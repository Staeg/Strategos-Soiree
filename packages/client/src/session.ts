import {
  createMatch, lineups, step, viewFor,
  type Agent, type Command, type GameEvent, type HeroId, type MatchState, type MatchView, type Phase, type Side,
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

/** Milliseconds per step at speed 1. Planning steps only wait for commits. */
const PACE: Record<Phase, number> = { map: 1000, plan: 120, resolve: 900, clash: 220, over: 1000 };
/** Lets the AI "think" visibly before committing instead of answering instantly. */
const AI_PAUSE_STEPS = 6;

export class LocalSession implements Session {
  view: MatchView;
  prev: MatchView;
  speed = 1;
  paused = false;
  private state: MatchState;
  private acc = 0;
  private pending: Command[] = [];
  private aiWait = AI_PAUSE_STEPS;

  constructor(seed: number, private readonly ai: Agent, readonly side: Side = 0, teams: readonly [readonly HeroId[], readonly HeroId[]] = lineups(seed)) {
    this.state = createMatch(seed, teams);
    this.view = this.prev = viewFor(this.state, side);
  }

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
    const commands = [...this.pending, ...this.aiCommands()];
    this.pending = [];
    this.prev = this.view;
    this.state = step(this.state, commands);
    this.view = viewFor(this.state, this.side);
    this.outbox.push(...this.view.events);
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
