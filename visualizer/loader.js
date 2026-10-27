// Loading screen. The module script below reports real progress through window.tvcLoader;
// between those checkpoints (and while Three.js downloads) it keeps creeping toward the next one.
(() => {
  const $ = id => document.getElementById(id);
  const el = $('loader');
  // True while the loader fully covers the page: the 3D scenes skip drawing then (they can't be seen), which keeps
  // slower machines from crawling through the load. Drawing resumes as soon as the fade-out starts.
  window.tvcCovered = () => !el.hidden && !el.classList.contains('out');
  const store = (s, k, v) => { try { return v === undefined ? s.getItem(k) : s.setItem(k, v); } catch { return null; } };
  let variant = 'fuel';                                       // default look; the arc is kept for the footer preview
  el.dataset.variant = variant;
  let quick = store(sessionStorage, 'tvc-loaded') === '1';   // reload in the same session: skip the finale
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;   // system "reduce motion": plain fade only
  let t0 = performance.now(), target = 0, shown = 0, doneReq = false, finishing = false, timers = [], ticker = 0;
  let setAt = t0, last = t0;
  const STAGES = [0.25, 0.3, 0.45, 0.55, 0.65, 0.8, 1];   // checkpoints reported by main.js / mission.js

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
  // Where the bar is heading: the last checkpoint, plus a slow creep (up to 85%) toward the next one
  function goalAt(now) {
    if (doneReq) return 1;
    const next = STAGES.find(s => s > target + 1e-6) ?? 1;
    return target + (next - target) * 0.85 * (1 - Math.exp(-(now - setAt) / 1500));
  }
  // Eases toward the goal (~0.3 s time constant) but never faster than a full bar per 1.2 s, so checkpoints glide
  // instead of jumping. Runs on animation frames while visible, on a timer when hidden so loading still finishes.
  function tick(now = performance.now()) {
    if (finishing) return;
    const dt = Math.min(0.25, Math.max(0, now - last) / 1000); last = now;   // capped: after a hiccup, catch up gradually
    const step = (goalAt(now) - shown) * (1 - Math.exp(-dt / 0.3));
    if (document.hidden) shown = goalAt(now);              // nobody's watching: no easing, so a background tab finishes promptly
    else shown += quick ? step : Math.min(step, dt / 1.2);
    if (doneReq && 1 - shown < 0.01) shown = 1;
    render(shown);
    if (doneReq && shown >= 1 && now - t0 >= (quick ? 0 : 1000)) return finish();
    ticker = document.hidden ? setTimeout(tick, 50) : requestAnimationFrame(tick);
  }
  const stopTicker = () => { cancelAnimationFrame(ticker); clearTimeout(ticker); };
  document.addEventListener('visibilitychange', () => {   // animation frames pause in hidden tabs; switch to the timer
    if (document.hidden && !finishing && !el.hidden) { stopTicker(); ticker = setTimeout(tick, 50); }
  });
  // Finale, then fade out. As the fade starts, 'tvc:reveal' tells main.js to run the intro transition.
  function finish() {
    finishing = true; render(1);
    store(sessionStorage, 'tvc-loaded', '1');
    const calm = quick || reduced, at = (ms, fn) => timers.push(setTimeout(fn, ms));
    let revealAt = 120;
    if (!calm) {
      el.classList.add('finale'); $('ldText').textContent = variant === 'fuel' ? 'Gimbal check · ±8°' : 'Touchdown';
      revealAt = 1250;
    }
    at(revealAt, () => {
      $('ldText').textContent = 'Ready';
      document.dispatchEvent(new CustomEvent('tvc:reveal', { detail: { quick, reduced } }));
      el.classList.add('out');
      at(450, () => { el.hidden = true; el.classList.remove('finale'); });
    });
  }
  function start() {
    timers.forEach(clearTimeout); timers = [];
    el.hidden = false; el.classList.remove('out', 'finale');
    t0 = setAt = last = performance.now(); shown = target = 0; doneReq = finishing = false;
    $('ldText').textContent = 'Loading Three.js';
    stopTicker(); tick();
  }
  // If the 3D library never arrives, say so and let a click dismiss the screen
  timers.push(setTimeout(() => {
    if (doneReq) return;
    $('ldText').textContent = 'Still loading · check your connection (click to skip)';
    el.onclick = () => { el.hidden = true; };
  }, 15000));

  window.tvcLoader = {
    set(p, text) {
      if (p > target) { target = p; setAt = performance.now(); }
      if (text && !finishing) $('ldText').textContent = text;
    },
    done() { target = 1; doneReq = true; },
    // TEMPORARY: replay a look with simulated steps (footer buttons)
    preview(v) {
      variant = el.dataset.variant = v; quick = false;
      start();
      [[0.3, 'Building bench rig', 500], [0.45, 'Generating Earth', 800], [0.55, 'Generating clouds', 1050], [0.65, 'Generating Moon', 1300],
       [0.8, 'Plotting transfer orbit', 1700], [1, 'Ready', 2100]].forEach(([p, t, ms]) => timers.push(setTimeout(() => this.set(p, t), ms)));
      timers.push(setTimeout(() => this.done(), 2150));
    },
  };
  tick();
})();
