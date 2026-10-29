import { CORE, JUNGLE, JUNGLE_HALVES, STRUCTURE_SITES, distance, opposite } from './board.ts';
import { ALL_AT_ONCE, resolveNext } from './cards.ts';
import {
  CAMP_IDS, CARDS_KEPT, CARD_OWNER, DRAW_EVERY, FIGHT_EVERY, INTERLEAVE, MANA_KEPT, MANA_PER_PHASE, MAX_MAP_TICKS,
  STRUCTURE_HP, buildDeck, campDef, cardDef, heroDef, lineups, type HeroId,
} from './content.ts';
import { clashStep, freshFx, startClash, triggerOp } from './fight.ts';
import { alive, heroesOn, maxHp } from './hero.ts';
import { mapTick } from './map.ts';
import { addCharge } from './powers.ts';
import { seedRng, shuffle, type RngState } from './rng.ts';
import type { Camp, Command, Hero, MatchState, Side, SideState, Stage } from './types.ts';

/**
 * The whole game is `step(state, commands) -> state`: pure, integer-only and
 * driven by explicit steps. Renderers, AIs, replays and a future server all
 * sit on top of this one function. What a step means depends on the phase;
 * see `Phase`.
 */

/** Without explicit lineups, the seed decides which of each role's two heroes plays for which side. The ball opens on a strategy stage. */
export function createMatch(seed: number, teams: readonly [readonly HeroId[], readonly HeroId[]] = lineups(seed)): MatchState {
  const rng = { map: seedRng(seed, 1), fight: seedRng(seed, 2), cards: seedRng(seed, 3) };
  const camps = campLayout(seedRng(seed, 4));
  const heroes: Hero[] = [];
  for (const side of [0, 1] as const) {
    teams[side].forEach((id) => {
      const def = heroDef(id);
      const h: Hero = {
        uid: heroes.length, side, role: def.role, id, cell: CORE[side], hp: 0, xp: 0, stance: 'passive',
        retreating: false, camp: -1, respawnAt: -1, mapReadyAt: 0,
        ultReadyAt: 'cooldown' in def.ult ? def.ult.cooldown : 0, ascended: false,
        charge: 0, grown: { dmg: 0, spd: 0 }, boons: [], origin: { hp: 0, cell: CORE[side], respawnAt: -1 }, fx: freshFx(),
      };
      h.hp = maxHp(h);
      heroes.push(h);
    });
  }
  const side = (s: Side): SideState => ({
    mana: 0, hand: [], deck: shuffle(rng.cards, buildDeck(teams[s])), discard: [], plays: [], committed: false,
    strategy: { stances: [], camp: -1 }, campIntel: camps.map(() => -1), blindUntil: 0,
  });
  const s: MatchState = {
    seed: seed >>> 0, seq: 0, mapTick: 0, fightPhase: 0, fightTick: 0, phase: 'plan', stage: 'strategy', nextFight: FIGHT_EVERY,
    heroes,
    minions: [],
    structures: STRUCTURE_SITES.map((st) => ({ ...st, hp: STRUCTURE_HP[st.kind], maxHp: STRUCTURE_HP[st.kind], guardedUntil: 0 })),
    camps,
    wards: [], engagements: [], pending: [], initiative: -1,
    sides: [side(0), side(1)],
    rng, winner: null, events: [],
  };
  openStage(s, 'strategy');
  s.events = [];
  return s;
}

/**
 * Side 0's five camps, one of each kind in a random order, go to random
 * cells of its jungle: three in one half, two in the other. Side 1's are the
 * same camps turned half a circle about the centre, so the Wyrm north-east
 * of one core is south-west of the other.
 */
function campLayout(rng: RngState): Camp[] {
  const [three, two] = shuffle(rng, JUNGLE_HALVES[0].map((half) => shuffle(rng, [...half])));
  const cells = [...three!.slice(0, 3), ...two!.slice(0, 2)];
  const kinds = shuffle(rng, [...CAMP_IDS]);
  return ([0, 1] as const).flatMap((owner) => cells.map((cell, i) => {
    const def = campDef(kinds[i]!);
    return { cell: owner === 0 ? cell : opposite(cell), owner, kind: kinds[i]!, creeps: def.creeps, hp: def.hp, fought: 0, respawnAt: -1 };
  }));
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
  const cells = s.heroes.map((h) => h.cell);
  for (const c of commands) apply(s, c);
  phaseStep(s);
  deathTriggers(s, cells);
}

function phaseStep(s: MatchState): void {
  switch (s.phase) {
    case 'map': {
      mapTick(s);
      if (s.phase !== 'map') return;
      if (s.mapTick % DRAW_EVERY === 0) for (const side of [0, 1] as const) draw(s, side);
      if (s.mapTick >= MAX_MAP_TICKS) return finishOnPoints(s);
      if (s.mapTick >= s.nextFight) return startFight(s, false);
      const met = encounter(s);
      if (met < 0) return;
      s.events.push({ type: 'encounter', cell: met });
      return startFight(s, true);
    }
    case 'plan':
      if (s.sides[0].committed && s.sides[1].committed) reveal(s);
      return;
    case 'resolve': {
      resolveNext(s);
      const fresh = s.engagements.some((e) => !e.over && !e.started);
      if (fresh && (INTERLEAVE || s.pending.length === 0)) startClash(s);
      else if (s.pending.length === 0) closeStage(s);
      return;
    }
    case 'clash':
      if (clashStep(s)) return;
      if (s.pending.length === 0) return closeStage(s);
      s.phase = 'resolve';
      s.events.push({ type: 'phase', phase: 'resolve' });
      return;
  }
}

/** Death-triggered ultimates (Final Count): any hero dying within range this step, wherever it stood. */
function deathTriggers(s: MatchState, cells: number[]): void {
  for (const e of s.events) {
    if (e.type !== 'death') continue;
    for (const h of s.heroes) {
      const ult = heroDef(h.id).ult;
      if (ult.kind !== 'trigger' || ult.when.on !== 'death' || h.uid === e.uid || !alive(h) || s.fightPhase < h.ultReadyAt) continue;
      if (distance(h.cell, cells[e.uid]!) > ult.when.range) continue;
      if (ult.op.op === 'tally') {
        const store = heroDef(h.id).map.op;
        addCharge(s, h, ult.op.n, 'store' in store && store.store !== undefined ? store.store : Infinity);
      }
      triggerOp(s, h, h, ult.op);
      h.ultReadyAt = s.fightPhase + ult.cooldown;
      s.events.push({ type: 'order', side: h.side, uid: h.uid, order: 'ult' });
    }
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
      if (!drafting(s, me) || !h || (c.stance !== 'passive' && c.stance !== 'aggressive')) return;
      me.strategy.stances[cast(s, c.side).indexOf(h)] = c.stance;
      return;
    }
    case 'camp': {
      if (!drafting(s, me) || !(c.camp === -1 || (Number.isInteger(c.camp) && c.camp >= 0 && c.camp < s.camps.length))) return;
      me.strategy.camp = c.camp;
      return;
    }
    case 'play': {
      const id = me.hand[c.handIndex];
      const source = own(c.source);
      if (s.phase !== 'plan' || me.committed || !id || !source) return;
      const def = cardDef(id);
      if (def.cost > me.mana || !def.stages.includes(s.stage) || (CARD_OWNER[id] !== undefined && CARD_OWNER[id] !== source.id)) return;
      const wants = def.aim === 'enemy' || def.aim === 'ally' ? ['hero'] : def.aim === 'tower' || def.aim === 'cell' ? ['cell'] : def.aim === 'siege' ? ['hero', 'cell'] : ['none'];
      if (!wants.includes(c.target.kind)) return;
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
      me.committed = true;
      // The hand is cut down to size once a fight phase is over, as its strategy goes in.
      if (s.stage !== 'strategy') return;
      const drop = [...new Set(c.discard)].filter((i) => i >= 0 && i < me.hand.length).sort((a, b) => b - a);
      for (const i of drop) {
        if (me.hand.length <= CARDS_KEPT) break;
        discard(me, me.hand.splice(i, 1)[0]!);
      }
      while (me.hand.length > CARDS_KEPT) discard(me, me.hand.shift()!);
      return;
    }
  }
}

/** A side's heroes, in uid order. */
const cast = (s: MatchState, side: Side): Hero[] => s.heroes.filter((h) => h.side === side);

const jungler = (s: MatchState, side: Side): Hero | undefined => cast(s, side).find((h) => h.role === 'jungle');

/** Whether a side may still change the strategy it is drawing up. */
const drafting = (s: MatchState, me: SideState): boolean => s.phase === 'plan' && s.stage === 'strategy' && !me.committed;

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

/**
 * A fight phase: the scheduled one, with fresh mana, or one an encounter
 * calls at once, fought with whatever cards and mana the sides hold.
 */
function startFight(s: MatchState, encounter: boolean): void {
  s.fightPhase++;
  if (!encounter) for (const me of s.sides) me.mana = Math.min(me.mana, MANA_KEPT) + MANA_PER_PHASE;
  for (const h of s.heroes) h.origin = { hp: h.hp, cell: h.cell, respawnAt: h.respawnAt };
  openStage(s, 'motion');
}

/**
 * Heroes of both sides standing together off the lanes, on a jungle cell,
 * meet: the cell where they do, or -1. Heroes walking home pass by.
 */
function encounter(s: MatchState): number {
  return JUNGLE.find((cell) => {
    const here = heroesOn(s, cell).filter((h) => !h.retreating);
    return here.some((h) => h.side === 0) && here.some((h) => h.side === 1);
  }) ?? -1;
}

/**
 * Both sides plan the next stage blind. A side with no card for motion or
 * play has nothing to plan and is in at once; strategy always waits, since
 * it holds the stances and the hand's discards.
 */
function openStage(s: MatchState, stage: Stage): void {
  s.phase = 'plan';
  s.stage = stage;
  for (const side of [0, 1] as const) {
    const me = s.sides[side];
    me.plays = [];
    me.committed = stage !== 'strategy' && !me.hand.some((id) => cardDef(id).stages.includes(stage));
    if (stage === 'strategy') me.strategy = { stances: cast(s, side).map((h) => h.stance), camp: jungler(s, side)?.camp ?? -1 };
  }
  s.events.push({ type: 'phase', phase: 'plan', stage });
  if (s.sides[0].committed && s.sides[1].committed) reveal(s);
}

/** Both sides are in: every play is now public. Play resolves by initiative; motion and strategy all at once. */
function reveal(s: MatchState): void {
  const plays = s.sides.flatMap((me) => me.plays);
  s.pending = s.stage === 'play'
    ? [...new Set(plays.map((p) => cardDef(p.card).initiative))].sort((a, b) => a - b)
    : plays.length ? [ALL_AT_ONCE] : [];
  s.initiative = -1;
  s.phase = 'resolve';
  s.events.push({ type: 'phase', phase: 'resolve' });
  if (s.pending.length === 0) closeStage(s);
}

/** Motion leads to play, play to strategy, and strategy's orders end the fight phase. */
function closeStage(s: MatchState): void {
  if (s.stage === 'motion') return openStage(s, 'play');
  if (s.stage === 'play') return openStage(s, 'strategy');
  takeStrategy(s);
  endFightPhase(s);
}

/** Both sides' stances and camps take hold together. */
function takeStrategy(s: MatchState): void {
  for (const side of [0, 1] as const) {
    const plan = s.sides[side].strategy;
    cast(s, side).forEach((h, i) => {
      const stance = plan.stances[i] ?? h.stance;
      if (stance === h.stance) return;
      h.stance = stance;
      s.events.push({ type: 'order', side, uid: h.uid, order: 'stance' });
    });
    const j = jungler(s, side);
    if (j && j.camp !== plan.camp) {
      j.camp = plan.camp;
      s.events.push({ type: 'order', side, uid: j.uid, order: 'camp' });
    }
  }
}

/**
 * The next fight phase is called FIGHT_EVERY map ticks after this one ends.
 * Rivals still standing together on a jungle cell part: the one lowest on HP
 * walks home, until only one side holds its ground there.
 */
function endFightPhase(s: MatchState): void {
  for (const h of s.heroes) h.fx = freshFx();
  for (const me of s.sides) me.plays = [];
  s.engagements = [];
  s.nextFight = s.mapTick + FIGHT_EVERY;
  for (const cell of JUNGLE) {
    for (;;) {
      const here = heroesOn(s, cell).filter((h) => !h.retreating);
      if (!here.some((h) => h.side === 0) || !here.some((h) => h.side === 1)) break;
      here.reduce((a, b) => (b.hp < a.hp ? b : a)).retreating = true;
    }
  }
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
