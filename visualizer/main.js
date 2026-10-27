// Entry point: builds the Bench tab, the tab switching, then the Mission tab, reporting each step
// to the loading screen (loader.js).
import { initBench } from './bench.js';
import { initMission } from './mission.js';

export const VERSION = '2.3.0';   // bump with CHANGELOG.md; see README → Releasing

const $ = id => document.getElementById(id);
if (!('serial' in navigator)) document.body.classList.add('no-serial');   // hides Connect + baud
const loader = window.tvcLoader;
// Each step yields a frame so the loading bar can repaint before the next heavy bit
const nextFrame = () => new Promise(r => { requestAnimationFrame(() => setTimeout(r, 0)); setTimeout(r, 80); });
async function step(progress, label) { loader?.set(progress, label); await nextFrame(); }

await step(0.3, 'Building bench rig');
initBench();

// ---------- Tabs: the bench view moves into a mini side panel on the Mission tab ----------
const view = $('view');
const benchMain = $('benchMain');
function setTab(name) {
  document.body.dataset.tab = name;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $('crumb').textContent = name;
  if (name === 'mission') $('mbSlot').appendChild(view);
  else benchMain.prepend(view);
  lockWidths();
  try { localStorage.setItem('tvc-tab', name); } catch {}
}

// Labels that swap text (Connect/Disconnect, Bench/Mission, …) get a min-width equal to their
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
$('mbExpand').onclick = () => setTab('bench');
$('mbCollapse').onclick = () => {
  const c = $('miniBench').classList.toggle('collapsed');
  $('mbCollapse').textContent = c ? '+' : '–';
  $('mbCollapse').title = c ? 'Expand' : 'Collapse';
};
if (matchMedia('(max-width: 760px), (max-height: 520px)').matches) $('mbCollapse').onclick();

const mission = await initMission(step);

// ---------- Intro after the loading screen ----------
// Mission: the camera flies in from space while the HUD boots in around it. Bench: just the HUD boot.
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
  if (document.body.dataset.tab === 'mission') {
    if (!quick) mission.flyIn(1.8);
    bootHUD([['header'], ['.m-strip .ms-tile'], ['.m-controls'], ['#mPY'], ['#minimap'], ['.m-events'], ['#evList li', quick ? 4 : 12],
             ['#miniBench'], ['.m-gauges'], ['.m-center'], ['.tl-ev', quick ? 6 : 25], ['.m-gimbal']], quick ? 0 : 450, g);
  } else {
    bootHUD([['header'], ['.side-l > *'], ['.side-r > *']], quick ? 0 : 120, g);
  }
});

$('appVersion').textContent = 'v' + VERSION;
// Mission is the home page; Bench only if that's where the viewer last was
let savedTab = null;
try { savedTab = localStorage.getItem('tvc-tab'); } catch {}
setTab(savedTab === 'bench' ? 'bench' : 'mission');
// Footer loader previews (temporary): Fuel / Arc
document.querySelectorAll('[data-ld]').forEach(b => { b.onclick = () => loader?.preview(b.dataset.ld); });
loader?.set(1, 'Ready');
loader?.done();
