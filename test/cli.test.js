import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../server/cli.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const VAO = path.join(here, '..', 'bin', 'vao.js');
const FAKE = path.join(here, 'fake-agent.mjs');

function vao(home, ...args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [VAO, ...args], { env: { ...process.env, VAO_HOME: home }, timeout: 60000 }, (err, stdout, stderr) => {
      resolve({ code: err ? err.code ?? 1 : 0, stdout, stderr });
    });
  });
}

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

test('parseArgs handles flags, values, = form and positionals', () => {
  const { pos, opt } = parseArgs(['hire', 'Mei Ling', '--role', 'UI', '--leader', '--hair=hijab', '-w', '/x']);
  assert.deepEqual(pos, ['hire', 'Mei Ling']);
  assert.deepEqual(opt, { role: 'UI', leader: true, hair: 'hijab', workspace: '/x' });
});

test('offline: build a team from the command line', async () => {
  const home = tmp('vao-cli-');
  let r = await vao(home, 'hire', 'Zara', '--role', 'Designer', '--engine', 'demo', '--hair', 'tudung', '--hair-color', 'teal', '--shirt', 'pink', '--eyewear', 'round', '--leader');
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Hired Zara, Designer — Demo \(simulated\) — ★ team leader/);

  r = await vao(home, 'team', '--json');
  const cfg = JSON.parse(r.stdout);
  const zara = cfg.agents.find((a) => a.name === 'Zara');
  assert.equal(cfg.leaderId, zara.id);
  assert.equal(zara.look.hairStyle, 'hijab');
  assert.equal(zara.look.hairColor, '#2fa38a');
  assert.equal(zara.look.shirt, '#f27ab4');
  assert.equal(zara.look.eyewear, 'round');

  r = await vao(home, 'edit', 'zara', '--rename', 'Zara Lee', '--autonomy', 'read-only', '--extra', 'headphones');
  assert.equal(r.code, 0, r.stderr);
  r = await vao(home, 'lead', 'Danial');
  assert.match(r.stdout, /Danial is now the team leader/);
  r = await vao(home, 'fire', 'Farah');
  assert.equal(r.code, 0, r.stderr);
  r = await vao(home, 'boss', '--name', 'Amir', '--office', 'Studio Amir', '--hair', 'side');
  assert.equal(r.code, 0, r.stderr);

  const after = JSON.parse((await vao(home, 'team', '--json')).stdout);
  const zl = after.agents.find((a) => a.name === 'Zara Lee');
  assert.equal(zl.autonomy, 'safe');
  assert.equal(zl.look.extra, 'headphones');
  assert.equal(zl.look.hairStyle, 'hijab', 'look is kept when editing other fields');
  assert.equal(after.agents.find((a) => a.id === after.leaderId).name, 'Danial');
  assert.ok(!after.agents.some((a) => a.name === 'Farah'));
  assert.equal(after.boss.name, 'Amir');
  assert.equal(after.officeName, 'Studio Amir');

  r = await vao(home, 'hire', 'Bad', '--hair', 'rainbow');
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /Unknown hair style/);
  r = await vao(home, 'edit', 'Nobody', '--role', 'x');
  assert.match(r.stderr, /No agent called "Nobody"/);
});

test('setup-claude installs the skill', async () => {
  const home = tmp('vao-cli-');
  const proj = tmp('vao-proj-');
  const r = await vao(home, 'setup-claude', '--project', proj);
  assert.equal(r.code, 0, r.stderr);
  const skill = fs.readFileSync(path.join(proj, '.claude', 'skills', 'virtual-agent-office', 'SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: virtual-agent-office\ndescription: /);
  assert.match(skill, /vao task/);
});

test('live: drive a running office from the CLI, end to end', async () => {
  const home = tmp('vao-live-');
  const ws = tmp('vao-livews-');
  const server = spawn(process.execPath, [VAO, 'start', '--no-open', '--port', '0', '--workspace', ws], { env: { ...process.env, VAO_HOME: home }, stdio: 'ignore' });
  try {
    const rtFile = path.join(home, 'runtime.json');
    for (let i = 0; i < 100 && !fs.existsSync(rtFile); i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(fs.existsSync(rtFile), 'office wrote runtime.json');

    let r = await vao(home, 'start', '--no-open');
    assert.match(r.stdout, /already open/);

    // a small, fast team of fake CLIs
    for (const n of ['Mei Ling', 'Arjun', 'Farah']) assert.equal((await vao(home, 'fire', n)).code, 0);
    const fake = `"${process.execPath}" "${FAKE}"`;
    for (const n of ['Aisyah', 'Danial']) {
      r = await vao(home, 'edit', n, '--engine', 'custom', '--custom-command', fake);
      assert.equal(r.code, 0, r.stderr);
    }
    r = await vao(home, 'config', '--walk', '0');
    assert.match(r.stdout, /walk pace\s+0 ms/);

    r = await vao(home, 'team');
    assert.match(r.stdout, /★ Aisyah/);
    assert.match(r.stdout, /Custom CLI/);

    r = await vao(home, 'task', 'Build an API', '--wait', '--timeout', '1');
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Compiled by Aisyah/);
    assert.match(r.stderr, /Danial → Aisyah: Which port/);

    r = await vao(home, 'report', 'last');
    assert.match(r.stdout, /Compiled by Aisyah/);
    r = await vao(home, 'chat');
    assert.match(r.stdout, /Danial → Aisyah \(asks\): Which port should the API use\?/);
    r = await vao(home, 'status');
    assert.match(r.stdout, /No task running/);

    r = await vao(home, 'stop');
    assert.match(r.stdout, /Closed the office/);
    r = await vao(home, 'status');
    assert.match(r.stdout, /not running/);
  } finally {
    server.kill();
  }
});
