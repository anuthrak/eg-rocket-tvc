// Bench → Gimbal → Laser: the CT-1 laser gimbal-accuracy test (firmware v1.8.0+, GIM command).
// A laser on the motor tube marks each commanded angle on a wall. For each axis the gimbal steps
// -8 → +8 (up) then +8 → -8 (down) in 2° steps; you type the dot's signed distance from the zero mark
// and it becomes atan(mm / wall distance). Pass: max |measured − commanded| ≤ 1° and max up/down
// difference (backlash) ≤ 1° per axis. Runs are kept in this browser and download as CSV
// (axis,cmd_deg,meas_deg,dir — the same format as tests/ct1_laser_gimbal/laser_log.py).

const $ = id => document.getElementById(id);
const MIN_FW = [1, 8, 0];
const SEQ = [-8, -6, -4, -2, 0, 2, 4, 6, 8, 8, 6, 4, 2, 0, -2, -4, -6, -8];   // first 9 up, last 9 down
const N = SEQ.length, HALF = 9;
const SETTLE_MS = 600, REPLY_MS = 4000;
const LIMIT_ERR = 1.0, LIMIT_BACKLASH = 1.0;
const KEY_CUR = 'tvc-laser-current', KEY_HIST = 'tvc-laser-history', HIST_MAX = 20;
const dirOf = i => (i < HALF ? 'up' : 'down');

// ---------- Storage (this browser only; a download is the real record) ----------
function load(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function store(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }

// ---------- Results ----------
function axisStats(meas) {
  if (!meas || meas.some(v => v == null)) return null;
  let err = 0, back = 0;
  for (let i = 0; i < N; i++) err = Math.max(err, Math.abs(meas[i] - SEQ[i]));
  for (let i = 0; i < HALF; i++) back = Math.max(back, Math.abs(meas[i] - meas[N - 1 - i]));   // same command, up vs down
  return { err, back, pass: err <= LIMIT_ERR + 1e-9 && back <= LIMIT_BACKLASH + 1e-9 };
}
function verdict(run) {
  const s = ['X', 'Y'].map(a => axisStats(run.meas[a]));
  if (s.every(v => !v)) return null;
  return s.every(v => v && v.pass) ? 'PASS' : s.some(v => v && !v.pass) ? 'FAIL' : 'PART';
}
function csv(run) {
  const rows = ['axis,cmd_deg,meas_deg,dir'];
  for (const a of ['X', 'Y']) {
    const m = run.meas[a];
    if (!m || m.some(v => v == null)) continue;
    m.forEach((v, i) => rows.push(`${a},${SEQ[i]},${v.toFixed(2)},${dirOf(i)}`));
  }
  return rows.join('\n') + '\n';
}
const stamp = t => {
  const d = new Date(t), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
function summary(run) {
  const c = run.cfg;
  const lines = [
    `CT-1 laser gimbal test, ${stamp(run.t)}`,
    `Firmware v${run.fw} · wall ${run.dist} mm`,
    c ? `Calibration: XC ${c.xc} YC ${c.yc} · XD ${c.xd > 0 ? '+1' : '-1'} YD ${c.yd > 0 ? '+1' : '-1'} · SPG ${c.spg} · SWAP ${c.swap} (${c.state})` : '',
  ];
  for (const a of ['X', 'Y']) {
    const s = axisStats(run.meas[a]);
    lines.push(s ? `Axis ${a}: max error ${s.err.toFixed(2)}° (≤ ${LIMIT_ERR}) · backlash ${s.back.toFixed(2)}° (≤ ${LIMIT_BACKLASH}) · ${s.pass ? 'PASS' : 'FAIL'}`
                 : `Axis ${a}: not tested`);
  }
  const v = verdict(run);
  lines.push(`Overall: ${v === 'PART' ? 'incomplete (one axis)' : v ?? 'not tested'}`);
  return lines.filter(Boolean).join('\n');
}
function download(run) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv(run)], { type: 'text/csv' }));
  a.download = `t2_gimbal_${stamp(run.t).replace(' ', '_').replace(':', '')}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function initLaser({ send, link, calib }) {
  const panel = $('lzPanel');
  let open = false, tab = 0;
  let cfg = null, calOn = false;
  // The test being run. meas[axis] = 18 measured angles (deg) or null.
  const newRun = () => ({ id: Date.now(), t: Date.now(), dist: run?.dist || 1000, fw: '', cfg: null, meas: { X: null, Y: null } });
  let run = null;
  run = load(KEY_CUR, null);
  if (!run?.meas) run = newRun();
  let history = load(KEY_HIST, []);
  // Live state of a running axis
  let axis = 'X';
  let phase = 'idle';      // idle | pre (going to 0) | moving | settling | ready | done | error
  let idx = 0, redo = false, note = '', copied = 0;
  let work = null;         // the axis being measured; replaces run.meas[axis] only once all 18 points are in
  let settleTimer = 0, replyTimer = 0;
  let mmText = '';
  let distMsg = null;      // { text, warn } after the distance field is edited

  $('lzDist').value = run.dist;

  // ---------- Firmware lines ----------
  function handle(line) {
    const p = line.split(',');
    if (p[0] === 'CFG' && p.length >= 10) {
      cfg = { xc: +p[1], yc: +p[2], xd: +p[3], yd: +p[4], spg: +p[7], swap: +p[8], state: p[9] };
      if (open && !calOn) send('CAL');
    } else if (p[0] === 'CAL' && p[1] === 'ON') calOn = true;
    else if (p[0] === 'CAL' && p[1] === 'OFF') { calOn = false; if (open) send('CAL'); }   // e.g. Calibrate just closed
    else if (p[0] === 'CAL' && p.length >= 5) calOn = true;
    else if (p[0] === 'GIM') arrived();
    else if (p[0] === 'ERR' && ['pre', 'moving'].includes(phase)) fail(`The Nano said "${line}". This test needs firmware v1.8.0 or newer.`);
    if (open) render();
  }
  function onLink() {
    cfg = null; calOn = false;
    if (phase !== 'idle' && phase !== 'done') { stopTimers(); phase = 'idle'; note = 'Link lost. That axis was stopped; start it again.'; }
    if (open) render();
  }

  // ---------- Moving the gimbal ----------
  function stopTimers() { clearTimeout(settleTimer); clearTimeout(replyTimer); }
  function gim(x, y) {
    send(`GIM ${x} ${y}`);
    clearTimeout(replyTimer);
    replyTimer = setTimeout(() => fail('No reply from the Nano. This test needs firmware v1.8.0 or newer (firmware/nano_tvc).'), REPLY_MS);
  }
  function fail(msg) { stopTimers(); phase = 'error'; note = msg; render(); }
  function goPoint(i) {
    idx = i; phase = 'moving'; redo = false; mmText = '';
    const c = SEQ[i];
    if (axis === 'X') gim(c, 0); else gim(0, c);
    render();
  }
  function arrived() {
    clearTimeout(replyTimer);
    if (phase === 'pre') { goPoint(0); return; }
    if (phase !== 'moving') return;
    phase = 'settling';
    settleTimer = setTimeout(() => { phase = 'ready'; render(); focusInput(); }, SETTLE_MS);
  }
  function focusInput() { if (open && tab === 1) setTimeout(() => $('lzMm').focus(), 0); }

  function start(a) {
    if (!calOn) return;
    axis = a;
    if (run.meas.X == null && run.meas.Y == null) { run.t = Date.now(); run.fw = link().fw; run.cfg = cfg && { ...cfg }; }
    commitDist();
    work = Array(N).fill(null);
    note = ''; phase = 'pre';
    gim(0, 0);   // from the centre, then out to -8: the limit stops us approaching -8 from below
    render();
  }
  function stop() {
    stopTimers();
    if (phase !== 'idle' && phase !== 'done') send('GIM 0 0');
    phase = 'idle'; note = 'Stopped. Nothing from that run was kept.'; redo = false; work = null;
    render();
  }

  const degFromMm = mm => Math.round(Math.atan(mm / run.dist) * 180 / Math.PI * 100) / 100;
  const parseMm = () => {
    const t = mmText.trim().replace('−', '-').replace(',', '.');
    if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
    return Number(t);
  };
  function record() {
    const mm = parseMm();
    if (phase !== 'ready' || mm == null) return;
    const deg = degFromMm(mm);
    if (redo) { work[idx - 1] = deg; redo = false; mmText = ''; render(); focusInput(); return; }
    work[idx] = deg;
    if (idx + 1 < N) { goPoint(idx + 1); return; }
    // Axis done: back to centre and keep it
    send('GIM 0 0');
    run.meas[axis] = work; work = null;
    phase = 'done'; note = '';
    archive();
    render();
  }
  function startRedo() { if (phase === 'ready' && idx > 0) { redo = !redo; mmText = ''; render(); focusInput(); } }

  function save() { store(KEY_CUR, run); }
  // Every finished axis also updates this test's entry in the history
  function archive() {
    history = history.filter(h => h.id !== run.id);
    history.unshift(JSON.parse(JSON.stringify(run)));
    history = history.slice(0, HIST_MAX);
    store(KEY_HIST, history);
    save();
  }
  function newTest() {
    stopTimers(); phase = 'idle'; note = ''; redo = false;
    run = newRun(); distMsg = null; save();
    tab = 0; render();
  }

  // ---------- Open / close ----------
  function show() {
    if (calib.isOpen()) { calib.close(); if (calib.isOpen()) return; }   // unsaved calibration: let that panel ask first
    open = true;
    panel.hidden = false;
    $('lzBtn').classList.add('on');
    if (cfg && !calOn) send('CAL');
    else if (link().port && !cfg) send('GET');
    render();
  }
  function hide() {
    if (phase !== 'idle' && phase !== 'done' && phase !== 'error') stop();
    stopTimers();
    open = false;
    panel.hidden = true;
    $('lzBtn').classList.remove('on');
    if (calOn) send('RUN');   // back to flight mode; RUN also centres and ends GIM
    calOn = false;
    if (phase !== 'idle') phase = 'idle';
  }
  $('lzBtn').onclick = () => (open ? hide() : show());
  $('lzClose').onclick = hide;
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && open) hide(); });

  function go(t) { tab = Math.max(0, Math.min(2, t)); render(); if (tab === 1 && phase === 'ready') focusInput(); }
  panel.querySelectorAll('#lzTabs button').forEach(b => { b.onclick = () => go(+b.dataset.tab); });
  $('lzBack').onclick = () => go(tab - 1);
  $('lzNext').onclick = () => (tab === 2 ? hide() : go(tab + 1));

  // Setup
  // Wall distance. It is fixed for a test once an axis has been measured with it (the angles depend on it),
  // and the field never quietly rewrites what was typed: a bad entry is explained and the old value kept.
  const DIST_MIN = 200, DIST_MAX = 5000;
  const distLocked = () => running() || !!(run.meas.X || run.meas.Y);
  function checkDist(text) {
    const t = String(text).trim().replace(',', '.');
    if (!t) return { err: 'Type the distance in mm.' };
    if (!/^\d+(\.\d*)?$/.test(t)) return { err: 'Numbers only, in mm.' };
    const v = Number(t);
    if (v > 0 && v < 20) return { err: `That looks like metres. Type it in mm: ${t} m = ${Math.round(v * 1000)} mm.` };
    if (v < DIST_MIN || v > DIST_MAX) return { err: `Use ${DIST_MIN}–${DIST_MAX} mm (1000 mm is ideal).` };
    return { v: Math.round(v) };
  }
  function commitDist() {
    if (distLocked()) return;
    const c = checkDist($('lzDist').value);
    if (c.err) { distMsg = { text: `${c.err} Still using ${run.dist} mm.`, warn: true }; $('lzDist').value = run.dist; }
    else { run.dist = c.v; save(); distMsg = { text: `✓ Saved: ${run.dist} mm. Used for every point in this test.`, warn: false }; }
    render();
  }
  $('lzDist').oninput = () => {
    const c = checkDist($('lzDist').value);
    distMsg = c.err ? { text: c.err, warn: true } : { text: `Press Enter or click away to use ${c.v} mm.`, warn: false };
    render();
  };
  $('lzDist').onchange = commitDist;
  $('lzDist').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); $('lzDist').blur(); } };
  $('lzCentre').onclick = () => { if (phase === 'idle' || phase === 'done' || phase === 'error') { phase = 'idle'; send('GIM 0 0'); } };
  $('lzShowX').onclick = () => { if (phase === 'idle' || phase === 'done' || phase === 'error') { phase = 'idle'; send('GIM 8 0'); } };
  $('lzShowY').onclick = () => { if (phase === 'idle' || phase === 'done' || phase === 'error') { phase = 'idle'; send('GIM 0 8'); } };
  // Measure
  panel.querySelectorAll('[data-lzaxis]').forEach(b => {
    b.onclick = () => { if (phase === 'idle' || phase === 'done' || phase === 'error') { axis = b.dataset.lzaxis; phase = 'idle'; note = ''; render(); } };
  });
  $('lzStart').onclick = () => (['pre', 'moving', 'settling', 'ready'].includes(phase) ? stop() : start(axis));
  $('lzMm').oninput = e => { mmText = e.target.value; render(); };
  $('lzMm').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); record(); } };
  $('lzRec').onclick = record;
  $('lzRedo').onclick = startRedo;
  // Results
  $('lzCsv').onclick = () => download(run);
  $('lzCopy').onclick = async () => {
    try { await navigator.clipboard.writeText(summary(run) + '\n\n' + csv(run)); copied = Date.now(); render(); setTimeout(render, 1600); } catch {}
  };
  $('lzNew').onclick = newTest;
  $('lzHist').onclick = e => {
    const b = e.target.closest('[data-hist]');
    if (!b) return;
    const h = history.find(r => r.id === +b.dataset.hist);
    if (h) download(h);
  };

  // ---------- Render ----------
  const DASH = '—';
  const sdeg = v => (v == null || !Number.isFinite(v) ? DASH : (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + '°');
  const fwOld = fw => {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(fw || '');
    if (!m) return false;
    const v = m.slice(1).map(Number);
    for (let i = 0; i < 3; i++) if (v[i] !== MIN_FW[i]) return v[i] < MIN_FW[i];
    return false;
  };
  function setText(id, t) { const el = $(id); if (el.textContent !== t) el.textContent = t; }
  const running = () => ['pre', 'moving', 'settling', 'ready'].includes(phase);

  function render() {
    if (!open) return;
    const L = link();
    let msg = '';
    if (!L.port) msg = L.demo ? 'The laser test needs the real Arduino. Stop the demo and connect it.' : 'Connect the Arduino to run the laser test.';
    else if (fwOld(L.fw)) msg = `Firmware v${L.fw} can't run the laser test. Upload firmware v1.8.0 or newer (firmware/nano_tvc).`;
    else if (!cfg) msg = 'Waiting for the Nano. It restarts when the port opens and takes about 5 s to boot (keep the rocket still).';
    // Results stay readable offline
    $('lzMsg').textContent = msg;
    $('lzMsg').hidden = !msg || tab === 2;
    $('lzBody').hidden = !!msg && tab !== 2;

    const v = verdict(run);
    setText('lzState', v === 'PASS' ? 'Pass' : v === 'FAIL' ? 'Fail' : v === 'PART' ? '1 of 2 axes' : 'CT-1');
    $('lzState').className = v === 'PASS' ? 'ok' : v === 'FAIL' ? 'bad' : '';
    panel.querySelectorAll('#lzTabs button').forEach(b => b.classList.toggle('active', +b.dataset.tab === tab));
    $('lzTabs').querySelector('[data-tab="1"]').classList.toggle('done', v === 'PASS' || v === 'FAIL');
    panel.querySelectorAll('.lz-step').forEach(s => { s.hidden = +s.dataset.tab !== tab; });
    $('lzBack').disabled = tab === 0;
    setText('lzNext', tab === 2 ? 'Close' : 'Next');

    // Setup
    const idle = !running();
    const locked = distLocked();
    $('lzDist').disabled = locked;
    if (document.activeElement !== $('lzDist') && $('lzDist').value !== String(run.dist)) $('lzDist').value = run.dist;
    const ds = locked ? { text: `Locked at ${run.dist} mm: this test was measured with it. To change it, press New test on the Results tab.`, warn: false }
      : distMsg || { text: `Using ${run.dist} mm.`, warn: false };
    setText('lzDistSt', ds.text);
    $('lzDistSt').classList.toggle('cal-warn', ds.warn);
    ['lzCentre', 'lzShowX', 'lzShowY'].forEach(id => { $(id).disabled = !idle || !calOn; });
    if (cfg) {
      setText('lzCfg', `SPG ${cfg.spg} · centres ${cfg.xc}°/${cfg.yc}°`);
      setText('lzCfgWarn', cfg.state === 'UNSAVED' ? 'The calibration has unsaved changes. The test measures what is on the Nano now. Save it in Calibrate first so the result matches flight.'
        : cfg.state === 'DEFAULT' ? 'Nothing is saved on the Nano yet, so this tests the default calibration. Run Calibrate and save first.' : '');
    }

    // Measure: axis picker
    panel.querySelectorAll('[data-lzaxis]').forEach(b => {
      const a = b.dataset.lzaxis, s = axisStats(run.meas[a]);
      b.classList.toggle('active', a === axis);
      b.disabled = !idle;
      b.querySelector('small').textContent = s ? (s.pass ? '✓ Pass' : '✗ Fail') : 'Not run';
      b.querySelector('small').className = s ? (s.pass ? 'ok' : 'bad') : '';
    });
    setText('lzStart', running() ? 'Stop' : run.meas[axis] && axisStats(run.meas[axis]) ? `Run ${axis} again` : `Start ${axis}`);
    $('lzStart').classList.toggle('primary', !running());
    $('lzStart').disabled = !calOn && !running();

    // Progress dots: 9 up, 9 down
    const m = running() ? work : run.meas[axis];
    $('lzDots').querySelectorAll('i').forEach((d, i) => {
      const val = m?.[i];
      d.className = val == null ? '' : Math.abs(val - SEQ[i]) <= LIMIT_ERR ? 'ok' : 'bad';
      if (running() && i === (redo ? idx - 1 : idx)) d.classList.add('cur');
      d.title = `${SEQ[i] > 0 ? '+' : ''}${SEQ[i]}° ${dirOf(i)}` + (val == null ? '' : ` → ${sdeg(val)}`);
    });

    // Prompt
    const shown = redo ? idx - 1 : idx, c = SEQ[shown];
    const cmdTxt = `${axis} ${c > 0 ? '+' : c < 0 ? '−' : ''}${Math.abs(c)}°`;
    const prompts = {
      idle: run.meas[axis] && axisStats(run.meas[axis]) ? `Axis ${axis} done` : `Ready for axis ${axis}`,
      pre: 'Moving to the start…', moving: `Moving to ${cmdTxt}…`, settling: `${cmdTxt} · settling…`,
      ready: redo ? `Re-measure ${cmdTxt}` : `Mark the dot · ${cmdTxt}`, done: `Axis ${axis} done`, error: 'Stopped',
    };
    setText('lzPrompt', prompts[phase]);
    $('lzPrompt').classList.toggle('dim', phase === 'moving' || phase === 'settling' || phase === 'pre');
    const other = axis === 'X' ? 'Y' : 'X';
    const subs = {
      idle: run.meas[axis] && axisStats(run.meas[axis]) ? '' : `Pivot to wall: ${run.dist} mm. Centre the gimbal, check the zero mark, then press Start ${axis}. It steps −8° → +8° (up), then back down to −8°: 18 points.`,
      pre: '', moving: '', settling: '',
      ready: redo ? `Type the distance for the mark you made at point ${shown + 1} (the gimbal has moved on).`
        : `Point ${idx + 1} of ${N} · going ${dirOf(idx)} · wall ${run.dist} mm. Mark the dot, measure from the zero mark along ${axis} (+ is the side the dot went for +8°), type mm, press Enter.`,
      done: axisStats(run.meas[other]) ? 'Both axes done. See Results.' : `Now axis ${other}: pick it above and press Start ${other}.`,
      error: '',
    };
    setText('lzSub', note || subs[phase]);
    $('lzSub').classList.toggle('cal-warn', phase === 'error' || !!note && phase !== 'done');

    // Entry
    const ready = phase === 'ready';
    $('lzEntry').classList.toggle('off', !ready);
    $('lzMm').disabled = !ready;
    if ($('lzMm').value !== mmText) $('lzMm').value = mmText;
    const mm = parseMm(), deg = mm == null ? null : degFromMm(mm);
    setText('lzDeg', deg == null ? DASH : sdeg(deg));
    setText('lzErr', deg == null ? '' : `error ${sdeg(deg - c)}`);
    $('lzErr').className = deg == null ? '' : Math.abs(deg - c) <= LIMIT_ERR ? 'ok' : 'bad';
    // Sign check: a negative command puts the dot on the − side. Warn (don't block) when the typed sign disagrees.
    const wrongSign = ready && mm != null && c !== 0 && Math.abs(deg) >= 0.3 && Math.sign(deg) !== Math.sign(c);
    setText('lzSign', wrongSign ? `${c < 0 ? 'Negative' : 'Positive'} command, so the dot should be on the ${c < 0 ? '−' : '+'} side. Forgot the ${c < 0 ? 'minus' : 'sign'}? Check, then Enter anyway if it really is.` : '');
    $('lzRec').disabled = !ready || mm == null;
    setText('lzRec', redo ? 'Replace' : idx === N - 1 ? 'Record & finish' : 'Record & next');
    $('lzRedo').disabled = !ready || idx === 0;
    setText('lzRedo', redo ? 'Cancel redo' : 'Redo last point');

    // Results table
    const rows = [];
    for (let i = 0; i < HALF; i++) {
      const cmd = SEQ[i], cells = [`<td>${cmd > 0 ? '+' : cmd < 0 ? '−' : ''}${Math.abs(cmd)}°</td>`];
      for (const a of ['X', 'Y']) {
        const mm2 = run.meas[a], up = mm2?.[i], dn = mm2?.[N - 1 - i];
        const cls = v => (v == null ? '' : Math.abs(v - cmd) <= LIMIT_ERR ? '' : ' class="bad"');
        cells.push(`<td${cls(up)}>${up == null ? DASH : sdeg(up)}</td><td${cls(dn)}>${dn == null ? DASH : sdeg(dn)}</td>`);
      }
      rows.push(`<tr>${cells.join('')}</tr>`);
    }
    const tb = rows.join('');
    if ($('lzRows').innerHTML !== tb) $('lzRows').innerHTML = tb;
    for (const a of ['X', 'Y']) {
      const s = axisStats(run.meas[a]);
      setText(`lzE${a}`, s ? sdeg(s.err).replace('+', '') : DASH);
      setText(`lzB${a}`, s ? sdeg(s.back).replace('+', '') : DASH);
      setText(`lzV${a}`, s ? (s.pass ? 'Pass' : 'Fail') : 'Not run');
      $(`lzE${a}`).className = s && s.err > LIMIT_ERR ? 'bad' : '';
      $(`lzB${a}`).className = s && s.back > LIMIT_BACKLASH ? 'bad' : '';
      $(`lzV${a}`).className = 'cal-res ' + (s ? (s.pass ? 'ok' : 'bad') : '');
    }
    setText('lzOverall', v === 'PASS' ? 'PASS: both axes within 1°' : v === 'FAIL' ? 'FAIL: see the red values' : v === 'PART' ? 'One axis done. Run the other one too.' : 'No axis measured yet.');
    $('lzOverall').className = 'lz-overall ' + (v === 'PASS' ? 'ok' : v === 'FAIL' ? 'bad' : '');
    setText('lzMeta', run.fw ? `${stamp(run.t)} · firmware v${run.fw} · wall ${run.dist} mm` : '');
    $('lzCsv').disabled = $('lzCopy').disabled = !v;
    setText('lzCopy', Date.now() - copied < 1500 ? 'Copied ✓' : 'Copy summary');
    $('lzNew').disabled = running();

    const hist = history.map(h => {
      const hv = verdict(h);
      const ax = ['X', 'Y'].map(a => { const s = axisStats(h.meas[a]); return `${a} ${s ? (s.pass ? '✓' : '✗') : '–'}`; }).join(' ');
      return `<li><span>${stamp(h.t)}</span><span class="${hv === 'PASS' ? 'ok' : hv === 'FAIL' ? 'bad' : ''}">${ax}</span><button data-hist="${h.id}">CSV</button></li>`;
    }).join('');
    const hh = hist || '<li class="empty">No finished runs yet.</li>';
    if ($('lzHist').innerHTML !== hh) $('lzHist').innerHTML = hh;
  }

  return { handle, onLink, isOpen: () => open, close: hide, refresh: () => open && render() };
}
