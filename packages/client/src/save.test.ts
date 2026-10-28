import { hashState } from '@soiree/sim';
import { describe, expect, it } from 'vitest';
import { LocalSession } from './session.ts';

/** Plays a session at full speed, with the player stepping in now and then, until `until` holds. */
function play(s: LocalSession, until: (s: LocalSession) => boolean): void {
  let n = 0;
  while (!until(s) && s.snapshot.phase !== 'over') {
    const v = s.view;
    const mine = v.heroes.filter((h) => h.side === s.side);
    n++;
    if (v.phase === 'map' && n % 17 === 0) s.submit({ type: 'stance', uid: mine[n % mine.length]!.uid });
    if (v.phase === 'plan' && !v.sides[s.side].committed) {
      if (v.sides[s.side].hand.length && n % 3) s.submit({ type: 'play', handIndex: 0, source: mine[0]!.uid, target: { kind: 'none' } });
      else s.submit({ type: 'commit', discard: [] });
    }
    s.update(10_000);
  }
}

describe('saves', () => {
  it('replays a match exactly from its setup and journal, AI included', () => {
    const live = new LocalSession({ seed: 7, difficulty: 'tactician', side: 0 });
    play(live, (s) => s.snapshot.fightPhase >= 3 && s.snapshot.phase === 'plan');
    expect(live.journal.length).toBeGreaterThan(0);
    const save = JSON.parse(JSON.stringify({ setup: live.setup, journal: live.journal, state: live.snapshot }));
    const back = LocalSession.resume(save);
    expect(back.origin).toBeNull();
    expect(hashState(back.snapshot)).toBe(hashState(live.snapshot));
    // Both carry on identically from there.
    play(live, (s) => s.snapshot.fightPhase >= 5);
    play(back, (s) => s.snapshot.seq >= live.snapshot.seq);
    expect(hashState(back.snapshot)).toBe(hashState(live.snapshot));
  });

  it("adopts the snapshot when the journal no longer leads there (another build's save)", () => {
    const live = new LocalSession({ seed: 3, difficulty: 'novice', side: 0 });
    play(live, (s) => s.snapshot.fightPhase >= 2);
    // The journal leaves out the player's orders, so it replays into another match.
    const save = JSON.parse(JSON.stringify({ setup: live.setup, journal: [], state: live.snapshot }));
    const back = LocalSession.resume(save);
    expect(back.origin).not.toBeNull();
    expect(hashState(back.snapshot)).toBe(hashState(live.snapshot));
    expect(back.journal).toEqual([]);
  });
});
