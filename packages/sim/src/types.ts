import type { RngState } from './rng.ts';
import type { CardId, HeroId } from './content.ts';

export type Side = 0 | 1;
export type Phase = 'draft' | 'battle' | 'council' | 'over';
export type Stance = 'aggressive' | 'balanced' | 'defensive';

/**
 * Lane geometry is one-dimensional: each unit measures `dist` from its own
 * nexus (0) towards the enemy's (LANE). Two opposing units are
 * `LANE - a.dist - b.dist` apart, so neither side is special-cased.
 */
export interface Unit {
  id: number;
  side: Side;
  slot: number;
  hero: HeroId;
  hp: number;
  dist: number;
  cooldown: number;
  /** Tick at which a fallen unit returns; -1 while alive. */
  respawnAt: number;
}

export interface SideState {
  picks: HeroId[];
  stance: Stance;
  nexus: number;
  mana: number;
  hand: CardId[];
  deck: CardId[];
  discard: CardId[];
  /** Cards committed this council, hidden from the opponent until both are ready. */
  queued: CardId[];
  ready: boolean;
  /** Percentage bonuses that last for the next battle only. */
  buffs: { dmg: number; speed: number };
}

export interface MatchState {
  seed: number;
  tick: number;
  phase: Phase;
  /** 1-based index of the current (or just-finished) battle. */
  round: number;
  battleTicksLeft: number;
  draftTurn: number;
  pool: HeroId[];
  sides: [SideState, SideState];
  units: Unit[];
  /** Separate streams so card luck never depends on how a fight went, and vice versa. */
  rng: { combat: RngState; cards: RngState };
  winner: Side | 'draw' | null;
  /** What happened during the last step, for renderers and logs. Rebuilt every step. */
  events: GameEvent[];
}

export type Command =
  | { type: 'pick'; side: Side; hero: HeroId }
  | { type: 'stance'; side: Side; stance: Stance }
  | { type: 'play'; side: Side; handIndex: number }
  | { type: 'endTurn'; side: Side };

export type GameEvent =
  | { type: 'phase'; phase: Phase; round: number }
  | { type: 'pick'; side: Side; hero: HeroId }
  | { type: 'hit'; from: number; to: number; amount: number; crit: boolean }
  | { type: 'siege'; from: number; side: Side; amount: number; crit: boolean }
  | { type: 'heal'; from: number; to: number; amount: number }
  | { type: 'death'; unit: number }
  | { type: 'respawn'; unit: number }
  | { type: 'card'; side: Side; card: CardId; success: boolean };
