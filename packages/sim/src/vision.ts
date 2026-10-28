import { N_CELLS, NEIGHBOURS, distance, laneCell } from './board.ts';
import { alive, foe } from './hero.ts';
import { heroSeen } from './powers.ts';
import type { GameEvent, MatchState, Side } from './types.ts';

/**
 * Fog of war. A side sees the cells holding its heroes, minions and
 * structures, every cell next to one of its standing structures, and
 * whatever its wards reveal. Nothing else exists for it. A side under
 * Nightfall sees only the cells its units stand on.
 */
export function visibility(s: MatchState, side: Side): boolean[] {
  const seen = new Array<boolean>(N_CELLS).fill(false);
  const blind = s.sides[side].blindUntil > s.mapTick;
  for (const h of s.heroes) if (h.side === side && alive(h)) seen[h.cell] = true;
  for (const m of s.minions) if (m.side === side && m.n > 0) seen[laneCell(m.lane, m.pos)] = true;
  for (const st of s.structures) {
    if (st.side !== side || st.hp <= 0) continue;
    seen[st.cell] = true;
    if (!blind) for (const n of NEIGHBOURS[st.cell]!) if (n >= 0) seen[n] = true;
  }
  if (blind) return seen;
  for (const w of s.wards) {
    if (w.side !== side || w.until <= s.mapTick) continue;
    for (let c = 0; c < N_CELLS; c++) if (distance(w.cell, c) <= w.radius) seen[c] = true;
  }
  return seen;
}

/** The match as one side is allowed to know it: what a client renders and an AI reasons over. */
export interface MatchView extends MatchState {
  viewer: Side;
  /** The rival's hand is hidden; only its size is known. */
  rivalHand: number;
  visible: boolean[];
}

export function viewFor(s: MatchState, side: Side): MatchView {
  const visible = visibility(s, side);
  const v = structuredClone(s) as MatchView;
  const rival = v.sides[foe(side)];
  v.viewer = side;
  v.visible = visible;
  v.rivalHand = rival.hand.length;
  rival.hand = [];
  rival.deck = [];
  if (s.phase === 'plan') rival.plays = [];
  v.rng = { map: [0, 0, 0, 0], fight: [0, 0, 0, 0], cards: [0, 0, 0, 0] };
  for (const h of v.heroes) if (!heroSeen(s, side, s.heroes[h.uid]!, visible)) h.cell = -1;
  v.minions = v.minions.filter((m) => m.side === side || visible[laneCell(m.lane, m.pos)]);
  for (const c of v.camps) if (!visible[c.cell]) [c.creeps, c.hp] = [-1, -1];
  v.wards = v.wards.filter((w) => w.side === side);
  v.events = s.events.filter((e) => eventVisible(s, e, side, visible));
  return v;
}

function eventVisible(s: MatchState, e: GameEvent, side: Side, visible: boolean[]): boolean {
  const hero = (uid: number) => heroSeen(s, side, s.heroes[uid]!, visible);
  switch (e.type) {
    case 'minions': return visible[e.cell] === true;
    case 'march': {
      const next = e.pos + (e.side === 0 ? 1 : -1);
      return e.side === side || visible[laneCell(e.lane, e.pos)] === true || visible[laneCell(e.lane, next)] === true;
    }
    case 'hurt': case 'heal': case 'ability': case 'ascend': case 'act':
      return hero(e.uid);
    case 'order': return e.side === side;
    default: return true;
  }
}
