// Tests → Thrust vector: the CT-5 motor + gimbal test (firmware v1.12.0+: ARM / THR / GIM, gyro rates in CAL lines).
// The rocket sits on the rig pivot at its centre of mass, so a gimbal angle under thrust turns it. No scale needed:
// the IMU measures the result. At each throttle level:
//   hold  gimbal centred for HOLD_MS: vibration (gyro rms) and drift (angular acceleration with no command,
//         i.e. the thrust line misses the pivot, or the rocket isn't balanced)
//   kicks +X, −X, +Y, −Y: gimbal ±kick for PULSE_MS, then the opposite for PULSE_MS (so the rocket ends up stopped),
//         then centre and wait. The slope of the body rate during each half is the angular acceleration.
//   authority = −(α − α0) / gimbal°   (°/s² per gimbal °; positive = the gimbal pushes the way the controller expects:
//         gimbal +X answers a lean toward +X, so it must turn the rocket back toward −X)
//   trim  between kicks the page holds the rocket upright with a gentle PD loop on the gimbal (GIM at 50 Hz, gains
//         scaled down as the measured authority grows); the mean gimbal angle it settles at during the hold is the
//         trim, the angle that cancels the drift. (Clamped: no loop, no trim.)
//   relative thrust = authority / authority at the top level (authority ∝ thrust × lever arm ÷ inertia)
// Safety: the firmware's (85 % cap, ramp limit, 0.5 s link watchdog, 25° tilt cut, cut on mode change) plus a stop
// here past 12° lean or 90°/s, on Stop / Space / Esc, leaving the tab, hiding the page or losing the link.

const $ = id => document.getElementById(id);
const MIN_FW = [1, 12, 0];
const HEARTBEAT_MS = 150, REPLY_MS = 2000, RAMP_MS = 5000;
const SETTLE_MS = 1500, HOLD_MS = 2000, GAP_MS = 1200, SKIP_MS = 80;
const LEAN_MAX = 12, RATE_MAX = 90;
const AUTH_MIN = 1.0;   // °/s² per gimbal °: below this the kicks didn't measurably turn the rocket (noise)
const KP_S = 1.0, KD_S = 0.25, STAB_MAX = 4, AUTH_REF = 15;   // stabiliser: gimbal ° per lean ° and per °/s, at authority AUTH_REF
const KICKS = [['X', 1], ['X', -1], ['Y', 1], ['Y', -1]];
const KEY_CUR = 'tvc-vector-current', KEY_HIST = 'tvc-vector-history', KEY_OPT = 'tvc-vector-options', HIST_MAX = 20;
const ABORT = Symbol('abort');

function load(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function store(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }
const stamp = t => {
  const d = new Date(t), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const mean = a => a.reduce((s, v) => s + v, 0) / (a.length || 1);
// Least-squares slope of v against t (ms → per second). null with too few points.
function slope(pts) {
  if (pts.length < 4) return null;
  const mt = mean(pts.map(p => p.t)), mv = mean(pts.map(p => p.v));
  let num = 0, den = 0;
  for (const p of pts) { num += (p.t - mt) * (p.v - mv); den += (p.t - mt) ** 2; }
  return den ? num / den * 1000 : null;
}
const f = (v, d = 1) => (v == null || !Number.isFinite(v) ? '' : v.toFixed(d));

// ---------- One level's numbers from its recorded samples ----------
export function analyse(lv, kick) {
  const hold = lv.samples.filter(s => s.ph === 'hold');
  const a0 = { X: slope(hold.map(s => ({ t: s.t, v: s.rx }))), Y: slope(hold.map(s => ({ t: s.t, v: s.ry }))) };
  const mx = mean(hold.map(s => s.rx)), my = mean(hold.map(s => s.ry));
  const vib = hold.length ? Math.sqrt(mean(hold.map(s => (s.rx - mx) ** 2 + (s.ry - my) ** 2))) : null;
  const est = { X: [], Y: [] };
  for (const k of lv.kicks) {
    const key = k.axis === 'X' ? 'rx' : 'ry';
    for (const half of k.halves) {
      const pts = lv.samples.filter(s => s.t >= half.t0 + SKIP_MS && s.t <= half.t1).map(s => ({ t: s.t, v: s[key] }));
      const a = slope(pts);
      if (a == null || a0[k.axis] == null) continue;
      half.alpha = a;
      est[k.axis].push(-(a - a0[k.axis]) / (half.deg));
    }
  }
  // Clamped (no pivot loop): the rocket can't turn, so authority, trim and relative thrust mean nothing; vibration only.
  // On the pivot, an authority inside the noise is "no response", not a number to divide by.
  const real = v => (lv.stab && v != null && Math.abs(v) >= AUTH_MIN ? v : null);
  const auth = { X: real(est.X.length ? mean(est.X) : null), Y: real(est.Y.length ? mean(est.Y) : null) };
  // Stabilised hold: the mean gimbal is the trim. Without the loop, estimate it from the drift.
  const trim = lv.stab && hold.length ? { X: mean(hold.map(s => s.gx)), Y: mean(hold.map(s => s.gy)) } : { X: null, Y: null };
  return { a0, vib, auth, trim, kick };
}
export function relThrust(run) {
  const top = run.levels.at(-1);
  const at = r => (r?.auth.X != null && r?.auth.Y != null ? (r.auth.X + r.auth.Y) / 2 : r?.auth.X ?? r?.auth.Y ?? null);
  const ref = at(top?.res);
  return run.levels.map(l => { const a = at(l.res); return a != null && ref ? a / ref : null; });
}
function csv(run) {
  const rows = ['throttle_pct,authority_x_dps2_per_deg,authority_y_dps2_per_deg,trim_x_deg,trim_y_deg,drift_x_dps2,drift_y_dps2,vibration_dps_rms,rel_thrust,spec_rel_thrust,mount,kick_deg,pulse_ms'];
  const rel = relThrust(run), top = run.levels.at(-1)?.pct;
  run.levels.forEach((l, i) => {
    const r = l.res; if (!r) return;
    rows.push([l.pct, f(r.auth.X, 2), f(r.auth.Y, 2), f(r.trim.X, 2), f(r.trim.Y, 2), f(r.a0.X, 2), f(r.a0.Y, 2), f(r.vib, 2),
      f(rel[i], 3), f(top ? (l.pct / top) ** 2 : null, 3), run.mount, run.kick, run.pulse].join(','));
  });
  return rows.join('\n') + '\n';
}
function samplesCsv(run) {
  const rows = ['throttle_pct,phase,t_ms,gimbal_x_deg,gimbal_y_deg,tilt_x_deg,tilt_y_deg,rate_x_dps,rate_y_dps,throttle_actual_pct'];
  for (const l of run.levels) for (const s of l.samples)
    rows.push([l.pct, s.ph, Math.round(s.t - run.t0), f(s.gx, 2), f(s.gy, 2), f(s.tx, 2), f(s.ty, 2), f(s.rx, 1), f(s.ry, 1), f(s.thr, 0)].join(','));
  return rows.join('\n') + '\n';
}
const dirOk = (run, ax) => {
  const v = run.levels.map(l => l.res?.auth[ax]).filter(x => x != null);
  return run.mount !== 'pivot' || !v.length ? null : v.every(x => x > 0) ? 'ok' : v.every(x => x < 0) ? 'rev' : 'mixed';
};
function summary(run) {
  const rel = relThrust(run);
  const lines = [`CT-5 thrust vector, ${stamp(run.t)}`, `Firmware v${run.fw} · ${run.mount === 'pivot' ? 'on the pivot' : 'clamped'} · kick ${run.kick}° × ${run.pulse} ms`];
  run.levels.forEach((l, i) => {
    const r = l.res; if (!r) return;
    lines.push(`${String(l.pct).padStart(3)} %  authority X ${f(r.auth.X, 1) || '—'} Y ${f(r.auth.Y, 1) || '—'} °/s²/°  trim X ${f(r.trim.X, 2) || '—'} Y ${f(r.trim.Y, 2) || '—'}°  vibration ${f(r.vib, 1)} °/s  rel. thrust ${f(rel[i], 2) || '—'}`);
  });
  const dx = dirOk(run, 'X'), dy = dirOk(run, 'Y');
  if (run.mount === 'pivot') lines.push(`Direction X ${dx === 'ok' ? 'OK' : dx === 'rev' ? 'REVERSED' : dx ?? '—'} · Y ${dy === 'ok' ? 'OK' : dy === 'rev' ? 'REVERSED' : dy ?? '—'}`);
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
  let armed = false, fwAct = null, lastThr = 0;
  let checks = [false, false, false, false, false];
  let opt = { mount: 'pivot', levels: [30, 40, 50], kick: 2, pulse: 400, ...load(KEY_OPT, {}) };
  let phase = 'idle';                      // idle | arming | running | done | error
  let stepLabel = '', stepIdx = -1, want = 0, gim = { x: 0, y: 0 }, lean = 0;
  let note = '', noteWarn = false, copied = 0;
  let beat = 0, cancelers = [], aborted = false;
  let rec = null;                          // { lv, ph } while recording
  let stab = false, gain = 1;              // stabiliser on (pivot, between kicks), its gain scale
  let run = load(KEY_CUR, null);
  if (!Array.isArray(run?.levels)) run = null;
  let history = load(KEY_HIST, []);
  let work = null;

  // ---------- Firmware lines ----------
  function handle(line) {
    const p = line.split(',');
    if (p[0] === 'CFG') { cfg = { xc: +p[1], yc: +p[2], xd: +p[3], yd: +p[4], tx: +p[5], ty: +p[6], spg: +p[7], spgy: p.length >= 13 ? +p[12] : +p[7] }; if (open && !calOn) send('CAL'); }
    else if (p[0] === 'CAL' && p[1] === 'ON') calOn = true;
    else if (p[0] === 'CAL' && p[1] === 'OFF') { calOn = false; if (open && phase !== 'running') send('CAL'); }
    else if (p[0] === 'CAL' && p.length >= 5) {
      calOn = true; hasRates = p.length >= 7;
      if (cfg) {
        const tx = +p[3] - cfg.tx, ty = +p[4] - cfg.ty, rx = +p[5], ry = +p[6];
        lean = Math.max(Math.abs(tx), Math.abs(ty));
        if (rec && hasRates) rec.lv.samples.push({ t: performance.now(), ph: rec.ph, gx: gim.x, gy: gim.y, tx, ty, rx, ry, thr: fwAct });
        if (phase === 'running' && stab && hasRates) {
          const c = v => Math.max(-STAB_MAX, Math.min(STAB_MAX, v));
          setGim(c(gain * (KP_S * tx + KD_S * rx)), c(gain * (KP_S * ty + KD_S * ry)));
        }
        if (phase === 'running' && opt.mount === 'pivot') {
          if (lean > LEAN_MAX) abort(`Stopped: the rocket leaned ${lean.toFixed(0)}° (limit ${LEAN_MAX}°). Smaller kicks or shorter kicks, or re-balance it on the pivot.`);
          else if (hasRates && Math.max(Math.abs(rx), Math.abs(ry)) > RATE_MAX) abort(`Stopped: the rocket turned faster than ${RATE_MAX}°/s. Use a smaller kick.`);
        }
      }
    } else if (p[0] === 'THR' && p[1] === 'CUT') {
      const why = { LINK: 'the Nano stopped hearing this page (0.5 s)', TILT: 'the rocket leaned past 25°', MODE: 'the Nano changed mode' }[p[2]] || p[2];
      armed = false;
      if (phase === 'running' || phase === 'arming') abort(`Motor cut by the Nano: ${why}.`, true);
    } else if (p[0] === 'THR' && p.length >= 5) {
      armed = p[1] === 'ARMED'; fwAct = +p[3]; lastThr = performance.now();
      if (!armed && phase === 'running') abort('Stopped: the motor was disarmed.', true);
    } else if (p[0] === 'ERR' && (phase === 'running' || phase === 'arming')) abort(`The Nano said "${line}".`, true);
    if (open) render();
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
      await wait(40);
    }
  }
  function setGim(x, y) { gim = { x, y }; send(`GIM ${x.toFixed(2)} ${y.toFixed(2)}`, true); }
  function setThr(pct) { want = pct; send(`THR ${pct}`); }
  function startBeat() { clearInterval(beat); beat = setInterval(() => { if (armed || phase === 'arming') send(`THR ${want}`, true); }, HEARTBEAT_MS); }
  function stopBeat() { clearInterval(beat); beat = 0; }
  function setNote(t, warn) { note = t; noteWarn = !!warn; }

  async function sequence() {
    const levels = [...opt.levels].sort((a, b) => a - b);
    work = { id: Date.now(), t: Date.now(), t0: performance.now(), fw: link().fw, mount: opt.mount, kick: opt.kick, pulse: opt.pulse,
             levels: levels.map(pct => ({ pct, samples: [], kicks: [], res: null, stab: opt.mount === 'pivot' })) };
    gain = 1; stab = false;
    phase = 'arming'; setNote('', false); stepIdx = 0; render();
    want = 0; setGim(0, 0);
    send('ARM'); startBeat();
    await until(() => armed, REPLY_MS, 'No reply to ARM. Upload firmware v1.12.0 (firmware/nano_tvc).');
    phase = 'running';
    stab = opt.mount === 'pivot';
    for (const lv of work.levels) {
      stepLabel = `${lv.pct} % · spin up`; render();
      setThr(lv.pct);
      await until(() => fwAct != null && fwAct >= lv.pct - 0.5, RAMP_MS, 'The throttle did not reach its level.');
      stepLabel = `${lv.pct} % · settle`; render();
      await wait(SETTLE_MS);
      stepLabel = `${lv.pct} % · hold, gimbal centred`; render();
      rec = { lv, ph: 'hold' };
      await wait(HOLD_MS);
      stepIdx++;
      for (const [axis, sign] of KICKS) {
        const d = sign * opt.kick, name = `${sign > 0 ? '+' : '−'}${axis}`;
        stepLabel = `${lv.pct} % · kick ${name}`; render();
        const k = { axis, sign, halves: [] };
        lv.kicks.push(k);
        // Kick around where the stabiliser was holding (last 0.5 s), with the loop off
        const now = performance.now(), recent = lv.samples.filter(s => now - s.t < 500);
        const bx = recent.length ? mean(recent.map(s => s.gx)) : 0, by = recent.length ? mean(recent.map(s => s.gy)) : 0;
        stab = false;
        rec = { lv, ph: `kick${name}` };
        let t0 = performance.now();
        axis === 'X' ? setGim(bx + d, by) : setGim(bx, by + d);
        await wait(opt.pulse);
        k.halves.push({ t0, t1: performance.now(), deg: d });
        t0 = performance.now();
        axis === 'X' ? setGim(bx - d, by) : setGim(bx, by - d);
        await wait(opt.pulse);
        k.halves.push({ t0, t1: performance.now(), deg: -d });
        setGim(bx, by);
        stab = opt.mount === 'pivot';
        rec = { lv, ph: 'gap' };
        await wait(GAP_MS);
        stepIdx++;
      }
      rec = null;
      lv.res = analyse(lv, opt.kick);
      // Softer stabiliser at higher thrust: scale by the authority just measured
      const a = [lv.res.auth.X, lv.res.auth.Y].filter(v => v > 0);
      if (a.length) gain = Math.max(0.3, Math.min(1.5, AUTH_REF / mean(a)));
      render();
    }
    finish();
  }
  function finish() {
    rec = null; stab = false; want = 0; setGim(0, 0);
    send('THR 0'); send('DISARM'); stopBeat();
    armed = false; phase = 'done';
    run = work; work = null;
    store(KEY_CUR, run);
    history = [noSamples(run), ...history.filter(h => h.id !== run.id)].slice(0, HIST_MAX);
    store(KEY_HIST, history);
    setNote('Done: motor off, gimbal centred. See Results.', false);
    tab = 2; render();
  }
  // Past runs keep the results only; the raw samples stay with the current run (localStorage is small)
  const noSamples = r => ({ ...r, levels: r.levels.map(l => ({ ...l, samples: [] })) });

  function start() {
    if (!ready()) return;
    aborted = false; cancelers = [];
    sequence().catch(e => { if (e !== ABORT) abort(e.message || String(e), true); });
  }
  function abort(msg, warn = true) {
    if (phase !== 'running' && phase !== 'arming') { if (msg) setNote(msg, warn); return; }
    aborted = true;
    cancelers.forEach(c => c()); cancelers = [];
    rec = null; stab = false; want = 0;
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
  panel.querySelectorAll('[data-mount]').forEach(b => { b.onclick = () => { if (idle()) { opt.mount = b.dataset.mount; saveOpt(); } }; });
  panel.querySelectorAll('[data-lv]').forEach(b => { b.onclick = () => {
    if (!idle()) return;
    const v = +b.dataset.lv, has = opt.levels.includes(v);
    if (has && opt.levels.length === 1) return;
    opt.levels = has ? opt.levels.filter(x => x !== v) : [...opt.levels, v].sort((a, c) => a - c);
    saveOpt();
  }; });
  panel.querySelectorAll('[data-kick]').forEach(b => { b.onclick = () => { if (idle()) { opt.kick = +b.dataset.kick; saveOpt(); } }; });
  panel.querySelectorAll('[data-pulse]').forEach(b => { b.onclick = () => { if (idle()) { opt.pulse = +b.dataset.pulse; saveOpt(); } }; });
  $('vcGo').onclick = start;
  $('vcCsv').onclick = () => { if (run) download(`ct5_vector_${fileStamp(run)}.csv`, csv(run)); };
  $('vcCopy').onclick = async () => {
    try { await navigator.clipboard.writeText(summary(run) + '\n\n' + csv(run)); copied = Date.now(); render(); setTimeout(render, 1600); } catch {}
  };
  $('vcNew').onclick = () => { if (!idle()) return; phase = 'idle'; setNote('', false); tab = 0; render(); };
  $('vcHist').onclick = e => {
    const b = e.target.closest('[data-hist]');
    const h = b && history.find(r => r.id === +b.dataset.hist);
    if (h) download(`ct5_vector_${fileStamp(h)}.csv`, csv(h));
    const s = e.target.closest('[data-raw]');
    if (s && run) download(`ct5_vector_samples_${fileStamp(run)}.csv`, samplesCsv(run));
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
  const ready = () => calOn && hasRates && checks.every(Boolean) && idle();
  const totalSteps = () => opt.levels.length * (1 + KICKS.length);

  function render() {
    if (!open) return;
    const L = link();
    let msg = '';
    if (!L.port) msg = L.demo ? 'The thrust-vector test needs the real Arduino. Stop the demo and connect it.' : 'Connect the Arduino to run the thrust-vector test.';
    else if (fwOld(L.fw)) msg = `Firmware v${L.fw} doesn't send gyro rates in calibration mode. Upload firmware v1.12.0 or newer (firmware/nano_tvc).`;
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
    panel.querySelectorAll('[data-mount]').forEach(b => { b.classList.toggle('on', b.dataset.mount === opt.mount); b.disabled = busy; });
    panel.querySelectorAll('[data-lv]').forEach(b => { b.classList.toggle('on', opt.levels.includes(+b.dataset.lv)); b.disabled = busy; });
    panel.querySelectorAll('[data-kick]').forEach(b => { b.classList.toggle('on', +b.dataset.kick === opt.kick); b.disabled = busy; });
    panel.querySelectorAll('[data-pulse]').forEach(b => { b.classList.toggle('on', +b.dataset.pulse === opt.pulse); b.disabled = busy; });
    const secs = opt.levels.length * (2.5 + SETTLE_MS / 1000 + HOLD_MS / 1000 + KICKS.length * (2 * opt.pulse + GAP_MS) / 1000);
    setText('vcPlan', `${opt.levels.join(', ')} % · ${totalSteps()} steps · about ${Math.round(secs)} s with the motor on.` +
      (opt.mount === 'clamp' ? ' Clamped: the kicks still run (servos under load), but authority and trim need the pivot.' : ''));
    panel.querySelectorAll('#vcCheck input').forEach((c, i) => { c.checked = checks[i]; c.disabled = busy; });

    // Run
    setText('vcAct', armed && fwAct != null ? fwAct.toFixed(0) : DASH);
    setText('vcStep', busy ? `${Math.min(stepIdx + 1, totalSteps())} / ${totalSteps()}` : DASH);
    setText('vcGim', busy ? `${gim.x >= 0 ? '+' : ''}${gim.x.toFixed(1)}, ${gim.y >= 0 ? '+' : ''}${gim.y.toFixed(1)}` : DASH);
    setText('vcLean', calOn && cfg ? lean.toFixed(1) : DASH);
    const dots = $('vcDots');
    if (dots.childElementCount !== totalSteps()) dots.innerHTML = '<i></i>'.repeat(totalSteps());
    [...dots.children].forEach((d, i) => { d.className = busy ? (i < stepIdx ? 'ok' : i === stepIdx ? 'cur' : '') : phase === 'done' ? 'ok' : ''; });
    setText('vcPrompt', phase === 'arming' ? 'Arming…' : phase === 'running' ? stepLabel : phase === 'done' ? 'Done' : phase === 'error' ? 'Stopped' : 'Ready');
    setText('vcSub', busy ? 'Hands clear of the intake. Space or Stop motor ends it at once.'
      : !checks.every(Boolean) ? 'Tick the checklist on the Setup tab first.'
      : !hasRates ? 'Waiting for gyro rates from the Nano (firmware v1.12.0).'
      : 'Arm & start runs the whole sequence by itself. Keep a hand near the 12 V plug.');
    $('vcGo').disabled = !ready();
    setText('vcGo', busy ? 'Running…' : 'Arm & start');
    $('vcStop').disabled = !busy;
    setText('vcNote', note);
    $('vcNote').classList.toggle('cal-warn', noteWarn && !!note);

    // Results
    const r = run;
    const rel = r ? relThrust(r) : [];
    const cell = (v, d) => (v == null || !Number.isFinite(v) ? DASH : v.toFixed(d));
    const rows = r ? r.levels.filter(l => l.res).map((l, i) =>
      `<tr><td>${l.pct} %</td><td>${cell(l.res.auth.X, 1)}</td><td>${cell(l.res.auth.Y, 1)}</td><td>${cell(l.res.trim.X, 2)}</td><td>${cell(l.res.trim.Y, 2)}</td><td>${cell(l.res.vib, 1)}</td><td>${cell(rel[i], 2)}</td></tr>`).join('') : '';
    const tb = rows || `<tr><td colspan="7">${DASH}</td></tr>`;
    if ($('vcRows').innerHTML !== tb) $('vcRows').innerHTML = tb;
    const dx = r && dirOk(r, 'X'), dy = r && dirOk(r, 'Y');
    const dirTxt = d => (d === 'ok' ? 'OK' : d === 'rev' ? 'Reversed' : d === 'mixed' ? 'Unclear' : DASH);
    setText('vcDirX', dirTxt(dx)); setText('vcDirY', dirTxt(dy));
    $('vcDirX').className = dx === 'ok' ? 'ok' : dx ? 'bad' : '';
    $('vcDirY').className = dy === 'ok' ? 'ok' : dy ? 'bad' : '';
    const top = r?.levels.at(-1)?.res;
    setText('vcOverall', !r ? 'No run yet.' : r.mount !== 'pivot' ? `Clamped run: vibration ${cell(top?.vib, 1)} °/s rms at ${r.levels.at(-1).pct} %.`
      : dx === 'rev' || dy === 'rev' ? 'Gimbal pushes the wrong way on at least one axis: redo Calibrate → Direction.'
      : `Authority at ${r.levels.at(-1).pct} %: X ${cell(top?.auth.X, 1)}, Y ${cell(top?.auth.Y, 1)} °/s² per gimbal °.`);
    $('vcOverall').className = 'lz-overall' + (r && (dx === 'rev' || dy === 'rev') ? ' bad' : r ? ' ok' : '');
    setText('vcMeta', r ? `${stamp(r.t)} · firmware v${r.fw} · ${r.mount === 'pivot' ? 'pivot' : 'clamped'} · kick ${r.kick}° × ${r.pulse} ms` : '');
    $('vcCsv').disabled = $('vcCopy').disabled = !r;
    setText('vcCopy', Date.now() - copied < 1500 ? 'Copied ✓' : 'Copy summary');
    $('vcNew').disabled = busy;
    const hist = history.map(h => {
      const t = h.levels.at(-1)?.res;
      return `<li><span>${stamp(h.t)}</span><span>${t?.auth.X != null ? `X ${t.auth.X.toFixed(1)} · Y ${(t.auth.Y ?? 0).toFixed(1)} @ ${h.levels.at(-1).pct} %` : h.mount}</span><button data-hist="${h.id}">CSV</button></li>`;
    }).join('') + (run?.levels.some(l => l.samples.length) ? '<li><span>This run, every sample</span><span></span><button data-raw="1">CSV</button></li>' : '');
    const hh = hist || '<li class="empty">No finished runs yet.</li>';
    if ($('vcHist').innerHTML !== hh) $('vcHist').innerHTML = hh;
  }

  // For the charts (tests.js)
  const data = () => ({ run, work, busy: !idle(), gim, want, armed, fwAct });
  const level = () => (!open ? null : armed && fwAct != null && performance.now() - lastThr < 1000 ? fwAct / 85 : 0);
  return { handle, onLink, isOpen: () => open, close: hide, data, level, refresh: () => open && render() };
}
