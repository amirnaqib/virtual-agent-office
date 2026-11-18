// Shared by the browser (character builder / renderer) and the server (defaults).

export const SKIN = ['#ffe0c4', '#f6c9a0', '#e8b088', '#c98a5e', '#9c6440', '#6e4428', '#4a2c1a'];
export const HAIR_COLORS = ['#1c1418', '#3b2418', '#6b4226', '#a0663a', '#d9a35b', '#f1d785', '#c8c8d0', '#8a3b2e', '#d65a7c', '#5a7bd6', '#3fae8f', '#7a4fc4'];
export const CLOTH = ['#e94f4f', '#f08a3c', '#f2c94c', '#6fcf6f', '#2fa38a', '#3fa7d6', '#4a6fd8', '#7c5ad8', '#c45ad8', '#f27ab4', '#f4f1e8', '#9aa3b2', '#4b5263', '#2a2f3d', '#1a1c24', '#8b5a3c'];
export const HAIR_STYLES = ['short', 'spiky', 'side', 'bob', 'long', 'ponytail', 'bun', 'curly', 'mohawk', 'bald', 'hijab', 'cap'];
export const EYEWEAR = ['none', 'glasses', 'round', 'sunglasses'];
export const EXTRAS = ['none', 'headphones', 'beard', 'mustache', 'tie', 'scarf', 'blush'];

const pick = (a) => a[Math.floor(Math.random() * a.length)];

export function randomLook() {
  const hairStyle = pick(HAIR_STYLES);
  return {
    skin: pick(SKIN),
    hairStyle,
    hairColor: hairStyle === 'hijab' ? pick(CLOTH) : pick(HAIR_COLORS),
    shirt: pick(CLOTH),
    pants: pick(['#2a2f3d', '#1a1c24', '#4b5263', '#3d5a80', '#8b5a3c', '#6b6f7a']),
    shoes: pick(['#1a1c24', '#4a2c1a', '#f4f1e8', '#2a2f3d']),
    eyewear: Math.random() < 0.3 ? pick(EYEWEAR.slice(1)) : 'none',
    extra: Math.random() < 0.4 ? pick(EXTRAS.slice(1)) : 'none',
    extraColor: pick(CLOTH),
  };
}

export function normalizeLook(l = {}) {
  const base = randomLook();
  const color = (v, d) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : d);
  return {
    skin: color(l.skin, base.skin),
    hairStyle: HAIR_STYLES.includes(l.hairStyle) ? l.hairStyle : base.hairStyle,
    hairColor: color(l.hairColor, base.hairColor),
    shirt: color(l.shirt, base.shirt),
    pants: color(l.pants, base.pants),
    shoes: color(l.shoes, base.shoes),
    eyewear: EYEWEAR.includes(l.eyewear) ? l.eyewear : 'none',
    extra: EXTRAS.includes(l.extra) ? l.extra : 'none',
    extraColor: color(l.extraColor, base.extraColor),
    sprite: typeof l.sprite === 'string' ? l.sprite.slice(0, 64) : '',
  };
}
