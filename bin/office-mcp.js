#!/usr/bin/env node
// Virtual Agent Office — "office" MCP server + shell helper.
//
// MCP (stdio):  spawned by the agent's CLI (Claude Code gets it automatically).
// Shell helper: node office-mcp.js team | ask <who> "q" | send <who> "msg" | reply <id> "answer" | inbox | status "text"
//
// Identity comes from VAO_URL + VAO_TOKEN, which the office sets for every agent run.
// No dependencies: speaks newline-delimited JSON-RPC 2.0 on stdin/stdout.
import http from 'node:http';
import fs from 'node:fs';
import readline from 'node:readline';

const VERSION = '0.2.0';
const MAX_POLL = 50; // seconds per HTTP long-poll
const PROTOCOLS = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'];

function findIdentity() {
  let url = process.env.VAO_URL;
  let token = process.env.VAO_TOKEN;
  // Some CLIs start MCP servers with a scrubbed environment. On Linux, look at our ancestors.
  if ((!url || !token) && process.platform === 'linux') {
    let pid = process.ppid;
    for (let i = 0; i < 8 && pid > 1 && (!url || !token); i++) {
      try {
        const env = fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0');
        for (const kv of env) {
          if (!url && kv.startsWith('VAO_URL=')) url = kv.slice(8);
          if (!token && kv.startsWith('VAO_TOKEN=')) token = kv.slice(10);
        }
        pid = Number(fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ')[1]);
      } catch { break; }
    }
  }
  return { url, token };
}

const { url: OFFICE_URL, token: TOKEN } = findIdentity();

function call(op, args = {}) {
  return new Promise((resolve, reject) => {
    if (!OFFICE_URL || !TOKEN) return reject(new Error('Not connected to a Virtual Agent Office run (VAO_URL / VAO_TOKEN are missing).'));
    const body = JSON.stringify({ op, ...args });
    const u = new URL('/api/office', OFFICE_URL);
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), authorization: `Bearer ${TOKEN}` },
      timeout: (MAX_POLL + 20) * 1000,
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json;
        try { json = JSON.parse(data); } catch { return reject(new Error(`Office answered ${res.statusCode}: ${data.slice(0, 200)}`)); }
        if (!json.ok) return reject(new Error(json.error || `Office error ${res.statusCode}`));
        resolve(json);
      });
    });
    req.on('timeout', () => req.destroy(new Error('The office did not answer in time.')));
    req.on('error', (e) => reject(new Error(`Can't reach the office at ${OFFICE_URL}: ${e.message}`)));
    req.end(body);
  });
}

const clampWait = (v, d, max) => Math.max(0, Math.min(max, Number.isFinite(+v) ? +v : d));

// -- operations shared by MCP tools and the shell helper ----------------------
const ops = {
  async team() { return (await call('team')).text; },

  async send({ to, message, reply_to }) {
    return (await call('send', { to, message, reply_to })).text;
  },

  async ask({ to, question, wait_seconds }) {
    let left = clampWait(wait_seconds, 180, 600);
    let r = await call('ask', { to, question, wait_seconds: Math.min(left, MAX_POLL) });
    left -= Math.min(left, MAX_POLL);
    while (!r.answer && left > 0) {
      const w = Math.min(left, MAX_POLL);
      r = { ...r, ...(await call('await', { id: r.id, wait_seconds: w })) };
      left -= w;
    }
    if (r.answer) return `${r.answer.fromName} answered:\n${r.answer.text}`;
    return `No answer yet (question id ${r.id}). Carry on with your best judgement; the answer will show up in check_messages.`;
  },

  async inbox({ wait_seconds } = {}) {
    return (await call('inbox', { wait_seconds: clampWait(wait_seconds, 0, MAX_POLL) })).text;
  },

  async status({ text }) { return (await call('status', { text })).text; },
};

// -- MCP ----------------------------------------------------------------------
const WHO = 'A teammate\'s name, "leader", "boss" or "everyone".';
const TOOLS = [
  {
    name: 'team_status',
    description: 'See your team: who is the leader, what each person was assigned and what they are doing right now.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => ops.team(),
  },
  {
    name: 'ask',
    description: 'Ask the leader, a teammate or the boss a question and WAIT for the answer (default up to 180 s). Use it when you are blocked or depend on someone else\'s decision (API shape, file names, shared styles…).',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Who to ask: a teammate\'s name, "leader" or "boss".' },
        question: { type: 'string', description: 'A short, specific question.' },
        wait_seconds: { type: 'number', description: 'How long to wait for the answer (0-600, default 180).' },
      },
      required: ['to', 'question'],
      additionalProperties: false,
    },
    run: (a) => ops.ask(a),
  },
  {
    name: 'send_message',
    description: 'Send a message without waiting: share a decision that affects others, warn about a conflict, or answer a question you received (pass its id as reply_to).',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: `${WHO} Optional when reply_to is set.` },
        message: { type: 'string' },
        reply_to: { type: 'string', description: 'Id of the message you are answering (e.g. m_1a2b3c4d5e).' },
      },
      required: ['message'],
      additionalProperties: false,
    },
    run: (a) => ops.send(a),
  },
  {
    name: 'check_messages',
    description: 'Read messages and questions sent to you since you last checked. Check after each major step and answer questions with send_message(reply_to=…).',
    inputSchema: {
      type: 'object',
      properties: { wait_seconds: { type: 'number', description: 'Optionally wait up to this many seconds (max 50) for a new message.' } },
      additionalProperties: false,
    },
    run: (a) => ops.inbox(a),
  },
  {
    name: 'update_status',
    description: 'Show a short progress line above your head in the office (e.g. "Writing the login form").',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
    run: (a) => ops.status(a),
  },
];

function serveMcp() {
  const out = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on('line', async (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return out({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
    const { id, method, params } = msg;
    if (id === undefined || id === null) return; // notification
    try {
      if (method === 'initialize') {
        const v = PROTOCOLS.includes(params?.protocolVersion) ? params.protocolVersion : PROTOCOLS[PROTOCOLS.length - 1];
        return out({
          jsonrpc: '2.0', id,
          result: {
            protocolVersion: v,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'virtual-agent-office', version: VERSION },
            instructions: 'You are an agent in a virtual office. Use these tools to coordinate with your leader, teammates and the boss while you work. Keep messages short.',
          },
        });
      }
      if (method === 'ping') return out({ jsonrpc: '2.0', id, result: {} });
      if (method === 'tools/list') return out({ jsonrpc: '2.0', id, result: { tools: TOOLS.map(({ run, ...t }) => t) } });
      if (method === 'tools/call') {
        const tool = TOOLS.find((t) => t.name === params?.name);
        if (!tool) return out({ jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool: ${params?.name}` } });
        try {
          const text = await tool.run(params.arguments || {});
          return out({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } });
        } catch (e) {
          return out({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: e.message }], isError: true } });
        }
      }
      if (method === 'resources/list') return out({ jsonrpc: '2.0', id, result: { resources: [] } });
      if (method === 'prompts/list') return out({ jsonrpc: '2.0', id, result: { prompts: [] } });
      return out({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
    } catch (e) {
      return out({ jsonrpc: '2.0', id, error: { code: -32603, message: e.message } });
    }
  });
  rl.on('close', () => process.exit(0));
}

// -- shell helper -------------------------------------------------------------
const USAGE = `office — talk to your team from the shell
  office team                         who is doing what
  office ask <who> "question" [secs]  ask and wait for the answer (default 180 s)
  office send <who> "message"         tell someone without waiting
  office reply <message-id> "answer"  answer a question you received
  office inbox [secs]                 read messages sent to you
  office status "progress line"       shown above your head
  <who> = a teammate's name, leader, boss or everyone`;

async function shell(argv) {
  const [cmd, ...rest] = argv;
  const need = (n) => { if (rest.length < n) throw new Error(USAGE); };
  switch (cmd) {
    case 'team': return ops.team();
    case 'ask': need(2); return ops.ask({ to: rest[0], question: rest[1], wait_seconds: rest[2] });
    case 'send': need(2); return ops.send({ to: rest[0], message: rest.slice(1).join(' ') });
    case 'reply': need(2); return ops.send({ reply_to: rest[0], message: rest.slice(1).join(' ') });
    case 'inbox': return ops.inbox({ wait_seconds: rest[0] });
    case 'status': need(1); return ops.status({ text: rest.join(' ') });
    case 'help': case '-h': case '--help': return USAGE;
    default: throw new Error(USAGE);
  }
}

if (process.argv.length > 2) {
  shell(process.argv.slice(2)).then(
    (text) => { process.stdout.write(`${text}\n`); },
    (e) => { process.stderr.write(`${e.message}\n`); process.exitCode = 1; },
  );
} else {
  serveMcp();
}
