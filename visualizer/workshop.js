// Bench → Desk rig view: the test bench around the rig. Simple shapes, built in code, in the rig frame
// (mm, origin = rig pivot, x = rocket 0° toward the arm side is −x, y = rocket 90°, z up; table top at z = −DESK_H).
// Live props follow the real data: the bench supply shows volts and amps from the throttle, the laptop shows the
// tilt traces and the gimbal dial, the kill switch and the beacon light up when a motor test is armed or running.
// Test props show for the last test opened: the laser beam and target sheet (Laser), coins on the rocket (Thrust
// vector), the kitchen scale with the thrust (Throttle). Cables run from the rocket to the laptop and the supply.
// The room: a clean, modern makerspace (white walls with a violet accent band, polished floor, white pegboard, LED
// panels, a counter with enclosed 3D printers, a whiteboard, an extinguisher, a yellow safety line round the exhaust).
import * as THREE from 'three';

export function createWorkshop({ MM, PIVOT_Y, DESK_H, TABLE_H, airframe, tvc, TUBE_BELOW, RO }) {
  const root = new THREE.Group(); root.position.y = PIVOT_Y;
  const FLOOR = -DESK_H - TABLE_H, TOP = -DESK_H;
  // rig (x, y, z) mm → position in root
  const at = (x, y, z) => new THREE.Vector3(y * MM, z * MM, x * MM);
  const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...o });
  // A prop: a group placed at rig (x, y) on a surface z, turned to face rig direction `face` (deg, 0 = +x)
  function prop(x, y, z, face = 0, parent = root) {
    const g = new THREE.Group(); g.position.copy(at(x, y, z)); g.rotation.y = face * Math.PI / 180; parent.add(g); return g;
  }
  // Box in a prop's own frame (mm): w across (x), h up (y), d deep (z, + = front)
  function box(g, w, h, d, x, y, z, m) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w * MM, h * MM, d * MM), m);
    b.position.set(x * MM, y * MM, z * MM); b.castShadow = b.receiveShadow = true; g.add(b); return b;
  }
  function cyl(g, r, h, x, y, z, m, seg = 20) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(r * MM, r * MM, h * MM, seg), m);
    c.position.set(x * MM, y * MM, z * MM); c.castShadow = true; g.add(c); return c;
  }
  // A flat screen: a canvas on a plane, facing the prop's front
  function screen(g, w, h, x, y, z, cw, ch, tilt = 0) {
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w * MM, h * MM), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    m.position.set(x * MM, y * MM, z * MM); m.rotation.x = -tilt; g.add(m);
    return { ctx: cv.getContext('2d'), tex, w: cw, h: ch };
  }
  const FACE = 35;   // most props turn toward the default camera

  const dark = mat(0x1d1f24), black = mat(0x0c0d10), grey = mat(0x5b606b), alu = mat(0xa9adb5, { metalness: 0.5, roughness: 0.35 });
  const yellow = mat(0xe8b923), red = mat(0xc62828), white = mat(0xe6e6e6), green = mat(0x2f6b3a), blueBoard = mat(0x1e4e9c);

  // ---------- Bench power supply (12 V) ----------
  const psu = prop(-500, 250, TOP, FACE);
  box(psu, 200, 110, 230, 0, 55, 0, dark);
  box(psu, 196, 8, 226, 0, 112, 0, grey);
  const psuScreen = screen(psu, 120, 40, -30, 75, 115.6, 240, 80);
  const psuLed = new THREE.Mesh(new THREE.SphereGeometry(4 * MM, 12, 8), new THREE.MeshStandardMaterial({ color: 0x113311, emissive: 0x000000 }));
  psuLed.position.set(70 * MM, 75 * MM, 116 * MM); psu.add(psuLed);
  for (const [dx, m] of [[40, red], [70, black]]) cyl(psu, 6, 12, dx, 30, 118, m).rotation.x = Math.PI / 2;   // output posts
  cyl(psu, 9, 10, -60, 30, 118, grey).rotation.x = Math.PI / 2;   // knobs
  cyl(psu, 9, 10, -25, 30, 118, grey).rotation.x = Math.PI / 2;

  // ---------- Laptop (live view) ----------
  const lap = prop(-470, -230, TOP, FACE + 10);
  box(lap, 330, 16, 230, 0, 8, 0, alu);
  box(lap, 290, 2, 110, 0, 17, -30, black);                         // keyboard
  const lid = new THREE.Group(); lid.position.set(0, 16 * MM, -115 * MM); lid.rotation.x = -0.28; lap.add(lid);
  box(lid, 330, 220, 7, 0, 110, -3.5, alu);
  const lapScreen = screen(lid, 306, 196, 0, 112, 0.2, 512, 328);

  // ---------- Kill switch (fused plug) ----------
  const kill = prop(-330, 150, TOP, FACE);
  box(kill, 70, 40, 90, 0, 20, 0, mat(0xd8d8d8));
  const killBtnMat = new THREE.MeshStandardMaterial({ color: 0x7a0f12, emissive: 0x000000, roughness: 0.4 });
  cyl(kill, 18, 14, 0, 47, 0, killBtnMat);

  // ---------- Warning beacon on a stand ----------
  const bea = prop(-860, 520, TOP, 0);
  cyl(bea, 40, 8, 0, 4, 0, dark); cyl(bea, 6, 360, 0, 184, 0, grey);
  const beaconMat = new THREE.MeshStandardMaterial({ color: 0x6b4a10, emissive: 0x000000, transparent: true, opacity: 0.9 });
  cyl(bea, 28, 50, 0, 390, 0, beaconMat);
  cyl(bea, 30, 6, 0, 362, 0, dark);
  const beam = new THREE.Mesh(new THREE.ConeGeometry(70 * MM, 260 * MM, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffa31a, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  beam.rotation.z = Math.PI / 2; beam.position.set(130 * MM, 0, 0);
  const beamPivot = new THREE.Group(); beamPivot.position.set(0, 390 * MM, 0); beamPivot.add(beam); beamPivot.visible = false; bea.add(beamPivot);

  // ---------- Bench items: Nano + breadboard, safety glasses, multimeter, tape measure ----------
  const nano = prop(-360, -60, TOP, FACE - 20);
  box(nano, 165, 9, 55, 0, 4.5, 0, white);                         // breadboard
  box(nano, 44, 6, 18, -30, 12, 0, blueBoard);                     // Nano
  box(nano, 21, 4, 16, 30, 11, 0, blueBoard);                      // MPU-6050
  for (let i = 0; i < 6; i++) box(nano, 1.2, 8, 30, 50 + i * 4, 13, 0, mat([0xc62828, 0x1e88e5, 0xfdd835, 0x43a047][i % 4]));   // jumpers

  const glasses = prop(-580, 70, TOP, -20);
  const lens = new THREE.MeshStandardMaterial({ color: 0x9fd3ff, transparent: true, opacity: 0.35, roughness: 0.1 });
  for (const s of [-1, 1]) { const l = box(glasses, 58, 38, 3, s * 34, 22, 0, lens); l.rotation.y = s * 0.15; }
  box(glasses, 128, 6, 6, 0, 40, 0, black);
  for (const s of [-1, 1]) box(glasses, 4, 4, 120, s * 64, 38, -60, black);

  const dmm = prop(-680, 360, TOP, FACE);
  box(dmm, 80, 30, 160, 0, 15, 0, yellow);
  box(dmm, 60, 2, 40, 0, 31, 45, mat(0x9aa58c));                   // display
  cyl(dmm, 18, 6, 0, 33, -10, black);                              // dial
  const leadCurve = (ex, ez, c) => {
    const pts = [new THREE.Vector3(ex * MM, 31 * MM, -60 * MM), new THREE.Vector3(ex * 1.5 * MM, 10 * MM, -120 * MM), new THREE.Vector3((ex * 2 + 40) * MM, 3 * MM, (ez) * MM)];
    const t = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 1.6 * MM, 6), c); t.castShadow = true; dmm.add(t);
  };
  leadCurve(-15, -230, red); leadCurve(15, -250, black);

  const tape = prop(-720, -400, TOP, 60);
  cyl(tape, 33, 36, 0, 18, 0, yellow, 24);
  cyl(tape, 14, 37, 0, 18, 0, black);
  box(tape, 19, 1, 120, 0, 1, 90, mat(0xf2d64b));                  // blade pulled out

  // ---------- Cables: USB (Nano) and 12 V (ESC) from the rocket, under the arm, onto the table ----------
  // They start on the rocket (so they follow it) near the pivot on the arm side, as on the real rig.
  const usbMat = mat(0x202226), redMat = mat(0xb71c1c), blkMat = mat(0x16171a);
  const cables = [
    { m: usbMat, r: 2.2, start: [180, 15, 230], end: () => lap.localToWorld(new THREE.Vector3(-165 * MM, 8 * MM, 40 * MM)), via: [[-150, -60, -70], [-235, -110, TOP + 6]] },
    { m: redMat, r: 1.8, start: [180, -10, 160], end: () => psu.localToWorld(new THREE.Vector3(40 * MM, 30 * MM, 124 * MM)), via: [[-140, 60, -110], [-235, 150, TOP + 6]] },
    { m: blkMat, r: 1.8, start: [180, -16, 160], end: () => psu.localToWorld(new THREE.Vector3(70 * MM, 30 * MM, 124 * MM)), via: [[-140, 52, -112], [-235, 160, TOP + 6]] },
  ];
  // start = [CAD angle on the body, extra radius mm, height from the tail]
  for (const c of cables) { c.mesh = new THREE.Mesh(new THREE.BufferGeometry(), c.m); c.mesh.castShadow = true; root.add(c.mesh); }
  const _p = new THREE.Vector3();
  function cableStart([ang, dr, z]) {
    const a = ang * Math.PI / 180, r = RO + dr;
    return airframe.localToWorld(_p.set(Math.sin(a) * r * MM, z * MM, Math.cos(a) * r * MM)).clone();
  }
  function rebuildCables() {
    for (const c of cables) {
      const w2l = v => root.worldToLocal(v.clone());
      const s = w2l(cableStart(c.start)), e = w2l(c.end());
      const mid = c.via.map(([x, y, z]) => at(x, y, z));
      const drop = s.clone(); drop.y -= 70 * MM;                        // hangs from the rocket first
      const rise = e.clone(); rise.y += 4 * MM;
      const curve = new THREE.CatmullRomCurve3([s, drop, ...mid, rise, e], false, 'centripetal');
      c.mesh.geometry.dispose();
      c.mesh.geometry = new THREE.TubeGeometry(curve, 60, c.r * MM, 6);
    }
  }

  // ---------- Test props ----------
  // Laser (CT-1): a laser along the motor tube, its beam to an A3 sheet on the floor, and the dot
  const laserBody = new THREE.Mesh(new THREE.CylinderGeometry(5 * MM, 5 * MM, 60 * MM, 12), mat(0x30333a));
  laserBody.position.set(0, (-TUBE_BELOW - 30) * MM, 0); tvc.add(laserBody);
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(297 * MM, 420 * MM), mat(0xf4f4f0, { roughness: 0.9 }));
  sheet.rotation.x = -Math.PI / 2; sheet.position.copy(at(0, 0, FLOOR + 0.5)); sheet.receiveShadow = true; root.add(sheet);
  const beamGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const laserBeam = new THREE.Line(beamGeo, new THREE.LineBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.8 }));
  laserBeam.frustumCulled = false; root.add(laserBeam);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(3 * MM, 16), new THREE.MeshBasicMaterial({ color: 0xff1a1a }));
  dot.rotation.x = -Math.PI / 2; root.add(dot);
  const laserParts = [laserBody, sheet, laserBeam, dot];
  // Coins (CT-5): a small stack taped on the high side, on part D
  const coins = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(12 * MM, 12 * MM, 1.7 * MM, 20), mat(0xb08d57, { metalness: 0.7, roughness: 0.3 }));
    c.position.y = i * 1.8 * MM; coins.add(c);
  }
  // At CAD angle 35° (between the 0° flap and the 45° grid fin), on the side the default camera sees
  const coinHolder = new THREE.Group(); coinHolder.rotation.y = 35 * Math.PI / 180; airframe.add(coinHolder);
  coins.rotation.x = Math.PI / 2; coins.position.set(0, 425 * MM, (RO + 1) * MM); coinHolder.add(coins);
  const tapeStrip = new THREE.Mesh(new THREE.BoxGeometry(30 * MM, 8 * MM, 0.6 * MM), mat(0xd9d2b5)); tapeStrip.position.set(0, 425 * MM, (RO + 8.2) * MM); coinHolder.add(tapeStrip);
  const coinParts = [coinHolder];
  // Kitchen scale (CT-4) with the thrust on its display
  const scl = prop(-310, 340, TOP, FACE);
  box(scl, 180, 20, 180, 0, 10, 0, mat(0xdedede));
  box(scl, 170, 3, 170, 0, 21.5, 0, alu);
  const sclScreen = screen(scl, 70, 22, 0, 10, 90.6, 160, 50);

  // ---------- The room: a modern makerspace ----------
  // Light polished floor, white walls with a violet accent band, white pegboard, LED ceiling panels, a white counter
  // with enclosed 3D printers along the side wall, a whiteboard, a wall-mounted extinguisher and a yellow floor line
  // round the exhaust zone. Rig frame: the table's back edge is at x = −920, the back wall behind it, side wall at y = −ROOM_Y.
  const WALL_X = -1050, ROOM_Y = 1500, CEIL = 1750, FLOOR_X1 = 1400;
  const VIOLET = 0x57068c;
  function canvasTex(w, h, draw, rx = 1, ry = 1) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.anisotropy = 4;
    return t;
  }
  // Polished concrete: pale, faint mottling, large slab joints
  const concrete = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#b9bbbe'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++) { const v = 170 + Math.random() * 30 | 0; g.fillStyle = `rgba(${v},${v},${v + 3},${0.25 + Math.random() * 0.3})`; g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 4, 2 + Math.random() * 4); }
    g.strokeStyle = 'rgba(120,122,126,.55)'; g.lineWidth = 1.5; g.strokeRect(0.75, 0.75, w - 1.5, h - 1.5);
  }, (FLOOR_X1 - WALL_X) / 1200, (2 * ROOM_Y) / 1200);
  const floorMesh = new THREE.Mesh(new THREE.PlaneGeometry((2 * ROOM_Y) * MM, (FLOOR_X1 - WALL_X) * MM), mat(0xffffff, { map: concrete, roughness: 0.35, metalness: 0.05 }));
  floorMesh.rotation.x = -Math.PI / 2; floorMesh.position.copy(at((WALL_X + FLOOR_X1) / 2, 0, FLOOR)); floorMesh.receiveShadow = true; root.add(floorMesh);
  // Walls: smooth white, a violet accent band at bench height, a pale grey skirting
  const wallMat = mat(0xdcdfe4, { roughness: 0.9 }), accent = mat(VIOLET, { roughness: 0.7 }), skirt = mat(0xc9ccd1);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(2 * ROOM_Y * MM, (CEIL - FLOOR) * MM), wallMat);
  back.position.copy(at(WALL_X, 0, (CEIL + FLOOR) / 2)); back.receiveShadow = true; root.add(back);
  const side = new THREE.Mesh(new THREE.PlaneGeometry((FLOOR_X1 - WALL_X) * MM, (CEIL - FLOOR) * MM), wallMat);
  side.rotation.y = Math.PI / 2; side.position.copy(at((WALL_X + FLOOR_X1) / 2, -ROOM_Y, (CEIL + FLOOR) / 2)); side.receiveShadow = true; root.add(side);
  const backG = prop(WALL_X + 3, 0, FLOOR), sideG = prop((WALL_X + FLOOR_X1) / 2, -ROOM_Y + 3, FLOOR, 90);
  box(backG, 2 * ROOM_Y, 80, 6, 0, 40, 0, skirt); box(sideG, FLOOR_X1 - WALL_X, 80, 6, 0, 40, 0, skirt);
  box(backG, 2 * ROOM_Y, 140, 4, 0, (TOP + 520) - FLOOR + 70, 0, accent);            // accent band above the bench
  box(sideG, FLOOR_X1 - WALL_X, 140, 4, 0, (TOP + 520) - FLOOR + 70, 0, accent);

  // White pegboard above the table, tools hung neatly by size
  const peg = prop(WALL_X + 8, -150, TOP + 760, 0);
  const pegTex = canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = '#f4f5f7'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#c2c6cc'; for (let y = 8; y < h; y += 16) for (let x = 8; x < w; x += 16) { g.beginPath(); g.arc(x, y, 2.2, 0, Math.PI * 2); g.fill(); }
  }, 4, 2);
  box(peg, 1200, 560, 12, 0, 280, 0, mat(0xffffff, { map: pegTex, roughness: 0.8 }));
  const toolMat = mat(0x9aa0a8, { metalness: 0.6, roughness: 0.3 }), gripA = mat(VIOLET), gripB = mat(0x2b2d33);
  const hang = (x, y, w, h, m, rz = 0) => { const b = box(peg, w, h, 10, x, y, 14, m); b.rotation.z = rz; return b; };
  [40, 46, 52, 58, 64].forEach((L, i) => hang(-500 + i * 34, 420, 10, L * 3, toolMat));
  [-320, -290, -260, -230].forEach((x, i) => { hang(x, 450, 18, 90, i % 2 ? gripB : gripA); hang(x, 350, 6, 110, toolMat); });
  hang(-140, 400, 22, 170, gripA, 0.18); hang(-112, 400, 22, 170, gripA, -0.18);
  for (let i = 0; i < 7; i++) hang(-20 + i * 14, 420 - i * 6, 5, 120 - i * 10, gripB);
  hang(130, 400, 120, 30, gripB); hang(130, 340, 24, 140, toolMat);
  for (let i = 0; i < 5; i++) box(peg, 70, 50, 70, 260 + i * 80, 150, 40, mat(i % 2 ? 0xffffff : 0xe3e5e9));   // clear-ish bins
  box(peg, 420, 6, 80, 420, 120, 40, mat(0xd0d3d8));                                                          // bin shelf

  // White counter along the side wall with three enclosed 3D printers and filament drawers
  const counter = prop(-480, -ROOM_Y + 320, FLOOR, 90);
  const cab = mat(0xf5f6f8, { roughness: 0.6 }), top = mat(0xdadde2, { roughness: 0.35 }), handle = mat(0x8a9099, { metalness: 0.6 });
  box(counter, 1100, 880, 600, 0, 440, 0, cab);
  box(counter, 1120, 30, 620, 0, 895, 0, top);
  for (let i = 0; i < 4; i++) { box(counter, 240, 4, 2, -412 + i * 275, 760, 301, handle); if (i) box(counter, 2, 840, 2, -550 + i * 275, 440, 301, mat(0xd4d7dc)); }
  for (let i = 0; i < 3; i++) {                                                                        // enclosed printers
    const pr = new THREE.Group(); pr.position.set((-360 + i * 360) * MM, 910 * MM, -40 * MM); counter.add(pr);
    box(pr, 320, 370, 320, 0, 185, 0, mat(0x1c1d21, { roughness: 0.45 }));
    const glass = box(pr, 270, 290, 4, 0, 185, 161, new THREE.MeshStandardMaterial({ color: 0x9ab7c9, transparent: true, opacity: 0.35, roughness: 0.05 }));
    glass.castShadow = false;
    box(pr, 240, 6, 240, 0, 75, 0, mat(0x2a2c31));                                                    // bed
    box(pr, 50, 56, 50, -30 + i * 25, 106, 15, mat([0xd9541e, 0xf2f2f2, VIOLET][i]));                // a part printing
    box(pr, 260, 12, 26, 0, 265, 0, mat(0x55585f));                                                   // gantry
    const strip = box(pr, 290, 4, 4, 0, 356, 156, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4e0, emissiveIntensity: 0.8 }));
    strip.castShadow = false;
    box(pr, 56, 22, 4, 95, 25, 162, new THREE.MeshStandardMaterial({ color: 0x0b0c0e, emissive: 0x2a8fff, emissiveIntensity: 0.4 }));   // screen
  }
  // Whiteboard on the side wall, further along
  const wb = prop(250, -ROOM_Y + 10, TOP + 450, 90);
  box(wb, 1200, 800, 16, 0, 400, 0, mat(0xd9dce1, { metalness: 0.4 }));
  box(wb, 1170, 770, 4, 0, 400, 9, mat(0xfafafa, { roughness: 0.25 }));
  const ink = mat(0x2a2c33); box(wb, 300, 6, 2, -350, 600, 12, ink); box(wb, 220, 6, 2, -390, 560, 12, ink); box(wb, 6, 200, 2, 150, 450, 12, mat(VIOLET)); box(wb, 260, 6, 2, 260, 450, 12, mat(VIOLET));
  box(wb, 600, 20, 50, 0, -10, 25, mat(0xd9dce1));                                                    // marker tray

  // Wall-mounted fire extinguisher with its sign
  const ext = prop(WALL_X + 80, 700, FLOOR + 300, 0);
  cyl(ext, 70, 520, 0, 260, 0, mat(0xc0201a, { roughness: 0.3 }), 24);
  cyl(ext, 22, 50, 0, 545, 0, mat(0x222326)); box(ext, 120, 18, 30, 30, 575, 0, mat(0x222326));
  box(ext, 160, 220, 4, 0, 820, -60, mat(0xc0201a));                                                 // sign above

  // Safety line: a thin yellow square on the floor round the exhaust zone, under the rocket
  const ZONE = 700, BAND = 30, lineMat = mat(0xf2c200, { roughness: 0.5 });
  // [centre x, centre y, extent along rig x, extent along rig y]
  for (const [cx, cy, w, h] of [[ZONE / 2, 0, BAND, ZONE + BAND], [-ZONE / 2, 0, BAND, ZONE + BAND], [0, ZONE / 2, ZONE - BAND, BAND], [0, -ZONE / 2, ZONE - BAND, BAND]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(h * MM, 0.6 * MM, w * MM), lineMat);
    m.position.copy(at(cx, cy, FLOOR + 0.3)); m.receiveShadow = true; root.add(m);
  }

  // LED ceiling panels (cool white), hung on thin wires; soft, even light
  const panelMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xf4f7ff, emissiveIntensity: 1.2 });
  for (const [x, y] of [[-520, -300], [-520, 400], [200, -300], [200, 400]]) {
    const pnl = prop(x, y, CEIL - 120, 0);
    box(pnl, 600, 14, 1200, 0, 0, 0, panelMat).castShadow = false;
    box(pnl, 620, 10, 1220, 0, 10, 0, mat(0xd4d7dc));
    for (const sx of [-280, 280]) box(pnl, 2, 110, 2, sx, 70, 0, mat(0x777b82));
  }
  const lampLight = new THREE.PointLight(0xf2f5ff, 0.9, 0, 0); lampLight.position.copy(at(-300, 0, CEIL - 200)); root.add(lampLight);
  const fill = new THREE.HemisphereLight(0xf6f8ff, 0x8a8c90, 0.3); root.add(fill);   // bright, neutral room bounce

  // ---------- Live update ----------
  function drawPsu(v, a, on) {
    const { ctx, w, h, tex } = psuScreen;
    ctx.fillStyle = '#0a0f0a'; ctx.fillRect(0, 0, w, h);
    ctx.font = 'bold 40px "JetBrains Mono", monospace'; ctx.textBaseline = 'middle';
    ctx.fillStyle = on ? '#7dff8a' : '#2c4a2f'; ctx.fillText(v.toFixed(1), 8, h / 2);
    ctx.fillStyle = on ? '#ff6b5a' : '#4a2c2c'; ctx.fillText(a.toFixed(2), 126, h / 2);
    ctx.font = '14px sans-serif'; ctx.fillStyle = '#6b8a6f'; ctx.fillText('V', 100, h - 12); ctx.fillText('A', 228, h - 12);
    tex.needsUpdate = true;
  }
  function drawScale(g) {
    const { ctx, w, h, tex } = sclScreen;
    ctx.fillStyle = '#c4cfb4'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1b2016'; ctx.font = 'bold 34px "JetBrains Mono", monospace'; ctx.textBaseline = 'middle';
    ctx.textAlign = 'right'; ctx.fillText(g.toFixed(0) + ' g', w - 8, h / 2); ctx.textAlign = 'left';
    tex.needsUpdate = true;
  }
  function drawLaptop(s) {
    const { ctx, w, h, tex } = lapScreen;
    ctx.fillStyle = '#050506'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f2f3f5'; ctx.font = '600 18px "Barlow Condensed", sans-serif'; ctx.textBaseline = 'top';
    ctx.fillText('EG ROCKET TVC / BENCH', 14, 10);
    ctx.fillStyle = s.live ? '#3ecf6e' : '#6b6f78'; ctx.fillText(s.live ? '● LIVE' : '○ NOT CONNECTED', w - 150, 10);
    // tilt traces, last 10 s, ±35°
    const x0 = 14, y0 = 44, cw = 330, chh = 200, now = s.now;
    ctx.strokeStyle = '#1a1c20'; ctx.lineWidth = 1; ctx.strokeRect(x0, y0, cw, chh);
    ctx.strokeStyle = '#2c2f36'; ctx.beginPath(); ctx.moveTo(x0, y0 + chh / 2); ctx.lineTo(x0 + cw, y0 + chh / 2); ctx.stroke();
    ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(255,77,94,.5)';
    for (const v of [25, -25]) { const y = y0 + chh / 2 - v / 35 * chh / 2; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + cw, y); ctx.stroke(); }
    ctx.setLineDash([]);
    for (const [k, c] of [['tiltX', '#5b8cff'], ['tiltY', '#ff8a3d']]) {
      ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.beginPath();
      s.history.forEach((p, i) => { const x = x0 + cw - (now - p.t) / 10000 * cw, y = y0 + chh / 2 - Math.max(-35, Math.min(35, p[k])) / 35 * chh / 2; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
    }
    // gimbal dial
    const cx = 430, cy = 140, R = 62;
    ctx.strokeStyle = '#2c2f36'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
    const k = v => Math.max(-1, Math.min(1, v / 45)) * R;
    ctx.fillStyle = '#f2f3f5'; ctx.beginPath(); ctx.arc(cx + k(s.yaw), cy - k(s.pitch), 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#6b6f78'; ctx.font = '500 14px "Barlow Condensed", sans-serif'; ctx.fillText('GIMBAL', cx - 22, cy + R + 10);
    // throttle bar
    ctx.fillStyle = '#131418'; ctx.fillRect(14, 262, w - 28, 16);
    ctx.fillStyle = s.thr > 0 ? '#f5a623' : '#2c2f36'; ctx.fillRect(14, 262, (w - 28) * Math.min(1, s.thr), 16);
    ctx.fillStyle = '#6b6f78'; ctx.fillText(`THROTTLE ${(s.thr * 100).toFixed(0)} %   ·   PITCH ${s.pitch.toFixed(1)}°   ·   YAW ${s.yaw.toFixed(1)}°`, 14, 290);
    tex.needsUpdate = true;
  }

  let lastDraw = 0;
  const _o = new THREE.Vector3(), _d = new THREE.Vector3();
  // state: { now, live, armed (a motor test is open on a live link), thr (0..1 of full), pitch, yaw, history, tests: { laser, vector, throttle } }
  function update(s) {
    if (!root.visible) { laserBody.visible = false; coinParts.forEach(o => { o.visible = false; }); return; }
    rebuildCables();
    const t = s.now / 1000;
    // Kill switch lit while armed; beacon turns while the motor runs
    killBtnMat.color.set(s.armed ? 0xff2a2a : 0x7a0f12); killBtnMat.emissive.set(s.armed ? 0x661010 : 0x000000);
    const running = s.thr > 0.005;
    beamPivot.visible = running; beamPivot.rotation.y = t * 6;
    beaconMat.emissive.set(running ? (Math.sin(t * 12) > 0 ? 0xff8c00 : 0x7a4300) : 0x000000);
    psuLed.material.emissive.set(s.armed ? 0x22cc33 : 0x000000);
    // Test props
    laserParts.forEach(o => { o.visible = s.tests.laser; });
    coinParts.forEach(o => { o.visible = s.tests.vector; });
    scl.visible = s.tests.throttle;
    if (s.tests.laser) {
      tvc.localToWorld(_o.set(0, (-TUBE_BELOW - 60) * MM, 0));
      tvc.localToWorld(_d.set(0, (-TUBE_BELOW - 61) * MM, 0)).sub(_o).normalize();
      const floorY = PIVOT_Y + FLOOR * MM + 0.001, k = (floorY - _o.y) / (_d.y || -1e-6);
      const hit = _o.clone().addScaledVector(_d, Math.max(0, k));
      const a = root.worldToLocal(_o.clone()), b = root.worldToLocal(hit.clone());
      beamGeo.setFromPoints([a, b]); dot.position.copy(b);
    }
    if (s.now - lastDraw > 100) {
      lastDraw = s.now;
      // ≈ supply current: the 30 mm EDF draws ~11.2 A at full on 11.1 V; current grows ~ with throttle³
      const amps = s.armed ? 0.12 + 11.2 * s.thr ** 3 : 0;
      drawPsu(s.armed ? 12.0 - 0.05 * amps : 12.0, amps, s.armed);
      drawLaptop(s);
      if (s.tests.throttle) drawScale(s.thr > 0 ? 220 * s.thr ** 2 : 0);
    }
  }
  drawPsu(12, 0, false); drawScale(0);
  return { group: root, update };
}
