import Phaser from 'phaser';
import { CAMP_IDS, HERO_IDS, type HeroId, type Side } from '@soiree/sim';
import { CAMP_ART } from './camps.ts';
import { FONT_CHARS, glyph } from './font.ts';
import { BODY_CX, BODY_STEP, BODY_STRIDE, BODY_X, BODY_Y, CARD_ICONS, COSTUMES, FRAME_H, FRAME_W, SIGNATURES, type Patch } from './heroes.ts';
import { AMBER, css, CREAM, DUSK, GOLD, INK, inks, MAUVE, PLUM, TEAM, VIOLET } from './palette.ts';
import { paint, rect } from './pixels.ts';

/**
 * Every placeholder texture is drawn here at boot, from code: no binary
 * assets, so art can be replaced one key at a time by real sprite sheets.
 */
export function forgeAll(scene: Phaser.Scene): void {
  forgeFont(scene);
  for (const side of [0, 1] as const) {
    for (const id of HERO_IDS) forgeHero(scene, id, side);
    forgeNexus(scene, side);
    forgeTower(scene, side);
    for (const [kind, rows] of Object.entries(CARD_ICONS)) canvas(scene, `icon-${kind}-${side}`, 8, 8, (ctx) => paint(ctx, rows, 0, 0, inks(side)));
  }
  forgeEffects(scene);
  forgeScenery(scene);
}

export const heroKey = (id: string, side: Side) => `hero-${id}-${side}`;
export const FACE_W = 14;
export const FACE_H = 12;
export const heroOriginX = (side: Side) => (side === 0 ? BODY_CX : FRAME_W - BODY_CX) / FRAME_W;

function canvas(scene: Phaser.Scene, key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const tex = scene.textures.createCanvas(key, w, h)!;
  draw(tex.getContext());
  tex.refresh();
  return tex;
}

function forgeFont(scene: Phaser.Scene): void {
  canvas(scene, 'font', FONT_CHARS.length * 4, 6, (ctx) => {
    for (let i = 0; i < FONT_CHARS.length; i++) paint(ctx, glyph(i), i * 4, 0, { '#': '#ffffff' });
  });
  const data = Phaser.GameObjects.RetroFont.Parse(scene, {
    image: 'font', width: 4, height: 6, chars: FONT_CHARS, charsPerRow: FONT_CHARS.length,
    'offset.x': 0, 'offset.y': 0, 'spacing.x': 0, 'spacing.y': 0, lineSpacing: 1,
  } as unknown as Phaser.Types.GameObjects.BitmapText.RetroFontConfig);
  scene.cache.bitmapFont.add('pixel', data);
}

function forgeHero(scene: Phaser.Scene, id: HeroId, side: Side): void {
  const key = heroKey(id, side);
  const costume = COSTUMES[id];
  const frames: [string[], Patch[]][] = [[BODY_STEP, costume.idle], [BODY_STRIDE, costume.idle], [BODY_STEP, costume.strike]];
  const tex = canvas(scene, key, FRAME_W * frames.length, FRAME_H, (ctx) => {
    const ink = inks(side, SIGNATURES[id]);
    frames.forEach(([body, held], f) => {
      const ox = f * FRAME_W;
      const mirror = side === 1 ? { frameX: ox, width: FRAME_W } : undefined;
      paint(ctx, body, ox + BODY_X, BODY_Y, ink, mirror);
      for (const p of [...costume.wear, ...held]) paint(ctx, p.rows, ox + p.x, p.y, ink, mirror);
    });
  });
  frames.forEach((_, f) => tex.add(String(f), 0, f * FRAME_W, 0, FRAME_W, FRAME_H));
  // A head-and-shoulders crop of the walking frame, for card badges.
  tex.add('face', 0, side === 0 ? BODY_CX - 6 : FRAME_W - BODY_CX - 8, 0, FACE_W, FACE_H);
  scene.anims.create({ key: `${key}-walk`, frames: [{ key, frame: '0' }, { key, frame: '1' }], frameRate: 6, repeat: -1 });
  scene.anims.create({ key: `${key}-idle`, frames: [{ key, frame: '0' }], frameRate: 1 });
  scene.anims.create({ key: `${key}-strike`, frames: [{ key, frame: '2' }, { key, frame: '2' }, { key, frame: '0' }], frameRate: 10 });
}

/** A faceted crystal on a stone plinth, lit from the left. */
function forgeNexus(scene: Phaser.Scene, side: Side): void {
  const team = TEAM[side];
  const W = 15, H = 30, cx = 7;
  canvas(scene, `nexus-${side}`, W, H, (ctx) => {
    const top = 1, bottom = 21;
    for (let y = top; y <= bottom; y++) {
      const t = (y - top) / (bottom - top);
      const half = Math.round(Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.5) * 5 * (t > 0.75 ? (1 - t) * 4 : 1));
      for (let x = cx - half; x <= cx + half; x++) {
        const edge = x === cx - half || x === cx + half;
        const colour = edge ? INK : x < cx - 1 ? team.light : x > cx + 1 ? team.dark : team.main;
        rect(ctx, css(colour), side === 1 ? W - 1 - x : x, y, 1, 1);
      }
    }
    rect(ctx, css(INK), cx, 0, 1, 1);
    rect(ctx, '#ffffff', side === 1 ? W - 1 - (cx - 2) : cx - 2, 6, 1, 3);
    rect(ctx, css(INK), 1, 22, W - 2, 8);
    rect(ctx, css(MAUVE), 2, 23, W - 4, 2);
    rect(ctx, css(DUSK), 2, 25, W - 4, 4);
    rect(ctx, css(GOLD), 2, 23, W - 4, 1);
  });
}

/** A slim lantern-topped spire: the towers that light each side's way. */
function forgeTower(scene: Phaser.Scene, side: Side): void {
  const team = TEAM[side];
  canvas(scene, `tower-${side}`, 9, 16, (ctx) => {
    rect(ctx, css(INK), 3, 0, 3, 1);
    rect(ctx, css(INK), 2, 1, 5, 4);
    rect(ctx, css(team.light), 3, 2, 3, 2);
    rect(ctx, '#ffffff', 4, 2, 1, 1);
    rect(ctx, css(INK), 3, 5, 3, 7);
    rect(ctx, css(team.main), 4, 5, 1, 7);
    rect(ctx, css(INK), 1, 12, 7, 4);
    rect(ctx, css(MAUVE), 2, 12, 5, 1);
    rect(ctx, css(DUSK), 2, 13, 5, 2);
  });
}

function forgeEffects(scene: Phaser.Scene): void {
  // Hit spark: a four-point star that blooms and fades over four frames.
  const spark = canvas(scene, 'spark', 7 * 4, 7, (ctx) => {
    for (let f = 0; f < 4; f++) {
      const ox = f * 7 + 3, r = [1, 2, 3, 3][f]!;
      const colour = f < 2 ? '#ffffff' : css(GOLD);
      for (let i = f === 3 ? 2 : 0; i <= r; i++) {
        rect(ctx, colour, ox + i, 3, 1, 1); rect(ctx, colour, ox - i, 3, 1, 1);
        rect(ctx, colour, ox, 3 + i, 1, 1); rect(ctx, colour, ox, 3 - i, 1, 1);
      }
    }
  });
  frameStrip(spark, 4, 7, 7);
  scene.anims.create({ key: 'spark', frames: scene.anims.generateFrameNames('spark', { start: 0, end: 3 }), frameRate: 20, hideOnComplete: true });

  // Death puff: a ring of dust that widens and thins.
  const puff = canvas(scene, 'puff', 11 * 4, 11, (ctx) => {
    for (let f = 0; f < 4; f++) {
      const r = 2 + f;
      for (let a = 0; a < 16; a++) {
        if (f === 3 && a % 2) continue;
        const ang = (a / 16) * Math.PI * 2;
        rect(ctx, css(f < 2 ? CREAM : MAUVE), f * 11 + 5 + Math.round(Math.cos(ang) * r), 5 + Math.round(Math.sin(ang) * r), 1, 1);
      }
    }
  });
  frameStrip(puff, 4, 11, 11);
  scene.anims.create({ key: 'puff', frames: scene.anims.generateFrameNames('puff', { start: 0, end: 3 }), frameRate: 12, hideOnComplete: true });

  canvas(scene, 'orb', 3, 3, (ctx) => {
    rect(ctx, css(VIOLET), 0, 1, 3, 1); rect(ctx, css(VIOLET), 1, 0, 1, 3); rect(ctx, '#ffffff', 1, 1, 1, 1);
  });
  canvas(scene, 'arrow', 6, 1, (ctx) => { rect(ctx, '#8a5a3b', 0, 0, 4, 1); rect(ctx, '#ffffff', 4, 0, 2, 1); });
  canvas(scene, 'plus', 5, 5, (ctx) => { rect(ctx, '#7fc06a', 2, 0, 1, 5); rect(ctx, '#7fc06a', 0, 2, 5, 1); });
  canvas(scene, 'shadow', 10, 3, (ctx) => { rect(ctx, css(INK), 2, 0, 6, 3); rect(ctx, css(INK), 0, 1, 10, 1); });
  canvas(scene, 'pixel', 1, 1, (ctx) => rect(ctx, '#ffffff', 0, 0, 1, 1));
  // Camp creeps, neutral: no livery, the garden's own colours.
  const garden = { ...inks(0), G: '#2f5a3a', l: '#4f8a55' };
  for (const kind of CAMP_IDS) {
    const { rows } = CAMP_ART[kind];
    canvas(scene, `camp-${kind}`, rows[0]!.length, rows.length, (ctx) => paint(ctx, rows, 0, 0, garden));
  }
}

function frameStrip(tex: Phaser.Textures.CanvasTexture, count: number, w: number, h: number): void {
  for (let f = 0; f < count; f++) tex.add(String(f), 0, f * w, 0, w, h);
}

function forgeScenery(scene: Phaser.Scene): void {
  // Parquet ballroom floor: staggered planks with a faint grain.
  canvas(scene, 'floor', 16, 8, (ctx) => {
    rect(ctx, css(PLUM), 0, 0, 16, 8);
    rect(ctx, css(DUSK), 0, 0, 16, 1);
    rect(ctx, css(DUSK), 0, 4, 16, 1);
    rect(ctx, css(INK), 7, 1, 1, 3);
    rect(ctx, css(INK), 15, 5, 1, 3);
    rect(ctx, '#3a2a50', 2, 2, 3, 1);
    rect(ctx, '#3a2a50', 10, 6, 3, 1);
  });
  canvas(scene, 'lantern', 5, 7, (ctx) => {
    rect(ctx, css(INK), 2, 0, 1, 1);
    rect(ctx, css(AMBER), 1, 1, 3, 1);
    rect(ctx, css(GOLD), 0, 2, 5, 3);
    rect(ctx, '#fff3c4', 1, 3, 2, 1);
    rect(ctx, css(AMBER), 1, 5, 3, 1);
    rect(ctx, css(INK), 2, 6, 1, 1);
  });
}
