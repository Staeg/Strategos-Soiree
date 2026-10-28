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

/** Permille chance, per map tick, that a minion strikes. */
export const MINION_STRIKE = 100;
export const MINION_DMG = 50;
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
 * stays exact. Every XP_PER_STAT points give +1 DMG, +10 HP and +1 RES.
 */
export const XP_UNIT = 60;
export const XP_PER_STAT = 10;
export const XP_MINION = 1;
export const XP_HERO = 10;
export const XP_TOWER = 10;

/** How many of each order a side may give between fight phases. */
export const ORDERS_PER_PHASE = { stance: 1, roam: 1 } as const;

export interface StanceDef {
  /** Minions killed per map tick on the hero's cell; against camps, DMG dealt in multiples of the hero's. */
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

// ---- jungle camps -------------------------------------------------------------

export interface CampDef {
  name: string;
  text: string;
  /** Creeps in the camp; they die one after another, a hero's damage spilling over. */
  creeps: number;
  /** Per creep. Every creep strikes a hero on the camp once every `every` ticks it is fought, like clockwork. */
  hp: number;
  dmg: number;
  res: number;
  every: number;
  /** XP per creep, shared between the heroes on the camp. */
  xp: number;
  /** Map ticks from the last creep's death until the camp stands again. */
  respawn: number;
}

/**
 * Five camps a side, one of each, placed at random every match (see
 * `campLayout`). Tuned so a jungler who never leaves the jungle out-earns
 * a solo laner by a little, must walk home once before finishing a first
 * full clear, and never runs out of standing camps early on.
 */
export const CAMPS = {
  wallflowers: {
    name: 'Wallflowers', text: 'Six masked wallflowers that nip from every side, and wilt at a touch.',
    creeps: 6, hp: 220, dmg: 22, res: 0, every: 3, xp: 7, respawn: 55,
  },
  cloakroom: {
    name: 'Cloakroom', text: 'Four unclaimed coats walking the halls, buttoned up against the cold.',
    creeps: 4, hp: 480, dmg: 35, res: 10, every: 5, xp: 11, respawn: 60,
  },
  topiary: {
    name: 'Topiary Hounds', text: 'Two hedge-clipped hounds; blades blunt on their boxwood.',
    creeps: 2, hp: 1000, dmg: 28, res: 60, every: 5, xp: 28, respawn: 65,
  },
  chandelier: {
    name: 'Chandelier', text: 'A crystal chandelier that rarely falls, and falls hard.',
    creeps: 1, hp: 1400, dmg: 175, res: 20, every: 10, xp: 50, respawn: 65,
  },
  wyrm: {
    name: 'Punch-Bowl Wyrm', text: 'A wyrm coiled in the punch bowl: the most to chew through, the most to gain.',
    creeps: 1, hp: 3300, dmg: 62, res: 30, every: 4, xp: 84, respawn: 80,
  },
} as const satisfies Record<string, CampDef>;

export type CampId = keyof typeof CAMPS;
export const CAMP_IDS = Object.keys(CAMPS) as CampId[];
export const campDef = (id: CampId): CampDef => CAMPS[id];

// ---- fight-phase rules -------------------------------------------------------

/**
 * When true, the engagements started at an initiative fight to the end
 * before the next initiative resolves, so a hero can fight more than once a
 * phase. When false, every card resolves first and all fights follow.
 */
export const INTERLEAVE = true;

/** A lane minion drafted into an engagement (the Moth Tenor's procession). */
export const SQUAD_MINION: Stats = { hp: 100, dmg: 25, res: 0, spd: 5 };

// ---- effects ---------------------------------------------------------------

/**
 * Abilities and cards are data: small ops interpreted by the sim. A new kind
 * of effect is a new op, never a special case keyed on a hero's name.
 */

/**
 * Map abilities run every `every` map ticks. Auras (`every: 0`) never run on
 * their own: the system they bend asks whether the hero has one.
 */
export type MapOp =
  /** Kills enemy minions on the hero's cell; `store` banks each kill as charge, up to its value. */
  | { op: 'cull'; n: number; store?: number }
  /** Eats allied minions on the hero's cell to heal it (`self`) or every ally on or next to it (`near`); `grow` is permanent. */
  | { op: 'siphon'; n: number; heal: number; who: 'self' | 'near'; grow?: Partial<Stats> }
  /** Aggressive only: kills an enemy minion on a neighbouring lane cell, taking its XP and a charge. */
  | { op: 'glean'; n: number; store: number }
  /** An enemy minion on or next to the hero's cell changes sides; the hero earns it as a kill. */
  | { op: 'convert'; n: number }
  /** Lights one cell `dist` away, sweeping round the six directions a tick at a time. */
  | { op: 'beam'; dist: number; ticks: number }
  /** Shells the nearest enemy structure within `reach`. */
  | { op: 'bombard'; amount: number; reach: number }
  /** Aura: enemy minions entering the lane cell ahead of the hero stay put with this permille chance. */
  | { op: 'shadow'; permille: number }
  /** Aura: the enemy sees this hero only while sharing its cell with one of their heroes or structures. */
  | { op: 'dusk' }
  /** Aura: each enemy minion the hero kills is a charge; every `per` charges grant `grow`. */
  | { op: 'carve'; per: number; grow: Partial<Stats> };

/** Command ultimates, aimed at a cell on the map. */
export type CommandOp =
  /** An allied hero on the aimed cell arrives on the caster's cell. */
  | { op: 'beacon' };

/** Who a fight op lands on. `target` is the focus if set, else a random enemy. */
export type Pick = 'target' | 'weakest' | 'fastest';

export type FightOp =
  | {
    op: 'strike'; pct: number; pick: Pick;
    /** Heals for this percent of the damage dealt. */
    drain?: number;
    /** Costs this percent of max HP while above half health. */
    toll?: number;
    /** The target loses its next turn: always, or only if it is faster. */
    daze?: 'always' | 'faster';
    /** Ignores RES. */
    pierce?: boolean;
    /** Each charge adds this percent of DMG, and the strike spends `spend` charges. */
    perCharge?: number;
    spend?: number;
    /** A kill grants another turn at once. */
    again?: boolean;
  }
  | { op: 'cleave'; pct: number }
  /** Heals the ally lowest on HP% for pct of DMG; `spd` lasts the engagement. */
  | { op: 'mend'; pct: number; spd?: number }
  /** Shields the ally lowest on HP for `amount` plus `pct` of DMG. */
  | { op: 'ward'; amount: number; pct: number }
  /** The target's next turn is spent attacking one of its own allies. */
  | { op: 'swoon' }
  /** Costs `cost` charges per enemy in the fight; the target loses its next fight-ability use. No damage. */
  | { op: 'unmake'; cost: number };

/** Ops that fire when a trigger ultimate's condition holds, outside the hero's turn. */
export type TriggerOp =
  /** Cannot die until the engagement ends; DMG rises, HP burns each fight tick; then home at 1 HP. */
  | { op: 'undying'; dmgPct: number; burn: number }
  /** The dying ally is healed to `pct` of max HP instead. */
  | { op: 'reprieve'; pct: number }
  /** Gains charges, and the next turn is the fight ability. */
  | { op: 'tally'; n: number };

export type Trigger =
  /** The hero itself drops below pct% HP during an engagement. */
  | { on: 'selfBelow'; pct: number }
  /** An ally in the hero's engagement would die. */
  | { on: 'allyDying' }
  /** Any hero dies within `range` cells. */
  | { on: 'death'; range: number };

/** Effects that wait on the hero and land at the start of its next engagement this phase. */
export type ArmedOp =
  | { op: 'join'; reach: number }
  /** Boosts the source, or every ally in its engagement; a timed DMG boost lasts its first `ticks` fight ticks. */
  | { op: 'empower'; who: 'source' | 'engagement'; dmgPct?: number; res?: number; spd?: number; ticks?: number }
  /** Every ally in the engagement attacks the card's target for the first `ticks` ticks. */
  | { op: 'focus'; ticks: number }
  /** Slows the card's target, or every enemy, by pct% and/or a flat `spd` for the first `ticks` ticks. */
  | { op: 'slow'; who: 'target' | 'enemies'; pct?: number; spd?: number; ticks: number }
  /** The card's target takes pct% more damage for the first `ticks` ticks. */
  | { op: 'expose'; pct: number; ticks: number }
  /** The hero's first turn comes on the first fight tick. */
  | { op: 'quick' }
  /** The hero leaves the engagement after fight tick `tick`, for the nearest jungle cell. */
  | { op: 'fade'; tick: number }
  /** The hero's first attack deals pct% DMG. */
  | { op: 'firstHit'; pct: number }
  /** The hero's first turn is its fight ability. */
  | { op: 'opening' }
  /** Up to `n` allied minions on or next to the hero fight beside it. */
  | { op: 'procession'; n: number };

export type CardOp =
  | ArmedOp
  /** `below`: only targets a hero under that HP%. `duel`: only the two heroes, and nobody may join. `pull`: fought on the source's cell. */
  | { op: 'engage'; reach: number; length: number; below?: number; duel?: boolean; pull?: boolean }
  /** Engage cards with a later initiative cannot target the hero (`reach`: an ally that far away instead, who is also never pulled in). */
  | { op: 'evade'; reach?: number }
  /** Heals pct% max HP, to the source or every ally within `reach`. */
  | { op: 'heal'; pct: number; reach?: number }
  | { op: 'guardTower' }
  | { op: 'shield'; amount: number }
  | { op: 'strike'; amount: number; reach: number }
  /** Hits an enemy hero or structure within reach. */
  | { op: 'shell'; amount: number; reach: number }
  | { op: 'charge'; n: number; max: number }
  /** HP and position go back to where they were when the fight phase began; works even on the dead. */
  | { op: 'rewind' }
  /** Steps into the cell the hero's shadow covers. */
  | { op: 'shadowStep' }
  /** Until the next fight phase the enemy sees only the cells its own units stand on. */
  | { op: 'nightfall' }
  /** Cancels the opponent's costliest card at a later initiative (ties: the later one). */
  | { op: 'cancel' }
  /** An enemy hero within reach loses its map ability until the next fight phase. */
  | { op: 'unwrite'; reach: number }
  /** The opponent keeps one card fewer this phase. */
  | { op: 'squeeze' }
  /** Next map phase: minions with the hero (`cell`) or in its lane (`lane`) strike twice as often. */
  | { op: 'rally'; where: 'cell' | 'lane' }
  /** Next map phase: the hero kills `n` more minions a tick. */
  | { op: 'clear'; n: number }
  /** Next map phase: the map ability runs every `every` ticks. */
  | { op: 'cadence'; every: number };

export const ARMED: ReadonlySet<CardOp['op']> = new Set(['join', 'empower', 'focus', 'slow', 'expose', 'quick', 'fade', 'firstHit', 'opening', 'procession']);
export const isArmed = (op: CardOp): op is ArmedOp => ARMED.has(op.op);

export type Keyword = 'Engage' | 'Join' | 'Tactic' | 'Bound' | 'Ultimate';

export const KEYWORD_TEXT: Record<Keyword, string> = {
  Engage: 'starts an engagement with a visible enemy hero in reach; heroes on both cells are pulled in',
  Join: "enters the hero's next allied engagement in reach this phase; aggressive heroes have 1 less reach",
  Tactic: "changes the hero's next engagement this phase",
  Bound: 'fizzles if its hero is dead or at base',
  Ultimate: 'a hero ultimate; goes back on cooldown when played',
};

/** What the player aims a card at, besides choosing its source hero. `siege`: an enemy hero or structure. */
export type Aim = 'none' | 'enemy' | 'ally' | 'tower' | 'siege';

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

/** `every: 0` marks an aura. */
export interface MapAbility { name: string; text: string; every: number; op: MapOp }
export interface FightAbility { name: string; text: string; /** Fires on turns every, 2*every, ... */ every: number; op: FightOp }

export type Ultimate =
  | { kind: 'command'; name: string; text: string; cooldown: number; op: CommandOp; range: number }
  | { kind: 'card'; name: string; text: string; cooldown: number; card: CardId }
  | { kind: 'trigger'; name: string; text: string; cooldown: number; when: Trigger; op: TriggerOp }
  /** One-time, once the hero holds `charge` charges; `sweep` makes basic attacks hit every enemy. */
  | { kind: 'ascension'; name: string; text: string; charge: number; sweep: boolean };

export interface HeroDef {
  name: string;
  role: Role;
  stats: Stats;
  map: MapAbility;
  fight: FightAbility;
  ult: Ultimate;
  /** One copy of each enters the deck. Hero cards are Bound to their hero. */
  cards: readonly CardId[];
}

// ---- cards -----------------------------------------------------------------

const card = (name: string, cost: number, initiative: number, keywords: Keyword[], aim: Aim, effect: CardOp[], text: string): CardDef =>
  ({ name, cost, initiative, keywords, aim, effect, text });

const B = 'Bound' as const;

export const CARDS = {
  // Staples: one each per deck, played from whichever allied hero the player picks.
  skirmish: card('Skirmish', 3, 5, ['Engage'], 'enemy', [{ op: 'engage', reach: 1, length: 50 }], 'Target hero engages an enemy hero within 1.'),
  reinforce: card('Reinforce', 2, 6, ['Join'], 'none', [{ op: 'join', reach: 2 }], 'Target hero joins a nearby fight.'),
  fallBack: card('Fall Back', 1, 2, [], 'none', [{ op: 'evade' }], 'Later engages cannot target the target hero.'),
  pressTheAttack: card('Press the Attack', 1, 4, ['Tactic'], 'none', [{ op: 'empower', who: 'engagement', dmgPct: 20, ticks: 15 }], "In target hero's next fight, allies there +20% DMG for 15 ticks."),
  secondWind: card('Second Wind', 2, 8, [], 'none', [{ op: 'heal', pct: 25 }], 'Target hero heals 25%.'),
  holdTheLine: card('Hold the Line', 2, 3, [], 'tower', [{ op: 'guardTower' }], 'Target allied tower takes half damage until the next fight phase.'),

  // The Tallow Duchess
  snuff: card('Snuff', 3, 4, ['Engage', B], 'enemy', [{ op: 'engage', reach: 1, length: 30 }], 'Engage (1, 30).'),
  hotWax: card('Hot Wax', 2, 6, ['Tactic', B], 'enemy', [{ op: 'slow', who: 'target', pct: 50, ticks: 20 }], "In the Duchess's next fight, the target has half SPD for 20 ticks."),
  rekindle: card('Rekindle', 1, 1, [B], 'none', [{ op: 'heal', pct: 25 }], 'The Duchess heals 25%.'),

  // Gnomon
  highNoon: card('High Noon', 2, 5, ['Engage', B], 'enemy', [{ op: 'engage', reach: 1, length: 50, duel: true }], 'Gnomon engages (1, 50) the target alone; nobody may join.'),
  hourHand: card('Hour Hand', 1, 2, ['Tactic', B], 'none', [{ op: 'quick' }], "Gnomon's first turn in the next fight comes on tick 1."),
  shadowStep: card('Shadow Step', 2, 3, [B], 'none', [{ op: 'shadowStep' }], 'Gnomon steps one lane cell ahead, into the Long Shadow.'),
  rewind: card('Rewind', 4, 9, [B, 'Ultimate'], 'none', [{ op: 'rewind' }], "Gnomon's HP and place go back to the start of the phase, even from death."),

  // Vespertine
  outOfTheDark: card('Out of the Dark', 2, 2, ['Engage', B], 'enemy', [{ op: 'engage', reach: 1, length: 25 }], 'Engage (1, 25).'),
  starPin: card('Star Pin', 1, 4, ['Tactic', B], 'enemy', [{ op: 'focus', ticks: 15 }], "In Vespertine's next fight, every ally attacks the target for 15 ticks."),
  fade: card('Fade', 1, 7, ['Tactic', B], 'none', [{ op: 'fade', tick: 10 }], 'Vespertine leaves the next fight after tick 10.'),
  nightfall: card('Nightfall', 3, 1, [B, 'Ultimate'], 'none', [{ op: 'nightfall' }], 'Until the next fight phase the enemy sees only where it stands.'),

  // Carrion Abacus
  circling: card('Circling', 2, 6, ['Engage', B], 'enemy', [{ op: 'engage', reach: 2, length: 40, below: 60 }], 'Engage (2, 40) a hero under 60% HP.'),
  countTheBones: card('Count the Bones', 0, 3, [B], 'none', [{ op: 'charge', n: 3, max: 10 }], 'Carrion Abacus gains 3 Beads.'),
  sumOfDebts: card('Sum of Debts', 3, 8, ['Join', B], 'none', [{ op: 'join', reach: 2 }, { op: 'opening' }], "Carrion Abacus joins (2); the Abacus's first turn there is a Reckon."),

  // Moth Tenor
  lure: card('Lure', 2, 4, ['Engage', B], 'enemy', [{ op: 'engage', reach: 2, length: 50, pull: true }], "Engage (2, 50), fought on Moth Tenor's cell."),
  dustOfWings: card('Dust of Wings', 1, 5, ['Tactic', B], 'none', [{ op: 'slow', who: 'enemies', spd: 3, ticks: 20 }], "In Moth Tenor's next fight, every enemy -3 SPD for 20 ticks."),
  lampSeason: card('Lamp Season', 2, 2, [B], 'none', [{ op: 'rally', where: 'lane' }], "Next map phase, allied minions in Moth Tenor's lane strike twice as often."),
  lanternProcession: card('Lantern Procession', 3, 3, [B, 'Ultimate'], 'none', [{ op: 'procession', n: 6 }], "Up to 6 allied minions near Moth Tenor fight beside the Tenor in the next fight."),

  // Lacuna
  negativeSpace: card('Negative Space', 3, 6, ['Engage', B], 'enemy', [{ op: 'engage', reach: 2, length: 50 }], 'Engage (2, 50).'),
  unwrite: card('Unwrite', 2, 2, [B], 'enemy', [{ op: 'unwrite', reach: 3 }], 'An enemy within 3 loses its map ability until the next fight phase.'),
  silenceBetween: card('Silence Between', 0, 9, [B], 'none', [{ op: 'squeeze' }], 'The opponent keeps one card fewer.'),
  lacuna: card('Lacuna', 2, 0, [B, 'Ultimate'], 'none', [{ op: 'cancel' }], "Cancel the opponent's costliest later card."),

  // Saint Halyard
  rescueLine: card('Rescue Line', 2, 2, [B], 'ally', [{ op: 'evade', reach: 2 }], 'An ally within 2 is out of reach of later engages.'),
  foghorn: card('Foghorn', 2, 5, ['Engage', B], 'enemy', [{ op: 'engage', reach: 2, length: 30 }], 'Engage (2, 30).'),
  keepersOath: card("Keeper's Oath", 1, 4, ['Join', B], 'none', [{ op: 'join', reach: 2 }, { op: 'empower', who: 'engagement', res: 20 }], 'Join (2); allies there +20 RES.'),

  // Vintner Ghast
  spikedCup: card('Spiked Cup', 2, 6, ['Engage', B], 'enemy', [{ op: 'engage', reach: 1, length: 50 }, { op: 'expose', pct: 100, ticks: 10 }], 'Engage (1, 50); the target takes double damage for 10 ticks.'),
  secondGlass: card('Second Glass', 1, 8, [B], 'none', [{ op: 'heal', pct: 15, reach: 2 }], 'Allies within 2 heal 15%.'),
  vintage: card('Vintage', 2, 9, [B], 'none', [{ op: 'rally', where: 'cell' }], "Next map phase, allied minions on Vintner Ghast's cell strike twice as often."),

  // Scrimshander
  killLine: card('Kill Line', 3, 8, ['Engage', B], 'enemy', [{ op: 'engage', reach: 1, length: 40 }], 'Engage (1, 40).'),
  boneNeedle: card('Bone Needle', 1, 6, ['Tactic', B], 'none', [{ op: 'firstHit', pct: 200 }], "Scrimshander's first attack in the next fight deals 200% DMG."),
  ivoryWard: card('Ivory Ward', 2, 2, [B], 'none', [{ op: 'evade' }], 'Later engages cannot target Scrimshander.'),

  // Brass Reliquary
  fuse: card('Fuse', 2, 7, [B], 'none', [{ op: 'clear', n: 1 }], 'Next map phase, Brass Reliquary kills one more minion a tick.'),
  tampPowder: card('Tamp Powder', 1, 2, [B], 'none', [{ op: 'cadence', every: 2 }], 'Next map phase, Bombard fires every 2 ticks.'),
  brace: card('Brace', 1, 3, ['Tactic', B], 'none', [{ op: 'empower', who: 'source', res: 40, spd: 4 }], "In Brass Reliquary's next fight, the Reliquary gets +40 RES, +4 SPD."),
  relicShell: card('Relic Shell', 4, 9, [B, 'Ultimate'], 'siege', [{ op: 'shell', amount: 600, reach: 4 }], '600 damage to an enemy hero or structure within 4.'),
} as const satisfies Record<string, CardDef>;

export type CardId = keyof typeof CARDS;
export const CARD_IDS = Object.keys(CARDS) as CardId[];
export const cardDef = (id: CardId): CardDef => CARDS[id];
export const STAPLES: CardId[] = ['skirmish', 'reinforce', 'fallBack', 'pressTheAttack', 'secondWind', 'holdTheLine'];

// ---- heroes ----------------------------------------------------------------

export const HEROES = {
  tallowDuchess: {
    name: 'The Tallow Duchess', role: 'top',
    stats: { hp: 1150, dmg: 120, res: 10, spd: 9 },
    map: { name: 'Drip', text: 'Melts an allied minion on her cell: heals 60 and +2 DMG for good.', every: 5, op: { op: 'siphon', n: 1, heal: 60, who: 'self', grow: { dmg: 2 } } },
    fight: { name: 'Gutter', text: '150% DMG, healing half of it; costs 5% max HP above half health.', every: 3, op: { op: 'strike', pct: 150, pick: 'target', drain: 50, toll: 5 } },
    ult: { kind: 'trigger', name: 'Last Light', text: 'Under 20% HP in a fight: double DMG and cannot die until it ends, burning 2% a tick; then home at 1 HP.', cooldown: 4, when: { on: 'selfBelow', pct: 20 }, op: { op: 'undying', dmgPct: 100, burn: 2 } },
    cards: ['snuff', 'hotWax', 'rekindle'],
  },
  gnomon: {
    name: 'Gnomon', role: 'top',
    stats: { hp: 1000, dmg: 110, res: 20, spd: 12 },
    map: { name: 'Long Shadow', text: 'Enemy minions in the lane cell ahead of him stay put half the time.', every: 0, op: { op: 'shadow', permille: 500 } },
    fight: { name: 'Eclipse Cut', text: '130% DMG; a faster target loses its next turn.', every: 3, op: { op: 'strike', pct: 130, pick: 'target', daze: 'faster' } },
    ult: { kind: 'card', name: 'Rewind', text: 'A card: HP and place back to the start of the phase.', cooldown: 4, card: 'rewind' },
    cards: ['highNoon', 'hourHand', 'shadowStep'],
  },
  vespertine: {
    name: 'Vespertine', role: 'jungle',
    stats: { hp: 700, dmg: 165, res: 5, spd: 17 },
    map: { name: 'Dusk', text: 'Seen only on the same cell as an enemy hero or structure.', every: 0, op: { op: 'dusk' } },
    fight: { name: 'Puncture', text: '180% DMG to the weakest enemy; a kill grants another turn.', every: 2, op: { op: 'strike', pct: 180, pick: 'weakest', again: true } },
    ult: { kind: 'card', name: 'Nightfall', text: 'A card: the enemy sees only where it stands until the next fight phase.', cooldown: 4, card: 'nightfall' },
    cards: ['outOfTheDark', 'starPin', 'fade'],
  },
  carrionAbacus: {
    name: 'Carrion Abacus', role: 'jungle',
    stats: { hp: 850, dmg: 140, res: 10, spd: 14 },
    map: { name: 'Glean', text: 'Aggressive: kills an enemy minion next to him, takes its XP and a Bead (max 10).', every: 4, op: { op: 'glean', n: 1, store: 10 } },
    fight: { name: 'Reckon', text: 'DMG +15% per Bead, then spends 5 Beads.', every: 3, op: { op: 'strike', pct: 100, pick: 'target', perCharge: 15, spend: 5 } },
    ult: { kind: 'trigger', name: 'Final Count', text: 'A hero dies within 2: +5 Beads and his next turn is a Reckon.', cooldown: 2, when: { on: 'death', range: 2 }, op: { op: 'tally', n: 5 } },
    cards: ['circling', 'countTheBones', 'sumOfDebts'],
  },
  mothTenor: {
    name: 'Moth Tenor', role: 'mid',
    stats: { hp: 850, dmg: 80, res: 15, spd: 13 },
    map: { name: 'Aria', text: 'An enemy minion on or next to him changes sides; he earns it as a kill.', every: 6, op: { op: 'convert', n: 1 } },
    fight: { name: 'Swoon', text: 'The target spends its next turn attacking an ally.', every: 3, op: { op: 'swoon' } },
    ult: { kind: 'card', name: 'Lantern Procession', text: 'A card: allied minions near him fight beside him.', cooldown: 4, card: 'lanternProcession' },
    cards: ['lure', 'dustOfWings', 'lampSeason'],
  },
  lacuna: {
    name: 'Lacuna', role: 'mid',
    stats: { hp: 700, dmg: 130, res: 20, spd: 9 },
    map: { name: 'Erase', text: 'Kills 2 enemy minions on its cell and stores them as Void (max 12).', every: 10, op: { op: 'cull', n: 2, store: 12 } },
    fight: { name: 'Unmake', text: '2 Void per enemy in the fight: the target loses its next fight ability.', every: 3, op: { op: 'unmake', cost: 2 } },
    ult: { kind: 'card', name: 'Lacuna', text: "A card: cancel the opponent's costliest later card.", cooldown: 4, card: 'lacuna' },
    cards: ['negativeSpace', 'unwrite', 'silenceBetween'],
  },
  saintHalyard: {
    name: 'Saint Halyard', role: 'support',
    stats: { hp: 1000, dmg: 60, res: 30, spd: 9 },
    map: { name: 'Beam', text: 'Lights a cell 3 away, sweeping round like a lighthouse.', every: 1, op: { op: 'beam', dist: 3, ticks: 3 } },
    fight: { name: 'Lampward', text: 'The weakest ally gains a 200 + DMG shield.', every: 2, op: { op: 'ward', amount: 200, pct: 100 } },
    ult: { kind: 'command', name: 'Beacon', text: 'An allied hero on the aimed cell arrives on her cell.', cooldown: 4, range: 99, op: { op: 'beacon' } },
    cards: ['rescueLine', 'foghorn', 'keepersOath'],
  },
  vintnerGhast: {
    name: 'Vintner Ghast', role: 'support',
    stats: { hp: 850, dmg: 70, res: 15, spd: 11 },
    map: { name: 'Decant', text: 'Sacrifices an allied minion on her cell: allies on or next to it heal 80.', every: 6, op: { op: 'siphon', n: 1, heal: 80, who: 'near' } },
    fight: { name: 'Pour', text: 'Heals the ally lowest on HP% for 150% DMG; +2 SPD for the fight.', every: 2, op: { op: 'mend', pct: 150, spd: 2 } },
    ult: { kind: 'trigger', name: 'Toast', text: 'An ally in her fight would die: healed to 30% instead.', cooldown: 3, when: { on: 'allyDying' }, op: { op: 'reprieve', pct: 30 } },
    cards: ['spikedCup', 'secondGlass', 'vintage'],
  },
  scrimshander: {
    name: 'Scrimshander', role: 'carry',
    stats: { hp: 800, dmg: 90, res: 15, spd: 10 },
    map: { name: 'Carve', text: 'Every enemy minion she kills is Scrimshaw; each 10 is +5 DMG and +1 SPD.', every: 0, op: { op: 'carve', per: 10, grow: { dmg: 5, spd: 1 } } },
    fight: { name: 'Relief', text: 'An attack that ignores RES.', every: 2, op: { op: 'strike', pct: 100, pick: 'target', pierce: true } },
    ult: { kind: 'ascension', name: 'Masterwork', text: 'At 100 Scrimshaw her attacks hit every enemy, for good.', charge: 100, sweep: true },
    cards: ['killLine', 'boneNeedle', 'ivoryWard'],
  },
  brassReliquary: {
    name: 'Brass Reliquary', role: 'carry',
    stats: { hp: 850, dmg: 135, res: 15, spd: 6 },
    map: { name: 'Bombard', text: '100 damage to the nearest enemy structure within 2.', every: 5, op: { op: 'bombard', amount: 100, reach: 2 } },
    fight: { name: 'Grapeshot', text: '80% DMG to every enemy.', every: 2, op: { op: 'cleave', pct: 80 } },
    ult: { kind: 'card', name: 'Relic Shell', text: 'A card: 600 damage to an enemy hero or structure within 4.', cooldown: 4, card: 'relicShell' },
    cards: ['fuse', 'tampPowder', 'brace'],
  },
} as const satisfies Record<string, HeroDef>;

export type HeroId = keyof typeof HEROES;
export const HERO_IDS = Object.keys(HEROES) as HeroId[];
export const heroDef = (id: HeroId): HeroDef => HEROES[id];

/** Lineup order: uid within a side follows this. */
export const ROLES: Role[] = ['top', 'jungle', 'mid', 'support', 'carry'];

/** The two heroes of each role, split across the sides by the seed so every pairing gets played. */
export function lineups(seed: number): [HeroId[], HeroId[]] {
  const out: [HeroId[], HeroId[]] = [[], []];
  ROLES.forEach((role, i) => {
    const pair = HERO_IDS.filter((h) => heroDef(h).role === role);
    const flip = (seed >>> i) & 1;
    out[0].push(pair[flip]!);
    out[1].push(pair[1 - flip]!);
  });
  return out;
}

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

/** One copy of every staple and of each hero's cards. */
export function buildDeck(lineup: readonly HeroId[]): CardId[] {
  return [...STAPLES, ...lineup.flatMap((h) => heroDef(h).cards)];
}
