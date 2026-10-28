/**
 * Jungle tuning bench: `npm run jungle -- [seeds=100] [ticks=500]`.
 * Plays matches in which nobody gives an order or plays a card, so every
 * jungler spends all its time in its own jungle and every laner in its lane,
 * and reports what the camps in content.ts are tuned against:
 *  - jungler XP against the average solo (top and mid) laner's;
 *  - how many camps a fresh jungler clears before its first walk home;
 *  - how often all five of its camps are down at once (it has to wait).
 */
import { advance, createMatch, heroDef, XP_UNIT, type Hero, type MatchState } from '../src/index.ts';

const seeds = Number(process.argv[2] ?? 100);
const ticks = Number(process.argv[3] ?? 500);
const marks = [50, 100, 200, 300, 400, 500].filter((m) => m <= ticks);
const WINDOW = 100;

interface Tally { n: number; sum: number }
const tally = new Map<string, Tally>();
const note = (key: string, v: number) => {
  const t = tally.get(key) ?? { n: 0, sum: 0 };
  tally.set(key, { n: t.n + 1, sum: t.sum + v });
};
const mean = (key: string) => { const t = tally.get(key); return t ? t.sum / t.n : NaN; };

for (let seed = 1; seed <= seeds; seed++) {
  const s = createMatch(seed);
  const junglers = s.heroes.filter((h) => h.role === 'jungle');
  const firstBack = junglers.map(() => -1);
  const cleared = junglers.map(() => 0);
  while (s.phase !== 'over' && s.mapTick < ticks) {
    const commit = s.phase === 'plan' ? ([0, 1] as const).map((side) => ({ type: 'commit' as const, side, discard: [] })) : [];
    const before = s.camps.map((c) => c.creeps);
    const mapTick = s.phase === 'map';
    advance(s, commit);
    if (!mapTick) continue;
    junglers.forEach((j, k) => {
      const h = s.heroes[j.uid]!;
      s.camps.forEach((c, i) => {
        if (c.owner !== h.side || before[i]! === 0 || c.creeps > 0) return;
        cleared[k]!++;
        if (cleared[k] === 1) note('first camp', s.mapTick);
        if (cleared[k] === 5) note('fifth camp', s.mapTick);
      });
      if (firstBack[k]! < 0 && h.retreating) firstBack[k] = cleared[k]!;
      if (h.respawnAt >= 0 && s.events.some((e) => e.type === 'death' && e.uid === h.uid)) note('deaths', 1);
      const window = `starved ${Math.floor((s.mapTick - 1) / WINDOW) * WINDOW}`;
      if (h.respawnAt < 0 && !h.retreating) note(window, s.camps.every((c) => c.owner !== h.side || c.creeps === 0) ? 1 : 0);
    });
    if (marks.includes(s.mapTick)) {
      const xp = (h: Hero) => h.xp / XP_UNIT;
      const solo = s.heroes.filter((h) => h.role === 'top' || h.role === 'mid');
      const soloMean = solo.reduce((t, h) => t + xp(h), 0) / solo.length;
      note(`solo ${s.mapTick}`, soloMean);
      for (const h of s.heroes.filter((x) => x.role === 'jungle')) {
        note(`jungle ${s.mapTick}`, xp(h));
        note(`${heroDef(h.id).name} ${s.mapTick}`, xp(h));
        note(`ratio ${s.mapTick}`, xp(h) / soloMean);
      }
    }
  }
  firstBack.forEach((n) => {
    const camps = n < 0 ? 5 : Math.min(n, 5);
    note('first back', camps);
    note(`first back after ${camps}`, 1);
  });
}

const row = (label: string, key: (m: number) => string, f = (v: number) => v.toFixed(0)) =>
  console.log(label.padEnd(22) + marks.map((m) => f(mean(key(m))).padStart(8)).join(''));
console.log(`${seeds} seeds, idle matches (no orders, no cards)\n`);
console.log('XP at map tick'.padEnd(22) + marks.map((m) => String(m).padStart(8)).join(''));
row('solo laner (mean)', (m) => `solo ${m}`);
row('jungler', (m) => `jungle ${m}`);
for (const id of ['vespertine', 'carrionAbacus'] as const) row(`  ${heroDef(id).name}`, (m) => `${heroDef(id).name} ${m}`);
row('jungler / solo', (m) => `ratio ${m}`, (v) => v.toFixed(2));
const backs = [0, 1, 2, 3, 4, 5].map((n) => `${n}${n === 5 ? '+' : ''}: ${(100 * (tally.get(`first back after ${n}`)?.n ?? 0) / (2 * seeds)).toFixed(0)}%`);
console.log(`\ncamps cleared before the first walk home: ${mean('first back').toFixed(2)} on average (${backs.join(', ')})`);
console.log(`first camp down at tick ${mean('first camp').toFixed(0)}, fifth at ${mean('fifth camp').toFixed(0)}`);
console.log(`jungler deaths per match: ${((tally.get('deaths')?.n ?? 0) / seeds).toFixed(2)}`);
const windows = [...tally.keys()].filter((k) => k.startsWith('starved')).sort((a, b) => Number(a.slice(8)) - Number(b.slice(8)));
console.log('\nshare of active jungler ticks with all own camps down');
for (const w of windows) console.log(`  ticks ${w.slice(8).padStart(3)}-${Number(w.slice(8)) + WINDOW - 1}`.padEnd(22) + `${(100 * mean(w)).toFixed(1)}%`.padStart(8));
