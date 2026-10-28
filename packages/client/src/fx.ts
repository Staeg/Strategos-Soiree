import Phaser from 'phaser';
import { BLOOD, CREAM, GOLD, INK, LEAF, MANA_LIGHT, VIOLET } from './art/palette.ts';

export interface Point { x: number; y: number }

/** What an effect did to one target, which decides the colour it is marked in. */
export type Touch = 'harm' | 'heal' | 'shield';
const TOUCH: Record<Touch, number> = { harm: BLOOD, heal: LEAF, shield: MANA_LIGHT };

/** A drawing that lives `life` ms, redrawn every frame with its progress 0..1. */
interface Flourish {
  born: number;
  life: number;
  draw(g: Phaser.GameObjects.Graphics, t: number): void;
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

  constructor(private readonly g: Phaser.GameObjects.Graphics, private readonly now: () => number) {}

  private add(life: number, draw: Flourish['draw']): void {
    this.live.push({ born: this.now(), life, draw });
  }

  update(): void {
    const now = this.now();
    this.g.clear();
    this.live = this.live.filter((f) => now - f.born < f.life);
    for (const f of this.live) f.draw(this.g, clamp01((now - f.born) / f.life));
  }

  /** A streak from attacker to target, then a slash across it. */
  attack(from: Point, to: Point, tint: number, pace = 1): void {
    this.add(380 * pace, (g, t) => {
      const head = lerp(from, to, clamp01(t / 0.45));
      const tail = lerp(from, to, clamp01((t - 0.15) / 0.45));
      if (t < 0.6) {
        g.lineStyle(1, tint, 1).lineBetween(tail.x, tail.y, head.x, head.y);
        g.fillStyle(CREAM).fillRect(Math.round(head.x) - 1, Math.round(head.y) - 1, 2, 2);
      }
      if (t >= 0.4) {
        const k = clamp01((t - 0.4) / 0.6);
        const r = 3 + 3 * k;
        g.lineStyle(1, CREAM, 1 - k).lineBetween(to.x - r, to.y - r, to.x + r, to.y + r);
        g.lineStyle(1, BLOOD, 1 - k).lineBetween(to.x - r, to.y - r + 1, to.x + r, to.y + r + 1);
      }
    });
  }

  /** Minions' pot-shots: a fleck flying at the hero they hit. */
  fleck(from: Point, to: Point, tint: number, pace = 1): void {
    this.add(260 * pace, (g, t) => {
      const p = lerp(from, to, t);
      g.fillStyle(tint, 1 - t * 0.5).fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
    });
  }

  /** A ring off the caster, threads to each target, brackets on everyone touched. */
  ability(from: Point, targets: { at: Point; touch: Touch }[], ult: boolean, pace = 1): void {
    const tint = ult ? GOLD : VIOLET;
    this.add(700 * pace, (g, t) => {
      const burst = clamp01(t / 0.5);
      g.lineStyle(1, tint, 1 - burst).strokeCircle(from.x, from.y, 3 + 13 * burst);
      if (ult) g.lineStyle(1, CREAM, 1 - burst).strokeCircle(from.x, from.y, 2 + 8 * burst);
      for (const { at, touch } of targets) {
        const self = Math.abs(at.x - from.x) + Math.abs(at.y - from.y) < 2;
        if (!self) {
          const reach = clamp01(t / 0.35);
          const dots = Math.max(2, Math.round(Phaser.Math.Distance.BetweenPoints(from, at) / 3));
          for (let i = 0; i <= dots * reach; i++) {
            const p = lerp(from, at, i / dots);
            g.fillStyle(INK, 0.6 * (1 - t)).fillRect(Math.round(p.x), Math.round(p.y) + 1, 1, 1);
            g.fillStyle(tint, 1 - t * 0.7).fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
          }
        }
        if (t >= 0.25) bracket(g, at, TOUCH[touch], clamp01((t - 0.25) / 0.75));
      }
    });
  }

  /** A card landing on a hero: a gold thread from whoever played it. */
  aim(from: Point | null, to: Point, pace = 1): void {
    this.add(600 * pace, (g, t) => {
      if (from) {
        const reach = clamp01(t / 0.4);
        const p = lerp(from, to, reach);
        g.lineStyle(1, GOLD, 0.8 * (1 - t)).lineBetween(from.x, from.y, p.x, p.y);
      }
      if (t >= 0.3) bracket(g, to, GOLD, clamp01((t - 0.3) / 0.7));
    });
  }
}

/** Four corners closing in on a point, then fading: "this one". */
function bracket(g: Phaser.GameObjects.Graphics, at: Point, tint: number, k: number): void {
  const r = Math.round(10 - 4 * Math.min(1, k * 2));
  const a = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
  const [x, y] = [Math.round(at.x), Math.round(at.y)];
  g.fillStyle(tint, a);
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const cx = x + sx * r, cy = y + sy * r;
    g.fillRect(Math.min(cx, cx - sx * 3), cy, 4, 1);
    g.fillRect(cx, Math.min(cy, cy - sy * 3), 1, 4);
  }
}
