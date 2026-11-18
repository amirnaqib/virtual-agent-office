import { SKIN, HAIR_COLORS, CLOTH, HAIR_STYLES, EYEWEAR, EXTRAS, randomLook, normalizeLook } from './looks.js';
import { characterFrame, shadowSprite } from './sprites.js';
import { packCharacters, packCharacterFrame } from './assets.js';

const ENGINE_ORDER = ['claude', 'codex', 'antigravity', 'gemini', 'hermes', 'custom', 'mock'];
const DIRS = ['down', 'left', 'up', 'right'];
const LABEL = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Character builder dialog, used both for agents and for the boss. */
export function createBuilder({ getEngines, onSave, onDelete }) {
  const dlg = document.getElementById('dlgBuilder');
  const form = document.getElementById('builderForm');
  const cv = document.getElementById('previewCanvas');
  const g = cv.getContext('2d');
  const f = (n) => form.elements.namedItem(n);
  let mode = 'agent';
  let editing = null;
  let look = randomLook();
  let dirIdx = 0;
  let pose = 'walk';
  let raf = 0;

  const fillSelect = (sel, values, label = LABEL) => { sel.innerHTML = values.map((v) => `<option value="${v}">${label(v)}</option>`).join(''); };
  fillSelect(f('hairStyle'), HAIR_STYLES, (v) => ({ hijab: 'Hijab / tudung', cap: 'Cap', side: 'Side part', bob: 'Bob' }[v] || LABEL(v)));
  fillSelect(f('eyewear'), EYEWEAR, (v) => ({ none: 'None', round: 'Round (gold)' }[v] || LABEL(v)));
  fillSelect(f('extra'), EXTRAS, (v) => (v === 'none' ? 'None' : LABEL(v)));

  function paletteFor(key) {
    if (key === 'skin') return SKIN;
    if (key === 'hairColor') return ['hijab', 'cap'].includes(look.hairStyle) ? CLOTH : HAIR_COLORS;
    return CLOTH;
  }

  function renderSwatches() {
    for (const box of form.querySelectorAll('.swatches')) {
      const key = box.dataset.key;
      const cur = (look[key] || '').toLowerCase();
      const colors = paletteFor(key);
      box.innerHTML = colors.map((c) => `<button type="button" class="sw${c.toLowerCase() === cur ? ' on' : ''}" style="background:${c}" data-c="${c}" title="${c}"></button>`).join('')
        + `<input type="color" class="sw" value="${cur || '#888888'}" title="Custom colour">`;
    }
  }

  form.addEventListener('click', (e) => {
    const sw = e.target.closest('button.sw');
    if (!sw) return;
    look[sw.parentElement.dataset.key] = sw.dataset.c;
    renderSwatches();
  });
  form.addEventListener('input', (e) => {
    if (e.target.matches('input[type=color].sw')) { look[e.target.parentElement.dataset.key] = e.target.value; }
  });
  form.addEventListener('change', (e) => {
    if (e.target.matches('input[type=color].sw')) renderSwatches();
    if (['hairStyle', 'eyewear', 'extra', 'sprite'].includes(e.target.name)) { look[e.target.name] = e.target.value; renderSwatches(); }
    if (e.target.name === 'engine' || e.target.name === 'autonomy') renderEngineInfo();
  });

  function renderEngineInfo() {
    const engines = getEngines();
    const id = f('engine').value;
    const e = engines[id] || {};
    document.getElementById('customRow').hidden = id !== 'custom';
    f('model').placeholder = e.modelHint || 'default';
    document.getElementById('engineInfo').textContent = e.installed || id === 'custom' || id === 'mock'
      ? `${e.path ? `Found at ${e.path}. ` : ''}${id === 'mock' ? e.install : ''}`
      : `Not found on PATH. Install: ${e.install}`;
    const auto = f('autonomy').value;
    document.getElementById('autonomyInfo').textContent = e.autonomy ? `Uses: ${e.autonomy[auto]}. Planning and report writing always run read-only.` : '';
  }

  document.getElementById('btnRandom').addEventListener('click', () => {
    const keepSprite = look.sprite;
    look = { ...randomLook(), sprite: keepSprite };
    syncLookFields();
  });
  document.getElementById('pvLeft').addEventListener('click', () => { dirIdx = (dirIdx + 1) % 4; });
  document.getElementById('pvRight').addEventListener('click', () => { dirIdx = (dirIdx + 3) % 4; });
  const poseBtn = document.getElementById('pvPose');
  poseBtn.addEventListener('click', () => {
    pose = pose === 'walk' ? 'stand' : pose === 'stand' ? 'sit' : 'walk';
    poseBtn.textContent = { walk: 'Walk', stand: 'Stand', sit: 'Typing' }[pose];
  });

  function syncLookFields() {
    f('hairStyle').value = look.hairStyle;
    f('eyewear').value = look.eyewear;
    f('extra').value = look.extra;
    f('sprite').value = look.sprite || '';
    renderSwatches();
  }

  function drawPreview(t) {
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, cv.width, cv.height);
    const s = 6;
    const dir = pose === 'sit' ? 'down' : DIRS[dirIdx];
    const frame = pose === 'walk' ? Math.floor(t / 140) % 4 : 0;
    const x = cv.width / 2;
    const feet = 176;
    g.drawImage(shadowSprite(12), x - 6 * s, feet - 2 * s, 12 * s, 4 * s);
    const pack = look.sprite ? packCharacterFrame(look.sprite, dir, pose, frame) : null;
    if (pack) {
      const sc = Math.min(s, Math.floor(150 / pack.h)) || 1;
      g.save();
      if (pack.flip) { g.translate(x, 0); g.scale(-1, 1); g.drawImage(pack.img, pack.sx, pack.sy, pack.w, pack.h, -pack.ax * sc, feet - pack.ay * sc, pack.w * sc, pack.h * sc); }
      else g.drawImage(pack.img, pack.sx, pack.sy, pack.w, pack.h, x - pack.ax * sc, feet - pack.ay * sc, pack.w * sc, pack.h * sc);
      g.restore();
    } else {
      g.drawImage(characterFrame(normalizeLook(look), dir, pose, frame), x - 9 * s, feet - 24 * s, 18 * s, 26 * s);
    }
    if (pose === 'sit') {
      g.fillStyle = '#b07d48'; g.fillRect(x - 16 * s, feet - 9 * s, 32 * s, 9 * s);
      g.fillStyle = '#d9a66b'; g.fillRect(x - 16 * s, feet - 13 * s, 32 * s, 4 * s);
      const k = Math.floor(t / 110) % 2;
      g.fillStyle = look.skin; g.fillRect(x - 5 * s, feet - (14 + k) * s, 2 * s, 2 * s); g.fillRect(x + 3 * s, feet - (15 - k) * s, 2 * s, 2 * s);
      g.fillStyle = '#c8ccd6'; g.fillRect(x - 7 * s, feet - 12 * s, 14 * s, 7 * s);
    }
    raf = requestAnimationFrame(drawPreview);
  }

  function open({ agent = null, boss = null, officeName = '', isLeader = false } = {}) {
    mode = boss ? 'boss' : 'agent';
    editing = agent;
    for (const el of form.querySelectorAll('[data-agent-only]')) el.hidden = mode === 'boss';
    for (const el of form.querySelectorAll('[data-boss-only]')) el.hidden = mode !== 'boss';
    document.getElementById('btnFire').hidden = mode === 'boss' || !agent;
    document.getElementById('builderTitle').textContent = mode === 'boss' ? 'You, the boss' : agent ? `Edit ${agent.name}` : 'Hire an agent';
    document.getElementById('btnSaveAgent').textContent = mode === 'boss' || agent ? 'Save' : 'Hire';

    const engines = getEngines();
    f('engine').innerHTML = ENGINE_ORDER.filter((id) => engines[id]).map((id) => {
      const e = engines[id];
      const miss = !e.installed && id !== 'custom' && id !== 'mock';
      return `<option value="${id}">${e.label}${miss ? ' — not found' : ''}</option>`;
    }).join('');

    const packs = packCharacters();
    document.getElementById('spriteField').hidden = !packs.length;
    f('sprite').innerHTML = '<option value="">Built-in pixel art</option>' + packs.map((p) => `<option value="${p}">${p}</option>`).join('');

    const src = mode === 'boss' ? boss : agent;
    look = src?.look ? { ...src.look } : randomLook();
    f('name').value = src?.name || '';
    f('officeName').value = officeName;
    f('role').value = agent?.role || '';
    const firstInstalled = ENGINE_ORDER.find((id) => engines[id]?.installed && id !== 'custom' && id !== 'mock') || 'mock';
    f('engine').value = agent?.engine || firstInstalled;
    f('model').value = agent?.model || '';
    f('autonomy').value = agent?.autonomy || 'edit';
    f('customCommand').value = agent?.customCommand || '';
    f('extraArgs').value = agent?.extraArgs || '';
    f('persona').value = agent?.persona || '';
    f('makeLeader').checked = isLeader;
    f('makeLeader').disabled = isLeader;
    syncLookFields();
    renderEngineInfo();
    dirIdx = 0;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(drawPreview);
    dlg.showModal();
    setTimeout(() => f('name').focus(), 30);
  }

  dlg.addEventListener('close', () => cancelAnimationFrame(raf));

  form.addEventListener('submit', async (e) => {
    const action = e.submitter?.value;
    if (action !== 'save') return;
    e.preventDefault();
    const data = mode === 'boss'
      ? { boss: { name: f('name').value.trim(), look: normalizeLook(look), officeName: f('officeName').value.trim() } }
      : {
        agent: {
          id: editing?.id,
          name: f('name').value.trim(),
          role: f('role').value.trim(),
          engine: f('engine').value,
          model: f('model').value.trim(),
          autonomy: f('autonomy').value,
          customCommand: f('customCommand').value,
          extraArgs: f('extraArgs').value,
          persona: f('persona').value,
          look: normalizeLook(look),
          makeLeader: f('makeLeader').checked && !f('makeLeader').disabled,
        },
      };
    if (data.agent?.engine === 'custom' && !data.agent.customCommand.trim()) {
      f('customCommand').focus();
      return;
    }
    const ok = await onSave(mode, data);
    if (ok) dlg.close();
  });

  document.getElementById('btnFire').addEventListener('click', async () => {
    if (!editing) return;
    if (!confirm(`Remove ${editing.name} from the office?`)) return;
    if (await onDelete(editing.id)) dlg.close();
  });

  return { open };
}
