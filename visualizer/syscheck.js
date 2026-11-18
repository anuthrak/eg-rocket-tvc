// Tests → System check: a guided ~5 minute check of every part, with nothing rewired. The IMU stays on its breadboard
// (you pick the breadboard up when asked) and the EDF stays clamped to the desk.
//   1 Power and link   firmware version, config, calibration stream rate, gyro rates present, ESC start-up tune (you)
//   2 IMU still        5 s untouched: tilt noise, gyro offset and noise, resting lean
//   3 IMU axes         tilt toward +X, then +Y: right axis, right sign, gyro agrees with the accelerometer
//   4 Servos           SWEEP CIRCLE + CORNERS: both finish, reach their range, no Nano reset; smooth (you)
//   5 Control loop     flight mode, tilt by hand: the gimbal follows the lean on both axes; it moved (you)
//   6 Motor            ARM, 10 → 20 → 30 %: reaches each step, holds it; spins and blows out the tail (you)
//   7 Motor + servos   25 % then a sweep: no reset, no gaps in the data, vibration level; servos smooth (you)
//   8 Safety cuts      Space stops the motor (timed), tilting past 25° makes the Nano cut it (timed from the last crossing)
// Motor safety is the firmware's (85 % cap, ramp limit, 0.5 s link watchdog, 25° tilt cut, cut on mode change) plus a
// stop on Stop / Space / Esc, leaving the tab, hiding the page or losing the link. Needs firmware v1.9.0+ for the motor
// steps; gyro checks need v1.12.0 (skipped, not failed, on older firmware).

const $ = id => document.getElementById(id);
const HEARTBEAT_MS = 150, REPLY_MS = 2500;
const KEY_CUR = 'tvc-syscheck-current', KEY_HIST = 'tvc-syscheck-history', HIST_MAX = 20;
const ABORT = Symbol('abort');
const STEPS = [
  ['link', 'Power and link'], ['still', 'IMU still'], ['axes', 'IMU axes'], ['servo', 'Servos'],
  ['loop', 'Control loop'], ['motor', 'Motor'], ['both', 'Motor + servos'], ['cuts', 'Safety cuts'],
];
const LABEL = { pass: 'Pass', warn: 'Check', fail: 'Fail', skip: 'Skipped', run: 'Running', '': '' };

function load(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function store(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }
const stamp = t => {
  const d = new Date(t), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const mean = a => a.reduce((s, v) => s + v, 0) / (a.length || 1);
const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) ** 2))); };
const sg = (v, d = 1) => { const t = Math.abs(v).toFixed(d); return +t === 0 ? t : `${v >= 0 ? '+' : '−'}${t}`; };
const fwAtLeast = (fw, min) => {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(fw || '');
  if (!m) return false;
  const v = m.slice(1).map(Number);
  for (let i = 0; i < 3; i++) if (v[i] !== min[i]) return v[i] > min[i];
  return true;
};
const overall = run => {
  const s = Object.values(run?.res || {}).map(r => r.status);
  return !s.length ? null : s.includes('fail') ? 'fail' : s.includes('warn') ? 'warn' : 'pass';
};
function summary(run) {
  const lines = [`System check, ${stamp(run.t)} · firmware v${run.fw}`];
  STEPS.forEach(([id, name], i) => { const r = run.res[id]; if (r) lines.push(`${i + 1} ${name}: ${LABEL[r.status].toUpperCase()} · ${r.detail}`); });
  const o = overall(run);
  lines.push(`Overall: ${o === 'pass' ? 'all pass' : o === 'warn' ? 'pass, with checks to look at' : 'FAIL'}`);
  return lines.join('\n');
}
function csv(run) {
  const q = s => `"${String(s).replace(/"/g, '""')}"`;
  return ['step,name,status,detail', ...STEPS.filter(([id]) => run.res[id]).map(([id, name], i) => `${STEPS.findIndex(s => s[0] === id) + 1},${q(name)},${run.res[id].status},${q(run.res[id].detail)}`)].join('\n') + '\n';
}
function download(run) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv(run)], { type: 'text/csv' }));
  a.download = `system_check_${stamp(run.t).replace(' ', '_').replace(':', '')}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function initSysCheck({ send, link }) {
  const panel = $('scPanel');
  let open = false;
  // ---------- Telemetry (every line, via bench.js's 'tvc:line') ----------
  let cfg = null, calOn = false, resets = 0, lastErr = '';
  let armed = false, act = null, lastThr = 0, cut = null, sweepDone = 0;
  const cal = [], fl = [];                  // recent CAL samples / flight samples (15 s)
  const spg = ax => (ax === 'x' ? cfg?.spg : cfg?.spgy) || 4;
  document.addEventListener('tvc:line', ({ detail: line }) => {
    const now = performance.now(), p = line.split(',');
    if (/firmware v\d|Calibrating gyro/i.test(line)) resets++;
    if (p[0] === 'CFG') cfg = { xc: +p[1], yc: +p[2], xd: +p[3], yd: +p[4], tx: +p[5], ty: +p[6], spg: +p[7], spgy: p.length >= 13 ? +p[12] : +p[7] };
    else if (p[0] === 'CAL' && p[1] === 'ON') calOn = true;
    else if (p[0] === 'CAL' && p[1] === 'OFF') calOn = false;
    else if (p[0] === 'CAL' && p.length >= 5 && cfg) {
      calOn = true;
      cal.push({ t: now, sx: +p[1] - cfg.xc, sy: +p[2] - cfg.yc, tx: +p[3] - cfg.tx, ty: +p[4] - cfg.ty, rx: p.length >= 7 ? +p[5] : null, ry: p.length >= 7 ? +p[6] : null });
      while (cal.length && now - cal[0].t > 15000) cal.shift();
    } else if (p[0] === 'THR' && p[1] === 'CUT') { armed = false; act = 0; cut = { why: p[2], t: now }; onCut(p[2]); }
    else if (p[0] === 'THR' && p.length >= 5) { armed = p[1] === 'ARMED'; act = +p[3]; lastThr = now; }
    else if (p[0] === 'SWEEP' && p[1] === 'DONE') sweepDone = now;
    else if (p[0] === 'ERR') lastErr = line;
    else if (!/^[A-Z]+,/.test(line)) {
      const v = p.map(Number);
      if (v.length >= 5 && v.slice(0, 5).every(Number.isFinite)) {
        const dx = cfg?.xd || 1, dy = cfg?.yd || 1;
        fl.push({ t: now, tx: v[3], ty: v[4], gx: (v[1] - 90) * dx / spg('x'), gy: (v[2] - 90) * dy / spg('y') });
        while (fl.length && now - fl[0].t > 15000) fl.shift();
      }
    }
    if (open) soon();
  });
  let rafPending = false;
  function soon() { if (rafPending) return; rafPending = true; requestAnimationFrame(() => { rafPending = false; render(); }); }

  // ---------- Run state ----------
  let phase = 'idle';                       // idle | running | done | stopped
  let cur = null, res = {}, prompt = '', live = '', meter = null, buttons = [], note = '', noteWarn = false;
  let want = 0, beat = 0, aborted = false, cancelers = [], answer = null, spaceWait = null, expectCut = false, copied = 0;
  let run = load(KEY_CUR, null);
  let history = load(KEY_HIST, []);

  const wait = ms => new Promise((ok, no) => {
    if (aborted) { no(ABORT); return; }
    const c = () => { clearTimeout(t); no(ABORT); };
    const t = setTimeout(() => { cancelers = cancelers.filter(x => x !== c); ok(); }, ms);
    cancelers.push(c);
  });
  async function until(test, ms, what) {
    const t0 = performance.now();
    while (!test()) {
      if (!link().port) throw new Error('Link lost.');
      if (performance.now() - t0 > ms) throw new Error(what);
      await wait(40);
    }
  }
  // Ask with buttons: resolves to the clicked button's value
  function ask(text, opts) {
    prompt = text; buttons = opts; meter = null; render();
    return new Promise((ok, no) => {
      if (aborted) { no(ABORT); return; }
      answer = v => { answer = null; buttons = []; ok(v); };
      cancelers.push(() => { answer = null; no(ABORT); });
    });
  }
  function say(text, extra = {}) { prompt = text; buttons = extra.buttons || []; meter = extra.meter ?? null; render(); }
  const setRes = (id, status, detail) => { res[id] = { status, detail }; render(); };
  const recent = (buf, ms) => { const now = performance.now(); return buf.filter(s => now - s.t <= ms); };
  function setThr(p) { want = p; send(`THR ${p}`); }
  function startBeat() { clearInterval(beat); beat = setInterval(() => { if (armed) send(`THR ${want}`, true); }, HEARTBEAT_MS); }
  function motorOff() { want = 0; if (link().port) { send('THR 0'); send('DISARM'); } }
  async function armMotor() {
    send('ARM'); startBeat();
    await until(() => armed, REPLY_MS, 'No reply to ARM (needs firmware v1.9.0+, and calibration mode).');
  }
  async function reach(p) {
    setThr(p);
    const t0 = performance.now();
    await until(() => armed && act != null && act >= p - 0.5, 5000, `The throttle did not reach ${p} %.`);
    return performance.now() - t0;
  }
  async function toCal() {
    if (calOn && recent(cal, 300).length) return;
    send('CAL');
    await until(() => calOn && recent(cal, 200).length > 0, 3000, 'The Nano did not enter calibration mode.');
  }
  function onCut(why) {
    if (phase !== 'running') return;
    if (expectCut) { expectCut = false; return; }
    stop(`The Nano cut the motor (${why === 'LINK' ? 'it stopped hearing this page' : why === 'TILT' ? 'the breadboard leaned past 25°' : 'mode change'}).`, true);
  }

  // ---------- Steps ----------
  const S = {};
  S.link = async () => {
    if (!cfg) { send('GET'); await until(() => cfg, 6000, 'No config from the Nano. Is it still booting? Wait 5 s and run again.'); }
    await toCal();
    await wait(1100);
    const hz = recent(cal, 1000).length, fw = link().fw;
    const rates = cal.at(-1)?.rx != null;
    const tune = await ask('Did the ESC play its start-up tune (beeps, then a short tune) when you turned the 12 V on?',
      [{ l: 'Yes', v: 'yes', primary: true }, { l: 'No, it was silent', v: 'no' }, { l: '12 V not on yet', v: 'off' }]);
    const parts = [`firmware v${fw}`, `${hz} Hz`, rates ? 'gyro rates yes' : 'no gyro rates (v1.12.0)'];
    if (tune === 'no') setRes('link', 'fail', parts.join(' · ') + ' · ESC silent: re-seat the three motor bullets (a loose phase wire means no tune)');
    else if (tune === 'off') setRes('link', 'warn', parts.join(' · ') + ' · turn the 12 V on before the motor steps');
    else setRes('link', hz >= (rates ? 40 : 15) && fwAtLeast(fw, [1, 9, 0]) ? 'pass' : 'warn', parts.join(' · ') + ' · ESC tune OK' + (fwAtLeast(fw, [1, 9, 0]) ? '' : ' · motor steps need v1.9.0+'));
  };
  S.still = async () => {
    say('Put the breadboard down and don\'t touch it or the desk.', { meter: 0 });
    await wait(1000);
    const t0 = performance.now();
    while (performance.now() - t0 < 5000) { meter = (performance.now() - t0) / 5000; render(); await wait(100); }
    const s = recent(cal, 5000);
    if (s.length < 20) throw new Error('Too few samples from the Nano.');
    const tn = Math.max(sd(s.map(x => x.tx)), sd(s.map(x => x.ty)));
    const lean = `resting lean X ${sg(mean(s.map(x => x.tx)))}° Y ${sg(mean(s.map(x => x.ty)))}°`;
    if (s[0].rx == null) { setRes('still', tn <= 0.3 ? 'pass' : tn <= 0.6 ? 'warn' : 'fail', `tilt noise ${tn.toFixed(2)}° · ${lean} · gyro not checked (v1.12.0)`); return; }
    const off = Math.max(Math.abs(mean(s.map(x => x.rx))), Math.abs(mean(s.map(x => x.ry))));
    const gn = Math.max(sd(s.map(x => x.rx)), sd(s.map(x => x.ry)));
    const st = tn <= 0.3 && off <= 1 && gn <= 0.5 ? 'pass' : tn <= 0.6 && off <= 2 && gn <= 1 ? 'warn' : 'fail';
    setRes('still', st, `tilt noise ${tn.toFixed(2)}° · gyro offset ${off.toFixed(2)}°/s · gyro noise ${gn.toFixed(2)}°/s · ${lean}` +
      (off > 1 ? ' · large offset: keep it still for the 5 s after power-up (gyro calibration)' : ''));
  };
  S.axes = async () => {
    const out = [];
    let bad = false;
    for (const ax of ['X', 'Y']) {
      const k = ax === 'X' ? 'tx' : 'ty', o = ax === 'X' ? 'ty' : 'tx', r = ax === 'X' ? 'rx' : 'ry';
      const base = recent(cal, 500), b = mean(base.map(x => x[k])), bo = mean(base.map(x => x[o]));
      const t0 = performance.now();
      let skipped = false;
      say(`Tilt the breadboard about 20° toward +${ax} and hold it there. (+${ax} is the side you tilted toward in Calibrate → Sensor.)`,
        { buttons: [{ l: 'Skip', v: 'skip' }] });
      answer = () => { skipped = true; };
      // Held: lean past 12° on either axis for 0.5 s
      await until(() => {
        if (skipped) return true;
        const h = recent(cal, 500);
        return h.length >= 10 && h.every(x => Math.max(Math.abs(x.tx - (ax === 'X' ? b : bo)), Math.abs(x.ty - (ax === 'X' ? bo : b))) > 12);
      }, 30000, `Not tilted within 30 s (axis ${ax}).`);
      answer = null;
      if (skipped) { out.push(`${ax} skipped`); continue; }
      const h = recent(cal, 500), d = mean(h.map(x => x[k])) - b, dOther = mean(h.map(x => x[o])) - bo;
      let msg;
      if (Math.abs(dOther) > Math.abs(d)) { msg = `+${ax} showed up on ${ax === 'X' ? 'Y' : 'X'}: X and Y swapped (redo Calibrate → Sensor)`; bad = true; }
      else if (d < 0) { msg = `+${ax} read ${sg(d, 0)}°: sign reversed (redo Calibrate → Sensor)`; bad = true; }
      else msg = `+${ax} read ${sg(d, 0)}°`;
      // Gyro agrees: the integral of the rate over the move ≈ the change in tilt
      const mv = cal.filter(x => x.t >= t0 && x[r] != null);
      if (mv.length > 5) {
        let integ = 0;
        for (let i = 1; i < mv.length; i++) integ += mv[i][r] * (mv[i].t - mv[i - 1].t) / 1000;
        const ratio = integ / d;
        msg += ratio > 0.7 && ratio < 1.3 ? ', gyro agrees' : `, gyro saw ${sg(integ, 0)}° (${ratio < 0 ? 'opposite sign' : 'mismatch'})`;
        if (!(ratio > 0.7 && ratio < 1.3)) bad = bad || ratio < 0;
      }
      out.push(msg);
      say('Put it back down flat.');
      await until(() => { const h2 = recent(cal, 500); return h2.length >= 10 && h2.every(x => Math.abs(x.tx - (ax === 'X' ? b : bo)) < 5 && Math.abs(x.ty - (ax === 'X' ? bo : b)) < 5); }, 30000, 'Not back flat within 30 s.');
    }
    setRes('axes', out.every(m => m.includes('skipped')) ? 'skip' : bad ? 'fail' : out.some(m => m.includes('mismatch') || m.includes('skipped')) ? 'warn' : 'pass', out.join(' · '));
  };
  S.servo = async () => {
    await toCal();
    const r0 = resets, t0 = performance.now();
    for (const m of ['CIRCLE', 'CORNERS']) {
      say(`Sweep: ${m === 'CIRCLE' ? 'circle' : 'corner to corner'}. Watch both servos.`);
      const t = performance.now();
      send(`SWEEP ${m}`);
      await until(() => sweepDone > t, 7000, `The ${m.toLowerCase()} sweep did not finish (needs firmware v1.7.0+).`);
    }
    const s = cal.filter(x => x.t >= t0);
    const want = { x: Math.min(8 * spg('x'), 45), y: Math.min(8 * spg('y'), 45) };
    const got = { x: Math.max(...s.map(x => Math.abs(x.sx))), y: Math.max(...s.map(x => Math.abs(x.sy))) };
    const ok = got.x >= want.x * 0.9 && got.y >= want.y * 0.9;
    const smooth = await ask('Did both servos move smoothly through the whole range, with no binding, buzzing or stalling?',
      [{ l: 'Yes', v: 'yes', primary: true }, { l: 'No', v: 'no' }]);
    const reset = resets > r0;
    setRes('servo', reset || smooth === 'no' ? 'fail' : ok ? 'pass' : 'warn',
      `servo travel X ±${got.x.toFixed(0)}° Y ±${got.y.toFixed(0)}° (expected ±${want.x.toFixed(0)}° / ±${want.y.toFixed(0)}°)` +
      (reset ? ' · the Nano RESET during the sweep: servo current is browning out the supply' : '') + (smooth === 'no' ? ' · not smooth: check the linkages' : ''));
  };
  S.loop = async () => {
    send('RUN');
    await until(() => recent(fl, 300).length > 0, 3000, 'No flight telemetry after RUN.');
    const t0 = performance.now();
    let done = false;
    // Each direction reached, and enough samples in the 2–8° band on each axis to fit the response
    const cover = () => {
      const s = fl.filter(x => x.t >= t0), band = k => s.filter(x => Math.abs(x[k]) > 2 && Math.abs(x[k]) < 8).length >= 20;
      return { xp: s.some(x => x.tx > 5), xm: s.some(x => x.tx < -5), yp: s.some(x => x.ty > 5), ym: s.some(x => x.ty < -5), fx: band('tx'), fy: band('ty') };
    };
    say('Tilt the breadboard slowly about 10–15° each way: toward +X, −X, +Y and −Y (stay under 20°). The gimbal should follow.',
      { buttons: [{ l: 'Done tilting', v: 'done', primary: true }, { l: 'Skip', v: 'skip' }] });
    let skipped = false;
    answer = v => { if (v === 'skip') skipped = true; done = true; };
    await until(() => { const c = cover(); live = `Covered: ${c.xp ? '+X ✓' : '+X'}  ${c.xm ? '−X ✓' : '−X'}  ${c.yp ? '+Y ✓' : '+Y'}  ${c.ym ? '−Y ✓' : '−Y'}${c.xp && c.xm && c.yp && c.ym && !(c.fx && c.fy) ? ' · a bit more, slowly' : ''}`; return done || (c.xp && c.xm && c.yp && c.ym && c.fx && c.fy); }, 90000, 'Not finished within 90 s.');
    answer = null; live = '';
    if (skipped) { await toCal(); setRes('loop', 'skip', 'skipped'); return; }
    const s = fl.filter(x => x.t >= t0);
    const fit = (a, g) => {
      const pts = s.filter(x => Math.abs(x[a]) < 8).map(x => [x[a], x[g]]);
      if (pts.filter(p => Math.abs(p[0]) > 2).length < 10) return null;
      const mx = mean(pts.map(p => p[0])), my = mean(pts.map(p => p[1]));
      let sxy = 0, sxx = 0, syy = 0;
      for (const [x, y] of pts) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
      return sxx && syy ? { k: sxy / sxx, r: sxy / Math.sqrt(sxx * syy) } : null;
    };
    const fx = fit('tx', 'gx'), fy = fit('ty', 'gy');
    const ok = f => f && f.k > 0.05 && f.r > 0.6;
    const moved = await ask('Did the gimbal visibly move each time you tilted the breadboard?', [{ l: 'Yes', v: 'yes', primary: true }, { l: 'No', v: 'no' }]);
    await toCal();
    const d = f => (f ? `${f.k.toFixed(2)} gimbal°/lean° (r ${f.r.toFixed(2)})` : 'not enough tilt');
    setRes('loop', ok(fx) && ok(fy) && moved === 'yes' ? 'pass' : !fx || !fy ? 'warn' : 'fail',
      `X ${d(fx)} · Y ${d(fy)}` + (moved === 'no' ? ' · gimbal did not move: servo power or signal wires' : ''));
  };
  let motorSkipped = false;
  S.motor = async () => {
    motorSkipped = false;
    if (!fwAtLeast(link().fw, [1, 9, 0])) { motorSkipped = true; setRes('motor', 'skip', 'needs firmware v1.9.0+'); return; }
    const go = await ask('Motor steps next. EDF clamped to the desk, intake and outlet clear, the 12 V plug or supply switch within reach, eye protection on, 12 V on?',
      [{ l: 'Ready: spin it', v: 'go', primary: true }, { l: 'Skip the motor steps', v: 'skip' }]);
    if (go === 'skip') { motorSkipped = true; setRes('motor', 'skip', 'skipped'); return; }
    await toCal();
    say('Arming…');
    await armMotor();
    const parts = [];
    for (const p of [10, 20, 30]) {
      say(`${p} %: spinning up, then holding 1.5 s.`);
      const tr = await reach(p);
      await wait(1500);
      const h = [];
      const t0 = performance.now();
      while (performance.now() - t0 < 1000) { if (act != null) h.push(act); await wait(100); }
      parts.push(`${p} % in ${(tr / 1000).toFixed(1)} s, held ${mean(h).toFixed(0)} %`);
    }
    setThr(0);
    await until(() => act === 0, 3000, 'The throttle did not come back to 0.');
    const spin = await ask('Did the fan spin up at each step and blow out the back (tail side)?',
      [{ l: 'Yes', v: 'yes', primary: true }, { l: 'It blows the wrong way', v: 'rev' }, { l: 'It didn\'t spin', v: 'no' }]);
    setRes('motor', spin === 'yes' ? 'pass' : 'fail', parts.join(' · ') +
      (spin === 'rev' ? ' · blows the wrong way: swap any two of the three motor wires' : spin === 'no' ? ' · no spin: ESC signal (D3) and ground, motor bullets, 12 V' : ''));
  };
  S.both = async () => {
    if (motorSkipped) { setRes('both', 'skip', 'motor steps skipped'); return; }
    if (!armed) await armMotor();
    const r0 = resets;
    say('25 %: holding 2 s with the servos still, then a sweep with the motor on.');
    await reach(25);
    await wait(1500);
    let t0 = performance.now();
    await wait(2000);
    const quiet = cal.filter(x => x.t >= t0);
    t0 = performance.now();
    send('SWEEP CIRCLE');
    await until(() => sweepDone > t0, 7000, 'The sweep did not finish with the motor on.');
    const swept = cal.filter(x => x.t >= t0);
    setThr(0);
    await until(() => act === 0, 3000, 'The throttle did not come back to 0.');
    let gap = 0;
    const all = cal.filter(x => x.t >= quiet[0]?.t);
    for (let i = 1; i < all.length; i++) gap = Math.max(gap, all[i].t - all[i - 1].t);
    const vib = s => (s[0]?.rx != null ? `${Math.sqrt(sd(s.map(x => x.rx)) ** 2 + sd(s.map(x => x.ry)) ** 2).toFixed(1)}°/s` : `${Math.max(sd(s.map(x => x.tx)), sd(s.map(x => x.ty))).toFixed(2)}° tilt`);
    const smooth = await ask('With the motor on, did the servos move smoothly (no twitching or jitter)?', [{ l: 'Yes', v: 'yes', primary: true }, { l: 'No, they jittered', v: 'no' }]);
    const reset = resets > r0;
    setRes('both', reset || gap > 300 ? 'fail' : smooth === 'no' ? 'warn' : 'pass',
      `vibration ${vib(quiet)} motor only, ${vib(swept)} with the sweep · longest data gap ${gap.toFixed(0)} ms` +
      (reset ? ' · the Nano RESET' : '') + (smooth === 'no' ? ' · servo jitter: add 470–1000 µF across the servo rails' : ''));
  };
  S.cuts = async () => {
    if (motorSkipped) { setRes('cuts', 'skip', 'motor steps skipped'); return; }
    const out = [];
    let fail = false;
    // (a) Space
    if (!armed) await armMotor();
    say('15 %: spinning up…');
    await reach(15);
    let tPress = 0;
    say('Press Space now.');
    await new Promise((ok, no) => { spaceWait = () => { tPress = performance.now(); spaceWait = null; ok(); }; cancelers.push(() => { spaceWait = null; no(ABORT); }); });
    await until(() => !armed || act === 0, 2000, 'The motor did not stop after Space.');
    const dSpace = performance.now() - tPress;
    out.push(`Space stop ${dSpace.toFixed(0)} ms`); if (dSpace > 500) fail = true;
    await wait(800);
    // (b) Tilt cut by the Nano
    say('Re-arming for the tilt cut…');
    await armMotor();
    await reach(15);
    say('Tip the breadboard past 25° toward +X or +Y (about a third of the way to on its side) and hold. The Nano should cut the motor.');
    expectCut = true; cut = null;
    const t0 = performance.now();
    try { await until(() => cut && cut.t > t0, 20000, 'no cut'); }
    catch (e) { if (e === ABORT) throw e; expectCut = false; motorOff(); out.push('tilt cut: NONE within 20 s'); fail = true; }
    if (cut && cut.t > t0) {
      // Time from the last crossing past 25° before the cut (the Nano needs 3 readings in a row, ~60 ms; dips back
      // under 25° restart its count, so timing from the first crossing would count your wobble too)
      const lean = x => Math.max(Math.abs(x.tx), Math.abs(x.ty));
      const before = cal.filter(x => x.t >= t0 && x.t <= cut.t);
      let k = before.length - 1;
      while (k > 0 && lean(before[k - 1]) > 25) k--;
      const tLean = before[k] && lean(before[k]) > 25 ? before[k].t : null;
      out.push(cut.why === 'TILT' ? `tilt cut ${tLean ? (cut.t - tLean).toFixed(0) + ' ms after 25°' : 'OK'}` : `cut (${cut.why}), not TILT`);
      if (cut.why !== 'TILT') fail = true;
    }
    say('Put it back down flat.');
    await until(() => { const h = recent(cal, 500); return h.length >= 10 && h.every(x => Math.abs(x.tx) < 10 && Math.abs(x.ty) < 10); }, 30000, 'Not back flat within 30 s.');
    setRes('cuts', fail ? 'fail' : 'pass', out.join(' · '));
  };

  // ---------- Sequencer ----------
  async function runAll() {
    res = {}; aborted = false; cancelers = []; phase = 'running'; note = ''; resets = 0;
    const t = Date.now(), fw = link().fw;
    for (const [id] of STEPS) {
      cur = id; render();
      try { await S[id](); }
      catch (e) {
        if (e === ABORT) return;
        motorOff();
        setRes(id, 'fail', e.message || String(e));
        if (!link().port) { stop('Link lost.', true); return; }
      }
      answer = null; spaceWait = null; live = ''; meter = null;
    }
    motorOff(); clearInterval(beat);
    cur = null; phase = 'done'; prompt = ''; buttons = [];
    run = { id: t, t, fw, res };
    store(KEY_CUR, run);
    history = [run, ...history.filter(h => h.id !== run.id)].slice(0, HIST_MAX);
    store(KEY_HIST, history);
    render();
  }
  function stop(msg, warn) {
    if (phase !== 'running') return;
    aborted = true;
    cancelers.forEach(c => c()); cancelers = [];
    motorOff(); clearInterval(beat);
    if (cur && !res[cur]) res[cur] = { status: 'fail', detail: msg };
    answer = null; spaceWait = null; expectCut = false;
    phase = 'stopped'; prompt = ''; buttons = []; live = ''; meter = null;
    note = msg + ' The motor is off.'; noteWarn = !!warn;
    render();
  }

  // ---------- Open / close (tests.js closes the other tests first) ----------
  function show() {
    open = true; panel.hidden = false; $('scBtn').classList.add('on');
    if (link().port && !cfg) send('GET');
    render();
  }
  function hide() {
    stop('Stopped: the check was closed.');
    open = false; panel.hidden = true; $('scBtn').classList.remove('on');
    if (calOn && link().port) send('RUN');
  }
  $('scBtn').onclick = () => (open ? hide() : show());
  $('scClose').onclick = hide;
  $('scKill').onclick = () => stop('Stopped by you.');
  $('scGo').onclick = () => { if (phase === 'running') stop('Stopped by you.'); else if (ready()) runAll(); };
  $('scActs').onclick = e => { const b = e.target.closest('[data-v]'); if (b && answer) answer(b.dataset.v); };
  $('scCsv').onclick = () => { if (run) download(run); };
  $('scCopy').onclick = async () => { try { await navigator.clipboard.writeText(summary(run) + '\n\n' + csv(run)); copied = Date.now(); render(); setTimeout(render, 1600); } catch {} };
  $('scHist').onclick = e => { const b = e.target.closest('[data-hist]'); const h = b && history.find(r => r.id === +b.dataset.hist); if (h) download(h); };
  document.addEventListener('keydown', e => {
    if (!open) return;
    if (e.key === 'Escape') { hide(); return; }
    if (e.code !== 'Space' || e.target.matches?.('input[type=text], textarea')) return;
    if (spaceWait) { e.preventDefault(); motorOff(); spaceWait(); return; }
    if (phase === 'running' && (armed || want)) { e.preventDefault(); stop('Stopped by you (Space).'); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop('Stopped: the page was hidden.', true); });
  document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => { if (open && b.dataset.tab !== 'tests') hide(); }));

  // ---------- Render ----------
  const ready = () => link().port && cfg && phase !== 'running';
  function setText(id, t) { const el = $(id); if (el.textContent !== t) el.textContent = t; }
  function render() {
    if (!open) return;
    const L = link();
    const msg = !L.port ? (L.demo ? 'The system check needs the real Arduino. Stop the demo and connect it.' : 'Connect the Arduino to run the system check (Nano on USB, then 12 V on).')
      : !cfg && phase !== 'running' ? 'Waiting for the Nano. It restarts when the port opens and takes about 5 s to boot (keep the breadboard still).' : '';
    setText('scMsg', msg); $('scMsg').hidden = !msg; $('scBody').hidden = !!msg && phase !== 'running' && !run;
    const running = phase === 'running';
    setText('scState', running ? 'Running' : phase === 'stopped' ? 'Stopped' : phase === 'done' ? 'Done' : 'All parts');
    $('scState').className = armed ? 'bad' : '';
    $('scKill').hidden = !(armed || want);
    // Current step
    const i = STEPS.findIndex(s => s[0] === cur);
    setText('scNowNum', running && i >= 0 ? `${i + 1} / ${STEPS.length}` : '');
    setText('scNowName', running && i >= 0 ? STEPS[i][1] : phase === 'done' ? 'Finished' : phase === 'stopped' ? 'Stopped' : 'Ready');
    setText('scPrompt', running ? prompt : phase === 'stopped' ? 'Stopped before the end. Sort out what it found, then Run again.' : phase === 'done' ? (overall(run) === 'pass' ? 'Every step passed.' : 'Done. Look at the steps marked Check or Fail below.')
      : 'About 5 minutes. Keep the IMU on its breadboard and the EDF clamped to the desk; the check tells you when to pick the breadboard up. Power-up order: Nano on USB, connect, then 12 V on.');
    // Live readout
    const c = recent(cal, 300).at(-1), f = recent(fl, 300).at(-1);
    const lean = c ? `Lean X ${sg(c.tx)}° Y ${sg(c.ty)}°` : f ? `Lean X ${sg(f.tx)}° Y ${sg(f.ty)}° · gimbal X ${sg(f.gx)}° Y ${sg(f.gy)}°` : '';
    setText('scLive', running ? [live, lean, armed ? `Throttle ${act ?? 0} %` : ''].filter(Boolean).join(' · ') : '');
    $('scMeter').hidden = meter == null;
    if (meter != null) $('scMeterBar').style.width = (meter * 100).toFixed(0) + '%';
    const bh = buttons.map(b => `<button data-v="${b.v}"${b.primary ? ' class="primary"' : ''}>${b.l}</button>`).join('');
    if ($('scActs').innerHTML !== bh) $('scActs').innerHTML = bh;
    // Step list
    const shown = running || phase === 'stopped' ? res : run?.res || {};
    const rows = STEPS.map(([id, name], k) => {
      const r = shown[id], st = running && id === cur && !r ? 'run' : r?.status || '';
      return `<li class="sc-${st || 'todo'}"><span class="sc-n">${k + 1}</span><span class="sc-name">${name}</span><span class="sc-st">${LABEL[st]}</span>${r?.detail ? `<span class="sc-d">${r.detail}</span>` : ''}</li>`;
    }).join('');
    if ($('scList').innerHTML !== rows) $('scList').innerHTML = rows;
    setText('scGo', running ? 'Stop' : run || phase === 'stopped' ? 'Run again' : 'Start check');
    $('scGo').disabled = !running && !ready();
    $('scGo').classList.toggle('primary', !running);
    $('scCsv').disabled = $('scCopy').disabled = !run || running;
    setText('scCopy', Date.now() - copied < 1500 ? 'Copied ✓' : 'Copy summary');
    setText('scNote', note); $('scNote').classList.toggle('cal-warn', noteWarn && !!note);
    setText('scMeta', run && !running ? `Last check ${stamp(run.t)} · firmware v${run.fw}` : '');
    const hh = history.map(h => { const o = overall(h); return `<li><span>${stamp(h.t)}</span><span class="${o === 'pass' ? 'ok' : o === 'fail' ? 'bad' : ''}">${o === 'pass' ? 'All pass' : o === 'warn' ? 'Checks' : 'Fail'}</span><button data-hist="${h.id}">CSV</button></li>`; }).join('') || '<li class="empty">No finished checks yet.</li>';
    if ($('scHist').innerHTML !== hh) $('scHist').innerHTML = hh;
  }

  const level = () => (!open ? null : armed && act != null && performance.now() - lastThr < 1000 ? act / 85 : 0);
  return { isOpen: () => open, close: hide, level, refresh: () => open && render() };
}
