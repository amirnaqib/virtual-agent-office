import fs from 'node:fs';
import path from 'node:path';
import { which, splitArgs, fill, truncate } from './util.js';

/**
 * Engine adapters. Each one turns (prompt, agent, phase) into a command line.
 *
 * phase: 'plan' | 'work' | 'compile'
 *   - plan / compile always run with the engine's read-only ("safe") settings,
 *     so a leader can never modify files while planning or writing the report.
 *   - work uses the agent's configured autonomy: 'safe' | 'edit' | 'full'.
 *
 * Flags for Antigravity (agy) and Hermes come from their public docs/cheat
 * sheets and can change between versions; anything missing can be supplied
 * per agent through "Extra args".
 */

export const ENGINES = {
  claude: {
    label: 'Claude Code',
    bin: 'claude',
    color: '#e8875b',
    modelHint: 'e.g. opus, sonnet, haiku',
    install: 'npm i -g @anthropic-ai/claude-code',
    autonomy: {
      safe: 'read-only (edits & shell are denied)',
      edit: '--permission-mode acceptEdits',
      full: '--dangerously-skip-permissions',
    },
    parser: 'claude-stream',
    build({ agent, autonomy, extra }) {
      const args = ['-p', '--output-format', 'stream-json', '--verbose'];
      if (agent.model) args.push('--model', agent.model);
      if (autonomy === 'edit') args.push('--permission-mode', 'acceptEdits');
      if (autonomy === 'full') args.push('--dangerously-skip-permissions');
      args.push(...extra);
      return { args, stdin: true };
    },
  },

  codex: {
    label: 'OpenAI Codex',
    bin: 'codex',
    color: '#9fd8ff',
    modelHint: 'e.g. gpt-5-codex',
    install: 'npm i -g @openai/codex',
    autonomy: {
      safe: '--sandbox read-only',
      edit: '--full-auto (workspace-write sandbox)',
      full: '--dangerously-bypass-approvals-and-sandbox',
    },
    parser: 'text',
    build({ agent, autonomy, extra, tmpFile }) {
      const args = ['exec', '--skip-git-repo-check'];
      if (agent.model) args.push('-m', agent.model);
      if (autonomy === 'safe') args.push('--sandbox', 'read-only');
      if (autonomy === 'edit') args.push('--full-auto');
      if (autonomy === 'full') args.push('--dangerously-bypass-approvals-and-sandbox');
      const outFile = tmpFile('codex-last.txt');
      args.push('--output-last-message', outFile, ...extra, '-');
      return { args, stdin: true, outFile };
    },
  },

  antigravity: {
    label: 'Antigravity CLI',
    bin: 'agy',
    color: '#b18cff',
    modelHint: 'e.g. gemini-3-pro (see agy --help)',
    install: 'Install Antigravity, then sign in once by running `agy` interactively',
    autonomy: {
      safe: 'default (tools needing approval are denied in print mode)',
      edit: '--mode accept-edits',
      full: '--dangerously-skip-permissions',
    },
    parser: 'text',
    build({ agent, autonomy, extra, prompt }) {
      const args = [];
      if (agent.model) args.push('--model', agent.model);
      if (autonomy === 'edit') args.push('--mode', 'accept-edits');
      if (autonomy === 'full') args.push('--dangerously-skip-permissions');
      args.push(...extra, '-p', prompt);
      return { args, stdin: false };
    },
  },

  gemini: {
    label: 'Gemini CLI',
    bin: 'gemini',
    color: '#6fa8ff',
    modelHint: 'e.g. gemini-2.5-pro',
    install: 'npm i -g @google/gemini-cli',
    autonomy: {
      safe: 'default approval mode',
      edit: '--approval-mode auto_edit',
      full: '--yolo',
    },
    parser: 'text',
    build({ agent, autonomy, extra, prompt }) {
      const args = [];
      if (agent.model) args.push('-m', agent.model);
      if (autonomy === 'edit') args.push('--approval-mode', 'auto_edit');
      if (autonomy === 'full') args.push('--yolo');
      args.push(...extra, '-p', prompt);
      return { args, stdin: false };
    },
  },

  hermes: {
    label: 'Hermes Agent',
    bin: 'hermes',
    color: '#ffd166',
    modelHint: 'e.g. anthropic/claude-sonnet-4',
    install: 'See github.com/NousResearch/hermes-agent',
    autonomy: {
      safe: 'default (dangerous commands need approval)',
      edit: 'default',
      full: '--yolo',
    },
    parser: 'text',
    build({ agent, autonomy, extra, prompt }) {
      const args = ['chat', '-Q'];
      if (agent.model) args.push('-m', agent.model);
      if (autonomy === 'full') args.push('--yolo');
      args.push(...extra, '-q', prompt);
      return { args, stdin: false };
    },
  },

  custom: {
    label: 'Custom CLI',
    bin: null,
    color: '#7ee0a1',
    modelHint: 'available as {model} in the template',
    install: 'Any command. Use {prompt}, {model}, {workspace} placeholders. Without {prompt} the prompt is sent on stdin.',
    autonomy: { safe: 'up to your command', edit: 'up to your command', full: 'up to your command' },
    parser: 'text',
    build({ agent, extra, prompt, workspace }) {
      const tpl = (agent.customCommand || '').trim();
      if (!tpl) throw new Error('Custom engine needs a command template, e.g. `aider --yes-always --message {prompt}`');
      const tokens = splitArgs(tpl);
      const usesPrompt = tokens.some((t) => t.includes('{prompt}'));
      const vars = { prompt, model: agent.model || '', workspace };
      const [cmd, ...rest] = tokens.map((t) => fill(t, vars));
      return { cmd, args: [...rest, ...extra], stdin: !usesPrompt };
    },
  },

  mock: {
    label: 'Demo (simulated)',
    bin: null,
    color: '#ff8fb8',
    modelHint: 'not used',
    install: 'Built in. Simulates work so you can try the office without any CLI.',
    autonomy: { safe: 'simulated', edit: 'simulated', full: 'simulated' },
    parser: 'mock',
    build() { return { mock: true }; },
  },
};

export function engineCommand(engineId, agent) {
  if (engineId === 'custom') {
    const tpl = (agent?.customCommand || '').trim();
    return tpl ? splitArgs(tpl)[0] : null;
  }
  return ENGINES[engineId]?.bin ?? null;
}

/** Which engines are installed on this machine. */
export function detectEngines() {
  const out = {};
  for (const [id, e] of Object.entries(ENGINES)) {
    const found = e.bin ? which(e.bin) : null;
    out[id] = {
      id,
      label: e.label,
      bin: e.bin,
      color: e.color,
      modelHint: e.modelHint,
      install: e.install,
      autonomy: e.autonomy,
      installed: id === 'mock' || id === 'custom' ? true : Boolean(found),
      path: found,
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Output parsers
// ---------------------------------------------------------------------------

function describeTool(name, input = {}) {
  const base = (p) => (p ? path.basename(String(p)) : '');
  const detail =
    base(input.file_path || input.path || input.notebook_path) ||
    (input.command && truncate(String(input.command).split('\n')[0], 60)) ||
    (input.pattern && `"${truncate(input.pattern, 40)}"`) ||
    (input.url && truncate(input.url, 60)) ||
    (input.description && truncate(input.description, 60)) ||
    '';
  return detail ? `${name} ${detail}` : name;
}

export function createParser(kind) {
  if (kind === 'claude-stream') {
    let final = null;
    const texts = [];
    return {
      line(raw) {
        let ev;
        try { ev = JSON.parse(raw); } catch { return raw.trim() ? [{ kind: 'out', text: raw }] : []; }
        const out = [];
        if (ev.type === 'system' && ev.subtype === 'init') {
          out.push({ kind: 'sys', text: `session started${ev.model ? ` · ${ev.model}` : ''}` });
        } else if (ev.type === 'assistant') {
          for (const c of ev.message?.content || []) {
            if (c.type === 'text' && c.text?.trim()) { texts.push(c.text); out.push({ kind: 'say', text: c.text }); }
            if (c.type === 'tool_use') out.push({ kind: 'tool', text: describeTool(c.name, c.input) });
          }
        } else if (ev.type === 'result') {
          if (typeof ev.result === 'string') final = ev.result;
          if (ev.is_error) out.push({ kind: 'err', text: ev.result || ev.subtype || 'error' });
          const cost = ev.total_cost_usd ?? ev.cost_usd;
          out.push({ kind: 'sys', text: `finished${cost != null ? ` · $${Number(cost).toFixed(4)}` : ''}` });
        }
        return out;
      },
      finish() { return (final ?? texts.join('\n\n')).trim(); },
    };
  }
  // plain text
  return {
    line(raw) { return raw.trim() ? [{ kind: 'out', text: raw }] : []; },
    finish(stdout) { return stdout.trim(); },
  };
}

export function readOutFile(file) {
  if (!file) return null;
  try {
    const s = fs.readFileSync(file, 'utf8').trim();
    return s || null;
  } catch { return null; }
}
