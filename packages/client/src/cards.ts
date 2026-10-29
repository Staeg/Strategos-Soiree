import Phaser from 'phaser';
import { CARD_OWNER, cardDef, type CardId, type CardOp, type Side, type Stage } from '@soiree/sim';
import { FACE_H, FACE_W, heroKey } from './art/forge.ts';
import { SIGNATURES } from './art/heroes.ts';
import { BLOOD, CREAM, DUSK, GOLD, INK, MANA, MANA_DARK, MANA_LIGHT, MAUVE, NIGHT, PLUM, VIOLET } from './art/palette.ts';
import { cardRules } from './rules.ts';
import { centred, clip, glyphs, GLYPH_W, LINE_H, wrap } from './ui.ts';

const ICON: Record<CardOp['op'], string> = {
  engage: 'engage', join: 'join', shield: 'guard', guardTower: 'guard', evade: 'evade', fade: 'evade', shadowStep: 'evade',
  strike: 'strike', shell: 'strike', heal: 'heal', rewind: 'heal', nightfall: 'reveal',
  empower: 'tactic', focus: 'tactic', slow: 'tactic', expose: 'tactic', quick: 'tactic', firstHit: 'tactic', opening: 'tactic',
  procession: 'tactic', charge: 'tactic', cancel: 'tactic', unwrite: 'tactic', squeeze: 'tactic', rally: 'tactic', clear: 'tactic', cadence: 'tactic',
  move: 'move', beacon: 'move',
};
export const iconKey = (id: CardId, side: Side) => `icon-${ICON[cardDef(id).effect[0]!.op]}-${side}`;

/** A card's corner badge: its initiative if it can be played in the play stage, else the one stage it plays in. */
export const STAGE_MARK: Record<Stage, string> = { motion: 'M', play: 'P', strategy: 'S' };
const badge = (id: CardId): string => {
  const def = cardDef(id);
  return def.stages.includes('play') ? String(def.initiative) : def.stages.map((st) => STAGE_MARK[st]).join('');
};

export const CARD_W = 56;
export const CARD_H = 78;
/** The enlarged card: twice as wide unless told otherwise, as tall as its text needs. */
const BIG_W = 120;
const BIG_MIN_H = 156;

/**
 * A card face, centred on its container's origin: mana gem top-left,
 * initiative badge top-right (a stage letter for cards with no initiative),
 * emblem, name, text, the stages it plays in bottom-right, and on a hero's
 * own card that hero's face bottom-left. Every line is wrapped to the card and
 * clipped to it, so no text ever leaves the frame.
 *
 * `big` draws the enlargement for the inspect panel: `w` wide (BIG_W by
 * default), the header at twice the size, the whole short text, the
 * keywords, and with `rules` the full ruling from `cardRules` in place of
 * the reminder text; it grows to fit its words, never past `maxH`.
 */
export function cardFace(
  scene: Phaser.Scene, id: CardId, side: Side,
  opts: { big?: boolean; rules?: boolean; maxH?: number; w?: number } = {},
): Phaser.GameObjects.Container {
  const def = cardDef(id);
  const big = opts.big === true;
  const k = big ? 2 : 1;
  const w = big ? opts.w ?? BIG_W : CARD_W;
  const ultimate = def.keywords.includes('Ultimate');
  const inner = w - 8;
  const owner = CARD_OWNER[id];
  // The owner's badge: its face in a frame of its signature colour.
  const badgeW = (FACE_W + 2) * k, badgeH = (FACE_H + 2) * k;

  // Measure first: the big card is as tall as its words.
  const name = wrap(def.name, Math.floor((inner + 1) / (GLYPH_W * k)));
  const body = (opts.rules ? cardRules(id) : [def.text]).map(glyphs);
  const bodyLines = body.flatMap((para, i) => [...(i > 0 ? [''] : []), ...wrap(para, Math.floor((inner + 1) / GLYPH_W))]);
  const keyCols = Math.floor((inner + 1 - (owner ? badgeW : 0)) / GLYPH_W);
  const keywords = wrap([...def.stages, ...def.keywords].join(' * '), keyCols);
  const nameTop = 6 + 16 * k + 3;
  const bodyTop = nameTop + name.length * LINE_H * k + 2;
  const footer = big ? Math.max(keywords.length * LINE_H + 4, owner ? badgeH - 2 : 0) : owner ? badgeH - 4 : LINE_H;
  const h = big
    ? Math.min(opts.maxH ?? Infinity, Math.max(Math.min(BIG_MIN_H, opts.maxH ?? Infinity), bodyTop + bodyLines.length * LINE_H + footer + 4))
    : CARD_H;
  const top = -h / 2, left = -w / 2;

  const g = scene.add.graphics();
  g.fillStyle(INK).fillRect(left - 1, top - 1, w + 2, h + 2);
  g.fillStyle(ultimate ? VIOLET : GOLD).fillRect(left, top, w, h);
  g.fillStyle(CREAM).fillRect(left + 2, top + 2, w - 4, h - 4);
  g.fillStyle(DUSK).fillRect(left + 6, top + 5, w - 12, 16 * k + 2);
  g.fillStyle(PLUM).fillRect(left + 6, top + 5 + 16 * k + 1, w - 12, 1);
  // The mana gem, in mana blue; the initiative badge in the card's own trim.
  const gem = 8 * k;
  g.fillStyle(INK).fillRect(left - 2, top - 2, gem + 2, gem + 2);
  g.fillStyle(MANA).fillRect(left - 1, top - 1, gem, gem);
  g.fillStyle(MANA_LIGHT).fillRect(left - 1, top - 1, gem, k);
  g.fillStyle(MANA_DARK).fillRect(left - 1, top - 1 + gem - k, gem, k);
  g.fillStyle(INK).fillRect(left + w - gem, top - 2, gem + 2, gem + 2);
  g.fillStyle(MAUVE).fillRect(left + w - gem + 1, top - 1, gem, gem);
  if (footer && big) g.fillStyle(NIGHT, 0.12).fillRect(left + 3, top + h - footer - 2, w - 6, footer);

  const parts: Phaser.GameObjects.GameObject[] = [g];
  parts.push(scene.add.image(0, top + 5 + 8 * k + 1, iconKey(id, side)).setScale(2 * k));
  parts.push(centred(scene, left - 2 + gem / 2 + 1, top - 2 + gem / 2 + 1, String(def.cost), CREAM, k));
  parts.push(centred(scene, left + w - gem / 2 + 1, top - 2 + gem / 2 + 1, badge(id), CREAM, k));
  parts.push(scene.add.bitmapText(0, top + nameTop, 'pixel', name.join('\n').toUpperCase(), undefined, 1).setOrigin(0.5, 0).setTint(INK).setScale(k));

  const room = Math.floor((h - bodyTop - footer - 3) / LINE_H);
  const shown = clip(bodyLines, room, Math.floor((inner + 1) / GLYPH_W));
  parts.push(scene.add.bitmapText(left + 4, top + bodyTop, 'pixel', shown.join('\n').toUpperCase()).setTint(opts.rules ? PLUM : BLOOD));
  if (big) {
    parts.push(scene.add.bitmapText(left + 4 + (owner ? badgeW : 0), top + h - footer, 'pixel', keywords.join('\n').toUpperCase()).setTint(VIOLET));
  } else {
    // The stages it plays in, each in its place: M, P, S.
    const marks = (['motion', 'play', 'strategy'] as const).map((st) => (def.stages.includes(st) ? STAGE_MARK[st] : ' ')).join('');
    parts.push(scene.add.bitmapText(left + w - 4, top + h - LINE_H - 1, 'pixel', marks).setOrigin(1, 0).setTint(VIOLET));
  }
  if (owner) {
    const [bx, by] = [left - 2, top + h + 2 - badgeH];
    g.fillStyle(INK).fillRect(bx, by, badgeW, badgeH);
    g.fillStyle(SIGNATURES[owner][0]).fillRect(bx + 1, by + 1, badgeW - 2, badgeH - 2);
    g.fillStyle(DUSK).fillRect(bx + k, by + k, FACE_W * k, FACE_H * k);
    parts.push(scene.add.image(bx + k, by + k, heroKey(owner, side), 'face').setOrigin(0, 0).setScale(k));
  }
  return scene.add.container(0, 0, parts).setSize(w, h);
}
