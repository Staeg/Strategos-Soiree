import { distance } from './board.ts';
import { CARD_OWNER, cardDef, type CardId, type CardOp } from './content.ts';
import { alive, atBase, maxHp } from './hero.ts';
import { shadowCell } from './powers.ts';
import type { Hero, Side } from './types.ts';
import type { MatchView } from './vision.ts';

/** Who could play a card right now, and what it could land on, as one side sees the board. */
export interface Reach {
  sources: number[];
  heroes: number[];
  /** Cells of the structures it could land on. */
  cells: number[];
}

/**
 * The checks a play would face if it resolved this instant, made against a
 * side's own fogged view: a source that may play it and a target in reach.
 * A card with no source here would fizzle as things stand. It is a forecast,
 * not a verdict: earlier cards can still move heroes before it resolves.
 */
export function cardReach(v: MatchView, side: Side, id: CardId): Reach {
  const def = cardDef(id);
  const owner = CARD_OWNER[id];
  // Rewind alone works from death or the base.
  const rewind = def.effect.some((op) => op.op === 'rewind');
  const sources = v.heroes.filter((h) => h.side === side && (owner === undefined || h.id === owner)
    && (rewind || (alive(h) && h.cell >= 0 && (owner === undefined || !atBase(h)))));
  const heroes = def.aim === 'enemy' || def.aim === 'siege' ? v.heroes.filter((h) => h.side !== side && alive(h) && h.cell >= 0)
    : def.aim === 'ally' ? v.heroes.filter((h) => h.side === side && alive(h) && h.cell >= 0) : [];
  const cells = v.structures
    .filter((st) => st.hp > 0 && (def.aim === 'tower' ? st.side === side : def.aim === 'siege' && st.side !== side))
    .map((st) => st.cell);

  const out: Reach = { sources: [], heroes: [], cells: [] };
  for (const source of sources) {
    if (def.effect.some((op) => op.op === 'shadowStep') && shadowCell(source) < 0) continue;
    const hs = heroes.filter((t) => def.effect.every((op) => fits(op, source, t.cell, t)));
    const cs = cells.filter((c) => def.effect.every((op) => fits(op, source, c, null)));
    if (def.aim !== 'none' && !hs.length && !cs.length) continue;
    out.sources.push(source.uid);
    for (const t of hs) if (!out.heroes.includes(t.uid)) out.heroes.push(t.uid);
    for (const c of cs) if (!out.cells.includes(c)) out.cells.push(c);
  }
  return out;
}

/** Whether one op allows the target on `cell` (a hero, or a structure when `target` is null). */
function fits(op: CardOp, source: Hero, cell: number, target: Hero | null): boolean {
  switch (op.op) {
    case 'engage':
      if (!target) return false;
      if (op.below !== undefined && target.hp * 100 >= maxHp(target) * op.below) return false;
      return distance(source.cell, cell) - (target.stance === 'aggressive' ? 1 : 0) <= op.reach;
    case 'strike': case 'unwrite':
      return target !== null && distance(source.cell, cell) <= op.reach;
    case 'evade':
      return op.reach === undefined || distance(source.cell, cell) <= op.reach;
    case 'shell':
      return distance(source.cell, cell) <= op.reach;
    default:
      return true;
  }
}
