---
name: nano-banana-pro
description: Generate images via HuggingFace FLUX.1-schnell (free, no billing required).
---

# Nano Banana Pro (FLUX.1-schnell via HuggingFace)

Use the bundled script to generate images. Output is saved automatically in a folder named with the current date (`YYYY-MM-DD/`).

Generate

```bash
uv run {baseDir}/scripts/generate_image.py --prompt "your image description" --filename "output.png" --resolution 1K
```

Resolutions: `1K` = 1024px (default), `2K` = 1280px, `4K` = 1536px.

API key

- `HF_TOKEN` env var (free account at huggingface.co)
- Or use `--api-key` argument

Notes

- Images are saved in `YYYY-MM-DD/filename.png` relative to the working directory.
- The script prints a `MEDIA:` line for OpenClaw to auto-attach on supported chat providers.
- Do not read the image back; report the saved path only.
- Input image editing (`-i`) is not supported with this provider.
