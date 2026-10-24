# Goldschmidt Levi portfolio

A plain HTML/CSS/JavaScript version of <https://goldschmidt-levi.base44.app/>.
There is no framework and no runtime dependency: the `site/` folder can be hosted
on any static host (GitHub Pages, Netlify, Cloudflare Pages, OVH, etc.).

## How it works

```
content/*.json  ─┐
media/           ├──> python build_site.py ──> site/  (finished static website)
static/css, js  ─┘
```

- `content/site.json`: site name, description, navigation, logo.
- `content/projects.json`: categories and projects, in display order. Each
  project has a title, year, cover and a list of `sections`:
  - `text`
  - `images` (`grayscale: true|false`)
  - `videos` (YouTube id, optional start time)
  - `links`
  - `pdfs` (`viewable: true` adds a VOIR button)
- `content/photos.json`, `content/videos.json`, `content/cv.json`: the other
  pages.
- `media/`: every image, PDF and video, referenced from the JSON by their path
  relative to `media/`.
- `static/css/style.css`, `static/js/main.js`: the hand-written styles and
  behavior (lightbox, mobile carousels, click-to-load YouTube, PDF viewer,
  section navigation). These files are copied to `site/assets/`.
- `build_site.py`: the generator. It uses Python's standard library plus
  Pillow, which makes resized WebP versions of the images.

## Edit and preview

```sh
source .venv/bin/activate          # or: python3 -m venv .venv && pip install -r requirements.txt
# 1. edit content/*.json and add files to media/
python build_site.py               # 2. rebuild site/
.venv/bin/python -m http.server --directory site 8000   # 3. open http://127.0.0.1:8000/
```

To run the already-built website locally, without rebuilding it, only run the
last command (the `site/` folder must exist) and open
<http://127.0.0.1:8000/>. Press `Ctrl+C` to stop the server.
- **Adding a project:** copy a project block in `content/projects.json`,
  give it a unique `slug`, and put its images in `media/projets/<slug>/`.
- **Image thumbnails:** they are cached in `.cache/`. The first build takes a
  few minutes, later builds take seconds.
- **`site/`:** it is regenerated on every build, so don't edit it by hand.

### Build options

| Option | Effect |
| --- | --- |
| `--base-url https://example.com` | Adds canonical links and `sitemap.xml` (set this for the real domain). |
| `--no-thumbnails` | Uses the original images instead of resized WebP versions. |
| `--no-zips` | Skips the per-project “images ZIP” downloads. |
| `--global-zip` | Also builds `downloads/portfolio-images.zip` (about 250 MB, too large for GitHub Pages). |

## Deploy

- **Upload:** upload the *contents* of `site/` to the host.
- **Size:** the full site is about 500 MB, mostly the PDFs and images. The
  largest files are the project PDFs and ZIPs, all under 100 MB.
- **GitHub Pages:** see the next section. `site/` is git-ignored, because it
  is generated.
- **Netlify or Cloudflare Pages:** drag and drop the `site/` folder, or set
  the build command to `pip install -r requirements.txt && python build_site.py`
  and the publish directory to `site`.
- **Routes:** each page is a folder with an `index.html`, such as `/projets/`,
  `/photos/`, `/videos/`, `/cv/` and `/projets/<slug>/`.
  - The old Base44 URLs (`/project/<id>`) redirect to the new pages.
  - `404.html` is used by hosts that support it.

### GitHub Pages

[.github/workflows/pages.yml](.github/workflows/pages.yml) builds the site
and publishes it on every push to `main`. The base URL is set automatically,
including the `/<repo>/` sub-path of project sites.

1. Create an empty repository on GitHub, without a README.
2. Push this folder:

   ```sh
   git init -b main
   git add .
   git commit -m "Static portfolio"
   git remote add origin https://github.com/<user>/<repo>.git
   git push -u origin main
   ```

   The first push uploads about 290 MB of `media/`, so it can take a few minutes.
3. On GitHub, open **Settings → Pages** and set **Source** to **GitHub Actions**.
4. Open the **Actions** tab and wait for "Deploy to GitHub Pages".
   - The first run takes about 5 minutes, because the image thumbnails are generated.
   - Later runs take about 1 minute, because the thumbnails are cached.
   - If the first run failed because step 3 wasn't done yet, re-run it.
5. The site is online at `https://<user>.github.io/<repo>/`. A repository
   named `<user>.github.io` is served at `https://<user>.github.io/` instead.

To update the site later, edit `content/` or `media/`, then `git commit` and
`git push`.

**Custom domain (optional):**
- Enter the domain in **Settings → Pages → Custom domain**.
- Add the DNS records that GitHub shows.
- Enable **Enforce HTTPS**.

**Notes:**
- GitHub Pages limits a site to 1 GB and each file to 100 MB; this site is
  about 500 MB and its largest file is under 50 MB. Don't enable
  `--global-zip` in the workflow, because that ZIP is about 250 MB.
- A public repository makes the PDFs and photos in `media/` public, as they
  already are on the website. Private repositories need a paid plan to use
  GitHub Pages.

## Known content gaps

- **Missing PDFs:** two PDFs returned HTTP 403 on the original site and are
  missing: `MAEUProjectfinalpresentation.pdf` and `StatiqueAvecFrottements…pdf`.
  Add them to the project's `pdfs` section in `content/projects.json` if you
  have the files.
- **Empty project:** "S2 Projet 1 : the room" has no content on the original
  site either, so it shows "CONTENU À VENIR".
