import Phaser from 'phaser';
import {
  FIGHT_EVERY, XP_UNIT, foe, heroDef, maxHp, stats,
  type Hero, type MatchView, type Side,
} from '@soiree/sim';
import { heroKey, heroOriginX } from '../art/forge.ts';
import { SIGNATURES } from '../art/heroes.ts';
import { AMBER, BLOOD, CREAM, DUSK, GOLD, INK, LEAF, MAUVE, NIGHT, PLUM, TEAM, VIOLET } from '../art/palette.ts';
import { CHARGE_NAME } from '../rules.ts';
import { centred, LINE_H, say, text, W } from '../ui.ts';

/** Collapsed and popped-out bar widths, the row pitch, and where the first row sits. */
const NARROW = 108;
const WIDE = 268;
const ROW_H = 24;
const PITCH = 27;
const TOP = 22;
/** Popping out takes this long, in ms. */
const POP_MS = 110;
/** Clock faces: radius, and the spacing between the three. */
const DIAL_R = 7;
const DIAL_STEP = 19;

interface Row {
  uid: number;
  side: Side;
  /** 0 collapsed .. 1 popped out. */
  open: number;
  g: Phaser.GameObjects.Graphics;
  icon: Phaser.GameObjects.Image;
  /** The map ability's, the fight ability's and the ultimate's clocks. */
  clocks: Phaser.GameObjects.BitmapText[];
  unknown: Phaser.GameObjects.BitmapText;
  lines: Phaser.GameObjects.BitmapText[];
  stance: Phaser.GameObjects.BitmapText;
}

/** One of a hero's three abilities as a clock: what is left to wait (0: ready) and how far along it is. */
export interface Dial { left: number; part: number; tint: number }

/** Each ability's colour, on the clocks and in the inspect panel alike. */
export const ABILITY_TINT = { map: LEAF, fight: AMBER, ult: VIOLET } as const;

/**
 * Where a hero's abilities stand: the map ability in map ticks, the fight
 * ability in the hero's own turns, the ultimate in fight phases or charges.
 */
export function dials(v: MatchView, h: Hero): [Dial, Dial, Dial] {
  const def = heroDef(h.id);
  // An aura is always on unless Unwrite has silenced it; then it waits out the phase.
  const mapWait = Math.max(0, h.mapReadyAt - v.mapTick);
  const mapSpan = def.map.every || FIGHT_EVERY;
  const map = { left: mapWait, part: 1 - Math.min(mapWait, mapSpan) / mapSpan, tint: ABILITY_TINT.map };
  // The fight ability comes on turns every, 2*every...: count the turns still to pass before it.
  const every = def.fight.every;
  const wait = h.fx.opening ? 0 : (every - ((h.fx.turns + 1) % every)) % every;
  const fight = { left: wait, part: 1 - wait / every, tint: ABILITY_TINT.fight };
  const u = def.ult;
  const ult = u.kind === 'ascension'
    ? { left: h.ascended ? 0 : u.charge - h.charge, part: h.ascended ? 1 : h.charge / u.charge, tint: ABILITY_TINT.ult }
    : { left: Math.max(0, h.ultReadyAt - v.fightPhase), part: 1 - Math.max(0, h.ultReadyAt - v.fightPhase) / u.cooldown, tint: ABILITY_TINT.ult };
  return [map, fight, ult];
}

/**
 * The two casts down the sides of the screen: yours on the left, the
 * rival's on the right. At rest a bar shows the hero's figure under a
 * health bar, as on the board, and a clock for each of its three
 * abilities; hovered, it slides out towards the board with the name and
 * the rest.
 * Rivals out of sight are greyed and show only what was last seen of them.
 */
export class Roster {
  private rows: Row[] = [];
  /** What this side last saw of each rival hero. */
  private seen = new Map<number, Hero>();
  hovered = -1;
  /** A hero to call out, such as the owner of the card under the pointer, or -1. */
  highlight = -1;

  constructor(private readonly scene: Phaser.Scene, private readonly me: Side) {}

  /** Screen rectangle of a row at its current width. */
  private rect(r: Row, index: number): Phaser.Geom.Rectangle {
    const w = NARROW + (WIDE - NARROW) * ease(r.open);
    const left = r.side === this.me ? 2 : W - 2 - w;
    return new Phaser.Geom.Rectangle(left, TOP + index * PITCH, w, ROW_H);
  }

  /** The hero bar under a screen point, if any. */
  heroAt(x: number, y: number): number {
    for (const side of [this.me, foe(this.me)]) {
      const list = this.rows.filter((r) => r.side === side);
      for (let i = 0; i < list.length; i++) if (this.rect(list[i]!, i).contains(x, y)) return list[i]!.uid;
    }
    return -1;
  }

  update(v: MatchView, selected: number, pointer: { x: number; y: number }, dt: number, time: number): void {
    if (!this.rows.length) this.build(v);
    for (const h of v.heroes) {
      if (h.side !== this.me && h.cell >= 0 && h.respawnAt < 0) this.seen.set(h.uid, structuredClone(h));
    }
    this.hovered = this.heroAt(pointer.x, pointer.y);
    for (const side of [this.me, foe(this.me)]) {
      this.rows.filter((r) => r.side === side).forEach((r, i) => {
        const target = r.uid === this.hovered ? 1 : 0;
        r.open = Phaser.Math.Clamp(r.open + Math.sign(target - r.open) * (dt / POP_MS), 0, 1);
        this.draw(v, r, i, selected, time);
      });
    }
  }

  private build(v: MatchView): void {
    const s = this.scene;
    for (const h of v.heroes) {
      const r: Row = {
        uid: h.uid, side: h.side, open: 0,
        g: s.add.graphics().setDepth(1100),
        icon: s.add.image(0, 0, heroKey(h.id, h.side), '0').setOrigin(heroOriginX(h.side), 1).setDepth(1101),
        clocks: [0, 1, 2].map(() => centred(s, 0, 0, '', CREAM).setDepth(1102)),
        unknown: centred(s, 0, 0, '?', CREAM).setDepth(1102),
        lines: [0, 1, 2].map(() => text(s, 0, 0, '', MAUVE).setDepth(1101)),
        stance: text(s, 0, 0, '', CREAM).setDepth(1101),
      };
      this.rows.push(r);
    }
  }

  /** The rival as last seen, or as it must have started if never seen; your own heroes are always known. */
  known(h: Hero): { hero: Hero; fresh: boolean; ever: boolean } {
    if (h.side === this.me || h.respawnAt >= 0 || h.cell >= 0) return { hero: h, fresh: true, ever: true };
    const last = this.seen.get(h.uid);
    if (last) return { hero: last, fresh: false, ever: true };
    const start = { ...structuredClone(h), xp: 0, charge: 0, grown: { dmg: 0, spd: 0 }, boons: [] };
    return { hero: { ...start, hp: maxHp(start) }, fresh: false, ever: false };
  }

  private draw(v: MatchView, r: Row, index: number, selected: number, time: number): void {
    const live = v.heroes[r.uid]!;
    const { hero: h, fresh, ever } = this.known(live);
    const def = heroDef(h.id);
    const mine = r.side === this.me;
    const box = this.rect(r, index);
    const near = mine ? box.x : box.right; // the screen edge the bar hangs from
    const dead = live.respawnAt >= 0;
    const dim = !fresh || dead;
    const g = r.g.clear();

    g.fillStyle(INK, 0.92).fillRect(box.x, box.y, box.width, box.height);
    g.fillStyle(r.uid === selected ? DUSK : PLUM, dim && r.open < 1 ? 0.55 : 0.95).fillRect(box.x + 1, box.y + 1, box.width - 2, box.height - 2);
    // The hero's signature colour on the outer edge: the same pair it wears on the board.
    const [main, second] = SIGNATURES[h.id];
    g.fillStyle(main, dim ? 0.4 : 1).fillRect(mine ? near + 1 : near - 4, box.y + 1, 3, box.height - 2);
    g.fillStyle(second, dim ? 0.4 : 1).fillRect(mine ? near + 1 : near - 4, box.y + box.height - 5, 3, 4);
    if (r.uid === selected) g.lineStyle(1, CREAM, 0.5 + 0.3 * Math.sin(time / 180)).strokeRect(box.x + 0.5, box.y + 0.5, box.width - 1, box.height - 1);

    if (r.uid === this.highlight) {
      const pulse = 0.6 + 0.4 * Math.sin(time / 120);
      g.lineStyle(1, GOLD, pulse).strokeRect(box.x - 0.5, box.y - 0.5, box.width + 1, box.height + 1);
      g.lineStyle(1, GOLD, pulse * 0.4).strokeRect(box.x - 1.5, box.y - 1.5, box.width + 3, box.height + 3);
    }

    // The figure under its health bar, and the clocks, live in the hanging end, which never moves.
    const figure = mine ? near + 6 : near - 6 - 20;
    const [fx, fy] = [figure + (mine ? 8 : 12), box.y + 21];
    r.icon.setPosition(fx, fy).setAlpha(dim ? 0.45 : 1).setTint(dim ? 0x9a94a8 : 0xffffff);
    // The same bar the hero wears on the board, at the same size and place.
    const max = maxHp(h);
    const hp = dead ? 0 : Math.max(0, h.hp);
    const [bx, by] = [fx - 5, fy - 18];
    g.fillStyle(INK).fillRect(bx, by, 10, 3);
    if (hp > 0) g.fillStyle(dim ? 0x6b6577 : h.retreating ? GOLD : TEAM[h.side].main).fillRect(bx + 1, by + 1, Math.max(1, Math.ceil((8 * hp) / max)), 1);
    if (!dim && h.stance === 'aggressive') g.fillStyle(BLOOD).fillRect(bx + 10, by, 2, 3);
    r.unknown.setVisible(!fresh && !dead).setPosition(fx + (mine ? 12 : -12), by + 2);

    // The ultimate's clock nearest the board, the map ability's nearest the edge.
    dials(v, h).forEach((d, i) => {
      const cx = mine ? near + NARROW - 12 - (2 - i) * DIAL_STEP : near - NARROW + 12 + (2 - i) * DIAL_STEP;
      dial(g, r.clocks[i]!, cx, box.y + 12, d, dim, time);
    });

    // The pop-out, revealed once the bar has slid all the way.
    const out = r.open >= 1;
    const px = mine ? near + NARROW + 2 : near - WIDE + 4;
    const lines = out ? [def.name, ...this.details(v, h, live, fresh, ever)] : ['', '', ''];
    r.lines.forEach((t, i) => say(t, lines[i]!).setPosition(px, box.y + 3 + i * LINE_H).setVisible(out)
      .setTint(i === 0 ? (dim ? MAUVE : GOLD) : MAUVE));
    const stance = dead || !fresh ? '' : h.stance;
    say(r.stance, out ? stance : '').setTint(h.stance === 'aggressive' ? BLOOD : CREAM)
      .setPosition(px + (WIDE - NARROW - 8) - stance.length * 4, box.y + 3).setAlpha(dim ? 0.6 : 1);
    if (out) g.fillStyle(DUSK, 0.6).fillRect(mine ? near + NARROW - 1 : near - NARROW, box.y + 3, 1, box.height - 6);
  }

  /** The pop-out lines under the name: growth and stats, then what is particular to this hero. */
  private details(v: MatchView, h: Hero, live: Hero, fresh: boolean, ever: boolean): string[] {
    const st = stats(h);
    const xp = Math.floor(h.xp / XP_UNIT);
    const fight = `dmg${st.dmg} res${st.res} spd${st.spd}`;
    const hp = `hp${Math.max(0, h.hp)}/${maxHp(h)}`;
    if (live.respawnAt >= 0) return [`xp ${xp}  down: back in ${live.respawnAt - v.mapTick}`, special(v, h).join('  ')];
    if (!fresh) return ever ? [`${hp} ${fight} xp ${xp}`, ''] : ['never seen', `hp full at the start ${fight}`];
    const doing = h.retreating ? 'retreating' : h.fx.engagement >= 0 ? 'fighting' : '';
    return [
      `xp ${xp} ${hp} ${fight}`,
      [doing, ...special(v, h)].filter(Boolean).join('  '),
    ];
  }
}

const ease = (t: number) => 1 - (1 - t) * (1 - t);

/** A little clock face: the wait as a filling wedge and the count still to go, lit when ready. */
function dial(g: Phaser.GameObjects.Graphics, label: Phaser.GameObjects.BitmapText, cx: number, cy: number, d: Dial, dim: boolean, time: number): void {
  const R = DIAL_R;
  g.fillStyle(INK).fillCircle(cx, cy, R + 1);
  g.fillStyle(NIGHT).fillCircle(cx, cy, R);
  g.lineStyle(1, DUSK).strokeCircle(cx, cy, R);
  if (d.left <= 0) {
    const pulse = dim ? 0.5 : 0.75 + 0.25 * Math.sin(time / 200);
    g.fillStyle(d.tint, pulse).fillCircle(cx, cy, R);
    g.fillStyle(0xffffff, pulse).fillRect(cx - 3, cy, 7, 1).fillRect(cx, cy - 3, 1, 7);
    say(label, '');
    return;
  }
  if (d.part > 0) g.fillStyle(d.tint, dim ? 0.3 : 0.55).slice(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + d.part * Math.PI * 2, false).fillPath();
  g.fillStyle(MAUVE).fillRect(cx, cy - R, 1, 2);
  say(label, String(d.left)).setPosition(cx + 1, cy + 1).setTint(dim ? MAUVE : CREAM);
}

/** Charges, growth, the map ability's clock and any boons: whatever only this hero has. */
function special(v: MatchView, h: Hero): string[] {
  const def = heroDef(h.id);
  const out: string[] = [];
  const name = CHARGE_NAME[h.id];
  if (name) out.push(def.ult.kind === 'ascension' ? `${name} ${h.charge}/${def.ult.charge}` : `${name} ${h.charge}`);
  if (h.grown.dmg || h.grown.spd) out.push(`grown${h.grown.dmg ? ` +${h.grown.dmg} dmg` : ''}${h.grown.spd ? ` +${h.grown.spd} spd` : ''}`);
  const wait = h.mapReadyAt - v.mapTick;
  if (def.map.every === 0) out.push(wait > 0 ? `${def.map.name} unwritten` : `${def.map.name} on`);
  else out.push(wait > 0 ? `${def.map.name} in ${wait}` : `${def.map.name} ready`);
  for (const b of h.boons) if (b.until > v.mapTick) out.push(b.kind === 'cadence' ? 'cadence' : b.kind.startsWith('rally') ? 'rally' : 'fuse');
  return out;
}
