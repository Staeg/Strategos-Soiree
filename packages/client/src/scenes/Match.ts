import Phaser from 'phaser';
import {
  CARD_OWNER, CARDS_KEPT, CORE, DRAW_EVERY, FIGHT_EVERY, LANE_NAMES, N_CELLS, TOWER_DMG, atBase, campDef, cardDef, cardReach, foe, heroDef, maxHp, stats,
  type CardId, type GameEvent, type Hero, type MatchView, type Reach, type Side, type Target,
} from '@soiree/sim';
import { CAMP_ART } from '../art/camps.ts';
import { heroKey, heroOriginX } from '../art/forge.ts';
import { BLOOD, CREAM, DUSK, GOLD, INK, LEAF, MANA, MANA_LIGHT, MAUVE, NIGHT, PLUM, TEAM, VIOLET } from '../art/palette.ts';
import { cellAtPoint, cellX, cellY, drawBoard, HEX_H, HEX_W, hexPoints } from '../board.ts';
import { CARD_H, CARD_W, cardFace, iconKey } from '../cards.ts';
import { corners, Flourishes, snap, type Point, type Touch } from '../fx.ts';
import { DebugLog } from '../hud/log.ts';
import { dials, Roster } from '../hud/roster.ts';
import type { Session } from '../session.ts';
import { minionDots, minionTotals, SWARM } from '../swarm.ts';
import { button, centred, H, LINE_H, text, W, wrap, type Button } from '../ui.ts';

/**
 * Where heroes stand inside a cell, by side and by place in the side's
 * cast. A hero keeps its spot wherever it goes, so heroes walking together
 * keep their formation instead of shuffling as others come and go.
 */
const SLOTS: Record<Side, [number, number][]> = {
  0: [[-6, 4], [-1, 10], [-11, 10], [-7, -2], [-12, 4]],
  1: [[6, 4], [1, 10], [11, 10], [7, -2], [12, 4]],
};
const SPEEDS = [0.5, 1, 2, 4];

/** The hand fans along the bottom between the inspect panel and the fight console. */
const HAND_CX = 300;
const HAND_SPAN = 300;
const HAND_Y = H - 3 - CARD_H / 2;
/** The fight console in the bottom-right corner. */
const CON = { x: 474, y: 266, w: 162, h: 90 };
/** Where your orders sit, under your cast. */
const ORDERS = { x: 4, y: 22 + 5 * 27 + 4 };
/** The inspect panel: the rest of the left column, down to the corner buttons. */
const PANEL = { x: 2, y: 186, w: 108, h: 155 };

/**
 * The stage a fight is closed in on: the board left between the two casts,
 * the top bar and the hand. Its middle is where the camera puts the fight.
 */
const STAGE = { x: 112, y: 17, w: W - 224, h: H - 3 - CARD_H - 17 };
const FOCUS = { x: STAGE.x + STAGE.w / 2, y: STAGE.y + STAGE.h / 2 };
/** As far as the camera closes in: a single hex fills the stage. */
const MAX_ZOOM = 8;
/** However close the camera, heroes and everything on them look at most this many times their size. */
const FIGURE_CAP = 3;
/** How quickly the camera settles, closing in and pulling back, as time constants in ms. */
const GLIDE_IN_MS = 260;
const GLIDE_OUT_MS = 340;
/** How long the camera stays on a fight after it ends, so back-to-back initiatives don't bounce it. */
const LINGER_MS = 900;

type Adder = <T extends Phaser.GameObjects.GameObject>(o: T) => T;

type Mode =
  | { kind: 'idle' }
  | { kind: 'roam' }
  | { kind: 'ult' }
  /** Aiming a card: first a source hero (unless bound), then a target. */
  | { kind: 'card'; handIndex: number; source: number };

/** One line of the inspect panel: a coloured line, maybe a note on the right and an ability's clock before it. */
interface PanelRow { text: string; tint: number; right?: string; gap?: boolean; dot?: { left: number; tint: number } }

/** What the inspect panel shows. */
type Inspect =
  | { kind: 'card'; card: CardId; side: Side }
  | { kind: 'hero'; uid: number }
  | { kind: 'structure'; index: number }
  | { kind: 'camp'; index: number };

interface HeroView {
  sprite: Phaser.GameObjects.Sprite;
  striking: number;
  /** A step towards whoever it strikes, and when it began. */
  lunge: { dx: number; dy: number; at: number };
  /** Lit white until this time, when struck. */
  flash: number;
}

/** A layer rebuilt from scratch only when what it shows changes. */
class Layer {
  private key = '';
  readonly box: Phaser.GameObjects.Container;
  constructor(scene: Phaser.Scene, depth: number) { this.box = scene.add.container(0, 0).setDepth(depth); }
  /** Rebuilds with `build` if `key` differs from last time. */
  draw(key: unknown, build: (add: Adder) => void): void {
    const k = JSON.stringify(key);
    if (k === this.key) return;
    this.key = k;
    this.box.removeAll(true);
    build((o) => { this.box.add(o); return o; });
  }
  dirty(): void { this.key = ''; }
}

export class Match extends Phaser.Scene {
  private session!: Session;
  private heroes = new Map<number, HeroView>();
  private structures: Phaser.GameObjects.Image[] = [];
  private creeps: Phaser.GameObjects.Image[][] = [];
  private counts: Phaser.GameObjects.BitmapText[] = [];
  private campLabel!: Phaser.GameObjects.BitmapText;
  private fog!: Phaser.GameObjects.Graphics;
  private marks!: Phaser.GameObjects.Graphics;
  private bars!: Phaser.GameObjects.Graphics;
  private top!: Phaser.GameObjects.Graphics;
  private phaseLabel!: Phaser.GameObjects.BitmapText;
  private clock!: Phaser.GameObjects.BitmapText;
  private hint!: Phaser.GameObjects.BitmapText;
  private speedButtons: Button[] = [];
  private roster!: Roster;
  private log!: DebugLog;
  private hand!: Layer;
  private console!: Layer;
  private orders!: Layer;
  private help!: Layer;
  private panel!: Layer;
  private toasts: Phaser.GameObjects.BitmapText[] = [];
  private mode: Mode = { kind: 'idle' };
  private selected = -1;
  private hover = -1;
  private ctrl = false;
  private helpPinned = false;
  private helpHover = false;
  /** Hand index under the pointer, or -1. */
  private handHover = -1;
  /** A played card under the pointer on the timeline. */
  private timelineHover: { card: CardId; side: Side } | null = null;
  /** What a click fixed in the inspect panel, shown whenever nothing is hovered. */
  private pinned: Inspect | null = null;
  /** What the inspect panel shows this frame, and for your own card, where it could land. */
  private shown: Inspect | null = null;
  private reach: Reach | null = null;
  private discard = new Set<number>();
  private fogKey = -1;
  /** Cells lit by the hovered log line. */
  private logCells: number[] = [];
  /** The camera closes in on fights unless this is off (z). */
  private autoZoom = true;
  /** A second camera that never moves, for everything not on the board. */
  private hud!: Phaser.Cameras.Scene2D.Camera;
  /** While true, new game objects belong to the board and the board camera. */
  private boarding = false;
  private flourishes!: Flourishes;
  /** The fights the camera is on, kept until a while after they end. */
  private watching = { cells: [] as number[], until: 0 };
  /** Where the camera looks: world point (fx, fy) at screen point (ax, ay). */
  private eye = { fx: W / 2, fy: H / 2, ax: W / 2, ay: H / 2 };
  /**
   * How big a figure's pixel is in world units: 1 until the camera is
   * FIGURE_CAP times closer, then shrinking so figures stop growing.
   */
  private lens = 1;
  /** Bursts and numbers on the board, with their own scale, kept to the lens. */
  private lensed: { o: Phaser.GameObjects.Components.Transform & Phaser.GameObjects.GameObject; scale: number }[] = [];

  constructor() { super('match'); }

  init(data: { session: Session }): void {
    this.session = data.session;
    this.heroes.clear();
    this.counts = [];
    this.structures = [];
    this.creeps = [];
    this.speedButtons = [];
    this.toasts = [];
    this.mode = { kind: 'idle' };
    this.selected = -1;
    this.ctrl = false;
    this.helpPinned = false;
    this.pinned = null;
    this.shown = null;
    this.reach = null;
    this.discard.clear();
    this.fogKey = -1;
    this.logCells = [];
    this.boarding = false;
    this.watching = { cells: [], until: 0 };
    this.eye = { fx: W / 2, fy: H / 2, ax: W / 2, ay: H / 2 };
    this.lens = 1;
    this.lensed = [];
  }

  private get v(): MatchView { return this.session.view; }
  private get me(): Side { return this.session.side; }
  private get planning(): boolean { return this.v.phase === 'plan' && !this.v.sides[this.me].committed; }

  create(): void {
    // Two cameras: the main one may close in on the board, the HUD one never
    // moves. Every object is seen by exactly one of them.
    this.hud = this.cameras.add(0, 0, W, H);
    const assign = (o: Phaser.GameObjects.GameObject) => (this.boarding ? this.hud : this.cameras.main).ignore(o);
    this.events.on(Phaser.Scenes.Events.ADDED_TO_SCENE, assign);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.events.off(Phaser.Scenes.Events.ADDED_TO_SCENE, assign));

    this.cameras.main.setBackgroundColor(NIGHT);
    this.onBoard(() => {
      drawBoard(this);
      this.v.structures.forEach((st) => {
        const key = st.kind === 'core' ? `nexus-${st.side}` : `tower-${st.side}`;
        this.structures.push(this.add.image(cellX(st.cell), cellY(st.cell) + (st.kind === 'core' ? 10 : 7), key).setOrigin(0.5, 1).setDepth(cellY(st.cell) + 90));
      });
      this.v.camps.forEach((c) => {
        const spots = CAMP_ART[c.kind].spots.slice(0, campDef(c.kind).creeps);
        this.creeps.push(spots.map(([dx, dy]) => this.add.image(cellX(c.cell) + dx, cellY(c.cell) + dy, `camp-${c.kind}`).setDepth(60)));
      });
      this.fog = this.add.graphics().setDepth(50);
      this.marks = this.add.graphics().setDepth(70);
      this.bars = this.add.graphics().setDepth(400);
      this.flourishes = new Flourishes(this.add.graphics().setDepth(2990), () => this.time.now, () => this.lens);
      for (let i = 0; i < 2; i++) this.counts.push(text(this, 0, 0, '').setDepth(72));
      this.campLabel = centred(this, 0, 0, '').setDepth(72);
    });
    this.top = this.add.graphics().setDepth(1000);
    this.phaseLabel = centred(this, W / 2, 8, '').setDepth(1001);
    this.clock = text(this, 108, 6, '', MAUVE).setDepth(1001);
    this.hint = centred(this, HAND_CX, HAND_Y - CARD_H / 2 - 8, '', CREAM).setDepth(1001);

    this.roster = new Roster(this, this.me);
    this.log = new DebugLog(this, this.me);
    this.orders = new Layer(this, 1050);
    this.console = new Layer(this, 1050);
    this.hand = new Layer(this, 1300);
    this.panel = new Layer(this, 2000);
    this.help = new Layer(this, 2600);

    this.speedButtons.push(button(this, 418, 8, 22, 'II', () => { this.session.paused = !this.session.paused; }).setDepth(1001));
    SPEEDS.forEach((sp, i) => {
      this.speedButtons.push(button(this, 444 + i * 24, 8, 22, `${sp}x`, () => { this.session.speed = sp; this.session.paused = false; }).setDepth(1001));
    });
    const helpButton = button(this, 10, H - 9, 13, '?', () => { this.helpPinned = !this.helpPinned; }).setDepth(1001);
    helpButton.on('pointerover', () => { this.helpHover = true; }).on('pointerout', () => { this.helpHover = false; });
    button(this, 36, H - 9, 30, 'log', () => this.log.toggle()).setDepth(1001);

    this.input.mouse?.disableContextMenu();
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => { this.hover = cellAtPoint(...this.world(p)); });
    this.input.on('pointerdown', (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (over.length === 0) this.click(p);
    });
    const kb = this.input.keyboard!;
    kb.on('keydown', (e: KeyboardEvent) => this.key(e));
    kb.on('keyup', (e: KeyboardEvent) => { if (e.key === 'Control') this.ctrl = false; });
    this.game.events.on(Phaser.Core.Events.BLUR, () => { this.ctrl = false; });

    this.banner('The ball begins');
  }

  override update(time: number, delta: number): void {
    const events = this.session.update(this.game.loop.delta);
    this.log.record(this.v, this.session.prev, events);
    for (const e of events) this.react(e, time);
    if (this.v.phase !== 'plan' && this.mode.kind === 'card') this.mode = { kind: 'idle' };
    const p = this.input.activePointer;
    this.logCells = this.log.hover(p.x, p.y);
    this.frame(time, delta);
    this.drawFog();
    this.handHover = this.handAt(p);
    this.prunePin();
    this.shown = this.inspected(p);
    const card = this.shown?.kind === 'card' && this.shown.side === this.me ? this.shown.card : undefined;
    this.reach = card ? cardReach(this.v, this.me, card) : null;
    this.roster.highlight = this.cardOwner();
    this.drawUnits(time);
    this.flourishes.update();
    this.drawTop();
    this.roster.update(this.v, this.selected, p, delta, time);
    this.drawHand();
    this.drawPanel();
    this.drawConsole();
    this.drawOrders();
    this.drawHelp();
    this.log.draw();
  }

  // ---- input ---------------------------------------------------------------

  private key(e: KeyboardEvent): void {
    if (e.key === 'Control') { this.ctrl = true; return; }
    const k = e.key.toLowerCase();
    if (k === 'escape') { this.mode = { kind: 'idle' }; this.pinned = null; }
    else if (k === ' ') this.session.paused = !this.session.paused;
    else if (k === 's') this.orderStance();
    else if (k === 'r') this.beginOrder('roam');
    else if (k === 'u') this.beginOrder('ult');
    else if (k === 'l') this.log.toggle();
    else if (k === 'z') this.autoZoom = !this.autoZoom;
    else if (k === 'enter' && this.v.phase === 'plan') this.commit();
    else if (['1', '2', '3', '4'].includes(k)) this.session.speed = SPEEDS[Number(k) - 1]!;
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
      .map((h) => [h, Phaser.Math.Distance.Between(x, y, this.heroes.get(h.uid)!.sprite.x, this.heroes.get(h.uid)!.sprite.y - 6 * this.lens)] as const)
      .filter(([, d]) => d < 12 * this.lens)
      .sort((a, b) => a[1] - b[1])
      .map(([h]) => h);
  }

  /** Your hero whose own card is in the inspect panel, or -1. */
  private cardOwner(): number {
    const it = this.shown;
    const owner = it?.kind === 'card' && it.side === this.me ? CARD_OWNER[it.card] : undefined;
    return owner ? this.v.heroes.find((h) => h.side === this.me && h.id === owner)?.uid ?? -1 : -1;
  }

  /**
   * What the inspect panel shows: whatever the pointer is on (a card, a
   * hero's bar or figure, a structure or a camp), else what a click pinned,
   * else the selected hero.
   */
  private inspected(p: Phaser.Input.Pointer): Inspect | null {
    const me = this.v.sides[this.me];
    if (this.handHover >= 0) return { kind: 'card', card: me.hand[this.handHover]!, side: this.me };
    if (this.timelineHover) return { kind: 'card', ...this.timelineHover };
    if (this.roster.hovered >= 0) return { kind: 'hero', uid: this.roster.hovered };
    if (Phaser.Geom.Rectangle.Contains(new Phaser.Geom.Rectangle(STAGE.x, STAGE.y, STAGE.w, STAGE.h), p.x, p.y)) {
      const near = this.heroesNear(...this.world(p))[0];
      if (near) return { kind: 'hero', uid: near.uid };
      const spot = this.spotAt(this.hover);
      if (spot) return spot;
    }
    return this.pinned ?? (this.selected >= 0 ? { kind: 'hero', uid: this.selected } : null);
  }

  /** The structure or camp on a cell, to inspect. */
  private spotAt(cell: number): Inspect | null {
    if (cell < 0) return null;
    const st = this.v.structures.findIndex((x) => x.cell === cell);
    if (st >= 0) return { kind: 'structure', index: st };
    const camp = this.v.camps.findIndex((c) => c.cell === cell);
    return camp >= 0 ? { kind: 'camp', index: camp } : null;
  }

  private same(a: Inspect | null, b: Inspect | null): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  /** A pinned card is let go once it has left both the hand and the timeline. */
  private prunePin(): void {
    const pin = this.pinned;
    if (pin?.kind !== 'card') return;
    const side = this.v.sides[pin.side];
    if (!side.hand.includes(pin.card) && !side.plays.some((pl) => pl.card === pin.card)) this.pinned = null;
  }

  /** A click on nothing interactive: the hand, then the hero bars, then the board. */
  private click(p: Phaser.Input.Pointer): void {
    if (this.handHover >= 0) return this.clickCard(this.handHover, p.rightButtonDown());
    const bar = this.roster.heroAt(p.x, p.y);
    if (bar >= 0) {
      const h = this.v.heroes[bar]!;
      // While aiming, a bar is as good as the hero itself.
      if (this.mode.kind === 'card' && h.cell >= 0) return this.aimAt([h], h.cell);
      this.select(bar);
      return;
    }
    this.clickBoard(p);
  }

  /** Selecting a hero lets go of any pin, so the panel shows its abilities. */
  private select(uid: number): void {
    this.selected = uid;
    this.pinned = null;
  }

  /** Left-click pins a card in the panel (again lets go) and, while committing, picks it to play. */
  private clickCard(i: number, right: boolean): void {
    const me = this.v.sides[this.me];
    if (right) {
      if (!this.planning) return;
      if (this.discard.has(i)) this.discard.delete(i); else this.discard.add(i);
      return;
    }
    const pin: Inspect = { kind: 'card', card: me.hand[i]!, side: this.me };
    const again = this.same(this.pinned, pin);
    this.pinned = again ? null : pin;
    if (!this.planning) return;
    if (again && this.mode.kind === 'card' && this.mode.handIndex === i) this.mode = { kind: 'idle' };
    else if (!again && cardDef(me.hand[i]!).cost <= me.mana) this.pickCard(i);
  }

  private clickBoard(p: Phaser.Input.Pointer): void {
    const [x, y] = this.world(p);
    const cell = cellAtPoint(x, y);
    const near = this.heroesNear(x, y);
    const mode = this.mode;
    if (mode.kind === 'roam' || mode.kind === 'ult') {
      if (cell >= 0) this.session.submit({ type: mode.kind, uid: this.selected, cell });
      this.mode = { kind: 'idle' };
      return;
    }
    if (mode.kind === 'card') return this.aimAt(near, cell);
    if (near[0]) return this.select(near[0].uid);
    // A structure or camp pins its stats (again lets go); bare floor lets go of any pin.
    const spot = this.spotAt(cell);
    this.pinned = spot && !this.same(this.pinned, spot) ? spot : null;
  }

  private aimAt(near: Hero[], cell: number): void {
    const mode = this.mode;
    if (mode.kind !== 'card') return;
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

  private heroPos(v: MatchView, h: Hero): Point | null {
    if (h.cell < 0 || h.respawnAt >= 0) return null;
    const cast = v.heroes.filter((o) => o.side === h.side);
    const [dx, dy] = SLOTS[h.side][cast.findIndex((o) => o.uid === h.uid) % 5]!;
    return { x: cellX(h.cell) + dx, y: cellY(h.cell) + dy };
  }

  /** A screen point on the board, wherever the camera has gone. */
  private world(p: { x: number; y: number }): [number, number] {
    const w = this.cameras.main.getWorldPoint(p.x, p.y);
    return [w.x, w.y];
  }

  /** Makes game objects on the board, for the camera that can close in. */
  private onBoard<T>(make: () => T): T {
    const was = this.boarding;
    this.boarding = true;
    try { return make(); } finally { this.boarding = was; }
  }

  /**
   * Closes in on the fights being fought: the whole board swells until a
   * lone fight's hex fills the stage, while the figures on it stop growing
   * at FIGURE_CAP times their size. Otherwise, or with z, the whole board.
   * The camera eases towards its mark every frame, so a fight that moves on
   * drags it along smoothly.
   */
  private frame(time: number, delta: number): void {
    const v = this.v;
    const cam = this.cameras.main;
    const fighting = v.phase === 'resolve' || v.phase === 'clash';
    const live = fighting ? v.engagements.filter((e) => !e.over).map((e) => e.cell) : [];
    if (live.length) this.watching = { cells: live, until: time + LINGER_MS };
    const cells = this.autoZoom && fighting && time < this.watching.until ? this.watching.cells : [];
    let zoom = 1, mark = { fx: W / 2, fy: H / 2, ax: W / 2, ay: H / 2 };
    if (cells.length) {
      const xs = cells.map(cellX), ys = cells.map(cellY);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      // Whole steps of zoom keep the board's pixels square; fights far apart get less.
      zoom = Phaser.Math.Clamp(Math.floor(Math.min((STAGE.w - 16) / (x1 - x0 + HEX_W), (STAGE.h - 12) / (y1 - y0 + HEX_H))), 1, MAX_ZOOM);
      mark = { fx: (x0 + x1) / 2, fy: (y0 + y1) / 2, ax: FOCUS.x, ay: FOCUS.y };
    }
    const k = 1 - Math.exp(-delta / (zoom > cam.zoom ? GLIDE_IN_MS : GLIDE_OUT_MS));
    const near = (a: number, b: number) => (Math.abs(b - a) < 0.01 ? b : a + (b - a) * k);
    // Zoom eases by ratio, so closing in from 1x to 7x feels as even as it looks.
    const z = Math.abs(zoom - cam.zoom) < 0.01 ? zoom : Math.exp(near(Math.log(cam.zoom), Math.log(zoom)));
    const e = this.eye;
    this.eye = { fx: near(e.fx, mark.fx), fy: near(e.fy, mark.fy), ax: near(e.ax, mark.ax), ay: near(e.ay, mark.ay) };
    // The camera zooms about its middle: put world point (fx, fy) at screen point (ax, ay).
    cam.setZoom(z).setScroll(this.eye.fx - W / 2 - (this.eye.ax - W / 2) / z, this.eye.fy - H / 2 - (this.eye.ay - H / 2) / z);
    this.lens = Math.min(1, FIGURE_CAP / z);
    this.lensed = this.lensed.filter(({ o }) => o.active);
    for (const { o, scale } of this.lensed) o.setScale(scale * this.lens);
  }

  private drawUnits(time: number): void {
    const { view: v, prev, alpha } = this.session;
    const g = this.marks.clear();
    const bars = this.bars.clear();
    // Figures, and the bars and marks on them, are drawn in pixels `px` world units wide.
    const px = this.lens;
    const pulse = 0.6 + 0.4 * Math.sin(time / 120);

    // Structures, with a sliver of health beneath each.
    v.structures.forEach((st, i) => {
      const img = this.structures[i]!.setScale(px);
      const down = st.hp <= 0;
      img.setAlpha(down ? 0.35 : 1).setTint(down ? 0x555555 : 0xffffff);
      if (down) return;
      const [x, y] = [cellX(st.cell), cellY(st.cell) + (st.kind === 'core' ? 12 : 9) * px];
      bars.fillStyle(INK).fillRect(x - 7 * px, y, 14 * px, 3 * px);
      bars.fillStyle(TEAM[st.side].main).fillRect(x - 6 * px, y + px, Math.ceil((12 * st.hp) / st.maxHp) * px, px);
      if (v.mapTick < st.guardedUntil) bars.lineStyle(px, GOLD, 0.9).strokePoints(hexPoints(st.cell, 3), true);
    });

    // Camps: unseen ones as a faint first creep, a damaged one with a sliver of its HP left, a name under the pointer.
    this.campLabel.setVisible(false);
    v.camps.forEach((c, i) => {
      const n = c.creeps;
      this.creeps[i]!.forEach((img, k) => img.setVisible(n < 0 ? k === 0 : k < n).setAlpha(n < 0 ? 0.3 : 1).setScale(px));
      const def = campDef(c.kind);
      if (c.cell === this.hover) {
        const label = this.campLabel.setText(def.name).setScale(px).setPosition(cellX(c.cell), cellY(c.cell) - 21 * px).setVisible(true);
        g.fillStyle(INK, 0.85).fillRect(label.x - label.displayWidth / 2 - px, label.y - 4 * px, label.displayWidth + 2 * px, 7 * px);
      }
      const left = (n - 1) * def.hp + c.hp, full = def.creeps * def.hp;
      if (n <= 0 || left >= full) return;
      const [x, y] = [cellX(c.cell), cellY(c.cell) - 15 * px];
      bars.fillStyle(INK).fillRect(x - 7 * px, y, 14 * px, 3 * px);
      bars.fillStyle(CREAM).fillRect(x - 6 * px, y + px, Math.ceil((12 * left) / full) * px, px);
    });

    // Minions: a swarm of team-coloured dots, walking cell to cell in step with the heroes.
    for (const d of minionDots(v, alpha)) {
      const [x, y] = [snap(d.x, px), snap(d.y, px)];
      g.fillStyle(INK, 0.7 * d.alpha).fillRect(x, y + px, px, px);
      g.fillStyle(TEAM[d.side].light, d.alpha).fillRect(x, y, px, px);
    }
    // The count only for the cell under the pointer.
    this.counts.forEach((t) => t.setVisible(false));
    for (const [key, n] of minionTotals(v)) {
      const [cell, side] = [key >> 1, (key & 1) as Side];
      const [cx, cy] = [cellX(cell), cellY(cell)];
      if (cell === this.hover && n > 0) {
        const label = this.counts[side]!.setText(String(n)).setTint(TEAM[side].light).setScale(px).setVisible(true);
        label.setPosition(side === 0 ? cx - 13 * px - label.displayWidth : cx + 14 * px, cy - 13 * px);
        g.fillStyle(INK, 0.85).fillRect(label.x - px, label.y - px, label.displayWidth + 2 * px, 7 * px);
      }
    }

    for (const e of v.engagements) {
      if (e.over) continue;
      const beat = 0.5 + 0.5 * Math.sin(time / 120);
      g.lineStyle(px, GOLD, 0.5 + 0.5 * beat).strokePoints(hexPoints(e.cell, 0), true);
      g.lineStyle(px, BLOOD, 0.4 * beat).strokePoints(hexPoints(e.cell, 2), true);
    }
    for (const w of v.wards) {
      for (let c = 0; c < N_CELLS; c++) if (v.visible[c] && Phaser.Math.Distance.Between(cellX(c), cellY(c), cellX(w.cell), cellY(w.cell)) <= w.radius * 28 + 1) g.lineStyle(px, VIOLET, 0.4).strokePoints(hexPoints(c, 2), true);
    }
    if (this.hover >= 0 && this.mode.kind !== 'idle') g.lineStyle(px, CREAM, 0.8).strokePoints(hexPoints(this.hover, 1), true);
    for (const c of this.logCells) {
      g.fillStyle(CREAM, 0.12 + 0.08 * Math.sin(time / 140)).fillPoints(hexPoints(c, 1), true);
      g.lineStyle(px, CREAM, 0.9).strokePoints(hexPoints(c, 1), true);
    }
    // The structures your inspected card could land on.
    for (const c of this.reach?.cells ?? []) g.lineStyle(px, BLOOD, pulse).strokePoints(hexPoints(c, 2), true);
    // A pinned structure or camp keeps a ring, so you can find it again.
    const spot = this.pinned?.kind === 'structure' ? v.structures[this.pinned.index]?.cell : this.pinned?.kind === 'camp' ? v.camps[this.pinned.index]?.cell : undefined;
    if (spot !== undefined) g.lineStyle(px, CREAM, 0.5 + 0.3 * Math.sin(time / 150)).strokePoints(hexPoints(spot, 1), true);

    for (const h of v.heroes) {
      let hv = this.heroes.get(h.uid);
      const key = heroKey(h.id, h.side);
      if (!hv) {
        const sprite = this.onBoard(() => this.add.sprite(0, 0, key).setOrigin(heroOriginX(h.side), 1).play(`${key}-walk`));
        hv = { sprite, striking: 0, lunge: { dx: 0, dy: 0, at: -1e9 }, flash: 0 };
        this.heroes.set(h.uid, hv);
      }
      const now = this.heroPos(v, h);
      const before = prev.heroes[h.uid] && this.heroPos(prev, prev.heroes[h.uid]!);
      hv.sprite.setVisible(now !== null);
      if (!now) continue;
      // Map ticks walk heroes over the step that follows, exactly as minions walk.
      const moving = before && prev.phase === 'map' && (before.x !== now.x || before.y !== now.y);
      const x = moving ? Phaser.Math.Linear(before.x, now.x, alpha) : now.x;
      const y = moving ? Phaser.Math.Linear(before.y, now.y, alpha) : now.y;
      const reach = Math.sin(Math.PI * Phaser.Math.Clamp((time - hv.lunge.at) / 220, 0, 1)) * px;
      hv.sprite.setScale(px).setPosition(snap(x + hv.lunge.dx * reach, px), snap(y + hv.lunge.dy * reach, px)).setDepth(100 + y);
      if (time < hv.flash) hv.sprite.setTintFill(0xffffff); else hv.sprite.clearTint();
      if (time > hv.striking) {
        const anim = moving ? `${key}-walk` : `${key}-idle`;
        if (hv.sprite.anims.currentAnim?.key !== anim) hv.sprite.play(anim);
      }
      const max = maxHp(h);
      const [sx, sy] = [snap(x, px), snap(y, px)];
      const [bx, by] = [sx - 5 * px, sy - 17 * px];
      bars.fillStyle(INK).fillRect(bx, by, 10 * px, 3 * px);
      bars.fillStyle(h.retreating ? GOLD : TEAM[h.side].main).fillRect(bx + px, by + px, Math.max(1, Math.ceil((8 * h.hp) / max)) * px, px);
      if (h.stance === 'aggressive') bars.fillStyle(BLOOD).fillRect(bx + 10 * px, by, 2 * px, 3 * px);
      // The owner of the inspected card is called out in gold.
      if (h.uid === this.roster.highlight) {
        bars.lineStyle(px, GOLD, pulse).strokeRect(sx - 8 * px, sy - 15 * px, 16 * px, 17 * px);
        bars.lineStyle(px, GOLD, pulse * 0.6).strokePoints(hexPoints(h.cell, 1), true);
      }
      // The heroes it could land on are bracketed: red for rivals, green for your own.
      if (this.reach?.heroes.includes(h.uid)) corners(bars, { x: sx, y: sy - 7 * px }, 9, h.side === this.me ? LEAF : BLOOD, pulse, px);
      // A hero whose bar is hovered or selected is ringed on the board too.
      if (h.uid === this.selected || h.uid === this.roster.hovered) {
        const ring = h.uid === this.selected ? 0.6 + 0.4 * Math.sin(time / 150) : 0.5;
        bars.lineStyle(px, CREAM, ring).strokeRect(sx - 7 * px, sy - 14 * px, 14 * px, 15 * px);
        if (h.roam >= 0 && h.side === this.me) bars.lineStyle(px, CREAM, 0.5).strokePoints(hexPoints(h.roam, 4), true);
      }
    }
  }

  // ---- what happened -----------------------------------------------------------

  private react(e: GameEvent, time: number): void {
    const v = this.v;
    // Effects run at a pace that keeps up with the fight's.
    const pace = 1 / Math.sqrt(this.session.speed);
    const at = (uid: number): Point | null => {
      const s = this.heroes.get(uid)?.sprite;
      return s?.visible ? { x: s.x, y: s.y } : null;
    };
    // Offsets from a figure are in its own pixels, which shrink as the camera closes in.
    const u = this.lens;
    const chest = (p: Point): Point => ({ x: p.x, y: p.y - 7 * u });
    switch (e.type) {
      case 'act': {
        const hv = this.heroes.get(e.uid);
        const h = v.heroes[e.uid]!;
        const from = at(e.uid);
        if (hv) { hv.sprite.play(`${heroKey(h.id, h.side)}-strike`); hv.striking = time + 300; }
        const touched: { at: Point; touch: Touch }[] = [];
        for (const hit of e.hits) {
          const p = at(hit.uid);
          if (!p) continue;
          touched.push({ at: chest(p), touch: hit.amount > 0 ? 'harm' : hit.amount < 0 ? 'heal' : 'shield' });
          if (hit.amount > 0) {
            this.burst(p.x, p.y - 8 * u, 'spark');
            this.float(p.x, p.y - 20 * u, String(hit.amount), e.kind === 'attack' ? CREAM : GOLD);
            const struck = this.heroes.get(hit.uid);
            if (struck) struck.flash = time + 90;
          } else if (hit.amount < 0) this.float(p.x, p.y - 20 * u, `+${-hit.amount}`, LEAF);
          if (hit.shield > 0) this.float(p.x + 8 * u, p.y - 26 * u, `(${hit.shield})`, MAUVE);
        }
        if (!from) return;
        if (e.kind === 'attack') {
          const foeHit = touched.find((t) => t.touch === 'harm') ?? touched[0];
          if (!foeHit) return;
          if (hv) {
            const d = Math.max(1, Phaser.Math.Distance.BetweenPoints(from, foeHit.at));
            hv.lunge = { dx: ((foeHit.at.x - from.x) / d) * 4, dy: ((foeHit.at.y - from.y) / d) * 3, at: time };
          }
          for (const t of touched) this.flourishes.attack(chest(from), t.at, TEAM[h.side].light, pace);
        } else this.flourishes.ability(chest(from), touched, e.kind === 'ult', pace);
        return;
      }
      case 'ability': {
        // Map abilities: only the burst, since their effects play out on the map.
        const p = at(e.uid);
        if (p) this.flourishes.ability(chest(p), [], false, 1);
        return;
      }
      case 'squad': {
        const fight = v.engagements.find((x) => x.id === e.id);
        if (!fight) return;
        const [dx, dy] = SWARM[e.side][0]!;
        const swarm = { x: cellX(fight.cell) + dx, y: cellY(fight.cell) + dy };
        for (const hit of e.hits) {
          const p = (hit.uid >= 0 && at(hit.uid)) || { x: cellX(fight.cell), y: cellY(fight.cell) };
          if (hit.amount > 0) this.float(p.x, p.y - 20 * u, String(hit.amount), TEAM[e.side].light);
          if (hit.uid >= 0 && hit.amount > 0) this.flourishes.fleck(swarm, chest(p), TEAM[e.side].light, pace);
        }
        return;
      }
      case 'hurt': {
        const p = at(e.uid);
        if (p && e.by === 'card') this.float(p.x, p.y - 20 * u, String(e.amount), GOLD);
        return;
      }
      case 'death': {
        const p = at(e.uid);
        const h = v.heroes[e.uid]!;
        this.burst(p?.x ?? cellX(CORE[h.side]), (p?.y ?? cellY(CORE[h.side])) - 6 * u, 'puff');
        this.toast(`${h.side === this.me ? 'Your' : 'Rival'} ${heroDef(h.id).name} falls`);
        return;
      }
      case 'fall': {
        const st = v.structures[e.index]!;
        this.burst(cellX(st.cell), cellY(st.cell) - 4, 'puff', 2);
        this.toast(`${st.side === this.me ? 'Your' : 'Rival'} ${st.kind} ${st.kind === 'core' ? 'shatters' : 'tower falls'}`);
        return;
      }
      case 'card': {
        const def = cardDef(e.play.card);
        const t = e.play.target;
        const to = t.kind === 'hero' ? at(t.uid) : null;
        if (to && !e.fizzle) {
          const from = at(e.play.source);
          this.flourishes.aim(from && chest(from), chest(to), pace);
        }
        const who = e.play.side === this.me ? 'You' : 'Rival';
        this.toast(`${who}: ${def.name}${e.fizzle ? ` fizzles (${e.fizzle})` : ''}`, TEAM[e.play.side].light);
        return;
      }
      case 'engage':
        this.burst(cellX(e.cell), cellY(e.cell) - 4, 'spark', 3);
        // Alone at the table, the match holds its breath while the camera closes in.
        if (this.session.solo) this.session.paused = true;
        return;
      case 'phase':
        if (e.phase === 'plan') this.banner('Fight phase');
        if (e.phase === 'resolve' && v.initiative < 0) this.banner('Reveal');
        if (e.phase === 'map') this.discard.clear();
        if (e.phase === 'over') this.finale();
        return;
      default:
        return;
    }
  }

  /** A short line that drifts in under the top bar and fades; a few can stack. */
  private toast(line: string, tint = CREAM): void {
    this.toasts = this.toasts.filter((t) => t.active);
    if (this.toasts.length >= 4) this.toasts.shift()!.destroy();
    const t = centred(this, W / 2, 0, line, tint).setDepth(2900).setAlpha(0);
    this.toasts.push(t);
    this.toasts.forEach((x, i) => x.setY(24 + i * 9));
    const bg = this.add.graphics().setDepth(2899);
    this.tweens.add({
      targets: t, alpha: 1, duration: 150, hold: 2600, yoyo: true,
      // A toast pushed off the stack is destroyed while its tween still runs.
      onUpdate: () => {
        bg.clear();
        if (t.active) bg.fillStyle(INK, 0.75 * t.alpha).fillRect(t.x - t.width / 2 - 2, t.y - 4, t.width + 4, 8);
      },
      onComplete: () => { t.destroy(); bg.destroy(); },
    });
  }

  /** A one-shot animation on the board, named the same as its texture. */
  private burst(x: number, y: number, key: 'spark' | 'puff', scale = 1): void {
    const o = this.onBoard(() => this.add.sprite(x, y, key).setDepth(3000).setScale(scale * this.lens).play(key));
    this.lensed.push({ o, scale });
    o.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => o.destroy());
  }

  /** A number rising off the board. */
  private float(x: number, y: number, value: string, tint: number): void {
    const t = this.onBoard(() => centred(this, x, y, value, tint).setDepth(3001).setScale(this.lens));
    this.lensed.push({ o: t, scale: 1 });
    this.tweens.add({ targets: t, y: y - 10 * this.lens, alpha: 0, duration: 700, ease: 'Quad.out', onComplete: () => t.destroy() });
  }

  private banner(label: string): void {
    const t = centred(this, W / 2, 64, label, GOLD, 2).setDepth(3000).setAlpha(0);
    this.tweens.add({ targets: t, alpha: 1, duration: 250, hold: 900, yoyo: true, onComplete: () => t.destroy() });
  }

  // ---- heads-up display -----------------------------------------------------------

  private drawTop(): void {
    const v = this.v;
    const g = this.top.clear();
    g.fillStyle(INK).fillRect(0, 0, W, 16);
    g.fillStyle(DUSK).fillRect(0, 16, W, 1);
    for (const side of [0, 1] as const) {
      const total = v.structures.filter((s) => s.side === side).reduce((t, s) => t + Math.max(0, s.hp), 0);
      const max = v.structures.filter((s) => s.side === side).reduce((t, s) => t + s.maxHp, 0);
      const w = 96, x = side === this.me ? 4 : W - 4 - w;
      const fill = Math.round((w * total) / max);
      g.fillStyle(NIGHT).fillRect(x, 5, w, 6);
      g.fillStyle(TEAM[side].main).fillRect(side === this.me ? x : x + w - fill, 5, fill, 6);
      g.fillStyle(TEAM[side].light).fillRect(side === this.me ? x : x + w - fill, 5, fill, 1);
    }
    const phaseName = { map: 'map', plan: 'commit', resolve: 'reveal', clash: 'clash', over: 'the end' }[v.phase];
    this.phaseLabel.setText(`${phaseName}${v.phase === 'map' || v.fightPhase === 0 ? '' : ` #${v.fightPhase}`}`.toUpperCase()).setTint(v.phase === 'map' ? CREAM : GOLD);

    const toFight = FIGHT_EVERY - (v.mapTick % FIGHT_EVERY);
    const toDraw = DRAW_EVERY - (v.mapTick % DRAW_EVERY);
    this.clock.setText(`TICK ${v.mapTick}  ${v.phase === 'clash' ? `FIGHT TICK ${v.fightTick}` : v.phase === 'map' ? `FIGHT IN ${toFight}  DRAW IN ${toDraw}` : ''}`);
    if (v.phase === 'map') {
      g.fillStyle(NIGHT).fillRect(108, 12, 96, 2);
      g.fillStyle(GOLD).fillRect(108, 12, Math.round((96 * (FIGHT_EVERY - toFight)) / FIGHT_EVERY), 2);
    }
    const s = this.session;
    this.speedButtons.forEach((b, i) => b.setSelected(i === 0 ? s.paused : !s.paused && s.speed === SPEEDS[i - 1]));

    const aiming = this.mode.kind === 'card' && this.mode.source < 0 ? 'click the hero who plays it' : 'click its target';
    const fighting = v.phase === 'resolve' || v.phase === 'clash';
    const idle = s.paused && fighting ? 'paused   space resumes'
      : this.shown?.kind === 'card' && !this.ctrl ? 'hold ctrl for the full rules' : '';
    const hints: Record<Mode['kind'], string> = {
      idle,
      roam: 'click a cell to roam to   esc cancels',
      ult: 'click a cell to aim the ultimate   esc cancels',
      card: `${aiming}   esc cancels`,
    };
    const hint = this.hint.setText(hints[this.mode.kind].toUpperCase());
    // The hint hangs over the board's bottom edge, so it gets a backing.
    if (hint.text) g.fillStyle(INK, 0.85).fillRect(Math.floor(hint.x - hint.width / 2) - 3, hint.y - 5, hint.width + 6, 9);
  }

  /** Card positions in the hand, left to right. */
  private handXs(): number[] {
    const n = this.v.sides[this.me].hand.length;
    const step = n > 1 ? Math.min(CARD_W + 4, (HAND_SPAN - CARD_W) / (n - 1)) : 0;
    return Array.from({ length: n }, (_, i) => Math.round(HAND_CX + (i - (n - 1) / 2) * step));
  }

  /** The topmost hand card under the pointer, or -1: later cards lie over earlier ones. */
  private handAt(p: Phaser.Input.Pointer): number {
    if (this.log.isOpen && p.x < 308 && p.y > 162) return -1;
    const xs = this.handXs();
    const aimingAt = this.mode.kind === 'card' ? this.mode.handIndex : -1;
    for (let i = xs.length - 1; i >= 0; i--) {
      const lift = i === aimingAt ? 6 : 0;
      if (Math.abs(p.x - xs[i]!) <= CARD_W / 2 && p.y >= HAND_Y - CARD_H / 2 - lift && p.y <= H) return i;
    }
    return -1;
  }

  /**
   * The hand along the bottom, in every phase; playable only while
   * committing. A card nobody could play as things stand (its hero down,
   * nothing in reach) lies under a veil; one you cannot afford is faded.
   */
  private drawHand(): void {
    const v = this.v;
    const me = v.sides[this.me];
    const xs = this.handXs();
    const aimingAt = this.mode.kind === 'card' ? this.mode.handIndex : -1;
    const usable = me.hand.map((id) => cardReach(v, this.me, id).sources.length > 0);
    const pin = this.pinned?.kind === 'card' && this.pinned.side === this.me ? this.pinned.card : undefined;
    const hover = this.handHover;

    this.hand.draw([me.hand, xs, this.planning, me.mana, aimingAt, [...this.discard], hover, usable, pin], (add) => {
      me.hand.forEach((id, i) => {
        const face = add(cardFace(this, id, this.me));
        const lift = i === aimingAt ? 6 : i === hover ? 3 : 0;
        face.setPosition(xs[i]!, HAND_Y - lift);
        const affordable = cardDef(id).cost <= me.mana;
        face.setAlpha(this.discard.has(i) ? 0.3 : this.planning && !affordable ? 0.55 : 1);
        if (!usable[i]) {
          face.add(this.add.graphics().fillStyle(INK, 0.6).fillRect(-CARD_W / 2 - 1, -CARD_H / 2 - 1, CARD_W + 2, CARD_H + 2));
        }
        if (id === pin) {
          face.add(this.add.graphics().lineStyle(1, CREAM, 0.9).strokeRect(-CARD_W / 2 - 1.5, -CARD_H / 2 - 1.5, CARD_W + 3, CARD_H + 3));
        }
        if (this.discard.has(i)) add(centred(this, xs[i]!, HAND_Y + 20, 'discard', BLOOD));
      });
    });
  }

  /**
   * The inspect panel in the left column: the inspected card at full size,
   * or a hero's three abilities, or a structure's or camp's stats. Holding
   * ctrl over a card lets its full rules grow up over your cast.
   */
  private drawPanel(): void {
    const v = this.v;
    const it = this.shown;
    this.panel.draw([it, this.ctrl, v.seq, v.sides[this.me].mana, this.reach?.sources.length ?? 0], (add) => {
      if (!it) return;
      if (it.kind === 'card') return this.panelCard(add, it.card, it.side);
      const { x, y, w, h } = PANEL;
      const g = add(this.add.graphics());
      g.fillStyle(INK, 0.92).fillRect(x, y, w, h);
      g.lineStyle(1, DUSK).strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      const rows = it.kind === 'hero' ? this.heroRows(it.uid) : it.kind === 'structure' ? this.structureRows(it.index) : this.campRows(it.index);
      let ty = y + 5;
      for (const row of rows) {
        if (row.gap) ty += 4;
        if (ty + LINE_H > y + h - 2) break;
        let tx = x + 5;
        if (row.dot) {
          // The ability's clock in miniature: lit when ready.
          g.fillStyle(row.dot.tint, row.dot.left <= 0 ? 1 : 0.35).fillRect(tx, ty, 5, 5);
          tx += 8;
        }
        add(text(this, tx, ty, row.text.toUpperCase(), row.tint));
        if (row.right) add(text(this, x + w - 5, ty, row.right.toUpperCase(), MAUVE).setOrigin(1, 0));
        ty += LINE_H;
      }
    });
  }

  /** The inspected card at the panel's width; for your own, why it could not be played as things stand. */
  private panelCard(add: Adder, card: CardId, side: Side): void {
    const { x, y, w, h } = PANEL;
    const face = add(cardFace(this, card, side, { big: true, rules: this.ctrl, w, maxH: this.ctrl ? y + h - 20 : h }));
    face.setPosition(x + w / 2, y + h - face.height / 2);
    if (side !== this.me) return;
    const owner = CARD_OWNER[card];
    const bound = owner && this.v.heroes.find((o) => o.side === this.me && o.id === owner);
    const why = this.reach?.sources.length ? (this.planning && cardDef(card).cost > this.v.sides[this.me].mana ? 'not enough mana' : '')
      : bound && bound.respawnAt >= 0 ? `${heroDef(bound.id).name} is down`
        : bound && atBase(bound) ? `${heroDef(bound.id).name} is at base` : 'nothing in reach';
    if (!why) return;
    const [lx, ly] = [face.x, face.y + face.height / 2 - 7];
    const width = why.length * 4 - 1;
    add(this.add.graphics().fillStyle(INK, 0.9).fillRect(Math.floor(lx - width / 2) - 3, ly - 5, width + 6, 9));
    add(centred(this, lx, ly, why.toUpperCase(), why === 'not enough mana' ? MANA_LIGHT : CREAM));
  }

  /** A hero: name, stats, then each ability with its clock, as far as this side knows. */
  private heroRows(uid: number): PanelRow[] {
    const live = this.v.heroes[uid]!;
    const { hero: h, fresh, ever } = this.roster.known(live);
    const def = heroDef(h.id);
    const st = stats(h);
    const cols = Math.floor((PANEL.w - 10) / 4);
    const [map, fight, ult] = dials(this.v, h);
    const down = live.respawnAt >= 0;
    const rows: PanelRow[] = [
      { text: def.name, tint: h.side === this.me ? GOLD : TEAM[h.side].light, right: down ? 'down' : !fresh ? (ever ? 'unseen' : 'never seen') : '' },
      { text: `hp${down ? 0 : Math.max(0, h.hp)}/${maxHp(h)} dmg${st.dmg} res${st.res} spd${st.spd}`, tint: MAUVE },
    ];
    const ability = (name: string, body: string, dial: typeof map, right: string) => {
      rows.push({ text: name, tint: dial.tint, dot: dial, right, gap: true });
      for (const l of wrap(body, cols)) rows.push({ text: l, tint: CREAM });
    };
    const wait = (d: typeof map, unit: string) => (d.left <= 0 ? 'ready' : `${d.left} ${unit}${d.left === 1 || unit === 'more' ? '' : 's'}`);
    ability(def.map.name, def.map.text, map, def.map.every ? wait(map, 'tick') : map.left ? 'silent' : 'aura');
    ability(def.fight.name, def.fight.text, fight, `every ${def.fight.every}`);
    const u = def.ult;
    ability(u.name, u.text, ult, wait(ult, u.kind === 'ascension' ? 'more' : 'phase'));
    return rows;
  }

  private structureRows(index: number): PanelRow[] {
    const st = this.v.structures[index]!;
    const whose = st.side === this.me ? 'your' : 'rival';
    const where = st.lane === -1 ? '' : `${LANE_NAMES[st.lane]} `;
    const name = st.kind === 'core' ? `${whose} core` : `${whose} ${where}${st.kind} tower`;
    const cols = Math.floor((PANEL.w - 10) / 4);
    const rows: PanelRow[] = [
      { text: name, tint: TEAM[st.side].light },
      { text: st.hp > 0 ? `hp${st.hp}/${st.maxHp}` : 'fallen', tint: st.hp > 0 ? CREAM : MAUVE },
    ];
    if (st.hp <= 0) return rows;
    const say = (body: string, tint = CREAM, gap = false) => wrap(body, cols).forEach((l, i) => rows.push({ text: l, tint, gap: gap && i === 0 }));
    say(`each tick kills a rival minion on its cell; with none left, strikes a rival hero there for ${TOWER_DMG} dmg.`, CREAM, true);
    say('sees its own cell and every cell next to it.', MAUVE, true);
    if (st.kind === 'core') say('when it shatters, the ball is over.', MAUVE, true);
    if (this.v.mapTick < st.guardedUntil) say(`guarded: half damage until tick ${st.guardedUntil}.`, GOLD, true);
    return rows;
  }

  private campRows(index: number): PanelRow[] {
    const c = this.v.camps[index]!;
    const def = campDef(c.kind);
    const cols = Math.floor((PANEL.w - 10) / 4);
    const rows: PanelRow[] = [{ text: def.name, tint: GOLD, right: c.owner === this.me ? 'yours' : 'rival' }];
    const say = (body: string, tint = CREAM, gap = false) => wrap(body, cols).forEach((l, i) => rows.push({ text: l, tint, gap: gap && i === 0 }));
    say(def.text, MAUVE);
    const standing = c.creeps < 0 ? 'out of sight' : c.creeps === 0 ? (c.respawnAt >= 0 ? `cleared: back in ${c.respawnAt - this.v.mapTick}` : 'cleared')
      : `${c.creeps}/${def.creeps} standing${c.hp < def.hp ? `, hp${c.hp} on the first` : ''}`;
    say(standing, CREAM, true);
    rows.push({ text: `each: hp${def.hp} dmg${def.dmg} res${def.res}`, tint: CREAM, gap: true });
    say(`strikes every ${def.every} ticks it is fought. xp ${def.xp} each, shared.`, CREAM);
    say(`stands again ${def.respawn} ticks after the last falls.`, MAUVE);
    return rows;
  }

  /** Mana pips, five to a row. */
  private pips(g: Phaser.GameObjects.Graphics, x: number, y: number, mana: number): void {
    for (let i = 0; i < Math.min(mana, 20); i++) {
      const px = x + (i % 10) * 6, py = y + Math.floor(i / 10) * 5;
      g.fillStyle(INK).fillRect(px - 1, py - 1, 6, 5);
      g.fillStyle(MANA).fillRect(px, py, 4, 3);
      g.fillStyle(MANA_LIGHT).fillRect(px, py, 4, 1);
    }
  }

  /** Bottom right: your mana and deck in the map phase; the initiative timeline and commit while fighting. */
  private drawConsole(): void {
    const v = this.v;
    const me = v.sides[this.me];
    const rival = v.sides[foe(this.me)];
    const fighting = v.phase !== 'map' && v.phase !== 'over';
    const moment = v.phase === 'plan' ? [me.plays, me.committed, rival.committed, v.rivalHand] : fighting ? [v.seq] : [me.hand.length, me.deck.length, me.discard.length, v.rivalHand, me.mana, rival.mana];
    this.console.draw([v.phase, moment, this.planning, me.hand.length, me.mana], (add) => {
      this.timelineHover = null;
      const { x, y, w, h } = CON;
      const g = add(this.add.graphics());
      g.fillStyle(INK, 0.92).fillRect(x, y, w, h);
      g.lineStyle(1, DUSK).strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      add(text(this, x + 5, y + 5, `mana ${me.mana}`.toUpperCase(), MANA_LIGHT));
      this.pips(g, x + 52, y + 5, me.mana);

      if (!fighting) {
        const rows = [
          `hand ${me.hand.length}  deck ${me.deck.length}  discard ${me.discard.length}`,
          `rival: hand ${v.rivalHand}  mana ${rival.mana}`,
          `keeps ${CARDS_KEPT} cards between fights`,
        ];
        rows.forEach((r, i) => add(text(this, x + 5, y + 20 + i * 10, r.toUpperCase(), i === 0 ? CREAM : MAUVE)));
        return;
      }

      const status = v.phase !== 'plan' ? 'initiative' : rival.committed ? 'rival has committed' : 'rival is thinking';
      add(text(this, x + 5, y + 16, status.toUpperCase(), MAUVE));
      // The timeline: your plays above the line, the rival's below, initiative 0 to 9.
      const tx = x + 1 + 1, ty = y + 26, slot = 16;
      const current = v.phase === 'resolve' ? (v.pending[0] ?? 10) : v.phase === 'clash' ? v.initiative : -1;
      for (let i = 0; i < 10; i++) {
        const sx = tx + i * slot;
        g.fillStyle(i < current ? DUSK : PLUM).fillRect(sx, ty, slot - 1, 31);
        g.fillStyle(INK).fillRect(sx, ty + 15, slot - 1, 1);
        add(centred(this, sx + slot / 2, ty + 36, String(i), i === current ? GOLD : MAUVE));
      }
      for (const [side, row] of [[this.me, 0], [foe(this.me), 1]] as const) {
        const perSlot = new Map<number, number>();
        v.sides[side].plays.forEach((pl, index) => {
          const ini = cardDef(pl.card).initiative;
          const k = perSlot.get(ini) ?? 0;
          perSlot.set(ini, k + 1);
          const icon = add(this.add.image(tx + ini * slot + 4 + (k % 2) * 7, ty + row * 16 + 4 + Math.floor(k / 2) * 6, iconKey(pl.card, side)));
          if (pl.cancelled) icon.setAlpha(0.35);
          icon.setInteractive({ useHandCursor: side === this.me && this.planning });
          icon.on('pointerover', () => { this.timelineHover = { card: pl.card, side }; });
          icon.on('pointerout', () => { this.timelineHover = null; });
          if (side === this.me && this.planning) icon.on('pointerdown', () => { this.timelineHover = null; this.session.submit({ type: 'unplay', index }); });
        });
      }
      if (v.phase === 'plan') {
        const over = me.hand.length - CARDS_KEPT;
        if (this.planning && over > 0) add(text(this, x + 5, y + h - 21, `keeps ${CARDS_KEPT}: right-click to discard`.toUpperCase(), MAUVE));
        add(button(this, x + w - 46, y + h - 10, 88, me.committed ? 'waiting...' : 'commit (enter)', () => this.commit())).setEnabled(this.planning);
      }
    });
  }

  /** Under your bars, above the inspect panel: orders for the selected hero, while the map runs. */
  private drawOrders(): void {
    const v = this.v;
    const h = this.own(this.selected);
    const orders = v.sides[this.me].orders;
    const map = v.phase === 'map';
    const rival = h ? undefined : this.v.heroes[this.selected];
    const key = map && h ? [h.uid, h.stance, h.respawnAt >= 0, h.ultReadyAt, v.fightPhase, orders, this.mode.kind] : [map, rival?.uid];
    this.orders.draw(key, (add) => {
      const { x, y } = ORDERS;
      if (!map) return;
      if (rival) {
        add(text(this, x, y, 'watching a rival:\nclick one of yours\nto give orders'.toUpperCase(), MAUVE));
        return;
      }
      if (!h) {
        add(text(this, x, y, 'click a hero\nto give orders'.toUpperCase(), MAUVE));
        return;
      }
      const def = heroDef(h.id);
      const alive = h.respawnAt < 0;
      add(text(this, x, y, `orders: ${orders.stance} stance ${orders.roam} roam`.toUpperCase(), MAUVE));
      // One row of three, so the panel below keeps its room.
      add(button(this, x + 17, y + 15, 34, h.stance === 'passive' ? 'aggr s' : 'pass s', () => this.orderStance()))
        .setEnabled(alive && orders.stance > 0);
      add(button(this, x + 53, y + 15, 34, 'roam r', () => this.beginOrder('roam')))
        .setEnabled(alive && orders.roam > 0).setSelected(this.mode.kind === 'roam');
      if (def.ult.kind === 'command') {
        add(button(this, x + 89, y + 15, 34, 'ult u', () => this.beginOrder('ult')))
          .setEnabled(alive && v.fightPhase >= h.ultReadyAt).setSelected(this.mode.kind === 'ult');
      }
    });
  }

  /** The hotkeys, folded behind the ? in the corner. */
  private drawHelp(): void {
    const open = this.helpPinned || this.helpHover;
    this.help.draw([open], (add) => {
      if (!open) return;
      const rows: [string, string][] = [
        ['click', 'select a hero or its bar, either side'],
        ['click card', 'pin it beside you; play it (commit)'],
        ['click tower', 'or camp: pin its stats beside you'],
        ['s', 'toggle passive / aggressive'],
        ['r', 'roam to a cell'],
        ['u', 'aim a command ultimate'],
        ['right-click', 'mark a card to discard'],
        ['enter', 'commit your cards'],
        ['esc', 'cancel aiming, let go of a pin'],
        ['hold ctrl', 'a card\'s full rules'],
        ['space', 'pause (fights pause as they start)'],
        ['1-4', 'speed'],
        ['l', 'toggle the log (hover a line to find it)'],
        ['z', 'toggle zooming in on fights'],
      ];
      const w = 230, hgt = rows.length * 9 + 14;
      const [x, y] = [4, H - 20 - hgt];
      add(this.add.graphics().fillStyle(INK, 0.95).fillRect(x, y, w, hgt).lineStyle(1, DUSK).strokeRect(x + 0.5, y + 0.5, w - 1, hgt - 1));
      add(text(this, x + 5, y + 4, 'HOTKEYS', GOLD));
      rows.forEach(([k, what], i) => {
        add(text(this, x + 5, y + 14 + i * 9, k.toUpperCase(), CREAM));
        add(text(this, x + 58, y + 14 + i * 9, what.toUpperCase(), MAUVE));
      });
    });
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
