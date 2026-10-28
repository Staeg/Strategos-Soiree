import {
  createAgent, createMatch, hashState, step, viewFor,
  type Agent, type Command, type Difficulty, type GameEvent, type HeroId, type MatchState, type MatchView, type Phase, type Side,
} from '@soiree/sim';

type Without<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** A command as the local player issues it; the session stamps the side. */
export type Intent = Without<Command, 'side'>;

/**
 * What a scene needs from "the match", wherever it actually runs. A scene
 * only ever sees its side's fogged view, never the full state: the local
 * session filters it here, and a future online session will receive exactly
 * the same views from a server.
 */
export interface Session {
  readonly side: Side;
  readonly view: MatchView;
  readonly prev: MatchView;
  /** 0..1 progress towards the next step, for smooth interpolation. */
  readonly alpha: number;
  speed: number;
  paused: boolean;
  submit(intent: Intent): void;
  update(deltaMs: number): GameEvent[];
}

/** Everything that, with the player's commands, decides a local match. */
export interface MatchSetup {
  seed: number;
  difficulty: Difficulty;
  side: Side;
  /** Each side's heroes; saves from before the lineup screen leave it out and get the seed's. */
  teams?: [HeroId[], HeroId[]];
}

/** The player's commands, by the step they went into; steps without any are left out. */
export type Journal = [seq: number, commands: Command[]][];

/** Milliseconds per step at speed 1. Planning steps only wait for commits. */
const PACE: Record<Phase, number> = { map: 1000, plan: 120, resolve: 900, clash: 220, over: 1000 };
/** Lets the AI "think" visibly before committing instead of answering instantly. */
const AI_PAUSE_STEPS = 6;

/**
 * The match in this tab, with the AI as the rival. The sim is deterministic
 * and the AI's pacing counts steps, not milliseconds, so the setup and the
 * journal of the player's commands replay a match exactly: that is the save
 * format, and the bug report.
 */
export class LocalSession implements Session {
  view: MatchView;
  prev: MatchView;
  speed = 1;
  paused = false;
  readonly side: Side;
  readonly journal: Journal = [];
  /** Called after each step that changes the phase, with the new one. */
  onPhase: ((phase: Phase) => void) | null = null;
  private state: MatchState;
  private readonly ai: Agent;
  private acc = 0;
  private pending: Command[] = [];
  private aiWait = AI_PAUSE_STEPS;

  /** `origin`: a snapshot to start from instead of the seed's first step; the journal then counts from there. */
  constructor(readonly setup: MatchSetup, readonly origin: MatchState | null = null) {
    this.side = setup.side;
    this.ai = createAgent(setup.difficulty, setup.seed ^ 0x5eed);
    this.state = origin ? structuredClone(origin) : createMatch(setup.seed, setup.teams);
    this.view = this.prev = viewFor(this.state, this.side);
  }

  /**
   * Picks a saved match back up. Replaying the journal restores it exactly,
   * AI included; a save from another build may replay into a different
   * match, and then its snapshot is adopted instead, with a fresh AI.
   */
  static resume(save: { setup: MatchSetup; journal: Journal; origin?: MatchState; state: MatchState }): LocalSession {
    const s = new LocalSession(save.setup, save.origin ?? null);
    const at = new Map(save.journal);
    while (s.state.seq < save.state.seq && s.state.phase !== 'over') {
      s.pending = structuredClone(at.get(s.state.seq) ?? []);
      s.tick();
    }
    if (hashState(s.state) !== hashState(save.state)) return new LocalSession(save.setup, save.state);
    s.prev = s.view;
    s.outbox = [];
    return s;
  }

  /** The full, unfogged state: for saves and bug reports, never for rendering. */
  get snapshot(): MatchState { return this.state; }

  private get pace(): number {
    const p = this.state.phase;
    return p === 'plan' ? PACE.plan : PACE[p] / this.speed;
  }

  get alpha(): number {
    return Math.min(1, this.acc / this.pace);
  }

  submit(intent: Intent): void {
    this.pending.push({ ...intent, side: this.side } as Command);
    // Planning reacts at once: a played card should leave the hand this frame.
    if (this.state.phase === 'plan') this.tick();
  }

  update(deltaMs: number): GameEvent[] {
    if (!(this.paused && this.state.phase !== 'plan')) this.acc += Math.min(deltaMs, 250);
    while (this.acc >= this.pace && this.state.phase !== 'over') {
      this.acc -= this.pace;
      this.tick();
    }
    const out = this.outbox;
    this.outbox = [];
    return out;
  }

  private outbox: GameEvent[] = [];

  private tick(): void {
    if (this.pending.length) this.journal.push([this.state.seq, this.pending]);
    const commands = [...this.pending, ...this.aiCommands()];
    this.pending = [];
    this.prev = this.view;
    const was = this.state.phase;
    this.state = step(this.state, commands);
    this.view = viewFor(this.state, this.side);
    this.outbox.push(...this.view.events);
    if (this.state.phase !== was) this.onPhase?.(this.state.phase);
  }

  /** The AI deliberates for a few steps at the start of each plan phase, then plays a card a step. */
  private aiCommands(): Command[] {
    const s = this.state;
    const aiSide: Side = this.side === 0 ? 1 : 0;
    if (s.phase !== 'plan') {
      this.aiWait = AI_PAUSE_STEPS;
      return this.ai.act(viewFor(s, aiSide), aiSide);
    }
    if (s.sides[aiSide].committed || --this.aiWait > 0) return [];
    this.aiWait = 2;
    return this.ai.act(viewFor(s, aiSide), aiSide);
  }
}
