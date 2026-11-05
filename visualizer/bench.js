// Bench tab: the 3D test rig, Web Serial / demo feed, readouts, gimbal + link tables and chart.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import { initCalib } from './calib.js';

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
    controls.target.set(0, PIVOT_Y + 0.25, 0);   // middle of the rocket: more of it is above the CG
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

  // Rocket built from the CAD numbers (SLDP-ST-005, in mm from the tail), scaled so 1 mm = MM scene units.
  // Rough on purpose: no vents, window or screws.
  const MM = 2.25 / 632;
  const RO = 39.3, RI = 38.1;                  // body outer / bore radius
  const CG = 240;                              // desk-rig pivot
  const GIMBAL = 57;                           // TVC gimbal point
  const TUBE_R = 18, TUBE_OUT = 18;            // motor tube; sticks out past the tail so it can be seen (flush in the CAD)
  const Z_C1 = 200, Z_B = 203, Z_C2 = 357, Z_D = 375, Z_NOSE = 515, Z_CONE = 530, Z_TOP = 632;
  const FIN_ROOT = 75, FIN_TIP = 32, FIN_SPAN = 30;
  const PIVOT_Y = 1.45; // pivot height above the floor (the rocket clears it at any tilt)

  // Vertical reference line through the pivot
  const refGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, PIVOT_Y - (CG + TUBE_OUT) * MM - 0.15, 0), new THREE.Vector3(0, PIVOT_Y + (Z_TOP - CG) * MM + 0.15, 0)]);
  const refLine = new THREE.Line(refGeo, new THREE.LineDashedMaterial({ color: 0x5a6070, dashSize: 0.08, gapSize: 0.06 }));
  refLine.computeLineDistances(); scene.add(refLine);

  // Rocket group origin = rig pivot at the CG. All parts hang off "airframe", whose origin is the tail.
  const rocket = new THREE.Group();
  rocket.position.y = PIVOT_Y;
  rocket.rotation.order = 'ZXY'; // roll about own long axis first, then tilt toward X, then toward Y
  scene.add(rocket);
  const airframe = new THREE.Group();
  airframe.position.y = -CG * MM;
  rocket.add(airframe);

  // Rig collar + pivot pins at the CG (they move with the rocket)
  const metal = new THREE.MeshStandardMaterial({ color: 0x999fab, metalness: 0.7, roughness: 0.3 });
  const collar = new THREE.Mesh(new THREE.TorusGeometry((RO + 6) * MM, 4 * MM, 12, 40), metal);
  collar.rotation.x = Math.PI / 2; rocket.add(collar);
  const pinGeo = new THREE.CylinderGeometry(5 * MM, 5 * MM, 24 * MM, 12);
  [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([x, z]) => {
    const pin = new THREE.Mesh(pinGeo, metal);
    pin.position.set(x * (RO + 18) * MM, 0, z * (RO + 18) * MM);
    pin.rotation.set(z ? Math.PI / 2 : 0, 0, x ? Math.PI / 2 : 0);
    rocket.add(pin);
  });

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xdcdce6, roughness: 0.5 });
  const bandMat = new THREE.MeshStandardMaterial({ color: 0x8d9099, roughness: 0.5 });
  const noseMat = new THREE.MeshStandardMaterial({ color: 0xc82828, roughness: 0.45 });
  const finMat  = new THREE.MeshStandardMaterial({ color: 0x2838c8, roughness: 0.5, side: THREE.DoubleSide });
  const tubeMat = new THREE.MeshStandardMaterial({ color: 0x55585f, metalness: 0.7, roughness: 0.35 });
  const bay = new THREE.MeshStandardMaterial({ color: 0x101114, roughness: 0.9 });

  // Body parts A, B, D with the C1 and C2 coupler bands between them, then the nose band and cone
  function section(z0, z1, mat) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(RO * MM, RO * MM, (z1 - z0) * MM, 40), mat);
    m.position.y = (z0 + z1) / 2 * MM; m.castShadow = true; airframe.add(m);
  }
  section(0, Z_C1, bodyMat); section(Z_C1, Z_B, bandMat); section(Z_B, Z_C2, bodyMat);
  section(Z_C2, Z_D, bandMat); section(Z_D, Z_NOSE, bodyMat); section(Z_NOSE, Z_CONE, noseMat);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(RO * MM, (Z_TOP - Z_CONE) * MM, 40), noseMat);
  nose.position.y = (Z_CONE + Z_TOP) / 2 * MM; nose.castShadow = true; airframe.add(nose);

  // Open tail: the dark bore the motor tube swings in
  const tailBore = new THREE.Mesh(new THREE.CircleGeometry(RI * MM, 40), bay);
  tailBore.rotation.x = Math.PI / 2; tailBore.position.y = -0.001; airframe.add(tailBore);

  // TVC mount: the motor tube pivots about the gimbal point, in the same rotation sense as the rocket's tilt
  const tvc = new THREE.Group();
  tvc.position.y = GIMBAL * MM;
  tvc.rotation.order = 'ZXY';
  airframe.add(tvc);
  const tubeLen = GIMBAL + TUBE_OUT;
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(TUBE_R * MM, TUBE_R * MM, tubeLen * MM, 24), tubeMat);
  tube.position.y = -tubeLen / 2 * MM; tube.castShadow = true; tvc.add(tube);

  // Fins: root along the body at the tail, swept leading edge, clocked at 45/135/225/315° as in the CAD
  const finShape = new THREE.Shape();
  finShape.moveTo(0, 0); finShape.lineTo(FIN_SPAN * MM, 0); finShape.lineTo(FIN_SPAN * MM, FIN_TIP * MM); finShape.lineTo(0, FIN_ROOT * MM); finShape.closePath();
  const finGeo = new THREE.ShapeGeometry(finShape);
  for (let i = 0; i < 4; i++) {
    const holder = new THREE.Group();
    holder.rotation.y = Math.PI / 4 + (Math.PI / 2) * i;
    const fin = new THREE.Mesh(finGeo, finMat);
    fin.position.set(RO * MM, 0, 0);
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
  // pitch/yaw = X/Y servo deflection from neutral (charts, readouts, dial); tiltX/tiltY = the rocket's attitude (3D view)
  const target = { roll: 0, pitch: 0, yaw: 0, tiltX: 0, tiltY: 0 };
  const shown  = { roll: 0, pitch: 0, yaw: 0, tiltX: 0, tiltY: 0 };
  const zero   = { roll: 0, pitch: 0, yaw: 0, tiltX: 0, tiltY: 0 };
  const NO_CFG = { xd: 1, yd: 1, tx: 0, ty: 0, spg: 4 };
  let rig = { ...NO_CFG };   // from the Nano's CFG line: servo direction, level trims, servo degrees per gimbal degree
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
    if (line === 'FREE,ON' || line === 'FREE,OFF') { logLine(line, 'msg'); setFree(line === 'FREE,ON'); return; }   // firmware v1.5.0+
    // Calibration traffic (firmware v1.2.0+): CFG,… / CAL,ON|OFF / ERR,… and, in calibration, CAL,xServo,yServo,tiltX,tiltY
    if (/^(CAL|CFG|ERR|ABORT),/.test(line)) {   // ABORT,TILT / ABORT,CLEAR: firmware v1.3.0+ tilt abort
      const cal = line.match(/^CAL,(-?\d+),(-?\d+),(-?[\d.]+),(-?[\d.]+)/);
      logLine(line, cal ? undefined : 'msg');
      if (line.startsWith('CFG,')) {
        const p = line.split(',').map(Number);
        rig = { xd: p[3], yd: p[4], tx: p[5], ty: p[6], spg: p[7] };
      }
      calib.handle(line);
      // Show the held servo positions on the rig and gimbal dial while calibrating
      if (cal) {
        const tx = cal[3] - rig.tx, ty = cal[4] - rig.ty;
        if (servoMode.checked) applySample(target.roll + zero.roll, +cal[1], +cal[2], tx, ty);
        else applySample(target.roll + zero.roll, tx, ty);
      }
      return;
    }
    const parts = line.split(',').map(s => parseFloat(s));
    if (parts.length < 3 || parts.slice(0, 3).some(v => !Number.isFinite(v))) { errCount++; logLine(line, 'msg'); return; } // boot messages etc.
    logLine(line);
    applySample(...parts.slice(0, 5));   // roll, X servo, Y servo, then tiltX, tiltY from firmware v1.6.0+
  }

  function applySample(roll, pitch, yaw, tiltX, tiltY) {
    raw.pitch = pitch; raw.yaw = yaw;
    if (servoMode.checked) {
      pitch -= 90; yaw -= 90;
      // Older firmware doesn't send the tilt: the rocket stays upright and only the motor tube moves
      target.tiltX = Number.isFinite(tiltX) ? tiltX - zero.tiltX : 0;
      target.tiltY = Number.isFinite(tiltY) ? tiltY - zero.tiltY : 0;
    } else {
      target.tiltX = pitch - zero.pitch;
      target.tiltY = yaw - zero.yaw;
    }
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
    for (const a of Object.keys(zero)) { zero[a] += target[a]; target[a] = 0; }
    peak.pitch = peak.yaw = 0;
  };
  servoMode.onchange = () => { for (const a of Object.keys(zero)) zero[a] = 0; };
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

  // Free-test: the button only follows what the Nano reports, and the Nano starts with it off
  let freeOn = false;
  function setFree(on) { freeOn = on; $('freeBtn').classList.toggle('on', on); }
  $('freeBtn').onclick = () => send(freeOn ? 'FREE OFF' : 'FREE ON');

  function startLink(label) {
    $('serialLog').textContent = '';
    linkStart = performance.now(); lastLineT = null; lineCount = errCount = 0;
    peak.pitch = peak.yaw = 0; raw.pitch = raw.yaw = null; portLabel = label; fwVersion = label === 'Demo' ? 'Demo' : '—';
    rig = { ...NO_CFG };
    setFree(false); $('freeBtn').disabled = !port;
    calib.onLink();
  }
  function endLink() { linkStart = lastLineT = null; portLabel = '—'; setFree(false); $('freeBtn').disabled = true; calib.onLink(); }

  // Commands to the Nano (calibration). Writes are chained so two quick clicks can't fight over the writer lock.
  const enc = new TextEncoder();
  let writeChain = Promise.resolve();
  function send(cmd) {
    if (!port?.writable) return;
    logLine('› ' + cmd, 'tx');
    writeChain = writeChain.then(async () => {
      const w = port.writable.getWriter();
      try { await w.write(enc.encode(cmd + '\n')); } finally { w.releaseLock(); }
    }).catch(e => logLine('Send failed: ' + e.message, 'msg'));
  }
  const calib = initCalib({ send, link: () => ({ port: !!port, demo: !!demoTimer, fw: fwVersion }) });
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
      // A rocket wandering by a few degrees, with servos answering through the firmware's controller at full throttle
      const tx = 5 * Math.sin(t * 0.9) + 0.8 * Math.sin(t * 3.1), rateX = 4.5 * Math.cos(t * 0.9) + 2.5 * Math.cos(t * 3.1);
      const ty = 4 * Math.sin(t * 0.6 + 1.2), rateY = 2.4 * Math.cos(t * 0.6 + 1.2);
      const servo = (tilt, rate) => 90 + Math.round(Math.max(-8, Math.min(8, 0.68 * (2.5 * tilt + 0.55 * rate))) * rig.spg);
      handleLine(servoMode.checked ? `0,${servo(tx, rateX)},${servo(ty, rateY)},${tx.toFixed(1)},${ty.toFixed(1)}` : `0,${tx.toFixed(1)},${ty.toFixed(1)}`);
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
  let lastUi = 0, warmed = false;
  function animate(now) {
    requestAnimationFrame(animate);
    const k = smooth.checked ? 0.18 : 1;
    for (const a of Object.keys(shown)) shown[a] += (target[a] - shown[a]) * k;

    rocket.rotation.set(deg(shown.tiltX), deg(shown.roll), deg(-shown.tiltY));
    // Nozzle angle = servo deflection ÷ linkage ratio (attitude data says nothing about the servos, so the tube stays centred)
    const servoData = servoMode.checked;
    tvc.rotation.set(servoData ? deg(shown.pitch * rig.xd / rig.spg) : 0, 0, servoData ? deg(-shown.yaw * rig.yd / rig.spg) : 0);
    controls.update();
    fenceTarget();
    // One warm-up frame (uploads textures to the GPU), then skip drawing while the loading screen covers everything
    const covered = warmed && window.tvcCovered?.();
    if (!covered && view.clientWidth > 1 && view.clientHeight > 1) { (outlineOn ? outlineFx : renderer).render(scene, camera); warmed = true; }

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
