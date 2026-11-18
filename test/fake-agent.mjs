// A stand-in CLI for tests: reads the prompt from stdin and answers like an agent would.
let prompt = '';
process.stdin.on('data', (c) => { prompt += c; });
process.stdin.on('end', () => {
  const me = (prompt.match(/You are ([^,]+), the/) || [])[1] || 'agent';
  if (/Reply with ONLY a JSON object/.test(prompt)) {
    const names = [...prompt.matchAll(/^- ([^|]+) \| role/gm)].map((m) => m[1].trim());
    console.log('Thinking about the plan…');
    console.log(JSON.stringify({ summary: 'One job each.', assignments: names.map((n) => ({ agent: n, task: `Do part for ${n}` })) }));
  } else if (/Write the final report for the boss/.test(prompt)) {
    console.log(`## Summary\nCompiled by ${me}.\n\n${(prompt.match(/### .+/g) || []).join('\n')}`);
  } else {
    console.log(`${me} is working`);
    console.error('some stderr noise');
    console.log(`Done.\nREPORT:\n- ${me} finished`);
  }
});
