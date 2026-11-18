import { Scene } from './scene.js';
import { loadAssetPack, hasPack } from './assets.js';
import { characterFrame } from './sprites.js';
import { renderMarkdown } from './md.js';
import { createBuilder } from './builder.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STEPS = ['briefing', 'planning', 'working', 'compiling', 'delivering'];
const STEP_LABEL = { briefing: 'Brief', planning: 'Plan', working: 'Work', compiling: 'Compile', delivering: 'Deliver' };
const BUSY = new Set(['planning', 'working', 'compiling', 'assigning']);

const S = {
  config: null, engines: {}, status: {}, logs: {}, tasks: new Map(), feed: [],
  tab: 'boss', selected: null, home: '', assetsDir: '', connected: false, demo: false,
};

// ---------------------------------------------------------------------------
// Networking
// ---------------------------------------------------------------------------
let ws;
let seq = 0;
const pending = new Map();

function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onopen = () => { setConn(true); ws.send(JSON.stringify({ type: 'hello' })); };
  ws.onclose = () => { setConn(false); for (const p of pending.values()) p.reject(new Error('Disconnected')); pending.clear(); setTimeout(connect, 1500); };
  ws.onmessage = (e) => { try { handle(JSON.parse(e.data)); } catch (err) { console.error(err); } };
}

function request(type, payload = {}) {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== 1) return reject(new Error('Not connected to the office server.'));
    const reqId = ++seq;
    pending.set(reqId, { resolve, reject });
    ws.send(JSON.stringify({ type, reqId, ...payload }));
  });
}

async function act(type, payload, okMsg) {
  try {
    const r = await request(type, payload);
    if (okMsg) toast(okMsg, 'good');
    return r || true;
  } catch (e) {
    toast(e.message, 'error');
    return false;
  }
}

function setConn(on) {
  S.connected = on;
  $('#conn').classList.toggle('on', on);
  $('#conn').title = on ? 'Connected to the office server' : 'Disconnected — retrying…';
}

function handle(m) {
  if (m.reqId && pending.has(m.reqId)) {
    const p = pending.get(m.reqId);
    pending.delete(m.reqId);
    if (m.type === 'error') p.reject(new Error(m.message)); else p.resolve(m);
    if (m.type === 'error' || m.type === 'ok') return;
  } else if (m.type === 'error') { toast(m.message, 'error'); return; }

  switch (m.type) {
    case 'snapshot': {
      S.config = m.config; S.engines = m.engines; S.home = m.home; S.assetsDir = m.assetsDir; S.demo = m.demo; S.userHome = m.userHome;
      S.status = m.runtime.status || {}; S.logs = m.runtime.logs || {};
      S.tasks = new Map();
      for (const t of m.history || []) S.tasks.set(t.id, t);
      for (const t of m.runtime.queue || []) S.tasks.set(t.id, t);
      if (m.runtime.current) S.tasks.set(m.runtime.current.id, m.runtime.current);
      S.feed = [];
      for (const [id, list] of Object.entries(S.logs)) for (const l of list) S.feed.push({ id, ...l });
      S.feed.sort((a, b) => a.t - b.t);
      scene.sync(S.config, S.engines);
      for (const [id, st] of Object.entries(S.status)) scene.setStatus(id, st);
      renderAll();
      break;
    }
    case 'config':
      S.config = m.config;
      scene.sync(S.config, S.engines);
      renderAll();
      break;
    case 'engines':
      S.engines = m.engines;
      scene.sync(S.config, S.engines);
      renderEngineTable();
      renderTeam();
      break;
    case 'agent:status':
      S.status[m.id] = { status: m.status, activity: m.activity, since: m.since };
      scene.setStatus(m.id, m);
      scheduleRender();
      break;
    case 'agent:log': {
      const entry = { id: m.id, kind: m.kind, text: m.text, t: m.t };
      (S.logs[m.id] ||= []).push(entry);
      if (S.logs[m.id].length > 400) S.logs[m.id].shift();
      S.feed.push(entry);
      if (S.feed.length > 1500) S.feed.splice(0, 300);
      if (S.tab === 'agent' && S.selected === m.id) appendLine($('#agentTerm'), entry, false);
      if (S.tab === 'log') appendFeed(entry);
      break;
    }
    case 'fx':
      scene.fx(m);
      break;
    case 'task': {
      const prev = S.tasks.get(m.id);
      S.tasks.set(m.id, m);
      if (prev && prev.status === 'running' && ['done', 'failed'].includes(m.status)) {
        toast(`📥 ${m.leaderName || 'The team'} delivered a report${m.status === 'failed' ? ' (with problems)' : ''}.`, m.status === 'done' ? 'good' : 'error');
      }
      scheduleRender();
      break;
    }
    case 'history':
      for (const [id, t] of S.tasks) if (!['running', 'queued'].includes(t.status)) S.tasks.delete(id);
      for (const t of m.history) S.tasks.set(t.id, t);
      renderAll();
      break;
    default:
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const avatarCache = new Map();
function avatar(look, cls = '') {
  if (!look) return '';
  const key = JSON.stringify(look);
  let url = avatarCache.get(key);
  if (!url) {
    const c = document.createElement('canvas');
    c.width = 18; c.height = 26;
    c.getContext('2d').drawImage(characterFrame(look, 'down', 'stand', 0), 0, 0);
    url = c.toDataURL();
    avatarCache.set(key, url);
  }
  return `<img class="avatar ${cls}" src="${url}" alt="">`;
}

const agentById = (id) => S.config?.agents.find((a) => a.id === id);
const isLeader = (id) => S.config?.leaderId === id;
const engineLabel = (id) => S.engines[id]?.label || id;
const fmtTime = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtDate = (t) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const dur = (ms) => (ms < 60000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`);

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), kind === 'error' ? 7000 : 4000);
}

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderTaskNow(); renderInbox(); renderTeam(); if (S.tab === 'agent') renderAgentHead();
  });
}

function renderAll() {
  if (!S.config) return;
  $('#officeTitle').textContent = S.config.officeName;
  document.title = S.config.officeName;
  const ws = S.config.settings.workspace;
  $('#wsPath').textContent = S.userHome && ws.startsWith(S.userHome) ? `~${ws.slice(S.userHome.length)}` : ws;
  $('#wsPath').parentElement.title = `Workspace: ${ws}`;
  $('#brandAvatar').src = (avatar(S.config.boss.look).match(/src="([^"]+)"/) || [])[1] || '';
  $('#demoPill').hidden = !S.config.agents.some((a) => a.engine === 'mock');
  renderTarget(); renderTaskNow(); renderInbox(); renderTeam(); renderLogFilter();
  if (S.tab === 'agent') renderAgentPanel();
  if (S.tab === 'log') renderFeed();
}

// ---------------------------------------------------------------------------
// Boss desk
// ---------------------------------------------------------------------------
function renderTarget() {
  const sel = $('#taskTarget');
  const cur = sel.value;
  const leader = agentById(S.config.leaderId);
  sel.innerHTML = `<option value="">★ Whole team (via ${esc(leader?.name || 'leader')})</option>`
    + S.config.agents.map((a) => `<option value="${a.id}">→ ${esc(a.name)} only</option>`).join('');
  if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
}

async function sendTask(text, agentId) {
  text = text.trim();
  if (!text) { toast('Write a task first.', 'error'); return false; }
  const ok = await act('task:submit', { text, agentId: agentId || undefined });
  if (ok) {
    const busy = [...S.tasks.values()].some((t) => t.status === 'running' && t.id !== ok.id);
    toast(busy ? 'Queued — the team will start after the current task.' : agentId ? `Sent to ${agentById(agentId)?.name}.` : `Sent to ${agentById(S.config.leaderId)?.name}.`, 'good');
  }
  return ok;
}

function renderTaskNow() {
  const tasks = [...S.tasks.values()];
  const cur = tasks.find((t) => t.status === 'running');
  const queued = tasks.filter((t) => t.status === 'queued');
  const box = $('#taskNow');
  if (!cur && !queued.length) { box.innerHTML = ''; return; }
  let html = '';
  if (cur) {
    const steps = cur.kind === 'direct' ? ['working', 'delivering'] : STEPS;
    const idx = steps.indexOf(cur.stage);
    html += `<div class="card">
      <div class="section-head"><span class="card-title">In progress</span><button class="link" data-cancel="${cur.id}">cancel</button></div>
      <div><b>${esc(cur.text.split('\n')[0].slice(0, 160))}</b></div>
      <div class="steps">${steps.map((s, i) => `<div class="step ${i < idx ? 'done' : i === idx ? 'active' : ''}">${STEP_LABEL[s]}</div>`).join('')}</div>
      ${cur.plan?.summary ? `<div class="tiny muted">Plan: ${esc(cur.plan.summary)}</div>` : ''}
      ${(cur.assignments || []).map((a) => {
        const ag = agentById(a.agentId);
        const live = S.status[a.agentId];
        const st = a.status === 'working' && live ? live.status : a.status;
        return `<div class="assign" data-agent="${a.agentId}">${avatar(ag?.look, 'xs')}<div class="body"><div class="who">${esc(a.name)}</div><div class="what">${esc(a.status === 'working' && live?.activity ? live.activity : a.task)}</div></div><span class="chip ${st}">${esc(st)}</span></div>`;
      }).join('')}
    </div>`;
  }
  if (queued.length) html += `<div class="queue-note">+ ${queued.length} queued: ${queued.map((q) => `<span title="${esc(q.text)}">“${esc(q.text.slice(0, 40))}”</span> <button class="link" data-cancel="${q.id}">✕</button>`).join(', ')}</div>`;
  box.innerHTML = html;
}

function finishedTasks() {
  return [...S.tasks.values()].filter((t) => ['done', 'failed', 'cancelled'].includes(t.status)).sort((a, b) => b.createdAt - a.createdAt);
}

function renderInbox() {
  const list = finishedTasks();
  const unread = list.filter((t) => !t.read && t.status !== 'cancelled').length;
  scene.setUnread(unread);
  const badge = $('#inboxBadge');
  badge.hidden = !unread;
  badge.textContent = unread;
  $('#inbox').innerHTML = list.length
    ? list.map((t) => `<button class="mail ${t.read || t.status === 'cancelled' ? '' : 'unread'}" data-report="${t.id}">
        <span class="dot ${t.read || t.status === 'cancelled' ? 'read' : ''}"></span>
        <span style="flex:1;min-width:0"><span class="t">${esc(t.text.split('\n')[0])}</span>
        <span class="m">${t.status === 'done' ? '✓' : t.status === 'failed' ? '⚠' : '✕'} ${esc(t.leaderName || '')} · ${fmtDate(t.createdAt)}${t.finishedAt ? ` · ${dur(t.finishedAt - (t.startedAt || t.createdAt))}` : ''}</span></span>
      </button>`).join('')
    : '<div class="empty">No reports yet. Send the team a task ↑</div>';
}

function openReport(id) {
  const t = S.tasks.get(id);
  if (!t) return;
  $('#reportTitle').textContent = t.text.split('\n')[0].slice(0, 80);
  $('#reportMeta').textContent = `${t.status.toUpperCase()} · ${t.kind === 'team' ? `Leader: ${t.leaderName}` : `Direct to ${t.leaderName}`} · ${fmtDate(t.createdAt)}${t.finishedAt ? ` · took ${dur(t.finishedAt - (t.startedAt || t.createdAt))}` : ''}`;
  $('#reportBody').innerHTML = renderMarkdown(t.final || '_No report._');
  const team = (t.assignments || []).filter((a) => t.kind === 'team' || a.report);
  $('#reportTeamWrap').hidden = !team.length || t.kind === 'direct';
  $('#reportTeam').innerHTML = team.map((a) => `<h4>${esc(a.name)} <span class="muted tiny">${esc(a.role || '')} · ${esc(engineLabel(a.engine))} · ${esc(a.status)}${a.durationMs ? ` · ${dur(a.durationMs)}` : ''}</span></h4>
    <div class="tiny muted">Assignment: ${esc(a.task)}</div><div class="md">${renderMarkdown(a.report || a.error || '')}</div>`).join('');
  $('#reportFile').textContent = t.reportFile ? `Saved: ${t.reportFile}` : '';
  $('#btnCopyReport').onclick = () => navigator.clipboard?.writeText(t.final || '').then(() => toast('Copied.', 'good'), () => toast('Copy failed.', 'error'));
  $('#dlgReport').showModal();
  if (!t.read) { t.read = true; request('report:read', { id }).catch(() => {}); renderInbox(); }
}

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------
function renderTeam() {
  if (!S.config) return;
  const agents = [...S.config.agents].sort((a, b) => (isLeader(b.id) - isLeader(a.id)));
  $('#teamList').innerHTML = agents.map((a) => {
    const e = S.engines[a.engine] || {};
    const st = S.status[a.id]?.status || 'idle';
    const missing = !e.installed;
    return `<div class="member ${isLeader(a.id) ? 'leader' : ''}">
      ${avatar(a.look)}
      <div class="info">
        <div class="name">${isLeader(a.id) ? '<span class="crown" title="Team leader">★</span>' : ''}${esc(a.name)} <span class="chip ${st}">${esc(st)}</span></div>
        <div class="sub">${esc(a.role || 'Team member')}</div>
        <div class="eng ${missing ? 'missing' : ''}"><i style="background:${e.color || '#888'}"></i>${esc(e.label || a.engine)}${a.model ? ` · ${esc(a.model)}` : ''}${missing ? ' — not installed' : ''}</div>
      </div>
      <div class="acts">
        <button class="btn sm" data-edit="${a.id}">✎ Edit</button>
        ${isLeader(a.id) ? '' : `<button class="btn sm" data-lead="${a.id}" title="Make team leader">★ Lead</button>`}
        <button class="btn sm" data-open="${a.id}">Watch</button>
      </div>
    </div>`;
  }).join('');
}

// ---------------------------------------------------------------------------
// Agent detail
// ---------------------------------------------------------------------------
function renderAgentHead() {
  const a = agentById(S.selected);
  if (!a) return;
  const st = S.status[a.id] || { status: 'idle' };
  const e = S.engines[a.engine] || {};
  $('#agentHead').innerHTML = `${avatar(a.look, 'lg')}<div style="min-width:0">
    <h3>${isLeader(a.id) ? '★ ' : ''}${esc(a.name)}</h3>
    <div class="muted">${esc(a.role || 'Team member')}</div>
    <div class="eng"><i style="background:${e.color || '#888'}"></i>${esc(e.label || a.engine)}${a.model ? ` · ${esc(a.model)}` : ''} · ${esc(a.autonomy)}</div>
    <div class="act"><span class="chip ${st.status}">${esc(st.status)}</span> ${esc(st.activity || '')}</div>
  </div>`;
}

function renderAgentPanel() {
  const a = agentById(S.selected);
  if (!a) { switchTab('team'); return; }
  renderAgentHead();
  $('#agentActions').innerHTML = `<button class="btn sm" data-edit="${a.id}">✎ Edit character</button>
    ${isLeader(a.id) ? '' : `<button class="btn sm" data-lead="${a.id}">★ Make leader</button>`}
    <button class="btn sm" id="btnDirectToggle">→ Direct task</button>`;
  const term = $('#agentTerm');
  term.innerHTML = '';
  const logs = S.logs[a.id] || [];
  if (!logs.length) term.innerHTML = '<div class="l sys">No output yet. When this agent works, its CLI output streams here.</div>';
  for (const l of logs) appendLine(term, l, false, true);
  term.scrollTop = term.scrollHeight;
}

function appendLine(box, l, withName, noScroll) {
  if (!box) return;
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  if (box.firstElementChild?.textContent.startsWith('No output yet')) box.innerHTML = '';
  const div = document.createElement('div');
  div.className = `l ${l.kind}`;
  const prefix = l.kind === 'tool' ? '› ' : l.kind === 'err' ? '! ' : '';
  div.innerHTML = `${withName ? `<span class="ts">${fmtTime(l.t)}</span> <span class="who" style="color:${S.engines[agentById(l.id)?.engine]?.color || '#fff'}">${esc(agentById(l.id)?.name || '?')}</span> ` : ''}${esc(prefix + l.text)}`;
  box.appendChild(div);
  while (box.childElementCount > 500) box.firstElementChild.remove();
  if (!noScroll && nearBottom) box.scrollTop = box.scrollHeight;
}

// ---------------------------------------------------------------------------
// Activity feed
// ---------------------------------------------------------------------------
function renderLogFilter() {
  const sel = $('#logFilter');
  const cur = sel.value;
  sel.innerHTML = '<option value="">Everyone</option>' + S.config.agents.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('');
  sel.value = [...sel.options].some((o) => o.value === cur) ? cur : '';
}
const feedVisible = (l) => (!$('#logFilter').value || l.id === $('#logFilter').value) && ($('#logVerbose').checked || ['say', 'tool', 'err'].includes(l.kind));
function renderFeed() {
  const box = $('#logFeed');
  box.innerHTML = '';
  const rows = S.feed.filter(feedVisible).slice(-400);
  if (!rows.length) box.innerHTML = '<div class="l sys">Quiet office. Activity from every agent shows up here.</div>';
  for (const l of rows) appendLine(box, l, true, true);
  box.scrollTop = box.scrollHeight;
}
function appendFeed(l) {
  if (feedVisible(l)) {
    const box = $('#logFeed');
    if (box.firstElementChild?.textContent.startsWith('Quiet office')) box.innerHTML = '';
    appendLine(box, l, true);
  }
}

// ---------------------------------------------------------------------------
// Tabs & selection
// ---------------------------------------------------------------------------
function switchTab(tab) {
  S.tab = tab;
  for (const b of document.querySelectorAll('.tab')) b.classList.toggle('active', b.dataset.tab === tab);
  for (const p of ['boss', 'team', 'log', 'agent']) $(`#panel-${p}`).hidden = p !== tab;
  if (tab !== 'agent') { S.selected = null; scene.select(null); }
  if (tab === 'log') renderFeed();
}

function openAgent(id) {
  S.selected = id;
  scene.select(id);
  switchTab('agent');
  S.selected = id;
  scene.select(id);
  $('#directBox').hidden = true;
  renderAgentPanel();
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
function renderEngineTable() {
  const order = ['claude', 'codex', 'antigravity', 'gemini', 'hermes', 'custom', 'mock'];
  $('#engineTable').innerHTML = order.filter((id) => S.engines[id]).map((id) => {
    const e = S.engines[id];
    const builtin = id === 'custom' || id === 'mock';
    return `<div class="engine-row"><span class="${e.installed ? 'ok' : 'no'}">${e.installed ? '✓' : '·'}</span>
      <span><b style="color:${e.color}">${esc(e.label)}</b>${e.bin ? `<br><code>${esc(e.bin)}</code>` : ''}</span>
      <span class="muted">${builtin ? esc(e.install) : e.installed ? esc(e.path) : `Not found. ${esc(e.install)}`}</span></div>`;
  }).join('');
  $('#pathsInfo').innerHTML = `Office data: <code>${esc(S.home)}</code><br>Asset pack folder: <code>${esc(S.assetsDir)}</code> ${hasPack() ? '— <b>pack loaded ✓</b>' : '— none (using built-in pixel art)'}`;
}

function openSettings() {
  const f = $('#settingsForm').elements;
  const s = S.config.settings;
  f.workspace.value = s.workspace;
  f.timeoutMin.value = s.timeoutMin;
  f.walkDelayMs.value = s.walkDelayMs;
  f.saveReports.checked = s.saveReports;
  renderEngineTable();
  $('#dlgSettings').showModal();
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
const scene = new Scene($('#office'), {
  onSelect: (id) => { if (id) openAgent(id); else if (S.tab === 'agent') switchTab('team'); },
  onBoss: () => {
    switchTab('boss');
    const first = finishedTasks().find((t) => !t.read && t.status !== 'cancelled');
    if (first) openReport(first.id);
  },
});

const builder = createBuilder({
  getEngines: () => S.engines,
  onSave: async (mode, data) => {
    if (mode === 'boss') return act('boss:save', data, 'Saved.');
    const ok = await act('agent:save', data, data.agent.id ? 'Saved.' : `${data.agent.name} joined the office!`);
    return Boolean(ok);
  },
  onDelete: (id) => act('agent:delete', { id }, 'Removed.'),
});

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-edit],[data-lead],[data-open],[data-report],[data-cancel],[data-agent],[data-tab]');
  if (!t) return;
  if (t.dataset.tab) return switchTab(t.dataset.tab);
  if (t.dataset.edit) { const a = agentById(t.dataset.edit); return builder.open({ agent: a, isLeader: isLeader(a.id) }); }
  if (t.dataset.lead) return act('leader:set', { id: t.dataset.lead }, `${agentById(t.dataset.lead)?.name} is now the team leader ★`);
  if (t.dataset.open || t.dataset.agent) return openAgent(t.dataset.open || t.dataset.agent);
  if (t.dataset.report) return openReport(t.dataset.report);
  if (t.dataset.cancel) return act('task:cancel', { id: t.dataset.cancel }, 'Cancelling…');
});

$('#btnSend').addEventListener('click', async () => {
  if (await sendTask($('#taskText').value, $('#taskTarget').value)) $('#taskText').value = '';
});
$('#taskText').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('#btnSend').click(); });
$('#agentActions').addEventListener('click', (e) => {
  if (e.target.id === 'btnDirectToggle') { $('#directBox').hidden = !$('#directBox').hidden; if (!$('#directBox').hidden) $('#directText').focus(); }
});
$('#btnDirectSend').addEventListener('click', async () => {
  if (await sendTask($('#directText').value, S.selected)) { $('#directText').value = ''; $('#directBox').hidden = true; }
});
$('#directText').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('#btnDirectSend').click(); });
$('#btnBack').addEventListener('click', () => switchTab('team'));
$('#btnHire').addEventListener('click', () => builder.open({}));
$('#btnHire2').addEventListener('click', () => builder.open({}));
$('#btnBoss').addEventListener('click', () => builder.open({ boss: S.config.boss, officeName: S.config.officeName }));
$('#btnSettings').addEventListener('click', openSettings);
$('#btnRefreshEngines').addEventListener('click', () => act('engines:refresh', {}, 'Re-scanned your PATH.'));
$('#btnClearHistory').addEventListener('click', () => { if (confirm('Clear the inbox history? Saved Markdown reports stay on disk.')) act('history:clear', {}); });
$('#logFilter').addEventListener('change', renderFeed);
$('#logVerbose').addEventListener('change', renderFeed);
$('#settingsForm').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'save') return;
  e.preventDefault();
  const f = e.target.elements;
  const ok = await act('settings:save', { settings: { workspace: f.workspace.value.trim(), timeoutMin: +f.timeoutMin.value, walkDelayMs: +f.walkDelayMs.value, saveReports: f.saveReports.checked } }, 'Settings saved.');
  if (ok) $('#dlgSettings').close();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && S.tab === 'agent' && !document.querySelector('dialog[open]')) switchTab('team');
});

loadAssetPack().finally(() => {
  if (S.config) { scene.bg = null; scene.sync(S.config, S.engines); }
});
connect();
