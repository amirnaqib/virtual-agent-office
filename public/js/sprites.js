// Original procedural pixel art: every character and piece of furniture is
// drawn pixel-by-pixel at 1x and cached. No external art needed.

export const CW = 18; // character canvas (16x24 body + 1px outline margin)
export const CH = 26;
const OUTLINE = '#1b1424';
const EYE = '#1c1418';

const cache = new Map();

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const f = amt / 100;
  if (f < 0) { r *= 1 + f; g *= 1 + f; b *= 1 + f; } else { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

function painter(w, h, ox = 0, oy = 0) {
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  return {
    c, g,
    px(x, y, col) { g.fillStyle = col; g.fillRect(x + ox, y + oy, 1, 1); },
    rect(x, y, rw, rh, col) { if (rw <= 0 || rh <= 0) return; g.fillStyle = col; g.fillRect(x + ox, y + oy, rw, rh); },
    clear(x, y, rw = 1, rh = 1) { g.clearRect(x + ox, y + oy, rw, rh); },
  };
}

function addOutline(c, color = OUTLINE) {
  const g = c.getContext('2d');
  const { width: w, height: h } = c;
  const src = g.getImageData(0, 0, w, h);
  const d = src.data;
  const out = g.createImageData(w, h);
  out.data.set(d);
  const n = parseInt(color.slice(1), 16);
  const R = n >> 16, Gc = (n >> 8) & 255, B = n & 255;
  const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] > 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i + 3] > 0) continue;
      if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) {
        out.data[i] = R; out.data[i + 1] = Gc; out.data[i + 2] = B; out.data[i + 3] = 255;
      }
    }
  }
  g.putImageData(out, 0, 0);
  return c;
}

function flipH(c) {
  const f = makeCanvas(c.width, c.height);
  const g = f.getContext('2d');
  g.translate(c.width, 0);
  g.scale(-1, 1);
  g.drawImage(c, 0, 0);
  return f;
}

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

function lookKey(L) {
  return [L.skin, L.hairStyle, L.hairColor, L.shirt, L.pants, L.shoes, L.eyewear, L.extra, L.extraColor].join(',');
}

/**
 * @param look appearance
 * @param dir 'down'|'up'|'left'|'right'
 * @param pose 'stand'|'walk'|'sit'
 * @param frame walk: 0..3, otherwise 0
 */
export function characterFrame(look, dir, pose, frame = 0) {
  const key = `ch|${lookKey(look)}|${dir}|${pose}|${frame}`;
  let c = cache.get(key);
  if (c) return c;
  if (dir === 'right') {
    c = flipH(characterFrame(look, 'left', pose, frame));
  } else {
    const p = painter(CW, CH, 1, 1);
    if (dir === 'down') drawFront(p, look, pose, frame);
    else if (dir === 'up') drawBack(p, look, pose, frame);
    else drawSide(p, look, pose, frame);
    c = addOutline(p.c);
  }
  cache.set(key, c);
  return c;
}

function palette(L) {
  return {
    skin: L.skin, skinD: shade(L.skin, -14), skinDD: shade(L.skin, -32), skinL: shade(L.skin, 22),
    shirt: L.shirt, shirtD: shade(L.shirt, -20), shirtL: shade(L.shirt, 16),
    pants: L.pants, pantsD: shade(L.pants, -28),
    hair: L.hairColor, hairD: shade(L.hairColor, -24), hairL: shade(L.hairColor, 22),
    shoes: L.shoes, x: L.extraColor || '#e94f4f', xD: shade(L.extraColor || '#e94f4f', -25),
  };
}

function legsFront(p, c, pose, f) {
  if (pose === 'sit') return;
  const lUp = pose === 'walk' && f === 1 ? 1 : 0;
  const rUp = pose === 'walk' && f === 3 ? 1 : 0;
  p.rect(4, 17, 8, 1, c.pants);
  p.rect(4, 18, 3, 3 - lUp, c.pants);
  p.rect(9, 18, 3, 3 - rUp, c.pants);
  p.rect(6, 18, 1, 3 - lUp, c.pantsD);
  p.rect(9, 18, 1, 3 - rUp, c.pantsD);
  p.rect(4, 21 - lUp, 3, 1, c.shoes);
  p.rect(9, 21 - rUp, 3, 1, c.shoes);
}

function torsoFront(p, c, pose, f, o) {
  p.rect(4, 11 + o, 8, 6, c.shirt);
  p.rect(4, 11 + o, 8, 1, c.shirtL);
  p.rect(4, 16 + o, 8, 1, c.shirtD);
  if (pose === 'sit') {
    p.rect(2, 11 + o, 2, 4, c.shirtD);
    p.rect(12, 11 + o, 2, 4, c.shirtD);
    p.rect(3, 15 + o, 2, 1, c.skin);
    p.rect(11, 15 + o, 2, 1, c.skin);
  } else {
    const sw = pose === 'walk' ? (f === 1 ? 1 : f === 3 ? -1 : 0) : 0;
    p.rect(2, 11 + o, 2, 4, c.shirtD);
    p.rect(12, 11 + o, 2, 4, c.shirtD);
    p.rect(2, 15 + o - sw, 2, 1, c.skin);
    p.rect(12, 15 + o + sw, 2, 1, c.skin);
  }
}

function headBase(p, c, o) {
  p.rect(3, 2 + o, 10, 9, c.skin);
  p.rect(3, 10 + o, 10, 1, c.skinD);
  p.clear(3, 2 + o); p.clear(12, 2 + o); p.clear(3, 10 + o); p.clear(12, 10 + o);
}

function hairFront(p, c, s, o) {
  const H = c.hair;
  const cap = () => { p.rect(4, 1 + o, 8, 1, H); p.rect(3, 2 + o, 10, 2, H); p.px(5, 2 + o, c.hairL); p.px(6, 2 + o, c.hairL); };
  switch (s) {
    case 'short': cap(); p.rect(3, 4 + o, 2, 1, H); p.rect(11, 4 + o, 2, 1, H); p.px(3, 5 + o, H); p.px(12, 5 + o, H); break;
    case 'spiky': cap(); [4, 7, 10].forEach((x) => p.px(x, 0 + o, H)); p.px(3, 1 + o, H); p.px(12, 1 + o, H); p.rect(3, 4 + o, 1, 2, H); p.rect(12, 4 + o, 1, 2, H); p.px(6, 4 + o, H); p.px(9, 4 + o, H); break;
    case 'side': cap(); p.rect(3, 4 + o, 6, 1, H); p.rect(3, 5 + o, 2, 1, H); p.rect(12, 4 + o, 1, 2, H); break;
    case 'bob': cap(); p.rect(3, 4 + o, 10, 1, H); p.rect(2, 3 + o, 2, 7, H); p.rect(12, 3 + o, 2, 7, H); p.rect(2, 9 + o, 1, 1, c.hairD); p.rect(13, 9 + o, 1, 1, c.hairD); break;
    case 'long': cap(); p.rect(3, 4 + o, 3, 1, H); p.rect(10, 4 + o, 3, 1, H); p.rect(2, 3 + o, 2, 12, H); p.rect(12, 3 + o, 2, 12, H); p.rect(2, 13 + o, 1, 2, c.hairD); p.rect(13, 13 + o, 1, 2, c.hairD); break;
    case 'ponytail': cap(); p.rect(3, 4 + o, 2, 1, H); p.rect(11, 4 + o, 2, 1, H); p.rect(13, 3 + o, 1, 3, H); p.rect(14, 5 + o, 1, 4, c.hairD); break;
    case 'bun': cap(); p.rect(6, -1 + o, 4, 2, H); p.px(7, -1 + o, c.hairL); p.rect(3, 4 + o, 2, 1, H); p.rect(11, 4 + o, 2, 1, H); break;
    case 'curly':
      p.rect(3, 0 + o, 10, 4, H); p.rect(2, 1 + o, 12, 4, H);
      [3, 6, 9, 12].forEach((x) => p.clear(x, 0 + o));
      p.rect(2, 5 + o, 2, 2, H); p.rect(12, 5 + o, 2, 2, H);
      [[4, 1], [7, 2], [10, 1], [5, 3], [9, 3]].forEach(([x, y]) => p.px(x, y + o, c.hairL));
      break;
    case 'mohawk': p.rect(7, -1 + o, 2, 4, H); p.px(7, -1 + o, c.hairL); p.rect(4, 2 + o, 3, 1, c.skinD); p.rect(9, 2 + o, 3, 1, c.skinD); break;
    case 'bald': p.px(5, 3 + o, c.skinL); p.px(6, 3 + o, c.skinL); p.px(5, 4 + o, c.skinL); break;
    case 'cap':
      p.rect(4, 1 + o, 8, 1, H); p.rect(3, 2 + o, 10, 2, H); p.px(7, 2 + o, '#ffffff'); p.px(8, 2 + o, '#ffffff');
      p.rect(2, 4 + o, 12, 1, c.hairD); p.px(3, 5 + o, '#3b2418'); p.px(12, 5 + o, '#3b2418');
      break;
    case 'hijab':
      p.rect(4, 0 + o, 8, 1, H); p.rect(3, 1 + o, 10, 1, H); p.rect(2, 2 + o, 12, 9, H);
      p.rect(4, 4 + o, 8, 6, c.skin); p.rect(4, 9 + o, 8, 1, c.skinD);
      p.rect(3, 11 + o, 10, 2, H); p.rect(4, 13 + o, 8, 1, c.hairD);
      p.px(5, 1 + o, c.hairL); p.px(6, 1 + o, c.hairL); p.px(10, 10 + o, c.hairL);
      break;
    default: cap();
  }
}

function faceFront(p, c, L, o) {
  p.rect(5, 6 + o, 1, 2, EYE);
  p.rect(10, 6 + o, 1, 2, EYE);
  p.px(7, 9 + o, c.skinDD);
  p.px(8, 9 + o, c.skinDD);
  if (L.extra === 'blush') { p.px(4, 8 + o, '#f28b9b'); p.px(11, 8 + o, '#f28b9b'); }
  if (L.eyewear === 'glasses' || L.eyewear === 'round') {
    const fr = L.eyewear === 'round' ? '#d9a35b' : '#2a2f3d';
    [4, 6, 9, 11].forEach((x) => { p.px(x, 6 + o, fr); p.px(x, 7 + o, fr); });
    p.px(7, 6 + o, fr); p.px(8, 6 + o, fr);
    p.px(5, 6 + o, '#cfefff'); p.px(10, 6 + o, '#cfefff');
  } else if (L.eyewear === 'sunglasses') {
    p.rect(4, 6 + o, 3, 2, '#14141c'); p.rect(9, 6 + o, 3, 2, '#14141c'); p.rect(7, 6 + o, 2, 1, '#14141c');
    p.px(4, 6 + o, '#6e7a99'); p.px(9, 6 + o, '#6e7a99');
  }
  if (L.extra === 'beard') {
    p.rect(3, 8 + o, 1, 2, c.hair); p.rect(12, 8 + o, 1, 2, c.hair);
    p.rect(4, 9 + o, 8, 2, c.hair); p.rect(6, 8 + o, 4, 1, c.hair); p.rect(7, 9 + o, 2, 1, c.hairD);
  }
  if (L.extra === 'mustache') { p.rect(6, 8 + o, 4, 1, c.hair); }
}

function extrasBodyFront(p, c, L, o) {
  if (L.extra === 'tie') {
    p.px(6, 11 + o, '#f4f1e8'); p.px(9, 11 + o, '#f4f1e8');
    p.rect(7, 11 + o, 2, 1, c.xD); p.rect(7, 12 + o, 2, 3, c.x); p.px(7, 15 + o, c.x);
  }
  if (L.extra === 'scarf') { p.rect(4, 10 + o, 8, 2, c.x); p.rect(9, 12 + o, 2, 3, c.xD); }
}

function headphones(p, c, o, side) {
  if (side) {
    p.rect(8, 1 + o, 1, 4, '#2a2f3d'); p.rect(7, 5 + o, 3, 3, c.x); p.px(7, 5 + o, shade(c.x, 25));
  } else {
    p.rect(3, 0 + o, 10, 1, '#2a2f3d'); p.rect(2, 1 + o, 1, 4, '#2a2f3d'); p.rect(13, 1 + o, 1, 4, '#2a2f3d');
    p.rect(1, 5 + o, 2, 3, c.x); p.rect(13, 5 + o, 2, 3, c.x);
  }
}

function drawFront(p, L, pose, f) {
  const c = palette(L);
  const o = pose === 'walk' && (f === 1 || f === 3) ? -1 : 0;
  legsFront(p, c, pose, f);
  torsoFront(p, c, pose, f, o);
  p.rect(7, 11 + o, 2, 1, c.skinD);
  extrasBodyFront(p, c, L, o);
  headBase(p, c, o);
  hairFront(p, c, L.hairStyle, o);
  faceFront(p, c, L, o);
  if (L.extra === 'headphones') headphones(p, c, o, false);
}

function drawBack(p, L, pose, f) {
  const c = palette(L);
  const o = pose === 'walk' && (f === 1 || f === 3) ? -1 : 0;
  legsFront(p, c, pose, f);
  torsoFront(p, c, pose, f, o);
  if (L.extra === 'scarf') p.rect(4, 10 + o, 8, 2, c.x);
  headBase(p, c, o);
  const H = c.hair;
  const full = (bottom) => { p.rect(4, 1 + o, 8, 1, H); p.rect(3, 2 + o, 10, bottom - 1, H); p.px(6, 3 + o, c.hairL); p.px(9, 4 + o, c.hairL); };
  switch (L.hairStyle) {
    case 'bald': p.px(6, 4 + o, c.skinL); break;
    case 'mohawk': p.rect(7, -1 + o, 2, 10, H); break;
    case 'bob': full(8); p.rect(2, 3 + o, 2, 7, H); p.rect(12, 3 + o, 2, 7, H); break;
    case 'long': full(9); p.rect(2, 3 + o, 12, 12, H); p.rect(3, 14 + o, 10, 1, c.hairD); break;
    case 'ponytail': full(7); p.rect(7, 9 + o, 2, 6, H); p.px(7, 14 + o, c.hairD); break;
    case 'bun': full(7); p.rect(6, -1 + o, 4, 2, H); break;
    case 'curly': p.rect(3, 0 + o, 10, 9, H); p.rect(2, 1 + o, 12, 7, H); [3, 6, 9, 12].forEach((x) => p.clear(x, 0 + o)); p.px(5, 3 + o, c.hairL); p.px(9, 5 + o, c.hairL); break;
    case 'cap': p.rect(4, 1 + o, 8, 1, H); p.rect(3, 2 + o, 10, 3, H); p.rect(6, 4 + o, 4, 1, c.hairD); p.rect(3, 5 + o, 10, 3, '#3b2418'); break;
    case 'hijab': p.rect(4, 0 + o, 8, 1, H); p.rect(3, 1 + o, 10, 1, H); p.rect(2, 2 + o, 12, 9, H); p.rect(2, 11 + o, 12, 3, H); p.rect(3, 13 + o, 10, 1, c.hairD); p.px(6, 3 + o, c.hairL); break;
    default: full(7);
  }
  if (L.extra === 'headphones') headphones(p, c, o, false);
}

function drawSide(p, L, pose, f) {
  const c = palette(L);
  const walk = pose === 'walk';
  const o = walk && (f === 1 || f === 3) ? -1 : 0;
  // legs
  if (pose !== 'sit') {
    p.rect(5, 17, 6, 1, c.pants);
    if (walk && (f === 1 || f === 3)) {
      const front = f === 1 ? 3 : 4;
      const back = f === 1 ? 9 : 8;
      p.rect(back, 18, 3, 3, c.pantsD); p.rect(back - 1, 21, 4, 1, shade(c.shoes, -10));
      p.rect(front, 18, 3, 3, c.pants); p.rect(front - 1, 21, 4, 1, c.shoes);
    } else {
      p.rect(5, 18, 6, 3, c.pants); p.rect(8, 18, 1, 3, c.pantsD); p.rect(4, 21, 7, 1, c.shoes);
    }
  }
  // torso + arm
  p.rect(5, 11 + o, 6, 6, c.shirt);
  p.rect(5, 11 + o, 6, 1, c.shirtL);
  p.rect(5, 16 + o, 6, 1, c.shirtD);
  if (L.extra === 'tie') p.rect(5, 12 + o, 1, 3, c.x);
  if (L.extra === 'scarf') { p.rect(4, 10 + o, 7, 2, c.x); p.rect(9, 12 + o, 2, 3, c.xD); }
  const ax = walk ? (f === 1 ? -1 : f === 3 ? 1 : 0) : pose === 'sit' ? -2 : 0;
  p.rect(7 + ax, 11 + o, 2, 4, c.shirtD);
  p.rect(7 + ax, 15 + o, 2, 1, c.skin);
  // head
  headBase(p, c, o);
  p.px(2, 7 + o, c.skin);
  const H = c.hair;
  const top = () => { p.rect(4, 1 + o, 8, 1, H); p.rect(3, 2 + o, 10, 2, H); p.px(6, 2 + o, c.hairL); };
  const back = (h) => p.rect(9, 4 + o, 4, h, H);
  switch (L.hairStyle) {
    case 'bald': p.px(7, 3 + o, c.skinL); break;
    case 'mohawk': p.rect(4, 0 + o, 8, 2, H); break;
    case 'short': top(); back(4); p.rect(3, 4 + o, 2, 1, H); break;
    case 'spiky': top(); back(4); [5, 8, 11].forEach((x) => p.px(x, 0 + o, H)); p.px(3, 4 + o, H); break;
    case 'side': top(); back(4); p.rect(3, 4 + o, 4, 1, H); break;
    case 'bob': top(); p.rect(8, 4 + o, 6, 6, H); p.rect(3, 4 + o, 4, 1, H); break;
    case 'long': top(); p.rect(8, 4 + o, 6, 11, H); p.rect(3, 4 + o, 3, 1, H); p.rect(13, 13 + o, 1, 2, c.hairD); break;
    case 'ponytail': top(); back(3); p.rect(13, 3 + o, 2, 2, H); p.rect(14, 5 + o, 1, 5, c.hairD); break;
    case 'bun': top(); back(4); p.rect(11, 0 + o, 3, 3, H); break;
    case 'curly': p.rect(3, 0 + o, 11, 4, H); [4, 7, 10, 13].forEach((x) => p.clear(x, 0 + o)); p.rect(9, 4 + o, 5, 5, H); p.px(6, 2 + o, c.hairL); break;
    case 'cap': p.rect(4, 1 + o, 8, 1, H); p.rect(3, 2 + o, 10, 2, H); p.rect(0, 4 + o, 5, 1, c.hairD); p.rect(10, 4 + o, 3, 3, '#3b2418'); break;
    case 'hijab': p.rect(4, 0 + o, 8, 1, H); p.rect(3, 1 + o, 10, 1, H); p.rect(2, 2 + o, 12, 9, H); p.rect(3, 4 + o, 5, 6, c.skin); p.px(2, 7 + o, c.skin); p.rect(3, 11 + o, 10, 2, H); p.px(11, 3 + o, c.hairL); break;
    default: top(); back(4);
  }
  if (!['bob', 'long', 'hijab'].includes(L.hairStyle)) p.rect(8, 6 + o, 1, 2, c.skinD); // ear
  p.rect(4, 6 + o, 1, 2, EYE);
  p.px(3, 9 + o, c.skinDD);
  if (L.extra === 'blush') p.px(5, 8 + o, '#f28b9b');
  if (L.eyewear === 'glasses' || L.eyewear === 'round') {
    const fr = L.eyewear === 'round' ? '#d9a35b' : '#2a2f3d';
    p.px(3, 6 + o, fr); p.px(5, 6 + o, fr); p.px(3, 7 + o, fr); p.px(5, 7 + o, fr); p.rect(6, 6 + o, 2, 1, fr); p.px(4, 6 + o, '#cfefff');
  } else if (L.eyewear === 'sunglasses') {
    p.rect(3, 6 + o, 3, 2, '#14141c'); p.rect(6, 6 + o, 2, 1, '#14141c');
  }
  if (L.extra === 'beard') { p.rect(3, 8 + o, 6, 3, H); p.px(2, 8 + o, H); }
  if (L.extra === 'mustache') p.rect(2, 8 + o, 3, 1, H);
  if (L.extra === 'headphones') headphones(p, c, o, true);
}

// ---------------------------------------------------------------------------
// Furniture & props
// ---------------------------------------------------------------------------

function cached(key, w, h, draw, outline = false) {
  let c = cache.get(key);
  if (c) return c;
  const p = painter(w, h);
  draw(p);
  c = outline ? addOutline(p.c) : p.c;
  cache.set(key, c);
  return c;
}

export function floorTile(kind, variant) {
  return cached(`floor|${kind}|${variant}`, 16, 16, (p) => {
    if (kind === 'carpet') {
      p.rect(0, 0, 16, 16, '#7b3f4f');
      for (let i = 0; i < 16; i += 4) for (let j = (i / 4) % 2 ? 2 : 0; j < 16; j += 4) p.px(j, i, '#8a4b5c');
      return;
    }
    if (kind === 'tile') {
      p.rect(0, 0, 16, 16, '#d7dde3');
      p.rect(0, 15, 16, 1, '#bfc7cf'); p.rect(15, 0, 1, 16, '#bfc7cf');
      p.px(3 + (variant % 5) * 2, 5, '#e6ebef');
      return;
    }
    // warm wooden planks
    const base = ['#e2bf8f', '#dfba88', '#e5c495'][variant % 3];
    p.rect(0, 0, 16, 16, base);
    for (let y = 3; y < 16; y += 4) p.rect(0, y, 16, 1, '#c9a26f');
    const seams = [[(variant * 5) % 16, 0], [(variant * 5 + 8) % 16, 4], [(variant * 3 + 4) % 16, 8], [(variant * 7 + 12) % 16, 12]];
    for (const [x, y] of seams) p.rect(x, y, 1, 3, '#cfa874');
    p.px((variant * 11) % 16, 1 + (variant % 2) * 8, '#ebd0a6');
    p.px((variant * 7 + 3) % 16, 6, '#d6b07c');
  });
}

export function wallFace(w, kind) {
  return cached(`wall|${w}|${kind}`, 16 * w, 32, (p) => {
    p.rect(0, 0, 16 * w, 32, '#efe4cf');
    p.rect(0, 0, 16 * w, 3, '#7a5a40');
    p.rect(0, 3, 16 * w, 1, '#5e4430');
    p.rect(0, 26, 16 * w, 1, '#c9b796');
    p.rect(0, 27, 16 * w, 5, '#a3774f');
    p.rect(0, 27, 16 * w, 1, '#b88a5e');
    for (let x = 0; x < 16 * w; x += 8) p.px(x + 3, 14, '#e6d9c0');
  });
}

export function windowSprite() {
  return cached('window', 40, 20, (p) => {
    p.rect(0, 0, 40, 20, '#6b4f36');
    p.rect(2, 2, 36, 16, '#8fd0f4');
    p.rect(2, 2, 36, 5, '#b9e4fb');
    p.rect(19, 2, 2, 16, '#6b4f36');
    p.rect(2, 9, 36, 1, '#6b4f36');
    p.px(6, 4, '#ffffff'); p.px(7, 4, '#ffffff'); p.px(26, 12, '#e6f6ff');
    p.rect(4, 15, 12, 3, '#7fc59a'); p.rect(24, 14, 10, 4, '#6ab585');
    p.rect(0, 18, 40, 2, '#8a6a4a');
  });
}

export function whiteboardSprite() {
  return cached('whiteboard', 44, 22, (p) => {
    p.rect(0, 0, 44, 20, '#9aa3b2');
    p.rect(1, 1, 42, 18, '#fbfbf7');
    p.rect(4, 4, 14, 1, '#4a6fd8'); p.rect(4, 7, 20, 1, '#9aa3b2'); p.rect(4, 10, 16, 1, '#9aa3b2');
    p.rect(27, 4, 10, 8, '#ffffff'); p.rect(27, 4, 10, 1, '#e94f4f'); p.rect(27, 4, 1, 8, '#e94f4f'); p.rect(36, 4, 1, 8, '#e94f4f'); p.rect(27, 11, 10, 1, '#e94f4f');
    p.rect(30, 14, 8, 1, '#2fa38a'); p.rect(4, 14, 8, 1, '#f08a3c');
    p.rect(2, 20, 40, 2, '#7d8593');
    p.rect(30, 19, 4, 1, '#e94f4f'); p.rect(35, 19, 4, 1, '#4a6fd8');
  });
}

export function clockSprite() {
  return cached('clock', 11, 11, (p) => {
    p.rect(2, 0, 7, 11, '#3a3f4b'); p.rect(0, 2, 11, 7, '#3a3f4b'); p.rect(1, 1, 9, 9, '#3a3f4b');
    p.rect(2, 1, 7, 9, '#fbfbf7'); p.rect(1, 2, 9, 7, '#fbfbf7');
    p.rect(5, 2, 1, 4, '#1b1424'); p.rect(5, 5, 3, 1, '#1b1424'); p.px(5, 5, '#e94f4f');
  });
}

export function framedArt(variant) {
  return cached(`art|${variant}`, 16, 14, (p) => {
    p.rect(0, 0, 16, 14, '#d9a35b');
    p.rect(1, 1, 14, 12, ['#3d5a80', '#2fa38a', '#7c5ad8'][variant % 3]);
    p.rect(2, 8, 12, 4, ['#98c1d9', '#9fe3c5', '#f27ab4'][variant % 3]);
    p.rect(9, 3, 3, 3, '#f2c94c');
  });
}

/** Regular work desk: 32x22, top surface 10px. */
export function deskSprite(accent) {
  return cached(`desk|${accent}`, 32, 22, (p) => {
    p.rect(0, 0, 32, 10, '#d9a66b');
    p.rect(0, 0, 32, 1, '#ecc48e');
    p.rect(0, 9, 32, 1, '#c08e55');
    p.rect(0, 10, 32, 9, '#b07d48');
    p.rect(0, 10, 32, 1, '#8a5d33');
    p.rect(2, 12, 12, 5, '#a37042'); p.rect(7, 14, 2, 1, '#e8c07a');
    p.rect(0, 19, 3, 3, '#6b4626'); p.rect(29, 19, 3, 3, '#6b4626');
    if (accent) p.rect(18, 15, 10, 2, accent);
  }, true);
}

export function leaderDeskSprite() {
  return cached('leaderDesk', 44, 22, (p) => {
    p.rect(0, 0, 44, 10, '#c98d55');
    p.rect(0, 0, 44, 1, '#e2ad74');
    p.rect(0, 9, 44, 1, '#a8733f');
    p.rect(0, 10, 44, 9, '#8f5d33');
    p.rect(0, 10, 44, 1, '#6b4626');
    p.rect(0, 12, 44, 1, '#e0b84a');
    p.rect(17, 13, 10, 5, '#e0b84a'); p.rect(18, 14, 8, 3, '#7a5a20');
    p.px(20, 15, '#f2d877'); p.px(22, 14, '#f2d877'); p.px(24, 15, '#f2d877'); p.rect(20, 16, 5, 1, '#f2d877');
    p.rect(0, 19, 3, 3, '#4e321b'); p.rect(41, 19, 3, 3, '#4e321b');
  }, true);
}

export function bossDeskSprite() {
  return cached('bossDesk', 64, 26, (p) => {
    p.rect(0, 0, 64, 12, '#8e4f3a');
    p.rect(0, 0, 64, 1, '#b06a50');
    p.rect(0, 11, 64, 1, '#73402f');
    p.rect(0, 12, 64, 11, '#6a3626');
    p.rect(0, 12, 64, 1, '#4d2519');
    p.rect(0, 14, 64, 1, '#e0b84a'); p.rect(0, 21, 64, 1, '#e0b84a');
    p.rect(22, 16, 20, 4, '#2a1a14'); p.rect(22, 16, 20, 1, '#e0b84a');
    p.rect(0, 23, 4, 3, '#3a1c12'); p.rect(60, 23, 4, 3, '#3a1c12');
  }, true);
}

export function chairSprite(color = '#3a3f4b', big = false) {
  const w = big ? 20 : 14;
  return cached(`chair|${color}|${big}`, w, 20, (p) => {
    const d = shade(color, -25), l = shade(color, 18);
    p.rect(1, 0, w - 2, 10, color);
    p.rect(2, 1, w - 4, 1, l);
    if (big) { p.rect(0, 2, 1, 8, d); p.rect(w - 1, 2, 1, 8, d); p.rect(4, 3, w - 8, 1, d); }
    p.rect(0, 10, w, 3, d);
    p.rect(w / 2 - 1, 13, 2, 3, '#5b606c');
    p.rect(2, 16, w - 4, 1, '#5b606c');
    p.px(2, 17, '#2a2f3d'); p.px(w - 3, 17, '#2a2f3d'); p.px(w / 2, 17, '#2a2f3d');
  }, true);
}

export function laptopSprite(glow) {
  return cached(`laptop|${glow}`, 14, 11, (p) => {
    p.rect(1, 0, 12, 3, '#7d8391');
    p.rect(2, 1, 10, 1, '#5b606c');
    p.rect(0, 3, 14, 8, '#c8ccd6');
    p.rect(0, 3, 14, 1, '#e3e6ec');
    p.rect(0, 10, 14, 1, '#8f95a3');
    p.rect(6, 6, 2, 2, glow || '#9aa0ad');
  }, true);
}

export function monitorBackSprite(glow) {
  return cached(`monitor|${glow}`, 18, 15, (p) => {
    p.rect(0, 0, 18, 11, '#3a3f4b');
    p.rect(1, 1, 16, 1, '#555b69');
    p.rect(7, 4, 4, 3, glow || '#4b5263');
    p.rect(7, 11, 4, 2, '#2a2f3d');
    p.rect(4, 13, 10, 2, '#2a2f3d');
  }, true);
}

export function mugSprite(color = '#f4f1e8') {
  return cached(`mug|${color}`, 5, 5, (p) => {
    p.rect(0, 0, 4, 5, color); p.rect(4, 1, 1, 2, color); p.rect(1, 0, 2, 1, '#6b4226');
  }, true);
}

export function paperSprite() {
  return cached('paper', 7, 8, (p) => {
    p.rect(0, 0, 7, 8, '#fbfbf7');
    p.rect(1, 2, 5, 1, '#9aa3b2'); p.rect(1, 4, 4, 1, '#9aa3b2'); p.rect(1, 6, 5, 1, '#9aa3b2');
    p.px(6, 0, '#d9dde3');
  }, true);
}

export function envelopeSprite(kind = 'message') {
  const flap = kind === 'question' ? '#f2c94c' : kind === 'reply' ? '#6fcf6f' : '#9fd8ff';
  return cached(`env|${kind}`, 9, 7, (p) => {
    p.rect(0, 0, 9, 7, '#fbfbf7');
    p.px(0, 0, flap); p.px(8, 0, flap);
    p.rect(1, 1, 2, 1, flap); p.rect(6, 1, 2, 1, flap); p.rect(3, 2, 3, 1, flap); p.px(4, 3, flap);
    p.rect(0, 6, 9, 1, '#c9ccd3');
  }, true);
}

export function paperStack(n) {
  const k = Math.min(n, 6);
  return cached(`stack|${k}`, 10, 4 + k * 2, (p) => {
    for (let i = 0; i < k; i++) {
      const y = (k - 1 - i) * 2;
      p.rect((i % 2), y, 9, 4, i % 2 ? '#f1efe6' : '#fbfbf7');
      p.rect((i % 2), y + 3, 9, 1, '#c9ccd3');
    }
  }, true);
}

export function inboxTray(n) {
  const k = Math.min(n, 5);
  return cached(`tray|${k}`, 16, 10, (p) => {
    for (let i = 0; i < k; i++) p.rect(2, 4 - i, 12, 2, i % 2 ? '#f1efe6' : '#fbfbf7');
    p.rect(0, 5, 16, 5, '#c9a23a'); p.rect(0, 5, 16, 1, '#f2d877'); p.rect(1, 6, 14, 3, '#b08a2a');
  }, true);
}

export function plantSprite(variant = 0) {
  return cached(`plant|${variant}`, 16, 24, (p) => {
    const leaf = ['#3fae5f', '#2f9e6a', '#55b84a'][variant % 3];
    const dark = shade(leaf, -28), light = shade(leaf, 25);
    if (variant % 2) {
      p.rect(5, 1, 6, 4, leaf); p.rect(3, 4, 10, 6, leaf); p.rect(2, 8, 12, 6, leaf); p.rect(4, 13, 8, 2, dark);
      [[5, 3], [9, 6], [4, 9], [11, 10], [7, 12]].forEach(([x, y]) => p.px(x, y, light));
      [[7, 5], [6, 10], [10, 8]].forEach(([x, y]) => p.px(x, y, dark));
    } else {
      p.rect(7, 0, 2, 14, dark);
      p.rect(2, 3, 5, 3, leaf); p.rect(9, 1, 5, 3, leaf); p.rect(1, 8, 6, 3, leaf); p.rect(9, 6, 6, 3, leaf); p.rect(4, 11, 8, 3, leaf);
      p.px(3, 4, light); p.px(11, 2, light); p.px(2, 9, light); p.px(12, 7, light);
    }
    p.rect(4, 15, 8, 8, '#c96f4a'); p.rect(3, 15, 10, 2, '#dd8a62'); p.rect(4, 21, 8, 2, '#a8573a');
  }, true);
}

export function bookshelfSprite(variant = 0) {
  return cached(`shelf|${variant}`, 32, 34, (p) => {
    p.rect(0, 0, 32, 34, '#7a5236');
    p.rect(0, 0, 32, 2, '#946645');
    const cols = ['#e94f4f', '#3fa7d6', '#f2c94c', '#6fcf6f', '#7c5ad8', '#f08a3c', '#f4f1e8', '#2fa38a'];
    for (let r = 0; r < 3; r++) {
      const y = 3 + r * 10;
      p.rect(2, y, 28, 8, '#4e321b');
      let x = 3;
      let i = r * 3 + variant;
      while (x < 28) {
        const w = 2 + ((i * 7) % 3);
        const h = 5 + ((i * 5) % 3);
        p.rect(x, y + 8 - h, w, h, cols[i % cols.length]);
        p.rect(x, y + 8 - h, w, 1, shade(cols[i % cols.length], 25));
        x += w + ((i % 4) === 0 ? 2 : 0);
        i++;
      }
      p.rect(2, y + 8, 28, 1, '#946645');
    }
  }, true);
}

export function waterCoolerSprite() {
  return cached('cooler', 12, 28, (p) => {
    p.rect(2, 0, 8, 9, '#7cc6f0'); p.rect(3, 1, 2, 6, '#b8e4fb'); p.rect(3, 9, 6, 1, '#4a8fc4');
    p.rect(1, 10, 10, 16, '#e9edf2'); p.rect(1, 10, 10, 1, '#ffffff'); p.rect(3, 14, 2, 2, '#4a6fd8'); p.rect(7, 14, 2, 2, '#e94f4f');
    p.rect(2, 18, 8, 1, '#c3c9d1'); p.rect(1, 26, 10, 2, '#9aa3b2');
  }, true);
}

export function coffeeCounterSprite() {
  return cached('coffee', 32, 26, (p) => {
    p.rect(0, 8, 32, 6, '#d9dde3'); p.rect(0, 8, 32, 1, '#f1f3f6');
    p.rect(0, 14, 32, 10, '#6f7d8c'); p.rect(0, 14, 32, 1, '#58646f'); p.rect(15, 15, 1, 9, '#58646f');
    p.rect(6, 18, 3, 1, '#c3c9d1'); p.rect(22, 18, 3, 1, '#c3c9d1');
    p.rect(3, 0, 11, 11, '#2a2f3d'); p.rect(4, 1, 9, 3, '#3a3f4b'); p.px(5, 2, '#6fcf6f'); p.rect(6, 6, 5, 1, '#9aa3b2'); p.rect(7, 8, 3, 2, '#f4f1e8');
    p.rect(19, 4, 4, 5, '#e94f4f'); p.rect(24, 5, 4, 4, '#3fa7d6'); p.rect(19, 4, 4, 1, '#f27a7a');
    p.rect(0, 24, 32, 2, '#4b5263');
  }, true);
}

export function couchSprite(color = '#3fa7d6') {
  return cached(`couch|${color}`, 48, 24, (p) => {
    const d = shade(color, -22), l = shade(color, 16);
    p.rect(0, 0, 48, 10, d); p.rect(2, 1, 44, 1, color);
    p.rect(0, 8, 6, 14, color); p.rect(42, 8, 6, 14, color); p.rect(0, 8, 6, 1, l); p.rect(42, 8, 6, 1, l);
    p.rect(6, 10, 18, 10, color); p.rect(24, 10, 18, 10, color); p.rect(23, 10, 2, 10, d);
    p.rect(6, 10, 36, 1, l);
    p.rect(1, 22, 3, 2, '#4e321b'); p.rect(44, 22, 3, 2, '#4e321b');
    p.rect(8, 4, 8, 6, '#f2c94c'); p.rect(32, 4, 8, 6, '#f27ab4');
  }, true);
}

export function tableSprite() {
  return cached('lowtable', 24, 14, (p) => {
    p.rect(0, 0, 24, 8, '#a37042'); p.rect(0, 0, 24, 1, '#c08e55'); p.rect(0, 8, 24, 3, '#7a5236');
    p.rect(1, 11, 2, 3, '#4e321b'); p.rect(21, 11, 2, 3, '#4e321b');
    p.rect(4, 2, 6, 4, '#fbfbf7'); p.rect(15, 2, 4, 4, '#f4f1e8'); p.rect(16, 3, 2, 2, '#6b4226');
  }, true);
}

export function printerSprite() {
  return cached('printer', 18, 18, (p) => {
    p.rect(0, 6, 18, 12, '#6f7d8c'); p.rect(1, 8, 16, 6, '#d9dde3'); p.rect(1, 8, 16, 1, '#f1f3f6');
    p.rect(3, 2, 12, 6, '#fbfbf7'); p.rect(4, 4, 8, 1, '#9aa3b2');
    p.px(14, 10, '#6fcf6f'); p.rect(4, 12, 10, 1, '#2a2f3d');
  }, true);
}

export function rugSprite(w, h) {
  return cached(`rug|${w}|${h}`, w, h, (p) => {
    p.rect(0, 0, w, h, '#9a4a4a');
    p.rect(2, 2, w - 4, h - 4, '#b65c5c');
    p.rect(4, 4, w - 8, h - 8, '#9a4a4a');
    p.rect(5, 5, w - 10, h - 10, '#a85252');
    for (let x = 6; x < w - 6; x += 6) { p.px(x, 3, '#e0b84a'); p.px(x, h - 4, '#e0b84a'); }
    for (let y = 6; y < h - 6; y += 6) { p.px(3, y, '#e0b84a'); p.px(w - 4, y, '#e0b84a'); }
  });
}

export function crownSprite() {
  return cached('crown', 7, 5, (p) => {
    p.px(0, 0, '#f2c94c'); p.px(3, 0, '#f2c94c'); p.px(6, 0, '#f2c94c');
    p.rect(0, 1, 7, 3, '#f2c94c'); p.rect(0, 4, 7, 1, '#c9a23a'); p.px(3, 2, '#e94f4f');
  }, true);
}

export function shadowSprite(w = 12) {
  return cached(`shadow|${w}`, w, 4, (p) => {
    p.g.fillStyle = 'rgba(40,20,10,0.22)';
    p.g.beginPath();
    p.g.ellipse(w / 2, 2, w / 2, 2, 0, 0, Math.PI * 2);
    p.g.fill();
  });
}
