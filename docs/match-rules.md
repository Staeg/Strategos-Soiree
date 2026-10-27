# Match rules, as implemented

This is what the sim does today. Lines marked **(gap fill)** are my guesses
where the design left a hole; every number lives in
`packages/sim/src/content.ts` so tuning never touches rules code.

## Board

- A hexagon of side 5: 61 pointy-top cells. Side 0's core is the bottom-left
  corner, side 1's the top-right.
- Top lane runs up the left rim and across the top, bot along the bottom rim
  and up the right; mid goes straight through the centre. Side lanes are 13
  cells, mid is 9.
- Each core is flanked by three inner towers. Side lanes: 2 empty cells, then
  the outer tower on the rim corner, then 3 battleground cells to the enemy's
  outer tower. Mid: 1 empty cell, then the outer tower, then the single
  contested centre cell.
- Everything off the lanes is jungle, split by the river (the two cells
  equidistant from both cores). **(gap fill)** Each side has 4 camps, two in
  each half of the jungle, of 4 creeps that refill 40 ticks after being cleared.
- Lineup is 1-1-1-2: top, jungle, mid, and support + carry bot.

## Map phase (one step = one map tick, about a second)

Order inside a tick: respawns and retreat checks, heroes walk, map abilities,
then every cell fights at once (all intents gathered before any applies),
then free minions march, then camps refill, waves spawn, cards are drawn.

- **Waves**: 12 minions per lane per side every 8 ticks, walking one cell a
  tick. Each minion has a 10% chance per tick to strike: an enemy minion if
  any, else an enemy structure (50), else an enemy hero (50). A minion that
  strikes a hero stays put that tick, which staggers waves. **(gap fill)**
  Minions are pinned while enemy minions or an enemy structure share their
  cell, and the sides alternate who moves first so waves meet on a cell
  rather than passing through each other.
- **Heroes** kill 1 enemy minion (or creep) on their cell per tick when
  passive, 2 when aggressive. **(gap fill)** Structures kill one enemy minion
  a tick, or shoot an enemy hero for 120 when no enemy minion shields them.
  Aggressive heroes chip an unshielded enemy structure for a flat 25 a tick;
  passive ones don't. Towers 1500 (outer), 2000 (inner), core 3000.
- **Routing**: laners meet the nearest enemy minions they can see on their
  side of the enemy's next tower, else walk with their own wave's front, else
  hold at their outer tower; they only step under an enemy tower while their
  own minions are there. Junglers walk to the nearest camp they believe is up
  (aggressive ones count enemy camps too). Bot duo shares the lane.
- **Retreat**: below 40% HP (passive) or 20% (aggressive), a hero walks home on
  the next tick. **(gap fill)** The own core heals 25% max HP per tick; the hero
  heads back out at full HP. Dead heroes respawn at the core after 15 ticks.
- **Orders**: stance toggle and roam, each once between fight phases. Death
  resets stance to passive. Roam lasts until the next fight phase. **(open
  question)** I made this once per team, not per hero; it is one constant
  (`ORDERS_PER_PHASE`).
- **Fog**: a side sees cells with its heroes, minions or structures, cells
  next to its standing structures, and map-ability/ultimate reveals. The AI
  and the client both only ever get this view (`viewFor`).
- **XP**: a minion or creep death gives 1 XP to each enemy hero on its cell
  plus 1 shared between them; hero kills 10 + 10 shared; a fallen tower 10
  to every enemy hero. Each point: +1 DMG, +10 HP, +1 RES. Shared XP is
  stored in 60ths so splits stay exact.
- Every 10 ticks both sides draw; every 50 ticks the fight phase starts.
  **(gap fill)** At 3000 ticks the side with more structure HP left wins.

## Fight phase

1. **Commit**: both sides get 10 mana (up to 10 more carried over) and play
   cards blind, each naming a source hero and, if needed, a target. On
   commit, unplayed cards beyond 5 are discarded (right-click picks which,
   else the oldest go).
2. **Reveal**: plays resolve by initiative, 0 first. Plays sharing an
   initiative are checked and aimed against the state before any of them,
   then applied together.
3. **Clash**: all engagements run side by side in fight ticks; a step jumps to
   the next tick where someone acts. Heroes acting on the same tick go in a
   random order.

Card rules follow the hero brainstorm's conventions:

- **Engage (R, L)**: the source hero starts a fight with a visible enemy hero
  within R cells (an aggressive target counts 1 closer). Every hero on either
  cell is pulled in. L is the base length; **(gap fill)** each aggressive
  hero in the fight adds 5 ticks. Overlapping fights merge.
- **Join (R)**: the source enters an allied fight within R (aggressive heroes
  have 1 less reach). The fight must exist at an earlier initiative.
- **Tactic**: changes the fight its hero is in.
- **Bound**: hero cards fizzle if their hero is dead or at base.
- Shields last to the end of the fight phase. A hero acts every
  ceil(100 / SPD) fight ticks; its fight ability fires every Nth turn, other
  turns are basic attacks on its focus or a random enemy.
- **Ultimates** (cooldowns in fight phases): Command (aimed on the map any
  time in the map phase), Card (a unique card joins the hand at the next draw
  when ready), Trigger (fires in a fight when its condition holds), Ascension
  (one-time, at an XP threshold).

Deck: each hero's 3 cards ×2 plus 2 of each staple (Skirmish, Reinforce, Fall
Back, Press the Attack, Second Wind, Hold the Line): 42 cards.

## Placeholder content

Five test heroes, one per role, named "Test Top" and so on, with stats,
abilities and cards that exercise every effect category. They borrow the old
pixel costumes. The real roster replaces them once it is agreed.
