---
name: gemini
description: Gemini CLI for one-shot Q&A, summaries, and generation. Use ask.py for non-interactive usage with auto-save to geminiplace/.
---

# Gemini CLI

## Non-interactive (recommended)

Use the bundled script — sends prompt, waits up to 120s, saves response as `.md` in `geminiplace/`.

```bash
uv run {baseDir}/scripts/ask.py "your question here"
```

Output: `geminiplace/YYYY-MM-DD-HH-MM-SS-slug.md`

## Direct CLI

```bash
gemini "Answer this question..."
gemini --model <name> "Prompt..."
gemini --output-format json "Return JSON"
```

## Notes

- Gemini CLI responses take ~55s on average — normal behaviour.
- On Windows, `gemini` is a `.ps1` script installed via npm; the `ask.py` wrapper handles this automatically.
- If auth is required, run `gemini` once interactively and follow the login flow.
- Avoid `--yolo` for safety.
