import { CORE, LANES, LANES_AT, laneCell, distance, stepToward } from './board.ts';
import {
  BASE_HEAL, CAMP_RESPAWN, CAMP_SIZE, CREEP_DMG, FIGHT_EVERY, MINION_DMG, MINION_STRIKE, ROLE_LANE, STANCES,
  TOWER_DMG, WAVE_EVERY, WAVE_SIZE, XP_MINION, XP_TOWER, heroDef, type MapOp,
} from './content.ts';
import { alive, awardXp, foe, heal, heroesOn, idiv, kill, maxHp, mitigate, stats } from './hero.ts';
import { chance, randInt } from './rng.ts';
import { visibility } from './vision.ts';
import type { Hero, LaneId, MatchState, Side, Structure } from './types.ts';

/**
 * One map tick, about a second of the match. Heroes decide and walk first;
 * then every cell fights, with all intents gathered before any is applied so
 * that iteration order never matters; then the minions that are free to walk
 * march one cell on.
 */
export function mapTick(s: MatchState): void {
  s.mapTick++;
  const vis = [visibility(s, 0), visibility(s, 1)] as const;
  noteCamps(s, vis);

  for (const h of s.heroes) {
    if (!alive(h)) {
      if (s.mapTick >= h.respawnAt) respawn(s, h);
      continue;
    }
    if (!h.retreating && h.hp * 100 < maxHp(h) * STANCES[h.stance].retreat) {
      h.retreating = true;
      h.roam = -1;
    }
  }
  for (const h of s.heroes) if (alive(h)) walk(s, h, vis[h.side]);
  for (const h of s.heroes) {
    const ability = heroDef(h.id).map;
    if (alive(h) && s.mapTick >= h.mapReadyAt && mapOp(s, h, ability.op, h.cell)) {
      h.mapReadyAt = s.mapTick + ability.every;
      s.events.push({ type: 'ability', uid: h.uid });
    }
  }
  const held = skirmish(s);
  if (s.phase === 'over') return tidyMinions(s);
  march(s, held);

  for (const c of s.camps) {
    if (c.respawnAt >= 0 && s.mapTick >= c.respawnAt) [c.creeps, c.respawnAt] = [CAMP_SIZE, -1];
  }
  if ((s.mapTick - 1) % WAVE_EVERY === 0) {
    for (const lane of [0, 1, 2] as const) {
      s.minions.push({ lane, pos: 0, side: 0, n: WAVE_SIZE }, { lane, pos: LANES[lane].length - 1, side: 1, n: WAVE_SIZE });
    }
  }
  tidyMinions(s);
  s.wards = s.wards.filter((w) => w.until > s.mapTick);
}

/** The end of the current map phase, as a map tick: when "until the next fight phase" runs out. */
export const nextFightTick = (s: MatchState): number => (idiv(s.mapTick, FIGHT_EVERY) + 1) * FIGHT_EVERY;

// ---- heroes ----------------------------------------------------------------

function respawn(s: MatchState, h: Hero): void {
  h.respawnAt = -1;
  h.cell = CORE[h.side];
  h.hp = maxHp(h);
  s.events.push({ type: 'respawn', uid: h.uid });
}

function walk(s: MatchState, h: Hero, vis: boolean[]): void {
  if (h.cell === CORE[h.side]) {
    heal(s, h, idiv(maxHp(h) * BASE_HEAL, 100));
    if (h.retreating) {
      if (h.hp < maxHp(h)) return;
      h.retreating = false;
    }
  }
  h.cell = stepToward(h.cell, goal(s, h, vis), h.side);
}

function goal(s: MatchState, h: Hero, vis: boolean[]): number {
  if (h.retreating) return CORE[h.side];
  if (h.roam >= 0) return h.roam;
  const lane = ROLE_LANE[h.role];
  return lane === -1 ? campGoal(s, h, vis) : laneGoal(s, h, lane, vis);
}

/**
 * Laners meet the nearest enemy minions they can see on their side of the
 * enemy's next tower; failing that they walk with their own wave's front,
 * and failing that they hold at their outer tower. They only step under an
 * enemy tower while their own minions are there to take its shots.
 */
function laneGoal(s: MatchState, h: Hero, lane: LaneId, vis: boolean[]): number {
  const path = LANES[lane];
  const pos = (k: number) => (h.side === 0 ? k : path.length - 1 - k);
  const cell = (k: number) => path[pos(k)]!;
  const own = (k: number) => s.minions.some((m) => m.lane === lane && m.pos === pos(k) && m.side === h.side && m.n > 0);
  let tower = 1;
  while (tower < path.length - 1 && !enemyStructure(s, cell(tower), h.side)) tower++;
  const limit = own(tower) ? tower : tower - 1;
  for (let k = 1; k <= limit; k++) if (vis[cell(k)] && minionsAt(s, cell(k), foe(h.side)) > 0) return cell(k);
  let front = 0;
  for (let k = 1; k <= limit; k++) if (own(k)) front = k;
  return cell(Math.max(front, Math.min(limit, lane === 1 ? 3 : 4)));
}

/**
 * Junglers walk to the nearest camp they believe is up: seen standing, or
 * not seen empty for a full respawn. Aggressive junglers count the enemy's
 * camps too.
 */
function campGoal(s: MatchState, h: Hero, vis: boolean[]): number {
  const intel = s.sides[h.side].campIntel;
  const up = (i: number) => {
    const c = s.camps[i]!;
    return vis[c.cell] ? c.creeps > 0 : intel[i]! < 0 || s.mapTick >= intel[i]! + CAMP_RESPAWN;
  };
  let best = -1, bestKey = Infinity;
  s.camps.forEach((c, i) => {
    if (!up(i) || (c.owner !== h.side && h.stance !== 'aggressive')) return;
    const key = distance(h.cell, c.cell) * 100 + (c.owner === h.side ? 0 : 10) + (i % 4);
    if (key < bestKey) [best, bestKey] = [i, key];
  });
  if (best >= 0) return s.camps[best]!.cell;
  if (s.camps.some((c) => c.cell === h.cell)) return h.cell;
  return s.camps.find((c) => c.owner === h.side)!.cell;
}

function noteCamps(s: MatchState, vis: readonly [boolean[], boolean[]]): void {
  for (const side of [0, 1] as const) {
    const intel = s.sides[side].campIntel;
    s.camps.forEach((c, i) => {
      if (vis[side][c.cell]) intel[i] = c.creeps > 0 ? -1 : intel[i]! < 0 ? s.mapTick : intel[i]!;
    });
  }
}

/** Map abilities, and command ultimates aimed at `cell`. Returns false when there was nothing to do. */
export function mapOp(s: MatchState, h: Hero, op: MapOp, cell: number): boolean {
  switch (op.op) {
    case 'cull':
      return minionsAt(s, cell, foe(h.side)) > 0 && cullMinions(s, cell, foe(h.side), op.n, true) > 0;
    case 'smite': {
      const camp = s.camps.find((c) => c.cell === cell && c.creeps > 0);
      return camp !== undefined && cullCreeps(s, camp, op.n, h.side) > 0;
    }
    case 'muster': {
      const lane = LANES_AT[cell]![0];
      if (lane === undefined || cell === CORE[0] || cell === CORE[1]) return false;
      s.minions.push({ lane, pos: LANES[lane].indexOf(cell), side: h.side, n: op.n });
      return true;
    }
    case 'siphon': {
      if (h.hp >= maxHp(h) || minionsAt(s, cell, h.side) === 0) return false;
      heal(s, h, op.heal * cullMinions(s, cell, h.side, op.n, false));
      return true;
    }
    case 'reveal':
      s.wards.push({ side: h.side, cell, radius: op.radius, until: op.ticks > 0 ? s.mapTick + op.ticks : nextFightTick(s) });
      return true;
  }
}

// ---- minions, creeps and structures ------------------------------------------

export function minionsAt(s: MatchState, cell: number, side: Side): number {
  let n = 0;
  for (const m of s.minions) if (m.side === side && laneCell(m.lane, m.pos) === cell) n += m.n;
  return n;
}

const enemyStructure = (s: MatchState, cell: number, side: Side): Structure | undefined =>
  s.structures.find((st) => st.cell === cell && st.side !== side && st.hp > 0);

/** Removes up to n minions of `side` from a cell; their killers on the cell share the XP. */
export function cullMinions(s: MatchState, cell: number, side: Side, n: number, award: boolean): number {
  let left = n;
  for (const m of s.minions) {
    if (left === 0) break;
    if (m.side !== side || laneCell(m.lane, m.pos) !== cell) continue;
    const k = Math.min(left, m.n);
    m.n -= k;
    left -= k;
  }
  const died = n - left;
  if (died > 0) {
    s.events.push({ type: 'minions', cell, side, died });
    if (award) awardXp(s, heroesOn(s, cell, foe(side)), XP_MINION * died, XP_MINION * died);
  }
  return died;
}

function cullCreeps(s: MatchState, camp: MatchState['camps'][number], n: number, side: Side): number {
  const died = Math.min(n, camp.creeps);
  camp.creeps -= died;
  if (camp.creeps === 0 && died > 0) camp.respawnAt = s.mapTick + CAMP_RESPAWN;
  awardXp(s, heroesOn(s, camp.cell, side), XP_MINION * died, XP_MINION * died);
  return died;
}

function damageStructure(s: MatchState, index: number, amount: number): void {
  const st = s.structures[index]!;
  if (st.hp <= 0) return;
  const dealt = Math.min(st.hp, s.mapTick < st.guardedUntil ? idiv(amount, 2) : amount);
  st.hp -= dealt;
  s.events.push({ type: 'structure', index, amount: dealt });
  if (st.hp > 0) return;
  s.events.push({ type: 'fall', index });
  awardXp(s, s.heroes.filter((h) => h.side !== st.side), XP_TOWER, 0);
  if (st.kind === 'core') {
    s.phase = 'over';
    s.winner = foe(st.side);
    s.events.push({ type: 'phase', phase: 'over' });
  }
}

/**
 * Every cell fights at once. Heroes clear 1 or 2 minions (or creeps) by
 * stance, or chip a structure no minion shields. Each minion strikes with a
 * 10% chance: an enemy minion if any, else the structure, else a hero (and a
 * minion that strikes a hero stays put this tick, which staggers waves).
 * Structures kill a minion a tick, or shoot a hero no minion shields.
 * Returns how many minions of each stack stay put.
 */
function skirmish(s: MatchState): number[] {
  const rng = s.rng.map;
  const count = new Map<number, number>();
  const at = (cell: number, side: Side) => count.get(cell * 2 + side) ?? 0;
  for (const m of s.minions) count.set(laneCell(m.lane, m.pos) * 2 + m.side, at(laneCell(m.lane, m.pos), m.side) + m.n);
  const structureAt = (cell: number) => s.structures.findIndex((st) => st.cell === cell && st.hp > 0);
  const randomHero = (cell: number, side: Side): Hero | undefined => {
    const here = heroesOn(s, cell, side);
    return here.length ? here[randInt(rng, here.length)] : undefined;
  };

  const kills = new Map<number, number>();
  const kill1 = (cell: number, side: Side, n: number) => kills.set(cell * 2 + side, (kills.get(cell * 2 + side) ?? 0) + n);
  const creepKills: [number, number][] = s.camps.map(() => [0, 0]);
  const structureHits = new Map<number, number>();
  const hitStructure = (i: number, n: number) => structureHits.set(i, (structureHits.get(i) ?? 0) + n);
  const heroHits: { h: Hero; amount: number; by: 'minion' | 'tower' | 'creep' }[] = [];
  const held = s.minions.map(() => 0);

  for (const h of s.heroes) {
    if (!alive(h)) continue;
    const st = STANCES[h.stance];
    const enemy = foe(h.side);
    const camp = s.camps.findIndex((c) => c.cell === h.cell && c.creeps > 0);
    const si = structureAt(h.cell);
    if (at(h.cell, enemy) > 0) kill1(h.cell, enemy, st.clear);
    else if (camp >= 0) creepKills[camp]![h.side] += st.clear;
    if (si >= 0 && st.siege > 0 && s.structures[si]!.side === enemy && at(h.cell, enemy) === 0) hitStructure(si, st.siege);
  }

  s.minions.forEach((m, i) => {
    const cell = laneCell(m.lane, m.pos);
    const enemy = foe(m.side);
    const si = structureAt(cell);
    const tower = si >= 0 && s.structures[si]!.side === enemy;
    const heroes = heroesOn(s, cell, enemy).length > 0;
    if (at(cell, enemy) === 0 && !tower && !heroes) return;
    for (let k = 0; k < m.n; k++) {
      if (!chance(rng, MINION_STRIKE)) continue;
      if (at(cell, enemy) > 0) kill1(cell, enemy, 1);
      else if (tower) hitStructure(si, MINION_DMG);
      else {
        const h = randomHero(cell, enemy)!;
        heroHits.push({ h, amount: mitigate(MINION_DMG, stats(h).res), by: 'minion' });
        held[i]!++;
      }
    }
  });

  for (const c of s.camps) {
    if (c.creeps === 0 || heroesOn(s, c.cell).length === 0) continue;
    for (let k = 0; k < c.creeps; k++) {
      if (!chance(rng, MINION_STRIKE)) continue;
      const here = heroesOn(s, c.cell);
      const h = here[randInt(rng, here.length)]!;
      heroHits.push({ h, amount: mitigate(CREEP_DMG, stats(h).res), by: 'creep' });
    }
  }

  s.structures.forEach((st, i) => {
    if (st.hp <= 0) return;
    const enemy = foe(st.side);
    if (at(st.cell, enemy) > 0) return void kill1(st.cell, enemy, 1);
    const h = randomHero(st.cell, enemy);
    if (h) heroHits.push({ h, amount: mitigate(TOWER_DMG, stats(h).res), by: 'tower' });
  });

  for (const key of [...kills.keys()].sort((a, b) => a - b)) cullMinions(s, key >> 1, (key & 1) as Side, kills.get(key)!, true);
  s.camps.forEach((c, i) => {
    const first: Side = (s.mapTick & 1) as Side;
    for (const side of [first, foe(first)]) if (creepKills[i]![side] > 0) cullCreeps(s, c, creepKills[i]![side], side);
  });
  for (const [i, n] of [...structureHits].sort((a, b) => a[0] - b[0])) {
    damageStructure(s, i, n);
    if (s.phase === 'over') return held;
  }
  for (const { h, amount, by } of heroHits) {
    if (!alive(h)) continue;
    h.hp -= amount;
    s.events.push({ type: 'hurt', uid: h.uid, amount, by });
  }
  for (const h of s.heroes) if (alive(h) && h.hp <= 0) kill(s, h, heroesOn(s, h.cell, foe(h.side)));
  return held;
}

/**
 * Minions free to walk advance one cell. A minion is pinned while enemy
 * minions or an enemy structure share its cell. The sides take turns going
 * first each tick, so two waves stepping towards each other always meet on a
 * cell rather than passing through one another.
 */
function march(s: MatchState, held: number[]): void {
  const count = s.minions.length;
  const first: Side = (s.mapTick & 1) as Side;
  for (const side of [first, foe(first)]) {
    for (let i = 0; i < count; i++) {
      const m = s.minions[i]!;
      if (m.side !== side) continue;
      const movers = m.n - Math.min(held[i]!, m.n);
      const next = m.pos + (side === 0 ? 1 : -1);
      if (movers === 0 || next < 0 || next >= LANES[m.lane].length) continue;
      const cell = laneCell(m.lane, m.pos);
      if (minionsAt(s, cell, foe(side)) > 0 || enemyStructure(s, cell, side)) continue;
      m.n -= movers;
      s.minions.push({ lane: m.lane, pos: next, side, n: movers });
    }
  }
}

/** Merges stacks that share a lane, cell and side, and drops empty ones, in a canonical order. */
function tidyMinions(s: MatchState): void {
  const merged = new Map<number, number>();
  for (const m of s.minions) {
    const key = (m.lane * 16 + m.pos) * 2 + m.side;
    merged.set(key, (merged.get(key) ?? 0) + m.n);
  }
  s.minions = [...merged].filter(([, n]) => n > 0).sort((a, b) => a[0] - b[0])
    .map(([key, n]) => ({ lane: (key >> 5) as LaneId, pos: (key >> 1) & 15, side: (key & 1) as Side, n }));
}
