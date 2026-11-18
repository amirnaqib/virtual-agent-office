import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server/index.js';
import { BRIDGE } from '../server/engines.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE = path.join(here, 'fake-agent.mjs');

async function office() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vao-chat-'));
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'vao-chatws-'));
  const srv = await startServer({ port: 0, home, workspace: ws, demo: true });
  return srv;
}

function mcpClient(env) {
  const child = spawn(process.execPath, [BRIDGE], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'inherit'] });
  const rl = readline.createInterface({ input: child.stdout });
  const waiting = new Map();
  rl.on('line', (l) => { const m = JSON.parse(l); waiting.get(m.id)?.(m); waiting.delete(m.id); });
  let id = 0;
  return {
    call(method, params) {
      const myId = ++id;
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: myId, method, params })}\n`);
      return new Promise((r) => waiting.set(myId, r));
    },
    notify(method) { child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`); },
    close() { child.stdin.end(); child.kill(); },
  };
}

test('office MCP server speaks MCP and routes messages to teammates', async () => {
  const srv = await office();
  try {
    const { state, orch } = srv;
    const [leader, danial] = [state.leader, state.members[0]];
    const token = orch.chat.issueToken(danial.id, null);
    const c = mcpClient({ VAO_URL: orch.officeUrl, VAO_TOKEN: token });

    const init = await c.call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    assert.equal(init.result.protocolVersion, '2025-06-18');
    assert.ok(init.result.capabilities.tools);
    c.notify('notifications/initialized');

    const list = await c.call('tools/list', {});
    assert.deepEqual(list.result.tools.map((t) => t.name).sort(), ['ask', 'check_messages', 'send_message', 'team_status', 'update_status']);

    const team = await c.call('tools/call', { name: 'team_status', arguments: {} });
    assert.match(team.result.content[0].text, new RegExp(`Your leader is ${leader.name}`));

    const sent = await c.call('tools/call', { name: 'send_message', arguments: { to: 'leader', message: 'API is on /api/v1' } });
    assert.match(sent.result.content[0].text, new RegExp(`Sent to ${leader.name}`));
    const inLeaderInbox = orch.chat.takeUnread(leader.id);
    assert.equal(inLeaderInbox[0].text, 'API is on /api/v1');

    const bad = await c.call('tools/call', { name: 'send_message', arguments: { to: 'Nobody', message: 'hi' } });
    assert.equal(bad.result.isError, true);

    // a teammate messages Danial; he reads it with check_messages
    orch.chat.post({ from: leader.id, to: danial.id, text: 'Please use port 8080', kind: 'message' });
    const inbox = await c.call('tools/call', { name: 'check_messages', arguments: {} });
    assert.match(inbox.result.content[0].text, /Please use port 8080/);

    // ask the boss → the boss answers from the UI side
    const asking = c.call('tools/call', { name: 'ask', arguments: { to: 'boss', question: 'Blue or green?', wait_seconds: 10 } });
    await new Promise((r) => setTimeout(r, 300));
    const q = orch.chat.messages.find((m) => m.text === 'Blue or green?');
    orch.chat.post({ from: 'boss', to: danial.id, text: 'Green.', kind: 'reply', replyTo: q.id });
    const answered = await asking;
    assert.match(answered.result.content[0].text, /answered:\nGreen\./);
    assert.equal(orch.chat.find(q.id).answered, true);

    // revoked passes are refused
    orch.chat.revokeToken(token);
    const after = await c.call('tools/call', { name: 'team_status', arguments: {} });
    assert.equal(after.result.isError, true);
    c.close();
  } finally {
    srv.close();
  }
});

test('mid-work chat: a member asks the waiting leader, who answers in a reply turn', async () => {
  const srv = await office();
  try {
    const { state, orch } = srv;
    const cmd = `"${process.execPath}" "${FAKE}"`;
    for (const a of state.config.agents) Object.assign(a, { engine: 'custom', customCommand: cmd });
    state.setSettings({ walkDelayMs: 0 });
    const task = orch.submit({ text: 'Build an API' });
    await new Promise((resolve) => {
      const iv = setInterval(() => { if (!orch.current && !orch.queue.length) { clearInterval(iv); resolve(); } }, 50);
    });
    const done = state.history.find((t) => t.id === task.id);
    assert.equal(done.status, 'done', done.error);
    const q = done.chat.find((m) => m.kind === 'question');
    assert.ok(q, 'Danial asked a question');
    assert.equal(q.fromName, 'Danial');
    assert.equal(q.toName, state.leader.name);
    const a = done.chat.find((m) => m.kind === 'reply' && m.replyTo === q.id);
    assert.match(a.text, /Use port 8080/);
    const danial = done.assignments.find((x) => x.name === 'Danial');
    assert.match(danial.report, /answered: Use port 8080/);
    assert.match(done.final, /Chat was included/);
    assert.match(fs.readFileSync(done.reportFile, 'utf8'), /Appendix: team chat/);
  } finally {
    srv.close();
  }
});

test('boss can message an idle agent and gets a reply', async () => {
  const srv = await office();
  try {
    const { state, orch } = srv;
    const farah = state.config.agents.find((a) => a.name === 'Farah');
    Object.assign(farah, { engine: 'custom', customCommand: `"${process.execPath}" "${FAKE}"` });
    const m = orch.chat.post({ from: 'boss', to: farah.id, text: 'Which port do we use?' });
    await new Promise((resolve) => {
      const iv = setInterval(() => { if (orch.chat.replyTo(m.id)) { clearInterval(iv); resolve(); } }, 50);
    });
    assert.match(orch.chat.replyTo(m.id).text, /Use port 8080 \(Farah\)/);
    assert.equal(orch.chat.replyTo(m.id).to, 'boss');
  } finally {
    srv.close();
  }
});

test('an answered question does not come back through check_messages', async () => {
  const srv = await office();
  try {
    const { state, orch } = srv;
    const [a, b] = state.members;
    orch.running.set(b.id, 'x'); // b is "busy", so no reply turn
    const q = orch.chat.post({ from: a.id, to: b.id, text: 'Ready?', kind: 'question' });
    orch.chat.post({ from: b.id, to: a.id, text: 'Yes', kind: 'reply', replyTo: q.id });
    assert.deepEqual(orch.chat.takeUnread(b.id), []);
    assert.equal(orch.chat.takeUnread(a.id)[0].text, 'Yes');
  } finally {
    srv.close();
  }
});
