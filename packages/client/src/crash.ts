import { CREAM, DUSK, GOLD, INK, MAUVE, NIGHT, PLUM } from './art/palette.ts';
import { report, type Report } from './save.ts';

/**
 * Bug reports without devtools. An uncaught error stops Phaser's frame loop,
 * which freezes the canvas mid-frame, so the notice is plain DOM laid over
 * it: what went wrong, and the whole match as a replayable report to copy or
 * download. F8 saves the same report at any time, for bugs that do not crash.
 */
export function installCrashReporter(): void {
  window.addEventListener('error', (e) => show(report(e.error ?? e.message)));
  window.addEventListener('unhandledrejection', (e) => show(report(e.reason)));
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F8') { e.preventDefault(); download(report()); }
  });
}

const css = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const CSS = `
#crash { position: fixed; inset: 0; display: grid; place-items: center; background: ${css(INK)}d0;
  font: 13px/1.5 ui-monospace, Menlo, Consolas, monospace; color: ${css(CREAM)}; z-index: 10; padding: 16px; }
#crash > div { max-width: 640px; width: 100%; background: ${css(INK)}; border: 1px solid ${css(DUSK)}; padding: 16px 20px; box-sizing: border-box; }
#crash h1 { margin: 0 0 8px; font-size: 16px; color: ${css(GOLD)}; letter-spacing: 0.1em; text-transform: uppercase; }
#crash p { margin: 0 0 12px; color: ${css(MAUVE)}; }
#crash pre { margin: 0 0 12px; max-height: 30vh; overflow: auto; white-space: pre-wrap; word-break: break-word;
  background: ${css(NIGHT)}; padding: 8px; font-size: 11px; }
#crash button { font: inherit; color: ${css(CREAM)}; background: ${css(PLUM)}; border: 1px solid ${css(DUSK)}; padding: 4px 12px; margin: 4px 8px 0 0; cursor: pointer; }
#crash button:hover { background: ${css(DUSK)}; }
`;

let shown = false;

function show(r: Report): void {
  console.error('[strategos] crash report', r);
  if (shown) return; // the first error is the one that matters; later ones are usually its echoes
  shown = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  const root = document.createElement('div');
  root.id = 'crash';
  const where = r.match ? `tick ${r.match.state.mapTick}, ${r.match.state.phase} phase, seed ${r.match.setup.seed}` : 'outside a match';
  root.innerHTML = `<div>
    <h1>The ball has stopped</h1>
    <p>Something broke (${where}). The report below replays the whole match: copy or download it and pass it on.
    Reloading offers to continue from the last auto-save.</p>
    <pre></pre>
    <button data-act="copy">copy report</button><button data-act="download">download report</button><button data-act="reload">reload</button><button data-act="close">dismiss</button>
  </div>`;
  root.querySelector('pre')!.textContent = r.error ? (r.error.stack ?? r.error.message) : 'no error message';
  root.addEventListener('click', (e) => {
    const button = (e.target as HTMLElement).closest('button');
    const act = button?.dataset['act'];
    if (act === 'copy') copy(r, button!);
    if (act === 'download') download(r);
    if (act === 'reload') location.reload();
    if (act === 'close') { root.remove(); style.remove(); shown = false; }
  });
  document.head.append(style);
  document.body.append(root);
}

async function copy(r: Report, button: HTMLButtonElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(JSON.stringify(r));
    button.textContent = 'copied';
  } catch {
    button.textContent = 'copy blocked: download instead';
  }
}

function download(r: Report): void {
  const name = r.match ? `strategos-${r.match.setup.seed}-t${r.match.state.mapTick}.json` : 'strategos-report.json';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(r)], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
