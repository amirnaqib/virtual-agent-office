# Virtual Agent Office: notes for Claude

This repository is the `virtual-agent-office` package (CLI: `vao`). It's a top-down pixel office in the browser where AI coding CLIs work as a team: the leader plans, members work and chat through the `office` MCP server, and the leader reports to the boss (the user).

## When the user wants to *use* the office

Follow the skill below. Inside this repo, run the CLI as `node bin/vao.js …` unless `vao` is installed globally (`npm install -g .`).

@plugins/virtual-agent-office/skills/virtual-agent-office/SKILL.md

## When the user wants to *change* the code

- Node 18.17+, ES modules, no build step, one runtime dependency (`ws`). Keep it that way unless there's a strong reason.
- `npm test` runs everything (node:test). Add a test for new behaviour, and run the suite before committing.
- `npm run demo` (or `node bin/vao.js start --demo --no-open`) runs the office with simulated agents. Check UI changes in a browser (Playwright is fine) at desktop and phone widths.
- Layout:
  - `server/cli.js`: every `vao` command
  - `server/index.js`: HTTP + WebSocket server (localhost only, origin/Host checked), writes `runtime.json`
  - `server/orchestrator.js`: boss → leader → team → leader → boss flow, per-agent lock
  - `server/chat.js`: mid-task chat, reply turns
  - `server/engines.js`: CLI adapters
  - `server/runner.js`: spawning, streaming, timeouts
  - `server/prompts.js`
  - `bin/office-mcp.js`: MCP stdio server + shell helper
  - `public/js/`: canvas scene, procedural sprites, map, UI
- If an engine's CLI flags change, update `server/engines.js`, the engine table in `README.md` and `test/core.test.js` together.
- All pixel art is procedural (`public/js/sprites.js`). Never commit third-party asset packs. Users load them from `~/.virtual-agent-office/assets/`.
- When CLI commands or options change, update the skill at `plugins/virtual-agent-office/skills/virtual-agent-office/SKILL.md`, which is what users' Claude sessions read.
