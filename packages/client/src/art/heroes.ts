import type { HeroId } from '@soiree/sim';
import type { Signature } from './palette.ts';

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
 * Every hero owns a colour pair nobody else wears, plus a small accent: see
 * "Placeholder art" in docs/heroes-draft.md. The pairs are spread round the
 * wheel, clear of the two team liveries (teal and rose), and where two
 * heroes lean on the same hue their partners and values pull them apart.
 */
export const SIGNATURES: Record<HeroId, Signature> = {
  // Flame orange over ivory wax, a yellow heart to the flame.
  tallowDuchess: [0xf0882a, 0xeee2c0, 0xffdc5e],
  // Verdigris sundial, bronze fittings, a glint of noon.
  gnomon: [0x72ad48, 0x9a6634, 0xf4d46c],
  // Deep violet night, a silver crescent, white stars.
  vespertine: [0x4b2689, 0xc5cae8, 0xfff4c4],
  // Carrion-brown feathers, blood-red beads, a bone beak.
  carrionAbacus: [0x5e3e2a, 0xd8403a, 0xe6d7b0],
  // Pale chartreuse luna wings, lavender eyespots, lantern glow.
  mothTenor: [0xcfdc62, 0x9677d6, 0xffe39a],
  // Absence: pure black and pure white, nothing between.
  lacuna: [0x07050b, 0xffffff, 0x8f8f96],
  // Lighthouse scarlet and whitewash, a yellow lamp.
  saintHalyard: [0xd2383a, 0xf3efe6, 0xffe066],
  // Wine burgundy in a bottle-green glass.
  vintnerGhast: [0x8c1c46, 0x3f803f, 0xb6e09e],
  // Sea-blue oilskin and a carved ivory tusk.
  scrimshander: [0x2d62aa, 0xeee2c2, 0x9fc6e8],
  // Polished brass on black iron, a pale saint's halo.
  brassReliquary: [0xd2a23a, 0x41454f, 0xfff1aa],
};

/**
 * One costume per hero, drawn in its signature colours (1 2 3) so the cast
 * stays readable at map scale. The team livery (t d l) always shows
 * somewhere on the body.
 */
export const COSTUMES: Record<HeroId, Costume> = {
  // A candle in a wax gown, flame for a head.
  tallowDuchess: {
    wear: [{ x: 6, y: 0, rows: ['.1..', '131.', '.3..'] }, { x: 5, y: 13, rows: ['222222', '2.22.2'] }],
    idle: [{ x: 12, y: 6, rows: ['.1.', '.3.', '.2.', '.2.', '222'] }],
    strike: [{ x: 11, y: 6, rows: ['...11', '.3113', '33113', '.311.'] }],
  },
  // A sundial plate on his back, its blade over one shoulder.
  gnomon: {
    wear: [{ x: 1, y: 6, rows: ['.22.', '2132', '2112', '.22.'] }, { x: 2, y: 3, rows: ['3..', '.3.', '..3'] }],
    idle: [{ x: 12, y: 3, rows: ['.h.', '.m.', '.m.', '.m.', '.m.', '222', '.1.'] }],
    strike: [{ x: 11, y: 9, rows: ['2mmmmmmh'] }],
  },
  // A hole in the world full of stars, a crescent mask for a face.
  vespertine: {
    wear: [{ x: 6, y: 4, rows: ['1111', '1122', '1112'] }, { x: 5, y: 8, rows: ['.1111.', '113111', '111131', '.1311.'] }],
    idle: [{ x: 12, y: 9, rows: ['3', '2'] }],
    strike: [{ x: 12, y: 9, rows: ['223'] }],
  },
  // A brown ruff, a hooked bone beak, an abacus of red beads on his back.
  carrionAbacus: {
    wear: [{ x: 5, y: 7, rows: ['111111'] }, { x: 10, y: 5, rows: ['33', '.3'] }, { x: 0, y: 5, rows: ['1111', '1231', '1221', '1321', '1111'] }],
    idle: [{ x: 12, y: 10, rows: ['1.', '11'] }],
    strike: [{ x: 12, y: 8, rows: ['111.', '..11', '111.'] }],
  },
  // Dusty wings and antennae, a lantern held out.
  mothTenor: {
    wear: [{ x: 5, y: 0, rows: ['1....1', '.1..1.', '..11..'] }, { x: 0, y: 6, rows: ['..111', '.1121', '11111', '.111.', '..1..'] }, { x: 8, y: 5, rows: ['2.2'] }],
    idle: [{ x: 12, y: 6, rows: ['.w.', '333', '3h3', '333'] }],
    strike: [{ x: 12, y: 2, rows: ['.3.', '3h3', '333', '.w.', '.w.'] }],
  },
  // White gloves and a collar around nothing.
  lacuna: {
    wear: [{ x: 6, y: 4, rows: ['1111', '1111', '1111'] }, { x: 5, y: 7, rows: ['222222'] }],
    idle: [{ x: 12, y: 8, rows: ['22', '22'] }],
    strike: [{ x: 12, y: 7, rows: ['..22', '2222', '..22'] }],
  },
  // A striped lighthouse lantern for a head, a banded mast in hand.
  saintHalyard: {
    wear: [{ x: 5, y: 2, rows: ['.1111.', '133331', '13hh31', '133331', '.2222.'] }],
    idle: [{ x: 12, y: 2, rows: ['3', '1', '2', '1', '2', '1', '2', '1', '2', '1', '2'] }],
    strike: [{ x: 11, y: 3, rows: ['.3333', '3hhhh', '.3333'] }],
  },
  // A wine-red phantom in a tailcoat, a green carafe in hand.
  vintnerGhast: {
    wear: [{ x: 6, y: 4, rows: ['1111', '11h1', '1111'] }, { x: 5, y: 13, rows: ['.1111.', '..11..'] }, { x: 4, y: 11, rows: ['2', '2'] }],
    idle: [{ x: 12, y: 6, rows: ['.3.', '.2.', '212', '111', '.1.'] }],
    strike: [{ x: 12, y: 5, rows: ['112.', '1112', '...1', '...1'] }],
  },
  // An oilskin hood and a carved tusk harpoon.
  scrimshander: {
    wear: [{ x: 5, y: 2, rows: ['.1111.', '111111', '1....1'] }, { x: 5, y: 12, rows: ['11', '11'] }],
    idle: [{ x: 13, y: 0, rows: ['h', '2', '2', '3', '2', '2', '3', '2', '2', '3', '2', '2', '2'] }],
    strike: [{ x: 10, y: 9, rows: ['22322322h'] }],
  },
  // A little saint riding a brass mortar on iron cart wheels.
  brassReliquary: {
    wear: [{ x: 5, y: 0, rows: ['.3333.', '3....3'] }, { x: 3, y: 11, rows: ['111111111', '111111111', '.22...22.', '.22...22.'] }],
    idle: [{ x: 11, y: 9, rows: ['1111', '1111'] }],
    strike: [{ x: 11, y: 8, rows: ['.....3', '111133', '1111.3'] }],
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
