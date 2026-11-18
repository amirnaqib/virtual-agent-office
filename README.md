# Virtual Agent Office

A top-down pixel office where your AI coding CLIs work as a team.

You sit at the **boss desk**. Each agent has a desk, a name, a look you design, and a "brain" (Claude Code, Codex, Antigravity, Gemini CLI, Hermes Agent, or any other CLI). When you hand in a task:

1. The **leader** (★, your choice) walks over to your desk to pick up the brief.
2. The leader goes back to their desk, plans, and hands out assignments. You can watch the papers fly to each desk.
3. Every member **sits at their desk and types**. Their CLI really is running, and you can watch its output live.
4. **While they work, agents talk to each other.** A member can ask the leader or a teammate a question (or ask *you*) and wait for the answer. Envelopes fly between desks and the conversation shows up in the **Chat** tab.
5. When a member is done, they **walk to the leader's desk** and hand in their report.
6. The leader **compiles** everything, including the team chat, and **walks it to your desk**. The report lands in your inbox, and a Markdown copy is saved in the project.

![The office](docs/screenshot.png)

## Features

- **Mix any CLIs in one team:** Claude Code, OpenAI Codex, Antigravity CLI (`agy`), Gemini CLI, Hermes Agent, a **custom command** (aider, opencode, qwen, your own script…), or the built-in **Demo** engine, which needs nothing installed.
- **Pick the leader.** Any agent can be leader. Change it anytime and they swap desks.
- **Character builder:** name, role, skin tone, 12 hair styles (including hijab/tudung and cap), hair & clothing colours (plus custom colour picker), glasses/sunglasses, headphones, beard, tie, scarf… and a personality / standing instructions that goes into every prompt.
- **Per-agent settings:** model, autonomy (read-only / auto-edit / full auto), extra CLI args.
- **Agents chat mid-task** through a built-in **MCP server** (`office`): `ask`, `send_message`, `check_messages`, `team_status`, `update_status`. Claude Code gets it automatically. Other CLIs use the same functions as a shell command.
- **You're in the chat too:** agents can ask the boss a question, and you answer from the Chat tab. You can also message any agent, even with no task running. Idle agents answer right away.
- **Live view:** typing animation, code particles in the engine's colour, status bubbles. Click anyone to see their terminal output streaming.
- **Boss desk inbox:** compiled reports with each member's report attached. They're also saved to `<workspace>/.agent-office/reports/*.md`.
- **Direct tasks:** skip the leader and give one agent a job; they bring the result straight to you.
- **Idle life:** agents wander to the water cooler or the coffee machine when they have nothing to do.
- **Bring your own pixel art:** drop in a top-down asset pack (e.g. from itch.io) via a small manifest. See [docs/ASSETS.md](docs/ASSETS.md).

## Quick start

Requires **Node.js 18.17+**.

```bash
git clone https://github.com/amirnaqib/virtual-agent-office.git
```

```bash
cd virtual-agent-office && npm install
```

Try it with simulated agents first (no CLIs needed):

```bash
npm run demo
```

Then point it at a real project:

```bash
node bin/vao.js start --workspace /path/to/your/project
```

To get a global `vao` / `virtual-agent-office` command:

```bash
npm install -g .
```

The office opens at <http://127.0.0.1:4317>. On first launch you get a sample team. Every agent whose CLI isn't installed starts on the Demo engine. Open **Team → Edit** to switch engines, rename people and restyle them.

## Let Claude set it up for you

Your users don't need to learn any commands. Teach Claude Code the office once, then they just ask, for example *"set up an office with 3 agents, make Siti the leader with a blue hijab, then have the team add a login page"*. Claude builds the team, opens the office, hands out the task, relays the agents' questions and summarises the report.

Pick one:

- **Plugin (recommended):** inside Claude Code, run both:

  ```
  /plugin marketplace add amirnaqib/virtual-agent-office
  /plugin install virtual-agent-office@virtual-agent-office
  ```

  While the repo is private, users need GitHub access on their machine (`gh auth login && gh auth setup-git`).
- **One command:** `vao setup-claude` installs the skill for every Claude Code session on the machine (`~/.claude/skills/`). Use `vao setup-claude --project <dir>` for a single project.
- **In this repo:** `CLAUDE.md` already loads the skill, so Claude Code opened here knows it.

The skill lives at [`plugins/virtual-agent-office/skills/virtual-agent-office/SKILL.md`](plugins/virtual-agent-office/skills/virtual-agent-office/SKILL.md). Claude still needs `vao` installed (`npm install -g github:amirnaqib/virtual-agent-office`, or `npm install -g .` from a clone), and the skill tells it how to install it if missing.

## Commands

Everything in the browser is also a command, so scripts and Claude can drive the office. If an office is open, commands talk to it live; if not, team commands edit the saved office and `vao task` runs headless.

```
vao [start] [-w <dir>]        open the office (agents work in <dir>, default: current folder)
vao stop | vao doctor         close it | check engines, team, workspace, skill
vao team [--json]             list the team
vao hire "Siti" --role "Tech Lead" --engine claude --model sonnet --leader --hair hijab --hair-color blue --shirt white
vao edit "Ali" --engine codex --autonomy auto-edit --eyewear glasses
vao fire "Farah" | vao lead "Ali" | vao boss --name "Amir" --office "Amir's Studio"
vao task "Add a login page" [--to "Ali"] [--wait]
vao status | vao chat         what everyone is doing | team chat + questions for the boss
vao say "Siti" "How is it going?" | vao say --reply <message-id> "Use teal"
vao reports | vao report last
vao config --workspace <dir> --timeout 30 --walk 2600
vao setup-claude [--project <dir>]
```

Run `vao help` for every option, including all look options: skin, 12 hair styles (including hijab/tudung), colours, eyewear and extras.

### Start options

| Option | Default | |
|---|---|---|
| `-w, --workspace <dir>` | current folder | Where agents work (they all share it) |
| `-p, --port <n>` | `4317` | |
| `--host <addr>` | `127.0.0.1` | Keep it local unless you know what you're doing |
| `--home <dir>` | `~/.virtual-agent-office` | Team, history and asset pack live here (`VAO_HOME` works too) |
| `--assets <dir>` | `<home>/assets` | Custom asset pack folder |
| `--demo` | | New offices start everyone on the Demo engine |
| `--no-open` | | Don't open a browser |

## Engines

Each engine is a thin adapter that turns *(prompt, agent, phase)* into a command line. Planning and report-writing always run **read-only**. The agent's autonomy setting only applies to the actual work.

| Engine | Command | Read-only | Auto-edit | Full auto | Chat mid-task |
|---|---|---|---|---|---|
| Claude Code | `claude -p --output-format stream-json --verbose` (prompt on stdin) | default permissions | `--permission-mode acceptEdits` | `--dangerously-skip-permissions` | MCP tools, automatic (`--mcp-config` + `--allowedTools mcp__office`) |
| OpenAI Codex | `codex exec --skip-git-repo-check --output-last-message <tmp> -` (prompt on stdin) | `--sandbox read-only` | `--full-auto` (+ localhost network for the office command) | `--dangerously-bypass-approvals-and-sandbox` | `office` shell command |
| Antigravity CLI | `agy -p <prompt>` | default | `--mode accept-edits` | `--dangerously-skip-permissions` | `office` shell command |
| Gemini CLI | `gemini -p <prompt>` | default | `--approval-mode auto_edit` | `--yolo` | `office` shell command |
| Hermes Agent | `hermes chat -Q -q <prompt>` | default | default | `--yolo` | `office` shell command |
| Custom | your template, e.g. `aider --yes-always --message {prompt}` | – | – | – | `office` shell command |
| Demo | simulated | – | – | – | simulated |

`--model` / `-m` is added when you set a model. Anything else goes in **Extra args**.

> CLIs change their flags between versions. The Claude Code, Codex and Gemini flags above are their documented non-interactive modes. The **Antigravity (`agy`)** and **Hermes** flags come from their docs and cheat sheets, but they haven't been tested end-to-end here. If your version differs, check `agy --help` / `hermes chat --help` and adjust with **Extra args**, or switch that agent to the **Custom** engine with your own template.
> Antigravity: sign in once by running `agy` interactively before using it here.

**Custom engine placeholders:** `{prompt}`, `{model}`, `{workspace}`. If the template has no `{prompt}`, the prompt is sent on stdin. Placeholders are substituted *after* the template is split into arguments, so prompt text can never inject extra arguments.

## How the agents talk to each other

### While they work: the `office` MCP server

Every work run gets a private, short-lived office pass (`VAO_URL` + `VAO_TOKEN` in its environment). The bridge `bin/office-mcp.js` turns that into tools:

| Tool | What it does |
|---|---|
| `ask(to, question)` | Ask the leader, a teammate or the boss and **wait** for the answer (default up to 3 min) |
| `send_message(to, message, reply_to?)` | Tell someone something without waiting; `reply_to` answers a question |
| `check_messages()` | Read messages sent to you (agents are told to check after each major step) |
| `team_status()` | Who is the leader, who was assigned what, what everyone is doing right now |
| `update_status(text)` | A progress line shown above the agent's head |

`to` is a name, `leader`, `boss` or `everyone`.

- **Claude Code** gets the MCP server automatically on every work run.
- **Other CLIs** get the same functions as a shell command, described in their prompt, e.g. `"node" ".../office-mcp.js" ask leader "Which port?"`. This works whenever the agent may run shell commands: Full auto for most CLIs, and Auto-edit for Codex (the office opens localhost in Codex's sandbox for it).
- **Who answers?** If the person being asked isn't running right now (say the leader is waiting for reports, or an agent is idle), the office starts a short **reply turn** of that agent's CLI. It's read-only, sees the task, the plan and the recent chat, and its answer goes straight back. If someone is busy, the question waits in their inbox. Anything still unanswered when their run ends gets a reply turn too, so no question is left hanging.
- **The boss:** questions addressed to `boss` show up in the **Chat** tab with a reply box, and the boss's bubble shows `? 1 QUESTION`. You can message anyone from the Chat tab at any time.
- The whole conversation goes into the leader's compile prompt and into the saved report.

Using the office MCP server in another CLI's own config also works. For example, Gemini CLI's `~/.gemini/settings.json`:

```json
{ "mcpServers": { "office": { "command": "node", "args": ["/path/to/virtual-agent-office/bin/office-mcp.js"], "trust": true } } }
```

The server reads `VAO_URL` / `VAO_TOKEN` from its environment. If a CLI starts MCP servers with a cleaned environment, the bridge looks them up from its parent processes on Linux. Outside an office run it just answers "not connected".

### Task flow

```
 Boss desk ──task──▶ Leader ──plan (JSON)──▶ assignments
                                              │
                    ┌─────────────┬───────────┴───────────┐
                    ▼             ▼                       ▼
                 Member A      Member B     …          Member N     (parallel, same workspace)
                    │ REPORT:     │ REPORT:               │ REPORT:
                    └─────────────┴───────────┬───────────┘
                                              ▼
                                   Leader compiles report ──▶ Boss desk inbox
```

- The leader gets the team roster (names, roles, engines, personalities) and must reply with JSON assignments. If the leader's output can't be parsed, every member gets the whole task, framed by their role.
- Each member's prompt includes their assignment, the boss's original request, and what each teammate is doing, so they stay out of each other's files.
- Members finish with a `REPORT:` section. The leader receives all reports, including failures, and writes the final Markdown report for you.
- Tasks run one at a time. Sending more puts them in a queue.

## Safety

- The server only listens on `127.0.0.1` and rejects WebSocket connections from other origins, so other websites can't drive your agents.
- Agents run **as you**, in the workspace folder. **Auto-edit** and especially **Full auto** let a CLI change files and run commands without asking. Use git, start with read-only or auto-edit, and only give full auto to engines you trust.
- Several agents share one folder. The leader is told to split work by file, but conflicts are still possible. Commit before big tasks.

## Data

- `~/.virtual-agent-office/office.json`: team, leader, boss, settings
- `~/.virtual-agent-office/history.json`: inbox (last 100 tasks)
- `<workspace>/.agent-office/reports/`: Markdown copy of every report (turn off in Settings). Add `.agent-office/` to your project's `.gitignore` if you don't want them committed.

## Development

```bash
npm test
```

```
bin/vao.js            CLI entry
server/index.js       HTTP + WebSocket server (localhost only, origin-checked)
server/orchestrator.js  boss → leader → team → leader → boss workflow
server/engines.js     CLI adapters + output parsers
server/runner.js      process spawning, streaming, timeouts, cancel
server/prompts.js     plan / work / compile / reply prompts, plan parsing
server/chat.js        office chat: routing, inboxes, waits, reply turns
bin/office-mcp.js     "office" MCP server (stdio) + shell helper
server/cli.js         every `vao` command (live over WebSocket, or offline on the saved office)
plugins/…/SKILL.md    the Claude Code skill (also loaded by CLAUDE.md)
public/js/scene.js    canvas renderer, walking, typing, papers
public/js/sprites.js  procedural pixel art (characters & furniture)
public/js/map.js      office floor plan · path.js A* pathfinding
public/js/builder.js  character builder
```

No build step, no framework, one runtime dependency (`ws`).

## Ideas for next

- Per-agent git worktrees to remove edit conflicts
- Review rounds (leader sends work back with feedback)
- Sound effects, day/night windows, more rooms

---

## Ringkasan (Bahasa Melayu)

**Virtual Agent Office** ialah pejabat piksel *top-down* di mana CLI AI anda (Claude Code, Codex, Antigravity, Gemini, Hermes atau CLI lain) bekerja sebagai satu pasukan.

- **Pilih ketua (★)**, beri nama dan reka watak setiap agent: rambut (termasuk tudung), warna baju, cermin mata, headphone, personaliti dan lain-lain.
- Bila anda hantar tugasan dari **meja boss**, ketua datang ambil, rancang dan bahagikan kerja. Setiap agent **duduk di meja masing-masing dan menaip**. CLI sebenar sedang berjalan dan output boleh dilihat secara langsung.
- **Agent boleh berbual semasa bekerja** melalui MCP server `office`: tanya ketua, tanya rakan sepasukan, atau tanya boss (anda), dan tunggu jawapan. Claude Code disambung secara automatik. CLI lain guna arahan shell yang sama. Semua perbualan ada dalam tab **Chat**, dan anda boleh jawab atau mesej sesiapa sahaja dari situ.
- Bila siap, agent **berjalan ke meja ketua** untuk hantar laporan. Ketua **kompil** semua laporan dan **bawa ke meja boss**. Laporan masuk ke inbox anda dan disimpan sebagai Markdown dalam projek.

**Guna terus melalui Claude:** pasang plugin (`/plugin marketplace add amirnaqib/virtual-agent-office`, kemudian `/plugin install virtual-agent-office@virtual-agent-office`) atau jalankan `vao setup-claude`. Selepas itu pengguna cuma perlu minta kepada Claude, contohnya *"set pasukan 2 orang, Siti ketua bertudung biru, kemudian suruh mereka buat halaman login"*. Claude akan uruskan semuanya: bina pasukan, buka pejabat, beri tugasan, sampaikan soalan agent, dan ringkaskan laporan.

Cuba dahulu tanpa sebarang CLI:

```bash
npm install && npm run demo
```

Guna pada projek sebenar:

```bash
node bin/vao.js --workspace /laluan/ke/projek
```

Aset piksel sendiri (contohnya dari itch.io) boleh dimasukkan melalui `~/.virtual-agent-office/assets/`. Lihat [docs/ASSETS.md](docs/ASSETS.md). Jangan *commit* aset berbayar ke repo awam, kerana kebanyakan lesen itch.io tidak membenarkannya.

## License

MIT for the code. All built-in pixel art is drawn procedurally in `public/js/sprites.js` and is covered by the same license.
