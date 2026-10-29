import { CORE, LANES, LANES_AT, NEIGHBOURS, laneCell, distance, stepHome, stepToward } from './board.ts';
import {
  BASE_HEAL, MINION_DMG, MINION_STRIKE, ROLE_LANE, STANCES,
  TOWER_DMG, WAVE_EVERY, WAVE_SIZE, XP_MINION, XP_TOWER, campDef, heroDef, type MapOp,
} from './content.ts';
import { alive, awardXp, foe, heal, heroesOn, idiv, kill, maxHp, mitigate, stats } from './hero.ts';
import { addCharge, aura, boon, grow, shadowCell } from './powers.ts';
import { chance, randInt } from './rng.ts';
import { visibility } from './vision.ts';
import type { Camp, Hero, LaneId, MatchState, Side, Structure } from './types.ts';

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
    if (!h.retreating && h.hp * 100 < maxHp(h) * STANCES[h.stance].retreat) h.retreating = true;
  }
  for (const h of s.heroes) if (alive(h)) walk(s, h, vis[h.side]);
  laning(s);
  for (const h of s.heroes) {
    const ability = heroDef(h.id).map;
    if (ability.every === 0) continue;
    if (alive(h) && s.mapTick >= h.mapReadyAt && mapOp(s, h, ability.op, h.cell)) {
      h.mapReadyAt = s.mapTick + (boon(s, h, 'cadence') || ability.every);
      s.events.push({ type: 'ability', uid: h.uid });
    }
  }
  const held = skirmish(s);
  if (s.phase === 'over') return tidyMinions(s);
  march(s, held);

  for (const c of s.camps) {
    if (c.respawnAt >= 0 && s.mapTick >= c.respawnAt) [c.creeps, c.hp, c.fought, c.respawnAt] = [campDef(c.kind).creeps, campDef(c.kind).hp, 0, -1];
  }
  if ((s.mapTick - 1) % WAVE_EVERY === 0) {
    for (const lane of [0, 1, 2] as const) {
      s.minions.push({ lane, pos: 0, side: 0, n: WAVE_SIZE }, { lane, pos: LANES[lane].length - 1, side: 1, n: WAVE_SIZE });
    }
  }
  tidyMinions(s);
  s.wards = s.wards.filter((w) => w.until > s.mapTick);
}

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
  h.cell = h.retreating ? stepHome(h.cell, h.side) : stepToward(h.cell, goal(s, h, vis), h.side);
}

function goal(s: MatchState, h: Hero, vis: boolean[]): number {
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
 * Laning: a non-jungler standing on a lane cell with no allied minions on it
 * or further ahead along that lane is exposed. Every enemy hero on its cell
 * gets a free hit, and it withdraws a cell towards home. A hero under its own
 * tower is never exposed: it holds, and the enemy heroes there hit the tower
 * instead. Everyone exposed is found first, so two heroes caught out together
 * trade hits evenly.
 */
function laning(s: MatchState): void {
  const contested = (h: Hero) => alive(h) && h.role !== 'jungle' && h.cell !== CORE[0] && h.cell !== CORE[1]
    && heroesOn(s, h.cell, foe(h.side)).length > 0;
  const towerOf = (h: Hero) => s.structures.findIndex((st) => st.cell === h.cell && st.side === h.side && st.hp > 0);
  const exposed = s.heroes.filter((h) => contested(h) && towerOf(h) < 0 && uncovered(s, h));
  const hits = exposed.map((h) => heroesOn(s, h.cell, foe(h.side)).map((e) => ({ by: e, amount: mitigate(stats(e).dmg, stats(h).res) })));
  // Each tower shielding a hero takes the free hits of every enemy hero beside it, once.
  const sieges = new Map<number, number>();
  for (const h of s.heroes) {
    const ti = contested(h) && uncovered(s, h) ? towerOf(h) : -1;
    if (ti >= 0 && !sieges.has(ti)) sieges.set(ti, heroesOn(s, h.cell, foe(h.side)).reduce((n, e) => n + stats(e).dmg, 0));
  }
  for (const [ti, amount] of [...sieges].sort((a, b) => a[0] - b[0])) damageStructure(s, ti, amount);
  exposed.forEach((h, i) => {
    const lane = LANES_AT[h.cell]![0]!;
    const path = LANES[lane];
    const pos = path.indexOf(h.cell);
    const back = path[pos + (h.side === 0 ? -1 : 1)];
    for (const { amount } of hits[i]!) {
      h.hp -= amount;
      s.events.push({ type: 'hurt', uid: h.uid, amount, by: 'hero' });
    }
    if (h.hp <= 0) kill(s, h, hits[i]!.map((x) => x.by).filter(alive));
    else if (back !== undefined) h.cell = back;
  });
}

/** No allied minions on the hero's cell or ahead of it, on any lane through that cell. */
function uncovered(s: MatchState, h: Hero): boolean {
  const lanes = LANES_AT[h.cell]!;
  if (lanes.length === 0) return false;
  return lanes.every((lane) => {
    const pos = LANES[lane].indexOf(h.cell);
    return !s.minions.some((m) => m.lane === lane && m.side === h.side && m.n > 0 && (h.side === 0 ? m.pos >= pos : m.pos <= pos));
  });
}

/**
 * Junglers go first for the camp their side's strategy named, while it is
 * believed up. Otherwise they head for the camp they can start on soonest:
 * the walk there or the wait for it to stand again, whichever is longer, by
 * what their side last saw of it. Aggressive junglers also raid enemy camps
 * believed up.
 */
function campGoal(s: MatchState, h: Hero, vis: boolean[]): number {
  const intel = s.sides[h.side].campIntel;
  if (h.camp >= 0) {
    const c = s.camps[h.camp]!;
    if (intel[h.camp]! < 0 && !(vis[c.cell] && c.creeps === 0)) return c.cell;
    h.camp = -1;
  }
  let best = -1, bestKey = Infinity;
  s.camps.forEach((c, i) => {
    const seenEmpty = vis[c.cell] && c.creeps === 0;
    const wait = intel[i]! < 0 ? 0 : Math.max(seenEmpty ? 1 : 0, intel[i]! + campDef(c.kind).respawn - s.mapTick);
    if (c.owner !== h.side && (h.stance !== 'aggressive' || wait > 0)) return;
    const walk = distance(h.cell, c.cell);
    const key = (Math.max(walk, wait) * 100 + walk) * 100 + (c.owner === h.side ? 0 : 50) + i;
    if (key < bestKey) [best, bestKey] = [i, key];
  });
  return s.camps[best]!.cell;
}

function noteCamps(s: MatchState, vis: readonly [boolean[], boolean[]]): void {
  for (const side of [0, 1] as const) {
    const intel = s.sides[side].campIntel;
    s.camps.forEach((c, i) => {
      if (vis[side][c.cell]) intel[i] = c.creeps > 0 ? -1 : intel[i]! < 0 ? s.mapTick : intel[i]!;
    });
  }
}

/** Map abilities, run from the hero's cell. Returns false when there was nothing to do. */
export function mapOp(s: MatchState, h: Hero, op: MapOp, cell: number): boolean {
  const enemy = foe(h.side);
  switch (op.op) {
    case 'cull': {
      const died = minionsAt(s, cell, enemy) > 0 ? cullMinions(s, cell, enemy, op.n, true) : 0;
      if (op.store) addCharge(s, h, died, op.store);
      return died > 0;
    }
    case 'siphon': {
      if (minionsAt(s, cell, h.side) === 0) return false;
      if (op.who === 'self' && !op.grow && h.hp >= maxHp(h)) return false;
      const eaten = cullMinions(s, cell, h.side, op.n, false);
      const fed = op.who === 'self' ? [h] : s.heroes.filter((x) => x.side === h.side && alive(x) && distance(x.cell, cell) <= 1);
      for (const x of fed) heal(s, x, op.heal * eaten);
      for (let k = 0; k < eaten; k++) if (op.grow) grow(h, op.grow);
      return true;
    }
    case 'glean': {
      if (h.stance !== 'aggressive') return false;
      const from = [cell, ...NEIGHBOURS[cell]!].find((c) => c >= 0 && minionsAt(s, c, enemy) > 0);
      if (from === undefined) return false;
      const died = cullMinions(s, from, enemy, op.n, false);
      awardXp(s, [h], XP_MINION * died, XP_MINION * died);
      addCharge(s, h, died, op.store);
      return died > 0;
    }
    case 'convert': {
      const from = [cell, ...NEIGHBOURS[cell]!].find((c) => c >= 0 && minionsAt(s, c, enemy) > 0);
      if (from === undefined) return false;
      let left = op.n;
      for (const m of [...s.minions]) {
        if (left === 0) break;
        if (m.side !== enemy || laneCell(m.lane, m.pos) !== from || m.n === 0) continue;
        const k = Math.min(left, m.n);
        m.n -= k;
        left -= k;
        s.minions.push({ lane: m.lane, pos: m.pos, side: h.side, n: k });
      }
      const turned = op.n - left;
      awardXp(s, [h], XP_MINION * turned, XP_MINION * turned);
      return turned > 0;
    }
    case 'beam': {
      const dir = s.mapTick % 6;
      let at = cell;
      for (let k = 0; k < op.dist && NEIGHBOURS[at]![dir]! >= 0; k++) at = NEIGHBOURS[at]![dir]!;
      if (at === cell) return false;
      s.wards.push({ side: h.side, cell: at, radius: 0, until: s.mapTick + op.ticks });
      return true;
    }
    case 'bombard': {
      let best = -1;
      s.structures.forEach((st, i) => {
        if (st.side !== enemy || st.hp <= 0 || distance(cell, st.cell) > op.reach) return;
        if (best < 0 || distance(cell, st.cell) < distance(cell, s.structures[best]!.cell)) best = i;
      });
      if (best < 0) return false;
      damageStructure(s, best, op.amount);
      return true;
    }
    case 'shadow': case 'dusk': case 'carve':
      return false;
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

/**
 * Damage cuts down a camp's creeps in turn, spilling over from one to the
 * next; the heroes of `side` on the camp share the XP of every creep felled.
 */
function damageCamp(s: MatchState, camp: Camp, amount: number, side: Side): void {
  const def = campDef(camp.kind);
  let died = 0;
  for (let left = amount; left > 0 && camp.creeps > 0;) {
    const dealt = Math.min(left, camp.hp);
    camp.hp -= dealt;
    left -= dealt;
    if (camp.hp > 0) break;
    died++;
    if (--camp.creeps > 0) camp.hp = def.hp;
  }
  if (camp.creeps === 0 && died > 0) camp.respawnAt = s.mapTick + def.respawn;
  awardXp(s, heroesOn(s, camp.cell, side), 0, def.xp * died);
}

export function damageStructure(s: MatchState, index: number, amount: number): void {
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
 * Every cell fights at once. Heroes clear 1 or 2 minions by stance (or hit
 * a camp for 1 or 2 times their DMG), or chip a structure no minion shields.
 * Camp creeps strike on a fixed beat, every creep at once. Each minion strikes with a
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
  const campDamage: [number, number][] = s.camps.map(() => [0, 0]);
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
    const clear = st.clear + boon(s, h, 'clear');
    if (at(h.cell, enemy) > 0) {
      kill1(h.cell, enemy, clear);
      if (aura(s, h, 'carve')) addCharge(s, h, Math.min(clear, at(h.cell, enemy)));
    } else if (camp >= 0) campDamage[camp]![h.side] += mitigate(stats(h).dmg * clear, campDef(s.camps[camp]!.kind).res);
    if (si >= 0 && st.siege > 0 && s.structures[si]!.side === enemy && at(h.cell, enemy) === 0) hitStructure(si, st.siege);
  }

  s.minions.forEach((m, i) => {
    const cell = laneCell(m.lane, m.pos);
    const enemy = foe(m.side);
    const si = structureAt(cell);
    const tower = si >= 0 && s.structures[si]!.side === enemy;
    const heroes = heroesOn(s, cell, enemy).length > 0;
    if (at(cell, enemy) === 0 && !tower && !heroes) return;
    const strike = rallied(s, m.side, m.lane, cell) ? 2 * MINION_STRIKE : MINION_STRIKE;
    for (let k = 0; k < m.n; k++) {
      if (!chance(rng, strike)) continue;
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
    const def = campDef(c.kind);
    if (++c.fought % def.every !== 0) continue;
    for (let k = 0; k < c.creeps; k++) {
      const here = heroesOn(s, c.cell);
      const h = here[randInt(rng, here.length)]!;
      heroHits.push({ h, amount: mitigate(def.dmg, stats(h).res), by: 'creep' });
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
    for (const side of [first, foe(first)]) if (campDamage[i]![side] > 0) damageCamp(s, c, campDamage[i]![side], side);
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

/** Whether an allied hero's Vintage or Lamp Season doubles these minions' strikes. */
function rallied(s: MatchState, side: Side, lane: LaneId, cell: number): boolean {
  return s.heroes.some((h) => h.side === side && alive(h)
    && ((h.cell === cell && boon(s, h, 'rallyCell') > 0) || boon(s, h, 'rallyLane') === lane + 1));
}

/**
 * Enemy minions standing in a Long Shadow each stay put with its chance.
 * Returns how many of each stack it holds.
 */
function shadows(s: MatchState, held: number[]): number[] {
  const out = s.minions.map(() => 0);
  for (const h of s.heroes) {
    const shadow = aura(s, h, 'shadow');
    const cell = shadow ? shadowCell(h) : -1;
    if (cell < 0) continue;
    s.minions.forEach((m, i) => {
      if (m.side === h.side || laneCell(m.lane, m.pos) !== cell) return;
      for (let k = held[i]! + out[i]!; k < m.n; k++) if (chance(s.rng.map, shadow!.permille)) out[i]!++;
    });
  }
  return out;
}

/**
 * Minions free to walk advance one cell. A minion is pinned while enemy
 * minions or an enemy structure share its cell. The sides take turns going
 * first each tick, so two waves stepping towards each other always meet on a
 * cell rather than passing through one another.
 */
function march(s: MatchState, held: number[]): void {
  const shade = shadows(s, held);
  held = held.map((n, i) => n + shade[i]!);
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
      s.events.push({ type: 'march', lane: m.lane, pos: m.pos, side, n: movers });
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
