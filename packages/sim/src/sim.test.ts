import { describe, expect, it } from 'vitest';
import { createAgent, DIFFICULTIES } from './ai.ts';
import { CELLS, CORE, JUNGLE, JUNGLE_HALVES, LANES, N_CELLS, NEIGHBOURS, STRUCTURE_SITES, distance, isLane, mirror, opposite, stepHome, stepToward } from './board.ts';
import {
  CAMP_IDS, CARDS_KEPT, DOUBLED, DRAW_EVERY, FIGHT_EVERY, MANA_PER_PHASE, STAPLES, WAVE_SIZE, XP_UNIT, buildDeck, campDef, lineups,
  type CardId, type HeroId,
} from './content.ts';
import { awardXp, kill, maxHp, stats } from './hero.ts';
import { runMatch } from './match.ts';
import { cardReach } from './reach.ts';
import { nextU32, randInt, seedRng } from './rng.ts';
import { advance, createMatch, hashState, step } from './sim.ts';
import type { Command, GameEvent, MatchState, Target } from './types.ts';
import { viewFor, visibility } from './vision.ts';

const duel = (seed: number, steps = 3000) =>
  runMatch(seed, [createAgent('tactician', seed + 1), createAgent('tactician', seed + 2)], steps, true);

const commits = (): Command[] => ([0, 1] as const).map((side) => ({ type: 'commit' as const, side, discard: [] }));

/** Steps a match with no orders and no plays until `until` holds. */
function idle(s: MatchState, until: (s: MatchState) => boolean): MatchState {
  while (!until(s)) advance(s, s.phase === 'plan' ? commits() : []);
  return s;
}

/** Idles to the planning of fight phase `n`. */
const toFight = (s: MatchState, n = 1) => idle(s, (x) => x.phase === 'plan' && x.fightPhase === n);

/** A match past its opening strategy, on the map at tick 0. */
const begun = (seed: number, teams?: [HeroId[], HeroId[]]) => idle(createMatch(seed, teams), (x) => x.phase === 'map');

/** Idles to the first fight phase and opens its play stage, whatever the hands hold. */
function playStage(s: MatchState): MatchState {
  toFight(s);
  s.stage = 'play';
  for (const me of s.sides) [me.plays, me.committed] = [[], false];
  return s;
}

describe('rng', () => {
  it('repeats per seed and separates streams', () => {
    const a = seedRng(42, 1), b = seedRng(42, 1), c = seedRng(42, 2);
    const take = (s: typeof a) => Array.from({ length: 8 }, () => nextU32(s));
    const [ta, tb, tc] = [take(a), take(b), take(c)];
    expect(ta).toEqual(tb);
    expect(ta).not.toEqual(tc);
  });

  it('stays in bounds', () => {
    const s = seedRng(7, 0);
    for (let i = 0; i < 5000; i++) {
      const v = randInt(s, 31);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(31);
    }
  });
});

describe('board', () => {
  it('is a side-5 hexagon of 61 cells', () => {
    expect(N_CELLS).toBe(61);
    for (let i = 0; i < N_CELLS; i++) expect(NEIGHBOURS[i]!.filter((n) => n >= 0).length).toBeGreaterThanOrEqual(3);
  });

  it('runs side lanes along the rim and mid through the centre', () => {
    expect(LANES[0]).toHaveLength(13);
    expect(LANES[2]).toHaveLength(13);
    expect(LANES[1]).toHaveLength(9);
    for (const lane of Object.values(LANES)) {
      expect(lane[0]).toBe(CORE[0]);
      expect(lane[lane.length - 1]).toBe(CORE[1]);
      for (let k = 1; k < lane.length; k++) expect(distance(lane[k - 1]!, lane[k]!)).toBe(1);
    }
    expect(CELLS[LANES[1][4]!]).toEqual({ q: 0, r: 0 });
  });

  it('flanks each core with three inner towers, then 2 empty cells (1 on mid) before the outer tower', () => {
    for (const side of [0, 1] as const) {
      const inner = STRUCTURE_SITES.filter((s) => s.side === side && s.kind === 'inner');
      expect(inner.map((s) => distance(s.cell, CORE[side]))).toEqual([1, 1, 1]);
      for (const lane of [0, 1, 2] as const) {
        const outer = STRUCTURE_SITES.find((s) => s.side === side && s.kind === 'outer' && s.lane === lane)!;
        expect(distance(outer.cell, CORE[side])).toBe(lane === 1 ? 3 : 4);
      }
    }
  });

  it('mirrors the sides across the river', () => {
    for (const lane of Object.values(LANES)) expect([...lane].reverse()).toEqual(lane.map(mirror));
    for (const s of STRUCTURE_SITES.filter((x) => x.side === 0)) {
      expect(STRUCTURE_SITES.some((t) => t.side === 1 && t.kind === s.kind && t.cell === mirror(s.cell))).toBe(true);
    }
  });
});

describe('map phase', () => {
  it('spawns waves of 12 every 8 ticks that walk a cell per tick until they meet', () => {
    const s = idle(createMatch(5), (x) => x.mapTick === 1);
    expect(s.minions.filter((m) => m.side === 0 && m.pos === 0).map((m) => m.n)).toEqual([WAVE_SIZE, WAVE_SIZE, WAVE_SIZE]);
    idle(s, (x) => x.mapTick === 4);
    const top = s.minions.filter((m) => m.lane === 0 && m.side === 0);
    expect(top.map((m) => m.pos)).toEqual([3]);
    idle(s, (x) => x.mapTick === 9);
    expect(s.minions.filter((m) => m.lane === 0 && m.side === 0 && m.pos === 0)).toHaveLength(1);
  });

  it('calls a fight phase every 50 map ticks, with a card drawn every 7', () => {
    const s = toFight(createMatch(5));
    expect(s.mapTick).toBe(FIGHT_EVERY);
    expect(s.sides[0].hand).toHaveLength(Math.floor(FIGHT_EVERY / DRAW_EVERY));
    expect(s.sides[0].mana).toBe(MANA_PER_PHASE);
  });

  it('carries over at most 5 cards and 10 mana, cutting the hand as the strategy goes in', () => {
    const s = toFight(toFight(createMatch(5)), 2);
    const drawn = Math.floor(2 * FIGHT_EVERY / DRAW_EVERY) - Math.floor(FIGHT_EVERY / DRAW_EVERY);
    expect(s.sides[0].hand).toHaveLength(CARDS_KEPT + drawn);
    expect(s.sides[0].mana).toBe(20);
    idle(s, (x) => x.stage === 'strategy' && x.phase === 'plan');
    expect(s.sides[0].hand).toHaveLength(CARDS_KEPT + drawn);
    advance(s, [{ type: 'commit', side: 0, discard: [s.sides[0].hand.length - 1] }]);
    expect(s.sides[0].hand).toHaveLength(CARDS_KEPT);
  });

  it('opens on a strategy stage, whose stances and camp take hold blind and together', () => {
    const s = createMatch(5);
    expect([s.phase, s.stage, s.mapTick]).toEqual(['plan', 'strategy', 0]);
    const jungler = s.heroes.find((h) => h.side === 0 && h.role === 'jungle')!;
    const camp = s.camps.findIndex((c) => c.owner === 1);
    advance(s, [
      { type: 'stance', side: 0, uid: 0, stance: 'aggressive' },
      { type: 'stance', side: 0, uid: 1, stance: 'aggressive' },
      { type: 'stance', side: 0, uid: 6, stance: 'aggressive' },
      { type: 'camp', side: 0, camp },
      { type: 'commit', side: 0, discard: [] },
    ]);
    expect(s.heroes.map((h) => h.stance)).toEqual(new Array(10).fill('passive'));
    expect(viewFor(s, 1).sides[0].strategy).toEqual({ stances: new Array(5).fill('passive'), camp: -1 });
    advance(s, [{ type: 'commit', side: 1, discard: [] }]);
    expect(s.phase).toBe('map');
    expect(s.heroes.map((h) => h.stance)).toEqual(['aggressive', 'aggressive', ...new Array(8).fill('passive')]);
    expect(jungler.camp).toBe(camp);
    // No orders on the map.
    advance(s, [{ type: 'stance', side: 0, uid: 2, stance: 'aggressive' }]);
    expect(s.heroes[2]!.stance).toBe('passive');
  });

  it('sends the jungler to the camp its strategy names first', () => {
    const s = createMatch(5);
    const jungler = s.heroes.find((h) => h.side === 0 && h.role === 'jungle')!;
    const camp = s.camps.findIndex((c) => c.owner === 1);
    advance(s, [{ type: 'camp', side: 0, camp }, ...commits()]);
    const start = distance(jungler.cell, s.camps[camp]!.cell);
    idle(s, (x) => x.mapTick === 3);
    expect(distance(jungler.cell, s.camps[camp]!.cell)).toBe(start - 3);
  });

  it('holds a hero under its own tower and turns the enemy hero there on the tower', () => {
    const s = createMatch(5);
    const [ours, theirs] = [s.heroes.find((h) => h.side === 0 && h.role === 'top')!, s.heroes.find((h) => h.side === 1 && h.role === 'top')!];
    const tower = s.structures.find((st) => st.side === 0 && st.kind === 'outer' && LANES[0].includes(st.cell))!;
    s.heroes.filter((h) => h !== ours && h !== theirs).forEach((h) => { h.cell = CORE[h.side]; h.retreating = true; });
    for (const h of [ours, theirs]) [h.cell, h.roam] = [tower.cell, tower.cell];
    const [hp, towerHp] = [ours.hp, tower.hp];
    advance(s, []);
    expect(ours.cell).toBe(tower.cell);
    expect(ours.hp).toBe(hp);
    expect(theirs.cell).not.toBe(tower.cell);
    expect(towerHp - tower.hp).toBe(stats(theirs).dmg);
  });

  it('shares XP exactly', () => {
    const s = createMatch(5);
    awardXp(s, s.heroes.slice(3, 5), 1, 1);
    expect(s.heroes[3]!.xp).toBe(XP_UNIT * 1.5);
    awardXp(s, s.heroes.slice(0, 3), 0, 1);
    expect(s.heroes[0]!.xp).toBe(XP_UNIT / 3);
  });
});

describe('jungle camps', () => {
  it('lays out one of each camp a side, three in one jungle half and two in the other, turned about the centre for side 1', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const camps = createMatch(seed).camps;
      for (const side of [0, 1] as const) {
        const own = camps.filter((c) => c.owner === side);
        expect(own.map((c) => c.kind).sort()).toEqual([...CAMP_IDS].sort());
        expect(new Set(own.map((c) => c.cell)).size).toBe(5);
        const split = JUNGLE_HALVES[side].map((half) => own.filter((c) => half.includes(c.cell)).length).sort();
        expect(split).toEqual([2, 3]);
      }
      for (const c of camps.filter((x) => x.owner === 0)) {
        expect(camps.some((d) => d.owner === 1 && d.kind === c.kind && d.cell === opposite(c.cell))).toBe(true);
      }
    }
  });

  it('places the camps differently from match to match', () => {
    const layout = (seed: number) => createMatch(seed).camps.map((c) => `${c.kind}@${c.cell}`).join();
    expect(new Set([1, 2, 3, 4, 5, 6].map(layout)).size).toBeGreaterThan(4);
  });

  it('fells creeps with the hero\'s DMG, spilling over, and respawns the camp after its timer', () => {
    const s = begun(5);
    const jungler = s.heroes.find((h) => h.side === 0 && h.role === 'jungle')!;
    const camp = s.camps.find((c) => c.owner === 0 && c.kind === 'wallflowers')!;
    const def = campDef('wallflowers');
    jungler.cell = camp.cell;
    jungler.hp = 99_999;
    jungler.camp = s.camps.indexOf(camp);
    s.heroes.filter((h) => h !== jungler).forEach((h) => { h.cell = CORE[h.side]; h.retreating = true; });
    camp.hp = 1;
    advance(s, []);
    expect(camp.creeps).toBe(def.creeps - 1);
    expect(camp.hp).toBe(def.hp - (stats(jungler).dmg - 1));
    while (camp.creeps > 0) advance(s, []);
    expect(jungler.xp).toBe(def.xp * def.creeps * XP_UNIT);
    const back = camp.respawnAt;
    expect(back - s.mapTick).toBe(def.respawn);
    jungler.retreating = true;
    idle(s, (x) => x.mapTick === back);
    expect([camp.creeps, camp.hp]).toEqual([def.creeps, def.hp]);
  });
});

describe('fog of war', () => {
  it('shows only cells with own units and those next to own structures', () => {
    const s = createMatch(5);
    const seen = visibility(s, 0);
    expect(seen[CORE[0]]).toBe(true);
    expect(seen[CORE[1]]).toBe(false);
    expect(seen[LANES[0][6]!]).toBe(false);
    expect(seen[LANES[0][5]!]).toBe(true);
  });

  it('hides unseen enemy heroes and the rival hand', () => {
    const s = toFight(createMatch(5));
    const v = viewFor(s, 0);
    expect(v.sides[1].hand).toEqual([]);
    expect(v.rivalHand).toBe(s.sides[1].hand.length);
    for (const h of v.heroes) if (h.side === 1 && h.cell >= 0) expect(v.visible[h.cell]).toBe(true);
    expect(v.rng.map).toEqual([0, 0, 0, 0]);
  });
});

describe('fight phase', () => {
  const TEAMS: [HeroId[], HeroId[]] = [
    ['gnomon', 'vespertine', 'mothTenor', 'saintHalyard', 'scrimshander'],
    ['tallowDuchess', 'carrionAbacus', 'lacuna', 'vintnerGhast', 'brassReliquary'],
  ];

  /** Puts two heroes face to face on one cell at the start of a play stage. */
  function faceOff(hands: [CardId[], CardId[]] = [['skirmish', 'fallBack'], ['skirmish', 'fallBack']]): MatchState {
    const s = playStage(createMatch(11, TEAMS));
    const cell = LANES[1][4]!;
    for (const h of s.heroes) [h.cell, h.hp] = [h.side === 0 ? CORE[0] : CORE[1], maxHp(h)];
    s.heroes[0]!.cell = cell;
    s.heroes[5]!.cell = cell;
    s.sides[0].hand = hands[0];
    s.sides[1].hand = hands[1];
    return s;
  }

  it('reveals both sides at once and resolves by initiative, equal initiatives simultaneously', () => {
    const s = faceOff();
    advance(s, [
      { type: 'play', side: 0, handIndex: 0, source: 0, target: { kind: 'hero', uid: 5 } },
      { type: 'play', side: 1, handIndex: 1, source: 5, target: { kind: 'none' } },
      { type: 'commit', side: 0, discard: [] },
    ]);
    expect(s.phase).toBe('plan');
    expect(viewFor(s, 0).sides[1].plays).toEqual([]);
    advance(s, [{ type: 'commit', side: 1, discard: [] }]);
    expect(s.phase).toBe('resolve');
    expect(s.pending).toEqual([2, 5]);
    advance(s, []);
    advance(s, []);
    const card = s.events.find((e) => e.type === 'card');
    expect(card && card.type === 'card' && card.fizzle).toBe('evaded');
  });

  it('runs an engagement in fight ticks, skipping ticks where nobody acts', () => {
    const s = faceOff();
    advance(s, [
      { type: 'play', side: 0, handIndex: 0, source: 0, target: { kind: 'hero', uid: 5 } },
      { type: 'commit', side: 0, discard: [] },
      { type: 'commit', side: 1, discard: [] },
    ]);
    while (s.phase === 'resolve') advance(s, []);
    expect(s.phase).toBe('clash');
    const ticks: number[] = [];
    let turns = 0;
    while (s.phase === 'clash') {
      advance(s, []);
      if (s.phase === 'clash') ticks.push(s.fightTick);
      turns += s.events.filter((e) => e.type === 'act' && e.uid === 0).length;
    }
    expect(new Set(ticks).size).toBe(ticks.length);
    // Gnomon's SPD 12 acts every 9 ticks: 9, 18, 27, 36, 45 in a 50-tick fight.
    expect(turns).toBe(5);
    expect([s.phase, s.stage]).toEqual(['plan', 'strategy']);
  });
});

describe('fight phase rules', () => {
  const TEAMS: [HeroId[], HeroId[]] = [
    ['gnomon', 'vespertine', 'mothTenor', 'saintHalyard', 'scrimshander'],
    ['tallowDuchess', 'carrionAbacus', 'lacuna', 'vintnerGhast', 'brassReliquary'],
  ];
  const at = (s: MatchState, placed: Record<number, number>) => {
    for (const h of s.heroes) [h.cell, h.hp] = [placed[h.uid] ?? CORE[h.side], maxHp(h)];
  };
  const plan = () => playStage(createMatch(11, TEAMS));
  const run = (s: MatchState, commands: Command[]) => {
    advance(s, [...commands, ...commits()]);
    const all: GameEvent[] = [];
    while (s.phase !== 'map') { advance(s, s.phase === 'plan' ? commits() : []); all.push(...s.events); }
    return all;
  };
  const mid = LANES[1][4]!;

  it('forecasts who can play a card and what it reaches', () => {
    const s = plan();
    const next = NEIGHBOURS[mid]!.find((n) => n >= 0)!;
    const far = NEIGHBOURS[next]!.find((n) => n >= 0 && distance(n, mid) === 2)!;
    // Scrimshander (uid 4) stands with the Duchess (uid 5), so Gnomon's side sees her.
    at(s, { 0: mid, 4: next, 5: next });
    expect(cardReach(viewFor(s, 0), 0, 'highNoon')).toMatchObject({ sources: [0], heroes: [5] });
    // Vespertine waits at base, so nobody may play her Out of the Dark.
    expect(cardReach(viewFor(s, 0), 0, 'outOfTheDark').sources).toEqual([]);
    // A staple: whichever heroes have an enemy in reach.
    expect(cardReach(viewFor(s, 0), 0, 'skirmish').sources).toEqual([0, 4]);
    at(s, { 0: mid, 4: far, 5: far });
    expect(cardReach(viewFor(s, 0), 0, 'highNoon').sources).toEqual([]);
    // Bound cards wait on their hero being alive; Rewind alone does not.
    s.heroes[0]!.respawnAt = s.mapTick + 5;
    expect(cardReach(viewFor(s, 0), 0, 'hourHand').sources).toEqual([]);
    expect(cardReach(viewFor(s, 0), 0, 'rewind').sources).toEqual([0]);
  });

  it('merges same-initiative engages that share a hero, adding their lengths', () => {
    const s = plan();
    at(s, { 0: mid, 5: mid });
    s.sides[0].hand = ['skirmish'];
    s.sides[1].hand = ['skirmish'];
    const events = run(s, [
      { type: 'play', side: 0, handIndex: 0, source: 0, target: { kind: 'hero', uid: 5 } },
      { type: 'play', side: 1, handIndex: 0, source: 5, target: { kind: 'hero', uid: 0 } },
    ]);
    const engages = events.filter((e) => e.type === 'engage');
    expect(engages).toHaveLength(1);
    expect(engages[0]!.type === 'engage' && engages[0]!.members).toEqual([0, 5]);
    expect(s.engagements).toEqual([]);
  });

  it('gives a merged engagement the length of every engage in it', () => {
    const s = plan();
    at(s, { 0: mid, 5: mid });
    s.sides[0].hand = ['skirmish'];
    s.sides[1].hand = ['skirmish'];
    advance(s, [
      { type: 'play', side: 0, handIndex: 0, source: 0, target: { kind: 'hero', uid: 5 } },
      { type: 'play', side: 1, handIndex: 0, source: 5, target: { kind: 'hero', uid: 0 } },
      { type: 'commit', side: 0, discard: [] }, { type: 'commit', side: 1, discard: [] },
    ]);
    advance(s, []);
    expect(s.phase).toBe('clash');
    expect(s.engagements.map((e) => e.length)).toEqual([100]);
  });

  it('fights each initiative out before the next resolves', () => {
    const s = plan();
    at(s, { 0: mid, 5: mid });
    s.sides[0].hand = ['skirmish', 'killLine'];
    const phases: string[] = [];
    advance(s, [
      { type: 'play', side: 0, handIndex: 0, source: 0, target: { kind: 'hero', uid: 5 } },
      { type: 'play', side: 0, handIndex: 0, source: 4, target: { kind: 'hero', uid: 5 } },
      { type: 'commit', side: 0, discard: [] }, { type: 'commit', side: 1, discard: [] },
    ]);
    s.heroes[4]!.cell = mid;
    while (s.stage === 'play') { advance(s, []); for (const e of s.events) if (e.type === 'phase') phases.push(e.phase); }
    expect(phases).toEqual(['clash', 'resolve', 'clash', 'plan']);
  });

  it("holds a Tactic for the hero's next engagement, even one it did not start", () => {
    const s = plan();
    at(s, { 4: mid, 5: mid });
    s.sides[0].hand = ['pressTheAttack'];
    s.sides[1].hand = ['snuff'];
    advance(s, [
      { type: 'play', side: 0, handIndex: 0, source: 4, target: { kind: 'none' } },
      { type: 'play', side: 1, handIndex: 0, source: 5, target: { kind: 'hero', uid: 4 } },
      { type: 'commit', side: 0, discard: [] }, { type: 'commit', side: 1, discard: [] },
    ]);
    // Tactics come before engages: Press the Attack waits on its hero for Snuff's fight.
    advance(s, []);
    expect(s.heroes[4]!.fx.armed).toHaveLength(1);
    advance(s, []);
    expect(s.phase).toBe('clash');
    expect(s.heroes[4]!.fx.surgePct).toBe(20);
    expect(s.heroes[4]!.fx.armed).toEqual([]);
  });

  it('heals with Second Wind at its own initiative, not after the fights', () => {
    const s = plan();
    at(s, {});
    s.heroes[3]!.hp = 100;
    s.sides[0].hand = ['secondWind'];
    advance(s, [{ type: 'play', side: 0, handIndex: 0, source: 3, target: { kind: 'none' } }, ...[0, 1].map((side) => ({ type: 'commit' as const, side: side as 0 | 1, discard: [] }))]);
    advance(s, []);
    expect(s.heroes[3]!.hp).toBeGreaterThan(100);
  });

  it("cancels the opponent's costliest later card with Lacuna", () => {
    const s = plan();
    at(s, { 0: mid, 7: mid });
    s.sides[0].hand = ['skirmish'];
    s.sides[1].hand = ['lacuna'];
    const events = run(s, [
      { type: 'play', side: 0, handIndex: 0, source: 0, target: { kind: 'hero', uid: 7 } },
      { type: 'play', side: 1, handIndex: 0, source: 7, target: { kind: 'none' } },
    ]);
    const fizzles = events.flatMap((e) => (e.type === 'card' ? [e.fizzle] : []));
    expect(fizzles).toEqual([null, 'cancelled']);
    expect(events.some((e) => e.type === 'engage')).toBe(false);
  });

  it('keeps Vespertine hidden unless she shares a cell with an enemy hero or structure', () => {
    const s = createMatch(11, TEAMS);
    const vesp = s.heroes[1]!;
    vesp.cell = LANES[1][4]!;
    expect(visibility(s, 1)[vesp.cell]).toBe(true);
    expect(viewFor(s, 1).heroes[1]!.cell).toBe(-1);
    s.heroes[7]!.cell = vesp.cell;
    expect(viewFor(s, 1).heroes[1]!.cell).toBe(vesp.cell);
  });

  it("saves a dying ally with Vintner Ghast's Toast", () => {
    const s = plan();
    at(s, { 0: mid, 5: mid, 8: mid });
    s.heroes[5]!.hp = 1;
    s.heroes[8]!.ultReadyAt = 0;
    s.sides[0].hand = ['skirmish'];
    const events = run(s, [{ type: 'play', side: 0, handIndex: 0, source: 0, target: { kind: 'hero', uid: 5 } }]);
    expect(events.some((e) => e.type === 'act' && e.uid === 8 && e.kind === 'ult')).toBe(true);
  });

  it("keeps the Tallow Duchess standing through Last Light, then sends her home", () => {
    const s = plan();
    at(s, { 0: mid, 5: mid });
    s.heroes[5]!.hp = 100;
    s.heroes[5]!.ultReadyAt = 0;
    s.sides[0].hand = ['skirmish'];
    const events = run(s, [{ type: 'play', side: 0, handIndex: 0, source: 0, target: { kind: 'hero', uid: 5 } }]);
    expect(events.some((e) => e.type === 'act' && e.uid === 5 && e.kind === 'ult')).toBe(true);
    expect(events.some((e) => e.type === 'death' && e.uid === 5)).toBe(false);
    expect(s.heroes[5]!.cell).toBe(CORE[1]);
  });

  it('brings Gnomon back from death with Rewind', () => {
    const s = plan();
    at(s, {});
    s.heroes[0]!.origin = { hp: 600, cell: mid, respawnAt: -1 };
    kill(s, s.heroes[0]!, []);
    s.heroes[0]!.ultReadyAt = 0;
    s.sides[0].hand = ['rewind'];
    run(s, [{ type: 'play', side: 0, handIndex: 0, source: 0, target: { kind: 'none' } }]);
    expect(s.heroes[0]!.respawnAt).toBe(-1);
    expect(s.heroes[0]!.cell).toBe(mid);
    expect(s.heroes[0]!.hp).toBe(600);
  });
});

describe('motion, encounters and the way home', () => {
  const TEAMS: [HeroId[], HeroId[]] = [
    ['gnomon', 'vespertine', 'mothTenor', 'saintHalyard', 'scrimshander'],
    ['tallowDuchess', 'carrionAbacus', 'lacuna', 'vintnerGhast', 'brassReliquary'],
  ];
  const mid = LANES[1][4]!;

  /** The first fight phase's motion stage, with these hands. */
  function motion(hands: [CardId[], CardId[]]): MatchState {
    const s = toFight(createMatch(11, TEAMS));
    s.stage = 'motion';
    s.sides.forEach((me, i) => [me.hand, me.plays, me.committed] = [hands[i]!, [], false]);
    return s;
  }

  it('moves heroes all at once, with no initiative, and only cards of the stage', () => {
    const s = motion([['roam', 'skirmish'], ['sprint']]);
    const [a, b] = [s.heroes[0]!, s.heroes[5]!];
    [a.cell, b.cell] = [mid, NEIGHBOURS[mid]![0]!];
    const far = CELLS.findIndex((_, c) => distance(c, mid) === 3);
    advance(s, [
      { type: 'play', side: 0, handIndex: 1, source: 0, target: { kind: 'hero', uid: 5 } },
      { type: 'play', side: 0, handIndex: 0, source: 0, target: { kind: 'cell', cell: far } },
      // Sprint reaches 1 cell: Gnomon's cell, as it stood before anyone moved.
      { type: 'play', side: 1, handIndex: 0, source: 5, target: { kind: 'cell', cell: mid } },
      ...commits(),
    ]);
    expect(s.sides[0].plays.map((p) => p.card)).toEqual(['roam']);
    expect(s.phase).toBe('resolve');
    advance(s, []);
    expect([a.cell, b.cell]).toEqual([far, mid]);
    expect(s.events.filter((e) => e.type === 'card').map((e) => e.type === 'card' && e.fizzle)).toEqual([null, null]);
    // Skirmish waits in hand for the play stage.
    expect([s.phase, s.stage]).toEqual(['plan', 'play']);
  });

  it("lets a mid laner's and a jungler's own move outdo the staples", () => {
    const s = motion([['moonpath', 'flit'], ['updraught', 'elision']]);
    s.sides[0].mana = 0;
    s.sides[1].mana = 1;
    for (const h of s.heroes) h.cell = mid;
    const at = (d: number) => CELLS.findIndex((_, c) => distance(c, mid) === d);
    advance(s, [
      { type: 'play', side: 0, handIndex: 0, source: 1, target: { kind: 'cell', cell: at(3) } },
      { type: 'play', side: 0, handIndex: 0, source: 2, target: { kind: 'cell', cell: at(2) } },
      { type: 'play', side: 1, handIndex: 0, source: 6, target: { kind: 'cell', cell: at(4) } },
      // Out of mana: Elision stays in hand, to move Lacuna between fights.
      { type: 'play', side: 1, handIndex: 0, source: 7, target: { kind: 'cell', cell: at(3) } },
      ...commits(),
    ]);
    advance(s, []);
    expect([1, 2, 6, 7].map((uid) => distance(s.heroes[uid]!.cell, mid))).toEqual([3, 2, 4, 0]);
    expect(s.sides[1].hand).toEqual(['elision']);
    expect(s.stage).toBe('play');
  });

  it('calls a fight phase at once when rivals meet in the jungle, on the mana in hand, and the next one 50 ticks after', () => {
    const s = begun(11, TEAMS);
    const camp = s.camps.findIndex((c) => c.owner === 0);
    const [a, b] = [s.heroes[1]!, s.heroes[6]!];
    s.sides[0].mana = 3;
    // Both junglers go for the same camp, and stand on it.
    a.camp = b.camp = camp;
    a.cell = b.cell = s.camps[camp]!.cell;
    advance(s, []);
    expect(s.events.find((e) => e.type === 'encounter')).toEqual({ type: 'encounter', cell: a.cell });
    expect([s.phase, s.fightPhase, s.sides[0].mana]).toEqual(['plan', 1, 3]);
    const tick = s.mapTick;
    idle(s, (x) => x.phase === 'map');
    expect(s.nextFight).toBe(tick + FIGHT_EVERY);
    // They parted: whoever is lower on HP walks home.
    expect([a, b].filter((h) => h.retreating)).toHaveLength(1);
  });

  it('sends the rival lowest on HP home when a fight phase ends with both sides on a jungle cell', () => {
    const s = createMatch(11, TEAMS);
    const cell = JUNGLE[0]!;
    const [a, b, c] = [s.heroes[1]!, s.heroes[2]!, s.heroes[6]!];
    a.cell = b.cell = c.cell = cell;
    a.hp = 100;
    c.hp = 200;
    advance(s, commits());
    expect([a.retreating, b.retreating, c.retreating]).toEqual([true, false, true]);
    // Walking home, they pass each other by.
    advance(s, []);
    expect(s.events.some((e) => e.type === 'encounter')).toBe(false);
  });

  it('walks home by a shortest way, keeping to the lanes the most', () => {
    const laneCells = (from: number, side: 0 | 1, next: (c: number) => number) => {
      let n = 0;
      for (let c = from; c !== CORE[side]; c = next(c)) n += isLane(c) ? 1 : 0;
      return n;
    };
    let better = 0;
    for (const side of [0, 1] as const) {
      for (let c = 0; c < N_CELLS; c++) {
        let steps = 0;
        for (let x = c; x !== CORE[side]; x = stepHome(x, side)) steps++;
        expect(steps).toBe(distance(c, CORE[side]));
        const [home, plain] = [laneCells(c, side, (x) => stepHome(x, side)), laneCells(c, side, (x) => stepToward(x, CORE[side], side))];
        expect(home).toBeGreaterThanOrEqual(plain);
        if (home > plain) better++;
      }
    }
    expect(better).toBeGreaterThan(0);
  });
});

describe('simulation', () => {
  it('is deterministic down to every event', () => {
    const [x, y] = [duel(1234), duel(1234)];
    expect(hashState(x.final)).toBe(hashState(y.final));
    expect(x.log).toEqual(y.log);
  });

  it('diverges across seeds', () => {
    expect(hashState(duel(1).final)).not.toBe(hashState(duel(2).final));
  });

  it('never mutates its input', () => {
    const s = createMatch(9);
    const before = JSON.stringify(s);
    step(s, [{ type: 'stance', side: 0, uid: 0, stance: 'aggressive' }]);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('plays every difficulty pairing to a finish', () => {
    for (const a of DIFFICULTIES) for (const b of DIFFICULTIES) {
      const { final } = runMatch(77, [createAgent(a, 1), createAgent(b, 2)], 6000);
      expect(final.phase).toBe('over');
      expect(final.heroes).toHaveLength(10);
      expect(final.minions.every((m) => m.n > 0)).toBe(true);
      for (const st of final.structures) expect(st.hp).toBeLessThanOrEqual(st.maxHp);
    }
  });

  it('builds the deck from one of each staple and hero card, and two of Sprint and Roam', () => {
    const deck = buildDeck(lineups(3)[0]);
    expect(deck).toHaveLength(STAPLES.length + DOUBLED.length + 15);
    for (const id of new Set(deck)) expect(deck.filter((c) => c === id)).toHaveLength(DOUBLED.includes(id) ? 2 : 1);
    expect(DOUBLED).toEqual(['sprint', 'roam']);
  });

  it('splits each role between the sides by seed', () => {
    for (const seed of [0, 1, 31]) {
      const [a, b] = lineups(seed);
      expect(new Set([...a, ...b]).size).toBe(10);
    }
  });
});
