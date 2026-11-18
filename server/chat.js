import crypto from 'node:crypto';
import { uid, truncate } from './util.js';
import { replyPrompt } from './prompts.js';

const MAX_MESSAGES = 600;
const MAX_POLL_MS = 50_000;
const LEADER_WORDS = ['leader', 'lead', 'team leader', 'ketua', 'the leader'];
const ALL_WORDS = ['everyone', 'all', 'team', 'everybody', 'semua', 'the team'];
const BOSS_WORDS = ['boss', 'the boss', 'bos'];

/**
 * Office chat: agents (and the boss) message each other while work is going on.
 *
 * - Running agents talk through the "office" MCP server / shell helper (HTTP + token).
 * - A question to someone who is NOT running right now (e.g. the leader waiting for
 *   reports) triggers a short read-only "reply turn" of that agent's CLI.
 * - Questions a running agent never answered get a reply turn when its run ends.
 */
export class OfficeChat {
  constructor(orch) {
    this.orch = orch;
    this.messages = [];
    this.unread = new Map();
    this.tokens = new Map();
    this.replyWaiters = new Map();
    this.inboxWaiters = new Map();
    this.pendingTurns = new Set();
  }

  get state() { return this.orch.state; }

  // -- identity ---------------------------------------------------------------
  issueToken(agentId, taskId) {
    const token = crypto.randomBytes(24).toString('hex');
    this.tokens.set(token, { agentId, taskId });
    return token;
  }

  revokeToken(token) { this.tokens.delete(token); }

  nameOf(id) {
    if (id === 'boss') return this.state.config.boss?.name || 'Boss';
    if (id === 'everyone') return 'everyone';
    return this.state.agent(id)?.name || 'someone';
  }

  /** Turn "leader" / "boss" / "everyone" / a name into a recipient id. */
  resolve(who, fromId) {
    const n = String(who || '').trim().replace(/^@/, '').toLowerCase();
    if (!n) throw new Error('Say who the message is for: a teammate\'s name, "leader", "boss" or "everyone".');
    const agents = this.state.config.agents;
    const boss = (this.state.config.boss?.name || 'boss').toLowerCase();
    let id = null;
    if (BOSS_WORDS.includes(n) || n === boss) id = 'boss';
    else if (ALL_WORDS.includes(n)) id = 'everyone';
    else if (LEADER_WORDS.includes(n)) id = this.state.leader?.id;
    else {
      const exact = agents.find((a) => a.name.toLowerCase() === n);
      const first = agents.filter((a) => a.name.toLowerCase().split(/\s+/)[0] === n.split(/\s+/)[0]);
      id = exact?.id || (first.length === 1 ? first[0].id : null);
    }
    if (!id) throw new Error(`Nobody called "${who}" works here. Try one of: ${agents.map((a) => a.name).join(', ')}, leader, boss or everyone.`);
    if (id === fromId) throw new Error('That is you. Pick someone else.');
    return id;
  }

  // -- messages ---------------------------------------------------------------
  post({ from, to, text, kind = 'message', replyTo = null, taskId = null }) {
    text = String(text ?? '').trim().slice(0, 4000);
    if (!text) throw new Error('The message is empty.');
    if (taskId === null || taskId === undefined) taskId = this.orch.current?.id ?? null;
    const msg = {
      id: uid('m'), ts: Date.now(), taskId, from, fromName: this.nameOf(from), to, toName: this.nameOf(to),
      text, kind, replyTo, answered: false,
    };
    this.messages.push(msg);
    if (this.messages.length > MAX_MESSAGES) this.messages.splice(0, this.messages.length - MAX_MESSAGES);

    if (replyTo) {
      const orig = this.find(replyTo);
      if (orig && !orig.answered) {
        orig.answered = true;
        this.orch.emit('chat:update', { id: orig.id, answered: true });
      }
      for (const fn of this.replyWaiters.get(replyTo) || []) fn(msg);
      this.replyWaiters.delete(replyTo);
      // once you've answered something it's no longer "new" for you
      const mine = this.unread.get(from);
      if (mine) this.unread.set(from, mine.filter((id) => id !== replyTo));
    }

    const recipients = to === 'everyone' ? this.state.config.agents.map((a) => a.id).filter((id) => id !== from) : [to];
    for (const r of recipients) {
      if (r === 'boss') continue;
      if (!this.unread.has(r)) this.unread.set(r, []);
      this.unread.get(r).push(msg.id);
      for (const fn of this.inboxWaiters.get(r) || []) fn();
      this.inboxWaiters.delete(r);
    }

    const task = this.orch.current;
    if (task && task.id === taskId) (task.chat ||= []).push(slim(msg));

    this.orch.emit('chat', { message: msg });
    this.orch.fx({ kind: 'msg', from, to, msgKind: kind });
    const fromAgent = this.state.agent(from);
    if (fromAgent) this.orch.log(fromAgent, 'chat', `→ ${msg.toName}${kind === 'question' ? ' (asks)' : ''}: ${text}`);
    for (const r of recipients) {
      const ag = this.state.agent(r);
      if (ag) this.orch.log(ag, 'chat', `← ${msg.fromName}${kind === 'question' ? ' asks' : ''}: ${text}`);
    }
    this.maybeRespond(msg, recipients);
    return msg;
  }

  find(id) { return this.messages.find((m) => m.id === id) || null; }

  /** Who needs a reply turn right now? */
  maybeRespond(msg, recipients) {
    const wantsAnswer = msg.kind === 'question' || (msg.from === 'boss' && msg.kind !== 'reply');
    if (!wantsAnswer) return;
    let targets = recipients.filter((r) => r !== 'boss' && r !== msg.from);
    if (msg.to === 'everyone') targets = targets.filter((r) => r === this.state.leader?.id); // the leader answers for the team
    for (const r of targets) if (!this.orch.isRunning(r)) this.respondLater(r, msg);
  }

  /** Called when an agent's work run ends: answer anything still open. */
  afterRun(agentId) {
    for (const m of this.messages) {
      if (m.answered || m.to !== agentId) continue;
      if (m.kind === 'question' || (m.from === 'boss' && m.kind !== 'reply')) this.respondLater(agentId, m);
    }
  }

  respondLater(agentId, msg) {
    const key = `${agentId}|${msg.id}`;
    if (this.pendingTurns.has(key)) return;
    this.pendingTurns.add(key);
    this.orch.withAgent(agentId, () => this.respond(agentId, msg))
      .catch((e) => console.warn('[vao] reply turn failed:', e.message))
      .finally(() => this.pendingTurns.delete(key));
  }

  async respond(agentId, msg) {
    if (msg.answered && msg.to !== 'everyone') return;
    const agent = this.state.agent(agentId);
    if (!agent) return;
    const prev = this.orch.status[agentId] || { status: 'idle', activity: '' };
    this.orch.setStatus(agent, 'replying', `Answering ${msg.fromName}`);
    try {
      const task = this.orch.current && this.orch.current.id === msg.taskId ? this.orch.current : null;
      const assignment = task?.assignments?.find((a) => a.agentId === agentId);
      const history = this.messages.filter((m) => (m.from === agentId || m.to === agentId || m.to === 'everyone') && m.id !== msg.id).slice(-6);
      const res = await this.orch.exec(agent, replyPrompt({
        office: this.state.config, agent, msg, task, assignment, history,
        isLeader: agentId === this.state.leader?.id, workspace: this.state.config.settings.workspace,
      }), 'chat', { mock: { question: msg.text, fromName: msg.fromName }, timeoutMs: 4 * 60_000 });
      if (res.aborted) return;
      const text = res.ok ? res.text.trim().slice(0, 3000) : `(I couldn't answer just now: ${truncate(res.error, 200)})`;
      this.post({ from: agentId, to: msg.from === 'everyone' ? 'boss' : msg.from, text, kind: 'reply', replyTo: msg.id, taskId: msg.taskId });
    } finally {
      if (this.orch.status[agentId]?.status === 'replying') this.orch.setStatus(agent, prev.status === 'replying' ? 'idle' : prev.status, prev.activity);
    }
  }

  takeUnread(agentId) {
    const ids = this.unread.get(agentId) || [];
    this.unread.set(agentId, []);
    // skip questions to me that were already answered (e.g. by my own reply turn)
    return ids.map((id) => this.find(id)).filter((m) => m && !(m.answered && m.to === agentId && m.kind !== 'reply'));
  }

  waitFor(map, key, ms) {
    return new Promise((resolve) => {
      if (ms <= 0) return resolve(null);
      let done = false;
      const fn = (v) => { if (done) return; done = true; clearTimeout(t); resolve(v ?? true); };
      const t = setTimeout(() => {
        done = true;
        const set = map.get(key);
        set?.delete(fn);
        if (set && !set.size) map.delete(key);
        resolve(null);
      }, ms);
      if (!map.has(key)) map.set(key, new Set());
      map.get(key).add(fn);
    });
  }

  replyTo(id) { return this.messages.find((m) => m.replyTo === id) || null; }

  // -- API used by the MCP bridge / shell helper (and the Demo engine) ----------
  async api(ctx, op, args = {}) {
    const me = this.state.agent(ctx.agentId);
    if (!me) throw new Error('You are no longer in the office.');
    const taskId = ctx.taskId ?? this.orch.current?.id ?? null;
    const wait = (s, max) => Math.max(0, Math.min(max, (Number(s) || 0) * 1000));

    switch (op) {
      case 'team':
        return { text: this.teamText(me) };

      case 'send': {
        let to;
        let kind = 'message';
        let replyTo = null;
        if (args.reply_to) {
          const orig = this.find(String(args.reply_to));
          if (!orig) throw new Error(`No message with id ${args.reply_to}.`);
          replyTo = orig.id;
          kind = 'reply';
          to = args.to ? this.resolve(args.to, me.id) : orig.from;
        } else {
          to = this.resolve(args.to, me.id);
        }
        const m = this.post({ from: me.id, to, text: args.message, kind, replyTo, taskId });
        return { id: m.id, text: `Sent to ${m.toName}.` };
      }

      case 'ask': {
        const to = this.resolve(args.to, me.id);
        if (to === 'everyone') throw new Error('Ask one person (a name, "leader" or "boss"). To tell everyone something, use send_message.');
        const m = this.post({ from: me.id, to, text: args.question, kind: 'question', taskId });
        const reply = await this.waitFor(this.replyWaiters, m.id, wait(args.wait_seconds ?? 50, MAX_POLL_MS));
        return { id: m.id, answer: reply ? { fromName: reply.fromName, text: reply.text } : null };
      }

      case 'await': {
        const id = String(args.id || '');
        const orig = this.find(id);
        if (!orig) throw new Error(`No question with id ${id}.`);
        const existing = this.replyTo(id);
        const reply = existing || await this.waitFor(this.replyWaiters, id, wait(args.wait_seconds, MAX_POLL_MS));
        return { id, answer: reply && reply !== true ? { fromName: reply.fromName, text: reply.text } : null };
      }

      case 'inbox': {
        let msgs = this.takeUnread(me.id);
        if (!msgs.length && args.wait_seconds) {
          await this.waitFor(this.inboxWaiters, me.id, wait(args.wait_seconds, MAX_POLL_MS));
          msgs = this.takeUnread(me.id);
        }
        return { messages: msgs.map(slim), text: inboxText(msgs) };
      }

      case 'status': {
        const text = truncate(String(args.text || '').trim(), 120);
        if (!text) throw new Error('Status text is empty.');
        const cur = this.orch.status[me.id] || { status: 'working' };
        this.orch.setStatus(me, cur.status, text);
        this.orch.log(me, 'say', `[status] ${text}`);
        return { text: 'Status updated.' };
      }

      default:
        throw new Error(`Unknown operation: ${op}`);
    }
  }

  /** HTTP entry point (POST /api/office). */
  async http(authHeader, body) {
    const token = String(authHeader || '').replace(/^Bearer\s+/i, '');
    const ctx = this.tokens.get(token);
    if (!ctx) { const e = new Error('This office pass is not valid any more (the run may have finished).'); e.status = 401; throw e; }
    return this.api(ctx, body?.op, body || {});
  }

  /** In-process API for the Demo engine. */
  bound(agentId, taskId) {
    return { call: (op, args) => this.api({ agentId, taskId }, op, args) };
  }

  teamText(me) {
    const st = this.state;
    const leader = st.leader;
    const task = this.orch.current;
    const lines = [
      `You are ${me.name} (${me.role || 'team member'}).${me.id === leader?.id ? ' You are the team leader.' : ` Your leader is ${leader?.name}.`} The boss is ${this.nameOf('boss')}.`,
    ];
    if (task) lines.push(`Current task from the boss: "${truncate(task.text.replace(/\s+/g, ' '), 300)}"`);
    lines.push('Team:');
    for (const a of st.config.agents) {
      const s = this.orch.status[a.id] || { status: 'idle' };
      const asg = task?.assignments?.find((x) => x.agentId === a.id);
      lines.push(`- ${a.name}${a.id === leader?.id ? ' ★ leader' : ''}${a.id === me.id ? ' (you)' : ''} — ${a.role || 'member'} — ${s.status}${s.activity ? `: ${truncate(s.activity, 80)}` : ''}`);
      if (asg) lines.push(`    assignment: ${truncate(asg.task.replace(/\s+/g, ' '), 200)}`);
    }
    return lines.join('\n');
  }

  snapshot() { return this.messages.slice(-200); }

  forTask(taskId) { return this.messages.filter((m) => m.taskId === taskId); }
}

function slim(m) {
  return { id: m.id, ts: m.ts, from: m.from, fromName: m.fromName, to: m.to, toName: m.toName, kind: m.kind, text: m.text, replyTo: m.replyTo };
}

function inboxText(msgs) {
  if (!msgs.length) return 'No new messages.';
  return `${msgs.length} new message${msgs.length === 1 ? '' : 's'}:\n` + msgs.map((m) => {
    const label = m.kind === 'question' ? 'question' : m.kind === 'reply' ? 'reply' : 'message';
    const hint = m.kind === 'question' || m.from === 'boss' ? `\n  ↳ answer with send_message(reply_to: "${m.id}", message: "…")` : '';
    return `[${m.id}] ${m.fromName} → ${m.to === 'everyone' ? 'everyone' : 'you'} (${label}): ${m.text}${hint}`;
  }).join('\n');
}
