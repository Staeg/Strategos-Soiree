import type { LaneId, Side } from './types.ts';

/**
 * The board: a hexagon of hexes, side 5 (radius 4), 61 cells, pointy-top,
 * in axial coordinates. Side 0's core sits on the bottom-left corner and
 * side 1's on the top-right; the two side lanes run along the rim and mid
 * runs straight across. Everything here is static, so it lives outside
 * MatchState and is computed once.
 *
 * The two sides are mirror images across the river: reflecting (q, r) to
 * (r, q) swaps the cores and maps every lane onto itself, so each side's top
 * laner faces the other's on equal ground.
 */
export const RADIUS = 4;

export interface Cell {
  q: number;
  r: number;
}

/** Neighbour directions, counter-clockwise from east. */
const DIRS: readonly Cell[] = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 }, { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

export const CELLS: readonly Cell[] = (() => {
  const out: Cell[] = [];
  for (let r = -RADIUS; r <= RADIUS; r++) {
    for (let q = -RADIUS; q <= RADIUS; q++) if (Math.abs(q + r) <= RADIUS) out.push({ q, r });
  }
  return out;
})();
export const N_CELLS = CELLS.length;

const INDEX = new Map(CELLS.map((c, i) => [`${c.q},${c.r}`, i]));
export const cellAt = (q: number, r: number): number => INDEX.get(`${q},${r}`) ?? -1;
export const mirror = (i: number): number => cellAt(CELLS[i]!.r, CELLS[i]!.q);

export const distance = (a: number, b: number): number => {
  const A = CELLS[a]!, B = CELLS[b]!;
  return (Math.abs(A.q - B.q) + Math.abs(A.r - B.r) + Math.abs(A.q + A.r - B.q - B.r)) / 2;
};

/** For each cell, its neighbour in each of the six directions, or -1 off the board. */
export const NEIGHBOURS: readonly (readonly number[])[] = CELLS.map((c) => DIRS.map((d) => cellAt(c.q + d.q, c.r + d.r)));

export const within = (centre: number, radius: number): number[] =>
  CELLS.flatMap((_, i) => (distance(centre, i) <= radius ? [i] : []));

/** Walks `steps` cells from (q, r) along direction d, returning every cell visited. */
const walk = (from: Cell, d: number, steps: number): number[] =>
  Array.from({ length: steps }, (_, k) => cellAt(from.q + DIRS[d]!.q * (k + 1), from.r + DIRS[d]!.r * (k + 1)));

const corner = (d: number): Cell => ({ q: DIRS[d]!.q * RADIUS, r: DIRS[d]!.r * RADIUS });

export const CORE: Record<Side, number> = { 0: cellAt(-RADIUS, RADIUS), 1: cellAt(RADIUS, -RADIUS) };

export const LANE_NAMES = ['top', 'mid', 'bot'] as const;

/**
 * Each lane as a path of cells from side 0's core to side 1's. Top climbs the
 * left rim and crosses the top; bot runs the bottom rim and climbs the right;
 * mid goes straight through the centre.
 */
export const LANES: Record<LaneId, readonly number[]> = (() => {
  const start = corner(4);
  const rim = (turns: number[]): number[] => {
    const path = [CORE[0]];
    let at = start;
    for (const d of turns) {
      path.push(...walk(at, d, RADIUS));
      at = CELLS[path[path.length - 1]!]!;
    }
    return path;
  };
  return {
    0: rim([2, 1, 0]),
    1: [CORE[0], ...walk(start, 1, 2 * RADIUS)],
    2: rim([0, 1, 2]),
  };
})();

export const laneCell = (lane: LaneId, pos: number): number => LANES[lane][pos]!;

export type StructureKind = 'core' | 'inner' | 'outer';

export interface StructureSite {
  kind: StructureKind;
  side: Side;
  lane: LaneId | -1;
  cell: number;
}

/**
 * Core on the corner, inner towers on its three neighbours, outer towers on
 * the next rim corner (or two steps further along mid). The rest of each
 * side lane between the outer towers is the battleground; mid has one
 * contested cell, the centre.
 */
export const STRUCTURE_SITES: readonly StructureSite[] = (() => {
  const sites: StructureSite[] = [];
  for (const side of [0, 1] as const) {
    sites.push({ kind: 'core', side, lane: -1, cell: CORE[side] });
    for (const lane of [0, 1, 2] as const) {
      const path = LANES[lane];
      const at = (k: number) => path[side === 0 ? k : path.length - 1 - k]!;
      sites.push({ kind: 'inner', side, lane, cell: at(1) });
      sites.push({ kind: 'outer', side, lane, cell: at(lane === 1 ? 3 : 4) });
    }
  }
  return sites;
})();

/** Which lanes pass through each cell (cores sit on all three). */
export const LANES_AT: readonly (readonly LaneId[])[] = CELLS.map((_, i) =>
  ([0, 1, 2] as const).filter((l) => LANES[l].includes(i)));

export const isLane = (cell: number): boolean => LANES_AT[cell]!.length > 0;

/** Which side's half a cell lies in: the nearer core, or null on the river. */
export const territory = (cell: number): Side | null => {
  const [a, b] = [distance(cell, CORE[0]), distance(cell, CORE[1])];
  return a === b ? null : a < b ? 0 : 1;
};

/** Everything off the lanes is jungle. */
export const JUNGLE: readonly number[] = CELLS.flatMap((_, i) => (isLane(i) ? [] : [i]));

/** The cell turned half a circle about the centre: what side 0 owns there, side 1 owns here. */
export const opposite = (i: number): number => cellAt(-CELLS[i]!.q, -CELLS[i]!.r);

/**
 * Each side's jungle, split by mid into the half towards top lane and the
 * half towards bot. Turning the board about its centre swaps the sides and
 * top with bot, so side 1's top half is side 0's bot half turned round.
 */
export const JUNGLE_HALVES: Record<Side, readonly [readonly number[], readonly number[]]> = (() => {
  const half = (side: Side, top: boolean) =>
    JUNGLE.filter((c) => territory(c) === side && (top ? CELLS[c]!.q + CELLS[c]!.r < 0 : CELLS[c]!.q + CELLS[c]!.r > 0));
  return { 0: [half(0, true), half(0, false)], 1: [half(1, true), half(1, false)] };
})();

/**
 * Shortest-path step tables. BFS from every target; ties broken by
 * direction order, reflected for side 1 so both sides walk mirror
 * images of each other's routes.
 */
const DIST: readonly Int8Array[] = CELLS.map((_, target) => {
  const d = new Int8Array(N_CELLS).fill(-1);
  d[target] = 0;
  const queue = [target];
  for (let k = 0; k < queue.length; k++) {
    const at = queue[k]!;
    for (const n of NEIGHBOURS[at]!) if (n >= 0 && d[n] === -1) { d[n] = d[at]! + 1; queue.push(n); }
  }
  return d;
});

export function stepToward(from: number, to: number, side: Side): number {
  if (from === to) return from;
  const d = DIST[to]!;
  for (let k = 0; k < 6; k++) {
    const n = NEIGHBOURS[from]![side === 0 ? k : 5 - k]!;
    if (n >= 0 && d[n] === d[from]! - 1) return n;
  }
  return from;
}

/**
 * For each cell, the most lane cells any shortest path from it to each core
 * crosses. Walking home, a hero takes the step that keeps this highest: of
 * the equally short ways back, the one that stays on the lanes longest.
 */
const LANE_WAY: Record<Side, Int8Array> = (() => {
  const way = (side: Side) => {
    const d = DIST[CORE[side]]!;
    const best = new Int8Array(N_CELLS);
    const order = CELLS.map((_, i) => i).sort((a, b) => d[a]! - d[b]!);
    for (const c of order) {
      const onward = NEIGHBOURS[c]!.filter((n) => n >= 0 && d[n] === d[c]! - 1);
      best[c] = (isLane(c) ? 1 : 0) + Math.max(0, ...onward.map((n) => best[n]!));
    }
    return best;
  };
  return { 0: way(0), 1: way(1) };
})();

/** A step home along the shortest way that keeps to the lanes the most. */
export function stepHome(from: number, side: Side): number {
  const home = CORE[side];
  if (from === home) return from;
  const d = DIST[home]!, way = LANE_WAY[side];
  let best = from;
  for (let k = 0; k < 6; k++) {
    const n = NEIGHBOURS[from]![side === 0 ? k : 5 - k]!;
    if (n >= 0 && d[n] === d[from]! - 1 && (best === from || way[n]! > way[best]!)) best = n;
  }
  return best;
}
