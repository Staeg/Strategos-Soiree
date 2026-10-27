import type { Agent } from './ai.ts';
import { createMatch, step } from './sim.ts';
import type { GameEvent, MatchState } from './types.ts';

export interface MatchResult {
  final: MatchState;
  ticks: number;
  log: GameEvent[][];
}

/** Plays a whole match headlessly: the same loop a client or server runs, minus the clock. */
export function runMatch(seed: number, agents: readonly [Agent, Agent], maxTicks = 50_000, keepLog = false): MatchResult {
  let s = createMatch(seed);
  const log: GameEvent[][] = [];
  while (s.phase !== 'over' && s.tick < maxTicks) {
    s = step(s, [...agents[0].act(s, 0), ...agents[1].act(s, 1)]);
    if (keepLog) log.push(s.events);
  }
  return { final: s, ticks: s.tick, log };
}
