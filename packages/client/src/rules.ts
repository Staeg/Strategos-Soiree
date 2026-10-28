import {
  CARD_OWNER, CARDS_KEPT, cardDef, heroDef,
  type CardId, type CardOp, type HeroDef, type HeroId,
} from '@soiree/sim';

/**
 * The long form of every card, written out from its effect ops rather than
 * kept as a second copy of the text: what Ctrl reveals. The short `text` on
 * the card is a reminder; this is the rule.
 */
export function cardRules(id: CardId): string[] {
  const def = cardDef(id);
  const owner = CARD_OWNER[id];
  const hero = owner ? heroDef(owner) : undefined;
  const who = hero ? shortName(hero) : 'the hero';
  const Who = cap(who);
  const out = [
    `${def.cost} mana. Initiative ${def.initiative}: resolves after every lower initiative, at the same time as equal ones.`,
    hero ? `Played by ${hero.name}.` : 'Played by whichever allied hero you pick.',
    AIM[def.aim],
    ...def.effect.map((op) => cap(opRules(op, who, Who, owner))),
  ];
  for (const k of def.keywords) {
    if (k === 'Bound') out.push(`Bound: fizzles if ${who} is dead or at base.`);
    else if (k === 'Ultimate' && hero && 'cooldown' in hero.ult) out.push(`Ultimate: back on cooldown for ${hero.ult.cooldown} fight phases once played.`);
  }
  return out.filter(Boolean);
}

const AIM: Record<ReturnType<typeof cardDef>['aim'], string> = {
  none: '',
  enemy: 'Aimed at an enemy hero.',
  ally: 'Aimed at an allied hero.',
  tower: 'Aimed at an allied structure.',
  siege: 'Aimed at an enemy hero or structure.',
};

const cells = (n: number) => `${n} cell${n === 1 ? '' : 's'}`;
const ticks = (n: number) => `the first ${n} fight ticks`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "The Tallow Duchess" reads as "the Duchess" mid-sentence; other names stand as they are. */
function shortName(h: HeroDef): string {
  return h.name.startsWith('The ') ? `the ${h.name.split(' ').pop()}` : h.name;
}

/** What each hero calls its charges, where it has any. */
export const CHARGE_NAME: Partial<Record<HeroId, string>> = {
  carrionAbacus: 'Beads', lacuna: 'Void', scrimshander: 'Scrimshaw',
};

function opRules(op: CardOp, who: string, Who: string, owner: HeroId | undefined): string {
  const next = `in ${who}'s next fight this phase`;
  switch (op.op) {
    case 'engage': {
      const range = `a visible enemy hero within ${cells(op.reach)}${op.below ? ` who is under ${op.below}% HP` : ''}`;
      const crowd = op.duel
        ? 'Only the two of them fight, and nobody may join.'
        : 'Every hero on either cell is pulled in.';
      return `${who} starts a fight with ${range} (an aggressive target counts as a cell closer). ${crowd} `
        + `It is fought on ${op.pull ? `${who}'s own cell` : "the target's cell"} and lasts ${op.length} fight ticks.`;
    }
    case 'join':
      return `${who} enters the next allied fight within ${cells(op.reach)} this phase (1 less reach while aggressive).`;
    case 'empower': {
      const gains = [op.res && `+${op.res} RES`, op.spd && `+${op.spd} SPD`].filter(Boolean).join(' and ');
      const whom = op.who === 'source' ? who : `every ally ${next}`;
      const dmg = op.dmgPct ? `+${op.dmgPct}% DMG for ${op.ticks ? ticks(op.ticks) : 'the whole fight'}` : '';
      return `${whom} gains ${[dmg, gains && `${gains} for the whole fight`].filter(Boolean).join(', and ')}${op.who === 'source' ? ` ${next}` : ''}.`;
    }
    case 'focus':
      return `${next}, every ally attacks the target for ${ticks(op.ticks)}.`;
    case 'slow': {
      const loss = [op.pct && `${op.pct}% of its SPD`, op.spd && `${op.spd} SPD`].filter(Boolean).join(' and ');
      return `${next}, ${op.who === 'target' ? 'the target' : 'every enemy'} loses ${loss} for ${ticks(op.ticks)}.`;
    }
    case 'expose':
      return `${next}, the target takes ${op.pct === 100 ? 'double' : `${op.pct}% more`} damage for ${ticks(op.ticks)}.`;
    case 'quick':
      return `${next}, ${who}'s first turn comes on the very first fight tick.`;
    case 'fade':
      return `${who} walks out of the next fight this phase after fight tick ${op.tick}, to the nearest jungle cell.`;
    case 'firstHit':
      return `${who}'s first attack ${next} deals ${op.pct}% DMG.`;
    case 'opening':
      return `${who}'s first turn in that fight is ${owner ? heroDef(owner).fight.name : 'its fight ability'}.`;
    case 'procession':
      return `up to ${op.n} allied lane minions on or next to ${who} fight beside ${who === 'the hero' ? 'it' : who} ${next}.`;
    case 'evade':
      return op.reach === undefined
        ? `engage cards with a later initiative than this cannot target ${who}.`
        : `an allied hero within ${cells(op.reach)} of ${who} cannot be targeted by engages with a later initiative, and is never pulled into a fight as a bystander.`;
    case 'heal':
      return op.reach === undefined
        ? `${who} heals ${op.pct}% of max HP.`
        : `every allied hero within ${cells(op.reach)} of ${who} heals ${op.pct}% of max HP.`;
    case 'guardTower':
      return 'the structure takes half damage until the next fight phase.';
    case 'shield':
      return `${who} gains a ${op.amount}-point shield.`;
    case 'strike':
      return `deals ${op.amount} damage, less the target's RES, to an enemy hero within ${cells(op.reach)}.`;
    case 'shell':
      return `deals ${op.amount} damage to the target within ${cells(op.reach)} of ${who}: an enemy hero (less its RES) or a structure.`;
    case 'charge':
      return `${who} gains ${op.n} ${(owner && CHARGE_NAME[owner]) ?? 'charges'}, up to ${op.max}.`;
    case 'rewind':
      return `${who}'s HP and position go back to what they were when this fight phase began. Works even if ${who} died this phase, but not if ${who} was already dead when it began.`;
    case 'shadowStep':
      return `${who} steps into the cell his Long Shadow covers: one lane cell further along his lane, towards the enemy core. Fizzles if he is not standing on a lane, or the lane ends there.`;
    case 'nightfall':
      return 'until the next fight phase, the enemy sees only the cells its own heroes, minions and structures stand on: no wards, no tower sight.';
    case 'cancel':
      return "cancels the opponent's costliest card with a later initiative this phase; between equal costs, the later one.";
    case 'unwrite':
      return `an enemy hero within ${cells(op.reach)} loses its map ability until the next fight phase.`;
    case 'squeeze':
      return `the opponent at once discards cards at random until it holds at most ${CARDS_KEPT - 1} that are not ultimates.`;
    case 'rally':
      return `next map phase, allied minions ${op.where === 'cell' ? `on ${who}'s cell` : `in ${who}'s lane`} strike twice as often.`;
    case 'clear':
      return `next map phase, ${who} kills ${op.n} more minion${op.n === 1 ? '' : 's'} a tick.`;
    case 'cadence':
      return `next map phase, ${owner ? heroDef(owner).map.name : 'the map ability'} runs every ${op.every} ticks.`;
  }
}
