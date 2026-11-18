#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { startServer, defaultHome } from '../server/index.js';

const HELP = `
  virtual-agent-office — a pixel office where your AI CLIs work as a team

  Usage
    npx virtual-agent-office [options]

  Options
    -w, --workspace <dir>   Folder the agents work in (default: current folder)
    -p, --port <n>          Port (default: 4317)
        --host <addr>       Bind address (default: 127.0.0.1 — keep it local!)
        --home <dir>        Where the office, team & history are stored
                            (default: ${defaultHome()})
        --assets <dir>      Custom pixel asset pack folder (default: <home>/assets)
        --demo              New offices use the simulated Demo engine for everyone
        --no-open           Don't open the browser
    -h, --help              Show this help
`;

function parse(argv) {
  const o = { open: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) { console.error(`Missing value for ${a}`); process.exit(1); }
      return v;
    };
    if (a === '-h' || a === '--help') { console.log(HELP); process.exit(0); }
    else if (a === '-w' || a === '--workspace') o.workspace = next();
    else if (a === '-p' || a === '--port') o.port = Number(next());
    else if (a === '--host') o.host = next();
    else if (a === '--home') o.home = next();
    else if (a === '--assets') o.assets = next();
    else if (a === '--demo') o.demo = true;
    else if (a === '--no-open') o.open = false;
    else { console.error(`Unknown option: ${a}\n${HELP}`); process.exit(1); }
  }
  return o;
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* headless */ }
}

const opts = parse(process.argv.slice(2));
try {
  const { url, state } = await startServer(opts);
  const eng = Object.values(state.engines).filter((e) => e.bin);
  console.log(`\n  🏢  Virtual Agent Office is open at ${url}\n`);
  console.log(`  Workspace : ${state.config.settings.workspace}`);
  console.log(`  Office    : ${state.file}`);
  console.log(`  Engines   : ${eng.map((e) => `${e.installed ? '✓' : '·'} ${e.label}`).join('   ')}`);
  if (opts.host && !['127.0.0.1', 'localhost', '::1'].includes(opts.host)) {
    console.log('\n  ⚠  Listening beyond localhost: anyone who can reach this port can make your agents run commands.');
  }
  console.log('\n  Press Ctrl+C to close the office.\n');
  if (opts.open) openBrowser(url);
} catch (e) {
  if (e.code === 'EADDRINUSE') console.error(`Port ${opts.port ?? 4317} is busy. Try --port 4318`);
  else console.error(e);
  process.exit(1);
}
