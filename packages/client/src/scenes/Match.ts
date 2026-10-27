import Phaser from 'phaser';
import {
  CARD_OWNER, CARDS_KEPT, CORE, DRAW_EVERY, FIGHT_EVERY, KEYWORD_TEXT, N_CELLS, XP_UNIT, cardDef, heroDef, laneCell, maxHp,
  type CardId, type GameEvent, type Hero, type MatchView, type Target,
} from '@soiree/sim';
import { heroKey, heroOriginX } from '../art/forge.ts';
import { BLOOD, CREAM, DUSK, GOLD, INK, LEAF, MAUVE, NIGHT, PLUM, TEAM, VIOLET } from '../art/palette.ts';
import { cellAtPoint, cellX, cellY, drawBoard, hexPoints } from '../board.ts';
import { CARD_H, CARD_W, cardFace, iconKey } from '../cards.ts';
import type { Session } from '../session.ts';
import { button, centred, H, text, W, type Button } from '../ui.ts';

/** Where heroes stand inside a cell, by side and by arrival order. */
const SLOTS: Record<0 | 1, [number, number][]> = {
  0: [[-6, 4], [-1, 10], [-11, 10], [-7, -2], [-12, 4]],
  1: [[6, 4], [1, 10], [11, 10], [7, -2], [12, 4]],
};
const SPEEDS = [0.5, 1, 2, 4];
const PANEL_X = 312;

type Adder = <T extends Phaser.GameObjects.GameObject>(o: T) => T;

type Mode =
  | { kind: 'idle' }
  | { kind: 'roam' }
  | { kind: 'ult' }
  /** Aiming a card: first a source hero (unless bound), then a target. */
  | { kind: 'card'; handIndex: number; source: number };

interface HeroView {
  sprite: Phaser.GameObjects.Sprite;
  striking: number;
}

export class Match extends Phaser.Scene {
  private session!: Session;
  private heroes = new Map<number, HeroView>();
  private structures: Phaser.GameObjects.Image[] = [];
  private creeps: Phaser.GameObjects.Image[][] = [];
  private counts = new Map<number, Phaser.GameObjects.BitmapText>();
  private fog!: Phaser.GameObjects.Graphics;
  private marks!: Phaser.GameObjects.Graphics;
  private bars!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Graphics;
  private phaseLabel!: Phaser.GameObjects.BitmapText;
  private clock!: Phaser.GameObjects.BitmapText;
  private hint!: Phaser.GameObjects.BitmapText;
  private speedButtons: Button[] = [];
  private panel!: Phaser.GameObjects.Container;
  private panelKey = '';
  private mode: Mode = { kind: 'idle' };
  private selected = -1;
  private hover = -1;
  private alt = false;
  private hoverCard: CardId | null = null;
  private discard = new Set<number>();
  private log: string[] = [];
  private fogKey = -1;

  constructor() { super('match'); }

  init(data: { session: Session }): void {
    this.session = data.session;
    this.heroes.clear();
    this.counts.clear();
    this.structures = [];
    this.creeps = [];
    this.speedButtons = [];
    this.panelKey = '';
    this.mode = { kind: 'idle' };
    this.selected = -1;
    this.discard.clear();
    this.log = [];
    this.fogKey = -1;
  }

  private get v(): MatchView { return this.session.view; }
  private get me() { return this.session.side; }

  create(): void {
    this.add.graphics().fillStyle(NIGHT).fillRect(0, 0, W, H);
    drawBoard(this);
    this.v.structures.forEach((st) => {
      const key = st.kind === 'core' ? `nexus-${st.side}` : `tower-${st.side}`;
      this.structures.push(this.add.image(cellX(st.cell), cellY(st.cell) + (st.kind === 'core' ? 10 : 7), key).setOrigin(0.5, 1).setDepth(cellY(st.cell) + 90));
    });
    this.v.camps.forEach((c) => {
      this.creeps.push([0, 1, 2, 3].map((k) => this.add.image(cellX(c.cell) - 6 + (k % 2) * 6, cellY(c.cell) - 6 + Math.floor(k / 2) * 6, 'creep').setDepth(60)));
    });
    this.fog = this.add.graphics().setDepth(50);
    this.marks = this.add.graphics().setDepth(70);
    this.bars = this.add.graphics().setDepth(400);
    this.hud = this.add.graphics().setDepth(1000);
    this.phaseLabel = centred(this, 164, 9, '').setDepth(1001);
    this.clock = text(this, 12, 308, '', MAUVE).setDepth(1001);
    this.hint = text(this, 12, 348, '', MAUVE).setDepth(1001);
    this.panel = this.add.container(0, 0).setDepth(1500);

    SPEEDS.forEach((sp, i) => {
      this.speedButtons.push(button(this, 152 + i * 34, 324, 30, `${sp}x`, () => { this.session.speed = sp; this.session.paused = false; }).setDepth(1001));
    });
    this.speedButtons.push(button(this, 118, 324, 30, 'II', () => { this.session.paused = !this.session.paused; }).setDepth(1001));

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => { this.hover = cellAtPoint(p.x, p.y); });
    this.input.on('pointerdown', (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (over.length === 0) this.clickBoard(p);
    });
    const kb = this.input.keyboard!;
    kb.on('keydown', (e: KeyboardEvent) => this.key(e));
    kb.on('keyup', (e: KeyboardEvent) => { if (e.key === 'Alt') { this.alt = false; this.panelKey = ''; } });
    this.game.events.on(Phaser.Core.Events.BLUR, () => { this.alt = false; });

    this.banner('The ball begins');
  }

  override update(time: number): void {
    for (const e of this.session.update(this.game.loop.delta)) this.react(e, time);
    if (this.v.phase !== 'plan' && this.mode.kind === 'card') this.mode = { kind: 'idle' };
    this.drawFog();
    this.drawUnits(time);
    this.drawHud();
    this.drawPanel();
  }

  // ---- input ---------------------------------------------------------------

  private key(e: KeyboardEvent): void {
    if (e.key === 'Alt') {
      e.preventDefault();
      this.alt = true;
      this.panelKey = '';
      return;
    }
    const k = e.key.toLowerCase();
    if (k === 'escape') this.mode = { kind: 'idle' };
    else if (k === ' ') this.session.paused = !this.session.paused;
    else if (k === 's') this.orderStance();
    else if (k === 'r') this.beginOrder('roam');
    else if (k === 'u') this.beginOrder('ult');
    else if (k === 'enter' && this.v.phase === 'plan') this.commit();
    else if (['1', '2', '3', '4'].includes(k)) this.session.speed = SPEEDS[Number(k) - 1]!;
    this.panelKey = '';
  }

  private own(uid: number): Hero | undefined {
    const h = this.v.heroes[uid];
    return h && h.side === this.me ? h : undefined;
  }

  private orderStance(): void {
    const h = this.own(this.selected);
    if (h && this.v.phase === 'map') this.session.submit({ type: 'stance', uid: h.uid });
  }

  private beginOrder(kind: 'roam' | 'ult'): void {
    if (this.v.phase === 'map' && this.own(this.selected)) this.mode = { kind };
  }

  /** Heroes drawn near a screen point, nearest first. */
  private heroesNear(x: number, y: number): Hero[] {
    return this.v.heroes
      .filter((h) => h.respawnAt < 0 && h.cell >= 0 && this.heroes.get(h.uid)?.sprite.visible)
      .map((h) => [h, Phaser.Math.Distance.Between(x, y, this.heroes.get(h.uid)!.sprite.x, this.heroes.get(h.uid)!.sprite.y - 6)] as const)
      .filter(([, d]) => d < 12)
      .sort((a, b) => a[1] - b[1])
      .map(([h]) => h);
  }

  private clickBoard(p: Phaser.Input.Pointer): void {
    const cell = cellAtPoint(p.x, p.y);
    const near = this.heroesNear(p.x, p.y);
    const mode = this.mode;
    if (mode.kind === 'roam' || mode.kind === 'ult') {
      if (cell >= 0) this.session.submit({ type: mode.kind, uid: this.selected, cell });
      this.mode = { kind: 'idle' };
      return;
    }
    if (mode.kind === 'card') {
      const def = cardDef(this.v.sides[this.me].hand[mode.handIndex]!);
      if (mode.source < 0) {
        const src = near.find((h) => h.side === this.me);
        if (src) this.aimCard(mode.handIndex, src.uid);
        return;
      }
      if (def.aim === 'enemy' || def.aim === 'ally') {
        const t = near.find((h) => (def.aim === 'enemy') === (h.side !== this.me));
        if (t) this.play(mode.handIndex, mode.source, { kind: 'hero', uid: t.uid });
      } else if (def.aim === 'tower') {
        const st = this.v.structures.find((x) => x.cell === cell && x.side === this.me && x.hp > 0);
        if (st) this.play(mode.handIndex, mode.source, { kind: 'cell', cell });
      } else if (def.aim === 'siege') {
        const t = near.find((h) => h.side !== this.me);
        const st = this.v.structures.find((x) => x.cell === cell && x.side !== this.me && x.hp > 0);
        if (t) this.play(mode.handIndex, mode.source, { kind: 'hero', uid: t.uid });
        else if (st) this.play(mode.handIndex, mode.source, { kind: 'cell', cell });
      }
      return;
    }
    const mine = near.find((h) => h.side === this.me);
    if (mine) this.selected = mine.uid;
  }

  private pickCard(handIndex: number): void {
    const id = this.v.sides[this.me].hand[handIndex]!;
    const owner = CARD_OWNER[id];
    const bound = owner && this.v.heroes.find((h) => h.side === this.me && h.id === owner);
    if (bound) return this.aimCard(handIndex, bound.uid);
    const sel = this.own(this.selected);
    this.mode = { kind: 'card', handIndex, source: -1 };
    if (sel && sel.respawnAt < 0) this.aimCard(handIndex, sel.uid);
  }

  private aimCard(handIndex: number, source: number): void {
    const def = cardDef(this.v.sides[this.me].hand[handIndex]!);
    if (def.aim === 'none') return this.play(handIndex, source, { kind: 'none' });
    this.mode = { kind: 'card', handIndex, source };
  }

  private play(handIndex: number, source: number, target: Target): void {
    this.session.submit({ type: 'play', handIndex, source, target });
    this.mode = { kind: 'idle' };
    this.discard.clear();
  }

  private commit(): void {
    this.session.submit({ type: 'commit', discard: [...this.discard] });
    this.discard.clear();
    this.mode = { kind: 'idle' };
  }

  // ---- the board ---------------------------------------------------------------

  private drawFog(): void {
    const v = this.v;
    if (this.fogKey === v.seq) return;
    this.fogKey = v.seq;
    const g = this.fog.clear();
    for (let c = 0; c < N_CELLS; c++) {
      if (v.visible[c]) continue;
      g.fillStyle(INK, 0.55).fillPoints(hexPoints(c, 1), true);
      g.fillStyle(PLUM, 0.5);
      for (let k = -2; k <= 2; k++) g.fillRect(cellX(c) + k * 4 - (c % 2), cellY(c) - 9 + ((k + 2) % 3) * 8, 1, 1);
    }
  }

  private heroPos(v: MatchView, h: Hero): { x: number; y: number } | null {
    if (h.cell < 0 || h.respawnAt >= 0) return null;
    const here = v.heroes.filter((o) => o.side === h.side && o.cell === h.cell && o.respawnAt < 0);
    const [dx, dy] = SLOTS[h.side][Math.max(0, here.indexOf(h)) % 5]!;
    return { x: cellX(h.cell) + dx, y: cellY(h.cell) + dy };
  }

  private drawUnits(time: number): void {
    const { view: v, prev, alpha } = this.session;
    const g = this.marks.clear();
    const bars = this.bars.clear();

    // Structures, with a sliver of health beneath each.
    v.structures.forEach((st, i) => {
      const img = this.structures[i]!;
      const down = st.hp <= 0;
      img.setAlpha(down ? 0.35 : 1).setTint(down ? 0x555555 : 0xffffff);
      if (down) return;
      const [x, y] = [cellX(st.cell), cellY(st.cell) + (st.kind === 'core' ? 12 : 9)];
      bars.fillStyle(INK).fillRect(x - 7, y, 14, 3);
      bars.fillStyle(TEAM[st.side].main).fillRect(x - 6, y + 1, Math.ceil((12 * st.hp) / st.maxHp), 1);
      if (v.mapTick < st.guardedUntil) bars.lineStyle(1, GOLD, 0.9).strokePoints(hexPoints(st.cell, 3), true);
    });

    v.camps.forEach((c, i) => {
      const n = c.creeps;
      this.creeps[i]!.forEach((img, k) => img.setVisible(n < 0 ? k === 0 : k < n).setAlpha(n < 0 ? 0.3 : 1));
    });

    // Minions as pips: each side's count in a corner of the cell.
    const totals = new Map<number, number>();
    for (const m of v.minions) {
      const key = laneCell(m.lane, m.pos) * 2 + m.side;
      totals.set(key, (totals.get(key) ?? 0) + m.n);
    }
    for (const t of this.counts.values()) t.setVisible(false);
    for (const [key, n] of totals) {
      const [cell, side] = [key >> 1, (key & 1) as 0 | 1];
      const x = cellX(cell) + (side === 0 ? -11 : 2), y = cellY(cell) - 12;
      g.fillStyle(INK).fillRect(x - 1, y - 1, 11, 4);
      for (let k = 0; k < Math.min(n, 3); k++) g.fillStyle(TEAM[side].light).fillRect(x + k * 3, y, 2, 2);
      let label = this.counts.get(key);
      if (!label) this.counts.set(key, label = text(this, 0, 0, '', CREAM).setDepth(71));
      label.setText(String(n)).setPosition(x + (side === 0 ? -4 * String(n).length - 1 : 10), y - 2).setTint(TEAM[side].light).setVisible(true);
    }

    for (const e of v.engagements) {
      if (e.over) continue;
      const pulse = 0.5 + 0.5 * Math.sin(time / 120);
      g.lineStyle(1, GOLD, 0.5 + 0.5 * pulse).strokePoints(hexPoints(e.cell, 0), true);
      g.lineStyle(1, BLOOD, 0.4 * pulse).strokePoints(hexPoints(e.cell, 2), true);
    }
    for (const w of v.wards) {
      for (let c = 0; c < N_CELLS; c++) if (v.visible[c] && Phaser.Math.Distance.Between(cellX(c), cellY(c), cellX(w.cell), cellY(w.cell)) <= w.radius * 28 + 1) g.lineStyle(1, VIOLET, 0.4).strokePoints(hexPoints(c, 2), true);
    }
    if (this.hover >= 0 && this.mode.kind !== 'idle') g.lineStyle(1, CREAM, 0.8).strokePoints(hexPoints(this.hover, 1), true);

    for (const h of v.heroes) {
      let hv = this.heroes.get(h.uid);
      const key = heroKey(h.id, h.side);
      if (!hv) {
        hv = { sprite: this.add.sprite(0, 0, key).setOrigin(heroOriginX(h.side), 1).play(`${key}-walk`), striking: 0 };
        this.heroes.set(h.uid, hv);
      }
      const now = this.heroPos(v, h);
      const before = prev.heroes[h.uid] && this.heroPos(prev, prev.heroes[h.uid]!);
      hv.sprite.setVisible(now !== null);
      if (!now) continue;
      const moving = before && v.phase === 'map' && (before.x !== now.x || before.y !== now.y);
      const x = moving ? Phaser.Math.Linear(before.x, now.x, alpha) : now.x;
      const y = moving ? Phaser.Math.Linear(before.y, now.y, alpha) : now.y;
      hv.sprite.setPosition(Math.round(x), Math.round(y)).setDepth(100 + y);
      if (time > hv.striking) {
        const anim = moving ? `${key}-walk` : `${key}-idle`;
        if (hv.sprite.anims.currentAnim?.key !== anim) hv.sprite.play(anim);
      }
      const max = maxHp(h);
      const [bx, by] = [Math.round(x) - 5, Math.round(y) - 17];
      bars.fillStyle(INK).fillRect(bx, by, 10, 3);
      bars.fillStyle(h.retreating ? GOLD : TEAM[h.side].main).fillRect(bx + 1, by + 1, Math.max(1, Math.ceil((8 * h.hp) / max)), 1);
      if (h.stance === 'aggressive') bars.fillStyle(BLOOD).fillRect(bx + 10, by, 2, 3);
      if (h.uid === this.selected) {
        bars.lineStyle(1, CREAM, 0.6 + 0.4 * Math.sin(time / 150)).strokeRect(Math.round(x) - 7, Math.round(y) - 14, 14, 15);
        if (h.roam >= 0) bars.lineStyle(1, CREAM, 0.5).strokePoints(hexPoints(h.roam, 4), true);
      }
    }
  }

  // ---- what happened -----------------------------------------------------------

  private react(e: GameEvent, time: number): void {
    const v = this.v;
    const at = (uid: number) => {
      const s = this.heroes.get(uid)?.sprite;
      return s?.visible ? { x: s.x, y: s.y } : null;
    };
    switch (e.type) {
      case 'act': {
        const hv = this.heroes.get(e.uid);
        const h = v.heroes[e.uid]!;
        if (hv) { hv.sprite.play(`${heroKey(h.id, h.side)}-strike`); hv.striking = time + 300; }
        for (const hit of e.hits) {
          const p = at(hit.uid) ?? (h.cell >= 0 ? { x: cellX(h.cell), y: cellY(h.cell) } : null);
          if (!p) continue;
          if (hit.amount > 0) {
            this.add.sprite(p.x, p.y - 8, 'spark').setDepth(3000).play('spark');
            this.float(p.x, p.y - 20, String(hit.amount), e.kind === 'attack' ? CREAM : GOLD);
          } else if (hit.amount < 0) this.float(p.x, p.y - 20, `+${-hit.amount}`, LEAF);
          if (hit.shield > 0) this.float(p.x + 8, p.y - 26, `(${hit.shield})`, MAUVE);
        }
        return;
      }
      case 'squad': {
        const fight = v.engagements.find((x) => x.id === e.id);
        if (!fight) return;
        for (const hit of e.hits) {
          const p = (hit.uid >= 0 && at(hit.uid)) || { x: cellX(fight.cell), y: cellY(fight.cell) };
          if (hit.amount > 0) this.float(p.x, p.y - 20, String(hit.amount), TEAM[e.side].light);
        }
        return;
      }
      case 'hurt': {
        const p = at(e.uid);
        if (p && e.by === 'card') this.float(p.x, p.y - 20, String(e.amount), GOLD);
        return;
      }
      case 'death': {
        const p = at(e.uid);
        const h = v.heroes[e.uid]!;
        this.add.sprite(p?.x ?? cellX(CORE[h.side]), (p?.y ?? cellY(CORE[h.side])) - 6, 'puff').setDepth(3000).play('puff');
        this.note(`${h.side === this.me ? 'Your' : 'Rival'} ${heroDef(h.id).name} falls`);
        return;
      }
      case 'fall': {
        const st = v.structures[e.index]!;
        this.add.sprite(cellX(st.cell), cellY(st.cell) - 4, 'puff').setDepth(3000).setScale(2).play('puff');
        this.note(`${st.side === this.me ? 'Your' : 'Rival'} ${st.kind} ${st.kind === 'core' ? 'shatters' : 'tower falls'}`);
        return;
      }
      case 'card': {
        const def = cardDef(e.play.card);
        const who = e.play.side === this.me ? 'You' : 'Rival';
        this.note(`${who}: ${def.name}${e.fizzle ? ` fizzles (${e.fizzle})` : ''}`);
        return;
      }
      case 'engage':
        this.add.sprite(cellX(e.cell), cellY(e.cell) - 4, 'spark').setDepth(3000).setScale(3).play('spark');
        return;
      case 'phase':
        if (e.phase === 'plan') this.banner('Fight phase');
        if (e.phase === 'resolve' && v.initiative < 0) this.banner('Reveal');
        if (e.phase === 'map') { this.log = []; this.discard.clear(); }
        if (e.phase === 'over') this.finale();
        this.panelKey = '';
        return;
      default:
        return;
    }
  }

  private note(line: string): void {
    this.log.push(line);
    if (this.log.length > 7) this.log.shift();
    this.panelKey = '';
  }

  private float(x: number, y: number, value: string, tint: number): void {
    const t = centred(this, x, y, value, tint).setDepth(3001);
    this.tweens.add({ targets: t, y: y - 10, alpha: 0, duration: 700, ease: 'Quad.out', onComplete: () => t.destroy() });
  }

  private banner(label: string): void {
    const t = centred(this, 164, 40, label, GOLD, 2).setDepth(3000).setAlpha(0);
    this.tweens.add({ targets: t, alpha: 1, duration: 250, hold: 900, yoyo: true, onComplete: () => t.destroy() });
  }

  // ---- heads-up display -----------------------------------------------------------

  private drawHud(): void {
    const v = this.v;
    const g = this.hud.clear();
    g.fillStyle(INK).fillRect(0, 0, 300, 18).fillRect(0, 300, 300, H - 300);
    g.fillStyle(DUSK).fillRect(0, 18, 300, 1).fillRect(0, 300, 300, 1).fillRect(300, 0, 1, H);
    for (const side of [0, 1] as const) {
      const total = v.structures.filter((s) => s.side === side).reduce((t, s) => t + Math.max(0, s.hp), 0);
      const max = v.structures.filter((s) => s.side === side).reduce((t, s) => t + s.maxHp, 0);
      const w = 96, x = side === this.me ? 6 : 300 - 6 - w;
      const fill = Math.round((w * total) / max);
      g.fillStyle(NIGHT).fillRect(x, 6, w, 6);
      g.fillStyle(TEAM[side].main).fillRect(side === this.me ? x : x + w - fill, 6, fill, 6);
      g.fillStyle(TEAM[side].light).fillRect(side === this.me ? x : x + w - fill, 6, fill, 1);
    }
    const phaseName = { map: 'map', plan: 'commit', resolve: 'reveal', clash: 'clash', over: 'the end' }[v.phase];
    this.phaseLabel.setText(`${phaseName} ${v.phase === 'map' || v.fightPhase === 0 ? '' : `#${v.fightPhase}`}`.toUpperCase());

    const toFight = FIGHT_EVERY - (v.mapTick % FIGHT_EVERY);
    const toDraw = DRAW_EVERY - (v.mapTick % DRAW_EVERY);
    g.fillStyle(NIGHT).fillRect(12, 314, 96, 3);
    g.fillStyle(GOLD).fillRect(12, 314, Math.round((96 * (FIGHT_EVERY - toFight)) / FIGHT_EVERY), 3);
    const s = this.session;
    this.clock.setText(`TICK ${v.mapTick}  FIGHT IN ${v.phase === 'map' ? toFight : 0}  DRAW IN ${toDraw}${v.phase === 'clash' ? `  FIGHT TICK ${v.fightTick}` : ''}`);
    this.speedButtons.forEach((b, i) => b.setSelected(i < SPEEDS.length ? !s.paused && s.speed === SPEEDS[i] : s.paused));
    const orders = v.sides[this.me].orders;
    const hints: Record<Mode['kind'], string> = {
      idle: `click a hero   S stance (${orders.stance})   R roam (${orders.roam})   U ult   space pause   hold alt for keywords`,
      roam: 'click a cell to roam to   esc cancels',
      ult: 'click a cell to aim the ultimate   esc cancels',
      card: this.mode.kind === 'card' && this.mode.source < 0 ? 'click the hero who plays it   esc cancels' : 'click its target   esc cancels',
    };
    this.hint.setText(hints[this.mode.kind].toUpperCase());
  }

  // ---- the side panel -------------------------------------------------------------

  private drawPanel(): void {
    const v = this.v;
    // While planning, steps only tick over to wait for commits: rebuild on what the player can see change.
    const me = v.sides[this.me];
    const moment = v.phase === 'plan' ? [me.hand, me.plays, me.committed, v.sides[this.me === 0 ? 1 : 0].committed] : v.seq;
    const key = JSON.stringify([moment, this.selected, this.mode, this.alt, this.hoverCard, [...this.discard], this.log]);
    if (key === this.panelKey) return;
    this.panelKey = key;
    this.panel.removeAll(true);
    const add: Adder = (o) => { this.panel.add(o); return o; };
    this.roster(add);
    if (v.phase === 'map' || v.phase === 'over') this.mapPanel(124, add);
    else this.fightPanel(124, add);
  }

  private roster(add: Adder): void {
    const v = this.v;
    v.heroes.filter((h) => h.side === this.me).forEach((h, i) => {
      const y = 12 + i * 22;
      const def = heroDef(h.id);
      const row = add(this.add.zone(PANEL_X + 160, y + 6, 316, 21).setInteractive({ useHandCursor: true }));
      row.on('pointerdown', () => { this.selected = h.uid; this.panelKey = ''; });
      const bg = add(this.add.graphics());
      bg.fillStyle(h.uid === this.selected ? DUSK : PLUM, 0.8).fillRect(PANEL_X, y - 4, 316, 20);
      add(this.add.sprite(PANEL_X + 10, y + 14, heroKey(h.id, h.side), '0').setOrigin(heroOriginX(h.side), 1));
      add(text(this, PANEL_X + 24, y - 1, def.name, GOLD));
      add(text(this, PANEL_X + 24, y + 7, `${h.role}  ${Math.floor(h.xp / XP_UNIT)} xp${h.charge > 0 && def.ult.kind !== 'ascension' ? `  ${h.charge}*` : ''}`, MAUVE));
      const max = maxHp(h);
      bg.fillStyle(INK).fillRect(PANEL_X + 110, y, 82, 5);
      bg.fillStyle(h.respawnAt >= 0 ? DUSK : TEAM[h.side].main).fillRect(PANEL_X + 111, y + 1, Math.ceil((80 * Math.max(0, h.hp)) / max), 3);
      add(text(this, PANEL_X + 110, y + 7, `${Math.max(0, h.hp)}/${max}`, CREAM));
      const status = h.respawnAt >= 0 ? `back in ${h.respawnAt - v.mapTick}` : h.retreating ? 'retreating' : h.roam >= 0 ? 'roaming' : h.fx.engagement >= 0 ? 'engaged' : '';
      add(text(this, PANEL_X + 200, y - 1, h.stance, h.stance === 'aggressive' ? BLOOD : CREAM));
      add(text(this, PANEL_X + 200, y + 7, status, MAUVE));
      const ult = def.ult;
      const ready = ult.kind === 'ascension' ? h.ascended : v.fightPhase >= h.ultReadyAt;
      const label = ult.kind === 'ascension' ? (h.ascended ? 'ascended' : `asc ${h.charge}/${ult.charge}`) : ready ? 'ult ready' : `ult in ${h.ultReadyAt - v.fightPhase}`;
      add(text(this, PANEL_X + 258, y - 1, label, ready ? VIOLET : DUSK));
    });
  }

  private mapPanel(top: number, add: Adder): void {
    const v = this.v;
    const h = this.own(this.selected);
    if (!h) {
      add(text(this, PANEL_X + 4, top, 'select a hero to give orders', MAUVE));
    } else {
      const def = heroDef(h.id);
      const st = def.stats;
      add(text(this, PANEL_X + 4, top, `${def.name}   dmg ${st.dmg}  hp ${st.hp}  res ${st.res}  spd ${st.spd}`, GOLD));
      const lines: [string, string][] = [
        [`map: ${def.map.name}`, `${def.map.text} every ${def.map.every} ticks.`],
        [`fight: ${def.fight.name}`, `${def.fight.text} every ${def.fight.every} turns.`],
        [`ultimate (${def.ult.kind}): ${def.ult.name}`, def.ult.text],
      ];
      lines.forEach(([a, b], i) => {
        add(text(this, PANEL_X + 4, top + 12 + i * 18, a, CREAM));
        add(this.add.bitmapText(PANEL_X + 4, top + 19 + i * 18, 'pixel', b.toUpperCase()).setTint(MAUVE).setMaxWidth(312));
      });
      const orders = v.sides[this.me].orders;
      const y = top + 78;
      const alive = h.respawnAt < 0 && v.phase === 'map';
      add(button(this, PANEL_X + 50, y, 96, h.stance === 'passive' ? 'go aggressive' : 'go passive', () => this.orderStance())).setEnabled(alive && orders.stance > 0);
      add(button(this, PANEL_X + 154, y, 96, 'roam', () => this.beginOrder('roam'))).setEnabled(alive && orders.roam > 0).setSelected(this.mode.kind === 'roam');
      const command = def.ult.kind === 'command' && v.fightPhase >= h.ultReadyAt;
      add(button(this, PANEL_X + 258, y, 96, def.ult.kind === 'command' ? def.ult.name : 'no command', () => this.beginOrder('ult')))
        .setEnabled(alive && command).setSelected(this.mode.kind === 'ult');
      add(text(this, PANEL_X + 4, y + 11, `orders left until the fight phase: ${orders.stance} stance, ${orders.roam} roam`, MAUVE));
    }
    const me = v.sides[this.me];
    const rival = v.sides[this.me === 0 ? 1 : 0];
    add(text(this, PANEL_X + 4, top + 108, `your hand ${me.hand.length}, deck ${me.deck.length}, mana ${me.mana}.  rival hand ${v.rivalHand}, mana ${rival.mana}`, CREAM));
    me.hand.forEach((id, i) => {
      const def = cardDef(id);
      const x = PANEL_X + 4 + (i % 2) * 158, y = top + 122 + Math.floor(i / 2) * 9;
      add(this.add.image(x + 4, y + 2, iconKey(id, this.me)));
      add(text(this, x + 12, y, `${def.cost}/${def.initiative} ${def.name}`, CREAM));
    });
  }

  /** The plan, reveal and clash screens share the timeline; planning adds the hand. */
  private fightPanel(top: number, add: Adder): void {
    const v = this.v;
    const me = v.sides[this.me];
    const rival = v.sides[this.me === 0 ? 1 : 0];
    const planning = v.phase === 'plan' && !me.committed;
    const g = add(this.add.graphics());
    const status = v.phase !== 'plan' ? '' : rival.committed ? 'rival has committed' : `rival is thinking, ${v.rivalHand} cards`;
    add(text(this, PANEL_X + 4, top - 2, `initiative     ${status}`, MAUVE));
    for (let i = 0; i < Math.min(me.mana, 20); i++) g.fillStyle(VIOLET).fillRect(PANEL_X + 246 + (i % 10) * 7, top - 3 + Math.floor(i / 10) * 4, 5, 3);

    // The timeline: own plays above the line, the rival's below, initiative 0 to 9.
    const tx = PANEL_X + 10, ty = top + 8;
    const current = v.phase === 'resolve' ? (v.pending[0] ?? 10) : v.phase === 'clash' ? v.initiative : -1;
    for (let i = 0; i < 10; i++) {
      const x = tx + i * 30;
      g.fillStyle(i < current ? DUSK : PLUM).fillRect(x, ty, 28, 34);
      g.fillStyle(INK).fillRect(x, ty + 16, 28, 1);
      add(centred(this, x + 14, ty + 39, String(i), i === current ? GOLD : MAUVE));
    }
    for (const [side, row] of [[this.me, 0], [this.me === 0 ? 1 : 0, 1]] as const) {
      const perSlot = new Map<number, number>();
      v.sides[side].plays.forEach((p, index) => {
        const ini = cardDef(p.card).initiative;
        const k = perSlot.get(ini) ?? 0;
        perSlot.set(ini, k + 1);
        const icon = add(this.add.image(tx + ini * 30 + 7 + (k % 3) * 8, ty + row * 17 + 7 + Math.floor(k / 3) * 6, iconKey(p.card, side)));
        icon.setInteractive({ useHandCursor: side === this.me && planning });
        icon.on('pointerover', () => { this.hoverCard = p.card; });
        if (side === this.me && planning) icon.on('pointerdown', () => this.session.submit({ type: 'unplay', index }));
      });
    }

    if (v.phase === 'plan') {
      me.hand.forEach((id, i) => {
        const face = add(cardFace(this, id, this.me, this.alt));
        face.setPosition(PANEL_X + 4 + CARD_W / 2 + (i % 5) * (CARD_W + 10), top + 58 + CARD_H / 2 + Math.floor(i / 5) * (CARD_H + 4));
        const affordable = cardDef(id).cost <= me.mana;
        const aiming = this.mode.kind === 'card' && this.mode.handIndex === i;
        face.setAlpha(this.discard.has(i) ? 0.3 : planning && !affordable ? 0.5 : 1);
        if (aiming) face.y -= 4;
        face.setInteractive({ useHandCursor: planning });
        face.on('pointerover', () => { this.hoverCard = id; });
        face.on('pointerdown', (p: Phaser.Input.Pointer) => {
          if (!planning) return;
          if (p.rightButtonDown()) {
            if (this.discard.has(i)) this.discard.delete(i); else this.discard.add(i);
            this.panelKey = '';
          } else if (affordable) this.pickCard(i);
        });
      });
      const over = me.hand.length - CARDS_KEPT;
      if (planning && over > 0) add(text(this, PANEL_X + 4, H - 14, `keeps ${CARDS_KEPT}: right-click to discard`, MAUVE));
      add(button(this, PANEL_X + 262, H - 12, 100, me.committed ? 'waiting...' : 'commit (enter)', () => this.commit())).setEnabled(planning);
    } else {
      this.log.forEach((line, i) => add(text(this, PANEL_X + 4, top + 58 + i * 10, line, i === this.log.length - 1 ? CREAM : MAUVE)));
    }

    if (this.alt && this.hoverCard) {
      const def = cardDef(this.hoverCard);
      const box = add(this.add.graphics());
      box.fillStyle(INK, 0.9).fillRect(6, 252, 288, 44);
      add(text(this, 10, 255, `${def.name}: cost ${def.cost}, initiative ${def.initiative}`, GOLD));
      def.keywords.forEach((k, i) => add(this.add.bitmapText(10, 264 + i * 8, 'pixel', `${k}: ${KEYWORD_TEXT[k]}`.toUpperCase()).setTint(VIOLET).setMaxWidth(280)));
    }
  }

  // ---- the end -----------------------------------------------------------

  private finale(): void {
    const v = this.v;
    const verdict = v.winner === 'draw' ? 'Draw' : v.winner === this.me ? 'Victory' : 'Defeat';
    this.time.delayedCall(900, () => {
      this.add.graphics().setDepth(4000).fillStyle(INK, 0.8).fillRect(0, 0, W, H);
      centred(this, W / 2, 150, verdict, verdict === 'Defeat' ? BLOOD : GOLD, 5).setDepth(4001);
      centred(this, W / 2, 180, `after ${v.mapTick} map ticks and ${v.fightPhase} fight phases`, CREAM).setDepth(4001);
      button(this, W / 2, 210, 90, 'again', () => this.scene.start('title')).setDepth(4001);
    });
  }
}
