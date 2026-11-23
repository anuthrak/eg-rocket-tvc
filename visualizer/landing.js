// Landing tab: a Starship-style ship landing on Mars, for the showcase.
//   Idle: the ship in orbit (landing-orbit.js draws the planet; the ship is drawn on top at metre scale).
//   Begin descent: deorbit burn, then a time-compressed plasma entry, a cut inside the cloud deck to the ground scene,
//   the belly flop and flip on autopilot (landing-sim.js createFlight), and the TVC landing from right after the flip:
//     Rig       - the real rocket's tilt and nozzle angles on the desk rig (bench.js 'tvc:sample' events) are added on
//                 top of the autopilot's attitude, so pushing the real rocket pushes the ship.
//     Simulated - the Nano's controller (controller.js) instead, with gusts and a TVC on/off switch.
//   Endings get a short slow-motion replay, then the result card. Illustrative, not to scale in time.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as L from './landing-sim.js';
import { createOrbitScene, R_MARS } from './landing-orbit.js';
import { blendLooks, easeLook, newLook, createPost, createFlare, QUALITY, Q_ORDER } from './landing-look.js';

const $ = id => document.getElementById(id);
const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, k) => a + (b - a) * k;
const sstep = (a, b, x) => { const s = clamp((x - a) / (b - a), 0, 1); return s * s * (3 - 2 * s); };
const rnd = (a, b) => a + Math.random() * (b - a);
// Phase → look (landing-look.js): [from, to, how far] blended by the phase's own progress. Tune here.
//   orbit, deorbit: space · entry: C → B as it descends · cut into the cloud deck: B (hazy) ·
//   belly flop and flip: B → A as it descends · TVC landing and touchdown: A · crash: C
const PHASE_LOOKS = {
  orbit: () => ['space'], deorbit: () => ['space'],
  entry: u => u < 0.55 ? ['space', 'C', u / 0.55] : ['C', 'B', (u - 0.55) / 0.45],
  belly: h => ['B', 'A', clamp((7000 - h) / 5000, 0, 1)],
  flip: () => ['B', 'A', 0.85], tvc: () => ['A'], landed: () => ['A'], crashed: () => ['C', 'A', 0.35],
};
const GUST_SCALE = 0.85;   // of demo-sim's gust: with the TVC on, one gust peaks under ~21° (200 random runs, never past the 25° abort)

export async function initLanding(step) {
  await step?.(0.86, 'Generating Mars');

  // ---------- Renderer / scene ----------
  const view = $('landingView');
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;      // applied by the OutputPass (landing-look.js); keeps the oranges from clipping yellow
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  view.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const HAZE = new THREE.Color(0xd49a72);
  scene.fog = new THREE.FogExp2(HAZE, 1.25e-5);        // dusty air: ~30% at 30 km, the horizon (110 km) mostly hazed out
  const camera = new THREE.PerspectiveCamera(40, 1, 1, 200000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.enabled = false; controls.maxPolarAngle = 88 * DEG;

  // Afternoon sun through dusty air: a low sun for long shadows; colour and strength come from the active look
  const SUN = new THREE.Vector3(-0.6, 0.36, -0.71).normalize();    // ~21° up
  const sun = new THREE.DirectionalLight(0xffe4c2, 3.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 1, far: 1200 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.8;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xe8b08a, 0x2a140a, 0.5); scene.add(hemi);

  // Sky dome: zenith → mid → horizon glow from the active look, a sun halo, a dust band just above the horizon
  const skyU = { uSun: { value: SUN }, uZen: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uHor: { value: new THREE.Color() },
    uSunCol: { value: new THREE.Color() }, uDust: { value: 0.3 } };
  {
    const sky = new THREE.Mesh(new THREE.SphereGeometry(150000, 48, 24), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyU,
      vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); vec4 p = projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: `uniform vec3 uSun, uZen, uMid, uHor, uSunCol; uniform float uDust; varying vec3 vD;
        void main(){ vec3 d = normalize(vD); float h = clamp(d.y, -0.3, 1.0);
          vec3 c = mix(uHor, uMid, smoothstep(0.0, 0.22, h));
          c = mix(c, uZen, smoothstep(0.18, 0.85, h));
          float s = max(dot(d, normalize(uSun)), 0.0);
          c += uSunCol * (pow(s, 900.0) * 30.0 + pow(s, 60.0) * 0.6 + pow(s, 6.0) * 0.12);     // disc (blooms), halo, wide glow
          c = mix(c, uHor * 1.08, uDust * exp(-abs(h - 0.03) * 22.0));                          // dust band hugging the horizon
          c = mix(c, uHor * 0.8, smoothstep(0.0, -0.25, h));
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
  const ridged = (x, y) => { let s = 0, a = 1, f = 1; for (let i = 0; i < 4; i++) { const n = 1 - Math.abs(vnoise(x * f, y * f)); s += a * n * n; a *= 0.5; f *= 2.1; } return s / 1.875; };
  function terrain(x, z) {
    const dist = Math.hypot(x, z);
    let h = 28 * fbm(x / 1400, z / 1400) + 5 * fbm(x / 160, z / 160) + 0.6 * fbm(x / 22, z / 22);
    let far = 0, tone = 0;
    if (dist > 4000) {
      // Out to the horizon: ridged mountain ranges, flat-topped mesas, a canyon, and the planet's curve
      const kf = sstep(5000, 22000, dist);
      const mtn = 1900 * Math.pow(ridged(x / 14000 + 3.1, z / 14000 - 1.7), 2.2) * kf;
      const m = fbm(x / 6000 + 11, z / 6000 - 4), mesa = 520 * sstep(0.18, 0.26, m) * sstep(4000, 12000, dist);
      const cy = z - 26000 - 6000 * Math.sin(x / 17000), canyon = -700 * Math.exp(-((cy / 2600) ** 2)) * sstep(9000, 20000, Math.abs(x) + 8000);
      far = mtn + mesa + canyon + 60 * fbm(x / 900, z / 900) * kf;
      tone = (mtn > 300 ? -0.06 : 0) + (mesa > 260 ? 0.05 : 0) + (canyon < -200 ? -0.08 : 0);
    }
    h += far - dist * dist / (2 * 3389.5e3);
    h += 1.6 * Math.sin((x * 0.8 + z * 0.6) / 18 + 2 * vnoise(x / 90, z / 90)) * sstep(0.1, 0.6, vnoise(x / 400 + 5, z / 400));   // dune ripples
    let rimBright = 0;
    for (const [cx, cz, R] of craters) {
      const dx = x - cx, dz = z - cz; if (Math.abs(dx) > R * 1.8 || Math.abs(dz) > R * 1.8) continue;
      const q = Math.hypot(dx, dz) / R;
      if (q < 1) h -= 0.18 * R * (1 - q * q);
      const rim = Math.exp(-(((q - 1) / 0.22) ** 2)); h += 0.06 * R * rim; rimBright = Math.max(rimBright, rim);
    }
    const flat = sstep(40, 110, dist);                 // the landing zone is graded flat
    return [h * flat, rimBright * flat, tone];
  }
  const heightAt = (x, z) => terrain(x, z)[0];
  const groundU = { uGShadow: { value: new THREE.Color() }, uGMid: { value: new THREE.Color() }, uGLit: { value: new THREE.Color() },
    uGHigh: { value: new THREE.Color() }, uGRock: { value: new THREE.Color() } };
  {
    const N = 480, geo = new THREE.PlaneGeometry(2, 2, N, N); geo.rotateX(-Math.PI / 2);
    const P = geo.attributes.position, uv = geo.attributes.uv, col = new Float32Array(P.count * 3);
    const warp = u => Math.sign(u) * (160 * Math.abs(u) + 1400 * u * u + 108000 * Math.abs(u) ** 6);   // 0.7 m at the pad … 110 km out
    const tones = new Float32Array(P.count);
    for (let i = 0; i < P.count; i++) {
      const x = warp(P.getX(i)), z = warp(P.getZ(i)), [h, rim, tone] = terrain(x, z);
      P.setXYZ(i, x, h, z);
      tones[i] = 0.5 + 0.55 * fbm(x / 140 + 9, z / 140) + 0.3 * rim + 0.25 * fbm(x / 1800, z / 1800) + tone * 3;
      uv.setXY(i, x / 16, z / 16);
    }
    geo.computeVertexNormals();
    // Vertex colour carries palette coordinates, not colours: r = lightness (shadow → mid → lit → highlight),
    // g = slope (steep = rock), b = distance (fine detail fades into the haze). The shader maps them to the look.
    const N_ = geo.attributes.normal;
    for (let i = 0; i < P.count; i++) {
      const d = Math.hypot(P.getX(i), P.getZ(i));
      col.set([clamp(tones[i], 0, 1), clamp((1 - N_.getY(i)) * 4, 0, 1), sstep(2000, 30000, d)], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
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
    const gMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: detail, bumpMap: bump, bumpScale: 2.6, roughness: 1, metalness: 0 });
    gMat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, groundU);
      sh.fragmentShader = 'uniform vec3 uGShadow, uGMid, uGLit, uGHigh, uGRock;\n' + sh.fragmentShader
        .replace('#include <map_fragment>', `#ifdef USE_MAP
            vec4 sampledDiffuseColor = texture2D(map, vMapUv);
            diffuseColor *= mix(sampledDiffuseColor * 2.2, vec4(1.0), vColor.b);   // detail (averages ~0.45 linear, so x2.2), fading out with distance
          #endif`)
        .replace('#include <color_fragment>', `
          float t = vColor.r, sl = vColor.g;
          vec3 base = mix(uGShadow, uGMid, smoothstep(0.0, 0.42, t));
          base = mix(base, uGLit, smoothstep(0.42, 0.82, t));
          base = mix(base, uGHigh, smoothstep(0.86, 1.0, t) * 0.55);
          base = mix(base, uGRock, smoothstep(0.2, 0.65, sl) * 0.8);
          diffuseColor.rgb *= base;`);
    };
    const ground = new THREE.Mesh(geo, gMat);
    ground.receiveShadow = true;
    scene.add(ground);
  }

  // Cloud layers: thin water-ice / dust sheets to fall through (one just below the cut from orbit), drifting slowly
  function cloudLayer(alt, size, opacity, seed, rep) {
    const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
    const img = g.createImageData(512, 512), s0 = seed * 37.1;
    for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
      // tileable: sample noise on a torus
      const a = x / 512 * Math.PI * 2, b = y / 512 * Math.PI * 2;
      const n = fbm(Math.cos(a) * 1.6 + s0, Math.sin(a) * 1.6 + Math.cos(b) * 1.6 * 0.7) * 0.6 + fbm(Math.sin(b) * 2.4 + s0, Math.cos(a) * 2.4) * 0.4;
      const v = clamp((n + 0.15) * 2.2, 0, 1), o = (y * 512 + x) * 4;
      img.data[o] = 250; img.data[o + 1] = 236; img.data[o + 2] = 220; img.data[o + 3] = Math.round(255 * v * v);
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); t.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }));
    cloudMeshes.push([m, opacity]);
    m.rotation.x = -Math.PI / 2; m.position.y = alt; m.renderOrder = 2; scene.add(m);
    return t;
  }
  const cloudMeshes = [];
  // The cloud deck the ship falls through (6.6–8.1 km): soft sprite wisps round its path, bright lit tops, grey-orange
  // ragged base. The flat layer at 6.55 km is the overcast ceiling seen from below after the breakout.
  const DECK = { base: 6600, top: 8100 };
  const wispTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    for (let i = 0; i < 22; i++) { const x = 64 + rnd(-30, 30), y = 64 + rnd(-26, 26), r = rnd(18, 44);
      const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const wisps = [];
  // Cumulus clusters with clear sky between: one dense cluster round the ship's path (it exits near the base edge),
  // six more scattered round it. Inside the main one, packed layers of small wisps and a few big wall puffs.
  function puff(x, y, z, size, k, op) {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: wispTex, transparent: true, depthWrite: false, rotation: rnd(0, 6.28),
      color: new THREE.Color().setRGB(lerp(0.58, 1, k), lerp(0.5, 0.95, k), lerp(0.46, 0.9, k)), opacity: op }));
    m.position.set(x, y, z); m.scale.setScalar(size); m.renderOrder = 3; scene.add(m); wisps.push(m);
  }
  function buildWisps(q, cx, cz) {
    wisps.forEach(w => scene.remove(w)); wisps.length = 0;
    const H = DECK.top - DECK.base, mx = cx + 260, mz = cz + 160;   // main cluster centre: the path runs near its edge
    for (let i = 0; i < 260 * q; i++) {   // wisps packed round the path, every depth
      const y = rnd(DECK.base + 40, DECK.top), r = rnd(12, 160), a = rnd(0, 6.28), k = (y - DECK.base) / H;
      puff(cx + r * Math.cos(a), y, cz + r * Math.sin(a), rnd(30, 140), 0.45 + 0.55 * k, rnd(0.6, 0.95));
    }
    for (let i = 0; i < 10; i++) puff(cx + rnd(-40, 40), rnd(DECK.base + 200, DECK.top - 100), cz + rnd(-40, 40), rnd(160, 260), 0.8, 0.9);   // wall puffs
    for (let i = 0; i < 230 * q; i++) {   // the main cluster's body: rounded, lit top, flatter shaded base
      const u = Math.random(), y = DECK.base + H * Math.pow(u, 0.7), w = 650 * Math.sqrt(1 - 0.6 * u) * Math.sqrt(Math.random()), a = rnd(0, 6.28);
      puff(mx + w * Math.cos(a), y, mz + w * Math.sin(a), rnd(180, 420), 0.4 + 0.6 * u, 0.85);
    }
    for (let c = 0; c < 6; c++) {   // other clusters, sky between
      const a0 = c / 6 * 6.28 + rnd(-0.3, 0.3), d = rnd(2600, 6500), ox = cx + d * Math.cos(a0), oz = cz + d * Math.sin(a0), sc = rnd(0.6, 1.2);
      for (let i = 0; i < 55 * q; i++) { const u = Math.random(), w = 520 * sc * Math.sqrt(Math.random()), a = rnd(0, 6.28);
        puff(ox + w * Math.cos(a), DECK.base + H * sc * Math.pow(u, 0.7), oz + w * Math.sin(a), rnd(220, 480) * sc, 0.4 + 0.6 * u, 0.85); }
    }
  }
  const clouds = [cloudLayer(6550, 90000, 0.0, 1, 7), cloudLayer(3200, 70000, 0.32, 2, 9)];
  // Sun lens flare (landing-look.js), parked far along the sun direction each frame
  const flare = createFlare(); scene.add(flare.lf);

  // Rocks: a few noise-displaced low-poly shapes, instanced. Dense near the pad and the landing views, none on the pad.
  const rocks = [];
  {
    const rockMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0, flatShading: true });
    rockMat.onBeforeCompile = sh => { Object.assign(sh.uniforms, { uGRock: groundU.uGRock, uGMid: groundU.uGMid });
      sh.fragmentShader = 'uniform vec3 uGRock, uGMid;\n' + sh.fragmentShader.replace('#include <color_fragment>', 'diffuseColor.rgb *= mix(uGRock, uGMid, 0.35) * 1.1;'); };
    let seed = 3; const r01 = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const MAX = 4200;
    for (let v = 0; v < 3; v++) {
      const g = new THREE.IcosahedronGeometry(1, 1), P = g.attributes.position;
      for (let i = 0; i < P.count; i++) {
        const x = P.getX(i), y = P.getY(i), z = P.getZ(i), k = 0.7 + 0.45 * vnoise(x * 2.1 + v * 7, z * 2.1 + y * 1.7);
        P.setXYZ(i, x * k, y * k * 0.6, z * k);
      }
      g.computeVertexNormals();
      const m = new THREE.InstancedMesh(g, rockMat, MAX); m.castShadow = m.receiveShadow = true; m.frustumCulled = false;
      const o = new THREE.Object3D();
      for (let i = 0; i < MAX; i++) {
        const a = r01() * Math.PI * 2, d = L.PAD_R + 12 + Math.pow(r01(), 1.8) * 1400;
        const x = Math.cos(a) * d, z = Math.sin(a) * d, big = r01() < 0.04;
        const sz = big ? 2.5 + r01() * 4 : 0.25 + Math.pow(r01(), 2.2) * 2.2;
        o.position.set(x, heightAt(x, z) - sz * 0.25, z);
        o.rotation.set(r01() * 0.6, r01() * 6.28, r01() * 0.6);
        o.scale.set(sz * (0.8 + r01() * 0.6), sz * (0.6 + r01() * 0.6), sz * (0.8 + r01() * 0.6));
        o.updateMatrix(); m.setMatrixAt(i, o.matrix);
      }
      scene.add(m); rocks.push(m);
    }
  }
  const setRockDensity = k => rocks.forEach(m => { m.count = Math.round(4200 * k); });

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
  const envU = { uZen: { value: new THREE.Color(0x3f5a86) }, uHor: { value: new THREE.Color(0xd9a084) }, uGnd: { value: new THREE.Color(0x8f4222) } };
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide, uniforms: envU,
    vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uZen, uHor, uGnd; varying vec3 vD; void main(){ float h = vD.y;
      vec3 c = mix(uGnd * 0.7, uHor, smoothstep(-0.25, 0.02, h)); c = mix(c, uZen, smoothstep(0.1, 0.8, h)); gl_FragColor = vec4(c * 1.3, 1.0); }` })));
  let envRT = null; const envScenes = [scene];
  function updateEnv() {   // reflections in the steel follow the active look's sky
    const rt = pmrem.fromScene(envScene, 0.04);
    for (const sc of envScenes) sc.environment = rt.texture;
    envRT?.dispose(); envRT = rt;
  }
  updateEnv();
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
  // Vacuum engines (the deorbit burn): their bells glow orange as they heat and cool after shutdown
  const rvacMat = new THREE.MeshStandardMaterial({ color: 0x55575e, metalness: 0.9, roughness: 0.3, side: THREE.DoubleSide, emissive: new THREE.Color(1, 0.32, 0.08), emissiveIntensity: 0 });
  const rvacs = [];
  for (let i = 0; i < 3; i++) {
    const a = (30 + 120 * i) * DEG, e = bell(0.55, 1.15, 3.4); e.children[0].material = rvacMat;
    e.position.set(Math.cos(a) * 2.9, 0.5, Math.sin(a) * 2.9); airframe.add(e); rvacs.push(e);
  }

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
          gl_FragColor = vec4(uColor * along * edge * uK * fl * diamonds * 3.0, 1.0); }`,   // above the bloom threshold
    });
  }
  const plumeGeo = new THREE.ConeGeometry(1, 1, 32, 1, true); plumeGeo.rotateX(Math.PI); plumeGeo.translate(0, -0.5, 0);
  const plume = new THREE.Group(); plume.position.y = -BELL; tvc.add(plume);
  const plumeOuter = new THREE.Mesh(plumeGeo, plumeMat(0x6a8cff, 0.85));
  const plumeInner = new THREE.Mesh(plumeGeo, plumeMat(0xf0f4ff, 1.3));
  plume.add(plumeOuter, plumeInner);
  const engineLight = new THREE.PointLight(0xaac4ff, 0, 220, 1.6); engineLight.position.y = -6; plume.add(engineLight);
  // Engine fire (RVacs), cinematic: a long bright core per engine (white-hot at the nozzle → blue-violet → faint pink),
  // glowing fire particles streaming along it (fireFx), a flare at each nozzle; startup stutters and over-expands, the
  // shutdown collapses back into the nozzle with a sputter.
  const coreMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    uniforms: { uK: { value: 0 }, uT: { value: 0 }, uFl: { value: 0 } },
    vertexShader: `varying float vY; varying vec3 vN; varying vec3 vV;
      void main(){ vY = position.y; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uK, uT, uFl; varying float vY; varying vec3 vN; varying vec3 vV;
      void main(){ float a = clamp(1.0 + vY, 0.0, 1.0);                       // 1 at the nozzle, 0 at the tip
        float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.2);
        float rip = 0.85 + 0.15 * sin(vY * 30.0 - uT * 60.0);
        float fl = 1.0 + uFl * (0.6 * sin(uT * 83.0) + 0.4 * sin(uT * 41.0 + vY * 9.0));
        vec3 c = mix(vec3(1.0, 0.45, 0.75), vec3(0.45, 0.45, 1.0), smoothstep(0.0, 0.55, a));   // pink tail → blue-violet
        c = mix(c, vec3(1.0, 0.97, 0.95), smoothstep(0.6, 0.95, a));                            // white-hot at the nozzle
        float I = pow(a, 6.0) * 2.2 + pow(a, 1.4) * 0.55;
        gl_FragColor = vec4(c * I * edge * uK * fl * rip, 1.0); }`,
  });
  const coreGeo = new THREE.CylinderGeometry(0.95, 3.2, 1, 28, 1, true); coreGeo.translate(0, -0.5, 0);
  const innerGeo = new THREE.CylinderGeometry(0.6, 1.2, 1, 20, 1, true); innerGeo.translate(0, -0.5, 0);
  const nozzleTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(220,210,255,0.8)');
    gr.addColorStop(0.5, 'rgba(150,120,255,0.18)'); gr.addColorStop(1, 'rgba(120,80,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const vacCores = rvacs.map(e => {
    const g = new THREE.Group(); g.position.y = -3.4; g.visible = false; e.add(g);
    const outer = new THREE.Mesh(coreGeo, coreMat.clone()), inner = new THREE.Mesh(innerGeo, coreMat.clone());
    const flare = new THREE.Sprite(new THREE.SpriteMaterial({ map: nozzleTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    flare.position.y = -0.6; g.add(outer, inner, flare);
    return { g, outer, inner, flare };
  });
  const engLight = new THREE.PointLight(0xc8b8ff, 0, 45, 1.4); engLight.position.y = -4; airframe.add(engLight);
  // k[i]: each engine's level 0..1, fl[i]: startup roughness 0..1
  function setVac(k, fl, t) {
    vacCores.forEach((c, i) => {
      const v = k[i], f = fl[i] ?? 0; c.g.visible = v > 0.01;
      const flick = 1 + f * 0.4 * Math.sin(t * 97 + i * 2) + 0.04 * Math.sin(t * 61 + i);
      const len = 30 * v * flick * (1 + 0.5 * f), wide = (0.75 + 0.25 * v) * (1 + 0.7 * f);   // startup: over-expanded
      c.outer.scale.set(wide, len, wide); c.inner.scale.set(wide, len * 0.45, wide);
      for (const m of [c.outer, c.inner]) { const u = m.material.uniforms; u.uK.value = v * (m === c.inner ? 1.3 : 0.8) * (1 + 0.6 * f); u.uT.value = t + i; u.uFl.value = f; }
      c.flare.scale.setScalar(4 + 5 * v * flick); c.flare.material.opacity = Math.min(1, v * 0.8 * flick);
    });
    engLight.intensity = (k[0] + k[1] + k[2]) / 3 * 180 * (1 + 0.15 * Math.sin(t * 53));
  }
  function setPlume(thr, t) {
    plume.visible = thr > 0.01;
    const len = 18 + 42 * thr, r = 3.2 + 5 * thr;
    plumeOuter.scale.set(r, len, r); plumeInner.scale.set(r * 0.42, len * 0.55, r * 0.42);
    plumeOuter.material.uniforms.uT.value = plumeInner.material.uniforms.uT.value = t;
    engineLight.intensity = thr > 0.01 ? 7000 * (0.4 + thr) : 0;
  }

  // ---------- Particles: one tinted system per blend mode ----------
  function createPoints(N, additive, target) {
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), size = new Float32Array(N), alpha = new Float32Array(N);
    const p = Array.from({ length: N }, () => ({ life: 0 }));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1)); geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uScale: { value: 500 } },
      vertexShader: `uniform float uScale; attribute vec3 aColor; attribute float aSize; attribute float aAlpha; varying vec3 vC; varying float vA;
        void main(){ vC = pow(aColor, vec3(2.2)); vA = aAlpha; vec4 mv = modelViewMatrix*vec4(position,1.0);
          gl_PointSize = min(aSize*uScale/max(-mv.z,0.01), 700.0); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: additive
        ? `varying vec3 vC; varying float vA; void main(){ float r = length(gl_PointCoord-0.5)*2.0; if (r>1.0) discard; gl_FragColor = vec4(vC*vA*pow(1.0-r,1.6)*2.6, 1.0); }`
        : `varying vec3 vC; varying float vA; void main(){ float r = length(gl_PointCoord-0.5)*2.0; if (r>1.0) discard; gl_FragColor = vec4(vC, vA*pow(1.0-r,1.4)); }` });
    const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; target.add(pts);
    let next = 0;
    return {
      // o = { x, y, z, vx, vy, vz, life, s0, s1, a, drag, g, rgb: [r, g, b], fire: bool (cools from yellow to red) }
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
  const dust = createPoints(2800, false, scene), fire = createPoints(1000, true, scene);
  const DUST = [0.72, 0.5, 0.36], STREAK = [0.95, 0.85, 0.75];
  const debris = [];
  { for (let i = 0; i < 46; i++) {
      const s = rnd(0.6, 3), m = new THREE.Mesh(new THREE.BoxGeometry(s, s * rnd(0.2, 0.6), s * rnd(0.5, 1.2)), i % 3 ? M.dark : M.steel);
      m.visible = false; m.castShadow = true; scene.add(m); debris.push({ m, v: new THREE.Vector3(), w: new THREE.Vector3() });
    } }
  const flash = new THREE.PointLight(0xffa040, 0, 900, 1.4); scene.add(flash);

  // ---------- Orbit and entry: the planet pass (landing-orbit.js) + the ship pass at metre scale ----------
  await step?.(0.92, 'Parking in Mars orbit');
  // In orbit the sun is low ahead (5° above the ground under the ship, near the direction of travel): the ground is lit at
  // grazing angles (long crater shadows), the sun sits ~24° above the limb in forward shots with the arc brightest under
  // it, and the ship is mostly backlit. During the entry it eases to the ground scene's sun, so the cut matches.
  const sph = (az, el) => new THREE.Vector3(Math.cos(el * DEG) * Math.cos(az * DEG), Math.sin(el * DEG), Math.cos(el * DEG) * Math.sin(az * DEG));
  const SUN_AZ = [-40, -128], SUN_EL = [5, 21];
  const ORB_SUN = sph(SUN_AZ[0], SUN_EL[0]);
  let sunK = -1, envSunK = -1;
  const SUNRISE = /[?&]sunrise/.test(location.search), SUNRISE_DIR = sph(-40, -17.5);
  function orbitSun(k) {
    k = clamp(k, 0, 1); if (Math.abs(k - sunK) < 1e-4) return; sunK = k;
    ORB_SUN.copy(sph(lerp(SUN_AZ[0], SUN_AZ[1], k), lerp(SUN_EL[0], SUN_EL[1], k)));
    if (typeof shipSun !== 'undefined') shipSun.position.copy(ORB_SUN).multiplyScalar(100);
    if (typeof rebuildOrbitEnv !== 'undefined' && Math.abs(k - envSunK) > 0.25) { envSunK = k; rebuildOrbitEnv(); }
  }
  const orbit = createOrbitScene(ORB_SUN);
  const shipScene = new THREE.Scene();
  let rebuildOrbitEnv;
  // Ship lighting in orbit: hard sun key, warm bounce up from the planet, a cool rim from the limb, near-black ambient
  // The real sun is the key; a faint fill from the camera side (~12%) so the shadow side isn't dead black
  const shipKey = new THREE.DirectionalLight(0xffe8d0, 0.6); shipKey.position.copy(sph(150, 25)).multiplyScalar(100);
  const shipSun = new THREE.DirectionalLight(0xfff4e8, 3.2); shipSun.position.copy(ORB_SUN).multiplyScalar(100); shipScene.add(shipSun);
  const shipBounce = new THREE.DirectionalLight(0xff7a3a, 0.75); shipBounce.position.set(0.3, -1, 0.1).multiplyScalar(100);   // the lit ground below
  const shipRim = new THREE.DirectionalLight(0x9bb4ff, 0.8); shipRim.position.set(-0.6, 0.15, 0.8).multiplyScalar(100);
  shipScene.add(shipKey, shipBounce, shipRim, new THREE.AmbientLight(0x1a1c24, 0.25));
  // Its reflections: black space, the bright orange planet below with the limb band, the sun
  {
    const env = new THREE.Scene();
    env.add(new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), new THREE.ShaderMaterial({ side: THREE.BackSide,
      uniforms: { uSun: { value: ORB_SUN } },
      vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uSun; varying vec3 vD; void main(){ vec3 d = normalize(vD); float lim = -0.33;
        vec3 ground = vec3(0.55, 0.2, 0.07) * (0.6 + 0.6 * smoothstep(-0.5, 0.8, dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(uSun.x, 0.0, uSun.z))))) * max(uSun.y * 2.4, 0.15);
        vec3 c = d.y < lim ? ground : vec3(0.0);
        c += vec3(1.0, 0.55, 0.25) * exp(-abs(d.y - lim) * 40.0) * 0.8;
        c += vec3(1.0, 0.96, 0.9) * pow(max(dot(d, normalize(uSun)), 0.0), 400.0) * 3.0;
        gl_FragColor = vec4(c, 1.0); }` })));
    let rt = null;
    rebuildOrbitEnv = () => { const n = pmrem.fromScene(env, 0); shipScene.environment = n.texture; rt?.dispose(); rt = n; };
    rebuildOrbitEnv();
  }
  const glow = createPoints(1200, true, shipScene);       // plasma streaks
  const puffs = createPoints(900, false, shipScene);     // RCS gas
  const haze = createPoints(1800, true, shipScene);      // vacuum exhaust haze
  // Post-processing (bloom, tone mapping, grade) and the look
  const post = createPost(renderer, scene, orbit.scene, orbit.camera, shipScene, camera);
  const orbitFlare = createFlare(); orbit.scene.add(orbitFlare.lf);
  const look = newLook('space'), lookTarget = newLook('space');
  let qName = 'high';
  try { const q = localStorage.getItem('tvc-landing-quality'); if (QUALITY[q]) qName = q; } catch {}
  let envTimer = 0, lookOverride = null;
  function lookFor() {
    if (lookOverride) return [lookOverride];
    if (state === 'orbit' || state === 'deorbit') return PHASE_LOOKS[state]();
    if (state === 'entry') return PHASE_LOOKS.entry(ent.u);
    if (state === 'flight') { const s = flight.s; return s.phase === 'belly' ? PHASE_LOOKS.belly(s.h) : PHASE_LOOKS[s.phase](); }
    if (state === 'falling' || state === 'crashed' || endState === 'crashed') return PHASE_LOOKS.crashed();
    return PHASE_LOOKS.landed();
  }
  function applyLook(dt) {
    const [a, b, k] = lookFor();
    blendLooks(lookTarget, a, b ?? a, clamp(k ?? 0, 0, 1));
    easeLook(look, lookTarget, 1 - Math.exp(-dt / 0.7));
    skyU.uZen.value.copy(look.zen); skyU.uMid.value.copy(look.mid); skyU.uHor.value.copy(look.hor);
    skyU.uSunCol.value.copy(look.sun); skyU.uDust.value = look.dust;
    scene.fog.color.copy(look.hor); scene.fog.density = look.fog;
    sun.color.copy(look.sun); sun.intensity = look.sunI;
    hemi.color.copy(look.hemiSky); hemi.groundColor.copy(look.hemiGnd); hemi.intensity = look.hemiI;
    groundU.uGShadow.value.copy(look.gShadow); groundU.uGMid.value.copy(look.gMid); groundU.uGLit.value.copy(look.gLit);
    groundU.uGHigh.value.copy(look.gHigh); groundU.uGRock.value.copy(look.gRock);
    cloudMeshes.forEach(([m, o], i) => { m.material.opacity = o * (i === 0 ? look.clouds : look.clouds * 1.6); });
    const q = QUALITY[qName];
    post.apply(look, q, simClock);
    post.grade.uniforms.uFade.value = fadeAmt; post.grade.uniforms.uFlash.value = flashAmt;
    if (state === 'orbit' && dipAmt > 0.001) { post.grade.uniforms.uFade.value = dipAmt; post.grade.uniforms.uFadeCol.value.setRGB(0, 0, 0); }
    else post.grade.uniforms.uFadeCol.value.copy(look.hor).lerp(new THREE.Color(1, 0.96, 0.92), 0.6);
    flashAmt *= Math.exp(-dt * 5);
    flare.setStrength(look.flare); orbitFlare.setStrength(look.flare * 0.2 * orbit.sunVisible);
    // Reflections: rebuild the environment now and then while the look is changing
    envTimer -= dt;
    const cd = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
    if (envTimer <= 0 && !inOrbit() && cd(envU.uZen.value, look.zen) + cd(envU.uHor.value, look.hor) > 0.004) {
      envU.uZen.value.copy(look.zen); envU.uHor.value.copy(look.hor); envU.uGnd.value.copy(look.gMid); updateEnv(); envTimer = 0.5;
    }
  }
  function setQuality(name) {
    qName = name; const q = QUALITY[name];
    try { localStorage.setItem('tvc-landing-quality', name); } catch {}
    setRockDensity(q.rocks);
    orbit.setQuality(name === 'high' ? 8 : name === 'medium' ? 6 : 5, Math.min(devicePixelRatio, q.pr));
    if (sun.shadow.mapSize.x !== q.shadow) { sun.shadow.mapSize.set(q.shadow, q.shadow); sun.shadow.map?.dispose(); sun.shadow.map = null; }
    $('lndQual').querySelector('.lbl').textContent = 'Quality: ' + q.label;
    resize();
  }
  // Entry heating colour, shared by every plasma layer: h = heating 0..1, k = 1 at the hottest spot. Faint pink-violet
  // (glowing ionised gas) at low heating → orange → white-yellow at the stagnation zone at peak. Display-space colours.
  const HEATC = `vec3 heatCol(float h, float k){
    vec3 c = mix(vec3(0.75, 0.35, 1.0), vec3(1.0, 0.32, 0.55), smoothstep(0.0, 0.25, h));
    c = mix(c, vec3(1.0, 0.45, 0.12), smoothstep(0.2, 0.55, h));
    return mix(c, vec3(1.0, 0.86, 0.58), smoothstep(0.6, 0.95, h) * k); }`;
  // Plasma: a glowing sheath over the heat shield and a wake trailing off the ship
  const plasmaMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uI: { value: 0 }, uT: { value: 0 }, uH: { value: 0 } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){ vP = position; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uI; uniform float uT; uniform float uH; varying vec3 vN; varying vec3 vV; varying vec3 vP; ${HEATC}
      void main(){ float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float n = 0.6 + 0.4 * sin(vP.y * 0.7 + uT * 25.0 + 2.5 * sin(vP.z * 1.7 - uT * 13.0)) * (0.7 + 0.3 * sin(vP.z * 0.9 + vP.y * 0.3 + uT * 7.0));
        vec3 c = mix(heatCol(uH, 0.4 + 0.6 * smoothstep(28.0, 46.0, vP.y)), vec3(0.8, 0.4, 1.0), f * 0.5 * (1.0 - uH));
        gl_FragColor = vec4(pow(c, vec3(2.2)) * uI * (0.35 + 1.6 * pow(f, 1.4)) * n * 2.5, 1.0); }`,
  });
  const plasma = new THREE.Mesh(shield.geometry, plasmaMat); plasma.scale.set(1.14, 1.01, 1.14); plasma.visible = false; airframe.add(plasma);
  // Bow shock: a glowing envelope just off the belly and nose, drawn as a thin bright rim (fresnel), strongest on the
  // leading side, white-hot at the edge going pink then violet (after the reference renders)
  const shockMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uI: { value: 0 }, uT: { value: 0 }, uH: { value: 0 }, uLead: { value: new THREE.Vector3(0.9, 0.42, 0).normalize() } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vL;
      void main(){ vL = normal; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uI; uniform float uT; uniform float uH; uniform vec3 uLead; varying vec3 vN; varying vec3 vV; varying vec3 vL; ${HEATC}
      void main(){ float d = abs(dot(normalize(vN), normalize(vV)));
        float rim = pow(1.0 - d, 5.0), halo = pow(1.0 - d, 1.8) * 0.18;
        float lead = smoothstep(-0.35, 0.55, dot(normalize(vL), uLead));
        float fl = 0.85 + 0.15 * sin(uT * 37.0 + vL.y * 9.0);
        vec3 c = mix(vec3(0.62, 0.42, 1.0), heatCol(uH, 0.3), lead);
        c = mix(c, heatCol(uH, 1.0), smoothstep(0.55, 1.0, rim) * lead);
        gl_FragColor = vec4(pow(c, vec3(2.2)) * uI * (rim * 2.4 + halo) * lead * fl * 3.0, 1.0); }`,
  });
  const shock = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), shockMat);
  shock.scale.set(8.2, 31, 8.6); shock.position.set(2.4, 2.5, 0); shock.visible = false; ship.add(shock);
  const wakeGeo = new THREE.CylinderGeometry(0.0, 1.0, 1.0, 32, 1, true); wakeGeo.translate(0, 0.5, 0);
  const wakeMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uI: { value: 0 }, uT: { value: 0 }, uH: { value: 0 } },
    vertexShader: `varying float vY; varying vec3 vN; varying vec3 vV; varying vec2 vUv;
      void main(){ vY = position.y; vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uI; uniform float uT; uniform float uH; varying float vY; varying vec3 vN; varying vec3 vV; varying vec2 vUv; ${HEATC}
      void main(){ float along = pow(1.0 - vY, 1.5); float edge = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 4.0);
        float streak = (0.55 + 0.45 * sin(vUv.x * 120.0 + vY * 9.0 - uT * 6.0)) * (0.6 + 0.4 * sin(vUv.x * 19.0 + vY * 23.0 - uT * 4.0));
        vec3 c = mix(heatCol(uH, 0.6), vec3(0.55, 0.4, 1.0), smoothstep(0.0, 0.7, vY));
        gl_FragColor = vec4(pow(c, vec3(2.2)) * uI * along * (0.06 + 1.8 * edge) * streak * 2.2, 1.0); }`,
  });
  const wake = new THREE.Mesh(wakeGeo, wakeMat); wake.visible = false; shipScene.add(wake);
  // Plasma ribbons: ragged sheets peeling off the nose, belly edges and flap tips (ship-local anchors, belly = +x),
  // streaming back along the flow and cooling white-hot → orange → violet along their length. Camera-facing strips
  // bent by turbulence in the vertex shader; flicker, split (break-up noise) and length follow the heating.
  const RIB = [[0.5, 28.5, 0], [0.6, 21, R + 4.2], [0.6, 21, -R - 4.2], [0.6, -12, R + 6.2], [0.6, -12, -R - 6.2],
    [1.2, 8, R * 0.95], [1.2, 8, -R * 0.95], [1.5, -2, R * 0.9], [1.5, -2, -R * 0.9], [1.0, 14, R * 0.97]];
  const ribGeo = new THREE.PlaneGeometry(1, 1, 1, 40);
  const ribBase = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `uniform vec3 uA, uFlow; uniform float uLen, uW, uT, uSeed; varying float vS; varying float vX;
      void main(){ float s = position.y + 0.5; vS = s; vX = position.x * 2.0;
        vec3 f = normalize(uFlow), side = normalize(cross(f, vec3(0.0, 0.0, 1.0))), up = vec3(0.0, 0.0, 1.0);
        vec3 c = uA + f * s * uLen;
        c += side * (sin(s * 7.0 - uT * 9.0 + uSeed) * 3.0 + sin(s * 17.0 - uT * 23.0 + uSeed * 2.0)) * s;
        c += up * sin(s * 5.0 - uT * 7.0 + uSeed * 3.0) * 4.0 * s;
        vec3 w = normalize(cross(f, cameraPosition - c));
        c += w * position.x * uW * (0.4 + 2.6 * s);
        gl_Position = projectionMatrix * viewMatrix * vec4(c, 1.0); }`,
    fragmentShader: `uniform float uI, uH, uT, uSeed; varying float vS; varying float vX; ${HEATC}
      void main(){ float edge = pow(max(1.0 - abs(vX), 0.0), 1.5);
        float brk = smoothstep(0.15, 0.6, 0.5 + 0.5 * sin(vS * 23.0 - uT * 31.0 + uSeed * 5.0) * sin(vS * 9.0 - uT * 13.0 + vX * 2.0 + uSeed));
        float fade = (1.0 - vS) * smoothstep(0.0, 0.04, vS);
        vec3 c = heatCol(uH * (1.0 - vS * 0.85), 1.0 - vS);
        gl_FragColor = vec4(pow(c, vec3(2.2)) * uI * edge * mix(0.3, 1.0, brk) * fade * fade * 2.2, 1.0); }`,
  });
  const ribbons = RIB.map((a, i) => {
    const m = new THREE.Mesh(ribGeo, ribBase.clone());
    m.material.uniforms = { uA: { value: new THREE.Vector3() }, uFlow: { value: new THREE.Vector3(-1, 0, 0) }, uLen: { value: 80 }, uW: { value: 1.6 },
      uT: { value: 0 }, uSeed: { value: i * 1.7 + 0.3 }, uI: { value: 0 }, uH: { value: 0 } };
    m.frustumCulled = false; m.visible = false; shipScene.add(m);
    return { m, a: new THREE.Vector3(...a), k: 0.7 + 0.3 * ((i * 0.618) % 1) };
  });
  const RIB_N = { high: 10, medium: 6, low: 3 };
  // The plasma lights the ship from below: steel sides and flaps catch its orange light at peak
  const plasmaLight = new THREE.PointLight(0xff8040, 0, 0, 2); plasmaLight.position.set(R + 6, 4, 0); ship.add(plasmaLight);
  let tileT = 0, entShot = -1;
  // Entry heating panel (re-uses the deorbit burn panel's slot)
  const burnEl = $('lndBurn'), burnHTML = burnEl.innerHTML;
  function heatPanel(on) {
    burnEl.innerHTML = on ? '<div class="ms-label">Entry heating · belly</div><div class="lnd-burn-row"><span>Heat flux <b id="lndQ">0</b> MW/m²</span><span>Tiles <b id="lndTile">20</b> °C</span></div><div class="lnd-heat"><i id="lndHeatBar"></i></div>' : burnHTML;
  }
  // Entry profile: altitude and speed by progress u, heating q ∝ √ρ·v³ (exponential air, 11.1 km scale height), peak = 1
  const entryHV = u => [12e3 + 188e3 * Math.pow(1 - u, 1.35), 420 + 3030 * (1 - sstep(0.32, 1, u))];
  const qRaw = (h, v) => Math.sqrt(Math.exp(-h / 11.1e3)) * v ** 3;
  let Q_MAX = 0; for (let i = 0; i <= 400; i++) Q_MAX = Math.max(Q_MAX, qRaw(...entryHV(i / 400)));

  // ---------- State ----------
  // orbit (idle) → deorbit → entry → flight (belly, flip, tvc: landing-sim.js) → landed | crashed, via falling / tipping,
  // then a short replay before the result card
  let source = 'sim';
  let state = 'orbit', paused = false;
  let outcome = null, legK = 0, trim = { x: 0, y: 0 }, trimN = 0, td = null, lost = false;
  let calls = {};                    // callouts already shown this run
  const START = L.flightStart();
  let flight = L.createFlight(START.x0);
  const att = L.createAttitudeSim();
  let dev = { tiltX: 0, tiltY: 0, gx: 0, gy: 0 };      // the TVC source's attitude (deg), once it flies
  let rig = null, rigSeen = -1e9;
  let gustPlan = [], promptPlan = [], maxTilt = 0, maxGimbal = 0;
  let et = 0, phi = 0, ent = { h: L.ENTRY.h0, v: L.ENTRY.v0, I: 0, fade: 0, u: 0 };   // orbit/entry timeline
  let simClock = 0, frames = [], replay = null, endState = null, stormT = 0, fadeOut = 0;
  const trail = [];
  const tracker = L.createTracker(d => {
    feed(`Pushed to <b>${d.peak.toFixed(1)}°</b> · back in <b>${d.recover.toFixed(2)} s</b>`, d.peak > 15 ? 'warn' : 'ok');
  });
  const fall = { v: new THREE.Vector3(), axis: new THREE.Vector3(), ang: 0, rate: 0 };

  document.addEventListener('tvc:sample', e => { rig = e.detail; rigSeen = performance.now(); });
  const rigLive = () => performance.now() - rigSeen < 1500;   // the feed is 20-100 Hz: 1.5 s of silence = no link
  const inOrbit = () => state === 'orbit' || state === 'deorbit' || state === 'entry';
  const running = () => state === 'deorbit' || state === 'entry' || state === 'flight' || state === 'falling' || state === 'tipping';
  const ended = () => state === 'landed' || state === 'crashed' || state === 'replay';

  // ---------- UI ----------
  const goBtn = $('lndGo'), pauseBtn = $('lndPause'), tvcBtn = $('lndTvc'), gustBtn = $('lndGust'), camBtn = $('lndCam'), loopBox = $('lndLoop');
  const srcBtns = [...document.querySelectorAll('#lndSrc button')];
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
  goBtn.onclick = () => (state === 'orbit' ? begin() : ended() ? (reset(), begin()) : null);
  pauseBtn.onclick = () => setPaused(!paused);
  $('lndAgain').onclick = () => { reset(); begin(); };
  const CAMS = ['auto', 'chase', 'pad', 'free'];
  let camMode = 'auto';
  camBtn.onclick = () => { camMode = CAMS[(CAMS.indexOf(camMode) + 1) % CAMS.length]; controls.enabled = camMode === 'free'; if (camMode === 'free') controls.target.copy(ship.position); refresh(); };
  addEventListener('keydown', e => {
    if (document.body.dataset.tab !== 'landing' || e.target.closest('input, select, textarea')) return;
    if (e.key === 'g' || e.key === 'G') doGust();
    if (e.key === ' ') {
      e.preventDefault();
      if (running()) setPaused(!paused);
      else if (state === 'orbit' || ended()) goBtn.click();
    }
  });
  function setPaused(p) {
    if (!running() && p) return;
    paused = p;
    $('landing').classList.toggle('paused', paused);
    refresh();
  }

  function refresh() {
    goBtn.querySelector('.lbl').textContent = state === 'orbit' ? 'Begin descent' : running() ? 'In flight' : 'Fly again';
    goBtn.disabled = running() || state === 'replay' || (source === 'rig' && !rigLive() && state === 'orbit');
    pauseBtn.disabled = !running();
    pauseBtn.querySelector('.lbl').textContent = paused ? 'Play' : 'Pause';
    pauseBtn.classList.toggle('on', paused);
    srcBtns.forEach(b => { b.disabled = running() || state === 'replay'; });
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
  const once = (key, html, ms, cls) => { if (!calls[key]) { calls[key] = true; callout(html, ms, cls); } };
  function feed(html, cls = '') {
    const li = document.createElement('li'); li.className = cls; li.innerHTML = html;
    const list = $('lndFeed'); list.prepend(li);
    while (list.childElementCount > 5) list.lastElementChild.remove();
  }
  let flashAmt = 0, fadeAmt = 0;
  function flashScreen(strength = 1) { flashAmt = Math.max(flashAmt, 0.85 * strength); }
  function doGust() {
    if (state !== 'flight' || flight.s.phase !== 'tvc' || paused) return;
    if (source === 'sim') { att.gust(rnd(0, 360), GUST_SCALE); callout('GUST'); }
    else callout('GUST INCOMING · <b>PUSH THE ROCKET</b>', 2600, 'warn');
  }

  let loopTimer = 0;
  function reset() {
    state = 'orbit'; paused = false; $('landing').classList.remove('paused');
    outcome = null; legK = 0; td = null; lost = false; calls = {}; endState = null; replay = null; stormT = 0; fadeOut = 0;
    flight = L.createFlight(START.x0); att.reset(); tracker.reset();
    trim = { x: 0, y: 0 }; trimN = 0; maxTilt = 0; maxGimbal = 0; trail.length = 0; frames = []; simClock = 0;
    dev = { tiltX: 0, tiltY: 0, gx: 0, gy: 0 };
    et = 0; ent = { h: L.ENTRY.h0, v: L.ENTRY.v0, I: 0, fade: 0, u: 0 };
    fall.ang = fall.rate = 0;
    ship.visible = true; debris.forEach(d => { d.m.visible = false; }); fire.clear(); dust.clear(); glow.clear(); puffs.clear(); haze.clear();
    orbitSun(0); setVac([0, 0, 0], [], 0); rvacMat.emissiveIntensity = 0; heatPanel(false); $('lndBurn').hidden = true; deoShot = '';
    ribbons.forEach(r => { r.m.visible = false; }); plasmaLight.intensity = 0; tileT = 0; entShot = -1; if (camera.fov !== 40) { camera.fov = 40; resize(); }
    shipScene.add(ship); ship.position.set(0, 0, 0);
    $('lndResult').hidden = true; $('lndFeed').textContent = ''; $('lndReplay').hidden = true; fadeAmt = 0;
    clearTimeout(loopTimer); $('lndLoopNote').textContent = '';
    setLegs(0);
    refresh();
  }
  function begin() {
    if (source === 'rig' && !rigLive()) { callout('NO RIG DATA · CONNECT THE ARDUINO', 2600, 'warn'); return; }
    state = 'deorbit'; et = 0; dipAmt = 0; idleHold = false;
    callout('DEORBIT BURN', 2200);
    refresh();
  }
  function cutToGround() {   // inside the cloud deck: swap the orbit scene for the ground scene
    state = 'flight';
    scene.add(ship);
    plasma.visible = false; wake.visible = false; shock.visible = false; M.tiles.emissiveIntensity = 0; glow.clear();
    ribbons.forEach(r => { r.m.visible = false; }); plasmaLight.intensity = 0; tileT = 0; burnEl.hidden = true; heatPanel(false);
    fadeOut = 0.8; tBreak = null; trk = null;
    buildWisps({ high: 1, medium: 0.6, low: 0.3 }[qName] ?? 1, flight.s.x ?? 0, flight.s.z ?? 0);
    once('belly', 'BELLY FLOP · <b>INSIDE THE CLOUD DECK</b>', 2200);
    refresh();
  }
  function handover() {
    if (trimN) { trim.x /= trimN; trim.y /= trimN; }
    att.reset();
    gustPlan = source === 'sim' ? [2, 6, 10].map(t => ({ t: t + rnd(-0.6, 0.6), dir: rnd(0, 360) })) : [];
    promptPlan = source === 'rig' ? [2.5, 8].map(t => ({ t })) : [];
    callout(source === 'rig' ? 'TVC CONTROL · <b>RIG ACTIVE</b>' : 'TVC CONTROL · SIMULATED', 2400);
  }

  // ---------- Simulation step (100 Hz) ----------
  function readDev() {
    if (source === 'sim') return att.read();
    if (!rig) return { tiltX: 0, tiltY: 0, gx: 0, gy: 0 };
    return { tiltX: rig.tiltX - trim.x, tiltY: rig.tiltY - trim.y, gx: rig.gx ?? 0, gy: rig.gy ?? 0 };
  }
  function simStep() {
    if (state !== 'flight') return;
    const s = flight.s, wasPhase = s.phase;
    let d = null;
    if (s.phase === 'tvc') {
      if (source === 'rig' && !rigLive()) { lost = true; return; }   // pause until the rig link is back
      lost = false;
      const t = s.t - s.tPh;
      for (const g of gustPlan) if (!g.done && t >= g.t) { g.done = true; att.gust(g.dir, GUST_SCALE); callout('GUST'); }
      for (const p of promptPlan) if (!p.done && t >= p.t) { p.done = true; callout('GUST INCOMING · <b>PUSH THE ROCKET</b>', 2600, 'warn'); }
      if (source === 'sim') att.step(1 + 1.5 * sstep(80, 0, s.h));      // dust blown back up near the ground
      d = readDev(); dev = d;
      const dt = L.tiltOf(d.tiltX, d.tiltY);
      maxTilt = Math.max(maxTilt, dt); maxGimbal = Math.max(maxGimbal, Math.abs(d.gx), Math.abs(d.gy));
      tracker.step(s.t, dt);
      if (dt > L.ABORT_DEG) { startFall(); return; }
    } else if (source === 'rig') {
      // Rig: ask for a still rocket during the belly flop, average its resting lean through the flip as the trim
      if (s.phase === 'belly' && s.h < 5200) once('hold', 'TVC HANDOVER AFTER THE FLIP · <b>HOLD THE ROCKET STILL</b>', 3000, 'warn');
      if (s.phase === 'flip' && rig && rigLive()) { trim.x += rig.tiltX; trim.y += rig.tiltY; trimN++; }
    }
    flight.step(d);
    if (wasPhase === 'belly' && s.phase === 'flip') { callout('FLIP', 1800); flashScreen(0.6); flash.intensity = 2e5; shake = 1.2; }
    if (wasPhase === 'flip' && s.phase === 'tvc') handover();
    if (s.h < L.LEGS_AT) { legK = clamp(legK + L.DT / 2.2, 0, 1); once('legs', 'LEGS DEPLOYED', 1400); }
    if (s.h <= groundUnder()) touchdown(s.tilt);
  }
  const groundUnder = () => heightAt(flight.s.x, flight.s.z);

  function touchdown(tilt) {
    const s = flight.s, miss = flight.drift;
    td = { tilt, vs: -s.vh, miss };
    s.h = groundUnder();
    if (tilt > L.TIP_DEG) { startTip(); return; }
    const onPad = miss <= L.PAD_R;
    outcome = { ok: true,
      title: tilt <= L.LAND_OK_DEG ? (onPad ? 'TOUCHDOWN' : 'TOUCHDOWN · OFF THE PAD') : 'HARD LANDING',
      sub: tilt <= L.LAND_OK_DEG
        ? (onPad ? `Upright on the pad, ${miss.toFixed(1)} m from centre` : `Upright, but ${miss.toFixed(1)} m from the pad centre`)
        : `It stayed up, landing at ${tilt.toFixed(1)}°` };
    dustStorm(s.x, s.h, s.z);
    stormT = 2.5;
    finish('landed');
  }
  function dustStorm(x, y, z) {
    for (let i = 0; i < 420; i++) {
      const a = rnd(0, Math.PI * 2), v = rnd(12, 46);
      dust.emit({ x: x + Math.cos(a) * 4, y: y + rnd(0.5, 3), z: z + Math.sin(a) * 4, vx: Math.cos(a) * v, vy: rnd(0.5, 9), vz: Math.sin(a) * v,
        life: rnd(2.5, 6), s0: 4, s1: rnd(16, 34), a: 0.6, drag: 0.7, rgb: DUST });
    }
  }
  function startFall() {
    state = 'falling';
    const s = flight.s, ax = L.axisFromTilt(s.cmd.x + dev.tiltX, s.cmd.y + dev.tiltY);
    fall.axis.set(ax.z, 0, -ax.x).normalize();
    if (!isFinite(fall.axis.x)) fall.axis.set(1, 0, 0);
    fall.rate = 0.6; fall.v.set(s.vx, s.vh, s.vz); fall.h = Math.max(0, s.h - groundUnder());
    callout('LOSS OF CONTROL', 2400, 'warn');
    refresh();
  }
  function startTip() {
    state = 'tipping';
    const s = flight.s, ax = L.axisFromTilt(s.cmd.x + dev.tiltX, s.cmd.y + dev.tiltY);
    fall.axis.set(ax.z, 0, -ax.x).normalize(); fall.rate = 0.18;
    callout('TIPPING OVER', 2000, 'warn');
    refresh();
  }
  function explode(at, why, quiet) {
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
    shake = 2.2; flashScreen(0.5);
    if (quiet) return;
    outcome = { ok: false, title: why === 'tip' ? 'TIPPED OVER' : 'LOSS OF CONTROL',
      sub: why === 'tip' ? `Touched down leaning ${td.tilt.toFixed(1)}° and fell over (limit ${L.TIP_DEG}°)`
        : `The TVC lost it past the ${L.ABORT_DEG}° abort at ${(fall.h ?? 0).toFixed(0)} m${source === 'sim' && !att.tvc ? ', with the TVC switched off' : ''}` };
    outcome.at = at.clone();
    finish('crashed');
  }
  // An ending: hold a moment, play the last 1.6 s back at half speed, then the result card
  function finish(how) {
    state = how; endState = how;
    refresh();
    setTimeout(() => {
      if (state !== how) return;
      const tEnd = simClock, rf = frames.filter(f => f.t >= tEnd - 1.6 - (how === 'crashed' ? 0.2 : 0));
      if (rf.length > 5) { replay = { frames: rf, t: rf[0].t, end: rf[rf.length - 1].t }; state = 'replay'; $('lndReplay').hidden = false; ship.visible = true; refresh(); }
      else showResult();
    }, how === 'landed' ? 1600 : 2200);
  }
  function endReplay() {
    $('lndReplay').hidden = true;
    state = endState; replay = null;
    if (endState === 'crashed') explode(outcome.at, null, true);
    showResult();
    refresh();
    if (loopBox.checked) {
      let n = 10;
      const tick = () => {
        if (!loopBox.checked || (state !== 'landed' && state !== 'crashed')) { $('lndLoopNote').textContent = ''; return; }
        $('lndLoopNote').textContent = `Next descent in ${n} s`;
        if (n-- <= 0) { $('lndLoopNote').textContent = ''; if (source === 'sim' || rigLive()) { reset(); begin(); } return; }
        loopTimer = setTimeout(tick, 1000);
      };
      tick();
    }
  }
  function showResult() {
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
    $('lndResSrc').textContent = source === 'rig' ? 'From the flip down, flown by the real rocket on the desk rig'
      : `From the flip down, simulated TVC ${att.tvc ? 'on' : 'off'} (same controller as the Nano)`;
  }

  // ---------- Orbit timeline (screen time) ----------
  const qA = new THREE.Quaternion(), qB = new THREE.Quaternion(), _z = new THREE.Vector3(0, 0, 1);
  const bellyQ = a => qA.setFromAxisAngle(_z, -a * DEG).clone();
  function orbitStep(dt) {
    const E = L.ENTRY;
    let pitch = 88, thr = 0, h = E.h0, v = E.v0;
    if (state === 'orbit') {
      pitch = 88; phi += v / 1000 / (R_MARS + h / 1000) * dt * 4;
    } else if (state === 'deorbit') {
      et += dt;
      pitch = deorbitPitch(et); curPitch = pitch;
      phi += v / 1000 / (R_MARS + h / 1000) * dt * 4;
      deorbitFx(dt);
      if (et >= E.deorbit) {
        state = 'entry'; et = 0; setVac([0, 0, 0], [], 0); deoEndPos.copy(camera.position); deoEndLook.copy(deoLook); heatPanel(true); burnEl.hidden = false; entShot = -1; ent.tr = 0; dev = { tiltX: 0, tiltY: 0, gx: 0, gy: 0 }; tvc.rotation.set(0, 0, 0);
        callout('ENTRY INTERFACE · <b>TIME WARP</b>', 2600);
      }
    } else if (state === 'entry') {
      // Time warp ramps instead of switching: a 1.5 s beat at ×1 (the ship settles nose-up), ×1 → ×30 over 3 s, then
      // down to ×10 into the cloud cut. Progress through the 20 s profile runs at warp/30; the badge counts live.
      ent.tr += dt;
      const wNow = 1 + (E.warp - 1) * sstep(1.5, 4.5, ent.tr) - (E.warp - 10) * sstep(0.88, 1, et / E.entry);
      et += dt * wNow / E.warp;
      $('lndWarp').textContent = '×' + Math.max(1, Math.round(wNow)) + ' time warp';
      if (window.__entU != null) et = window.__entU * E.entry;
      const u = clamp(et / E.entry, 0, 1);
      [h, v] = entryHV(u);
      const q = qRaw(h, v) / Q_MAX; ent.q = q;
      pitch = lerp(84, 68, sstep(0, 2.5, ent.tr) * (1 - sstep(0.86, 1, u))) + 3 * Math.sin(et * 1.7) + 1.5 * q * Math.sin(et * 5.3) * Math.sin(et * 2.1);   // buffets a little at peak
      phi += v / 1000 / (R_MARS + h / 1000) * dt * clamp(wNow, 4, 12);   // ground scroll: from the orbit's ×4, capped: drifts, never races
      ent.I = Math.pow(clamp(q * 1.1, 0, 1), 0.8);
      tileT += (q - tileT) * (1 - Math.exp(-dt * (q > tileT ? 0.9 : 0.35)));   // thermal lag: heats fast, cools slowly
      $('lndQ').textContent = (q * 1.15).toFixed(2); $('lndTile').textContent = Math.round(20 + 1580 * tileT).toLocaleString('en-US');
      $('lndHeatBar').style.width = (q * 100).toFixed(1) + '%';
      if (h < 80e3) once('lossSig', 'SIGNAL · <b>PLASMA BLACKOUT</b>', 2400);
      if (h < 40e3) once('aos', 'SIGNAL <b>ACQUIRED</b>', 2000);
      ent.fade = sstep(0.86, 1, u); ent.u = u;
      orbitSun(sstep(0.12, 1, u));
      rvacMat.emissiveIntensity *= Math.exp(-dt * 0.8);
      if (u > 0.59) once('peak', 'PEAK HEATING · <b>1,600 °C</b> ON THE TILES', 2400);
      if (u >= 1) { ent.h = h; ent.v = v; cutToGround(); return; }
    }
    ent.h = h; ent.v = v;
    if (state !== 'deorbit') curPitch = pitch;
    ship.quaternion.copy(bellyQ(pitch));
    ship.position.set(0, 0, 0);
    if (state !== 'deorbit') tvc.rotation.set(0, 0, 0);
    setFlaps(state === 'entry' ? 0.3 + 0.1 * Math.sin(et * 2.3) : 0.1, state === 'entry' ? 0.3 - 0.1 * Math.sin(et * 2.3) : 0.1);
    setPlume(0, simClock);
    puffs.update(dt); haze.update(dt);
    // Plasma sheath, wake and streaks
    const I = state === 'entry' ? ent.I : 0;
    plasma.visible = wake.visible = shock.visible = I > 0.01;
    const Hq = state === 'entry' ? ent.q ?? 0 : 0;
    plasmaMat.uniforms.uI.value = I * 0.8 * (1 - 0.5 * Hq); plasmaMat.uniforms.uT.value = simClock; plasmaMat.uniforms.uH.value = Hq;
    shockMat.uniforms.uI.value = I * 1.3 * (1 - 0.6 * Hq); shockMat.uniforms.uT.value = simClock; shockMat.uniforms.uH.value = Hq;
    shock.scale.set(8.2, 31, 8.6).multiplyScalar(1.12 - 0.12 * I);   // the shock hugs closer as the heating rises
    const tt = state === 'entry' ? tileT : 0;                         // tiles: dull red → orange → yellow, with lag
    M.tiles.emissive.setRGB(1, 0.18 + 0.5 * tt, 0.06 + 0.2 * tt * tt); M.tiles.emissiveIntensity = tt * 1.8;
    plasmaLight.intensity = I * 420; plasmaLight.color.setRGB(1, 0.4 + 0.35 * Hq, 0.2 + 0.2 * Hq);
    wakeMat.uniforms.uI.value = I * 0.6; wakeMat.uniforms.uT.value = simClock; wakeMat.uniforms.uH.value = Hq;
    const gam = (4 + 36 * ent.u) * DEG;                       // flight path angle below horizontal
    const flow = new THREE.Vector3(-Math.cos(gam), Math.sin(gam), 0);   // where the air goes, relative to the ship
    wake.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), flow);
    wake.scale.set(8 + 3 * I, 260 + 260 * I, 8 + 3 * I); wake.position.copy(flow).multiplyScalar(-4);
    const nR = RIB_N[qName] ?? 10;
    ribbons.forEach((r, i) => {
      const on = I > 0.03 && i < nR; r.m.visible = on; if (!on) return;
      const u = r.m.material.uniforms;
      ship.updateMatrixWorld(); ship.localToWorld(u.uA.value.copy(r.a)); u.uFlow.value.copy(flow);
      u.uLen.value = (40 + 110 * I) * r.k; u.uT.value = simClock; u.uH.value = Hq;
      u.uI.value = I * (0.7 + 0.3 * Math.sin(simClock * (11 + i * 3.7) + i)) * (0.75 + 0.25 * Math.sin(simClock * 29 + i * 2.3));
    });
    if (Hq > 0.4) for (let i = 0; i < 3; i++) {   // sparks shedding off the flap tips and tile edges at peak
      const a = ribbons[1 + (Math.random() * 4 | 0)].m.material.uniforms.uA.value;
      glow.emit({ x: a.x, y: a.y, z: a.z, vx: flow.x * rnd(150, 320) + rnd(-20, 20), vy: flow.y * rnd(150, 320) + rnd(-20, 20), vz: rnd(-30, 30),
        life: rnd(0.15, 0.45), s0: 0.7, s1: 0.25, a: 1, drag: 0, rgb: [1, 0.85, 0.55] });
    }
    if (I > 0.05) {
      const n = Math.round(14 * I);
      for (let i = 0; i < n; i++) {
        const along = rnd(-22, 28), side = Math.random() < 0.5 ? -1 : 1;
        const p = new THREE.Vector3(Math.cos(-pitch * DEG) * along, Math.sin(-pitch * DEG) * along - 4, side * rnd(3, 7));
        glow.emit({ x: p.x, y: p.y, z: p.z, vx: flow.x * 420, vy: flow.y * 420, vz: side * rnd(10, 40), life: rnd(0.12, 0.3), s0: 2.5, s1: 7, a: 0.7 * I, drag: 0, rgb: [1, lerp(0.42, 0.7, Hq) + rnd(-0.05, 0.05), lerp(0.85, 0.35, Hq)] });
      }
    }
    glow.update(dt);
  }

  // ---------- Deorbit burn (screen seconds; ENTRY.deorbit = 10.4) ----------
  //   a 0-1.2 prep · b 1.2-4.2 flip tail-first (RCS) · c 4.2-4.8 staggered ignition · d 4.8-7.4 burn ·
  //   e 7.4-7.9 shutdown · f 7.9-10.4 flip back belly-first (RCS), then entry
  const DEO = { flip1: [1.2, 4.2], ign: 4.2, burn: [4.8, 7.4], off: 7.4, flip2: [7.9, 10.4] };
  // An attitude slew: accelerate, coast, decelerate, then a small overshoot that settles
  const slew = (t, t0, t1) => { const u = clamp((t - t0) / (t1 - t0), 0, 1), e = u * u * (3 - 2 * u);
    const after = Math.max(0, t - t1); return e + (u >= 1 ? 0.012 * Math.sin(after * 7) * Math.exp(-after * 2.5) : 0); };
  function deorbitPitch(t) { return 88 + 180 * slew(t, ...DEO.flip1) - 184 * slew(t, ...DEO.flip2); }
  const IGN_GAP = 0.1;
  const stutter = (x, seed) => (Math.sin(x * 47 + seed * 3.1) > -0.2 ? 1 : 0.15);
  const vacLevel = t => [0, 1, 2].map(i => { const t0 = DEO.ign + i * IGN_GAP, to = DEO.off + i * 0.05;
    if (t < t0) return 0;
    if (t < to) { const st = t - t0; return (st < 0.3 ? stutter(st, i) * (0.5 + st / 0.6) : Math.min(1, 0.5 + st)) * 0.9; }
    const sd = t - to; return sd > 0.25 ? 0 : (1 - sd / 0.25) * stutter(sd * 1.7, i + 5) * 0.9; });
  // Fire particles: fast, glowing, short-lived, streaming along each plume in a ~17° cone; at shutdown a last faint puff
  const _hx = new THREE.Vector3(), _hd = new THREE.Vector3();
  function hazeFx(dt, k, puff) {
    rvacs.forEach((e, i) => {
      if (k[i] < 0.02 && !puff) return;
      e.updateWorldMatrix(true, false);
      _hx.set(0, -3.6, 0).applyMatrix4(e.matrixWorld);
      const n = puff ? 5 : Math.round(rnd(0, 1) + k[i] * 260 * dt);
      for (let j = 0; j < n; j++) {
        const cone = puff ? 50 : 17, th = Math.acos(1 - Math.random() * (1 - Math.cos(cone * DEG))), ph = rnd(0, Math.PI * 2);
        _hd.set(Math.sin(th) * Math.cos(ph), -Math.cos(th), Math.sin(th) * Math.sin(ph)).transformDirection(e.matrixWorld);
        const sp = puff ? rnd(5, 12) : rnd(180, 260), hot = Math.random();
        haze.emit({ x: _hx.x, y: _hx.y, z: _hx.z, vx: _hd.x * sp, vy: _hd.y * sp, vz: _hd.z * sp, life: puff ? rnd(0.8, 1.4) : rnd(0.06, 0.14),
          s0: puff ? 1.2 : 1.4, s1: puff ? rnd(6, 9) : rnd(2.5, 4.5), a: puff ? 0.12 : 0.12 + 0.16 * hot, drag: 0,
          rgb: puff ? [0.75, 0.6, 1] : hot > 0.6 ? [1, 0.95, 1] : hot > 0.25 ? [0.7, 0.6, 1] : [1, 0.55, 0.8] });
      }
    });
  }
  const _rp = new THREE.Vector3(), _rd = new THREE.Vector3();
  // Puffs at the nose and tail in opposite directions (pitch couple); sign = which way it turns
  function rcs(sign, n) {
    for (const [along, dir] of [[NOSE * 0.86, 1], [-TAIL * 0.92, -1]]) for (let i = 0; i < n; i++) {
      _rp.set(R * 1.02 * dir * sign, along, rnd(-1, 1)).applyQuaternion(ship.quaternion);
      _rd.set(dir * sign, rnd(-0.15, 0.15), rnd(-0.25, 0.25)).normalize().applyQuaternion(ship.quaternion);
      const v = rnd(18, 34);
      puffs.emit({ x: _rp.x, y: _rp.y, z: _rp.z, vx: _rd.x * v, vy: _rd.y * v, vz: _rd.z * v, life: rnd(0.35, 0.8), s0: 0.8, s1: rnd(5, 9), a: 0.75, drag: 0, rgb: [0.95, 0.95, 1] });
    }
  }
  let deoShot = '', curPitch = 88;
  function deorbitFx(dt) {
    if (dt <= 0) return;
    const t = et;
    if (t < 1.2) once('deo', 'DEORBIT BURN · <b>T-3</b>', 1400);
    // RCS: start and stop of each slew, a short burst each
    const burst = (t0) => t > t0 && t < t0 + 0.45;
    if (burst(DEO.flip1[0])) rcs(1, 3); if (burst(DEO.flip1[1] - 0.5)) rcs(-1, 3);
    if (burst(DEO.flip2[0])) rcs(-1, 3); if (burst(DEO.flip2[1] - 0.5)) rcs(1, 3);
    if (t > DEO.flip1[1] && t < DEO.flip1[1] + 0.25 && Math.random() < 0.3) rcs(Math.random() < 0.5 ? 1 : -1, 1);   // trim the overshoot
    // Engines
    const k = vacLevel(t), fl = [0, 1, 2].map(i => { const t0 = DEO.ign + i * IGN_GAP; return t > t0 && t < t0 + 0.3 ? 1 - (t - t0) / 0.3 : 0; });
    setVac(k, fl, simClock);
    if (t > DEO.ign && !calls.ign) { calls.ign = true; flashScreen(0.12); shake = 0.6; callout('IGNITION', 1200); }
    hazeFx(dt, k, t > DEO.off + 0.25 && t < DEO.off + 0.45);
    if (t > DEO.ign) rvacMat.emissiveIntensity = t < DEO.off ? Math.min(1.6, rvacMat.emissiveIntensity + dt * 0.5) : rvacMat.emissiveIntensity * Math.exp(-dt * 0.6);
    // Small gimbal corrections on the centre engines while burning
    const burning = t > DEO.burn[0] && t < DEO.off;
    const gy = burning ? 0.9 * Math.sin(t * 3.1) + 0.4 * Math.sin(t * 7.3) : 0, gx = burning ? 0.6 * Math.sin(t * 2.3 + 1) : 0;
    tvc.rotation.set(gx * DEG * 1.6, 0, -gy * DEG * 1.6);
    dev = { tiltX: 0, tiltY: 0, gx, gy };
    // Burn panel: delta-v and periapsis
    const bu = clamp((t - DEO.ign) / (DEO.off - DEO.ign), 0, 1);
    $('lndBurn').hidden = t < DEO.ign || t > DEO.flip2[0] + 0.8;
    $('lndDv').textContent = (L.ENTRY.dv * bu).toFixed(1);
    $('lndPe').textContent = (200 - 160 * bu).toFixed(0);
    if (t > DEO.off && !calls.cut) { calls.cut = true; callout('SHUTDOWN · <b>Δv ' + L.ENTRY.dv + ' M/S</b>', 1600); rcs(1, 4); }
    if (t > DEO.flip2[1] - 1.6 && !calls.ei) { calls.ei = true; callout('ENTRY INTERFACE IN <b>3 · 2 · 1</b>', 1500); }
  }
  // Camera beats for the deorbit: always toward the sunrise / limb or across the ship, never straight down
  const _ct = new THREE.Vector3();
  function placeCam(shipAz, shipEl, viewAz, viewEl, d, roll = 0) {
    camera.position.copy(sph(shipAz, shipEl)).multiplyScalar(-d);
    camera.up.set(0, 1, 0); camera.lookAt(_ct.copy(camera.position).addScaledVector(sph(viewAz, viewEl), 1000));
    if (roll) camera.rotateZ(roll * DEG);
  }
  // One continuous shot: the ship in 3/4 profile, centred a little low, the lit limb arc behind. A slow orbit through the
  // beats, easing in ~15% for the ignition and out again for the flip back. No cuts.
  const deoStartPos = new THREE.Vector3(), deoStartLook = new THREE.Vector3(), deoEndPos = new THREE.Vector3(), deoEndLook = new THREE.Vector3(), deoLook = new THREE.Vector3();
  function deorbitShot(dt) {
    const t = et, asp = camera.aspect, far = Math.max(1, 1.5 / Math.max(asp, 0.4));
    if (t <= dt + 1e-6 || deoShot === '') { deoStartPos.copy(camera.position); deoStartLook.copy(orbLook); deoShot = 'go'; }
    const u = t / L.ENTRY.deorbit;
    const viewAz = lerp(-74, -50, u), viewEl = lerp(-9, -12, u);
    const zoom = 1 - 0.15 * sstep(DEO.ign - 0.6, DEO.ign + 0.6, t) * (1 - sstep(DEO.off + 0.3, DEO.flip2[0] + 0.6, t));
    const d = 108 * zoom * far;
    _pv.copy(sph(viewAz, viewEl)).multiplyScalar(-d).add(_co.set(0, 4, 0));        // camera: back along the view, a little up
    const burnK = sstep(DEO.ign - 1.2, DEO.ign, t) * (1 - sstep(DEO.off + 0.4, DEO.flip2[0] + 1, t));
    _ct.set(lerp(0, 14, burnK), -9, 0);                                                // below the ship (it sits above the HUD); toward the tail and plume while burning
    const k = sstep(0, 1.6, t);                                                       // ease over from where the idle shot was
    camera.position.copy(deoStartPos).lerp(_pv, k);
    deoLook.copy(deoStartLook).lerp(_ct, k);
    camera.up.set(0, 1, 0); camera.lookAt(deoLook);
    camOff.copy(camera.position); orbLook.copy(deoLook);
  }

  // ---------- Placing the ship in the ground scene ----------
  const _q = new THREE.Quaternion(), _pv = new THREE.Vector3(), _up = new THREE.Vector3(), _nz = new THREE.Vector3();
  const CG_H = () => TAIL + FOOT * legK;   // CG above the ground when upright on its feet
  const VIS_GIMBAL = 1.6;                  // the TVC source's nozzle swing is drawn this much bigger, so it reads on screen
  function placeShip() {
    if (state !== 'flight' && !(state === 'landed' && !replay)) return;
    const s = flight.s, tx = s.cmd.x + dev.tiltX, ty = s.cmd.y + dev.tiltY, ax = L.axisFromTilt(tx, ty);
    ship.rotation.set(Math.atan2(ax.z, ax.y), 0, Math.atan2(-ax.x, Math.hypot(ax.y, ax.z)));
    ship.position.set(s.x + ax.x * CG_H(), s.h + ax.y * CG_H(), s.z + ax.z * CG_H());
    const gx = s.gA.x + dev.gx * VIS_GIMBAL, gy = s.gA.y + dev.gy * VIS_GIMBAL;
    tvc.rotation.set(gx * DEG, 0, -gy * DEG);
    if (s.phase === 'belly') setFlaps(0.3 + 0.35 * s.flap, 0.3 - 0.35 * s.flap);
    else { const k = s.phase === 'flip' ? sstep(0, 3, s.t - s.tPh) : 1; setFlaps(lerp(0.3, -0.2, k), lerp(0.3, -0.2, k)); }
    setLegs(sstep(0, 1, legK));
  }
  function lowestPoint() {
    _up.set(0, 1, 0).applyQuaternion(ship.quaternion);
    return Math.min(ship.position.y + _up.y * NOSE, ship.position.y - _up.y * (TAIL + BELL));
  }
  function fallStep(dt) {
    if (state === 'falling') {
      fall.rate += 0.9 * dt;
      ship.rotateOnWorldAxis(fall.axis, fall.rate * dt);
      fall.v.y -= L.G * dt;
      ship.position.addScaledVector(fall.v, dt);
      flight.s.h = ship.position.y - TAIL; flight.s.vh = fall.v.y;
      if (lowestPoint() <= heightAt(ship.position.x, ship.position.z) + 0.3) explode(ship.position.clone().setY(heightAt(ship.position.x, ship.position.z)), 'air');
    } else if (state === 'tipping') {
      fall.rate += 1.4 * dt;
      const s = flight.s, ang = fall.rate * dt, ax = L.axisFromTilt(s.cmd.x + dev.tiltX, s.cmd.y + dev.tiltY), hl = Math.hypot(ax.x, ax.z) || 1;
      const pivot = _pv.set(s.x + ax.x / hl * FOOT_R, groundUnder(), s.z + ax.z / hl * FOOT_R);
      _q.setFromAxisAngle(fall.axis, ang);
      ship.position.sub(pivot).applyQuaternion(_q).add(pivot);
      ship.quaternion.premultiply(_q);
      fall.ang += ang;
      if (fall.ang > 1.05) explode(ship.position.clone().setY(groundUnder()), 'tip');
    }
  }
  // Frames for the replay (ground scene only)
  function record() {
    frames.push({ t: simClock, p: ship.position.clone(), q: ship.quaternion.clone(), g: tvc.rotation.clone(), legK, thr: curThr(), vis: ship.visible });
    while (frames.length && frames[0].t < simClock - 4) frames.shift();
  }
  function playReplay(dt) {
    replay.t += dt * 0.5;
    const fr = replay.frames;
    let i = fr.findIndex(f => f.t >= replay.t); if (i < 1) i = 1;
    const a = fr[i - 1], b = fr[Math.min(i, fr.length - 1)], k = b.t > a.t ? clamp((replay.t - a.t) / (b.t - a.t), 0, 1) : 0;
    ship.position.lerpVectors(a.p, b.p, k); ship.quaternion.slerpQuaternions(a.q, b.q, k);
    tvc.rotation.copy(b.g); setLegs(sstep(0, 1, b.legK)); ship.visible = true;
    setPlume(b.thr, simClock);
    if (replay.t >= replay.end) endReplay();
  }
  const curThr = () => state === 'flight' && flight.s.phase !== 'belly' ? flight.s.thr : 0;

  // ---------- Camera ----------
  // Ground scene: follows the ship rigidly (it moves at 300+ m/s) and smooths only the offset; a change of shot cuts.
  const camOff = new THREE.Vector3(-105, 42, -118), lookOff = new THREE.Vector3(), _co = new THREE.Vector3(), _lo = new THREE.Vector3();
  let shake = 0, orbitA = 0, shotName = '', padCam = false;
  const PAD_CAM = new THREE.Vector3(-82, 6, -98), REPLAY_CAM = new THREE.Vector3(70, 5, 62);
  function shot() {
    if (camMode !== 'auto') return camMode;
    if (state === 'replay') return 'replay';
    if (state === 'flight') {
      const s = flight.s;
      if (s.phase === 'belly') {   // shaky close-up through the deck → long-lens tracking cam as it pierces the base
        if (tBreak === null && s.h < DECK.base + 150) { tBreak = s.t; }
        if (tBreak === null) return 'close';
        return s.t < tBreak + 4.8 ? 'track' : s.t < tBreak + 7.5 ? 'flaps' : 'high';
      }
      if (s.phase === 'flip') return 'flip';
      return s.h > 70 ? 'chase' : 'pad';
    }
    if (state === 'landed' || state === 'tipping' || (state === 'crashed' && td)) return 'pad';
    return 'chase';
  }
  function camGoal(name) {
    const h = flight.s.h;
    switch (name) {
      case 'wide': _co.set(-105 + 20 * Math.sin(orbitA), 42, -118); _lo.set(0, -8, 0); break;
      case 'close': _co.set(-19, 3.5, -15); _lo.set(3, -2, 0); break;            // riding along by the aft flap
      case 'flaps': _co.set(-34, 12, -30); _lo.set(-12, -2, 0); break;                 // close on the aft flaps working
      case 'high': _co.set(-70, 120, -160); _lo.set(0, -40, 0); break;                 // pull back: the ground coming up
      case 'flip': _co.set(-40, 10, -150); _lo.set(0, 0, 0); break;
      default: {   // chase: from above, the pad below; lower as it nears the ground
        const k = sstep(40, 900, h), az = Math.atan2(SUN.z, SUN.x) + 0.5 * Math.sin(orbitA), el = lerp(16, 50, k) * DEG, R = lerp(110, 170, k);
        _co.set(R * Math.cos(el) * Math.cos(az), R * Math.sin(el), R * Math.cos(el) * Math.sin(az));
        _lo.set(0, -6 - 0.03 * k * Math.min(h, 600), 0);
      }
    }
  }
  // Idle in orbit: composed shots, each a slow drift, cut through a short dip to black
  //   [ship azimuth, ship elevation (deg, from the camera), view azimuth, view elevation, distance from → to (m), roll (deg)]
  const IDLE = [
    { ship: [-26, -13], view: [-38, -9], d: [125, 108], roll: [1.5, -0.5] },      // hero: toward the sun, the arc and glare, the ship rim-lit
    { ship: [-34, -15], view: [-38, -10], d: [520, 470], roll: [0, 0.6] },        // wide: the ship small, sun and arc in frame
    { ship: [-24, -12], view: [-40, -9], d: [112, 98], roll: [-0.8, 0.4] },
    { ship: [12, -14], view: [-6, -20], d: [105, 94], roll: [2, 0] },               // low: along the belly, lit ground below
  ];
  const SHOT_T = 11;
  let idleT = 0, idleI = 0, idleHold = false;
  const orbLook = new THREE.Vector3(0, -22, 0), _sd = new THREE.Vector3(), _vd = new THREE.Vector3();
  function idleShot(dt) {
    if (!idleHold) idleT += dt;
    if (idleT > SHOT_T) { idleT = 0; idleI = (idleI + 1) % IDLE.length; }
    const S = IDLE[idleI], u = idleT / SHOT_T, asp = camera.aspect;
    const squeeze = Math.min(1, asp / 1.6), far = Math.max(1, 1.5 / Math.max(asp, 0.4));   // portrait: centre the ship, back off
    const vAz = S.view[0], sAz = vAz + (S.ship[0] - vAz) * squeeze, sEl = S.view[1] + (S.ship[1] - S.view[1]) * squeeze;
    _sd.copy(sph(sAz, sEl)); _vd.copy(sph(vAz, S.view[1]));
    const d = lerp(S.d[0], S.d[1], sstep(0, 1, u)) * far;
    camera.position.copy(_sd).multiplyScalar(-d);
    camera.up.set(0, 1, 0); camera.lookAt(_pv.copy(camera.position).addScaledVector(_vd, 1000));
    camera.rotateZ(lerp(S.roll[0], S.roll[1], u) * DEG);
    camOff.copy(camera.position); orbLook.copy(camera.position).addScaledVector(_vd, d);
    dipAmt = Math.max(sstep(SHOT_T - 0.5, SHOT_T, idleT), 1 - sstep(0, 0.6, idleT));
  }
  let dipAmt = 0, tBreak = null, trk = null;
  // From far away the ship is a small bright point: sunlit steel and leftover heat
  const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: wispTex, color: 0xffd8b0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  glint.visible = false; scene.add(glint);
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const ENT_CAM = [[V3(-50, -4, -62), null, V3(0, -8, 0)], [V3(128, -66, -58), V3(108, -58, -82), V3(2, -6, 0)], [V3(-4, 12, 74), V3(-24, 7, 62), V3(-16, 2, 0)]];
  function cloudFx(dt) {   // vapour trail and torn streamers through the deck
    const s = flight.s;
    if (state === 'flight' && s.phase === 'belly' && (tBreak === null || s.t < tBreak + 6) && !paused) {   // vapour trail
      const sp2 = ship.position;
      const n = Math.min(40, Math.ceil(dt * 300)); for (let i = 0; i < n; i++) { const f = i / n;
        dust.emit({ x: sp2.x - s.vx * dt * f, y: sp2.y - s.vh * dt * f + 6, z: sp2.z - s.vz * dt * f, vx: rnd(-1, 1), vy: rnd(-1, 1), vz: rnd(-1, 1),
          life: 9, s0: 9, s1: 60, a: 0.75, drag: 0.5, rgb: [0.97, 0.95, 0.93] }); }
    }
    if (tBreak !== null && state === 'flight' && s.phase === 'belly' && s.t < tBreak + 2.5 && !paused) {   // torn streamers off the flaps
      if (s.h < DECK.base) once('base', 'CLOUD BASE · <b>6.6 KM</b>', 2000);
      for (const i of [1, 2, 3, 4]) { const a = ship.localToWorld(_pv.copy(ribbons[i].a));
        dust.emit({ x: a.x, y: a.y, z: a.z, vx: rnd(-4, 4), vy: -s.vh * 0.85 + rnd(-10, 10), vz: rnd(-4, 4), life: rnd(0.6, 1.4), s0: 6, s1: 30, a: 0.35, drag: 0.6, rgb: [0.95, 0.9, 0.86] }); }
    }
  }
  function cameraStep(dt) {
    orbitA += dt * (state === 'orbit' ? 0.12 : 0.04);
    if (inOrbit()) {   // orbit pass: the camera moves round the ship at the origin
      let off;
      if (state === 'orbit' && camMode !== 'free') { idleShot(dt); return; }
      if (state === 'deorbit' && camMode !== 'free') {
        deorbitShot(dt);
        const sh = shake;
        if (sh > 0.001 && !paused) { camera.position.add(_lo.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(sh * 0.5)); shake *= Math.exp(-dt * 3); }
        return;
      }
      if (state === 'orbit' || state === 'deorbit') off = _co.set(-80, 70, -110);
      else if (camMode === 'free') off = null;
      else {   // entry: A pulls down under the belly as the glow starts · B (peak) low, long lens up at the belly · C the wake
        const u = ent.u, sh = u < 0.3 ? 0 : u < 0.64 ? 1 : 2, S = ENT_CAM[sh];
        const k = sh === 0 ? sstep(0, 1, u / 0.3) : sh === 1 ? (u - 0.3) / 0.34 : (u - 0.64) / 0.36;
        if (sh === 0) { off = _co.copy(deoEndPos).lerp(S[0], k); _ct.copy(deoEndLook).lerp(S[2], k); }
        else { off = _co.copy(S[0]).lerp(S[1], k); _ct.copy(S[2]); }
        if (sh !== entShot) { if (entShot >= 0) { camOff.copy(off); orbLook.copy(_ct); } entShot = sh; }
        const fov = sh === 1 ? 30 : 40; if (camera.fov !== fov) { camera.fov = fov; resize(); }
      }
      if (camMode === 'free') controls.update(); else {
        camOff.lerp(off, 1 - Math.exp(-dt * (state === 'entry' ? 4 : 1.5)));
        camera.position.copy(camOff);
        orbLook.lerp(state === 'entry' ? _ct : _lo.copy(deoEndLook), 1 - Math.exp(-dt * 4));
        camera.lookAt(orbLook);
      }
      const sh = state === 'entry' ? ent.I * 0.9 : state === 'deorbit' && et > 0.9 && et < 2.1 ? 0.25 : 0;
      if (sh > 0.001 && !paused) camera.position.add(_lo.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(sh * 0.5));
      return;
    }
    if (camMode === 'still') return;
    if (state === 'flight') cloudFx(dt);
    if (camMode === 'free') { controls.target.lerp(ship.position, 1 - Math.exp(-dt * 3)); controls.update(); return; }
    const name = shot(), sp = ship.position;
    glint.visible = false;
    if (name === 'track') {   // a long-lens operator far below: lags, overshoots and corrects, magnified wobble
      if (shotName !== 'track') {
        trk = { p: sp.clone().add(_co.set(-5200, -4600, -3400)), a: sp.clone().add(_lo.set(60, -260, 30)), v: new THREE.Vector3(), t: 0 };
        if (camera.position.y < 0) camera.position.y = 0;
      }
      trk.t += dt;
      if (!paused) {
        _lo.copy(sp).sub(trk.a).multiplyScalar(7).addScaledVector(trk.v, -3.4);           // spring-damper aim
        trk.v.addScaledVector(_lo, dt); trk.a.addScaledVector(trk.v, dt);
        trk.a.add(_lo.set(flight.s.vx, flight.s.vh, flight.s.vz).multiplyScalar(dt * 0.97));   // pans with it (slightly behind)
        trk.a.add(_lo.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(1.6));       // hand jitter
        if (Math.random() < 0.02) trk.v.add(_lo.set(rnd(-1, 1), rnd(-1, 1), 0).multiplyScalar(25));   // a bump
      }
      camera.position.copy(trk.p); camera.lookAt(_pv.copy(trk.a).add(_lo.set(70, -45, 0)));   // ship off-centre, the cloud in the corner
      glint.visible = true; glint.position.copy(sp); glint.scale.setScalar(0.07 * camera.position.distanceTo(sp) * Math.tan(camera.fov * DEG / 2));
      camera.rotateZ(0.6 * DEG * Math.sin(trk.t * 1.3));
      const fov = lerp(9, 6, sstep(0.6, 2.4, trk.t));                               // zooms in as it locks on
      if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; resize(); }
      shotName = name; padCam = true; return;
    }
    if (name === 'pad' || name === 'replay') {
      const P = name === 'pad' ? PAD_CAM : REPLAY_CAM;
      if (name !== shotName) { camera.position.copy(P); lookOff.set(sp.x, clamp(0.45 * (sp.y + 15), 14, 60), sp.z); }
      camera.position.lerp(P, 1 - Math.exp(-dt * 2));
      _lo.set(sp.x * 0.8, clamp(0.45 * (sp.y + 15), 14, 60), sp.z * 0.8);
      lookOff.lerp(_lo, 1 - Math.exp(-dt * 4));
      camera.lookAt(lookOff);
      padCam = true;
    } else {
      camGoal(name);
      const cut = name !== shotName && shotName !== '' && (name === 'flaps' || name === 'flip' || name === 'close' || shotName === 'flaps' || shotName === 'track');
      if (padCam || cut) { camOff.copy(cut ? _co : camera.position.clone().sub(sp)); lookOff.copy(_lo); padCam = false; }
      camOff.lerp(_co, 1 - Math.exp(-dt * 1.2)); lookOff.lerp(_lo, 1 - Math.exp(-dt * 2));
      camera.position.copy(sp).add(camOff);
      const gmin = heightAt(camera.position.x, camera.position.z) + 3;
      if (camera.position.y < gmin) camera.position.y = gmin;
      camera.lookAt(_pv.copy(sp).add(lookOff));
    }
    shotName = name;
    const s = flight.s;
    const buffet = paused ? 0 : state === 'flight' ? (s.phase === 'belly' ? clamp(s.q / 1100, 0, 1) * 0.5 : s.phase === 'flip' ? 0.8 : 0.35 * sstep(40, 0, s.h)) : 0;
    const inDeck = s.h > DECK.base - 40 && s.h < DECK.top ? 1 : 0;
    const sh = (paused ? 0 : shake) + buffet + (name === 'close' && !paused ? 0.5 + 0.7 * inDeck + (Math.random() < 0.04 ? 1.6 : 0) : 0);
    if (sh > 0.001) camera.position.add(_co.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(sh * 0.6));
    if (!paused) shake *= Math.exp(-dt * 2.5);
    const fov = name === 'pad' || name === 'replay' ? 44 : name === 'flaps' || name === 'close' ? 52 : 40;
    if (camera.fov !== fov) { camera.fov = fov; resize(); }
  }

  // ---------- HUD ----------
  const sgn = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1);
  const R_PER_DEG = 40 / 25;   // dial: 25° at r = 40
  const PH = ['orbit', 'entry', 'belly', 'flip', 'tvc', 'td'];
  function phaseKey() {
    if (state === 'orbit') return 'orbit';
    if (state === 'deorbit' || state === 'entry') return 'entry';
    if (state === 'flight') return flight.s.phase;
    if (state === 'falling') return 'tvc';
    return 'td';
  }
  function hud() {
    const s = flight.s, orb = inOrbit();
    const alt = orb ? ent.h : state === 'landed' || state === 'crashed' || state === 'replay' ? 0 : Math.max(0, s.h - groundUnder());
    const blackout = state === 'entry' && ent.h < 80e3 && ent.h > 40e3 && !paused;
    $('landing').classList.toggle('lnd-blackout', blackout);
    $('lndAlt').textContent = blackout ? (Math.random() < 0.15 ? '—' : '- -') : alt >= 1000 ? (alt / 1000).toFixed(alt >= 1e5 ? 0 : alt >= 1e4 ? 1 : 2) : alt.toFixed(alt < 10 ? 1 : 0);
    $('lndAltU').textContent = alt >= 1000 ? 'km' : 'm';
    const flying = state === 'flight' || state === 'falling';
    const vs = orb ? (state === 'entry' ? -ent.v * Math.sin((4 + 36 * ent.u) * DEG) : 0) : flying ? s.vh : 0;
    $('lndVs').textContent = vs.toFixed(1);
    const spd = orb ? ent.v : flying ? Math.hypot(s.vx, s.vh, s.vz) : 0;
    if (blackout) $('lndVs').textContent = '—';
    $('lndSpd').textContent = blackout ? '—' : (spd * 3.6).toLocaleString('en-US', { maximumFractionDigits: 0 });
    const thr = orb ? (state === 'deorbit' ? vacLevel(et).reduce((x, y) => x + y) / 3 : 0) : curThr();
    $('lndThr').style.width = `${clamp(thr, 0, 1) * 100}%`;
    $('lndThrV').textContent = `${Math.round(clamp(thr, 0, 1) * 100)}%`;
    const dp = orb ? null : flight.drift;
    $('lndDrift').textContent = dp === null ? '—' : dp >= 1000 ? (dp / 1000).toFixed(2) + ' km' : dp.toFixed(0) + ' m';
    $('lndTtg').textContent = state === 'flight' && s.phase === 'tvc' ? flight.ttg.toFixed(0) + ' s' : '—';
    $('lndWarp').hidden = state !== 'entry';
    $('lndPhase').textContent = paused ? 'PAUSED' : lost ? 'SIGNAL LOST'
      : state === 'orbit' ? 'MARS ORBIT · 200 KM'
      : state === 'deorbit' ? 'DEORBIT BURN'
      : state === 'entry' ? (blackout ? 'PLASMA BLACKOUT' : ent.I > 0.15 ? 'ENTRY · PLASMA' : 'ATMOSPHERIC ENTRY')
      : state === 'flight' ? (s.phase === 'belly' ? 'BELLY FLOP' : s.phase === 'flip' ? 'FLIP' : s.h > 20 ? (source === 'rig' ? 'TVC LANDING · RIG' : 'TVC LANDING') : 'FINAL METRES')
      : state === 'falling' ? 'LOSS OF CONTROL' : state === 'tipping' ? 'TIPPING OVER'
      : state === 'replay' ? 'REPLAY'
      : outcome?.title ?? '';
    $('lndPhase').classList.toggle('warn', blackout || lost || state === 'falling' || state === 'tipping' || (endState === 'crashed'));
    const ki = PH.indexOf(phaseKey());
    document.querySelectorAll('#lndChips span').forEach((c, i) => { c.classList.toggle('on', i === ki); c.classList.toggle('done', ki > i); });
    // Attitude dial: the TVC's tilt and nozzle (its own, without the autopilot's lean)
    const a = dev, tvcOn = state === 'flight' && s.phase === 'tvc' || state === 'falling' || (ended() && td);
    const px = clamp(a.tiltY, -30, 30) * R_PER_DEG, py = -clamp(a.tiltX, -30, 30) * R_PER_DEG;
    $('lndTiltDot').setAttribute('cx', px); $('lndTiltDot').setAttribute('cy', py);
    $('lndTiltVec').setAttribute('x2', px); $('lndTiltVec').setAttribute('y2', py);
    $('lndGimDot').setAttribute('cx', a.gy * 5); $('lndGimDot').setAttribute('cy', -a.gx * 5);
    if (state === 'flight' && s.phase === 'tvc' && !paused) { trail.push([px, py]); if (trail.length > 45) trail.shift(); }
    $('lndTrail').setAttribute('points', trail.map(q => q.join(',')).join(' '));
    if (!tvcOn) {
      const pitch = orb ? ((curPitch % 360) + 360) % 360 : s.tilt;
      $('lndTiltL').textContent = 'Pitch'; $('lndTilt').textContent = pitch.toFixed(0) + '°'; $('lndTilt').className = '';
    } else {
      const t = L.tiltOf(a.tiltX, a.tiltY);
      $('lndTiltL').textContent = 'TVC tilt'; $('lndTilt').textContent = t.toFixed(1) + '°';
      $('lndTilt').className = t > 15 ? 'warn' : t > 8 ? 'amber' : '';
    }
    $('lndTX').textContent = sgn(a.tiltX) + '°'; $('lndTY').textContent = sgn(a.tiltY) + '°';
    $('lndGX').textContent = sgn(a.gx) + '°'; $('lndGY').textContent = sgn(a.gy) + '°';
    const live = rigLive(), src = $('lndSource');
    src.classList.toggle('live', source === 'rig' && live); src.classList.toggle('sim', source === 'sim');
    $('lndSrcTitle').textContent = source === 'sim' ? 'SIMULATED TVC' : live ? (rig?.demo ? 'RIG · BENCH DEMO FEED' : 'RIG · LIVE') : 'RIG · NO DATA';
    $('lndSrcSub').innerHTML = source === 'sim'
      ? (att.tvc ? 'Autopilot through the flip, then the Nano’s controller holds it to touchdown. <b>Gust</b> (G) shoves it.' : 'TVC is <b>off</b>: after the flip nothing holds it upright.')
      : live ? 'Autopilot through the flip, then the ship follows the real rocket. <b>Push it</b> and watch the TVC fight back.'
      : 'Connect the Arduino (top bar) or switch to <b>Simulated</b>.';
    if (state === 'orbit') goBtn.disabled = source === 'rig' && !live;
  }

  // ---------- Effects per frame (ground scene) ----------
  const _ex = new THREE.Vector3();
  function effects(dt) {
    const sp = ship.position;
    _up.set(0, 1, 0).applyQuaternion(ship.quaternion);
    if (state === 'flight' && flight.s.phase === 'belly') {   // dust in the air rushing past
      const s = flight.s, v = Math.hypot(s.vx, s.vh), n = Math.round(clamp((v - 60) / 60, 0, 5));
      for (let i = 0; i < n; i++) {
        const ahead = rnd(40, 200);
        dust.emit({ x: sp.x + s.vx / v * ahead + rnd(-70, 70), y: sp.y + s.vh / v * ahead + rnd(-50, 50), z: sp.z + rnd(-90, 90),
          vx: 0, vy: 0, vz: 0, life: rnd(0.5, 1.1), s0: 0.6, s1: 1.4, a: 0.35, drag: 0, rgb: STREAK });
      }
    }
    if (state === 'flight' && flight.s.rcs && Math.random() < 0.7) {   // flip: nose RCS puffs
      const s = flight.s, nose = _pv.copy(sp).addScaledVector(_up, NOSE * 0.8), side = Math.sign(s.rcs);
      for (let i = 0; i < 3; i++) dust.emit({ x: nose.x, y: nose.y, z: nose.z + rnd(-3, 3), vx: -_up.y * 30 * side + s.vx, vy: _up.x * 30 * side + s.vh, vz: rnd(-4, 4),
        life: rnd(0.3, 0.7), s0: 1.5, s1: 6, a: 0.7, drag: 3, rgb: [1, 1, 1] });
    }
    // Dust blown off the ground where the exhaust (along the nozzle, so it follows the gimbal) meets it
    if (plume.visible && ship.visible) {
      tvc.updateWorldMatrix(true, false);
      _nz.set(0, -1, 0).transformDirection(tvc.matrixWorld);            // exhaust direction
      const exit = _ex.set(0, -BELL, 0).applyMatrix4(tvc.matrixWorld);
      const g = heightAt(exit.x, exit.z), d = _nz.y < -0.3 ? (exit.y - g) / -_nz.y : 1e9;
      if (d < 110) {
        const k = 1 - d / 110, gx = exit.x + _nz.x * d, gz = exit.z + _nz.z * d, n = Math.round(30 * k * k + 3);
        const bx = _nz.x * 40, bz = _nz.z * 40;                         // pushed the way the exhaust leans
        for (let i = 0; i < n; i++) {
          const a = rnd(0, Math.PI * 2), v = rnd(18, 52) * (0.4 + k);
          dust.emit({ x: gx + Math.cos(a) * 3, y: g + 0.6, z: gz + Math.sin(a) * 3, vx: Math.cos(a) * v + bx, vy: rnd(0.4, 6), vz: Math.sin(a) * v + bz,
            life: rnd(1, 3.2), s0: 2.5, s1: rnd(10, 22) * (0.6 + k), a: 0.4 + 0.3 * k, drag: 0.6, rgb: DUST });
        }
      }
    }
    if (stormT > 0) {   // the cloud keeps rolling out after touchdown
      stormT -= dt; const s = flight.s;
      for (let i = 0; i < 8; i++) { const a = rnd(0, Math.PI * 2), v = rnd(6, 20);
        dust.emit({ x: s.x + Math.cos(a) * 12, y: s.h + rnd(0, 4), z: s.z + Math.sin(a) * 12, vx: Math.cos(a) * v, vy: rnd(1, 5), vz: Math.sin(a) * v, life: rnd(3, 6), s0: 8, s1: 30, a: 0.35, drag: 0.4, rgb: DUST }); }
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
    clouds.forEach((c, i) => { c.offset.x += dt * 0.0015 * (i + 1); c.offset.y += dt * 0.0008; });
  }

  // ---------- Loop ----------
  function resize() {
    const w = view.clientWidth, h = view.clientHeight;
    if (w < 2 || h < 2) return;
    const pr = Math.min(devicePixelRatio, QUALITY[qName].pr);
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    post.setSize(w, h, pr);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    orbit.resize(w / h, camera.fov);
    const sc = h * renderer.getPixelRatio() / (2 * Math.tan(camera.fov * DEG / 2));
    dust.setScale(sc); fire.setScale(sc); glow.setScale(sc); puffs.setScale(sc); haze.setScale(sc);
  }
  new ResizeObserver(resize).observe(view);

  let last = performance.now(), acc = 0, lastHud = 0, warmed = false;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.1); last = now;
    if (document.body.dataset.tab !== 'landing') return;      // paused while another tab shows
    const sdt = paused ? 0 : dt;
    simClock += sdt;
    if (inOrbit()) {
      if (!paused) orbitStep(dt); else orbitStep(0);
      cameraStep(dt);
      fadeAmt = ent.fade;
      orbit.set(ent.h / 1000, phi, camera.position, camera.quaternion, simClock);
      // ?sunrise: in the hero idle shots, put the sun disc and glare right on the limb (a film cheat; the light stays real)
      const cheat = SUNRISE && state === 'orbit' && idleI !== 1 && idleI !== 3;
      orbit.setBurstDir(cheat ? SUNRISE_DIR : null);
      orbitFlare.lf.position.copy(cheat ? SUNRISE_DIR : ORB_SUN).multiplyScalar(6e5);
      applyLook(dt);
      post.setMode(true);
      if (!(warmed && window.tvcCovered?.())) { post.render(dt); warmed = true; }
    } else {
      acc += sdt;
      while (acc >= L.DT) { acc -= L.DT; simStep(); }
      if (!paused) fallStep(sdt);
      if (state === 'replay' && !paused) playReplay(dt);
      else { placeShip(); setPlume(state === 'falling' || state === 'tipping' ? 0 : curThr(), simClock); }
      if (state === 'flight' || state === 'falling' || state === 'tipping' || (ended() && state !== 'replay' && simClock - (frames.at(-1)?.t ?? 0) < 0.6)) record();
      if (!paused) effects(sdt);
      if (fadeOut > 0) { fadeOut = Math.max(0, fadeOut - dt); fadeAmt = fadeOut / 0.8; } else fadeAmt = 0;
      padLights.forEach((m, i) => { m.visible = Math.floor(simClock * 2 + i / 3) % 2 === 0 || state === 'landed'; });
      const lp = ship.position, throwD = Math.max(lp.y, 0) / SUN.y;
      sun.target.position.copy(lp).addScaledVector(SUN, -throwD); sun.position.copy(sun.target.position).addScaledVector(SUN, throwD + 120);
      if (Math.abs(sun.shadow.camera.far - (throwD + 300)) > 30) { sun.shadow.camera.far = throwD + 300; sun.shadow.camera.updateProjectionMatrix(); }
      cameraStep(dt);
      flare.lf.position.copy(camera.position).addScaledVector(SUN, 60000);
      applyLook(dt);
      post.setMode(false);
      if (!(warmed && window.tvcCovered?.())) { post.render(dt); warmed = true; }
    }
    if (now - lastHud > 60) { lastHud = now; hud(); }
    // Frame rate: shown with ?debug; drop a quality level if it stays under 40 fps for 3 s
    fpsN++; fpsT += dt;
    if (fpsT >= 1) {
      const fps = fpsN / fpsT; fpsN = 0; fpsT = 0;
      if (DEBUG) $('lndFps').textContent = fps.toFixed(0) + ' fps · ' + QUALITY[qName].label;
      slow = fps < 40 ? slow + 1 : 0;
      if (slow >= 3 && qName !== 'low' && !DEBUG) { slow = 0; setQuality(Q_ORDER[Q_ORDER.indexOf(qName) + 1]); callout('QUALITY LOWERED · ' + QUALITY[qName].label.toUpperCase(), 1800); }
    }
  }
  let fpsN = 0, fpsT = 0, slow = 0;
  const DEBUG = /[?&]debug/.test(location.search);
  if (DEBUG) {
    $('lndFps').hidden = false;
    // Stills for comparing looks: __lnd.still('A') shows the ground scene from a low camera toward the horizon
    window.__lnd = {
      still(name, x = -160, y = 5, z = -170, tx = 1800, ty = 120, tz = 2300) {
        lookOverride = name; state = 'landed'; endState = 'landed'; scene.add(ship); ship.visible = false;
        camMode = 'still'; controls.enabled = false; camera.position.set(x, heightAt(x, z) + y, z); camera.lookAt(tx, ty, tz);
        Object.assign(look, blendLooks({}, name, name, 0)); refresh();
      },
      look(name) { lookOverride = name; },
      entry(u) { window.__entU = u; },
      ground() { cutToGround(); },
      shot(i, t = 4) { idleI = i; idleT = t; idleHold = true; },   // freeze idle shot i at t seconds
    };
  }

  try { const s = localStorage.getItem('tvc-landing-src'); if (s === 'rig' || s === 'sim') source = s; } catch {}
  setSource(source);
  setQuality(qName);
  $('lndQual').onclick = () => setQuality(Q_ORDER[(Q_ORDER.indexOf(qName) + 1) % Q_ORDER.length]);
  camera.position.copy(camOff);
  resize();
  requestAnimationFrame(frame);
  return { resize };
}
