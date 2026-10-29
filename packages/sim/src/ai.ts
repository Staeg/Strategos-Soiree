import { CELLS, CORE, distance } from './board.ts';
import { CARDS_KEPT, CARD_OWNER, cardDef, type CardId } from './content.ts';
import { alive, atBase, maxHp, stats } from './hero.ts';
import { randInt, seedRng, type RngState } from './rng.ts';
import type { Command, Hero, Play, Side, Stance, Target } from './types.ts';
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

/** Plays at random and keeps its strategy as it stands: the default behaviours do all the work. */
class Novice implements Agent {
  readonly name: string = 'Novice';
  protected rng: RngState;
  constructor(seed: number) { this.rng = seedRng(seed, 101); }

  act(v: MatchView, side: Side): Command[] {
    if (v.phase !== 'plan' || v.sides[side].committed) return [];
    if (v.stage === 'strategy') {
      const orders = this.strategy(v, side);
      if (orders.length) return orders;
    }
    const options = this.options(v, side).filter((o) => o.value > this.threshold());
    if (options.length === 0) return [{ type: 'commit', side, discard: this.discards(v, side) }];
    const o = this.choose(options);
    return [{ type: 'play', side, handIndex: o.handIndex, source: o.source, target: o.target }];
  }

  /** Strategy orders still to give: none once the draft reads as wanted, so the agent moves on to its cards. */
  protected strategy(_v: MatchView, _side: Side): Command[] { return []; }
  protected threshold(): number { return randInt(this.rng, 3) === 0 ? Infinity : 0; }
  protected choose(options: Option[]): Option { return options[randInt(this.rng, options.length)]!; }
  protected discards(_v: MatchView, _side: Side): number[] { return []; }

  /** Every affordable card, with one sensible source and target each, and a rough worth. */
  protected options(v: MatchView, side: Side): Option[] {
    const me = v.sides[side];
    const out: Option[] = [];
    me.hand.forEach((id, handIndex) => {
      const def = cardDef(id);
      if (def.cost > me.mana || !def.stages.includes(v.stage)) return;
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
      case 'ally': {
        const others = v.heroes.filter((h) => h.side === side && known(h) && h !== source);
        const t = others.length ? others[randInt(this.rng, others.length)]! : source;
        return { target: { kind: 'hero', uid: t.uid }, value: 1 };
      }
      case 'cell': {
        const reach = Math.max(...def.effect.map((op) => (op.op === 'move' ? op.reach : 0)));
        const cells = CELLS.flatMap((_, c) => (c !== source.cell && distance(source.cell, c) <= reach ? [c] : []));
        return cells.length ? { target: { kind: 'cell', cell: cells[randInt(this.rng, cells.length)]! }, value: 1 } : null;
      }
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
 * Reads the board: moves heroes in on weakened enemies and low allies out of
 * reach, engages where its heroes outweigh the enemy on the two cells an
 * engage pulls in, follows up with joins and tactics, saves heroes that are
 * low and exposed, turns aggressive when healthy, and now and then sends a
 * fresh jungler to invade.
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

  protected override strategy(v: MatchView, side: Side): Command[] {
    const plan = v.sides[side].strategy;
    const out: Command[] = [];
    v.heroes.filter((h) => h.side === side).forEach((h, i) => {
      const want: Stance = ratio(h) > 0.7 ? 'aggressive' : ratio(h) < 0.5 ? 'passive' : h.stance;
      if (alive(h) && plan.stances[i] !== want) out.push({ type: 'stance', side, uid: h.uid, stance: want });
    });
    const camp = this.invasion(v, side);
    if (camp !== plan.camp) out.push({ type: 'camp', side, camp });
    return out;
  }

  /** Every other fight phase, a fresh jungler goes for the nearest rival camp believed standing. */
  private invasion(v: MatchView, side: Side): number {
    const j = v.heroes.find((h) => h.side === side && h.role === 'jungle');
    if (!j || !alive(j) || ratio(j) < 0.8 || v.fightPhase % 2 === 0) return -1;
    let best = -1;
    v.camps.forEach((c, i) => {
      if (c.owner === side || v.sides[side].campIntel[i]! >= 0) return;
      if (best < 0 || distance(j.cell, c.cell) < distance(j.cell, v.camps[best]!.cell)) best = i;
    });
    return best;
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
        case 'move':
          for (const c of CELLS.keys()) {
            if (c !== source.cell && distance(source.cell, c) <= op.reach) offer({ kind: 'cell', cell: c }, this.moveWorth(v, side, source, c));
          }
          break;
        case 'beacon':
          for (const a of v.heroes) {
            if (a.side === side && a !== source && known(a) && ratio(a) < 0.35 && near(99).some((e) => distance(e.cell, a.cell) <= 1)) offer({ kind: 'hero', uid: a.uid }, 4);
          }
          break;
      }
    }
    return best;
  }

  /**
   * What moving `h` onto `cell` is worth: a low hero gets out of reach on
   * the way home; a healthy one closes on a weakened enemy it and its
   * friends there outweigh, never under a rival structure.
   */
  private moveWorth(v: MatchView, side: Side, h: Hero, cell: number): number {
    const enemies = v.heroes.filter((e) => e.side !== side && known(e));
    const gap = (c: number) => Math.min(9, ...enemies.map((e) => distance(e.cell, c)));
    if (ratio(h) < 0.35) {
      if (gap(h.cell) > 1) return 0;
      return gap(cell) > 1 && distance(cell, CORE[side]) < distance(h.cell, CORE[side]) ? 4 : 0;
    }
    if (ratio(h) < 0.6 || v.structures.some((st) => st.side !== side && st.hp > 0 && st.cell === cell)) return 0;
    const strength = (hs: Hero[]) => hs.reduce((t, x) => t + x.hp * stats(x).dmg, 0);
    let worth = 0;
    for (const e of enemies) {
      if (distance(e.cell, cell) > 1 || distance(e.cell, h.cell) <= 1) continue;
      const ours = [h, ...v.heroes.filter((a) => a.side === side && a !== h && known(a) && distance(a.cell, e.cell) <= 1)];
      const edge = strength(ours) / Math.max(1, strength(enemies.filter((x) => distance(x.cell, e.cell) <= 1)));
      if (edge > 1.5) worth = Math.max(worth, 2 + (1 - ratio(e)) * 3 + (cell === e.cell ? 0 : 0.5));
    }
    return worth;
  }
}
