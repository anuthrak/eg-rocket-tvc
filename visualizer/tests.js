// Tests tab: the test list, one test open at a time, the live telemetry strip, the Free-hand test and the charts.
// Telemetry comes from bench.js as 'tvc:line' events (every serial or demo line). The CAL-mode tests are their own
// modules (calib.js, laser.js, throttle.js, vector.js); this file only opens/closes them and draws their data.
import { Chart } from './tcharts.js';

const $ = id => document.getElementById(id);
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const DASH = '—';
const GMAX = 8;

export function initTests({ calib, laser, throttle, vector, syscheck, send, link }) {
  // ---------- Live telemetry ----------
  let cfg = null;                                  // from CFG: centres, directions, trims, linkage ratios
  const T = { t: 0, mode: null, tx: null, ty: null, gx: null, gy: null, sx: null, sy: null, rx: null, ry: null, thr: null, tgt: null, thrT: 0 };
  let freeOn = false, abortOn = false;
  const rates = [];                                // last 0.5 s of gyro rates (CAL, firmware v1.12.0+)
  const tilts = [];                                // last 0.5 s of tilts (fallback vibration measure)

  const spg = ax => (ax === 'x' ? cfg?.spg : cfg?.spgy) || 4;
  const dir = ax => (ax === 'x' ? cfg?.xd : cfg?.yd) || 1;
  function sample(now) {
    for (const [buf, a, b] of [[rates, T.rx, T.ry], [tilts, T.tx, T.ty]]) {
      if (a == null) continue;
      buf.push([now, a, b]);
      while (buf.length && now - buf[0][0] > 500) buf.shift();
    }
    feed(now);
  }
  function rms(buf) {
    if (buf.length < 5) return null;
    const ma = buf.reduce((s, p) => s + p[1], 0) / buf.length, mb = buf.reduce((s, p) => s + p[2], 0) / buf.length;
    return Math.sqrt(buf.reduce((s, p) => s + (p[1] - ma) ** 2 + (p[2] - mb) ** 2, 0) / buf.length);
  }

  document.addEventListener('tvc:line', ({ detail: line }) => {
    const now = performance.now();
    const p = line.split(',');
    if (p[0] === 'CFG') { cfg = { xc: +p[1], yc: +p[2], xd: +p[3], yd: +p[4], tx: +p[5], ty: +p[6], spg: +p[7], spgy: p.length >= 13 ? +p[12] : +p[7] }; return; }
    if (line === 'FREE,ON' || line === 'FREE,OFF') { freeOn = line === 'FREE,ON'; fhRender(); return; }
    if (p[0] === 'ABORT') { abortOn = p[1] === 'TILT'; fhRender(); return; }
    if (p[0] === 'THR' && p.length >= 5) { T.thr = p[1] === 'ARMED' ? +p[3] : 0; T.tgt = p[1] === 'ARMED' ? +p[2] : 0; T.thrT = now; return; }
    if (p[0] === 'THR' && p[1] === 'CUT') { T.thr = T.tgt = 0; T.thrT = now; return; }
    if (p[0] === 'CAL' && p.length >= 5 && cfg) {
      const xa = +p[1], ya = +p[2];
      T.mode = 'cal'; T.t = now;
      T.sx = xa - cfg.xc; T.sy = ya - cfg.yc;
      T.gx = T.sx * cfg.xd / spg('x'); T.gy = T.sy * cfg.yd / spg('y');
      T.tx = +p[3] - cfg.tx; T.ty = +p[4] - cfg.ty;
      T.rx = p.length >= 7 ? +p[5] : null; T.ry = p.length >= 7 ? +p[6] : null;
      sample(now);
      return;
    }
    if (/^[A-Z]+,/.test(line)) return;
    // Flight telemetry: roll, X servo (90 = centre), Y servo, tiltX, tiltY
    const v = p.map(Number);
    if (v.length < 5 || v.slice(0, 5).some(x => !Number.isFinite(x))) return;
    T.mode = 'flight'; T.t = now;
    T.sx = v[1] - 90; T.sy = v[2] - 90;
    T.gx = T.sx * dir('x') / spg('x'); T.gy = T.sy * dir('y') / spg('y');
    T.tx = v[3]; T.ty = v[4]; T.rx = T.ry = null;
    if (T.thr != null && now - T.thrT > 1500) T.thr = T.tgt = null;
    sample(now);
    fhSample();
  });

  // ---------- Test list: one open at a time ----------
  const fh = { open: false, isOpen: () => fh.open, close: () => fhHide(), refresh: () => fhRender() };
  const tests = { sc: syscheck, cal: calib, fh, lz: laser, th: throttle, vc: vector };
  const btnOf = { sc: 'scBtn', cal: 'calBtn', fh: 'fhBtn', lz: 'lzBtn', th: 'thBtn', vc: 'vcBtn' };
  for (const [key, id] of Object.entries(btnOf)) {
    // Capture: runs before the module's own onclick (which toggles). Clicking the open test does nothing;
    // clicking another closes the open one first (Calibrate may ask about unsaved changes and stay open).
    $(id).addEventListener('click', e => {
      if (tests[key].isOpen()) { e.stopImmediatePropagation(); return; }
      for (const [k, m] of Object.entries(tests)) {
        if (k === key || !m.isOpen()) continue;
        m.close();
        if (m.isOpen()) { e.stopImmediatePropagation(); return; }
      }
    }, true);
  }
  $('fhBtn').onclick = () => (fh.open ? fhHide() : fhShow());
  function current() { return Object.keys(tests).find(k => tests[k].isOpen()) || null; }
  function sync() {
    const c = current();
    document.body.dataset.test = c || 'home';
    document.body.classList.toggle('test-open', !!c);
    for (const [k, id] of Object.entries(btnOf)) { $(id).classList.toggle('active', k === c); $(id).setAttribute('aria-pressed', k === c); }
    $('testsHome').hidden = !!c;
  }
  const mo = new MutationObserver(sync);
  for (const id of Object.values(btnOf)) mo.observe($(id), { attributes: true, attributeFilter: ['class'] });
  sync();

  // ---------- Free-hand (flight loop) ----------
  let fhStats = null;
  const fhReset = () => { fhStats = { n: 0, pk: { tx: 0, ty: 0, gx: 0, gy: 0 }, sat: { x: 0, y: 0 }, fit: { x: [], y: [] } }; };
  fhReset();
  function fhShow() {
    fh.open = true; $('fhPanel').hidden = false; $('fhBtn').classList.add('on');
    fhRender();
  }
  function fhHide() {
    fh.open = false; $('fhPanel').hidden = true; $('fhBtn').classList.remove('on');
    if (freeOn && link().port) send('FREE OFF');        // never leave the tilt abort off behind your back
  }
  $('fhClose').onclick = fhHide;
  $('fhReset').onclick = () => { fhReset(); fhRender(); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && fh.open) fhHide(); });
  document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => { if (fh.open && b.dataset.tab !== 'tests') fhHide(); }));
  function fhSample() {
    if (!fh.open) return;
    const s = fhStats;
    s.n++;
    for (const k of ['tx', 'ty', 'gx', 'gy']) if (Math.abs(T[k]) > Math.abs(s.pk[k])) s.pk[k] = T[k];
    if (Math.abs(T.gx) >= GMAX - 0.15) s.sat.x++;
    if (Math.abs(T.gy) >= GMAX - 0.15) s.sat.y++;
    // Response fit: lean inside ±6° (the gimbal isn't at its limit there), last 600 samples
    for (const [ax, t, g] of [['x', T.tx, T.gx], ['y', T.ty, T.gy]]) {
      if (Math.abs(t) > 6) continue;
      s.fit[ax].push([t, g]); if (s.fit[ax].length > 600) s.fit[ax].shift();
    }
    if (s.n % 5 === 0) fhRender();
  }
  function fit(pts) {
    const big = pts.filter(p => Math.abs(p[0]) > 2);
    if (big.length < 10) return null;
    const n = pts.length, mx = pts.reduce((a, p) => a + p[0], 0) / n, my = pts.reduce((a, p) => a + p[1], 0) / n;
    let sxy = 0, sxx = 0, syy = 0;
    for (const [x, y] of pts) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
    if (!sxx || !syy) return { k: 0, r: 0 };
    return { k: sxy / sxx, r: sxy / Math.sqrt(sxx * syy) };
  }
  function setText(id, t) { const el = $(id); if (el.textContent !== t) el.textContent = t; }
  const sgn = v => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`;
  function fhRender() {
    if (!fh.open) return;
    const L = link();
    const msg = !L.port && !L.demo ? 'Connect the Arduino (or start Demo mode to try the charts).' : '';
    setText('fhMsg', msg); $('fhMsg').hidden = !msg; $('fhBody').hidden = !!msg;
    $('freeBtn').classList.toggle('on', freeOn);
    setText('fhState', freeOn ? 'Free-test on' : abortOn ? 'Tilt abort' : L.demo ? 'Demo' : 'Flight loop');
    $('fhState').className = freeOn || abortOn ? 'bad' : '';
    const s = fhStats;
    for (const ax of ['x', 'y']) {
      const f = fit(s.fit[ax]), A = ax.toUpperCase();
      const ok = f && f.k > 0.05 && f.r > 0.6;
      setText(`fhDir${A}`, !f ? DASH : ok ? 'Following' : f.k < -0.05 && f.r < -0.6 ? 'Opposite' : 'Not following');
      $(`fhDir${A}`).className = !f ? '' : ok ? 'ok' : 'bad';
      setText(`fhDir${A}s`, !f ? 'Lean past 2° to check' : `${(f.k).toFixed(2)} gimbal ° per lean ° · r ${f.r.toFixed(2)}`);
      setText(`fhPt${A}`, s.n ? sgn(s.pk['t' + ax]) + '°' : DASH);
      setText(`fhPg${A}`, s.n ? sgn(s.pk['g' + ax]) + '°' : DASH);
      setText(`fhK${A}`, f ? f.k.toFixed(2) : DASH);
      setText(`fhSat${A}`, s.n ? `${Math.round(s.sat[ax] / s.n * 100)} %` : DASH);
    }
    setText('fhNote', abortOn ? 'Tilt abort: the rocket went past 25°, so the gimbal is centred until it is back upright for 1 s. Free-test removes the abort.'
      : T.mode === 'cal' ? 'The Nano is still in calibration mode. Close the other test, or press Reset on the Nano.' : '');
  }

  // ---------- Charts ----------
  const X = css('--pitch'), Y = css('--yaw'), N = css('--muted'), W = css('--text');
  const tile = (forTests) => { const d = document.createElement('div'); d.dataset.for = forTests; $('tCharts').appendChild(d); return d; };
  const C = {
    tilt: new Chart(tile('home sc cal lz'), { title: 'Tilt', sub: 'After level trim · 10 s', unit: '°', symmetric: true, minRange: 4,
      series: [{ id: 'x', label: 'X', color: X }, { id: 'y', label: 'Y', color: Y }] }),
    servo: new Chart(tile('home sc cal fh lz'), { title: 'Gimbal', sub: 'Commanded, from the servo position · 10 s', unit: '°', symmetric: true, minRange: 4,
      series: [{ id: 'x', label: 'X', color: X }, { id: 'y', label: 'Y', color: Y }] }),
    fhX: new Chart(tile('fh'), { title: 'X axis', sub: 'Lean and the gimbal answer · 10 s', unit: '°', symmetric: true, minRange: 4,
      series: [{ id: 't', label: 'Lean X', color: X }, { id: 'g', label: 'Gimbal X', color: N, dash: true }] }),
    fhY: new Chart(tile('fh'), { title: 'Y axis', sub: 'Lean and the gimbal answer · 10 s', unit: '°', symmetric: true, minRange: 4,
      series: [{ id: 't', label: 'Lean Y', color: Y }, { id: 'g', label: 'Gimbal Y', color: N, dash: true }] }),
    fhResp: new Chart(tile('fh'), { kind: 'xy', title: 'Gimbal vs lean', sub: 'Last 5 s · slope = response', xLabel: 'Lean', xUnit: '°', unit: '°', xMin: -10, xMax: 10, yMin: -9, yMax: 9,
      series: [{ id: 'x', label: 'X', color: X, line: false }, { id: 'y', label: 'Y', color: Y, line: false }], refs: [{ y: 8 }, { y: -8 }], empty: 'Tilt the rocket' }),
    lzCvm: new Chart(tile('lz'), { kind: 'xy', title: 'Commanded vs measured', sub: 'Dashed: perfect', xLabel: 'Command', xUnit: '°', unit: '°', xMin: -9, xMax: 9, yMin: -9.5, yMax: 9.5,
      series: [{ id: 'x', label: 'X', color: X, line: false }, { id: 'y', label: 'Y', color: Y, line: false }], refs: [{ fn: x => x }], empty: 'Measure an axis' }),
    lzErr: new Chart(tile('lz'), { kind: 'xy', title: 'Error per point', sub: 'Measured − commanded · dashed: ±1° limit', xLabel: 'Command', xUnit: '°', unit: '°', xMin: -9, xMax: 9, minRange: 2.6,
      series: [{ id: 'xu', label: 'X up', color: X, marker: true }, { id: 'xd', label: 'X down', color: X, dash: true, marker: true, hollow: true },
               { id: 'yu', label: 'Y up', color: Y, marker: true }, { id: 'yd', label: 'Y down', color: Y, dash: true, marker: true, hollow: true }],
      refs: [{ y: 1 }, { y: -1 }], empty: 'Measure an axis' }),
    thThr: new Chart(tile('sc th'), { title: 'Throttle', sub: '30 s', unit: '%', span: 30, yMin: 0, yMax: 90,
      series: [{ id: 'a', label: 'Actual', color: X }, { id: 't', label: 'Target', color: N, dash: true }], empty: 'Arm to see the throttle' }),
    vib: new Chart(tile('home sc cal th'), { title: 'Vibration', sub: 'Gyro rms over 0.5 s · 30 s', unit: '°/s', span: 30, yMin: 0, minRange: 2,
      series: [{ id: 'v', label: 'Vibration', color: W }] }),
    thThrust: new Chart(tile('th'), { kind: 'xy', title: 'Thrust vs throttle', sub: 'Step test · dashed: spec', xLabel: 'Throttle', xUnit: '%', unit: 'g', xMin: 0, xMax: 90, yMin: 0,
      series: [{ id: 'm', label: 'Measured', color: X, marker: true }, { id: 's', label: 'Spec (220 g × t²)', color: N, dash: true }], empty: 'Needs a scale (step test)' }),
    vcRate: new Chart(tile('home cal th vc'), { title: 'Body rate', sub: 'Gyro · 10 s', unit: '°/s', symmetric: true, minRange: 10,
      series: [{ id: 'x', label: 'X', color: X }, { id: 'y', label: 'Y', color: Y }], empty: 'Calibration mode, firmware v1.12.0' }),
    vcMove: new Chart(tile('vc'), { kind: 'xy', title: 'Off the stop vs throttle', sub: 'Each ramp · dashed: 1° lift-off line', xLabel: 'Throttle', xUnit: '%', unit: '°', xMin: 0, xMax: 30, yMin: -0.5, minRange: 2,
      series: [{ id: 'a8', label: '8°', color: X, line: false }, { id: 'a6', label: '6°', color: Y, line: false }, { id: 'a4', label: '4°', color: W, line: false }, { id: 'a2', label: '2°', color: N, line: false }],
      refs: [{ y: 1 }], empty: 'Run the test' }),
    vcBreak: new Chart(tile('vc'), { kind: 'xy', title: 'Starts moving vs gimbal', sub: 'Dashed: same torque at every angle', xLabel: 'Gimbal', xUnit: '°', unit: '%', xMin: 0, xMax: 9, yMin: 0,
      series: [{ id: 'm', label: 'Each repeat', color: X, line: false, marker: true }, { id: 's', label: 'Same torque', color: N, dash: true }], empty: 'Run the test' }),
  };

  for (const [k, c] of Object.entries(C)) c.tile.dataset.chart = k;   // for per-test ordering in CSS

  // Live feeds: every telemetry sample
  function feed(now) {
    C.tilt.push(now, { x: T.tx, y: T.ty });
    C.servo.push(now, { x: T.gx, y: T.gy });
    C.fhX.push(now, { t: T.tx, g: T.gx });
    C.fhY.push(now, { t: T.ty, g: T.gy });
    if (T.thr != null) C.thThr.push(now, { a: T.thr, t: T.tgt });
    const r = rms(rates);
    C.vib.push(now, { v: r ?? rms(tilts) });
    C.vcRate.push(now, { x: T.rx, y: T.ry });
  }
  let lastVibUnit = '';
  // Result charts: rebuilt from each module's data a few times a second
  function results() {
    const now = performance.now();
    // Free-hand scatter: last 5 s
    const pick = (ch, id) => ch.data[id].filter(p => now - p[0] < 5000);
    const lx = pick(C.fhX, 't'), gx = pick(C.fhX, 'g'), ly = pick(C.fhY, 't'), gy = pick(C.fhY, 'g');
    C.fhResp.set({ x: lx.map((p, i) => [p[1], gx[i]?.[1]]).filter(p => p[1] != null), y: ly.map((p, i) => [p[1], gy[i]?.[1]]).filter(p => p[1] != null) });
    // Laser
    const lz = laser.data?.();
    if (lz) {
      const m = { X: lz.running && lz.axis === 'X' ? lz.work : lz.run.meas.X, Y: lz.running && lz.axis === 'Y' ? lz.work : lz.run.meas.Y };
      const pts = (a, from, to) => (m[a] || []).slice(from, to).map((v, i) => (v == null ? null : [lz.seq[from + i], v])).filter(Boolean);
      const err = (a, from, to) => pts(a, from, to).map(([c, v]) => [c, v - c]);
      C.lzCvm.set({ x: pts('X', 0, lz.seq.length), y: pts('Y', 0, lz.seq.length) });
      C.lzErr.set({ xu: err('X', 0, lz.half), xd: err('X', lz.half), yu: err('Y', 0, lz.half), yd: err('Y', lz.half) });
    }
    // Throttle step test (if a scale was used)
    const th = throttle.data?.();
    if (th) {
      const pts = (th.work || th.run.pts).filter(p => p.g != null).map(p => [p.pct, p.g]);
      C.thThrust.set({ m: pts, s: pts.length ? Array.from({ length: 18 }, (_, i) => [i * 5, 220 * (i * 5 / 100) ** 2]) : [] });
    }
    // Vibration unit: gyro (v1.12.0 in CAL) or tilt spread
    const unit = rms(rates) != null ? 'g' : 't';
    if (unit !== lastVibUnit) {
      lastVibUnit = unit;
      C.vib.o.unit = unit === 'g' ? '°/s' : '°';
      C.vib.tile.querySelector('.t-tile-h span').textContent = unit === 'g' ? 'Gyro rms over 0.5 s · 30 s' : 'Tilt spread over 0.5 s · 30 s (gyro needs CAL + v1.12.0)';
      C.vib.clear();
    }
    // Thrust vector (breakaway): every ramp's "off the stop" against throttle, and the lift-off points
    const vc = vector.data();
    const r = vc.work || vc.run;
    if (r) {
      const trials = r.angles.flatMap(a => a.trials.map(t => [a.deg, t]));
      if (vc.cur && vc.work) { const a = r.angles.find(x => x.trials.length < r.reps); if (a) trials.push([a.deg, vc.cur]); }
      const mv = { a8: [], a6: [], a4: [], a2: [] };
      for (const [deg, t] of trials) for (const p of t.samples || [])
        if (p.m != null && (p.ph === 'ramp' || p.ph === 'top') && mv['a' + deg]) mv['a' + deg].push([p.act ?? p.want, p.m]);
      C.vcMove.o.xMax = Math.max(30, r.max + 2);
      C.vcMove.set(mv);
      const at = t => t.first ?? t.brk;
      const pts = r.angles.flatMap(a => a.trials.filter(t => at(t) != null).map(t => [a.deg, at(t)]));
      // Same-torque curve through the median lift-off at the biggest angle that lifted off
      let ref = null;
      for (const a of r.angles) { const b = a.trials.map(at).filter(v => v != null).sort((x, y) => x - y); if (b.length) { ref = [a.deg, b[(b.length - 1) >> 1]]; break; } }
      const model = vc.thrustModel();
      const curve = ref ? Array.from({ length: 33 }, (_, i) => 1 + i * 0.25).map(d => [d, vc.pctFor(model, model.g(ref[1]) * Math.sin(ref[0] * Math.PI / 180) / Math.sin(d * Math.PI / 180))]).filter(p => p[1] != null && p[1] <= 85) : [];
      C.vcBreak.set({ m: pts, s: curve });
    }
  }

  // ---------- Strip + drawing loop (only while the Tests tab is showing) ----------
  const f1 = v => { if (v == null || !Number.isFinite(v)) return DASH; const t = Math.abs(v).toFixed(1); return +t === 0 ? t : `${v >= 0 ? '+' : '−'}${t}`; };
  function strip(now) {
    const stale = !T.t || now - T.t > 1000;
    const L = link();
    setText('tsMode', stale ? (L.port ? 'Waiting' : 'No link') : T.mode === 'cal' ? 'Calibration' : L.demo ? 'Demo' : freeOn ? 'Flight · free' : abortOn ? 'Flight · abort' : 'Flight');
    setText('tsTx', stale ? DASH : f1(T.tx)); setText('tsTy', stale ? DASH : f1(T.ty));
    setText('tsGx', stale ? DASH : f1(T.gx)); setText('tsGy', stale ? DASH : f1(T.gy));
    setText('tsRx', stale || T.rx == null ? DASH : f1(T.rx)); setText('tsRy', stale || T.ry == null ? DASH : f1(T.ry));
    setText('tsThr', T.thr == null ? DASH : T.thr.toFixed(0));
    $('tsMode').parentElement.classList.toggle('warn', freeOn || abortOn || (T.thr ?? 0) > 0);
  }
  let lastRes = 0, lastStrip = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    if (document.body.dataset.tab !== 'tests') return;
    if (now - lastStrip > 100) { lastStrip = now; strip(now); }
    if (now - lastRes > 250) { lastRes = now; results(); }
    for (const c of Object.values(C)) c.draw(now);
  }
  requestAnimationFrame(loop);

  return { refresh: () => { fhRender(); for (const m of Object.values(tests)) m.refresh?.(); } };
}
