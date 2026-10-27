import { CARDS, TICK_HZ, hero, type CardId, type HeroId } from './content.ts';
import { randInt, seedRng, type RngState } from './rng.ts';
import { advance, draftingSide } from './sim.ts';
import type { Command, MatchState, Side, Stance } from './types.ts';

/**
 * An agent sees the match and returns this tick's commands, exactly like a
 * player's input layer. It owns its own RNG so that thinking never perturbs
 * the match's random streams; the sim cannot tell an AI from a human.
 */
export interface Agent {
  readonly name: string;
  act(state: MatchState, side: Side): Command[];
}

export type Difficulty = 'novice' | 'tactician' | 'strategos';
export const DIFFICULTIES: Difficulty[] = ['novice', 'tactician', 'strategos'];

export function createAgent(difficulty: Difficulty, seed: number): Agent {
  switch (difficulty) {
    case 'novice': return new Novice(seed);
    case 'tactician': return new Tactician(seed);
    case 'strategos': return new Strategos(seed);
  }
}

const STANCE_LIST: Stance[] = ['aggressive', 'balanced', 'defensive'];
const THINK_EVERY = TICK_HZ * 2;

/** Rough power score used for drafting; deliberately naive. */
const heroValue = (id: HeroId): number => {
  const h = hero(id);
  const dps = (h.dmg * (1000 + h.crit) * TICK_HZ) / (1000 * h.cooldown);
  return dps * 10 + h.hp * 0.3 + h.range * 0.004 + (h.heal ?? 0) * 6;
};

const CARD_VALUE: Record<CardId, number> = { volley: 6, rally: 5, warcry: 4, fortify: 4, haste: 2, gambit: 3 };

class Novice implements Agent {
  readonly name: string = 'Novice';
  protected rng: RngState;
  constructor(seed: number) { this.rng = seedRng(seed, 101); }

  act(s: MatchState, side: Side): Command[] {
    const me = s.sides[side];
    if (draftingSide(s) === side) return [{ type: 'pick', side, hero: s.pool[randInt(this.rng, s.pool.length)]! }];
    if (s.phase === 'battle' && s.tick % THINK_EVERY === 0 && randInt(this.rng, 4) === 0) {
      return [{ type: 'stance', side, stance: STANCE_LIST[randInt(this.rng, 3)]! }];
    }
    if (s.phase === 'council' && !me.ready) {
      const playable = me.hand.findIndex((c) => CARDS[c].cost <= me.mana);
      if (playable >= 0 && randInt(this.rng, 3) > 0) return [{ type: 'play', side, handIndex: playable }];
      return [{ type: 'endTurn', side }];
    }
    return [];
  }
}

class Tactician extends Novice {
  override readonly name: string = 'Tactician';

  override act(s: MatchState, side: Side): Command[] {
    const me = s.sides[side];
    if (draftingSide(s) === side) {
      const best = [...s.pool].sort((a, b) => heroValue(b) - heroValue(a))[0]!;
      return [{ type: 'pick', side, hero: best }];
    }
    if (s.phase === 'battle' && s.tick % THINK_EVERY === 0) {
      const stance = this.chooseStance(s, side);
      return stance === me.stance ? [] : [{ type: 'stance', side, stance }];
    }
    if (s.phase === 'council' && !me.ready) {
      let pick = -1;
      me.hand.forEach((c, i) => {
        if (CARDS[c].cost > me.mana) return;
        if (pick < 0 || CARD_VALUE[c] > CARD_VALUE[me.hand[pick]!]) pick = i;
      });
      return [pick >= 0 ? { type: 'play', side, handIndex: pick } : { type: 'endTurn', side }];
    }
    return [];
  }

  protected chooseStance(s: MatchState, side: Side): Stance {
    const strength = (sd: Side) =>
      s.units.filter((u) => u.side === sd && u.respawnAt < 0).reduce((t, u) => t + u.hp, 0);
    const edge = strength(side) - strength(side === 0 ? 1 : 0);
    if (edge > 60) return 'aggressive';
    if (edge < -60) return 'defensive';
    return 'balanced';
  }
}

/**
 * Plans its stance by rolling the real simulation forward. The rollout
 * reseeds the combat stream from the agent's own RNG first: it imagines
 * plausible futures without peeking at the actual upcoming rolls.
 */
class Strategos extends Tactician {
  override readonly name = 'Strategos';
  private static readonly HORIZON = TICK_HZ * 6;
  private static readonly SAMPLES = 2;

  protected override chooseStance(s: MatchState, side: Side): Stance {
    let best: Stance = s.sides[side].stance;
    let bestScore = -Infinity;
    for (const stance of STANCE_LIST) {
      let score = 0;
      for (let k = 0; k < Strategos.SAMPLES; k++) score += this.rollout(s, side, stance);
      if (score > bestScore) [best, bestScore] = [stance, score];
    }
    return best;
  }

  private rollout(from: MatchState, side: Side, stance: Stance): number {
    const s = structuredClone(from);
    s.rng.combat = seedRng(randInt(this.rng, 0x7fffffff), 7);
    advance(s, [{ type: 'stance', side, stance }]);
    for (let t = 0; t < Strategos.HORIZON && s.phase === 'battle'; t++) advance(s, []);
    const other: Side = side === 0 ? 1 : 0;
    const hp = (sd: Side) =>
      s.units.filter((u) => u.side === sd && u.respawnAt < 0).reduce((t, u) => t + u.hp, 0);
    if (s.winner === side) return 1e6;
    if (s.winner === other) return -1e6;
    return (s.sides[side].nexus - s.sides[other].nexus) * 3 + hp(side) - hp(other);
  }
}
