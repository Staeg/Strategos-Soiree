import type { Side } from '@soiree/sim';

/** A dusk-ballroom palette: plum night, candle gold, two rival liveries. */
export const INK = 0x120d19;
export const NIGHT = 0x1b1424;
export const PLUM = 0x2e2140;
export const DUSK = 0x4a3561;
export const MAUVE = 0x7a5c8f;
export const GOLD = 0xe8c170;
export const AMBER = 0xc98b3b;
export const CREAM = 0xf4e9d8;
export const LEAF = 0x7fc06a;
export const VIOLET = 0xa77be0;
export const BLOOD = 0xc2414b;

export const TEAM = [
  { main: 0x47b5a6, dark: 0x24686a, light: 0x9be3d3 },
  { main: 0xd65f7a, dark: 0x7f2c4b, light: 0xf3a5b5 },
] as const satisfies Record<Side, { main: number; dark: number; light: number }>;

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** Glyph -> colour for hand-drawn sprites. `t d l` follow the team livery. */
export function inks(side: Side): Record<string, string> {
  const team = TEAM[side];
  return {
    o: hex(INK), s: '#e3b08f', k: '#b47c64',
    t: hex(team.main), d: hex(team.dark), l: hex(team.light),
    m: '#b9c3cf', M: '#5d6778', w: '#8a5a3b', g: hex(GOLD), c: hex(CREAM),
    h: '#ffffff', p: hex(VIOLET), P: '#5b3d8c', L: hex(LEAF), D: hex(DUSK), r: hex(BLOOD),
  };
}

export const css = hex;
