// Command-line interface: everything the browser can do, so Claude (or any
// script) can set up and drive the office from a terminal.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { startServer, defaultHome } from './index.js';
import { OfficeState } from './state.js';
import { ENGINES, detectEngines } from './engines.js';
import { SKIN, HAIR_STYLES, EYEWEAR, EXTRAS, randomLook } from '../public/js/looks.js';
import { readJSON } from './util.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILL_SRC = path.join(ROOT, 'plugins', 'virtual-agent-office', 'skills', 'virtual-agent-office', 'SKILL.md');
const BOOL = new Set(['leader', 'wait', 'json', 'demo', 'no-open', 'open', 'help', 'force', 'all']);

export const HELP = `
  virtual-agent-office (vao) — a pixel office where your AI CLIs work as a team

  Start / stop
    vao [start] [-w <dir>] [-p <port>] [--no-open] [--demo]   open the office (default command);
                                                               agents work in <dir>, default: current folder
    vao stop                                                   close a running office
    vao doctor                                                 check engines, team and setup

  Team
    vao team [--json]                                          list the team
    vao hire <name> [agent options] [--leader]                 add an agent
    vao edit <name> [agent options] [--rename <new>]           change an agent
    vao fire <name>                                            remove an agent
    vao lead <name>                                            make an agent the leader
    vao boss [--name <you>] [--office <office name>] [look options]

  Work
    vao task "<what to do>" [--to <name>] [--wait] [--timeout <min>]
                                       give the team (or one agent) a task. With no office
                                       running, it runs headless and waits for the report.
    vao status                                                 what everyone is doing now
    vao chat [--last <n>]                                      recent team chat + open questions
    vao say <who> "<message>"                                  message an agent / leader / everyone
    vao say --reply <message-id> "<answer>"                    answer an agent's question
    vao reports [--last <n>]                                   recent reports
    vao report [<task-id>|last]                                print a report

  Settings
    vao config [--workspace <dir>] [--timeout <min>] [--walk <ms>] [--save-reports true|false]
    vao setup-claude [--project <dir>] [--force]               install the Claude Code skill

  Agent options
    --role "<title>"  --engine claude|codex|antigravity|gemini|hermes|custom|demo
    --model <id>      --autonomy read-only|auto-edit|full   --persona "<personality>"
    --custom-command "<cmd with {prompt}>"   --extra-args "<flags>"
  Look options
    --skin light|fair|medium|tan|brown|dark|deep|#hex
    --hair ${HAIR_STYLES.join('|')}
    --hair-color black|brown|blonde|red|gray|pink|blue|… or #hex (hijab/cap use clothing colours)
    --shirt <colour>  --pants <colour>  --shoes <colour>
    --eyewear ${EYEWEAR.join('|')}   --extra ${EXTRAS.join('|')}   --extra-color <colour>
    colours: red orange yellow green teal cyan blue purple magenta pink white gray slate navy black brown denim, or #rrggbb

  Global options
    --home <dir>   office data folder (default ${defaultHome()}, or VAO_HOME)
`;

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------
export function parseArgs(argv) {
  const pos = [];
  const opt = {};
  const alias = { w: 'workspace', p: 'port', h: 'help' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { pos.push(...argv.slice(i + 1)); break; }
    const m = a.match(/^--?([^=]+)(?:=(.*))?$/);
    if (!m || /^-\d/.test(a)) { pos.push(a); continue; }
    const key = alias[m[1]] || m[1];
    if (m[2] !== undefined) opt[key] = m[2];
    else if (BOOL.has(key)) opt[key] = true;
    else {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`Missing value for --${key}`);
      opt[key] = v;
      i++;
    }
  }
  return { pos, opt };
}

const COLORS = {
  red: '#e94f4f', orange: '#f08a3c', yellow: '#f2c94c', green: '#6fcf6f', teal: '#2fa38a', cyan: '#3fa7d6', sky: '#3fa7d6',
  blue: '#4a6fd8', purple: '#7c5ad8', violet: '#7c5ad8', magenta: '#c45ad8', pink: '#f27ab4', white: '#f4f1e8', cream: '#f4f1e8',
  gray: '#9aa3b2', grey: '#9aa3b2', slate: '#4b5263', navy: '#2a2f3d', charcoal: '#2a2f3d', black: '#1a1c24', brown: '#8b5a3c',
  denim: '#3d5a80', maroon: '#8a3b2e', gold: '#d9a35b',
};
const HAIR_COLORS = {
  black: '#1c1418', 'dark-brown': '#3b2418', darkbrown: '#3b2418', brown: '#6b4226', auburn: '#a0663a', 'light-brown': '#a0663a',
  blonde: '#d9a35b', blond: '#d9a35b', platinum: '#f1d785', gray: '#c8c8d0', grey: '#c8c8d0', silver: '#c8c8d0', white: '#c8c8d0',
  red: '#8a3b2e', ginger: '#8a3b2e', pink: '#d65a7c', blue: '#5a7bd6', green: '#3fae8f', purple: '#7a4fc4',
};
const SKIN_NAMES = { pale: 0, light: 0, fair: 1, medium: 2, olive: 2, tan: 3, brown: 4, dark: 5, deep: 6 };
const HAIR_SYN = { tudung: 'hijab', headscarf: 'hijab', scarf: 'hijab', 'baseball-cap': 'cap', hat: 'cap', bobcut: 'bob', 'side-part': 'side', afro: 'curly', shaved: 'bald', pony: 'ponytail' };
const ENGINE_SYN = { 'claude-code': 'claude', anthropic: 'claude', openai: 'codex', agy: 'antigravity', 'gemini-cli': 'gemini', demo: 'mock', simulated: 'mock' };
const AUTONOMY_SYN = { 'read-only': 'safe', readonly: 'safe', safe: 'safe', edit: 'edit', 'auto-edit': 'edit', autoedit: 'edit', full: 'full', 'full-auto': 'full', yolo: 'full' };
const AUTONOMY_LABEL = { safe: 'read-only', edit: 'auto-edit', full: 'full auto' };

function colour(v, table = COLORS, what = 'colour') {
  const s = String(v).trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^[0-9a-f]{6}$/.test(s)) return `#${s}`;
  if (table[s]) return table[s];
  if (COLORS[s]) return COLORS[s];
  throw new Error(`Unknown ${what} "${v}". Use one of: ${Object.keys(table).join(', ')} — or #rrggbb.`);
}

function applyLook(base, o) {
  const look = { ...base };
  if (o.skin !== undefined) {
    const s = String(o.skin).toLowerCase();
    look.skin = s in SKIN_NAMES ? SKIN[SKIN_NAMES[s]] : colour(o.skin, {}, 'skin tone');
  }
  if (o.hair !== undefined) {
    const h = String(o.hair).toLowerCase();
    const style = HAIR_SYN[h] || h;
    if (!HAIR_STYLES.includes(style)) throw new Error(`Unknown hair style "${o.hair}". Use: ${HAIR_STYLES.join(', ')}.`);
    look.hairStyle = style;
  }
  if (o['hair-color'] !== undefined || o['hair-colour'] !== undefined) {
    const v = o['hair-color'] ?? o['hair-colour'];
    look.hairColor = ['hijab', 'cap'].includes(look.hairStyle) ? colour(v) : colour(v, HAIR_COLORS, 'hair colour');
  }
  for (const k of ['shirt', 'pants', 'shoes']) if (o[k] !== undefined) look[k] = colour(o[k]);
  if (o['extra-color'] !== undefined || o['extra-colour'] !== undefined) look.extraColor = colour(o['extra-color'] ?? o['extra-colour']);
  if (o.eyewear !== undefined) {
    if (!EYEWEAR.includes(o.eyewear)) throw new Error(`Unknown eyewear "${o.eyewear}". Use: ${EYEWEAR.join(', ')}.`);
    look.eyewear = o.eyewear;
  }
  if (o.extra !== undefined) {
    if (!EXTRAS.includes(o.extra)) throw new Error(`Unknown extra "${o.extra}". Use: ${EXTRAS.join(', ')}.`);
    look.extra = o.extra;
  }
  return look;
}

function engineId(v) {
  const s = String(v).toLowerCase();
  const id = ENGINE_SYN[s] || s;
  if (!ENGINES[id]) throw new Error(`Unknown engine "${v}". Use: claude, codex, antigravity, gemini, hermes, custom or demo.`);
  return id;
}

function agentFields(o) {
  const a = {};
  if (o.role !== undefined) a.role = o.role;
  if (o.engine !== undefined) a.engine = engineId(o.engine);
  if (o.model !== undefined) a.model = o.model;
  if (o.autonomy !== undefined) {
    const v = AUTONOMY_SYN[String(o.autonomy).toLowerCase()];
    if (!v) throw new Error('Autonomy must be read-only, auto-edit or full.');
    a.autonomy = v;
  }
  if (o.persona !== undefined) a.persona = o.persona;
  if (o['custom-command'] !== undefined) a.customCommand = o['custom-command'];
  if (o['extra-args'] !== undefined) a.extraArgs = o['extra-args'];
  return a;
}

function findAgent(agents, name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) throw new Error('Which agent? Give a name.');
  const exact = agents.find((a) => a.name.toLowerCase() === n || a.id === name);
  if (exact) return exact;
  const pre = agents.filter((a) => a.name.toLowerCase().startsWith(n));
  if (pre.length === 1) return pre[0];
  throw new Error(`No agent called "${name}". The team: ${agents.map((a) => a.name).join(', ')}.`);
}

const home = (o) => path.resolve(o.home || defaultHome());
const out = (s = '') => process.stdout.write(`${s}\n`);
const note = (s = '') => process.stderr.write(`${s}\n`);
const pad = (s, n) => String(s).padEnd(n);
const lookText = (l) => [l.hairStyle === 'hijab' ? 'hijab' : `${l.hairStyle} hair`, l.eyewear !== 'none' ? l.eyewear : '', l.extra !== 'none' ? l.extra : ''].filter(Boolean).join(', ');

// ---------------------------------------------------------------------------
// Talking to a running office (falls back to editing the files directly)
// ---------------------------------------------------------------------------
export async function connectLive(h) {
  const rt = readJSON(path.join(h, 'runtime.json'), null);
  if (!rt?.url || !rt.pid) return null;
  try { process.kill(rt.pid, 0); } catch { return null; }
  const ws = new WebSocket(`${rt.url.replace(/^http/, 'ws')}/ws`);
  const opened = await new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), 3000);
    ws.once('open', () => { clearTimeout(t); resolve(true); });
    ws.once('error', () => { clearTimeout(t); resolve(false); });
  });
  if (!opened) { try { ws.terminate(); } catch { /* ignore */ } return null; }
  let seq = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.on('message', (d) => {
    let m;
    try { m = JSON.parse(d.toString()); } catch { return; }
    if (m.reqId && pending.has(m.reqId)) {
      const p = pending.get(m.reqId);
      pending.delete(m.reqId);
      if (m.type === 'error') p.reject(new Error(m.message)); else p.resolve(m);
    }
    for (const fn of listeners) fn(m);
  });
  const req = (type, payload = {}) => new Promise((resolve, reject) => {
    const reqId = ++seq;
    pending.set(reqId, { resolve, reject });
    ws.send(JSON.stringify({ type, reqId, ...payload }));
  });
  return { rt, url: rt.url, req, on: (fn) => listeners.add(fn), close: () => ws.close() };
}

/** Run a config change live (if an office is open) or on disk. */
async function withOffice(o, live, offline) {
  const h = home(o);
  const conn = await connectLive(h);
  if (conn) {
    try {
      const snap = await conn.req('hello');
      return await live(conn, snap);
    } finally { conn.close(); }
  }
  const state = new OfficeState({ home: h, workspace: null, demo: false });
  return offline(state);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
function printTeam(cfg, engines, status = {}) {
  out(`${cfg.officeName} · boss: ${cfg.boss.name} · workspace: ${cfg.settings.workspace}`);
  for (const a of [...cfg.agents].sort((x, y) => (y.id === cfg.leaderId) - (x.id === cfg.leaderId))) {
    const e = engines[a.engine] || {};
    const st = status[a.id]?.status;
    out(`${a.id === cfg.leaderId ? '★' : ' '} ${pad(a.name, 12)} ${pad(a.role || '—', 24)} ${pad(`${e.label || a.engine}${a.model ? ` (${a.model})` : ''}`, 26)} ${pad(AUTONOMY_LABEL[a.autonomy], 10)} ${e.installed === false ? '⚠ not installed  ' : ''}${st ? `[${st}] ` : ''}${lookText(a.look)}`);
  }
}

const commands = {
  async team(pos, o) {
    await withOffice(o,
      (c, snap) => { if (o.json) out(JSON.stringify(snap.config, null, 2)); else printTeam(snap.config, snap.engines, snap.runtime.status); },
      (st) => { if (o.json) out(JSON.stringify(st.config, null, 2)); else printTeam(st.config, st.engines); });
  },

  async hire(pos, o) {
    const name = pos.join(' ').trim() || o.name;
    if (!name) throw new Error('Usage: vao hire <name> [--role …] [--engine …] [--leader]');
    const engines = detectEngines();
    const fallback = ['claude', 'codex', 'antigravity', 'gemini', 'hermes'].find((id) => engines[id]?.installed) || 'mock';
    const agent = { name, engine: fallback, autonomy: 'edit', ...agentFields(o), look: applyLook(randomLook(), o), makeLeader: Boolean(o.leader) };
    await withOffice(o,
      async (c, snap) => {
        if (snap.config.agents.some((a) => a.name.toLowerCase() === name.toLowerCase())) throw new Error(`${name} already works here. Use: vao edit ${name} …`);
        await c.req('agent:save', { agent });
      },
      (st) => {
        if (st.config.agents.some((a) => a.name.toLowerCase() === name.toLowerCase())) throw new Error(`${name} already works here. Use: vao edit ${name} …`);
        st.upsertAgent(agent);
      });
    const e = engines[agent.engine];
    out(`Hired ${name}${agent.role ? `, ${agent.role}` : ''} — ${e.label}${agent.makeLeader ? ' — ★ team leader' : ''}.`);
    if (!e.installed && agent.engine !== 'custom' && agent.engine !== 'mock') note(`⚠ ${e.label} is not installed on this machine (${e.install}).`);
  },

  async edit(pos, o) {
    const fields = agentFields(o);
    const run = async (agents, save) => {
      const a = findAgent(agents, pos.join(' '));
      const next = { ...a, ...fields, name: o.rename || a.name, look: applyLook(a.look, o), makeLeader: Boolean(o.leader) };
      await save(next);
      out(`Updated ${next.name}.`);
    };
    await withOffice(o,
      (c, snap) => run(snap.config.agents, (agent) => c.req('agent:save', { agent })),
      (st) => run(st.config.agents, (agent) => st.upsertAgent(agent)));
  },

  async fire(pos, o) {
    await withOffice(o,
      async (c, snap) => { const a = findAgent(snap.config.agents, pos.join(' ')); await c.req('agent:delete', { id: a.id }); out(`${a.name} left the office.`); },
      (st) => { const a = findAgent(st.config.agents, pos.join(' ')); st.deleteAgent(a.id); out(`${a.name} left the office.`); });
  },

  async lead(pos, o) {
    await withOffice(o,
      async (c, snap) => { const a = findAgent(snap.config.agents, pos.join(' ')); await c.req('leader:set', { id: a.id }); out(`★ ${a.name} is now the team leader.`); },
      (st) => { const a = findAgent(st.config.agents, pos.join(' ')); st.setLeader(a.id); out(`★ ${a.name} is now the team leader.`); });
  },

  async boss(pos, o) {
    const build = (cfg) => ({ name: o.name ?? cfg.boss.name, look: applyLook(cfg.boss.look, o), officeName: o.office ?? cfg.officeName });
    await withOffice(o,
      async (c, snap) => { await c.req('boss:save', { boss: build(snap.config) }); },
      (st) => st.setBoss(build(st.config)));
    out('Boss profile saved.');
  },

  async config(pos, o) {
    const s = {};
    if (o.workspace !== undefined) s.workspace = path.resolve(o.workspace);
    if (o.timeout !== undefined) s.timeoutMin = Number(o.timeout);
    if (o.walk !== undefined) s.walkDelayMs = Number(o.walk);
    if (o['save-reports'] !== undefined) s.saveReports = !/^(false|no|0|off)$/i.test(o['save-reports']);
    const show = (cfg) => {
      const x = cfg.settings;
      out(`workspace     ${x.workspace}\ntimeout       ${x.timeoutMin} min per agent run\nwalk pace     ${x.walkDelayMs} ms\nsave reports  ${x.saveReports ? 'yes (.agent-office/reports/)' : 'no'}`);
    };
    await withOffice(o,
      async (c, snap) => {
        if (Object.keys(s).length) { await c.req('settings:save', { settings: s }); show((await c.req('hello')).config); } else show(snap.config);
      },
      (st) => { if (Object.keys(s).length) st.setSettings(s); show(st.config); });
  },

  async task(pos, o) {
    const text = pos.join(' ').trim();
    if (!text) throw new Error('Usage: vao task "<what the team should do>" [--to <name>] [--wait]');
    const h = home(o);
    const conn = await connectLive(h);
    if (conn) {
      try {
        const snap = await conn.req('hello');
        if (o.workspace) await conn.req('settings:save', { settings: { workspace: path.resolve(o.workspace) } });
        const to = o.to ? findAgent(snap.config.agents, o.to) : null;
        const r = await conn.req('task:submit', { text, agentId: to?.id });
        const leader = to || snap.config.agents.find((a) => a.id === snap.config.leaderId);
        out(`Task ${r.id} sent to ${leader?.name}${to ? ' (direct)' : ' (team leader)'}. Watch it at ${conn.url}`);
        if (!o.wait) { out('Check progress with: vao status · read the result with: vao report last'); return; }
        return await followTask(conn, r.id, snap, o);
      } finally { conn.close(); }
    }
    // No office open: run headless in this process, in the current folder unless told otherwise.
    const workspace = path.resolve(o.workspace || process.cwd());
    note(`No office is running, so this task runs here (workspace ${workspace}) and waits for the report.`);
    let srv;
    try { srv = await startServer({ port: 4317, home: h, workspace }); }
    catch (e) { if (e.code !== 'EADDRINUSE') throw e; srv = await startServer({ port: 0, home: h, workspace }); }
    note(`Watch it live at ${srv.url}`);
    const c2 = await connectLive(h);
    try {
      const snap = await c2.req('hello');
      const to = o.to ? findAgent(snap.config.agents, o.to) : null;
      const r = await c2.req('task:submit', { text, agentId: to?.id });
      return await followTask(c2, r.id, snap, o);
    } finally { c2?.close(); srv.close(); }
  },

  async status(pos, o) {
    const conn = await connectLive(home(o));
    if (!conn) {
      out('The office is not running. Start it with: vao start');
      const last = readJSON(path.join(home(o), 'history.json'), []).slice(-1)[0];
      if (last) out(`Last task: "${oneLine(last.text, 80)}" — ${last.status}. Read it with: vao report last`);
      return;
    }
    try {
      const snap = await conn.req('hello');
      const { config, runtime } = snap;
      out(`Office open at ${conn.url} · workspace ${config.settings.workspace}`);
      const cur = runtime.current;
      if (cur) {
        out(`Now: "${oneLine(cur.text, 100)}" — ${cur.kind === 'direct' ? 'direct task' : 'team task'}, stage: ${cur.stage}`);
        if (cur.plan?.summary) out(`Plan: ${cur.plan.summary}`);
      } else out('No task running.');
      if (runtime.queue?.length) out(`Queued: ${runtime.queue.length}`);
      for (const a of config.agents) {
        const s = runtime.status[a.id] || { status: 'idle' };
        out(`  ${a.id === config.leaderId ? '★' : ' '} ${pad(a.name, 12)} ${pad(s.status, 11)} ${oneLine(s.activity || '', 90)}`);
      }
      printOpenQuestions(runtime.chat);
    } finally { conn.close(); }
  },

  async chat(pos, o) {
    const conn = await connectLive(home(o));
    if (!conn) {
      const last = readJSON(path.join(home(o), 'history.json'), []).slice(-1)[0];
      if (!last?.chat?.length) { out('The office is not running and the last task had no chat.'); return; }
      out(`Chat from the last task ("${oneLine(last.text, 60)}"):`);
      for (const m of last.chat.slice(-(Number(o.last) || 30))) out(fmtMsg(m));
      return;
    }
    try {
      const snap = await conn.req('hello');
      const msgs = snap.runtime.chat || [];
      if (!msgs.length) out('No chat yet.');
      for (const m of msgs.slice(-(Number(o.last) || 30))) out(fmtMsg(m));
      printOpenQuestions(msgs);
    } finally { conn.close(); }
  },

  async say(pos, o) {
    const conn = await connectLive(home(o));
    if (!conn) throw new Error('The office is not running. Start it with: vao start');
    try {
      if (o.reply) {
        const text = pos.join(' ').trim();
        if (!text) throw new Error('Usage: vao say --reply <message-id> "<answer>"');
        await conn.req('boss:send', { replyTo: o.reply, text });
        out('Answer sent.');
      } else {
        const [who, ...rest] = pos;
        const text = rest.join(' ').trim();
        if (!who || !text) throw new Error('Usage: vao say <name|leader|everyone> "<message>"');
        const snap = await conn.req('hello');
        let to = who;
        if (!['everyone', 'all', 'team', 'leader'].includes(who.toLowerCase())) to = findAgent(snap.config.agents, who).id;
        await conn.req('boss:send', { to, text });
        out(`Sent. Idle agents answer within a minute or so; see replies with: vao chat`);
      }
    } finally { conn.close(); }
  },

  async reports(pos, o) {
    const hist = readJSON(path.join(home(o), 'history.json'), []);
    if (!hist.length) { out('No reports yet.'); return; }
    for (const t of hist.slice(-(Number(o.last) || 10)).reverse()) {
      out(`${t.id}  ${new Date(t.createdAt).toLocaleString()}  ${pad(t.status, 9)} ${oneLine(t.text, 60)}${t.reportFile ? `\n    ${t.reportFile}` : ''}`);
    }
  },

  async report(pos, o) {
    const hist = readJSON(path.join(home(o), 'history.json'), []);
    const id = pos[0] || 'last';
    const t = id === 'last' ? hist[hist.length - 1] : hist.find((x) => x.id === id);
    if (!t) throw new Error(id === 'last' ? 'No reports yet.' : `No task ${id}. See: vao reports`);
    out(`# ${oneLine(t.text, 120)}\n_${t.status} · ${t.kind === 'team' ? `leader ${t.leaderName}` : `direct to ${t.leaderName}`} · ${new Date(t.createdAt).toLocaleString()}_\n`);
    out(t.final || '(no report)');
    if (t.reportFile) out(`\nSaved: ${t.reportFile}`);
  },

  async doctor(pos, o) {
    const h = home(o);
    const major = Number(process.versions.node.split('.')[0]);
    out(`Node.js       ${process.version} ${major >= 18 ? '✓' : '✗ (need 18.17+)'}`);
    out(`Office data   ${h} ${fs.existsSync(path.join(h, 'office.json')) ? '✓' : '(created on first start)'}`);
    const conn = await connectLive(h);
    out(`Office open   ${conn ? `yes — ${conn.url} (pid ${conn.rt.pid})` : 'no — start it with: vao start'}`);
    conn?.close();
    const engines = detectEngines();
    out('Engines');
    for (const id of ['claude', 'codex', 'antigravity', 'gemini', 'hermes']) {
      const e = engines[id];
      out(`  ${e.installed ? '✓' : '·'} ${pad(e.label, 16)} ${e.installed ? e.path : `not found — ${e.install}`}`);
    }
    const st = new OfficeState({ home: h, workspace: null, demo: false });
    const cfg = st.config;
    const leader = cfg.agents.find((a) => a.id === cfg.leaderId);
    out(`Team          ${cfg.agents.length} agents, leader ★ ${leader?.name}`);
    let ws = false;
    try { ws = fs.statSync(cfg.settings.workspace).isDirectory(); } catch { /* missing */ }
    out(`Workspace     ${cfg.settings.workspace} ${ws ? '✓' : '✗ missing — vao config --workspace <dir>'}`);
    const missing = cfg.agents.filter((a) => !['custom', 'mock'].includes(a.engine) && !engines[a.engine]?.installed);
    for (const a of missing) out(`  ⚠ ${a.name} uses ${engines[a.engine].label}, which is not installed → vao edit "${a.name}" --engine <installed engine>`);
    const demo = cfg.agents.filter((a) => a.engine === 'mock');
    if (demo.length) out(`  ℹ ${demo.map((a) => a.name).join(', ')} use the Demo engine (simulated work).`);
    const skill = path.join(os.homedir(), '.claude', 'skills', 'virtual-agent-office', 'SKILL.md');
    out(`Claude skill  ${fs.existsSync(skill) ? `installed (${skill}) ✓` : 'not installed — vao setup-claude'}`);
  },

  async 'setup-claude'(pos, o) {
    const base = o.project ? path.join(path.resolve(o.project), '.claude') : path.join(os.homedir(), '.claude');
    const dest = path.join(base, 'skills', 'virtual-agent-office', 'SKILL.md');
    const fresh = fs.readFileSync(SKILL_SRC, 'utf8');
    if (fs.existsSync(dest) && !o.force && fs.readFileSync(dest, 'utf8') !== fresh && !fs.readFileSync(dest, 'utf8').includes('name: virtual-agent-office')) {
      throw new Error(`${dest} exists and isn't ours. Use --force to overwrite.`);
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, fresh);
    out(`Installed the Claude Code skill at ${dest}`);
    out(o.project
      ? 'Claude Code sessions in that project now know how to set up and run the office.'
      : 'Every Claude Code session on this machine now knows how to set up and run the office.\nTry asking Claude: "set up a virtual office with 3 agents and make Claude the leader".');
  },

  async stop(pos, o) {
    const rt = readJSON(path.join(home(o), 'runtime.json'), null);
    if (!rt?.pid) { out('No office is running.'); return; }
    try { process.kill(rt.pid, 'SIGTERM'); out(`Closed the office (pid ${rt.pid}).`); }
    catch { out('No office is running.'); }
    try { fs.rmSync(path.join(home(o), 'runtime.json')); } catch { /* gone */ }
  },
};

function oneLine(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function fmtMsg(m) {
  const tag = m.kind === 'question' ? 'asks' : m.kind === 'reply' ? 'replies' : 'says';
  const open = m.to === 'boss' && m.kind === 'question' && !m.answered ? '  ← OPEN' : '';
  return `[${m.id}] ${m.fromName} → ${m.toName} (${tag}): ${oneLine(m.text, 400)}${open}`;
}

function printOpenQuestions(msgs = []) {
  const open = msgs.filter((m) => m.to === 'boss' && m.kind === 'question' && !m.answered);
  if (!open.length) return;
  out('\nQuestions waiting for the boss:');
  for (const m of open) out(`  [${m.id}] ${m.fromName}: ${oneLine(m.text, 300)}\n    answer with: vao say --reply ${m.id} "<answer>"`);
}

async function followTask(conn, id, snap, o) {
  const limit = (Number(o.timeout) || 120) * 60_000;
  return new Promise((resolve) => {
    let lastStage = '';
    const timer = setTimeout(() => { note(`Still running after ${o.timeout || 120} min. Check later with: vao status`); resolve(); }, limit);
    conn.on((m) => {
      if (m.type === 'task' && m.id === id) {
        if (m.stage !== lastStage) { lastStage = m.stage; note(`… ${m.stage}${m.stage === 'working' && m.assignments?.length ? ` (${m.assignments.map((a) => a.name).join(', ')})` : ''}`); }
        if (['done', 'failed', 'cancelled'].includes(m.status)) {
          clearTimeout(timer);
          out(m.final || '(no report)');
          if (m.reportFile) out(`\nSaved: ${m.reportFile}`);
          if (m.status !== 'done') process.exitCode = 1;
          resolve();
        }
      }
      if (m.type === 'chat') {
        const msg = m.message;
        if (msg.to === 'boss' && msg.kind === 'question') note(`❓ ${msg.fromName} asks the boss [${msg.id}]: ${msg.text}\n   answer with: vao say --reply ${msg.id} "<answer>"`);
        else note(`💬 ${msg.fromName} → ${msg.toName}: ${oneLine(msg.text, 200)}`);
      }
      if (m.type === 'agent:status' && m.status === 'error') note(`⚠ ${snap.config.agents.find((a) => a.id === m.id)?.name}: ${m.activity}`);
    });
  });
}

// ---------------------------------------------------------------------------
// start (default)
// ---------------------------------------------------------------------------
function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* headless */ }
}

async function start(pos, o) {
  const h = home(o);
  const live = await connectLive(h);
  if (live) {
    out(`The office is already open at ${live.url}`);
    if (o.workspace) { await live.req('settings:save', { settings: { workspace: path.resolve(o.workspace) } }); out(`Workspace set to ${path.resolve(o.workspace)}`); }
    live.close();
    if (!o['no-open']) openBrowser(live.url);
    return;
  }
  const port = o.port !== undefined ? Number(o.port) : 4317;
  let srv;
  try {
    srv = await startServer({ port, host: o.host, home: h, workspace: path.resolve(o.workspace || process.cwd()), assets: o.assets, demo: o.demo });
  } catch (e) {
    if (e.code === 'EADDRINUSE') throw new Error(`Port ${port} is busy. Try: vao start --port ${port + 1}`);
    throw e;
  }
  const { url, state } = srv;
  const eng = Object.values(state.engines).filter((e) => e.bin);
  out(`\n  🏢  Virtual Agent Office is open at ${url}\n`);
  out(`  Workspace : ${state.config.settings.workspace}`);
  out(`  Office    : ${state.file}`);
  out(`  Engines   : ${eng.map((e) => `${e.installed ? '✓' : '·'} ${e.label}`).join('   ')}`);
  if (o.host && !['127.0.0.1', 'localhost', '::1'].includes(o.host)) {
    out('\n  ⚠  Listening beyond localhost: anyone who can reach this port can make your agents run commands.');
  }
  out('\n  Press Ctrl+C to close the office.\n');
  if (!o['no-open']) openBrowser(url);
}

export async function main(argv) {
  let parsed;
  try { parsed = parseArgs(argv); } catch (e) { note(e.message); process.exitCode = 1; return; }
  const { pos, opt } = parsed;
  if (opt.help || pos[0] === 'help') { out(HELP); return; }
  const known = pos[0] && (pos[0] === 'start' || commands[pos[0]]);
  const cmd = known ? pos.shift() : 'start';
  if (!known && pos.length) { note(`Unknown command: ${pos[0]}\n${HELP}`); process.exitCode = 1; return; }
  try {
    if (cmd === 'start') await start(pos, opt);
    else await commands[cmd](pos, opt);
  } catch (e) {
    note(e.message);
    process.exitCode = 1;
  }
}
