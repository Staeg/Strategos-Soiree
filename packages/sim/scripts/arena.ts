/**
 * Headless AI-vs-AI tournament: `npm run arena -- [games=200]`.
 * Each pairing plays both sides of every seed, so first-pick bias cancels out.
 * This is the harness for tuning difficulties against measurable win rates.
 */
import { createAgent, DIFFICULTIES, runMatch, type Difficulty } from '../src/index.ts';

const games = Number(process.argv[2] ?? 200);
const pct = (n: number) => `${((100 * n) / (2 * games)).toFixed(1).padStart(5)}%`;

function score(a: Difficulty, b: Difficulty): { wins: number; draws: number; ticks: number } {
  let wins = 0, draws = 0, ticks = 0;
  for (let seed = 1; seed <= games; seed++) {
    for (const side of [0, 1] as const) {
      const agents = side === 0
        ? [createAgent(a, seed * 2), createAgent(b, seed * 2 + 1)] as const
        : [createAgent(b, seed * 2 + 1), createAgent(a, seed * 2)] as const;
      const r = runMatch(seed, agents);
      ticks += r.ticks;
      if (r.final.winner === 'draw') draws++;
      else if (r.final.winner === side) wins++;
    }
  }
  return { wins, draws, ticks };
}

const started = performance.now();
console.log(`row win rate vs column, ${games * 2} games per cell (draws in brackets)\n`);
console.log(''.padEnd(11) + DIFFICULTIES.map((d) => d.padStart(16)).join(''));
for (const a of DIFFICULTIES) {
  const cells = DIFFICULTIES.map((b) => {
    const r = score(a, b);
    return `${pct(r.wins)} [${pct(r.draws).trim()}]`.padStart(16);
  });
  console.log(a.padEnd(11) + cells.join(''));
}
console.log(`\n${((performance.now() - started) / 1000).toFixed(1)}s`);
