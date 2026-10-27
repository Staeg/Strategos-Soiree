import {
  BATTLE_TICKS, CARDS, DRAFT_ORDER, HAND_SIZE, HERO_IDS, LANE, MAX_ROUNDS, NEXUS_HP,
  RESPAWN_TICKS, SIEGE_PERCENT, STANCES, STARTING_DECK, councilMana, hero,
  type CardId,
} from './content.ts';
import { chance, randInt, seedRng, shuffle } from './rng.ts';
import type { Command, MatchState, Side, SideState, Unit } from './types.ts';

/**
 * The whole game is `step(state, commands) -> state`: pure, integer-only and
 * driven by an explicit tick. Renderers, AIs, replays and a future server all
 * sit on top of this one function.
 */

const foe = (side: Side): Side => (side === 0 ? 1 : 0);
const idiv = (a: number, b: number): number => Math.floor(a / b);

function newSide(): SideState {
  return {
    picks: [], stance: 'balanced', nexus: NEXUS_HP, mana: 0,
    hand: [], deck: [], discard: [], queued: [], ready: false,
    buffs: { dmg: 0, speed: 0 },
  };
}

export function createMatch(seed: number): MatchState {
  const s: MatchState = {
    seed: seed >>> 0,
    tick: 0,
    phase: 'draft',
    round: 0,
    battleTicksLeft: 0,
    draftTurn: 0,
    pool: [...HERO_IDS],
    sides: [newSide(), newSide()],
    units: [],
    rng: { combat: seedRng(seed, 1), cards: seedRng(seed, 2) },
    winner: null,
    events: [],
  };
  for (const side of s.sides) side.deck = shuffle(s.rng.cards, [...STARTING_DECK]);
  return s;
}

/** Whose pick it is, or null once the draft is over. */
export const draftingSide = (s: MatchState): Side | null =>
  s.phase === 'draft' ? (DRAFT_ORDER[s.draftTurn] ?? null) : null;

export function step(prev: MatchState, commands: readonly Command[]): MatchState {
  const s = structuredClone(prev);
  advance(s, commands);
  return s;
}

/** In-place variant of `step`, for callers that own a private copy (AI rollouts). */
export function advance(s: MatchState, commands: readonly Command[]): void {
  s.events = [];
  s.tick++;
  for (const c of commands) apply(s, c);
  if (s.phase === 'battle') battleTick(s);
  else if (s.phase === 'council' && s.sides[0].ready && s.sides[1].ready) resolveCouncil(s);
}

/** Invalid commands are ignored: the sim never trusts its callers. */
function apply(s: MatchState, c: Command): void {
  const me = s.sides[c.side];
  switch (c.type) {
    case 'pick': {
      const at = s.pool.indexOf(c.hero);
      if (draftingSide(s) !== c.side || at < 0) return;
      s.pool.splice(at, 1);
      me.picks.push(c.hero);
      s.events.push({ type: 'pick', side: c.side, hero: c.hero });
      if (++s.draftTurn === DRAFT_ORDER.length) {
        let id = 0;
        for (const side of [0, 1] as const) {
          s.sides[side].picks.forEach((h, slot) => {
            s.units.push({ id: id++, side, slot, hero: h, hp: hero(h).hp, dist: 0, cooldown: 0, respawnAt: -1 });
          });
        }
        startBattle(s);
      }
      return;
    }
    case 'stance':
      if (s.phase === 'battle' && c.stance in STANCES) me.stance = c.stance;
      return;
    case 'play': {
      const id = me.hand[c.handIndex];
      if (s.phase !== 'council' || me.ready || !id || CARDS[id].cost > me.mana) return;
      me.mana -= CARDS[id].cost;
      me.hand.splice(c.handIndex, 1);
      me.queued.push(id);
      return;
    }
    case 'endTurn':
      if (s.phase === 'council') me.ready = true;
      return;
  }
}

function startBattle(s: MatchState): void {
  s.phase = 'battle';
  s.round++;
  s.battleTicksLeft = BATTLE_TICKS;
  for (const u of s.units) {
    u.dist = 0;
    u.cooldown = 0;
    if (u.respawnAt >= 0) {
      u.respawnAt = -1;
      u.hp = idiv(hero(u.hero).hp, 2);
    }
  }
  s.events.push({ type: 'phase', phase: 'battle', round: s.round });
}

const alive = (u: Unit): boolean => u.respawnAt < 0;
const gap = (a: Unit, b: Unit): number => LANE - a.dist - b.dist;

function nearestFoe(s: MatchState, u: Unit): Unit | undefined {
  let best: Unit | undefined;
  for (const o of s.units) {
    if (o.side !== u.side && alive(o) && (!best || gap(u, o) < gap(u, best))) best = o;
  }
  return best;
}

function mostWounded(s: MatchState, u: Unit, range: number): Unit | undefined {
  let best: Unit | undefined;
  let bestMissing = 0;
  for (const o of s.units) {
    if (o.side !== u.side || !alive(o) || Math.abs(o.dist - u.dist) > range) continue;
    const missing = hero(o.hero).hp - o.hp;
    if (missing > bestMissing) [best, bestMissing] = [o, missing];
  }
  return best;
}

function rollDamage(s: MatchState, u: Unit, defender: Side | null): { amount: number; crit: boolean } {
  const def = hero(u.hero);
  const mine = s.sides[u.side];
  const taken = defender === null ? 100 : STANCES[s.sides[defender].stance].taken;
  const variance = 85 + randInt(s.rng.combat, 31);
  const crit = chance(s.rng.combat, def.crit);
  const raw = def.dmg * STANCES[mine.stance].dmg * (100 + mine.buffs.dmg) * variance * taken * (crit ? 2 : 1);
  return { amount: Math.max(1, idiv(raw, 100 ** 4)), crit };
}

type Intent =
  | { kind: 'hit'; u: Unit; target: Unit }
  | { kind: 'heal'; u: Unit; target: Unit; amount: number }
  | { kind: 'siege'; u: Unit };

function battleTick(s: MatchState): void {
  // Decide everything first, then resolve: unit order must not matter.
  const intents: Intent[] = [];
  for (const u of s.units) {
    if (!alive(u)) continue;
    if (u.cooldown > 0) u.cooldown--;
    const def = hero(u.hero);
    const side = s.sides[u.side];
    const ready = u.cooldown === 0;

    if (def.heal && ready) {
      const ally = mostWounded(s, u, def.range);
      if (ally) {
        intents.push({ kind: 'heal', u, target: ally, amount: def.heal });
        u.cooldown = def.cooldown;
        continue;
      }
    }
    const target = nearestFoe(s, u);
    if (target && gap(u, target) <= def.range) {
      if (ready) intents.push({ kind: 'hit', u, target });
      if (ready) u.cooldown = def.cooldown;
      continue;
    }
    if (LANE - u.dist <= def.range) {
      if (ready) intents.push({ kind: 'siege', u });
      if (ready) u.cooldown = def.cooldown;
      continue;
    }
    const st = STANCES[side.stance];
    const speed = idiv(def.speed * st.speed * (100 + side.buffs.speed), 100 * 100);
    let next = Math.min(u.dist + speed, idiv(st.hold * LANE, 1000));
    if (target) next = Math.min(next, LANE - target.dist);
    u.dist = Math.max(u.dist, next);
  }

  for (const it of intents) {
    if (it.kind === 'heal') {
      const max = hero(it.target.hero).hp;
      const amount = Math.min(it.amount, max - it.target.hp);
      it.target.hp += amount;
      s.events.push({ type: 'heal', from: it.u.id, to: it.target.id, amount });
    } else if (it.kind === 'hit') {
      const { amount, crit } = rollDamage(s, it.u, it.target.side);
      it.target.hp -= amount;
      s.events.push({ type: 'hit', from: it.u.id, to: it.target.id, amount, crit });
    } else {
      const roll = rollDamage(s, it.u, null);
      const amount = Math.max(1, idiv(roll.amount * SIEGE_PERCENT, 100));
      const victim = foe(it.u.side);
      s.sides[victim].nexus = Math.max(0, s.sides[victim].nexus - amount);
      s.events.push({ type: 'siege', from: it.u.id, side: victim, amount, crit: roll.crit });
    }
  }

  for (const u of s.units) {
    if (alive(u) && u.hp <= 0) {
      u.hp = 0;
      u.respawnAt = s.tick + RESPAWN_TICKS;
      s.events.push({ type: 'death', unit: u.id });
    } else if (!alive(u) && s.tick >= u.respawnAt) {
      u.respawnAt = -1;
      u.hp = hero(u.hero).hp;
      u.dist = 0;
      s.events.push({ type: 'respawn', unit: u.id });
    }
  }

  const [a, b] = [s.sides[0].nexus, s.sides[1].nexus];
  if (a === 0 || b === 0) return finish(s, a === b ? 'draw' : a === 0 ? 1 : 0);
  if (--s.battleTicksLeft > 0) return;
  if (s.round >= MAX_ROUNDS) return finish(s, a === b ? 'draw' : a > b ? 0 : 1);
  startCouncil(s);
}

function draw(s: MatchState, side: SideState): void {
  while (side.hand.length < HAND_SIZE) {
    if (side.deck.length === 0) {
      if (side.discard.length === 0) return;
      side.deck = shuffle(s.rng.cards, side.discard);
      side.discard = [];
    }
    side.hand.push(side.deck.pop()!);
  }
}

function startCouncil(s: MatchState): void {
  s.phase = 'council';
  for (const side of s.sides) {
    side.buffs = { dmg: 0, speed: 0 };
    side.mana = councilMana(s.round);
    side.ready = false;
    draw(s, side);
  }
  s.events.push({ type: 'phase', phase: 'council', round: s.round });
}

/** Both sides committed blind; reveal and resolve side 0's cards, then side 1's. */
function resolveCouncil(s: MatchState): void {
  startBattle(s);
  for (const side of [0, 1] as const) {
    const me = s.sides[side];
    for (const id of me.queued) {
      s.events.push({ type: 'card', side, card: id, success: playCard(s, side, id) });
      me.discard.push(id);
    }
    me.queued = [];
    me.mana = 0;
  }
  for (const u of s.units) {
    if (alive(u) && u.hp <= 0) {
      u.hp = 0;
      u.respawnAt = s.tick + RESPAWN_TICKS;
      s.events.push({ type: 'death', unit: u.id });
    }
  }
}

function playCard(s: MatchState, side: Side, id: CardId): boolean {
  const me = s.sides[side];
  switch (id) {
    case 'rally':
      for (const u of s.units) if (u.side === side && alive(u)) u.hp = Math.min(hero(u.hero).hp, u.hp + 50);
      return true;
    case 'volley':
      for (const u of s.units) if (u.side !== side && alive(u)) u.hp -= 30;
      return true;
    case 'fortify':
      me.nexus = Math.min(NEXUS_HP, me.nexus + 40);
      return true;
    case 'warcry':
      me.buffs.dmg += 25;
      return true;
    case 'haste':
      me.buffs.speed += 30;
      return true;
    case 'gambit': {
      // Card luck draws from its own stream, so the outcome is the same no matter how combat rolled.
      const won = chance(s.rng.cards, 500);
      if (won) s.sides[foe(side)].nexus = Math.max(1, s.sides[foe(side)].nexus - 60);
      return won;
    }
  }
}

function finish(s: MatchState, winner: Side | 'draw'): void {
  s.phase = 'over';
  s.winner = winner;
  s.events.push({ type: 'phase', phase: 'over', round: s.round });
}

/** FNV-1a over the canonical JSON form; equal hashes on two machines mean no desync. */
export function hashState(s: MatchState): string {
  const text = JSON.stringify(s);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}
