import Phaser from 'phaser';
import { H, W } from './ui.ts';
import { Boot } from './scenes/Boot.ts';
import { Title } from './scenes/Title.ts';
import { Lineup } from './scenes/Lineup.ts';
import { Match } from './scenes/Match.ts';

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: W,
  height: H,
  pixelArt: true,
  roundPixels: true,
  backgroundColor: '#120d19',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [Boot, Title, Lineup, Match],
});
