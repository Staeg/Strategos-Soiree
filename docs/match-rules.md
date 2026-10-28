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
- The sides are mirror images across the river, so every lane and camp is
  equal ground.
- Everything off the lanes is jungle, split by the river (the two cells
  equidistant from both cores). Each side has one of each of the five camps
  below, at random every match: three in one half of its jungle (split by
  mid) and two in the other. Side 1's camps are side 0's turned half a circle
  about the centre, so a Wyrm north-east of one core is south-west of the
  other, and a camp north-west of one bot outer tower is south-east of the
  other top outer tower. Lanes stay mirrored across the river.
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
- **Heroes** kill 1 enemy minion on their cell per tick when passive, 2
  when aggressive. On a camp they deal 1 or 2 times their DMG instead (less
  the camp's RES), felling its creeps in turn with damage spilling over. **(gap fill)** Structures kill one enemy minion
  a tick, or shoot an enemy hero for 120 when no enemy minion shields them.
  Aggressive heroes chip an unshielded enemy structure for a flat 25 a tick;
  passive ones don't. Towers 1500 (outer), 2000 (inner), core 3000.
- **Routing**: laners meet the nearest enemy minions they can see on their
  side of the enemy's next tower, else walk with their own wave's front, else
  hold at their outer tower; they only step under an enemy tower while their
  own minions are there. Junglers walk to the camp they can start soonest:
  the longer of the walk and the wait for it to respawn, by what their side
  last saw (aggressive ones also raid enemy camps believed up). Bot duo shares the lane.
- **Laning**: a non-jungler on a lane cell with no allied minions on it or
  further ahead along the lane is exposed. Each enemy hero on that cell gets a
  free hit on it (its DMG against the hero's RES), and it withdraws one cell
  towards home. Laners walk back up behind their wave, so lanes rock back and
  forth with the waves and structures wear down.
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
- **XP**: a minion death gives 1 XP to each enemy hero on its cell plus 1
  shared between them; a creep gives its camp's XP, shared; hero kills 10 + 10 shared; a fallen tower 10
  to every enemy hero. Every 10 XP: +1 DMG, +10 HP, +1 RES (a tenth of the
  original rate). Shared XP is stored in 60ths so splits stay exact.
- Every 10 ticks both sides draw; every 50 ticks the fight phase starts.
  **(gap fill)** At 3000 ticks the side with more structure HP left wins.

## Jungle camps

Camp creeps don't roll to hit: every creep strikes a hero on the camp once
every `every` ticks it is fought, so a camp's cost is something a player can
count. A camp refills `respawn` ticks after its last creep falls. All
numbers are per creep, in `CAMPS` in `content.ts`.

| Camp | Creeps | HP | DMG | RES | Strikes every | XP | Respawn | Character |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Wallflowers | 6 | 220 | 22 | 0 | 3 | 7 | 55 | quick and rich per tick, nips from every side |
| Cloakroom | 4 | 480 | 35 | 10 | 5 | 11 | 60 | the middling one |
| Topiary Hounds | 2 | 1000 | 28 | 60 | 5 | 28 | 65 | slow to cut, but safe: the camp to take when low |
| Chandelier | 1 | 1400 | 175 | 20 | 10 | 50 | 65 | falls hard every 10th tick: kill it before the 10th, take it free |
| Punch-Bowl Wyrm | 1 | 3300 | 62 | 30 | 4 | 84 | 80 | the most to chew through and the most to gain |

They are tuned with `npm run jungle -- 200`, which plays matches where
nobody gives an order or plays a card, so junglers live in their own
jungle and laners in their lanes. Over 200 seeds:

- **XP**: the jungler stays slightly ahead of the average solo (top and
  mid) laner, with the walks home included: 1.06× at tick 100, 1.04× at
  200, 1.08× at 300, 1.11× at 500 (behind only at tick 50, after the first
  walk home). Vespertine clears faster than Carrion Abacus (1.13× vs 1.08×
  at 500), so the jungler stats were left as they were.
- **Damage**: a fresh jungler walks home after 2.35 camps on average and
  never dies to camps; 1% of first clears finish all five before going home.
- **Respawns**: in the first 100 ticks the jungler finds all five of its
  camps down on 1.6% of its active ticks. As it levels it clears faster
  than they come back: 22% at ticks 100-199, 40% by 400-499.

## Fight phase

1. **Commit**: both sides get 10 mana (up to 10 more carried over) and play
   cards blind, each naming a source hero and, if needed, a target. On
   commit, unplayed cards beyond 5 are discarded (right-click picks which,
   else the oldest go).
2. **Reveal**: plays resolve by initiative, 0 first. Plays sharing an
   initiative are checked and aimed against the state before any of them,
   then applied together.
3. **Clash**: the engagements an initiative started fight to the end before
   the next initiative resolves, so a hero can fight twice in one phase. They
   run side by side in fight ticks; a step jumps to the next tick where
   someone acts, and heroes acting on the same tick go in a random order.
   **(open question)** `INTERLEAVE` in `content.ts` switches back to "every
   card first, then all fights".

Card rules:

- **Engage (R, L)**: the source hero starts a fight with a visible enemy hero
  within R cells (an aggressive target counts 1 closer). Every hero on either
  cell is pulled in. L is the base length; **(gap fill)** each aggressive
  hero in the fight adds 5 ticks. Engages at the same initiative that share
  a hero become one engagement whose length is all of theirs added up.
- **Next engagement**: Join and Tactic cards, and any card that changes a
  fight, wait on their hero and land when its next engagement this phase
  starts, whoever started it. An engagement starting at the same initiative
  counts.
- **Join (R)**: the source enters its next allied engagement within R
  (aggressive heroes have 1 less reach).
- Cards that used to act "after all engagements" (Second Wind, Second Glass,
  Rewind) act at their own initiative.
- **Bound**: hero cards fizzle if their hero is dead or at base.
- Shields last to the end of the fight phase; every other fight bonus lasts
  one engagement. A hero acts every ceil(100 / SPD) fight ticks; its fight
  ability fires every Nth turn, other turns are basic attacks on its focus or
  a random enemy.
- **Ultimates** (cooldowns in fight phases): Command (aimed on the map any
  time in the map phase), Card (a unique card joins the hand at the next draw
  when ready), Trigger (fires the moment its condition holds), Ascension
  (one-time, at a charge threshold).

Deck: one copy of each hero's 3 cards plus one of each staple (Skirmish,
Reinforce, Fall Back, Press the Attack, Second Wind, Hold the Line): 21
cards. The discard pile is shuffled back in when the draw pile runs out.
Staples are played from whichever allied hero the player picks.

## Heroes

The first ten are in: two per role, and the seed decides which side gets
which. Their abilities and cards are in `docs/heroes-draft.md` and, as data,
in `packages/sim/src/content.ts`.
