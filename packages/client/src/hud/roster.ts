import Phaser from 'phaser';
import {
  XP_UNIT, foe, heroDef, maxHp, stats,
  type Hero, type MatchView, type Side,
} from '@soiree/sim';
import { SIGNATURES } from '../art/heroes.ts';
import { BLOOD, CREAM, DUSK, GOLD, INK, MAUVE, NIGHT, PLUM, TEAM, VIOLET } from '../art/palette.ts';
import { CHARGE_NAME } from '../rules.ts';
import { centred, LINE_H, text, W, wrap } from '../ui.ts';

/** Collapsed and popped-out bar widths, the row pitch, and where the first row sits. */
const NARROW = 108;
const WIDE = 248;
const ROW_H = 24;
const PITCH = 27;
const TOP = 22;
/** Popping out takes this long, in ms. */
const POP_MS = 110;
/** Health bar length. */
const BAR = 76;

interface Row {
  uid: number;
  side: Side;
  /** 0 collapsed .. 1 popped out. */
  open: number;
  g: Phaser.GameObjects.Graphics;
  name: Phaser.GameObjects.BitmapText;
  clock: Phaser.GameObjects.BitmapText;
  unknown: Phaser.GameObjects.BitmapText;
  lines: Phaser.GameObjects.BitmapText[];
  stance: Phaser.GameObjects.BitmapText;
}

/** What one side last saw of a rival hero, and when. */
interface Sighting { hero: Hero; tick: number }

/**
 * The two casts down the sides of the screen: yours on the left, the
 * rival's on the right. At rest a bar shows a name, a health bar and the
 * ultimate's clock; hovered, it slides out towards the board with the rest.
 * Rivals out of sight are greyed and show only what was last seen of them.
 */
export class Roster {
  private rows: Row[] = [];
  private seen = new Map<number, Sighting>();
  private detail: Phaser.GameObjects.Container | null = null;
  private detailKey = '';
  hovered = -1;

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

  update(v: MatchView, selected: number, ctrl: boolean, pointer: { x: number; y: number }, dt: number, time: number): void {
    if (!this.rows.length) this.build(v);
    for (const h of v.heroes) {
      if (h.side !== this.me && h.cell >= 0 && h.respawnAt < 0) this.seen.set(h.uid, { hero: structuredClone(h), tick: v.mapTick });
    }
    this.hovered = this.heroAt(pointer.x, pointer.y);
    for (const side of [this.me, foe(this.me)]) {
      this.rows.filter((r) => r.side === side).forEach((r, i) => {
        const target = r.uid === this.hovered ? 1 : 0;
        r.open = Phaser.Math.Clamp(r.open + Math.sign(target - r.open) * (dt / POP_MS), 0, 1);
        this.draw(v, r, i, selected, time);
      });
    }
    this.drawDetail(v, ctrl);
  }

  private build(v: MatchView): void {
    const s = this.scene;
    for (const h of v.heroes) {
      const r: Row = {
        uid: h.uid, side: h.side, open: 0,
        g: s.add.graphics().setDepth(1100),
        name: text(s, 0, 0, '', GOLD).setDepth(1101),
        clock: centred(s, 0, 0, '', CREAM).setDepth(1102),
        unknown: centred(s, 0, 0, '?', CREAM).setDepth(1102),
        lines: [0, 1, 2].map(() => text(s, 0, 0, '', MAUVE).setDepth(1101)),
        stance: text(s, 0, 0, '', CREAM).setDepth(1101),
      };
      this.rows.push(r);
    }
  }

  /** The rival as last seen, or as it must have started if never seen; your own heroes are always known. */
  private known(v: MatchView, h: Hero): { hero: Hero; fresh: boolean; tick: number } {
    if (h.side === this.me || h.respawnAt >= 0) return { hero: h, fresh: true, tick: v.mapTick };
    if (h.cell >= 0) return { hero: h, fresh: true, tick: v.mapTick };
    const last = this.seen.get(h.uid);
    if (last) return { hero: last.hero, fresh: false, tick: last.tick };
    const start = { ...structuredClone(h), xp: 0, charge: 0, grown: { dmg: 0, spd: 0 }, boons: [] };
    return { hero: { ...start, hp: maxHp(start) }, fresh: false, tick: -1 };
  }

  private draw(v: MatchView, r: Row, index: number, selected: number, time: number): void {
    const live = v.heroes[r.uid]!;
    const { hero: h, fresh, tick } = this.known(v, live);
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

    // Name, health and the ult clock live in the hanging end, which never moves.
    const inner = mine ? near + 7 : near - 7 - BAR;
    r.name.setText(def.name.toUpperCase()).setPosition(inner, box.y + 4).setTint(dim ? MAUVE : GOLD);
    const max = maxHp(h);
    const hp = dead ? 0 : Math.max(0, h.hp);
    const barY = box.y + 13;
    g.fillStyle(INK).fillRect(inner - 1, barY - 1, BAR + 2, 6);
    g.fillStyle(NIGHT).fillRect(inner, barY, BAR, 4);
    const fill = Math.ceil((BAR * hp) / max);
    const tint = dim ? 0x6b6577 : h.retreating ? GOLD : TEAM[h.side].main;
    g.fillStyle(tint).fillRect(mine ? inner : inner + BAR - fill, barY, fill, 4);
    g.fillStyle(dim ? 0x8d8799 : TEAM[h.side].light).fillRect(mine ? inner : inner + BAR - fill, barY, fill, 1);
    r.unknown.setVisible(!fresh && !dead).setPosition(inner + BAR / 2 + 1, barY + 2);
    if (!fresh && !dead) g.fillStyle(INK, 0.8).fillRect(inner + BAR / 2 - 3, barY - 1, 7, 7);

    this.drawClock(v, r, h, mine ? near + NARROW - 12 : near - NARROW + 12, box.y + 12, dim, time);

    // The pop-out, revealed once the bar has slid all the way.
    const out = r.open >= 1;
    const px = mine ? near + NARROW + 2 : near - WIDE + 4;
    const lines = out ? this.details(v, h, live, fresh, tick) : ['', '', ''];
    r.lines.forEach((t, i) => t.setText(lines[i]!.toUpperCase()).setPosition(px, box.y + 3 + i * LINE_H).setVisible(out));
    const stance = dead || !fresh ? '' : h.stance;
    r.stance.setText(out ? stance.toUpperCase() : '').setTint(h.stance === 'aggressive' ? BLOOD : CREAM)
      .setPosition(px + (WIDE - NARROW - 8) - stance.length * 4, box.y + 3).setAlpha(dim ? 0.6 : 1);
    if (out) g.fillStyle(DUSK, 0.6).fillRect(mine ? near + NARROW - 1 : near - NARROW, box.y + 3, 1, box.height - 6);
  }

  /** A little clock face: the ultimate's cooldown as a filling wedge and the phases still to wait. */
  private drawClock(v: MatchView, r: Row, h: Hero, cx: number, cy: number, dim: boolean, time: number): void {
    const def = heroDef(h.id);
    const ult = def.ult;
    const g = r.g;
    let left: number, part: number;
    if (ult.kind === 'ascension') {
      left = h.ascended ? 0 : ult.charge - h.charge;
      part = h.ascended ? 1 : h.charge / ult.charge;
    } else {
      left = Math.max(0, h.ultReadyAt - v.fightPhase);
      part = 1 - left / ult.cooldown;
    }
    const R = 7;
    g.fillStyle(INK).fillCircle(cx, cy, R + 1);
    g.fillStyle(NIGHT).fillCircle(cx, cy, R);
    g.lineStyle(1, DUSK).strokeCircle(cx, cy, R);
    if (left <= 0) {
      const pulse = dim ? 0.5 : 0.75 + 0.25 * Math.sin(time / 200);
      g.fillStyle(VIOLET, pulse).fillCircle(cx, cy, R);
      g.fillStyle(0xffffff, pulse).fillRect(cx - 3, cy, 7, 1).fillRect(cx, cy - 3, 1, 7);
      r.clock.setText('');
      return;
    }
    if (part > 0) {
      g.fillStyle(VIOLET, dim ? 0.3 : 0.55).slice(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + part * Math.PI * 2, false).fillPath();
    }
    g.fillStyle(MAUVE).fillRect(cx, cy - R, 1, 2);
    r.clock.setText(String(left)).setPosition(cx + 1, cy + 1).setTint(dim ? MAUVE : CREAM);
  }

  /** The three pop-out lines: growth and stance, the fight numbers, what is particular to this hero. */
  private details(v: MatchView, h: Hero, live: Hero, fresh: boolean, tick: number): string[] {
    const st = stats(h);
    const xp = Math.floor(h.xp / XP_UNIT);
    const hp = `${Math.max(0, h.hp)}/${maxHp(h)}`;
    if (live.respawnAt >= 0) return [`${h.role}  xp ${xp}`, `down: back in ${live.respawnAt - v.mapTick} ticks`, special(v, h).join('  ')];
    if (!fresh) {
      return [
        `${h.role}  ${tick < 0 ? 'never seen' : `last seen tick ${tick}`}`,
        tick < 0 ? 'hp ? at full when the ball began' : `hp ${hp} then  xp ${xp}`,
        `dmg ${st.dmg}  res ${st.res}  spd ${st.spd}${tick < 0 ? ' at least' : ''}`,
      ];
    }
    const doing = h.retreating ? 'retreating' : h.roam >= 0 ? 'roaming' : h.fx.engagement >= 0 ? 'fighting' : '';
    return [
      `${h.role}  xp ${xp}  ${doing}`,
      `hp ${hp} dmg ${st.dmg} res ${st.res} spd ${st.spd}`,
      special(v, h).join('  '),
    ];
  }

  /** Ctrl over a bar: the hero's three abilities, written out, under the bar. */
  private drawDetail(v: MatchView, ctrl: boolean): void {
    const r = this.rows.find((x) => x.uid === this.hovered);
    const key = ctrl && r && r.open >= 1 ? `${r.uid}` : '';
    if (key === this.detailKey) return;
    this.detailKey = key;
    this.detail?.destroy();
    this.detail = null;
    if (!key || !r) return;
    const h = v.heroes[r.uid]!;
    const def = heroDef(h.id);
    const index = this.rows.filter((x) => x.side === r.side).indexOf(r);
    const box = this.rect(r, index);
    const cols = Math.floor((WIDE - 10) / 4);
    const ult = def.ult;
    const ultTail = ult.kind === 'ascension' ? 'one time' : `cooldown ${ult.cooldown} fight phases`;
    const paras: [string, number][] = [
      [`map: ${def.map.name}${def.map.every ? ` (every ${def.map.every} ticks)` : ' (aura)'}`, GOLD], [def.map.text, CREAM],
      [`fight: ${def.fight.name} (every ${def.fight.every} turns)`, GOLD], [def.fight.text, CREAM],
      [`ultimate, ${ult.kind}: ${ult.name} (${ultTail})`, VIOLET], [ult.text, CREAM],
    ];
    const lines = paras.flatMap(([p, tint]) => wrap(p, cols).map((l) => [l, tint] as const));
    const height = lines.length * LINE_H + 6;
    const y = Math.min(box.bottom + 2, 268 - height);
    const c = this.scene.add.container(box.x, y).setDepth(1200);
    c.add(this.scene.add.graphics().fillStyle(INK, 0.95).fillRect(0, 0, WIDE, height).lineStyle(1, DUSK).strokeRect(0.5, 0.5, WIDE - 1, height - 1));
    lines.forEach(([l, tint], i) => c.add(text(this.scene, 5, 4 + i * LINE_H, l, tint)));
    this.detail = c;
  }
}

const ease = (t: number) => 1 - (1 - t) * (1 - t);

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
