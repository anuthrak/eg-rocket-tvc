// Entry point: builds the Bench tab, the tab switching, then the Landing tab, reporting each step
// to the loading screen (loader.js).
import { initBench } from './bench.js';
import { initTests } from './tests.js';
import { initLanding } from './landing.js';

export const VERSION = '3.0.0';   // bump with CHANGELOG.md; see README → Releasing

const $ = id => document.getElementById(id);
if (!('serial' in navigator)) document.body.classList.add('no-serial');   // hides Connect + baud
const loader = window.tvcLoader;
// Each step yields a frame so the loading bar can repaint before the next heavy bit
const nextFrame = () => new Promise(r => { requestAnimationFrame(() => setTimeout(r, 0)); setTimeout(r, 80); });
async function step(progress, label) { loader?.set(progress, label); await nextFrame(); }

await step(0.3, 'Building bench rig');
const bench = initBench();
initTests(bench);

// ---------- Tabs: the serial log moves to the Tests tab ----------
const view = $('view');
const benchMain = $('benchMain');
const serialLog = $('serialLog'), logHome = serialLog.parentElement;
function setTab(name) {
  document.body.dataset.tab = name;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $('crumb').textContent = name;
  benchMain.prepend(view);
  if (name === 'tests') $('tLogSlot').appendChild(serialLog);
  else logHome.appendChild(serialLog);
  lockWidths();
  try { localStorage.setItem('tvc-tab', name); } catch {}
}

// Labels that swap text (Connect/Disconnect, …) get a min-width equal to their
// longest version, so switching never nudges the controls beside them.
function lockWidths() {
  document.querySelectorAll('[data-labels]').forEach(el => {
    if (!el.offsetWidth) return;            // hidden on this tab; measured when it's shown
    const cur = el.textContent;
    el.style.minWidth = '';
    const w = Math.max(...el.dataset.labels.split('|').map(t => { el.textContent = t; return el.getBoundingClientRect().width; }));
    el.textContent = cur;
    el.style.minWidth = Math.ceil(w) + 'px';
  });
}
document.fonts.ready.then(lockWidths);
window.addEventListener('resize', lockWidths);
document.querySelectorAll('.tab').forEach(b => b.onclick = () => setTab(b.dataset.tab));


await initLanding(step);

// ---------- Intro after the loading screen ----------
// The HUD boots in panel by panel.
// Same-tab reloads (cached) skip the fly-in and get a quick HUD fade; "reduce motion" gets the loader's plain fade only.
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
function bootHUD(selectors, startMs, gapMs) {
  let d = startMs;
  for (const [sel, gap = gapMs] of selectors) {
    for (const el of document.querySelectorAll(sel)) {
      if (el.offsetParent === null) continue;                    // not shown at this size / on this tab
      el.style.setProperty('--d', d + 'ms');
      el.classList.remove('boot-in'); void el.offsetWidth;        // restart if it's already running
      el.classList.add('boot-in');
      el.addEventListener('animationend', () => el.classList.remove('boot-in'), { once: true });
      d += gap;
    }
  }
}
document.addEventListener('tvc:reveal', ({ detail: { quick } }) => {
  if (reduceMotion.matches) return;
  const g = quick ? 12 : 40;   // panels land around when the camera does (~2 s)
  if (document.body.dataset.tab === 'landing') {
    bootHUD([['header'], ['.lnd-controls'], ['.lnd-source'], ['.lnd-alt'], ['.lnd-center'], ['.lnd-att']], quick ? 0 : 120, g);
  } else if (document.body.dataset.tab === 'tests') {
    bootHUD([['header'], ['.t-rail > *'], ['.t-strip'], ['#testsHome, .cal:not([hidden])'], ['.t-viz .t-tile']], quick ? 0 : 120, g);
  } else {
    bootHUD([['header'], ['.side-l > *'], ['.side-r > *']], quick ? 0 : 120, g);
  }
});

$('appVersion').textContent = 'v' + VERSION;
// Landing is the home page; Bench or Tests only if that's where the viewer last was
let savedTab = null;
try { savedTab = localStorage.getItem('tvc-tab'); } catch {}
setTab(['bench', 'tests'].includes(savedTab) ? savedTab : 'landing');
// Footer loader previews (temporary): Fuel / Arc
document.querySelectorAll('[data-ld]').forEach(b => { b.onclick = () => loader?.preview(b.dataset.ld); });
loader?.set(1, 'Ready');
loader?.done();
