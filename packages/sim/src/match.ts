import type { Agent } from './ai.ts';
import { createMatch, step } from './sim.ts';
import type { GameEvent, MatchState } from './types.ts';
import { viewFor } from './vision.ts';

export interface MatchResult {
  final: MatchState;
  steps: number;
  log: GameEvent[][];
}

/** Plays a whole match headlessly: the same loop a client or server runs, minus the clock. */
export function runMatch(seed: number, agents: readonly [Agent, Agent], maxSteps = 20_000, keepLog = false): MatchResult {
  let s = createMatch(seed);
  const log: GameEvent[][] = [];
  while (s.phase !== 'over' && s.seq < maxSteps) {
    s = step(s, [...agents[0].act(viewFor(s, 0), 0), ...agents[1].act(viewFor(s, 1), 1)]);
    if (keepLog) log.push(s.events);
  }
  return { final: s, steps: s.seq, log };
}
