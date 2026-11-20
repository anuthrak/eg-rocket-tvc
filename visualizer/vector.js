// Tests → Thrust vector: the CT-5 breakaway test (firmware v1.13.0+: ARM REST / THR / GIM, gyro rates in CAL lines).
// "How much thrust does it take to move the rocket?" The rocket starts where it naturally rests: leaning on a rig
// stop, pulled there by its imbalance (CG off the pivot, ESC on one side, cable tug) and held by pivot friction.
// For each gimbal angle, each repeat:
//   rest      motor armed at 0 % (ARM REST: the Nano measures its tilt cut from this attitude, not from upright),
//             gimbal centred: the mean tilt is the rest lean, its direction is the way the rocket falls.
//   aim       gimbal set to the chosen angle along that direction, so thrust pushes the rocket back toward upright
//             (gimbal +X answers a lean toward +X). Baseline: noise of the lean and of the body rate.
//   ramp      throttle rises slowly (START_PCT → max at the chosen %/s). Every IMU sample (50 Hz) gives
//             "moved" = how far the rocket has come off its rest, toward upright.
//   lift-off  moved > max(MOVE_DEG, 5 × noise) for 5 samples in a row (100 ms): the motor is cut at once from this
//             page and the gimbal centred, so it settles back onto the stop.
//   starts    the throttle where it really started to move, back-dated from lift-off by a curve fit (onset()).
//             The thrust, side force and torque use this one.
//   back      wait for it to settle back on the stop.
// Results: lift-off throttle per angle (median of the repeats), the thrust there (from the Throttle step test's
// scale readings if there are any, else the 220 g × t² spec), the side force T·sin(gimbal) and the torque about the
// pivot (side force × LEVER_MM). That torque should be the same at every gimbal angle: it is what the imbalance and
// friction hold the rocket with. Divided by the mass it gives the equivalent CG offset.
// Safety: the firmware's (85 % cap, ramp limit, 0.5 s link watchdog, cut past 12° from rest, cut on mode change)
// plus a stop here past MOVED_MAX from rest or 90°/s, on Stop / Space / Esc, leaving the tab, hiding the page or
// losing the link.

const $ = id => document.getElementById(id);
const MIN_FW = [1, 13, 0];
const HEARTBEAT_MS = 150, REPLY_MS = 2000, TICK_MS = 100;
const REST_MS = 800, AIM_MS = 600, BASE_MS = 1200, TOP_HOLD_MS = 1500, BACK_MAX_MS = 4000, BACK_EXTRA_MS = 800;
const START_PCT = 5;
const REST_MIN = 2;            // °: less than this and the rocket isn't resting on a lean (balanced, or upright)
const MOVE_DEG = 2.5, FIRST_DEG = 0.3, HITS = 5;   // lift-off: 2.5° off the stop for 5 samples (100 ms), so motor shake and settling on the stop don't count
const MOVED_MAX = 9, RATE_MAX = 90;   // the Nano cuts at 12° from rest by itself
const LEVER_MM = 190;          // rig pivot (247 mm from the tail, SLDP-GS-001) to TVC gimbal point (57 mm)
const MASS_G = 598;            // PROJECT_SUMMARY §5 estimate
const SPEC_G = 220;            // QX 30 mm EDF at full throttle
const KEY_CUR = 'tvc-breakaway-current', KEY_HIST = 'tvc-breakaway-history', KEY_OPT = 'tvc-breakaway-options', HIST_MAX = 20;
const KEY_THRUST = 'tvc-thrust-current';   // throttle.js step test (scale readings)
const ABORT = Symbol('abort');

function load(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function store(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }
const stamp = t => {
  const d = new Date(t), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const mean = a => a.reduce((s, v) => s + v, 0) / (a.length || 1);
const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) ** 2))); };
const median = a => { const s = [...a].sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
const f = (v, d = 1) => (v == null || !Number.isFinite(v) ? '' : v.toFixed(d));
const rad = d => d * Math.PI / 180;

// ---------- Thrust from throttle: the step test's scale readings if there are 2+, else the spec curve ----------
export function thrustModel() {
  const pts = (load(KEY_THRUST, null)?.pts || []).filter(p => p && p.g != null && Number.isFinite(p.g)).map(p => [p.pct, p.g]).sort((a, b) => a[0] - b[0]);
  if (pts.length >= 2) {
    const tab = [[0, 0], ...pts.filter(p => p[0] > 0)];
    const g = pct => {
      if (pct <= 0) return 0;
      for (let i = 1; i < tab.length; i++) if (pct <= tab[i][0]) {
        const [x0, y0] = tab[i - 1], [x1, y1] = tab[i];
        return y0 + (y1 - y0) * (pct - x0) / (x1 - x0);
      }
      const [x0, y0] = tab.at(-2), [x1, y1] = tab.at(-1);   // past the table: extend the last segment
      return y1 + (y1 - y0) * (pct - x1) / (x1 - x0);
    };
    return { g, src: 'scale' };
  }
  return { g: pct => SPEC_G * (Math.max(0, pct) / 100) ** 2, src: 'spec' };
}
// Throttle that gives g grams (bisection on the model)
function pctFor(model, g) {
  let lo = 0, hi = 85;
  if (model.g(hi) < g) return null;
  for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; model.g(m) < g ? (lo = m) : (hi = m); }
  return (lo + hi) / 2;
}

// ---------- When it really started moving ----------
// Lift-off (2.5° off the stop) comes after the torque balance is crossed: the rocket needs time to accelerate, and the
// throttle keeps rising meanwhile. Off the stop, moved(t) ≈ A·(t − t0)^n: n = 3 when the excess torque grows with the
// ramp, n = 2 when friction lets go at once (stick-slip). Grid search over t0 (20 ms) and n, least squares for A,
// over the ramp samples up to lift-off. Returns the throttle at t0, or null when there are too few points.
export function onset(samples, endIdx) {
  const end = samples[endIdx];
  if (!end) return null;
  const pts = [];
  for (let i = endIdx; i >= 0; i--) {
    const s = samples[i];
    if (s.ph !== 'ramp' && s.ph !== 'top') break;
    if (end.t - s.t > 5000) break;
    if (s.m != null) pts.unshift(s);
  }
  if (pts.length < 8) return null;
  let best = null;
  for (const n of [2, 3]) {
    for (let t0 = pts[0].t; t0 < end.t - 40; t0 += 20) {
      let sxy = 0, sxx = 0;
      const xs = pts.map(p => (p.t > t0 ? ((p.t - t0) / 1000) ** n : 0));
      pts.forEach((p, i) => { sxy += xs[i] * p.m; sxx += xs[i] * xs[i]; });
      if (!sxx) continue;
      const A = sxy / sxx;
      if (A <= 0) continue;
      let sse = 0;
      pts.forEach((p, i) => { sse += (p.m - A * xs[i]) ** 2; });
      if (!best || sse < best.sse) best = { sse, t0 };
    }
  }
  if (!best) return null;
  // Throttle at t0: the last sample at or before it
  let k = pts.length - 1;
  while (k > 0 && pts[k].t > best.t0) k--;
  return pts[k].act ?? pts[k].want;
}

// ---------- One gimbal angle's numbers ----------
export function analyse(ang, model = thrustModel()) {
  const ok = ang.trials.filter(t => t.brk != null);
  const brk = median(ok.map(t => t.brk)), first = median(ok.filter(t => t.first != null).map(t => t.first));
  const spread = ok.length > 1 ? Math.max(...ok.map(t => t.brk)) - Math.min(...ok.map(t => t.brk)) : null;
  const at = first ?? brk;                       // torque from where it starts moving (lift-off is a little later)
  const g = at != null ? model.g(at) : null;
  const side = g != null ? g * Math.sin(rad(ang.deg)) : null;
  const torque = side != null ? side * LEVER_MM : null;
  const rest = median(ang.trials.map(t => t.restDeg).filter(v => v != null));
  return { brk, first, spread, g, side, torque, rest, n: ang.trials.length, nOk: ok.length };
}
export function overall(run, model = thrustModel()) {
  const res = run.angles.map(a => analyse(a, model));
  const tq = res.map(r => r.torque).filter(v => v != null);
  const torque = median(tq);
  const t0 = run.angles.flatMap(a => a.trials)[0];
  return { res, torque, cg: torque != null ? torque / MASS_G : null, restDeg: t0?.restDeg ?? null, restDir: t0?.restDir ?? null,
           tqSpread: tq.length > 1 ? (Math.max(...tq) - Math.min(...tq)) / torque : null, src: model.src };
}
const dirName = d => {
  if (d == null) return '';
  const n = ((Math.round(d) % 360) + 360) % 360;
  const near = [[0, '+X'], [90, '+Y'], [180, '−X'], [270, '−Y'], [360, '+X']].find(([a]) => Math.abs(n - a) <= 10);
  return near ? `toward ${near[1]}` : `toward ${n}° (0° = +X, 90° = +Y)`;
};

function csv(run) {
  const model = thrustModel(), o = overall(run, model);
  const rows = ['gimbal_deg,trial,rest_lean_deg,rest_dir_deg,starts_moving_pct,liftoff_pct,thrust_g,side_force_g,torque_gmm,noise_deg,threshold_deg,max_pct,ramp_pct_s,thrust_source'];
  run.angles.forEach(a => a.trials.forEach((t, i) => {
    const at = t.first ?? t.brk, g = at != null ? model.g(at) : null, side = g != null ? g * Math.sin(rad(a.deg)) : null;
    rows.push([a.deg, i + 1, f(t.restDeg, 2), f(t.restDir, 0), f(t.first, 1), t.brk == null ? 'none' : f(t.brk, 1), f(g, 1), f(side, 1), f(side != null ? side * LEVER_MM : null, 0),
      f(t.noise, 3), f(t.thresh, 2), run.max, run.ramp, o.src].join(','));
  }));
  return rows.join('\n') + '\n';
}
function samplesCsv(run) {
  const rows = ['gimbal_deg,trial,phase,t_ms,throttle_cmd_pct,throttle_actual_pct,gimbal_x_deg,gimbal_y_deg,tilt_x_deg,tilt_y_deg,rate_x_dps,rate_y_dps,moved_deg'];
  run.angles.forEach(a => a.trials.forEach((t, i) => {
    for (const s of t.samples || [])
      rows.push([a.deg, i + 1, s.ph, Math.round(s.t - run.t0), f(s.want, 1), f(s.act, 1), f(s.gx, 2), f(s.gy, 2), f(s.tx, 2), f(s.ty, 2), f(s.rx, 1), f(s.ry, 1), f(s.m, 2)].join(','));
  }));
  return rows.join('\n') + '\n';
}
function summary(run) {
  const o = overall(run);
  const lines = [`CT-5 breakaway, ${stamp(run.t)}`, `Firmware v${run.fw} · ramp ${run.ramp} %/s up to ${run.max} % · ${run.reps} repeat${run.reps > 1 ? 's' : ''} · thrust from ${o.src === 'scale' ? 'the scale step test' : 'the spec curve (220 g × t²)'}`,
    `Rest lean ${f(o.restDeg, 1)}° ${dirName(o.restDir)}`];
  run.angles.forEach((a, i) => {
    const r = o.res[i];
    lines.push(`gimbal ${a.deg}°  lift-off ${r.brk != null ? f(r.brk, 1) + ' %' : 'none'}${r.spread != null ? ` (±${f(r.spread / 2, 1)})` : ''}  starts moving ${f(r.first, 1) || '—'} %  thrust ${f(r.g, 0) || '—'} g  side ${f(r.side, 1) || '—'} g  torque ${f(r.torque, 0) || '—'} g·mm  (${r.nOk}/${r.n})`);
  });
  if (o.torque != null) lines.push(`Torque to lift it off the stop ≈ ${f(o.torque, 0)} g·mm ≈ CG ${f(o.cg, 1)} mm off the pivot at ${MASS_G} g (includes pivot friction)`);
  return lines.join('\n');
}
function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const fileStamp = run => stamp(run.t).replace(' ', '_').replace(':', '');

export function initVector({ send, link }) {
  const panel = $('vcPanel');
  let open = false, tab = 0;
  let cfg = null, calOn = false, hasRates = false;
  let armed = false, fwAct = null, lastThr = 0, restReply = null;
  let checks = [false, false, false, false, false];
  let opt = { angles: [8, 4], max: 25, ramp: 2, reps: 2, ...load(KEY_OPT, {}) };
  if (!Array.isArray(opt.angles) || !opt.angles.length) opt.angles = [8, 4];
  let phase = 'idle';                      // idle | arming | running | done | error
  let stepLabel = '', stepIdx = 0, want = 0, gim = { x: 0, y: 0 }, lean = 0, moved = null;
  let note = '', noteWarn = false, copied = 0;
  let beat = 0, cancelers = [], aborted = false;
  let cur = null;                          // the trial being run: { ph, samples, u, s0, thresh, hits, brk, ... }
  let run = load(KEY_CUR, null);
  if (!Array.isArray(run?.angles)) run = null;
  let history = load(KEY_HIST, []).filter(h => Array.isArray(h?.angles));
  let work = null;

  // ---------- Firmware lines ----------
  function handle(line) {
    const p = line.split(',');
    if (p[0] === 'CFG') { cfg = { tx: +p[5], ty: +p[6] }; if (open && !calOn) send('CAL'); }
    else if (p[0] === 'CAL' && p[1] === 'ON') calOn = true;
    else if (p[0] === 'CAL' && p[1] === 'OFF') { calOn = false; if (open && phase !== 'running') send('CAL'); }
    else if (p[0] === 'CAL' && p.length >= 5) {
      calOn = true; hasRates = p.length >= 7;
      if (cfg) {
        const tx = +p[3] - cfg.tx, ty = +p[4] - cfg.ty, rx = +p[5], ry = +p[6];
        lean = Math.hypot(tx, ty);
        if (cur && hasRates) sampleIn(tx, ty, rx, ry);
      }
    } else if (p[0] === 'ARM' && p[1] === 'REST') restReply = { x: +p[2], y: +p[3] };
    else if (p[0] === 'THR' && p[1] === 'CUT') {
      const why = { LINK: 'the Nano stopped hearing this page (0.5 s)', MOVE: 'the rocket moved more than 12° from its rest', TILT: 'the rocket leaned past 25°', MODE: 'the Nano changed mode' }[p[2]] || p[2];
      armed = false;
      if (phase === 'running' || phase === 'arming') abort(`Motor cut by the Nano: ${why}.`, true);
    } else if (p[0] === 'THR' && p.length >= 5) {
      armed = p[1] === 'ARMED'; fwAct = +p[3]; lastThr = performance.now();
      if (!armed && phase === 'running') abort('Stopped: the motor was disarmed.', true);
    } else if (p[0] === 'ERR' && (phase === 'running' || phase === 'arming')) {
      abort(line === 'ERR,ARM REST lean' ? 'The Nano reads a lean of more than 40°: is the rocket on the rig, and the IMU calibrated (Calibrate → Level)?' : `The Nano said "${line}".`, true);
    }
    if (open) render();
  }
  // Every IMU sample during a trial (50 Hz). Lift-off is detected here, not in the sequencer, so the cut is immediate.
  function sampleIn(tx, ty, rx, ry) {
    const c = cur, now = performance.now();
    const s = { t: now, ph: c.ph, want, act: fwAct, gx: gim.x, gy: gim.y, tx, ty, rx, ry, m: null };
    if (c.u) {
      s.m = c.s0 - (tx * c.u.x + ty * c.u.y);      // positive = off the stop, toward upright
      moved = s.m;
    }
    c.samples.push(s);
    if (phase !== 'running') return;
    if (s.m != null && (c.ph === 'ramp' || c.ph === 'top')) {
      c.hits = s.m > c.thresh ? c.hits + 1 : 0;
      if (c.hits >= HITS && c.brk == null) {
        // Lift-off: motor off and gimbal centred at once
        want = 0; send('THR 0'); setGim(0, 0);
        const i = c.samples.length - HITS;          // the first of the HITS samples over the line
        c.brkIdx = i;
        c.brk = c.samples[i].act ?? c.samples[i].want;
        c.ph = 'back';
        c.wake?.();
      }
    }
    if (s.m != null && s.m > MOVED_MAX) abort(`Stopped: the rocket came ${s.m.toFixed(0)}° off its rest (limit ${MOVED_MAX}°). Use a lower ramp rate.`);
    else if (Math.max(Math.abs(rx), Math.abs(ry)) > RATE_MAX) abort(`Stopped: the rocket turned faster than ${RATE_MAX}°/s.`);
  }
  function onLink() {
    cfg = null; calOn = false; armed = false; fwAct = null;
    if (phase === 'running' || phase === 'arming') abort('Link lost. The Nano cuts the motor by itself within 0.5 s.', true);
    if (open) render();
  }

  // ---------- Sequencer ----------
  const wait = ms => new Promise((res, rej) => {
    if (aborted) { rej(ABORT); return; }
    const t = setTimeout(res, ms);
    cancelers.push(() => { clearTimeout(t); rej(ABORT); });
  });
  async function until(test, ms, what) {
    const t0 = performance.now();
    while (!test()) {
      if (performance.now() - t0 > ms) throw new Error(what);
      await wait(20);
    }
  }
  function setGim(x, y) { gim = { x, y }; send(`GIM ${x.toFixed(2)} ${y.toFixed(2)}`, true); }
  function setThr(pct) { want = pct; send(`THR ${pct.toFixed(1)}`, true); }
  function startBeat() { clearInterval(beat); beat = setInterval(() => { if (armed || phase === 'arming') send(`THR ${want.toFixed(1)}`, true); }, HEARTBEAT_MS); }
  function stopBeat() { clearInterval(beat); beat = 0; }
  function setNote(t, warn) { note = t; noteWarn = !!warn; }
  const label = t => { stepLabel = t; render(); };

  async function trial(ang, rep) {
    const c = { ph: 'rest', samples: [], u: null, s0: 0, thresh: MOVE_DEG, hits: 0, brk: null, first: null, wake: null };
    cur = c; moved = null;
    const tag = `${ang.deg}° · ${rep + 1}/${work.reps}`;
    // Rest: re-take the Nano's rest attitude (motor at 0), gimbal centred
    label(`${tag} · resting on the stop`);
    want = 0; if (armed) send('THR 0', true);   // THR before the first ARM is an error on the Nano
    setGim(0, 0);
    restReply = null; send('ARM REST');
    await until(() => restReply && armed, REPLY_MS, 'No reply to ARM REST. Upload firmware v1.13.0 (firmware/nano_tvc).');
    await wait(REST_MS);
    const rs = c.samples.filter(s => s.ph === 'rest');
    if (rs.length < 10) throw new Error('No IMU samples from the Nano.');
    const r = { x: mean(rs.map(s => s.tx)), y: mean(rs.map(s => s.ty)) }, rl = Math.hypot(r.x, r.y);
    if (rl < REST_MIN) throw new Error(`The rocket is resting only ${rl.toFixed(1)}° from upright, so there is no stop to lift it off. Let it lean onto a stop (or add a little weight to one side), then start again.`);
    c.u = { x: r.x / rl, y: r.y / rl }; c.restDeg = rl; c.restDir = Math.atan2(r.y, r.x) * 180 / Math.PI;
    // Aim: gimbal along the lean, so thrust pushes it back toward upright; then measure the noise
    label(`${tag} · gimbal ${ang.deg}° against the lean`);
    c.ph = 'aim';
    setGim(ang.deg * c.u.x, ang.deg * c.u.y);
    await wait(AIM_MS);
    c.ph = 'base';
    await wait(BASE_MS);
    const bs = c.samples.filter(s => s.ph === 'base');
    const lin = bs.map(s => s.tx * c.u.x + s.ty * c.u.y);
    c.s0 = mean(lin); c.noise = sd(lin);
    c.thresh = Math.max(MOVE_DEG, 5 * c.noise);
    for (const s of bs) s.m = c.s0 - (s.tx * c.u.x + s.ty * c.u.y);
    // Ramp until it lifts off (sampleIn cuts the motor) or the top is reached and held
    c.ph = 'ramp';
    const t0 = performance.now(), span = (work.max - START_PCT) / work.ramp * 1000;
    await new Promise((res, rej) => {
      if (aborted) { rej(ABORT); return; }
      let topAt = 0;
      const iv = setInterval(() => {
        if (c.brk != null) return done();
        const el = performance.now() - t0;
        if (el < span) { label(`${tag} · ramping, ${want.toFixed(0)} %`); setThr(Math.min(work.max, START_PCT + work.ramp * el / 1000)); return; }
        if (!topAt) { topAt = performance.now(); c.ph = 'top'; setThr(work.max); label(`${tag} · holding ${work.max} %`); }
        else if (performance.now() - topAt > TOP_HOLD_MS) done();
      }, TICK_MS);
      const done = () => { clearInterval(iv); c.wake = null; res(); };
      c.wake = done;
      cancelers.push(() => { clearInterval(iv); rej(ABORT); });
    });
    // Back onto the stop
    c.ph = 'back';
    setThr(0); setGim(0, 0);
    label(c.brk != null ? `${tag} · lifted off at ${c.brk.toFixed(1)} %, settling back` : `${tag} · no lift-off up to ${work.max} %, settling`);
    const tb = performance.now();
    await until(() => (moved ?? 0) < 0.5 || performance.now() - tb > BACK_MAX_MS, BACK_MAX_MS + 500, 'never');
    await wait(BACK_EXTRA_MS);
    // Starts moving: back-dated from lift-off by a curve fit (onset()); if the fit fails, where moved last left
    // the small band on its way to lift-off
    if (c.brk != null) {
      c.first = onset(c.samples, c.brkIdx + HITS - 1);
      if (c.first == null) {
        const band = Math.max(FIRST_DEG, 3 * c.noise);
        let k = c.brkIdx;
        while (k > 0 && c.samples[k - 1].m != null && c.samples[k - 1].m > band && c.samples[k - 1].ph !== 'base') k--;
        const s = c.samples[k];
        c.first = s && s.ph !== 'base' ? (s.act ?? s.want) : null;
      }
    }
    cur = null;
    return { restDeg: c.restDeg, restDir: c.restDir, noise: c.noise, thresh: c.thresh, brk: c.brk, first: c.first,
             samples: c.samples.map(s => ({ t: s.t, ph: s.ph, want: s.want, act: s.act, gx: s.gx, gy: s.gy, tx: s.tx, ty: s.ty, rx: s.rx, ry: s.ry, m: s.m })) };
  }

  async function sequence() {
    const angles = [...opt.angles].sort((a, b) => b - a);   // biggest first: lifts off soonest
    work = { id: Date.now(), t: Date.now(), t0: performance.now(), fw: link().fw, max: opt.max, ramp: opt.ramp, reps: opt.reps,
             angles: angles.map(deg => ({ deg, trials: [] })) };
    phase = 'arming'; setNote('', false); stepIdx = 0; render();
    want = 0; setGim(0, 0);
    startBeat();
    phase = 'running';
    for (const ang of work.angles) {
      for (let rep = 0; rep < work.reps; rep++) {
        ang.trials.push(await trial(ang, rep));
        stepIdx++; render();
      }
    }
    finish();
  }
  function finish() {
    cur = null; want = 0; setGim(0, 0);
    send('THR 0'); send('DISARM'); stopBeat();
    armed = false; phase = 'done';
    run = work; work = null;
    // Keep the raw samples of this run only (localStorage is small)
    if (!store2(KEY_CUR, run)) store(KEY_CUR, noSamples(run));
    history = [noSamples(run), ...history.filter(h => h.id !== run.id)].slice(0, HIST_MAX);
    store(KEY_HIST, history);
    setNote('Done: motor off, gimbal centred. See Results.', false);
    tab = 2; render();
  }
  function store2(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch { return false; } }
  const noSamples = r => ({ ...r, angles: r.angles.map(a => ({ ...a, trials: a.trials.map(t => ({ ...t, samples: [] })) })) });

  function start() {
    if (!ready()) return;
    aborted = false; cancelers = [];
    sequence().catch(e => { if (e !== ABORT) abort(e.message || String(e), true); });
  }
  function abort(msg, warn = true) {
    if (phase !== 'running' && phase !== 'arming') { if (msg) setNote(msg, warn); return; }
    aborted = true;
    cancelers.forEach(c => c()); cancelers = [];
    cur = null; want = 0; moved = null;
    if (link().port) { send('GIM 0 0'); send('THR 0'); send('DISARM'); }
    stopBeat();
    armed = false; phase = 'error'; work = null;
    setNote(msg || 'Stopped. Nothing from this run was kept.', warn);
    render();
  }

  // ---------- Open / close (tests.js closes the other tests first) ----------
  function show() {
    open = true; panel.hidden = false;
    $('vcBtn').classList.add('on');
    if (cfg && !calOn) send('CAL');
    else if (link().port && !cfg) send('GET');
    render();
  }
  function hide() {
    abort('Stopped: the test was closed.');
    open = false; panel.hidden = true;
    $('vcBtn').classList.remove('on');
    if (calOn) send('RUN');
    calOn = false;
    if (phase === 'error') phase = 'idle';
  }
  $('vcBtn').onclick = () => (open ? hide() : show());
  $('vcClose').onclick = hide;
  $('vcKill').onclick = () => abort('Stopped by you.', false);
  $('vcStop').onclick = () => abort('Stopped by you.', false);
  document.addEventListener('keydown', e => {
    if (!open) return;
    if (e.key === 'Escape') { hide(); return; }
    if (e.code === 'Space' && (phase === 'running' || phase === 'arming') && !e.target.matches?.('input[type=text], textarea')) { e.preventDefault(); abort('Stopped by you (Space).', false); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) abort('Stopped: the page was hidden.'); });
  document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => { if (open && b.dataset.tab !== 'tests') hide(); }));

  function go(t) { tab = Math.max(0, Math.min(2, t)); render(); }
  panel.querySelectorAll('#vcTabs button').forEach(b => { b.onclick = () => go(+b.dataset.tab); });
  $('vcBack').onclick = () => go(tab - 1);
  $('vcNext').onclick = () => (tab === 2 ? hide() : go(tab + 1));
  panel.querySelectorAll('#vcCheck input').forEach((c, i) => { c.onchange = () => { checks[i] = c.checked; render(); }; });
  const saveOpt = () => { store(KEY_OPT, opt); render(); };
  const idle = () => phase !== 'running' && phase !== 'arming';
  panel.querySelectorAll('[data-ang]').forEach(b => { b.onclick = () => {
    if (!idle()) return;
    const v = +b.dataset.ang, has = opt.angles.includes(v);
    if (has && opt.angles.length === 1) return;
    opt.angles = has ? opt.angles.filter(x => x !== v) : [...opt.angles, v].sort((a, c) => c - a);
    saveOpt();
  }; });
  panel.querySelectorAll('[data-max]').forEach(b => { b.onclick = () => { if (idle()) { opt.max = +b.dataset.max; saveOpt(); } }; });
  panel.querySelectorAll('[data-ramp]').forEach(b => { b.onclick = () => { if (idle()) { opt.ramp = +b.dataset.ramp; saveOpt(); } }; });
  panel.querySelectorAll('[data-rep]').forEach(b => { b.onclick = () => { if (idle()) { opt.reps = +b.dataset.rep; saveOpt(); } }; });
  $('vcGo').onclick = start;
  $('vcCsv').onclick = () => { if (run) download(`ct5_breakaway_${fileStamp(run)}.csv`, csv(run)); };
  $('vcCopy').onclick = async () => {
    try { await navigator.clipboard.writeText(summary(run) + '\n\n' + csv(run)); copied = Date.now(); render(); setTimeout(render, 1600); } catch {}
  };
  $('vcNew').onclick = () => { if (!idle()) return; phase = 'idle'; setNote('', false); tab = 0; render(); };
  $('vcHist').onclick = e => {
    const b = e.target.closest('[data-hist]');
    const h = b && history.find(r => r.id === +b.dataset.hist);
    if (h) download(`ct5_breakaway_${fileStamp(h)}.csv`, csv(h));
    const s = e.target.closest('[data-raw]');
    if (s && run) download(`ct5_breakaway_samples_${fileStamp(run)}.csv`, samplesCsv(run));
  };

  // ---------- Render ----------
  const DASH = '—';
  const fwOld = fw => {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(fw || '');
    if (!m) return false;
    const v = m.slice(1).map(Number);
    for (let i = 0; i < 3; i++) if (v[i] !== MIN_FW[i]) return v[i] < MIN_FW[i];
    return false;
  };
  function setText(id, t) { const el = $(id); if (el.textContent !== t) el.textContent = t; }
  const ready = () => calOn && hasRates && checks.every(Boolean) && idle() && !fwOld(link().fw);
  const totalSteps = () => opt.angles.length * opt.reps;

  function render() {
    if (!open) return;
    const L = link();
    let msg = '';
    if (!L.port) msg = L.demo ? 'The thrust-vector test needs the real Arduino. Stop the demo and connect it.' : 'Connect the Arduino to run the thrust-vector test.';
    else if (fwOld(L.fw)) msg = `Firmware v${L.fw} can't arm with the rocket resting on a stop (its 25° tilt cut would stop the motor). Upload firmware v1.13.0 or newer (firmware/nano_tvc).`;
    else if (!cfg) msg = 'Waiting for the Nano. It restarts when the port opens and takes about 5 s to boot (keep the rocket still).';
    $('vcMsg').textContent = msg;
    $('vcMsg').hidden = !msg || tab === 2;
    $('vcBody').hidden = !!msg && tab !== 2;

    const busy = !idle();
    setText('vcState', phase === 'arming' ? 'Arming…' : phase === 'running' ? 'Running' : phase === 'error' ? 'Stopped' : 'CT-5');
    $('vcState').className = busy ? 'bad' : '';
    $('vcKill').hidden = !busy;
    panel.querySelectorAll('#vcTabs button').forEach(b => b.classList.toggle('active', +b.dataset.tab === tab));
    $('vcTabs').querySelector('[data-tab="0"]').classList.toggle('done', checks.every(Boolean));
    $('vcTabs').querySelector('[data-tab="1"]').classList.toggle('done', !!run);
    panel.querySelectorAll('.vc-step').forEach(s => { s.hidden = +s.dataset.tab !== tab; });
    $('vcBack').disabled = tab === 0;
    setText('vcNext', tab === 2 ? 'Close' : 'Next');

    // Setup
    panel.querySelectorAll('[data-ang]').forEach(b => { b.classList.toggle('on', opt.angles.includes(+b.dataset.ang)); b.disabled = busy; });
    panel.querySelectorAll('[data-max]').forEach(b => { b.classList.toggle('on', +b.dataset.max === opt.max); b.disabled = busy; });
    panel.querySelectorAll('[data-ramp]').forEach(b => { b.classList.toggle('on', +b.dataset.ramp === opt.ramp); b.disabled = busy; });
    panel.querySelectorAll('[data-rep]').forEach(b => { b.classList.toggle('on', +b.dataset.rep === opt.reps); b.disabled = busy; });
    const per = (REST_MS + AIM_MS + BASE_MS + 1500) / 1000 + (opt.max - START_PCT) / opt.ramp + 2;
    setText('vcPlan', `Gimbal ${[...opt.angles].sort((a, b) => b - a).join('°, ')}° × ${opt.reps} · ${totalSteps()} ramps · up to about ${Math.round(per * totalSteps())} s, much less if it lifts off early.` +
      (lean ? ` Resting now at ${lean.toFixed(1)}° from upright.` : ''));
    panel.querySelectorAll('#vcCheck input').forEach((c, i) => { c.checked = checks[i]; c.disabled = busy; });

    // Run
    setText('vcAct', armed && fwAct != null ? fwAct.toFixed(1) : DASH);
    setText('vcStep', busy ? `${Math.min(stepIdx + 1, totalSteps())} / ${totalSteps()}` : DASH);
    setText('vcGim', busy ? `${gim.x >= 0 ? '+' : ''}${gim.x.toFixed(1)}, ${gim.y >= 0 ? '+' : ''}${gim.y.toFixed(1)}` : DASH);
    setText('vcLean', calOn && cfg ? lean.toFixed(1) : DASH);
    setText('vcMoved', busy && moved != null ? moved.toFixed(2) : DASH);
    const dots = $('vcDots');
    if (dots.childElementCount !== totalSteps()) dots.innerHTML = '<i></i>'.repeat(totalSteps());
    [...dots.children].forEach((d, i) => { d.className = busy ? (i < stepIdx ? 'ok' : i === stepIdx ? 'cur' : '') : phase === 'done' ? 'ok' : ''; });
    setText('vcPrompt', phase === 'arming' ? 'Arming…' : phase === 'running' ? stepLabel : phase === 'done' ? 'Done' : phase === 'error' ? 'Stopped' : 'Ready');
    setText('vcSub', busy ? 'Hands clear of the intake. Space or Stop motor ends it at once.'
      : !checks.every(Boolean) ? 'Tick the checklist on the Setup tab first.'
      : !hasRates ? 'Waiting for gyro rates from the Nano.'
      : 'Arm & start runs every ramp by itself. Keep a hand near the 12 V plug.');
    $('vcGo').disabled = !ready();
    setText('vcGo', busy ? 'Running…' : 'Arm & start');
    $('vcStop').disabled = !busy;
    setText('vcNote', note);
    $('vcNote').classList.toggle('cal-warn', noteWarn && !!note);

    // Results
    const r = run, o = r ? overall(r) : null;
    const cell = (v, d) => (v == null || !Number.isFinite(v) ? DASH : v.toFixed(d));
    const rows = r ? r.angles.map((a, i) => {
      const x = o.res[i];
      const lift = x.brk != null ? `${x.brk.toFixed(1)}${x.spread != null ? ` <small>±${(x.spread / 2).toFixed(1)}</small>` : ''}` : `none <small>≤ ${r.max}</small>`;
      return `<tr><td>${a.deg}°</td><td>${lift}</td><td>${cell(x.first, 1)}</td><td>${cell(x.g, 0)}</td><td>${cell(x.side, 1)}</td><td>${cell(x.torque, 0)}</td><td>${x.nOk}/${x.n}</td></tr>`;
    }).join('') : '';
    const tb = rows || `<tr><td colspan="7">${DASH}</td></tr>`;
    if ($('vcRows').innerHTML !== tb) $('vcRows').innerHTML = tb;
    setText('vcRest', o?.restDeg != null ? `${o.restDeg.toFixed(1)}° ${dirName(o.restDir)}` : DASH);
    setText('vcTorque', o?.torque != null ? `${o.torque.toFixed(0)} g·mm ≈ CG ${o.cg.toFixed(1)} mm off` : DASH);
    const none = r && o.res.every(x => x.brk == null);
    setText('vcOverall', !r ? 'No run yet.'
      : none ? `It never lifted off the stop up to ${r.max} %. Check Calibrate → Direction (the gimbal may be pushing it into the stop), then try a higher max throttle or a bigger gimbal angle.`
      : `Lifts off at ${cell(o.res.find(x => x.brk != null).brk, 1)} % with ${r.angles[o.res.findIndex(x => x.brk != null)].deg}° of gimbal.` +
        (o.tqSpread != null && o.tqSpread > 0.35 ? ' The torque differs a lot between angles: the thrust curve may be off (run the Throttle step test on a scale) or the pivot is sticky.' : ''));
    $('vcOverall').className = 'lz-overall' + (none ? ' bad' : r ? ' ok' : '');
    setText('vcMeta', r ? `${stamp(r.t)} · firmware v${r.fw} · ramp ${r.ramp} %/s to ${r.max} % · thrust from ${o.src === 'scale' ? 'your scale step test' : 'the spec curve (no scale step test yet)'} · lever ${LEVER_MM} mm` : '');
    $('vcCsv').disabled = $('vcCopy').disabled = !r;
    setText('vcCopy', Date.now() - copied < 1500 ? 'Copied ✓' : 'Copy summary');
    $('vcNew').disabled = busy;
    const hist = history.map(h => {
      const ho = overall(h), k = ho.res.findIndex(x => x.brk != null);
      return `<li><span>${stamp(h.t)}</span><span>${k >= 0 ? `${ho.res[k].brk.toFixed(1)} % @ ${h.angles[k].deg}°` : `none ≤ ${h.max} %`}</span><button data-hist="${h.id}">CSV</button></li>`;
    }).join('') + (run?.angles.some(a => a.trials.some(t => t.samples?.length)) ? '<li><span>This run, every sample</span><span></span><button data-raw="1">CSV</button></li>' : '');
    const hh = hist || '<li class="empty">No finished runs yet.</li>';
    if ($('vcHist').innerHTML !== hh) $('vcHist').innerHTML = hh;
  }

  // For the charts (tests.js): finished trials plus the one running now
  const data = () => ({ run, work, cur, busy: !idle(), opt, thrustModel, pctFor, LEVER_MM });
  const level = () => (!open ? null : armed && fwAct != null && performance.now() - lastThr < 1000 ? fwAct / 85 : 0);
  return { handle, onLink, isOpen: () => open, close: hide, data, level, refresh: () => open && render() };
}
