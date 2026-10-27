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

/**
 * One costume per hero, each built around a single signature colour so the
 * cast stays readable at map scale. The team livery (t d l) always shows
 * somewhere on the body.
 */
export const COSTUMES: Record<HeroId, Costume> = {
  // A candle in a wax gown, flame for a head.
  tallowDuchess: {
    wear: [{ x: 6, y: 0, rows: ['.g..', 'gag.', '.a..'] }, { x: 5, y: 13, rows: ['cccccc', 'c.cc.c'] }],
    idle: [{ x: 12, y: 6, rows: ['.g.', '.a.', '.c.', '.c.', 'ccc'] }],
    strike: [{ x: 11, y: 6, rows: ['...gg', '.agga', 'aagga', '.agg.'] }],
  },
  // A sundial plate on his back, its blade over one shoulder.
  gnomon: {
    wear: [{ x: 1, y: 6, rows: ['.MM.', 'MmgM', 'MmmM', '.MM.'] }, { x: 2, y: 3, rows: ['g..', '.g.', '..g'] }],
    idle: [{ x: 12, y: 3, rows: ['.h.', '.m.', '.m.', '.m.', '.m.', 'MMM', '.w.'] }],
    strike: [{ x: 11, y: 9, rows: ['Mmmmmmmh'] }],
  },
  // A hole in the world full of stars, a crescent mask for a face.
  vespertine: {
    wear: [{ x: 6, y: 4, rows: ['nnnn', 'nnhh', 'nnnh'] }, { x: 5, y: 8, rows: ['.nnnn.', 'nnhnnn', 'nnnnhn', '.nhnn.'] }],
    idle: [{ x: 12, y: 9, rows: ['h', 'm'] }],
    strike: [{ x: 12, y: 9, rows: ['mmh'] }],
  },
  // Black ruff, hooked beak, an abacus of red beads on his back.
  carrionAbacus: {
    wear: [{ x: 5, y: 7, rows: ['xxxxxx'] }, { x: 10, y: 5, rows: ['gg', '.a'] }, { x: 0, y: 5, rows: ['wwww', 'wrhw', 'wrrw', 'whrw', 'wwww'] }],
    idle: [{ x: 12, y: 10, rows: ['x.', 'xx'] }],
    strike: [{ x: 12, y: 8, rows: ['xxx.', '..xx', 'xxx.'] }],
  },
  // Dusty wings and antennae, a lantern held out.
  mothTenor: {
    wear: [{ x: 5, y: 0, rows: ['y....y', '.y..y.', '..yy..'] }, { x: 0, y: 6, rows: ['..yyy', '.yyay', 'yyyyy', '.yyy.', '..y..'] }, { x: 8, y: 5, rows: ['a.a'] }],
    idle: [{ x: 12, y: 6, rows: ['.w.', 'ggg', 'gag', 'ggg'] }],
    strike: [{ x: 12, y: 2, rows: ['.g.', 'gag', 'ggg', '.w.', '.w.'] }],
  },
  // White gloves and a collar around nothing.
  lacuna: {
    wear: [{ x: 6, y: 4, rows: ['xxxx', 'xxxx', 'xxxx'] }, { x: 5, y: 7, rows: ['hhhhhh'] }],
    idle: [{ x: 12, y: 8, rows: ['hh', 'hh'] }],
    strike: [{ x: 12, y: 7, rows: ['..hh', 'hhhh', '..hh'] }],
  },
  // A lighthouse lantern for a head.
  saintHalyard: {
    wear: [{ x: 5, y: 2, rows: ['.MMMM.', 'MggggM', 'MgaagM', 'MggggM', '.MMMM.'] }],
    idle: [{ x: 12, y: 2, rows: ['g', 'w', 'w', 'w', 'w', 'w', 'w', 'w', 'w', 'w', 'w'] }],
    strike: [{ x: 11, y: 3, rows: ['.gggg', 'gcccc', '.gggg'] }],
  },
  // A wine-red phantom in a tailcoat, carafe in hand.
  vintnerGhast: {
    wear: [{ x: 6, y: 4, rows: ['qqqq', 'qqoq', 'qqqq'] }, { x: 5, y: 13, rows: ['.qqqq.', '..qq..'] }, { x: 4, y: 11, rows: ['R', 'R'] }],
    idle: [{ x: 12, y: 6, rows: ['.c.', '.c.', 'cRc', 'RRR', '.R.'] }],
    strike: [{ x: 12, y: 5, rows: ['RRc.', 'RRRc', '...R', '...R'] }],
  },
  // An oilskin hood and a carved tusk harpoon.
  scrimshander: {
    wear: [{ x: 5, y: 2, rows: ['.eeee.', 'eeeeee', 'e....e'] }],
    idle: [{ x: 13, y: 0, rows: ['h', 'y', 'y', 'y', 'y', 'y', 'y', 'y', 'y', 'y', 'y', 'y', 'y'] }],
    strike: [{ x: 10, y: 9, rows: ['yyyyyyyyyh'] }],
  },
  // A little saint riding a bronze mortar on cart wheels.
  brassReliquary: {
    wear: [{ x: 5, y: 0, rows: ['.gggg.', 'g....g'] }, { x: 3, y: 11, rows: ['bbbbbbbbb', 'bbbbbbbbb', '.MM...MM.', '.MM...MM.'] }],
    idle: [{ x: 11, y: 9, rows: ['bbbb', 'bbbb'] }],
    strike: [{ x: 11, y: 8, rows: ['.....a', 'bbbbaa', 'bbbb.a'] }],
  },
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
