// Bench tab: the 3D test rig, Web Serial / demo feed, readouts, gimbal + link tables and chart.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';

const $ = id => document.getElementById(id);

export function initBench() {
  // ---------- Scene ----------
  const view = document.getElementById('view');
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  view.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050506);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  // Distance needed so the whole rocket (incl. ±45° tilt) fits the current window shape
  function fitDistance() {
    const vHalf = THREE.MathUtils.degToRad(camera.fov / 2);
    const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
    return Math.max(1.45 / Math.tan(vHalf), 1.15 / Math.tan(hHalf)) * 1.1;
  }
  const VIEW_DIR = new THREE.Vector3(3.2, 0.9, 4.2).normalize();
  // Zoom stays in proportion to the 8×8 floor grid: close enough to inspect the gimbal, never so far that the rig is a
  // speck. Orbiting stays a free 360°. The pan target is fenced to the grid so the view can't wander off it.
  const GRID_HALF = 4;
  function setZoomLimits() {
    controls.minDistance = 1.2;
    controls.maxDistance = Math.max(11, fitDistance() * 1.5);   // tall, narrow windows need more room to fit the rocket
  }
  const _tClamp = new THREE.Vector3();
  function fenceTarget() {
    _tClamp.set(THREE.MathUtils.clamp(controls.target.x, -GRID_HALF, GRID_HALF),
                THREE.MathUtils.clamp(controls.target.y, 0, PIVOT_Y * 2),
                THREE.MathUtils.clamp(controls.target.z, -GRID_HALF, GRID_HALF)).sub(controls.target);
    if (_tClamp.lengthSq()) { controls.target.add(_tClamp); camera.position.add(_tClamp); }
  }
  function resetView() {
    controls.target.set(0, PIVOT_Y, 0);
    camera.position.copy(controls.target).addScaledVector(VIEW_DIR, fitDistance());
    controls.update();
  }

  scene.add(new THREE.HemisphereLight(0xffffff, 0x333344, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(4, 8, 5); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
  scene.add(sun);

  const grid = new THREE.GridHelper(8, 16, 0x2a2d34, 0x16171b);
  scene.add(grid);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.ShadowMaterial({ opacity: 0.35 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

  // Rocket dimensions; the gimbal pivot is at the middle of the full length (≈ center of mass)
  const R = 0.2, BODY = 1.6, NOSE = 0.5, TAIL = 0.15;
  const MID = (TAIL + BODY + NOSE) / 2;
  const PIVOT_Y = 1.45; // pivot height above the floor (high enough to clear it at ±45°)

  // Vertical reference line through the pivot
  const refGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, PIVOT_Y - MID - 0.15, 0), new THREE.Vector3(0, PIVOT_Y + MID + 0.15, 0)]);
  const refLine = new THREE.Line(refGeo, new THREE.LineDashedMaterial({ color: 0x5a6070, dashSize: 0.08, gapSize: 0.06 }));
  refLine.computeLineDistances(); scene.add(refLine);

  // Rocket group origin = pivot. All parts hang off "airframe", shifted down by MID so the middle sits on the pivot.
  const rocket = new THREE.Group();
  rocket.position.y = PIVOT_Y;
  rocket.rotation.order = 'ZXY'; // roll about own long axis first, then pitch (X), then yaw (Z)
  scene.add(rocket);
  const airframe = new THREE.Group();
  airframe.position.y = -MID;
  rocket.add(airframe);

  // Gimbal collar + pivot pins at the center of mass (they move with the rocket)
  const metal = new THREE.MeshStandardMaterial({ color: 0x999fab, metalness: 0.7, roughness: 0.3 });
  const collar = new THREE.Mesh(new THREE.TorusGeometry(R + 0.03, 0.025, 12, 40), metal);
  collar.rotation.x = Math.PI / 2; rocket.add(collar);
  const pinGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.14, 12);
  [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([x, z]) => {
    const pin = new THREE.Mesh(pinGeo, metal);
    pin.position.set(x * (R + 0.1), 0, z * (R + 0.1));
    pin.rotation.set(z ? Math.PI / 2 : 0, 0, x ? Math.PI / 2 : 0);
    rocket.add(pin);
  });

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xdcdce6, roughness: 0.5 });
  const noseMat = new THREE.MeshStandardMaterial({ color: 0xc82828, roughness: 0.45 });
  const finMat  = new THREE.MeshStandardMaterial({ color: 0x2838c8, roughness: 0.5, side: THREE.DoubleSide });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R, BODY, 32), bodyMat);
  body.position.y = TAIL + BODY / 2; body.castShadow = true; airframe.add(body);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(R, NOSE, 32), noseMat);
  nose.position.y = TAIL + BODY + NOSE / 2; nose.castShadow = true; airframe.add(nose);

  // Motor mount / nozzle under the body (sits in the gimbal)
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, TAIL, 24),
    new THREE.MeshStandardMaterial({ color: 0x55585f, metalness: 0.7, roughness: 0.35 }));
  nozzle.position.y = TAIL / 2; nozzle.castShadow = true; airframe.add(nozzle);

  // Fins: triangle in the radial plane, like the Processing sketch
  const finShape = new THREE.Shape();
  finShape.moveTo(0, 0); finShape.lineTo(0.15, 0.2); finShape.lineTo(0, 0.4); finShape.closePath();
  const finGeo = new THREE.ShapeGeometry(finShape);
  for (let i = 0; i < 4; i++) {
    const holder = new THREE.Group();
    holder.rotation.y = (Math.PI / 2) * i;
    const fin = new THREE.Mesh(finGeo, finMat);
    fin.position.set(R, TAIL, 0);
    fin.castShadow = true;
    holder.add(fin); airframe.add(holder);
  }

  // Small axis gizmo at the pivot
  const axes = new THREE.AxesHelper(0.5); axes.position.y = PIVOT_Y; scene.add(axes);

  // Outline view: black fills + white silhouettes (OutlineEffect's inverted hull) + white fin edges
  const outlineFx = new OutlineEffect(renderer, { defaultThickness: 0.005, defaultColor: [1, 1, 1], defaultAlpha: 1 });
  const noOutline = { visible: false };
  [grid.material, floor.material, refLine.material, axes.material].forEach(m => { m.userData.outlineParameters = noOutline; });
  const fillMat = new THREE.MeshBasicMaterial({ color: 0x050506 });
  const finFillMat = new THREE.MeshBasicMaterial({ color: 0x050506, side: THREE.DoubleSide });
  const edgeMat = new THREE.LineBasicMaterial({ color: 0xffffff });
  finFillMat.userData.outlineParameters = edgeMat.userData.outlineParameters = noOutline; // flat fins: edges only
  const finEdgeGeo = new THREE.EdgesGeometry(finGeo);
  const rocketMeshes = [];
  rocket.traverse(o => { if (o.isMesh) rocketMeshes.push(o); });
  rocketMeshes.forEach(m => {
    m.userData.solidMat = m.material;
    m.userData.lineMat = m.material === finMat ? finFillMat : fillMat;
    if (m.material === finMat) { const e = new THREE.LineSegments(finEdgeGeo, edgeMat); e.visible = false; m.add(e); m.userData.edges = e; }
  });
  let outlineOn = false;
  function setOutline(on) {
    outlineOn = on;
    rocketMeshes.forEach(m => {
      m.material = on ? m.userData.lineMat : m.userData.solidMat;
      if (m.userData.edges) m.userData.edges.visible = on;
    });
  }

  let firstFit = true;
  function resize() {
    const w = Math.max(1, view.clientWidth), h = Math.max(1, view.clientHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(w, h, false); // false = CSS controls display size, we only set the buffer
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    setZoomLimits();
    if (firstFit) { resetView(); firstFit = false; return; }
    // Keep the user's viewing angle but re-zoom so the rocket stays in frame
    const dir = camera.position.clone().sub(controls.target).normalize();
    camera.position.copy(controls.target).addScaledVector(dir, fitDistance());
    controls.update();
  }
  new ResizeObserver(resize).observe(view);
  window.addEventListener('resize', resize);
  resize();

  // ---------- State ----------
  const target = { roll: 0, pitch: 0, yaw: 0 };
  const shown  = { roll: 0, pitch: 0, yaw: 0 };
  const zero   = { roll: 0, pitch: 0, yaw: 0 };
  const history = []; // {t, pitch, yaw}
  const peak   = { pitch: 0, yaw: 0 }; // largest-magnitude value since connect / zero
  let sampleTimes = [];
  let linkStart = null;                // when the current Arduino / demo feed started
  let lastLineT = null;                // when the last valid line arrived (null = none yet)
  let lineCount = 0, errCount = 0;     // lines received / lines that didn't parse, since link start
  let portLabel = '—', fwVersion = '—';   // fwVersion comes from the Nano's boot line "TVC firmware vX.Y.Z"
  const raw = { pitch: null, yaw: null }; // pitch/yaw exactly as sent (servo angles in servo mode)

  const servoMode = $('servoMode'), smooth = $('smooth');
  $('outline').onchange = e => setOutline(e.target.checked);
  $('baud').onchange = () => { ['baudVal', 'lkBaud', 'ftBaud'].forEach(id => { $(id).textContent = $('baud').value; }); };

  function handleLine(line) {
    if (!line) return;
    lineCount++;
    const fw = line.match(/firmware v(\d+\.\d+\.\d+)/i);
    if (fw) fwVersion = fw[1];
    const parts = line.split(',').map(s => parseFloat(s));
    if (parts.length < 3 || parts.slice(0, 3).some(v => !Number.isFinite(v))) { errCount++; logLine(line, 'msg'); return; } // boot messages etc.
    logLine(line);
    let [roll, pitch, yaw] = parts;
    raw.pitch = pitch; raw.yaw = yaw;
    if (servoMode.checked) { pitch -= 90; yaw -= 90; }
    target.roll = roll - zero.roll;
    target.pitch = pitch - zero.pitch;
    target.yaw = yaw - zero.yaw;
    for (const a of ['pitch', 'yaw']) if (Math.abs(target[a]) > Math.abs(peak[a])) peak[a] = target[a];

    const now = performance.now();
    lastLineT = now;
    sampleTimes.push(now);
    history.push({ t: now, pitch: target.pitch, yaw: target.yaw });
    while (history.length && now - history[0].t > 10000) history.shift();
  }

  $('zeroBtn').onclick = () => {
    zero.roll += target.roll; zero.pitch += target.pitch; zero.yaw += target.yaw;
    target.roll = target.pitch = target.yaw = 0;
    peak.pitch = peak.yaw = 0;
  };
  servoMode.onchange = () => { zero.roll = zero.pitch = zero.yaw = 0; };
  $('viewBtn').onclick = resetView;

  // ---------- Web Serial ----------
  let port = null, reader = null, pipeDone = null, keepReading = false;

  function setStatus(text, on) {
    $('statusText').textContent = text;
    for (const id of ['dot', 'mbLive']) { $(id).classList.toggle('on', !!on); $(id).classList.remove('stale'); }
  }
  // Serial log: newest at the bottom, keeps the last 200 lines, follows new lines unless you've scrolled up
  function logLine(text, cls) {
    const log = $('serialLog'), atEnd = log.scrollTop + log.clientHeight >= log.scrollHeight - 8;
    const row = document.createElement('div');
    row.textContent = text; if (cls) row.className = cls;
    log.appendChild(row);
    while (log.childElementCount > 200) log.firstElementChild.remove();
    if (atEnd) log.scrollTop = log.scrollHeight;
  }
  const gTrail = [];   // recent gimbal dial positions

  function startLink(label) {
    $('serialLog').textContent = '';
    linkStart = performance.now(); lastLineT = null; lineCount = errCount = 0;
    peak.pitch = peak.yaw = 0; raw.pitch = raw.yaw = null; portLabel = label; fwVersion = label === 'Demo' ? 'Demo' : '—';
  }
  function endLink() { linkStart = lastLineT = null; portLabel = '—'; }
  const hex4 = n => n.toString(16).toUpperCase().padStart(4, '0');

  async function connect() {
    if (!('serial' in navigator)) { setStatus('Web Serial not supported — use Chrome or Edge'); return; }
    try {
      stopDemo();
      port = await navigator.serial.requestPort();
      await port.open({ baudRate: Number($('baud').value) });
      setStatus('Live', true);
      const { usbVendorId: vid, usbProductId: pid } = port.getInfo();
      startLink(vid ? `${hex4(vid)}:${hex4(pid)}` : 'Serial');
      $('connectBtn').textContent = 'Disconnect';
      keepReading = true;
      readLoop();
    } catch (err) {
      setStatus(err.name === 'NotFoundError' ? 'No port selected' : 'Error: ' + err.message);
      port = null;
    }
  }

  async function readLoop() {
    let buf = '';
    while (port && port.readable && keepReading) {
      const decoder = new TextDecoderStream();
      pipeDone = port.readable.pipeTo(decoder.writable).catch(() => {});
      reader = decoder.readable.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
          let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            handleLine(buf.slice(0, i).trim());
            buf = buf.slice(i + 1);
          }
          if (buf.length > 1000) buf = ''; // guard against garbage with no newlines
        }
      } catch (e) {
        setStatus('Read error: ' + e.message);
      } finally {
        reader.releaseLock();
      }
    }
  }

  async function disconnect() {
    keepReading = false;
    try { if (reader) await reader.cancel(); } catch {}
    try { if (pipeDone) await pipeDone; } catch {}
    try { if (port) await port.close(); } catch {}
    port = null; reader = null; endLink();
    setStatus('Not connected', false);
    $('connectBtn').textContent = 'Connect Arduino';
  }

  $('connectBtn').onclick = () => (port ? disconnect() : connect());
  if ('serial' in navigator) {
    navigator.serial.addEventListener('disconnect', e => { if (e.target === port) disconnect(); });
  } else {
    setStatus('Web Serial not supported — use Chrome or Edge (demo mode still works)');
  }

  // ---------- Demo mode (no hardware) ----------
  let demoTimer = null;
  function startDemo() {
    if (port) return;
    $('demoBtn').textContent = 'Stop demo';
    $('demoPill').classList.add('on');
    setStatus('Demo feed', true);
    startLink('Demo');
    const t0 = performance.now();
    demoTimer = setInterval(() => {
      const t = (performance.now() - t0) / 1000;
      const p = 90 + 35 * Math.sin(t * 0.9) + 6 * Math.sin(t * 3.1);
      const y = 90 + 30 * Math.sin(t * 0.6 + 1.2);
      const fake = servoMode.checked ? `0,${Math.round(p)},${Math.round(y)}` : `0,${Math.round(p - 90)},${Math.round(y - 90)}`;
      handleLine(fake);
    }, 50);
  }
  function stopDemo() {
    if (!demoTimer) return;
    clearInterval(demoTimer); demoTimer = null;
    $('demoBtn').textContent = 'Demo mode';
    $('demoPill').classList.remove('on');
    if (!port) { setStatus('Not connected', false); endLink(); }
  }
  $('demoBtn').onclick = () => (demoTimer ? stopDemo() : startDemo());

  // ---------- Chart ----------
  const chart = $('chart'), ctx = chart.getContext('2d');
  function drawChart() {
    const dpr = Math.min(devicePixelRatio, 2);
    const w = chart.clientWidth, h = chart.clientHeight;
    if (!w || !h) return; // hidden while on the Mission tab
    if (chart.width !== w * dpr) { chart.width = w * dpr; chart.height = h * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const RANGE = 60; // ±60° visible
    const L = 22;     // left gutter for axis labels
    const yOf = v => h / 2 - (v / RANGE) * (h / 2 - 6);
    // Faint grid: every 15° and every 2 s, with small muted axis labels
    ctx.lineWidth = 1; ctx.font = '500 9px "Barlow Condensed", sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let v = -45; v <= 45; v += 15) {
      const y = Math.round(yOf(v)) + 0.5;
      ctx.strokeStyle = v === 0 ? '#2c2f36' : '#16171b';
      ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(w, y); ctx.stroke();
      ctx.fillStyle = '#5a5e66'; ctx.fillText(v, L - 5, y);
    }
    ctx.strokeStyle = '#16171b';
    for (let s = 2; s < 10; s += 2) {
      const x = Math.round(L + (w - L) * s / 10) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(255,77,94,.55)';
    [45, -45].forEach(v => { ctx.beginPath(); ctx.moveTo(L, yOf(v)); ctx.lineTo(w, yOf(v)); ctx.stroke(); });
    ctx.setLineDash([]);
    const now = performance.now();
    const xOf = t => w - ((now - t) / 10000) * (w - L);
    ctx.save(); ctx.beginPath(); ctx.rect(L, 0, w - L, h); ctx.clip();
    [['pitch', '#5b8cff'], ['yaw', '#ff8a3d']].forEach(([k, c]) => {
      ctx.strokeStyle = c; ctx.lineWidth = 1.4; ctx.lineJoin = 'round'; ctx.beginPath();
      history.forEach((s, i) => { const x = xOf(s.t), y = yOf(s[k]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
    });
    ctx.restore();
  }

  // ---------- Loop ----------
  const deg = THREE.MathUtils.degToRad;
  let lastUi = 0;
  function animate(now) {
    requestAnimationFrame(animate);
    const k = smooth.checked ? 0.18 : 1;
    for (const a of ['roll', 'pitch', 'yaw']) shown[a] += (target[a] - shown[a]) * k;

    rocket.rotation.set(deg(shown.pitch), deg(shown.roll), deg(-shown.yaw));
    controls.update();
    fenceTarget();
    if (view.clientWidth > 1 && view.clientHeight > 1) (outlineOn ? outlineFx : renderer).render(scene, camera);

    if (now - lastUi > 80) {
      lastUi = now;
      updateBenchUI(now);
      drawChart();
    }
  }

  const DASH = '—';
  const sgn1 = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1);
  function updateBenchUI(now) {
    const linked = linkStart !== null, hasData = linked && lastLineT !== null;
    const f1 = v => (hasData ? v.toFixed(1) : DASH), d1 = v => (hasData ? v.toFixed(1) + '°' : DASH);
    $('pitchVal').textContent = f1(target.pitch);
    $('yawVal').textContent = f1(target.yaw);
    $('rollVal').textContent = f1(target.roll);
    $('pitchMax').textContent = d1(peak.pitch);
    $('yawMax').textContent = d1(peak.yaw);
    $('mbP').textContent = d1(target.pitch);
    $('mbY').textContent = d1(target.yaw);
    $('mpyP').textContent = d1(target.pitch); $('mpyY').textContent = d1(target.yaw);
    $('mPY').classList.toggle('on', hasData);   // one-line P/Y under the mission controls on phones
    $('pitchCard').classList.toggle('limit', hasData && Math.abs(target.pitch) >= 44.5);
    $('yawCard').classList.toggle('limit', hasData && Math.abs(target.yaw) >= 44.5);

    sampleTimes = sampleTimes.filter(t => now - t < 1000);
    const rate = sampleTimes.length;
    $('rateVal').textContent = linked ? rate : DASH;
    $('feedRate').textContent = linked ? rate + ' Hz' : DASH;
    if (!linked) $('linkClock').textContent = DASH;
    else {
      const s = Math.floor((now - linkStart) / 1000);
      $('linkClock').textContent = 'T+' + [s / 3600, s / 60 % 60, s % 60].map(v => String(Math.floor(v)).padStart(2, '0')).join(':');
    }

    // Link panel + header cells
    const age = hasData ? now - lastLineT : null;
    const ageNum = age === null ? DASH : age < 1000 ? Math.round(age) : (age / 1000).toFixed(1);
    const ageUnit = age !== null && age >= 1000 ? 's' : 'ms';
    $('lastAge').textContent = age === null ? DASH : `${ageNum} ${ageUnit}`;
    $('lkAge').textContent = ageNum; $('lkAgeU').textContent = ageUnit;
    $('lineCount').textContent = $('lkLines').textContent = linked ? lineCount.toLocaleString('en-US') : DASH;
    $('lkErr').textContent = linked ? errCount.toLocaleString('en-US') : DASH;
    $('lkPort').textContent = portLabel;
    $('lkFw').textContent = linkStart === null ? '—' : fwVersion === '—' ? 'Unknown' : fwVersion;

    // Connected but nothing arriving for a second → STALE
    if (port) {
      const stale = now - (lastLineT ?? linkStart) > 1000;
      $('statusText').textContent = stale ? 'Stale' : 'Live';
      for (const id of ['dot', 'mbLive']) { $(id).classList.toggle('on', !stale); $(id).classList.toggle('stale', stale); }
    }

    // Gimbal panel
    const servoKnown = hasData && servoMode.checked && raw.pitch !== null;
    $('gsP').textContent = servoKnown ? raw.pitch.toFixed(0) : DASH;
    $('gsY').textContent = servoKnown ? raw.yaw.toFixed(0) : DASH;
    $('gdP').textContent = hasData ? sgn1(target.pitch) : DASH;
    $('gdY').textContent = hasData ? sgn1(target.yaw) : DASH;
    const sat = hasData ? Math.min(100, Math.max(Math.abs(target.pitch), Math.abs(target.yaw)) / 45 * 100) : 0;
    $('gSat').textContent = hasData ? sat.toFixed(0) : DASH;
    $('gSatBar').style.width = (100 - sat) + '%';

    // Gimbal dial: +Y to the right, +P up, ring = ±45°
    $('gDial').classList.toggle('on', hasData);
    if (hasData) {
      const k = v => Math.max(-1, Math.min(1, v / 45)) * 44, x = k(target.yaw), y = -k(target.pitch);
      $('gdDot').setAttribute('cx', x.toFixed(1)); $('gdDot').setAttribute('cy', y.toFixed(1));
      $('gdDot').classList.toggle('sat', sat >= 98);
      gTrail.push(`${x.toFixed(1)},${y.toFixed(1)}`); if (gTrail.length > 30) gTrail.shift();
    } else gTrail.length = 0;
    $('gdTrail').setAttribute('points', gTrail.join(' '));
  }
  requestAnimationFrame(animate);
}
