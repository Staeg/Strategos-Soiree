import { distance } from './board.ts';
import { CARDS_KEPT, CARD_OWNER, FIGHT_EVERY, cardDef, type CardId } from './content.ts';
import { alive, atBase, maxHp, stats } from './hero.ts';
import { randInt, seedRng, type RngState } from './rng.ts';
import type { Command, Hero, Play, Side, Target } from './types.ts';
import type { MatchView } from './vision.ts';

/**
 * An agent sees only its side's view of the match (fogged, rival hand and
 * plans hidden) and returns this step's commands, exactly like a player's
 * input layer. It owns its own RNG so thinking never perturbs the match;
 * the sim cannot tell an AI from a human.
 */
export interface Agent {
  readonly name: string;
  act(view: MatchView, side: Side): Command[];
}

export type Difficulty = 'novice' | 'tactician';
export const DIFFICULTIES: Difficulty[] = ['novice', 'tactician'];

export function createAgent(difficulty: Difficulty, seed: number): Agent {
  return difficulty === 'novice' ? new Novice(seed) : new Tactician(seed);
}

interface Option {
  handIndex: number;
  source: number;
  target: Target;
  value: number;
}

const NONE: Target = { kind: 'none' };
const known = (h: Hero) => alive(h) && h.cell >= 0;
const ratio = (h: Hero) => h.hp / maxHp(h);

/** Plays at random and gives no orders: the default behaviours do all the work. */
class Novice implements Agent {
  readonly name: string = 'Novice';
  protected rng: RngState;
  constructor(seed: number) { this.rng = seedRng(seed, 101); }

  act(v: MatchView, side: Side): Command[] {
    if (v.phase === 'map') return this.orders(v, side);
    if (v.phase !== 'plan' || v.sides[side].committed) return [];
    const options = this.options(v, side).filter((o) => o.value > this.threshold());
    if (options.length === 0) return [{ type: 'commit', side, discard: this.discards(v, side) }];
    const o = this.choose(options);
    return [{ type: 'play', side, handIndex: o.handIndex, source: o.source, target: o.target }];
  }

  protected orders(_v: MatchView, _side: Side): Command[] { return []; }
  protected threshold(): number { return randInt(this.rng, 3) === 0 ? Infinity : 0; }
  protected choose(options: Option[]): Option { return options[randInt(this.rng, options.length)]!; }
  protected discards(_v: MatchView, _side: Side): number[] { return []; }

  /** Every affordable card, with one sensible source and target each, and a rough worth. */
  protected options(v: MatchView, side: Side): Option[] {
    const me = v.sides[side];
    const out: Option[] = [];
    me.hand.forEach((id, handIndex) => {
      const def = cardDef(id);
      if (def.cost > me.mana) return;
      for (const source of this.sources(v, side, id)) {
        const best = this.aim(v, side, id, source);
        if (best) out.push({ handIndex, source: source.uid, ...best });
      }
    });
    return out;
  }

  protected sources(v: MatchView, side: Side, id: CardId): Hero[] {
    const owner = CARD_OWNER[id];
    return v.heroes.filter((h) => h.side === side && alive(h) && (owner === undefined || (h.id === owner && !atBase(h))));
  }

  protected aim(v: MatchView, side: Side, id: CardId, source: Hero): { target: Target; value: number } | null {
    const def = cardDef(id);
    const enemies = v.heroes.filter((h) => h.side !== side && known(h));
    switch (def.aim) {
      case 'enemy': {
        if (!enemies.length) return null;
        return { target: { kind: 'hero', uid: enemies[randInt(this.rng, enemies.length)]!.uid }, value: 1 };
      }
      case 'ally': return { target: { kind: 'hero', uid: source.uid }, value: 1 };
      case 'tower': {
        const st = v.structures.find((x) => x.side === side && x.hp > 0 && x.kind !== 'core');
        return st ? { target: { kind: 'cell', cell: st.cell }, value: 1 } : null;
      }
      case 'siege': {
        if (enemies.length) return { target: { kind: 'hero', uid: enemies[randInt(this.rng, enemies.length)]!.uid }, value: 1 };
        const st = v.structures.find((x) => x.side !== side && x.hp > 0 && v.visible[x.cell]);
        return st ? { target: { kind: 'cell', cell: st.cell }, value: 1 } : null;
      }
      case 'none': return { target: NONE, value: 1 };
    }
  }
}

/**
 * Reads the board: engages where its heroes outweigh the enemy on the two
 * cells an engage pulls in, follows up with joins and tactics, saves heroes
 * that are low and exposed, and sends its jungler to gank before each fight
 * phase.
 */
class Tactician extends Novice {
  override readonly name: string = 'Tactician';

  protected override threshold(): number { return 1.5; }
  protected override choose(options: Option[]): Option {
    return options.reduce((a, b) => (b.value > a.value ? b : a));
  }

  protected override discards(v: MatchView, side: Side): number[] {
    const hand = v.sides[side].hand;
    if (hand.length <= CARDS_KEPT) return [];
    const worth = (id: CardId) => (cardDef(id).keywords.includes('Engage') ? 3 : cardDef(id).keywords.includes('Join') ? 2 : 1);
    return hand.map((id, i) => [i, worth(id)] as const).sort((a, b) => a[1] - b[1]).slice(0, hand.length - CARDS_KEPT).map(([i]) => i);
  }

  protected override orders(v: MatchView, side: Side): Command[] {
    const me = v.sides[side];
    const mine = v.heroes.filter((h) => h.side === side && alive(h));
    const phaseTick = v.mapTick % FIGHT_EVERY;
    if (me.orders.roam > 0 && phaseTick === FIGHT_EVERY - 12) {
      const jungler = mine.find((h) => h.role === 'jungle' && !h.retreating);
      const prey = v.heroes.filter((h) => h.side !== side && known(h) && mine.some((a) => a.role !== 'jungle' && distance(a.cell, h.cell) <= 1));
      prey.sort((a, b) => ratio(a) - ratio(b));
      if (jungler && prey[0] && distance(jungler.cell, prey[0].cell) <= 8) return [{ type: 'roam', side, uid: jungler.uid, cell: prey[0].cell }];
    }
    if (me.orders.stance > 0) {
      const tired = mine.find((h) => h.stance === 'aggressive' && ratio(h) < 0.5);
      if (tired) return [{ type: 'stance', side, uid: tired.uid }];
      if (phaseTick === 5) {
        const fresh = mine.find((h) => h.stance === 'passive' && ratio(h) > 0.8);
        if (fresh) return [{ type: 'stance', side, uid: fresh.uid }];
      }
    }
    return [];
  }

  /** Heroes an engage from `source` onto `target` would pull in, by side, as far as this side can see. */
  private pulled(v: MatchView, source: Hero, target: Hero): [Hero[], Hero[]] {
    const on = (h: Hero) => known(h) && (h.cell === source.cell || h.cell === target.cell);
    const ours = v.heroes.filter((h) => h.side === source.side && on(h));
    return [ours, v.heroes.filter((h) => h.side !== source.side && on(h))];
  }

  /** Planned engages: who goes in where, and at what initiative. */
  private planned(v: MatchView, side: Side): { cell: number; initiative: number; members: Set<number> }[] {
    return v.sides[side].plays.flatMap((p: Play) => {
      if (!cardDef(p.card).keywords.includes('Engage') || p.target.kind !== 'hero') return [];
      const source = v.heroes[p.source]!, target = v.heroes[p.target.uid]!;
      if (!known(target)) return [];
      const [ours] = this.pulled(v, source, target);
      return [{ cell: target.cell, initiative: cardDef(p.card).initiative, members: new Set(ours.map((h) => h.uid)) }];
    });
  }

  protected override aim(v: MatchView, side: Side, id: CardId, source: Hero): { target: Target; value: number } | null {
    const def = cardDef(id);
    const plans = this.planned(v, side);
    const inFight = plans.some((p) => p.members.has(source.uid));
    const enemies = v.heroes.filter((h) => h.side !== side && known(h));
    const strength = (hs: Hero[]) => hs.reduce((t, h) => t + h.hp * stats(h).dmg, 0);
    let best: { target: Target; value: number } | null = null;
    const offer = (target: Target, value: number) => { if (!best || value > best.value) best = { target, value }; };

    /** Fights this source will be in at or after the card's initiative, so waiting effects land. */
    const ahead = plans.some((p) => p.members.has(source.uid) && p.initiative >= def.initiative);
    const near = (r: number) => enemies.filter((e) => distance(source.cell, e.cell) <= r);
    for (const op of def.effect) {
      switch (op.op) {
        case 'engage':
          for (const e of enemies) {
            if (plans.some((p) => p.cell === e.cell)) continue;
            if (op.below !== undefined && e.hp * 100 >= maxHp(e) * op.below) continue;
            if (distance(source.cell, e.cell) - (e.stance === 'aggressive' ? 1 : 0) > op.reach) continue;
            const [ours, theirs] = op.duel ? [[source], [e]] : this.pulled(v, source, e);
            const edge = strength(ours) / Math.max(1, strength(theirs));
            if (edge > 1.3) offer({ kind: 'hero', uid: e.uid }, 4 + Math.min(4, edge) + (1 - ratio(e)) * 3);
          }
          break;
        case 'join':
          for (const p of plans) {
            if (!p.members.has(source.uid) && p.initiative >= def.initiative && distance(source.cell, p.cell) <= op.reach - (source.stance === 'aggressive' ? 1 : 0)) offer(NONE, 5);
          }
          break;
        case 'empower': case 'quick': case 'firstHit': case 'opening': case 'procession':
          if (ahead) offer(NONE, 3);
          break;
        case 'fade':
          if (ahead && ratio(source) < 0.6) offer(NONE, 3);
          break;
        case 'focus': case 'slow': case 'expose': {
          const plan = plans.find((p) => p.members.has(source.uid) && p.initiative >= def.initiative);
          if (!plan) break;
          if (def.aim === 'none') { offer(NONE, 3); break; }
          for (const e of enemies) if (distance(e.cell, plan.cell) <= 1) offer({ kind: 'hero', uid: e.uid }, 3 + (1 - ratio(e)));
          break;
        }
        case 'shield':
          for (const p of plans) for (const uid of p.members) offer({ kind: 'hero', uid }, 3 + (1 - ratio(v.heroes[uid]!)) * 2);
          break;
        case 'strike': case 'shell':
          for (const e of near(op.reach)) offer({ kind: 'hero', uid: e.uid }, e.hp <= op.amount ? 7 : 2);
          if (op.op === 'shell') {
            for (const st of v.structures) if (st.side !== side && st.hp > 0 && v.visible[st.cell] && distance(source.cell, st.cell) <= op.reach) offer({ kind: 'cell', cell: st.cell }, st.hp <= op.amount ? 8 : 3);
          }
          break;
        case 'evade':
          if (op.reach === undefined) {
            if (ratio(source) < 0.45 && near(2).length) offer(NONE, 4);
          } else {
            for (const a of v.heroes) {
              if (a.side === side && alive(a) && distance(a.cell, source.cell) <= op.reach && ratio(a) < 0.45) offer({ kind: 'hero', uid: a.uid }, 4);
            }
          }
          break;
        case 'heal':
          offer(NONE, ratio(source) < 0.6 ? 2.5 : 0);
          break;
        case 'guardTower': {
          const st = v.structures.find((x) => x.side === side && x.hp > 0 && x.hp < x.maxHp / 2);
          if (st) offer({ kind: 'cell', cell: st.cell }, 2);
          break;
        }
        case 'rewind':
          if (inFight || ratio(source) < 0.5) offer(NONE, 3);
          break;
        case 'unwrite':
          for (const e of near(op.reach)) offer({ kind: 'hero', uid: e.uid }, 2);
          break;
        case 'charge': case 'rally': case 'clear': case 'cadence': case 'nightfall': case 'cancel': case 'squeeze':
          offer(NONE, 2);
          break;
        case 'shadowStep':
          break;
      }
    }
    return best;
  }
}
