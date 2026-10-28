import Phaser from 'phaser';
import {
  createAgent, heroDef, HERO_IDS, LANE_NAMES, ROLE_LANE, ROLES,
  type Difficulty, type HeroId, type Role, type Side,
} from '@soiree/sim';
import { heroKey, heroOriginX } from '../art/forge.ts';
import { CREAM, GOLD, MAUVE, TEAM } from '../art/palette.ts';
import { LocalSession } from '../session.ts';
import { backdrop, button, centred, clip, LINE_H, text, W, wrap } from '../ui.ts';

/** Where the two partners of a pair stand, either side of the role between them. */
const SPREAD = 112;
const FIRST_ROW = 116;
const PITCH = 36;
/** One do-si-do across the floor, in ms. */
const SWAP_MS = 420;
const DETAIL_Y = 292;
const STORE = 'soiree.lineup';

/** Each role's two heroes, in lineup order; the pairing the player chooses within. */
const PAIRS = ROLES.map((role) => HERO_IDS.filter((h) => heroDef(h).role === role)) as [HeroId, HeroId][];

interface Pair {
  role: Role;
  /** Index into the role's pair of the hero dancing on the player's side. */
  mine: 0 | 1;
  sprites: [Phaser.GameObjects.Sprite, Phaser.GameObjects.Sprite];
  names: [Phaser.GameObjects.BitmapText, Phaser.GameObjects.BitmapText];
  busy: boolean;
}

/**
 * A stand-in for the draft: the ten heroes face each other across the
 * ballroom in five role pairs. Choosing a partner sends the other across the
 * floor, in the rival's livery: whoever you leave, the rival fields.
 */
export class Lineup extends Phaser.Scene {
  private difficulty: Difficulty = 'novice';
  private pairs: Pair[] = [];
  private detail: Phaser.GameObjects.BitmapText[] = [];

  constructor() { super('lineup'); }

  init(data: { difficulty: Difficulty }): void {
    this.difficulty = data.difficulty;
    this.pairs = [];
    this.detail = [];
  }

  create(): void {
    backdrop(this, 62);
    centred(this, W / 2, 12, 'choose your partners', GOLD, 2);
    centred(this, W / 2, 48, 'whoever you leave dances for your rival', CREAM).setAlpha(0.7);
    centred(this, W / 2 - SPREAD, 74, 'yours', TEAM[0].light);
    centred(this, W / 2 + SPREAD, 74, `rival, ${this.difficulty}`, TEAM[1].light);

    const saved = recall();
    ROLES.forEach((role, i) => this.pairs.push(this.stage(role, i, saved?.[i] === PAIRS[i]![1] ? 1 : 0)));

    for (let i = 0; i < 4; i++) this.detail.push(text(this, 40, DETAIL_Y + i * (LINE_H + 2), '', CREAM));
    this.describe(null);

    button(this, W / 2 - 120, 344, 90, 'back', () => this.scene.start('title'));
    button(this, W / 2, 344, 90, 'shuffle', () => this.pairs.forEach((p) => Math.random() < 0.5 && this.swap(p)));
    button(this, W / 2 + 120, 344, 90, 'begin', () => this.begin());
  }

  /** One role's row: the role and its lane in the middle, a hero on each side of it. */
  private stage(role: Role, i: number, mine: 0 | 1): Pair {
    const y = FIRST_ROW + i * PITCH;
    const lane = ROLE_LANE[role];
    centred(this, W / 2, y - 12, role, GOLD);
    centred(this, W / 2, y - 4, lane === -1 ? 'the camps' : `${LANE_NAMES[lane]} lane`, MAUVE);
    const ids = PAIRS[i]!;
    const make = (side: Side) => {
      const id = ids[side === 0 ? mine : 1 - mine]!;
      this.add.image(this.spot(side), y + 1, 'shadow').setAlpha(0.4).setScale(2);
      const sprite = this.add.sprite(this.spot(side), y, heroKey(id, side)).setOrigin(heroOriginX(side), 1).setScale(2);
      sprite.play({ key: `${heroKey(id, side)}-walk`, startFrame: i % 2 });
      return sprite;
    };
    const sprites: Pair['sprites'] = [make(0), make(1)];
    const label = (side: Side) => centred(this, this.spot(side) + (side === 0 ? -64 : 64), y - 8, '', CREAM);
    const pair: Pair = { role, mine, sprites, names: [label(0), label(1)], busy: false };
    this.rename(pair);

    for (const side of [0, 1] as const) {
      this.add.zone(W / 2 + (side === 0 ? -1 : 1) * (SPREAD + 2), y - 14, 200, PITCH - 2)
        .setInteractive({ useHandCursor: true })
        .on('pointerover', () => this.describe(this.partner(pair, side)))
        .on('pointerout', () => this.describe(null))
        .on('pointerdown', () => { this.swap(pair); this.describe(this.partner(pair, side)); });
    }
    return pair;
  }

  private spot(side: Side): number { return W / 2 + (side === 0 ? -SPREAD : SPREAD); }

  private partner(p: Pair, side: Side): HeroId {
    const ids = PAIRS[ROLES.indexOf(p.role)]!;
    return ids[side === 0 ? p.mine : 1 - p.mine]!;
  }

  private rename(p: Pair): void {
    for (const side of [0, 1] as const) p.names[side].setText(heroDef(this.partner(p, side)).name.toUpperCase()).setTint(TEAM[side].light);
  }

  /**
   * The partners cross the floor: one arcs over, one ducks under, and each
   * takes the other side's livery at the centre line, turning to face the
   * room once it arrives.
   */
  private swap(p: Pair): void {
    if (p.busy) return;
    p.busy = true;
    p.mine = (1 - p.mine) as 0 | 1;
    const [a, b] = p.sprites;
    const y = a.y;
    const from = [a.x, b.x];
    let crossed = false;
    this.tweens.addCounter({
      from: 0, to: 1, duration: SWAP_MS, ease: 'Sine.inOut',
      onUpdate: (tw) => {
        const t = tw.getValue() ?? 0;
        const lift = Math.sin(t * Math.PI);
        a.setPosition(Phaser.Math.Linear(from[0]!, from[1]!, t), y - lift * 10);
        b.setPosition(Phaser.Math.Linear(from[1]!, from[0]!, t), y + lift * 3);
        if (!crossed && t >= 0.5) {
          crossed = true;
          // Past the centre each wears its new side's colours, still walking the old way.
          this.dress(a, this.partner(p, 1), 1, true);
          this.dress(b, this.partner(p, 0), 0, true);
          this.rename(p);
        }
      },
      onComplete: () => {
        a.setPosition(from[1]!, y);
        b.setPosition(from[0]!, y);
        this.dress(a, this.partner(p, 1), 1, false);
        this.dress(b, this.partner(p, 0), 0, false);
        p.sprites = [b, a];
        p.busy = false;
        remember(this.pairs.map((q) => this.partner(q, 0)));
      },
    });
  }

  /** A side's livery and facing; `back` keeps the sprite facing the side it came from. */
  private dress(s: Phaser.GameObjects.Sprite, id: HeroId, side: Side, back: boolean): void {
    const key = heroKey(id, side);
    s.setFlipX(back).setOrigin(heroOriginX((back ? 1 - side : side) as Side), 1);
    s.play(`${key}-walk`);
  }

  /** The hovered hero's kit, or a reminder of how the floor works. */
  private describe(id: HeroId | null): void {
    const cols = Math.floor((W - 80) / 4);
    const d = id && heroDef(id);
    const lines = d
      ? [
        `${d.name}  hp ${d.stats.hp}  dmg ${d.stats.dmg}  res ${d.stats.res}  spd ${d.stats.spd}`,
        `map  ${d.map.name}: ${d.map.text}`,
        `fight  ${d.fight.name}: ${d.fight.text}`,
        `ult  ${d.ult.name}: ${d.ult.text}`,
      ]
      : ['click a hero to swap the pair. one hero per role, and the rival fields whoever you leave.'];
    this.detail.forEach((t, i) => {
      t.setText(clip(wrap((lines[i] ?? '').toUpperCase(), cols), 1, cols)[0] ?? '').setTint(!d ? MAUVE : i === 0 ? GOLD : CREAM);
    });
  }

  private begin(): void {
    if (this.pairs.some((p) => p.busy)) return;
    const seed = (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0;
    const teams: [HeroId[], HeroId[]] = [this.pairs.map((p) => this.partner(p, 0)), this.pairs.map((p) => this.partner(p, 1))];
    remember(teams[0]);
    this.scene.start('match', { session: new LocalSession(seed, createAgent(this.difficulty, seed ^ 0x5eed), 0, teams) });
  }
}

/** The last lineup this browser played, if it still fits the roster; a convenience, never required. */
function recall(): HeroId[] | null {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? 'null') as unknown;
    if (!Array.isArray(raw) || raw.length !== PAIRS.length) return null;
    return raw.every((id, i) => PAIRS[i]!.includes(id as HeroId)) ? raw as HeroId[] : null;
  } catch { return null; }
}

function remember(mine: HeroId[]): void {
  try { localStorage.setItem(STORE, JSON.stringify(mine)); } catch { /* private window: forget quietly */ }
}

