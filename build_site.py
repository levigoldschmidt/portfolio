#!/usr/bin/env python3
"""Build the static portfolio site.

    python build_site.py                 # content/ + media/ + static/  ->  site/
    python build_site.py --base-url https://example.com/
    python build_site.py --global-zip    # also add the big all-images ZIP
    .venv/bin/python -m http.server --directory site 8000   # preview

Pillow generates cached WebP image variants up to 800 px for thumbnails and
2000 px for larger views. FFmpeg creates cached poster frames for local videos.
The original files remain untouched.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import shutil
import subprocess
import sys
import zipfile
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote, urlparse

import imageio_ffmpeg

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
        self.translations = load("translations.en.json")
        self.language = "fr"
        self.base_url = (args.base_url or self.site.get("base_url") or "").strip()
        if self.base_url and not self.base_url.endswith("/"):
            self.base_url += "/"
        self.images = Images(enabled=not args.no_thumbnails)
        self.make_zips = args.enable_image_downloads and not args.no_zips
        self.global_zip = self.make_zips and args.global_zip
        self.pages: list[str] = []
        self.style_version = hashlib.sha256((STATIC / "css" / "style.css").read_bytes()).hexdigest()[:12]
        self.script_version = hashlib.sha256((STATIC / "js" / "main.js").read_bytes()).hexdigest()[:12]
        self.fbx_script_version = hashlib.sha256((STATIC / "js" / "fbx-viewer.js").read_bytes()).hexdigest()[:12]

    def tr(self, text: str, **values: str | int) -> str:
        translated = self.translations.get(text, text) if self.language == "en" else text
        return translated.format(**values) if values else translated

    def localized_target(self, target: str) -> str:
        if self.language != "en":
            return target
        return f"en/{target}" if target else "en/"

    @staticmethod
    def files_in_folders(folders: list[str], extensions: set[str]) -> list[str]:
        files = []
        for folder in folders:
            directory = MEDIA / folder
            if not directory.is_dir():
                raise SystemExit(f"error: media folder not found: media/{folder}")
            files.extend(
                path.relative_to(MEDIA).as_posix()
                for path in sorted(directory.iterdir(), key=lambda item: item.name.lower())
                if path.is_file() and path.suffix.lower() in extensions
            )
        return files

    # ---------- layout ----------
    def layout(self, page: Page, *, title: str, body: str, active: str = "", description: str = "",
               image: str | None = None, canonical: str | None = None, absolute: bool = False) -> str:
        site = self.site
        rel = page.rel
        if absolute:  # 404.html can be served from any URL, so use root-based paths
            prefix = urlparse(self.base_url).path if self.base_url else "/"
            rel = lambda target: url_path(prefix + target)  # noqa: E731
        title = self.tr(title)
        full_title = f"{title} — {site['name']}" if title else site["name"]
        description = self.tr(description) if description else self.tr(site["description"])
        nav = "".join(
            '<a class="click-anim" href="{}"{}>{}</a>'.format(
                rel(self.localized_target(item["href"])),
                ' aria-current="page"' if item["href"] == active else "",
                esc(self.tr(item["label"])))
            for item in site["nav"]
        )
        route = page.path.removesuffix("index.html")
        if self.language == "en":
            french_page = route.removeprefix("en/")
            english_page = route
        else:
            french_page = route
            english_page = f"en/{route}"
        french_current = ' aria-current="page"' if self.language == "fr" else ""
        english_current = ' aria-current="page"' if self.language == "en" else ""
        language_label = "Language" if self.language == "en" else "Langue"
        language_switch = (
            f'<nav class="language-switch" aria-label="{language_label}">'
            f'<a href="{rel(french_page)}"{french_current}>FR</a>'
            '<span aria-hidden="true">/</span>'
            f'<a href="{rel(english_page)}"{english_current}>EN</a>'
            '</nav>'
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
<html lang="{self.language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(full_title)}</title>
<meta name="description" content="{esc(description)}">
<meta property="og:type" content="website">
<meta property="og:title" content="{esc(full_title)}">
<meta property="og:description" content="{esc(description)}">
{chr(10).join(head_extra)}
<link rel="stylesheet" href="{rel('assets/css/style.css')}?v={self.style_version}">
<script type="importmap">{{"imports":{{"three":"https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"}}}}</script>
<script src="{rel('assets/js/main.js')}?v={self.script_version}" defer></script>
</head>
<body>
<header class="site-header">
<div class="inner">
<a class="brand" href="{rel(self.localized_target(''))}">{esc(site['name'])}</a>
<nav class="main-nav" aria-label="{esc(self.tr("Navigation principale"))}">{nav}</nav>
{language_switch}
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

    def hero(self, page: Page, rel_media: str | None, alt: str, gray: bool = True) -> str:
        if not rel_media:
            return '<div class="hero"><div class="hero-placeholder" aria-hidden="true"></div></div>'
        return f'<div class="hero">{self.img(page, rel_media, alt=alt, width=LARGE_WIDTH, gray=gray, lazy=False)}</div>'

    def subnav(self, items: list[tuple[str, str]]) -> str:
        if not items:
            return ""
        links = "".join(
            f'<a class="click-anim{" active" if i == 0 else ""}" href="#{esc(sid)}">{esc(self.tr(label))}</a>'
            for i, (sid, label) in enumerate(items)
        )
        return f'<div class="subnav"><nav aria-label="{esc(self.tr("Sections de la page"))}">{links}</nav></div>'

    def section(self, sid: str, title: str, inner: str, large: bool = False, container: str = "",
                requires_code: bool = False) -> str:
        cls = "section-title large" if large else "section-title"
        heading = f'<h2 class="{cls}">{esc(title)}</h2>'
        if requires_code:
            inner = (
                f'<div class="protected-area" data-protected-area>'
                f'<div class="protected-content" aria-hidden="true" inert>{inner}</div>'
                '<form class="protected-gate" data-code-gate>'
                f'<p class="protected-title">{esc(self.tr("Contenu protégé"))}</p>'
                f'<label for="{esc(sid)}-access-code">{esc(self.tr("Entrez le code pour voir ce contenu."))}</label>'
                '<div class="protected-controls">'
                f'<input id="{esc(sid)}-access-code" name="access-code" type="password" inputmode="numeric" '
                f'autocomplete="off" maxlength="4" pattern="[0-9]{{4}}" required aria-label="{esc(self.tr("Code d’accès"))}">'
                f'<button type="submit">{esc(self.tr("Déflouter"))}</button>'
                '</div>'
                f'<p class="protected-error" role="alert" hidden>{esc(self.tr("Code incorrect. Réessayez."))}</p>'
                '</form></div>'
            )
        if container:
            return f'<section id="{esc(sid)}" class="section"><div class="{container}">{heading}{inner}</div></section>'
        return f'<section id="{esc(sid)}" class="section">{heading}{inner}</section>'

    def video_poster(self, rel_media: str) -> str:
        src = MEDIA / rel_media
        stat = src.stat()
        digest = hashlib.sha1(f"{rel_media}:{stat.st_mtime_ns}:{stat.st_size}".encode()).hexdigest()[:16]
        cached = CACHE / "video-posters" / f"{digest}.jpg"
        if not cached.exists():
            cached.parent.mkdir(parents=True, exist_ok=True)
            temporary = cached.with_name(f"{cached.stem}.tmp.jpg")
            result = subprocess.run(
                [
                    imageio_ffmpeg.get_ffmpeg_exe(),
                    "-hide_banner", "-loglevel", "error", "-ss", "0.5", "-i", str(src),
                    "-frames:v", "1", "-vf", "scale=w='min(800,iw)':h=-2",
                    "-q:v", "3", "-y", str(temporary),
                ],
                capture_output=True,
                text=True,
            )
            if result.returncode or not temporary.is_file():
                error = result.stderr.strip() or "no frame was produced"
                if temporary.exists():
                    temporary.unlink()
                raise SystemExit(f"error: could not create video thumbnail for media/{rel_media}: {error}")
            temporary.replace(cached)

        output = f"media/_resized/video-posters/{cached.name}"
        dest = OUT / output
        dest.parent.mkdir(parents=True, exist_ok=True)
        link_or_copy(cached, dest)
        return output

    def media_thumbnail(self, page: Page, rel_media: str, alt: str, gray: bool) -> str:
        if Path(rel_media).suffix.lower() not in VIDEO_EXT:
            return self.img(page, rel_media, alt=alt, width=THUMB_WIDTH, gray=gray)
        poster = page.rel(self.video_poster(rel_media))
        gray_class = ' class="gray"' if gray else ""
        return (f'<img src="{poster}" alt="{esc(alt)}"{gray_class} loading="lazy" decoding="async">'
                f'<span class="video-play" aria-hidden="true">{ICONS["play"]}</span>')

    def image_section(self, page: Page, group: str, title: str, images: list[str], grayscale: bool,
                      mute_videos: bool = False) -> str:
        media = images
        large_media = []
        for path in media:
            if Path(path).suffix.lower() in VIDEO_EXT:
                large_media.append(page.rel(self.images.original(path)))
            else:
                large_media.append(page.rel(self.images.variant(path, LARGE_WIDTH).src))
        gray_attr = " data-grayscale=true" if grayscale else ""
        grid = "".join(
            f'<button type="button" class="image-thumbnail{" video-thumbnail" if Path(p).suffix.lower() in VIDEO_EXT else ""}"'
            f' data-lightbox="{esc(group)}" data-src="{src}" data-alt="{esc(title)} {i}"'
            f'{" data-muted=true" if mute_videos and Path(p).suffix.lower() in VIDEO_EXT else ""}'
            f'{gray_attr}'
            f' aria-label="{esc(self.tr("Agrandir ou lire l’élément {i} sur {count}", i=i, count=len(media)))}">'
            f'{self.media_thumbnail(page, p, f"{title} {i}", grayscale)}</button>'
            for i, (p, src) in enumerate(zip(media, large_media), 1)
        )
        slides = "".join(
            f'<button type="button" class="slide{" active" if i == 1 else ""}'
            f'{" video-thumbnail" if Path(p).suffix.lower() in VIDEO_EXT else ""}" data-lightbox="{esc(group)}"'
            f' data-src="{src}" data-alt="{esc(title)} {i}"'
            f'{" data-muted=true" if mute_videos and Path(p).suffix.lower() in VIDEO_EXT else ""}'
            f'{gray_attr}'
            f' aria-label="{esc(self.tr("Agrandir ou lire l’élément {i} sur {count}", i=i, count=len(media)))}">'
            f'{self.media_thumbnail(page, p, f"{title} {i}", grayscale)}</button>'
            for i, (p, src) in enumerate(zip(media, large_media), 1)
        )
        arrows = counter = ""
        if len(media) > 1:
            arrows = (f'<button type="button" class="arrow prev" aria-label="{esc(self.tr("Image précédente"))}">{ICONS["prev"]}</button>'
                      f'<button type="button" class="arrow next" aria-label="{esc(self.tr("Image suivante"))}">{ICONS["next"]}</button>')
            counter = f'<div class="counter" aria-live="polite">1 / {len(media)}</div>'
        return (f'<div class="image-grid">{grid}</div>'
                f'<div class="carousel"><div class="slides">{slides}</div>{arrows}{counter}</div>')

    def video_tile(self, page: Page, video: dict, label: str, gray: bool = False) -> str:
        thumb = video.get("thumbnail")
        img = self.img(page, thumb, alt=label, width=THUMB_WIDTH, gray=gray) if thumb else ""
        watch = f"https://www.youtube.com/watch?v={video['youtube']}" + (f"&t={video['start']}s" if video.get("start") else "")
        start = f' data-start="{video["start"]}"' if video.get("start") else ""
        grayscale = " data-grayscale=true" if gray else ""
        muted = " data-muted=true" if video.get("muted") else ""
        return (f'<div class="video"><a class="click-anim" role="button" href="{esc(watch)}" data-youtube="{esc(video["youtube"])}"{start}'
                f'{grayscale}{muted}'
                f' aria-label="{esc(self.tr("Lire : {label}", label=label))}">{img}<span class="play"><span>{ICONS["play"]}</span></span></a></div>')

    def local_video_tile(self, page: Page, group: str, rel_media: str) -> str:
        src = page.rel(self.images.original(rel_media))
        title = self.tr(Path(rel_media).stem.replace("_", " ").replace("-", " "))
        return (f'<div><div class="video"><button type="button" data-lightbox="{esc(group)}-videos"'
                f' data-src="{src}" data-alt="{esc(title)}" aria-label="{esc(self.tr("Lire : {label}", label=title))}">'
                f'<video src="{src}" muted playsinline preload="none"></video>'
                f'<span class="play"><span>{ICONS["play"]}</span></span></button></div>'
                f'<p class="video-title">{esc(title)}</p></div>')

    def file_row(self, page: Page, href: str, name: str, viewable: bool, download_name: str | None = None) -> str:
        actions = []
        if viewable:
            actions.append(f'<a class="button-link" href="{href}" target="_blank" rel="noopener" data-pdf data-name="{esc(download_name or name)}">{ICONS["eye"]}{esc(self.tr("VOIR"))}</a>')
        actions.append(f'<a class="button-link" href="{href}" download="{esc(download_name or name)}">{ICONS["download"]}{esc(self.tr("TÉLÉCHARGER"))}</a>')
        icon = ICONS["file"] if name.lower().endswith(".pdf") else ICONS["download"]
        return (f'<div class="file"><span class="file-name">{icon}<span>{esc(name)}</span></span>'
                f'<span class="file-actions">{"".join(actions)}</span></div>')

    # ---------- pages ----------
    def build_cv(self, path: str, active: str, canonical: str | None = None):
        page = Page(path)
        cv = self.cv
        blocks = []
        for section in cv["sections"]:
            if section.get("layout") == "timeline":
                entries = []
                for item in section["items"]:
                    meta = f' <em>{esc(self.tr(item["meta"]))}</em>' if item.get("meta") else ""
                    description = f'<p>{esc(self.tr(item["description"]))}</p>' if item.get("description") else ""
                    entries.append(
                        '<article class="cv-entry">'
                        f'<p class="cv-entry-heading"><strong>{esc(self.tr(item["heading"]))}</strong>{meta}</p>'
                        f'{description}</article>'
                    )
                content = f'<div class="cv-timeline">{"".join(entries)}</div>'
            else:
                separator = ":" if self.language == "en" else " :"
                items = "".join(
                    f'<li><strong>{esc(self.tr(item["label"]))}{separator}</strong> {esc(self.tr(item["text"]))}</li>'
                    for item in section["items"]
                )
                content = f'<ul class="cv-bullets">{items}</ul>'
            blocks.append(f'<section class="cv-group"><h3>{esc(self.tr(section["title"]))}</h3>{content}</section>')
        blocks = "".join(blocks)
        nav = [("cv", "CV")]
        pdf = ""
        if cv.get("pdf"):
            nav.append(("pdf", "PDF"))
            href = page.rel(self.images.original(cv["pdf"]["file"]))
            pdf_name = f'{cv["pdf"]["name"]} (French)' if self.language == "en" else cv["pdf"]["name"]
            pdf = self.section(
                "pdf", "PDF",
                f'<div class="file-list">{self.file_row(page, href, pdf_name, True, download_name=cv["pdf"]["name"])}</div>',
                large=True,
            )
        photo = self.img(page, cv["hero"], alt=cv.get("hero_alt", cv["name"]), width=LARGE_WIDTH, gray=True, lazy=False)
        contacts = []
        for item in cv["contacts"]:
            value = f'<a href="{esc(item["href"])}">{esc(self.tr(item["label"]))}</a>' if item.get("href") else esc(self.tr(item["label"]))
            contacts.append(f"<li>{value}</li>")
        contacts = "".join(contacts)
        profile = f'<p class="cv-profile-text">{esc(self.tr(cv["profile"]))}</p>' if cv.get("profile") else ""
        cv_header = (
            f'<header class="cv-profile"><div class="cv-photo">{photo}</div>'
            f'<div class="cv-identity"><ul class="cv-contact">{contacts}</ul>{profile}</div>'
            '</header>'
        )
        body = [
            self.subnav(nav),
            f'<section id="cv" class="section cv-section"><div class="cv">{cv_header}'
            f'<h2 class="section-title">CV</h2>{blocks}</div></section>',
        ]
        body.append(pdf)
        title = "" if path == "index.html" else "CV"
        self.write(page, self.layout(page, title=title, body="\n".join(body), active=active,
                                     image=self.images.original(cv["hero"]) if cv.get("hero") else None,
                                     canonical=canonical))

    def build_projects_index(self):
        page = Page(self.localized_target("projets/index.html"))
        categories = [
            category for category in self.projects["categories"]
            if any(project["category"] == category for project in self.projects["projects"])
        ]
        out = [self.subnav([(category, category) for category in categories])]
        for category in self.projects["categories"]:
            cards = []
            for p in (p for p in self.projects["projects"] if p["category"] == category):
                scale = f"--scale: {p['cover_scale']}" if p.get("cover_scale") else ""
                cover = (self.img(page, p["cover"], alt="", width=THUMB_WIDTH, style=scale)
                         if p.get("cover") else '<span class="tile-placeholder"></span>')
                href = page.rel(self.localized_target("projets/" + p["slug"] + "/"))
                cards.append(
                    f'<a class="project-card" href="{href}">'
                    f'<span class="tile">{cover}<span class="caption"><span>{esc(self.tr(p["title"]))}</span></span></span></a>'
                )
            if cards:
                out.append(f'<section id="{esc(category)}" class="category"><h2 class="section-title">{esc(self.tr(category))}</h2>'
                           f'<div class="project-grid">{"".join(cards)}</div></section>')
        if self.global_zip:
            out.append(f'<div class="download-all"><a class="button-link" href="{page.rel("downloads/portfolio-images.zip")}"'
                       f' download="Portfolio - images.zip">{ICONS["download"]}{esc(self.tr("TOUT TÉLÉCHARGER (ZIP)"))}</a></div>')
        description = (f"Architecture and high-school projects — {self.site['name']}" if self.language == "en"
                       else f"Projets d’architecture et de lycée — {self.site['name']}")
        self.write(page, self.layout(page, title="Projets", body="\n".join(out), active="projets/",
                                     description=description))

    def build_project(self, p: dict):
        page = Page(self.localized_target(f"projets/{p['slug']}/index.html"))
        title = self.tr(p["title"])
        meta = self.tr(p["category"]).upper() + (f" — {p['year']}" if p.get("year") else "")
        body = [
            f'<div class="back"><a class="click-anim" href="{page.rel(self.localized_target("projets/"))}">{ICONS["back"]}{esc(self.tr("RETOUR"))}</a></div>',
            self.hero(page, p.get("cover"), title, gray=p["category"] == "Architecture"),
            f'<div class="project-head"><h1>{esc(title)}</h1><p class="meta">{esc(meta)}</p></div>',
            self.subnav([(s["id"], s["label"]) for s in p["sections"]]),
        ]
        if not p["sections"]:
            body.append(f'<p class="coming-soon">{esc(self.tr("CONTENU À VENIR"))}</p>')
        for s in p["sections"]:
            heading = self.tr(s.get("heading", s["label"]))
            kind = s["type"]
            if kind == "text":
                inner = f'<p class="prose">{esc(self.tr(s["text"]))}</p>'
            elif kind == "3d_model":
                model = page.rel(self.images.original(s["file"]))
                inner = (
                    '<div class="interactive-model" data-fbx-viewer>'
                    f'<div class="model-stage" data-model-stage><div class="model-orientation" data-model-orientation '
                    f'aria-label="{esc(self.tr("Cube d’orientation"))}" hidden></div>'
                    f'<p class="model-status" role="status">'
                    f'{esc(self.tr("Chargement du modèle 3D…"))}</p></div>'
                    '<div class="model-controls">'
                    f'<p>{esc(self.tr("Faites glisser pour faire tourner le modèle, utilisez la molette ou pincez pour zoomer, et le clic droit ou deux doigts pour le déplacer."))}</p>'
                    f'<button type="button" data-model-reset>{esc(self.tr("Réinitialiser les plans"))}</button>'
                    f'</div><div class="model-cut-controls" data-model-cut-controls '
                    f'aria-label="{esc(self.tr("Plans de coupe"))}" hidden></div>'
                    f'<p class="model-slicing-note">{esc(self.tr("Chaque plan se déplace selon sa normale et s’incline avec les rotations X/Y/Z ; les surfaces de coupe ne sont pas refermées."))}</p>'
                    f'<span class="visually-hidden" data-model-src="{esc(model)}"></span></div>'
                    f'<script type="module" src="{page.rel("assets/js/fbx-viewer.js")}?v={self.fbx_script_version}"></script>'
                )
            elif kind == "images":
                images = s.get("images")
                if "folders" in s:
                    images = self.files_in_folders(s["folders"], IMAGE_EXT)
                if "video_folders" in s:
                    images += self.files_in_folders(s["video_folders"], VIDEO_EXT)
                inner = self.image_section(page, f"{p['slug']}-{s['id']}", heading, images,
                                           p["category"] == "Architecture", s.get("mute_videos", False))
            elif kind == "videos":
                if "folders" in s:
                    videos = self.files_in_folders(s["folders"], VIDEO_EXT)
                    tiles = "".join(self.local_video_tile(page, p["slug"], video) for video in videos)
                else:
                    tiles = "".join(
                        self.video_tile(page, v, f"{title} — {self.tr('Vidéo').lower()} {i}", p["category"] == "Architecture")
                        for i, v in enumerate(s["videos"], 1))
                inner = f'<div class="video-grid">{tiles}</div>'
            elif kind == "links":
                inner = ""
                if s.get("instagram_posts"):
                    fallback = esc(self.tr("Instagram — @aeris.racing"))
                    posts = "".join(
                        f'<blockquote class="instagram-media" data-instgrm-permalink="{esc(url)}" data-instgrm-version="14">'
                        f'<a href="{esc(url)}" target="_blank" rel="noopener noreferrer">{fallback}</a></blockquote>'
                        for url in s["instagram_posts"])
                    inner += f'<div class="instagram-grid">{posts}</div>'
                inner += '<div class="link-list">' + "".join(
                    f'<a class="text-link click-anim" href="{esc(link["url"])}" target="_blank" rel="noopener noreferrer">{esc(self.tr(link["label"]))}</a>'
                    for link in s["links"]) + "</div>"
            elif kind == "pdfs":
                rows = [self.file_row(page, page.rel(self.images.original(f["file"])), f["name"], f.get("viewable", True))
                        for f in s["files"]]
                if s.get("images_zip") and self.make_zips and self.project_images(p):
                    rows.append(self.file_row(page, page.rel(f"downloads/{p['slug']}-images.zip"),
                                              self.tr("toutes les images (zip)"), False,
                                              download_name=f"{title} - images.zip"))
                inner = f'<div class="file-list">{"".join(rows)}</div>'
            else:
                warnings.append(f"{p['slug']}: unknown section type {kind!r} skipped")
                continue
            body.append(self.section(s["id"], heading, inner, large=kind == "pdfs",
                                     requires_code=s.get("requires_code", False)))
        text = next((s["text"] for s in p["sections"] if s["type"] == "text"), "")
        description = " ".join(self.tr(text).split())[:155] or f"{title} — {meta.title()}"
        self.write(page, self.layout(page, title=title, body="\n".join(body), active="projets/",
                                     description=description,
                                     image=self.images.original(p["cover"]) if p.get("cover") else None))
        if self.language != "fr":
            return
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
        page = Page(self.localized_target("photos/index.html"))
        categories = [category for category in self.photos["categories"] if category["items"]]
        out = [self.subnav([(category["name"], category["name"]) for category in categories])]
        total = sum(len(c["items"]) for c in self.photos["categories"])
        n = 0
        for category in self.photos["categories"]:
            tiles = []
            for item in category["items"]:
                n += 1
                title = self.tr(item["title"])
                src = page.rel(self.images.variant(item["file"], LARGE_WIDTH).src)
                label = self.tr("Agrandir : {title} ({index} sur {total})", title=title, index=n, total=total)
                if item.get("type") == "video":
                    media = (f'<video src="{src}" muted autoplay loop playsinline preload="metadata"'
                             f' aria-label="{esc(title)}"></video>')
                else:
                    media = self.img(page, item["file"], alt=title, width=THUMB_WIDTH)
                tiles.append(f'<button type="button" data-lightbox="photos" data-src="{src}" data-alt="{esc(title)}"'
                             f' aria-label="{esc(label)}">{media}</button>')
            if tiles:
                category_name = self.tr(category["name"])
                out.append(f'<section id="{esc(category["name"])}" class="category photos">'
                           f'<h2 class="section-title">{esc(category_name)}</h2><div class="photo-grid">{"".join(tiles)}</div></section>')
        description = (f"Photography — {self.site['name']}" if self.language == "en"
                       else f"Photographies — {self.site['name']}")
        self.write(page, self.layout(page, title="Photos", body="\n".join(out), active="photos/",
                                     description=description))

    def build_videos(self):
        page = Page(self.localized_target("videos/index.html"))
        tiles = "".join(
            f'<div>{self.video_tile(page, v, self.tr(v["title"]))}<p class="video-title">{esc(self.tr(v["title"]))}</p></div>'
            for v in self.videos["videos"]
        )
        body = f'<div class="videos-page"><div class="video-grid">{tiles}</div></div>'
        description = (f"Videos — {self.site['name']}" if self.language == "en"
                       else f"Vidéos — {self.site['name']}")
        self.write(page, self.layout(page, title="Vidéos", body=body, active="videos/",
                                     description=description))

    def build_404(self):
        page = Page("en/404.html" if self.language == "en" else "404.html")
        projects = self.localized_target("projets/")
        body = (f'<div class="not-found"><p>{esc(self.tr("PAGE INTROUVABLE"))}</p>'
                f'<p><a class="text-link" href="{url_path((urlparse(self.base_url).path if self.base_url else "/") + projects)}">{esc(self.tr("VOIR LES PROJETS"))}</a></p></div>')
        self.write(page, self.layout(page, title="Page introuvable", body=body, absolute=True))
        self.pages.remove(page.path)

    # ---------- downloads ----------
    def project_images(self, p: dict) -> list[str]:
        files = [p["cover"]] if p.get("cover") else []
        for s in p["sections"]:
            if s["type"] != "images":
                continue
            files += s.get("images", [])
            if "folders" in s:
                files += self.files_in_folders(s["folders"], IMAGE_EXT)
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
            if p.get("download_images_zip", True):
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
        for language in ("fr", "en"):
            self.language = language
            prefix = "en/" if language == "en" else ""
            self.build_cv(f"{prefix}index.html", active="cv/", canonical="en/" if language == "en" else "")
            self.build_cv(f"{prefix}cv/index.html", active="cv/", canonical="en/cv/" if language == "en" else "cv/")
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
    parser.add_argument("--enable-image-downloads", action="store_true",
                        help="include downloadable ZIP archives of project and photo images")
    parser.add_argument("--no-zips", action="store_true", help="skip all image ZIP downloads")
    parser.add_argument("--global-zip", action="store_true",
                        help="also build the ~250 MB 'TOUT TÉLÉCHARGER (ZIP)' archive (requires --enable-image-downloads)")
    args = parser.parse_args()
    if Image is None and not args.no_thumbnails:
        parser.error("Pillow is required for image resizing; install dependencies with "
                     "'python -m pip install -r requirements.txt' or use --no-thumbnails")
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
