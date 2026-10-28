import { describe, expect, it } from 'vitest';
import { createAgent, DIFFICULTIES } from './ai.ts';
import { CELLS, CORE, JUNGLE_HALVES, LANES, N_CELLS, NEIGHBOURS, STRUCTURE_SITES, distance, mirror, opposite } from './board.ts';
import { CAMP_IDS, CARDS_KEPT, FIGHT_EVERY, STAPLES, WAVE_SIZE, XP_UNIT, buildDeck, campDef, lineups, type CardId, type HeroId } from './content.ts';
import { awardXp, kill, maxHp, stats } from './hero.ts';
import { runMatch } from './match.ts';
import { cardReach } from './reach.ts';
import { nextU32, randInt, seedRng } from './rng.ts';
import { advance, createMatch, hashState, step } from './sim.ts';
import type { Command, GameEvent, MatchState, Target } from './types.ts';
import { viewFor, visibility } from './vision.ts';

const duel = (seed: number, steps = 3000) =>
  runMatch(seed, [createAgent('tactician', seed + 1), createAgent('tactician', seed + 2)], steps, true);

/** Steps a match with no orders and no plays until `until` holds. */
function idle(s: MatchState, until: (s: MatchState) => boolean): MatchState {
  while (!until(s)) {
    const commit = s.phase === 'plan' ? ([0, 1] as const).map((side) => ({ type: 'commit' as const, side, discard: [] })) : [];
    advance(s, commit);
  }
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

  it('calls a fight phase every 50 map ticks, with a card drawn every 10', () => {
    const s = idle(createMatch(5), (x) => x.phase === 'plan');
    expect(s.mapTick).toBe(FIGHT_EVERY);
    expect(s.sides[0].hand).toHaveLength(5);
    expect(s.sides[0].mana).toBe(10);
  });

  it('carries over at most 5 cards and 10 mana', () => {
    const s = idle(createMatch(5), (x) => x.phase === 'plan');
    idle(s, (x) => x.phase === 'plan' && x.fightPhase === 2);
    expect(s.sides[0].hand).toHaveLength(10);
    expect(s.sides[0].mana).toBe(20);
    advance(s, [{ type: 'commit', side: 0, discard: [9, 8] }]);
    expect(s.sides[0].hand).toHaveLength(CARDS_KEPT);
  });

  it('lets each side give one stance and one roam order per map phase', () => {
    const s = createMatch(5);
    advance(s, [{ type: 'stance', side: 0, uid: 0 }, { type: 'stance', side: 0, uid: 1 }]);
    expect(s.heroes.slice(0, 2).map((h) => h.stance)).toEqual(['aggressive', 'passive']);
    advance(s, [{ type: 'roam', side: 0, uid: 1, cell: 30 }, { type: 'roam', side: 0, uid: 2, cell: 30 }]);
    expect(s.heroes[1]!.roam).toBe(30);
    expect(s.heroes[2]!.roam).toBe(-1);
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
    const s = createMatch(5);
    const jungler = s.heroes.find((h) => h.side === 0 && h.role === 'jungle')!;
    const camp = s.camps.find((c) => c.owner === 0 && c.kind === 'wallflowers')!;
    const def = campDef('wallflowers');
    jungler.cell = camp.cell;
    jungler.hp = 99_999;
    jungler.roam = camp.cell;
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
    const s = idle(createMatch(5), (x) => x.phase === 'plan');
    const v = viewFor(s, 0);
    expect(v.sides[1].hand).toEqual([]);
    expect(v.rivalHand).toBe(5);
    for (const h of v.heroes) if (h.side === 1 && h.cell >= 0) expect(v.visible[h.cell]).toBe(true);
    expect(v.rng.map).toEqual([0, 0, 0, 0]);
  });
});

describe('fight phase', () => {
  const TEAMS: [HeroId[], HeroId[]] = [
    ['gnomon', 'vespertine', 'mothTenor', 'saintHalyard', 'scrimshander'],
    ['tallowDuchess', 'carrionAbacus', 'lacuna', 'vintnerGhast', 'brassReliquary'],
  ];

  /** Puts two heroes face to face on one cell at the start of a plan phase. */
  function faceOff(hands: [CardId[], CardId[]] = [['skirmish', 'fallBack'], ['skirmish', 'fallBack']]): MatchState {
    const s = idle(createMatch(11, TEAMS), (x) => x.phase === 'plan');
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
    expect(s.phase).toBe('map');
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
  const plan = () => idle(createMatch(11, TEAMS), (x) => x.phase === 'plan');
  const run = (s: MatchState, commands: Command[]) => {
    advance(s, [...commands, { type: 'commit', side: 0, discard: [] }, { type: 'commit', side: 1, discard: [] }]);
    const all: GameEvent[] = [];
    while (s.phase !== 'map') { advance(s, []); all.push(...s.events); }
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
    while (s.phase !== 'map') { advance(s, []); for (const e of s.events) if (e.type === 'phase') phases.push(e.phase); }
    expect(phases).toEqual(['clash', 'resolve', 'clash', 'map']);
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
    step(s, [{ type: 'stance', side: 0, uid: 0 }]);
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

  it('builds the deck from one of each staple and hero card', () => {
    const deck = buildDeck(lineups(3)[0]);
    expect(deck).toHaveLength(STAPLES.length + 15);
    expect(new Set(deck).size).toBe(deck.length);
  });

  it('splits each role between the sides by seed', () => {
    for (const seed of [0, 1, 31]) {
      const [a, b] = lineups(seed);
      expect(new Set([...a, ...b]).size).toBe(10);
    }
  });
});
