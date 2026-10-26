// Entry point: builds the Bench tab, the tab switching, then the Mission tab, reporting each step
// to the loading screen (loader.js).
import { initBench } from './bench.js';
import { initMission } from './mission.js';

export const VERSION = '2.1.0';   // bump with CHANGELOG.md; see README → Releasing

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

await initMission(step);

$('appVersion').textContent = 'v' + VERSION;
try { const saved = localStorage.getItem('tvc-tab'); if (saved === 'mission') setTab('mission'); } catch {}
document.querySelectorAll('[data-ld]').forEach(b => { b.onclick = () => loader?.preview(b.dataset.ld); });
loader?.set(1, 'Ready');
loader?.done();
