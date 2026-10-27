import Phaser from 'phaser';
import { forgeAll } from '../art/forge.ts';

export class Boot extends Phaser.Scene {
  constructor() { super('boot'); }

  create(): void {
    forgeAll(this);
    this.scene.start('title');
  }
}
