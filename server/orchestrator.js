import fs from 'node:fs';
import path from 'node:path';
import { runAgent } from './runner.js';
import { planPrompt, workPrompt, compilePrompt, parsePlan, extractReport } from './prompts.js';
import { uid, delay, slugify, truncate } from './util.js';

const LOG_LIMIT = 400;

/**
 * The office workflow:
 *   boss desk → leader (brief) → leader plans → members work at their desks →
 *   members walk to the leader and report → leader compiles → leader delivers
 *   the report to the boss desk.
 * Visual hints ("fx") are broadcast so the browser can animate walks & papers.
 */
export class Orchestrator {
  constructor(state, emit) {
    this.state = state;
    this.emit = emit;
    this.queue = [];
    this.current = null;
    this.controller = null;
    this.status = {};
    this.logs = {};
  }

  // -- runtime status ------------------------------------------------------
  setStatus(agent, status, activity = '') {
    this.status[agent.id] = { status, activity: truncate(activity, 140), since: Date.now() };
    this.emit('agent:status', { id: agent.id, ...this.status[agent.id] });
  }

  log(agent, kind, text) {
    const entry = { kind, text: truncate(text, 2000), t: Date.now() };
    (this.logs[agent.id] ||= []).push(entry);
    if (this.logs[agent.id].length > LOG_LIMIT) this.logs[agent.id].splice(0, this.logs[agent.id].length - LOG_LIMIT);
    this.emit('agent:log', { id: agent.id, ...entry });
    if (kind === 'tool' || kind === 'say') {
      const cur = this.status[agent.id];
      if (cur) { cur.activity = truncate(text.split('\n')[0], 140); this.emit('agent:status', { id: agent.id, ...cur }); }
    }
  }

  fx(payload) { this.emit('fx', payload); }

  snapshot() {
    return { status: this.status, logs: this.logs, queue: this.queue.map(publicTask), current: this.current ? publicTask(this.current) : null };
  }

  // -- task lifecycle ------------------------------------------------------
  submit({ text, agentId }) {
    text = String(text || '').trim().slice(0, 20000);
    if (!text) throw new Error('Write a task for the team first.');
    const direct = Boolean(agentId);
    if (direct && !this.state.agent(agentId)) throw new Error('Unknown agent');
    if (!this.state.leader) throw new Error('Add an agent to the office first.');
    const task = {
      id: uid('t'),
      kind: direct ? 'direct' : 'team',
      text,
      targetId: direct ? agentId : null,
      createdAt: Date.now(),
      status: 'queued',
      stage: 'queued',
      assignments: [],
      final: null,
      read: false,
    };
    this.queue.push(task);
    this.pushTask(task);
    this.pump();
    return task;
  }

  cancel(id) {
    if (this.current?.id === id) { this.controller?.abort(); return; }
    const i = this.queue.findIndex((t) => t.id === id);
    if (i !== -1) {
      const [t] = this.queue.splice(i, 1);
      t.status = 'cancelled';
      t.stage = 'cancelled';
      this.pushTask(t);
    }
  }

  markRead(id) {
    const t = this.state.history.find((h) => h.id === id);
    if (t && !t.read) { t.read = true; this.state.saveHistory(); this.pushTask(t); }
  }

  pushTask(task) { this.emit('task', publicTask(task)); }

  async pump() {
    if (this.current || !this.queue.length) return;
    const task = this.queue.shift();
    this.current = task;
    this.controller = new AbortController();
    task.status = 'running';
    task.startedAt = Date.now();
    try {
      if (task.kind === 'direct') await this.runDirect(task);
      else await this.runTeam(task);
      if (this.controller.signal.aborted) throw new Error('Cancelled');
      task.status = 'done';
      task.stage = 'delivered';
    } catch (e) {
      const cancelled = this.controller.signal.aborted;
      task.status = cancelled ? 'cancelled' : 'failed';
      task.stage = task.status;
      task.error = cancelled ? 'Cancelled by the boss' : e.message;
      if (!task.final) task.final = `## ${cancelled ? 'Cancelled' : 'Task failed'}\n${task.error}`;
      for (const a of this.state.config.agents) {
        if (this.status[a.id]?.status !== 'idle') this.setStatus(a, 'idle');
        this.fx({ kind: 'walk', id: a.id, to: 'desk' });
      }
    } finally {
      task.finishedAt = Date.now();
      task.reportFile = this.saveReport(task);
      this.state.addHistory(publicTask(task));
      this.pushTask(task);
      this.current = null;
      this.controller = null;
      setTimeout(() => {
        for (const a of this.state.config.agents) {
          if (['done', 'error'].includes(this.status[a.id]?.status)) this.setStatus(a, 'idle');
        }
      }, 6000).unref?.();
      this.pump();
    }
  }

  /** Run an agent with logs/status wiring. */
  async run(agent, prompt, phase, mock) {
    const s = this.state.config.settings;
    const res = await runAgent({
      agent,
      prompt,
      phase,
      workspace: s.workspace,
      timeoutMs: s.timeoutMin * 60000,
      signal: this.controller.signal,
      onActivity: ({ kind, text }) => this.log(agent, kind, text),
      mock,
    });
    if (!res.ok && res.error) this.log(agent, 'err', res.error);
    if (this.controller.signal.aborted) throw new Error('Cancelled');
    return res;
  }

  walk(id, to) {
    this.fx({ kind: 'walk', id, to });
  }

  async pause(ms) {
    await delay(ms ?? this.state.config.settings.walkDelayMs, this.controller.signal);
    if (this.controller.signal.aborted) throw new Error('Cancelled');
  }

  async runTeam(task) {
    const { state } = this;
    const office = state.config;
    const leader = state.leader;
    const members = state.members;
    const workspace = office.settings.workspace;
    task.leaderId = leader.id;
    task.leaderName = leader.name;

    // 1. Brief: leader picks up the task from the boss desk.
    task.stage = 'briefing';
    this.pushTask(task);
    this.setStatus(leader, 'briefing', `Getting the brief from ${office.boss.name}`);
    this.walk(leader.id, 'boss');
    await this.pause();
    this.fx({ kind: 'paper', from: 'boss', to: leader.id });
    this.walk(leader.id, 'desk');
    await this.pause();

    // 2. Plan.
    task.stage = 'planning';
    this.pushTask(task);
    this.setStatus(leader, 'planning', 'Planning who does what');
    const planRes = await this.run(leader, planPrompt({ office, leader, members, task: task.text, workspace }), 'plan', {
      task: task.text, members,
    });
    const plan = parsePlan(planRes.ok ? planRes.text : '', { members, leader, task: task.text });
    if (plan.fallback) this.log(leader, 'err', planRes.ok ? 'Could not read a JSON plan from my output, so everyone takes the whole task from their role.' : 'Planning failed, so everyone takes the whole task from their role.');
    task.plan = { summary: plan.summary, fallback: plan.fallback };
    task.assignments = plan.assignments.map((a) => {
      const ag = state.agent(a.agentId);
      return { agentId: ag.id, name: ag.name, role: ag.role, engine: ag.engine, task: a.task, status: 'assigned' };
    });
    this.log(leader, 'say', `Plan: ${plan.summary || `${task.assignments.length} assignment(s)`}`);

    // 3. Hand out assignments.
    task.stage = 'working';
    this.pushTask(task);
    this.setStatus(leader, 'assigning', 'Handing out assignments');
    for (const a of task.assignments) {
      if (a.agentId !== leader.id) {
        this.fx({ kind: 'paper', from: leader.id, to: a.agentId });
        await this.pause(350);
      }
    }
    if (!task.assignments.some((a) => a.agentId === leader.id)) this.setStatus(leader, 'waiting', 'Waiting for reports');

    // 4. Everyone works in parallel, then reports to the leader.
    await Promise.all(task.assignments.map((a) => this.memberWork(task, a, leader)));

    // 5. Compile.
    task.stage = 'compiling';
    this.pushTask(task);
    this.setStatus(leader, 'compiling', 'Compiling the final report');
    const reports = task.assignments.map((a) => ({ name: a.name, role: a.role, task: a.task, ok: a.status === 'done', report: a.report || '', error: a.error || '' }));
    const compRes = await this.run(leader, compilePrompt({ office, leader, task: task.text, plan: task.plan, reports }), 'compile', {
      task: task.text, reports,
    });
    task.final = compRes.ok
      ? compRes.text
      : `## Summary\n${leader.name} could not compile the report (${compRes.error}). Raw team reports are below.\n\n${reports.map((r) => `### ${r.name}\n${r.ok ? r.report : `Failed: ${r.error}`}`).join('\n\n')}`;

    // 6. Deliver to the boss desk.
    task.stage = 'delivering';
    this.pushTask(task);
    this.setStatus(leader, 'delivering', `Delivering the report to ${office.boss.name}`);
    this.walk(leader.id, 'boss');
    await this.pause();
    this.fx({ kind: 'paper', from: leader.id, to: 'boss', inbox: true });
    this.walk(leader.id, 'desk');
    this.setStatus(leader, 'done', 'Report delivered');
  }

  async memberWork(task, a, leader) {
    const { state } = this;
    const office = state.config;
    const agent = state.agent(a.agentId);
    const teammates = task.assignments.filter((o) => o.agentId !== a.agentId).map((o) => ({ name: o.name, role: o.role, task: o.task }));
    a.status = 'working';
    this.pushTask(task);
    this.setStatus(agent, 'working', 'Reading the assignment');
    const res = await this.run(agent, workPrompt({ office, agent, leader, task: task.text, assignment: a.task, teammates, workspace: office.settings.workspace }), 'work', {
      assignment: a.task, leaderName: leader.name,
    });
    a.status = res.ok ? 'done' : 'failed';
    a.report = extractReport(res.text);
    a.error = res.ok ? undefined : res.error;
    a.durationMs = res.durationMs;
    this.pushTask(task);

    if (agent.id !== leader.id) {
      this.setStatus(agent, 'reporting', `Reporting to ${leader.name}`);
      this.walk(agent.id, 'leader');
      await this.pause();
      this.fx({ kind: 'paper', from: agent.id, to: leader.id, stack: true });
      this.walk(agent.id, 'desk');
      await this.pause(600);
    }
    this.setStatus(agent, res.ok ? 'done' : 'error', res.ok ? 'Finished' : truncate(res.error, 120));
    if (agent.id === leader.id) this.setStatus(agent, 'waiting', 'Waiting for reports');
  }

  async runDirect(task) {
    const { state } = this;
    const office = state.config;
    const agent = state.agent(task.targetId);
    if (!agent) throw new Error('That agent left the office.');
    task.leaderId = agent.id;
    task.leaderName = agent.name;
    task.assignments = [{ agentId: agent.id, name: agent.name, role: agent.role, engine: agent.engine, task: task.text, status: 'working' }];
    task.stage = 'working';
    this.pushTask(task);
    this.fx({ kind: 'paper', from: 'boss', to: agent.id });
    this.setStatus(agent, 'working', 'Reading the task');
    const res = await this.run(agent, workPrompt({ office, agent, leader: agent, task: task.text, assignment: task.text, teammates: [], workspace: office.settings.workspace, direct: true }), 'work', {
      assignment: task.text, leaderName: office.boss.name,
    });
    const a = task.assignments[0];
    a.status = res.ok ? 'done' : 'failed';
    a.report = extractReport(res.text);
    a.error = res.ok ? undefined : res.error;
    task.final = res.ok ? res.text : `## ${agent.name} could not finish\n${res.error}${res.text ? `\n\n${res.text}` : ''}`;
    task.stage = 'delivering';
    this.pushTask(task);
    this.setStatus(agent, 'delivering', `Bringing the result to ${office.boss.name}`);
    this.walk(agent.id, 'boss');
    await this.pause();
    this.fx({ kind: 'paper', from: agent.id, to: 'boss', inbox: true });
    this.walk(agent.id, 'desk');
    this.setStatus(agent, res.ok ? 'done' : 'error', res.ok ? 'Delivered' : truncate(res.error, 120));
  }

  saveReport(task) {
    const s = this.state.config.settings;
    if (!s.saveReports || !task.final) return null;
    try {
      const dir = path.join(s.workspace, '.agent-office', 'reports');
      fs.mkdirSync(dir, { recursive: true });
      const d = new Date(task.createdAt);
      const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
      const file = path.join(dir, `${stamp}-${slugify(task.text)}.md`);
      const team = task.assignments.map((a) => `### ${a.name} (${a.role || 'member'} · ${a.engine}) — ${a.status}\n**Assignment:** ${a.task}\n\n${a.report || a.error || ''}`).join('\n\n');
      const md = `# ${truncate(task.text.split('\n')[0], 120)}\n\n- Status: **${task.status}**\n- ${task.kind === 'team' ? `Leader: **${task.leaderName}**` : `Assigned directly to **${task.leaderName}**`}\n- Started: ${new Date(task.createdAt).toLocaleString()}\n\n## Task\n${task.text}\n\n---\n\n${task.final}\n\n---\n\n## Appendix: team reports\n${task.plan?.summary ? `_Plan: ${task.plan.summary}_\n\n` : ''}${team}\n`;
      fs.writeFileSync(file, md);
      return file;
    } catch (e) {
      console.warn('[vao] could not save report:', e.message);
      return null;
    }
  }
}

function publicTask(t) {
  const { ...copy } = t;
  return JSON.parse(JSON.stringify(copy));
}
