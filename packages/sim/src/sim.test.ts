import { describe, expect, it } from 'vitest';
import { createAgent, DIFFICULTIES } from './ai.ts';
import { HEROES, NEXUS_HP } from './content.ts';
import { runMatch } from './match.ts';
import { nextU32, randInt, seedRng } from './rng.ts';
import { createMatch, hashState, step } from './sim.ts';

const duel = (seed: number) =>
  runMatch(seed, [createAgent('tactician', seed + 1), createAgent('strategos', seed + 2)], 50_000, true);

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
    step(s, [{ type: 'pick', side: 0, hero: 'knight' }]);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('ignores out-of-turn and duplicate picks', () => {
    let s = createMatch(3);
    s = step(s, [{ type: 'pick', side: 1, hero: 'mage' }]);
    expect(s.sides[1].picks).toEqual([]);
    s = step(s, [{ type: 'pick', side: 0, hero: 'mage' }, { type: 'pick', side: 1, hero: 'mage' }]);
    expect(s.sides[0].picks).toEqual(['mage']);
    expect(s.sides[1].picks).toEqual([]);
  });

  it('plays every difficulty pairing to a finish', () => {
    for (const a of DIFFICULTIES) for (const b of DIFFICULTIES) {
      const { final } = runMatch(77, [createAgent(a, 1), createAgent(b, 2)]);
      expect(final.phase).toBe('over');
      expect(final.units).toHaveLength(6);
      for (const u of final.units) expect(u.hp).toBeLessThanOrEqual(HEROES[u.hero].hp);
      for (const side of final.sides) expect(side.nexus).toBeLessThanOrEqual(NEXUS_HP);
    }
  });
});
