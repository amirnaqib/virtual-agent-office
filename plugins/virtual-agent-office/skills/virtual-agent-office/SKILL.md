---
name: virtual-agent-office
description: Set up and run Virtual Agent Office (the `vao` CLI) — a top-down pixel office where AI coding CLIs (Claude Code, Codex, Antigravity, Gemini CLI, Hermes, custom) work as one team under a leader and report to the boss. Use whenever the user wants to create or change an agent team (hire/fire agents, name them, design their look, pick engines, choose the leader / ketua), open the office, give the team a task, chat with the agents or answer their questions, or read the team's reports. Also for "pejabat agent", "virtual office", "agent team", "vao".
---

# Virtual Agent Office

The user is the **boss**. Their agents sit at desks in a pixel office (in the browser). A task goes to the **leader** (★), who plans and hands out assignments. Members do the work with their own CLI, chat with each other mid-task, report back, and the leader delivers a compiled report to the boss desk. Everything is driven by the `vao` command, so the user only has to talk to you.

Reply in the user's language (many users write in Bahasa Melayu: *ketua* = leader, *ahli* = member, *tudung* = hijab, *tugasan* = task, *laporan* = report).

> If **you** are running inside the office as one of the agents (your prompt says you are a team member, or you have `office` MCP tools / `VAO_TOKEN` is set), ignore this skill and just do your assignment.

## 1. Make sure it's installed

```bash
vao doctor
```

If `vao` is not found:
- Inside the `virtual-agent-office` repo itself: use `node bin/vao.js …` instead of `vao`, or run `npm install -g .` once.
- Elsewhere: `npm install -g github:amirnaqib/virtual-agent-office`. For a private repo the machine needs GitHub access first (`gh auth login && gh auth setup-git`). Or `git clone` it and run `npm install -g .` inside.
- Needs Node.js 18.17+.

`vao doctor` shows which engines (CLIs) are installed, the team, the workspace, whether an office is open, and whether this skill is installed for every project (`vao setup-claude`).

## 2. Build the team from what the user says

Turn the user's description into commands. Don't ask about details they didn't care about: pick sensible names, roles and looks, then show the result and offer changes. **Only use engines `vao doctor` reports as installed** (use `demo` to try things without any CLI).

```bash
vao team                                   # current team (★ = leader)
vao hire "Aisyah" --role "Tech Lead" --engine claude --model sonnet --leader \
  --hair hijab --hair-color teal --shirt white --persona "Calm, organised, writes crisp summaries"
vao hire "Danial" --role "Backend Engineer" --engine codex --hair short --hair-color black --eyewear glasses --shirt blue
vao edit "Danial" --engine claude --autonomy auto-edit      # change anything later
vao edit "Mei Ling" --rename "Mei" --extra headphones --extra-color navy
vao lead "Danial"                                          # new leader (they swap desks)
vao fire "Farah"
vao boss --name "Amir" --office "Amir's AI Studio" --hair side --extra tie --extra-color red
```

A new office already has a sample team of 5 (Aisyah ★, Danial, Mei Ling, Arjun, Farah). If the user describes their own team, `fire` the ones they don't want, or `edit` them into the people they asked for.

**Agent options:** `--role`, `--engine claude|codex|antigravity|gemini|hermes|custom|demo`, `--model`, `--autonomy read-only|auto-edit|full`, `--persona "…"` (personality and standing instructions, included in every prompt), `--custom-command "aider --yes-always --message {prompt}"` (for `--engine custom`), `--extra-args "…"`, `--leader`.

**Look options:** `--skin light|fair|medium|tan|brown|dark|deep`, `--hair short|spiky|side|bob|long|ponytail|bun|curly|mohawk|bald|hijab|cap`, `--hair-color black|dark-brown|brown|auburn|blonde|platinum|gray|red|pink|blue|green|purple` (for hijab/cap use any clothing colour), `--shirt / --pants / --shoes / --extra-color` = `red orange yellow green teal cyan blue purple magenta pink white gray slate navy black brown denim gold` or `#rrggbb`, `--eyewear none|glasses|round|sunglasses`, `--extra none|headphones|beard|mustache|tie|scarf|blush`.

**Autonomy — ask before `full`.** `read-only` can look but not change files. `auto-edit` (the default) may edit files in the workspace. `full` lets the CLI edit *and* run commands without asking. Only set `full` when the user clearly wants it. Mid-task chat for non-Claude engines needs shell access (usually `full`; Codex works with `auto-edit`).

## 3. Open the office

The office is a long-running server, so start it **in the background** (Bash `run_in_background: true`) and point it at the project the agents should work in. Without `--workspace` it uses the current folder:

```bash
vao start --workspace "/absolute/path/to/project"
```

It opens the browser at http://127.0.0.1:4317 (add `--no-open` on headless machines). Tell the user the URL. If an office is already open, `vao start` just says so and reuses it. `vao stop` closes it. `vao config` shows or changes settings (`--workspace`, `--timeout <min>`, `--walk <ms>`, `--save-reports true|false`).

Suggest a git commit before big tasks: several agents edit the same folder.

## 4. Give the team work

```bash
vao task "Add a dark-mode toggle to the settings page and write tests for it"
vao task "Review the README for typos" --to "Farah"       # one agent, skips the leader
```

The leader picks it up, plans, and the team works. Then follow along:

```bash
vao status        # stage (briefing/planning/working/compiling/delivering) + what each agent is doing
vao chat          # what the agents are telling each other, plus questions waiting for the boss
vao report last   # the final report (also saved in <workspace>/.agent-office/reports/)
vao reports       # history
```

Tasks take minutes. Check `vao status` every minute or two rather than blocking, or run `vao task "…" --wait` in the background and read its output. With no office open, `vao task` runs headless in the current folder (or `--workspace "<dir>"`) and waits for the report. That's handy when the user doesn't need to watch.

## 5. Agents chat while they work, and may ask the boss

Agents use the built-in `office` MCP server (Claude Code gets it automatically; other CLIs use the `office` shell command) to ask the leader, each other or the boss. When `vao status` / `vao chat` shows **Questions waiting for the boss**, relay the question to the user, then pass on their answer:

```bash
vao say --reply m_1a2b3c4d5e "Use teal for the primary button"
```

Answer yourself only if the user already told you the answer. The user can also talk to anyone at any time. Idle agents answer within a minute:

```bash
vao say "Aisyah" "How is it going?"
vao say leader "Please prioritise the login page"
vao say everyone "Lunch break after this task 🍜"
```

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| `⚠ … not installed` in `vao team` / `vao doctor` | Install that CLI, or `vao edit "<name>" --engine <installed one>` |
| An agent fails with "printed nothing" / auth errors | Sign in to that CLI once interactively (`claude`, `codex login`, `agy`, `gemini`, `hermes`) |
| Antigravity / Hermes flags differ on the user's version | `vao edit "<name>" --extra-args "…"` or `--engine custom --custom-command "… {prompt}"` |
| `Port 4317 is busy` | `vao start --port 4318` |
| Chat doesn't work for a non-Claude agent | It needs shell access: `--autonomy full` (Codex: `auto-edit` is enough) |
| Wrong project folder | `vao config --workspace "/path"` (not during a running task) |

Data lives in `~/.virtual-agent-office/` (`office.json` team, `history.json` inbox, `assets/` optional pixel-art pack, see the repo's `docs/ASSETS.md`).
