# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A self-contained template for building Reveal.js presentations from Markdown via pandoc. The main artifact is `presentation.html`, generated from `presentation.md`.

## Commands

### Build the presentation

```bash
./build
```

Renders any IPE images in `images/` to SVG (skipping up-to-date ones), then calls pandoc to produce `presentation.html`. Picks up all `.bib` files in the root directory automatically for citations. By default all the resources are not included in the html presentation to speedup the compilation process, but to ensure a presentation fully functional even offline the final html should be compiled including all the assets in it using the flag `--embed-resources`.

### Export to PDF

```bash
./tools/render-pdf
./tools/render-pdf --last-frame                  # one frame per slide (no fragment steps)
./tools/render-pdf -o output.pdf                 # custom output path
./tools/render-pdf -s 1-4,7:1-3,9               # render specific slides/frames
./tools/render-pdf --png ./slides-dir            # export as individual PNGs
```

Starts a local HTTP server on port 8080, then uses Puppeteer to screenshot each slide and each fragment state, assembling the result into a PDF via `pdf-lib`.

### Install PDF export dependencies (once)

```bash
cd tools/render-revealjs && npm install
```

### Generate a QR code

```bash
cd tools/qrc
pip install -r requirements.txt
python qrc.py "https://example.com" output.png
python qrc.py "https://example.com" branded.png --logo logo.png --error-correction H
```

### Force re-render all IPE images

```bash
cd images && ./render --force
```

## Architecture

### Build pipeline

`build` → `images/render` (IPE→SVG via `iperender`) → `pandoc` (Markdown+CSS+bibs → `presentation.html` with embedded resources)

The pandoc invocation uses `--embed-resources --standalone` so `presentation.html` is fully self-contained (no external dependencies at serve time).

### PDF rendering pipeline

`tools/render-pdf` (bash) → spawns `python3 -m http.server` → `tools/render-revealjs/render-revealjs.js` (Node/Puppeteer)

The renderer navigates Reveal.js via its JavaScript API (`Reveal.slide(h, v, fragIndex)`) to capture each horizontal/vertical slide and each fragment step as a PNG screenshot. Screenshots are assembled into a PDF using `pdf-lib`.

Slide selector syntax for `--slides` / `-s`:
- `N` — slide N; `N-M` — range; `N-` — N to last; `-M` — 1 to M
- `N:F` — frame F of slide N; `N:F-G` — frame range (frame 1 = initial state, frame 2 = after first fragment)

### Presentation source (`presentation.md`)

YAML frontmatter controls pandoc and Reveal.js options (`theme`, `transition`, `slideNumber`, etc.). The title slide is written as raw HTML (`<section id="title-slide">`) rather than pandoc metadata to allow layout customization. Citations reference any `.bib` file in the root and are rendered in IEEE style.

Use `img.image-large` CSS class for images that should overflow the default slide width (defined in `style.css`).

## Requirements

- `pandoc` with citeproc
- `iperender` (only if using `.ipe` vector graphics)
- `node.js` + npm (for PDF/PNG export)
- `python3` with `qrcode` and `Pillow` (for QR code generation)
