import {
  createMatch, draftingSide, step, TICK_HZ,
  type Agent, type Command, type GameEvent, type MatchState, type Side,
} from '@soiree/sim';

type Without<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** A command as the local player issues it; the session stamps the side. */
export type Intent = Without<Command, 'side'>;

/**
 * What a scene needs from "the match", wherever it actually runs. The local
 * session steps the sim itself; a future online session will forward intents
 * to a server and feed back confirmed states through the same shape.
 */
export interface Session {
  readonly side: Side;
  readonly state: MatchState;
  readonly prev: MatchState;
  /** 0..1 progress towards the next tick, for smooth interpolation. */
  readonly alpha: number;
  submit(intent: Intent): void;
  update(deltaMs: number): GameEvent[];
}

const TICK_MS = 1000 / TICK_HZ;
/** Lets the AI "think" visibly during turn-based phases instead of answering instantly. */
const AI_PAUSE_TICKS = Math.round(TICK_HZ * 0.7);

export class LocalSession implements Session {
  state: MatchState;
  prev: MatchState;
  private acc = 0;
  private pending: Command[] = [];
  private aiWait = AI_PAUSE_TICKS;

  constructor(seed: number, private readonly ai: Agent, readonly side: Side = 0) {
    this.state = this.prev = createMatch(seed);
  }

  get alpha(): number {
    return this.acc / TICK_MS;
  }

  submit(intent: Intent): void {
    this.pending.push({ ...intent, side: this.side } as Command);
  }

  update(deltaMs: number): GameEvent[] {
    this.acc += Math.min(deltaMs, 250);
    const events: GameEvent[] = [];
    while (this.acc >= TICK_MS) {
      this.acc -= TICK_MS;
      const commands = [...this.pending, ...this.aiCommands()];
      this.pending = [];
      this.prev = this.state;
      this.state = step(this.state, commands);
      events.push(...this.state.events);
    }
    return events;
  }

  private aiCommands(): Command[] {
    const s = this.state;
    const aiSide: Side = this.side === 0 ? 1 : 0;
    const deliberate = draftingSide(s) === aiSide || (s.phase === 'council' && !s.sides[aiSide].ready);
    if (!deliberate) return this.ai.act(s, aiSide);
    if (--this.aiWait > 0) return [];
    this.aiWait = AI_PAUSE_TICKS;
    return this.ai.act(s, aiSide);
  }
}
