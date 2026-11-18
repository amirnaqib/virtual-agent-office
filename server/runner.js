import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ENGINES, createParser, readOutFile } from './engines.js';
import { isWin, which, splitArgs, stripAnsi, delay, truncate } from './util.js';
import { mockOutput } from './mock.js';

const MAX_CAPTURE = 4 * 1024 * 1024;
const running = new Set();

/**
 * Run one agent turn.
 * @returns {Promise<{ok:boolean,text:string,error?:string,exitCode?:number,durationMs:number,aborted?:boolean}>}
 */
export async function runAgent({ agent, prompt, phase, workspace, timeoutMs, signal, onActivity, mock }) {
  const engine = ENGINES[agent.engine] || ENGINES.mock;
  const autonomy = phase === 'work' ? (agent.autonomy || 'edit') : 'safe';
  const started = Date.now();
  const emit = (kind, text) => onActivity?.({ kind, text: String(text) });

  if (engine.parser === 'mock') {
    return runMock({ agent, phase, signal, emit, mock, started });
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vao-'));
  const tmpFile = (name) => path.join(tmpDir, name);
  try {
    const extra = splitArgs(agent.extraArgs || '');
    let spec;
    try {
      spec = engine.build({ agent, autonomy, extra, prompt, workspace, tmpFile, phase });
    } catch (e) {
      return { ok: false, text: '', error: e.message, durationMs: Date.now() - started };
    }
    const cmd = spec.cmd || engine.bin;
    const parser = createParser(engine.parser);
    emit('sys', `$ ${cmd} ${spec.args.map((a) => (a === prompt ? '<prompt>' : a)).join(' ')}`);

    const res = await spawnStreaming({
      cmd,
      args: spec.args,
      cwd: workspace,
      stdin: spec.stdin ? prompt : null,
      timeoutMs,
      signal,
      onLine(line, stream) {
        const clean = stripAnsi(line);
        if (stream === 'stderr') { if (clean.trim()) emit('err', clean); return; }
        for (const a of parser.line(clean)) emit(a.kind, a.text);
      },
    });

    const fromFile = readOutFile(spec.outFile);
    const text = (fromFile || parser.finish(stripAnsi(res.stdout)) || '').trim();
    const durationMs = Date.now() - started;
    if (res.aborted) return { ok: false, aborted: true, text, error: 'Cancelled', durationMs };
    if (res.error) return { ok: false, text, error: res.error, durationMs };
    if (res.timedOut) return { ok: false, text, error: `Timed out after ${Math.round(timeoutMs / 60000)} min`, durationMs };
    if (res.code !== 0) {
      const tail = stripAnsi(res.stderr).trim().split('\n').slice(-6).join('\n');
      return { ok: false, text, exitCode: res.code, error: `Exited with code ${res.code}${tail ? `: ${truncate(tail, 600)}` : ''}`, durationMs };
    }
    if (!text) {
      return { ok: false, text: '', exitCode: 0, error: 'The CLI finished but printed nothing. Check that it is signed in and supports non-interactive mode.', durationMs };
    }
    return { ok: true, text, exitCode: 0, durationMs };
  } finally {
    fs.rm(tmpDir, { recursive: true, force: true }, () => {});
  }
}

async function runMock({ agent, phase, signal, emit, mock, started }) {
  const { lines, text, durationMs } = mockOutput({ agent, phase, ...mock });
  const step = durationMs / (lines.length + 1);
  emit('sys', `simulated ${phase} · Demo engine`);
  for (const l of lines) {
    await delay(step * (0.6 + Math.random() * 0.8), signal);
    if (signal?.aborted) return { ok: false, aborted: true, text: '', error: 'Cancelled', durationMs: Date.now() - started };
    emit(l.kind, l.text);
  }
  await delay(step, signal);
  if (signal?.aborted) return { ok: false, aborted: true, text: '', error: 'Cancelled', durationMs: Date.now() - started };
  return { ok: true, text, exitCode: 0, durationMs: Date.now() - started };
}

// ---------------------------------------------------------------------------
// Process spawning
// ---------------------------------------------------------------------------

const META = /([()\][%!^"`<>&|;, *?])/g;
function winEscapeArg(arg, double) {
  let a = String(arg).replace(/\r?\n/g, ' ');
  a = a.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"');
  a = a.replace(/(?=(\\+?)?)\1$/, '$1$1');
  a = `"${a}"`.replace(META, '^$1');
  return double ? a.replace(META, '^$1') : a;
}

function buildSpawn(cmd, args) {
  const resolved = which(cmd);
  if (!resolved) return { error: `Command not found: \`${cmd}\`. Is it installed and on your PATH?` };
  if (isWin && /\.(cmd|bat)$/i.test(resolved)) {
    // .cmd shims (npm globals) must go through cmd.exe; escape like cross-spawn does.
    const dbl = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/i.test(resolved);
    const line = [resolved.replace(META, '^$1'), ...args.map((a) => winEscapeArg(a, dbl))].join(' ');
    return { file: process.env.comspec || 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], opts: { windowsVerbatimArguments: true } };
  }
  return { file: resolved, args, opts: {} };
}

export function spawnStreaming({ cmd, args, cwd, stdin, timeoutMs, signal, onLine }) {
  return new Promise((resolve) => {
    const sp = buildSpawn(cmd, args);
    if (sp.error) return resolve({ error: sp.error, stdout: '', stderr: '' });
    if (cwd && !fs.existsSync(cwd)) return resolve({ error: `Workspace folder does not exist: ${cwd}`, stdout: '', stderr: '' });

    let child;
    try {
      child = spawn(sp.file, sp.args, {
        cwd,
        env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        detached: !isWin,
        ...sp.opts,
      });
    } catch (e) {
      return resolve({ error: e.message, stdout: '', stderr: '' });
    }
    running.add(child);

    let stdout = '';
    let stderr = '';
    const buf = { stdout: '', stderr: '' };
    let timedOut = false;
    let aborted = false;
    let settled = false;

    const push = (stream, chunk) => {
      const s = chunk.toString('utf8');
      if (stream === 'stdout') { if (stdout.length < MAX_CAPTURE) stdout += s; }
      else if (stderr.length < MAX_CAPTURE) stderr += s;
      buf[stream] += s;
      const parts = buf[stream].split(/\r?\n/);
      buf[stream] = parts.pop();
      for (const p of parts) onLine?.(p, stream);
    };
    child.stdout.on('data', (c) => push('stdout', c));
    child.stderr.on('data', (c) => push('stderr', c));
    child.stdin.on('error', () => {});
    if (stdin != null) child.stdin.end(stdin);
    else child.stdin.end();

    const timer = timeoutMs ? setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs) : null;
    const onAbort = () => { aborted = true; killTree(child); };
    signal?.addEventListener('abort', onAbort, { once: true });

    const finish = (code, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      running.delete(child);
      for (const s of ['stdout', 'stderr']) if (buf[s]) { onLine?.(buf[s], s); buf[s] = ''; }
      resolve({ code, stdout, stderr, timedOut, aborted, error });
    };
    child.on('error', (e) => finish(-1, e.code === 'ENOENT' ? `Command not found: \`${cmd}\`` : e.message));
    child.on('close', (code) => finish(code ?? -1));
  });
}

function killTree(child) {
  if (!child || child.exitCode != null) return;
  try {
    if (isWin) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    else process.kill(-child.pid, 'SIGTERM');
  } catch { try { child.kill('SIGTERM'); } catch { /* gone */ } }
  setTimeout(() => {
    if (child.exitCode == null) {
      try { if (!isWin) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* gone */ }
    }
  }, 4000).unref();
}

export function killAll() {
  for (const c of running) killTree(c);
}
