import { describe, expect, it } from 'vitest';
import { createAgent, DIFFICULTIES } from './ai.ts';
import { CELLS, CORE, LANES, N_CELLS, NEIGHBOURS, STRUCTURE_SITES, distance, mirror } from './board.ts';
import { CARDS_KEPT, FIGHT_EVERY, WAVE_SIZE, XP_UNIT, buildDeck, LINEUP } from './content.ts';
import { awardXp } from './hero.ts';
import { runMatch } from './match.ts';
import { nextU32, randInt, seedRng } from './rng.ts';
import { advance, createMatch, hashState, step } from './sim.ts';
import type { MatchState } from './types.ts';
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
  /** Puts two heroes face to face on one cell at the start of a plan phase. */
  function faceOff(): MatchState {
    const s = idle(createMatch(11), (x) => x.phase === 'plan');
    const cell = LANES[1][4]!;
    for (const h of s.heroes) h.cell = h.side === 0 ? CORE[0] : CORE[1];
    s.heroes[0]!.cell = cell;
    s.heroes[5]!.cell = cell;
    s.sides[0].hand = ['skirmish', 'fallBack'];
    s.sides[1].hand = ['skirmish', 'fallBack'];
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
    // SPD 7 acts every 15 ticks: 15, 30, 45 in a 50-tick fight.
    expect(turns).toBe(3);
    expect(s.phase).toBe('map');
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

  it('builds the deck from staples and hero cards, two of each', () => {
    expect(buildDeck(LINEUP)).toHaveLength(42);
  });
});
