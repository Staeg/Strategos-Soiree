import { CAMP_SITES, CORE, N_CELLS, STRUCTURE_SITES, distance } from './board.ts';
import { resolveNext, settle } from './cards.ts';
import {
  CAMP_SIZE, CARDS_KEPT, CARD_OWNER, DRAW_EVERY, FIGHT_EVERY, LINEUP, MANA_KEPT, MANA_PER_PHASE, MAX_MAP_TICKS,
  ORDERS_PER_PHASE, STRUCTURE_HP, buildDeck, cardDef, heroDef, type HeroId,
} from './content.ts';
import { clashStep, startClash } from './fight.ts';
import { alive, maxHp } from './hero.ts';
import { mapOp, mapTick } from './map.ts';
import { seedRng, shuffle } from './rng.ts';
import type { Command, FightFx, Hero, MatchState, Side, SideState } from './types.ts';

/**
 * The whole game is `step(state, commands) -> state`: pure, integer-only and
 * driven by explicit steps. Renderers, AIs, replays and a future server all
 * sit on top of this one function. What a step means depends on the phase;
 * see `Phase`.
 */

const freshFx = (): FightFx => ({
  engagement: -1, shield: 0, dmgPct: 0, surgePct: 0, surgeUntil: 0, res: 0, spd: 0, focus: -1, evadeAfter: 99, afterHeal: 0, nextTurn: 0, turns: 0,
});

const freshOrders = () => ({ ...ORDERS_PER_PHASE });

export function createMatch(seed: number, lineups: readonly [readonly HeroId[], readonly HeroId[]] = [LINEUP, LINEUP]): MatchState {
  const rng = { map: seedRng(seed, 1), fight: seedRng(seed, 2), cards: seedRng(seed, 3) };
  const heroes: Hero[] = [];
  for (const side of [0, 1] as const) {
    lineups[side].forEach((id) => {
      const def = heroDef(id);
      const h: Hero = {
        uid: heroes.length, side, role: def.role, id, cell: CORE[side], hp: 0, xp: 0, stance: 'passive',
        retreating: false, roam: -1, respawnAt: -1, mapReadyAt: 0,
        ultReadyAt: 'cooldown' in def.ult ? def.ult.cooldown : 0, ascended: false, fx: freshFx(),
      };
      h.hp = maxHp(h);
      heroes.push(h);
    });
  }
  const side = (s: Side): SideState => ({
    mana: 0, hand: [], deck: shuffle(rng.cards, buildDeck(lineups[s])), discard: [], plays: [], committed: false,
    orders: freshOrders(), campIntel: CAMP_SITES.map(() => -1),
  });
  return {
    seed: seed >>> 0, seq: 0, mapTick: 0, fightPhase: 0, fightTick: 0, phase: 'map',
    heroes,
    minions: [],
    structures: STRUCTURE_SITES.map((st) => ({ ...st, hp: STRUCTURE_HP[st.kind], maxHp: STRUCTURE_HP[st.kind], guardedUntil: 0 })),
    camps: CAMP_SITES.map((c) => ({ ...c, creeps: CAMP_SIZE, respawnAt: -1 })),
    wards: [], engagements: [], pending: [],
    sides: [side(0), side(1)],
    rng, winner: null, events: [],
  };
}

export function step(prev: MatchState, commands: readonly Command[]): MatchState {
  const s = structuredClone(prev);
  advance(s, commands);
  return s;
}

/** In-place variant of `step`, for callers that own a private copy (AI rollouts). */
export function advance(s: MatchState, commands: readonly Command[]): void {
  s.events = [];
  s.seq++;
  if (s.phase === 'over') return;
  for (const c of commands) apply(s, c);
  switch (s.phase) {
    case 'map':
      mapTick(s);
      if (s.phase !== 'map') return;
      if (s.mapTick % DRAW_EVERY === 0) for (const side of [0, 1] as const) draw(s, side);
      if (s.mapTick % FIGHT_EVERY === 0) startPlan(s);
      else if (s.mapTick >= MAX_MAP_TICKS) finishOnPoints(s);
      return;
    case 'plan':
      if (s.sides[0].committed && s.sides[1].committed) startResolve(s);
      return;
    case 'resolve':
      resolveNext(s);
      if (s.pending.length === 0) {
        if (s.engagements.some((e) => !e.over)) startClash(s);
        else endFightPhase(s);
      }
      return;
    case 'clash':
      if (!clashStep(s)) endFightPhase(s);
      return;
  }
}

/** Invalid commands are ignored: the sim never trusts its callers. */
function apply(s: MatchState, c: Command): void {
  const me = s.sides[c.side];
  const own = (uid: number): Hero | undefined => {
    const h = s.heroes[uid];
    return h && h.side === c.side ? h : undefined;
  };
  switch (c.type) {
    case 'stance': {
      const h = own(c.uid);
      if (s.phase !== 'map' || !h || !alive(h) || me.orders.stance <= 0) return;
      h.stance = h.stance === 'passive' ? 'aggressive' : 'passive';
      me.orders.stance--;
      s.events.push({ type: 'order', side: c.side, uid: h.uid, order: 'stance' });
      return;
    }
    case 'roam': {
      const h = own(c.uid);
      if (s.phase !== 'map' || !h || !alive(h) || me.orders.roam <= 0 || !(c.cell >= 0 && c.cell < N_CELLS)) return;
      h.roam = c.cell;
      h.retreating = false;
      me.orders.roam--;
      s.events.push({ type: 'order', side: c.side, uid: h.uid, order: 'roam' });
      return;
    }
    case 'ult': {
      const h = own(c.uid);
      const ult = h && heroDef(h.id).ult;
      if (s.phase !== 'map' || !h || !alive(h) || ult?.kind !== 'command' || s.fightPhase < h.ultReadyAt) return;
      if (!(c.cell >= 0 && c.cell < N_CELLS) || distance(h.cell, c.cell) > ult.range) return;
      if (!mapOp(s, h, ult.op, c.cell)) return;
      h.ultReadyAt = s.fightPhase + ult.cooldown;
      s.events.push({ type: 'order', side: c.side, uid: h.uid, order: 'ult' });
      return;
    }
    case 'play': {
      const id = me.hand[c.handIndex];
      const source = own(c.source);
      if (s.phase !== 'plan' || me.committed || !id || !source) return;
      const def = cardDef(id);
      if (def.cost > me.mana || (CARD_OWNER[id] !== undefined && CARD_OWNER[id] !== source.id)) return;
      const wants = def.aim === 'enemy' || def.aim === 'ally' ? 'hero' : def.aim === 'tower' ? 'cell' : 'none';
      if (c.target.kind !== wants) return;
      me.mana -= def.cost;
      me.hand.splice(c.handIndex, 1);
      me.plays.push({ side: c.side, card: id, source: source.uid, target: c.target });
      return;
    }
    case 'unplay': {
      const play = me.plays[c.index];
      if (s.phase !== 'plan' || me.committed || !play) return;
      me.plays.splice(c.index, 1);
      me.hand.push(play.card);
      me.mana += cardDef(play.card).cost;
      return;
    }
    case 'commit': {
      if (s.phase !== 'plan' || me.committed) return;
      const drop = [...new Set(c.discard)].filter((i) => i >= 0 && i < me.hand.length).sort((a, b) => b - a);
      for (const i of drop) {
        if (me.hand.length <= CARDS_KEPT) break;
        discard(me, me.hand.splice(i, 1)[0]!);
      }
      while (me.hand.length > CARDS_KEPT) discard(me, me.hand.shift()!);
      me.committed = true;
      return;
    }
  }
}

/** Ultimate cards never enter the deck: unkept, they simply wait for the next draw. */
function discard(me: SideState, id: MatchState['sides'][number]['hand'][number]): void {
  if (!cardDef(id).keywords.includes('Ultimate')) me.discard.push(id);
}

function draw(s: MatchState, side: Side): void {
  const me = s.sides[side];
  if (me.deck.length === 0) {
    me.deck = shuffle(s.rng.cards, me.discard);
    me.discard = [];
  }
  const id = me.deck.pop();
  if (id) me.hand.push(id);
  for (const h of s.heroes) {
    const ult = heroDef(h.id).ult;
    if (h.side !== side || ult.kind !== 'card' || s.fightPhase < h.ultReadyAt) continue;
    if (!me.hand.includes(ult.card) && !me.plays.some((p) => p.card === ult.card)) me.hand.push(ult.card);
  }
  s.events.push({ type: 'draw', side });
}

function startPlan(s: MatchState): void {
  s.phase = 'plan';
  s.fightPhase++;
  for (const me of s.sides) {
    me.mana = Math.min(me.mana, MANA_KEPT) + MANA_PER_PHASE;
    me.plays = [];
    me.committed = false;
  }
  for (const h of s.heroes) h.roam = -1;
  s.events.push({ type: 'phase', phase: 'plan' });
}

/** Both sides are in: every play is now public, and resolves by initiative. */
function startResolve(s: MatchState): void {
  const all = s.sides.flatMap((me) => me.plays.map((p) => cardDef(p.card).initiative));
  s.pending = [...new Set(all)].sort((a, b) => a - b);
  s.phase = 'resolve';
  s.events.push({ type: 'phase', phase: 'resolve' });
  if (s.pending.length === 0) endFightPhase(s);
}

function endFightPhase(s: MatchState): void {
  settle(s);
  for (const h of s.heroes) h.fx = freshFx();
  for (const me of s.sides) {
    me.plays = [];
    me.orders = freshOrders();
  }
  s.engagements = [];
  s.phase = 'map';
  s.events.push({ type: 'phase', phase: 'map' });
}

/** At the time limit, the side whose structures stand taller wins. */
function finishOnPoints(s: MatchState): void {
  const total = (side: Side) => s.structures.reduce((t, st) => t + (st.side === side ? st.hp : 0), 0);
  const [a, b] = [total(0), total(1)];
  s.phase = 'over';
  s.winner = a === b ? 'draw' : a > b ? 0 : 1;
  s.events.push({ type: 'phase', phase: 'over' });
}

/** FNV-1a over the canonical JSON form; equal hashes on two machines mean no desync. */
export function hashState(s: MatchState): string {
  const text = JSON.stringify(s);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}
