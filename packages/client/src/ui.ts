import Phaser from 'phaser';
import { CREAM, DUSK, GOLD, INK, MAUVE, NIGHT, PLUM } from './art/palette.ts';

export const W = 480;
export const H = 270;

export function text(scene: Phaser.Scene, x: number, y: number, value: string, tint = CREAM, scale = 1) {
  return scene.add.bitmapText(x, y, 'pixel', value.toUpperCase()).setTint(tint).setScale(scale);
}

export function centred(scene: Phaser.Scene, x: number, y: number, value: string, tint = CREAM, scale = 1) {
  return text(scene, x, y, value, tint, scale).setOrigin(0.5, 0.5);
}

export interface Button extends Phaser.GameObjects.Container {
  setEnabled(on: boolean): this;
  setSelected(on: boolean): this;
}

/** A bevelled pixel button. Plain Graphics, so it stays crisp at every zoom. */
export function button(scene: Phaser.Scene, x: number, y: number, w: number, label: string, onClick: () => void): Button {
  const h = 13;
  const g = scene.add.graphics();
  const t = centred(scene, 0, 0, label);
  const c = scene.add.container(x, y, [g, t]) as Button;
  let enabled = true, selected = false, hover = false;
  const draw = () => {
    g.clear();
    const face = !enabled ? NIGHT : selected ? GOLD : hover ? MAUVE : DUSK;
    g.fillStyle(INK).fillRect(-w / 2 - 1, -h / 2 - 1, w + 2, h + 2);
    g.fillStyle(face).fillRect(-w / 2, -h / 2, w, h);
    g.fillStyle(selected ? CREAM : MAUVE, enabled ? 1 : 0.3).fillRect(-w / 2, -h / 2, w, 1);
    g.fillStyle(INK, 0.35).fillRect(-w / 2, h / 2 - 1, w, 1);
    t.setTint(!enabled ? DUSK : selected ? INK : CREAM);
  };
  c.setSize(w, h).setInteractive({ useHandCursor: true })
    .on('pointerover', () => { hover = true; draw(); })
    .on('pointerout', () => { hover = false; draw(); })
    .on('pointerdown', () => enabled && onClick());
  c.setEnabled = (on) => { enabled = on; draw(); return c; };
  c.setSelected = (on) => { selected = on; draw(); return c; };
  draw();
  return c;
}

/** Night sky over a ballroom: dithered dusk bands, a few stars, a garland of lanterns. */
export function backdrop(scene: Phaser.Scene, floorY = 150): void {
  const g = scene.add.graphics();
  const bands = [NIGHT, 0x22192e, PLUM, 0x3a2a50];
  const bandH = floorY / bands.length;
  bands.forEach((c, i) => g.fillStyle(c).fillRect(0, i * bandH, W, bandH + 1));
  for (let i = 1; i < bands.length; i++) {
    g.fillStyle(bands[i]!);
    for (let x = (i % 2) * 2; x < W; x += 4) g.fillRect(x, i * bandH - 1, 2, 1);
  }
  const rng = new Phaser.Math.RandomDataGenerator(['soiree']);
  for (let i = 0; i < 40; i++) {
    const star = scene.add.image(rng.between(0, W), rng.between(0, floorY * 0.6), 'pixel').setTint(CREAM).setAlpha(rng.realInRange(0.2, 0.8));
    scene.tweens.add({ targets: star, alpha: 0.1, duration: rng.between(900, 2600), yoyo: true, repeat: -1, delay: rng.between(0, 2000) });
  }
  scene.add.tileSprite(0, floorY, W, H - floorY, 'floor').setOrigin(0, 0);
  // A sagging string between posts, lanterns hung along it.
  const cord = scene.add.graphics().lineStyle(1, MAUVE, 0.8);
  const sag = (x: number) => 26 + Math.sin((x / W) * Math.PI) * 10;
  cord.beginPath().moveTo(0, sag(0));
  for (let x = 0; x <= W; x += 4) cord.lineTo(x, sag(x));
  cord.strokePath();
  for (let x = 24; x < W; x += 48) {
    const lantern = scene.add.image(x, sag(x) + 3, 'lantern').setOrigin(0.5, 0);
    scene.tweens.add({ targets: lantern, angle: { from: -6, to: 6 }, duration: 1800 + (x % 5) * 200, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
  }
}
