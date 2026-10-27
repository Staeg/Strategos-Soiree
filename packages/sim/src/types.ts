import type { RngState } from './rng.ts';
import type { StructureKind } from './board.ts';
import type { CardId, HeroId } from './content.ts';

export type Side = 0 | 1;
/** 0 top, 1 mid, 2 bot. */
export type LaneId = 0 | 1 | 2;
export type Role = 'top' | 'jungle' | 'mid' | 'support' | 'carry';
export type Stance = 'passive' | 'aggressive';

/**
 * The match loops through four phases:
 *  map      real-time-ish; one step is one map tick (about a second).
 *  plan     both sides commit cards blind; steps idle until both are in.
 *  resolve  one step per initiative value that has cards on it.
 *  clash    one step per fight tick in which somebody acts; empty ticks are skipped.
 */
export type Phase = 'map' | 'plan' | 'resolve' | 'clash' | 'over';

export interface Stats {
  dmg: number;
  hp: number;
  res: number;
  spd: number;
}

/** Everything about a hero that only lasts for the current fight phase. */
export interface FightFx {
  /** Engagement id, or -1. */
  engagement: number;
  shield: number;
  /** Additive percent bonuses; `surgePct` only until fight tick `surgeUntil`. */
  dmgPct: number;
  surgePct: number;
  surgeUntil: number;
  res: number;
  spd: number;
  /** Uid this hero's basic attacks prefer, or -1. */
  focus: number;
  /** Engage cards with a higher initiative than this cannot target the hero. */
  evadeAfter: number;
  /** Percent of max HP healed once every engagement is over. */
  afterHeal: number;
  /** Fight tick of the hero's next turn, and how many turns it has had. */
  nextTurn: number;
  turns: number;
}

export interface Hero {
  uid: number;
  side: Side;
  role: Role;
  id: HeroId;
  cell: number;
  hp: number;
  /** In XP_UNIT fractions of a point, so shared XP divides exactly. */
  xp: number;
  stance: Stance;
  retreating: boolean;
  /** Roam destination until the next fight phase, or -1. */
  roam: number;
  /** Map tick the hero returns, or -1 while alive. */
  respawnAt: number;
  /** Map tick the map ability is next ready. */
  mapReadyAt: number;
  /** Fight-phase number from which the ultimate is ready. */
  ultReadyAt: number;
  /** Ascensions are one-time: set once reached. */
  ascended: boolean;
  fx: FightFx;
}

/** Minions travel as stacks: `n` minions of `side` at index `pos` of a lane path. */
export interface MinionStack {
  lane: LaneId;
  pos: number;
  side: Side;
  n: number;
}

export interface Structure {
  kind: StructureKind;
  side: Side;
  lane: LaneId | -1;
  cell: number;
  hp: number;
  maxHp: number;
  /** Takes half damage before this map tick (Hold the Line). */
  guardedUntil: number;
}

export interface Camp {
  cell: number;
  owner: Side;
  creeps: number;
  /** Map tick the camp refills, or -1 while it stands. */
  respawnAt: number;
}

/** Vision of every cell within `radius` of `cell`, until map tick `until`. */
export interface Ward {
  side: Side;
  cell: number;
  radius: number;
  until: number;
}

export type Target =
  | { kind: 'none' }
  | { kind: 'cell'; cell: number }
  | { kind: 'hero'; uid: number };

/** A committed card: who it comes from and what it is aimed at. */
export interface Play {
  side: Side;
  card: CardId;
  source: number;
  target: Target;
}

export interface Engagement {
  id: number;
  cell: number;
  members: number[];
  /** Fight tick at which it ends. */
  length: number;
  over: boolean;
}

export interface SideState {
  mana: number;
  hand: CardId[];
  deck: CardId[];
  discard: CardId[];
  plays: Play[];
  committed: boolean;
  /** Orders left this map phase. */
  orders: { stance: number; roam: number };
  /** Per camp: map tick this side last saw it empty, or -1 if believed up. */
  campIntel: number[];
}

export interface MatchState {
  seed: number;
  /** Steps taken, whatever the phase. */
  seq: number;
  mapTick: number;
  /** Fight phases started so far; ultimate cooldowns count these. */
  fightPhase: number;
  fightTick: number;
  phase: Phase;
  heroes: Hero[];
  minions: MinionStack[];
  structures: Structure[];
  camps: Camp[];
  wards: Ward[];
  engagements: Engagement[];
  /** Initiatives still to resolve this fight phase, ascending. */
  pending: number[];
  sides: [SideState, SideState];
  /** Separate streams so card shuffles never depend on how a fight went, and vice versa. */
  rng: { map: RngState; fight: RngState; cards: RngState };
  winner: Side | 'draw' | null;
  /** What happened during the last step, for renderers and logs. Rebuilt every step. */
  events: GameEvent[];
}

export type Command =
  | { type: 'stance'; side: Side; uid: number }
  | { type: 'roam'; side: Side; uid: number; cell: number }
  /** Command-type ultimates, aimed on the map. */
  | { type: 'ult'; side: Side; uid: number; cell: number }
  | { type: 'play'; side: Side; handIndex: number; source: number; target: Target }
  | { type: 'unplay'; side: Side; index: number }
  /** `discard` lists hand indices to drop first if more than CARDS_KEPT stay unplayed. */
  | { type: 'commit'; side: Side; discard: number[] };

export type Fizzle = 'source' | 'target' | 'reach' | 'evaded' | 'engaged' | 'none';

export type GameEvent =
  | { type: 'phase'; phase: Phase }
  | { type: 'draw'; side: Side }
  | { type: 'order'; side: Side; uid: number; order: 'stance' | 'roam' | 'ult' }
  | { type: 'minions'; cell: number; side: Side; died: number }
  | { type: 'hurt'; uid: number; amount: number; by: 'minion' | 'tower' | 'creep' | 'card' | 'hero' }
  | { type: 'heal'; uid: number; amount: number }
  | { type: 'structure'; index: number; amount: number }
  | { type: 'fall'; index: number }
  | { type: 'death'; uid: number }
  | { type: 'respawn'; uid: number }
  | { type: 'ability'; uid: number }
  | { type: 'ascend'; uid: number }
  | { type: 'card'; play: Play; fizzle: Fizzle | null }
  | { type: 'engage'; id: number; cell: number; members: number[] }
  | { type: 'act'; uid: number; kind: 'attack' | 'ability' | 'ult'; hits: Hit[] }
  | { type: 'disengage'; id: number };

export interface Hit {
  uid: number;
  /** Positive damage, negative healing; shields are reported separately. */
  amount: number;
  shield: number;
}
