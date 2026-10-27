import Phaser from 'phaser';
import { createAgent, DIFFICULTIES, HERO_IDS, type Difficulty } from '@soiree/sim';
import { heroKey, heroOriginX } from '../art/forge.ts';
import { GOLD, MAUVE } from '../art/palette.ts';
import { LocalSession } from '../session.ts';
import { backdrop, button, centred, W } from '../ui.ts';

const BLURB: Record<Difficulty, string> = {
  novice: 'Novice: picks on a whim',
  tactician: 'Tactician: reads the fight',
  strategos: 'Strategos: plans ahead',
};

export class Title extends Phaser.Scene {
  constructor() { super('title'); }

  create(): void {
    backdrop(this, 160);
    centred(this, W / 2, 70, 'Strategos', GOLD, 4);
    centred(this, W / 2, 94, 'a soiree of blades', MAUVE, 1);

    // A little procession of the cast along the floor.
    HERO_IDS.forEach((id, i) => {
      const side = (i % 2) as 0 | 1;
      this.add.image(W / 2 + (i - 3.5) * 40, 196, 'shadow').setAlpha(0.4).setScale(2);
      this.add.sprite(W / 2 + (i - 3.5) * 40, 197, heroKey(id, side)).setOrigin(heroOriginX(side), 1).setScale(2).play(`${heroKey(id, side)}-walk`);
    });

    const hint = centred(this, W / 2, 250, 'choose your rival', MAUVE);
    DIFFICULTIES.forEach((d, i) => {
      const b = button(this, W / 2 + (i - 1) * 100, 222, 90, d, () => this.begin(d));
      b.on('pointerover', () => hint.setText(BLURB[d].toUpperCase()));
    });
  }

  private begin(difficulty: Difficulty): void {
    const seed = (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0;
    this.scene.start('draft', { session: new LocalSession(seed, createAgent(difficulty, seed ^ 0x5eed)), difficulty });
  }
}
