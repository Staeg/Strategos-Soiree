import { CORE } from './board.ts';
import { RESPAWN_TICKS, XP_HERO, XP_PER_STAT, XP_UNIT, heroDef } from './content.ts';
import type { Hero, MatchState, Side, Stats } from './types.ts';

/** Small shared helpers: hero arithmetic every phase relies on. */

export const foe = (side: Side): Side => (side === 0 ? 1 : 0);
export const idiv = (a: number, b: number): number => Math.floor(a / b);

export const alive = (h: Hero): boolean => h.respawnAt < 0;
export const atBase = (h: Hero): boolean => h.cell === CORE[h.side];

/** Base stats grown by XP (every XP_PER_STAT points: +1 DMG, +10 HP, +1 RES) and by abilities. */
export function stats(h: Hero): Stats {
  const def = heroDef(h.id);
  const points = idiv(h.xp, XP_UNIT * XP_PER_STAT);
  return {
    dmg: def.stats.dmg + points + h.grown.dmg,
    hp: def.stats.hp + idiv(h.xp * 10, XP_UNIT * XP_PER_STAT),
    res: def.stats.res + points,
    spd: def.stats.spd + h.grown.spd,
  };
}

export const maxHp = (h: Hero): number => stats(h).hp;

/** Resistance as effective HP: 100 RES halves damage taken. */
export const mitigate = (amount: number, res: number): number => Math.max(1, idiv(amount * 100, 100 + Math.max(0, res)));

export function heroesOn(s: MatchState, cell: number, side?: Side): Hero[] {
  return s.heroes.filter((h) => alive(h) && h.cell === cell && (side === undefined || h.side === side));
}

/** Grants XP in units; max HP grows, and current HP grows with it. */
export function gainXp(s: MatchState, h: Hero, units: number): void {
  if (units <= 0) return;
  const before = maxHp(h);
  h.xp += units;
  if (alive(h)) h.hp += maxHp(h) - before;
}

/** `each` points to every receiver, plus `shared` points split evenly between them. */
export function awardXp(s: MatchState, receivers: Hero[], each: number, shared: number): void {
  if (receivers.length === 0) return;
  const split = idiv(shared * XP_UNIT, receivers.length);
  for (const h of receivers) gainXp(s, h, each * XP_UNIT + split);
}

export function heal(s: MatchState, h: Hero, amount: number): number {
  const done = Math.max(0, Math.min(amount, maxHp(h) - h.hp));
  h.hp += done;
  if (done > 0) s.events.push({ type: 'heal', uid: h.uid, amount: done });
  return done;
}

/** Sends a hero home to wait out its respawn; whoever stood over it shares the XP. */
export function kill(s: MatchState, h: Hero, killers: Hero[]): void {
  h.hp = 0;
  h.respawnAt = s.mapTick + RESPAWN_TICKS;
  h.cell = CORE[h.side];
  h.stance = 'passive';
  h.retreating = false;
  h.camp = -1;
  s.events.push({ type: 'death', uid: h.uid });
  awardXp(s, killers, XP_HERO, XP_HERO);
}
