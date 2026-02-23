#!/usr/bin/env python3
"""
QR Code Generator CLI

Usage:
    python qrcode.py <text> <output_path> [options]

Options:
    --size SIZE           Size of the output image in pixels (default: 300)
    --error-correction    Error correction level: L, M, Q, H (default: M)
    --border SIZE         Border size in modules (default: 1)
    --logo PATH           Path to an image to place in the center of the QR code
"""

import argparse
import sys
import qrcode
from qrcode.constants import ERROR_CORRECT_L, ERROR_CORRECT_M, ERROR_CORRECT_Q, ERROR_CORRECT_H
from PIL import Image


ERROR_CORRECTION_LEVELS = {
    'L': ERROR_CORRECT_L,  # ~7% error correction
    'M': ERROR_CORRECT_M,  # ~15% error correction
    'Q': ERROR_CORRECT_Q,  # ~25% error correction
    'H': ERROR_CORRECT_H,  # ~30% error correction
}


def generate_qrcode(text: str, output_path: str, size: int = 300, 
                    error_correction: str = 'M', border: int = 1,
                    logo_path: str = None) -> None:
    """
    Generate a QR code and save it to a file.
    
    Args:
        text: The text/data to encode in the QR code
        output_path: Path where the QR code image will be saved
        size: Size of the output image in pixels
        error_correction: Error correction level (L, M, Q, H)
        border: Border size in modules (minimum 1)
        logo_path: Optional path to a logo image to place in the center
    """
    # Validate error correction level
    error_correction = error_correction.upper()
    if error_correction not in ERROR_CORRECTION_LEVELS:
        raise ValueError(f"Invalid error correction level: {error_correction}. "
                        f"Must be one of: {', '.join(ERROR_CORRECTION_LEVELS.keys())}")
    
    # If using a logo, recommend higher error correction
    if logo_path and error_correction in ('L', 'M'):
        print(f"Warning: Using a logo with error correction level '{error_correction}' "
              "may result in unreadable QR codes. Consider using 'H' for best results.",
              file=sys.stderr)
    
    # Create QR code instance
    qr = qrcode.QRCode(
        version=1,  # Auto-adjust version based on data
        error_correction=ERROR_CORRECTION_LEVELS[error_correction],
        box_size=10,
        border=border,
    )
    
    # Add data
    qr.add_data(text)
    qr.make(fit=True)
    
    # Create image
    qr_image = qr.make_image(fill_color="black", back_color="white").convert('RGBA')
    
    # Resize to desired output size
    qr_image = qr_image.resize((size, size), Image.Resampling.LANCZOS)
    
    # Add logo if provided
    if logo_path:
        qr_image = add_logo(qr_image, logo_path)
    
    # Save the image
    # Convert to RGB if saving as JPEG
    if output_path.lower().endswith(('.jpg', '.jpeg')):
        qr_image = qr_image.convert('RGB')
    
    qr_image.save(output_path)
    print(f"QR code saved to: {output_path}")


def add_logo(qr_image: Image.Image, logo_path: str) -> Image.Image:
    """
    Add a logo to the center of the QR code image.
    
    Args:
        qr_image: The QR code image
        logo_path: Path to the logo image
        
    Returns:
        QR code image with logo in the center
    """
    # Open the logo
    logo = Image.open(logo_path)
    
    # Convert logo to RGBA if it isn't already
    if logo.mode != 'RGBA':
        logo = logo.convert('RGBA')
    
    # Calculate logo size (about 25-30% of QR code size for visibility)
    # Using 25% to be safe with error correction
    qr_width, qr_height = qr_image.size
    logo_max_size = int(min(qr_width, qr_height) * 0.25)
    
    # Resize logo maintaining aspect ratio
    logo_width, logo_height = logo.size
    ratio = min(logo_max_size / logo_width, logo_max_size / logo_height)
    new_logo_size = (int(logo_width * ratio), int(logo_height * ratio))
    logo = logo.resize(new_logo_size, Image.Resampling.LANCZOS)
    
    # Calculate position to center the logo
    logo_pos = (
        (qr_width - logo.size[0]) // 2,
        (qr_height - logo.size[1]) // 2
    )
    
    # Create a copy of the QR image to paste the logo onto
    result = qr_image.copy()
    
    # Paste logo onto QR code (using logo as mask for transparency)
    result.paste(logo, logo_pos, logo)
    
    return result


def main():
    parser = argparse.ArgumentParser(
        description='Generate QR codes with optional customization',
        usage='python qrcode.py <text> <output_path> [options]'
    )
    
    parser.add_argument('text', help='Text or data to encode in the QR code')
    parser.add_argument('output_path', help='Output path for the QR code image (e.g., output.png)')
    
    parser.add_argument(
        '--size', '-s',
        type=int,
        default=300,
        help='Size of the output image in pixels (default: 300)'
    )
    
    parser.add_argument(
        '--error-correction', '-e',
        type=str,
        default='M',
        choices=['L', 'M', 'Q', 'H', 'l', 'm', 'q', 'h'],
        help='Error correction level: L (~7%%), M (~15%%), Q (~25%%), H (~30%%) (default: M)'
    )
    
    parser.add_argument(
        '--logo', '-l',
        type=str,
        default=None,
        help='Path to an image to place in the center of the QR code'
    )
    
    parser.add_argument(
        '--border', '-b',
        type=int,
        default=1,
        help='Border size in modules (default: 1)'
    )
    
    args = parser.parse_args()
    
    try:
        generate_qrcode(
            text=args.text,
            output_path=args.output_path,
            size=args.size,
            error_correction=args.error_correction,
            border=args.border,
            logo_path=args.logo
        )
    except FileNotFoundError as e:
        print(f"Error: File not found - {e}", file=sys.stderr)
        sys.exit(1)
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
