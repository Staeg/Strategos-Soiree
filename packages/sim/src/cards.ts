import { N_CELLS, distance } from './board.ts';
import { CARDS_KEPT, CARD_OWNER, FIGHT_EVERY, ROLE_LANE, cardDef, heroDef, isArmed, type CardOp } from './content.ts';
import { alive, atBase, foe, heal, kill, maxHp, mitigate, stats } from './hero.ts';
import { damageStructure } from './map.ts';
import { addBoon, addCharge, heroSeen, shadowCell } from './powers.ts';
import { randInt } from './rng.ts';
import { visibility } from './vision.ts';
import type { Engagement, Fizzle, Hero, MatchState, Play, Structure } from './types.ts';

/** In `pending`, the batch of every play at once: motion and strategy have no initiative. */
export const ALL_AT_ONCE = -1;

/**
 * Resolves every play at the next initiative (or all of them, for
 * ALL_AT_ONCE). Plays in one batch are simultaneous: all of them are checked
 * and aimed against the state as it stood before any of them, and only then
 * applied, so none can change what another does. Engages at one initiative
 * that share a hero become a single engagement as long as all of them together.
 */
export function resolveNext(s: MatchState): void {
  const initiative = s.pending.shift()!;
  s.initiative = initiative;
  const plays = s.sides.flatMap((side) => side.plays.filter((p) => initiative === ALL_AT_ONCE || cardDef(p.card).initiative === initiative));
  const seen = [visibility(s, 0), visibility(s, 1)] as const;
  const aimed = plays.map((p) => (p.cancelled ? 'cancelled' : aim(s, p, initiative, seen[p.side])));
  const engages: Aimed[] = [];
  aimed.forEach((a, i) => {
    const play = plays[i]!;
    s.events.push({ type: 'card', play, fizzle: typeof a === 'string' ? a : null });
    if (typeof a !== 'string') {
      for (const op of cardDef(play.card).effect) applyOp(s, play, a, op);
      if (a.members.length) engages.push(a);
    }
    retire(s, play);
  });
  form(s, engages);
}

/** What a play resolved to, fixed before anything at its initiative happens. */
interface Aimed {
  source: Hero;
  target: Hero | null;
  structure: Structure | null;
  /** For an Engage: who it pulls in, where, for how long. Where a hero moves to, too. */
  members: number[];
  cell: number;
  length: number;
  duel: boolean;
}

function aim(s: MatchState, p: Play, initiative: number, seen: boolean[]): Aimed | Fizzle {
  const def = cardDef(p.card);
  const source = s.heroes[p.source];
  const rewind = def.effect.some((op) => op.op === 'rewind');
  if (!source || source.side !== p.side) return 'source';
  if (!rewind && (!alive(source) || (def.keywords.includes('Bound') && atBase(source)))) return 'source';
  if (def.keywords.includes('Bound') && CARD_OWNER[p.card] !== source.id) return 'source';

  let target: Hero | null = null;
  let structure: Structure | null = null;
  if (p.target.kind === 'hero') {
    target = s.heroes[p.target.uid] ?? null;
    if (!target || !alive(target)) return 'target';
    const enemy = def.aim === 'enemy' || def.aim === 'siege';
    if (enemy && (target.side === p.side || !heroSeen(s, p.side, target, seen))) return 'target';
    if (def.aim === 'ally' && target.side !== p.side) return 'target';
  } else if (p.target.kind === 'cell' && def.aim === 'cell') {
    if (!(p.target.cell >= 0 && p.target.cell < N_CELLS)) return 'target';
  } else if (p.target.kind === 'cell') {
    const cell = p.target.cell;
    structure = s.structures.find((x) => x.cell === cell && x.hp > 0) ?? null;
    if (!structure) return 'target';
    if (def.aim === 'tower' && structure.side !== p.side) return 'target';
    if (def.aim === 'siege' && structure.side === p.side) return 'target';
  } else if (def.aim !== 'none') return 'target';

  const out: Aimed = { source, target, structure, members: [], cell: -1, length: 0, duel: false };
  for (const op of def.effect) {
    switch (op.op) {
      case 'engage': {
        if (!target) return 'target';
        if (target.fx.evadeAfter < initiative) return 'evaded';
        if (op.below !== undefined && target.hp * 100 >= maxHp(target) * op.below) return 'target';
        const gap = distance(source.cell, target.cell) - (target.stance === 'aggressive' ? 1 : 0);
        if (gap > op.reach) return 'reach';
        out.members = op.duel
          ? [source.uid, target.uid]
          : s.heroes.filter((h) => alive(h) && (h === source || h === target || !h.fx.aloof) && (h.cell === source.cell || h.cell === target!.cell)).map((h) => h.uid);
        out.cell = op.pull ? source.cell : target.cell;
        out.length = op.length;
        out.duel = op.duel === true;
        break;
      }
      case 'strike': case 'unwrite':
        if (!target) return 'target';
        if (distance(source.cell, target.cell) > op.reach) return 'reach';
        break;
      case 'evade':
        if (op.reach !== undefined && (!target || distance(source.cell, target.cell) > op.reach)) return 'reach';
        break;
      case 'shell':
        if (distance(source.cell, target?.cell ?? structure!.cell) > op.reach) return 'reach';
        break;
      case 'shadowStep':
        out.cell = shadowCell(source);
        if (out.cell < 0) return 'none';
        break;
      case 'move': {
        const to = (p.target as { cell: number }).cell;
        if (to === source.cell || distance(source.cell, to) > op.reach) return 'reach';
        out.cell = to;
        break;
      }
      case 'beacon':
        if (!target || target === source) return 'target';
        out.cell = source.cell;
        break;
      default:
        break;
    }
  }
  return out;
}

function applyOp(s: MatchState, p: Play, a: Aimed, op: CardOp): void {
  const src = a.source;
  const until = s.mapTick + FIGHT_EVERY;
  if (isArmed(op)) return void src.fx.armed.push({ op, target: a.target?.uid ?? -1 });
  switch (op.op) {
    case 'engage':
      return;
    case 'evade': {
      const h = op.reach === undefined ? src : a.target!;
      h.fx.evadeAfter = Math.min(h.fx.evadeAfter, cardDef(p.card).initiative);
      if (op.reach !== undefined) h.fx.aloof = true;
      return;
    }
    case 'heal': {
      const who = op.reach === undefined ? [src] : s.heroes.filter((h) => h.side === src.side && alive(h) && distance(h.cell, src.cell) <= op.reach!);
      for (const h of who) heal(s, h, Math.floor((maxHp(h) * op.pct) / 100));
      return;
    }
    case 'guardTower':
      a.structure!.guardedUntil = until;
      return;
    case 'shield':
      (a.target ?? src).fx.shield += op.amount;
      return;
    case 'strike':
    case 'shell': {
      if (a.structure) return damageStructure(s, s.structures.indexOf(a.structure), op.amount);
      const t = a.target!;
      if (!alive(t)) return;
      const amount = mitigate(op.amount, stats(t).res + t.fx.res);
      t.hp -= amount;
      s.events.push({ type: 'hurt', uid: t.uid, amount, by: 'card' });
      if (t.hp <= 0) kill(s, t, [src]);
      return;
    }
    case 'charge':
      return addCharge(s, src, op.n, op.max);
    case 'rewind': {
      const o = src.origin;
      if (o.respawnAt >= 0) return;
      if (!alive(src)) {
        src.respawnAt = -1;
        s.events.push({ type: 'respawn', uid: src.uid });
      }
      src.hp = Math.min(o.hp, maxHp(src));
      src.cell = o.cell;
      src.retreating = false;
      return;
    }
    case 'shadowStep':
    case 'move':
      src.cell = a.cell;
      return;
    case 'nightfall':
      s.sides[foe(src.side)].blindUntil = until;
      return;
    case 'cancel': {
      const now = cardDef(p.card).initiative;
      let best: Play | undefined;
      for (const q of s.sides[foe(p.side)].plays) {
        const d = cardDef(q.card);
        if (q.cancelled || d.initiative <= now) continue;
        const b = best && cardDef(best.card);
        if (!b || d.cost > b.cost || (d.cost === b.cost && d.initiative >= b.initiative)) best = q;
      }
      if (best) best.cancelled = true;
      return;
    }
    case 'unwrite':
      a.target!.mapReadyAt = Math.max(a.target!.mapReadyAt, until);
      return;
    case 'squeeze': {
      const rival = s.sides[foe(p.side)];
      const loose = () => rival.hand.flatMap((id, i) => (cardDef(id).keywords.includes('Ultimate') ? [] : [i]));
      while (loose().length > CARDS_KEPT - 1) {
        const pool = loose();
        const [id] = rival.hand.splice(pool[randInt(s.rng.cards, pool.length)]!, 1);
        rival.discard.push(id!);
      }
      return;
    }
    case 'rally':
      return addBoon(src, op.where === 'cell'
        ? { kind: 'rallyCell', value: 1, until }
        : { kind: 'rallyLane', value: Math.max(0, ROLE_LANE[src.role]) + 1, until });
    case 'clear':
      return addBoon(src, { kind: 'clear', value: op.n, until });
    case 'cadence':
      return addBoon(src, { kind: 'cadence', value: op.every, until });
    case 'beacon':
      a.target!.cell = a.cell;
      a.target!.retreating = false;
      return;
  }
}

/**
 * Turns this initiative's engages into engagements. Engages that share a hero
 * merge, and the merged fight lasts as long as all of them added up. A hero
 * still in an unfought engagement (only when fights wait for every card)
 * drags it in too.
 */
function form(s: MatchState, engages: Aimed[]): void {
  const group = engages.map((_, i) => i);
  const root = (i: number): number => (group[i] === i ? i : (group[i] = root(group[i]!)));
  engages.forEach((a, i) => engages.forEach((b, j) => {
    if (j > i && a.members.some((uid) => b.members.includes(uid))) group[root(j)] = root(i);
  }));
  engages.forEach((lead, i) => {
    if (root(i) !== i) return;
    const parts = engages.filter((_, j) => root(j) === i);
    const members = [...new Set(parts.flatMap((a) => a.members))].filter((uid) => alive(s.heroes[uid]!));
    const length = parts.reduce((t, a) => t + a.length, 0);
    const sealed = parts.length === 1 && lead.duel;
    const touching = s.engagements.filter((e) => !e.over && !e.started && e.members.some((uid) => members.includes(uid)));
    const into: Engagement = touching[0] ?? { id: s.engagements.length, cell: lead.cell, members: [], squads: [], length: 0, sealed, started: false, over: false };
    if (!touching.length) s.engagements.push(into);
    for (const other of touching.slice(1)) {
      into.members.push(...other.members);
      into.length = Math.max(into.length, other.length);
      other.members = [];
      other.over = true;
    }
    if (touching.length) into.sealed = false;
    into.length = Math.max(into.length, length);
    for (const uid of members) if (!into.members.includes(uid)) into.members.push(uid);
    into.members.sort((x, y) => x - y);
    for (const uid of into.members) {
      const h = s.heroes[uid]!;
      h.fx.engagement = into.id;
      h.cell = into.cell;
    }
    s.events.push({ type: 'engage', id: into.id, cell: into.cell, members: [...into.members] });
  });
}

/** Spent cards go to the discard pile; ultimates go back on cooldown instead. */
function retire(s: MatchState, p: Play): void {
  const def = cardDef(p.card);
  if (!def.keywords.includes('Ultimate')) return void s.sides[p.side].discard.push(p.card);
  const owner = s.heroes.find((h) => h.side === p.side && h.id === CARD_OWNER[p.card]);
  const ult = owner && heroDef(owner.id).ult;
  if (owner && ult && 'cooldown' in ult) owner.ultReadyAt = s.fightPhase + ult.cooldown;
}
