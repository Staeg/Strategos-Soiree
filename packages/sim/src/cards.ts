import { distance } from './board.ts';
import { CARD_OWNER, FIGHT_EVERY, cardDef, heroDef, type CardOp } from './content.ts';
import { alive, atBase, heal, kill, maxHp, mitigate, stats } from './hero.ts';
import { visibility } from './vision.ts';
import type { Engagement, Fizzle, Hero, MatchState, Play } from './types.ts';

/**
 * Resolves every play at the next initiative. Plays that share an initiative
 * are simultaneous: all of them are checked and aimed against the state as it
 * stood before any of them, and only then applied, so none can change what
 * another does.
 */
export function resolveNext(s: MatchState): void {
  const initiative = s.pending.shift()!;
  const plays = s.sides.flatMap((side) => side.plays.filter((p) => cardDef(p.card).initiative === initiative));
  const seen = [visibility(s, 0), visibility(s, 1)] as const;
  const aimed = plays.map((p) => aim(s, p, initiative, seen[p.side]));
  aimed.forEach((a, i) => {
    const play = plays[i]!;
    s.events.push({ type: 'card', play, fizzle: typeof a === 'string' ? a : null });
    if (typeof a !== 'string') apply(s, play, a);
    retire(s, play);
  });
}

/** What a play resolved to, fixed before anything at its initiative happens. */
interface Aimed {
  source: Hero;
  target: Hero | null;
  /** Heroes an Engage pulls in. */
  members: number[];
  /** The engagement a Join enters. */
  joins: number;
  /** Who a Tactic boosts. */
  allies: Hero[];
}

function aim(s: MatchState, p: Play, initiative: number, seen: boolean[]): Aimed | Fizzle {
  const def = cardDef(p.card);
  const source = s.heroes[p.source];
  if (!source || source.side !== p.side || !alive(source)) return 'source';
  if (def.keywords.includes('Bound') && (CARD_OWNER[p.card] !== source.id || atBase(source))) return 'source';

  let target: Hero | null = null;
  if (p.target.kind === 'hero') {
    target = s.heroes[p.target.uid] ?? null;
    if (!target || !alive(target)) return 'target';
    if (def.aim === 'enemy' && (target.side === p.side || !seen[target.cell])) return 'target';
    if (def.aim === 'ally' && target.side !== p.side) return 'target';
  } else if (def.aim === 'enemy' || def.aim === 'ally') return 'target';
  if (def.aim === 'tower') {
    const st = p.target.kind === 'cell' ? s.structures.find((x) => x.cell === (p.target as { cell: number }).cell) : undefined;
    if (!st || st.side !== p.side || st.hp <= 0) return 'target';
  }

  const out: Aimed = { source, target, members: [], joins: -1, allies: [source] };
  for (const op of def.effect) {
    if (op.op === 'engage') {
      if (!target) return 'target';
      if (target.fx.evadeAfter < initiative) return 'evaded';
      const gap = distance(source.cell, target.cell) - (target.stance === 'aggressive' ? 1 : 0);
      if (gap > op.reach) return 'reach';
      out.members = s.heroes.filter((h) => alive(h) && (h.cell === source.cell || h.cell === target!.cell)).map((h) => h.uid);
    } else if (op.op === 'join') {
      if (source.fx.engagement >= 0) return 'engaged';
      const reach = op.reach - (source.stance === 'aggressive' ? 1 : 0);
      let best: Engagement | undefined;
      for (const e of s.engagements) {
        if (!e.members.some((uid) => s.heroes[uid]!.side === p.side)) continue;
        const d = distance(source.cell, e.cell);
        if (d <= reach && (!best || d < distance(source.cell, best.cell))) best = e;
      }
      if (!best) return 'none';
      out.joins = best.id;
    } else if (op.op === 'empower' && op.who === 'engagement') {
      const e = s.engagements.find((x) => x.id === source.fx.engagement);
      if (!e) return 'none';
      out.allies = e.members.filter((uid) => s.heroes[uid]!.side === p.side).map((uid) => s.heroes[uid]!);
    } else if (op.op === 'strike') {
      if (!target) return 'target';
      if (distance(source.cell, target.cell) > op.reach) return 'reach';
    }
  }
  return out;
}

function apply(s: MatchState, p: Play, a: Aimed): void {
  for (const op of cardDef(p.card).effect) applyOp(s, p, a, op);
}

function applyOp(s: MatchState, p: Play, a: Aimed, op: CardOp): void {
  const fx = a.source.fx;
  switch (op.op) {
    case 'engage':
      return engage(s, a.members, a.target!.cell, op.length);
    case 'join': {
      const e = s.engagements.find((x) => x.id === a.joins)!;
      if (a.source.fx.engagement >= 0) return;
      e.members.push(a.source.uid);
      a.source.fx.engagement = e.id;
      a.source.cell = e.cell;
      return;
    }
    case 'evade':
      fx.evadeAfter = Math.min(fx.evadeAfter, cardDef(p.card).initiative);
      return;
    case 'afterHeal':
      fx.afterHeal += op.pct;
      return;
    case 'guardTower': {
      const cell = (p.target as { cell: number }).cell;
      const st = s.structures.find((x) => x.cell === cell)!;
      st.guardedUntil = s.mapTick + FIGHT_EVERY;
      return;
    }
    case 'empower':
      for (const h of a.allies) {
        if (op.ticks) [h.fx.surgePct, h.fx.surgeUntil] = [h.fx.surgePct + (op.dmgPct ?? 0), Math.max(h.fx.surgeUntil, op.ticks)];
        else h.fx.dmgPct += op.dmgPct ?? 0;
        h.fx.res += op.res ?? 0;
        h.fx.spd += op.spd ?? 0;
      }
      return;
    case 'shield':
      (a.target ?? a.source).fx.shield += op.amount;
      return;
    case 'strike': {
      const t = a.target!;
      if (!alive(t)) return;
      const amount = mitigate(op.amount, stats(t).res + t.fx.res);
      t.hp -= amount;
      s.events.push({ type: 'hurt', uid: t.uid, amount, by: 'card' });
      if (t.hp <= 0) kill(s, t, [a.source]);
      return;
    }
    case 'focus':
      for (const h of a.allies) h.fx.focus = a.target!.uid;
      return;
  }
}

/**
 * Starts an engagement on `cell` with every listed hero. Anyone already in a
 * fight drags that fight in too: overlapping engagements merge into one.
 */
function engage(s: MatchState, uids: number[], cell: number, length: number): void {
  const members = uids.filter((uid) => alive(s.heroes[uid]!));
  const touching = s.engagements.filter((e) => e.members.some((uid) => members.includes(uid)));
  const into: Engagement = touching[0] ?? { id: s.engagements.length, cell, members: [], length, over: false };
  if (!touching.length) s.engagements.push(into);
  for (const other of touching.slice(1)) {
    into.members.push(...other.members);
    into.length = Math.max(into.length, other.length);
    other.members = [];
    other.over = true;
  }
  into.length = Math.max(into.length, length);
  for (const uid of members) if (!into.members.includes(uid)) into.members.push(uid);
  into.members.sort((a, b) => a - b);
  for (const uid of into.members) {
    const h = s.heroes[uid]!;
    h.fx.engagement = into.id;
    h.cell = into.cell;
  }
  s.events.push({ type: 'engage', id: into.id, cell: into.cell, members: [...into.members] });
}

/** Spent cards go to the discard pile; ultimates go back on cooldown instead. */
function retire(s: MatchState, p: Play): void {
  const def = cardDef(p.card);
  if (!def.keywords.includes('Ultimate')) return void s.sides[p.side].discard.push(p.card);
  const owner = s.heroes.find((h) => h.side === p.side && h.id === CARD_OWNER[p.card]);
  const ult = owner && heroDef(owner.id).ult;
  if (owner && ult && 'cooldown' in ult) owner.ultReadyAt = s.fightPhase + ult.cooldown;
}

/** Once every engagement is over: delayed heals land and fight-phase effects lapse. */
export function settle(s: MatchState): void {
  for (const h of s.heroes) {
    if (alive(h) && h.fx.afterHeal > 0) heal(s, h, Math.floor((maxHp(h) * h.fx.afterHeal) / 100));
  }
}
