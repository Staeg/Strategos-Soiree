import Phaser from 'phaser';
import {
  BATTLE_TICKS, card, CARDS, hero, LANE, MAX_ROUNDS, NEXUS_HP,
  type CardId, type GameEvent, type Side, type Stance, type Unit,
} from '@soiree/sim';
import { heroKey, heroOriginX } from '../art/forge.ts';
import { BLOOD, CREAM, DUSK, GOLD, INK, LEAF, MAUVE, NIGHT, PLUM, TEAM, VIOLET } from '../art/palette.ts';
import type { Session } from '../session.ts';
import { backdrop, button, centred, H, text, W, type Button } from '../ui.ts';

const FLOOR_Y = 120;
const LANE_X: [number, number] = [44, W - 44];
const ROW_Y = [162, 190, 218];
const SCALE = 2;
const NEXUS_X: Record<Side, number> = { 0: 22, 1: W - 22 };
const NEXUS_Y = 206;
const STANCES: [Stance, string][] = [['aggressive', '1 Aggressive'], ['balanced', '2 Balanced'], ['defensive', '3 Defensive']];

interface UnitView {
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image;
  bar: Phaser.GameObjects.Graphics;
  striking: number;
}

const laneX = (side: Side, dist: number) => {
  const t = dist / LANE;
  return Math.round(side === 0 ? LANE_X[0] + t * (LANE_X[1] - LANE_X[0]) : LANE_X[1] - t * (LANE_X[1] - LANE_X[0]));
};

export class Match extends Phaser.Scene {
  private session!: Session;
  private units = new Map<number, UnitView>();
  private nexus!: Record<Side, Phaser.GameObjects.Image>;
  private hud!: Phaser.GameObjects.Graphics;
  private roundLabel!: Phaser.GameObjects.BitmapText;
  private rivalStance!: Phaser.GameObjects.BitmapText;
  private stanceButtons: Button[] = [];
  private council!: Phaser.GameObjects.Container;
  private councilKey = '';
  private reveal = 0;

  constructor() { super('match'); }

  init(data: { session: Session }): void {
    this.session = data.session;
    this.units.clear();
    this.stanceButtons = [];
    this.councilKey = '';
  }

  create(): void {
    backdrop(this, FLOOR_Y);
    this.add.graphics().fillStyle(INK, 0.3).fillRect(0, ROW_Y[0]! - 30, W, ROW_Y[2]! - ROW_Y[0]! + 36);
    this.nexus = {
      0: this.add.image(NEXUS_X[0], NEXUS_Y, 'nexus-0').setOrigin(0.5, 1).setScale(SCALE).setDepth(NEXUS_Y),
      1: this.add.image(NEXUS_X[1], NEXUS_Y, 'nexus-1').setOrigin(0.5, 1).setScale(SCALE).setDepth(NEXUS_Y),
    };
    for (const side of [0, 1] as const) {
      this.tweens.add({ targets: this.nexus[side], y: NEXUS_Y - 2, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    }

    this.hud = this.add.graphics().setDepth(1000);
    this.roundLabel = centred(this, W / 2, 9, '').setDepth(1001);
    this.add.graphics().setDepth(999).fillStyle(INK).fillRect(0, H - 40, W, 40).fillStyle(DUSK).fillRect(0, H - 40, W, 1);
    STANCES.forEach(([stance, label], i) => {
      this.stanceButtons.push(button(this, W / 2 + (i - 1) * 96, H - 22, 88, label, () => this.session.submit({ type: 'stance', stance })).setDepth(1001));
    });
    this.rivalStance = text(this, W - 96, H - 8, '', MAUVE).setDepth(1001);
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      const stance = STANCES[Number(e.key) - 1];
      if (stance) this.session.submit({ type: 'stance', stance: stance[0] });
      if (e.key === ' ' && this.session.state.phase === 'council') this.session.submit({ type: 'endTurn' });
    });
    this.council = this.add.container(0, 0).setDepth(2000);

    this.banner(`Battle ${this.session.state.round}`);
  }

  override update(time: number, delta: number): void {
    const events = this.session.update(delta);
    for (const e of events) this.react(e, time);
    this.drawUnits(time);
    this.drawHud();
    this.drawCouncil();
  }

  // ---- the lane -----------------------------------------------------------

  private view(u: Unit): UnitView {
    let v = this.units.get(u.id);
    if (!v) {
      const key = heroKey(u.hero, u.side);
      v = {
        shadow: this.add.image(0, 0, 'shadow').setAlpha(0.45).setScale(SCALE),
        sprite: this.add.sprite(0, 0, key).setOrigin(heroOriginX(u.side), 1).setScale(SCALE).play(`${key}-walk`),
        bar: this.add.graphics(),
        striking: 0,
      };
      this.units.set(u.id, v);
    }
    return v;
  }

  private unitPos(id: number): { x: number; y: number } {
    const u = this.session.state.units[id]!;
    const p = this.session.prev.units[id];
    const dist = p && p.respawnAt < 0 && u.respawnAt < 0 ? Phaser.Math.Linear(p.dist, u.dist, this.session.alpha) : u.dist;
    return { x: laneX(u.side, dist), y: ROW_Y[u.slot]! };
  }

  private drawUnits(time: number): void {
    const { state, prev } = this.session;
    for (const u of state.units) {
      const v = this.view(u);
      const alive = u.respawnAt < 0;
      const { x, y } = this.unitPos(u.id);
      const key = heroKey(u.hero, u.side);
      const moving = prev.units[u.id]?.dist !== u.dist && state.phase === 'battle';
      v.sprite.setPosition(x, y).setDepth(y).setVisible(alive);
      v.shadow.setPosition(x, y).setDepth(y - 1).setVisible(alive);
      if (time > v.striking) {
        const anim = moving ? `${key}-walk` : `${key}-idle`;
        if (v.sprite.anims.currentAnim?.key !== anim) v.sprite.play(anim);
      }
      const g = v.bar.clear().setDepth(y + 1).setVisible(alive);
      const max = hero(u.hero).hp;
      g.fillStyle(INK).fillRect(x - 8, y - 32, 16, 4);
      g.fillStyle(TEAM[u.side].main).fillRect(x - 7, y - 31, Math.ceil((14 * u.hp) / max), 2);
    }
  }

  private react(e: GameEvent, time: number): void {
    switch (e.type) {
      case 'hit':
      case 'siege': {
        const from = this.units.get(e.from);
        const attacker = this.session.state.units[e.from]!;
        if (from) {
          from.sprite.play(`${heroKey(attacker.hero, attacker.side)}-strike`);
          from.striking = time + 300;
        }
        const start = this.unitPos(e.from);
        const end = e.type === 'hit' ? this.unitPos(e.to) : { x: NEXUS_X[e.side], y: NEXUS_Y - 16 };
        const land = () => {
          this.add.sprite(end.x, end.y - 14, 'spark').setDepth(3000).setScale(SCALE).play('spark');
          this.float(end.x, end.y - 38, e.crit ? `${e.amount}!` : String(e.amount), e.crit ? GOLD : CREAM);
          if (e.type === 'hit') {
            const target = this.units.get(e.to)?.sprite.setTintFill(0xffffff);
            this.time.delayedCall(70, () => target?.clearTint());
          } else this.tweens.add({ targets: this.nexus[e.side], x: NEXUS_X[e.side] + 1, duration: 40, yoyo: true, repeat: 2 });
        };
        const range = hero(attacker.hero).range;
        if (range < 1000) return land();
        const missile = attacker.hero === 'archer' ? 'arrow' : 'orb';
        const shot = this.add.image(start.x, start.y - 16, missile).setDepth(3000).setScale(SCALE).setFlipX(attacker.side === 1);
        this.tweens.add({ targets: shot, x: end.x, y: end.y - 16, duration: 160, onComplete: () => { shot.destroy(); land(); } });
        return;
      }
      case 'heal': {
        const p = this.unitPos(e.to);
        const plus = this.add.image(p.x, p.y - 24, 'plus').setDepth(3000).setScale(SCALE);
        this.tweens.add({ targets: plus, y: p.y - 40, alpha: 0, duration: 600, onComplete: () => plus.destroy() });
        this.float(p.x + 10, p.y - 36, `+${e.amount}`, LEAF);
        return;
      }
      case 'death': {
        const p = this.unitPos(e.unit);
        this.add.sprite(p.x, p.y - 12, 'puff').setDepth(3000).setScale(SCALE).play('puff');
        return;
      }
      case 'phase':
        if (e.phase === 'battle') this.banner(`Battle ${e.round}`);
        if (e.phase === 'council') this.banner('Council');
        if (e.phase === 'over') this.finale();
        return;
      case 'card': {
        const who = e.side === this.session.side ? 'You' : 'Rival';
        const name = card(e.card).name;
        const label = e.card === 'gambit' ? `${who}: ${name} ${e.success ? 'hits!' : 'misses'}` : `${who}: ${name}`;
        const y = 70 + this.reveal * 10;
        this.reveal++;
        const t = centred(this, W / 2, y, label, TEAM[e.side].light).setDepth(3000).setAlpha(0);
        this.tweens.add({ targets: t, alpha: 1, duration: 200, hold: 1400, yoyo: true, onComplete: () => { t.destroy(); this.reveal = Math.max(0, this.reveal - 1); } });
        return;
      }
      default:
        return;
    }
  }

  private float(x: number, y: number, value: string, tint: number): void {
    const t = centred(this, x, y, value, tint).setDepth(3001);
    this.tweens.add({ targets: t, y: y - 10, alpha: 0, duration: 700, ease: 'Quad.out', onComplete: () => t.destroy() });
  }

  private banner(label: string): void {
    const t = centred(this, W / 2, 104, label, GOLD, 3).setDepth(3000).setAlpha(0);
    this.tweens.add({ targets: t, alpha: 1, duration: 250, hold: 700, yoyo: true, onComplete: () => t.destroy() });
  }

  // ---- heads-up display ---------------------------------------------------

  private drawHud(): void {
    const s = this.session.state;
    const g = this.hud.clear();
    for (const side of [0, 1] as const) {
      const w = 140, x = side === 0 ? 8 : W - 8 - w;
      const fill = Math.round((w * s.sides[side].nexus) / NEXUS_HP);
      g.fillStyle(INK).fillRect(x - 1, 4, w + 2, 8);
      g.fillStyle(NIGHT).fillRect(x, 5, w, 6);
      g.fillStyle(TEAM[side].main).fillRect(side === 0 ? x : x + w - fill, 5, fill, 6);
      g.fillStyle(TEAM[side].light).fillRect(side === 0 ? x : x + w - fill, 5, fill, 1);
    }
    const timer = s.phase === 'battle' ? s.battleTicksLeft / BATTLE_TICKS : 0;
    g.fillStyle(INK).fillRect(W / 2 - 41, 15, 82, 4);
    g.fillStyle(GOLD).fillRect(W / 2 - 40, 16, Math.round(80 * timer), 2);
    this.roundLabel.setText(`ROUND ${Math.max(1, s.round)}/${MAX_ROUNDS}`);

    const me = s.sides[this.session.side];
    const battle = s.phase === 'battle';
    this.stanceButtons.forEach((b, i) => b.setVisible(s.phase !== 'council').setEnabled(battle).setSelected(me.stance === STANCES[i]![0]));
    const rival = s.sides[this.session.side === 0 ? 1 : 0];
    this.rivalStance.setText(battle ? `RIVAL: ${rival.stance.toUpperCase()}` : '');
  }

  // ---- the council (turn-based phase) ------------------------------------

  private drawCouncil(): void {
    const s = this.session.state;
    const me = s.sides[this.session.side];
    const rivalReady = s.sides[this.session.side === 0 ? 1 : 0].ready;
    const key = s.phase === 'council' ? JSON.stringify([me.hand, me.queued, me.mana, me.ready, rivalReady]) : '';
    if (key === this.councilKey) return;
    this.councilKey = key;
    this.council.removeAll(true);
    if (s.phase !== 'council') return;

    const veil = this.add.graphics().fillStyle(INK, 0.72).fillRect(0, 24, W, H - 64);
    this.council.add(veil);
    this.council.add(centred(this, W / 2, 44, 'Council', GOLD, 2));
    this.council.add(centred(this, W / 2, 60, 'commit cards blind. both sides reveal at once.', MAUVE));

    // Mana as a row of gems.
    const pips = this.add.graphics();
    const total = me.mana + me.queued.reduce((t, c) => t + CARDS[c].cost, 0);
    for (let i = 0; i < total; i++) {
      const x = W / 2 + (i - (total - 1) / 2) * 9, y = 76;
      pips.fillStyle(INK).fillRect(x - 3, y - 3, 7, 7);
      pips.fillStyle(i < me.mana ? VIOLET : PLUM).fillRect(x - 2, y - 2, 5, 5);
      if (i < me.mana) pips.fillStyle(CREAM).fillRect(x - 1, y - 1, 1, 1);
    }
    this.council.add(pips);

    me.queued.forEach((id, i) => this.council.add(this.cardFace(W / 2 + (i - (me.queued.length - 1) / 2) * 36, 112, id, 0.6, false)));
    if (me.queued.length) this.council.add(centred(this, W / 2, 92, 'committed', MAUVE));

    me.hand.forEach((id, i) => {
      const playable = !me.ready && CARDS[id].cost <= me.mana;
      const face = this.cardFace(W / 2 + (i - (me.hand.length - 1) / 2) * 56, 172, id, 1, playable);
      if (playable) face.on('pointerdown', () => this.session.submit({ type: 'play', handIndex: i }));
      this.council.add(face);
    });

    const end = button(this, W / 2, H - 22, 110, me.ready ? 'waiting...' : 'end turn (space)', () => this.session.submit({ type: 'endTurn' }));
    end.setEnabled(!me.ready);
    this.council.add(end);
    this.council.add(text(this, W - 96, H - 8, rivalReady ? 'RIVAL: READY' : 'RIVAL: THINKING', rivalReady ? CREAM : MAUVE));
  }

  private cardFace(x: number, y: number, id: CardId, scale: number, playable: boolean): Phaser.GameObjects.Container {
    const def = card(id);
    const w = 48, h = 64;
    const g = this.add.graphics();
    g.fillStyle(INK).fillRect(-w / 2 - 1, -h / 2 - 1, w + 2, h + 2);
    g.fillStyle(GOLD).fillRect(-w / 2, -h / 2, w, h);
    g.fillStyle(CREAM).fillRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4);
    g.fillStyle(DUSK).fillRect(-w / 2 + 6, -h / 2 + 6, w - 12, 20);
    g.fillStyle(INK).fillRect(-w / 2 - 2, -h / 2 - 2, 10, 10);
    g.fillStyle(VIOLET).fillRect(-w / 2 - 1, -h / 2 - 1, 8, 8);
    const icon = this.add.image(0, -h / 2 + 16, `icon-${id}-${this.session.side}`).setScale(2);
    const cost = centred(this, -w / 2 + 3, -h / 2 + 3, String(def.cost), CREAM);
    const name = centred(this, 0, 2, def.name, INK);
    const body = this.add.bitmapText(-w / 2 + 4, 9, 'pixel', def.text.toUpperCase()).setTint(BLOOD).setMaxWidth(w - 8);
    const c = this.add.container(x, y, [g, icon, cost, name, body]).setScale(scale).setSize(w, h);
    if (!playable && scale === 1) c.setAlpha(0.45);
    if (playable) {
      c.setInteractive({ useHandCursor: true });
      c.on('pointerover', () => this.tweens.add({ targets: c, y: y - 6, duration: 80 }));
      c.on('pointerout', () => this.tweens.add({ targets: c, y, duration: 80 }));
    }
    return c;
  }

  // ---- the end -----------------------------------------------------------

  private finale(): void {
    const s = this.session.state;
    const verdict = s.winner === 'draw' ? 'Draw' : s.winner === this.session.side ? 'Victory' : 'Defeat';
    this.time.delayedCall(900, () => {
      this.add.graphics().setDepth(4000).fillStyle(INK, 0.8).fillRect(0, 0, W, H);
      centred(this, W / 2, 96, verdict, verdict === 'Defeat' ? BLOOD : GOLD, 4).setDepth(4001);
      centred(this, W / 2, 124, `nexus ${s.sides[this.session.side].nexus} - ${s.sides[this.session.side === 0 ? 1 : 0].nexus}`, CREAM).setDepth(4001);
      button(this, W / 2, 160, 90, 'again', () => this.scene.start('title')).setDepth(4001);
    });
  }
}
