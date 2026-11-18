// Tests → Throttle: the CT-4 EDF throttle test (firmware v1.9.0+, ARM / THR / DISARM).
// Runs the motor from the page with the gimbal held at centre (the Nano's calibration mode). Safety lives in the
// firmware: 85 % cap, ramp-up limit, motor cut when no line arrives for 0.5 s (this page sends a heartbeat), on a
// tilt past 25° and on any mode change. The page adds: a checklist before Arm, Stop motor / Space, and a stop
// whenever the panel closes, the tab is hidden or the link drops.
// ESC calibration (firmware v1.10.0+, ESCCAL HIGH/LOW): teaches the ESC 1000 µs = 0 % and 2000 µs = 100 %. Starts only
// with the 12 V confirmed off; the firmware drops full throttle by itself after 15 s or a quiet link.
// Step test: 10 → 85 % in 9 points; at each one you type the scale reading (g) and, if you have a meter, the
// supply current (A). Runs are kept in this browser and download as CSV (throttle_pct,esc_us,thrust_g,current_a).

const $ = id => document.getElementById(id);
const MIN_FW = [1, 9, 0], ESCCAL_FW = [1, 10, 0];
const ESCCAL_MS = 15000;
const CAP = 85;
const STEPS = [10, 20, 30, 40, 50, 60, 70, 80, 85];
const SPEC_G = 220;                       // QX 30 mm EDF static thrust at full throttle, 11.1 V
const HEARTBEAT_MS = 150;                 // firmware cuts after THR_LINK_MS = 500
const SETTLE_MS = 1500, REPLY_MS = 2000;
const KEY_CUR = 'tvc-thrust-current', KEY_HIST = 'tvc-thrust-history', HIST_MAX = 20;
const specG = pct => SPEC_G * (pct / 100) ** 2;
const escUs = pct => 1000 + Math.round(Math.min(pct, CAP) * 10);

function load(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function store(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }

const stamp = t => {
  const d = new Date(t), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const done = run => run.pts.length > 0 && run.pts.every(p => p.g != null);
function csv(run) {
  const rows = ['throttle_pct,esc_us,thrust_g,current_a'];
  run.pts.forEach(p => { if (p.g != null) rows.push(`${p.pct},${escUs(p.pct)},${p.g.toFixed(1)},${p.a == null ? '' : p.a.toFixed(2)}`); });
  return rows.join('\n') + '\n';
}
function peak(run) {
  let best = null;
  for (const p of run.pts) if (p.g != null && (!best || p.g > best.g)) best = p;
  return best;
}
function summary(run) {
  const b = peak(run);
  const lines = [`CT-4 EDF thrust vs throttle, ${stamp(run.t)}`, `Firmware v${run.fw} · cap ${CAP} %`];
  for (const p of run.pts) if (p.g != null)
    lines.push(`${String(p.pct).padStart(3)} %  ${escUs(p.pct)} µs  ${p.g.toFixed(0).padStart(4)} g  (spec ${specG(p.pct).toFixed(0)} g)${p.a == null ? '' : `  ${p.a.toFixed(2)} A`}`);
  if (b) lines.push(`Max thrust ${b.g.toFixed(0)} g at ${b.pct} % (spec ${specG(b.pct).toFixed(0)} g)`);
  return lines.join('\n');
}
function download(run) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv(run)], { type: 'text/csv' }));
  a.download = `ct4_thrust_${stamp(run.t).replace(' ', '_').replace(':', '')}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function initThrottle({ send, link, calib, laser }) {
  const panel = $('thPanel');
  let open = false, tab = 0;
  let cfg = false, calOn = false;
  // From the Nano's THR lines
  let armed = false, fwTgt = null, fwAct = null, fwUs = null, lastThr = 0;
  let want = 0;                           // what this page asks for (slider / step test)
  let armPending = 0;                     // time ARM was sent, until THR,ARMED arrives
  let note = '', noteWarn = false, copied = 0;
  let checks = [false, false, false, false];
  // Step test
  let phase = 'idle';                     // idle | ramp | settle | ready | done
  let idx = 0, settleTimer = 0, work = null, gText = '', aText = '';
  let run = load(KEY_CUR, null);
  if (!Array.isArray(run?.pts)) run = { id: Date.now(), t: Date.now(), fw: '', pts: [] };
  let history = load(KEY_HIST, []);
  let beat = 0;
  // ESC calibration: idle | sent (waiting for ESCCAL,HIGH) | high | low | error
  let ec = 'idle', ecT0 = 0, ecOff = false, ecNote = '';

  // ---------- Firmware lines ----------
  function handle(line) {
    const p = line.split(',');
    if (p[0] === 'CFG') { cfg = true; if (open && !calOn) send('CAL'); }
    else if (p[0] === 'CAL' && p[1] === 'ON') calOn = true;
    else if (p[0] === 'CAL' && p[1] === 'OFF') { calOn = false; if (open) send('CAL'); }
    else if (p[0] === 'CAL' && p.length >= 5) calOn = true;
    else if (p[0] === 'ESCCAL') {
      if (p[1] === 'HIGH') { ec = 'high'; ecT0 = performance.now(); ecNote = ''; }
      else if (p[1] === 'LOW') { if (ec === 'high' || ec === 'sent') { ec = 'low'; ecOff = false; } }   // the 12 V is on now
      else {
        ec = 'error'; ecOff = false;
        ecNote = ({ TIMEOUT: 'Took longer than 15 s, so the Nano went back to zero by itself.',
                    LINK: 'The Nano stopped hearing this page, so it went back to zero.',
                    MODE: 'The Nano changed mode, so it went back to zero.' }[p[1]] || line) + ' Turn the 12 V off and start again.';
      }
    } else if (p[0] === 'THR' && p[1] === 'CUT') {
      const why = { LINK: 'the Nano stopped hearing this page (0.5 s)', TILT: 'the rocket leaned past 25°', MODE: 'the Nano changed mode' }[p[2]] || p[2];
      cutLocal(`Motor cut: ${why}.${p[2] === 'MODE' ? '' : ' Recheck the checklist before arming again.'}`, p[2] !== 'MODE');
    } else if (p[0] === 'THR' && p.length >= 5) {
      armed = p[1] === 'ARMED'; fwTgt = +p[2]; fwAct = +p[3]; fwUs = +p[4]; lastThr = performance.now();
      if (armed) armPending = 0;
      if (!armed && phase !== 'idle' && phase !== 'done') abortStep('Step test stopped: the motor was disarmed.');
      if (phase === 'ramp' && armed && fwAct >= STEPS[idx] - 0.5) {
        phase = 'settle';
        settleTimer = setTimeout(() => { phase = 'ready'; render(); focusEntry(); }, SETTLE_MS);
      }
    } else if (p[0] === 'ERR' && ec === 'sent') { ec = 'error'; ecNote = `The Nano said "${line}".`;
    } else if (p[0] === 'ERR' && (armPending || armed)) { armPending = 0; setNote(`The Nano said "${line}". This test needs firmware v1.9.0 or newer.`, true); }
    if (open) render();
  }
  function onLink() {
    cfg = false; calOn = false;
    if (armed || phase !== 'idle') cutLocal('Link lost. The Nano cuts the motor by itself within 0.5 s.', false);
    armed = false; fwTgt = fwAct = fwUs = null; armPending = 0;
    if (ec === 'sent' || ec === 'high') { ec = 'error'; ecNote = 'Link lost. The Nano goes back to zero by itself within 0.5 s. Turn the 12 V off.'; }
    if (open) render();
  }

  // ---------- Motor ----------
  function setNote(t, warn) { note = t; noteWarn = !!warn; }
  function cutLocal(msg, uncheck) {
    armed = false; want = 0; armPending = 0;
    if (phase !== 'idle' && phase !== 'done') { clearTimeout(settleTimer); phase = 'idle'; work = null; }
    if (uncheck) checks = checks.map(() => false);
    setNote(msg, true);
    if (open) render();
  }
  function arm() {
    if (!calOn || !checks.every(Boolean) || armed || ec === 'sent' || ec === 'high') return;
    want = 0; setNote('', false);
    armPending = performance.now();
    send('ARM');
    setTimeout(() => { if (armPending && performance.now() - armPending >= REPLY_MS - 50) { armPending = 0; setNote('No reply to ARM. This test needs firmware v1.9.0 or newer (firmware/nano_tvc).', true); render(); } }, REPLY_MS);
    render();
  }
  function stopMotor(msg) {
    const was = armed || armPending || phase !== 'idle';
    want = 0; armPending = 0;
    if (phase !== 'idle' && phase !== 'done') { clearTimeout(settleTimer); phase = 'idle'; work = null; }
    if (link().port) send('DISARM');
    armed = false;
    if (was) setNote(msg || 'Motor stopped.', false);
    render();
  }
  function setWant(pct) {
    want = Math.max(0, Math.min(CAP, Math.round(pct)));
    if (armed) send(`THR ${want}`);
    render();
  }
  // Heartbeat: re-send the target so the Nano knows the page is alive (not logged)
  function startBeat() {
    clearInterval(beat);
    beat = setInterval(() => {
      if (armed) send(`THR ${want}`, true);
      else if (ec === 'sent' || ec === 'high') { send('HB', true); render(); }   // render: the countdown
    }, HEARTBEAT_MS);
  }
  // ---------- ESC calibration ----------
  function ecStart() {
    if (!calOn || armed || armPending || !ecOff || !['idle', 'low', 'error'].includes(ec)) return;
    ec = 'sent'; ecNote = '';
    send('ESCCAL HIGH');
    setTimeout(() => { if (ec === 'sent') { ec = 'error'; ecNote = 'No reply. ESC calibration needs firmware v1.10.0 or newer (firmware/nano_tvc).'; render(); } }, REPLY_MS);
    render();
  }
  function ecLow(cancel) {
    if (ec !== 'sent' && ec !== 'high') return;
    send('ESCCAL LOW');
    if (cancel) { ec = 'idle'; ecOff = false; ecNote = 'Cancelled: signal back to zero. Turn the 12 V off before trying again.'; }
    render();
  }
  function stopBeat() { clearInterval(beat); beat = 0; }

  // ---------- Step test ----------
  function focusEntry() { if (open && tab === 1) setTimeout(() => $('thG').focus(), 0); }
  function goStep(i) {
    idx = i; phase = 'ramp'; gText = aText = '';
    clearTimeout(settleTimer);
    setWant(STEPS[i]);
  }
  function startStep() {
    if (!armed) return;
    work = STEPS.map(pct => ({ pct, g: null, a: null }));
    setNote('', false);
    goStep(0);
  }
  function abortStep(msg) {
    clearTimeout(settleTimer); phase = 'idle'; work = null;
    if (armed) setWant(0);
    setNote(msg, true);
  }
  const num = t => {
    t = t.trim().replace('−', '-').replace(',', '.');
    return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : null;
  };
  function record() {
    const g = num(gText), a = aText.trim() ? num(aText) : null;
    if (phase !== 'ready' || g == null || (aText.trim() && a == null)) return;
    work[idx].g = Math.abs(g); work[idx].a = a;
    if (idx + 1 < STEPS.length) { goStep(idx + 1); return; }
    setWant(0);
    run = { id: Date.now(), t: Date.now(), fw: link().fw, pts: work };
    work = null; phase = 'done';
    store(KEY_CUR, run);
    history = [JSON.parse(JSON.stringify(run)), ...history.filter(h => h.id !== run.id)].slice(0, HIST_MAX);
    store(KEY_HIST, history);
    setNote('Step test done, throttle back to 0. See Results.', false);
    render();
  }

  // ---------- Open / close ----------
  function show() {
    if (calib.isOpen()) { calib.close(); if (calib.isOpen()) return; }   // unsaved calibration: let that panel ask first
    if (laser.isOpen()) laser.close();
    open = true;
    panel.hidden = false;
    $('thBtn').classList.add('on');
    if (cfg && !calOn) send('CAL');
    else if (link().port && !cfg) send('GET');
    startBeat();
    render();
  }
  function hide() {
    if (armed || armPending) stopMotor();
    ecLow(true);
    stopBeat();
    clearTimeout(settleTimer);
    if (phase !== 'done') { phase = 'idle'; work = null; }
    open = false;
    panel.hidden = true;
    $('thBtn').classList.remove('on');
    if (calOn) send('RUN');   // back to flight mode; RUN also cuts the motor in the firmware
    calOn = false;
  }
  $('thBtn').onclick = () => (open ? hide() : show());
  $('thClose').onclick = hide;
  $('thKill').onclick = () => stopMotor();
  document.addEventListener('keydown', e => {
    if (!open) return;
    if (e.key === 'Escape') { hide(); return; }
    // Space stops the motor from anywhere except a text box (where it types a space)
    if (e.code === 'Space' && (ec === 'sent' || ec === 'high')) { e.preventDefault(); ecLow(true); return; }
    if (e.code === 'Space' && (armed || armPending) && !(e.target.matches?.('input[type=text], textarea'))) { e.preventDefault(); stopMotor(); }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) return; ecLow(true); if (armed || armPending) stopMotor('Motor stopped: the page was hidden.'); });
  document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => { if (open && b.dataset.tab !== 'tests') hide(); }));

  function go(t) { tab = Math.max(0, Math.min(2, t)); render(); if (tab === 1 && phase === 'ready') focusEntry(); }
  panel.querySelectorAll('#thTabs button').forEach(b => { b.onclick = () => go(+b.dataset.tab); });
  $('thBack').onclick = () => go(tab - 1);
  $('thNext').onclick = () => (tab === 2 ? hide() : go(tab + 1));

  panel.querySelectorAll('#thCheck input').forEach((c, i) => { c.onchange = () => { checks[i] = c.checked; render(); }; });
  $('thEcOff').onchange = e => { ecOff = e.target.checked; render(); };
  $('thEcGo').onclick = ecStart;
  $('thEcLow').onclick = () => ecLow(false);
  $('thEcCancel').onclick = () => ecLow(true);
  $('thArm').onclick = arm;
  $('thStop').onclick = () => stopMotor();
  $('thSlider').oninput = e => { if (phase === 'idle' || phase === 'done') setWant(+e.target.value); };
  panel.querySelectorAll('[data-thp]').forEach(b => { b.onclick = () => { if (phase === 'idle' || phase === 'done') setWant(+b.dataset.thp); }; });
  $('thStepGo').onclick = () => (['ramp', 'settle', 'ready'].includes(phase) ? abortStep('Step test stopped. Nothing from it was kept.') : startStep());
  $('thG').oninput = e => { gText = e.target.value; render(); };
  $('thA').oninput = e => { aText = e.target.value; render(); };
  for (const id of ['thG', 'thA']) $(id).onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); record(); } };
  $('thRec').onclick = record;
  $('thCsv').onclick = () => download(run);
  $('thCopy').onclick = async () => {
    try { await navigator.clipboard.writeText(summary(run) + '\n\n' + csv(run)); copied = Date.now(); render(); setTimeout(render, 1600); } catch {}
  };
  $('thNew').onclick = () => { run = { id: Date.now(), t: Date.now(), fw: '', pts: [] }; store(KEY_CUR, run); phase = 'idle'; setNote('', false); tab = 1; render(); };
  $('thHist').onclick = e => {
    const b = e.target.closest('[data-hist]');
    const h = b && history.find(r => r.id === +b.dataset.hist);
    if (h) download(h);
  };

  // ---------- Render ----------
  const DASH = '—';
  const fwOld = (fw, min = MIN_FW) => {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(fw || '');
    if (!m) return false;
    const v = m.slice(1).map(Number);
    for (let i = 0; i < 3; i++) if (v[i] !== min[i]) return v[i] < min[i];
    return false;
  };
  function setText(id, t) { const el = $(id); if (el.textContent !== t) el.textContent = t; }
  const stepping = () => ['ramp', 'settle', 'ready'].includes(phase);

  function render() {
    if (!open) return;
    const L = link();
    let msg = '';
    if (!L.port) msg = L.demo ? 'The throttle test needs the real Arduino. Stop the demo and connect it.' : 'Connect the Arduino to run the throttle test.';
    else if (fwOld(L.fw)) msg = `Firmware v${L.fw} can't run the motor. Upload firmware v1.9.0 or newer (firmware/nano_tvc).`;
    else if (!cfg) msg = 'Waiting for the Nano. It restarts when the port opens and takes about 5 s to boot (keep the rocket still).';
    $('thMsg').textContent = msg;
    $('thMsg').hidden = !msg || tab === 2;
    $('thBody').hidden = !!msg && tab !== 2;

    const live = armed && fwAct != null;
    const ecOn = ec === 'sent' || ec === 'high';
    setText('thState', ecOn ? 'ESC cal · full signal' : armed ? (fwAct > 0 ? 'Running' : 'Armed') : armPending ? 'Arming…' : 'Safe');
    $('thState').className = armed || ecOn ? 'bad' : '';
    $('thKill').hidden = !(armed || armPending);
    panel.querySelectorAll('#thTabs button').forEach(b => b.classList.toggle('active', +b.dataset.tab === tab));
    $('thTabs').querySelector('[data-tab="0"]').classList.toggle('done', checks.every(Boolean));
    $('thTabs').querySelector('[data-tab="1"]').classList.toggle('done', done(run));
    panel.querySelectorAll('.th-step').forEach(s => { s.hidden = +s.dataset.tab !== tab; });
    $('thBack').disabled = tab === 0;
    setText('thNext', tab === 2 ? 'Close' : 'Next');

    // Safety
    panel.querySelectorAll('#thCheck input').forEach((c, i) => { c.checked = checks[i]; c.disabled = armed; });
    // ESC calibration
    const ecBusy = ec === 'sent' || ec === 'high';
    const ecLeft = ec === 'high' ? Math.max(0, ESCCAL_MS - (performance.now() - ecT0)) : ESCCAL_MS;
    const ecOldFw = fwOld(L.fw, ESCCAL_FW);
    if (ecBusy) $('thEc').open = true;
    $('thEcOff').checked = ecOff; $('thEcOff').disabled = ecBusy;
    setText('thEcStep', ecOldFw ? `Needs firmware v1.10.0 or newer (this Nano has v${L.fw}).`
      : ec === 'sent' ? 'Sending full throttle…'
      : ec === 'high' ? `Full throttle signal ON (${Math.ceil(ecLeft / 1000)} s left). Turn the 12 V ON now and listen. When the ESC beeps (often 2 beeps after about 2 s), press "Heard the beeps: set zero" straight away. Waiting too long can put some ESCs into their settings menu.`
      : ec === 'low' ? 'Zero sent. The ESC should play a confirm tone (often one long beep) and go quiet: the range is stored. Turn the 12 V off, wait, turn it on again: it should arm without the double beep. Then Arm on the Run tab.'
      : "Teaches the ESC that 1000 µs is 0 % and 2000 µs is 100 %. Do it once, or when it double-beeps and won't arm. With the 12 V OFF: tick the box, press Send full throttle, then turn the 12 V on and follow the prompts. Fan clamped and everyone clear: if the ESC were already powered and armed, full throttle would spin it.");
    $('thEcTime').hidden = ec !== 'high';
    $('thEcBar').style.width = (ecLeft / ESCCAL_MS * 100).toFixed(1) + '%';
    $('thEcGo').disabled = ecOldFw || ecBusy || !calOn || armed || !!armPending || !ecOff;
    $('thEcLow').disabled = ec !== 'high';
    $('thEcCancel').disabled = !ecBusy;
    setText('thEcNote', ecNote);

    // Live
    const act = live ? fwAct : 0;
    setText('thAct', live ? fwAct.toFixed(0) : armed ? '0' : DASH);
    setText('thTgt', armed && fwTgt != null ? fwTgt.toFixed(0) : DASH);
    setText('thUs', fwUs != null && armed ? String(fwUs) : calOn ? '1000' : DASH);
    setText('thEst', live ? specG(fwAct).toFixed(0) : DASH);
    $('thBarAct').style.width = (act / CAP * 100).toFixed(1) + '%';
    $('thBarTgt').style.left = ((armed ? want : 0) / CAP * 100).toFixed(1) + '%';
    $('thBarTgt').hidden = !armed;
    const allChecked = checks.every(Boolean);
    $('thArm').disabled = !calOn || armed || !!armPending || !allChecked || ecBusy;
    setText('thArm', armed ? 'Armed' : armPending ? 'Arming…' : 'Arm');
    $('thStop').disabled = !(armed || armPending);
    const n = note || (!allChecked ? 'Tick the checklist on the Safety tab to arm.' : !armed ? 'Arm, then set a throttle. Space stops the motor.' : '');
    setText('thNote', n);
    $('thNote').classList.toggle('cal-warn', noteWarn && !!note);

    // Manual
    const manual = armed && !stepping();
    $('thSlider').disabled = !manual;
    if (+$('thSlider').value !== want) $('thSlider').value = want;
    setText('thWant', `${want} %`);
    panel.querySelectorAll('[data-thp]').forEach(b => { b.disabled = !manual; });

    // Step test
    setText('thStepGo', stepping() ? 'Stop' : 'Start');
    $('thStepGo').disabled = !stepping() && !armed;
    const pts = stepping() ? work : run.pts;
    $('thDots').querySelectorAll('i').forEach((d, i) => {
      const p = pts?.[i];
      d.className = p?.g != null ? 'ok' : '';
      if (stepping() && i === idx) d.classList.add('cur');
      d.title = `${STEPS[i]} %` + (p?.g != null ? ` → ${p.g.toFixed(0)} g` : '');
    });
    const st = { idle: done(run) ? 'Done' : 'Ready', ramp: `${STEPS[idx]} % · ramping`, settle: `${STEPS[idx]} % · settling`, ready: `${STEPS[idx]} % · read the scale`, done: 'Done' }[phase];
    setText('thStepSt', st);
    $('thStepSt').className = 'cal-res' + (phase === 'ready' ? ' ok' : '');
    setText('thSub', phase === 'ready'
      ? `Point ${idx + 1} of ${STEPS.length} at ${STEPS[idx]} %. Type the scale reading (g), and the current if you have it, then Enter.`
      : 'Tare the scale with the motor off. At each step type the reading: thrust pushes the scale down or lifts the rocket off it, so either sign is fine.');
    const ready = phase === 'ready';
    $('thEntry').classList.toggle('off', !ready);
    $('thG').disabled = $('thA').disabled = !ready;
    if ($('thG').value !== gText) $('thG').value = gText;
    if ($('thA').value !== aText) $('thA').value = aText;
    $('thRec').disabled = !ready || num(gText) == null || (aText.trim() !== '' && num(aText) == null);
    setText('thRec', idx === STEPS.length - 1 ? 'Record & finish' : 'Record & next');

    // Results
    const rows = run.pts.filter(p => p.g != null).map(p =>
      `<tr><td>${p.pct} %</td><td>${escUs(p.pct)}</td><td>${p.g.toFixed(0)}</td><td>${specG(p.pct).toFixed(0)}</td><td>${p.a == null ? DASH : p.a.toFixed(2)}</td></tr>`).join('');
    const tb = rows || `<tr><td colspan="5">${DASH}</td></tr>`;
    if ($('thRows').innerHTML !== tb) $('thRows').innerHTML = tb;
    const b = peak(run);
    setText('thOverall', b ? `Max ${b.g.toFixed(0)} g at ${b.pct} %` : 'No step test yet.');
    $('thOverall').className = 'lz-overall' + (b ? ' ok' : '');
    setText('thMeta', run.fw ? `${stamp(run.t)} · firmware v${run.fw}` : '');
    $('thCsv').disabled = $('thCopy').disabled = !done(run);
    setText('thCopy', Date.now() - copied < 1500 ? 'Copied ✓' : 'Copy summary');
    $('thNew').disabled = stepping();
    const hist = history.map(h => {
      const p = peak(h);
      return `<li><span>${stamp(h.t)}</span><span>${p ? `${p.g.toFixed(0)} g @ ${p.pct} %` : DASH}</span><button data-hist="${h.id}">CSV</button></li>`;
    }).join('');
    const hh = hist || '<li class="empty">No finished runs yet.</li>';
    if ($('thHist').innerHTML !== hh) $('thHist').innerHTML = hh;
  }

  // Plume level for the 3D view while this panel is open: the real throttle (1 = the cap), 0 when not running.
  // null when closed (the bench shows its usual dim plume).
  const level = () => (!open ? null : armed && fwAct != null && performance.now() - lastThr < 1000 ? fwAct / CAP : 0);

  return { handle, onLink, isOpen: () => open, close: hide, level, data: () => ({ run, work }), refresh: () => open && render() };
}
