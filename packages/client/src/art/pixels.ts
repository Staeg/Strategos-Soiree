/** Paints glyph rows ('.' is transparent) onto a canvas, optionally mirrored inside a frame. */
export function paint(
  ctx: CanvasRenderingContext2D,
  rows: readonly string[],
  x: number,
  y: number,
  inks: Record<string, string>,
  mirror?: { frameX: number; width: number },
): void {
  rows.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) {
      const colour = inks[row[dx]!];
      if (!colour) continue;
      let px = x + dx;
      if (mirror) px = mirror.frameX + mirror.width - 1 - (px - mirror.frameX);
      ctx.fillStyle = colour;
      ctx.fillRect(px, y + dy, 1, 1);
    }
  });
}

export function rect(ctx: CanvasRenderingContext2D, colour: string, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = colour;
  ctx.fillRect(x, y, w, h);
}
