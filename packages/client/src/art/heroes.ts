import type { HeroId } from '@soiree/sim';

/**
 * Heroes are a shared body plus a hand-drawn costume. Each frame is 20x16,
 * facing right, feet on the bottom row; the body occupies columns 4-11 so
 * weapons have room to swing forward.
 */
export const FRAME_W = 20;
export const FRAME_H = 16;
export const BODY_X = 4;
export const BODY_Y = 3;
/** Horizontal centre of the body, used as the sprite origin. */
export const BODY_CX = BODY_X + 4;

const TORSO = [
  '..oooo..',
  '.osssso.',
  '.osssoo.',
  '.osssso.',
  '..oooo..',
  '.otttto.',
  'otlttdto',
  'otlttdto',
  '.otttto.',
  '.oddddo.',
];
export const BODY_STEP = [...TORSO, '.od..do.', '.oo..oo.'];
export const BODY_STRIDE = [...TORSO, '..oddo..', '..oooo..'];

export interface Patch {
  x: number;
  y: number;
  rows: string[];
}

export interface Costume {
  /** Worn in every frame (helmets, hoods, halos). */
  wear: Patch[];
  /** Held while walking. */
  idle: Patch[];
  /** Held mid-strike. */
  strike: Patch[];
}

/** Costumes by look. Placeholder heroes borrow these until the roster has its own. */
export const COSTUMES = {
  knight: {
    wear: [{ x: 5, y: 2, rows: ['.MMMM.', 'MmmmmM', 'Mm..mM'] }],
    idle: [{ x: 12, y: 3, rows: ['.h.', '.m.', '.m.', '.m.', '.m.', 'ggg', '.w.'] }],
    strike: [{ x: 11, y: 8, rows: ['g......', 'gwmmmmh', 'g......'] }],
  },
  brute: {
    wear: [{ x: 4, y: 1, rows: ['c......c', 'cc....cc'] }],
    idle: [{ x: 12, y: 2, rows: ['.ww.', 'wwww', 'wkww', '.ww.', '.w..', '.w..', '.w..', '.w..'] }],
    strike: [{ x: 11, y: 7, rows: ['.....ww.', 'wwwwwwww', '.....wkw', '......w.'] }],
  },
  archer: {
    wear: [{ x: 5, y: 2, rows: ['.LLLL.', 'LLLLLL', 'L....L', 'L.....'] }],
    idle: [{ x: 12, y: 5, rows: ['.w', 'wc', 'wc', 'wc', 'wc', '.w'] }],
    strike: [{ x: 11, y: 5, rows: ['...w...', '..wc...', '.w.c...', 'mmmmmmh', '.w.c...', '..wc...', '...w...'] }],
  },
  mage: {
    wear: [{ x: 5, y: 0, rows: ['...p..', '..pp..', '.pPpp.', 'pppppp'] }],
    idle: [{ x: 12, y: 2, rows: ['.p.', 'php', '.p.', '.w.', '.w.', '.w.', '.w.', '.w.', '.w.', '.w.'] }],
    strike: [{ x: 12, y: 1, rows: ['hph.', 'phph', 'hph.', '.w..', '.w..', '.w..', '.w..', '.w..', '.w..', '.w..'] }],
  },
  rogue: {
    wear: [{ x: 5, y: 2, rows: ['.DDDD.', 'DDDDDD', '......', 'DDD.DD'] }],
    idle: [{ x: 12, y: 8, rows: ['h', 'm', 'w'] }],
    strike: [{ x: 12, y: 9, rows: ['wmmh'] }],
  },
  cleric: {
    wear: [{ x: 5, y: 0, rows: ['.gggg.', 'g....g', '.gggg.'] }],
    idle: [{ x: 12, y: 2, rows: ['.g.', 'ggg', '.g.', '.w.', '.w.', '.w.', '.w.', '.w.', '.w.', '.w.'] }],
    strike: [{ x: 12, y: 1, rows: ['hgh', 'ggg', 'hgh', '.w.', '.w.', '.w.', '.w.', '.w.', '.w.', '.w.', '.w.'] }],
  },
  lancer: {
    wear: [{ x: 5, y: 0, rows: ['..rr..', '.rr...', 'MmmmmM', 'M....M'] }],
    idle: [{ x: 13, y: 0, rows: ['h', 'm', 'w', 'w', 'w', 'w', 'w', 'w', 'w', 'w', 'w', 'w', 'w'] }],
    strike: [{ x: 10, y: 9, rows: ['wwwwwwwmh'] }],
  },
  warden: {
    wear: [{ x: 5, y: 2, rows: ['.MMMM.', 'MMMMMM'] }],
    idle: [{ x: 10, y: 7, rows: ['.MM.', 'MmmM', 'MgmM', 'MmmM', 'MmmM', '.MM.'] }],
    strike: [{ x: 12, y: 6, rows: ['.MM.', 'MmmM', 'MgmM', 'MmgM', 'MmmM', 'MmmM', '.MM.'] }],
  },
} satisfies Record<string, Costume>;

export const LOOKS: Record<HeroId, keyof typeof COSTUMES> = {
  stubTop: 'warden', stubJungle: 'rogue', stubMid: 'mage', stubSupport: 'cleric', stubCarry: 'archer',
};

/** Tiny 8x8 card emblems, one per kind of card. */
export const CARD_ICONS = {
  engage: ['m......m', '.m....m.', '..m..m..', '...mm...', '...mm...', '..g..g..', '.w....w.', 'w......w'],
  join: ['g.......', 'gtttt...', 'gttttt..', 'gtttt...', 'g.......', 'g.......', 'g.......', 'gg......'],
  tactic: ['....gg..', '...gg...', '..gg....', '.ggggg..', '...gg...', '..gg....', '.gg.....', 'g.......'],
  guard: ['.MMMMMM.', 'MmmmmmmM', 'MmmggmmM', 'MmggggmM', 'MmmggmmM', '.MmmmmM.', '..MmmM..', '...MM...'],
  reveal: ['........', '..oooo..', '.occcco.', 'occttcco', 'occttcco', '.occcco.', '..oooo..', '........'],
  evade: ['.....ll.', '....lll.', '...lll..', '..lll...', '.lll....', 'lll.....', '.l......', '........'],
  strike: ['w..w..w.', 'w..w..w.', 'w..w..w.', 'm..m..m.', 'h..h..h.', '........', '.oooooo.', '........'],
  heal: ['...LL...', '...LL...', '.LLLLLL.', '.LLLLLL.', '...LL...', '...LL...', '........', '........'],
} satisfies Record<string, string[]>;
