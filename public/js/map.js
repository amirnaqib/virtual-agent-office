// Office floor plan. Everything is in pixels (1 tile = 16px) unless noted.
export const T = 16;
const DESK_COLS = [11, 17, 7, 21, 3, 25]; // left tile of each 2-tile desk, centre-out
const FIRST_DESK_ROW = 12;

export function buildLayout(memberCount) {
  const W = 30;
  const rows = Math.max(2, Math.ceil(memberCount / DESK_COLS.length));
  const deskRows = Array.from({ length: rows }, (_, i) => FIRST_DESK_ROW + i * 4);
  const H = deskRows[deskRows.length - 1] + 4;
  const blocked = new Uint8Array(W * H);
  const block = (x, y) => { if (x >= 0 && y >= 0 && x < W && y < H) blocked[y * W + x] = 1; };
  const blockRect = (x0, y0, w, h) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) block(x, y); };

  // walls: top face (rows 0-1), sides, bottom
  blockRect(0, 0, W, 2);
  blockRect(0, 0, 1, H);
  blockRect(W - 1, 0, 1, H);
  blockRect(0, H - 1, W, 1);

  const cx = (W * T) / 2; // 240

  // boss desk (row 5, 4 tiles)
  const bossDesk = { kind: 'boss', cx, row: 5, w: 64, h: 26, bottom: 6 * T, seat: { x: cx, y: 5 * T - 2 } };
  blockRect(13, 5, 4, 1);
  const bossVisit = [{ x: cx, y: 6 * T + 12 }, { x: cx - 22, y: 6 * T + 12 }, { x: cx + 22, y: 6 * T + 12 }];

  // leader desk (row 9)
  const leaderDesk = { kind: 'leader', cx, row: 9, w: 44, h: 22, bottom: 10 * T, seat: { x: cx, y: 9 * T - 2 } };
  blockRect(13, 9, 4, 1);
  block(15, 8);
  const leaderVisit = [{ x: cx, y: 10 * T + 12 }, { x: cx - 20, y: 10 * T + 12 }, { x: cx + 20, y: 10 * T + 12 }];

  // team desks
  const desks = [];
  for (const r of deskRows) {
    for (const x of DESK_COLS) {
      desks.push({ kind: 'member', tx: x, row: r, cx: x * T + T, w: 32, h: 22, bottom: (r + 1) * T, seat: { x: x * T + T, y: r * T - 2 } });
      blockRect(x, r, 2, 1);
      block(x + 1, r - 1); // the chair: only its owner walks into it (path goal)
    }
  }
  // fill order: first row centre-out, then next row
  desks.sort((a, b) => a.row - b.row || DESK_COLS.indexOf(a.tx) - DESK_COLS.indexOf(b.tx));

  // decor
  const decor = [];
  const add = (sprite, x, bottom, tiles, extra = {}) => {
    decor.push({ sprite, x, bottom, ...extra });
    for (const [tx, ty] of tiles) block(tx, ty);
  };
  add('bookshelf', 2 * T, 4 * T, [[2, 2], [3, 2], [2, 3], [3, 3]], { variant: 0 });
  add('bookshelf', 26 * T, 4 * T, [[26, 2], [27, 2], [26, 3], [27, 3]], { variant: 3 });
  add('plant', 1 * T, 4 * T, [[1, 3], [1, 2]], { variant: 1 });
  add('plant', 28 * T, 4 * T, [[28, 3], [28, 2]], { variant: 0 });
  add('plant', 9 * T, 5 * T, [[9, 4]], { variant: 2 });
  add('plant', 20 * T, 5 * T, [[20, 4]], { variant: 1 });
  add('couch', 1 * T, 9 * T, [[1, 8], [2, 8], [3, 8]], { color: '#3fa7d6' });
  add('table', 1 * T + 12, 10 * T + 2, [[2, 9]]);
  add('coffee', 25 * T, 9 * T, [[25, 8], [26, 8]]);
  add('cooler', 28 * T + 2, 9 * T, [[28, 8]]);
  add('printer', 11 * T - 1, 9 * T + 4, [[11, 8]]);
  add('plant', 18 * T, 9 * T + 4, [[18, 8]], { variant: 2 });
  add('plant', 1 * T, (H - 1) * T, [[1, H - 2]], { variant: 0 });
  add('plant', 28 * T, (H - 1) * T, [[28, H - 2]], { variant: 1 });
  add('plant', 14 * T + 8, (H - 1) * T, [[14, H - 2], [15, H - 2]], { variant: 2 });

  const wallDecor = [
    { sprite: 'art', x: 26, y: 8, variant: 0 },
    { sprite: 'window', x: 74, y: 5 },
    { sprite: 'whiteboard', x: 132, y: 4 },
    { sprite: 'plaque', x: cx, y: 8 },
    { sprite: 'clock', x: 322, y: 9 },
    { sprite: 'window', x: 362, y: 5 },
    { sprite: 'art', x: 438, y: 8, variant: 1 },
  ];
  const rugs = [
    { x: 10 * T, y: 3 * T - 4, w: 10 * T, h: 4 * T + 8 },
    { x: 1 * T, y: 9 * T + 2, w: 3 * T + 8, h: 2 * T - 4, small: true },
  ];

  const pois = [
    { x: 28 * T + 8, y: 9 * T + 12, face: 'up' },
    { x: 26 * T, y: 9 * T + 12, face: 'up' },
    { x: 5 * T, y: 9 * T + 12, face: 'left' },
    { x: 6 * T, y: 2 * T + 12, face: 'up' },
    { x: 23 * T, y: 2 * T + 12, face: 'up' },
    { x: 12 * T, y: 9 * T + 12, face: 'up' },
    { x: 2 * T + 8, y: 4 * T + 12, face: 'up' },
  ].filter((p) => !blocked[Math.floor(p.y / T) * W + Math.floor(p.x / T)]);

  return {
    W, H, T, blocked,
    isBlocked: (x, y) => x < 0 || y < 0 || x >= W || y >= H || blocked[y * W + x] === 1,
    bossDesk, leaderDesk, desks, decor, wallDecor, rugs, pois, bossVisit, leaderVisit,
  };
}

export const toTile = (p) => ({ x: Math.floor(p.x / T), y: Math.floor(p.y / T) });
