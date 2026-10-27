import { JUNGLE, LANES, LANES_AT, distance } from './board.ts';
import { heroDef, type MapOp } from './content.ts';
import { alive } from './hero.ts';
import type { Boon, Hero, MatchState, Side } from './types.ts';

/**
 * The hooks hero powers hang on: auras other systems consult, charges,
 * permanent growth, map-phase boons. Each is keyed on an op, never a name.
 */

/** The hero's aura of this kind, if it has one and nothing has silenced it. */
export function aura<K extends MapOp['op']>(s: MatchState, h: Hero, kind: K): Extract<MapOp, { op: K }> | undefined {
  const op = heroDef(h.id).map.op;
  return op.op === kind && alive(h) && s.mapTick >= h.mapReadyAt ? (op as Extract<MapOp, { op: K }>) : undefined;
}

/** Adds charges (capped at `max`), growing Carve heroes and reaching charge ascensions. */
export function addCharge(s: MatchState, h: Hero, n: number, max = Infinity): void {
  if (n <= 0) return;
  const before = h.charge;
  h.charge = Math.min(max, h.charge + n);
  const def = heroDef(h.id);
  const carve = def.map.op.op === 'carve' ? def.map.op : undefined;
  if (carve) {
    const steps = Math.floor(h.charge / carve.per) - Math.floor(before / carve.per);
    for (let k = 0; k < steps; k++) grow(h, carve.grow);
  }
  if (def.ult.kind === 'ascension' && !h.ascended && h.charge >= def.ult.charge) {
    h.ascended = true;
    s.events.push({ type: 'ascend', uid: h.uid });
  }
}

export function grow(h: Hero, by: { dmg?: number; spd?: number }): void {
  h.grown.dmg += by.dmg ?? 0;
  h.grown.spd += by.spd ?? 0;
}

/** The strongest live boon of a kind, or 0. */
export function boon(s: MatchState, h: Hero, kind: Boon['kind']): number {
  return h.boons.reduce((v, b) => (b.kind === kind && b.until > s.mapTick ? Math.max(v, b.value) : v), 0);
}

export function addBoon(h: Hero, b: Boon): void {
  h.boons = [...h.boons.filter((x) => x.kind !== b.kind), b];
}

/** The lane cell just ahead of the hero, towards the enemy, or -1 off the lanes. */
export function shadowCell(h: Hero): number {
  const lane = LANES_AT[h.cell]?.[0];
  if (lane === undefined) return -1;
  const path = LANES[lane];
  return path[path.indexOf(h.cell) + (h.side === 0 ? 1 : -1)] ?? -1;
}

export function nearestJungle(cell: number): number {
  return JUNGLE.reduce((a, b) => (distance(cell, b) < distance(cell, a) ? b : a));
}

/** Whether `side` can see hero `h`, given the cells it sees. Dusk heroes hide unless met. */
export function heroSeen(s: MatchState, side: Side, h: Hero, vis: readonly boolean[]): boolean {
  if (h.side === side) return true;
  if (!alive(h) || !vis[h.cell]) return false;
  if (!aura(s, h, 'dusk')) return true;
  return s.heroes.some((x) => x.side === side && alive(x) && x.cell === h.cell)
    || s.structures.some((st) => st.side === side && st.hp > 0 && st.cell === h.cell);
}
