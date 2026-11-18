import fs from 'node:fs';
import path from 'node:path';
import { ENGINES, detectEngines } from './engines.js';
import { normalizeLook } from '../public/js/looks.js';
import { uid, readJSON, writeJSON } from './util.js';

const AUTONOMY = ['safe', 'edit', 'full'];
const MAX_AGENTS = 16;
const str = (v, n, d = '') => (typeof v === 'string' ? v.slice(0, n) : d);

const DEFAULT_TEAM = [
  { name: 'Aisyah', role: 'Tech Lead', engine: 'claude', persona: 'Calm and organised. Splits work cleanly and writes crisp summaries.', look: { skin: '#e8b088', hairStyle: 'hijab', hairColor: '#2fa38a', shirt: '#f4f1e8', pants: '#2a2f3d', shoes: '#1a1c24', eyewear: 'none', extra: 'none' } },
  { name: 'Danial', role: 'Backend Engineer', engine: 'codex', persona: 'Pragmatic, loves clean APIs and tests everything he touches.', look: { skin: '#c98a5e', hairStyle: 'short', hairColor: '#1c1418', shirt: '#4a6fd8', pants: '#1a1c24', shoes: '#1a1c24', eyewear: 'glasses', extra: 'none' } },
  { name: 'Mei Ling', role: 'Frontend & UI Designer', engine: 'antigravity', persona: 'Detail-oriented, obsessed with spacing and colour.', look: { skin: '#ffe0c4', hairStyle: 'bob', hairColor: '#1c1418', shirt: '#f27ab4', pants: '#4b5263', shoes: '#f4f1e8', eyewear: 'none', extra: 'headphones', extraColor: '#2a2f3d' } },
  { name: 'Arjun', role: 'QA & Testing', engine: 'gemini', persona: 'Sceptical in a good way. Finds the edge cases nobody thought of.', look: { skin: '#9c6440', hairStyle: 'curly', hairColor: '#1c1418', shirt: '#f2c94c', pants: '#3d5a80', shoes: '#4a2c1a', eyewear: 'none', extra: 'beard' } },
  { name: 'Farah', role: 'Docs & Research', engine: 'hermes', persona: 'Curious and thorough. Explains things simply.', look: { skin: '#f6c9a0', hairStyle: 'long', hairColor: '#6b4226', shirt: '#7c5ad8', pants: '#2a2f3d', shoes: '#1a1c24', eyewear: 'round', extra: 'none' } },
];

export function sanitizeAgent(a = {}, existing = {}) {
  const engine = ENGINES[a.engine] ? a.engine : existing.engine || 'mock';
  return {
    id: existing.id || (typeof a.id === 'string' && /^a_[a-f0-9]{10}$/.test(a.id) ? a.id : uid('a')),
    name: str(a.name, 24).trim() || existing.name || 'Agent',
    role: str(a.role, 48).trim(),
    engine,
    model: str(a.model, 80).trim(),
    autonomy: AUTONOMY.includes(a.autonomy) ? a.autonomy : existing.autonomy || 'edit',
    customCommand: str(a.customCommand, 500),
    extraArgs: str(a.extraArgs, 300),
    persona: str(a.persona, 800),
    look: normalizeLook(a.look ?? existing.look),
  };
}

export class OfficeState {
  constructor({ home, workspace, demo }) {
    this.home = home;
    this.file = path.join(home, 'office.json');
    this.historyFile = path.join(home, 'history.json');
    this.demo = demo;
    this.cliWorkspace = workspace;
    this.engines = detectEngines();
    this.load();
  }

  load() {
    const raw = readJSON(this.file, null);
    if (raw && Array.isArray(raw.agents)) {
      this.config = {
        version: 1,
        officeName: str(raw.officeName, 48) || 'Virtual Agent Office',
        boss: { name: str(raw.boss?.name, 24) || 'Boss', look: normalizeLook(raw.boss?.look) },
        agents: raw.agents.slice(0, MAX_AGENTS).map((a) => sanitizeAgent(a, { id: a.id })),
        leaderId: raw.leaderId,
        settings: this.sanitizeSettings(raw.settings || {}),
      };
    } else {
      this.config = this.defaults();
    }
    if (this.cliWorkspace) this.config.settings.workspace = this.cliWorkspace;
    if (!this.config.agents.some((a) => a.id === this.config.leaderId)) this.config.leaderId = this.config.agents[0]?.id ?? null;
    this.history = readJSON(this.historyFile, []);
    if (!Array.isArray(this.history)) this.history = [];
    this.save();
  }

  defaults() {
    const agents = DEFAULT_TEAM.map((d) => {
      const installed = !this.demo && this.engines[d.engine]?.installed;
      return sanitizeAgent({ ...d, engine: installed ? d.engine : 'mock', autonomy: 'edit' });
    });
    return {
      version: 1,
      officeName: 'Virtual Agent Office',
      boss: { name: 'Boss', look: normalizeLook({ skin: '#f6c9a0', hairStyle: 'side', hairColor: '#3b2418', shirt: '#2a2f3d', pants: '#1a1c24', shoes: '#1a1c24', eyewear: 'sunglasses', extra: 'tie', extraColor: '#e94f4f' }) },
      agents,
      leaderId: agents[0].id,
      settings: this.sanitizeSettings({}),
    };
  }

  sanitizeSettings(s) {
    const n = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);
    return {
      workspace: typeof s.workspace === 'string' && s.workspace ? s.workspace : process.cwd(),
      timeoutMin: n(s.timeoutMin, 1, 240, 30),
      walkDelayMs: n(s.walkDelayMs, 0, 10000, 2600),
      saveReports: s.saveReports !== false,
    };
  }

  save() { writeJSON(this.file, this.config); }
  saveHistory() { writeJSON(this.historyFile, this.history.slice(-100)); }

  get leader() { return this.config.agents.find((a) => a.id === this.config.leaderId) || this.config.agents[0] || null; }
  get members() { return this.config.agents.filter((a) => a.id !== this.leader?.id); }
  agent(id) { return this.config.agents.find((a) => a.id === id) || null; }

  upsertAgent(input) {
    const existing = this.agent(input?.id);
    if (!existing && this.config.agents.length >= MAX_AGENTS) throw new Error(`The office has room for ${MAX_AGENTS} agents.`);
    const agent = sanitizeAgent(input, existing || {});
    if (existing) Object.assign(existing, agent);
    else this.config.agents.push(agent);
    if (input?.makeLeader || !this.config.leaderId) this.config.leaderId = agent.id;
    this.save();
    return agent;
  }

  deleteAgent(id) {
    if (this.config.agents.length <= 1) throw new Error('Keep at least one agent in the office.');
    this.config.agents = this.config.agents.filter((a) => a.id !== id);
    if (this.config.leaderId === id) this.config.leaderId = this.config.agents[0].id;
    this.save();
  }

  setLeader(id) {
    if (!this.agent(id)) throw new Error('Unknown agent');
    this.config.leaderId = id;
    this.save();
  }

  setBoss(b = {}) {
    this.config.boss = { name: str(b.name, 24).trim() || 'Boss', look: normalizeLook(b.look) };
    if (typeof b.officeName === 'string' && b.officeName.trim()) this.config.officeName = b.officeName.trim().slice(0, 48);
    this.save();
  }

  setSettings(s = {}) {
    const next = this.sanitizeSettings({ ...this.config.settings, ...s });
    const ws = path.resolve(next.workspace);
    let ok = false;
    try { ok = fs.statSync(ws).isDirectory(); } catch { /* missing */ }
    if (!ok) throw new Error(`Workspace folder not found: ${ws}`);
    next.workspace = ws;
    this.config.settings = next;
    this.save();
  }

  refreshEngines() { this.engines = detectEngines(); return this.engines; }

  addHistory(task) {
    const i = this.history.findIndex((t) => t.id === task.id);
    if (i === -1) this.history.push(task); else this.history[i] = task;
    this.saveHistory();
  }
}
