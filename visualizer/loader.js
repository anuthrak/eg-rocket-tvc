// Loading screen. The module script below reports real progress through window.tvcLoader;
// until it starts (Three.js still downloading) the bar creeps on its own up to 25%.
(() => {
  const $ = id => document.getElementById(id);
  const el = $('loader');
  const store = (s, k, v) => { try { return v === undefined ? s.getItem(k) : s.setItem(k, v); } catch { return null; } };
  let variant = 'fuel';                                       // default look; the arc is kept for the footer preview
  el.dataset.variant = variant;
  let quick = store(sessionStorage, 'tvc-loaded') === '1';   // reload in the same session: skip the finale
  let t0 = performance.now(), target = 0, shown = 0, doneReq = false, finishing = false, timers = [], ticker = 0;

  // Arc milestones, placed along the path
  const base = $('ldArcBase'), LEN = base.getTotalLength();
  // [label, fraction of the path, label dx, label dy, text-anchor]; LOI sits where the final 11px descent begins
  const MS = [['LIFTOFF', 0, 0, -12, 'middle'], ['ORBIT', 0.13, -8, 4, 'end'], ['TLI', 0.22, 0, 16, 'middle'],
    ['MCC', 0.55, 0, 16, 'middle'], ['LOI', 1 - 11 / LEN, -9, 4, 'end'], ['TOUCHDOWN', 1, 13, 38, 'middle']];
  const msEls = MS.map(([name, f, dx, dy, anchor]) => {
    const p = base.getPointAtLength(LEN * f), g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'ld-ms');
    g.innerHTML = `<circle cx="${p.x}" cy="${p.y}" r="4"/><text x="${p.x + dx}" y="${p.y + dy}" text-anchor="${anchor}">${name}</text>`;
    $('ldMilestones').appendChild(g);
    return [f, g];
  });

  function render(p) {
    $('ldPct').textContent = Math.floor(p * 100) + '%';
    $('ldFuelA').setAttribute('width', 196 * Math.min(1, p / 0.5));
    $('ldFuelB').setAttribute('width', 119 * Math.max(0, (p - 0.5) / 0.5));
    $('ldFeed').classList.toggle('on', p > 0.5);
    $('ldArcTrail').style.strokeDashoffset = 1 - p;
    const pt = base.getPointAtLength(LEN * p);
    for (const id of ['ldShip', 'ldShipGlow']) { $(id).setAttribute('cx', pt.x); $(id).setAttribute('cy', pt.y); }
    msEls.forEach(([f, g]) => g.classList.toggle('done', p >= f - 1e-6));
  }
  // Timer-driven (not requestAnimationFrame) so loading still completes in a background tab
  function tick() {
    if (finishing) return;
    const now = performance.now();
    const goal = Math.max(target, Math.min(0.25, (now - t0) / 3000 * 0.25));
    shown += (goal - shown) * 0.12;
    if (goal - shown < 0.002) shown = goal;
    render(shown);
    if (doneReq && shown >= 0.999 && now - t0 >= (quick ? 0 : 1000)) finish();
    else ticker = setTimeout(tick, 16);
  }
  function finish() {
    finishing = true; render(1);
    store(sessionStorage, 'tvc-loaded', '1');
    if (!quick) { el.classList.add('finale'); $('ldText').textContent = variant === 'fuel' ? 'Gimbal check · ±8°' : 'Touchdown'; }
    timers.push(setTimeout(() => {
      $('ldText').textContent = 'Ready';
      el.classList.add('out');
      timers.push(setTimeout(() => { el.hidden = true; }, 450));
    }, quick ? 120 : 1250));
  }
  function start() {
    timers.forEach(clearTimeout); timers = [];
    el.hidden = false; el.classList.remove('out', 'finale');
    t0 = performance.now(); shown = target = 0; doneReq = finishing = false;
    $('ldText').textContent = 'Loading Three.js';
    clearTimeout(ticker); tick();
  }
  // If the 3D library never arrives, say so and let a click dismiss the screen
  timers.push(setTimeout(() => {
    if (doneReq) return;
    $('ldText').textContent = 'Still loading · check your connection (click to skip)';
    el.onclick = () => { el.hidden = true; };
  }, 15000));

  window.tvcLoader = {
    set(p, text) { target = Math.max(target, p); if (text && !finishing) $('ldText').textContent = text; },
    done() { target = 1; doneReq = true; },
    // TEMPORARY: replay a look with simulated steps (footer buttons)
    preview(v) {
      variant = el.dataset.variant = v; quick = false;
      start();
      [[0.3, 'Building bench rig', 500], [0.45, 'Generating Earth', 900], [0.65, 'Generating Moon', 1300],
       [0.8, 'Plotting transfer orbit', 1700], [1, 'Ready', 2100]].forEach(([p, t, ms]) => timers.push(setTimeout(() => this.set(p, t), ms)));
      timers.push(setTimeout(() => this.done(), 2150));
    },
  };
  tick();
})();
