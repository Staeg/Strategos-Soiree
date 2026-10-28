import { laneCell, type MatchView, type Side } from '@soiree/sim';
import { cellX, cellY } from './board.ts';

/**
 * Minion dots: a little swarm in each side's upper corner of a cell,
 * filled from the middle out so a few minions huddle and a wave spreads.
 */
export const SWARM: Record<Side, [number, number][]> = (() => {
  const spots: [number, number][] = [];
  for (let y = -14; y <= -6; y += 2) for (let x = -12; x <= 0; x += 2) spots.push([x + (y % 4 === 0 ? 1 : 0), y]);
  const centre = (p: [number, number]) => (p[0] + 6) ** 2 + ((p[1] + 10) * 1.4) ** 2 + ((p[0] * 7 + p[1] * 13) & 3);
  spots.sort((a, b) => centre(a) - centre(b));
  return { 0: spots, 1: spots.map(([x, y]) => [-x, y]) };
})();

export interface Dot {
  x: number;
  y: number;
  side: Side;
  /** Fades out a dot walking into the fog. */
  alpha: number;
}

const spot = (cell: number, side: Side, k: number): [number, number] => {
  const [dx, dy] = SWARM[side][Math.min(k, SWARM[side].length - 1)]!;
  return [cellX(cell) + dx, cellY(cell) + dy];
};

/**
 * Every minion dot this frame. Stacks that marched in the last step walk
 * from their old cell to their new one over the step, `t` of the way there,
 * so they keep pace with the heroes walking beside them: they leave from
 * the back of the swarm they left and fill the back of the one they join.
 */
export function minionDots(v: MatchView, t: number): Dot[] {
  const totals = minionTotals(v);
  const marches = v.events.flatMap((e) => (e.type === 'march' ? [e] : []));
  const arrived = new Map<number, number>();
  const left = new Map<number, number>();
  const dots: Dot[] = [];
  for (const e of marches) {
    const from = laneCell(e.lane, e.pos);
    const to = laneCell(e.lane, e.pos + (e.side === 0 ? 1 : -1));
    const [fromKey, toKey] = [from * 2 + e.side, to * 2 + e.side];
    const seen = totals.has(toKey);
    for (let j = 0; j < e.n; j++) {
      const a = spot(from, e.side, (totals.get(fromKey) ?? 0) + (left.get(fromKey) ?? 0) + j);
      // Arrivals take the back spots of the swarm they join, counting from its far end.
      const at = seen ? Math.max(0, totals.get(toKey)! - 1 - (arrived.get(toKey) ?? 0) - j) : j;
      const b = spot(to, e.side, at);
      dots.push({ x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, side: e.side, alpha: seen ? 1 : 1 - t });
    }
    left.set(fromKey, (left.get(fromKey) ?? 0) + e.n);
    if (seen) arrived.set(toKey, (arrived.get(toKey) ?? 0) + e.n);
  }
  for (const [key, n] of totals) {
    const [cell, side] = [key >> 1, (key & 1) as Side];
    const still = Math.min(n - Math.min(n, arrived.get(key) ?? 0), SWARM[side].length);
    for (let k = 0; k < still; k++) {
      const [x, y] = spot(cell, side, k);
      dots.push({ x, y, side, alpha: 1 });
    }
  }
  return dots;
}

/** Minions per cell and side, keyed `cell * 2 + side`. */
export function minionTotals(v: MatchView): Map<number, number> {
  const totals = new Map<number, number>();
  for (const m of v.minions) {
    const key = laneCell(m.lane, m.pos) * 2 + m.side;
    totals.set(key, (totals.get(key) ?? 0) + m.n);
  }
  return totals;
}
