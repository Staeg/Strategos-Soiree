import Phaser from 'phaser';
import { cardDef, type CardId, type CardOp, type Side } from '@soiree/sim';
import { BLOOD, CREAM, DUSK, GOLD, INK, MAUVE, VIOLET } from './art/palette.ts';
import { centred } from './ui.ts';

const ICON: Record<CardOp['op'], string> = {
  engage: 'engage', join: 'join', shield: 'guard', guardTower: 'guard', evade: 'evade', fade: 'evade', shadowStep: 'evade',
  strike: 'strike', shell: 'strike', heal: 'heal', rewind: 'heal', nightfall: 'reveal',
  empower: 'tactic', focus: 'tactic', slow: 'tactic', expose: 'tactic', quick: 'tactic', firstHit: 'tactic', opening: 'tactic',
  procession: 'tactic', charge: 'tactic', cancel: 'tactic', unwrite: 'tactic', squeeze: 'tactic', rally: 'tactic', clear: 'tactic', cadence: 'tactic',
};
export const iconKey = (id: CardId, side: Side) => `icon-${ICON[cardDef(id).effect[0]!.op]}-${side}`;

export const CARD_W = 52;
export const CARD_H = 70;

/**
 * A card face: cost gem top-left, initiative badge top-right, emblem, name,
 * and either its rules text or, while Alt is held, its hidden keywords.
 */
export function cardFace(scene: Phaser.Scene, id: CardId, side: Side, keywords: boolean): Phaser.GameObjects.Container {
  const def = cardDef(id);
  const [w, h] = [CARD_W, CARD_H];
  const ultimate = def.keywords.includes('Ultimate');
  const g = scene.add.graphics();
  g.fillStyle(INK).fillRect(-w / 2 - 1, -h / 2 - 1, w + 2, h + 2);
  g.fillStyle(ultimate ? VIOLET : GOLD).fillRect(-w / 2, -h / 2, w, h);
  g.fillStyle(CREAM).fillRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4);
  g.fillStyle(DUSK).fillRect(-w / 2 + 6, -h / 2 + 5, w - 12, 18);
  g.fillStyle(INK).fillRect(-w / 2 - 2, -h / 2 - 2, 10, 10);
  g.fillStyle(VIOLET).fillRect(-w / 2 - 1, -h / 2 - 1, 8, 8);
  g.fillStyle(INK).fillRect(w / 2 - 8, -h / 2 - 2, 10, 10);
  g.fillStyle(MAUVE).fillRect(w / 2 - 7, -h / 2 - 1, 8, 8);
  const icon = scene.add.image(0, -h / 2 + 14, iconKey(id, side)).setScale(2);
  const cost = centred(scene, -w / 2 + 3, -h / 2 + 3, String(def.cost), CREAM);
  const init = centred(scene, w / 2 - 3, -h / 2 + 3, String(def.initiative), CREAM);
  const name = scene.add.bitmapText(0, -h / 2 + 26, 'pixel', def.name.toUpperCase(), undefined, 1).setOrigin(0.5, 0).setTint(INK).setMaxWidth(w - 4);
  const lines = name.getTextBounds().local.height > 8 ? 1 : 0;
  const body = keywords
    ? (def.keywords.length ? def.keywords.join(' ') : 'no keywords')
    : def.text;
  const text = scene.add.bitmapText(-w / 2 + 4, -h / 2 + 36 + lines * 7, 'pixel', body.toUpperCase()).setTint(keywords ? VIOLET : BLOOD).setMaxWidth(w - 8);
  return scene.add.container(0, 0, [g, icon, cost, init, name, text]).setSize(w, h);
}
