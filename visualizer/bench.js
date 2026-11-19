// Bench tab: the 3D test rig, Web Serial / demo feed, readouts, gimbal + link tables and chart.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createWorkshop } from './workshop.js';
import { initCalib } from './calib.js';
import { initLaser } from './laser.js';
import { initThrottle } from './throttle.js';
import { initVector } from './vector.js';
import { initSysCheck } from './syscheck.js';
import { createDemoSim } from './demo-sim.js';

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
    controls.maxDistance = Math.max(11, fitDistance() * viewScale() * 1.5);   // tall, narrow windows need more room to fit the rocket
  }
  const _tClamp = new THREE.Vector3();
  function fenceTarget() {
    _tClamp.set(THREE.MathUtils.clamp(controls.target.x, -GRID_HALF, GRID_HALF),
                THREE.MathUtils.clamp(controls.target.y, rigScene ? FLOOR_RIG : 0, PIVOT_Y * 2),
                THREE.MathUtils.clamp(controls.target.z, -GRID_HALF, GRID_HALF)).sub(controls.target);
    if (_tClamp.lengthSq()) { controls.target.add(_tClamp); camera.position.add(_tClamp); }
  }
  // The desk-rig scene also shows the table, so it frames lower and further out
  const viewScale = () => (rigScene ? 1.75 : 1);
  function resetView() {
    if (rigScene) controls.target.set(0, PIVOT_Y - 0.7, -0.9);
    else controls.target.set(0, PIVOT_Y + 0.25, 0);   // middle of the rocket: more of it is above the CG
    setZoomLimits();
    camera.position.copy(controls.target).addScaledVector(VIEW_DIR, fitDistance() * viewScale());
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

  // Rocket built from the CAD numbers (SLDP-ST-008, batch-002, in mm from the tail), scaled so 1 mm = MM scene units.
  // Rough on purpose: no vents, notch, window or screws. Ogive nose with ship flaps, hot-staging band, grid fins,
  // strakes, bay door, TVC gimbal at 37 mm with the motor tube 57 mm below it.
  const MM = 2.25 / 632;
  const RO = 39.3, RI = 38.1;                  // body outer / bore radius
  const CG = 247;                              // desk-rig pivot (SLDP-GS-001: pivot 247 mm above the tail, on the CG)
  const GIMBAL = 37;                           // TVC gimbal point (SLDP-TVC-002)
  const TUBE_R = 18, TUBE_BELOW = 57, TUBE_ABOVE = 10;   // motor tube: bottom 57 below the gimbal (20 past the tail)
  const Z_C1 = 200, Z_B = 203, Z_C2 = 357, Z_D = 375, Z_NOSE = 515, Z_CONE = 530, NOSE_L = 1.3 * 2 * RO, Z_TOP = Z_CONE + NOSE_L;
  const PIVOT_Y = 1.45; // pivot height above the floor (the rocket clears it at any tilt)

  // Vertical reference line through the pivot
  const refGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, PIVOT_Y - (CG + TUBE_BELOW - GIMBAL) * MM - 0.15, 0), new THREE.Vector3(0, PIVOT_Y + (Z_TOP - CG) * MM + 0.15, 0)]);
  const refLine = new THREE.Line(refGeo, new THREE.LineDashedMaterial({ color: 0x5a6070, dashSize: 0.08, gapSize: 0.06 }));
  refLine.computeLineDistances(); scene.add(refLine);

  // Rocket group origin = rig pivot at the CG. All parts hang off "airframe", whose origin is the tail.
  // Rotation = the rig's gimbal chain: outer pivot (scene X = rocket +Y axis), then inner pivot (scene Z = rocket +X),
  // then roll about the rocket's own axis. See animate().
  const rocket = new THREE.Group();
  rocket.position.y = PIVOT_Y;
  rocket.rotation.order = 'XZY';
  scene.add(rocket);
  const airframe = new THREE.Group();
  airframe.position.y = -CG * MM;
  rocket.add(airframe);

  // Generic rig collar + pivot pins at the CG (the plain scene; the desk-rig scene has the real rig instead)
  const metal = new THREE.MeshStandardMaterial({ color: 0x999fab, metalness: 0.7, roughness: 0.3 });
  const plainRig = new THREE.Group();
  rocket.add(plainRig);
  const collar = new THREE.Mesh(new THREE.TorusGeometry((RO + 6) * MM, 4 * MM, 12, 40), metal);
  collar.rotation.x = Math.PI / 2; plainRig.add(collar);
  const pinGeo = new THREE.CylinderGeometry(5 * MM, 5 * MM, 24 * MM, 12);
  [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([x, z]) => {
    const pin = new THREE.Mesh(pinGeo, metal);
    pin.position.set(x * (RO + 18) * MM, 0, z * (RO + 18) * MM);
    pin.rotation.set(z ? Math.PI / 2 : 0, 0, x ? Math.PI / 2 : 0);
    plainRig.add(pin);
  });

  // Booster (parts A, B, couplers, strakes, door): light stainless steel. Ship (part D, nose band, ogive, flaps) and
  // grid fins: black.
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xdfe2e6, metalness: 0.35, roughness: 0.33 });
  const bandMat = new THREE.MeshStandardMaterial({ color: 0xaeb2b9, metalness: 0.4, roughness: 0.35 });
  const doorMat = new THREE.MeshStandardMaterial({ color: 0xc8cbd0, metalness: 0.35, roughness: 0.4 });
  const gridMat = new THREE.MeshStandardMaterial({ color: 0x16171a, metalness: 0.3, roughness: 0.6 });
  const tubeMat = new THREE.MeshStandardMaterial({ color: 0x55585f, metalness: 0.7, roughness: 0.35 });
  const shipMat = gridMat, shipBandMat = gridMat, noseMat = gridMat;
  const finMat = new THREE.MeshStandardMaterial({ color: 0x16171a, metalness: 0.3, roughness: 0.6, side: THREE.DoubleSide });
  const bay = new THREE.MeshStandardMaterial({ color: 0x101114, roughness: 0.9 });

  // CAD angle a (0° = rocket +X, 90° = +Y) → scene direction (sin a, 0, cos a): rocket +X is scene +Z, +Y is scene +X.
  // A child of radial(a) built along its local +X points that way.
  const rad = d => d * Math.PI / 180;
  function radial(a, obj) { const g = new THREE.Group(); g.rotation.y = rad(a - 90); g.add(obj); airframe.add(g); return obj; }
  // Box in a radial frame: r0..r1 out from the axis, z0..z1 up from the tail, w wide (tangential)
  function radialBox(a, r0, r1, z0, z1, w, mat) {
    const m = new THREE.Mesh(new THREE.BoxGeometry((r1 - r0) * MM, (z1 - z0) * MM, w * MM), mat);
    m.position.set((r0 + r1) / 2 * MM, (z0 + z1) / 2 * MM, 0); m.castShadow = true;
    return radial(a, m);
  }
  // Flat plate from a (r, z) outline, thickness t, in a radial plane
  function radialPlate(a, pts, t, mat) {
    const s = new THREE.Shape(pts.map(([r, z]) => new THREE.Vector2(r * MM, z * MM)));
    const g = new THREE.ExtrudeGeometry(s, { depth: t * MM, bevelEnabled: false });
    g.translate(0, 0, -t / 2 * MM);
    const m = new THREE.Mesh(g, mat); m.castShadow = true; m.userData.plate = true;
    return radial(a, m);
  }

  // Body parts A, B, D with the C1 and C2 coupler bands between them, then the nose band
  function section(z0, z1, mat) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(RO * MM, RO * MM, (z1 - z0) * MM, 48), mat);
    m.position.y = (z0 + z1) / 2 * MM; m.castShadow = true; airframe.add(m);
  }
  section(0, Z_C1, bodyMat); section(Z_C1, Z_B, bandMat); section(Z_B, Z_C2, bodyMat);
  section(Z_C2, Z_D, bandMat); section(Z_D, Z_NOSE, shipMat); section(Z_NOSE, Z_CONE, shipBandMat);

  // Tangent-ogive nose (length 1.3 × OD) with a blunt 4 mm tip
  {
    const rho = (RO * RO + NOSE_L * NOSE_L) / (2 * RO), pts = [];
    for (let i = 0; i <= 32; i++) {
      const x = NOSE_L * i / 32, r = Math.sqrt(Math.max(rho * rho - x * x, 0)) + RO - rho;
      if (r < 4) { pts.push(new THREE.Vector2(0, (Z_CONE + x) * MM)); break; }
      pts.push(new THREE.Vector2(r * MM, (Z_CONE + x) * MM));
    }
    if (pts.at(-1).x > 0) pts.push(new THREE.Vector2(0, Z_TOP * MM));
    const nose = new THREE.Mesh(new THREE.LatheGeometry(pts, 48), noseMat);
    nose.castShadow = true; airframe.add(nose);
    // Forward ship flaps at 0° and 180°, on the ogive (start 10, end 58 above its base; span 14 → 5)
    const nr = x => Math.sqrt(Math.max(rho * rho - x * x, 0)) + RO - rho;
    for (const a of [0, 180]) {
      const root = Array.from({ length: 12 }, (_, i) => 10 + 48 * i / 11).map(x => [nr(x) - 0.8, Z_CONE + x]);
      radialPlate(a, [...root, [nr(58) + 5, Z_CONE + 58], [nr(10) + 14, Z_CONE + 10 + 14]], 1.6, finMat);
    }
  }
  // Aft ship flaps at 0° and 180°: from the D bottom, root 70, tip 42, span 22
  for (const a of [0, 180]) radialPlate(a, [[RO - 0.6, Z_D], [RO + 22, Z_D], [RO + 22, Z_D + 42], [RO - 0.6, Z_D + 70]], 2, finMat);

  // Hot-staging band (C2): 20 dark pockets around the 18 mm interstage ring
  for (let k = 0; k < 20; k++) radialBox(360 * (k + 0.5) / 20, RO - 0.4, RO + 0.15, (Z_C2 + Z_D) / 2 - 6, (Z_C2 + Z_D) / 2 + 6, 4, bay);

  // Grid fins at 45/135/225/315°: z 340–348, 22 wide, 18 out past a 2 mm pad; 45° diamond lattice, cells open along z
  {
    const z0 = 340, z1 = 348, r0 = RO + 2, r1 = RO + 20, w = 22, wall = 1;
    for (const a of [45, 135, 225, 315]) {
      radialBox(a, RO - 0.2, r0, z0, z1, w * 0.75, gridMat);                       // root pad
      radialBox(a, r0, r1, z0, z1, wall, gridMat).position.z = (w - wall) / 2 * MM; // frame sides
      radialBox(a, r0, r1, z0, z1, wall, gridMat).position.z = -(w - wall) / 2 * MM;
      radialBox(a, r1 - wall, r1, z0, z1, w, gridMat);                              // frame tip
      // lattice: diagonal bars clipped to the frame, as boxes along ±45° (each spans corner to corner of its cell row)
      const cx = (r0 + r1) / 2, hx = (r1 - r0) / 2 - wall, hz = w / 2 - wall;
      for (const sgn of [1, -1]) for (let k = -40; k <= 40; k += 5) {
        // line: r = cx + t, tang = sgn·t + k·√2 ; clip to |r−cx| ≤ hx, |tang| ≤ hz
        let t0 = -hx, t1 = hx;
        const lo = (-hz - k * Math.SQRT2) * sgn, hi = (hz - k * Math.SQRT2) * sgn;
        t0 = Math.max(t0, Math.min(lo, hi)); t1 = Math.min(t1, Math.max(lo, hi));
        if (t1 - t0 < 1) continue;
        const len = (t1 - t0) * Math.SQRT2, tm = (t0 + t1) / 2;
        const bar = new THREE.Mesh(new THREE.BoxGeometry(len * MM, (z1 - z0) * MM, wall * 0.8 * MM), gridMat);
        bar.position.set((cx + tm) * MM, (z0 + z1) / 2 * MM, (sgn * tm + k * Math.SQRT2) * MM);
        bar.rotation.y = -sgn * Math.PI / 4;
        radial(a, bar);
      }
    }
  }
  // Strakes on part A at 55/145/235/325°: z 40–170, 3.5 wide, 1.5 proud, 45° ends
  for (const a of [55, 145, 235, 325]) radialPlate(a, [[RO - 0.4, 40], [RO + 1.5, 41.9], [RO + 1.5, 168.1], [RO - 0.4, 170]], 3.5, bandMat);
  // Avionics bay door at 90° on part B (flange 52 wide, z 243–330)
  {
    const w = 52 / RO, door = new THREE.Mesh(new THREE.CylinderGeometry((RO + 0.7) * MM, (RO + 0.7) * MM, 87 * MM, 12, 1, true, rad(90) - w / 2, w), doorMat);
    door.position.y = (243 + 330) / 2 * MM; door.material.side = THREE.DoubleSide; airframe.add(door);
  }

  // Open tail: the dark bore the motor tube swings in
  const tailBore = new THREE.Mesh(new THREE.CircleGeometry(RI * MM, 40), bay);
  tailBore.rotation.x = Math.PI / 2; tailBore.position.y = -0.001; airframe.add(tailBore);

  // TVC mount: the motor tube pivots about the gimbal point, in the same rotation sense as the rocket's tilt
  const tvc = new THREE.Group();
  tvc.position.y = GIMBAL * MM;
  tvc.rotation.order = 'XZY';   // the K-9 chain: inner gimbal about scene X (rocket Y axis), then the tube about scene Z
  airframe.add(tvc);
  const tubeLen = TUBE_BELOW + TUBE_ABOVE;
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(TUBE_R * MM, TUBE_R * MM, tubeLen * MM, 24), tubeMat);
  tube.position.y = (TUBE_ABOVE - TUBE_BELOW) / 2 * MM; tube.castShadow = true; tvc.add(tube);

  // Small axis gizmo at the pivot
  const axes = new THREE.AxesHelper(0.5); axes.position.y = PIVOT_Y; scene.add(axes);

  // ---------- Desk-rig scene (SLDP-GS-001 Rev B): the rocket on the 2-axis rig, the rig clamped to a table ----------
  // Rig frame as in the CAD: origin = pivot, x = rocket 0° (scene +Z), y = rocket 90° (scene +X), z up.
  // The arm runs along −x onto the desk; the desk top is 40 mm below the pivot, its edge 220 mm from the axis.
  const DESK_H = 40, REACH = 220, TABLE_D = 700, TABLE_W = 1200, TABLE_T = 25, TABLE_H = 740;
  const FLOOR_RIG = PIVOT_Y - (DESK_H + TABLE_H) * MM;      // floor height in the rig scene
  const pla = new THREE.MeshStandardMaterial({ color: 0xc9ccd3, roughness: 0.6 });
  const plaDark = new THREE.MeshStandardMaterial({ color: 0x8e939d, roughness: 0.6 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x6d7380, metalness: 0.6, roughness: 0.4 });
  const wood = new THREE.MeshStandardMaterial({ color: 0xd2b48c, roughness: 0.55 });   // birch top
  const legMat = new THREE.MeshStandardMaterial({ color: 0xe4e6ea, metalness: 0.3, roughness: 0.4 });   // white steel legs
  // rig (x, y, z) mm → scene; box from rig-frame bounds
  const rigBox = (parent, x0, x1, y0, y1, z0, z1, mat) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry((y1 - y0) * MM, (z1 - z0) * MM, (x1 - x0) * MM), mat);
    m.position.set((y0 + y1) / 2 * MM, (z0 + z1) / 2 * MM, (x0 + x1) / 2 * MM);
    m.castShadow = m.receiveShadow = true; parent.add(m); return m;
  };
  const ring = (parent, r0, r1, h, mat) => {
    const m = new THREE.Mesh(new THREE.LatheGeometry([[r0, -h / 2], [r1, -h / 2], [r1, h / 2], [r0, h / 2], [r0, -h / 2]].map(([r, z]) => new THREE.Vector2(r * MM, z * MM)), 64), mat);
    m.castShadow = true; parent.add(m); return m;
  };
  const pinX = (parent, x0, x1) => {            // pivot screw along rig x (scene Z)
    const m = new THREE.Mesh(new THREE.CylinderGeometry(1.6 * MM, 1.6 * MM, Math.abs(x1 - x0) * MM, 10), steel);
    m.rotation.x = Math.PI / 2; m.position.z = (x0 + x1) / 2 * MM; parent.add(m); return m;
  };
  const pinY = (parent, y0, y1) => {            // along rig y (scene X)
    const m = new THREE.Mesh(new THREE.CylinderGeometry(1.6 * MM, 1.6 * MM, Math.abs(y1 - y0) * MM, 10), steel);
    m.rotation.z = Math.PI / 2; m.position.x = (y0 + y1) / 2 * MM; parent.add(m); return m;
  };
  // On the rocket (moves with it): collar band z 205–225 from the tail, pivot tabs at 0/180° (rig ±x)
  const rigOnRocket = new THREE.Group(); rocket.add(rigOnRocket);
  {
    const z0 = 205 - CG, z1 = 225 - CG;
    const c = ring(rigOnRocket, RO + 0.1, RO + 3, z1 - z0, pla); c.position.y = (z0 + z1) / 2 * MM;
    for (const s of [1, -1]) {
      rigBox(rigOnRocket, s > 0 ? RO + 3 : -47.3, s > 0 ? 47.3 : -(RO + 3), -9, 9, z0, z1, pla);   // collar pads
      rigBox(rigOnRocket, s > 0 ? 47.3 : -50.8, s > 0 ? 50.8 : -47.3, -8, 8, z0, 13, pla);         // pivot tabs, up to the pin
    }
  }
  // Middle ring: turns about the outer pivot (rig y) with the rocket; carries the inner pivots (rig x)
  const middle = new THREE.Group(); middle.position.y = PIVOT_Y; middle.rotation.order = 'XYZ';
  ring(middle, 62, 68, 10, pla);
  for (const s of [1, -1]) {
    rigBox(middle, s > 0 ? 51.8 : -63, s > 0 ? 63 : -51.8, -8, 8, -5, 12, pla);   // inner bosses
    rigBox(middle, -8, 8, s > 0 ? 67 : -74, s > 0 ? 74 : -67, -5, 12, pla);       // outer bosses
  }
  pinX(middle, -75, 75);
  // Fixed: outer ring + arm stub + flange, arm, base, 2 C-clamps, table, floor
  const rigFixed = new THREE.Group(); rigFixed.position.y = PIVOT_Y;
  ring(rigFixed, 75, 83, 10, pla);
  for (const s of [1, -1]) rigBox(rigFixed, -18, 18, s > 0 ? 75 : -83, s > 0 ? 83 : -75, -5, 12, pla);
  pinY(rigFixed, -90, 90);
  rigBox(rigFixed, -115, -81, -12, 12, -5, 25, pla);                 // arm stub
  rigBox(rigFixed, -125, -115, -20, 20, -5, 30, plaDark);            // bolted flange (both halves)
  rigBox(rigFixed, -305, -125, -12, 12, -5, 25, plaDark);            // arm
  rigBox(rigFixed, -305, -230, -35, 35, -DESK_H, -DESK_H + 8, plaDark);   // base, with its clamp ledges
  rigBox(rigFixed, -305, -230, -21, 21, -DESK_H + 8, -5, plaDark);
  const nProcFixed = rigFixed.children.length;                       // the parts above are replaced by the CAD model once it loads
  for (const s of [1, -1]) {                                         // C-clamps on the ledges, reaching round the desk edge
    const y = s * 28;
    rigBox(rigFixed, -255, -REACH + 12, y - 4, y + 4, -DESK_H + 8, -DESK_H + 14, steel);                 // top jaw
    rigBox(rigFixed, -REACH + 4, -REACH + 12, y - 4, y + 4, -DESK_H - TABLE_T - 14, -DESK_H + 14, steel); // spine
    rigBox(rigFixed, -255, -REACH + 12, y - 4, y + 4, -DESK_H - TABLE_T - 14, -DESK_H - TABLE_T - 8, steel); // bottom jaw
    rigBox(rigFixed, -244, -238, y - 3, y + 3, -DESK_H - TABLE_T - 8, -DESK_H - TABLE_T, steel);       // screw pad
  }
  const tableTop = rigBox(rigFixed, -REACH - TABLE_D, -REACH, -TABLE_W / 2, TABLE_W / 2, -DESK_H - TABLE_T, -DESK_H, wood);
  tableTop.castShadow = false;
  for (const x of [-REACH - 40, -REACH - TABLE_D + 40]) for (const y of [-TABLE_W / 2 + 40, TABLE_W / 2 - 40])
    rigBox(rigFixed, x - 20, x + 20, y - 20, y + 20, -DESK_H - TABLE_H, -DESK_H - TABLE_T, legMat);
  scene.add(middle, rigFixed);
  const rigMeshes = [];
  [rigOnRocket, middle, rigFixed].forEach(g => g.traverse(o => { if (o.isMesh) rigMeshes.push(o); }));

  let rigScene = false;
  try { rigScene = localStorage.getItem('tvc-bench-scene') === 'rig'; } catch {}
  const tableParts = rigFixed.children.slice(nProcFixed);
  let detail = false;            // the CAD model (models/sldp45.glb) has loaded
  const rigOnly = [];             // with the CAD model: arm, base, table, clamps (the rings also show in the plain view)
  function applyScene() {
    plainRig.visible = !rigScene && !detail;
    rigOnRocket.visible = rigScene && !detail;
    middle.visible = rigFixed.visible = rigScene || detail;
    tableParts.forEach(o => { o.visible = rigScene; });   // table + clamps
    workshop.group.visible = rigScene;
    rigOnly.forEach(o => { o.visible = rigScene; });
    const fy = rigScene ? FLOOR_RIG : 0;
    grid.position.y = fy; floor.position.y = fy;
    grid.visible = floor.visible = !rigScene;   // the workshop has its own concrete floor
    sun.intensity = rigScene ? 0.55 : 1.4;       // softer shadows indoors; the workshop's ceiling panels light the room
    $('sceneBtn')?.classList.toggle('on', rigScene);
    $('sceneBtn')?.setAttribute('aria-pressed', String(rigScene));
    resetView();
  }

  // Outline view: black fills + white silhouettes (OutlineEffect's inverted hull) + white fin edges
  const outlineFx = new OutlineEffect(renderer, { defaultThickness: 0.005, defaultColor: [1, 1, 1], defaultAlpha: 1 });
  const noOutline = { visible: false };
  [grid.material, floor.material, refLine.material, axes.material].forEach(m => { m.userData.outlineParameters = noOutline; });
  const fillMat = new THREE.MeshBasicMaterial({ color: 0x050506 });
  const finFillMat = new THREE.MeshBasicMaterial({ color: 0x050506, side: THREE.DoubleSide });
  const edgeMat = new THREE.LineBasicMaterial({ color: 0xffffff });
  finFillMat.userData.outlineParameters = edgeMat.userData.outlineParameters = noOutline; // thin plates: edges only
  const rocketMeshes = [];
  airframe.traverse(o => { if (o.isMesh) rocketMeshes.push(o); });
  plainRig.traverse(o => { if (o.isMesh) rocketMeshes.push(o); });
  function prepOutline(list) {
    list.forEach(m => {
      if (m.userData.solidMat) return;
      m.userData.solidMat = m.material;
      const plate = !!m.userData.plate;
      m.userData.lineMat = plate ? finFillMat : fillMat;
      if (plate) { const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), edgeMat); e.visible = false; m.add(e); m.userData.edges = e; }
    });
  }
  prepOutline([...rocketMeshes, ...rigMeshes]);
  let outlineOn = false;
  function setOutline(on) {
    outlineOn = on;
    [...rocketMeshes, ...rigMeshes].forEach(m => {
      m.material = on ? m.userData.lineMat : m.userData.solidMat;
      if (m.userData.edges) m.userData.edges.visible = on;
    });
  }

  // ---------- Detailed model from the CAD (SLDP45 full GA with desk rig, STEP → models/sldp45.glb) ----------
  // Built by cad/lib/step2glb.py: one mesh per part named "<group>|<colour>|<part>", in mm, already in scene axes
  // (rocket +X → +Z, +Y → +X, z → up), tail at 0, rig pivot at 247. The simple model above stands in until it loads.
  // Groups: rocket (moves with the rocket), inner (TVC inner gimbal + riding servo: turns with the X nozzle angle),
  // tube (motor tube: both angles), middle (rig middle ring), fixed (outer ring, arm, base).
  const procAirframe = airframe.children.filter(o => o !== tvc);   // the simple model's parts, replaced on load
  const innerG = new THREE.Group(); innerG.position.y = GIMBAL * MM; airframe.add(innerG);
  const sledMat = new THREE.MeshStandardMaterial({ color: 0x3d5a46, roughness: 0.7 });
  const kGimbalMat = new THREE.MeshStandardMaterial({ color: 0x4a4f58, roughness: 0.6 });
  const servoMat = new THREE.MeshStandardMaterial({ color: 0x1c2333, roughness: 0.5 });
  const CAD_MAT = { steel_body: bodyMat, steel_band: bandMat, steel_door: doorMat, black: gridMat, sled: sledMat,
                    gimbal: kGimbalMat, servo: servoMat, tube: tubeMat, pla, pla2: plaDark, steel };
  new GLTFLoader().load('models/sldp45.glb', gltf => {
    const parts = [];
    gltf.scene.traverse(o => { if (o.isMesh) parts.push(o); });
    if (!parts.length) return;
    // Out with the stand-ins (keep the plume, arrow, the inner-gimbal group and the table + clamps)
    procAirframe.forEach(o => airframe.remove(o));
    tvc.remove(tube);
    middle.clear();
    rigFixed.children.filter(o => !tableParts.includes(o)).forEach(o => rigFixed.remove(o));
    for (const m of parts) {
      const [grp, col, name] = m.name.split('|');
      const mesh = new THREE.Mesh(m.geometry, CAD_MAT[col] || pla);
      mesh.name = name; mesh.geometry.computeVertexNormals();
      mesh.scale.setScalar(MM); mesh.castShadow = true; mesh.receiveShadow = grp !== 'rocket';
      if (grp === 'inner') { mesh.position.y = -GIMBAL * MM; innerG.add(mesh); }
      else if (grp === 'tube') { mesh.position.y = -GIMBAL * MM; tvc.add(mesh); }
      else if (grp === 'middle') { mesh.position.y = -CG * MM; middle.add(mesh); }
      else if (grp === 'fixed') { mesh.position.y = -CG * MM; rigFixed.add(mesh); if (/^(5 Arm|6 Base)/.test(name)) rigOnly.push(mesh); }
      else airframe.add(mesh);
    }
    rocketMeshes.length = 0;
    airframe.traverse(o => { if (o.isMesh && !(o.material instanceof THREE.ShaderMaterial) && o.parent !== forceArrow) rocketMeshes.push(o); });
    rigMeshes.length = 0;
    [middle, rigFixed].forEach(g => g.traverse(o => { if (o.isMesh) rigMeshes.push(o); }));
    prepOutline([...rocketMeshes, ...rigMeshes]);
    setOutline(outlineOn);
    detail = true;
    applyScene();
  }, undefined, err => console.warn('Detailed model not loaded, using the simple one:', err));

  // ---------- Workshop around the desk rig (workshop.js): supply, laptop, kill switch, beacon, cables, test props ----------
  const workshop = createWorkshop({ MM, PIVOT_Y, DESK_H, TABLE_H, airframe, tvc, TUBE_BELOW, RO });
  scene.add(workshop.group);

  // ---------- Thrust: plume out of the motor tube, arrow for the sideways force it puts on the rocket ----------
  // Added after the outline list above, so outline view leaves them as they are.
  function plumeMaterial(color, strength) {
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(color) }, uK: { value: strength } },
      vertexShader: `varying float vY; varying vec3 vN; varying vec3 vV;
        void main(){ vY = position.y; vec4 mv = modelViewMatrix*vec4(position,1.0);
          vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `uniform vec3 uColor; uniform float uK; varying float vY; varying vec3 vN; varying vec3 vV;
        void main(){ float along = pow(clamp(1.0 + vY, 0.0, 1.0), 1.6);      // bright at the tube, fades to the tip
          float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.3);       // soft silhouette
          gl_FragColor = vec4(uColor * along * edge * uK, 1.0); }`
    });
    m.userData.outlineParameters = noOutline;
    return m;
  }
  const PLUME_LEN = 130 * MM, PLUME_R = TUBE_R * 1.1 * MM;   // short enough to clear the floor
  const plumeGeo = new THREE.ConeGeometry(1, 1, 24, 1, true); plumeGeo.rotateX(Math.PI); plumeGeo.translate(0, -0.5, 0);
  const plume = new THREE.Group();
  const plumeOuter = new THREE.Mesh(plumeGeo, plumeMaterial(0x4f8fd8, 0.8));
  const plumeInner = new THREE.Mesh(plumeGeo, plumeMaterial(0xd8ecff, 1));   // the EDF blows air, so cool colours, not fire
  plumeInner.scale.set(0.5, 0.6, 0.5);
  plume.add(plumeOuter, plumeInner);
  plume.position.y = -TUBE_BELOW * MM; plume.visible = false;
  tvc.add(plume);

  const ARROW_AT_LIMIT = 0.45;   // scene units at the full ±8°
  const forceArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, GIMBAL * MM, 0), ARROW_AT_LIMIT, 0xf5a623, 0.08, 0.055);
  [forceArrow.line, forceArrow.cone].forEach(o => {
    o.material.depthTest = false; o.material.transparent = true;   // the gimbal point is inside the body: draw it on top
    o.material.userData.outlineParameters = noOutline;
    o.renderOrder = 5;
  });
  forceArrow.visible = false;
  airframe.add(forceArrow);

  const _lateral = new THREE.Vector3();
  // gx, gy = nozzle angle in degrees. level = 1 for full thrust, lower when no motor is actually running.
  function updateThrust(on, gx, gy, level) {
    plume.visible = on;
    forceArrow.visible = false;
    if (!on) return;
    const flicker = 0.92 + Math.random() * 0.16;
    plume.scale.set(PLUME_R, PLUME_LEN * flicker, PLUME_R);
    plumeOuter.material.uniforms.uK.value = 0.8 * level;
    plumeInner.material.uniforms.uK.value = level;
    // Rocket +X is scene +Z and +Y is scene +X. A positive nozzle angle pushes the tail toward that side.
    _lateral.set(Math.sin(gy * Math.PI / 180), 0, Math.sin(gx * Math.PI / 180));
    const size = _lateral.length() / Math.sin(8 * Math.PI / 180);
    if (size < 0.03) return;
    forceArrow.visible = true;
    forceArrow.setDirection(_lateral.normalize());
    forceArrow.setLength(Math.max(0.1, size * ARROW_AT_LIMIT), 0.08, 0.055);
    forceArrow.line.material.opacity = forceArrow.cone.material.opacity = Math.max(level, 0.6);
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
    camera.position.copy(controls.target).addScaledVector(dir, fitDistance() * viewScale());
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
  const NO_CFG = { xd: 1, yd: 1, tx: 0, ty: 0, spg: 4, spgy: 4 };
  let rig = { ...NO_CFG };   // from the Nano's CFG line: servo direction, level trims, servo degrees per gimbal degree
  const history = []; // {t, tiltX, tiltY}
  const peak   = { pitch: 0, yaw: 0 }; // largest-magnitude value since connect / zero
  let sampleTimes = [];
  let linkStart = null;                // when the current Arduino / demo feed started
  let lastLineT = null;                // when the last valid line arrived (null = none yet)
  let lineCount = 0, errCount = 0;     // lines received / lines that didn't parse, since link start
  let portLabel = '—', fwVersion = '—';   // fwVersion comes from the Nano's boot line "TVC firmware vX.Y.Z"
  const raw = { pitch: null, yaw: null }; // pitch/yaw exactly as sent (servo angles in servo mode)

  const servoMode = $('servoMode'), smooth = $('smooth');
  $('outline').onchange = e => setOutline(e.target.checked);
  $('sceneBtn').onclick = () => {
    rigScene = !rigScene;
    try { localStorage.setItem('tvc-bench-scene', rigScene ? 'rig' : 'plain'); } catch {}
    applyScene();
  };
  applyScene();
  $('baud').onchange = () => { ['baudVal', 'lkBaud', 'ftBaud'].forEach(id => { $(id).textContent = $('baud').value; }); };

  function handleLine(line) {
    if (!line) return;
    lineCount++;
    document.dispatchEvent(new CustomEvent('tvc:line', { detail: line }));   // the Tests tab's strip and charts
    const fw = line.match(/firmware v(\d+\.\d+\.\d+)/i);
    if (fw) fwVersion = fw[1];
    if (line === 'FREE,ON' || line === 'FREE,OFF') { logLine(line, 'msg'); setFree(line === 'FREE,ON'); return; }   // firmware v1.5.0+
    // Calibration traffic (firmware v1.2.0+): CFG,… / CAL,ON|OFF / ERR,… and, in calibration, CAL,xServo,yServo,tiltX,tiltY
    if (/^(CAL|CFG|ERR|ABORT|SWEEP|GIM|THR|ESCCAL),/.test(line)) {   // ABORT,TILT / ABORT,CLEAR: firmware v1.3.0+ tilt abort; SWEEP,DONE: v1.7.0+; GIM,x,y: v1.8.0+ (laser test); THR,…: v1.9.0+ (throttle test); ESCCAL,…: v1.10.0+
      const cal = line.match(/^CAL,(-?\d+),(-?\d+),(-?[\d.]+),(-?[\d.]+)/);
      logLine(line, cal ? undefined : 'msg');
      if (line.startsWith('CFG,')) {
        const p = line.split(',').map(Number);
        rig = { xd: p[3], yd: p[4], tx: p[5], ty: p[6], spg: p[7], spgy: p.length >= 13 ? p[12] : p[7] };   // spg = X servo; Y separate from v1.11.0
      }
      calib.handle(line);
      laser.handle(line);
      throttle.handle(line);
      vector.handle(line);
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
    history.push({ t: now, tiltX: target.tiltX, tiltY: target.tiltY });
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
    calib.onLink(); laser.onLink(); throttle.onLink(); vector.onLink();
  }
  function endLink() { linkStart = lastLineT = null; portLabel = '—'; setFree(false); $('freeBtn').disabled = true; calib.onLink(); laser.onLink(); throttle.onLink(); vector.onLink(); }

  // Commands to the Nano (calibration). Writes are chained so two quick clicks can't fight over the writer lock.
  // quiet = not shown in the serial log (the throttle test's heartbeat).
  const enc = new TextEncoder();
  let writeChain = Promise.resolve();
  function send(cmd, quiet) {
    if (!port?.writable) return;
    if (!quiet) logLine('› ' + cmd, 'tx');
    writeChain = writeChain.then(async () => {
      const w = port.writable.getWriter();
      try { await w.write(enc.encode(cmd + '\n')); } finally { w.releaseLock(); }
    }).catch(e => logLine('Send failed: ' + e.message, 'msg'));
  }
  const linkInfo = () => ({ port: !!port, demo: !!demoTimer, fw: fwVersion });
  const calib = initCalib({ send, link: linkInfo });
  const laser = initLaser({ send, link: linkInfo, calib });
  const throttle = initThrottle({ send, link: linkInfo, calib, laser });
  const vector = initVector({ send, link: linkInfo });
  const syscheck = initSysCheck({ send, link: linkInfo });   // listens to 'tvc:line' itself
  // The tests all use the Nano's CAL mode; tests.js makes sure only one is open at a time
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
  let demoTimer = null, demoSim = null;
  function startDemo() {
    if (port) return;
    $('demoBtn').textContent = 'Stop demo';
    $('demoPill').classList.add('on');
    setStatus('Demo feed', true);
    startLink('Demo');
    const sim = demoSim = createDemoSim();
    let simT = performance.now();
    demoTimer = setInterval(() => {
      // Catch up in 10 ms steps; after a pause (hidden tab) carry on from now instead of replaying it
      const now = performance.now();
      if (now - simT > 500) simT = now - 50;
      for (; simT < now; simT += 10) {
        const gust = sim.step();
        if (gust) logLine(`Gust: pushed toward ${gust.dir}°`, 'msg');
      }
      const s = sim.read();
      const servo = (g, spg) => 90 + Math.round(g * spg);
      handleLine(servoMode.checked
        ? `0,${servo(s.gimbalX, rig.spg)},${servo(s.gimbalY, rig.spgy)},${s.tiltX.toFixed(1)},${s.tiltY.toFixed(1)}`
        : `0,${s.tiltX.toFixed(1)},${s.tiltY.toFixed(1)}`);
    }, 50);
  }
  function stopDemo() {
    if (!demoTimer) return;
    clearInterval(demoTimer); demoTimer = null;
    endDrag(); demoSim = null;
    $('demoBtn').textContent = 'Demo mode';
    $('demoPill').classList.remove('on');
    if (!port) { setStatus('Not connected', false); endLink(); }
  }
  $('demoBtn').onclick = () => (demoTimer ? stopDemo() : startDemo());

  // ---------- Demo: drag the rocket, then let go ----------
  // Dragging the rocket tilts it; dragging anywhere else still orbits the camera. The grabbed point follows the pointer on
  // a plane facing the camera. Grabbing near the pivot would make it twitchy, so that acts like grabbing further along.
  const ray = new THREE.Raycaster(), _ndc = new THREE.Vector2();
  const PIVOT = new THREE.Vector3(0, PIVOT_Y, 0), MIN_LEVER = 0.7;
  const _plane = new THREE.Plane(), _hit = new THREE.Vector3(), _camDir = new THREE.Vector3(), _axis = new THREE.Vector3();
  let drag = null;   // { id, lever, offset }

  function aimRay(e) {
    const r = view.getBoundingClientRect();
    _ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
    ray.setFromCamera(_ndc, camera);
  }
  function rocketHit(e) { aimRay(e); return ray.intersectObjects(rocketMeshes, false)[0] || null; }
  function canDrag() { return !!demoSim && !$('calBtn').classList.contains('on') && !$('lzBtn').classList.contains('on') && !$('thBtn').classList.contains('on'); }

  view.addEventListener('pointerdown', e => {   // capture phase: decides before OrbitControls sees the press
    if (drag || !canDrag() || !e.isPrimary || e.button !== 0) return;
    const hit = rocketHit(e);
    if (!hit) return;
    rocket.updateWorldMatrix(true, false);
    _axis.set(0, 1, 0).transformDirection(rocket.matrixWorld);
    let lever = hit.point.clone().sub(PIVOT).dot(_axis);
    if (Math.abs(lever) < MIN_LEVER) lever = MIN_LEVER;
    const grab = PIVOT.clone().addScaledVector(_axis, lever);
    camera.getWorldDirection(_camDir);
    _plane.setFromNormalAndCoplanarPoint(_camDir, grab);
    if (!ray.ray.intersectPlane(_plane, _hit)) return;
    drag = { id: e.pointerId, lever, offset: grab.sub(_hit) };
    controls.enabled = false;
    view.setPointerCapture(e.pointerId);
    view.style.cursor = 'grabbing';
  }, true);

  view.addEventListener('pointermove', e => {
    if (!drag) {
      view.style.cursor = canDrag() && e.pointerType === 'mouse' && rocketHit(e) ? 'grab' : '';
      return;
    }
    if (e.pointerId !== drag.id) return;
    aimRay(e);
    if (!ray.ray.intersectPlane(_plane, _hit)) return;
    _axis.copy(_hit).add(drag.offset).sub(PIVOT).normalize().multiplyScalar(Math.sign(drag.lever));
    // Rocket up = (cos tiltX · sin tiltY, cos tiltX · cos tiltY, sin tiltX) in scene axes: see rocket.rotation in animate()
    const tiltX = THREE.MathUtils.radToDeg(Math.asin(_axis.z)), tiltY = THREE.MathUtils.radToDeg(Math.atan2(_axis.x, _axis.y));
    demoSim.hold(tiltX + zero.tiltX, tiltY + zero.tiltY);
  });

  function endDrag(e) {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    drag = null;
    controls.enabled = true;
    view.style.cursor = '';
    demoSim?.release();
  }
  view.addEventListener('pointerup', endDrag);
  view.addEventListener('pointercancel', endDrag);

  // ---------- Chart ----------
  const chart = $('chart'), ctx = chart.getContext('2d');
  function drawChart() {
    const dpr = Math.min(devicePixelRatio, 2);
    const w = chart.clientWidth, h = chart.clientHeight;
    if (!w || !h) return; // hidden while on the Mission tab
    if (chart.width !== w * dpr) { chart.width = w * dpr; chart.height = h * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const RANGE = 35; // ±35° of tilt visible
    const L = 22;     // left gutter for axis labels
    const yOf = v => h / 2 - (v / RANGE) * (h / 2 - 6);
    // Faint grid: every 10° and every 2 s, with small muted axis labels
    ctx.lineWidth = 1; ctx.font = '500 9px "Barlow Condensed", sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let v = -30; v <= 30; v += 10) {
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
    [25, -25].forEach(v => { ctx.beginPath(); ctx.moveTo(L, yOf(v)); ctx.lineTo(w, yOf(v)); ctx.stroke(); });
    ctx.setLineDash([]);
    const now = performance.now();
    const xOf = t => w - ((now - t) / 10000) * (w - L);
    ctx.save(); ctx.beginPath(); ctx.rect(L, 0, w - L, h); ctx.clip();
    [['tiltX', '#5b8cff'], ['tiltY', '#ff8a3d']].forEach(([k, c]) => {
      ctx.strokeStyle = c; ctx.lineWidth = 1.4; ctx.lineJoin = 'round'; ctx.beginPath();
      history.forEach((s, i) => { const x = xOf(s.t), y = yOf(s[k]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
    });
    ctx.restore();
  }

  // ---------- Loop ----------
  const deg = THREE.MathUtils.degToRad;
  let lastUi = 0, warmed = false;
  let lastTest = null;
  try { lastTest = localStorage.getItem('tvc-last-test'); } catch {}
  function animate(now) {
    requestAnimationFrame(animate);
    const k = smooth.checked ? 0.18 : 1;
    for (const a of Object.keys(shown)) shown[a] += (target[a] - shown[a]) * k;

    // Rocket axis from the tilts: (cos tiltX · sin tiltY, cos tiltX · cos tiltY, sin tiltX) in scene axes. Set it through the
    // rig's gimbal chain: outer pivot (scene X) by a, then inner pivot (scene Z) by b; the middle ring turns by a.
    const tX = deg(shown.tiltX), tY = deg(shown.tiltY);
    const dx = Math.cos(tX) * Math.sin(tY), dy = Math.cos(tX) * Math.cos(tY), dz = Math.sin(tX);
    const ga = Math.atan2(dz, dy), gb = Math.atan2(-dx, Math.hypot(dy, dz));
    rocket.rotation.set(ga, deg(shown.roll), gb);
    middle.rotation.x = ga;
    // Nozzle angle = servo deflection ÷ linkage ratio (attitude data says nothing about the servos, so the tube stays centred)
    const servoData = servoMode.checked;
    const gx = servoData ? shown.pitch * rig.xd / rig.spg : 0, gy = servoData ? shown.yaw * rig.yd / rig.spgy : 0;
    tvc.rotation.set(deg(gx), 0, deg(-gy));
    innerG.rotation.x = deg(gx);
    // On the real rig the plume follows the throttle test's real throttle; otherwise it stays dim (the command, not real thrust)
    const thr = throttle.level() ?? vector.level() ?? syscheck.level();
    updateThrust(linkStart !== null && lastLineT !== null && thr !== 0, gx, gy, demoTimer ? 1 : thr ?? 0.35);
    const live = linkStart !== null && lastLineT !== null && !demoTimer;
    // Test props: the last test opened (Throttle and Thrust vector close when you leave the Tests tab, which has no 3D view)
    const openTest = laser.isOpen() ? 'laser' : vector.isOpen() ? 'vector' : throttle.isOpen() ? 'throttle' : null;
    if (openTest && openTest !== lastTest) { lastTest = openTest; try { localStorage.setItem('tvc-last-test', lastTest); } catch {} }
    workshop.update({ now, live, armed: live && thr != null, thr: live && thr ? thr * 0.85 : 0,
      pitch: target.pitch, yaw: target.yaw, history,
      tests: { laser: lastTest === 'laser', vector: lastTest === 'vector', throttle: lastTest === 'throttle' } });
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
    $('viewNote').textContent = !hasData ? '' : demoTimer
      ? 'Drag the rocket and let go. Simulated gusts, thrust and recovery. Arrow = sideways force on the rocket.'
      : throttle.isOpen() || vector.isOpen() || syscheck.isOpen() ? 'Motor test: the plume shows the real throttle.'
      : 'Motor off: plume and arrow show the commanded thrust.';
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

  return { calib, laser, throttle, vector, syscheck, send, link: linkInfo };
}
