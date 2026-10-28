import Phaser from 'phaser';
import { cardDef, heroDef, type GameEvent, type MatchView, type Side } from '@soiree/sim';
import { CREAM, DUSK, GOLD, INK, MAUVE, TEAM } from '../art/palette.ts';
import { clip, LINE_H, text, wrap } from '../ui.ts';

const KEEP = 2000;
const X = 4, Y = 164, WIDTH = 300, HEIGHT = 178;
const COLS = Math.floor((WIDTH - 10) / 4);
const ROWS = Math.floor((HEIGHT - 16) / LINE_H);

/**
 * A raw record of every event this side was shown, newest at the bottom: a
 * debugging aid, folded away behind a button in the corner by default.
 */
export class DebugLog {
  private lines: { text: string; tint: number }[] = [];
  private open = false;
  /** Lines scrolled up from the bottom. */
  private scroll = 0;
  private dirty = true;
  private readonly box: Phaser.GameObjects.Container;
  private readonly body: Phaser.GameObjects.BitmapText[] = [];
  private readonly title: Phaser.GameObjects.BitmapText;

  constructor(private readonly scene: Phaser.Scene, private readonly me: Side) {
    const g = scene.add.graphics()
      .fillStyle(INK, 0.94).fillRect(0, 0, WIDTH, HEIGHT)
      .lineStyle(1, DUSK).strokeRect(0.5, 0.5, WIDTH - 1, HEIGHT - 1);
    this.title = text(scene, 5, 4, '', GOLD);
    for (let i = 0; i < ROWS; i++) this.body.push(text(scene, 5, 14 + i * LINE_H, '', MAUVE));
    this.box = scene.add.container(X, Y, [g, this.title, ...this.body]).setDepth(2500).setVisible(false);
    scene.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      if (!this.open || !new Phaser.Geom.Rectangle(X, Y, WIDTH, HEIGHT).contains(p.x, p.y)) return;
      this.scroll = Phaser.Math.Clamp(this.scroll - Math.sign(dy) * 3, 0, Math.max(0, this.wrapped().length - ROWS));
      this.dirty = true;
    });
  }

  toggle(): void {
    this.open = !this.open;
    this.scroll = 0;
    this.dirty = true;
  }

  get isOpen(): boolean { return this.open; }

  record(v: MatchView, events: GameEvent[]): void {
    for (const e of events) {
      const line = describe(v, e, this.me);
      if (line) this.lines.push({ text: `${v.mapTick}${v.phase === 'clash' ? `.${v.fightTick}` : ''} ${line}`, tint: tintOf(e) });
    }
    if (this.lines.length > KEEP) this.lines.splice(0, this.lines.length - KEEP);
    if (events.length) this.dirty = true;
  }

  private wrapped(): { text: string; tint: number }[] {
    return this.lines.flatMap((l) => wrap(l.text, COLS).map((t, i) => ({ text: i ? `  ${t}` : t, tint: l.tint })));
  }

  draw(): void {
    this.box.setVisible(this.open);
    if (!this.open || !this.dirty) return;
    this.dirty = false;
    const all = this.wrapped();
    const end = all.length - this.scroll;
    const shown = all.slice(Math.max(0, end - ROWS), end);
    this.title.setText(clip([`LOG  ${this.lines.length} EVENTS${this.scroll ? `  (SCROLLED ${this.scroll})` : '  WHEEL TO SCROLL'}`], 1, COLS)[0]!);
    this.body.forEach((t, i) => {
      const l = shown[i];
      t.setText(l ? l.text.toUpperCase() : '').setTint(l?.tint ?? MAUVE);
    });
  }
}

function tintOf(e: GameEvent): number {
  const side = 'side' in e ? e.side : e.type === 'card' ? e.play.side : null;
  if (side !== null && side !== undefined) return TEAM[side].light;
  return e.type === 'phase' ? GOLD : e.type === 'death' || e.type === 'fall' ? CREAM : MAUVE;
}

function describe(v: MatchView, e: GameEvent, me: Side): string {
  const hero = (uid: number) => {
    const h = v.heroes[uid];
    return h ? `${h.side === me ? '' : 'rival '}${heroDef(h.id).name}` : `#${uid}`;
  };
  const side = (s: Side) => (s === me ? 'you' : 'rival');
  switch (e.type) {
    case 'phase': return `-- ${e.phase} --`;
    case 'draw': return `${side(e.side)} drew a card`;
    case 'order': return `${side(e.side)} order ${e.order}: ${hero(e.uid)}`;
    case 'minions': return `${e.died} ${e.side === me ? 'of your' : 'rival'} minion${e.died === 1 ? '' : 's'} died at cell ${e.cell}`;
    case 'hurt': return `${hero(e.uid)} takes ${e.amount} from ${e.by}`;
    case 'heal': return `${hero(e.uid)} heals ${e.amount}`;
    case 'structure': {
      const st = v.structures[e.index]!;
      return `${side(st.side)} ${st.kind} at cell ${st.cell} takes ${e.amount}`;
    }
    case 'fall': {
      const st = v.structures[e.index]!;
      return `${side(st.side)} ${st.kind} at cell ${st.cell} falls`;
    }
    case 'death': return `${hero(e.uid)} dies`;
    case 'respawn': return `${hero(e.uid)} is back`;
    case 'ability': return `${hero(e.uid)} uses ${heroDef(v.heroes[e.uid]!.id).map.name}`;
    case 'ascend': return `${hero(e.uid)} ascends`;
    case 'card': {
      const p = e.play;
      const target = p.target.kind === 'hero' ? ` on ${hero(p.target.uid)}` : p.target.kind === 'cell' ? ` on cell ${p.target.cell}` : '';
      return `${side(p.side)} ${cardDef(p.card).name} from ${hero(p.source)}${target}${e.fizzle ? `: fizzles (${e.fizzle})` : ''}`;
    }
    case 'engage': return `fight ${e.id} at cell ${e.cell}: ${e.members.map(hero).join(', ')}`;
    case 'act': {
      const hits = e.hits.map((h) => `${hero(h.uid)} ${h.amount >= 0 ? h.amount : `+${-h.amount}`}${h.shield ? ` (${h.shield} shield)` : ''}`).join(', ');
      return `${hero(e.uid)} ${e.kind}${hits ? `: ${hits}` : ''}`;
    }
    case 'squad': return `${side(e.side)} minions in fight ${e.id} hit ${e.hits.map((h) => (h.uid >= 0 ? `${hero(h.uid)} ${h.amount}` : `a minion ${h.amount}`)).join(', ')}`;
    case 'disengage': return `fight ${e.id} ends`;
  }
}
