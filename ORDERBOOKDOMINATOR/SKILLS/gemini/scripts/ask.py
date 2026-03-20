#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""
Send a prompt to Gemini CLI and save the response as a .md file in geminiplace/.

Usage:
    uv run SKILLS/gemini/scripts/ask.py "your question here"
"""

import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path


def slugify(text: str, max_len: int = 40) -> str:
    text = text.lower()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_]+", "-", text).strip("-")
    return text[:max_len]


def main():
    if len(sys.argv) < 2:
        print("Usage: uv run ask.py \"your question here\"", file=sys.stderr)
        sys.exit(1)

    prompt = " ".join(sys.argv[1:])

    print(f"Asking Gemini: {prompt[:80]}{'...' if len(prompt) > 80 else ''}")

    try:
        result = subprocess.run(
            ["powershell", "-NoProfile", "-Command", f"gemini '{prompt.replace(chr(39), chr(39)*2)}'"],
            capture_output=True,
            text=True,
            timeout=120,
        )
    except subprocess.TimeoutExpired:
        print("Error: Gemini did not respond within 120 seconds.", file=sys.stderr)
        sys.exit(1)

    response = result.stdout.strip()
    if not response and result.stderr:
        print(f"Error from gemini: {result.stderr.strip()}", file=sys.stderr)
        sys.exit(1)

    output_dir = Path("geminiplace")
    output_dir.mkdir(exist_ok=True)

    timestamp = datetime.now().strftime("%Y-%m-%d-%H-%M-%S")
    slug = slugify(prompt)
    filename = output_dir / f"{timestamp}-{slug}.md"

    content = f"# {prompt}\n\n{response}\n"
    filename.write_text(content, encoding="utf-8")

    print(f"\nSaved: {filename.resolve()}")

    return response


if __name__ == "__main__":
    main()
