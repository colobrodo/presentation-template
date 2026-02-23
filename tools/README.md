# Tools

## Dependencies

- **pandoc** with citeproc - see [pandoc documentation](https://pandoc.org/installing.html)
- **iperender** - for IPE image rendering
- **Node.js** - for PDF export (`cd render-revealjs && npm install`)
- **Python 3** - for QR code generation (`pip3 install -r qrc/requirements.txt`)

## Structure

```
tools/
├── render-pdf.sh       # PDF export (uses render-revealjs)
├── qrc-wrapper         # QR code generation wrapper
├── render-revealjs/    # Node.js tool for capturing slides to PDF
└── qrc/                # Python QR code generator
```

## Usage

**Build HTML:**
```bash
./build.sh
```

**Export to PDF:**
```bash
./tools/render-pdf.sh
```

**Generate QR code:**
```bash
./tools/qrc-wrapper "https://example.com" output.png
```
