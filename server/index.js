import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { OfficeState } from './state.js';
import { Orchestrator } from './orchestrator.js';
import { killAll } from './runner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(__dirname, '..', 'public');
const PKG = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.gif': 'image/gif', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.md': 'text/markdown; charset=utf-8',
};

export function defaultHome() {
  return process.env.VAO_HOME || path.join(os.homedir(), '.virtual-agent-office');
}

export async function startServer(opts = {}) {
  const port = opts.port ?? 4317;
  const host = opts.host ?? '127.0.0.1';
  const home = path.resolve(opts.home || defaultHome());
  const assetsDir = path.resolve(opts.assets || path.join(home, 'assets'));
  const allowRemote = !['127.0.0.1', 'localhost', '::1'].includes(host);
  fs.mkdirSync(assetsDir, { recursive: true });

  const state = new OfficeState({ home, workspace: opts.workspace ? path.resolve(opts.workspace) : null, demo: opts.demo });
  const clients = new Set();
  const emit = (type, payload) => {
    const msg = JSON.stringify({ type, ...payload });
    for (const ws of clients) if (ws.readyState === 1) ws.send(msg);
  };
  const orch = new Orchestrator(state, emit);

  const hostAllowed = (req) => {
    const h = (req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    return allowRemote || ['localhost', '127.0.0.1', '::1'].includes(h);
  };

  const server = http.createServer((req, res) => {
    if (!hostAllowed(req)) { res.writeHead(403); return res.end('Forbidden host'); }
    let url;
    try { url = new URL(req.url, 'http://x'); } catch { res.writeHead(400); return res.end(); }
    if (url.pathname === '/api/office') return officeApi(req, res);
    let p = decodeURIComponent(url.pathname);
    let root = PUBLIC;
    if (p.startsWith('/custom-assets/')) { root = assetsDir; p = p.slice('/custom-assets'.length); }
    if (p === '/') p = '/index.html';
    const file = path.resolve(root, `.${p}`);
    if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) {
        // No asset pack installed is the normal case: answer quietly.
        if (root === assetsDir && p === '/manifest.json') { res.writeHead(204); return res.end(); }
        res.writeHead(404); return res.end('Not found');
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      fs.createReadStream(file).pipe(res);
    });
  });

  // Agents' office bridge (MCP server / shell helper) talks to this endpoint with a per-run token.
  function officeApi(req, res) {
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
    if (req.method !== 'POST') return send(405, { ok: false, error: 'POST only' });
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { body += c; if (body.length > 64 * 1024) { send(413, { ok: false, error: 'Too large' }); req.destroy(); } });
    req.on('end', async () => {
      let json;
      try { json = JSON.parse(body || '{}'); } catch { return send(400, { ok: false, error: 'Bad JSON' }); }
      try { send(200, { ok: true, ...(await orch.chat.http(req.headers.authorization, json)) }); }
      catch (e) { send(e.status || 400, { ok: false, error: e.message }); }
    });
  }

  const wss = new WebSocketServer({
    server,
    path: '/ws',
    maxPayload: 1024 * 1024,
    verifyClient: ({ req }) => {
      if (!hostAllowed(req)) return false;
      const origin = req.headers.origin;
      if (!origin) return true; // non-browser local client
      try { return new URL(origin).host === req.headers.host; } catch { return false; }
    },
  });

  const snapshot = () => ({
    version: PKG.version,
    demo: Boolean(opts.demo),
    config: state.config,
    engines: state.engines,
    runtime: orch.snapshot(),
    history: state.history.slice(-50),
    home,
    assetsDir,
    userHome: os.homedir(),
  });
  const pushConfig = () => emit('config', { config: state.config });

  const handlers = {
    hello: () => ({ type: 'snapshot', ...snapshot() }),
    'agent:save': ({ agent }) => {
      if (agent?.makeLeader && orch.current) throw new Error('Wait until the current task finishes before changing the leader.');
      const a = state.upsertAgent(agent || {});
      pushConfig();
      return { type: 'ok', what: 'agent:save', id: a.id };
    },
    'agent:delete': ({ id }) => {
      if (orch.current) throw new Error('Wait until the current task finishes before removing someone.');
      state.deleteAgent(id);
      pushConfig();
    },
    'leader:set': ({ id }) => {
      if (orch.current) throw new Error('Wait until the current task finishes before changing the leader.');
      state.setLeader(id);
      pushConfig();
    },
    'boss:save': ({ boss }) => { state.setBoss(boss); pushConfig(); },
    'settings:save': ({ settings }) => { state.setSettings(settings); pushConfig(); return { type: 'ok', what: 'settings:save' }; },
    'engines:refresh': () => { emit('engines', { engines: state.refreshEngines() }); },
    'task:submit': ({ text, agentId }) => { const t = orch.submit({ text, agentId }); return { type: 'ok', what: 'task:submit', id: t.id }; },
    'task:cancel': ({ id }) => { orch.cancel(id); },
    'report:read': ({ id }) => { orch.markRead(id); },
    'boss:send': ({ to, text, replyTo }) => {
      let target;
      if (replyTo) {
        target = orch.chat.find(replyTo)?.from;
        if (!target || target === 'boss') throw new Error('That message is gone.');
      } else {
        target = to === 'everyone' || state.agent(to) ? to : orch.chat.resolve(to, 'boss');
      }
      const m = orch.chat.post({ from: 'boss', to: target, text, kind: replyTo ? 'reply' : 'message', replyTo: replyTo || null });
      return { type: 'ok', what: 'boss:send', id: m.id };
    },
    'history:clear': () => { state.history = state.history.filter((t) => t.status === 'running'); state.saveHistory(); emit('history', { history: state.history }); },
  };

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      const h = handlers[msg?.type];
      if (!h) return;
      try {
        const reply = h(msg);
        if (reply) ws.send(JSON.stringify({ ...reply, reqId: msg.reqId }));
        else if (msg.reqId) ws.send(JSON.stringify({ type: 'ok', what: msg.type, reqId: msg.reqId }));
      } catch (e) {
        ws.send(JSON.stringify({ type: 'error', message: e.message, reqId: msg.reqId }));
      }
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });

  const port_ = server.address().port;
  const localHost = ['0.0.0.0', '::', 'localhost', '127.0.0.1'].includes(host) ? '127.0.0.1' : host.includes(':') ? `[${host}]` : host;
  orch.officeUrl = `http://${localHost}:${port_}`;

  const shutdown = () => { killAll(); server.close(); process.exit(0); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  const shownHost = host === '0.0.0.0' || host === '::' ? 'localhost' : host;
  return { url: `http://${shownHost}:${server.address().port}`, state, orch, server, close: () => { killAll(); wss.close(); server.close(); } };
}
