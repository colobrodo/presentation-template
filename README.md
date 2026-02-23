# Presentation Template

This is a simple and reusable template for creating reveal.js presentations from markdown using pandoc, mainly intended for self-use.
This template also include some tools to generate qr-codes and to render the presentation to pdf.

## Structure

```
presentation-template/
├── presentation.md      # Main presentation content
├── build                # Build script (pandoc + image rendering)
├── style.css            # Reveal.js styling
├── images/
│   └── render           # IPE image rendering script
└── tools/
    └── render-pdf       # PDF export tool
```

## Usage

### Build HTML presentation

```bash
./build
```

This script will:
- Render any IPE images to SVG
- Include all the `.bib` files in the folder as a reference
- Build `presentation.html` using pandoc

### Export to PDF

```bash
./tools/render-pdf
```

You can use the `--last-frame` option to render the full slides without reveals

## Customization

### Title slide

The title and authors are not specified in the header of the markdown file to allow for more customization

### Styling

Edit `style.css` to customize colors, fonts, and layout. The template includes basic reveal.js customizations.


## Requirements

- `pandoc` with citeproc support
- `iperender` (for IPE image rendering, if used)
- `python3` (for QR code generation)
- `node.js` (for PDF export)

## Notes

- The template uses IEEE citation style by default
- Markdown and HTML can be mixed in `presentation.md`
- Use `::: notes` blocks for speaker notes
- The first author in the title slide is automatically bolded
