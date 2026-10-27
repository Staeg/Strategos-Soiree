import Phaser from 'phaser';
import { DRAFT_ORDER, draftingSide, hero, HERO_IDS, type HeroId, type Side } from '@soiree/sim';
import { heroKey, heroOriginX } from '../art/forge.ts';
import { CREAM, DUSK, GOLD, INK, MAUVE, PLUM, TEAM } from '../art/palette.ts';
import type { Session } from '../session.ts';
import { backdrop, centred, text, W } from '../ui.ts';

interface Tile {
  id: HeroId;
  frame: Phaser.GameObjects.Graphics;
  sprite: Phaser.GameObjects.Sprite;
  tag: Phaser.GameObjects.BitmapText;
}

const TILE_W = 74, TILE_H = 58;

export class Draft extends Phaser.Scene {
  private session!: Session;
  private tiles: Tile[] = [];
  private turn!: Phaser.GameObjects.BitmapText;
  private order!: Phaser.GameObjects.Graphics;

  constructor() { super('draft'); }

  init(data: { session: Session }): void {
    this.session = data.session;
    this.tiles = [];
  }

  create(): void {
    backdrop(this, 250);
    centred(this, W / 2, 54, 'The Draft', GOLD, 2);
    this.turn = centred(this, W / 2, 68, '', CREAM);
    this.order = this.add.graphics();

    HERO_IDS.forEach((id, i) => {
      const x = W / 2 + ((i % 4) - 1.5) * (TILE_W + 6);
      const y = 118 + Math.floor(i / 4) * (TILE_H + 6);
      const def = hero(id);
      const frame = this.add.graphics({ x, y });
      const sprite = this.add.sprite(x - 24, y + 14, heroKey(id, this.session.side))
        .setOrigin(heroOriginX(this.session.side), 1).setScale(2);
      text(this, x + 2, y - 22, def.name, GOLD);
      text(this, x + 2, y - 12, `hp ${def.hp}`, CREAM);
      text(this, x + 2, y - 4, `dmg ${def.dmg}`, CREAM);
      text(this, x + 2, y + 4, `rng ${def.range / 100}`, CREAM);
      if (def.heal) text(this, x + 2, y + 12, `heal ${def.heal}`, TEAM[0].light);
      const tag = centred(this, x, y + TILE_H / 2 - 4, '', INK);
      const zone = this.add.zone(x, y, TILE_W, TILE_H).setInteractive({ useHandCursor: true });
      zone.on('pointerover', () => this.isMine(id) && sprite.play(`${heroKey(id, this.session.side)}-walk`));
      zone.on('pointerout', () => sprite.stop().setFrame('0'));
      zone.on('pointerdown', () => this.isMine(id) && this.session.submit({ type: 'pick', hero: id }));
      this.tiles.push({ id, frame, sprite, tag });
    });
    this.refresh();
  }

  override update(_: number, delta: number): void {
    const events = this.session.update(delta);
    if (this.session.state.phase !== 'draft') {
      this.scene.start('match', { session: this.session });
      return;
    }
    if (events.some((e) => e.type === 'pick')) this.refresh();
  }

  private isMine(id: HeroId): boolean {
    const s = this.session.state;
    return draftingSide(s) === this.session.side && s.pool.includes(id);
  }

  private refresh(): void {
    const s = this.session.state;
    const me = this.session.side;
    const mine = draftingSide(s) === me;
    this.turn.setText(mine ? 'YOUR PICK' : 'RIVAL IS CHOOSING...').setTint(mine ? CREAM : MAUVE);

    for (const t of this.tiles) {
      const owner = ([0, 1] as const).find((side) => s.sides[side].picks.includes(t.id));
      const g = t.frame.clear();
      g.fillStyle(INK).fillRect(-TILE_W / 2 - 1, -TILE_H / 2 - 1, TILE_W + 2, TILE_H + 2);
      g.fillStyle(owner === undefined ? PLUM : TEAM[owner].dark).fillRect(-TILE_W / 2, -TILE_H / 2, TILE_W, TILE_H);
      g.fillStyle(owner === undefined ? DUSK : TEAM[owner].main).fillRect(-TILE_W / 2, -TILE_H / 2, TILE_W, 1);
      t.sprite.setAlpha(owner === undefined ? 1 : 0.55);
      t.tag.setText(owner === undefined ? '' : owner === me ? 'YOURS' : 'RIVAL');
    }

    // The snake order, as a row of pips: filled once spent.
    const g = this.order.clear();
    DRAFT_ORDER.forEach((side: Side, i) => {
      const x = W / 2 + (i - 2.5) * 10, y = 80;
      g.fillStyle(INK).fillRect(x - 3, y - 3, 6, 6);
      g.fillStyle(i < s.draftTurn ? TEAM[side].main : i === s.draftTurn ? GOLD : TEAM[side].dark).fillRect(x - 2, y - 2, 4, 4);
    });
  }
}
