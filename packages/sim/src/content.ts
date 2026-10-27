import type { Stance } from './types.ts';

/**
 * Placeholder numbers. Everything balance-related lives here so the arena
 * script can sweep it without touching rules code.
 */
export const TICK_HZ = 20;
export const LANE = 8_000;
export const BATTLE_TICKS = 20 * TICK_HZ;
export const MAX_ROUNDS = 5;
export const NEXUS_HP = 300;
export const RESPAWN_TICKS = 6 * TICK_HZ;
export const SIEGE_PERCENT = 75;
export const HAND_SIZE = 4;
export const DRAFT_ORDER = [0, 1, 1, 0, 0, 1] as const;

export const councilMana = (round: number): number => Math.min(2 + round, 6);

export interface StanceDef {
  dmg: number;
  taken: number;
  speed: number;
  /** Furthest a unit will advance, in permille of the lane. */
  hold: number;
}

export const STANCES: Record<Stance, StanceDef> = {
  aggressive: { dmg: 125, taken: 120, speed: 115, hold: 1000 },
  balanced: { dmg: 100, taken: 100, speed: 100, hold: 1000 },
  defensive: { dmg: 85, taken: 75, speed: 90, hold: 450 },
};

export interface HeroDef {
  name: string;
  hp: number;
  dmg: number;
  range: number;
  speed: number;
  cooldown: number;
  crit: number;
  heal?: number;
}

export const HEROES = {
  knight: { name: 'Knight', hp: 160, dmg: 24, range: 500, speed: 40, cooldown: 20, crit: 80 },
  brute: { name: 'Brute', hp: 210, dmg: 32, range: 450, speed: 34, cooldown: 30, crit: 60 },
  archer: { name: 'Archer', hp: 90, dmg: 22, range: 2600, speed: 38, cooldown: 22, crit: 120 },
  mage: { name: 'Mage', hp: 80, dmg: 48, range: 2200, speed: 32, cooldown: 40, crit: 100 },
  rogue: { name: 'Rogue', hp: 100, dmg: 20, range: 450, speed: 60, cooldown: 12, crit: 250 },
  cleric: { name: 'Cleric', hp: 100, dmg: 10, range: 2000, speed: 34, cooldown: 30, crit: 0, heal: 22 },
  lancer: { name: 'Lancer', hp: 130, dmg: 30, range: 900, speed: 48, cooldown: 26, crit: 100 },
  warden: { name: 'Warden', hp: 190, dmg: 16, range: 600, speed: 36, cooldown: 18, crit: 40 },
} as const satisfies Record<string, HeroDef>;

export type HeroId = keyof typeof HEROES;
export const HERO_IDS = Object.keys(HEROES) as HeroId[];
export const hero = (id: HeroId): HeroDef => HEROES[id];

export interface CardDef {
  name: string;
  cost: number;
  text: string;
}

export const CARDS = {
  rally: { name: 'Rally', cost: 2, text: 'Allies heal 50' },
  volley: { name: 'Volley', cost: 2, text: '30 dmg to every foe' },
  fortify: { name: 'Fortify', cost: 2, text: 'Nexus +40' },
  warcry: { name: 'Warcry', cost: 1, text: '+25% dmg next fight' },
  haste: { name: 'Haste', cost: 1, text: '+30% speed next fight' },
  gambit: { name: 'Gambit', cost: 1, text: '50%: 60 dmg to nexus' },
} as const satisfies Record<string, CardDef>;

export type CardId = keyof typeof CARDS;
export const CARD_IDS = Object.keys(CARDS) as CardId[];
export const card = (id: CardId): CardDef => CARDS[id];
export const STARTING_DECK: CardId[] = CARD_IDS.flatMap((id) => [id, id]);
