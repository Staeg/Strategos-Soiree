import Phaser from 'phaser';
import { DIFFICULTIES, HERO_IDS, type Difficulty } from '@soiree/sim';
import { heroKey, heroOriginX } from '../art/forge.ts';
import { GOLD, MAUVE } from '../art/palette.ts';
import { autosave, clearAutosave, loadAutosave, watch } from '../save.ts';
import { LocalSession } from '../session.ts';
import { backdrop, button, centred, W } from '../ui.ts';

const BLURB: Record<Difficulty, string> = {
  novice: 'Novice: plays on a whim',
  tactician: 'Tactician: reads the board',
};

export class Title extends Phaser.Scene {
  constructor() { super('title'); }

  create(): void {
    backdrop(this, 214);
    centred(this, W / 2, 96, 'Strategos', GOLD, 5);
    centred(this, W / 2, 126, 'a soiree of blades', MAUVE, 1);

    // A little procession of the cast along the floor.
    HERO_IDS.forEach((id, i) => {
      const side = (i % 2) as 0 | 1;
      const x = W / 2 + (i - (HERO_IDS.length - 1) / 2) * 56;
      this.add.image(x, 260, 'shadow').setAlpha(0.4).setScale(2);
      this.add.sprite(x, 261, heroKey(id, side)).setOrigin(heroOriginX(side), 1).setScale(2).play(`${heroKey(id, side)}-walk`);
    });

    const hint = centred(this, W / 2, 330, 'choose your rival', MAUVE);
    DIFFICULTIES.forEach((d, i) => {
      const b = button(this, W / 2 + (i - (DIFFICULTIES.length - 1) / 2) * 110, 300, 100, d, () => this.begin(d));
      b.on('pointerover', () => hint.setText(BLURB[d].toUpperCase()));
    });

    const save = loadAutosave();
    if (save) {
      const { mapTick, fightPhase } = save.state;
      const b = button(this, W / 2, 278, 100, 'continue', () => this.play(LocalSession.resume(save)));
      b.on('pointerover', () => hint.setText(`the ${save.setup.difficulty} match, from tick ${mapTick}${fightPhase ? ` (fight ${fightPhase})` : ''}`.toUpperCase()));
    }
  }

  private begin(difficulty: Difficulty): void {
    const seed = (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0;
    this.play(new LocalSession({ seed, difficulty, side: 0 }));
  }

  /** Auto-saves as the ball begins and as every fight phase opens; a finished match leaves nothing to continue. */
  private play(session: LocalSession): void {
    watch(session);
    autosave(session);
    session.onPhase = (phase) => {
      if (phase === 'plan') autosave(session);
      if (phase === 'over') clearAutosave();
    };
    this.scene.start('match', { session });
  }
}
