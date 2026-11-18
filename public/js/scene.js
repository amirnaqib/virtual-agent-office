import * as S from './sprites.js';
import { drawText, textWidth } from './font.js';
import { buildLayout, T, toTile } from './map.js';
import { findPath } from './path.js';
import { packSprite, packCharacterFrame } from './assets.js';

const WALK_SPEED = 62; // px per second
const BUSY = new Set(['planning', 'working', 'compiling', 'assigning', 'replying']);
const CODE_GLYPHS = ['{', '}', ';', '<', '>', '/', '=', '+', '(', ')', '0', '1', '#', '*'];
const rand = (a, b) => a + Math.random() * (b - a);

const STATUS_WORD = {
  briefing: 'GETTING BRIEF', planning: 'PLANNING', assigning: 'ASSIGNING', working: 'TYPING', reporting: 'REPORTING',
  compiling: 'COMPILING', delivering: 'DELIVERING', waiting: 'WAITING', error: 'ERROR', done: 'DONE', replying: 'REPLYING',
};

export class Scene {
  constructor(canvas, handlers = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = document.createElement('canvas');
    this.wctx = this.world.getContext('2d');
    this.handlers = handlers;
    this.actors = new Map();
    this.layout = null;
    this.bg = null;
    this.papers = [];
    this.particles = [];
    this.leaderStack = 0;
    this.unread = 0;
    this.selectedId = null;
    this.hoverId = null;
    this.engineColors = {};
    this.officeName = '';
    this.time = 0;
    this.scale = 1;
    this.bossBubbleUntil = 0;
    this.bossQuestions = 0;

    canvas.addEventListener('mousemove', (e) => this.onMove(e));
    canvas.addEventListener('mouseleave', () => { this.hoverId = null; canvas.style.cursor = ''; });
    canvas.addEventListener('click', (e) => this.onClick(e));
    new ResizeObserver(() => this.fit()).observe(canvas.parentElement);

    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      this.time += dt;
      this.update(dt);
      this.render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // -------------------------------------------------------------------------
  // Data sync
  // -------------------------------------------------------------------------
  sync(config, engines = {}) {
    for (const [id, e] of Object.entries(engines)) this.engineColors[id] = e.color;
    const leaderId = config.leaderId;
    const members = config.agents.filter((a) => a.id !== leaderId);
    const prevH = this.layout?.H;
    const needRebuild = !this.layout || this.layout.memberSlots < members.length || this.layout.memberSlots - members.length >= 6 && this.layout.memberSlots > 12;
    if (needRebuild) {
      this.layout = buildLayout(members.length);
      this.layout.memberSlots = this.layout.desks.length;
    }
    if (this.officeName !== config.officeName || needRebuild) { this.officeName = config.officeName; this.bg = null; }
    if (prevH !== this.layout.H) this.fit();

    const seen = new Set();
    const place = (agent, desk, isLeader) => {
      seen.add(agent.id);
      let a = this.actors.get(agent.id);
      if (!a) {
        a = {
          id: agent.id, x: desk.seat.x, y: desk.seat.y, dir: 'down', pose: 'sit', seated: true,
          queue: [], cur: null, status: 'idle', activity: '', frame: 0, frameT: 0, carry: false,
          nextWander: this.time + rand(25, 70), doneUntil: 0, hasAssignment: false,
        };
        this.actors.set(agent.id, a);
      }
      const moved = a.desk && a.desk !== desk;
      Object.assign(a, { name: agent.name, role: agent.role, engine: agent.engine, look: agent.look, isLeader, desk });
      if (moved) {
        if (a.seated && !a.cur && !a.queue.length) { a.queue.push({ type: 'walk', to: 'desk' }); }
        else if (!a.queue.some((q) => q.type === 'walk' && q.to === 'desk')) a.queue.push({ type: 'walk', to: 'desk' });
      }
    };
    const leader = config.agents.find((a) => a.id === leaderId);
    if (leader) place(leader, this.layout.leaderDesk, true);
    // Keep people at the desk they already have; newcomers (or an ex-leader) take a free one.
    const taken = new Set();
    const keep = new Map();
    for (const m of members) {
      const d = this.actors.get(m.id)?.desk;
      if (d && d.kind === 'member' && this.layout.desks.includes(d) && !taken.has(d)) { keep.set(m.id, d); taken.add(d); }
    }
    const free = this.layout.desks.filter((d) => !taken.has(d));
    for (const m of members) place(m, keep.get(m.id) || free.shift(), false);
    for (const id of [...this.actors.keys()]) if (id !== 'boss' && !seen.has(id)) this.actors.delete(id);

    let boss = this.actors.get('boss');
    const bd = this.layout.bossDesk;
    if (!boss) {
      boss = { id: 'boss', isBoss: true, x: bd.seat.x, y: bd.seat.y, dir: 'down', pose: 'sit', seated: true, queue: [], cur: null, status: 'idle', frame: 0, frameT: 0 };
      this.actors.set('boss', boss);
    }
    Object.assign(boss, { name: config.boss?.name || 'Boss', look: config.boss?.look, desk: bd });
  }

  setStatus(id, st) {
    const a = this.actors.get(id);
    if (!a) return;
    const prev = a.status;
    a.status = st.status;
    a.activity = st.activity || '';
    if (st.status === 'done') a.doneUntil = this.time + 6;
    if (st.status === 'reporting' || st.status === 'delivering') a.carry = true;
    if (!BUSY.has(st.status) && st.status !== 'waiting') a.hasAssignment = false;
    if ((BUSY.has(st.status) || st.status === 'briefing') && prev === 'idle') this.cancelWander(a, false);
  }

  setUnread(n) { this.unread = n; }

  setBossQuestions(n) { this.bossQuestions = n; }

  cancelWander(a, incomingWalk) {
    const wandering = a.cur?.wander || a.queue.some((q) => q.wander);
    if (!wandering) return;
    if (a.cur?.wander) a.cur = null;
    a.queue = a.queue.filter((q) => !q.wander);
    if (!incomingWalk && !a.seated) a.queue.unshift({ type: 'walk', to: 'desk' });
    if (!a.cur && !a.seated && a.pose === 'stand') a.pose = 'stand';
  }

  fx(p) {
    if (p.kind === 'walk') {
      const a = this.actors.get(p.id);
      if (!a) return;
      this.cancelWander(a, true);
      a.queue.push({ type: 'walk', to: p.to });
      return;
    }
    if (p.kind === 'msg') {
      const from = this.actors.get(p.from);
      const label = p.msgKind === 'question' ? 'ASK' : p.msgKind === 'reply' ? 'RE' : 'MSG';
      const toName = p.to === 'everyone' ? 'ALL' : (this.actors.get(p.to)?.name || '').split(' ')[0];
      if (from) from.chatBubble = { text: `${label} → ${toName}`.toUpperCase(), kind: p.msgKind, until: this.time + 3.5 };
      const targets = p.to === 'everyone' ? [...this.actors.keys()].filter((id) => id !== p.from && id !== 'boss') : [p.to];
      for (const t of targets) {
        const a = this.anchorOf(p.from);
        const b = this.anchorOf(t);
        if (a && b) this.papers.push({ envelope: true, msgKind: p.msgKind, x0: a.x, y0: a.y - 6, x1: b.x, y1: b.y - 6, t: 0, dur: 800 });
      }
      return;
    }
    if (p.kind === 'paper') {
      const act = { type: 'paper', from: p.from, to: p.to, stack: p.stack, inbox: p.inbox };
      const mover = [p.from, p.to].map((id) => this.actors.get(id)).find((a) => a && !a.isBoss && (a.cur || a.queue.length));
      if (mover) { this.cancelWander(mover, false); mover.queue.push(act); } else this.launchPaper(act);
    }
  }

  // -------------------------------------------------------------------------
  // Simulation
  // -------------------------------------------------------------------------
  update(dt) {
    for (const a of this.actors.values()) {
      if (a.isBoss) continue;
      if (!a.cur && a.queue.length) { a.cur = a.queue.shift(); this.startAction(a, a.cur); }
      if (a.cur) {
        if (this.stepAction(a, a.cur, dt)) a.cur = null;
      } else if (a.seated && a.status === 'idle' && this.time > a.nextWander && this.layout.pois.length) {
        a.nextWander = this.time + rand(35, 90);
        if (Math.random() < 0.55) {
          const poi = this.layout.pois[Math.floor(Math.random() * this.layout.pois.length)];
          a.queue.push({ type: 'walk', to: 'poi', poi, wander: true }, { type: 'wait', ms: rand(2500, 5000), wander: true }, { type: 'walk', to: 'desk', wander: true });
        }
      }
      // typing particles
      if (a.seated && BUSY.has(a.status) && Math.random() < dt * 3.2) {
        const top = a.desk.bottom - a.desk.h;
        this.particles.push({ ch: CODE_GLYPHS[Math.floor(Math.random() * CODE_GLYPHS.length)], x: a.desk.cx + rand(-8, 6), y: top + 1, vy: -rand(9, 15), life: 1.2, t: 0, color: this.engineColors[a.engine] || '#9fd8ff' });
      }
    }
    for (const p of this.particles) { p.t += dt; p.y += p.vy * dt; }
    this.particles = this.particles.filter((p) => p.t < p.life);
    for (const p of this.papers) {
      p.t += dt * 1000;
      if (p.t >= p.dur && !p.done) { p.done = true; this.paperArrived(p); }
    }
    this.papers = this.papers.filter((p) => !p.done);
  }

  target(a, act) {
    if (act.to === 'desk') return { ...a.desk.seat, face: 'down', sit: true };
    if (act.to === 'poi') return { x: act.poi.x, y: act.poi.y, face: act.poi.face };
    const spots = act.to === 'boss' ? this.layout.bossVisit : this.layout.leaderVisit;
    const taken = [...this.actors.values()].filter((o) => o !== a && o.cur?.type === 'walk' && o.cur.to === act.to).map((o) => o.cur.spot);
    const spot = spots.findIndex((_, i) => !taken.includes(i));
    act.spot = spot === -1 ? 0 : spot;
    return { ...spots[act.spot], face: 'up' };
  }

  startAction(a, act) {
    if (act.type === 'walk') {
      const tgt = this.target(a, act);
      act.tgt = tgt;
      const L = this.layout;
      const start = toTile(a);
      const goal = toTile(tgt);
      const path = findPath(start, goal, L.W, L.H, L.isBlocked) || [];
      act.points = path.slice(1, -1).map((p) => ({ x: p.x * T + 8, y: p.y * T + 12 }));
      act.points.push({ x: tgt.x, y: tgt.y });
      a.seated = false;
      a.pose = 'walk';
    } else if (act.type === 'paper') {
      act.t = 0;
      act.dur = 700;
      if (act.from === a.id) a.carry = false;
      this.launchPaper(act);
    } else if (act.type === 'wait') {
      act.t = 0;
    }
  }

  stepAction(a, act, dt) {
    if (act.type === 'walk') {
      let budget = WALK_SPEED * dt;
      while (budget > 0 && act.points.length) {
        const p = act.points[0];
        const dx = p.x - a.x, dy = p.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d > 0.01) a.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
        if (d <= budget) { a.x = p.x; a.y = p.y; budget -= d; act.points.shift(); }
        else { a.x += (dx / d) * budget; a.y += (dy / d) * budget; budget = 0; }
      }
      a.frameT += dt;
      if (a.frameT > 0.13) { a.frameT = 0; a.frame = (a.frame + 1) % 4; }
      if (!act.points.length) {
        a.dir = act.tgt.face || a.dir;
        a.frame = 0;
        if (act.tgt.sit) { a.pose = 'sit'; a.seated = true; a.carry = false; a.dir = 'down'; }
        else a.pose = 'stand';
        return true;
      }
      return false;
    }
    if (act.type === 'paper' || act.type === 'wait') {
      act.t += dt * 1000;
      return act.t >= (act.type === 'wait' ? act.ms : act.dur);
    }
    return true;
  }

  anchorOf(id) {
    if (id === 'boss') {
      const d = this.layout.bossDesk;
      return { x: d.cx + 20, y: d.bottom - d.h + 2 };
    }
    const a = this.actors.get(id);
    if (!a) return null;
    if (a.seated) return { x: a.desk.cx - 10, y: a.desk.bottom - a.desk.h + 1 };
    return { x: a.x, y: a.y - 14 };
  }

  launchPaper(act) {
    const from = this.anchorOf(act.from);
    const to = this.anchorOf(act.to);
    if (!from || !to) return;
    this.papers.push({ ...act, x0: from.x, y0: from.y, x1: to.x, y1: to.y, t: 0, dur: 650 });
  }

  paperArrived(p) {
    if (p.envelope) return;
    if (p.inbox) { this.leaderStack = 0; this.bossBubbleUntil = this.time + 6; }
    else if (p.stack) this.leaderStack++;
    else {
      const a = this.actors.get(p.to);
      if (a && !a.isBoss) { if (a.seated) a.hasAssignment = true; else a.carry = true; }
    }
  }

  pendingInbox() {
    let n = this.papers.filter((p) => p.inbox).length;
    for (const a of this.actors.values()) {
      if (a.cur?.type === 'paper' && a.cur.inbox && !this.papers.some((p) => p.inbox)) n++;
      n += a.queue.filter((q) => q.type === 'paper' && q.inbox).length;
    }
    return n;
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------
  fit() {
    if (!this.layout) return;
    const host = this.canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const ww = this.layout.W * T, wh = this.layout.H * T;
    const narrow = window.matchMedia('(max-width: 960px)').matches;
    const cs = getComputedStyle(host);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const availW = (host.clientWidth - padX) * dpr;
    const availH = narrow ? Infinity : (host.clientHeight - padY) * dpr;
    // Crisp integer scaling on desktop; on phones use the full width instead.
    let s = narrow ? availW / ww : Math.floor(Math.min(availW / ww, availH / wh));
    if (s < 1) s = Math.min(availW / ww, availH / wh);
    this.scale = s;
    this.canvas.width = Math.round(ww * s);
    this.canvas.height = Math.round(wh * s);
    this.canvas.style.width = `${this.canvas.width / dpr}px`;
    this.canvas.style.height = `${this.canvas.height / dpr}px`;
    this.world.width = ww;
    this.world.height = wh;
  }

  buildBackground() {
    const L = this.layout;
    const c = document.createElement('canvas');
    c.width = L.W * T;
    c.height = L.H * T;
    const g = c.getContext('2d');
    const floor = packSprite('floor');
    for (let y = 2; y < L.H - 1; y++) {
      for (let x = 1; x < L.W - 1; x++) {
        if (floor) g.drawImage(floor.img, floor.x, floor.y, floor.w, floor.h, x * T, y * T, T, T);
        else g.drawImage(S.floorTile('wood', (x * 7 + y * 13 + ((x * y) % 5)) % 9), x * T, y * T);
      }
    }
    g.fillStyle = 'rgba(60,30,10,0.18)';
    g.fillRect(T, 2 * T, (L.W - 2) * T, 3);
    for (const r of L.rugs) g.drawImage(S.rugSprite(r.w, r.h), r.x, r.y);
    const wallSp = packSprite('wall');
    if (wallSp) for (let x = 1; x < L.W - 1; x++) g.drawImage(wallSp.img, wallSp.x, wallSp.y, wallSp.w, wallSp.h, x * T, 0, T, 2 * T);
    else g.drawImage(S.wallFace(L.W - 2), T, 0);
    for (const d of L.wallDecor) {
      if (d.sprite === 'window') g.drawImage(S.windowSprite(), d.x, d.y);
      else if (d.sprite === 'whiteboard') g.drawImage(S.whiteboardSprite(), d.x, d.y);
      else if (d.sprite === 'clock') g.drawImage(S.clockSprite(), d.x, d.y);
      else if (d.sprite === 'art') g.drawImage(S.framedArt(d.variant), d.x, d.y);
      else if (d.sprite === 'plaque') {
        const name = (this.officeName || 'Virtual Agent Office').toUpperCase().slice(0, 30);
        const w = textWidth(name) + 10;
        const x = Math.round(d.x - w / 2);
        g.fillStyle = '#e0b84a'; g.fillRect(x - 1, d.y - 1, w + 2, 13);
        g.fillStyle = '#4e321b'; g.fillRect(x, d.y, w, 11);
        g.fillStyle = '#6b4626'; g.fillRect(x, d.y, w, 1);
        drawText(g, name, d.x, d.y + 3, '#f2d877', 'center');
      }
    }
    // side & bottom walls
    g.fillStyle = '#4a3a2e';
    g.fillRect(0, 0, T, L.H * T);
    g.fillRect((L.W - 1) * T, 0, T, L.H * T);
    g.fillRect(0, (L.H - 1) * T, L.W * T, T);
    g.fillStyle = '#6b5442';
    g.fillRect(T - 2, 2 * T, 2, (L.H - 3) * T);
    g.fillRect((L.W - 1) * T, 2 * T, 2, (L.H - 3) * T);
    g.fillRect(T, (L.H - 1) * T, (L.W - 2) * T, 2);
    // door
    const dx = (L.W / 2) * T - 16;
    g.drawImage(S.floorTile('tile', 1), dx, (L.H - 1) * T);
    g.drawImage(S.floorTile('tile', 2), dx + 16, (L.H - 1) * T);
    g.fillStyle = '#3a2c22'; g.fillRect(dx - 2, (L.H - 1) * T, 2, T); g.fillRect(dx + 32, (L.H - 1) * T, 2, T);
    this.bg = c;
  }

  drawCharacter(g, a, x, y, pose, dir, frame) {
    const look = a.look || {};
    if (look.sprite) {
      const f = packCharacterFrame(look.sprite, dir, pose, frame);
      if (f) {
        g.save();
        if (f.flip) { g.translate(Math.round(x), 0); g.scale(-1, 1); g.drawImage(f.img, f.sx, f.sy, f.w, f.h, -f.ax, Math.round(y - f.ay), f.w, f.h); }
        else g.drawImage(f.img, f.sx, f.sy, f.w, f.h, Math.round(x - f.ax), Math.round(y - f.ay), f.w, f.h);
        g.restore();
        return;
      }
    }
    g.drawImage(S.characterFrame(look, dir, pose, frame), Math.round(x - S.CW / 2), Math.round(y - 24));
  }

  drawDeskUnit(g, desk, occ) {
    const top = desk.bottom - desk.h;
    const cx = desk.cx;
    const isBoss = desk.kind === 'boss';
    const chair = isBoss ? S.chairSprite('#6a2e2e', true) : desk.kind === 'leader' ? S.chairSprite('#5a3f8a') : S.chairSprite('#3a3f4b');
    g.drawImage(chair, Math.round(cx - chair.width / 2), top - (isBoss ? 18 : 15));
    const seated = occ && occ.seated;
    const busy = seated && BUSY.has(occ.status);
    if (seated) this.drawCharacter(g, occ, cx, top + 7 + (busy && Math.floor(this.time * 4) % 2 ? 0 : 0), 'sit', 'down', 0);

    const override = packSprite(isBoss ? 'bossDesk' : desk.kind === 'leader' ? 'leaderDesk' : 'desk');
    if (override) g.drawImage(override.img, override.x, override.y, override.w, override.h, Math.round(cx - override.w / 2 + (override.ox || 0)), desk.bottom - override.h + (override.oy || 0), override.w, override.h);
    else {
      const sp = isBoss ? S.bossDeskSprite() : desk.kind === 'leader' ? S.leaderDeskSprite() : S.deskSprite(occ ? this.engineColors[occ.engine] : null);
      g.drawImage(sp, Math.round(cx - sp.width / 2), top);
    }

    const glow = busy ? this.engineColors[occ.engine] || '#9fd8ff' : null;
    if (isBoss) {
      g.drawImage(S.monitorBackSprite('#6fcf6f'), cx - 30, top - 6);
      const n = Math.max(0, this.unread - this.pendingInbox());
      g.drawImage(S.inboxTray(n), cx + 12, top - 1);
      drawText(g, 'BOSS', cx, top + 17, '#f2d877', 'center');
      g.drawImage(S.mugSprite('#e94f4f'), cx - 8, top + 2);
    } else {
      if (desk.kind === 'leader' && this.leaderStack > 0) {
        const st = S.paperStack(this.leaderStack);
        g.drawImage(st, cx - 20, top + 6 - st.height);
      }
      if (occ?.hasAssignment && seated) g.drawImage(S.paperSprite(), cx - 15, top + 1);
      g.drawImage(S.mugSprite(occ ? occ.look?.extraColor || '#f4f1e8' : '#f4f1e8'), cx + 9, top + 2);
    }
    if (!isBoss) {
      const lap = S.laptopSprite(glow);
      g.drawImage(lap, cx - 7, top - 1);
      if (glow) { g.fillStyle = glow; g.globalAlpha = 0.18 + 0.08 * Math.sin(this.time * 6); g.fillRect(cx - 9, top - 3, 18, 3); g.globalAlpha = 1; }
    }
    if (seated) {
      const skin = occ.look?.skin || '#f6c9a0';
      const t = Math.floor(this.time * 9);
      const l = busy && t % 2 ? -1 : 0;
      const r = busy && t % 2 === 0 ? -1 : 0;
      g.fillStyle = skin;
      g.fillRect(cx - 5, top - 1 + l, 2, 2);
      g.fillRect(cx + 3, top - 1 + r, 2, 2);
      g.fillStyle = '#1b1424';
      g.fillRect(cx - 5, top + 1 + l, 2, 1);
      g.fillRect(cx + 3, top + 1 + r, 2, 1);
    }
  }

  drawDecor(g, d) {
    const override = packSprite(d.sprite);
    if (override) { g.drawImage(override.img, override.x, override.y, override.w, override.h, d.x + (override.ox || 0), d.bottom - override.h + (override.oy || 0), override.w, override.h); return; }
    const sp = {
      bookshelf: () => S.bookshelfSprite(d.variant), plant: () => S.plantSprite(d.variant), couch: () => S.couchSprite(d.color),
      table: () => S.tableSprite(), coffee: () => S.coffeeCounterSprite(), cooler: () => S.waterCoolerSprite(), printer: () => S.printerSprite(),
    }[d.sprite]?.();
    if (sp) g.drawImage(sp, d.x, d.bottom - sp.height);
  }

  headPos(a) {
    if (a.seated) return { x: a.desk.cx, y: a.desk.bottom - a.desk.h - 15 };
    return { x: Math.round(a.x), y: Math.round(a.y) - 24 };
  }

  render() {
    if (!this.layout) return;
    const L = this.layout;
    if (!this.bg) this.buildBackground();
    const g = this.wctx;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, this.world.width, this.world.height);
    g.drawImage(this.bg, 0, 0);

    const items = [];
    for (const d of L.decor) items.push({ y: d.bottom, draw: () => this.drawDecor(g, d) });
    const occupants = new Map();
    for (const a of this.actors.values()) occupants.set(a.desk, a);
    const desks = [L.bossDesk, L.leaderDesk, ...L.desks];
    for (const d of desks) {
      const occ = occupants.get(d);
      items.push({ y: d.bottom, draw: () => this.drawDeskUnit(g, d, occ) });
    }
    for (const a of this.actors.values()) {
      if (a.seated) continue;
      items.push({
        y: a.y,
        draw: () => {
          g.drawImage(S.shadowSprite(12), Math.round(a.x - 6), Math.round(a.y - 2));
          this.drawCharacter(g, a, a.x, a.y, a.pose, a.dir, a.pose === 'walk' ? a.frame : 0);
          if (a.carry) {
            const bob = a.pose === 'walk' ? (a.frame % 2) : 0;
            const px = a.dir === 'left' ? -8 : a.dir === 'right' ? 2 : a.dir === 'up' ? -3 : 3;
            g.drawImage(S.paperSprite(), Math.round(a.x + px), Math.round(a.y - 14 - bob));
          }
        },
      });
    }
    items.sort((p, q) => p.y - q.y);
    for (const it of items) it.draw();

    // flying papers
    for (const p of this.papers) {
      const k = Math.min(1, p.t / p.dur);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const x = p.x0 + (p.x1 - p.x0) * e;
      const y = p.y0 + (p.y1 - p.y0) * e - Math.sin(Math.PI * k) * 22;
      if (p.envelope) g.drawImage(S.envelopeSprite(p.msgKind), Math.round(x - 4), Math.round(y - 3));
      else g.drawImage(S.paperSprite(), Math.round(x - 3), Math.round(y - 4));
    }
    // code particles
    for (const p of this.particles) {
      g.globalAlpha = Math.max(0, 1 - p.t / p.life);
      drawText(g, p.ch, Math.round(p.x), Math.round(p.y), p.color);
    }
    g.globalAlpha = 1;

    // labels on top
    const labelled = [...this.actors.values()].sort((p, q) => this.headPos(p).y - this.headPos(q).y);
    for (const a of labelled) this.drawLabel(g, a);

    const c = this.ctx;
    c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.drawImage(this.world, 0, 0, this.canvas.width, this.canvas.height);
  }

  drawLabel(g, a) {
    const h = this.headPos(a);
    const hot = a.id === this.hoverId || a.id === this.selectedId;
    const name = (a.name || '').toUpperCase().slice(0, 14);
    const w = textWidth(name) + 4;
    let y = h.y - 9;
    const x = Math.round(h.x - w / 2);
    g.fillStyle = hot ? 'rgba(255,255,255,0.95)' : a.isBoss ? 'rgba(90,40,20,0.85)' : 'rgba(20,18,32,0.72)';
    g.fillRect(x, y, w, 7);
    drawText(g, name, h.x, y + 1, hot ? '#1b1424' : a.isBoss ? '#f2d877' : '#ffffff', 'center');
    if (a.isLeader) g.drawImage(S.crownSprite(), x - 8, y + 1);
    if (!a.isBoss && this.engineColors[a.engine]) { g.fillStyle = this.engineColors[a.engine]; g.fillRect(x + w + 1, y + 2, 3, 3); }

    // status bubble
    let text = null;
    let color = '#ffffff';
    let ink = '#1b1424';
    const chatting = a.chatBubble && this.time < a.chatBubble.until;
    if (a.isBoss) {
      const n = Math.max(0, this.unread - this.pendingInbox());
      if (chatting) { text = a.chatBubble.text; color = '#9fd8ff'; }
      else if (this.bossQuestions > 0) { text = `? ${this.bossQuestions} QUESTION${this.bossQuestions > 1 ? 'S' : ''}`; color = '#f2c94c'; }
      else if (n > 0 || this.time < this.bossBubbleUntil) { text = n > 0 ? `${n} NEW` : 'THANKS!'; color = '#f2c94c'; }
    } else if (a.status === 'error') { text = '!'; color = '#e94f4f'; ink = '#ffffff'; }
    else if (chatting) { text = a.chatBubble.text; color = a.chatBubble.kind === 'question' ? '#f2c94c' : a.chatBubble.kind === 'reply' ? '#9fe39f' : '#9fd8ff'; }
    else if (a.status === 'done' && this.time < a.doneUntil) { text = '✓'; color = '#6fcf6f'; }
    else if (BUSY.has(a.status) || ['briefing', 'reporting', 'delivering', 'waiting'].includes(a.status)) {
      if (hot) text = (a.activity && BUSY.has(a.status) ? a.activity : STATUS_WORD[a.status] || a.status).toUpperCase().replace(/[^\x20-\x7E✓…★]/g, '').slice(0, 26);
      else if (BUSY.has(a.status)) text = ['.  ', '.. ', '...'][Math.floor(this.time * 3) % 3];
      else text = STATUS_WORD[a.status] || '';
      if (a.status === 'waiting' && !hot) { text = '…'; color = '#c8ccd6'; }
    }
    if (text) {
      const bw = Math.max(9, textWidth(text) + 6);
      y -= 10;
      const bx = Math.round(h.x - bw / 2);
      g.fillStyle = '#1b1424';
      g.fillRect(bx - 1, y, bw + 2, 9);
      g.fillRect(bx, y - 1, bw, 11);
      g.fillStyle = color;
      g.fillRect(bx, y, bw, 9);
      g.fillStyle = '#1b1424';
      g.fillRect(Math.round(h.x) - 1, y + 10, 3, 1);
      g.fillRect(Math.round(h.x), y + 11, 1, 1);
      g.fillStyle = color;
      g.fillRect(Math.round(h.x), y + 9, 1, 1);
      drawText(g, text, h.x, y + 2, ink, 'center');
    }
    if (a.id === this.selectedId) {
      const by = y - 7 + Math.round(Math.sin(this.time * 5) * 1.5);
      g.fillStyle = '#f2c94c';
      g.fillRect(Math.round(h.x) - 3, by, 7, 1);
      g.fillRect(Math.round(h.x) - 2, by + 1, 5, 1);
      g.fillRect(Math.round(h.x) - 1, by + 2, 3, 1);
      g.fillRect(Math.round(h.x), by + 3, 1, 1);
    }
  }

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------
  toWorld(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * this.world.width, y: ((e.clientY - r.top) / r.height) * this.world.height };
  }

  hit(p) {
    let best = null;
    for (const a of this.actors.values()) {
      const h = this.headPos(a);
      const box = a.seated ? { x: h.x - 10, y: h.y - 10, w: 20, h: 30 } : { x: a.x - 9, y: a.y - 34, w: 18, h: 36 };
      if (p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h) {
        if (!best || (a.seated ? a.desk.bottom : a.y) > (best.seated ? best.desk.bottom : best.y)) best = a;
      }
    }
    if (!best && this.layout) {
      const bd = this.layout.bossDesk;
      if (Math.abs(p.x - bd.cx) < bd.w / 2 && p.y > bd.bottom - bd.h - 20 && p.y < bd.bottom) best = this.actors.get('boss');
    }
    return best;
  }

  onMove(e) {
    const a = this.hit(this.toWorld(e));
    this.hoverId = a?.id || null;
    this.canvas.style.cursor = a ? 'pointer' : '';
  }

  onClick(e) {
    const a = this.hit(this.toWorld(e));
    if (a?.isBoss) { this.handlers.onBoss?.(); return; }
    this.selectedId = a?.id || null;
    this.handlers.onSelect?.(this.selectedId);
  }

  select(id) { this.selectedId = id; }
}
