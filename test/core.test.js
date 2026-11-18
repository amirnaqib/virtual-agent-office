import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePlan, extractReport, planPrompt } from '../server/prompts.js';
import { splitArgs, fill } from '../server/util.js';
import { ENGINES, createParser } from '../server/engines.js';
import { runAgent } from '../server/runner.js';
import { OfficeState } from '../server/state.js';
import { Orchestrator } from '../server/orchestrator.js';
import { findPath } from '../public/js/path.js';
import { buildLayout } from '../public/js/map.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE = path.join(here, 'fake-agent.mjs');
const leader = { id: 'a_l', name: 'Aisyah', role: 'Lead' };
const members = [{ id: 'a_1', name: 'Danial', role: 'Backend' }, { id: 'a_2', name: 'Mei Ling', role: 'UI' }];

test('parsePlan reads JSON, fenced JSON, and maps names case-insensitively', () => {
  const p1 = parsePlan('{"summary":"s","assignments":[{"agent":"danial","task":"api"},{"agent":"MEI LING","task":"ui"}]}', { members, leader, task: 't' });
  assert.equal(p1.fallback, false);
  assert.deepEqual(p1.assignments.map((a) => a.agentId), ['a_1', 'a_2']);
  const p2 = parsePlan('Here you go:\n```json\n{"assignments":[{"agent":"Aisyah","task":"x"}]}\n```', { members, leader, task: 't' });
  assert.equal(p2.assignments[0].agentId, 'a_l');
});

test('parsePlan falls back when the output is not a plan', () => {
  const p = parsePlan('I could not decide', { members, leader, task: 'Build it' });
  assert.equal(p.fallback, true);
  assert.equal(p.assignments.length, 2);
  assert.match(p.assignments[0].task, /Build it/);
});

test('parsePlan ignores unknown names and duplicates', () => {
  const p = parsePlan('{"assignments":[{"agent":"Ghost","task":"x"},{"agent":"Danial","task":"a"},{"agent":"Danial","task":"b"}]}', { members, leader, task: 't' });
  assert.equal(p.assignments.length, 1);
  assert.equal(p.assignments[0].task, 'a');
});

test('extractReport takes the text after the last REPORT:', () => {
  assert.equal(extractReport('work...\nREPORT: first\nmore\nREPORT:\n- final bit'), '- final bit');
  assert.equal(extractReport('no marker here'), 'no marker here');
});

test('splitArgs keeps quoted strings and placeholders cannot inject args', () => {
  assert.deepEqual(splitArgs(`aider --yes "two words" --message {prompt}`), ['aider', '--yes', 'two words', '--message', '{prompt}']);
  const tokens = splitArgs('tool --m {prompt}').map((t) => fill(t, { prompt: 'a b; rm -rf /' }));
  assert.deepEqual(tokens, ['tool', '--m', 'a b; rm -rf /']);
});

test('engine adapters build the expected command lines', () => {
  const agent = { model: 'sonnet' };
  const tmpFile = (n) => `/tmp/${n}`;
  const c = ENGINES.claude.build({ agent, autonomy: 'edit', extra: [], prompt: 'P', tmpFile });
  assert.deepEqual(c.args, ['-p', '--output-format', 'stream-json', '--verbose', '--model', 'sonnet', '--permission-mode', 'acceptEdits']);
  assert.equal(c.stdin, true);
  const x = ENGINES.codex.build({ agent: {}, autonomy: 'safe', extra: [], prompt: 'P', tmpFile });
  assert.deepEqual(x.args, ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--output-last-message', '/tmp/codex-last.txt', '-']);
  const g = ENGINES.gemini.build({ agent: {}, autonomy: 'full', extra: [], prompt: 'P', tmpFile });
  assert.deepEqual(g.args, ['--yolo', '-p', 'P']);
  const a = ENGINES.antigravity.build({ agent: {}, autonomy: 'full', extra: [], prompt: 'P', tmpFile });
  assert.deepEqual(a.args, ['--dangerously-skip-permissions', '-p', 'P']);
  const h = ENGINES.hermes.build({ agent: {}, autonomy: 'full', extra: ['--toolsets', 'web'], prompt: 'P', tmpFile });
  assert.deepEqual(h.args, ['chat', '-Q', '--yolo', '--toolsets', 'web', '-q', 'P']);
  const cu = ENGINES.custom.build({ agent: { customCommand: 'aider --message {prompt}' }, extra: [], prompt: 'hello there', workspace: '/w' });
  assert.equal(cu.cmd, 'aider');
  assert.deepEqual(cu.args, ['--message', 'hello there']);
  assert.equal(cu.stdin, false);
});

test('claude stream-json parser surfaces tools and the final result', () => {
  const p = createParser('claude-stream');
  const ev = [
    { type: 'system', subtype: 'init', model: 'm' },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Looking' }, { type: 'tool_use', name: 'Edit', input: { file_path: '/x/src/app.js' } }] } },
    { type: 'result', subtype: 'success', result: 'All done', total_cost_usd: 0.0123 },
  ].flatMap((e) => p.line(JSON.stringify(e)));
  assert.ok(ev.some((e) => e.kind === 'tool' && e.text === 'Edit app.js'));
  assert.equal(p.finish(''), 'All done');
});

test('runAgent spawns a custom CLI, streams lines and returns the output', async () => {
  const lines = [];
  const res = await runAgent({
    agent: { name: 'Danial', engine: 'custom', customCommand: `"${process.execPath}" "${FAKE}"` },
    prompt: 'You are Danial, the Backend. Do work.',
    phase: 'work',
    workspace: os.tmpdir(),
    timeoutMs: 20000,
    onActivity: (a) => lines.push(a),
  });
  assert.equal(res.ok, true, res.error);
  assert.match(res.text, /REPORT:/);
  assert.ok(lines.some((l) => l.kind === 'err' && /stderr noise/.test(l.text)));
});

test('runAgent reports a missing command clearly', async () => {
  const res = await runAgent({ agent: { engine: 'custom', customCommand: 'definitely-not-a-real-cli-xyz {prompt}' }, prompt: 'x', phase: 'work', workspace: os.tmpdir(), timeoutMs: 5000 });
  assert.equal(res.ok, false);
  assert.match(res.error, /not found/i);
});

test('runAgent times out long runs', async () => {
  const res = await runAgent({ agent: { engine: 'custom', customCommand: `"${process.execPath}" -e "setTimeout(()=>{},60000)"` }, prompt: 'x', phase: 'work', workspace: os.tmpdir(), timeoutMs: 400 });
  assert.equal(res.ok, false);
  assert.match(res.error, /Timed out/);
});

test('full office run: leader plans, members report, boss gets the compiled report', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vao-test-'));
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'vao-ws-'));
  const state = new OfficeState({ home, workspace: ws, demo: true });
  const cmd = `"${process.execPath}" "${FAKE}"`;
  for (const a of state.config.agents) Object.assign(a, { engine: 'custom', customCommand: cmd });
  state.setSettings({ walkDelayMs: 0 });
  const events = [];
  const orch = new Orchestrator(state, (type, payload) => events.push({ type, ...payload }));
  const task = orch.submit({ text: 'Make a website' });
  await new Promise((resolve) => {
    const iv = setInterval(() => { if (!orch.current && !orch.queue.length) { clearInterval(iv); resolve(); } }, 50);
  });
  const done = state.history.find((t) => t.id === task.id);
  assert.equal(done.status, 'done', done.error);
  assert.equal(done.assignments.length, state.members.length);
  assert.ok(done.assignments.every((a) => a.status === 'done'));
  assert.match(done.final, /Compiled by Aisyah/);
  assert.ok(events.some((e) => e.type === 'fx' && e.kind === 'paper' && e.to === 'boss' && e.inbox));
  assert.ok(events.some((e) => e.type === 'fx' && e.kind === 'walk' && e.to === 'leader'));
  assert.ok(fs.existsSync(done.reportFile));
});

test('office layout: every seat and visitor spot is reachable', () => {
  for (const n of [0, 4, 7, 15]) {
    const L = buildLayout(n);
    const start = { x: 15, y: 10 };
    const spots = [...L.desks.map((d) => d.seat), L.leaderDesk.seat, ...L.leaderVisit, ...L.bossVisit, ...L.pois];
    for (const s of spots) {
      const goal = { x: Math.floor(s.x / 16), y: Math.floor(s.y / 16) };
      assert.ok(findPath(start, goal, L.W, L.H, L.isBlocked), `unreachable ${JSON.stringify(goal)} with ${n} members`);
    }
  }
});

test('plan prompt lists the team and asks for JSON only', () => {
  const p = planPrompt({ office: { officeName: 'X', boss: { name: 'Boss' } }, leader, members, task: 'T', workspace: '/w' });
  assert.match(p, /Danial \| role: Backend/);
  assert.match(p, /Reply with ONLY a JSON object/);
});
