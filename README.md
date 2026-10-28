# Strategos Soirée

A shotcaller's MOBA: five heroes walk their lanes and camps on a hex map by
themselves while you rewire them with a few scarce orders (stance, roam).
Every 50 map ticks the match stops for a **fight phase**: both sides commit
cards blind, reveal, resolve them by initiative, and each initiative's
engagements play out in fight ticks before the next resolves.

This is the rough structure with the first ten heroes (two per role, split
between the sides by the seed), against an AI of two difficulties, with
placeholder pixel art drawn entirely from code. The roster is in
[docs/heroes-draft.md](docs/heroes-draft.md). The
rules as implemented, and which gaps were filled by guesswork, are in
[docs/match-rules.md](docs/match-rules.md).

```sh
npm install
npm run dev          # play at http://localhost:5173
npm test             # determinism and rules tests
npm run arena -- 50  # AI-vs-AI win-rate table over 50 seeds per pairing
npm run jungle -- 200 # jungle camp tuning bench: XP, walks home, respawns
npm run build        # static site in packages/client/dist
```

## Architecture

```
packages/
  sim/      the game. Pure TypeScript, no engine, no DOM, no clock.
  client/   Phaser 3 + Vite. Renders the sim; never decides anything.
```

**The simulation is one function**: `step(state, commands) -> state`. A step
is a map tick, an initiative's worth of reveals, or the next fight tick in
which someone acts, depending on the phase. It uses integer maths only and
draws randomness from seeded sfc32 streams stored inside the state. Same seed
and same commands give the same match on every machine, which is what makes
the rest possible:

- **Multiplayer-ready.** A 1v1 server can run the same package
  authoritatively. Clients and AIs only ever see `viewFor(state, side)`: the
  fogged board, without the rival's hand or uncommitted plays. The client
  talks to the match through a `Session` interface; an online session slots
  in beside `LocalSession`.
- **AI is just another input.** Agents get the same fogged view a player
  does and return commands; they own their own RNG, so thinking never
  perturbs the match.
- **Measurable difficulty.** `npm run arena` plays matches headlessly, which
  is how difficulties get tuned against win rates.
- **Content is data.** Heroes, abilities and cards are small effect ops
  (`engage`, `join`, `empower`, `cull`, `muster`...) interpreted by the sim, so
  the real roster is mostly data entry plus the occasional new op.

**Art** is generated at boot by `client/src/art/forge.ts` from glyph grids
and small procedures (heroes, nexus crystals, cards, effects, the 3×5 font).
Each texture has a stable key, so real sprite sheets can replace them one at
a time. The placeholder art follows one principle, written down with the
hero palettes under "Placeholder art" in
[docs/heroes-draft.md](docs/heroes-draft.md): make every character as
visually distinct as possible.

**The match screen** puts your heroes down the left and the rival's down the
right (hover a bar to slide it out; rivals out of sight are greyed and show
only what was last seen), the board in the middle, the hand along the bottom
in every phase, and mana and the initiative timeline bottom right. Hold
**Ctrl** over a card or a hero bar for its full rules. Hotkeys hide behind
the **?** in the bottom-left corner, next to a debug **log** of every event.

## Deploying

Pushes to `main` publish the client to GitHub Pages via
`.github/workflows/pages.yml` (set Pages to "GitHub Actions" in the repo
settings once). The Vite build uses a relative base, so the same `dist/` can
later be wrapped as a desktop app (Electron or Tauri).
