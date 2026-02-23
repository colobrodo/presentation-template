# QR Code Generator CLI

A Python command-line tool to generate QR codes with customizable options including size, error correction level, and logo overlay.

## Installation

```bash
pip install -r requirements.txt
```

## Usage

```bash
python qrc.py <text> <output_path> [options]
```

## Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--size` | `-s` | Output image size in pixels | 300 |
| `--error-correction` | `-e` | Error correction level (L, M, Q, H) | M |
| `--border` | `-b` | Border size in modules | 1 |
| `--logo` | `-l` | Path to image for center overlay | None |

### Error Correction Levels

- **L** - ~7% error correction
- **M** - ~15% error correction (default)
- **Q** - ~25% error correction
- **H** - ~30% error correction

## Examples

```bash
# Basic QR code
python qrc.py "https://example.com" output.png

# Custom size with high error correction
python qrc.py "Hello World" code.png --size 500 --error-correction H

# With logo in center
python qrc.py "https://mysite.com" branded.png --logo logo.png --error-correction H
```

## Notes

- The logo is automatically scaled to ~25% of the QR code size to maintain scannability
- When using a logo, the script warns if error correction is below 'H' (30%), as logos cover part of the code
- Supports PNG, JPEG, and other common image formats for output
