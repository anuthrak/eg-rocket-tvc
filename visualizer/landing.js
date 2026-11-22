// Landing tab: the ship (the SLDP 45 upper stage, scaled to 50 m) landing on Mars.
//   Entry (autopilot, landing-sim.js createEntry): belly-first fall from 8 km at ~330 m/s, the flip, the landing burn.
//   At 150 m the TVC takes over (createTerminal), from one of two sources:
//     Rig       - the ship's attitude IS the real rocket's tilt on the desk rig (bench.js 'tvc:sample' events), and the
//                 real nozzle angles push its tail. Push the real rocket and the ship gets pushed.
//     Simulated - no hardware: the Nano's controller (controller.js) flies it, with gusts, a Gust button and a
//                 TVC on/off switch (TVC off shows what happens without it).
// Illustrative, not to scale in time: the TVC phase uses the desk rocket's own (fast) attitude dynamics.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as L from './landing-sim.js';

const $ = id => document.getElementById(id);
const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, k) => a + (b - a) * k;
const sstep = (a, b, x) => { const s = clamp((x - a) / (b - a), 0, 1); return s * s * (3 - 2 * s); };
const rnd = (a, b) => a + Math.random() * (b - a);
const GUST_SCALE = 0.85;   // of demo-sim's gust: with the TVC on, one gust peaks under ~21° (200 random runs, never past the 25° abort)

export async function initLanding(step) {
  await step?.(0.86, 'Generating Mars');

  // ---------- Renderer / scene ----------
  const view = $('landingView');
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  view.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const HAZE = new THREE.Color(0xc79a74);
  scene.fog = new THREE.Fog(HAZE, 900, 16000);
  const camera = new THREE.PerspectiveCamera(40, 1, 1, 60000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.enabled = false; controls.maxPolarAngle = 88 * DEG;

  // Afternoon sun through dusty air: warm key light, a butterscotch sky fill
  const SUN = new THREE.Vector3(-0.55, 0.52, -0.65).normalize();   // ~31° up
  const sun = new THREE.DirectionalLight(0xffe6c8, 3.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 1, far: 1200 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.8;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(0xe0b48c, 0x3a2216, 0.75));

  // Sky dome: butterscotch at the horizon, dusty pink-brown overhead, a pale glow round the sun
  {
    const sky = new THREE.Mesh(new THREE.SphereGeometry(40000, 48, 24), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uSun: { value: SUN } },
      vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); vec4 p = projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: `uniform vec3 uSun; varying vec3 vD;
        void main(){ float h = clamp(vD.y, -0.2, 1.0);
          vec3 hor = vec3(0.86,0.66,0.48), mid = vec3(0.70,0.47,0.33), top = vec3(0.42,0.27,0.21);
          vec3 c = mix(hor, mid, smoothstep(0.0, 0.25, h)); c = mix(c, top, smoothstep(0.25, 0.95, h));
          float s = max(dot(normalize(vD), normalize(uSun)), 0.0);
          c += vec3(0.95,0.88,0.78) * pow(s, 64.0) * 0.9 + vec3(0.55,0.62,0.72) * pow(s, 8.0) * 0.22;   // Mars sunsets go blue round the sun
          c = mix(c, vec3(0.55,0.40,0.30), smoothstep(0.0, -0.2, h));
          gl_FragColor = vec4(c, 1.0); }`,
    }));
    sky.renderOrder = -1; sky.frustumCulled = false;
    scene.add(sky);
  }

  // ---------- Terrain: craters, dunes and noise on a grid that gets coarser with distance ----------
  const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
  function vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return lerp(lerp(a, b, u), lerp(c, d, u), v) * 2 - 1;
  }
  const fbm = (x, y) => { let s = 0, a = 1, f = 1; for (let i = 0; i < 5; i++) { s += a * vnoise(x * f, y * f); a *= 0.5; f *= 2.03; } return s; };
  const craters = [];
  { let seed = 11; const r01 = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 160; i++) {
      const R = 40 + Math.pow(r01(), 3) * 500, d = 600 + R + Math.pow(r01(), 1.2) * 9000, a = r01() * Math.PI * 2;
      craters.push([Math.cos(a) * d, Math.sin(a) * d, R]);
    }
    for (let i = 0; i < 160; i++) {   // small ones near the pad, for scale
      const R = 3 + Math.pow(r01(), 2) * 30, d = 70 + R + Math.pow(r01(), 0.8) * 650, a = r01() * Math.PI * 2;
      craters.push([Math.cos(a) * d, Math.sin(a) * d, R]);
    }
  }
  function terrain(x, z) {
    let h = 28 * fbm(x / 1400, z / 1400) + 5 * fbm(x / 160, z / 160) + 0.6 * fbm(x / 22, z / 22);
    h += 1.6 * Math.sin((x * 0.8 + z * 0.6) / 18 + 2 * vnoise(x / 90, z / 90)) * sstep(0.1, 0.6, vnoise(x / 400 + 5, z / 400));   // dune ripples
    let rimBright = 0;
    for (const [cx, cz, R] of craters) {
      const dx = x - cx, dz = z - cz; if (Math.abs(dx) > R * 1.8 || Math.abs(dz) > R * 1.8) continue;
      const q = Math.hypot(dx, dz) / R;
      if (q < 1) h -= 0.18 * R * (1 - q * q);
      const rim = Math.exp(-(((q - 1) / 0.22) ** 2)); h += 0.06 * R * rim; rimBright = Math.max(rimBright, rim);
    }
    const flat = sstep(40, 110, Math.hypot(x, z));     // the landing zone is graded flat
    return [h * flat, rimBright * flat];
  }
  const heightAt = (x, z) => terrain(x, z)[0];
  {
    const N = 420, geo = new THREE.PlaneGeometry(2, 2, N, N); geo.rotateX(-Math.PI / 2);
    const P = geo.attributes.position, uv = geo.attributes.uv, col = new Float32Array(P.count * 3);
    const warp = u => Math.sign(u) * (160 * Math.abs(u) + 1400 * u * u + 14000 * Math.abs(u) ** 4);   // 0.8 m at the pad … 15 km out
    for (let i = 0; i < P.count; i++) {
      const x = warp(P.getX(i)), z = warp(P.getZ(i)), [h, rim] = terrain(x, z);
      P.setXYZ(i, x, h, z);
      const k = 0.08 * fbm(x / 120 + 9, z / 120) + 0.12 * rim + 0.06 * fbm(x / 1800, z / 1800);
      col.set([clamp(0.56 + k, 0.3, 0.8), clamp(0.31 + k * 0.7, 0.15, 0.55), clamp(0.19 + k * 0.45, 0.08, 0.4)], i * 3);
      uv.setXY(i, x / 16, z / 16);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    // Regolith detail: pebbly grey noise tiled every 16 m, as colour and bump (the scale cue up close)
    const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
    const img = g.createImageData(512, 512);
    for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
      const v = 175 + 45 * (vnoise(x / 11, y / 11) * 0.55 + vnoise(x / 3, y / 3) * 0.45) + 16 * (Math.random() - 0.5), o = (y * 512 + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = v; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    for (let i = 0; i < 260; i++) {   // rocks (wrapped so the tile is seamless)
      const r = 1 + Math.pow(Math.random(), 3) * 9, cx = Math.random() * 512, cy = Math.random() * 512;
      for (const ox of [-512, 0, 512]) for (const oy of [-512, 0, 512]) {
        const gr = g.createRadialGradient(cx + ox - r * 0.3, cy + oy - r * 0.3, r * 0.1, cx + ox, cy + oy, r);
        gr.addColorStop(0, 'rgba(230,230,230,.6)'); gr.addColorStop(0.7, 'rgba(90,90,90,.5)'); gr.addColorStop(1, 'rgba(60,60,60,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(cx + ox, cy + oy, r, 0, 7); g.fill();
      }
    }
    const detail = new THREE.CanvasTexture(c); detail.wrapS = detail.wrapT = THREE.RepeatWrapping; detail.anisotropy = 8; detail.colorSpace = THREE.SRGBColorSpace;
    const bump = new THREE.CanvasTexture(c); bump.wrapS = bump.wrapT = THREE.RepeatWrapping; bump.anisotropy = 8;
    const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, map: detail, bumpMap: bump, bumpScale: 2.2, roughness: 1, metalness: 0 }));
    ground.receiveShadow = true;
    scene.add(ground);
  }

  // Landing pad: a painted disc, edge lights
  const PAD = new THREE.Group(); scene.add(PAD);
  {
    const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
    g.fillStyle = '#6b6662'; g.beginPath(); g.arc(256, 256, 254, 0, 7); g.fill();
    for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '60,30,15' : '255,255,255'},${Math.random() * 0.07})`; g.fillRect(Math.random() * 512, Math.random() * 512, 3, 3); }
    g.strokeStyle = '#ecebe6'; g.lineWidth = 14; g.beginPath(); g.arc(256, 256, 226, 0, 7); g.stroke();
    g.lineWidth = 6; g.beginPath(); g.arc(256, 256, 120, 0, 7); g.stroke();
    g.lineWidth = 18; g.beginPath(); g.moveTo(170, 170); g.lineTo(342, 342); g.moveTo(342, 170); g.lineTo(170, 342); g.stroke();
    g.fillStyle = '#f5a623'; for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; g.fillRect(256 + Math.cos(a) * 196 - 7, 256 + Math.sin(a) * 196 - 7, 14, 14); }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(L.PAD_R, 64), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 }));
    disc.rotation.x = -Math.PI / 2; disc.position.y = 0.05; disc.receiveShadow = true; PAD.add(disc);
  }
  const padLights = [];
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2;
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff4d5e, fog: false }));
    m.position.set(Math.cos(a) * (L.PAD_R + 2), 0.4, Math.sin(a) * (L.PAD_R + 2)); PAD.add(m); padLights.push(m);
  }

  await step?.(0.9, 'Fuelling the ship');

  // ---------- The ship: a Starship-style upper stage, 50 m x 9 m, built in code ----------
  // Stainless body with a black tiled heat shield on the belly (+x side), forward and aft flaps on the ±z sides that
  // move in the belly flop, three gimballed sea-level engines in the middle (the TVC) and three fixed vacuum bells.
  const R = L.SHIP.D / 2, LEN = L.SHIP.L, BARREL = 37;    // body radius, length, where the nose starts (m from the tail)
  const TAIL = 0.4 * LEN, NOSE = LEN - TAIL;              // CG above the tail / below the nose tip
  const BELL = 2.6;                                       // sea-level bell length below the engine plane
  const ship = new THREE.Group(); ship.rotation.order = 'XZY'; scene.add(ship);
  const airframe = new THREE.Group(); airframe.position.y = -TAIL; ship.add(airframe);   // airframe origin = the tail
  const tvc = new THREE.Group(); tvc.position.y = 0.4; airframe.add(tvc);                // the centre engines' gimbal
  // Reflections for the steel: a small environment in the sky's colours
  const pmrem = new THREE.PMREMGenerator(renderer);
  { const env = new THREE.Scene();
    env.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide,
      vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `varying vec3 vD; void main(){ float h = vD.y; vec3 c = mix(vec3(0.5,0.3,0.18), vec3(0.92,0.7,0.52), smoothstep(-0.3, 0.05, h));
        c = mix(c, vec3(0.52,0.36,0.27), smoothstep(0.2, 0.9, h)); gl_FragColor = vec4(c * 1.2, 1.0); }` })));
    scene.environment = pmrem.fromScene(env, 0.04).texture; }
  // Panel lines on the steel: rings every ~1.8 m, a few stringers, brushed streaks
  function steelTex() {
    const c = document.createElement('canvas'); c.width = 256; c.height = 1024; const g = c.getContext('2d');
    g.fillStyle = '#c9ccd1'; g.fillRect(0, 0, 256, 1024);
    for (let i = 0; i < 1600; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '40,40,40' : '255,255,255'},${Math.random() * 0.05})`; g.fillRect(Math.random() * 256, Math.random() * 1024, 2 + Math.random() * 30, 1 + Math.random() * 3); }
    g.fillStyle = 'rgba(60,60,64,.55)'; for (let y = 0; y < 1024; y += 37) g.fillRect(0, y, 256, 2);
    g.fillStyle = 'rgba(60,60,64,.3)'; for (let x = 0; x < 256; x += 64) g.fillRect(x, 0, 1, 1024);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 8; return t;
  }
  function tileTex() {   // hexagonal heat-shield tiles
    const c = document.createElement('canvas'); c.width = 512; c.height = 512; const g = c.getContext('2d');
    g.fillStyle = '#101113'; g.fillRect(0, 0, 512, 512);
    const r = 9, w = r * Math.sqrt(3);
    for (let row = 0; row * r * 1.5 < 530; row++) for (let col = 0; col * w < 530; col++) {
      const cx = col * w + (row % 2) * w / 2, cy = row * r * 1.5, v = 20 + Math.random() * 16;
      g.fillStyle = `rgb(${v},${v},${v + 3})`; g.beginPath();
      for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + k * Math.PI / 3; g.lineTo(cx + Math.cos(a) * (r - 0.8), cy + Math.sin(a) * (r - 0.8)); }
      g.fill();
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 18); t.anisotropy = 8; return t;
  }
  const M = {
    steel: new THREE.MeshStandardMaterial({ color: 0xffffff, map: steelTex(), metalness: 0.85, roughness: 0.3, envMapIntensity: 1.1 }),
    tiles: new THREE.MeshStandardMaterial({ color: 0xffffff, map: tileTex(), metalness: 0.1, roughness: 0.75 }),
    flap: new THREE.MeshStandardMaterial({ color: 0x55585f, metalness: 0.7, roughness: 0.4, side: THREE.DoubleSide }),
    engine: new THREE.MeshStandardMaterial({ color: 0x55575e, metalness: 0.9, roughness: 0.3, side: THREE.DoubleSide }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1a1a1d, metalness: 0.5, roughness: 0.5 }),
    window: new THREE.MeshStandardMaterial({ color: 0x0b0d12, metalness: 0.9, roughness: 0.1 }),
  };
  // Body profile: barrel, then an ogive to a blunt tip
  const prof = [];
  for (let i = 0; i <= 12; i++) prof.push(new THREE.Vector2(R, BARREL * i / 12));
  for (let i = 1; i <= 24; i++) { const u = i / 24; prof.push(new THREE.Vector2(Math.max(R * Math.pow(1 - Math.pow(u, 2.1), 0.62), 0.05), BARREL + (LEN - BARREL) * u)); }
  const body = new THREE.Mesh(new THREE.LatheGeometry(prof, 72, Math.PI, Math.PI), M.steel);   // the back (-x) half
  const shield = new THREE.Mesh(new THREE.LatheGeometry(prof.map(p => new THREE.Vector2(p.x + 0.04, p.y)), 72, 0, Math.PI), M.tiles);   // the belly (+x) half
  const base = new THREE.Mesh(new THREE.CircleGeometry(R, 48), M.dark); base.rotation.x = Math.PI / 2;
  [body, shield].forEach(m => { m.castShadow = true; m.receiveShadow = true; airframe.add(m); });
  airframe.add(base);
  // A row of windows near the nose, on the steel side
  for (let i = 0; i < 6; i++) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.5, 2.2), M.window);
    w.position.set(-R * Math.cos(0.35) - 0.02, BARREL - 1 - i * 1.15, R * Math.sin(0.35)); w.rotation.y = -0.35; airframe.add(w);
  }
  // Flaps: a hinge along the body at each side (±z), the panel sticking out sideways. Deflection is about that hinge.
  function flapGeo(root0, root1, span, tip0, tip1) {
    const sh = new THREE.Shape(); sh.moveTo(0, root0); sh.lineTo(0, root1); sh.lineTo(span, tip1); sh.lineTo(span, tip0); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.4, bevelEnabled: false }); g.translate(0, 0, -0.2); return g;
  }
  const flaps = [];
  for (const [side, fwd] of [[1, true], [-1, true], [1, false], [-1, false]]) {
    const hinge = new THREE.Group();
    hinge.position.set(0.35, 0, side * R * 0.98);
    hinge.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;   // local +x points out of the side
    const geo = fwd ? flapGeo(BARREL - 1.5, BARREL + 7, 4.4, BARREL + 0.5, BARREL + 4.8) : flapGeo(1.2, 13, 6.6, 0.4, 7.8);
    const m = new THREE.Mesh(geo, M.flap); m.castShadow = true;
    const pivot = new THREE.Group(); pivot.add(m); hinge.add(pivot); airframe.add(hinge);
    flaps.push({ pivot, side, fwd });
  }
  // Flap deflection (rad, + = toward the belly), about each flap's hinge line (the body's long axis)
  function setFlaps(fwd, aft) { for (const f of flaps) f.pivot.rotation.y = f.side * (f.fwd ? fwd : aft); }
  // Engines: three gimballed sea-level bells in the middle (on the TVC gimbal) and three fixed vacuum bells outside
  function bell(r0, r1, h) {
    const g = new THREE.Group();
    const b = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, 28, 1, true), M.engine); b.position.y = -h / 2; b.castShadow = true;
    const p = new THREE.Mesh(new THREE.CylinderGeometry(r0 * 0.8, r0, 0.8, 16), M.dark); p.position.y = 0.3;
    g.add(b, p); return g;
  }
  for (let i = 0; i < 3; i++) { const a = (90 + 120 * i) * DEG, e = bell(0.42, 0.7, BELL); e.position.set(Math.cos(a) * 1.0, 0, Math.sin(a) * 1.0); tvc.add(e); }
  for (let i = 0; i < 3; i++) { const a = (30 + 120 * i) * DEG, e = bell(0.55, 1.15, 3.4); e.position.set(Math.cos(a) * 2.9, 0.5, Math.sin(a) * 2.9); airframe.add(e); }

  // Landing legs: 4 struts that swing down from the tail
  const legs = [];
  const LEG = 9.5, HINGE = 6, FOOT = LEG * Math.cos(36 * DEG) - HINGE + BELL;   // deployed feet reach FOOT below the tail, past the bells
  { const geo = new THREE.CylinderGeometry(0.22, 0.3, LEG, 10); geo.translate(0, -LEG / 2, 0);
    const footGeo = new THREE.CylinderGeometry(1.0, 1.2, 0.35, 20);
    for (let i = 0; i < 4; i++) {
      const az = (45 + 90 * i) * DEG, hinge = new THREE.Group();
      hinge.position.set(Math.cos(az) * (R + 0.15), HINGE, Math.sin(az) * (R + 0.15));
      hinge.rotation.y = -az;
      const pivot = new THREE.Group(); hinge.add(pivot);
      const strut = new THREE.Mesh(geo, M.dark); strut.castShadow = true; pivot.add(strut);
      const foot = new THREE.Mesh(footGeo, M.dark); foot.position.y = -LEG; foot.castShadow = true; pivot.add(foot);
      airframe.add(hinge); legs.push(pivot);
    }
  }
  const FOOT_R = R + LEG * Math.sin(36 * DEG);
  const setLegs = k => legs.forEach(p => { p.visible = k > 0.001; p.rotation.z = lerp(176, 36, k) * DEG; });

  // Plume: methalox blue-white, wider in the thin air; a light that washes the ground
  function plumeMat(color, k) {
    return new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      uniforms: { uColor: { value: new THREE.Color(color) }, uK: { value: k }, uT: { value: 0 } },
      vertexShader: `varying float vY; varying vec3 vN; varying vec3 vV;
        void main(){ vY = position.y; vec4 mv = modelViewMatrix*vec4(position,1.0);
          vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `uniform vec3 uColor; uniform float uK; uniform float uT; varying float vY; varying vec3 vN; varying vec3 vV;
        void main(){ float along = pow(clamp(1.0 + vY, 0.0, 1.0), 2.0);
          float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.5);
          float diamonds = 0.82 + 0.18 * sin(vY * 40.0 - uT * 30.0);
          float fl = 0.88 + 0.12 * sin(uT * 53.0 + vY * 31.0);
          gl_FragColor = vec4(uColor * along * edge * uK * fl * diamonds, 1.0); }`,
    });
  }
  const plumeGeo = new THREE.ConeGeometry(1, 1, 32, 1, true); plumeGeo.rotateX(Math.PI); plumeGeo.translate(0, -0.5, 0);
  const plume = new THREE.Group(); plume.position.y = -BELL; tvc.add(plume);
  const plumeOuter = new THREE.Mesh(plumeGeo, plumeMat(0x6a8cff, 0.85));
  const plumeInner = new THREE.Mesh(plumeGeo, plumeMat(0xf0f4ff, 1.3));
  plume.add(plumeOuter, plumeInner);
  const engineLight = new THREE.PointLight(0xaac4ff, 0, 220, 1.6); engineLight.position.y = -6; plume.add(engineLight);
  function setPlume(thr, t) {
    plume.visible = thr > 0.01;
    const len = 18 + 42 * thr, r = 3.2 + 5 * thr;
    plumeOuter.scale.set(r, len, r); plumeInner.scale.set(r * 0.42, len * 0.55, r * 0.42);
    plumeOuter.material.uniforms.uT.value = plumeInner.material.uniforms.uT.value = t;
    engineLight.intensity = thr > 0.01 ? 7000 * (0.4 + thr) : 0;
  }

  // ---------- Particles: one tinted system per blend mode ----------
  function createPoints(N, additive) {
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), size = new Float32Array(N), alpha = new Float32Array(N);
    const p = Array.from({ length: N }, () => ({ life: 0 }));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1)); geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uScale: { value: 500 } },
      vertexShader: `uniform float uScale; attribute vec3 aColor; attribute float aSize; attribute float aAlpha; varying vec3 vC; varying float vA;
        void main(){ vC = aColor; vA = aAlpha; vec4 mv = modelViewMatrix*vec4(position,1.0);
          gl_PointSize = min(aSize*uScale/max(-mv.z,0.01), 700.0); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: additive
        ? `varying vec3 vC; varying float vA; void main(){ float r = length(gl_PointCoord-0.5)*2.0; if (r>1.0) discard; gl_FragColor = vec4(vC*vA*pow(1.0-r,1.6), 1.0); }`
        : `varying vec3 vC; varying float vA; void main(){ float r = length(gl_PointCoord-0.5)*2.0; if (r>1.0) discard; gl_FragColor = vec4(vC, vA*pow(1.0-r,1.4)); }` });
    const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; scene.add(pts);
    let next = 0;
    return {
      // o = { x, y, z, vx, vy, vz, life, s0, s1, a, drag, rgb: [r, g, b], fire: bool (cools from yellow to red) }
      emit(o) { const q = p[next]; Object.assign(q, o, { age: 0, max: o.life }); pos.set([o.x, o.y, o.z], next * 3); col.set(o.rgb ?? [1, 1, 1], next * 3); next = (next + 1) % N; },
      update(dt) {
        for (let i = 0; i < N; i++) {
          const q = p[i]; if (q.life <= 0) { alpha[i] = 0; continue; }
          q.life -= dt; q.age += dt; const k = Math.max(0, 1 - q.drag * dt);
          q.vx *= k; q.vy = q.vy * k - (q.g ?? 0) * dt; q.vz *= k;
          pos[i * 3] += q.vx * dt; pos[i * 3 + 1] += q.vy * dt; pos[i * 3 + 2] += q.vz * dt;
          const u = Math.min(1, q.age / q.max);
          if (q.fire) { const h = 1 - u; col.set([1, 0.35 + 0.6 * h * h, 0.1 + 0.5 * h ** 4], i * 3); }
          size[i] = q.s0 + (q.s1 - q.s0) * Math.sqrt(u); alpha[i] = q.a * Math.min(1, q.age * 10) * Math.pow(1 - u, 1.2);
        }
        for (const a of ['position', 'aColor', 'aSize', 'aAlpha']) geo.attributes[a].needsUpdate = true;
      },
      clear() { p.forEach(q => { q.life = 0; }); alpha.fill(0); },
      setScale(s) { mat.uniforms.uScale.value = s; },
    };
  }
  const dust = createPoints(2400, false), fire = createPoints(1000, true);
  const DUST = [0.72, 0.5, 0.36], STREAK = [0.95, 0.85, 0.75];
  const debris = [];
  { for (let i = 0; i < 46; i++) {
      const s = rnd(0.6, 3), m = new THREE.Mesh(new THREE.BoxGeometry(s, s * rnd(0.2, 0.6), s * rnd(0.5, 1.2)), i % 3 ? M.dark : M.steel);
      m.visible = false; m.castShadow = true; scene.add(m); debris.push({ m, v: new THREE.Vector3(), w: new THREE.Vector3() });
    } }
  const flash = new THREE.PointLight(0xffa040, 0, 900, 1.4); scene.add(flash);

  // ---------- State ----------
  let source = 'sim';                 // 'rig' | 'sim'
  let state = 'idle';                 // idle | entry | tvc | landed | crashed (+ 'falling', 'tipping' on the way)
  let outcome = null, legK = 0, trim = { x: 0, y: 0 }, trimN = 0, holdCalled = false, legsCalled = false;
  const START = L.entryStart();       // where to start so the entry hands over above the pad
  let entry = L.createEntry(START.x0), term = null;
  const att = L.createAttitudeSim();
  const shown = { tiltX: 0, tiltY: 0, gx: 0, gy: 0 };   // the TVC's attitude (deg), once it has control
  let rig = null, rigSeen = -1e9;
  let gustPlan = [], promptPlan = [], maxTilt = 0, maxGimbal = 0, td = null, lost = false, flipCalled = false, burnCalled = false;
  const trail = [];
  const tracker = L.createTracker(d => {
    feed(`Pushed to <b>${d.peak.toFixed(1)}°</b> · back in <b>${d.recover.toFixed(2)} s</b>`, d.peak > 15 ? 'warn' : 'ok');
  });
  const fall = { v: new THREE.Vector3(), axis: new THREE.Vector3(), ang: 0, rate: 0 };

  document.addEventListener('tvc:sample', e => { rig = e.detail; rigSeen = performance.now(); });
  const rigLive = () => performance.now() - rigSeen < 1500;   // the feed is 20-100 Hz: 1.5 s of silence = no link

  // A common view of where the ship is, whichever half of the flight it is in
  const pos = () => term ? { x: term.s.x, h: term.s.h, z: term.s.z, vx: term.s.vx, vh: term.s.vs, vz: term.s.vz }
                         : { x: entry.s.x, h: entry.s.h, z: 0, vx: entry.s.vx, vh: entry.s.vh, vz: 0 };

  // ---------- UI ----------
  const goBtn = $('lndGo'), tvcBtn = $('lndTvc'), gustBtn = $('lndGust'), camBtn = $('lndCam'), loopBox = $('lndLoop');
  const srcBtns = [...document.querySelectorAll('#lndSrc button')];
  const running = () => state === 'entry' || state === 'tvc' || state === 'falling' || state === 'tipping';
  function setSource(s) {
    if (running()) return;
    source = s;
    srcBtns.forEach(b => b.classList.toggle('on', b.dataset.src === s));
    $('landing').dataset.src = s;
    try { localStorage.setItem('tvc-landing-src', s); } catch {}
    reset();
  }
  srcBtns.forEach(b => b.onclick = () => setSource(b.dataset.src));
  tvcBtn.onclick = () => { att.setTvc(!att.tvc); refresh(); };
  gustBtn.onclick = () => doGust();
  goBtn.onclick = () => (state === 'idle' ? begin() : (state === 'landed' || state === 'crashed') ? (reset(), begin()) : null);
  $('lndAgain').onclick = () => { reset(); begin(); };
  const CAMS = ['auto', 'chase', 'pad', 'free'];
  let camMode = 'auto';
  camBtn.onclick = () => { camMode = CAMS[(CAMS.indexOf(camMode) + 1) % CAMS.length]; controls.enabled = camMode === 'free'; if (camMode === 'free') controls.target.copy(ship.position); refresh(); };
  addEventListener('keydown', e => {
    if (document.body.dataset.tab !== 'landing' || e.target.closest('input, select, textarea')) return;
    if (e.key === 'g' || e.key === 'G') doGust();
    if (e.key === ' ' && (state === 'idle' || state === 'landed' || state === 'crashed')) { e.preventDefault(); goBtn.click(); }
  });

  function refresh() {
    goBtn.querySelector('.lbl').textContent = state === 'idle' ? 'Begin entry' : running() ? 'In flight' : 'Fly again';
    goBtn.disabled = running() || (source === 'rig' && !rigLive() && state === 'idle');
    srcBtns.forEach(b => { b.disabled = running(); });
    tvcBtn.querySelector('.lbl').textContent = att.tvc ? 'TVC: On' : 'TVC: Off';
    tvcBtn.classList.toggle('off', !att.tvc);
    gustBtn.querySelector('.lbl').textContent = source === 'rig' ? 'Call a gust' : 'Gust';
    gustBtn.title = source === 'rig' ? 'Shows a prompt to push the real rocket (G)' : 'Shove the ship sideways (G)';
    camBtn.querySelector('.lbl').textContent = 'Cam: ' + camMode[0].toUpperCase() + camMode.slice(1);
  }

  let calloutTimer = 0;
  function callout(html, ms = 2200, cls = '') {
    const c = $('lndCallout'); c.innerHTML = html; c.className = 'callout show ' + cls;
    clearTimeout(calloutTimer); calloutTimer = setTimeout(() => { c.className = 'callout ' + cls; }, ms);
  }
  function feed(html, cls = '') {
    const li = document.createElement('li'); li.className = cls; li.innerHTML = html;
    const list = $('lndFeed'); list.prepend(li);
    while (list.childElementCount > 5) list.lastElementChild.remove();
  }
  function doGust() {
    if (state !== 'tvc') return;
    if (source === 'sim') { att.gust(rnd(0, 360), GUST_SCALE); callout('GUST'); }
    else callout('GUST INCOMING · <b>PUSH THE ROCKET</b>', 2600, 'warn');
  }

  let loopTimer = 0;
  function reset() {
    state = 'idle'; outcome = null; legK = 0; td = null; lost = false;
    holdCalled = legsCalled = flipCalled = burnCalled = false;
    entry = L.createEntry(START.x0); term = null; att.reset(); tracker.reset();
    trim = { x: 0, y: 0 }; trimN = 0; maxTilt = 0; maxGimbal = 0; trail.length = 0;
    Object.assign(shown, { tiltX: 0, tiltY: 0, gx: 0, gy: 0 });
    fall.ang = fall.rate = 0;
    ship.visible = true; debris.forEach(d => { d.m.visible = false; }); fire.clear(); dust.clear();
    $('lndResult').hidden = true; $('lndFeed').textContent = '';
    clearTimeout(loopTimer); $('lndLoopNote').textContent = '';
    setLegs(0);
    placeShip();
    refresh();
  }
  function begin() {
    if (source === 'rig' && !rigLive()) { callout('NO RIG DATA · CONNECT THE ARDUINO', 2600, 'warn'); return; }
    state = 'entry';
    callout('ENTRY INTERFACE · BELLY FLOP', 2400);
    refresh();
  }
  function handover() {
    term = L.createTerminal({ x: entry.s.x, h: entry.s.h, vx: entry.s.vx, vh: entry.s.vh, m: entry.s.m });
    if (trimN) { trim.x /= trimN; trim.y /= trimN; }
    att.reset();
    state = 'tvc';
    // Simulated: three gusts on the way down. Rig: prompts to push the real rocket.
    gustPlan = source === 'sim' ? [4, 10, 16].map(t => ({ t: t + rnd(-0.8, 0.8), dir: rnd(0, 360) })) : [];
    promptPlan = source === 'rig' ? [4, 12].map(t => ({ t })) : [];
    callout(source === 'rig' ? 'TVC CONTROL · <b>RIG ACTIVE</b>' : 'TVC CONTROL · SIMULATED', 2400);
    refresh();
  }

  // ---------- Simulation step (100 Hz) ----------
  function readAttitude() {
    if (source === 'sim') return att.read();
    if (!rig) return { tiltX: 0, tiltY: 0, gx: 0, gy: 0 };
    return { tiltX: rig.tiltX - trim.x, tiltY: rig.tiltY - trim.y, gx: rig.gx ?? 0, gy: rig.gy ?? 0 };
  }
  function simStep() {
    if (state === 'entry') {
      const e = entry.s;
      entry.step();
      if (e.phase === 'flip' && !flipCalled) { flipCalled = true; callout('FLIP', 1800); }
      if (e.phase === 'burn' && !burnCalled) { burnCalled = true; callout('LANDING BURN', 1800); }
      if (e.h < L.LEGS_AT && !legsCalled) { legsCalled = true; callout('LEGS DEPLOYED', 1400); }
      if (e.h < L.LEGS_AT) legK = clamp(legK + L.DT / 2.5, 0, 1);
      // Rig: ask for a still rocket just before the handover, then average its resting lean as the trim
      if (source === 'rig' && e.phase === 'burn') {
        if (e.h < 420 && !holdCalled) { holdCalled = true; callout('HANDOVER SOON · <b>HOLD THE ROCKET STILL</b>', 2600, 'warn'); }
        if (e.h < 260 && rig && rigLive()) { trim.x += rig.tiltX; trim.y += rig.tiltY; trimN++; }
      }
      if (e.phase === 'handover') handover();
      return;
    }
    if (state !== 'tvc') return;
    const s = term.s;
    if (source === 'rig' && !rigLive()) { lost = true; return; }   // pause until the rig link is back
    lost = false;
    const t = s.t;
    for (const g of gustPlan) if (!g.done && t >= g.t) { g.done = true; att.gust(g.dir, GUST_SCALE); callout('GUST'); }
    for (const p of promptPlan) if (!p.done && t >= p.t) { p.done = true; callout('GUST INCOMING · <b>PUSH THE ROCKET</b>', 2600, 'warn'); }
    if (source === 'sim') att.step(1 + 1.5 * sstep(60, 0, s.h));       // dust blown back up near the ground
    const a = readAttitude(), tilt = L.tiltOf(a.tiltX, a.tiltY);
    Object.assign(shown, a);
    maxTilt = Math.max(maxTilt, tilt); maxGimbal = Math.max(maxGimbal, Math.abs(a.gx), Math.abs(a.gy));
    tracker.step(t, tilt);
    if (tilt > L.ABORT_DEG) { startFall(); return; }
    term.step(a);
    if (s.h <= groundUnder()) touchdown(tilt);
  }
  const groundUnder = () => { const p = pos(); return heightAt(p.x, p.z); };

  function touchdown(tilt) {
    const s = term.s, miss = term.drift;
    td = { tilt, vs: -s.vs, miss };
    s.h = groundUnder();
    if (tilt > L.TIP_DEG) { startTip(); return; }
    state = 'landed';
    const onPad = miss <= L.PAD_R;
    outcome = { ok: true,
      title: tilt <= L.LAND_OK_DEG ? (onPad ? 'TOUCHDOWN' : 'TOUCHDOWN · OFF THE PAD') : 'HARD LANDING',
      sub: tilt <= L.LAND_OK_DEG
        ? (onPad ? `Upright on the pad, ${miss.toFixed(1)} m from centre` : `Upright, but ${miss.toFixed(1)} m from the pad centre`)
        : `It stayed up, landing at ${tilt.toFixed(1)}°` };
    for (let i = 0; i < 240; i++) {
      const a = rnd(0, Math.PI * 2), v = rnd(14, 34);
      dust.emit({ x: s.x, y: s.h + 0.5, z: s.z, vx: Math.cos(a) * v, vy: rnd(0.5, 4), vz: Math.sin(a) * v, life: rnd(2, 5), s0: 3, s1: rnd(12, 24), a: 0.55, drag: 0.8, rgb: DUST });
    }
    finish();
  }
  function startFall() {
    state = 'falling';
    const ax = L.axisFromTilt(shown.tiltX, shown.tiltY);
    fall.axis.set(ax.z, 0, -ax.x).normalize();   // tumble further the way it leans
    fall.rate = 0.6; fall.v.set(term.s.vx, term.s.vs, term.s.vz);
    callout('LOSS OF CONTROL', 2400, 'warn');
    refresh();
  }
  function startTip() {
    state = 'tipping';
    const ax = L.axisFromTilt(shown.tiltX, shown.tiltY);
    fall.axis.set(ax.z, 0, -ax.x).normalize(); fall.rate = 0.18;
    callout('TIPPING OVER', 2000, 'warn');
    refresh();
  }
  function explode(at, why) {
    state = 'crashed';
    ship.visible = false;
    for (let i = 0; i < 700; i++) {
      const u = rnd(-1, 1), a = rnd(0, Math.PI * 2), r = Math.sqrt(1 - u * u), v = rnd(6, 48);
      fire.emit({ x: at.x, y: at.y + rnd(0, 10), z: at.z, vx: r * Math.cos(a) * v, vy: Math.abs(u) * v * 0.8 + 3, vz: r * Math.sin(a) * v, life: rnd(0.8, 2.4), s0: rnd(4, 7), s1: rnd(14, 32), a: rnd(0.5, 1), drag: 1.4, g: L.G, fire: true });
    }
    for (let i = 0; i < 320; i++) {
      const a = rnd(0, Math.PI * 2), v = rnd(4, 26);
      dust.emit({ x: at.x, y: at.y + rnd(0, 5), z: at.z, vx: Math.cos(a) * v, vy: rnd(1, 10), vz: Math.sin(a) * v, life: rnd(3, 8), s0: 5, s1: rnd(18, 40), a: 0.6, drag: 0.5, rgb: [0.35, 0.25, 0.2] });
    }
    debris.forEach(d => {
      d.m.visible = true; d.m.position.set(at.x + rnd(-5, 5), at.y + rnd(2, 20), at.z + rnd(-5, 5));
      const a = rnd(0, Math.PI * 2), v = rnd(6, 32); d.v.set(Math.cos(a) * v, rnd(8, 30), Math.sin(a) * v);
      d.w.set(rnd(-5, 5), rnd(-5, 5), rnd(-5, 5));
    });
    flash.position.set(at.x, at.y + 10, at.z); flash.intensity = 4e5;
    shake = 2.2;
    outcome = { ok: false, title: why === 'tip' ? 'TIPPED OVER' : 'LOSS OF CONTROL',
      sub: why === 'tip' ? `Touched down leaning ${td.tilt.toFixed(1)}° and fell over (limit ${L.TIP_DEG}°)`
        : `Tilted past the ${L.ABORT_DEG}° abort at ${Math.max(0, pos().h).toFixed(0)} m${source === 'sim' && !att.tvc ? ', with the TVC switched off' : ''}` };
    finish();
  }
  function finish() {
    refresh();
    setTimeout(() => showResult(), outcome.ok ? 1400 : 2200);
    if (loopBox.checked) {
      let n = 10;
      const tick = () => {
        if (!loopBox.checked || (state !== 'landed' && state !== 'crashed')) { $('lndLoopNote').textContent = ''; return; }
        $('lndLoopNote').textContent = `Next entry in ${n} s`;
        if (n-- <= 0) { $('lndLoopNote').textContent = ''; if (source === 'sim' || rigLive()) { reset(); begin(); } return; }
        loopTimer = setTimeout(tick, 1000);
      };
      tick();
    }
  }
  function showResult() {
    if (state !== 'landed' && state !== 'crashed') return;
    const r = $('lndResult'), d = tracker.done;
    r.hidden = false; r.classList.toggle('bad', !outcome.ok);
    $('lndResTitle').textContent = outcome.title;
    $('lndResSub').textContent = outcome.sub;
    const best = d.length ? Math.min(...d.map(x => x.recover)) : null;
    $('lndResStats').innerHTML = [
      ['Pushes survived', String(d.length)],
      ['Biggest push', `${maxTilt.toFixed(1)}°`],
      ['Fastest recovery', best === null ? '—' : `${best.toFixed(2)} s`],
      ['Peak gimbal', `${maxGimbal.toFixed(1)}°`],
      ['Touchdown tilt', td ? `${td.tilt.toFixed(1)}°` : '—'],
      ['From pad centre', td ? `${td.miss.toFixed(1)} m` : '—'],
    ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    $('lndResSrc').textContent = source === 'rig' ? 'Last 150 m flown by the real rocket on the desk rig'
      : `Last 150 m simulated, TVC ${att.tvc ? 'on' : 'off'} (same controller as the Nano)`;
  }

  // ---------- Placing the ship ----------
  const _q = new THREE.Quaternion(), _pv = new THREE.Vector3(), _up = new THREE.Vector3(), _z = new THREE.Vector3(0, 0, 1);
  const CG_H = () => TAIL + FOOT * legK;   // CG above the ground when upright on its feet
  function placeShip() {
    if (state === 'falling' || state === 'tipping') return;    // animated in fallStep
    const p = pos();
    if (!term) {   // entry: pitched in the x-h plane about the CG; the gimbal swings in the same plane
      const s = entry.s;
      ship.rotation.set(0, 0, 0); ship.quaternion.setFromAxisAngle(_z, -s.th);
      // h is the tail's height; the CG sits TAIL up the body axis from it
      ship.position.set(s.x + Math.sin(s.th) * TAIL, s.h + Math.cos(s.th) * CG_H(), 0);
      tvc.rotation.set(0, 0, -s.gim);
      // Flaps: working in the belly flop (the trim pitches it), folding toward the back once the engines take over
      const k = s.phase === 'entry' ? 1 : Math.max(0, 1 - (s.t - s.tPh) / 3);
      setFlaps(lerp(-0.2, 0.3 + 0.35 * s.flap, k), lerp(-0.2, 0.3 - 0.35 * s.flap, k));
    } else {
      setFlaps(-0.2, -0.2);
      const ax = L.axisFromTilt(shown.tiltX, shown.tiltY);
      ship.rotation.set(Math.atan2(ax.z, ax.y), 0, Math.atan2(-ax.x, Math.hypot(ax.y, ax.z)));
      ship.position.set(p.x + ax.x * TAIL, p.h + CG_H(), p.z + ax.z * TAIL);
      tvc.rotation.set(shown.gx * DEG, 0, -shown.gy * DEG);
    }
    setLegs(sstep(0, 1, legK));
  }
  function lowestPoint() {
    _up.set(0, 1, 0).applyQuaternion(ship.quaternion);
    const yNose = ship.position.y + _up.y * NOSE, yTail = ship.position.y - _up.y * (TAIL + BELL);
    return Math.min(yNose, yTail);
  }
  function fallStep(dt) {
    if (state === 'falling') {
      fall.rate += 0.9 * dt;
      ship.rotateOnWorldAxis(fall.axis, fall.rate * dt);
      fall.v.y -= L.G * dt;
      ship.position.addScaledVector(fall.v, dt);
      term.s.h = ship.position.y - TAIL; term.s.vs = fall.v.y;
      if (lowestPoint() <= heightAt(ship.position.x, ship.position.z) + 0.3) explode(ship.position.clone().setY(heightAt(ship.position.x, ship.position.z)), 'air');
    } else if (state === 'tipping') {
      fall.rate += 1.4 * dt;
      const ang = fall.rate * dt, ax = L.axisFromTilt(shown.tiltX, shown.tiltY), hl = Math.hypot(ax.x, ax.z) || 1;
      const pivot = _pv.set(term.s.x + ax.x / hl * FOOT_R, groundUnder(), term.s.z + ax.z / hl * FOOT_R);
      _q.setFromAxisAngle(fall.axis, ang);
      ship.position.sub(pivot).applyQuaternion(_q).add(pivot);
      ship.quaternion.premultiply(_q);
      fall.ang += ang;
      if (fall.ang > 1.05) explode(ship.position.clone().setY(groundUnder()), 'tip');
    }
  }

  // ---------- Camera: follows the ship rigidly (it moves at 330 m/s), smoothing only its offset ----------
  const camOff = new THREE.Vector3(-105, 42, -118), lookOff = new THREE.Vector3(), _co = new THREE.Vector3(), _lo = new THREE.Vector3();
  let shake = 0, orbit = 0, padCam = false;
  const PAD_CAM = new THREE.Vector3(-82, 6, -98);
  function camGoal(mode) {
    const h = pos().h;
    if (mode === 'side') {          // entry and flip: broadside, the ground far below in the haze
      _co.set(-105 + 30 * Math.sin(orbit), 42, -118); _lo.set(0, -8, 0);   // three-quarter view from the sun side, so the ship is lit
    } else if (mode === 'chase') {  // burn and TVC phase: from above, the pad below; lower as it nears the ground
      const k = sstep(40, 900, h), az = Math.atan2(SUN.z, SUN.x) + 0.5 * Math.sin(orbit), el = lerp(16, 50, k) * DEG, R = lerp(110, 170, k);
      _co.set(R * Math.cos(el) * Math.cos(az), R * Math.sin(el), R * Math.cos(el) * Math.sin(az));
      _lo.set(0, -8 - 0.08 * k * Math.min(h, 600), 0);
    }
  }
  function cameraStep(dt) {
    if (camMode === 'free') { controls.target.lerp(ship.position, 1 - Math.exp(-dt * 3)); controls.update(); return; }
    orbit += dt * (state === 'idle' ? 0.15 : 0.04);
    let mode = camMode === 'auto'
      ? (state === 'idle' || (state === 'entry' && entry.s.phase !== 'burn') ? 'side'
        : (state === 'tvc' && term.s.h <= 55) || state === 'landed' || state === 'tipping' || (state === 'crashed' && td) ? 'pad' : 'chase')
      : camMode;
    const sp = ship.position;
    if (mode === 'pad') {
      padCam = true;
      camera.position.lerp(PAD_CAM, 1 - Math.exp(-dt * 2));
      _lo.set(sp.x * 0.8, clamp(0.45 * (sp.y + 15), 14, 60), sp.z * 0.8);
      lookOff.lerp(_lo, 1 - Math.exp(-dt * 4));
      camera.lookAt(lookOff);
    } else {
      if (padCam) { camOff.copy(camera.position).sub(sp); padCam = false; }
      camGoal(mode);
      camOff.lerp(_co, 1 - Math.exp(-dt * 1.2)); lookOff.lerp(_lo, 1 - Math.exp(-dt * 2));
      camera.position.copy(sp).add(camOff);
      const gmin = heightAt(camera.position.x, camera.position.z) + 3;
      if (camera.position.y < gmin) camera.position.y = gmin;
      camera.lookAt(_pv.copy(sp).add(lookOff));
    }
    const buffet = state === 'entry' ? clamp(entry.s.q / 1100, 0, 1) * 0.5 + (entry.s.phase === 'flip' ? 0.6 : 0) : state === 'tvc' ? 0.35 * sstep(40, 0, term.s.h) : 0;
    const sh = shake + buffet;
    if (sh > 0.001) camera.position.add(_co.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(sh * 0.6));
    shake *= Math.exp(-dt * 2.5);
    const fov = mode === 'pad' ? 44 : 40;
    if (camera.fov !== fov) { camera.fov = fov; resize(); }
  }

  // ---------- HUD ----------
  const sgn = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1);
  const R_PER_DEG = 40 / 25;   // dial: 25° at r = 40
  const PH = ['entry', 'flip', 'burn', 'tvc', 'td'];
  function phaseKey() {
    if (state === 'entry') return entry.s.phase === 'handover' ? 'tvc' : entry.s.phase;
    if (state === 'tvc' || state === 'falling') return 'tvc';
    if (state === 'landed' || state === 'crashed' || state === 'tipping') return 'td';
    return null;
  }
  function hud() {
    const p = pos(), a = shown, tilt = state === 'tvc' || state === 'landed' || state === 'tipping' ? L.tiltOf(a.tiltX, a.tiltY) : 0;
    const airborne = state !== 'landed' && state !== 'crashed';
    const alt = airborne ? Math.max(0, p.h - groundUnder()) : 0;
    $('lndAlt').textContent = alt >= 1000 ? (alt / 1000).toFixed(2) : alt.toFixed(alt < 10 ? 1 : 0);
    $('lndAltU').textContent = alt >= 1000 ? 'km' : 'm';
    const flying = state === 'entry' || state === 'tvc' || state === 'falling';
    $('lndVs').textContent = (flying ? p.vh : 0).toFixed(1);
    $('lndSpd').textContent = flying ? (Math.hypot(p.vx, p.vh, p.vz) * 3.6).toFixed(0) : '0';
    const thr = state === 'tvc' ? term.throttle : state === 'entry' ? entry.s.thr : 0;
    $('lndThr').style.width = `${clamp(thr, 0, 1) * 100}%`;
    $('lndThrV').textContent = `${Math.round(clamp(thr, 0, 1) * 100)}%`;
    $('lndDrift').textContent = Math.hypot(p.x, p.z) >= 1000 ? (Math.hypot(p.x, p.z) / 1000).toFixed(2) + ' km' : Math.hypot(p.x, p.z).toFixed(0) + ' m';
    $('lndTtg').textContent = state === 'tvc' ? L.timeToGo(term.s.h).toFixed(0) + ' s' : '—';
    const e = entry.s;
    $('lndPhase').textContent = lost ? 'SIGNAL LOST'
      : state === 'idle' ? 'READY FOR ENTRY'
      : state === 'entry' ? (e.phase === 'entry' ? 'BELLY FLOP' : e.phase === 'flip' ? 'FLIP' : 'LANDING BURN')
      : state === 'tvc' ? (term.s.h > 20 ? (source === 'rig' ? 'TVC CONTROL · RIG' : 'TVC CONTROL') : 'FINAL METRES')
      : state === 'falling' ? 'LOSS OF CONTROL' : state === 'tipping' ? 'TIPPING OVER'
      : outcome?.title ?? '';
    $('lndPhase').classList.toggle('warn', lost || state === 'falling' || state === 'tipping' || state === 'crashed');
    const k = phaseKey(), ki = PH.indexOf(k);
    document.querySelectorAll('#lndChips span').forEach((c, i) => { c.classList.toggle('on', i === ki); c.classList.toggle('done', ki > i); });
    // Attitude dial: the TVC's tilt and nozzle; in the entry, the ship's pitch shows as text
    const px = clamp(a.tiltY, -30, 30) * R_PER_DEG, py = -clamp(a.tiltX, -30, 30) * R_PER_DEG;
    $('lndTiltDot').setAttribute('cx', px); $('lndTiltDot').setAttribute('cy', py);
    $('lndTiltVec').setAttribute('x2', px); $('lndTiltVec').setAttribute('y2', py);
    $('lndGimDot').setAttribute('cx', a.gy * 5); $('lndGimDot').setAttribute('cy', -a.gx * 5);
    if (state === 'tvc') { trail.push([px, py]); if (trail.length > 45) trail.shift(); }
    $('lndTrail').setAttribute('points', trail.map(q => q.join(',')).join(' '));
    if (state === 'entry' || state === 'idle') {
      $('lndTiltL').textContent = 'Pitch'; $('lndTilt').textContent = (e.th / DEG).toFixed(0) + '°'; $('lndTilt').className = '';
    } else {
      $('lndTiltL').textContent = 'Tilt'; $('lndTilt').textContent = tilt.toFixed(1) + '°';
      $('lndTilt').className = tilt > 15 ? 'warn' : tilt > 8 ? 'amber' : '';
    }
    $('lndTX').textContent = sgn(a.tiltX) + '°'; $('lndTY').textContent = sgn(a.tiltY) + '°';
    $('lndGX').textContent = sgn(a.gx) + '°'; $('lndGY').textContent = sgn(a.gy) + '°';
    const live = rigLive(), src = $('lndSource');
    src.classList.toggle('live', source === 'rig' && live); src.classList.toggle('sim', source === 'sim');
    $('lndSrcTitle').textContent = source === 'sim' ? 'SIMULATED TVC' : live ? (rig?.demo ? 'RIG · BENCH DEMO FEED' : 'RIG · LIVE') : 'RIG · NO DATA';
    $('lndSrcSub').innerHTML = source === 'sim'
      ? (att.tvc ? 'Autopilot to 150 m, then the Nano’s controller lands it. <b>Gust</b> (G) shoves it.' : 'TVC is <b>off</b>: nothing holds it upright once it hands over.')
      : live ? 'Autopilot to 150 m, then the ship follows the real rocket. <b>Push it</b> and watch the TVC fight back.'
      : 'Connect the Arduino (top bar) or switch to <b>Simulated</b>.';
    if (state === 'idle') goBtn.disabled = source === 'rig' && !live;
  }

  // ---------- Effects per frame ----------
  function effects(dt) {
    const sp = ship.position;
    _up.set(0, 1, 0).applyQuaternion(ship.quaternion);
    // Speed streaks while falling fast: dust in the air the ship rushes past
    if (state === 'entry') {
      const v = Math.hypot(entry.s.vx, entry.s.vh), n = Math.round(clamp((v - 60) / 60, 0, 5));
      for (let i = 0; i < n; i++) {
        const ahead = rnd(40, 200);
        dust.emit({ x: sp.x + entry.s.vx / v * ahead + rnd(-70, 70), y: sp.y + entry.s.vh / v * ahead + rnd(-50, 50), z: rnd(-90, 90),
          vx: 0, vy: 0, vz: 0, life: rnd(0.5, 1.1), s0: 0.6, s1: 1.4, a: 0.35, drag: 0, rgb: STREAK });
      }
      // Flip: nose RCS puffs
      if (entry.s.rcs && Math.random() < 0.7) {
        const nose = _pv.copy(sp).addScaledVector(_up, NOSE * 0.8), side = Math.sign(entry.s.rcs);
        for (let i = 0; i < 3; i++) dust.emit({ x: nose.x, y: nose.y, z: nose.z + rnd(-3, 3), vx: -_up.y * 30 * side + entry.s.vx, vy: _up.x * 30 * side + entry.s.vh, vz: rnd(-4, 4),
          life: rnd(0.3, 0.7), s0: 1.5, s1: 6, a: 0.7, drag: 3, rgb: [1, 1, 1] });
      }
    }
    // Dust blown off the ground where the plume meets it
    if (plume.visible && ship.visible) {
      const exit = _pv.copy(sp).addScaledVector(_up, -(TAIL + BELL));
      const g = heightAt(exit.x, exit.z), d = (exit.y - g) / Math.max(_up.y, 0.3);
      if (d < 90 && _up.y > 0.3) {
        const k = 1 - d / 90, gx = exit.x - _up.x * d, gz = exit.z - _up.z * d, n = Math.round(26 * k * k + 3);
        for (let i = 0; i < n; i++) {
          const a = rnd(0, Math.PI * 2), v = rnd(18, 50) * (0.4 + k);
          dust.emit({ x: gx + Math.cos(a) * 3, y: g + 0.6, z: gz + Math.sin(a) * 3, vx: Math.cos(a) * v, vy: rnd(0.4, 5), vz: Math.sin(a) * v,
            life: rnd(1, 3), s0: 2.5, s1: rnd(9, 20) * (0.6 + k), a: 0.4 + 0.3 * k, drag: 0.6, rgb: DUST });
        }
      }
    }
    dust.update(dt); fire.update(dt);
    debris.forEach(d => {
      if (!d.m.visible) return;
      d.v.y -= L.G * dt; d.m.position.addScaledVector(d.v, dt);
      d.m.rotation.x += d.w.x * dt; d.m.rotation.y += d.w.y * dt; d.m.rotation.z += d.w.z * dt;
      const g = heightAt(d.m.position.x, d.m.position.z) + 0.3;
      if (d.m.position.y < g) { d.m.position.y = g; d.v.multiplyScalar(0.35); d.v.y = Math.abs(d.v.y) * 0.4; d.w.multiplyScalar(0.5); }
    });
    flash.intensity *= Math.exp(-dt * 3.5);
  }

  // ---------- Loop ----------
  function resize() {
    const w = view.clientWidth, h = view.clientHeight;
    if (w < 2 || h < 2) return;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    const sc = h * renderer.getPixelRatio() / (2 * Math.tan(camera.fov * DEG / 2));
    dust.setScale(sc); fire.setScale(sc);
  }
  new ResizeObserver(resize).observe(view);

  let last = performance.now(), acc = 0, lastHud = 0, warmed = false, t = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.1); last = now;
    if (document.body.dataset.tab !== 'landing') return;      // paused while another tab shows
    t += dt; acc += dt;
    while (acc >= L.DT) {
      acc -= L.DT;
      if (state === 'idle' && source === 'rig' && rig && rigLive()) Object.assign(shown, readAttitude());
      else simStep();
    }
    fallStep(dt);
    placeShip();
    const thr = state === 'tvc' ? term.throttle : state === 'entry' ? entry.s.thr : 0;
    setPlume(state === 'falling' ? 0 : thr, t);
    effects(dt);
    padLights.forEach((m, i) => { m.visible = Math.floor(t * 2 + i / 3) % 2 === 0 || state === 'landed'; });
    // Shadow box on the spot where the ship's shadow falls
    const lp = ship.position, throwD = Math.max(lp.y, 0) / SUN.y;
    sun.target.position.copy(lp).addScaledVector(SUN, -throwD); sun.position.copy(sun.target.position).addScaledVector(SUN, throwD + 120);
    if (Math.abs(sun.shadow.camera.far - (throwD + 300)) > 30) { sun.shadow.camera.far = throwD + 300; sun.shadow.camera.updateProjectionMatrix(); }
    cameraStep(dt);
    if (warmed && window.tvcCovered?.()) return;
    renderer.render(scene, camera); warmed = true;
    if (now - lastHud > 60) { lastHud = now; hud(); }
  }

  try { const s = localStorage.getItem('tvc-landing-src'); if (s === 'rig' || s === 'sim') source = s; } catch {}
  setSource(source);
  camera.position.copy(ship.position).add(camOff);
  resize();
  requestAnimationFrame(frame);
  return { resize };
}
