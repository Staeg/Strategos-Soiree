import Phaser from 'phaser';
import { CELLS, CORE, JUNGLE, LANES, N_CELLS, STRUCTURE_SITES, territory } from '@soiree/sim';
import { DUSK, INK, MAUVE, PLUM, TEAM } from './art/palette.ts';

/**
 * Screen geometry for the hex board. Pointy-top cells, 28 wide and 32 tall,
 * so every centre and every corner lands on a whole pixel.
 */
export const HEX_W = 28;
export const HEX_H = 32;
export const ORIGIN = { x: 320, y: 134 };

export const cellX = (cell: number): number => ORIGIN.x + HEX_W * CELLS[cell]!.q + (HEX_W / 2) * CELLS[cell]!.r;
export const cellY = (cell: number): number => ORIGIN.y + (HEX_H * 3 / 4) * CELLS[cell]!.r;

const CORNERS: [number, number][] = [[0, -16], [14, -8], [14, 8], [0, 16], [-14, 8], [-14, -8]];

export function hexPoints(cell: number, inset = 0): Phaser.Geom.Point[] {
  const [x, y] = [cellX(cell), cellY(cell)];
  const k = (16 - inset) / 16;
  return CORNERS.map(([dx, dy]) => new Phaser.Geom.Point(Math.round(x + dx * k), Math.round(y + dy * k)));
}

/** Nearest cell centre to a screen point, if the point is on the board. */
export function cellAtPoint(x: number, y: number): number {
  let best = -1, bestD = 15 * 15;
  for (let c = 0; c < N_CELLS; c++) {
    const d = (cellX(c) - x) ** 2 + (cellY(c) - y) ** 2;
    if (d < bestD) [best, bestD] = [c, d];
  }
  return best;
}

const LANE_CELLS = new Set(Object.values(LANES).flat());
const RIVER = 0x2a3550;

/**
 * The ballroom floor at the end of the world: lanes are carpet runners,
 * the jungle is a clipped garden in each side's tint, the river a strip of
 * dark mirror between them.
 */
export function drawBoard(scene: Phaser.Scene): void {
  const g = scene.add.graphics().setDepth(0);
  for (let c = 0; c < N_CELLS; c++) {
    const side = territory(c);
    const lane = LANE_CELLS.has(c);
    const fill = lane ? DUSK : side === null ? RIVER : side === 0 ? 0x223a3c : 0x3a2232;
    g.fillStyle(INK).fillPoints(hexPoints(c), true);
    g.fillStyle(fill).fillPoints(hexPoints(c, 1), true);
    if (lane) {
      // A carpet runner: a lighter weave down the middle of the cell.
      g.fillStyle(MAUVE, 0.35).fillPoints(hexPoints(c, 6), true);
    } else {
      g.fillStyle(side === null ? 0x3b4a6b : PLUM, 0.5).fillRect(cellX(c) - 5, cellY(c) + 4, 10, 1);
    }
  }
  for (const c of JUNGLE) {
    if (territory(c) === null) continue;
    scene.add.image(cellX(c) + (c % 2 ? 5 : -5), cellY(c) - 3, 'hedge').setDepth(1).setAlpha(0.8);
  }
  // Corner plinths under each core, in livery.
  for (const side of [0, 1] as const) {
    g.lineStyle(1, TEAM[side].main, 0.8).strokePoints(hexPoints(CORE[side], 1), true);
  }
  for (const st of STRUCTURE_SITES) {
    if (st.kind !== 'core') g.fillStyle(TEAM[st.side].dark, 0.6).fillPoints(hexPoints(st.cell, 3), true);
  }
}
