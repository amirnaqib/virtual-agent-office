import { ENGINES } from './engines.js';
import { truncate } from './util.js';

const engineLabel = (a) => ENGINES[a.engine]?.label || a.engine;

function identity(agent, office) {
  const lines = [`You are ${agent.name}, the ${agent.role || 'team member'} at "${office.officeName}", a virtual office of AI agents.`];
  if (agent.persona?.trim()) lines.push(`Your personality and working style: ${agent.persona.trim()}`);
  return lines.join('\n');
}

export function planPrompt({ office, leader, members, task, workspace }) {
  const roster = members.length
    ? members.map((m) => `- ${m.name} | role: ${m.role || 'generalist'} | engine: ${engineLabel(m)}${m.persona ? ` | style: ${truncate(m.persona, 120)}` : ''}`).join('\n')
    : '- (no other members — you will do the work yourself)';
  return `${identity(leader, office)}
You are the TEAM LEADER. Your boss, ${office.boss?.name || 'the Boss'}, just handed you this task:

"""
${task}
"""

Workspace directory (shared by everyone): ${workspace}

Your team:
${roster}

Break the task into focused, NON-overlapping assignments, at most one per person. Skip people who are not needed. You may assign work to yourself ("${leader.name}") as well.
Each assignment must be self-contained: the member cannot see this message, so include the goal, the files or folders they own, and what "done" means. Give different people different files to avoid edit conflicts.

Do NOT do the work and do NOT modify files in this step. You are only planning.
Reply with ONLY a JSON object (no prose, no code fence) in exactly this shape:
{"summary": "<one sentence plan>", "assignments": [{"agent": "<exact name>", "task": "<instructions>"}]}`;
}

export function workPrompt({ office, agent, leader, task, assignment, teammates, workspace, direct }) {
  const from = direct ? `Your boss, ${office.boss?.name || 'the Boss'}, assigned you this task directly` : `Your team leader ${leader.name} assigned you this task, which is part of the boss's request "${truncate(task, 300)}"`;
  const others = teammates.length
    ? `\nTeammates working in parallel (stay out of their area):\n${teammates.map((t) => `- ${t.name} (${t.role || 'member'}): ${truncate(t.task, 160)}`).join('\n')}\n`
    : '';
  return `${identity(agent, office)}
${from}:

"""
${assignment}
"""

Workspace directory: ${workspace}
${others}
Do the work now, inside the workspace. When you are finished, end your reply with a short report under a line that says exactly "REPORT:" covering what you did, which files you created or changed, and anything left open or risky.`;
}

export function compilePrompt({ office, leader, task, plan, reports }) {
  const body = reports
    .map((r) => `### ${r.name} (${r.role || 'member'}) — ${r.ok ? 'done' : 'FAILED'}\nAssignment: ${truncate(r.task, 600)}\n${r.ok ? `Report:\n${truncate(r.report, 4000)}` : `Error: ${truncate(r.error, 800)}${r.report ? `\nPartial output:\n${truncate(r.report, 1500)}` : ''}`}`)
    .join('\n\n');
  return `${identity(leader, office)}
You are the TEAM LEADER. Your boss, ${office.boss?.name || 'the Boss'}, asked for:

"""
${task}
"""

Your plan was: ${plan?.summary || '(no summary)'}

Reports from your team:

${body || '(no reports)'}

Write the final report for the boss in Markdown with these sections:
## Summary (2-3 sentences, the outcome first)
## What was done (one bullet per person, credit them by name)
## Deliverables / files changed
## Issues, risks & next steps

Be honest about anything that failed. Do NOT modify any files; only write the report.`;
}

/** Pull the leader's JSON plan out of free-form CLI output. */
export function parsePlan(text, { members, leader, task }) {
  const people = [leader, ...members];
  const byName = new Map(people.map((p) => [p.name.trim().toLowerCase(), p]));
  const candidates = [];
  const fence = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m;
  while ((m = fence.exec(text))) candidates.push(m[1]);
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));

  for (const c of candidates) {
    let obj;
    try { obj = JSON.parse(c.trim()); } catch { continue; }
    const list = Array.isArray(obj) ? obj : obj.assignments || obj.tasks || obj.plan;
    if (!Array.isArray(list)) continue;
    const seen = new Set();
    const assignments = [];
    for (const a of list) {
      const name = String(a.agent || a.name || a.member || a.assignee || '').trim().toLowerCase();
      const who = byName.get(name) || people.find((p) => p.id === a.agent);
      const t = String(a.task || a.instructions || a.work || '').trim();
      if (!who || !t || seen.has(who.id)) continue;
      seen.add(who.id);
      assignments.push({ agentId: who.id, task: t });
    }
    if (assignments.length) return { summary: String(obj.summary || '').trim(), assignments, fallback: false };
  }

  // Fallback: everyone gets the whole task, framed by their role.
  const pool = members.length ? members : [leader];
  return {
    summary: 'The leader did not return a valid plan, so everyone works on the task from their own role.',
    fallback: true,
    assignments: pool.map((p) => ({
      agentId: p.id,
      task: `${task}\n\nFocus only on the part that fits your role (${p.role || 'generalist'}). Coordinate through your report.`,
    })),
  };
}

/** The member's report = text after the last "REPORT:" marker, else the tail of the output. */
export function extractReport(text) {
  const s = String(text || '').trim();
  const idx = s.search(/REPORT:\s*(?![\s\S]*REPORT:)/i);
  if (idx !== -1) {
    const r = s.slice(idx).replace(/^REPORT:\s*/i, '').trim();
    if (r) return r;
  }
  return s.length > 3000 ? `…${s.slice(-3000)}` : s;
}
