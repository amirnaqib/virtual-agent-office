// Demo engine: realistic-looking, clearly labelled simulated output so the
// office can be tried without any AI CLI installed.

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rand = (a, b) => a + Math.random() * (b - a);

const ROLE_WORK = [
  { re: /front|ui|ux|design|web|css/i, task: 'Design and build the user-facing side', steps: ['Sketching the layout', 'Picking a colour palette', 'Building components', 'Checking responsive breakpoints', 'Polishing hover states'] },
  { re: /back|api|server|data|db/i, task: 'Implement the backend / API pieces', steps: ['Modelling the data', 'Writing the endpoints', 'Adding validation', 'Handling error cases', 'Checking query performance'] },
  { re: /test|qa|quality|review/i, task: 'Write tests and review the result', steps: ['Listing edge cases', 'Writing unit tests', 'Running the suite', 'Reviewing the diff', 'Filing follow-ups'] },
  { re: /doc|writ|content|copy/i, task: 'Write the documentation and copy', steps: ['Outlining the docs', 'Writing the quick start', 'Adding examples', 'Proof-reading', 'Formatting headings'] },
  { re: /research|analy|data sci/i, task: 'Research options and best practices', steps: ['Collecting sources', 'Comparing approaches', 'Summarising trade-offs', 'Drafting a recommendation'] },
  { re: /devops|infra|ops|deploy/i, task: 'Prepare build, CI and deployment', steps: ['Reading the build config', 'Writing the CI workflow', 'Adding a Dockerfile', 'Checking env variables'] },
];

function roleInfo(role) {
  return ROLE_WORK.find((r) => r.re.test(role || '')) || {
    task: `Handle the ${role || 'general'} part`,
    steps: ['Reading the brief', 'Breaking it into steps', 'Working through the list', 'Double-checking the result'],
  };
}

export function mockOutput({ agent, phase, task = '', members = [], reports = [], assignment = '', leaderName = 'the leader' }) {
  if (phase === 'plan') {
    const people = members.length ? members : [agent];
    const assignments = people.map((m) => ({
      agent: m.name,
      task: `${roleInfo(m.role).task} for: "${task}". Keep to your own area and report back what you produced.`,
    }));
    const plan = { summary: `Split the request into ${assignments.length || 1} parallel workstream${assignments.length === 1 ? '' : 's'}.`, assignments };
    return {
      durationMs: rand(3500, 5500),
      lines: [
        { kind: 'say', text: 'Reading the brief from the boss…' },
        { kind: 'tool', text: 'Read workspace overview' },
        { kind: 'say', text: `Matching the work to ${members.length} teammate${members.length === 1 ? '' : 's'}…` },
        { kind: 'say', text: 'Writing the assignment list' },
      ],
      text: JSON.stringify(plan),
    };
  }

  if (phase === 'compile') {
    const body = reports.map((r) => `### ${r.name} · ${r.role || 'Member'}\n${r.ok ? r.report : `⚠️ Did not finish: ${r.error}`}`).join('\n\n');
    return {
      durationMs: rand(3500, 5500),
      lines: [
        { kind: 'say', text: `Collecting ${reports.length} report${reports.length === 1 ? '' : 's'}…` },
        { kind: 'say', text: 'Cross-checking for gaps' },
        { kind: 'say', text: 'Writing the summary for the boss' },
      ],
      text: `## Summary\nThe team worked through **"${task}"** in parallel and every workstream reported back.\n\n## What the team did\n${body || '_No team members were assigned._'}\n\n## Next steps\n- This was a **simulated run** (Demo engine), so no files were changed.\n- Open **Team**, switch each agent to a real CLI (Claude Code, Codex, Antigravity, Gemini, Hermes or a custom command) and send the task again.`,
    };
  }

  // work
  const info = roleInfo(agent.role);
  const steps = [...info.steps];
  const lines = [{ kind: 'say', text: `Got it, ${leaderName}. Starting now.` }];
  for (const s of steps) {
    lines.push({ kind: 'say', text: `${s}…` });
    if (Math.random() < 0.6) lines.push({ kind: 'tool', text: pick(['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash']) + ' ' + pick(['src/index.js', 'README.md', 'package.json', 'src/app.css', 'tests/app.test.js', 'docs/notes.md']) + ' (simulated)' });
  }
  lines.push({ kind: 'say', text: 'Wrapping up my report.' });
  const short = String(assignment).replace(/\s+/g, ' ').replace(/\s*Keep to your own area.*$/, '').slice(0, 160);
  return {
    durationMs: rand(6000, 13000),
    lines,
    text: `Working on it.\n\nREPORT:\n- Took on: ${short}.\n- Steps: ${steps.join(' → ')}.\n- Result: draft ready for review (simulated, no files changed).\n- Open question: confirm scope with the boss before the real run.`,
  };
}
