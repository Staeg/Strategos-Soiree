# Strategos Soirée

A shotcaller's game: draft three heroes, then lead them through a match that
alternates between **battles** (real time, you call the stance) and
**councils** (turn based, you commit cards with limited mana, blind, and both
sides reveal at once).

This is the pilot: one draft-and-match loop against an AI of three
difficulties, with placeholder pixel art drawn entirely from code.

```sh
npm install
npm run dev          # play at http://localhost:5173
npm test             # determinism and rules tests
npm run arena -- 200 # AI-vs-AI win-rate table over 200 seeds per pairing
npm run build        # static site in packages/client/dist
```

## Architecture

```
packages/
  sim/      the game. Pure TypeScript, no engine, no DOM, no clock.
  client/   Phaser 3 + Vite. Renders the sim; never decides anything.
```

**The simulation is one function**: `step(state, commands) -> state`. It runs
at a fixed 20 Hz, uses integer maths only, and draws randomness from seeded
sfc32 streams stored inside the state. Same seed and same commands give the
same match on every machine, which is what makes the rest possible:

- **Multiplayer-ready.** A 1v1 server can run the same package
  authoritatively (or both clients can run it in lockstep and compare
  `hashState`). The client already talks to the match through a `Session`
  interface; an online session slots in beside `LocalSession`.
- **AI is just another input.** Agents return commands like a player does
  and own their own RNG, so thinking never perturbs the match. The hardest
  one plans by rolling the real sim forward, with the combat stream reseeded
  so it imagines futures instead of peeking at the real dice.
- **Measurable difficulty.** `npm run arena` plays matches headlessly; that is
  how the difficulty targets (Strategos beatable by perfect play over 75% of
  the time, but never reliably) get tuned and kept honest.
- **Fair luck.** Combat and card luck use separate streams, damage variance
  is bounded (±15%), and the one coin-flip card shows its result.

**Art** is generated at boot by `client/src/art/forge.ts` from glyph grids
and small procedures (heroes, nexus crystals, cards, effects, the 3×5 font).
Each texture has a stable key, so real sprite sheets can replace them one at
a time.

## Deploying

Pushes to `main` publish the client to GitHub Pages via
`.github/workflows/pages.yml` (set Pages to "GitHub Actions" in the repo
settings once). The Vite build uses a relative base, so the same `dist/` can
later be wrapped as a desktop app (Electron or Tauri).
