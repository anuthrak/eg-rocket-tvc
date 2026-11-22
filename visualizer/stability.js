// Tests → Stability (IT-3): how the rig holds the rocket with the motor OFF. Firmware v1.12.0+ (gyro rates in CAL lines).
// "Is the rocket balanced on the pivot, and if not, by how much and what fixes it?"
// For every release (each axis, alternating sides): you tip the rocket to the chosen angle and hold it still, the page
// sees it is held, you let go, and it records until the rocket is still again (or hits a stop, or the time runs out).
// Each release is fitted with
//   d(rate)/dt = −k·(tilt − eq) − c·rate − f·sign(rate)
//     k  gravity spring (1/s²): > 0 the CG is below the pivot (swings back), ≈ 0 neutral, < 0 above (falls away)
//     c  viscous damping (1/s)           f  dry pivot friction (°/s²)          eq  where gravity alone would settle it
// integrated so it is linear in the unknowns (least squares):
//   rate − rate₀ = −k·∫tilt dt + k·eq·t − c·(tilt − tilt₀) − f·∫sign(rate) dt + offset
// and cross-checked from the swing peaks (period, amplitude decay: straight line = dry friction, exponential = damping).
// From k: CG height vs the pivot h = −k·I/(m·g) (I about the pivot), swing period, pull at 5°. From f: the friction
// torque and the dead band (f/k: how far from eq it can stop). Then the fix for the chosen target (tab slide + nose
// ballast). The two rig axes cross at one point (SLDP-GS-001), so both should give the same CG height: if they don't,
// one is held by friction or something (cables) springs only one axis.
// Motor off throughout: no ARM, no throttle. Demo mode runs a simulated rig so the test can be tried without the Nano.

const $ = id => document.getElementById(id);
const MIN_FW = [1, 12, 0];
const G = 9.80665;
const HOLD_MS = 400, HOLD_RATE = 5, HOLD_SPREAD = 1.0;          // held still: slow and steady for 0.4 s
const MOVE_DEG = 0.8, MOVE_RATE = 10;                          // let go: moved this far from the hold, or this fast
const STILL_MS = 1500, STILL_RATE = 3, STILL_SPREAD = 0.5;     // at rest again after the swing
const STOP_DEG = 27;
const PEAK_RATE = 3;                                           // °/s each way between swing peaks
const MOVED_MIN = 2.5;                                         // ° of travel for a release to count as a swing                                           // at a rig stop (±30° hard stops)
const PAUSE_MS = 1200, STAY_HINT_MS = 5000;
const KEY_CUR = 'tvc-stability-current', KEY_HIST = 'tvc-stability-history', KEY_OPT = 'tvc-stability-options', HIST_MAX = 20;
const DEF = { axes: ['X', 'Y'], reps: 2, angle: 10, maxS: 20, target: 0, mass: 598, inertia: 0.017, lever: 385, slide: 5 };

// ---------- Maths ----------
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
// Least squares: rows [{ x: [...], y }], cols = indices of x to use → coefficients (full length, unused = 0) + R²
function lsq(rows, cols) {
  const n = cols.length, A = cols.map(() => Array(n).fill(0)), b = Array(n).fill(0);
  for (const { x, y } of rows) for (let i = 0; i < n; i++) { b[i] += x[cols[i]] * y; for (let j = 0; j < n; j++) A[i][j] += x[cols[i]] * x[cols[j]]; }
  const s = solve(A, b);
  if (!s) return null;
  const full = Array(rows[0].x.length).fill(0);
  cols.forEach((c, i) => { full[c] = s[i]; });
  const my = rows.reduce((m, r) => m + r.y, 0) / rows.length;
  let ss = 0, st = 0;
  for (const { x, y } of rows) { const e = y - x.reduce((m, v, i) => m + v * full[i], 0); ss += e * e; st += (y - my) ** 2; }
  return { s: full, r2: st ? 1 - ss / st : 0, rms: Math.sqrt(ss / rows.length) };
}
const mean = a => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const median = a => { const s = a.filter(v => v != null && Number.isFinite(v)).sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
function linFit(xs, ys) {
  const n = xs.length; if (n < 2) return null;
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  if (!sxx) return null;
  const m = sxy / sxx;
  return { m, b: my - m * mx, r2: syy ? (sxy * sxy) / (sxx * syy) : 1 };
}
// CG height above the pivot (mm, negative = below) from the spring k (1/s²); I about the CG + m·h² about the pivot
export function cgHeight(k, P) {
  const m = P.mass / 1000;
  let h = 0;
  for (let i = 0; i < 4; i++) h = -k * (P.inertia + m * h * h) / (m * G);
  return h * 1000;
}
// Smoothed rate (5-point moving average)
const smooth = (a, w = 2) => a.map((_, i) => { let s = 0, n = 0; for (let j = Math.max(0, i - w); j <= Math.min(a.length - 1, i + w); j++) { s += a[j]; n++; } return s / n; });

// One release → its numbers. rel: { axis, side, start, bias, stuck, hitStop, pts: [[t s, tilt °, rate °/s], …] }
export function analyseRelease(rel, P) {
  const base = { axis: rel.axis, side: rel.side, start: rel.start, stuck: !!rel.stuck, hitStop: !!rel.hitStop };
  if (rel.stuck) return { ...base, settle: rel.start, kind: 'stuck' };
  let q = rel.pts;
  if (rel.hitStop) { const i = q.findIndex(p => Math.abs(p[1]) >= STOP_DEG - 1); if (i > 10) q = q.slice(0, i); }   // fit only the free part
  const dur = q.length ? q.at(-1)[0] - q[0][0] : 0;
  const rr = q.map(p => p[2] - rel.bias);
  const peakRate = Math.max(0, ...rr.map(Math.abs));
  // Barely moved (crept a degree or two, then stopped): friction holds it there, so treat it as stuck, not as a slow swing
  const moved = q.length ? Math.max(...q.map(p => p[1])) - Math.min(...q.map(p => p[1])) : 0;
  if (q.length && moved < MOVED_MIN) return { ...base, stuck: true, kind: 'stuck', moved, settle: q.at(-1)[1] };
  if (q.length < 25 || dur < 0.6 || peakRate < 4) return { ...base, settle: q.at(-1)?.[1] ?? rel.start, kind: 'small', err: 'Too little motion to fit.' };
  // Integrated model
  const t0 = q[0][0], a0 = q[0][1], r0 = rr[0];
  let Ia = 0, Is = 0, Ir = 0;
  const sg = r => (Math.abs(r) < 1.5 ? 0 : Math.sign(r));
  const rows = q.map((p, i) => {
    if (i) {
      const dt = p[0] - q[i - 1][0];
      Ia += (p[1] + q[i - 1][1]) / 2 * dt; Is += (sg(rr[i]) + sg(rr[i - 1])) / 2 * dt; Ir += (rr[i] + rr[i - 1]) / 2 * dt;
    }
    return { x: [Ia, p[0] - t0, p[1] - a0, Is, 1], y: rr[i] - r0, ir: Ir, da: p[1] - a0 };
  });
  let fit = lsq(rows, [0, 1, 2, 3, 4]);
  if (fit && -fit.s[3] < 0) fit = lsq(rows, [0, 1, 2, 4]);                     // no dry friction
  if (fit && -fit.s[2] < 0) fit = lsq(rows, -fit.s[3] > 0 ? [0, 1, 3, 4] : [0, 1, 4]);   // no viscous damping
  if (!fit) return { ...base, settle: q.at(-1)[1], kind: 'small', err: 'Could not fit the swing.' };
  const k = -fit.s[0], c = Math.max(0, -fit.s[2]), f = Math.max(0, -fit.s[3]);
  const settle = mean(q.filter(p => p[0] >= q.at(-1)[0] - 0.5).map(p => p[1]));
  const eq = Math.abs(k) > 0.3 ? fit.s[1] / k : settle;
  const wd2 = k - c * c / 4;
  const T = k > 0.3 && wd2 > 0 ? 2 * Math.PI / Math.sqrt(wd2) : null;
  // Gyro check: the tilt should change by the integral of the rate (a leftover gyro offset adds a slope in time)
  const gfit = lsq(rows.map(r => ({ x: [r.ir, r.x[1], 1], y: r.da })), [0, 1, 2]);
  // Peaks: where the (smoothed) rate turns round, with hysteresis: the rate must pass ±PEAK_RATE each way, so gyro
  // noise near a turning point or while it sits still can't add false peaks. The release is the first extreme.
  const rs = smooth(rr, 3);
  const peaks = [[q[0][0] - t0, q[0][1]]];
  let state = 0, lastZero = 0;
  for (let i = 1; i < rs.length; i++) {
    if (Math.sign(rs[i]) !== Math.sign(rs[i - 1])) lastZero = i;
    const now = rs[i] > PEAK_RATE ? 1 : rs[i] < -PEAK_RATE ? -1 : 0;
    if (!now || now === state) continue;
    if (state) {
      let j0 = lastZero;
      for (let j = Math.max(0, lastZero - 5); j <= Math.min(q.length - 1, lastZero + 5); j++) if (Math.abs(q[j][1] - eq) > Math.abs(q[j0][1] - eq)) j0 = j;
      peaks.push([q[j0][0] - t0, q[j0][1]]);
    }
    state = now;
  }
  // Once a swing is smaller than the noise (0.6°) it has stopped: later "peaks" are sensor noise
  const cut = peaks.findIndex((p, i) => i > 0 && Math.abs(p[1] - eq) < 0.6);
  if (cut > 0) peaks.length = cut;
  const amps = peaks.map(p => Math.abs(p[1] - eq));
  const halfs = peaks.slice(1).map((p, i) => p[0] - peaks[i][0]);
  const Tpk = halfs.length >= 2 ? 2 * median(halfs.slice(1).length ? halfs.slice(1) : halfs) : halfs.length === 1 ? 2 * halfs[0] : null;
  // Decay shape (needs 3+ amplitudes): straight line → dry friction, exponential → viscous damping
  let decay = null, dropDeg = null, logDec = null;
  const amp = amps.filter(a => a > 0.3);
  if (amp.length >= 3) {
    const idx = amp.map((_, i) => i);
    const lin = linFit(idx, amp), log = linFit(idx, amp.map(Math.log));
    dropDeg = lin ? -lin.m : null; logDec = log ? -log.m : null;
    if (lin && log) decay = lin.r2 > log.r2 + 0.01 ? 'dry' : 'viscous';
  }
  const h = cgHeight(k, P);
  const Ipiv = P.inertia + (P.mass / 1000) * (h / 1000) ** 2;
  const kind = k > 0.3 ? 'back' : k < -0.3 ? 'falls' : 'neutral';
  // Settling time: last moment it was more than 1° from where it ended
  let tSettle = 0;
  for (let i = q.length - 1; i >= 0; i--) if (Math.abs(q[i][1] - settle) > 1) { tSettle = q[i][0] - t0; break; }
  return { ...base, kind, k, c, f, eq, T, Tpk, zeta: k > 0.3 ? c / (2 * Math.sqrt(k)) : null, band: k > 0.3 ? f / k : null,
           fricNmm: Ipiv * f * Math.PI / 180 * 1000, h, pull5: k * 5, settle, tSettle, peaks: peaks.length - 1, amps, decay, dropDeg, logDec,
           gyro: gfit ? gfit.s[0] : null, r2: fit.r2, rms: fit.rms, dur, peakRate };
}

// Whole run → per-axis summary, overall verdict and the fix
export function analyse(run) {
  const P = run.P;
  // Recompute from the samples when they were kept (so analysis fixes apply to saved runs); past runs keep their numbers
  const res = run.rels.map(r => (r.pts?.length || r.stuck || !r.res ? analyseRelease(r, P) : r.res));
  const axes = run.axes.map(axis => {
    const rs = res.filter(r => r.axis === axis);
    const ok = rs.filter(r => r.k != null);
    const stuck = rs.filter(r => r.stuck);
    const hs = ok.map(r => r.h);
    const plus = ok.filter(r => r.side > 0).map(r => r.settle), minus = ok.filter(r => r.side < 0).map(r => r.settle);
    const k = median(ok.map(r => r.k));
    return { axis, n: rs.length, nOk: ok.length, nStuck: stuck.length, stuckMax: stuck.length ? Math.max(...stuck.map(r => Math.abs(r.start))) : null,
             k, h: median(hs), hSpread: hs.length > 1 ? Math.max(...hs) - Math.min(...hs) : null,
             T: median(ok.map(r => r.T)), Tpk: median(ok.map(r => r.Tpk)), zeta: median(ok.map(r => r.zeta)), f: median(ok.map(r => r.f)),
             band: median(ok.map(r => r.band)), fric: median(ok.map(r => r.fricNmm)), pull5: k != null ? k * 5 : null,
             settle: median(ok.map(r => r.settle)), settleGap: plus.length && minus.length ? median(plus) - median(minus) : null,
             tSettle: median(ok.map(r => r.tSettle)), decay: (() => { const d = ok.map(r => r.decay).filter(Boolean); return d.length ? (d.filter(x => x === 'dry').length * 2 >= d.length ? 'dry' : 'viscous') : null; })(),
             gyro: median(ok.map(r => r.gyro)), r2: median(ok.map(r => r.r2)) };
  });
  // Best CG estimate. Both pivots cross at one point, so gravity gives both axes the same spring k. Two things break that:
  // friction (hides spring: lower k, big dead band) and an extra spring on one axis (cable, lead, a stop touching: higher k,
  // usually with an off-centre rest and rests that depend on the side it came from). Normally take the softer axis; take the
  // stiffer one only when the softer one shows a big dead band and the stiffer one shows no sign of a spring.
  for (const a of axes) {
    a.springy = a.h != null && ((a.settle != null && Math.abs(a.settle) > 4) || (a.settleGap != null && Math.abs(a.settleGap) > 2 * (a.band ?? 0) + 1.5) || (a.hSpread != null && a.hSpread > 6));
    a.sticky = a.band != null && a.band > 1.5;
  }
  const good = axes.filter(a => a.h != null);
  let best = null;
  if (good.length === 1) best = good[0];
  else if (good.length === 2) {
    const [soft, stiff] = Math.abs(good[0].k) <= Math.abs(good[1].k) ? good : [good[1], good[0]];
    best = soft.sticky && !stiff.springy ? stiff : soft;
  }
  const h = best?.h ?? null;
  const mismatch = good.length === 2 && Math.abs(good[0].h - good[1].h) > 5;
  const stuckAxis = axes.find(a => a.nStuck && a.nStuck === a.n);
  if (stuckAxis && best && best.k > 0.3) {
    const Ipiv = P.inertia + (P.mass / 1000) * (best.h / 1000) ** 2;
    stuckAxis.fricMin = Ipiv * best.k * stuckAxis.stuckMax * Math.PI / 180 * 1000;   // friction held at least gravity's pull there
  }
  return { res, axes, best, h, mismatch, stuckAxis, fix: h != null ? fixFor(h, P, run.target) : null };
}
// What moves the CG from h to the target (mm above the pivot): slide the pivot tabs (±slide), then nose ballast
export function fixFor(h, P, target) {
  const need = target - h;                       // + : the CG must come up relative to the pivot
  if (Math.abs(need) < 1.5) return { need, slide: 0, grams: 0, ok: true };
  const s = Math.sign(need) * Math.min(Math.abs(need), P.slide);
  const rem = need - s;
  const L = P.lever + s - target;                // ballast point above the CG target after the slide
  const grams = Math.abs(rem) > 0.5 && L > 0 ? P.mass * rem / L : 0;
  return { need, slide: s, grams, ok: false };
}

// ---------- Text ----------
const f = (v, d = 1) => (v == null || !Number.isFinite(v) ? '' : v.toFixed(d));
const sgn = (v, d = 1) => (v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`);
const hText = h => (h == null ? '—' : Math.abs(h) < 1.5 ? 'on the pivot' : `${Math.abs(h).toFixed(0)} mm ${h < 0 ? 'below' : 'above'}`);
function fixText(fx, target) {
  if (!fx) return '';
  if (fx.ok) return `Already within 1.5 mm of the target (${target ? `${target} mm nose-heavy` : 'neutral'}).`;
  const parts = [];
  if (Math.abs(fx.slide) >= 0.5) parts.push(`slide both pivot tabs ${Math.abs(fx.slide).toFixed(0)} mm toward the ${fx.slide > 0 ? 'tail' : 'nose'}`);
  if (fx.grams >= 1) parts.push(`add about ${fx.grams.toFixed(0)} g at the nose`);
  else if (fx.grams <= -1) parts.push(`take about ${(-fx.grams).toFixed(0)} g off the nose (or add it at the tail)`);
  return parts.length ? parts.join(', then ') + '.' : 'Within the tab slide.';
}
function releaseText(r) {
  if (!r) return '';
  if (r.stuck) return r.moved != null ? `crept only ${f(r.moved, 1)}° from ${sgn(r.start)}° and stopped: held by friction or something touching` : `stayed where it was left at ${sgn(r.start)}°: pivot friction is stronger than gravity's pull there`;
  if (r.err) return r.err;
  if (r.kind === 'back') return `swings back every ${f(r.T, 2)} s, CG ${hText(r.h)} the pivot, settles at ${sgn(r.settle)}°`;
  if (r.kind === 'falls') return `falls away${r.hitStop ? ' onto the stop' : ''}: CG ${hText(r.h)} the pivot`;
  return `about neutral (k ${f(r.k, 2)}), stopped at ${sgn(r.settle)}°`;
}
export function verdict(o, run) {
  if (!o.axes.some(a => a.n)) return { text: 'No releases yet.', bad: false };
  const tgt = run.target ? `${run.target} mm nose-heavy` : 'neutral';
  if (o.h == null) {  // nothing fitted
    const a = o.stuckAxis;
    return { text: a ? `Every release on ${a.axis} stayed where it was left (up to ${f(a.stuckMax, 0)}°): pivot friction holds it, so the CG can't be measured on this axis. Loosen the pivot nuts a little (snug, then back off until it swings freely) or release from a bigger angle.`
      : 'No release could be fitted. Tip it further (10–15°) and keep your hands off after letting go.', bad: true };
  }
  const b = o.best;
  let t = `CG ${hText(o.h)} the pivot (from ${b.axis}: ${b.k > 0.3 ? `swings back every ${f(b.T, 2)} s` : b.k < -0.3 ? 'falls away' : 'about neutral'}). Target: ${tgt}. Fix: ${fixText(o.fix, run.target)}`;
  if (o.mismatch) {
    const [a1, a2] = o.axes.filter(a => a.h != null);
    const other = a1 === b ? a2 : a1;
    const why = Math.abs(other.k) > Math.abs(b.k)
      ? `something adds a spring to ${other.axis} only (a cable or tether, ESC leads, a stop or the collar touching)` +
        (other.springy ? `: it ${other.settle != null && Math.abs(other.settle) > 4 ? `rests at ${sgn(other.settle)}° instead of near upright` : 'comes to rest in different places'}${other.settleGap != null && Math.abs(other.settleGap) > 2 ? `, ${f(Math.abs(other.settleGap), 0)}° apart depending on the side it came from` : ''}, and its pivot friction (±${f(other.band, 1) || '—'}°) is too small to explain that` : '') +
        `. Unplug or re-route the cables and run ${other.axis} again; if it then matches ${b.axis}, that was it`
      : `${other.axis} is held back by pivot friction (dead band ±${f(other.band, 1)}°): back its nuts off a little and run it again`;
    t += ` The axes disagree (${a1.axis} ${hText(a1.h)}, ${a2.axis} ${hText(a2.h)}). The rig's two pivots cross at one point, so gravity acts the same on both; ${b.axis} is taken as the true CG because ${why}.`;
  } else if (o.stuckAxis && o.stuckAxis.axis !== b.axis) {
    t += ` ${o.stuckAxis.axis} never moved after letting go (up to ${f(o.stuckAxis.stuckMax, 0)}°): it isn't neutral, its pivot friction (at least ${f(o.stuckAxis.fricMin, 0)} N·mm) is stronger than gravity's pull there. Back its nuts off a little and test it again.`;
  }
  const lean = o.axes.find(a => a.settle != null && Math.abs(a.settle) > 4 && !(o.mismatch && a !== b));
  if (lean && !o.mismatch) t += ` It rests at ${sgn(lean.settle)}° on ${lean.axis}: something off to the ${lean.settle > 0 ? '+' : '−'}${lean.axis} side (the ESC, a lead) or a cable pulling. With the CG this close to the pivot, under 1 mm of side offset is enough; a small weight at pivot height on the other side centres it.`;
  const bigBand = o.axes.find(a => a.band != null && a.band > 2);
  if (bigBand) t += ` ${bigBand.axis} pivot friction is large: it can stop anywhere within ±${f(bigBand.band, 1)}° of where gravity would settle it.`;
  const odd = o.axes.find(a => a.gyro != null && (a.gyro < 0.8 || a.gyro > 1.25));
  if (odd) t += ` ${odd.axis}: the tilt moved ${f(odd.gyro, 2)}× what the gyro says, so check Calibrate → Level and the IMU mount.`;
  return { text: t, bad: !o.fix?.ok || o.mismatch || !!bigBand };
}

function csv(run) {
  const o = analyse(run);
  const rows = ['release,axis,side,start_deg,result,k_per_s2,period_fit_s,period_peaks_s,cg_height_mm,pull_at_5deg_dps2,damping_c_per_s,damping_ratio,dry_friction_dps2,friction_Nmm,dead_band_deg,eq_deg,settle_deg,settle_time_s,peaks,decay,amp_drop_deg_per_half,log_decrement,gyro_ratio,fit_r2,duration_s,hit_stop'];
  o.res.forEach((r, i) => rows.push([i + 1, r.axis, r.side > 0 ? '+' : '-', f(r.start, 2), r.stuck ? 'stuck' : r.kind, f(r.k, 3), f(r.T, 3), f(r.Tpk, 3), f(r.h, 1), f(r.pull5, 1),
    f(r.c, 3), f(r.zeta, 3), f(r.f, 2), f(r.fricNmm, 2), f(r.band, 2), f(r.eq, 2), f(r.settle, 2), f(r.tSettle, 2), r.peaks ?? '', r.decay ?? '', f(r.dropDeg, 2), f(r.logDec, 3), f(r.gyro, 3), f(r.r2, 3), f(r.dur, 2), r.hitStop ? 1 : 0].join(',')));
  return rows.join('\n') + '\n';
}
function samplesCsv(run) {
  const rows = ['release,axis,side,t_s,tilt_deg,rate_dps,rate_minus_bias_dps'];
  run.rels.forEach((r, i) => { for (const p of r.pts || []) rows.push([i + 1, r.axis, r.side > 0 ? '+' : '-', f(p[0], 3), f(p[1], 2), f(p[2], 2), f(p[2] - r.bias, 2)].join(',')); });
  return rows.join('\n') + '\n';
}
function summary(run) {
  const o = analyse(run), P = run.P;
  const lines = [`IT-3 rig stability (motor off), ${stamp(run.t)}`,
    `Firmware v${run.fw}${run.demo ? ' (demo: simulated rig)' : ''} · axes ${run.axes.join(', ')} · ${run.reps} releases each · ${run.angle}° · mass ${P.mass} g · I ${P.inertia} kg·m² · ballast point ${P.lever} mm above the pivot · tab slide ±${P.slide} mm`,
    verdict(o, run).text, ''];
  for (const a of o.axes) lines.push(`${a.axis}: CG ${hText(a.h)} · period ${f(a.T, 2) || '—'} s (peaks ${f(a.Tpk, 2) || '—'} s) · pull ${f(a.pull5, 0) || '—'} °/s² at 5° · ζ ${f(a.zeta, 2) || '—'} · friction ${a.fric != null ? f(a.fric, 1) : a.fricMin != null ? '≥ ' + f(a.fricMin, 0) : '—'} N·mm (±${f(a.band, 1) || '—'}°) · settles ${sgn(a.settle)}° · ${a.nOk}/${a.n} fitted${a.nStuck ? `, ${a.nStuck} stuck` : ''}`);
  return lines.join('\n');
}
function load(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function store(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch { return false; } }
const stamp = t => {
  const d = new Date(t), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fileStamp = run => stamp(run.t).replace(' ', '_').replace(':', '');
function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- Simulated rig (Demo mode) ----------
// X: CG ~29 mm below the pivot (swings back every 2 s), light friction. Y: the same CG but a tight pivot (dry friction
// 140 °/s²), so at 10° it stays where it is left and only moves from ~15°: the situation this test was made for.
function makeSim() {
  const ax = { X: { a: 1, w: 0, k: 9.87, c: 0.15, f: 2, eq: 0.4 }, Y: { a: -0.5, w: 0, k: 9.87, c: 0.15, f: 140, eq: -0.3 } };
  const hand = { X: null, Y: null };            // target tilt while held
  const noise = () => (Math.random() + Math.random() + Math.random() - 1.5) * 0.6;
  function step(dt) {
    for (const [n, s] of Object.entries(ax)) {
      if (hand[n] != null) { const d = hand[n] - s.a; s.w = Math.max(-25, Math.min(25, d * 6)); s.a += s.w * dt; continue; }
      let acc = -s.k * (s.a - s.eq) - s.c * s.w;
      if (Math.abs(s.w) < 0.4) { if (Math.abs(acc) <= s.f) { s.w = 0; continue; } acc -= s.f * Math.sign(acc); }
      else acc -= s.f * Math.sign(s.w);
      s.w += acc * dt; s.a += s.w * dt;
      if (Math.abs(s.a) >= 30) { s.a = 30 * Math.sign(s.a); s.w = 0; }
    }
  }
  return {
    hand,
    tick() { for (let i = 0; i < 8; i++) step(0.0025); return { tx: ax.X.a + noise() * 0.2, ty: ax.Y.a + noise() * 0.2, rx: ax.X.w + 0.3 + noise() * 0.5, ry: ax.Y.w - 0.2 + noise() * 0.5 }; },
    tilt: n => ax[n].a,
  };
}

export function initStability({ send, link }) {
  const panel = $('stPanel');
  let open = false, tab = 0;
  let cfg = null, calOn = false, hasRates = false;
  let live = null;
  let opt = { ...DEF, ...load(KEY_OPT, {}) };
  if (!Array.isArray(opt.axes) || !opt.axes.length) opt.axes = [...DEF.axes];
  let checks = [false, false, false, false];
  let phase = 'idle';                      // idle | running | done
  let step = '', plan = [], idx = 0;       // step: hold | ready | swing | pause
  let buf = [], hold = null, moveHits = 0, rec = null, readyAt = 0, pauseT = 0;
  let note = '', noteWarn = false, copied = 0, lastRes = null;
  let run = load(KEY_CUR, null);
  if (!Array.isArray(run?.rels)) run = null;
  let history = load(KEY_HIST, []).filter(h => Array.isArray(h?.rels));
  let work = null;
  let sim = null, simTimer = 0;
  const api = { onSample: null };

  // ---------- Firmware lines ----------
  function handle(line) {
    if (link().demo) return;
    const p = line.split(',');
    if (p[0] === 'CFG') { cfg = { tx: +p[5], ty: +p[6] }; if (open && !calOn) send('CAL'); }
    else if (p[0] === 'CAL' && p[1] === 'ON') calOn = true;
    else if (p[0] === 'CAL' && p[1] === 'OFF') { calOn = false; if (open) send('CAL'); }
    else if (p[0] === 'CAL' && p.length >= 5) {
      calOn = true; hasRates = p.length >= 7;
      if (cfg && hasRates) sampleIn({ tx: +p[3] - cfg.tx, ty: +p[4] - cfg.ty, rx: +p[5], ry: +p[6] });
    }
  }
  function onLink() {
    cfg = null; calOn = false; live = null; hasRates = false;
    stopSim();
    if (phase === 'running') stop('Link lost.', true);
    // bench.js starts the demo timer just after this call, so look again on the next tick
    setTimeout(() => { if (open) { if (link().demo) startSim(); render(); } }, 0);
  }

  // ---------- Every IMU sample (50 Hz): the release state machine ----------
  function sampleIn(s) {
    const now = performance.now();
    live = s;
    api.onSample?.(now, s);
    if (phase !== 'running') { if (open && now - (lastRes ?? 0) > 100) { lastRes = now; render(); } return; }
    const cur = plan[idx];
    const a = cur.axis === 'X' ? s.tx : s.ty, r = cur.axis === 'X' ? s.rx : s.ry;
    buf.push({ t: now, a, r }); while (buf.length && now - buf[0].t > 3000) buf.shift();
    const need = Math.max(3, work.angle - 2);
    if (step === 'hold') {
      const w = buf.filter(p => p.t >= now - HOLD_MS);
      const steady = w.length >= 8 && now - buf[0].t >= HOLD_MS && w.every(p => Math.abs(p.r) < HOLD_RATE) && Math.max(...w.map(p => p.a)) - Math.min(...w.map(p => p.a)) < HOLD_SPREAD;
      if (steady && a * cur.side >= need) {
        hold = { a: mean(w.map(p => p.a)), bias: mean(w.map(p => p.r)) };
        step = 'ready'; readyAt = now; moveHits = 0;
      }
    } else if (step === 'ready') {
      const moving = Math.abs(a - hold.a) > MOVE_DEG || Math.abs(r - hold.bias) > MOVE_RATE;
      moveHits = moving ? moveHits + 1 : 0;
      if (moveHits >= 2) {
        // Back-date the release to the last sample still at the hold angle
        let i = buf.length - 1;
        while (i > 0 && Math.abs(buf[i].a - hold.a) > 0.3) i--;
        const t0 = buf[i].t;
        rec = { axis: cur.axis, side: cur.side, start: hold.a, bias: hold.bias, t0, pts: buf.slice(i).map(p => [(p.t - t0) / 1000, p.a, p.r]) };
        step = 'swing';
      } else if (link().demo && now - readyAt > 4000) stayed();     // demo: nobody to press "It stayed"
    } else if (step === 'swing') {
      const t = (now - rec.t0) / 1000;
      rec.pts.push([t, a, r]);
      const w = rec.pts.filter(p => p[0] >= t - STILL_MS / 1000);
      const still = t > 1 && t - rec.pts[0][0] >= STILL_MS / 1000 && w.every(p => Math.abs(p[2] - rec.bias) < STILL_RATE) && Math.max(...w.map(p => p[1])) - Math.min(...w.map(p => p[1])) < STILL_SPREAD;
      if (Math.abs(a) >= STOP_DEG) { rec.hitStop = true; endRelease(); }
      else if (still || t >= work.maxS) { rec.ended = still ? 'still' : 'time'; endRelease(); }
    } else if (step === 'pause' && now - pauseT >= PAUSE_MS) nextRelease();
    if (open && now - (lastRes ?? 0) > 100) { lastRes = now; render(); }
  }
  function endRelease() {
    // Gyro offset: from the last second if it ended at rest (better than the hold, where a hand may still be moving)
    const tEnd = rec.pts.at(-1)?.[0] ?? 0;
    if (rec.ended === 'still') rec.bias = mean(rec.pts.filter(p => p[0] >= tEnd - 1).map(p => p[2]));
    rec.res = analyseRelease(rec, work.P);
    work.rels.push(rec);
    rec = null; idx++;
    step = 'pause'; pauseT = performance.now();
    if (idx >= plan.length) finish();
  }
  function stayed() {
    if (phase !== 'running' || step !== 'ready') return;
    const cur = plan[idx];
    rec = { axis: cur.axis, side: cur.side, start: hold.a, bias: hold.bias, t0: performance.now(), stuck: true, pts: [] };
    endRelease();
    render();
  }
  function nextRelease() { step = 'hold'; buf = []; hold = null; render(); }

  // ---------- Run control ----------
  function start() {
    if (!ready()) return;
    const P = { mass: opt.mass, inertia: opt.inertia, lever: opt.lever, slide: opt.slide };
    plan = [];
    for (const axis of opt.axes) for (let i = 0; i < opt.reps; i++) plan.push({ axis, side: i % 2 ? -1 : 1 });
    work = { id: Date.now(), t: Date.now(), fw: link().fw, demo: !!link().demo, axes: [...opt.axes], reps: opt.reps, angle: opt.angle, maxS: opt.maxS, target: opt.target, P, rels: [] };
    idx = 0; phase = 'running'; setNote('', false);
    nextRelease();
  }
  function redo() {
    if (phase !== 'running' || !work.rels.length || step === 'swing') return;
    work.rels.pop(); idx--; rec = null;
    nextRelease();
  }
  function finish() {
    phase = 'done'; step = '';
    run = work; work = null;
    if (!store(KEY_CUR, run)) store(KEY_CUR, noSamples(run));
    history = [noSamples(run), ...history.filter(h => h.id !== run.id)].slice(0, HIST_MAX);
    store(KEY_HIST, history);
    setNote('Done. See Results.', false);
    tab = 2; render();
  }
  // Stop: keep what was measured if anything
  function stop(msg, warn) {
    if (phase !== 'running') return;
    rec = null;
    if (work.rels.length) { const n = work.rels.length; finish(); setNote(`${msg || 'Stopped.'} Kept the ${n} finished release${n > 1 ? 's' : ''}.`, !!warn); }
    else { phase = 'idle'; step = ''; work = null; setNote(msg || 'Stopped. Nothing was kept.', !!warn); }
    render();
  }
  const noSamples = r => ({ ...r, rels: r.rels.map(x => ({ ...x, pts: [] })) });
  function setNote(t, warn) { note = t; noteWarn = !!warn; }

  // ---------- Demo: simulated rig + a simulated hand ----------
  function startSim() {
    if (simTimer) return;
    sim = makeSim(); hasRates = true; calOn = true;
    simTimer = setInterval(() => {
      const cur = phase === 'running' ? plan[idx] : null;
      for (const n of ['X', 'Y']) sim.hand[n] = null;
      if (cur && step === 'hold') sim.hand[cur.axis] = cur.side * (work.angle + 1);
      if (cur && step === 'ready' && performance.now() - readyAt < 700) sim.hand[cur.axis] = hold.a;
      sampleIn(sim.tick());
    }, 20);
  }
  function stopSim() { clearInterval(simTimer); simTimer = 0; sim = null; }

  // ---------- Open / close ----------
  function show() {
    open = true; panel.hidden = false;
    $('stBtn').classList.add('on');
    if (link().demo) startSim();
    else if (cfg && !calOn) send('CAL');
    else if (link().port && !cfg) send('GET');
    render();
  }
  function hide() {
    stop('Stopped: the test was closed.');
    open = false; panel.hidden = true;
    $('stBtn').classList.remove('on');
    stopSim();
    if (calOn && !link().demo) send('RUN');
    calOn = false;
  }
  $('stBtn').onclick = () => (open ? hide() : show());
  $('stClose').onclick = hide;
  document.addEventListener('keydown', e => { if (open && e.key === 'Escape') hide(); });
  document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => { if (open && b.dataset.tab !== 'tests') hide(); }));

  function go(t) { tab = Math.max(0, Math.min(2, t)); render(); }
  panel.querySelectorAll('#stTabs button').forEach(b => { b.onclick = () => go(+b.dataset.tab); });
  $('stBack').onclick = () => go(tab - 1);
  $('stNext').onclick = () => (tab === 2 ? hide() : go(tab + 1));
  panel.querySelectorAll('#stCheck input').forEach((c, i) => { c.onchange = () => { checks[i] = c.checked; render(); }; });
  const idle = () => phase !== 'running';
  const saveOpt = () => { store(KEY_OPT, opt); render(); };
  const toggle = (list, v) => (list.includes(v) ? (list.length === 1 ? list : list.filter(x => x !== v)) : [...list, v].sort());
  panel.querySelectorAll('[data-axis]').forEach(b => { b.onclick = () => { if (idle()) { opt.axes = toggle(opt.axes, b.dataset.axis); saveOpt(); } }; });
  for (const [attr, key] of [['rep', 'reps'], ['angle', 'angle'], ['max', 'maxS'], ['target', 'target']])
    panel.querySelectorAll(`[data-${attr}]`).forEach(b => { b.onclick = () => { if (idle()) { opt[key] = +b.dataset[attr]; saveOpt(); } }; });
  const NUM = { stMass: ['mass', 100, 3000], stInertia: ['inertia', 0.001, 0.2], stLever: ['lever', 20, 1000], stSlide: ['slide', 0, 30] };
  for (const [id, [key, lo, hi]] of Object.entries(NUM)) {
    const el = $(id);
    el.value = opt[key];
    el.onchange = () => {
      const v = parseFloat(el.value);
      if (Number.isFinite(v) && v >= lo && v <= hi) { opt[key] = v; saveOpt(); }
      el.value = opt[key];
    };
  }
  $('stGo').onclick = start;
  $('stStayed').onclick = stayed;
  $('stRedo').onclick = redo;
  $('stStop').onclick = () => stop('Stopped by you.', false);
  $('stCsv').onclick = () => { if (run) download(`it3_stability_${fileStamp(run)}.csv`, csv(run)); };
  $('stRaw').onclick = () => { if (run?.rels.some(r => r.pts?.length)) download(`it3_stability_samples_${fileStamp(run)}.csv`, samplesCsv(run)); };
  $('stCopy').onclick = async () => {
    try { await navigator.clipboard.writeText(summary(run) + '\n\n' + csv(run)); copied = Date.now(); render(); setTimeout(render, 1600); } catch {}
  };
  $('stNew').onclick = () => { if (!idle()) return; phase = 'idle'; setNote('', false); tab = 0; render(); };
  $('stHist').onclick = e => {
    const b = e.target.closest('[data-hist]');
    const h = b && history.find(r => r.id === +b.dataset.hist);
    if (h) download(`it3_stability_${fileStamp(h)}.csv`, csv(h));
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
  function setHtml(id, h) { const el = $(id); if (el.innerHTML !== h) el.innerHTML = h; }
  const ready = () => calOn && hasRates && checks.every(Boolean) && idle() && (link().demo || !fwOld(link().fw));
  const total = () => opt.axes.length * opt.reps;

  function render() {
    if (!open) return;
    const L = link(), demo = !!L.demo;
    let msg = '';
    if (!L.port && !demo) msg = 'Connect the Arduino to run the stability test (or start Demo mode to try it on a simulated rig).';
    else if (!demo && fwOld(L.fw)) msg = `Firmware v${L.fw} doesn't send gyro rates in calibration mode. Upload firmware v1.12.0 or newer (firmware/nano_tvc).`;
    else if (!demo && !cfg) msg = 'Waiting for the Nano. It restarts when the port opens and takes about 5 s to boot (keep the rocket still).';
    $('stMsg').textContent = msg;
    $('stMsg').hidden = !msg || tab === 2;
    $('stBody').hidden = !!msg && tab !== 2;

    const busy = !idle();
    setText('stState', busy ? 'Recording' : demo ? 'Demo' : 'IT-3');
    $('stState').className = busy ? 'bad' : '';
    panel.querySelectorAll('#stTabs button').forEach(b => b.classList.toggle('active', +b.dataset.tab === tab));
    $('stTabs').querySelector('[data-tab="0"]').classList.toggle('done', checks.every(Boolean));
    $('stTabs').querySelector('[data-tab="1"]').classList.toggle('done', !!run);
    panel.querySelectorAll('.st-step').forEach(s => { s.hidden = +s.dataset.tab !== tab; });
    $('stBack').disabled = tab === 0;
    setText('stNext', tab === 2 ? 'Close' : 'Next');

    // Setup
    panel.querySelectorAll('[data-axis]').forEach(b => { b.classList.toggle('on', opt.axes.includes(b.dataset.axis)); b.disabled = busy; });
    for (const [attr, key] of [['rep', 'reps'], ['angle', 'angle'], ['max', 'maxS'], ['target', 'target']])
      panel.querySelectorAll(`[data-${attr}]`).forEach(b => { b.classList.toggle('on', +b.dataset[attr] === opt[key]); b.disabled = busy; });
    for (const id of Object.keys(NUM)) $(id).disabled = busy;
    setText('stPlan', `${total()} releases (${opt.axes.map(a => `${opt.reps} on ${a}`).join(', ')}, alternating + and − sides) from about ${opt.angle}°, up to ${opt.maxS} s each. About ${Math.round(total() * (opt.maxS * 0.5 + 6) / 60 + 0.5)} min.`);
    panel.querySelectorAll('#stCheck input').forEach((c, i) => { c.checked = checks[i]; c.disabled = busy; });

    // Run
    const cur = busy ? plan[idx] : null;
    const along = cur && live ? (cur.axis === 'X' ? live.tx : live.ty) : null;
    setText('stBig', along != null ? sgn(along) : live ? sgn(Math.hypot(live.tx, live.ty)) : DASH);
    setText('stBigLbl', cur ? `Tilt ${cur.axis}` : 'Lean');
    setText('stRel', busy ? `${Math.min(idx + 1, plan.length)} / ${plan.length}` : DASH);
    setText('stSide', cur ? `${cur.side > 0 ? '+' : '−'}${cur.axis}` : DASH);
    setText('stTilt', live ? `${sgn(live.tx)}, ${sgn(live.ty)}` : DASH);
    setText('stRate', live ? `${sgn(live.rx)}, ${sgn(live.ry)}` : DASH);
    setText('stTime', step === 'swing' && rec ? f((performance.now() - rec.t0) / 1000, 1) : DASH);
    const dots = $('stDots');
    const n = busy ? plan.length : total();
    if (dots.childElementCount !== n) dots.innerHTML = '<i></i>'.repeat(n);
    [...dots.children].forEach((d, i) => { d.className = busy ? (i < idx ? 'ok' : i === idx ? 'cur' : '') : phase === 'done' && run?.rels.length === n ? 'ok' : ''; });
    const need = cur ? Math.max(3, work.angle - 2) : 0;
    const side = cur ? `${cur.side > 0 ? '+' : '−'}${cur.axis}` : '';
    setText('stPrompt', !busy ? (phase === 'done' ? 'Done' : 'Ready')
      : step === 'hold' ? `Tip it toward ${side}, about ${work.angle}°, and hold still`
      : step === 'ready' ? 'Let go now. Hands off.'
      : step === 'swing' ? 'Recording…' : 'Next release…');
    setText('stSub', !busy ? (!checks.every(Boolean) ? 'Tick the checklist on the Setup tab first.' : !hasRates ? 'Waiting for gyro rates from the Nano.'
        : demo ? 'Demo: a simulated rig and hand. X swings back every 2 s; Y has a tight pivot that holds it at 10°.' : 'Start, then follow the prompts: tip, hold, let go. Motor stays off.')
      : step === 'hold' ? (along != null && along * cur.side < need ? `Now ${sgn(along)}°: needs at least ${cur.side > 0 ? '+' : '−'}${need}° on ${cur.axis}, held still for half a second.` : 'Hold it still…')
      : step === 'ready' ? (performance.now() - readyAt > STAY_HINT_MS ? 'If you have let go and it stays put, press "It stayed".' : 'Open your hand without pushing. It records until the rocket is still again.')
      : step === 'swing' ? `Keep your hands off. Ends when it is still for ${STILL_MS / 1000} s, hits a stop, or after ${work.maxS} s.` : '');
    $('stGo').disabled = !ready();
    setText('stGo', busy ? 'Recording…' : 'Start');
    $('stStayed').disabled = !(busy && step === 'ready');
    $('stRedo').disabled = !(busy && work.rels.length && step !== 'swing');
    $('stStop').disabled = !busy;
    const lastRel = busy ? work.rels.at(-1) : null;
    setText('stLast', lastRel ? `Release ${work.rels.length} (${lastRel.side > 0 ? '+' : '−'}${lastRel.axis}): ${releaseText(lastRel.res)}.` : '');
    setText('stNote', note);
    $('stNote').classList.toggle('cal-warn', noteWarn && !!note);

    // Results
    const r = run, o = r ? analyse(r) : null;
    const v = r ? verdict(o, r) : { text: 'No run yet.', bad: false };
    setText('stOverall', v.text);
    $('stOverall').className = 'lz-overall' + (r ? (v.bad ? ' bad' : ' ok') : '');
    setText('stCg', o?.h != null ? hText(o.h) : DASH);
    setText('stCgS', o?.best ? `from ${o.best.axis}${o.mismatch ? ' · axes disagree' : ''}` : '');
    setText('stPer', o ? o.axes.map(a => `${a.axis} ${a.T != null ? f(a.T, 2) + ' s' : a.nStuck === a.n && a.n ? 'stuck' : a.k != null && a.k < -0.3 ? 'falls' : '—'}`).join(' · ') : DASH);
    setText('stFix', o?.fix ? (o.fix.ok ? 'None needed' : `${Math.abs(o.fix.slide) >= 0.5 ? `Tabs ${o.fix.slide > 0 ? '−' : '+'}${Math.abs(o.fix.slide).toFixed(0)} mm` : ''}${Math.abs(o.fix.slide) >= 0.5 && Math.abs(o.fix.grams) >= 1 ? ' + ' : ''}${Math.abs(o.fix.grams) >= 1 ? `${o.fix.grams > 0 ? '' : '−'}${Math.abs(o.fix.grams).toFixed(0)} g nose` : ''}`) : DASH);
    setText('stFixS', r ? `to ${r.target ? `${r.target} mm nose-heavy` : 'neutral'}` : '');
    const fr = o ? o.axes.filter(a => a.fric != null || a.fricMin != null) : [];
    setText('stFric', fr.length ? fr.map(a => `${a.axis} ${a.fric != null ? f(a.fric, 1) : `≥ ${f(a.fricMin, 0)}`}`).join(' · ') : DASH);
    setText('stFricS', fr.length ? `N·mm · dead band ${fr.map(a => (a.band != null ? `±${f(a.band, 1)}°` : a.fricMin != null ? `≥ ±${f(a.stuckMax, 0)}°` : '—')).join(', ')}` : '');
    const cell = (x, d) => (x == null || !Number.isFinite(x) ? DASH : x.toFixed(d));
    setHtml('stRows', o ? o.axes.map(a => `<tr><td>${a.axis}</td><td>${a.h != null ? `${a.h >= 0 ? '+' : '−'}${Math.abs(a.h).toFixed(0)}${a.hSpread != null ? ` <small>±${(a.hSpread / 2).toFixed(0)}</small>` : ''}` : DASH}</td><td>${cell(a.T, 2)}</td><td>${cell(a.pull5, 0)}</td><td>${cell(a.zeta, 2)}</td><td>${a.fric != null ? cell(a.fric, 1) : a.fricMin != null ? `≥ ${a.fricMin.toFixed(0)}` : DASH}</td><td>${a.settle != null ? sgn(a.settle) : DASH}</td><td>${a.nOk}/${a.n}${a.nStuck ? ` <small>${a.nStuck} stuck</small>` : ''}</td></tr>`).join('') : `<tr><td colspan="8">${DASH}</td></tr>`);
    setHtml('stRelRows', o ? o.res.map((x, i) => `<tr><td>${i + 1} ${x.side > 0 ? '+' : '−'}${x.axis}</td><td>${sgn(x.start, 0)}</td><td>${x.stuck ? 'stuck' : x.err ? 'no fit' : x.kind === 'back' ? 'back' : x.kind === 'falls' ? 'falls' : 'neutral'}</td><td>${cell(x.T, 2)}<small>${x.Tpk != null ? ` / ${x.Tpk.toFixed(2)}` : ''}</small></td><td>${x.h != null ? sgn(x.h, 0) : DASH}</td><td>${cell(x.zeta, 2)}</td><td>${cell(x.f, 0)}</td><td>${x.decay ? (x.decay === 'dry' ? 'dry' : 'visc.') : DASH}</td><td>${x.settle != null ? sgn(x.settle) : DASH}</td><td>${cell(x.gyro, 2)}</td></tr>`).join('') : '');
    const P = r?.P;
    setText('stMeta', r ? `${stamp(r.t)} · firmware v${r.fw}${r.demo ? ' (demo: simulated rig)' : ''} · ${r.rels.length} releases from ~${r.angle}° · mass ${P.mass} g · I ${P.inertia} kg·m² · ballast point ${P.lever} mm above the pivot · tab slide ±${P.slide} mm` +
      (o.axes.some(a => a.settleGap != null) ? ` · settle gap (+ side − − side): ${o.axes.filter(a => a.settleGap != null).map(a => `${a.axis} ${sgn(a.settleGap)}°`).join(', ')}` : '') : '');
    $('stCsv').disabled = $('stCopy').disabled = !r;
    $('stRaw').disabled = !r?.rels.some(x => x.pts?.length);
    setText('stCopy', Date.now() - copied < 1500 ? 'Copied ✓' : 'Copy summary');
    $('stNew').disabled = busy;
    const hist = history.map(h => {
      const ho = analyse(h);
      return `<li><span>${stamp(h.t)}${h.demo ? ' (demo)' : ''}</span><span>${ho.h != null ? `CG ${hText(ho.h)}` : 'no fit'}</span><button data-hist="${h.id}">CSV</button></li>`;
    }).join('');
    setHtml('stHist', hist || '<li class="empty">No finished runs yet.</li>');
  }

  // For the charts (tests.js): finished releases, the one recording now, and the run's target
  const data = () => ({ run, work, rec, analyse, target: (work || run)?.target ?? opt.target });
  return Object.assign(api, { handle, onLink, isOpen: () => open, close: hide, data, level: () => null, refresh: () => open && render() });
}
