import type { CampId } from '@soiree/sim';

/**
 * Jungle camps, one sprite per creep. Glyphs use `inks()` letters plus the
 * hedge greens `G` and `l`. `spots` places each creep's centre relative to
 * the cell's, filled in order as the camp stands and emptied as it falls.
 */
export const CAMP_ART: Record<CampId, { rows: string[]; spots: [number, number][] }> = {
  // Masked wallflowers on wiry stems, crowding the upper half of the cell.
  wallflowers: {
    rows: [
      '.p.p.',
      'ppppp',
      'pocop',
      '.ppp.',
      '..L..',
      '.LL..',
      '..L..',
    ],
    spots: [[-8, -9], [-2, -10], [4, -9], [-5, -3], [1, -3], [7, -4]],
  },
  // Unclaimed coats, each on its own hook, with brass buttons.
  cloakroom: {
    rows: [
      '..o..',
      '.ooo.',
      'owwwo',
      'wwgww',
      'wwwww',
      'wwgww',
      '.www.',
      '.w.w.',
    ],
    spots: [[-6, -9], [1, -10], [-3, -2], [4, -3]],
  },
  // Hedge-clipped hounds, sitting up.
  topiary: {
    rows: [
      '......GG.',
      '.....GlhG',
      'G....GGGG',
      'GlGGGlG..',
      'GGGGGGG..',
      'G.G..G.G.',
    ],
    spots: [[-6, -7], [5, -5]],
  },
  // Gilt arms and crystal drops, hung from the dark.
  chandelier: {
    rows: [
      '.....o.....',
      '.....g.....',
      '.h..ggg..h.',
      '.g.ggggg.g.',
      'ggggggggggg',
      '.a.a.a.a.a.',
      '.h.h.h.h.h.',
      '..h.....h..',
    ],
    spots: [[0, -8]],
  },
  // A violet wyrm rising from a silver punch bowl.
  wyrm: {
    rows: [
      '.......pp....',
      '......pphp...',
      '......pp.....',
      '.......pp....',
      '..pP....pp...',
      '...pp..pP....',
      '.mrrrrrrrrrm.',
      'mmmmmmmmmmmmm',
      '.MmmmmmmmmmM.',
      '...MmmmmmM...',
      '.....mmm.....',
      '....MmmmM....',
    ],
    spots: [[0, -6]],
  },
};
