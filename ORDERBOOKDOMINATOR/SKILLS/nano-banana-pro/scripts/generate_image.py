#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "pillow>=10.0.0",
# ]
# ///
"""
Generate images using Hugging Face Inference API (free tier, FLUX.1-schnell).

Usage:
    uv run generate_image.py --prompt "your image description" --filename "output.png" [--resolution 1K|2K|4K]

Requires HF_TOKEN environment variable (free account at huggingface.co).
"""

import argparse
import json
import os
import sys
import urllib.request
from datetime import date
from io import BytesIO
from pathlib import Path


MODEL = "black-forest-labs/FLUX.1-schnell"
API_URL = f"https://router.huggingface.co/hf-inference/models/{MODEL}"

RESOLUTION_MAP = {
    "1K": (1024, 1024),
    "2K": (1280, 1280),
    "4K": (1536, 1536),
}


def main():
    parser = argparse.ArgumentParser(
        description="Generate images using Hugging Face FLUX.1-schnell (free)"
    )
    parser.add_argument("--prompt", "-p", required=True, help="Image description/prompt")
    parser.add_argument("--filename", "-f", required=True, help="Output filename (e.g., output.png)")
    parser.add_argument(
        "--resolution", "-r",
        choices=["1K", "2K", "4K"],
        default="1K",
        help="Output resolution: 1K=1024px, 2K=1280px, 4K=1536px"
    )
    # kept for CLI compatibility
    parser.add_argument("--input-image", "-i", action="append", dest="input_images", metavar="IMAGE")
    parser.add_argument("--api-key", "-k", help="HF token (overrides HF_TOKEN env var)")

    args = parser.parse_args()

    token = args.api_key or os.environ.get("HF_TOKEN")
    if not token:
        print("Error: No HuggingFace token found.", file=sys.stderr)
        print("Set HF_TOKEN environment variable or use --api-key.", file=sys.stderr)
        sys.exit(1)

    if args.input_images:
        print("Note: input image editing is not supported with this provider. Generating from prompt only.")

    width, height = RESOLUTION_MAP[args.resolution]
    today = date.today().strftime("%Y-%m-%d")
    output_path = Path(today) / Path(args.filename).name
    output_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"Generating image ({width}x{height}) via HuggingFace FLUX.1-schnell...")

    payload = json.dumps({
        "inputs": args.prompt,
        "parameters": {"width": width, "height": height}
    }).encode("utf-8")

    req = urllib.request.Request(
        API_URL,
        data=payload,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            image_data = response.read()

        from PIL import Image as PILImage
        image = PILImage.open(BytesIO(image_data))

        if image.mode == "RGBA":
            rgb = PILImage.new("RGB", image.size, (255, 255, 255))
            rgb.paste(image, mask=image.split()[3])
            rgb.save(str(output_path), "PNG")
        else:
            image.convert("RGB").save(str(output_path), "PNG")

        full_path = output_path.resolve()
        print(f"\nImage saved: {full_path}")
        print(f"MEDIA: {full_path}")

    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="ignore")
        print(f"Error {e.code}: {body}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error generating image: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
