#!/usr/bin/env python3
"""Build the static portfolio site.

    python build_site.py                 # content/ + media/ + static/  ->  site/
    python build_site.py --base-url https://example.com/
    python build_site.py --global-zip    # also add the big all-images ZIP
    .venv/bin/python -m http.server --directory site 8000   # preview

Only the Python standard library is required. If Pillow is installed, lightweight
WebP thumbnails are generated for the grids (cached in .cache/), otherwise the
original images are used everywhere.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import shutil
import sys
import zipfile
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote, urlparse

try:
    from PIL import Image, ImageOps
except ImportError:  # Pillow is optional
    Image = None

ROOT = Path(__file__).resolve().parent
CONTENT = ROOT / "content"
MEDIA = ROOT / "media"
STATIC = ROOT / "static"
CACHE = ROOT / ".cache" / "images"
OUT = ROOT / "site"

THUMB_WIDTH = 800
LARGE_WIDTH = 2000
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
VIDEO_EXT = {".mp4", ".webm", ".mov"}
GITHUB_FILE_LIMIT = 100 * 1024 * 1024

ICONS = {
    "back": '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>',
    "prev": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
    "next": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
    "play": '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l12.5-7.5z"/></svg>',
    "file": '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>',
    "eye": '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/></svg>',
    "download": '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></svg>',
}

warnings: list[str] = []


def esc(value) -> str:
    return html.escape(str(value), quote=True)


def load(name: str):
    return json.loads((CONTENT / name).read_text(encoding="utf-8"))


def url_path(path: str) -> str:
    return quote(path, safe="/#?=&")


@dataclass
class Picture:
    src: str
    width: int | None = None
    height: int | None = None


class Images:
    """Copies media into site/media and makes resized WebP variants when Pillow is available."""

    def __init__(self, enabled: bool):
        self.enabled = enabled and Image is not None
        self.used: set[str] = set()
        self.meta_file = CACHE / "meta.json"
        self.meta = json.loads(self.meta_file.read_text()) if self.meta_file.exists() else {}

    def original(self, rel: str) -> str:
        src = MEDIA / rel
        if not src.is_file():
            raise SystemExit(f"error: media file not found: media/{rel}")
        if rel not in self.used:
            dest = OUT / "media" / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            link_or_copy(src, dest)
            self.used.add(rel)
        return f"media/{rel}"

    def variant(self, rel: str, width: int) -> Picture:
        original = self.original(rel)
        if not self.enabled or Path(rel).suffix.lower() not in IMAGE_EXT:
            return Picture(original)
        src = MEDIA / rel
        stat = src.stat()
        key = f"{rel}@{width}"
        digest = hashlib.sha1(key.encode()).hexdigest()[:10]
        cached = CACHE / f"{digest}-{Path(rel).stem}-{width}.webp"
        info = self.meta.get(key)
        if not (info and cached.exists() and info["mtime"] == stat.st_mtime and info["size"] == stat.st_size):
            try:
                with Image.open(src) as im:
                    im = ImageOps.exif_transpose(im)
                    if im.width > width:
                        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
                    if im.mode not in ("RGB", "RGBA"):
                        im = im.convert("RGBA" if "transparency" in im.info or im.mode in ("LA", "P") else "RGB")
                    cached.parent.mkdir(parents=True, exist_ok=True)
                    im.save(cached, "WEBP", quality=82, method=5)
                    info = {"mtime": stat.st_mtime, "size": stat.st_size, "w": im.width, "h": im.height}
                    self.meta[key] = info
            except Exception as exc:  # unreadable image: fall back to the original file
                warnings.append(f"could not resize media/{rel}: {exc}")
                return Picture(original)
        out_rel = f"media/_resized/{Path(rel).parent.as_posix()}/{cached.name}"
        dest = OUT / out_rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        link_or_copy(cached, dest)
        return Picture(out_rel, info["w"], info["h"])

    def save(self):
        if self.enabled:
            CACHE.mkdir(parents=True, exist_ok=True)
            self.meta_file.write_text(json.dumps(self.meta, indent=1))


def link_or_copy(src: Path, dest: Path):
    if dest.exists():
        dest.unlink()
    try:
        os.link(src, dest)
    except OSError:
        shutil.copy2(src, dest)


class Page:
    def __init__(self, path: str):
        self.path = path  # e.g. "projets/pfs-2/index.html"
        self.depth = path.count("/")

    def rel(self, target: str) -> str:
        return url_path("../" * self.depth + target) if target else ("../" * self.depth or "./")


class Builder:
    def __init__(self, args):
        self.site = load("site.json")
        self.projects = load("projects.json")
        self.photos = load("photos.json")
        self.videos = load("videos.json")
        self.cv = load("cv.json")
        self.base_url = (args.base_url or self.site.get("base_url") or "").strip()
        if self.base_url and not self.base_url.endswith("/"):
            self.base_url += "/"
        self.images = Images(enabled=not args.no_thumbnails)
        self.make_zips = not args.no_zips
        self.global_zip = self.make_zips and args.global_zip
        self.pages: list[str] = []

    # ---------- layout ----------
    def layout(self, page: Page, *, title: str, body: str, active: str = "", description: str = "",
               image: str | None = None, canonical: str | None = None, absolute: bool = False) -> str:
        site = self.site
        rel = page.rel
        if absolute:  # 404.html can be served from any URL, so use root-based paths
            prefix = urlparse(self.base_url).path if self.base_url else "/"
            rel = lambda target: url_path(prefix + target)  # noqa: E731
        full_title = f"{title} — {site['name']}" if title else site["name"]
        description = description or site["description"]
        nav = "".join(
            '<a class="click-anim" href="{}"{}>{}</a>'.format(
                rel(item["href"]), ' aria-current="page"' if item["href"] == active else "", esc(item["label"]))
            for item in site["nav"]
        )
        head_extra = []
        canonical = canonical if canonical is not None else page.path.removesuffix("index.html")
        if self.base_url and not absolute:
            head_extra.append(f'<link rel="canonical" href="{esc(self.base_url + url_path(canonical))}">')
            head_extra.append(f'<meta property="og:url" content="{esc(self.base_url + url_path(canonical))}">')
            if image:
                head_extra.append(f'<meta property="og:image" content="{esc(self.base_url + url_path(image))}">')
        logo = self.images.original(site["logo"]) if site.get("logo") else None
        if logo:
            head_extra.append(f'<link rel="icon" type="image/png" href="{rel(logo)}">')
            head_extra.append(f'<link rel="apple-touch-icon" href="{rel(logo)}">')
        return f"""<!doctype html>
<html lang="{esc(site.get('language', 'fr'))}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(full_title)}</title>
<meta name="description" content="{esc(description)}">
<meta property="og:type" content="website">
<meta property="og:title" content="{esc(full_title)}">
<meta property="og:description" content="{esc(description)}">
{chr(10).join(head_extra)}
<link rel="stylesheet" href="{rel('assets/css/style.css')}">
<script src="{rel('assets/js/main.js')}" defer></script>
</head>
<body>
<header class="site-header">
<div class="inner">
<a class="brand" href="{rel('')}">{esc(site['name'])}</a>
<nav class="main-nav" aria-label="Navigation principale">{nav}</nav>
</div>
</header>
<main id="contenu">
{body}
</main>
</body>
</html>
"""

    def write(self, page: Page, content: str):
        dest = OUT / page.path
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(content, encoding="utf-8")
        self.pages.append(page.path)

    # ---------- components ----------
    def img(self, page: Page, rel_media: str, *, alt: str, width: int, gray: bool = False,
            lazy: bool = True, style: str = "") -> str:
        pic = self.images.variant(rel_media, width)
        attrs = [f'src="{page.rel(pic.src)}"', f'alt="{esc(alt)}"']
        if pic.width:
            attrs.append(f'width="{pic.width}" height="{pic.height}"')
        if lazy:
            attrs.append('loading="lazy" decoding="async"')
        if gray:
            attrs.append('class="gray"')
        if style:
            attrs.append(f'style="{esc(style)}"')
        return f"<img {' '.join(attrs)}>"

    def hero(self, page: Page, rel_media: str | None, alt: str) -> str:
        if not rel_media:
            return '<div class="hero"><div class="hero-placeholder" aria-hidden="true"></div></div>'
        return f'<div class="hero">{self.img(page, rel_media, alt=alt, width=LARGE_WIDTH, gray=True, lazy=False)}</div>'

    def subnav(self, items: list[tuple[str, str]]) -> str:
        if not items:
            return ""
        links = "".join(
            f'<a class="click-anim{" active" if i == 0 else ""}" href="#{esc(sid)}">{esc(label)}</a>'
            for i, (sid, label) in enumerate(items)
        )
        return f'<div class="subnav"><nav aria-label="Sections de la page">{links}</nav></div>'

    def section(self, sid: str, title: str, inner: str, large: bool = False, container: str = "") -> str:
        cls = "section-title large" if large else "section-title"
        heading = f'<h2 class="{cls}">{esc(title)}</h2>'
        if container:
            return f'<section id="{esc(sid)}" class="section"><div class="{container}">{heading}{inner}</div></section>'
        return f'<section id="{esc(sid)}" class="section">{heading}{inner}</section>'

    def image_section(self, page: Page, group: str, title: str, images: list[str], gray: bool) -> str:
        orig = [page.rel(self.images.original(p)) for p in images]
        grid = "".join(
            f'<button type="button" data-lightbox="{esc(group)}" data-src="{src}" data-alt="{esc(title)} {i}"'
            f' aria-label="Agrandir l’image {i} sur {len(images)}">'
            f'{self.img(page, p, alt=f"{title} {i}", width=THUMB_WIDTH, gray=gray)}</button>'
            for i, (p, src) in enumerate(zip(images, orig), 1)
        )
        slides = "".join(
            f'<button type="button" class="slide{" active" if i == 1 else ""}" data-lightbox="{esc(group)}"'
            f' data-src="{src}" data-alt="{esc(title)} {i}" aria-label="Agrandir l’image {i} sur {len(images)}">'
            f'{self.img(page, p, alt=f"{title} {i}", width=THUMB_WIDTH * 3 // 2, gray=gray)}</button>'
            for i, (p, src) in enumerate(zip(images, orig), 1)
        )
        arrows = counter = ""
        if len(images) > 1:
            arrows = (f'<button type="button" class="arrow prev" aria-label="Image précédente">{ICONS["prev"]}</button>'
                      f'<button type="button" class="arrow next" aria-label="Image suivante">{ICONS["next"]}</button>')
            counter = f'<div class="counter" aria-live="polite">1 / {len(images)}</div>'
        return (f'<div class="image-grid">{grid}</div>'
                f'<div class="carousel"><div class="slides">{slides}</div>{arrows}{counter}</div>')

    def video_tile(self, page: Page, video: dict, label: str, gray: bool = False) -> str:
        thumb = video.get("thumbnail")
        img = self.img(page, thumb, alt=label, width=THUMB_WIDTH, gray=gray) if thumb else ""
        watch = f"https://www.youtube.com/watch?v={video['youtube']}" + (f"&t={video['start']}s" if video.get("start") else "")
        start = f' data-start="{video["start"]}"' if video.get("start") else ""
        return (f'<div class="video"><a class="click-anim" role="button" href="{esc(watch)}" data-youtube="{esc(video["youtube"])}"{start}'
                f' aria-label="Lire : {esc(label)}">{img}<span class="play"><span>{ICONS["play"]}</span></span></a></div>')

    def file_row(self, page: Page, href: str, name: str, viewable: bool, download_name: str | None = None) -> str:
        actions = []
        if viewable:
            actions.append(f'<a class="button-link" href="{href}" target="_blank" rel="noopener" data-pdf data-name="{esc(name)}">{ICONS["eye"]}VOIR</a>')
        actions.append(f'<a class="button-link" href="{href}" download="{esc(download_name or name)}">{ICONS["download"]}TÉLÉCHARGER</a>')
        icon = ICONS["file"] if name.lower().endswith(".pdf") else ICONS["download"]
        return (f'<div class="file"><span class="file-name">{icon}<span>{esc(name)}</span></span>'
                f'<span class="file-actions">{"".join(actions)}</span></div>')

    # ---------- pages ----------
    def build_cv(self, path: str, active: str, canonical: str | None = None):
        page = Page(path)
        cv = self.cv
        blocks = "".join(
            f'<section><h3>{esc(s["title"])}</h3><ul>{"".join(f"<li>{esc(i)}</li>" for i in s["items"])}</ul></section>'
            for s in cv["sections"]
        )
        nav = [("cv", "CV")]
        body = [self.hero(page, cv.get("hero"), cv.get("hero_alt", self.site["name"]))]
        pdf = ""
        if cv.get("pdf"):
            nav.append(("pdf", "PDF"))
            href = page.rel(self.images.original(cv["pdf"]["file"]))
            pdf = self.section("pdf", "PDF", f'<div class="file-list">{self.file_row(page, href, cv["pdf"]["name"], True)}</div>', large=True)
        body.append(self.subnav(nav))
        ratio = ""
        if cv.get("hero"):
            pic = self.images.variant(cv["hero"], LARGE_WIDTH)
            if pic.width:
                ratio = f' style="--hero-ratio: {pic.width / pic.height:.4f}"'
        cv_section = self.section("cv", "CV", f'<p class="contact">{esc(cv["contact"])}</p>{blocks}', container="cv")
        body.append(cv_section.replace('<div class="cv">', f'<div class="cv"{ratio}>', 1))
        body.append(pdf)
        title = "" if path == "index.html" else "CV"
        self.write(page, self.layout(page, title=title, body="\n".join(body), active=active,
                                     image=self.images.original(cv["hero"]) if cv.get("hero") else None,
                                     canonical=canonical))

    def build_projects_index(self):
        page = Page("projets/index.html")
        out = []
        for category in self.projects["categories"]:
            cards = []
            for p in (p for p in self.projects["projects"] if p["category"] == category):
                scale = f"--scale: {p['cover_scale']}" if p.get("cover_scale") else ""
                cover = (self.img(page, p["cover"], alt="", width=THUMB_WIDTH, style=scale)
                         if p.get("cover") else '<span class="tile-placeholder"></span>')
                href = page.rel("projets/" + p["slug"] + "/")
                cards.append(
                    f'<a class="project-card" href="{href}">'
                    f'<span class="tile">{cover}<span class="caption"><span>{esc(p["title"])}</span></span></span></a>'
                )
            if cards:
                out.append(f'<section id="{esc(category)}" class="category"><h2 class="section-title">{esc(category)}</h2>'
                           f'<div class="project-grid">{"".join(cards)}</div></section>')
        if self.global_zip:
            out.append(f'<div class="download-all"><a class="button-link" href="{page.rel("downloads/portfolio-images.zip")}"'
                       f' download="Portfolio - images.zip">{ICONS["download"]}TOUT TÉLÉCHARGER (ZIP)</a></div>')
        self.write(page, self.layout(page, title="Projets", body="\n".join(out), active="projets/",
                                     description=f"Projets d’architecture et de lycée — {self.site['name']}"))

    def build_project(self, p: dict):
        page = Page(f"projets/{p['slug']}/index.html")
        meta = p["category"].upper() + (f" — {p['year']}" if p.get("year") else "")
        body = [
            f'<div class="back"><a class="click-anim" href="{page.rel("projets/")}">{ICONS["back"]}RETOUR</a></div>',
            self.hero(page, p.get("cover"), p["title"]),
            f'<div class="project-head"><h1>{esc(p["title"])}</h1><p class="meta">{esc(meta)}</p></div>',
            self.subnav([(s["id"], s["label"]) for s in p["sections"]]),
        ]
        if not p["sections"]:
            body.append('<p class="coming-soon">CONTENU À VENIR</p>')
        for s in p["sections"]:
            heading = s.get("heading", s["label"])
            kind = s["type"]
            if kind == "text":
                inner = f'<p class="prose">{esc(s["text"])}</p>'
            elif kind == "images":
                inner = self.image_section(page, f"{p['slug']}-{s['id']}", heading, s["images"], s.get("grayscale", True))
            elif kind == "videos":
                inner = '<div class="video-grid">' + "".join(
                    self.video_tile(page, v, f"{p['title']} — vidéo {i}", s.get("grayscale", True))
                    for i, v in enumerate(s["videos"], 1)) + "</div>"
            elif kind == "links":
                inner = '<div class="link-list">' + "".join(
                    f'<a class="text-link click-anim" href="{esc(link["url"])}" target="_blank" rel="noopener noreferrer">{esc(link["label"])}</a>'
                    for link in s["links"]) + "</div>"
            elif kind == "pdfs":
                rows = [self.file_row(page, page.rel(self.images.original(f["file"])), f["name"], f.get("viewable", True))
                        for f in s["files"]]
                if s.get("images_zip") and self.make_zips and self.project_images(p):
                    rows.append(self.file_row(page, page.rel(f"downloads/{p['slug']}-images.zip"), "toutes les images (zip)",
                                              False, download_name=f"{p['title']} - images.zip"))
                inner = f'<div class="file-list">{"".join(rows)}</div>'
            else:
                warnings.append(f"{p['slug']}: unknown section type {kind!r} skipped")
                continue
            body.append(self.section(s["id"], heading, inner, large=kind == "pdfs"))
        text = next((s["text"] for s in p["sections"] if s["type"] == "text"), "")
        description = " ".join(text.split())[:155] or f"{p['title']} — {meta.title()}"
        self.write(page, self.layout(page, title=p["title"], body="\n".join(body), active="projets/",
                                     description=description,
                                     image=self.images.original(p["cover"]) if p.get("cover") else None))
        redirect = Page(f"project/{p['id']}/index.html")
        target = redirect.rel(f"projets/{p['slug']}/")
        canonical = f'<link rel="canonical" href="{esc(self.base_url + "projets/" + p["slug"] + "/")}">' if self.base_url else ""
        self.write(redirect, f"""<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>{esc(p['title'])}</title>
<meta name="robots" content="noindex">{canonical}
<meta http-equiv="refresh" content="0; url={target}">
</head><body><p><a href="{target}">{esc(p['title'])}</a></p></body></html>
""")
        self.pages.remove(redirect.path)

    def build_photos(self):
        page = Page("photos/index.html")
        out = []
        total = sum(len(c["items"]) for c in self.photos["categories"])
        n = 0
        for category in self.photos["categories"]:
            tiles = []
            for item in category["items"]:
                n += 1
                src = page.rel(self.images.original(item["file"]))
                label = f'Agrandir : {item["title"]} ({n} sur {total})'
                if item.get("type") == "video":
                    media = (f'<video src="{src}" muted autoplay loop playsinline preload="metadata"'
                             f' aria-label="{esc(item["title"])}"></video>')
                else:
                    media = self.img(page, item["file"], alt=item["title"], width=THUMB_WIDTH)
                tiles.append(f'<button type="button" data-lightbox="photos" data-src="{src}" data-alt="{esc(item["title"])}"'
                             f' aria-label="{esc(label)}">{media}</button>')
            if tiles:
                out.append(f'<section id="{esc(category["name"])}" class="category photos">'
                           f'<h2 class="section-title">{esc(category["name"])}</h2><div class="photo-grid">{"".join(tiles)}</div></section>')
        self.write(page, self.layout(page, title="Photos", body="\n".join(out), active="photos/",
                                     description=f"Photographies — {self.site['name']}"))

    def build_videos(self):
        page = Page("videos/index.html")
        tiles = "".join(
            f'<div>{self.video_tile(page, v, v["title"])}<p class="video-title">{esc(v["title"])}</p></div>'
            for v in self.videos["videos"]
        )
        body = f'<div class="videos-page"><div class="video-grid">{tiles}</div></div>'
        self.write(page, self.layout(page, title="Vidéos", body=body, active="videos/",
                                     description=f"Vidéos — {self.site['name']}"))

    def build_404(self):
        page = Page("404.html")
        body = ('<div class="not-found"><p>PAGE INTROUVABLE</p>'
                f'<p><a class="text-link" href="{url_path((urlparse(self.base_url).path if self.base_url else "/") + "projets/")}">VOIR LES PROJETS</a></p></div>')
        self.write(page, self.layout(page, title="Page introuvable", body=body, absolute=True))
        self.pages.remove(page.path)

    # ---------- downloads ----------
    def project_images(self, p: dict) -> list[str]:
        files = [p["cover"]] if p.get("cover") else []
        for s in p["sections"]:
            files += s.get("images", []) if s["type"] == "images" else []
        return list(dict.fromkeys(files))

    def build_zips(self):
        if not self.make_zips:
            return
        downloads = OUT / "downloads"
        downloads.mkdir(parents=True, exist_ok=True)

        def write_zip(path: Path, entries: list[tuple[str, str]]):
            with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_STORED) as zf:
                used = set()
                for arcname, rel in entries:
                    name, n = arcname, 2
                    while name.lower() in used:
                        stem, dot, ext = arcname.rpartition(".")
                        name = f"{stem}-{n}.{ext}" if dot else f"{arcname}-{n}"
                        n += 1
                    used.add(name.lower())
                    zf.write(MEDIA / rel, name)
            if path.stat().st_size > GITHUB_FILE_LIMIT:
                warnings.append(f"{path.relative_to(OUT)} is {path.stat().st_size / 1e6:.0f} MB "
                                "(over GitHub's 100 MB file limit; use --no-zips or another host if needed)")

        everything = []
        for p in self.projects["projects"]:
            images = self.project_images(p)
            if not images:
                continue
            folder = safe_name(p["title"])
            write_zip(downloads / f"{p['slug']}-images.zip", [(f"{folder}/{Path(r).name}", r) for r in images])
            everything += [(f"Projets/{folder}/{Path(r).name}", r) for r in images]
        for category in self.photos["categories"]:
            everything += [(f"Photos/{safe_name(category['name'])}/{Path(i['file']).name}", i["file"])
                           for i in category["items"]]
        if self.global_zip:
            write_zip(downloads / "portfolio-images.zip", everything)

    # ---------- misc ----------
    def build_seo(self):
        if not self.base_url:
            (OUT / "robots.txt").write_text("User-agent: *\nAllow: /\n")
            warnings.append("no base URL set: sitemap.xml and canonical links skipped "
                            "(use --base-url or \"base_url\" in content/site.json)")
            return
        urls = "".join(
            f"<url><loc>{esc(self.base_url + url_path(p.removesuffix('index.html')))}</loc></url>\n"
            for p in sorted(self.pages)
        )
        (OUT / "sitemap.xml").write_text(
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            f'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{urls}</urlset>\n')
        (OUT / "robots.txt").write_text(f"User-agent: *\nAllow: /\nSitemap: {self.base_url}sitemap.xml\n")

    def run(self):
        if OUT.exists():
            shutil.rmtree(OUT)
        OUT.mkdir()
        shutil.copytree(STATIC, OUT / "assets")
        (OUT / ".nojekyll").write_text("")
        self.build_cv("index.html", active="cv/", canonical="")
        self.build_cv("cv/index.html", active="cv/", canonical="")
        self.build_projects_index()
        for project in self.projects["projects"]:
            self.build_project(project)
        self.build_photos()
        self.build_videos()
        self.build_404()
        self.build_zips()
        self.build_seo()
        self.images.save()


def safe_name(text: str) -> str:
    return "".join("-" if c in '<>:"/\\|?*' else c for c in text).strip(" .") or "sans-titre"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base-url", help="public URL of the site, e.g. https://example.com/ (for sitemap/canonical)")
    parser.add_argument("--no-thumbnails", action="store_true", help="use original images everywhere")
    parser.add_argument("--no-zips", action="store_true", help="skip all image ZIP downloads")
    parser.add_argument("--global-zip", action="store_true",
                        help="also build the ~250 MB 'TOUT TÉLÉCHARGER (ZIP)' archive of every image")
    args = parser.parse_args()
    if Image is None and not args.no_thumbnails:
        warnings.append("Pillow is not installed: grids use the original images (pip install pillow)")
    builder = Builder(args)
    builder.run()
    files = [p for p in OUT.rglob("*") if p.is_file()]
    size = sum(p.stat().st_size for p in files)
    print(f"Built {len(builder.pages)} pages into {OUT.relative_to(ROOT)}/ ({len(files)} files, {size / 1e6:.0f} MB)")
    for warning in dict.fromkeys(warnings):
        print(f"warning: {warning}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
