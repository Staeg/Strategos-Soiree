import { hashState, type MatchState } from '@soiree/sim';
import { LocalSession, type Journal, type MatchSetup } from './session.ts';

/**
 * Auto-saves and bug reports share one record: the setup, the player's
 * journal and a snapshot of the full state. The journal replays the match
 * exactly from its seed; the snapshot is what a save resumes from when the
 * build has changed under it, and what a report shows at a glance.
 */
export interface Save {
  kind: 'strategos-save';
  build: string;
  at: string;
  setup: MatchSetup;
  journal: Journal;
  /** Present when the journal starts from this snapshot instead of the seed. */
  origin?: MatchState;
  state: MatchState;
  hash: string;
}

export interface Report {
  kind: 'strategos-report';
  build: string;
  at: string;
  userAgent: string;
  url: string;
  error?: { message: string; stack?: string };
  /** The match being played when the report was made, if any. */
  match?: Save;
}

declare const __BUILD__: string | undefined;
export const BUILD = typeof __BUILD__ === 'string' ? __BUILD__ : 'dev';

const KEY = 'strategos.autosave';

export function capture(s: LocalSession): Save {
  const state = structuredClone(s.snapshot);
  return {
    kind: 'strategos-save', build: BUILD, at: new Date().toISOString(),
    setup: s.setup, journal: structuredClone(s.journal),
    ...(s.origin ? { origin: s.origin } : {}),
    state, hash: hashState(state),
  };
}

/** Browser storage can be missing, full or blocked: saving is best effort and never breaks the match. */
function storage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

/** One slot: the latest checkpoint of the latest match. */
export function autosave(s: LocalSession): void {
  try { storage()?.setItem(KEY, JSON.stringify(capture(s))); } catch { /* full or blocked */ }
}

/** The save to continue from, unless there is none or its match is over. */
export function loadAutosave(): Save | null {
  try {
    const raw = storage()?.getItem(KEY);
    const save = raw ? JSON.parse(raw) as Save : null;
    return save?.kind === 'strategos-save' && save.state.phase !== 'over' ? save : null;
  } catch { return null; }
}

export function clearAutosave(): void {
  try { storage()?.removeItem(KEY); } catch { /* blocked */ }
}

/** The match being played, for reports; set by the scene that runs it. */
let live: LocalSession | null = null;
export function watch(s: LocalSession | null): void { live = s; }

/**
 * Readies a match to be played: watched for reports, auto-saved as the ball
 * begins and as every fight phase opens; a finished match leaves nothing to continue.
 */
export function autosaving(s: LocalSession): LocalSession {
  watch(s);
  autosave(s);
  s.onPhase = (phase) => {
    if (phase === 'plan') autosave(s);
    if (phase === 'over') clearAutosave();
  };
  return s;
}

/** What a bug report needs: the error, if any, and the whole match so far, replayable. */
export function report(error?: unknown): Report {
  const err = error instanceof Error ? { message: error.message, ...(error.stack ? { stack: error.stack } : {}) }
    : error !== undefined ? { message: String(error) } : undefined;
  return {
    kind: 'strategos-report', build: BUILD, at: new Date().toISOString(),
    userAgent: navigator.userAgent, url: location.href,
    ...(err ? { error: err } : {}),
    ...(live ? { match: capture(live) } : {}),
  };
}

/** Replays a save or the match inside a report; for picking either back up, here or in a test. */
export function restore(from: Save | Report): LocalSession | null {
  const save = from.kind === 'strategos-report' ? from.match : from;
  return save ? LocalSession.resume(save) : null;
}
