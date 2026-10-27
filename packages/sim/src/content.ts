import type { LaneId, Role, Stance, Stats } from './types.ts';

/**
 * Rules numbers. Everything balance-related lives here so the arena script
 * can sweep it without touching rules code.
 */
export const FIGHT_EVERY = 50;
export const DRAW_EVERY = 10;
export const WAVE_EVERY = 8;
export const WAVE_SIZE = 12;
export const MAX_MAP_TICKS = 3000;

export const MANA_PER_PHASE = 10;
export const MANA_KEPT = 10;
export const CARDS_KEPT = 5;

/** Permille chance, per map tick, that a minion or creep strikes. */
export const MINION_STRIKE = 100;
export const MINION_DMG = 50;
export const CREEP_DMG = 40;
export const CAMP_SIZE = 4;
export const CAMP_RESPAWN = 40;
/** Damage a structure deals an enemy hero on its cell when no enemy minions shield them. */
export const TOWER_DMG = 120;
export const STRUCTURE_HP = { core: 3000, inner: 2000, outer: 1500 } as const;

export const RESPAWN_TICKS = 15;
/** Percent of max HP healed per map tick while standing on the own core. */
export const BASE_HEAL = 25;
/** Fight ticks every aggressive hero adds to its engagement. */
export const AGGRESSIVE_LENGTH = 5;

/**
 * XP is stored in 60ths of a point: shared XP split between up to six heroes
 * stays exact. Each whole point is +1 DMG, +10 HP, +1 RES.
 */
export const XP_UNIT = 60;
export const XP_MINION = 1;
export const XP_HERO = 10;
export const XP_TOWER = 10;

/** How many of each order a side may give between fight phases. */
export const ORDERS_PER_PHASE = { stance: 1, roam: 1 } as const;

export interface StanceDef {
  /** Minions or creeps killed per map tick on the hero's cell. */
  clear: number;
  /** Below this percent of max HP the hero walks home. */
  retreat: number;
  /**
   * Flat damage dealt per tick to an enemy structure no enemy minion shields.
   * Deliberately not scaled by DMG: towers fall to waves, heroes only help.
   */
  siege: number;
}

export const STANCES: Record<Stance, StanceDef> = {
  passive: { clear: 1, retreat: 40, siege: 0 },
  aggressive: { clear: 2, retreat: 20, siege: 25 },
};

// ---- effects ---------------------------------------------------------------

/**
 * Abilities and cards are data: small ops interpreted by the sim. A new kind
 * of effect is a new op, never a special case keyed on a hero's name.
 */
export type MapOp =
  | { op: 'cull'; n: number }
  | { op: 'smite'; n: number }
  | { op: 'muster'; n: number }
  | { op: 'siphon'; n: number; heal: number }
  | { op: 'reveal'; radius: number; ticks: number };

/** Who a fight op lands on. `target` is the focus if set, else a random enemy. */
export type Pick = 'target' | 'weakest';

export type FightOp =
  | { op: 'strike'; pct: number; pick: Pick }
  | { op: 'cleave'; pct: number }
  | { op: 'mend'; pct: number }
  | { op: 'guard'; amount: number; who: 'self' | 'allies' }
  | { op: 'haste'; spd: number; who: 'self' | 'allies' };

export type CardOp =
  | { op: 'engage'; reach: number; length: number }
  | { op: 'join'; reach: number }
  | { op: 'evade' }
  | { op: 'afterHeal'; pct: number }
  | { op: 'guardTower' }
  /** Boosts the source, or every ally in its engagement; a timed DMG boost lasts its first `ticks` fight ticks. */
  | { op: 'empower'; who: 'source' | 'engagement'; dmgPct?: number; res?: number; spd?: number; ticks?: number }
  | { op: 'shield'; amount: number }
  | { op: 'strike'; amount: number; reach: number }
  | { op: 'focus' };

export type Keyword = 'Engage' | 'Join' | 'Tactic' | 'Bound' | 'Ultimate';

export const KEYWORD_TEXT: Record<Keyword, string> = {
  Engage: 'starts an engagement with a visible enemy hero in reach; heroes on both cells are pulled in',
  Join: 'enters an allied engagement in reach; aggressive heroes have 1 less reach',
  Tactic: 'changes the engagement its hero is in',
  Bound: 'fizzles if its hero is dead or at base',
  Ultimate: 'a hero ultimate; goes back on cooldown when played',
};

/** What the player aims a card at, besides choosing its source hero. */
export type Aim = 'none' | 'enemy' | 'ally' | 'tower';

export interface CardDef {
  name: string;
  cost: number;
  /** 0-9, resolved ascending; equal initiatives resolve simultaneously. */
  initiative: number;
  keywords: readonly Keyword[];
  aim: Aim;
  effect: readonly CardOp[];
  text: string;
}

export interface MapAbility { name: string; text: string; every: number; op: MapOp }
export interface FightAbility { name: string; text: string; /** Fires on turns every, 2*every, ... */ every: number; op: FightOp }

export type Ultimate =
  | { kind: 'command'; name: string; text: string; cooldown: number; op: MapOp; range: number }
  | { kind: 'card'; name: string; text: string; cooldown: number; card: CardId }
  | { kind: 'trigger'; name: string; text: string; cooldown: number; when: Trigger; op: FightOp }
  | { kind: 'ascension'; name: string; text: string; xp: number; bonus: Partial<Stats> };

export type Trigger = { on: 'selfBelow' | 'allyBelow'; pct: number };

export interface HeroDef {
  name: string;
  role: Role;
  stats: Stats;
  map: MapAbility;
  fight: FightAbility;
  ult: Ultimate;
  /** Each enters the deck twice. Hero cards are Bound to their hero. */
  cards: readonly CardId[];
}

// ---- cards -----------------------------------------------------------------

const card = (name: string, cost: number, initiative: number, keywords: Keyword[], aim: Aim, effect: CardOp[], text: string): CardDef =>
  ({ name, cost, initiative, keywords, aim, effect, text });

export const CARDS = {
  // Staples: every deck carries two, and each names any allied hero as its source.
  skirmish: card('Skirmish', 3, 5, ['Engage'], 'enemy', [{ op: 'engage', reach: 1, length: 50 }], 'The plain engage.'),
  reinforce: card('Reinforce', 2, 6, ['Join'], 'none', [{ op: 'join', reach: 2 }], 'Join a nearby fight.'),
  fallBack: card('Fall Back', 1, 2, [], 'none', [{ op: 'evade' }], 'Later engages cannot target this hero.'),
  pressTheAttack: card('Press the Attack', 1, 4, ['Tactic'], 'none', [{ op: 'empower', who: 'engagement', dmgPct: 20, ticks: 15 }], 'Allies in its fight: +20% DMG for 15 ticks.'),
  secondWind: card('Second Wind', 2, 8, [], 'none', [{ op: 'afterHeal', pct: 25 }], 'After the fights, heal 25%.'),
  holdTheLine: card('Hold the Line', 2, 3, [], 'tower', [{ op: 'guardTower' }], 'A tower takes half damage until the next fight phase.'),

  // Placeholder hero cards, bound to their test hero.
  shove: card('Shove', 3, 5, ['Engage', 'Bound'], 'enemy', [{ op: 'engage', reach: 1, length: 50 }], 'Engage (1, 50).'),
  brace: card('Brace', 1, 3, ['Tactic', 'Bound'], 'none', [{ op: 'empower', who: 'source', res: 30 }], '+30 RES in fights this phase.'),
  holdFast: card('Hold Fast', 2, 6, ['Join', 'Bound'], 'none', [{ op: 'join', reach: 2 }], 'Join (2).'),
  lunge: card('Lunge', 3, 5, ['Engage', 'Bound'], 'enemy', [{ op: 'engage', reach: 2, length: 50 }], 'Engage (2, 50).'),
  shade: card('Shade', 1, 2, ['Bound'], 'none', [{ op: 'evade' }], 'Later engages cannot target this hero.'),
  hunt: card('Hunt', 2, 7, ['Join', 'Bound'], 'none', [{ op: 'join', reach: 3 }], 'Join (3).'),
  zap: card('Zap', 2, 4, ['Bound'], 'enemy', [{ op: 'strike', amount: 150, reach: 3 }], '150 damage to a visible enemy within 3.'),
  ambush: card('Ambush', 4, 6, ['Engage', 'Bound'], 'enemy', [{ op: 'engage', reach: 2, length: 40 }], 'Engage (2, 40).'),
  overcharge: card('Overcharge', 1, 7, ['Tactic', 'Bound'], 'none', [{ op: 'empower', who: 'source', dmgPct: 30 }], '+30% DMG in fights this phase.'),
  aegis: card('Aegis', 2, 3, ['Bound'], 'ally', [{ op: 'shield', amount: 250 }], 'Shield an ally for 250.'),
  vigil: card('Vigil', 1, 7, ['Tactic', 'Bound'], 'none', [{ op: 'empower', who: 'engagement', res: 15 }], 'Allies in its fight: +15 RES.'),
  escort: card('Escort', 2, 6, ['Join', 'Bound'], 'none', [{ op: 'join', reach: 2 }], 'Join (2).'),
  pin: card('Pin', 3, 6, ['Engage', 'Bound'], 'enemy', [{ op: 'engage', reach: 2, length: 40 }], 'Engage (2, 40).'),
  steady: card('Steady', 1, 7, ['Tactic', 'Bound'], 'none', [{ op: 'empower', who: 'source', dmgPct: 40 }], '+40% DMG in fights this phase.'),
  slip: card('Slip', 1, 2, ['Bound'], 'none', [{ op: 'evade' }], 'Later engages cannot target this hero.'),

  // Card ultimates enter the hand when ready and never the deck.
  pounce: card('Pounce', 2, 0, ['Engage', 'Bound', 'Ultimate'], 'enemy', [{ op: 'engage', reach: 3, length: 40 }], 'Engage (3, 40) before anything else.'),
} as const satisfies Record<string, CardDef>;

export type CardId = keyof typeof CARDS;
export const CARD_IDS = Object.keys(CARDS) as CardId[];
export const cardDef = (id: CardId): CardDef => CARDS[id];
export const STAPLES: CardId[] = ['skirmish', 'reinforce', 'fallBack', 'pressTheAttack', 'secondWind', 'holdTheLine'];

// ---- heroes ----------------------------------------------------------------

/**
 * Test heroes, one per role, clearly placeholder: they exist so the loop runs
 * and every effect category is exercised. The real roster replaces them.
 */
export const HEROES = {
  stubTop: {
    name: 'Test Top', role: 'top',
    stats: { hp: 1400, dmg: 75, res: 40, spd: 7 },
    map: { name: 'Cleave', text: 'Kills 2 enemy minions on its cell.', every: 4, op: { op: 'cull', n: 2 } },
    fight: { name: 'Slam', text: '60% DMG to every enemy.', every: 2, op: { op: 'cleave', pct: 60 } },
    ult: { kind: 'trigger', name: 'Bulwark', text: 'Below 50% HP: shields every ally for 200.', cooldown: 2, when: { on: 'selfBelow', pct: 50 }, op: { op: 'guard', amount: 200, who: 'allies' } },
    cards: ['shove', 'brace', 'holdFast'],
  },
  stubJungle: {
    name: 'Test Jungle', role: 'jungle',
    stats: { hp: 1100, dmg: 115, res: 25, spd: 12 },
    map: { name: 'Smite', text: 'Kills 2 creeps on its camp.', every: 3, op: { op: 'smite', n: 2 } },
    fight: { name: 'Rend', text: '200% DMG to the weakest enemy.', every: 3, op: { op: 'strike', pct: 200, pick: 'weakest' } },
    ult: { kind: 'card', name: 'Pounce', text: 'A free early engage card.', cooldown: 3, card: 'pounce' },
    cards: ['lunge', 'shade', 'hunt'],
  },
  stubMid: {
    name: 'Test Mid', role: 'mid',
    stats: { hp: 800, dmg: 140, res: 10, spd: 10 },
    map: { name: 'Siphon', text: 'Consumes 2 allied minions, healing 40 each.', every: 5, op: { op: 'siphon', n: 2, heal: 40 } },
    fight: { name: 'Nova', text: '120% DMG to every enemy.', every: 3, op: { op: 'cleave', pct: 120 } },
    ult: { kind: 'command', name: 'Flare', text: 'Reveals 2 cells around any point until the next fight phase.', cooldown: 2, range: 99, op: { op: 'reveal', radius: 2, ticks: 0 } },
    cards: ['zap', 'ambush', 'overcharge'],
  },
  stubSupport: {
    name: 'Test Support', role: 'support',
    stats: { hp: 950, dmg: 65, res: 25, spd: 9 },
    map: { name: 'Muster', text: 'Raises 2 allied minions on its lane cell.', every: 6, op: { op: 'muster', n: 2 } },
    fight: { name: 'Mend', text: 'Heals the weakest ally for 150% DMG.', every: 2, op: { op: 'mend', pct: 150 } },
    ult: { kind: 'trigger', name: 'Mercy', text: 'An ally below 30% HP: haste every ally by 5.', cooldown: 2, when: { on: 'allyBelow', pct: 30 }, op: { op: 'haste', spd: 5, who: 'allies' } },
    cards: ['aegis', 'vigil', 'escort'],
  },
  stubCarry: {
    name: 'Test Carry', role: 'carry',
    stats: { hp: 750, dmg: 145, res: 10, spd: 13 },
    map: { name: 'Glimpse', text: 'Sees 1 cell around itself for 3 ticks.', every: 8, op: { op: 'reveal', radius: 1, ticks: 3 } },
    fight: { name: 'Volley', text: '150% DMG to its target.', every: 2, op: { op: 'strike', pct: 150, pick: 'target' } },
    ult: { kind: 'ascension', name: 'Awaken', text: 'At 300 XP: +30 DMG and +3 SPD for good.', xp: 300, bonus: { dmg: 30, spd: 3 } },
    cards: ['pin', 'steady', 'slip'],
  },
} as const satisfies Record<string, HeroDef>;

export type HeroId = keyof typeof HEROES;
export const HERO_IDS = Object.keys(HEROES) as HeroId[];
export const heroDef = (id: HeroId): HeroDef => HEROES[id];

/** Lineup order: uid within a side follows this. */
export const ROLES: Role[] = ['top', 'jungle', 'mid', 'support', 'carry'];
export const LINEUP: HeroId[] = ['stubTop', 'stubJungle', 'stubMid', 'stubSupport', 'stubCarry'];

/** Which lane a laner walks; the jungler has none. */
export const ROLE_LANE: Record<Role, LaneId | -1> = { top: 0, jungle: -1, mid: 1, support: 2, carry: 2 };

/** Which hero a card is bound to, if any. */
export const CARD_OWNER: Partial<Record<CardId, HeroId>> = Object.fromEntries(
  HERO_IDS.flatMap((h) => {
    const def = heroDef(h);
    const own = def.cards.map((c) => [c, h] as const);
    return def.ult.kind === 'card' ? [...own, [def.ult.card, h] as const] : own;
  }),
);

export function buildDeck(lineup: readonly HeroId[]): CardId[] {
  return [...STAPLES, ...lineup.flatMap((h) => heroDef(h).cards)].flatMap((c) => [c, c]);
}
