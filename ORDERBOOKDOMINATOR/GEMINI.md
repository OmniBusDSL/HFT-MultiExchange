# ORDERBOOKDOMINATOR Workspace

This workspace is a multi-purpose environment dedicated to two primary goals:
1.  **AI Skill Development**: A framework for creating, validating, and packaging reusable "Agent Skills" (modular capability extensions for AI agents).
2.  **Market Monitoring**: A real-time Order Book Monitor for the LCX Exchange.

## 🏗️ Project Structure

- `orderbook-monitor/`: A TypeScript application that tracks real-time market depth across all LCX trading pairs.
- `SKILLS/`: The core of the skill development framework.
  - `skill-creator/`: Tools for managing the lifecycle of a skill (init, validate, package).
  - `nano-banana-pro/`: Image generation via HuggingFace (FLUX.1-schnell).
  - `gemini/`: One-shot Gemini CLI wrapper.
  - `github/`: GitHub operations via the `gh` CLI.
- `geminiplace/`: Storage for AI-generated research, notes, and documentation.
- `logs/`: Market data captured by the monitor, including an SQLite database (`orderbook.db`).
- `YYYY-MM-DD/`: Directories for generated assets (e.g., images from `nano-banana-pro`).

---

## 📈 Orderbook Monitor

The `orderbook-monitor` is a high-performance market depth tracker that uses WebSockets to maintain local order book snapshots for LCX pairs.

### Tech Stack
- **Language**: TypeScript (ESM)
- **Runtime**: Node.js
- **Database**: SQLite (`better-sqlite3`) for logging and state.
- **Communication**: WebSockets (`ws`) and REST API.

### Building and Running
1.  **Navigate to directory**: `cd orderbook-monitor`
2.  **Install dependencies**: `npm install`
3.  **Run in development**: `npm run dev` (uses `tsx`)
4.  **Production Build**: `npm run build` && `npm start`

### Core Modules (`src/`)
- `index.ts`: Entry point.
- `api.ts`: LCX REST API client for fetching pairs and initial snapshots.
- `websocket.ts`: WebSocket manager with rate-limiting and auto-reconnection.
- `orderbook.ts`: Logic for applying delta updates and maintaining price levels.
- `logger.ts`: Persistent logging to SQLite and JSON.
- `display.ts`: Terminal UI/Dashboard for real-time monitoring.

---

## 🧩 AI Skill Framework

The framework enables the creation of "Skills" — modular packages providing specialized workflows, tool instructions, and domain expertise.

### Skill Anatomy
Each skill in `SKILLS/` contains:
- `SKILL.md`: Required. Contains YAML frontmatter (`name`, `description`) and Markdown instructions.
- `scripts/`: Optional. Executable Python/Bash logic.
- `references/`: Optional. On-demand documentation.
- `assets/`: Optional. Templates or static files.

### Key Commands (Root Directory)
- **Initialize Skill**:
  ```bash
  python SKILLS/skill-creator/scripts/init_skill.py <skill-name> --path ./SKILLS
  ```
- **Validate Skill**:
  ```bash
  python SKILLS/skill-creator/scripts/quick_validate.py ./SKILLS/<skill-name>
  ```
- **Package Skill**:
  ```bash
  python SKILLS/skill-creator/scripts/package_skill.py ./SKILLS/<skill-name>
  ```
- **Generate Image**:
  ```bash
  uv run SKILLS/nano-banana-pro/scripts/generate_image.py --prompt "description" --filename "output.png"
  ```

---

## 📝 Development Guidelines

- **TypeScript**: Strict typing, ESM modules, and clean abstractions.
- **Environment**: Use `.env` files for keys (LCX API, Gemini API, HF_TOKEN).
- **Rate Limiting**: LCX WebSocket subscriptions must be staggered (1s) to prevent IP bans.
- **Skill Design**: Follow **Progressive Disclosure**. Keep `SKILL.md` lean; move details to `references/`.
- **Validation**: Always run `quick_validate.py` before packaging a skill.
