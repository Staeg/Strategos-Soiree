/**
 * Headless AI-vs-AI tournament: `npm run arena -- [games=50]`.
 * Each pairing plays both sides of every seed, so any side bias cancels out.
 * This is the harness for tuning difficulties against measurable win rates.
 */
import { createAgent, DIFFICULTIES, runMatch, type Difficulty } from '../src/index.ts';

const games = Number(process.argv[2] ?? 50);
const pct = (n: number) => `${((100 * n) / (2 * games)).toFixed(1).padStart(5)}%`;

function score(a: Difficulty, b: Difficulty): { wins: number; draws: number; ticks: number } {
  let wins = 0, draws = 0, ticks = 0;
  for (let seed = 1; seed <= games; seed++) {
    for (const side of [0, 1] as const) {
      const agents = side === 0
        ? [createAgent(a, seed * 2), createAgent(b, seed * 2 + 1)] as const
        : [createAgent(b, seed * 2 + 1), createAgent(a, seed * 2)] as const;
      const r = runMatch(seed, agents);
      ticks += r.final.mapTick;
      if (r.final.winner === 'draw') draws++;
      else if (r.final.winner === side) wins++;
    }
  }
  return { wins, draws, ticks };
}

const started = performance.now();
console.log(`row win rate vs column, ${games * 2} games per cell (draws in brackets, mean map ticks)\n`);
console.log(''.padEnd(11) + DIFFICULTIES.map((d) => d.padStart(24)).join(''));
for (const a of DIFFICULTIES) {
  const cells = DIFFICULTIES.map((b) => {
    const r = score(a, b);
    return `${pct(r.wins)} [${pct(r.draws).trim()}] ${Math.round(r.ticks / (2 * games))}t`.padStart(24);
  });
  console.log(a.padEnd(11) + cells.join(''));
}
console.log(`\n${((performance.now() - started) / 1000).toFixed(1)}s`);
