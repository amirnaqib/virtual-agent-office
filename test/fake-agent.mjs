// A stand-in CLI for tests: reads the prompt from stdin and answers like an agent would.
import { execFileSync } from 'node:child_process';

let prompt = '';
process.stdin.on('data', (c) => { prompt += c; });
process.stdin.on('end', () => {
  const me = (prompt.match(/You are ([^,]+), the/) || [])[1] || 'agent';
  if (/Reply with ONLY a JSON object/.test(prompt)) {
    const names = [...prompt.matchAll(/^- ([^|]+) \| role/gm)].map((m) => m[1].trim());
    console.log('Thinking about the plan…');
    console.log(JSON.stringify({ summary: 'One job each.', assignments: names.map((n) => ({ agent: n, task: `Do part for ${n}` })) }));
  } else if (/Output only the reply text\./.test(prompt)) {
    // reply turn: someone messaged us while we were not running
    console.log(`Use port 8080 (${me})`);
  } else if (/Write the final report for the boss/.test(prompt)) {
    const chat = /Team chat during the work:/.test(prompt) ? '\nChat was included.' : '';
    console.log(`## Summary\nCompiled by ${me}.${chat}\n\n${(prompt.match(/### .+/g) || []).join('\n')}`);
  } else {
    console.log(`${me} is working`);
    console.error('some stderr noise');
    let extra = '';
    if (me === 'Danial' && process.env.VAO_BRIDGE && /ask <who> "question"/.test(prompt)) {
      // talk to the leader mid-work through the shell helper
      extra = execFileSync(process.execPath, [process.env.VAO_BRIDGE, 'ask', 'leader', 'Which port should the API use?', '30'], { encoding: 'utf8' }).trim();
      console.log(extra);
    }
    console.log(`Done.\nREPORT:\n- ${me} finished${extra ? `\n- ${extra.replace(/\n/g, ' ')}` : ''}`);
  }
});
