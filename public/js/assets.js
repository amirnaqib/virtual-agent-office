// Optional custom asset pack (e.g. a top-down pack you bought on itch.io).
// Put the PNGs + manifest.json in ~/.virtual-agent-office/assets/ — see docs/ASSETS.md.
// Anything not listed in the manifest falls back to the built-in pixel art.

let manifest = null;
const images = {};

export async function loadAssetPack() {
  try {
    const res = await fetch('/custom-assets/manifest.json', { cache: 'no-cache' });
    if (res.status !== 200) return null;
    const m = await res.json();
    await Promise.all(Object.entries(m.images || {}).map(([key, file]) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { images[key] = img; resolve(); };
      img.onerror = () => { console.warn(`[assets] could not load ${file}`); resolve(); };
      img.src = `/custom-assets/${String(file).replace(/^\/+/, '')}`;
    })));
    manifest = m;
    return m;
  } catch {
    return null;
  }
}

export function hasPack() { return Boolean(manifest); }

/** Furniture/tile override: { image, x, y, w, h, ox?, oy? } */
export function packSprite(name) {
  const s = manifest?.sprites?.[name];
  if (!s || !images[s.image]) return null;
  return { img: images[s.image], ...s };
}

export function packCharacters() {
  return Object.keys(manifest?.characters || {});
}

/**
 * Character sheet override. Manifest entry:
 * { image, frameW, frameH, anchorX?, anchorY?, anims: { walk_down: {row, frames:[..], flip?}, idle_down, sit, ... } }
 */
export function packCharacterFrame(name, dir, pose, frame) {
  const ch = manifest?.characters?.[name];
  if (!ch || !images[ch.image]) return null;
  const a = ch.anims || {};
  const want = pose === 'sit' ? ['sit', 'idle_down'] : pose === 'walk' ? [`walk_${dir}`, `idle_${dir}`] : [`idle_${dir}`, `walk_${dir}`];
  let anim = null;
  let flip = false;
  for (const k of want) if (a[k]) { anim = a[k]; break; }
  if (!anim && dir === 'right') {
    const alt = pose === 'walk' ? a.walk_left : a.idle_left;
    if (alt) { anim = alt; flip = true; }
  }
  if (!anim) return null;
  const frames = anim.frames || [0];
  const col = frames[frame % frames.length];
  return {
    img: images[ch.image],
    sx: col * ch.frameW,
    sy: anim.row * ch.frameH,
    w: ch.frameW,
    h: ch.frameH,
    ax: ch.anchorX ?? ch.frameW / 2,
    ay: ch.anchorY ?? ch.frameH,
    flip: flip || Boolean(anim.flip),
  };
}
