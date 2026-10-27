import { CORE, LANES, LANES_AT, NEIGHBOURS, distance } from './board.ts';
import { AGGRESSIVE_LENGTH, SQUAD_MINION, heroDef, type ArmedOp, type FightOp, type TriggerOp } from './content.ts';
import { alive, foe, heal, idiv, kill, maxHp, mitigate, stats } from './hero.ts';
import { nearestJungle } from './powers.ts';
import { randInt, shuffle } from './rng.ts';
import type { Armed, Engagement, FightFx, Hit, Hero, MatchState, Side, Squad } from './types.ts';

/**
 * Engagements, in fight ticks. The engagements that have just formed start
 * together at fight tick 0 and run side by side. A hero takes a turn every
 * ceil(100 / SPD) ticks; one step of the sim jumps straight to the next tick
 * in which somebody acts, so empty ticks cost nothing and are never animated.
 * Heroes acting on the same tick go in a random order.
 */
export function startClash(s: MatchState): void {
  s.phase = 'clash';
  s.fightTick = 0;
  const fresh = s.engagements.filter((e) => !e.over && !e.started);
  joinUp(s, fresh);
  for (const e of fresh) {
    e.started = true;
    e.length += AGGRESSIVE_LENGTH * e.members.filter((uid) => s.heroes[uid]!.stance === 'aggressive').length;
    for (const uid of e.members) {
      const h = s.heroes[uid]!;
      h.fx.turns = 0;
      h.fx.lastTurn = 0;
      h.fx.nextTurn = interval(s, h);
    }
    for (const uid of e.members) for (const a of take(s.heroes[uid]!)) arm(s, s.heroes[uid]!, e, a);
  }
  s.events.push({ type: 'phase', phase: 'clash' });
}

/** Heroes holding a Join step into the nearest allied engagement in reach that is about to start. */
function joinUp(s: MatchState, fresh: Engagement[]): void {
  for (const h of s.heroes) {
    const i = h.fx.armed.findIndex((a) => a.op.op === 'join');
    if (i < 0 || !alive(h) || h.fx.engagement >= 0) continue;
    const reach = (h.fx.armed[i]!.op as { reach: number }).reach - (h.stance === 'aggressive' ? 1 : 0);
    let best: Engagement | undefined;
    for (const e of fresh) {
      if (e.sealed || !e.members.some((uid) => s.heroes[uid]!.side === h.side)) continue;
      const d = distanceTo(h, e);
      if (d <= reach && (!best || d < distanceTo(h, best))) best = e;
    }
    if (!best) continue;
    h.fx.armed.splice(i, 1);
    best.members.push(h.uid);
    best.members.sort((a, b) => a - b);
    h.fx.engagement = best.id;
    h.cell = best.cell;
    s.events.push({ type: 'engage', id: best.id, cell: best.cell, members: [...best.members] });
  }
}

const distanceTo = (h: Hero, e: Engagement) => distance(h.cell, e.cell);

function take(h: Hero): Armed[] {
  const armed = h.fx.armed;
  h.fx.armed = [];
  return armed;
}

/** A waiting card effect lands as its hero's engagement starts. */
function arm(s: MatchState, h: Hero, e: Engagement, { op, target }: { op: ArmedOp; target: number }): void {
  const fx = h.fx;
  const allies = living(s, e, h.side);
  const t = s.heroes[target];
  const inFight = t !== undefined && e.members.includes(t.uid) && alive(t);
  switch (op.op) {
    case 'join':
      return;
    case 'empower':
      for (const a of op.who === 'source' ? [h] : allies) {
        if (op.ticks) [a.fx.surgePct, a.fx.surgeUntil] = [a.fx.surgePct + (op.dmgPct ?? 0), Math.max(a.fx.surgeUntil, op.ticks)];
        else a.fx.dmgPct += op.dmgPct ?? 0;
        a.fx.res += op.res ?? 0;
        a.fx.spd += op.spd ?? 0;
      }
      return;
    case 'focus':
      if (inFight) for (const a of allies) [a.fx.focus, a.fx.focusUntil] = [t!.uid, op.ticks];
      return;
    case 'slow':
      for (const v of op.who === 'target' ? (inFight ? [t!] : []) : living(s, e, foe(h.side))) {
        v.fx.slowPct = Math.max(v.fx.slowPct, op.pct ?? 0);
        v.fx.slowSpd += op.spd ?? 0;
        v.fx.slowUntil = Math.max(v.fx.slowUntil, op.ticks);
        v.fx.nextTurn = interval(s, v);
      }
      return;
    case 'expose':
      if (inFight) [t!.fx.exposePct, t!.fx.exposeUntil] = [t!.fx.exposePct + op.pct, Math.max(t!.fx.exposeUntil, op.ticks)];
      return;
    case 'quick':
      fx.nextTurn = 1;
      return;
    case 'fade':
      fx.fadeAt = op.tick;
      return;
    case 'firstHit':
      fx.firstHitPct = Math.max(fx.firstHitPct, op.pct);
      return;
    case 'opening':
      fx.opening = true;
      return;
    case 'procession': {
      let left = op.n;
      const cells = [h.cell, ...NEIGHBOURS[h.cell]!.filter((c) => c >= 0)];
      for (const m of s.minions) {
        if (left === 0) break;
        if (m.side !== h.side || !cells.includes(LANES[m.lane][m.pos]!)) continue;
        const k = Math.min(left, m.n);
        m.n -= k;
        left -= k;
      }
      const drafted = op.n - left;
      if (drafted > 0) e.squads.push({ side: h.side, hp: new Array<number>(drafted).fill(SQUAD_MINION.hp), nextTurn: squadInterval });
      return;
    }
  }
}

const squadInterval = Math.ceil(100 / SQUAD_MINION.spd);

function speed(s: MatchState, h: Hero): number {
  const slowed = s.fightTick < h.fx.slowUntil;
  const flat = Math.max(1, stats(h).spd + h.fx.spd - (slowed ? h.fx.slowSpd : 0));
  return Math.max(1, idiv(flat * (100 - (slowed ? h.fx.slowPct : 0)), 100));
}
const interval = (s: MatchState, h: Hero): number => s.fightTick + Math.ceil(100 / speed(s, h));
const living = (s: MatchState, e: Engagement, side?: Side): Hero[] =>
  e.members.map((uid) => s.heroes[uid]!).filter((h) => alive(h) && (side === undefined || h.side === side));

/** Plays the next fight tick in which anything happens. Returns false once every engagement is over. */
export function clashStep(s: MatchState): boolean {
  let t = Infinity;
  for (const e of s.engagements) {
    if (e.over || !e.started) continue;
    const next = Math.min(...living(s, e).map((h) => h.fx.nextTurn), ...e.squads.map((q) => q.nextTurn));
    if (next > e.length || !living(s, e, 0).length || !living(s, e, 1).length) close(s, e);
    else t = Math.min(t, next);
  }
  if (t === Infinity) return false;
  s.fightTick = t;
  const turns: [Hero | Squad, Engagement][] = [];
  for (const e of s.engagements) {
    if (e.over || !e.started) continue;
    for (const h of living(s, e)) {
      if (h.fx.fadeAt >= 0 && t > h.fx.fadeAt) leave(s, e, h);
      else if (h.fx.nextTurn === t) turns.push([h, e]);
    }
    for (const q of e.squads) if (q.nextTurn === t) turns.push([q, e]);
  }
  for (const [x, e] of shuffle(s.rng.fight, turns)) {
    if (e.over) continue;
    if ('uid' in x) { if (alive(x)) turn(s, x, e); }
    else squadTurn(s, x, e);
  }
  return true;
}

function close(s: MatchState, e: Engagement): void {
  e.over = true;
  for (const h of e.members.map((uid) => s.heroes[uid]!)) {
    if (alive(h) && h.fx.undying) {
      h.hp = Math.max(1, h.hp);
      h.cell = CORE[h.side];
      h.retreating = true;
    }
    calm(h);
  }
  for (const q of e.squads) {
    const lane = LANES_AT[e.cell]![0];
    const n = q.hp.filter((hp) => hp > 0).length;
    if (lane !== undefined && n > 0) s.minions.push({ lane, pos: LANES[lane].indexOf(e.cell), side: q.side, n });
  }
  s.events.push({ type: 'disengage', id: e.id });
}

/** Clears everything that lasts only for one engagement. */
function calm(h: Hero): void {
  const { shield, evadeAfter, aloof, armed, opening } = h.fx;
  h.fx = { ...freshFx(), shield, evadeAfter, aloof, armed, opening };
}

export const freshFx = (): FightFx => ({
  engagement: -1, shield: 0, evadeAfter: 99, aloof: false, armed: [], opening: false,
  dmgPct: 0, surgePct: 0, surgeUntil: 0, res: 0, spd: 0, focus: -1, focusUntil: 0,
  slowPct: 0, slowSpd: 0, slowUntil: 0, exposePct: 0, exposeUntil: 0, firstHitPct: 0, fadeAt: -1,
  swooned: false, muted: 0, undying: false, burn: 0, nextTurn: 0, lastTurn: 0, turns: 0,
});

/** Fade: the hero slips out to the nearest jungle cell. */
function leave(s: MatchState, e: Engagement, h: Hero): void {
  e.members = e.members.filter((uid) => uid !== h.uid);
  h.cell = nearestJungle(e.cell);
  calm(h);
  s.events.push({ type: 'engage', id: e.id, cell: e.cell, members: [...e.members] });
}

/**
 * A turn: a swoon spends it on an ally; otherwise the fight ability on its
 * turn (unless muted or unable), else a basic attack.
 */
function turn(s: MatchState, h: Hero, e: Engagement): void {
  const fx = h.fx;
  if (fx.burn > 0) h.hp = Math.max(1, h.hp - idiv(maxHp(h) * fx.burn * (s.fightTick - fx.lastTurn), 100));
  fx.turns++;
  fx.lastTurn = s.fightTick;
  fx.nextTurn = interval(s, h);
  const def = heroDef(h.id);
  let kind: 'attack' | 'ability' = 'attack';
  let hits: Hit[] | null = null;
  let again = false;

  if (fx.swooned) {
    fx.swooned = false;
    const friends = living(s, e, h.side).filter((a) => a !== h);
    const friend = friends.length ? friends[randInt(s.rng.fight, friends.length)]! : undefined;
    s.events.push({ type: 'act', uid: h.uid, kind, hits: friend ? [damage(s, friend, power(s, h))] : [] });
    return aftermath(s, e);
  }
  if (fx.opening || fx.turns % def.fight.every === 0) {
    fx.opening = false;
    if (fx.muted > 0) fx.muted--;
    else {
      const out = fightOp(s, h, e, def.fight.op);
      if (out) [hits, again, kind] = [out.hits, out.again, 'ability'];
    }
  }
  if (!hits) {
    const sweep = h.ascended && def.ult.kind === 'ascension' && def.ult.sweep;
    if (sweep) hits = [...living(s, e, foe(h.side)).map((f) => damage(s, f, power(s, h))), ...squadHits(s, e, foe(h.side), power(s, h))];
    else hits = basic(s, h, e, power(s, h));
    if (!hits.length) return;
  }
  s.events.push({ type: 'act', uid: h.uid, kind, hits });
  aftermath(s, e);
  if (again && alive(h) && !e.over) turn(s, h, e);
}

/** A basic attack on the focus, else on a random enemy hero or drafted minion. */
function basic(s: MatchState, h: Hero, e: Engagement, raw: number): Hit[] {
  const focus = s.fightTick <= h.fx.focusUntil ? living(s, e, foe(h.side)).find((f) => f.uid === h.fx.focus) : undefined;
  if (focus) return [damage(s, focus, raw)];
  const foes = living(s, e, foe(h.side));
  const minions = e.squads.flatMap((q) => (q.side === h.side ? [] : q.hp.flatMap((hp, i) => (hp > 0 ? [[q, i] as const] : []))));
  const n = foes.length + minions.length;
  if (n === 0) return [];
  const k = randInt(s.rng.fight, n);
  if (k < foes.length) return [damage(s, foes[k]!, raw)];
  const [q, i] = minions[k - foes.length]!;
  return [hitMinion(q, i, raw)];
}

function hitMinion(q: Squad, i: number, raw: number): Hit {
  const dealt = mitigate(raw, SQUAD_MINION.res);
  q.hp[i]! -= dealt;
  return { uid: -1, amount: dealt, shield: 0 };
}

function squadHits(s: MatchState, e: Engagement, side: Side, raw: number): Hit[] {
  return e.squads.filter((q) => q.side === side).flatMap((q) => q.hp.flatMap((hp, i) => (hp > 0 ? [hitMinion(q, i, raw)] : [])));
}

/** Every drafted minion strikes a random enemy hero. */
function squadTurn(s: MatchState, q: Squad, e: Engagement): void {
  q.nextTurn = s.fightTick + squadInterval;
  const hits: Hit[] = [];
  for (const hp of q.hp) {
    const foes = living(s, e, foe(q.side));
    if (hp <= 0 || !foes.length) continue;
    hits.push(damage(s, foes[randInt(s.rng.fight, foes.length)]!, SQUAD_MINION.dmg));
  }
  s.events.push({ type: 'squad', id: e.id, side: q.side, hits });
  aftermath(s, e);
}

/** After any blow: triggered ultimates react, the fallen fall, the drafted dead are cleared. */
function aftermath(s: MatchState, e: Engagement): void {
  const members = e.members.map((uid) => s.heroes[uid]!);
  for (const h of members) {
    const ult = heroDef(h.id).ult;
    if (ult.kind !== 'trigger' || !alive(h) || s.fightPhase < h.ultReadyAt) continue;
    const when = ult.when;
    let subject: Hero | undefined;
    if (when.on === 'selfBelow' && !h.fx.undying && h.hp * 100 < maxHp(h) * when.pct) subject = h;
    if (when.on === 'allyDying') subject = members.find((a) => a.side === h.side && alive(a) && a.hp <= 0 && !a.fx.undying);
    if (!subject) continue;
    triggerOp(s, h, subject, ult.op);
    h.ultReadyAt = s.fightPhase + ult.cooldown;
    s.events.push({ type: 'act', uid: h.uid, kind: 'ult', hits: [] });
  }
  for (const v of members) {
    if (alive(v) && v.fx.undying) v.hp = Math.max(1, v.hp);
    else if (alive(v) && v.hp <= 0) kill(s, v, living(s, e, foe(v.side)));
  }
  for (const q of e.squads) q.hp = q.hp.filter((hp) => hp > 0);
  e.squads = e.squads.filter((q) => q.hp.length > 0);
  if (living(s, e, 0).length === 0 || living(s, e, 1).length === 0) close(s, e);
}

export function triggerOp(s: MatchState, h: Hero, subject: Hero, op: TriggerOp): void {
  switch (op.op) {
    case 'undying':
      subject.fx.undying = true;
      subject.fx.dmgPct += op.dmgPct;
      subject.fx.burn = op.burn;
      subject.hp = Math.max(1, subject.hp);
      return;
    case 'reprieve':
      subject.hp = 0;
      heal(s, subject, idiv(maxHp(subject) * op.pct, 100));
      return;
    case 'tally':
      h.fx.opening = true;
      return;
  }
}

function power(s: MatchState, h: Hero): number {
  const surge = s.fightTick <= h.fx.surgeUntil ? h.fx.surgePct : 0;
  const first = h.fx.firstHitPct || 100;
  h.fx.firstHitPct = 0;
  return idiv(idiv(stats(h).dmg * (100 + h.fx.dmgPct + surge), 100) * first, 100);
}

function pick(s: MatchState, h: Hero, e: Engagement, how: FightOpPick): Hero | undefined {
  const foes = living(s, e, foe(h.side));
  if (!foes.length) return undefined;
  if (how === 'weakest') return foes.reduce((a, b) => (b.hp < a.hp ? b : a));
  if (how === 'fastest') return foes.reduce((a, b) => (speed(s, b) > speed(s, a) ? b : a));
  const focus = s.fightTick <= h.fx.focusUntil ? foes.find((f) => f.uid === h.fx.focus) : undefined;
  return focus ?? foes[randInt(s.rng.fight, foes.length)];
}
type FightOpPick = Extract<FightOp, { op: 'strike' }>['pick'];

function damage(s: MatchState, target: Hero, raw: number, pierce = false): Hit {
  const exposed = s.fightTick <= target.fx.exposeUntil ? target.fx.exposePct : 0;
  const dealt = mitigate(idiv(raw * (100 + exposed), 100), pierce ? 0 : stats(target).res + target.fx.res);
  const shield = Math.min(target.fx.shield, dealt);
  target.fx.shield -= shield;
  target.hp -= dealt - shield;
  return { uid: target.uid, amount: dealt - shield, shield };
}

/** A fight op, or null when the hero is unable or unwilling (nobody to heal, say). */
function fightOp(s: MatchState, h: Hero, e: Engagement, op: FightOp): { hits: Hit[]; again: boolean } | null {
  const allies = living(s, e, h.side);
  const scaled = (pct: number) => idiv(power(s, h) * pct, 100);
  const done = (hits: Hit[], again = false) => ({ hits, again });
  switch (op.op) {
    case 'strike': {
      const t = pick(s, h, e, op.pick);
      if (!t) return null;
      const hit = damage(s, t, scaled(op.pct + (op.perCharge ?? 0) * h.charge), op.pierce);
      const hits = [hit];
      if (op.spend) h.charge = Math.max(0, h.charge - op.spend);
      if (op.drain) {
        const back = heal(s, h, idiv((hit.amount + hit.shield) * op.drain, 100));
        if (back) hits.push({ uid: h.uid, amount: -back, shield: 0 });
      }
      if (op.toll && h.hp * 2 > maxHp(h)) h.hp = Math.max(1, h.hp - idiv(maxHp(h) * op.toll, 100));
      if (op.daze === 'always' || (op.daze === 'faster' && speed(s, t) > speed(s, h))) t.fx.nextTurn = interval(s, t) + (t.fx.nextTurn - s.fightTick);
      return done(hits, op.again === true && t.hp <= 0);
    }
    case 'cleave': {
      const foes = living(s, e, foe(h.side));
      if (!foes.length) return null;
      const raw = scaled(op.pct);
      return done([...foes.map((f) => damage(s, f, raw)), ...squadHits(s, e, foe(h.side), raw)]);
    }
    case 'mend': {
      const hurt = allies.filter((a) => a.hp < maxHp(a));
      if (!hurt.length) return null;
      const t = hurt.reduce((a, b) => (b.hp * maxHp(a) < a.hp * maxHp(b) ? b : a));
      const amount = Math.min(scaled(op.pct), maxHp(t) - t.hp);
      t.hp += amount;
      t.fx.spd += op.spd ?? 0;
      return done([{ uid: t.uid, amount: -amount, shield: 0 }]);
    }
    case 'ward': {
      const t = allies.reduce((a, b) => (b.hp < a.hp ? b : a));
      const amount = op.amount + scaled(op.pct);
      t.fx.shield += amount;
      return done([{ uid: t.uid, amount: 0, shield: amount }]);
    }
    case 'swoon': {
      const t = pick(s, h, e, 'target');
      if (!t) return null;
      t.fx.swooned = true;
      return done([{ uid: t.uid, amount: 0, shield: 0 }]);
    }
    case 'unmake': {
      const cost = op.cost * living(s, e, foe(h.side)).length;
      const t = pick(s, h, e, 'target');
      if (!t || h.charge < cost) return null;
      h.charge -= cost;
      t.fx.muted++;
      return done([{ uid: t.uid, amount: 0, shield: 0 }]);
    }
  }
}
