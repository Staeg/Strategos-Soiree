import Phaser from 'phaser';
import { BLOOD, CREAM, GOLD, INK, LEAF, MANA_LIGHT, VIOLET } from './art/palette.ts';

export interface Point { x: number; y: number }

/** What an effect did to one target, which decides the colour it is marked in. */
export type Touch = 'harm' | 'heal' | 'shield';
const TOUCH: Record<Touch, number> = { harm: BLOOD, heal: LEAF, shield: MANA_LIGHT };

/** A drawing that lives `life` ms, redrawn every frame with its progress 0..1 and the size of a pixel. */
interface Flourish {
  born: number;
  life: number;
  draw(g: Phaser.GameObjects.Graphics, t: number, k: number): void;
}

const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/**
 * Placeholder fight effects, all drawn into one Graphics. Two vocabularies,
 * so a glance tells them apart: an attack is a quick streak ending in a
 * slash across the target; an ability is a ring bursting off the caster,
 * a dotted thread to each target, and brackets that close on every hero it
 * touched, coloured by what it did to them.
 */
export class Flourishes {
  private live: Flourish[] = [];

  /** `px`: how big a pixel of these drawings is in world units, so they keep their size as the camera closes in. */
  constructor(private readonly g: Phaser.GameObjects.Graphics, private readonly now: () => number, private readonly px: () => number = () => 1) {}

  private add(life: number, draw: Flourish['draw']): void {
    this.live.push({ born: this.now(), life, draw });
  }

  update(): void {
    const now = this.now();
    this.g.clear();
    this.live = this.live.filter((f) => now - f.born < f.life);
    const k = this.px();
    for (const f of this.live) f.draw(this.g, clamp01((now - f.born) / f.life), k);
  }

  /** A streak from attacker to target, then a slash across it. */
  attack(from: Point, to: Point, tint: number, pace = 1): void {
    this.add(380 * pace, (g, t, px) => {
      const head = lerp(from, to, clamp01(t / 0.45));
      const tail = lerp(from, to, clamp01((t - 0.15) / 0.45));
      if (t < 0.6) {
        g.lineStyle(px, tint, 1).lineBetween(tail.x, tail.y, head.x, head.y);
        g.fillStyle(CREAM).fillRect(snap(head.x, px) - px, snap(head.y, px) - px, 2 * px, 2 * px);
      }
      if (t >= 0.4) {
        const k = clamp01((t - 0.4) / 0.6);
        const r = (3 + 3 * k) * px;
        g.lineStyle(px, CREAM, 1 - k).lineBetween(to.x - r, to.y - r, to.x + r, to.y + r);
        g.lineStyle(px, BLOOD, 1 - k).lineBetween(to.x - r, to.y - r + px, to.x + r, to.y + r + px);
      }
    });
  }

  /** Minions' pot-shots: a fleck flying at the hero they hit. */
  fleck(from: Point, to: Point, tint: number, pace = 1): void {
    this.add(260 * pace, (g, t, px) => {
      const p = lerp(from, to, t);
      g.fillStyle(tint, 1 - t * 0.5).fillRect(snap(p.x, px), snap(p.y, px), px, px);
    });
  }

  /** A ring off the caster, threads to each target, brackets on everyone touched. */
  ability(from: Point, targets: { at: Point; touch: Touch }[], ult: boolean, pace = 1): void {
    const tint = ult ? GOLD : VIOLET;
    this.add(700 * pace, (g, t, px) => {
      const burst = clamp01(t / 0.5);
      g.lineStyle(px, tint, 1 - burst).strokeCircle(from.x, from.y, (3 + 13 * burst) * px);
      if (ult) g.lineStyle(px, CREAM, 1 - burst).strokeCircle(from.x, from.y, (2 + 8 * burst) * px);
      for (const { at, touch } of targets) {
        const self = Math.abs(at.x - from.x) + Math.abs(at.y - from.y) < 2 * px;
        if (!self) {
          const reach = clamp01(t / 0.35);
          const dots = Math.max(2, Math.round(Phaser.Math.Distance.BetweenPoints(from, at) / (3 * px)));
          for (let i = 0; i <= dots * reach; i++) {
            const p = lerp(from, at, i / dots);
            g.fillStyle(INK, 0.6 * (1 - t)).fillRect(snap(p.x, px), snap(p.y, px) + px, px, px);
            g.fillStyle(tint, 1 - t * 0.7).fillRect(snap(p.x, px), snap(p.y, px), px, px);
          }
        }
        if (t >= 0.25) bracket(g, at, TOUCH[touch], clamp01((t - 0.25) / 0.75), px);
      }
    });
  }

  /** A card landing on a hero: a gold thread from whoever played it. */
  aim(from: Point | null, to: Point, pace = 1): void {
    this.add(600 * pace, (g, t, px) => {
      if (from) {
        const reach = clamp01(t / 0.4);
        const p = lerp(from, to, reach);
        g.lineStyle(px, GOLD, 0.8 * (1 - t)).lineBetween(from.x, from.y, p.x, p.y);
      }
      if (t >= 0.3) bracket(g, to, GOLD, clamp01((t - 0.3) / 0.7), px);
    });
  }
}

/** Four corners closing in on a point, then fading: "this one". */
function bracket(g: Phaser.GameObjects.Graphics, at: Point, tint: number, k: number, px: number): void {
  const r = Math.round(10 - 4 * Math.min(1, k * 2));
  corners(g, at, r, tint, k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4, px);
}

/** Four corner marks `r` pixels out from a point, each pixel `px` world units. */
export function corners(g: Phaser.GameObjects.Graphics, at: Point, r: number, tint: number, alpha: number, px = 1): void {
  const [x, y] = [snap(at.x, px), snap(at.y, px)];
  g.fillStyle(tint, alpha);
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const cx = x + sx * r * px, cy = y + sy * r * px;
    g.fillRect(Math.min(cx, cx - sx * 3 * px), cy, 4 * px, px);
    g.fillRect(cx, Math.min(cy, cy - sy * 3 * px), px, 4 * px);
  }
}

/** Rounds to the grid of pixels `px` world units wide. */
export const snap = (v: number, px = 1): number => Math.round(v / px) * px;
