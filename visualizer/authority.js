// Tests → Authority: the IT-5 open-loop gimbal step ("b"), firmware v1.12.0+ (ARM / THR / GIM, gyro rates in CAL lines).
// "How hard can the TVC turn the rocket?" The rocket is balanced on the rig pivot, so gravity barely acts on it and
// whatever turns it is the TVC. Each tip, on one axis:
//   still     wait until the rocket sits still within START_MAX of upright (it stays where it was left).
//   spin      motor to the chosen throttle with the gimbal centred; base = the drift that thrust alone gives
//             (misalignment, leftover imbalance), as a rate slope.
//   step      gimbal to the chosen angle so it tips toward the other side of upright (gimbal +X answers a lean toward
//             +X, so it turns the rocket toward −X). The body rate grows linearly: its slope is the angular
//             acceleration. Ends after TRAVEL of tilt.
//   brake     gimbal the other way until the rate is back to zero, then motor off, gimbal centred. So the rocket
//             stops about 2 × TRAVEL from where it started and the next tip goes back the other way.
// Results per axis and angle: acceleration (°/s², minus the drift), per gimbal degree (the controller's b at this
// throttle), against the design (PROJECT_SUMMARY §5: ~185 °/s² at 8° and 220 g, I ≈ 0.017 kg·m²), the torque that
// is (I × acceleration), the thrust it implies (torque / (sin gimbal × lever)), and the CG offset above the pivot the
// torque could still lift at 25°.
// Safety: the firmware's (85 % cap, ramp limit, 0.5 s link watchdog, cut past 25°, cut on mode change) plus a stop
// here past TILT_MAX, RATE_MAX, a tip the wrong way or too much drift, on Stop / Space / Esc, leaving the tab,
// hiding the page or losing the link.
import { thrustModel } from './vector.js';

const $ = id => document.getElementById(id);
const MIN_FW = [1, 12, 0];
const HEARTBEAT_MS = 150, REPLY_MS = 2000, SPIN_MAX_MS = 4000;
const STILL_MS = 800, STILL_RATE = 2, STILL_SPREAD = 0.6, WAIT_MAX_MS = 30000, START_MAX = 12;   // °/s, °: still = slow and not swinging
const BASE_MS = 700, STEP_MAX_MS = 2500, BRAKE_EXTRA_MS = 500, SETTLE_MS = 1200;
const TRAVEL = 5, WRONG = 2, DRIFT_MAX = 6, TILT_MAX = 20, RATE_MAX = 120;  // °, °/s
const GRATE = 60;              // °/s: the firmware's gimbal slew limit; the fit starts once the gimbal is there
const FIT_MIN = 5;             // samples
const LEVER_MM = 190;          // rig pivot to TVC gimbal point (as vector.js)
const MASS_G = 598;            // PROJECT_SUMMARY §5 estimate
const I_KGM2 = 0.017;          // PROJECT_SUMMARY §5 estimate, about the CG
const DESIGN = 185, DESIGN_G = 220, DESIGN_DEG = 8;   // °/s² at 8° gimbal and 220 g thrust
const HOLD_LEAN = 25;          // ° lean for "the CG offset it can still lift"
const KEY_CUR = 'tvc-authority-current', KEY_HIST = 'tvc-authority-history', KEY_OPT = 'tvc-authority-options', HIST_MAX = 20;
const KEY_SWING = 'tvc-authority-swing';
const SWING_MS = 15000, SWING_MIN = 4, SWING_AFTER = 3;   // record 15 s; released at least 4° out; 3 s of motion after
const ABORT = Symbol('abort');

// ---------- Swing (IT-3): what the rig does to the rocket with the motor off ----------
// Tip it about 10° on one axis and let go. From the release on, the rocket obeys
//   d(rate)/dt = −k·(tilt − eq) − c·rate        (k: gravity spring, 1/s²; c: pivot damping, 1/s; eq: where it settles)
// Integrated, that is linear in the unknowns: rate − rate₀ = −k·∫tilt dt + (k·eq)·t − c·(tilt − tilt₀) + offset, solved by least
// squares. k > 0: CG below the pivot (swings back), k ≈ 0: neutral (stays where left), k < 0: CG above (falls away).
// The same model removes gravity and friction from every tip: rate + k·∫(tilt − eq) dt + c·(tilt − tilt₀) then grows
// at exactly the TVC's acceleration.
function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let j = i + 1; j < n; j++) if (Math.abs(M[j][i]) > Math.abs(M[p][i])) p = j;
    if (Math.abs(M[p][i]) < 1e-12) return null;
    [M[i], M[p]] = [M[p], M[i]];
    for (let j = 0; j < n; j++) if (j !== i) { const q = M[j][i] / M[i][i]; for (let k = i; k <= n; k++) M[j][k] -= q * M[i][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
// pts: [{ t (ms), a (tilt °), r (rate °/s) }] → { k, c, eq, T, pull5, gyro, n } or { err }
export function fitSwing(pts) {
  if (pts.length < 50) return { err: 'Too few samples from the Nano.' };
  // Still runs: at least 300 ms slow (< 4 °/s) and within 1° (a hand holding it is never perfectly still). The release is the end of the last still run held
  // at least SWING_MIN out from where it started that is followed by motion; the fit runs until it is still again.
  const a0 = pts.slice(0, 5).reduce((s, p) => s + p.a, 0) / 5;
  const runs = [];
  for (let i = 0; i < pts.length;) {
    if (Math.abs(pts[i].r) >= 4) { i++; continue; }
    let j = i;
    while (j + 1 < pts.length && Math.abs(pts[j + 1].r) < 4 && Math.abs(pts[j + 1].a - pts[i].a) < 1) j++;
    if (pts[j].t - pts[i].t >= 300) runs.push({ i, j });
    i = j + 1;
  }
  const held = runs.filter(r => Math.abs(pts[r.j].a - a0) >= SWING_MIN);
  if (!held.length) return { err: `Tip it at least ${SWING_MIN}°, hold it still for a moment, then let go.` };
  const moving = held.filter(r => r.j < pts.length - 1);
  const last = held.at(-1);
  if (!moving.length || (last.j >= pts.length - 1 && moving.at(-1) === last)) {
    // Held out and never moved again: neutral (no spring; friction unknown, taken as none)
    if ((pts.at(-1).t - pts[last.i].t) / 1000 >= SWING_AFTER)
      return { k: 0, c: 0, eq: pts.at(-1).a, T: null, pull5: 0, gyro: null, n: last.j - last.i + 1, neutral: true, at: Date.now() };
    return { err: 'Let go sooner: it needs 3 s after you let go.' };
  }
  const relRun = moving.at(-1), rel = relRun.j;
  const next = runs.find(r => r.i > rel && pts[r.j].t - pts[r.i].t >= 1000);   // at rest again (a swing's turnaround is shorter)
  const q = pts.slice(rel, next ? next.i + 1 : pts.length);
  if ((q.at(-1).t - q[0].t) / 1000 < 1) {
    // Moved a little, then stopped and stayed: about neutral, and pivot friction stops it (no spring to measure)
    if (next && (pts.at(-1).t - pts[next.i].t) / 1000 >= SWING_AFTER && Math.abs(pts[next.j].a - pts[rel].a) < SWING_MIN)
      return { k: 0, c: 0, eq: pts.at(-1).a, T: null, pull5: 0, gyro: null, n: q.length, neutral: true, sticky: true, at: Date.now() };
    return { err: 'Too little motion after you let go. Try again with a bigger tip.' };
  }
  const t0 = q[0].t, ar = q[0].a, r0 = q[0].r;
  let I = 0, Ir = 0;
  const rows = q.map((p, i) => {
    if (i) { const dt = (p.t - q[i - 1].t) / 1000; I += (p.a + q[i - 1].a) / 2 * dt; Ir += (p.r + q[i - 1].r) / 2 * dt; }
    return { x: [I, (p.t - t0) / 1000, p.a - ar, 1], y: p.r - r0, ir: Ir, da: p.a - ar };   // 1: free offset (one noisy sample at the release must not bias the fit)
  });
  const A = [0, 1, 2, 3].map(() => [0, 0, 0, 0]), b = [0, 0, 0, 0];
  for (const { x, y } of rows) for (let i = 0; i < 4; i++) { b[i] += x[i] * y; for (let j = 0; j < 4; j++) A[i][j] += x[i] * x[j]; }
  const s = solve(A, b);
  if (!s) return { err: 'Could not fit the swing. Try again with a bigger tip.' };
  const k = -s[0], c = -s[2], eq = Math.abs(k) > 0.05 ? s[1] / k : q.at(-1).a;
  // Gyro check: the tilt should change by exactly the integral of the rate
  let sxy = 0, sxx = 0;
  for (const r of rows) { sxy += r.ir * r.da; sxx += r.ir * r.ir; }
  return { k, c, eq, T: k > 0.05 ? 2 * Math.PI / Math.sqrt(k) : null, pull5: k * 5, gyro: sxx ? sxy / sxx : null, n: q.length, at: Date.now() };
}
const swingText = w => !w ? 'not measured' : w.err ? w.err
  : w.k > 0.3 ? `swings back every ${w.T.toFixed(1)} s (pull ${w.pull5.toFixed(0)} °/s² at 5°), settles at ${w.eq >= 0 ? '+' : '−'}${Math.abs(w.eq).toFixed(1)}°`
  : w.k < -0.3 ? `falls away (CG above the pivot, push ${(-w.pull5).toFixed(0)} °/s² at 5°)`
  : w.sticky ? `about neutral: moved a little and stopped at ${w.eq >= 0 ? '+' : '−'}${Math.abs(w.eq).toFixed(1)}° (pivot friction; no correction needed)`
  : w.neutral ? `neutral: stayed where it was left at ${w.eq >= 0 ? '+' : '−'}${Math.abs(w.eq).toFixed(1)}° (no correction needed)`
  : `about neutral (stays where it is left, pull ${Math.abs(w.pull5).toFixed(1)} °/s² at 5°)`;
// Corrected rate along an axis for a run of samples: rate + k·∫(tilt − eq) dt + c·(tilt − tilt₀)
function corrected(pts, w) {
  if (!w || w.err || !pts.length) return pts.map(p => [p.t, p.r]);
  let I = 0;
  return pts.map((p, i) => {
    if (i) I += ((p.a - w.eq) + (pts[i - 1].a - w.eq)) / 2 * (p.t - pts[i - 1].t) / 1000;
    return [p.t, p.r + w.k * I + w.c * (p.a - pts[0].a)];
  });
}

function load(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function store(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch { return false; } }
const stamp = t => {
  const d = new Date(t), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const median = a => { const s = [...a].sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
const f = (v, d = 1) => (v == null || !Number.isFinite(v) ? '' : v.toFixed(d));
const sinD = d => Math.sin(d * Math.PI / 180);
// Least-squares slope of y against t (ms) in units per second
function slope(pts) {
  if (pts.length < FIT_MIN) return null;
  const n = pts.length, mt = pts.reduce((s, p) => s + p[0], 0) / n, my = pts.reduce((s, p) => s + p[1], 0) / n;
  let sty = 0, stt = 0;
  for (const [t, y] of pts) { sty += (t - mt) * (y - my); stt += (t - mt) ** 2; }
  return stt ? sty / stt * 1000 : null;
}

// ---------- Numbers ----------
export const design = (thrG, deg) => DESIGN * (thrG / DESIGN_G) * sinD(deg) / sinD(DESIGN_DEG);   // °/s² expected
const torqueOf = acc => I_KGM2 * acc * Math.PI / 180 / 9.80665e-3 * 1000;                        // °/s² → g·mm
export function analyse(run, model = thrustModel()) {
  const groups = [];
  for (const ax of run.axes) for (const deg of run.angles) {
    const ts = run.tips.filter(t => t.axis === ax && t.deg === deg);
    const ok = ts.filter(t => t.acc != null);
    const acc = median(ok.map(t => t.acc));
    const thr = median(ok.map(t => t.thr).filter(v => v != null)) ?? run.thr;
    const exp = design(model.g(thr), deg);
    const torque = acc != null ? torqueOf(acc) : null;
    groups.push({ axis: ax, deg, acc, perDeg: acc != null ? acc / deg : null, exp, pct: acc != null && exp ? acc / exp * 100 : null,
                  torque, thrust: torque != null ? torque / (sinD(deg) * LEVER_MM) : null, drift: median(ok.map(t => t.drift)),
                  spread: ok.length > 1 ? Math.max(...ok.map(t => t.acc)) - Math.min(...ok.map(t => t.acc)) : null, n: ts.length, nOk: ok.length });
  }
  const big = Math.max(...run.angles);
  const top = groups.filter(g => g.deg === big && g.torque != null);
  const torque = median(top.map(g => g.torque));
  return { groups, big, torque, cg: torque != null ? torque / (MASS_G * sinD(HOLD_LEAN)) : null,
           acc: median(top.map(g => g.acc)), pct: median(top.map(g => g.pct)), thrust: median(top.map(g => g.thrust)), model: model.g(run.thr), src: model.src };
}

function csv(run) {
  const model = thrustModel();
  const rows = ['axis,gimbal_deg,tip,direction,start_tilt_deg,throttle_pct,accel_dps2,drift_dps2,brake_dps2,per_gimbal_deg,design_dps2,pct_of_design,torque_gmm,implied_thrust_g,fit_samples,step_ms,thrust_source,accel_uncorrected_dps2,swing_k_per_s2'];
  run.tips.forEach((t, i) => {
    const exp = design(model.g(t.thr ?? run.thr), t.deg), tq = t.acc != null ? torqueOf(t.acc) : null;
    rows.push([t.axis, t.deg, i + 1, t.s > 0 ? '+' : '-', f(t.start, 2), f(t.thr, 1), f(t.acc, 1), f(t.drift, 1), f(t.brake, 1), f(t.acc != null ? t.acc / t.deg : null, 2),
      f(exp, 1), f(t.acc != null ? t.acc / exp * 100 : null, 0), f(tq, 0), f(tq != null ? tq / (sinD(t.deg) * LEVER_MM) : null, 1), t.nFit ?? '', f(t.stepMs, 0), model.src, f(t.accRaw, 1), f(t.swingK, 2)].join(','));
  });
  return rows.join('\n') + '\n';
}
function samplesCsv(run) {
  const rows = ['tip,axis,gimbal_deg,phase,t_ms,throttle_cmd_pct,throttle_actual_pct,gimbal_x_deg,gimbal_y_deg,tilt_x_deg,tilt_y_deg,rate_x_dps,rate_y_dps'];
  run.tips.forEach((t, i) => {
    for (const s of t.samples || [])
      rows.push([i + 1, t.axis, t.deg, s.ph, Math.round(s.t - run.t0), f(s.want, 1), f(s.act, 1), f(s.gx, 2), f(s.gy, 2), f(s.tx, 2), f(s.ty, 2), f(s.rx, 1), f(s.ry, 1)].join(','));
  });
  return rows.join('\n') + '\n';
}
function summary(run) {
  const o = analyse(run);
  const lines = [`IT-5 gimbal authority, ${stamp(run.t)}`,
    `Firmware v${run.fw} · throttle ${run.thr} % · axes ${run.axes.join(', ')} · ${run.reps} repeat${run.reps > 1 ? 's' : ''} each way · design from ${o.src === 'scale' ? 'the scale step test' : 'the spec curve (220 g × t²)'}`];
  for (const g of o.groups)
    lines.push(`${g.axis} ${g.deg}°  accel ${f(g.acc, 1) || '—'} °/s²  (${f(g.perDeg, 2) || '—'} per °, ${f(g.pct, 0) || '—'} % of design ${f(g.exp, 1)})  torque ${f(g.torque, 0) || '—'} g·mm  thrust ${f(g.thrust, 0) || '—'} g  drift ${f(g.drift, 1) || '—'} °/s²  (${g.nOk}/${g.n})`);
  for (const a of run.axes) lines.push(`Swing ${a}: ${run.swing?.[a] ? swingText(run.swing[a]) + ` (k ${f(run.swing[a].k, 2)}/s², c ${f(run.swing[a].c, 2)}/s): corrected` : 'not measured: not corrected for gravity or friction'}`);
  if (o.torque != null) lines.push(`At ${o.big}°: ${f(o.torque, 0)} g·mm (I = ${I_KGM2} kg·m² est.) ≈ lifts a CG up to ${f(o.cg, 1)} mm above the pivot at ${HOLD_LEAN}° lean (${MASS_G} g)`);
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

export function initAuthority({ send, link }) {
  const panel = $('auPanel');
  let open = false, tab = 0;
  let cfg = null, calOn = false, hasRates = false;
  let armed = false, fwAct = null, lastThr = 0;
  let live = null;                         // last sample: { tx, ty, rx, ry }
  let checks = [false, false, false, false, false];
  let opt = { thr: 25, angles: [8, 4], axes: ['X'], reps: 1, ...load(KEY_OPT, {}) };
  if (!Array.isArray(opt.angles) || !opt.angles.length) opt.angles = [8, 4];
  if (!Array.isArray(opt.axes) || !opt.axes.length) opt.axes = ['X'];
  let phase = 'idle';                      // idle | arming | running | done | error
  let stepLabel = '', stepIdx = 0, want = 0, gim = { x: 0, y: 0 };
  let note = '', noteWarn = false, copied = 0;
  let beat = 0, cancelers = [], aborted = false;
  let cur = null;                          // the tip being run
  let run = load(KEY_CUR, null);
  if (!Array.isArray(run?.tips)) run = null;
  let history = load(KEY_HIST, []).filter(h => Array.isArray(h?.tips));
  let work = null;
  let swing = load(KEY_SWING, {});          // { X: fitSwing(), Y: … }
  let rec = null, swingNote = '', swingWarn = false, recTick = 0;   // rec: the swing being recorded { axis, t0, pts }

  // ---------- Firmware lines ----------
  function handle(line) {
    const p = line.split(',');
    if (p[0] === 'CFG') { cfg = { tx: +p[5], ty: +p[6] }; if (open && !calOn) send('CAL'); }
    else if (p[0] === 'CAL' && p[1] === 'ON') calOn = true;
    else if (p[0] === 'CAL' && p[1] === 'OFF') { calOn = false; if (open && phase !== 'running') send('CAL'); }
    else if (p[0] === 'CAL' && p.length >= 5) {
      calOn = true; hasRates = p.length >= 7;
      if (cfg && hasRates) {
        live = { tx: +p[3] - cfg.tx, ty: +p[4] - cfg.ty, rx: +p[5], ry: +p[6] };
        sampleIn(live);
      }
    } else if (p[0] === 'THR' && p[1] === 'CUT') {
      const why = { LINK: 'the Nano stopped hearing this page (0.5 s)', TILT: 'the rocket leaned past 25°', MODE: 'the Nano changed mode', MOVE: 'the rocket moved 12° from rest' }[p[2]] || p[2];
      armed = false;
      if (phase === 'running' || phase === 'arming') abort(`Motor cut by the Nano: ${why}.`, true);
    } else if (p[0] === 'THR' && p.length >= 5) {
      armed = p[1] === 'ARMED'; fwAct = +p[3]; lastThr = performance.now();
      if (!armed && phase === 'running') abort('Stopped: the motor was disarmed.', true);
    } else if (p[0] === 'ERR' && (phase === 'running' || phase === 'arming')) abort(`The Nano said "${line}".`, true);
    if (open) render();
  }
  const along = (c, s) => (c.axis === 'X' ? { t: s.tx, r: s.rx, o: s.ty } : { t: s.ty, r: s.ry, o: s.tx });
  // Every IMU sample (50 Hz). The step and brake end here, not in the sequencer, so the motor reacts at once.
  function sampleIn(s) {
    // Limits while the motor is on (not while waiting: you may be setting it upright by hand)
    const motorOn = phase === 'running' && (want > 0 || (fwAct ?? 0) > 0);
    if (motorOn && Math.max(Math.abs(s.tx), Math.abs(s.ty)) > TILT_MAX) { abort(`Stopped: the rocket leaned past ${TILT_MAX}°.`); return; }
    if (motorOn && Math.max(Math.abs(s.rx), Math.abs(s.ry)) > RATE_MAX) { abort(`Stopped: the rocket turned faster than ${RATE_MAX}°/s.`); return; }
    if (rec) rec.pts.push({ t: performance.now(), a: rec.axis === 'X' ? s.tx : s.ty, r: rec.axis === 'X' ? s.rx : s.ry });
    const c = cur;
    if (!c) return;
    const now = performance.now();
    c.samples.push({ t: now, ph: c.ph, want, act: fwAct, gx: gim.x, gy: gim.y, tx: s.tx, ty: s.ty, rx: s.rx, ry: s.ry });
    if (phase !== 'running') return;
    const a = along(c, s);
    const moved = (a.t - (c.ph === 'step' ? c.stepStart : c.start)) * c.s;   // positive = the way it should tip (step: from where the gimbal moved)
    if (c.ph === 'spin' || c.ph === 'base') {
      if (Math.abs(moved) > DRIFT_MAX) abort(`Stopped: with the gimbal centred the thrust alone turned it ${Math.abs(moved).toFixed(0)}°. Check the balance and that the motor tube is straight (Calibrate → Centre).`);
    } else if (c.ph === 'step') {
      if (moved < -WRONG) {
        abort(`Stopped: it tipped the wrong way (gimbal ${c.axis} ${c.s > 0 ? '−' : '+'}${c.deg}° should turn it toward ${c.s > 0 ? '+' : '−'}${c.axis}). Check Calibrate → Direction.`);
      } else if (moved >= TRAVEL) {
        c.ph = 'brake'; c.stepMs = now - c.stepAt; c.brakeAt = now;
        setGim(...gimFor(c, -1));
      }
    } else if (c.ph === 'brake') {
      // Stopped turning: the mean of the last 3 rates (one noisy sample at zero would leave it coasting)
      const last = c.samples.slice(-3);
      if (last.length === 3 && last.every(p => p.ph === 'brake') && last.reduce((m, p) => m + (c.axis === 'X' ? p.rx : p.ry), 0) / 3 * c.s <= 0) stopTip(c);
    }
  }
  // Gimbal for this tip: k = +1 tips it the way of c.s, −1 brakes. Gimbal +X turns the rocket toward −X.
  const gimFor = (c, k) => { const g = -c.s * k * c.deg; return c.axis === 'X' ? [g, 0] : [0, g]; };
  function stopTip(c) {
    if (c.ph === 'coast') return;
    c.ph = 'coast';
    want = 0; send('THR 0', true); setGim(0, 0);
    c.wake?.();
  }
  function onLink() {
    cfg = null; calOn = false; armed = false; fwAct = null; live = null;
    if (rec) cancelSwing('Swing stopped: link lost.');
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
  function startBeat() { clearInterval(beat); beat = setInterval(() => { if (armed) send(`THR ${want.toFixed(1)}`, true); }, HEARTBEAT_MS); }
  function stopBeat() { clearInterval(beat); beat = 0; }
  function setNote(t, warn) { note = t; noteWarn = !!warn; }
  const label = t => { stepLabel = t; render(); };

  async function tip(axis, deg, s0, k) {
    const tag = `${axis} ${deg}° · tip ${k + 1}/${totalTips()}`;
    // Still: near upright and not moving, for STILL_MS
    label(`${tag} · waiting for it to sit still within ${START_MAX}° of upright`);
    let since = 0, lo = null, hi = null;
    await until(() => {
      const s = live, a = s && (axis === 'X' ? { t: s.tx, o: s.ty } : { t: s.ty, o: s.tx });
      const ok = s && Math.abs(a.t) <= START_MAX && Math.abs(a.o) <= START_MAX && Math.max(Math.abs(s.rx), Math.abs(s.ry)) < STILL_RATE;
      if (ok) { lo = Math.min(lo ?? a.t, a.t); hi = Math.max(hi ?? a.t, a.t); }
      if (!ok || hi - lo > STILL_SPREAD) { since = 0; lo = hi = ok ? a.t : null; return false; }   // still swinging
      if (!since) since = performance.now();
      return performance.now() - since >= STILL_MS;
    }, WAIT_MAX_MS, `The rocket didn't settle within ${START_MAX}° of upright for 30 s. Set it near upright by hand, let go, then start again.`);
    // Direction: back toward (and past) upright if it is leaning, else as planned
    const t0 = axis === 'X' ? live.tx : live.ty;
    const s = Math.abs(t0) > 3 ? -Math.sign(t0) : s0;   // leaning more than 3°: tip it back across upright; else alternate
    const c = { axis, deg, s, start: t0, ph: 'spin', samples: [], wake: null };
    cur = c;
    // Spin: motor up with the gimbal centred, then the drift
    label(`${tag} · motor to ${work.thr} %, gimbal centred`);
    setGim(0, 0); setThr(work.thr);
    await until(() => fwAct != null && fwAct >= work.thr - 0.5, SPIN_MAX_MS, 'The motor never reached the throttle (no THR reply).');
    c.ph = 'base'; c.baseAt = performance.now();
    await wait(BASE_MS);
    // Step: gimbal on, tip it, brake it (sampleIn ends both)
    label(`${tag} · gimbal ${axis} ${(-s * deg) > 0 ? '+' : '−'}${deg}°, tipping toward ${s > 0 ? '+' : '−'}${axis}`);
    c.stepStart = axis === 'X' ? live.tx : live.ty;
    c.ph = 'step'; c.stepAt = performance.now();
    setGim(...gimFor(c, 1));
    await new Promise((res, rej) => {
      if (aborted) { rej(ABORT); return; }
      // Time limits: too slow to travel TRAVEL → brake anyway after STEP_MAX_MS; braking gives up after as long as
      // the step took plus BRAKE_EXTRA_MS (motor off either way)
      const iv = setInterval(() => {
        const now = performance.now();
        if (c.ph === 'step' && now - c.stepAt > STEP_MAX_MS) { c.ph = 'brake'; c.stepMs = now - c.stepAt; c.brakeAt = now; setGim(...gimFor(c, -1)); }
        else if (c.ph === 'brake' && now - c.brakeAt > c.stepMs + BRAKE_EXTRA_MS) stopTip(c);
        if (c.ph === 'coast') done();
      }, 20);
      const done = () => { clearInterval(iv); c.wake = null; res(); };
      c.wake = done;
      cancelers.push(() => { clearInterval(iv); rej(ABORT); });
    });
    label(`${tag} · motor off, settling`);
    await wait(SETTLE_MS);
    // Fits: drift from the base, acceleration once the gimbal is there, braking the same way
    // Gravity and pivot friction removed with the swing fit for this axis, if there is one
    const w = work.swing?.[axis];
    const ax = p => ({ t: p.t, a: axis === 'X' ? p.tx : p.ty, r: axis === 'X' ? p.rx : p.ry });
    const lag = deg / GRATE * 1000 + 60;
    const base = c.samples.filter(p => p.ph === 'base').map(ax);
    const step = c.samples.filter(p => p.ph === 'step' && p.t >= c.stepAt + lag).map(ax);
    const brk = c.samples.filter(p => p.ph === 'brake' && p.t >= c.brakeAt + 2 * lag).map(ax);
    const drift = slope(corrected(base, w)), acc = slope(corrected(step, w)), brake = slope(corrected(brk, w));
    const driftRaw = slope(base.map(p => [p.t, p.r])), accRaw = slope(step.map(p => [p.t, p.r]));
    const thrs = c.samples.filter(p => p.ph === 'step' && p.act != null).map(p => p.act);
    cur = null;
    return { axis, deg, s, start: t0, thr: median(thrs), drift: drift != null ? drift * s : null,
             acc: acc != null ? (acc - (drift ?? 0)) * s : null, accRaw: accRaw != null ? (accRaw - (driftRaw ?? 0)) * s : null, swingK: w && !w.err ? w.k : null,
             brake: brake != null ? brake * s : null, nFit: step.length, stepMs: c.stepMs ?? null,
             samples: c.samples.map(p => ({ t: p.t, ph: p.ph, want: p.want, act: p.act, gx: p.gx, gy: p.gy, tx: p.tx, ty: p.ty, rx: p.rx, ry: p.ry })), stepAt: c.stepAt };
  }

  async function sequence() {
    const angles = [...opt.angles].sort((a, b) => b - a);
    work = { id: Date.now(), t: Date.now(), t0: performance.now(), fw: link().fw, thr: opt.thr, reps: opt.reps, axes: [...opt.axes], angles, tips: [],
             swing: Object.fromEntries(['X', 'Y'].filter(a => swing[a] && !swing[a].err).map(a => [a, swing[a]])) };
    phase = 'arming'; setNote('', false); stepIdx = 0; render();
    want = 0; setGim(0, 0);
    send('ARM');
    await until(() => armed, REPLY_MS, 'No reply to ARM. Is the Nano in calibration mode (firmware v1.12.0 or newer)?');
    startBeat();
    phase = 'running';
    let k = 0;
    for (const axis of work.axes) for (const deg of angles) for (let r = 0; r < work.reps; r++) for (const s0 of [1, -1]) {
      work.tips.push(await tip(axis, deg, s0, k++));
      stepIdx++; render();
    }
    finish();
  }
  function finish() {
    cur = null; want = 0; setGim(0, 0);
    send('THR 0'); send('DISARM'); stopBeat();
    armed = false; phase = 'done';
    run = work; work = null;
    if (!store(KEY_CUR, run)) store(KEY_CUR, noSamples(run));
    history = [noSamples(run), ...history.filter(h => h.id !== run.id)].slice(0, HIST_MAX);
    store(KEY_HIST, history);
    setNote('Done: motor off, gimbal centred. See Results.', false);
    tab = 2; render();
  }
  const noSamples = r => ({ ...r, tips: r.tips.map(t => ({ ...t, samples: [] })) });

  function start() {
    if (!ready()) return;
    aborted = false; cancelers = [];
    sequence().catch(e => { if (e !== ABORT) abort(e.message || String(e), true); });
  }
  function abort(msg, warn = true) {
    if (phase !== 'running' && phase !== 'arming') { if (msg) setNote(msg, warn); return; }
    aborted = true;
    cancelers.forEach(c => c()); cancelers = [];
    cur = null; want = 0;
    if (link().port) { send('GIM 0 0'); send('THR 0'); send('DISARM'); }
    stopBeat();
    armed = false; phase = 'error'; work = null;
    setNote(msg || 'Stopped. Nothing from this run was kept.', warn);
    render();
  }

  // ---------- Open / close (tests.js closes the other tests first) ----------
  function show() {
    open = true; panel.hidden = false;
    $('auBtn').classList.add('on');
    if (cfg && !calOn) send('CAL');
    else if (link().port && !cfg) send('GET');
    render();
  }
  function hide() {
    if (rec) cancelSwing('');
    abort('Stopped: the test was closed.');
    open = false; panel.hidden = true;
    $('auBtn').classList.remove('on');
    if (calOn) send('RUN');
    calOn = false;
    if (phase === 'error') phase = 'idle';
  }
  $('auBtn').onclick = () => (open ? hide() : show());
  $('auClose').onclick = hide;
  $('auKill').onclick = () => abort('Stopped by you.', false);
  $('auStop').onclick = () => abort('Stopped by you.', false);
  document.addEventListener('keydown', e => {
    if (!open) return;
    if (e.key === 'Escape') { hide(); return; }
    if (e.code === 'Space' && (phase === 'running' || phase === 'arming') && !e.target.matches?.('input[type=text], textarea')) { e.preventDefault(); abort('Stopped by you (Space).', false); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) abort('Stopped: the page was hidden.'); });
  document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => { if (open && b.dataset.tab !== 'tests') hide(); }));

  function go(t) { tab = Math.max(0, Math.min(2, t)); render(); }
  panel.querySelectorAll('#auTabs button').forEach(b => { b.onclick = () => go(+b.dataset.tab); });
  $('auBack').onclick = () => go(tab - 1);
  $('auNext').onclick = () => (tab === 2 ? hide() : go(tab + 1));
  panel.querySelectorAll('#auCheck input').forEach((c, i) => { c.onchange = () => { checks[i] = c.checked; render(); }; });
  const saveOpt = () => { store(KEY_OPT, opt); render(); };
  const idle = () => phase !== 'running' && phase !== 'arming';
  const toggle = (list, v, sort) => {
    const has = list.includes(v);
    if (has && list.length === 1) return list;
    return has ? list.filter(x => x !== v) : sort([...list, v]);
  };
  panel.querySelectorAll('[data-ang]').forEach(b => { b.onclick = () => { if (idle()) { opt.angles = toggle(opt.angles, +b.dataset.ang, l => l.sort((a, c) => c - a)); saveOpt(); } }; });
  panel.querySelectorAll('[data-axis]').forEach(b => { b.onclick = () => { if (idle()) { opt.axes = toggle(opt.axes, b.dataset.axis, l => l.sort()); saveOpt(); } }; });
  panel.querySelectorAll('[data-thr]').forEach(b => { b.onclick = () => { if (idle()) { opt.thr = +b.dataset.thr; saveOpt(); } }; });
  panel.querySelectorAll('[data-rep]').forEach(b => { b.onclick = () => { if (idle()) { opt.reps = +b.dataset.rep; saveOpt(); } }; });
  $('auGo').onclick = start;
  function startSwing(axis) {
    if (!idle() || rec || !calOn || !hasRates) return;
    rec = { axis, t0: performance.now(), pts: [] };
    swingNote = ''; swingWarn = false;
    recTick = setInterval(() => { if (performance.now() - rec.t0 >= SWING_MS) endSwing(); else render(); }, 250);
    render();
  }
  function endSwing() {
    clearInterval(recTick);
    const { axis, pts } = rec; rec = null;
    const w = fitSwing(pts);
    if (w.err) { swingNote = `Swing ${axis}: ${w.err}`; swingWarn = true; }
    else {
      swing[axis] = w; store(KEY_SWING, swing);
      const odd = w.gyro != null && (w.gyro < 0.7 || w.gyro > 1.3);
      swingNote = odd ? `Swing ${axis}: the gyro and the tilt disagree (the tilt moved ${w.gyro.toFixed(2)}× what the gyro says), so the correction may be off. Check Calibrate → Level.` : '';
      swingWarn = odd;
    }
    render();
  }
  function cancelSwing(msg) { clearInterval(recTick); rec = null; swingNote = msg; swingWarn = !!msg; render(); }
  panel.querySelectorAll('[data-swing]').forEach(b => { b.onclick = () => (rec ? cancelSwing('Swing cancelled.') : startSwing(b.dataset.swing)); });
  $('auCsv').onclick = () => { if (run) download(`it5_authority_${fileStamp(run)}.csv`, csv(run)); };
  $('auCopy').onclick = async () => {
    try { await navigator.clipboard.writeText(summary(run) + '\n\n' + csv(run)); copied = Date.now(); render(); setTimeout(render, 1600); } catch {}
  };
  $('auNew').onclick = () => { if (!idle()) return; phase = 'idle'; setNote('', false); tab = 0; render(); };
  $('auHist').onclick = e => {
    const b = e.target.closest('[data-hist]');
    const h = b && history.find(r => r.id === +b.dataset.hist);
    if (h) download(`it5_authority_${fileStamp(h)}.csv`, csv(h));
    if (e.target.closest('[data-raw]') && run) download(`it5_authority_samples_${fileStamp(run)}.csv`, samplesCsv(run));
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
  const ready = () => calOn && hasRates && checks.every(Boolean) && idle() && !rec && !fwOld(link().fw);
  const totalTips = () => opt.axes.length * opt.angles.length * opt.reps * 2;
  const sg = v => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`;

  function render() {
    if (!open) return;
    const L = link();
    let msg = '';
    if (!L.port) msg = L.demo ? 'The authority test needs the real Arduino. Stop the demo and connect it.' : 'Connect the Arduino to run the authority test.';
    else if (fwOld(L.fw)) msg = `Firmware v${L.fw} doesn't send gyro rates in calibration mode. Upload firmware v1.12.0 or newer (firmware/nano_tvc).`;
    else if (!cfg) msg = 'Waiting for the Nano. It restarts when the port opens and takes about 5 s to boot (keep the rocket still).';
    $('auMsg').textContent = msg;
    $('auMsg').hidden = !msg || tab === 2;
    $('auBody').hidden = !!msg && tab !== 2;

    const busy = !idle();
    setText('auState', phase === 'arming' ? 'Arming…' : phase === 'running' ? 'Running' : phase === 'error' ? 'Stopped' : 'IT-5');
    $('auState').className = busy ? 'bad' : '';
    $('auKill').hidden = !busy;
    panel.querySelectorAll('#auTabs button').forEach(b => b.classList.toggle('active', +b.dataset.tab === tab));
    $('auTabs').querySelector('[data-tab="0"]').classList.toggle('done', checks.every(Boolean));
    $('auTabs').querySelector('[data-tab="1"]').classList.toggle('done', !!run);
    panel.querySelectorAll('.au-step').forEach(s => { s.hidden = +s.dataset.tab !== tab; });
    $('auBack').disabled = tab === 0;
    setText('auNext', tab === 2 ? 'Close' : 'Next');

    // Setup
    panel.querySelectorAll('[data-ang]').forEach(b => { b.classList.toggle('on', opt.angles.includes(+b.dataset.ang)); b.disabled = busy; });
    panel.querySelectorAll('[data-axis]').forEach(b => { b.classList.toggle('on', opt.axes.includes(b.dataset.axis)); b.disabled = busy; });
    panel.querySelectorAll('[data-thr]').forEach(b => { b.classList.toggle('on', +b.dataset.thr === opt.thr); b.disabled = busy; });
    panel.querySelectorAll('[data-rep]').forEach(b => { b.classList.toggle('on', +b.dataset.rep === opt.reps); b.disabled = busy; });
    const lean = live ? Math.hypot(live.tx, live.ty) : null;
    panel.querySelectorAll('[data-swing]').forEach(b => {
      const on = rec?.axis === b.dataset.swing;
      b.classList.toggle('on', on); b.disabled = busy || (!!rec && !on) || !calOn || !hasRates;
      setText(b.id, on ? 'Stop' : `Swing ${b.dataset.swing}`);
    });
    const left = rec ? Math.max(0, Math.ceil((SWING_MS - (performance.now() - rec.t0)) / 1000)) : 0;
    setText('auSwingTxt', rec ? `Swing ${rec.axis}: tip it about 10° toward +${rec.axis}, hold it still, then let go and keep your hands off. Recording… ${left} s`
      : ['X', 'Y'].map(a => `${a}: ${swingText(swing[a])}${swing[a]?.at ? ` [${new Date(swing[a].at).toTimeString().slice(0, 5)}]` : ''}`).join(' · ') +
        (swingNote ? ` — ${swingNote}${swingWarn && /Tip it|Let go|Too little|Too few|Could not/.test(swingNote) ? ' (the result shown is the previous one)' : ''}` : ''));
    $('auSwingTxt').classList.toggle('cal-warn', !rec && swingWarn);
    setText('auPlan', `${totalTips()} tips (${opt.axes.join(' and ')} · gimbal ${[...opt.angles].sort((a, b) => b - a).join('°, ')}° · ${opt.reps} each way) at ${opt.thr} %, about ${Math.round(totalTips() * 5)} s.` +
      (lean != null ? ` Now ${lean.toFixed(1)}° from upright${lean > START_MAX ? `: set it within ${START_MAX}° first` : ''}.` : ''));
    panel.querySelectorAll('#auCheck input').forEach((c, i) => { c.checked = checks[i]; c.disabled = busy; });

    // Run
    setText('auAct', armed && fwAct != null ? fwAct.toFixed(1) : DASH);
    setText('auStep', busy ? `${Math.min(stepIdx + 1, totalTips())} / ${totalTips()}` : DASH);
    setText('auGim', busy ? `${sg(gim.x)}, ${sg(gim.y)}` : DASH);
    setText('auTilt', live ? `${sg(live.tx)}, ${sg(live.ty)}` : DASH);
    setText('auRate', live ? `${sg(live.rx)}, ${sg(live.ry)}` : DASH);
    const dots = $('auDots');
    if (dots.childElementCount !== totalTips()) dots.innerHTML = '<i></i>'.repeat(totalTips());
    [...dots.children].forEach((d, i) => { d.className = busy ? (i < stepIdx ? 'ok' : i === stepIdx ? 'cur' : '') : phase === 'done' ? 'ok' : ''; });
    setText('auPrompt', phase === 'arming' ? 'Arming…' : phase === 'running' ? stepLabel : phase === 'done' ? 'Done' : phase === 'error' ? 'Stopped' : 'Ready');
    setText('auSub', busy ? 'Hands clear of the rocket and the intake. Space or Stop motor ends it at once.'
      : !checks.every(Boolean) ? 'Tick the checklist on the Setup tab first.'
      : !hasRates ? 'Waiting for gyro rates from the Nano.'
      : 'Arm & start runs every tip by itself, back and forth across upright. Keep a hand near the 12 V plug.');
    $('auGo').disabled = !ready();
    setText('auGo', busy ? 'Running…' : 'Arm & start');
    $('auStop').disabled = !busy;
    setText('auNote', note);
    $('auNote').classList.toggle('cal-warn', noteWarn && !!note);

    // Results
    const r = run, o = r ? analyse(r) : null;
    const cell = (v, d) => (v == null || !Number.isFinite(v) ? DASH : v.toFixed(d));
    const rows = o ? o.groups.map(g => `<tr><td>${g.axis} ${g.deg}°</td><td>${cell(g.acc, 0)}${g.spread != null ? ` <small>±${(g.spread / 2).toFixed(0)}</small>` : ''}</td><td>${cell(g.perDeg, 1)}</td><td>${cell(g.pct, 0)}</td><td>${cell(g.torque, 0)}</td><td>${cell(g.thrust, 0)}</td><td>${g.nOk}/${g.n}</td></tr>`).join('') : '';
    const tb = rows || `<tr><td colspan="7">${DASH}</td></tr>`;
    if ($('auRows').innerHTML !== tb) $('auRows').innerHTML = tb;
    setText('auAcc', o?.acc != null ? `${o.acc.toFixed(0)} °/s² at ${o.big}°` : DASH);
    setText('auCg', o?.cg != null && o.cg > 0 ? `${o.cg.toFixed(1)} mm above the pivot` : DASH);
    const none = o && o.acc == null;
    const weak = o && o.pct != null && o.pct < 50;
    const neg = o && o.acc != null && o.acc <= 0;
    const rawTop = r ? median(r.tips.filter(t => t.deg === o.big && t.accRaw != null).map(t => t.accRaw)) : null;
    setText('auOverall', !r ? 'No run yet.'
      : none ? 'No usable tips: the fits need the rocket to keep tipping for at least 0.1 s after the gimbal moves. Try a higher throttle.'
      : neg ? `Not a valid result: after removing gravity, friction and the drift the acceleration came out ${o.acc.toFixed(0)} °/s² (before the corrections: ${rawTop != null ? rawTop.toFixed(0) : '—'} °/s²). ` +
        'The corrections are bigger than what the TVC did. Redo the swing for this axis if anything on the rig changed since (cables, collar, weights), then run again at a higher throttle. Download both CSVs (Past runs → this run, every sample) to see each tip.'
      : `At ${r.thr} % and ${o.big}° of gimbal it turns the rocket at ${o.acc.toFixed(0)} °/s², ${o.pct.toFixed(0)} % of what the design expects at this throttle. ` +
        `That torque (≈ ${o.torque.toFixed(0)} g·mm) could still lift the rocket off a ${HOLD_LEAN}° lean with its CG up to ${o.cg.toFixed(1)} mm above the pivot.` +
        (weak ? ' Well below the design: the thrust is probably lower than the spec curve (run the Throttle step test on a scale), or the rocket is heavier than 0.017 kg·m².' : ''));
    $('auOverall').className = 'lz-overall' + (none || weak || neg ? ' bad' : r ? ' ok' : '');
    setText('auMeta', r ? `${stamp(r.t)} · firmware v${r.fw} · throttle ${r.thr} % · design ${o.model.toFixed(0)} g at ${r.thr} % from ${o.src === 'scale' ? 'your scale step test' : 'the spec curve (no scale step test yet)'} · I ${I_KGM2} kg·m² · lever ${LEVER_MM} mm · ${r.axes.every(a => r.swing?.[a]) ? 'gravity and friction removed with the swing fit' : r.axes.some(a => r.swing?.[a]) ? `swing fit for ${r.axes.filter(a => r.swing?.[a]).join(', ')} only` : 'no swing fit: not corrected for gravity or friction'}` : '');
    $('auCsv').disabled = $('auCopy').disabled = !r;
    setText('auCopy', Date.now() - copied < 1500 ? 'Copied ✓' : 'Copy summary');
    $('auNew').disabled = busy;
    const hist = history.map(h => {
      const ho = analyse(h);
      return `<li><span>${stamp(h.t)}</span><span>${ho.acc != null ? `${ho.acc.toFixed(0)} °/s² @ ${ho.big}°, ${h.thr} %` : `none, ${h.thr} %`}</span><button data-hist="${h.id}">CSV</button></li>`;
    }).join('') + (run?.tips.some(t => t.samples?.length) ? '<li><span>This run, every sample</span><span></span><button data-raw="1">CSV</button></li>' : '');
    const hh = hist || '<li class="empty">No finished runs yet.</li>';
    if ($('auHist').innerHTML !== hh) $('auHist').innerHTML = hh;
  }

  // For the charts (tests.js): finished tips plus the one running now
  const data = () => ({ run, work, cur, design, thrustModel });
  const level = () => (!open ? null : armed && fwAct != null && performance.now() - lastThr < 1000 ? fwAct / 85 : 0);
  return { handle, onLink, isOpen: () => open, close: hide, data, level, refresh: () => open && render() };
}
