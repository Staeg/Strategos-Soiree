# First roster: 20 heroes

Status: ten are implemented, with Stag's changes folded into their entries
below: the Tallow Duchess, Gnomon, Vespertine, Carrion Abacus, Moth Tenor,
Lacuna, Saint Halyard, Vintner Ghast, Scrimshander and Brass Reliquary. The
other ten are still a brainstorm. Numbers are first guesses meant to be
argued with.

## The look, in one line

Every hero is a guest at a ball held at the edge of the world: half courtly,
half uncanny. Each one is a single strong silhouette on the 20×16 frame with
**one signature colour** against a muted body, so two dozen tiny sprites stay
readable on a hex map. Several are not people at all (a bell, a void between
two gloves, a pair of twins counted as one hero).

### Placeholder art

Until real sprites arrive, every hero is drawn from code
(`packages/client/src/art/heroes.ts`), and the one rule for it is:

- **Make the characters as visually distinct as possible.** Each hero owns a
  *signature*: a main colour, a counter-colour and a small accent, chosen so
  that no two heroes share a pair. Spread the main colours round the wheel;
  where two heroes must lean on the same hue, separate them by value (light
  against dark) or by a clashing partner. Keep clear of the two team
  liveries, teal and rose, which every body already wears on its torso.
- Silhouette carries as much as colour: a head that is not a head (a flame,
  a lantern, a void), a prop held out from the body, something on the back.
- The signature is reused wherever the hero appears outside the board, such
  as the edge of its bar in the match HUD, so a colour always means one hero.

| Hero | Main | Counter | Accent |
|------|------|---------|--------|
| The Tallow Duchess | flame orange | ivory wax | flame yellow |
| Gnomon | verdigris green | bronze | noon gold |
| Vespertine | deep violet | silver crescent | star white |
| Carrion Abacus | carrion brown | blood-red beads | bone |
| Moth Tenor | pale chartreuse | lavender eyespots | lantern glow |
| Lacuna | black | white | grey |
| Saint Halyard | lighthouse scarlet | whitewash | lamp yellow |
| Vintner Ghast | wine burgundy | bottle green | glass highlight |
| Scrimshander | sea-blue oilskin | ivory tusk | pale sea |
| Brass Reliquary | polished brass | black iron | halo |

New heroes pick an unused pair before anything else is drawn.

## Conventions the cards assume

These fill gaps in the match design. They are the bits the engine and the
roster both depend on, so they are worth agreeing on early.

- **Initiative** runs 0 to 9 and resolves ascending: 0 first, 9 last. Equal
  initiative is simultaneous. Rough bands: 0–1 setup and information, 2–4
  protection, tricks and the Tactics that shape fights, 5–8 engages, 7–9
  follow-ups and aftermath. Tactics sit before the engages so they land on
  the fights they were played for; Out of the Dark (2) is the one early
  engage, Vespertine's ambush.
- **Engage (reach R, length L)**: start an engagement between this hero and a
  visible enemy hero within R hexes. Any other heroes on either hex are pulled
  in. L is the base fight-tick count (average 50 across the roster).
  An enemy in aggressive stance counts as 1 hex closer.
- **Engagements resolve at their initiative**: everything an initiative
  starts is fought out before the next initiative, so a hero can fight more
  than once a phase. Engages at the same initiative that share a hero merge
  into one engagement as long as all of them added together.
- **Next engagement**: a card that affects an engagement (Join, Tactic,
  anything that changes a fight) acts on its hero's next engagement that
  phase, whoever starts it.
- **Join (reach R)**: this hero enters its next allied engagement within R
  hexes. A hero in aggressive stance has 1 less reach to Join.
- **Tactic**: changes this hero's next engagement.
- Nothing waits for "after all engagements": such cards act at their own
  initiative.
- **No reveal cards.** Cards resolve simultaneously and the map moves on
  before you could use what they show, so vision lives on map abilities
  and Command ultimates only.
- **Bound**: every hero card is bound; it fizzles if its hero is dead or at
  base when it resolves. (Hidden keyword, shown with Alt.)
- **Shield**: absorbs damage, gone at the end of the fight phase.
- **Turns in a fight**: a hero acts every ⌈100 ÷ SPD⌉ fight ticks, so SPD 10
  acts 5 times in a 50-tick fight and SPD 20 acts 10 times. The fight ability
  fires on the turn listed ("every 3rd turn" = turns 3, 6, 9…); other turns
  are basic attacks.
- **Map abilities** run on their own, every N map ticks.
- **Ultimate categories** (cooldowns in fight phases):
  - *Command*: a third command the player aims on the map, usable any time
    in the map phase.
  - *Card*: when ready, a unique card enters your hand at the next draw. It
    never enters the deck and goes back on cooldown when played.
  - *Trigger*: fires by itself in a fight when its condition is met.
  - *Ascension*: a one-time transformation reached by playing well.
- **Deck**: one copy of each hero's 3 cards and of each of the 6 staples
  (21 total). The discard pile reshuffles when the draw pile runs out. With
  5 draws per map phase and 5 cards saved, a full hand is about 10.

## Roster at a glance

| Role | Hero | HP | DMG | RES | SPD | Archetype |
|---|---|---|---|---|---|---|
| Top | Ossuary Bell | 1500 | 70 | 40 | 6 | Warden, taunts |
| Top | The Tallow Duchess | 1150 | 120 | 10 | 9 | Self-burning bruiser |
| Top | Gnomon | 1000 | 110 | 20 | 12 | Duelist, time |
| Top | Mother Sprue | 1300 | 85 | 25 | 7 | Pusher, holds lanes |
| Jungle | Cairn | 1700 | 65 | 55 | 5 | Tank, area engage |
| Jungle | The Mire Abbot | 1450 | 80 | 35 | 8 | Tank, ganks from bogs |
| Jungle | Vespertine | 700 | 165 | 5 | 17 | Assassin, unseen |
| Jungle | Carrion Abacus | 850 | 140 | 10 | 14 | Assassin, scavenger |
| Mid | Glasswright | 750 | 150 | 10 | 10 | Burst mage, fragile |
| Mid | The Cartographer | 800 | 105 | 15 | 11 | Vision, map control |
| Mid | Moth Tenor | 850 | 80 | 15 | 13 | Charm, steals minions |
| Mid | Lacuna | 700 | 130 | 20 | 9 | Counterplay, erasure |
| Support | Saint Halyard | 1000 | 60 | 30 | 9 | Vision, rescues |
| Support | Vintner Ghast | 850 | 70 | 15 | 11 | Healer, minion fuel |
| Support | Orrery | 950 | 75 | 25 | 8 | Initiative and tempo |
| Support | The Hooded Mantis | 1100 | 95 | 20 | 12 | Engage, XP funnel |
| Carry | Marquise Rook | 700 | 150 | 10 | 14 | Ranged, falconer |
| Carry | Scrimshander | 800 | 90 | 15 | 10 | Late-game scaler |
| Carry | The Twinned | 900 | 60 | 15 | 20 | Two bodies, many hits |
| Carry | Brass Reliquary | 850 | 135 | 15 | 6 | Siege artillery |

Averages: HP 995, DMG 102, RES 20, SPD 10.5. 13 of 20 map abilities touch
minions (fuel, staggering, conversion, theft, funnelling).

---

## Top

### Ossuary Bell
`HP 1500 · DMG 70 · RES 40 · SPD 6`

*Look:* a squat bronze bell on two stick legs, a cloth skirt at the rim, the
clapper hanging like a tongue. Verdigris green. Rings (two-frame sway) when it
acts.

*Plays like:* the lane you can't dive. Slow, deaf to tricks, everyone in the
fight ends up hitting it.

- **Map · Toll** (every 10 ticks): every enemy hero within 2 hexes is
  revealed for 3 ticks. The sound gives away anyone lurking near top.
- **Fight · Resonance** (every 2nd turn): 60% DMG to every enemy; each one
  hit attacks the Bell on its next turn.
- **Ultimate · Requiem** (Command, 3): every enemy hero within 3 hexes is
  revealed and cannot change stance until the next fight phase.

| Card | Cost | Init | Keywords | Effect |
|---|---|---|---|---|
| Summoning Toll | 3 | 5 | Engage (1, 40) | The Bell takes 30% less damage for the first 10 ticks. |
| Hollow Echo | 2 | 3 | Tactic | Every enemy's first turn in the Bell's engagement is spent attacking the Bell. |
| Ossify | 1 | 8 | Tactic | The Bell gains +40 RES for this phase's remaining engagements. |

### The Tallow Duchess
`HP 1150 · DMG 120 · RES 10 · SPD 9`

*Look:* a tall candle in a pale wax gown that drips as she walks, a small
flame for a head. Flame orange and ivory; the flame flickers between two frames.

*Plays like:* burns her own wave and her own health for power, trusting her
ultimate to keep her standing.

- **Map · Drip** (every 5 ticks): melts one *allied* minion on her hex, healing
  60 HP and gaining +2 DMG for good.
- **Fight · Gutter** (every 3rd turn): 150% DMG to her target, healing half
  of it. If she is above 50% HP, she also loses 5% of her max HP.
- **Ultimate · Last Light** (Trigger, 4): the first time she would drop
  below 20% HP in an engagement, she becomes pure flame: double DMG, loses 2%
  max HP per tick, cannot die until the engagement ends, then returns to base
  at 1 HP.

| Card | Cost | Init | Keywords | Effect |
|---|---|---|---|---|
| Snuff | 3 | 5 | Engage (1, 30) | A short, early, brutal fight. |
| Hot Wax | 2 | 3 | Tactic | Her target has its SPD halved for the first 20 ticks. |
| Rekindle | 1 | 1 | — | Heal 25% max HP. |

### Gnomon
`HP 1000 · DMG 110 · RES 20 · SPD 12`

*Look:* a lanky knight with a round sundial plate across his back, the blade
of the dial jutting over one shoulder. A long black shadow sprite trails him
in a fixed direction regardless of where he faces. Verdigris and bronze.

*Plays like:* a duelist who wants clean one-on-ones and punishes fast heroes.

- **Map · Long Shadow** (always): his shadow covers the next lane hex toward
  the enemy. Each enemy minion standing in it fails to move with 50%
  probability every tick, so waves arrive at him staggered and thin.
- **Fight · Eclipse Cut** (every 3rd turn): 130% DMG; if the target's SPD is
  higher than his, it loses its next turn.
- **Ultimate · Rewind** (Card, 4): *Rewind* costs 4, initiative 9: Gnomon's
  HP and position are set back to what they were at the start of the fight
  phase. A dead Gnomon is rewound too.

| Card | Cost | Init | Keywords | Effect |
|---|---|---|---|---|
| High Noon | 2 | 5 | Engage (1, 50) | One target only: nobody else can Join this engagement. |
| Hour Hand | 1 | 2 | Tactic | Gnomon takes his first turn on the first tick of his engagement, whatever his SPD. |
| Shadow Step | 2 | 3 | — | Gnomon steps one lane cell ahead, into the hex his Long Shadow covers (out of reach of Engages measured from his old hex). |

### Mother Sprue
`HP 1300 · DMG 85 · RES 25 · SPD 7`

*Look:* a hunched grandmother in a moss shawl, a crooked staff topped with a
birdcage full of bees (single yellow pixels that orbit). Moss green and bark
brown.

*Plays like:* never loses a wave. Turns dead minions into walls and wins the
lane by attrition.

- **Map · Sprout** (every 8 ticks): if an allied minion died on her hex since
  the last Sprout, it rises as a Sapling: a minion with double life that never
  moves and blocks its hex for enemy minions.
- **Fight · Thicket** (every 3rd turn): her target skips its next turn; she
  heals 10% of her missing HP.
- **Ultimate · Overgrowth** (Command, 3): every allied minion in her lane
  gains a second life until the next fight phase.

| Card | Cost | Init | Keywords | Effect |
|---|---|---|---|---|
| Bramble Wall | 2 | 2 | — | Her hex blocks enemy minions and enemy heroes' movement until the next fight phase. |
| Grasp of Roots | 3 | 6 | Engage (2, 45) | Pulls the target onto her hex. |
| Seed Pod | 1 | 8 | — | Her lane's next wave spawns with 16 minions instead of 12. |

## Jungle

### Cairn
`HP 1700 · DMG 65 · RES 55 · SPD 5`

*Look:* five balanced stones, the top one with two lichen eyes; the stack
wobbles a pixel per frame. Slate grey with ochre lichen.

*Plays like:* slow, unkillable, and the only hero that can start a fight with
everyone at once.

- **Map · Quarry** (each camp cleared): leaves rubble on the camp hex for 20
  ticks. Enemy heroes spend 2 ticks crossing rubble.
- **Fight · Crush** (every 2nd turn): 50% DMG to every enemy, each loses 3
  SPD for the rest of the engagement (stacks).
- **Ultimate · Avalanche** (Card, 4): *Avalanche* costs 5, initiative 4:
  Engage every enemy hero within 2 hexes of Cairn in one engagement, length
  60.

| Card | Cost | Init | Keywords | Effect |
|---|---|---|---|---|
| Rockfall | 3 | 5 | Engage (2, 50) | Target must stand on a lane hex next to the jungle. |
| Bulwark of Stone | 2 | 3 | Join (2) | For the first 15 ticks, attacks aimed at allies hit Cairn instead. |
| Settle | 1 | 9 | — | After all engagements, Cairn heals 20% max HP. |

### The Mire Abbot
`HP 1450 · DMG 80 · RES 35 · SPD 8`

*Look:* a hunched frog-faced monk in a sodden habit, a lily pad for a hat,
swinging a censer that leaks green gas. Murky teal.

*Plays like:* lays a trail, then ganks from it. Strong against heroes who
overstay in lane.

- **Map · Bogwater** (always): hexes he walks through stay boggy for 10
  ticks. Enemy minions there move only every other tick, piling up.
- **Fight · Sink** (every 3rd turn): his target loses 20 RES for the
  engagement and he gains it.
- **Ultimate · Swallow the Path** (Command, 3): for the next 20 map ticks he
  crosses any jungle hex in a single tick.

| Card | Cost | Init | Keywords | Effect |
|---|---|---|---|---|
| From the Reeds | 3 | 3 | Engage (1, 50) | Early engage, but the target must be on a hex he bogged in the last 10 ticks. |
| Leech | 2 | 6 | Tactic | Each time an enemy attacks in his engagement, he heals 30. |
| Mudslick | 1 | 2 | — | An enemy hero within 3 hexes cannot Roam this map phase. |

### Vespertine
`HP 700 · DMG 165 · RES 5 · SPD 17`

*Look:* a slender human outline that is a hole in the world, showing a
starfield that twinkles; only a pale crescent mask floats where the face
would be. Deep violet with white single-pixel stars.

*Plays like:* the reason fog of war matters. You know she's coming; you don't
know where.

- **Map · Dusk** (always): minions never reveal her, and she passes towers
  unseen. Enemies see her only while she shares a hex with an enemy hero or
  structure.
- **Fight · Puncture** (every 2nd turn): 180% DMG to the lowest-HP enemy; if
  it kills, she takes another turn at once.
- **Ultimate · Nightfall** (Card, 4): *Nightfall* costs 3, initiative 1:
  until the next fight phase, the enemy sees only the hexes their own units
  stand on (towers lose their adjacent vision too).

| Card | Cost | Init | Keywords | Effect |
|---|---|---|---|---|
| Out of the Dark | 2 | 2 | Engage (1, 25) | Very early, very short. |
| Star Pin | 1 | 4 | Tactic | In her next engagement, all allies attack a chosen enemy for the first 15 ticks. |
| Fade | 1 | 4 | Tactic | Vespertine leaves her next engagement after its 10th tick and returns to the nearest jungle hex. |

### Carrion Abacus
`HP 850 · DMG 140 · RES 10 · SPD 14`

*Look:* a lean vulture-man in a brown frock, an enormous abacus strapped to
his back whose red beads slide as he scores. Carrion brown and blood red.

*Plays like:* steals from lanes, counts every death, and arrives when someone
is already hurt.

- **Map · Glean** (every 4 ticks, aggressive stance only): kills an enemy
  minion on a lane hex next to him, takes its XP and slides a Bead (max 10).
- **Fight · Reckon** (every 3rd turn): (1 + 0.15 × Beads) × DMG to his
  target, then 5 Beads are spent.
- **Ultimate · Final Count** (Trigger, 2): when any hero dies within 2 hexes
  of him, he gains 5 Beads and his next turn is a Reckon.

| Card | Cost | Init | Keywords | Effect |
|---|---|---|---|---|
| Circling | 2 | 6 | Engage (2, 40) | Only targets a hero below 60% HP. |
| Count the Bones | 0 | 3 | — | Gain 3 Beads. |
| Sum of Debts | 3 | 8 | Join (2) | His first turn in his next engagement is a Reckon. |

## Mid

### Glasswright
`HP 750 · DMG 150 · RES 10 · SPD 10`

*Look:* a body shaped like an arched church window, a rose window for a
head, jewel-coloured panes in black leading. Every colour, held together by
black. Throws coloured shards.

*Plays like:* devastating, fragile, and slowly breaking itself to win.

- **Map · Prism** (every 5 ticks): kills an enemy minion on its hex and one
  on each neighbouring lane hex.
- **Fight · Shatter** (every 3rd turn): 120% DMG to every enemy; it loses 10%
  of its own max HP.
- **Ultimate · Cathedral** (Card, 3): *Cathedral* costs 4, initiative 2: a
  glass dome over a hex within 3. Engage cards cannot target heroes inside it
  this phase.

| Card | Cost | Init | Keywords | Effect |
|---|---|---|---|---|
| Lancet Window | 3 | 5 | Engage (2, 40) | The ranged mid engage. |
| Leaded Frame | 2 | 1 | Shield | Glasswright gains a 400 Shield. |
| Refraction | 2 | 6 | Tactic | The first hit any enemy lands on Glasswright is copied back onto that enemy. |

### The Cartographer
`HP 800 · DMG 105 · RES 15 · SPD 11`

*Look:* a stooped figure in parchment robes, a quill as long as a spear, a
brass telescope in place of one eye. Sepia and ink blue.

*Plays like:* plays the map, not the fight. Sees everything, then deletes
part of the board.

- **Map · Survey** (every 6 ticks): a fogged hex next to her becomes
  permanently visible until an enemy hero stands on it.
- **Fight · Margin Note** (every 2nd turn): marks her target; the next ally
  to hit it deals +50%.
- **Ultimate · Erratum** (Command, 4): a hex within 5 is erased until the
  next fight phase. Nothing can enter it; anything on it is pushed to the
  nearest hex. (Not tower or Core hexes.)

| Card | Cost | Init | Keywords | Effect |
|---|---|---|---|---|
| Triangulate | 1 | 1 | — | An enemy hero within 4 hexes counts as standing on a Surveyed hex this phase. |
| Here Be Dragons | 3 | 6 | Engage (3, 45) | Only targets a hero on a hex she has Surveyed. |
| Contour Line | 2 | 3 | — | Draw a line of 3 hexes; enemy heroes cannot Roam across it this phase. |

### Moth Tenor
`HP 850 · DMG 80 · RES 15 · SPD 13`

*Look:* a tall moth in a mantle of dusty wings, feathered antennae, holding a
lantern; two lavender eyespots on the wings. Pale chartreuse and lavender, a
faint dust trail.

*Plays like:* the wave in mid slowly becomes his. Fights against him turn on
themselves.

- **Map · Aria** (every 6 ticks): one enemy minion on his hex or a
  neighbouring hex switches sides, and he gets the XP as if he had killed it.
- **Fight · Swoon** (every 3rd turn): his target spends its next turn
  attacking one of its own allies (or skips, if alone).
- **Ultimate · Lantern Procession** (Card, 4): *Lantern Procession* costs 3,
  initiative 3: up to 6 allied minions on or next to his hex follow him into
  his next engagement and fight as combatants (100 HP, 25 DMG, 5 SPD each).
  Enemies can hit them; survivors go back to the lane.

| Card | Cost | Init | Keywords | Effect |
|---|---|---|---|---|
| Lure | 2 | 6 | Engage (2, 50) | Fought on his hex. |
| Dust of Wings | 1 | 3 | Tactic | In his next engagement, every enemy has −3 SPD for the first 20 ticks. |
| Lamp Season | 2 | 2 | — | Allied minions in his lane hit twice as often next map phase. |

### Lacuna
`HP 700 · DMG 130 · RES 20 · SPD 9`

*Look:* a pair of white gloves and a starched collar floating around nothing;
a small black square where a face would be. Pure black and white, no other
colour.

*Plays like:* the answer to whatever the opponent planned. Rewards reading
your opponent.

- **Map · Erase** (every 10 ticks): kills 2 enemy minions on its hex, for
  the usual XP, and stores them as Void (max 12).
- **Fight · Unmake** (every 3rd turn): no damage. Costs 2 Void per enemy in
  the fight; its target loses its next fight-ability use. Without enough
  Void, Lacuna attacks instead.
- **Ultimate · Lacuna** (Card, 4): *Lacuna* costs 2, initiative 0: cancel the
  highest-cost card the opponent played at a later initiative this phase
  (ties: the later initiative).

| Card | Cost | Init | Keywords | Effect |
|---|---|---|---|---|
| Negative Space | 3 | 6 | Engage (2, 50) | — |
| Unwrite | 2 | 2 | — | An enemy hero within 3 hexes loses its map ability until the next fight phase. |
| Silence Between | 0 | 9 | — | The opponent can save 1 fewer card this phase (a random one goes). |

## Support

### Saint Halyard
`HP 1000 · DMG 60 · RES 30 · SPD 9`

*Look:* a broad keeper in an oilskin coat, a glass lantern for a head whose
beam sweeps around the hex. Lighthouse scarlet and white stripes, a yellow
lamp.

*Plays like:* nobody on her team dies alone, and nothing bot goes unseen.

- **Map · Beam** (every tick): reveals one hex at distance 3, rotating
  through the six directions like a lighthouse sweep.
- **Fight · Lampward** (every 2nd turn): the lowest-HP ally gains a Shield
  of 200 + her DMG.
- **Ultimate · Beacon** (Command, 4): an allied hero anywhere on the map
  arrives on her hex at the next map tick.

| Card | Cost | Init | Keywords | Effect |
|---|---|---|---|---|
| Rescue Line | 2 | 2 | — | An allied hero within 2 hexes is pulled out of any engagement starting this phase. |
| Foghorn | 2 | 5 | Engage (2, 30) | — |
| Keeper's Oath | 1 | 4 | Join (2) | All allies in that engagement gain +20 RES. |

### Vintner Ghast
`HP 850 · DMG 70 · RES 15 · SPD 11`

*Look:* a translucent phantom in a waiter's tailcoat, a carafe in one hand,
a tray floating at its shoulder. Wine burgundy and bottle green.

*Plays like:* pours the wave into her carry. Strong sustain, a weaker lane.

- **Map · Decant** (every 6 ticks): sacrifices an allied minion on her hex to
  heal each allied hero on or next to it for 80. The enemy gets no XP for it.
- **Fight · Pour** (every 2nd turn): heals the ally with the lowest HP% for
  150% of her DMG and gives them +2 SPD for that engagement.
- **Ultimate · Toast** (Trigger, 3): when an ally in her engagement would
  die, they are instead healed to 30% max HP.

| Card | Cost | Init | Keywords | Effect |
|---|---|---|---|---|
| Spiked Cup | 2 | 6 | Engage (1, 50) | The target takes double damage for the first 10 ticks. |
| Second Glass | 1 | 8 | — | Allied heroes within 2 hexes heal 15%. |
| Vintage | 2 | 9 | — | Allied minions on her hex hit twice as often next map phase. |

### Orrery
`HP 950 · DMG 75 · RES 25 · SPD 8`

*Look:* a woman inside a brass orrery: three rings orbit her torso, each
carrying a tiny planet pixel that moves every frame. Brass and teal.

*Plays like:* bends the order of play itself. Weak in a straight fight,
terrifying when the initiative ladder is close.

- **Map · Ephemeris** (on each draw, every 10 ticks): reveals one card the
  opponent just drew.
- **Fight · Orbit** (every 3rd turn): an ally takes its next turn at once.
- **Ultimate · Planetary Alignment** (Card, 3): *Planetary Alignment* costs
  3, initiative 0: your other cards this phase resolve 3 initiative earlier
  (minimum 0).

| Card | Cost | Init | Keywords | Effect |
|---|---|---|---|---|
| Gyre | 2 | 4 | Join (3) | All allies there gain +3 SPD. |
| Armillary Snare | 3 | 6 | Engage (1, 50) | Nobody can leave this engagement early. |
| Mainspring | 0 | 9 | — | Up to 3 unspent mana carries over past the 10 cap (13 next phase). |

### The Hooded Mantis
`HP 1100 · DMG 95 · RES 20 · SPD 12`

*Look:* a tall praying mantis in a nun's wimple, forelimbs folded in prayer
until it strikes. Jade and white.

*Plays like:* the aggressive support. Feeds her carry and hunts outside the
rules of the fight phase.

- **Map · Tithe** (always): XP she would get from minions goes to the allied
  hero on her hex with the least XP instead, +50%.
- **Fight · Pin** (every 3rd turn): she and her target both skip their next
  turn; the next allied hit on the target deals double.
- **Ultimate · Pilgrimage** (Command, 4): leaps to a visible enemy hero
  within 4 hexes and starts a 20-tick engagement right there, in the middle
  of the map phase.

| Card | Cost | Init | Keywords | Effect |
|---|---|---|---|---|
| Folded Arms | 3 | 4 | Engage (2, 50) | — |
| Vow of Stillness | 1 | 2 | — | An enemy hero within 3 cannot change stance or Roam this phase. |
| Benediction | 2 | 7 | Join (2) | Allies there heal 15% when she arrives. |

## Carry

### Marquise Rook
`HP 700 · DMG 150 · RES 10 · SPD 14`

*Look:* a towering powdered wig, a crossbow at the hip, a falcon on her
gauntlet that leaves her to hunt. Cream and crimson.

*Plays like:* a safe ranged carry who can last-hit from afar and see far
ahead.

- **Map · Hawking** (every 3 ticks): her falcon kills an enemy minion on any
  hex within 2 (even under a tower).
- **Fight · Stoop** (every 3rd turn): 150% DMG to the fastest enemy, which
  loses 3 SPD.
- **Ultimate · Falconer's Gambit** (Card, 3): *Falconer's Gambit* costs 3,
  initiative 3: her Engage and Join reach is 4 this phase, and the falcon lets
  her target heroes she cannot see.

| Card | Cost | Init | Keywords | Effect |
|---|---|---|---|---|
| Jess Strike | 2 | 7 | Engage (2, 30) | A late, short engage to pick off whoever is left. |
| Hood | 1 | 3 | — | An enemy within 2 hexes misses its first 3 attacks this phase. |
| Hunting Party | 2 | 5 | Join (2) | She deals +30% DMG in that engagement. |

### Scrimshander
`HP 800 · DMG 90 · RES 15 · SPD 10`

*Look:* a hunched figure in whale-oil leathers carrying a carved tusk
harpoon; the tusk visibly fills with etched lines as she grows. Sea-blue
and ivory.

*Plays like:* weak early, a monster late. The opponent has to end it before
the Masterwork.

- **Map · Carve** (always): every enemy minion she kills adds 1 Scrimshaw.
  Each 10 Scrimshaw is +5 DMG and +1 SPD for good.
- **Fight · Relief** (every 2nd turn): an attack that ignores RES.
- **Ultimate · Masterwork** (Ascension): at 100 Scrimshaw her basic attacks
  hit every enemy in the engagement, permanently.

| Card | Cost | Init | Keywords | Effect |
|---|---|---|---|---|
| Kill Line | 3 | 8 | Engage (1, 40) | The last engage of the phase. |
| Bone Needle | 1 | 2 | Tactic | Her first attack in her next engagement deals 200%. |
| Ivory Ward | 2 | 2 | — | Enemy Engage cards cannot target her this phase. |

### The Twinned
`HP 900 · DMG 60 · RES 15 · SPD 20`

*Look:* two small identical figures in harlequin diamonds, one red, one blue,
always in mirrored poses. One hero, two sprites.

*Plays like:* many small hits, clears two hexes at once, and slips out of
bad engages.

- **Map · Split Lane** (aggressive stance only): one twin stands a hex
  further down the lane, so their kills are split across two hexes.
- **Fight · Crossfire** (every 4th turn): both twins hit the same target
  twice.
- **Ultimate · Swap** (Command, 3): the Twinned and any allied hero trade
  places.

| Card | Cost | Init | Keywords | Effect |
|---|---|---|---|---|
| Pincer | 3 | 5 | Engage (2, 50) | Enemy Join cards cannot reach this engagement. |
| Mirror Step | 1 | 1 | — | The first enemy Engage aimed at the Twinned this phase fizzles. |
| Twofold | 2 | 6 | Tactic | Their basic attacks split between the two lowest-HP enemies. |

### Brass Reliquary
`HP 850 · DMG 135 · RES 15 · SPD 6`

*Look:* a small saint statue riding a bronze mortar on cart wheels, a wisp of
incense smoke from the barrel. Polished brass on black iron.

*Plays like:* slow and immobile, but every tower in reach is on a clock.

- **Map · Bombard** (every 5 ticks): 100 DMG to the nearest enemy structure
  within 2 hexes. No minions needed.
- **Fight · Grapeshot** (every 2nd turn): 80% DMG to every enemy.
- **Ultimate · Relic Shell** (Card, 4): *Relic Shell* costs 4, initiative 9:
  600 DMG to any enemy structure or hero within 4 hexes.

| Card | Cost | Init | Keywords | Effect |
|---|---|---|---|---|
| Fuse | 2 | 7 | — | Next map phase she kills one more minion per tick. |
| Tamp Powder | 1 | 2 | — | Bombard fires every 2 ticks next map phase. |
| Brace | 1 | 3 | Tactic | +40 RES and +4 SPD in her next engagement. |

## Staples

Neutral cards every deck carries one of. They name no hero: the player
picks which allied hero plays each one.

| Card | Cost | Init | Keywords | Effect |
|---|---|---|---|---|
| Skirmish | 3 | 5 | Engage (1, 50) | The plain engage. |
| Reinforce | 2 | 6 | Join (2) | — |
| Fall Back | 1 | 2 | — | Engage cards with a later initiative cannot target that hero this phase. |
| Press the Attack | 1 | 4 | Tactic | Allies in that hero's next engagement deal +20% DMG for the first 15 ticks. |
| Second Wind | 2 | 8 | — | Heal that hero 25%. |
| Hold the Line | 2 | 3 | — | An allied tower takes half damage until the next fight phase. |

## Open questions

1. **Map-phase engagements.** The Mantis's Pilgrimage breaks the "fights only
   happen in the fight phase" rule. Too much, or exactly the kind of exception
   ultimates are for?
2. **Seeing the rival's hand.** Orrery's Ephemeris reveals cards the opponent
   draws. Fun read, or too much against the blind, simultaneous commit?
3. ~~**Tactic timing.**~~ Settled: every Tactic now sits at initiative 2–4
   and every engage but Out of the Dark at 5–8, so a Tactic lands on the
   fight it was played for.
