/**
 * Seeded, serialisable randomness.
 *
 * sfc32 uses only 32-bit integer operations, so every JS engine produces the
 * same sequence. Its whole state is four numbers that live inside MatchState:
 * cloning the match clones its future, which is what replays, rollouts and
 * lockstep multiplayer need.
 */
export type RngState = [number, number, number, number];

/** Derives an independent stream from a match seed (splitmix32 expansion). */
export function seedRng(seed: number, stream: number): RngState {
  let x = (seed ^ Math.imul(stream + 1, 0x9e3779b9)) >>> 0;
  const mix = (): number => {
    x = (x + 0x9e3779b9) >>> 0;
    let z = x;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
  const s: RngState = [mix(), mix(), mix(), mix()];
  for (let i = 0; i < 12; i++) nextU32(s);
  return s;
}

export function nextU32(s: RngState): number {
  const t = (((s[0] + s[1]) >>> 0) + s[3]) >>> 0;
  s[3] = (s[3] + 1) >>> 0;
  s[0] = s[1] ^ (s[1] >>> 9);
  s[1] = (s[2] + (s[2] << 3)) >>> 0;
  s[2] = ((s[2] << 21) | (s[2] >>> 11)) >>> 0;
  s[2] = (s[2] + t) >>> 0;
  return t;
}

/** Uniform integer in [0, n), without modulo bias. */
export function randInt(s: RngState, n: number): number {
  const limit = 0x1_0000_0000 - (0x1_0000_0000 % n);
  let v = nextU32(s);
  while (v >= limit) v = nextU32(s);
  return v % n;
}

/** True with probability permille / 1000. */
export function chance(s: RngState, permille: number): boolean {
  return randInt(s, 1000) < permille;
}

export function shuffle<T>(s: RngState, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randInt(s, i + 1);
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}
