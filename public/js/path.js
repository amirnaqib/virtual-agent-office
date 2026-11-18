// 4-directional A* on a tile grid. `blocked(x, y)` → true when not walkable.
export function findPath(start, goal, width, height, blocked) {
  const key = (x, y) => y * width + x;
  const inside = (x, y) => x >= 0 && y >= 0 && x < width && y < height;
  if (!inside(goal.x, goal.y)) return null;
  const h = (x, y) => Math.abs(x - goal.x) + Math.abs(y - goal.y);
  const open = [{ x: start.x, y: start.y, g: 0, f: h(start.x, start.y) }];
  const came = new Map();
  const gScore = new Map([[key(start.x, start.y), 0]]);
  const closed = new Set();
  const isGoal = (x, y) => x === goal.x && y === goal.y;

  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];
    const ck = key(cur.x, cur.y);
    if (isGoal(cur.x, cur.y)) {
      const path = [{ x: cur.x, y: cur.y }];
      let k = ck;
      while (came.has(k)) {
        k = came.get(k);
        path.push({ x: k % width, y: Math.floor(k / width) });
      }
      return path.reverse();
    }
    if (closed.has(ck)) continue;
    closed.add(ck);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (!inside(nx, ny)) continue;
      if (blocked(nx, ny) && !isGoal(nx, ny)) continue;
      const nk = key(nx, ny);
      if (closed.has(nk)) continue;
      // tiny turn penalty keeps paths straighter
      const turn = came.has(ck) ? ((ck - came.get(ck)) !== (nk - ck) ? 0.15 : 0) : 0;
      const g = cur.g + 1 + turn;
      if (g < (gScore.get(nk) ?? Infinity)) {
        gScore.set(nk, g);
        came.set(nk, ck);
        open.push({ x: nx, y: ny, g, f: g + h(nx, ny) });
      }
    }
  }
  return null;
}
