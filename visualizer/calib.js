// Bench → Gimbal → Calibrate: a guided setup that drives the firmware's serial commands (firmware v1.2.0+).
// The Nano answers with CFG,… (its config) and, while in calibration, streams CAL,xServo,yServo,rawTiltX,rawTiltY.
// Everything is applied live on the Nano; SAVE writes it to EEPROM.
// Firmware v1.3.0+ also reports the sensor mounting (CFG …,up,rot): Level detects the up axis and the
// sensor step turns the sensor's X/Y to match the rocket with SET ROT instead of asking for a remount.

const $ = id => document.getElementById(id);
const MIN_FW = [1, 2, 0];
const STEPS = 5;

export function initCalib({ send, link }) {
  const panel = $('calPanel');
  let open = false, step = 0;
  let cfg = null;              // { xc, yc, xd, yd, tx, ty, spg, swap, state }
  let calOn = false;           // firmware confirmed CAL,ON
  let live = null;             // { xa, ya, rx, ry } from the last CAL line
  let levelBusy = false;
  let confirming = false;      // "unsaved changes" bar in the footer
  const sensor = { phase: 'x', x: null, y: null };   // results: 'ok' | 'rev' | 'cross'
  const dir = { x: null, y: null };                   // null | 'tested' | 'ok'
  const dirNote = { x: '', y: '' };

  // ---------- Firmware lines ----------
  function handle(line) {
    const p = line.split(',');
    if (p[0] === 'CFG' && p.length >= 10) {
      const n = p.slice(1, 9).map(Number);
      cfg = { xc: n[0], yc: n[1], xd: n[2], yd: n[3], tx: n[4], ty: n[5], spg: n[6], swap: n[7], state: p[9],
              up: p.length >= 12 ? +p[10] : null, rot: p.length >= 12 ? +p[11] : null };   // v1.3.0+
      levelBusy = false;
      if (open && !calOn) send('CAL');
    } else if (p[0] === 'CAL' && p[1] === 'ON') calOn = true;
    else if (p[0] === 'CAL' && p[1] === 'OFF') calOn = false;
    else if (p[0] === 'CAL' && p.length >= 5) {
      const [xa, ya, rx, ry] = p.slice(1, 5).map(Number);
      live = { xa, ya, rx, ry };
      calOn = true;
      trackSensor();
    }
    if (open) render();
  }

  // New link (or link lost): the Nano restarts when the port opens, so forget everything
  function onLink() {
    cfg = null; calOn = false; live = null; levelBusy = false;
    if (open) render();
  }

  // ---------- Open / close ----------
  function show() {
    open = true; confirming = false;
    panel.hidden = false;
    $('calBtn').classList.add('on');
    if (cfg && !calOn) send('CAL');
    else if (link().port && !cfg) send('GET');   // firmware already booted before we started listening
    render();
  }
  function hide() {
    open = false; confirming = false;
    panel.hidden = true;
    $('calBtn').classList.remove('on');
    if (calOn) send('RUN');
    calOn = false;
  }
  function requestClose() {
    if (cfg && cfg.state === 'UNSAVED' && link().port) { confirming = true; render(); }
    else hide();
  }
  $('calBtn').onclick = () => (open ? requestClose() : show());
  $('calClose').onclick = requestClose;
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && open) requestClose(); });
  $('calSaveExit').onclick = () => { send('SAVE'); hide(); };
  $('calDiscardExit').onclick = () => { send('LOAD'); hide(); };
  $('calKeep').onclick = () => { confirming = false; render(); };

  // ---------- Step navigation ----------
  function go(s) { step = Math.max(0, Math.min(STEPS - 1, s)); confirming = false; render(); }
  panel.querySelectorAll('#calSteps button').forEach(b => { b.onclick = () => go(+b.dataset.step); });
  $('calBack').onclick = () => go(step - 1);
  $('calNext').onclick = () => (step === STEPS - 1 ? requestClose() : go(step + 1));

  // ---------- Step 1: centre ----------
  panel.querySelectorAll('[data-nudge]').forEach(b => {
    b.onclick = () => {
      if (!cfg) return;
      const [key, d] = b.dataset.nudge.split(',');
      const k = key === 'XC' ? 'xc' : 'yc';
      cfg[k] = Math.max(45, Math.min(135, cfg[k] + Number(d)));   // optimistic, so fast clicks add up
      cfg.state = 'UNSAVED';
      send(`SET ${key} ${cfg[k]}`);
      render();
    };
  });
  $('calCenter90').onclick = () => {
    if (!cfg) return;
    cfg.xc = cfg.yc = 90; cfg.state = 'UNSAVED';
    send('SET XC 90'); send('SET YC 90');
    render();
  };

  // ---------- Step 2: level ----------
  $('calLevel').onclick = () => { if (!cfg) return; levelBusy = true; send('LEVEL'); render(); };

  // ---------- Step 3: sensor axes ----------
  // Tilt toward +X, back to upright, tilt toward +Y, back to upright. Whichever axis moves most is the one that answered.
  function trackSensor() {
    if (!open || step !== 2 || !cfg || !live) return;
    const tx = live.rx - cfg.tx, ty = live.ry - cfg.ty;
    const big = Math.max(Math.abs(tx), Math.abs(ty)), level = big < 4;
    const judge = (want, other) => (Math.abs(want) >= Math.abs(other) ? (want > 0 ? 'ok' : 'rev') : 'cross');
    if (sensor.phase === 'x' && big > 12) {
      sensor.x = judge(tx, ty);
      // v1.3.0+: the lean showed up at angle θ in the sensor's current X/Y, so turn the mapping by θ (90° steps)
      if (sensor.x !== 'ok' && cfg.rot != null) {
        const k = ((Math.round(Math.atan2(ty, tx) / (Math.PI / 2)) % 4) + 4) % 4;
        cfg.rot = (cfg.rot + k) % 4; cfg.state = 'UNSAVED';
        send(`SET ROT ${cfg.rot}`);
        sensor.x = null; sensor.phase = 'fixed';
        sensorNote = `Sensor turned ${k * 90}° to match the rocket. Back to upright, then check again.`;
        return;
      }
      sensor.phase = 'back1';
    }
    else if (sensor.phase === 'fixed' && level) sensor.phase = 'x';
    else if (sensor.phase === 'back1' && level) sensor.phase = 'y';
    else if (sensor.phase === 'y' && big > 12) { sensor.y = judge(ty, tx); sensor.phase = 'back2'; }
    else if (sensor.phase === 'back2' && level) sensor.phase = 'done';
  }
  let sensorNote = '';
  $('calSensorRestart').onclick = () => { sensor.phase = 'x'; sensor.x = sensor.y = null; sensorNote = ''; render(); };

  // ---------- Step 4: servo direction ----------
  for (const ax of ['x', 'y']) {
    const AX = ax.toUpperCase(), other = ax === 'x' ? 'y' : 'x';
    $(`calTest${AX}`).onclick = () => { send(`PULSE ${AX} 15`); dir[ax] = 'tested'; dirNote[ax] = ''; render(); };
    $(`calOk${AX}`).onclick = () => { dir[ax] = 'ok'; render(); };
    $(`calFlip${AX}`).onclick = () => {
      if (!cfg) return;
      const k = ax + 'd';
      cfg[k] = -cfg[k]; cfg.state = 'UNSAVED';
      send(`SET ${AX}D ${cfg[k]}`);
      dir[ax] = null; dirNote[ax] = 'Direction flipped. Test again to confirm.';
      render();
    };
    $(`calSwap${AX}`).onclick = () => {
      if (!cfg) return;
      cfg.swap = cfg.swap ? 0 : 1; cfg.state = 'UNSAVED';
      send(`SET SWAP ${cfg.swap}`);
      dir.x = dir.y = null;
      dirNote[ax] = 'Swapped which pin drives which axis. Test both servos again.';
      dirNote[other] = '';
      render();
    };
  }

  // ---------- Step 5: save ----------
  function setSpg(v) {
    v = Math.max(0.2, Math.min(8, Number(v) || 4));
    $('calSpg').value = v;
    if (!cfg) return;
    cfg.spg = v; cfg.state = 'UNSAVED';
    send(`SET SPG ${v}`);
    render();
  }
  $('calSpg').onchange = e => setSpg(e.target.value);
  // Linkage ratio from a laser: a 20° servo pulse moves the dot d at wall distance L → gimbal angle atan(d / L)
  const MEASURE_DEG = 20;
  function measured() {
    const L = Number($('cmDist').value), d = Number($('cmMove').value);
    if (!(L > 0 && d > 0)) return null;
    return Math.round(MEASURE_DEG / (Math.atan(d / L) * 180 / Math.PI) * 10) / 10;
  }
  $('cmDist').oninput = $('cmMove').oninput = () => render();
  $('cmTest').onclick = () => { if (cfg) send(`PULSE X ${MEASURE_DEG}`); };
  $('cmUse').onclick = () => { const r = measured(); if (r) setSpg(r); };
  $('calSave').onclick = () => send('SAVE');
  $('calRevert').onclick = () => send('LOAD');
  $('calDefaults').onclick = () => send('DEFAULTS');

  // ---------- Render ----------
  const DASH = '—';
  const sdeg = v => (v == null || !Number.isFinite(v) ? DASH : (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1) + '°');
  const fwOld = fw => {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(fw || '');
    if (!m) return false;
    const v = m.slice(1).map(Number);
    for (let i = 0; i < 3; i++) if (v[i] !== MIN_FW[i]) return v[i] < MIN_FW[i];
    return false;
  };
  function setText(id, t) { const el = $(id); if (el.textContent !== t) el.textContent = t; }
  function bar(id, v) {
    const k = Math.max(-1, Math.min(1, (v ?? 0) / 30)) * 50;
    const el = $(id);
    el.style.left = (k < 0 ? 50 + k : 50) + '%';
    el.style.width = Math.abs(k) + '%';
  }

  function render() {
    if (!open) return;
    const L = link();
    // Blocking message instead of the steps when we can't calibrate yet
    let msg = '';
    if (!L.port) msg = L.demo ? 'Calibration needs the real Arduino. Stop the demo and connect it.' : 'Connect the Arduino to calibrate the gimbal.';
    else if (fwOld(L.fw)) msg = `Firmware v${L.fw} can't be calibrated from here. Upload firmware v1.2.0 or newer (firmware/nano_tvc).`;
    else if (!cfg) msg = 'Waiting for the Nano. It restarts when the port opens and takes about 5 s to boot (keep the rocket still).';
    $('calMsg').textContent = msg;
    $('calMsg').hidden = !msg;
    $('calBody').hidden = $('calStepsWrap').hidden = !!msg;

    setText('calState', !cfg ? DASH : cfg.state === 'SAVED' ? 'Saved' : cfg.state === 'UNSAVED' ? 'Unsaved changes' : 'Defaults (not saved)');
    $('calState').className = cfg?.state === 'UNSAVED' ? 'warn' : '';

    panel.querySelectorAll('#calSteps button').forEach(b => b.classList.toggle('active', +b.dataset.step === step));
    panel.querySelectorAll('.cal-step').forEach(s => { s.hidden = +s.dataset.step !== step; });
    $('calSteps').querySelector('[data-step="2"]').classList.toggle('done', sensor.x === 'ok' && sensor.y === 'ok');
    $('calSteps').querySelector('[data-step="3"]').classList.toggle('done', dir.x === 'ok' && dir.y === 'ok');
    $('calBack').disabled = step === 0;
    setText('calNext', step === STEPS - 1 ? 'Finish' : 'Next');

    $('calFoot').hidden = confirming;
    $('calConfirm').hidden = !confirming;
    if (!cfg) return;

    const pinX = cfg.swap ? 'D10' : 'D9', pinY = cfg.swap ? 'D9' : 'D10';
    // Step 1
    setText('cxVal', cfg.xc + '°'); setText('cyVal', cfg.yc + '°');
    setText('cxPin', pinX); setText('cyPin', pinY);
    // Step 2
    const tx = live ? live.rx - cfg.tx : null, ty = live ? live.ry - cfg.ty : null;
    setText('clUp', cfg.up == null ? 'Z (fixed)' : (cfg.up > 0 ? '+' : '−') + 'XYZ'[Math.abs(cfg.up) - 1]);
    setText('clRawX', sdeg(live?.rx)); setText('clRawY', sdeg(live?.ry));
    setText('clTrimX', sdeg(cfg.tx)); setText('clTrimY', sdeg(cfg.ty));
    setText('clNowX', sdeg(tx)); setText('clNowY', sdeg(ty));
    $('calLevel').disabled = levelBusy;
    setText('calLevel', levelBusy ? 'Hold still…' : 'Set level');
    // Step 3
    bar('csBarX', tx); bar('csBarY', ty);
    setText('csValX', sdeg(tx)); setText('csValY', sdeg(ty));
    const prompts = { x: 'Tilt the top toward +X', fixed: 'Back to upright', back1: 'Back to upright', y: 'Tilt the top toward +Y', back2: 'Back to upright', done: 'Sensor check done' };
    setText('csPrompt', prompts[sensor.phase]);
    const res = { ok: ['✓ Correct', 'ok'], rev: ['✗ Reversed', 'bad'], cross: ['✗ Other axis moved', 'bad'] };
    for (const ax of ['x', 'y']) {
      const r = res[sensor[ax]] || ['Not checked', ''];
      const el = $('csRes' + ax.toUpperCase());
      setText(el.id, r[0]); el.className = 'cal-res ' + r[1];
    }
    const bad = [sensor.x, sensor.y];
    setText('csHelp', cfg.rot != null
      ? (bad.includes('cross') || bad.includes('rev')
        ? 'X reads right but Y does not, which a real sensor can\'t do. Redo Level with the rocket upright and still, then Start over.'
        : sensorNote)
      : bad.includes('cross')
        ? 'The sensor is rotated 90°. Turn the MPU6050 so its X arrow points the way the X servo tilts the motor, Z up the rocket (or upload firmware v1.3.0, which corrects this for you).'
        : bad.includes('rev')
          ? 'The sensor reads that tilt backwards: it is mounted flipped. Remount it Z-up with its X/Y arrows matching the servos (or upload firmware v1.3.0).'
          : '');
    // Step 4
    setText('cdDirX', cfg.xd > 0 ? 'Normal' : 'Reversed'); setText('cdDirY', cfg.yd > 0 ? 'Normal' : 'Reversed');
    setText('cdPinX', pinX); setText('cdPinY', pinY);
    for (const ax of ['x', 'y']) {
      const AX = ax.toUpperCase();
      $(`calAns${AX}`).hidden = dir[ax] !== 'tested';
      const st = $(`cdSt${AX}`);
      setText(st.id, dir[ax] === 'ok' ? '✓ Correct' : dir[ax] === 'tested' ? 'Which way did it go?' : 'Not tested');
      st.className = 'cal-res ' + (dir[ax] === 'ok' ? 'ok' : '');
      setText(`cdNote${AX}`, dirNote[ax]);
    }
    // Step 5
    setText('svXc', cfg.xc + '°'); setText('svYc', cfg.yc + '°');
    setText('svXd', cfg.xd > 0 ? 'Normal' : 'Reversed'); setText('svYd', cfg.yd > 0 ? 'Normal' : 'Reversed');
    setText('svTx', sdeg(cfg.tx)); setText('svTy', sdeg(cfg.ty));
    setText('svPins', cfg.swap ? 'D10 = X · D9 = Y' : 'D9 = X · D10 = Y');
    if (document.activeElement !== $('calSpg')) $('calSpg').value = cfg.spg;
    const r = measured();
    setText('cmRatio', r ? `${r} servo° per gimbal°` : DASH);
    $('cmUse').disabled = !r;
    const checks = [
      ['Sensor axes', sensor.x === 'ok' && sensor.y === 'ok'],
      ['Servo directions', dir.x === 'ok' && dir.y === 'ok'],
    ];
    setText('svChecks', checks.filter(c => !c[1]).map(c => c[0]).join(' and ')
      ? `Not confirmed yet: ${checks.filter(c => !c[1]).map(c => c[0]).join(' and ')}. You can still save.` : 'All checks passed.');
    $('calSave').disabled = cfg.state === 'SAVED';
    $('calRevert').disabled = cfg.state !== 'UNSAVED';
  }

  return { handle, onLink, refresh: () => open && render() };
}
