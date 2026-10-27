import { AGGRESSIVE_LENGTH, heroDef, type FightOp, type Trigger } from './content.ts';
import { alive, foe, idiv, kill, maxHp, mitigate, stats } from './hero.ts';
import { randInt, shuffle } from './rng.ts';
import type { Engagement, Hit, Hero, MatchState, Side } from './types.ts';

/**
 * Engagements, in fight ticks. Every engagement starts at fight tick 0 and
 * they all run side by side. A hero takes a turn every ceil(100 / SPD)
 * ticks; one step of the sim jumps straight to the next tick in which
 * somebody acts, so empty ticks cost nothing and are never animated. Heroes
 * acting on the same tick go in a random order.
 */
export function startClash(s: MatchState): void {
  s.phase = 'clash';
  s.fightTick = 0;
  for (const e of s.engagements) {
    if (e.over) continue;
    e.length += AGGRESSIVE_LENGTH * e.members.filter((uid) => s.heroes[uid]!.stance === 'aggressive').length;
    for (const uid of e.members) {
      const h = s.heroes[uid]!;
      h.fx.turns = 0;
      h.fx.nextTurn = interval(h);
    }
  }
  s.events.push({ type: 'phase', phase: 'clash' });
}

const speed = (h: Hero): number => Math.max(1, stats(h).spd + h.fx.spd);
const interval = (h: Hero): number => Math.ceil(100 / speed(h));
const living = (s: MatchState, e: Engagement, side?: Side): Hero[] =>
  e.members.map((uid) => s.heroes[uid]!).filter((h) => alive(h) && (side === undefined || h.side === side));

/** Plays the next fight tick in which anything happens. Returns false once every engagement is over. */
export function clashStep(s: MatchState): boolean {
  let t = Infinity;
  for (const e of s.engagements) {
    if (e.over) continue;
    const next = Math.min(...living(s, e).map((h) => h.fx.nextTurn));
    if (next > e.length || !living(s, e, 0).length || !living(s, e, 1).length) close(s, e);
    else t = Math.min(t, next);
  }
  if (t === Infinity) return false;
  s.fightTick = t;
  const turns: [Hero, Engagement][] = [];
  for (const e of s.engagements) {
    if (!e.over) for (const h of living(s, e)) if (h.fx.nextTurn === t) turns.push([h, e]);
  }
  for (const [h, e] of shuffle(s.rng.fight, turns)) if (alive(h) && !e.over) turn(s, h, e);
  return true;
}

function close(s: MatchState, e: Engagement): void {
  e.over = true;
  s.events.push({ type: 'disengage', id: e.id });
}

/** A turn: a triggered ultimate if one fires, else the fight ability on its turn, else a basic attack. */
function turn(s: MatchState, h: Hero, e: Engagement): void {
  h.fx.turns++;
  h.fx.nextTurn = s.fightTick + interval(h);
  const def = heroDef(h.id);
  const ult = def.ult;
  let kind: 'attack' | 'ability' | 'ult' = 'attack';
  let hits: Hit[] | null = null;
  if (ult.kind === 'trigger' && s.fightPhase >= h.ultReadyAt && triggered(s, h, e, ult.when)) {
    hits = fightOp(s, h, e, ult.op);
    if (hits) [kind, h.ultReadyAt] = ['ult', s.fightPhase + ult.cooldown];
  }
  if (!hits && h.fx.turns % def.fight.every === 0) {
    hits = fightOp(s, h, e, def.fight.op);
    if (hits) kind = 'ability';
  }
  if (!hits) {
    const target = pick(s, h, e, 'target');
    if (!target) return;
    kind = 'attack';
    hits = [damage(target, power(s, h))];
  }
  s.events.push({ type: 'act', uid: h.uid, kind, hits });

  for (const v of e.members.map((uid) => s.heroes[uid]!)) {
    if (alive(v) && v.hp <= 0) kill(s, v, living(s, e, foe(v.side)));
  }
  if (living(s, e, 0).length === 0 || living(s, e, 1).length === 0) close(s, e);
}

function triggered(s: MatchState, h: Hero, e: Engagement, when: Trigger): boolean {
  const low = (x: Hero) => x.hp * 100 < maxHp(x) * when.pct;
  return when.on === 'selfBelow' ? low(h) : living(s, e, h.side).some(low);
}

function power(s: MatchState, h: Hero): number {
  const surge = s.fightTick <= h.fx.surgeUntil ? h.fx.surgePct : 0;
  return idiv(stats(h).dmg * (100 + h.fx.dmgPct + surge), 100);
}

function pick(s: MatchState, h: Hero, e: Engagement, how: 'target' | 'weakest'): Hero | undefined {
  const foes = living(s, e, foe(h.side));
  if (!foes.length) return undefined;
  if (how === 'weakest') return foes.reduce((a, b) => (b.hp < a.hp ? b : a));
  return foes.find((f) => f.uid === h.fx.focus) ?? foes[randInt(s.rng.fight, foes.length)];
}

function damage(target: Hero, raw: number): Hit {
  const dealt = mitigate(raw, stats(target).res + target.fx.res);
  const shield = Math.min(target.fx.shield, dealt);
  target.fx.shield -= shield;
  target.hp -= dealt - shield;
  return { uid: target.uid, amount: dealt - shield, shield };
}

/** A fight op, or null when the hero is unable or unwilling (nobody to heal, say). */
function fightOp(s: MatchState, h: Hero, e: Engagement, op: FightOp): Hit[] | null {
  const allies = living(s, e, h.side);
  const scaled = (pct: number) => idiv(power(s, h) * pct, 100);
  switch (op.op) {
    case 'strike': {
      const t = pick(s, h, e, op.pick);
      return t ? [damage(t, scaled(op.pct))] : null;
    }
    case 'cleave': {
      const foes = living(s, e, foe(h.side));
      return foes.length ? foes.map((f) => damage(f, scaled(op.pct))) : null;
    }
    case 'mend': {
      const hurt = allies.filter((a) => a.hp < maxHp(a));
      if (!hurt.length) return null;
      const t = hurt.reduce((a, b) => (b.hp * maxHp(a) < a.hp * maxHp(b) ? b : a));
      const amount = Math.min(scaled(op.pct), maxHp(t) - t.hp);
      t.hp += amount;
      return [{ uid: t.uid, amount: -amount, shield: 0 }];
    }
    case 'guard':
      return (op.who === 'self' ? [h] : allies).map((a) => {
        a.fx.shield += op.amount;
        return { uid: a.uid, amount: 0, shield: op.amount };
      });
    case 'haste':
      return (op.who === 'self' ? [h] : allies).map((a) => {
        a.fx.spd += op.spd;
        return { uid: a.uid, amount: 0, shield: 0 };
      });
  }
}
