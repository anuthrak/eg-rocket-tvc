// Landing tab: a Starship-style ship landing on Mars, for the showcase.
//   Idle: the ship in orbit (landing-orbit.js draws the planet; the ship is drawn on top at metre scale).
//   Begin descent: deorbit burn, then a time-compressed plasma entry, a cut inside the cloud deck to the ground scene,
//   the belly flop and flip on autopilot (landing-sim.js createFlight), and the TVC landing from right after the flip:
//     Rig       - the real rocket's tilt and nozzle angles on the desk rig (bench.js 'tvc:sample' events) are added on
//                 top of the autopilot's attitude, so pushing the real rocket pushes the ship.
//     Simulated - the Nano's controller (controller.js) instead, with gusts and a TVC on/off switch.
//   Endings hold a moment, then the result card. Illustrative, not to scale in time.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import * as L from './landing-sim.js';
import { createOrbitScene, R_MARS } from './landing-orbit.js';
import { blendLooks, easeLook, newLook, createPost, createFlare, QUALITY, Q_ORDER } from './landing-look.js';
import { PLAN, footprints, resolvePlan, onBase, makeBaseMap, MAP, padTexture, checkPlan, drawPlanMap, buildBase } from './landing-base.js';

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
  scene.fog = new THREE.FogExp2(HAZE, 5.7e-5);         // dusty air: density = 1/L (see the haze chunk below); the look sets it
  const camera = new THREE.PerspectiveCamera(40, 1, 1, 200000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.enabled = false; controls.maxPolarAngle = 88 * DEG;

  // Afternoon sun through dusty air: a low sun for long shadows; colour and strength come from the active look
  // Side light for the site cameras (on the west rim looking east, ~-10° azimuth): the sun ~90° to their left, so shadows
  // run across the frame, the west-facing valley wall is raked (buttresses half lit, half shaded) and the ship has a lit
  // and a shadow side. Behind the camera (the old -130°) it flattened everything.
  const SUN_GROUND_AZ = -100, SUN_GROUND_EL = 17;
  const SUN = new THREE.Vector3(Math.cos(SUN_GROUND_EL * DEG) * Math.cos(SUN_GROUND_AZ * DEG), Math.sin(SUN_GROUND_EL * DEG), Math.cos(SUN_GROUND_EL * DEG) * Math.sin(SUN_GROUND_AZ * DEG));   // ~17° up: long shadows
  // Aerial perspective (all fogged materials): haze = 1 - exp(-(d/L)^0.85), L from the look (fog density = 1/L): ~7% at 1 km, ~22% at
  // the valley wall 4 km out, ~53% at 15 km, ~83% at 40 km, so the scene reads in depth layers and the far ranges melt into the
  // sky. Thinner with height (sight lines from altitude cross less dust), a little cooler in the mid distances, warmer toward the sun; the fog colour is
  // the sky's horizon colour so the skyline has no seam. Computed from the camera-relative position, so sprites and points
  // work too. A material can take less haze with defines.HAZE_K (the ship: still the clearest thing in the frame).
  THREE.ShaderChunk.fog_pars_vertex = `#ifdef USE_FOG
  varying float vFogDepth; varying vec3 vFogRel;
#endif`;
  THREE.ShaderChunk.fog_vertex = `#ifdef USE_FOG
  vFogDepth = - mvPosition.z; vFogRel = transpose(mat3(viewMatrix)) * mvPosition.xyz;
#endif`;
  THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor; varying float vFogDepth; varying vec3 vFogRel;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear; uniform float fogFar;
  #endif
#endif`;
  THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
  {
    float hzD = length(vFogRel); vec3 hzW = cameraPosition + vFogRel, hzV = vFogRel / max(hzD, 1e-3);
    #ifdef FOG_EXP2
      // Dust thins with height (scale height 1 km): the mean density along the sight line from the camera to this point,
      // so a view down from the flip altitude crosses far less haze than one along the valley floor
      float hzYc = max(cameraPosition.y, 0.0), hzYp = max(hzW.y, 0.0), hzDy = hzYc - hzYp, hzE = exp(-hzYp / 1000.0);
      float hzRho = abs(hzDy) < 1.0 ? hzE : 1000.0 * (hzE - exp(-hzYc / 1000.0)) / hzDy;
      float fogFactor = 1.0 - exp(-pow(hzD * fogDensity * (0.06 + hzRho), 0.85));
    #else
      float fogFactor = smoothstep(fogNear, fogFar, hzD);
    #endif
    #ifdef HAZE_K
      fogFactor *= HAZE_K;
    #endif
    float hzS = pow(max(dot(hzV, normalize(vec3(${SUN.x.toFixed(4)}, ${SUN.y.toFixed(4)}, ${SUN.z.toFixed(4)}))), 0.0), 3.0);
    vec3 hzC = fogColor * mix(vec3(1.0), vec3(1.2, 1.08, 0.94), hzS * 0.7);
    hzC *= mix(vec3(0.96, 0.97, 1.03), vec3(1.0), smoothstep(0.3, 0.85, fogFactor));
    gl_FragColor.rgb = mix(gl_FragColor.rgb, hzC, fogFactor);
  }
#endif`;
  const sun = new THREE.DirectionalLight(0xffe4c2, 3.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 1, far: 1200 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.8;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xe8b08a, 0x2a140a, 0.5); scene.add(hemi);

  // Sky dome (section 13): butterscotch horizon → darker brownish-pink zenith (darker still from height), the blue glow
  // round a small Mars sun, thin high water-ice clouds drifting, dust layers on the horizon (thicker toward the sun), Phobos
  const skyU = { uSun: { value: SUN }, uZen: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uHor: { value: new THREE.Color() },
    uSunCol: { value: new THREE.Color() }, uDust: { value: 0.3 }, uT: { value: 0 }, uAlt: { value: 0 }, uCirrus: { value: 1 } };
  let groundSky; const vCam = new THREE.PerspectiveCamera(34, 1, 30, 260000);
  {
    const sky = groundSky = new THREE.Mesh(new THREE.SphereGeometry(150000, 64, 32), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyU,
      vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); vec4 p = projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: `uniform vec3 uSun, uZen, uMid, uHor, uSunCol; uniform float uDust, uT, uAlt, uCirrus; varying vec3 vD;
        float sh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float sn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(sh(i), sh(i + vec2(1, 0)), f.x), mix(sh(i + vec2(0, 1)), sh(i + vec2(1, 1)), f.x), f.y); }
        float sf(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * sn(p); p = p * 2.07 + 3.1; a *= 0.5; } return s; }
        void main(){ vec3 d = normalize(vD); float h = clamp(d.y, -0.3, 1.0);
          float up = smoothstep(500.0, 9000.0, uAlt);                                           // higher → darker, thinner sky
          vec3 zen = uZen * mix(1.0, 0.55, up), mid = uMid * mix(1.0, 0.75, up);
          vec3 c = mix(uHor, mid, smoothstep(0.0, 0.2, h));
          c = mix(c, zen, smoothstep(0.15, 0.8, h));
          vec3 sd = normalize(uSun); float s = max(dot(d, sd), 0.0);
          c = mix(c, vec3(0.34, 0.52, 0.86) * (0.65 + 0.5 * h), pow(s, 16.0) * 0.55 + pow(s, 120.0) * 0.25);   // blue aureole round the sun
          c += uSunCol * (smoothstep(0.999992, 0.999997, s) * 40.0 + pow(s, 2200.0) * 3.0 + pow(s, 90.0) * 0.35 + pow(s, 6.0) * 0.1);   // small disc, halo, glow
          // Thin water-ice cirrus high up: streaky noise on a far plane, lit from the sun side, drifting
          if (h > 0.02) { vec2 p = d.xz / (h + 0.06) * 1.6; p.x += uT * 0.004;
            float w = sf(vec2(p.x * 0.7 + p.y * 0.3, (p.y - p.x * 0.4) * 3.2)); float ci = smoothstep(0.52, 0.8, w) * smoothstep(0.02, 0.25, h) * (1.0 - 0.6 * up);
            c = mix(c, vec3(1.0, 0.94, 0.88) * (0.75 + 0.6 * pow(s, 4.0)), ci * 0.32 * uCirrus); }
          // Phobos: a small, dim, lumpy moon low in the east, lit from the sun's side
          vec3 ph = normalize(vec3(0.82, 0.16, 0.55)); float pd = acos(clamp(dot(d, ph), -1.0, 1.0));
          if (pd < 0.006) { vec3 t1 = normalize(cross(ph, vec3(0, 1, 0))), t2 = cross(t1, ph); vec2 q = vec2(dot(d - ph, t1), dot(d - ph, t2)) / 0.0045;
            float r = length(q * vec2(1.0, 1.25)) + 0.12 * (sn(q * 3.0 + 4.0) - 0.5);
            if (r < 1.0) { float lit = clamp(0.35 + 0.8 * dot(normalize(vec3(q, 0.6)), normalize(vec3(dot(sd, t1), dot(sd, t2), 0.4))), 0.0, 1.0);
              c = mix(c, vec3(0.62, 0.55, 0.5) * lit + c * 0.3, smoothstep(1.0, 0.85, r)); } }
          // Dust layers hugging the horizon, thicker toward the sun
          float band = exp(-abs(h - 0.02) * 26.0) + 0.5 * exp(-abs(h - 0.075) * 40.0);
          c = mix(c, uHor * (1.06 + 0.25 * pow(s, 3.0)), clamp(uDust * band * (1.0 + 0.8 * pow(max(dot(normalize(d.xz), normalize(sd.xz)), 0.0), 2.0)), 0.0, 1.0));
          c = mix(c, uHor * 0.8, smoothstep(0.0, -0.25, h));
          gl_FragColor = vec4(c, 1.0); }`,
    }));
    sky.renderOrder = -1; sky.frustumCulled = false;
    scene.add(sky);
  }

  // ---------- Terrain (section 13): a broad valley between two mesa walls ----------
  // The base sits on the floor of a valley ~4 km wide running north–south (the approach comes down it). Two long mesa
  // walls (260–310 m, cliffs broken by side canyons, loose buttes off their edges, rubble fans at their feet) close it on
  // either side; the valley floor rolls, a dry riverbed winds down it east of the pad, low outcrops and small buttes stand
  // on it, a dark crescent-dune field lies to the south. On the plateaus: big layered mesas 6–15 km out (the largest due
  // east, behind the ship from the site camera, which stands on the west rim), wind-carved ridges to the north-west; then
  // ridged ranges, a field of far mesas and a canyon to the horizon. Craters (fresh: bright rays; old: worn, sand-filled)
  // trail dust streaks downwind.
  const TERRAIN = {
    wind: [0.6, 0.8],               // the way the wind blows (dunes' horns and the streaks point this way)
    west: { x: -1850, wan: 380, h: 260, seed: 3.3, canyon: 620 }, east: { x: 2050, wan: 420, h: 310, seed: 8.1, canyon: 780 },   // valley walls: edge x, wander, height, canyon spacing
    river: [650, 300, 2600, 120, 800],   // dry riverbed: x = a + b·sin(z/c) + d·sin(z/e + 1)
    dunes: { x: 300, z: -7600, r: 1500 }, yardangs: { x: -6500, z: 2500, r: 2500 },
    // [x, z, radius, height]: big mesas on the plateaus, then small buttes on the valley floor
    mesas: [[11500, 600, 2700, 420], [8600, -5200, 1300, 270], [14500, 5600, 1900, 360], [-9800, -8000, 2300, 300], [-13000, 6800, 1700, 280], [6200, 12500, 2400, 380]],
    buttes: [[-900, 2600, 160, 60], [1100, -3400, 200, 75], [700, 5200, 140, 55], [-1100, -6000, 220, 80], [-600, 9000, 260, 90], [400, -11000, 300, 95],
      [1450, -1150, 210, 135], [620, 1350, 160, 85], [-350, -1400, 130, 65], [1250, 2300, 380, 170], [-700, 1700, 120, 55]],   // in the site cameras' view, 1.5–3 km out
    ridges: [[-1300, 180, 34], [1050, 220, 45]],
    channels: [[-950, 0.18, 0.9], [650, -0.12, 0.7], [1850, 0.1, 1]],   // [z at the river, drift dz/dx, depth k]: dry washes from the east wall to the riverbed
    peaks: [[13500, -2600, 3600, 820], [15200, 2900, 4300, 700], [11800, 6600, 3000, 640], [-14200, -3200, 3800, 760], [-12500, 4800, 3200, 600]],   // [x, z, radius, height]: ranges that break the skyline over the walls   // [x, wander, height]: low ridges along the valley floor
    baseR: 300,                     // craters kept this far from the pad (the ground is rough right up to it)
  };
  const GRADE = [];                 // levelled footprints ({ x, z, r, h }) for the base buildings, filled once terrain() exists
  // The base round the pad (section 14) is laid out in landing-base.js (PLAN); its footprints are levelled here
  const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
  function vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return lerp(lerp(a, b, u), lerp(c, d, u), v) * 2 - 1;
  }
  const fbm = (x, y) => { let s = 0, a = 1, f = 1; for (let i = 0; i < 5; i++) { s += a * vnoise(x * f, y * f); a *= 0.5; f *= 2.03; } return s; };
  const ridged = (x, y) => { let s = 0, a = 1, f = 1; for (let i = 0; i < 4; i++) { const n = 1 - Math.abs(vnoise(x * f, y * f)); s += a * n * n; a *= 0.5; f *= 2.1; } return s / 1.875; };
  const WX = TERRAIN.wind[0], WZ = TERRAIN.wind[1];
  const terrace = (h, band, sharp = 0.25) => band * (Math.floor(h / band) + sstep(sharp, 1, h / band - Math.floor(h / band)));   // benches
  const craters = [];
  { let seed = 11; const r01 = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 420; i++) {   // power-law sizes 20 m … ~800 m radius; f: 0.35 worn … 1 fresh
      const R = 20 + Math.pow(r01(), 4) * 780, d = 400 + R + Math.pow(r01(), 1.1) * 13000, a = r01() * Math.PI * 2, f = 0.35 + 0.65 * r01(), x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (d < TERRAIN.baseR + R * 2 && R > 8) continue;   // keep the base ground clear
      craters.push([x, z, R, f, r01() * 6.28]);
    }
    for (let i = 0; i < 120; i++) {   // small ones near the pad, for scale
      const R = 3 + Math.pow(r01(), 2) * (i < 60 ? 6 : 26), d = 90 + R + Math.pow(r01(), 0.8) * (i < 60 ? 800 : 1400), a = r01() * Math.PI * 2;
      if (i >= 60 && d < TERRAIN.baseR + R) continue;
      craters.push([Math.cos(a) * d, Math.sin(a) * d, R, 0.8 + 0.2 * r01(), r01() * 6.28]);
    }
  }
  // The valley walls: [height, talus 0..1]. Each wall stands on a long scree apron (600–900 m deep, up to ~40% of its height,
  // concave like real talus), rises in one sheer face or, along some stretches, two faces with a ledge between, and rounds
  // over at the rim. Side canyons cut it back at irregular spacing: wide bays and narrow slots, shallow and deep. Loose
  // buttes stand off the foot. The parts that depend on z only are tabled every 8 m.
  const WALLS = [[-1, TERRAIN.west], [1, TERRAIN.east]].map(([s, W]) => {
    const n = 30001, e = new Float32Array(n), H = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n), P = new Float32Array(n), D = new Float32Array(n), Ph = new Float32Array(n);
    for (let i = 0; i < n; i++) { const z = (i - 15000) * 8;
      e[i] = W.x + W.wan * fbm(z / 3800 + W.seed, W.seed) + 140 * fbm(z / 700 + W.seed * 2, 3.1); H[i] = W.h * (0.75 + 0.35 * fbm(z / 5000 + W.seed, 7));
      A[i] = 720 + 260 * fbm(z / 1500 + W.seed * 4, 1.3);                                   // apron depth
      B[i] = sstep(0.05, 0.35, fbm(z / 2600 + W.seed * 6, 5.7));                             // ledge along this stretch
      P[i] = lerp(5, 18, sstep(-0.5, 0.5, fbm(z / 1700 + W.seed * 3, 2.2)));                // canyon sharpness: bay … slot
      D[i] = 850 * lerp(0.45, 1.3, sstep(-0.6, 0.6, fbm(z / 2100 + W.seed * 5, 9.4)));     // canyon depth
      Ph[i] = z / W.canyon + 2.6 * fbm(z / 2600 + W.seed, W.seed * 2);                       // canyon spacing, irregular
    }
    return { s, W, e, H, A, B, P, D, Ph };
  });
  const wz = (A, z) => { const f = clamp(z / 8 + 15000, 0, 29999.999), i = f | 0, t = f - i; return A[i] + (A[i + 1] - A[i]) * t; };
  function wallAt(x, z) {
    let h = 0, tal = 0;
    for (const T of WALLS) {
      const { s, W } = T, e = wz(T.e, z), sx = s * (x - e);   // > 0: plateau side
      if (sx < -1400) continue;
      const notch = sx < 1800 ? Math.pow(Math.max(0, 1 - Math.abs(Math.sin(wz(T.Ph, z) + 1.2 * fbm(x / 900, z / 900 + W.seed)))), wz(T.P, z)) * sstep(1800, 300, sx) * wz(T.D, z) : 0;
      const H = wz(T.H, z), u = sx - notch, aw = wz(T.A, z), led = wz(T.B, z), lw = led > 0.01 && u > -200 && u < 700 ? 170 + 60 * fbm(x / 500, z / 500 + W.seed) : 170;
      // Face(s): steep for most of the height, rounding over at the rim; with a ledge, a lower face to ~55% then the upper one
      const face = v => 0.86 * sstep(-110, 50, v) + 0.14 * sstep(-30, 300, v);
      const cliff = lerp(face(u), 0.55 * sstep(-110, 40, u) + 0.45 * face(u - lw), led);
      const butte = sx > -1000 && sx < -100 && cliff < 1 ? sstep(0.6, 0.7, fbm(x / 420 + W.seed, z / 420)) * sstep(-1000, -250, sx) * (1 - cliff) : 0;
      // Scree apron: concave, runs into the canyon mouths, partly buries the foot of the face
      const ak = sstep(-aw, 40, u), apron = ak > 0 && cliff < 0.45 ? H * 0.4 * Math.pow(ak, 1.8) * (0.85 + 0.15 * fbm(x / 260, z / 260 + W.seed)) : 0;   // (behind the face it is buried anyway)
      const wallH = H * (cliff + 0.85 * butte) * (cliff + butte > 0.01 ? 1 + 0.05 * fbm(x / 600, z / 600) : 1);
      h += Math.max(wallH, apron);
      tal = Math.max(tal, ak * (1 - cliff) * (1 - butte));
    }
    return [h, tal];
  }
  // Craters binned on a 1 km grid (each listed in every cell its reach overlaps), so a point only checks its own cell
  const CB = 1000, CG = 34, cbin = Array.from({ length: CG * CG }, () => []);
  for (const c of craters) { const ext = c[2] * (c[2] > 60 ? 7.5 : 2.2);
    for (let i = Math.max(0, Math.floor((c[0] - ext) / CB) + CG / 2); i <= Math.min(CG - 1, Math.floor((c[0] + ext) / CB) + CG / 2); i++)
      for (let j = Math.max(0, Math.floor((c[1] - ext) / CB) + CG / 2); j <= Math.min(CG - 1, Math.floor((c[1] + ext) / CB) + CG / 2); j++) cbin[j * CG + i].push(c); }
  const NOC = [];
  // Rolling floor: rises, swales, low ridges (km scale) plus mounds 2–5 m and hummocks ~1 m, right up to the pad's edge
  const floorBase = (x, z, nearK, dist) => 16 * fbm(x / 2600, z / 2600) + 26 * fbm(x / 1300 + 4, z / 1300)
    + (nearK ? 9 * Math.pow(ridged(x / 700, z / 1100), 3) + 1.6 * fbm(x / 420, z / 420) + (dist < 3000 ? 0.25 * fbm(x / 22, z / 22) + sstep(3000, 2000, dist) * (5 * fbm(x / 90 + 1.7, z / 90 - 3.3) + 1.6 * fbm(x / 18 + 4, z / 18)) : 0) : 0);
  const FLOOR0 = floorBase(0, 0, true, 0);
  // Sight lines kept open to the pad (low cameras): terrain held a few metres under the line from the camera to the pad's
  // edge, in a strip ~30 m each side; everything outside the strip stays rough. [x, z, camera y] (y set once terrain exists)
  const SIGHT = [];
  // Returns [height, rim brightness, tone offset, dark sand 0..1, talus 0..1]
  function terrain(x, z, raw = false) {
    const dist = Math.hypot(x, z), T = TERRAIN;
    const nearK = dist < 20000;   // fine detail only where it can be seen
    let h = floorBase(x, z, nearK, dist) - FLOOR0 * sstep(1500, 0, dist);   // rolling floor, shifted to meet the pad at 0 (no pit, no pedestal)
    let tone = 0, sand = 0, rimBright = 0, talus = 0;
    // Valley floor relief (none on the base ground): rolling hillocks 15–45 m (with hollows) and coarse 3–5 m ridging, and two low broken ridges running down the
    // valley across the site cameras' line of sight, one between them and the pad, one in front of the east wall's apron
    if (dist > 45 && dist < 9000) {
      const fk = sstep(45, 220, dist) * sstep(9000, 7000, dist);   // from just outside the pad; past ~8 km the haze hides them
      h += fk * (44 * Math.pow(sstep(-0.75, 0.9, fbm(x / 560 + 2.3, z / 560 - 7.1)), 1.5) - 12) + (dist < 5000 ? sstep(40, 90, dist) * sstep(5000, 4000, dist) * (9 * fbm(x / 240 + 5, z / 240) + 6 * Math.pow(ridged(x / 75 + 3.1, z / 75 - 1.3), 2) - 2.5) : 0);   // rolling (no flat gaps), up and down about the pad's level; coarse ridged texture near
      for (const [rx, ra, rh] of T.ridges) {
        const dx = x - (rx + ra * Math.sin(z / 2300 + rx) + 140 * fbm(z / 1500, rx));
        if (Math.abs(dx) < 700) { const brk = sstep(-0.35, 0.15, fbm(z / 700 + rx, 1.9));
          h += fk * rh * brk * (0.6 + 0.4 * fbm(x / 300, z / 300)) * Math.exp(-((dx / (dx < 0 ? 260 : 150)) ** 2)); }   // gentle back slope, steeper front
      }
    }
    { const [wh, wt] = wallAt(x, z); h += wh; talus = wt; tone += 0.04 * wt; }
    // Dry riverbed winding down the valley east of the pad: a sandy bed between low banks
    { const R = T.river, dxr = x - (R[0] + R[1] * Math.sin(z / R[2]) + R[3] * Math.sin(z / R[4] + 1));
      if (Math.abs(dxr) < 300) { h += -9 * Math.exp(-((dxr / 45) ** 2)) + 1.8 * Math.exp(-((dxr / 110) ** 2)); sand = Math.max(sand, 0.85 * Math.exp(-((dxr / 60) ** 2))); } }
    // Dry washes: from the east wall's apron west to the riverbed, winding, with a side branch each; sandy beds
    if (x > 500 && x < 2300 && Math.abs(z) < 4000) for (const [cz, dr, dk] of T.channels) {
      const R = T.river, rx = R[0] + R[1] * Math.sin(z / R[2]) + R[3] * Math.sin(z / R[4] + 1), along = x - rx;
      if (along < -40 || along > 1500) continue;
      const tap = sstep(-40, 60, along) * sstep(1500, 1050, along);
      for (const [oz, k] of [[0, 1], [140 + 90 * dk, 0.6]]) {   // main wash, then a branch that joins it ~400 m up
        const bz = cz + oz * sstep(250, 650, along) + dr * along + 70 * Math.sin(along / 260 + cz) + 40 * fbm(along / 300, cz);
        const dzc = z - bz; if (Math.abs(dzc) > 120) continue;
        const bed = Math.exp(-((dzc / (22 * k + 10)) ** 2)) * tap * (oz ? sstep(250, 450, along) : 1);
        h -= 6 * dk * k * bed - 1.2 * Math.exp(-((dzc / 60) ** 2)) * tap; sand = Math.max(sand, 0.8 * bed);
      }
    }
    // Low rock outcrops on the floor (none near the pad)
    if (dist > 90 && dist < 12000) { const o = sstep(0.68, 0.8, fbm(x / 220 + 9, z / 220 - 4)) * sstep(90, 250, dist); h += 7 * o; tone -= 0.03 * o; }   // (sand/dust patches and streaks: in the ground shader)
    // Out to the horizon: ridged mountain ranges, a field of far mesas (benched), a canyon
    if (dist > 4000) {
      const kf = sstep(5000, 22000, dist);
      const mtn = 1900 * Math.pow(ridged(x / 14000 + 3.1, z / 14000 - 1.7), 2.2) * kf * sstep(16000, 30000, dist);
      const m = fbm(x / 6000 + 11, z / 6000 - 4), mesaF = terrace(520 * sstep(0.18, 0.26, m) * sstep(16000, 24000, dist), 40, 0.35);
      const cy = z - 26000 - 6000 * Math.sin(x / 17000), canyon = -700 * Math.exp(-((cy / 2600) ** 2)) * sstep(9000, 20000, Math.abs(x) + 8000);
      h += mtn + mesaF + canyon + 60 * fbm(x / 900, z / 900) * kf;
      tone += (mtn > 300 ? -0.06 : 0) + (mesaF > 260 ? 0.05 : 0) + (canyon < -200 ? -0.08 : 0);
    }
    // Ranges 10–15 km out that rise over the valley walls' flat top line (ridged, uneven peaks)
    for (const [px, pz, pr, ph] of T.peaks) { const dx = x - px, dz = z - pz; if (Math.abs(dx) > pr || Math.abs(dz) > pr) continue;
      const q = 1 - Math.hypot(dx, dz) / pr - 0.18 * fbm(x / 1600 + px, z / 1600); if (q <= 0) continue;
      h += ph * Math.pow(q, 1.5) * (0.6 + 0.55 * ridged(x / 2200 + px / 1e4, z / 2200)); tone -= 0.03 * q; }
    // Mesas and buttes: warped, embayed outlines, flat tops, cliffs benched in rock bands, rubble aprons; the big ones
    // break up at their edges into detached buttes and pillars
    for (const list of [TERRAIN.mesas, TERRAIN.buttes]) for (const [bx, bz, br, bh] of list) {
      const dx = x - bx, dz = z - bz; if (Math.abs(dx) > br * 1.8 || Math.abs(dz) > br * 1.8) continue;
      const big = br > 1000, bq = Math.hypot(dx, dz) / br + (big ? 0.22 * fbm(x / 1400 + bx, z / 1400) + 0.12 * fbm(x / 380, z / 380 + bz) : 0.3 * fbm(x / 240 + bx, z / 240));
      const k = sstep(1.05, big ? 0.95 : 0.82, bq);
      const edge = big ? sstep(0.8, 1.05, bq) : 1, split = (big || br > 500) ? 1 - 0.8 * edge * sstep(0.32, 0.12, Math.abs(vnoise(x / (big ? 420 : 300) + 1.7, z / (big ? 420 : 300) - 2.3))) : 1;
      const top = bh * k * split * (1 + (big ? 0.04 * fbm(x / 700, z / 700) : 0));
      h += lerp(top, terrace(top, Math.max(13, bh / 14), 0.35), 0.7 * sstep(5000, 2500, dist)) + bh * 0.22 * sstep(1.55, 1.0, bq) * (1 - k); tone += 0.03 * k;   // geometric benches only up close (far away they alias: the strata come from colour)
    }
    // Yardangs: long streamlined ridges lined up with the wind
    { const dx = x - T.yardangs.x, dz = z - T.yardangs.z, yr = Math.hypot(dx, dz) / T.yardangs.r;
      if (yr < 1.1) { const u = dx * WX + dz * WZ, v = dx * WZ - dz * WX, env = sstep(1.1, 0.6, yr);
        const r = 1 - Math.abs(Math.sin(v / 85 + 1.6 * vnoise(u / 700, v / 380))), len = sstep(0.05, 0.5, vnoise(u / 520 + 3, v / 170));
        h += 32 * Math.pow(r, 5) * len * env; tone += 0.04 * Math.pow(r, 5) * len * env; } }
    // Crescent (barchan) dunes of dark basalt sand: gentle upwind slope, steep slip face, horns pointing downwind
    { const dx = x - T.dunes.x, dz = z - T.dunes.z, dr = Math.hypot(dx, dz) / T.dunes.r;
      if (dr < 1.15) { const env = sstep(1.15, 0.7, dr), u = dx * WX + dz * WZ, v = dx * WZ - dz * WX;
        sand = Math.max(sand, 0.55 * env);
        const CU = 430, CV = 320, iu = Math.floor(u / CU), iv = Math.floor(v / CV), r1 = hash(iu, iv), r2 = hash(iu + 17, iv - 3);
        if (r1 < 0.78) { const sc = 0.6 + 0.6 * r2, lu = u - (iu + 0.5) * CU - (r2 - 0.5) * 120, lv = v - (iv + 0.5) * CV - (r1 - 0.5) * 80;
          const W = 120 * sc, Ld = 70 * sc, du = lu - 0.9 * lv * lv / W;
          const prof = du < 0 ? 1 - (du / (Ld * 1.7)) ** 2 : 1 - (du / (Ld * 0.32)) ** 2, across = 1 - (lv / W) ** 2;
          const hd = 19 * sc * Math.max(0, prof) * Math.pow(Math.max(0, across), 0.7) * env;
          h += hd; sand = Math.max(sand, Math.min(1, 0.55 * env + hd / 10)); } } }
    // Craters: bowl, raised rim, debris apron; fresh ones get bright rays, old ones fill with sand; dust streaks downwind
    const ci = Math.floor(x / CB) + CG / 2, cj = Math.floor(z / CB) + CG / 2;
    for (const [ccx, ccz, R, f, sd] of (ci >= 0 && ci < CG && cj >= 0 && cj < CG ? cbin[cj * CG + ci] : NOC)) {
      const dx = x - ccx, dz = z - ccz, big = R > 60, ext = R * (big ? 7.5 : 2.2);
      if (Math.abs(dx) > ext || Math.abs(dz) > ext) continue;
      const cq = Math.hypot(dx, dz) / R;
      if (cq < 1) { h -= 0.18 * f * R * (1 - cq * cq) * (f < 0.55 ? 0.55 : 1); tone -= 0.04 * f * sstep(0.9, 0.4, cq); if (f < 0.55) sand = Math.max(sand, 0.6 * sstep(0.8, 0.3, cq)); }
      const rim = Math.exp(-(((cq - 1) / 0.3) ** 2)); h += 0.06 * f * R * rim; rimBright = Math.max(rimBright, rim * f);
      if (f > 0.85 && cq > 1 && cq < 3.2) { const ray = Math.pow(Math.abs(Math.sin(Math.atan2(dz, dx) * 7 + sd)), 10) * Math.exp(-(cq - 1) / 0.9);
        h += 0.02 * R * Math.exp(-(((cq - 1.3) / 0.6) ** 2)); tone += 0.07 * ray; }
      if (big && cq > 1) { const tu = (dx * WX + dz * WZ) / R, tv = (dx * WZ - dz * WX) / R;
        if (tu > 0.8 && tu < 7) tone += 0.05 * Math.exp(-((tv / 0.8) ** 2)) * (1 - (tu - 0.8) / 6.2) * f; }
    }
    // Open sight lines to the pad, levelled footprints for the base, then only the pad itself is flat
    if (!raw) for (const [cx, cz, cy] of SIGHT) {
      const vx = -cx, vz = -cz, L2 = vx * vx + vz * vz, t = clamp(((x - cx) * vx + (z - cz) * vz) / L2, 0, 1);
      const d = Math.hypot(x - cx - vx * t, z - cz - vz * t), w = sstep(55, 30, d) * sstep(0.02, 0.08, t);
      if (w > 0) { const lim = lerp(cy, 0.5, t) - 2.5; if (h > lim) h -= (h - lim) * w; }
    }
    if (!raw) for (const g of GRADE) { const gd = Math.hypot(x - g.x, z - g.z); if (gd < g.r + 60) h = lerp(h, g.h, sstep(g.r + 60, g.r, gd)); }
    h -= dist * dist / (2 * 3389.5e3);   // the planet's curve
    const flat = sstep(32, 65, dist);   // the pad (25 m) and room for the legs
    return [h * flat, rimBright * flat, tone, sand * flat, talus];
  }
  const heightAt = (x, z) => terrain(x, z)[0];
  {
    // Sight lines: both pad cams (6 m up, on either side of the approach), the tele cam (2 m up) and the site cameras on the
    // west rim (~25 m up). Must match PAD_CAM and TVC_CAM (section: camera).
    const rimX = WALLS[0] ? wz(WALLS[0].e, 350) - 150 : -2000;
    for (const [cx, cz, ch] of [[-82, 98, 6], [-82, -98, 6], [-330, 60, 2], [rimX, 350, 25]]) SIGHT.push([cx, cz, terrain(cx, cz, true)[0] + ch]);
    // Footprints (landing-base.js), each levelled at the ground's mean height there
    for (const [gx, gz, r] of footprints()) { let m = 0; for (let k = 0; k < 9; k++) { const a = k / 9 * 6.283, rr = k ? r * 0.7 : 0; m += terrain(gx + Math.cos(a) * rr, gz + Math.sin(a) * rr)[0]; }
      GRADE.push({ x: gx, z: gz, r, h: m / 9 }); }
    resolvePlan(heightAt);   // the comms mast's rise, its road
  }
  let groundAt = heightAt;   // the drawn ground's height (bilinear on the mesh grid), set once the ground is built
  const groundU = { uGShadow: { value: new THREE.Color() }, uGMid: { value: new THREE.Color() }, uGLit: { value: new THREE.Color() },
    uGHigh: { value: new THREE.Color() }, uGRock: { value: new THREE.Color() }, uSunDir: { value: SUN }, uTime: { value: 0 },
    uBaseMap: { value: null }, uBaseRect: { value: new THREE.Vector2(MAP.min, MAP.size) } };   // the base's ground map (roads, tracks, scour): set once the base is built
  const buildGround = () => {
    const N = 560, geo = new THREE.PlaneGeometry(2, 2, N, N); geo.rotateX(-Math.PI / 2);
    const P = geo.attributes.position, uv = geo.attributes.uv, col = new Float32Array(P.count * 3), N1 = N + 1;
    const warp = u => { const a = Math.abs(u); return Math.sign(u) * (200 * a + 3000 * a * a + 30000 * a ** 3 + 77000 * a ** 8); };   // 0.7 m at the pad, ~50 m at 2 km, ~120 m at 6 km … 110 km out
    const tones = new Float32Array(P.count), sandA = new Float32Array(P.count), talA = new Float32Array(P.count), H = new Float32Array(P.count);
    for (let i = 0; i < P.count; i++) {
      const x = warp(P.getX(i)), z = warp(P.getZ(i)), [h, rim, tone, sand, tal] = terrain(x, z); talA[i] = tal;
      P.setXYZ(i, x, h, z); H[i] = h;
      tones[i] = 0.55 + 0.12 * fbm(x / 500 + 9, z / 500) + 0.3 * rim + 0.18 * fbm(x / 3000, z / 3000) + tone * 3;   // soft dust mottling
      sandA[i] = sand; uv.setXY(i, x / 7, z / 7);
    }
    geo.computeVertexNormals();
    // Baked light: long terrain shadows from the low sun (each vertex looks toward the sun over the height grid for the
    // steepest horizon; soft-edged) and a little darkening in hollows. Free at run time.
    const ws = new Float32Array(N1); for (let i = 0; i < N1; i++) ws[i] = warp(-1 + 2 * i / N);
    const inv = v => { let lo = 0, hi = N; if (v <= ws[0]) return 0; if (v >= ws[N]) return N; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ws[m] <= v) lo = m; else hi = m; } return lo + (v - ws[lo]) / (ws[hi] - ws[lo]); };
    const LUT = 8192, XM = 120000, invT = new Float32Array(LUT + 1); for (let i = 0; i <= LUT; i++) { const v = (i / LUT) ** 2 * XM; invT[i] = inv(v) - N / 2; }
    const gi = v => { const a = Math.abs(v), t = Math.sqrt(Math.min(a, XM) / XM) * LUT, i0 = Math.floor(t), f = t - i0, g = invT[i0] + (invT[Math.min(i0 + 1, LUT)] - invT[i0]) * f; return N / 2 + Math.sign(v) * g; };
    const hAt = (x, z) => { const fx = clamp(gi(x), 0, N - 1e-3), fz = clamp(gi(z), 0, N - 1e-3), ix = fx | 0, iz = fz | 0, tx = fx - ix, tz = fz - iz, o = iz * N1 + ix;
      return (H[o] * (1 - tx) + H[o + 1] * tx) * (1 - tz) + (H[o + N1] * (1 - tx) + H[o + N1 + 1] * tx) * tz; };
    const sl = Math.hypot(SUN.x, SUN.z), sx = SUN.x / sl, sz = SUN.z / sl, tanE = SUN.y / sl, shade = new Float32Array(P.count);
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), z = P.getZ(i), h0 = H[i] + 0.5; let m = -1;
      for (let k = 0, d = 4; k < 44 && d < 40000; k++, d *= 1.23) { const s = (hAt(x + sx * d, z + sz * d) - h0) / d + d / (2 * 3389.5e3); if (s > m) m = s; }
      const lit = 1 - sstep(-0.025, 0.035, m - tanE);
      const ix = i % N1, iz = (i / N1) | 0, a = Math.max(ix - 3, 0), b = Math.min(ix + 3, N), c = Math.max(iz - 3, 0), e = Math.min(iz + 3, N);
      const span = Math.max(1, (Math.abs(ws[b] - ws[a]) + Math.abs(ws[e] - ws[c])) / 2);
      const conc = ((H[iz * N1 + a] + H[iz * N1 + b] + H[c * N1 + ix] + H[e * N1 + ix]) / 4 - H[i]) / span;
      shade[i] = lit; col[i * 3 + 1] = clamp(1 - 1.8 * Math.max(0, conc), 0.55, 1);   // AO parked in col.g until packed below
    }
    // Vertex colour carries palette coordinates, not colours: r = lightness, g = slope (steep = rock), b = distance.
    const N_ = geo.attributes.normal, ao = new Float32Array(P.count);
    for (let i = 0; i < P.count; i++) {
      ao[i] = col[i * 3 + 1]; const d = Math.hypot(P.getX(i), P.getZ(i));
      col.set([clamp(tones[i], 0, 1), clamp((1 - N_.getY(i)) * 4, 0, 1), sstep(2000, 30000, d)], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const extra = new Float32Array(P.count * 4); for (let i = 0; i < P.count; i++) extra.set([sandA[i], shade[i], ao[i], talA[i]], i * 4);
    geo.setAttribute('aG', new THREE.BufferAttribute(extra, 4));   // x: dark sand, y: sun (baked terrain shadow), z: hollow darkening, w: talus (boulder fields)
    groundAt = (x, z) => hAt(x, z) - 0.05;
    return geo;
  };
  {
    const geo = buildGround();
    // Fine relief: a bump of plain noise (no blobs, so the 7 m tile doesn't show); colour detail is procedural in the shader
    const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
    const img = g.createImageData(512, 512);
    for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
      const tx = x / 512 * Math.PI * 2, ty = y / 512 * Math.PI * 2;   // tileable: sample on a torus
      const v = 128 + 60 * (0.55 * fbm(Math.cos(tx) * 3 + 9, Math.sin(tx) * 3 + Math.cos(ty) * 2) + 0.45 * fbm(Math.sin(ty) * 9, Math.cos(tx) * 9 + 4)) + 10 * (Math.random() - 0.5), o = (y * 512 + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = clamp(v, 0, 255); img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const bump = new THREE.CanvasTexture(c); bump.wrapS = bump.wrapT = THREE.RepeatWrapping; bump.anisotropy = 8;
    const gMat = new THREE.MeshStandardMaterial({ vertexColors: true, bumpMap: bump, bumpScale: 2.2, roughness: 1, metalness: 0 });
    gMat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, groundU);
      sh.vertexShader = 'attribute vec4 aG; varying vec3 vGW; varying vec4 vAG;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vGW = (modelMatrix * vec4(position, 1.0)).xyz; vAG = aG;');
      sh.fragmentShader = `uniform vec3 uGShadow, uGMid, uGLit, uGHigh, uGRock, uSunDir; uniform float uTime; uniform sampler2D uBaseMap; uniform vec2 uBaseRect; varying vec3 vGW; varying vec4 vAG;
        float gh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float gn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(gh(i), gh(i + vec2(1, 0)), f.x), mix(gh(i + vec2(0, 1)), gh(i + vec2(1, 1)), f.x), f.y); }
        float gf(vec2 p){ return 0.5 * gn(p) + 0.25 * gn(p * 2.03) + 0.125 * gn(p * 4.1) + 0.125 * gn(p * 8.3); }\n` + sh.fragmentShader
        .replace('#include <color_fragment>', `
          float t = vColor.r, sl = vColor.g, far = vColor.b; vec2 w = vGW.xz; float camD = distance(cameraPosition, vGW);
          // Three ground types: bright ochre dust (flat), dark basalt sand (dunes, hollows, channels), tan layered rock (slopes)
          vec3 base = mix(uGShadow, uGMid, smoothstep(0.0, 0.42, t));
          base = mix(base, uGLit, smoothstep(0.42, 0.82, t));
          base = mix(base, uGHigh, smoothstep(0.86, 1.0, t) * 0.55);
          float camD0 = distance(cameraPosition, vGW);
          float fp = length(fwidth(w));   // metres of ground per pixel: detail finer than this is faded to its mean (no moiré)
          // Rock strata: layers ~14 m thick inside ~40 m formations, each its own shade (pale caprock, dark seams), warped and
          // gently tilted so they wander across the cliffs; averaged out once a pixel spans a layer (no stripes far away)
          float sy = vGW.y + 22.0 * gf(w / 700.0) + 0.004 * dot(w, vec2(0.7, 0.3)), fwY = fwidth(sy);
          float li = floor(sy / 14.0), lf = fract(sy / 14.0), soft = 0.06 + fwY / 14.0;
          float lay = mix(gh(vec2(li - 1.0, 3.7)), gh(vec2(li, 3.7)), smoothstep(0.0, soft, lf));
          float fi = floor(sy / 41.0), form = mix(gh(vec2(fi - 1.0, 8.3)), gh(vec2(fi, 8.3)), smoothstep(0.0, 0.04 + fwY / 41.0, fract(sy / 41.0)));
          float seam = step(0.72, gh(vec2(li, 9.1))) * (1.0 - smoothstep(0.0, 0.1 + soft, lf));   // thin dark seam at some layer bases
          float band = 0.5 * form + 0.4 * lay + 0.1 * gf(w / 300.0) - 0.35 * seam;
          band = mix(band, 0.5, smoothstep(0.35, 1.0, fwY / 14.0) * 0.6);
          band = mix(band, 0.5, smoothstep(0.35, 1.0, fwY / 41.0));
          float fine = 0.5 - 0.5 * sin(sy / 2.7 + 1.3);   // fine bedding, up close only
          band *= 1.0 - 0.2 * fine * (1.0 - smoothstep(0.15, 0.6, fwidth(sy / 2.7)));
          float hzBump = 1.0 - smoothstep(0.3, 1.2, fp);
          vec3 rock = mix(mix(uGRock, uGMid, 0.55) * 1.3, mix(uGMid, uGHigh, 0.5) * 0.95, 0.2 + 0.55 * clamp(band, 0.0, 1.0));
          base = mix(base, rock, smoothstep(0.3, 0.75, sl) * 0.75);
          vec3 sandC = mix(uGRock, uGShadow, 0.4) * 1.35 * vec3(0.92, 0.95, 1.05);
          // Big patches that read from height: dark sand sheets, bright dust, wind streaks
          float sandP = max(vAG.x, 0.45 * smoothstep(0.5, 0.68, gf(w / 1700.0 + vec2(2.0, -6.0))));
          base *= 1.0 + 0.16 * smoothstep(0.45, 0.7, gf(w / 2200.0 + vec2(-3.0, 5.0))) * (1.0 - sandP);
          vec2 wuv = vec2(dot(w, vec2(0.6, 0.8)) / 5000.0, dot(w, vec2(0.8, -0.6)) / 500.0);
          base *= 1.0 + 0.12 * smoothstep(0.62, 0.82, gf(wuv + 1.0));
          base = mix(base, sandC, clamp(sandP, 0.0, 1.0) * (1.0 - smoothstep(0.35, 0.7, sl)) * 0.85);
          base *= 0.86 + 0.28 * gf(w / 2500.0 + 7.0);                                           // broad tone variation
          // Near the camera: 2 m and 25 cm mottling, pebbles, sand ripples in the low sandy spots (fade with distance)
          float nk = (1.0 - smoothstep(60.0, 1600.0, camD)) * (1.0 - smoothstep(0.5, 2.0, fp)), fk = (1.0 - smoothstep(8.0, 160.0, camD)) * (1.0 - smoothstep(0.06, 0.25, fp));
          base *= mix(1.0, 0.84 + 0.32 * gf(w / 2.0), nk) * mix(1.0, 0.88 + 0.24 * gn(w / 0.25), fk);
          base *= mix(1.0, 0.62, smoothstep(0.83, 0.9, gn(w / 0.35 + 3.0)) * fk * (1.0 - vAG.x));      // pebbles
          float rip = sin(dot(w, vec2(0.8, -0.6)) / 0.55 + 3.0 * gn(w / 6.0));   // crests across the wind
          base *= 1.0 + 0.07 * rip * (1.0 - smoothstep(0.8, 2.5, fp)) * (1.0 - smoothstep(8.0, 160.0, camD)) * clamp(vAG.x * 1.6 - 0.1, 0.0, 1.0);   // only where there is loose sand
          // The base's ground map: graded roads and aprons (lighter, smoother), rover tracks and contact shade (darker), blast scour (dark grit)
          { vec2 bu = (w - uBaseRect.x) / uBaseRect.y;
            if (bu.x > 0.0 && bu.x < 1.0 && bu.y > 0.0 && bu.y < 1.0) { vec3 bm = texture2D(uBaseMap, bu).rgb;
              base = mix(base, mix(uGLit, uGHigh, 0.35) * (0.92 + 0.1 * gn(w / 1.3)), bm.r * 0.62);
              base = mix(base, mix(uGRock, uGShadow, 0.5) * 1.6, bm.b * 0.55);
              base *= 1.0 - 0.5 * bm.g; } }
          // Boulder fields at the foot of the cliffs: dark speckle that reads from afar (real rocks up close)
          base *= 1.0 - 0.38 * vAG.w * mix(smoothstep(0.55, 0.75, gn(w / 7.0)), 0.3, smoothstep(2.0, 7.0, fp)) - 0.12 * vAG.w;
          // Baked light: terrain shadow on the sun term, hollows a little darker; drifting cloud shadows
          float sunL = mix(0.42, 1.0, vAG.y) * vAG.z;
          float cs = smoothstep(0.56, 0.78, gf((w + uTime * vec2(7.0, 5.0)) / 2800.0));
          diffuseColor.rgb *= base * sunL * (1.0 - 0.17 * cs);`)
        .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace('dHdxy_fwd()', '(dHdxy_fwd() * hzBump)'));
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
  // The hole the ship punches in the overcast (its breakout point; radius): cleared, its edge a little brighter
  const holeU = { value: new THREE.Vector3(0, 0, 0) };
  const deckHole = (x, z) => holeU.value.set(x, z, 900);
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
    m.position.set(x, y, z); m.scale.setScalar(size); m.renderOrder = 3; m.userData.op = op; scene.add(m); wisps.push(m);
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
  cloudMeshes[0][0].material.onBeforeCompile = sh => {
    sh.uniforms.uHole = holeU;
    sh.vertexShader = 'varying vec3 vHW;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vHW = (modelMatrix * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = 'uniform vec3 uHole; varying vec3 vHW;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      if (uHole.z > 0.0) { float hd = distance(vHW.xz, uHole.xy) / uHole.z; diffuseColor.a *= smoothstep(0.55, 1.15, hd); diffuseColor.rgb *= 1.0 + 0.5 * exp(-pow((hd - 1.05) / 0.25, 2.0)); }`);
  };
  // The tracking camera's neighbour: a thin instrument mast, near and out of focus at the start of the belly-flop hunt
  const trkMast = (() => { const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 0.8, metalness: 0.4 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 26, 8), m); pole.position.y = 13; g.add(pole);
    for (const [y, w] of [[18, 3.2], [24, 2.2]]) { const b = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, 0.12), m); b.position.y = y; g.add(b); }
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.9, 0.5), m); box.position.set(0.4, 21, 0); g.add(box);
    const ws = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.6, 10, 1, true), new THREE.MeshStandardMaterial({ color: 0xc8642a, roughness: 0.9, side: THREE.DoubleSide }));
    ws.rotation.z = Math.PI / 2; ws.position.set(1.2, 25.4, 0); g.add(ws);
    g.visible = false; scene.add(g); if (/[?&]debug/.test(location.search)) window.__mast = g; return g; })();
  // Sun lens flare (landing-look.js), parked far along the sun direction each frame
  const flare = createFlare(); scene.add(flare.lf);

  // Rocks (section 13): six shapes (angular dark basalt, flat layered slabs), partly buried, sized on a power law,
  // clustered on crater rims and aprons near the site, sparse on the open plain, none on the pad or graded ground
  const rocks = [];
  {
    const rockMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, flatShading: true });
    rockMat.onBeforeCompile = sh => { Object.assign(sh.uniforms, { uGRock: groundU.uGRock, uGMid: groundU.uGMid });
      sh.fragmentShader = 'uniform vec3 uGRock, uGMid;\n' + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= mix(uGRock, uGMid, 0.35) * 1.1;'); };
    let seed = 3; const r01 = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const shapes = [];
    for (let v = 0; v < 3; v++) {   // basalt: lumpy, angular
      const g = new THREE.IcosahedronGeometry(1, v === 2 ? 0 : 1), P = g.attributes.position;
      for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = P.getY(i), z = P.getZ(i), k = 0.68 + 0.5 * vnoise(x * 2.3 + v * 7, z * 2.3 + y * 1.9);
        P.setXYZ(i, x * k, y * k * (0.55 + 0.12 * v), z * k * (0.85 + 0.2 * v)); }
      g.computeVertexNormals(); shapes.push([g, 'basalt']);
    }
    for (let v = 0; v < 3; v++) {   // slabs: flat, layered, broken edges
      const g = new THREE.BoxGeometry(1.7, 0.42 + 0.12 * v, 1.1 + 0.3 * v, 3, 2, 3), P = g.attributes.position;
      for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = P.getY(i), z = P.getZ(i), k = 1 + 0.18 * vnoise(x * 3 + v * 5, z * 3 - v);
        P.setXYZ(i, x * k, y + 0.08 * vnoise(x * 4 + 2, z * 4), z * k); }
      g.computeVertexNormals(); shapes.push([g, 'slab']);
    }
    const pts = [];   // [x, z, size]
    const ok = (x, z) => Math.hypot(x, z) > L.PAD_R + 12 && !GRADE.some(g => Math.hypot(x - g.x, z - g.z) < g.r + 4) && !onBase(x, z);
    for (const [cx, cz, R, f] of craters) {   // rim and apron clusters (the nearer craters)
      const d = Math.hypot(cx, cz); if (d > 1800 || R < 3) continue;
      const n = Math.min(90, Math.round(R * 2.2 * f));
      for (let i = 0; i < n; i++) { const a = r01() * 6.28, rr = R * (0.85 + Math.pow(r01(), 1.6) * 1.6); pts.push([cx + Math.cos(a) * rr, cz + Math.sin(a) * rr, (0.2 + Math.pow(r01(), 2.6) * 1.6) * Math.min(1.6, 0.5 + R / 25)]); }
    }
    for (let i = 0, n = 0; i < 40000 && n < 3600; i++) {   // boulder fields at the foot of the valley walls (fallen from the cliffs)
      const x = (r01() < 0.5 ? -1 : 1) * (1300 + r01() * 1500), z = (r01() - 0.5) * 9000, t = wallAt(x, z)[1];
      if (t > 0.3 && r01() < t) { pts.push([x, z, 0.4 + Math.pow(r01(), 2.2) * 4.5]); n++; } }
    while (pts.length < 14600) {   // the open floor: sparse, a few big ones
      const a = r01() * 6.28, d = L.PAD_R + 12 + Math.pow(r01(), 1.7) * 1600, big = r01() < 0.03;
      pts.push([Math.cos(a) * d, Math.sin(a) * d, big ? 2 + r01() * 3.5 : 0.18 + Math.pow(r01(), 2.4) * 1.8]);
    }
    const per = Math.ceil(pts.length / shapes.length), o = new THREE.Object3D(), col = new THREE.Color();
    shapes.forEach(([g, kind], si) => {
      const m = new THREE.InstancedMesh(g, rockMat, per); m.castShadow = m.receiveShadow = true; m.frustumCulled = false;
      let n = 0;
      for (let i = si; i < pts.length; i += shapes.length) { const [x, z, sz] = pts[i]; if (!ok(x, z)) continue;
        o.position.set(x, heightAt(x, z) - sz * (0.22 + 0.28 * r01()), z);   // partly buried
        o.rotation.set((r01() - 0.5) * (kind === 'slab' ? 0.3 : 0.7), r01() * 6.28, (r01() - 0.5) * (kind === 'slab' ? 0.3 : 0.7));
        o.scale.set(sz * (0.8 + r01() * 0.6), sz * (0.6 + r01() * 0.6), sz * (0.8 + r01() * 0.6)); o.updateMatrix(); m.setMatrixAt(n, o.matrix);
        const f = kind === 'basalt' ? 0.55 + 0.2 * r01() : 1.15 + 0.25 * r01(); m.setColorAt(n, col.setRGB(f, f * (kind === 'slab' ? 0.95 : 0.98), f * (kind === 'slab' ? 0.86 : 0.97)));
        n++; }
      m.userData.n = n; m.count = n; scene.add(m); rocks.push(m);
    });
  }
  const setRockDensity = k => rocks.forEach(m => { m.count = Math.round(m.userData.n * k); });
  // Dust devils (section 13): two thin swirling columns far out on the plain, drifting downwind
  const devils = [];
  { const mat = () => new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { uT: { value: 0 }, uC: { value: new THREE.Color(0.85, 0.6, 0.42) } },
      vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float uT; uniform vec3 uC; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5); }
        float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
        void main(){ float y = vUv.y, sw = n(vec2(vUv.x * 12.0 + y * 6.0 - uT * 1.8, y * 9.0 - uT * 0.6)) * 0.7 + n(vec2(vUv.x * 30.0 - uT * 3.0, y * 20.0)) * 0.3;
          float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.5);
          float a = edge * (0.25 + 0.75 * sw) * smoothstep(1.0, 0.3, y) * smoothstep(0.0, 0.04, y) * 0.3;
          gl_FragColor = vec4(uC * (0.85 + 0.3 * y), a); }` });
    const geo = new THREE.CylinderGeometry(55, 9, 1, 24, 8, true).translate(0, 0.5, 0);
    for (const [x, z, H] of [[4600, 2700, 700], [-1600, -3900, 480]]) { const m = new THREE.Mesh(geo, mat()); m.scale.y = H; m.position.set(x, heightAt(x, z), z);
      m.userData = { x0: x, z0: z, ph: Math.random() * 6 }; m.renderOrder = 4; scene.add(m); devils.push(m); }
  }

  // Landing pad: a painted disc, edge lights
  const PAD = new THREE.Group(); scene.add(PAD);
  {
    const tex = padTexture(THREE, 'LZ-1');
    if (false) {
    for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '60,30,15' : '255,255,255'},${Math.random() * 0.07})`; g.fillRect(Math.random() * 512, Math.random() * 512, 3, 3); }
    g.strokeStyle = '#ecebe6'; g.lineWidth = 14; g.beginPath(); g.arc(256, 256, 226, 0, 7); g.stroke();
    g.lineWidth = 6; g.beginPath(); g.arc(256, 256, 120, 0, 7); g.stroke();
    g.lineWidth = 18; g.beginPath(); g.moveTo(170, 170); g.lineTo(342, 342); g.moveTo(342, 170); g.lineTo(170, 342); g.stroke();
    g.fillStyle = '#f5a623'; for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; g.fillRect(256 + Math.cos(a) * 196 - 7, 256 + Math.sin(a) * 196 - 7, 14, 14); }
    }
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
  const R = L.SHIP.D / 2, LEN = L.SHIP.L, BARREL = 33;    // body radius, length, where the nose starts (m from the tail)
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
  // Body profile (section 3 model): the barrel with the aft skirt hanging 1 m below the engine plane, then a tangent ogive
  // (17 m) cut where it narrows to ~1.1 m and closed with a flat elliptical cap: the blunt tiled tip
  const SKIRT = 1.0, NOSE_L = LEN - BARREL;
  const prof = [];
  for (let i = 0; i <= 18; i++) prof.push(new THREE.Vector2(R, -SKIRT + (BARREL + SKIRT) * i / 18));
  const RHO = (R * R + NOSE_L * NOSE_L) / (2 * R);
  const noseR = y => y <= BARREL ? R : Math.max(0, Math.sqrt(Math.max(0, RHO * RHO - (y - BARREL) ** 2)) + R - RHO);   // radius at height y
  { let yc = BARREL;
    for (let i = 1; i <= 24; i++) { const y = BARREL + (NOSE_L - 0.7) * i / 24, r = noseR(y); prof.push(new THREE.Vector2(r, y)); yc = y; if (r < 1.1) break; }
    const rc = prof[prof.length - 1].x, hc = LEN - yc;
    for (let i = 1; i <= 6; i++) { const a = i / 6 * Math.PI / 2; prof.push(new THREE.Vector2(Math.max(rc * Math.cos(a), 0.02), yc + hc * Math.sin(a))); } }
  const vByY = (g, k = 1) => { const p = g.attributes.position, uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, (p.getY(i) + SKIRT) / (LEN + SKIRT) * k); return g; };
  const scaleUV = (g, su, sv) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv); return g; };
  // Tiles: the windward half and ~9° further round each side, the edge ragged (alpha steps per tile row); the steel runs
  // under that ragged band so it shows through the gaps
  const SH0 = -0.15, SHL = Math.PI + 0.3, EDGE = 0.12;
  M.shield = M.tiles.clone(); M.shield.emissive = M.tiles.emissive;
  M.shield.alphaMap = (() => { const W = 512, H = 128, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.fillStyle = '#000'; const e = EDGE / SHL * W;
    for (let r = 0; r < H; r++) { g.fillRect(0, r, Math.round(Math.random() * e), 1); const b = Math.round(Math.random() * e); g.fillRect(W - b, r, b, 1); }
    return new THREE.CanvasTexture(c); })();
  M.shield.alphaTest = 0.5;
  M.tilesS = M.tiles.clone(); M.tilesS.emissive = M.tiles.emissive; M.tilesS.side = THREE.DoubleSide;   // tiles on small parts: uv in metres
  M.tilesS.map = M.tiles.map.clone(); M.tilesS.map.repeat.set(0.42, 0.42); M.tilesS.map.needsUpdate = true;
  const TILE_MATS = [M.tiles, M.shield, M.tilesS];
  const body = new THREE.Mesh(vByY(new THREE.LatheGeometry(prof, 96, Math.PI + 0.03, Math.PI - 0.06)), M.steel);   // leeward steel
  const shield = new THREE.Mesh(vByY(new THREE.LatheGeometry(prof.map(p => new THREE.Vector2(p.x + 0.04, p.y)), 96, SH0, SHL)), M.shield);
  const tipGeo = new THREE.LatheGeometry(prof.filter(p => p.y >= LEN - 2.6).map(p => new THREE.Vector2(p.x + 0.045, p.y)), 48);
  const tip = new THREE.Mesh(scaleUV(tipGeo, 9, 2.6), M.tilesS);                                                    // the tiled tip, all round
  const base = new THREE.Mesh(new THREE.CircleGeometry(R - 0.02, 48), M.dark); base.rotation.x = Math.PI / 2; base.position.y = 0.6;   // aft heat shield
  [body, shield, tip].forEach(m => { m.castShadow = true; m.receiveShadow = true; airframe.add(m); });
  airframe.add(base);
  // Flaps: hinged along the body on the leeward side of the beam (forward ~108°, aft ~100° from the belly), the panel sticking
  // out; tiles on the windward face, a fairing over each hinge. Forward: small and swept, the root following the nose.
  function flapGeo(pts, depth = 0.35) {
    const sh = new THREE.Shape(); sh.moveTo(pts[0][0], pts[0][1]); pts.slice(1).forEach(p => sh.lineTo(p[0], p[1])); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false }); g.translate(0, 0, -depth / 2); return { g, sh };
  }
  const flaps = [];
  for (const [side, fwd] of [[1, true], [-1, true], [1, false], [-1, false]]) {
    const phi = side * (fwd ? 108 : 100) * DEG, y0 = fwd ? BARREL + 1 : 1.0, y1 = fwd ? BARREL + 8.5 : 14;
    const Rh = noseR(y0) - 0.05, ax = noseR(y0) - Rh, bx = noseR(y1) - Rh;
    const pts = fwd ? [[ax, y0], [bx, y1], [bx + 1.1, y1 - 0.5], [bx + 2.6, y1 - 2.6], [ax + 3.7, y0 + 1.7], [ax + 3.5, y0 + 0.4], [ax + 2.8, y0 - 0.2]]
      : [[0, y0], [0, y1], [1.5, y1 - 0.4], [3.6, y1 - 1.8], [5.5, y1 - 4.2], [6.5, y1 - 6.5], [6.8, y1 - 9.2], [6.5, 1.4], [5.6, 0.5], [3, 0.4]];
    const hinge = new THREE.Group(); hinge.position.set(Math.cos(phi) * Rh, 0, Math.sin(phi) * Rh); hinge.rotation.y = -phi;
    const { g, sh } = flapGeo(pts);
    const m = new THREE.Mesh(g, M.flap); m.castShadow = true;
    const plate = new THREE.Mesh(new THREE.ShapeGeometry(sh), M.tilesS); plate.position.z = -side * 0.19;   // windward face
    const pivot = new THREE.Group(); pivot.add(m, plate); hinge.add(pivot);
    const len = Math.hypot(bx - ax, y1 - y0), fair = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, len, 10), M.steel);
    fair.position.set((ax + bx) / 2, (y0 + y1) / 2, 0); fair.rotation.z = Math.asin(-(bx - ax) / len); fair.castShadow = true; hinge.add(fair);
    airframe.add(hinge);
    flaps.push({ pivot, side, fwd });
  }
  // Flap deflection (rad, + = toward the belly), about each flap's hinge line (the body's long axis)
  function setFlaps(fwd, aft) { for (const f of flaps) f.pivot.rotation.y = f.side * (f.fwd ? fwd : aft); }
  // Details (dropped on Quality Low): cable raceway down the leeward side, chines along the aft flaps' line, two chopstick
  // catch pins under the forward flaps, the payload door outline
  const details = new THREE.Group(); airframe.add(details);
  const atAz = (o, az, r, y) => { const g = new THREE.Group(); g.position.set(Math.cos(az) * r, y, Math.sin(az) * r); g.rotation.y = -az; g.add(o); details.add(g); return g; };
  { const race = new THREE.Mesh(new THREE.BoxGeometry(0.3, BARREL - 1.5, 0.6), M.steel); race.castShadow = true; atAz(race, Math.PI, R + 0.1, (BARREL - 1.5) / 2 + 0.5);
    for (const sd of [1, -1]) {
      const ch = new THREE.Mesh(new THREE.BoxGeometry(0.7, 15, 0.22), M.dark); ch.castShadow = true; atAz(ch, sd * 100 * DEG, R + 0.3, 22.5);
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.34, 1.0, 10), M.dark); pin.rotation.z = -Math.PI / 2; pin.castShadow = true;
      atAz(pin, sd * 122 * DEG, R + 0.45, BARREL - 2.2);
    }
    const dc = document.createElement('canvas'); dc.width = 128; dc.height = 256; const g = dc.getContext('2d');
    g.strokeStyle = 'rgba(28,28,32,0.85)'; g.lineWidth = 3; g.strokeRect(6, 6, 116, 244); g.fillStyle = 'rgba(28,28,32,0.6)'; g.fillRect(8, 30, 112, 2);
    const door = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.02, R + 0.02, 9, 12, 1, true, 1.5 * Math.PI - 0.38, 0.76),
      new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(dc), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, roughness: 0.6, metalness: 0.5 }));
    door.position.y = 25; details.add(door); }
  // Engines: three gimballed sea-level bells in the middle (on the TVC gimbal) and three vacuum bells set up into the skirt
  M.engine.side = THREE.FrontSide;
  const bellIn = new THREE.MeshStandardMaterial({ color: 0x17130f, metalness: 0.6, roughness: 0.7, side: THREE.BackSide });   // sooty inside
  function bell(r0, r1, h, inner = true) {
    const g = new THREE.Group(), geo = new THREE.CylinderGeometry(r0, r1, h, 28, 1, true);
    const b = new THREE.Mesh(geo, M.engine); b.position.y = -h / 2; b.castShadow = true;
    const p = new THREE.Mesh(new THREE.CylinderGeometry(r0 * 0.8, r0, 0.8, 16), M.dark); p.position.y = 0.3;
    g.add(b, p);
    if (inner) { const i = new THREE.Mesh(geo, bellIn); i.position.y = -h / 2; g.add(i); }
    return g;
  }
  const cbells = [];
  for (let i = 0; i < 3; i++) { const a = (90 + 120 * i) * DEG, e = bell(0.42, 0.7, BELL); e.position.set(Math.cos(a) * 1.0, 0, Math.sin(a) * 1.0); tvc.add(e); cbells.push(e); }
  // Vacuum engines (the deorbit burn): their bells glow orange as they heat and cool after shutdown
  const rvacMat = new THREE.MeshStandardMaterial({ color: 0x55575e, metalness: 0.9, roughness: 0.3, side: THREE.DoubleSide, emissive: new THREE.Color(1, 0.32, 0.08), emissiveIntensity: 0 });
  const rvacs = [];
  for (let i = 0; i < 3; i++) {
    const a = (30 + 120 * i) * DEG, e = bell(0.55, 1.15, 3.4, false); e.children[0].material = rvacMat;
    e.position.set(Math.cos(a) * 2.9, 1.9, Math.sin(a) * 2.9); airframe.add(e); rvacs.push(e);
  }
  // Soot on the aft end (builds through the landing burn) and frost where the tanks' last propellant sits (the webcast look)
  const shellMat = (color, alpha) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, transparent: true, opacity: 0, alphaMap: alpha, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
  const grad = (frost) => { const c = document.createElement('canvas'); c.width = 256; c.height = 128; const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, '#000'); gr.addColorStop(frost ? 0.25 : 0.1, frost ? '#bbb' : '#000'); gr.addColorStop(1, '#fff');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 128);
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${Math.random() * 0.35})`; g.fillRect(Math.random() * 256, Math.random() * 128, 2 + Math.random() * (frost ? 6 : 14), 1 + Math.random() * 4); }
    const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.repeat.set(frost ? 3 : 2, 1); return t; };
  const soot = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.06, R + 0.06, 6, 64, 1, true), shellMat(0x0d0b0a, grad(false)));
  soot.position.y = -SKIRT + 3; airframe.add(soot);
  const frostMat = shellMat(0xeef3f8, grad(true)), frost = [[1.2, 5.5], [16, 19.5]].map(([a, b]) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.055, R + 0.055, b - a, 48, 1, true, Math.PI + 0.15, Math.PI - 0.3), frostMat);
    m.position.y = (a + b) / 2; airframe.add(m); return m; });
  function shipFx(sootK, frostK) { soot.material.opacity = sootK; frostMat.opacity = frostK; soot.visible = sootK > 0.01; frost.forEach(m => { m.visible = frostK > 0.01; }); }
  shipFx(0, 0);

  // Landing legs (section 3 model): four bays built into the aft skirt on the diagonals. Stowed, each is a fairing door
  // flush with the hull (tiled on the windward side); deployed, the door rides on the leg: an outer tube from a hinge at the
  // top of the bay with a chrome piston that telescopes out (the shock absorber), an A-frame of side braces to the hull,
  // a folding knee brace that snaps straight at the lock, and a dished pad on a ball joint that stays level.
  const LG = { HT: 9.0, RH: R - 0.5, OT: 7.0, PL: 8.8, LS: 7.8, PADH: 0.6, open: 36, DOOR: 6.6 };
  LG.LL = (3.6 + LG.HT - LG.PADH) / Math.cos(LG.open * DEG); LG.EXT = LG.LL - LG.LS;
  const FOOT = LG.LL * Math.cos(LG.open * DEG) + LG.PADH - LG.HT;      // deployed pads reach FOOT below the tail (3.6 m)
  const FOOT_R = LG.RH + LG.LL * Math.sin(LG.open * DEG);
  M.legS = new THREE.MeshStandardMaterial({ color: 0xb4b1aa, metalness: 0.75, roughness: 0.35 });
  M.chrome = new THREE.MeshStandardMaterial({ color: 0xe6eaef, metalness: 1, roughness: 0.12 });
  M.pad = new THREE.MeshStandardMaterial({ color: 0x2b2825, metalness: 0.35, roughness: 0.75 });
  const LGEO = {
    outer: new THREE.CylinderGeometry(0.3, 0.34, LG.OT, 12).translate(0, -LG.OT / 2, 0),
    pist: new THREE.CylinderGeometry(0.19, 0.19, LG.PL, 10).translate(0, LG.PL / 2, 0),
    collar: new THREE.CylinderGeometry(0.42, 0.42, 0.35, 12).translate(0, -LG.OT, 0),
    ball: new THREE.SphereGeometry(0.3, 12, 8),
    pad: new THREE.LatheGeometry([[0.02, -0.14], [0.9, -0.14], [1.05, -0.06], [1.08, 0.04], [0.85, 0.12], [0.3, 0.2], [0.02, 0.22]].map(p => new THREE.Vector2(...p)), 28),
    seg: new THREE.CylinderGeometry(0.11, 0.11, 1, 8).translate(0, 0.5, 0),
    knee: new THREE.SphereGeometry(0.2, 8, 6),
    door: scaleUV(new THREE.BoxGeometry(0.16, LG.DOOR, 1.5), 1.5, LG.DOOR),
    recess: new THREE.BoxGeometry(0.04, LG.DOOR, 1.4),
    hingeBox: new THREE.BoxGeometry(0.7, 0.6, 1.1),
  };
  const legDetail = [];
  function makeLeg(az, parent) {
    const hinge = new THREE.Group(); hinge.position.set(Math.cos(az) * LG.RH, LG.HT, Math.sin(az) * LG.RH); hinge.rotation.y = -az;
    const pivot = new THREE.Group(); hinge.add(pivot);
    const mk = (geo, mat, p = pivot) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; p.add(m); return m; };
    mk(LGEO.outer, M.legS); mk(LGEO.collar, M.dark);
    const door = mk(LGEO.door, Math.cos(az) > 0 ? M.tilesS : M.steel); door.position.set(R - LG.RH + 0.02, -LG.DOOR / 2 - 0.2, 0);
    const pg = new THREE.Group(); pivot.add(pg);
    mk(LGEO.pist, M.chrome, pg); mk(LGEO.ball, M.dark, pg);
    const padG = new THREE.Group(); pg.add(padG); const pad = mk(LGEO.pad, M.pad, padG); pad.position.y = -(LG.PADH - 0.14);
    const recess = mk(LGEO.recess, M.dark, hinge); recess.position.set(R - LG.RH + 0.03, -LG.DOOR / 2 - 0.2, 0); recess.visible = false;
    mk(LGEO.hingeBox, M.dark, hinge).position.set(0.15, 0, 0);
    const sideA = [mk(LGEO.seg, M.legS, hinge), mk(LGEO.seg, M.legS, hinge)], kneeA = mk(LGEO.seg, M.legS, hinge), kneeB = mk(LGEO.seg, M.legS, hinge), knee = mk(LGEO.knee, M.dark, hinge);
    legDetail.push(...sideA);
    parent.add(hinge);
    const L = { hinge, pivot, pg, padG, recess, sideA, kneeA, kneeB, knee };
    pivot.userData.leg = L; return L;
  }
  const _lgY = new THREE.Vector3(0, 1, 0), _lgA = new THREE.Vector3(), _lgB = new THREE.Vector3(), _lgD = new THREE.Vector3(), _lgM = new THREE.Vector3();
  function legSeg(m, a, b) { _lgD.subVectors(b, a); const l = _lgD.length(); m.position.copy(a); m.quaternion.setFromUnitVectors(_lgY, _lgD.divideScalar(l || 1)); m.scale.set(1, l, 1); }
  const KB = new THREE.Vector3(0.1, 0.9 - LG.HT, 0), KS = 3.0, KA = (() => { const s = Math.sin(LG.open * DEG), c = Math.cos(LG.open * DEG);
    return Math.hypot(KS * s - KB.x, -KS * c - KB.y) / 2; })();   // knee brace half length: straight exactly at the lock
  function poseLeg(L, th, ext, k, bk) {   // th: deg out from stowed, ext: piston out (m), k: deploy 0..1, bk: buckle 0..1
    const s = Math.sin(th * DEG), c = Math.cos(th * DEG);
    L.pivot.rotation.z = th * DEG; L.pg.position.y = -(LG.LS + ext);
    L.padG.rotation.z = lerp(90, -th, k) * DEG;   // stowed: flat against the hull; out: level
    L.recess.visible = k > 0.01;
    _lgB.set(5.2 * s, -5.2 * c, 0);                // side braces: hull points either side of the bay → the outer tube
    L.sideA.forEach((m, i) => legSeg(m, _lgA.set(0, 1.6 - LG.HT, i ? 0.75 : -0.75), _lgB));
    _lgB.set(KS * s, -KS * c, 0);                  // knee brace: hull (bay bottom) → knee → tube; folds inward when stowed
    const d = _lgB.distanceTo(KB), h = Math.sqrt(Math.max(0, KA * KA - d * d / 4)) + bk * 1.8;
    _lgD.subVectors(_lgB, KB).normalize(); const sg = -_lgD.y < 0 ? 1 : -1;   // perpendicular, pointing inward (−x)
    _lgM.addVectors(_lgB, KB).multiplyScalar(0.5).add(_lgA.set(-_lgD.y * sg, _lgD.x * sg, 0).multiplyScalar(h));
    legSeg(L.kneeA, KB, _lgM); legSeg(L.kneeB, _lgM, _lgB); L.knee.position.copy(_lgM);
  }
  const legs = [45, 135, 225, 315].map(a => makeLeg(a * DEG, airframe).pivot);

  // Deploy (section 9): stowed in the skirt bays; latches release one by one (stag s apart), each leg swings out
  // (accelerating) as its piston telescopes, past the lock by over° and bounces into it (damped). legT = s since the deploy started.
  const LEGS = { stow: 0, open: 36, stag: 0.1, swing: 1.1, over: 7, bDecay: 0.12, bPer: 0.26, kick: 0.35, puff: 10 };
  const LEGS_DONE = LEGS.swing + LEGS.stag * 3 + 0.5;   // all four locked and settled
  function legAng(t) {
    if (t <= 0) return LEGS.stow;
    const dir = Math.sign(LEGS.open - LEGS.stow);
    if (t < LEGS.swing) { const u = t / LEGS.swing; return LEGS.stow + (LEGS.open + dir * LEGS.over - LEGS.stow) * u * u; }
    const b = t - LEGS.swing; return LEGS.open + dir * LEGS.over * Math.exp(-b / LEGS.bDecay) * Math.cos(2 * Math.PI * b / LEGS.bPer);
  }

  // The ship takes half the haze: realistic air would wash it out on the long-lens site cameras, and it is the subject
  ship.traverse(o => { if (o.material) [].concat(o.material).forEach(m => { m.defines = { ...(m.defines || {}), HAZE_K: '0.5' }; m.needsUpdate = true; }); });
  // ---------- The outpost round the pad (landing-base.js): built from the plan, the parked ships cloned from this one ----------
  const parkedShip = ({ lean = 0, dusty = false } = {}) => {   // a ship standing on its legs; feet at y = 0
    const g = new THREE.Group(), pk = new THREE.Group(), pa = new THREE.Group(); g.add(pk); pk.add(pa); pa.position.y = FOOT; pk.rotation.z = lean;
    [body, shield, tip, base, details].forEach(m => pa.add(m.clone()));
    rvacs.forEach(e => { const c = e.clone(); c.children[0].material = M.engine; pa.add(c); });
    flaps.forEach(f => { const h = f.pivot.parent.clone(); h.children[f.pivot.parent.children.indexOf(f.pivot)].rotation.y = f.side * 0.3; pa.add(h); });
    [45, 135, 225, 315].forEach(a => poseLeg(makeLeg(a * DEG, pa), LEGS.open, LG.EXT, 1, 0));   // the same four legs, out
    const dustC = new THREE.Color(0xa0603a), cache = new Map();
    g.traverse(m => { if (!m.isMesh) return; m.castShadow = m.receiveShadow = true;
      if (dusty) m.material = [].concat(m.material).map(mt => { if (!cache.has(mt)) { const c = mt.clone(); c.color?.lerp(dustC, 0.45); c.roughness = Math.min(1, (c.roughness ?? 0.5) + 0.35); c.metalness = (c.metalness ?? 0) * 0.5; if (c.emissive) c.emissive.setRGB(0, 0, 0); cache.set(mt, c); } return cache.get(mt); })[0]; });
    return g;
  };
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff2d8, fog: false }), redMat = new THREE.MeshBasicMaterial({ color: 0xff4d5e, fog: false });
  const legBk = [0, 0, 0, 0];   // extra splay (deg) of a buckled leg (crash)
  let legTc = 0;
  function poseLegs() { legs.forEach((p, i) => { const t = legTc - i * LEGS.stag, u = clamp(t / LEGS.swing, 0, 1), th = legAng(t) + legBk[i];
    const ext = LG.EXT * sstep(0.1, 0.85, u) - (legC[i] || 0) / Math.cos(Math.min(th, 80) * DEG);
    poseLeg(p.userData.leg, th, Math.max(0, ext), sstep(0, 0.6, u), clamp(legBk[i] / 40, 0, 1)); }); }
  const setLegs = t => { legTc = t; poseLegs(); };
  // Touchdown (section 10): each leg's shock absorber takes up to stroke m (vertical); perMs m per m/s of touchdown speed;
  // the last engine cuts cut s after contact; over hardVs m/s it is a hard landing even upright.
  const TDN = { stroke: 0.6, perMs: 0.13, cut: 0.3, hardVs: 3, rest: 0.75, comp: 0.15, bDecay: 0.15, bPer: 0.35, rock: 0.18, rockPer: 0.7 };
  const legC = [0, 0, 0, 0];
  function setLegComp(c) { if (c !== legC) c.forEach((v, i) => { legC[i] = v; }); poseLegs(); }   // absorbers: the piston slides back in

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
  // Centre engines' relight flares (the flip): one per bell, a hard flash at each engine's ignition
  const cFlares = cbells.map(e => {
    const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: nozzleTex, color: 0xdfe6ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    f.position.y = -BELL - 0.4; f.visible = false; e.add(f); return f;
  });
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
  // ---------- Landing plumes (section 12): Raptor in thin Mars air, cinematic ----------
  // Per engine: a small white-blue exit glow (the only part that blooms) and a short translucent inner jet with a couple of
  // faint shock cells. Around all three: one shared, soft, bell-shaped envelope of nested shells with turbulence flowing
  // downstream (it follows the mean gimbal and shrinks as engines go out). Relights run orange-rich and rough for a moment;
  // shutdowns collapse with an orange puff. Near the ground the jet stops, the envelope flares out and a glowing sheet
  // spreads over the surface. Every layer is capped so the frame never whites out, and fades close to the camera.
  const PLUME = {
    vis: 1.35,                    // overall visibility (1 = realistic-ish; higher = more cinematic)
    jetLen: [7, 13], jetW: 1,     // inner jet length (m) at low / full throttle
    envLen: [34, 64], envW: [7.5, 12],   // envelope length / end radius near the ground / high up (m)
    jetK: 0.4, envK: 0.11, capJ: 0.32, capE: 0.14,   // brightness and per-layer cap (linear, under the bloom threshold)
    exit: 1.0, hot: 0.35,         // exit glow strength; how long a relight stays orange-rich (s)
    groundAt: 80, sheetR: [6, 34], dust: 1,
  };
  const NOISE = `float h3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
    float n3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
                 mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }`;
  const plumeVS = `uniform float uG; varying float vU; varying vec3 vN; varying vec3 vV; varying vec3 vP; varying float vD; varying vec3 vA;
    void main(){ vU = -position.y; vec3 p = position; p.xz *= 1.0 + uG * smoothstep(0.5, 1.0, vU) * 1.8;   // flares out on the ground
      vP = p; vec4 mv = modelViewMatrix * vec4(p, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vD = -mv.z; vA = normalize(normalMatrix * vec3(0.0, 1.0, 0.0));
      gl_Position = projectionMatrix * mv; }`;
  const plumeMat = jet => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    uniforms: { uK: { value: 0 }, uT: { value: 0 }, uHot: { value: 0 }, uWarm: { value: 0 }, uSeed: { value: 0 }, uLen: { value: 10 }, uCap: { value: 0.4 }, uG: { value: 0 } },
    vertexShader: plumeVS,
    fragmentShader: `uniform float uK, uT, uHot, uWarm, uSeed, uLen, uCap; varying float vU; varying vec3 vN; varying vec3 vV; varying vec3 vP; varying float vD; varying vec3 vA;
      ${NOISE}
      void main(){ float u = clamp(vU, 0.0, 1.0);
        float edge = pow(abs(dot(normalize(vN), normalize(vV))), ${jet ? '1.2' : '1.5'});   // soft silhouette, no hard rim
        vec3 q = vec3(vP.x * 0.45, vP.y * uLen * ${jet ? '0.35' : '0.09'} + uT * ${jet ? '9.0' : '2.6'} + uSeed, vP.z * 0.45);
        float turb = 0.55 + 0.45 * n3(q) + 0.25 * (n3(q * 2.3 + 7.0) - 0.5);
        ${jet ? `
        float I = pow(1.0 - u, 2.0) + 0.28 * exp(-pow((u - 0.22) * 14.0, 2.0)) + 0.16 * exp(-pow((u - 0.43) * 12.0, 2.0));
        vec3 c = mix(vec3(0.9, 0.93, 1.0), vec3(0.45, 0.55, 1.0), smoothstep(0.0, 0.45, u));` : `
        float I = pow(1.0 - u, 1.5) * smoothstep(0.0, 0.06, u);
        vec3 c = mix(vec3(0.42, 0.52, 1.0), vec3(0.62, 0.38, 1.0), u);
        c = mix(c, vec3(1.0, 0.62, 0.36), uWarm * smoothstep(0.3, 1.0, u));`}
        c = mix(c, vec3(1.15, 0.58, 0.26), uHot);                              // orange-rich at a (re)light
        float near = smoothstep(3.0, 22.0, vD);                                // fade where the camera is inside it
        near *= 1.0 - 0.8 * smoothstep(0.55, 0.97, abs(dot(normalize(vA), normalize(vV))));   // seen end-on the layers pile up: thin it
        gl_FragColor = vec4(min(c * I * edge * turb * uK * near, vec3(uCap)), 1.0); }`,
  });
  const latheU = (r, n = 24, seg = 28) => { const pts = []; for (let i = 0; i <= n; i++) { const u = i / n; pts.push(new THREE.Vector2(r(u), -u)); } return new THREE.LatheGeometry(pts, seg); };
  const jetGeo = latheU(u => 0.66 + 0.95 * Math.sqrt(u));                                        // m; length scaled per frame
  const ENV_R = 6.5, envGeo = latheU(u => 1.9 + (ENV_R - 1.9) * (1 - Math.pow(1 - u, 2.4)), 28, 36);
  const BELL_AZ = [90, 210, 330].map(a => a * DEG);
  const ENG = cbells.map((e, i) => {
    const g = new THREE.Group(); g.position.y = -BELL; g.visible = false; e.add(g);
    const jet = new THREE.Mesh(jetGeo, plumeMat(true)); jet.material.uniforms.uSeed.value = i * 2.1; jet.material.uniforms.uCap.value = PLUME.capJ; g.add(jet);
    return { e, g, jet, lvl: 0, gx: 0, gz: 0, want: 0, tau: [0.03, 0.045, 0.06][i] };
  });
  const env = new THREE.Group(); env.position.y = -BELL - 0.2; env.visible = false; tvc.add(env);
  const envShells = [[1, 1], [0.8, 0.86], [0.6, 0.7]].map(([w, l], i) => { const m = new THREE.Mesh(envGeo, plumeMat(false)); m.userData.wl = [w, l];
    m.material.uniforms.uSeed.value = 3 + i * 5.3; m.material.uniforms.uCap.value = PLUME.capE; env.add(m); return m; });
  // Lights: a short cool light under the nozzles (skirt, bells, legs, aft flaps), and a warm one off the lit ground near the end
  const nozLight = new THREE.PointLight(0xb8c8ff, 0, 45, 2); nozLight.position.y = -BELL - 3; tvc.add(nozLight);
  const poolLight = new THREE.PointLight(0xffa060, 0, 170, 2); scene.add(poolLight);
  // Ground sheet: the jet stopped by the ground, spread into a hot swirling disc (blue-white centre, dust-lit warm edge)
  const pool = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, polygonOffset: true, polygonOffsetFactor: -4,
    uniforms: { uK: { value: 0 }, uT: { value: 0 } },
    vertexShader: `varying vec2 vXZ; void main(){ vXZ = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uK, uT; varying vec2 vXZ; ${NOISE}
      void main(){ float r = length(vXZ); if (r > 1.0) discard; float a = atan(vXZ.y, vXZ.x);
        float sw = n3(vec3(cos(a + r * 2.0 - uT * 1.5) * 3.0, sin(a + r * 2.0 - uT * 1.5) * 3.0, r * 4.0 - uT * 2.0));
        float I = pow(1.0 - r, 1.6) * (0.55 + 0.6 * sw);
        vec3 c = mix(vec3(0.85, 0.88, 1.0), vec3(1.0, 0.6, 0.32), smoothstep(0.05, 0.55, r));
        gl_FragColor = vec4(min(c * I * uK, vec3(0.85)), 1.0); }` }));
  pool.visible = false; scene.add(pool);
  const _px = new THREE.Vector3(), _pd = new THREE.Vector3(), _pe = new THREE.Vector3();
  const plumeFx = { on: false, exit: new THREE.Vector3(), dir: new THREE.Vector3(0, -1, 0), len: 0, w: 0, k: 0, near: 0, g: new THREE.Vector3() };   // shimmer + dust
  let plT = 0, outT = 0, engOut = false, engT = 9, lastN = 3, envLow = false;
  // thr: the sim's throttle (fraction of three engines) · ft: time into the flip (relight stagger; 99 = all lit)
  function setPlume(thr, t, ft = 99, neng = 0) {   // neng: engines lit (sim's 3 → 2 → 1); 0 = by throttle; -1 = all off
    const dt = clamp(t - plT, 0, 0.1); plT = t;
    // Engine-out: below ~35% throttle for 0.5 s the two outer centre engines shut down one after the other; back over 50% they relight
    outT = thr > 0.01 && thr < 0.35 ? outT + dt : 0; engT += dt;
    if (!engOut && outT > 0.5) { engOut = true; engT = 0; }
    if (engOut && (thr > 0.5 || thr < 0.01)) { engOut = false; engT = 0; }
    if (neng && neng !== lastN) { engT = 0; lastN = neng; }
    let nOn = 0, hot = 0;
    ENG.forEach((E, i) => {
      const want = neng ? (i < neng ? 1 : 0) : i === 0 || !engOut ? 1 : engT > (i === 2 ? 0.15 : 0) ? 0 : 1;
      if (E.want && !want && E.lvl > 0.3 && ship.visible) {   // shutdown: an orange puff out of the bell
        E.e.updateWorldMatrix(true, false); _pe.set(0, -BELL, 0).applyMatrix4(E.e.matrixWorld); const s = flight.s;
        for (let n = 0; n < 14; n++) fire.emit({ x: _pe.x, y: _pe.y, z: _pe.z, vx: _pd.x * rnd(8, 25) + rnd(-3, 3) + (s.vx || 0), vy: _pd.y * rnd(8, 25) + rnd(-3, 3) + (s.vh || 0), vz: _pd.z * rnd(8, 25) + rnd(-3, 3) + (s.vz || 0),
          life: rnd(0.25, 0.6), s0: 1.2, s1: rnd(3, 6), a: 0.55, drag: 3, fire: true }); }
      E.want = want;
      E.lvl += (want - E.lvl) * (1 - Math.exp(-dt * (want ? 10 : 14)));
      const ig = ft >= 99 ? 1 : sstep(IGN[i], IGN[i] + 0.18, ft);
      const dying = !want && E.lvl > 0.04 ? stutter(engT * 1.7, i + 5) : 1;
      E.k = thr > 0.01 ? E.lvl * ig * dying : 0; nOn += E.k;
      const lit = ft < 99 ? ft - IGN[i] : 99;   // s since this engine relit in the flip
      E.hot = Math.max(lit >= 0 && lit < 99 ? 1 - sstep(0, PLUME.hot, lit) : 0, want && E.lvl < 0.9 ? 0.6 : 0, !want ? 0.5 : 0);
      E.f = Math.max(ft < 99 ? ignRough(ft) : 0, want && E.lvl < 0.9 ? 0.7 : 0);   // rough at a (re)light
      hot = Math.max(hot, E.hot * (E.k > 0.05 ? 1 : 0));
    });
    const te = nOn > 0.01 ? clamp(thr * 3 / Math.max(nOn, 1), 0, 1) : 0;          // each lit engine's own throttle
    // Height of the exits and where the averaged exhaust meets the ground
    tvc.updateWorldMatrix(true, false);
    _pd.set(0, -1, 0).transformDirection(tvc.matrixWorld); _px.set(0, -BELL, 0).applyMatrix4(tvc.matrixWorld);
    const gH = heightAt(_px.x, _px.z), dG = _pd.y < -0.2 ? (_px.y - gH) / -_pd.y : 1e9, h = _px.y - gH;
    const hiK = sstep(60, 400, h), warm = 1 - sstep(10, 160, h), V = PLUME.vis;
    const near = dG < PLUME.groundAt ? 1 - dG / PLUME.groundAt : 0;
    let maxLen = 0;
    ENG.forEach((E, i) => {
      const k = E.k; E.g.visible = k > 0.01;
      // Per-engine gimbal: each bell lags the shared command a little, plus a tiny jitter and a slow roll trim (tangential)
      E.gx += (tvc.rotation.x - E.gx) * (1 - Math.exp(-dt / E.tau)); E.gz += (tvc.rotation.z - E.gz) * (1 - Math.exp(-dt / E.tau));
      const jit = 0.3 * DEG, roll = 0.5 * DEG * Math.sin(t * 0.9 + 1.3) * (thr > 0.01 ? 1 : 0);
      E.e.rotation.set(E.gx - tvc.rotation.x + jit * Math.sin(t * 7.3 + i * 2) + Math.cos(BELL_AZ[i]) * roll, 0,
        E.gz - tvc.rotation.z + jit * Math.sin(t * 6.1 + i * 3) + Math.sin(BELL_AZ[i]) * roll);
      const fl = cFlares[i];
      if (!E.g.visible) { if (!(ft < 99 && ft - IGN[i] > 0 && ft - IGN[i] < 1.5)) fl.visible = false; return; }
      const st = 1 + E.f * 0.3 * Math.sin(t * 97 + i);
      let len = lerp(PLUME.jetLen[0], PLUME.jetLen[1], te) * (0.35 + 0.65 * E.lvl) * st * (0.9 + 0.15 * hiK);
      if (dG < len) len = Math.max(dG, 1.5);                       // stopped by the ground
      const w = PLUME.jetW * (1 + 0.3 * E.f) * (1 + 0.25 * near);
      E.jet.scale.set(w, len, w);
      const u = E.jet.material.uniforms; u.uT.value = t; u.uHot.value = E.hot; u.uLen.value = len; u.uK.value = k * PLUME.jetK * V * (0.7 + 0.5 * te) * (1 + 0.8 * near);
      // Exit glow: a small hard light in the bell (blooms); a short flash at each flip relight
      const d = ft - IGN[i], flash = ft < 99 && d > 0 ? Math.exp(-d * 6) : 0;
      fl.visible = true; fl.material.color.setRGB(1, 1 - 0.35 * E.hot, 1 - 0.6 * E.hot);
      fl.material.opacity = Math.min(1, PLUME.exit * k * (0.45 + 0.4 * te) + flash); fl.scale.setScalar(1.6 + 1.2 * te * k + 6 * flash + Math.random() * 0.4);
      maxLen = Math.max(maxLen, len);
    });
    // Shared envelope: follows the mean gimbal, sized by height (wider and longer up high) and by the engines lit
    const P = nOn > 0.01 && ship.visible, nk = nOn / 3;
    env.visible = P; envShells.forEach((m, i) => { m.visible = P && !(envLow && i > 0); });
    if (P) {
      let L = lerp(PLUME.envLen[0], PLUME.envLen[1], hiK) * (0.55 + 0.45 * te) * (0.6 + 0.4 * Math.sqrt(nk)) * V;
      const W = lerp(PLUME.envW[0], PLUME.envW[1], hiK) * (0.55 + 0.45 * Math.sqrt(nk)) * (0.85 + 0.15 * te), gk = dG < L ? 1 : near * 0.5;
      if (dG < L) L = Math.max(dG + 0.5, 2);
      envShells.forEach(m => { const [ws, ls] = m.userData.wl, u = m.material.uniforms;
        m.scale.set(W / ENV_R * ws, L * ls, W / ENV_R * ws);
        u.uT.value = t; u.uHot.value = hot; u.uWarm.value = Math.max(warm, near); u.uLen.value = L * ls; u.uG.value = gk;
        u.uK.value = PLUME.envK * V * Math.min(1, nk * 1.4) * (0.6 + 0.5 * te) * (1 + 0.4 * hot) * (1 + 0.7 * (1 - hiK)); });   // brighter low down, against the ground
      maxLen = Math.max(maxLen, L);
    }
    nozLight.intensity = P ? 60 * nOn * (0.4 + te) * (1 + 0.08 * Math.sin(t * 53)) : 0;
    // Ground sheet + warm light off the lit dust, growing as it closes in
    pool.visible = P && near > 0;
    if (pool.visible) {
      const gx = _px.x + _pd.x * dG, gz = _px.z + _pd.z * dG;
      pool.position.set(gx, heightAt(gx, gz) + 0.3, gz); pool.scale.setScalar(lerp(PLUME.sheetR[0], PLUME.sheetR[1], near) * (0.7 + 0.3 * Math.sqrt(nk)));
      pool.material.uniforms.uT.value = t; pool.material.uniforms.uK.value = near * near * (0.35 + 0.65 * te) * Math.min(1, nk * 1.5) * 2.0 * PLUME.vis;
      poolLight.position.set(gx, heightAt(gx, gz) + 10, gz);
      poolLight.intensity = 420 * near * near * (0.3 + 0.7 * te) * nk * (1 + 0.1 * Math.sin(t * 41));   // kept low: hot specular spots on the steel otherwise
    } else poolLight.intensity = 0;
    Object.assign(plumeFx, { on: P, len: maxLen, w: 1.5 + 2 * te, k: P ? Math.min(1, nOn / 2) * (0.35 + 0.35 * te) : 0, near: P ? near : 0, nk, te });
    plumeFx.exit.copy(_px); plumeFx.dir.copy(_pd); if (P && dG < 1e8) plumeFx.g.set(_px.x + _pd.x * dG, gH, _px.z + _pd.z * dG);
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
  const dust = createPoints(4500, false, scene), fire = createPoints(1000, true, scene);
  const outpost = buildBase({ THREE, scene, groundAt, heightAt, groundU, wind: TERRAIN.wind, parkedShip, dust, lamp: lampMat, red: redMat });
  groundU.uBaseMap.value = makeBaseMap(THREE);   // drawn after the build: it includes the contact shade under each building
  const DUST = [0.72, 0.5, 0.36], STREAK = [0.95, 0.85, 0.75];
  const debris = [];
  { for (let i = 0; i < 46; i++) {
      const s = rnd(0.6, 3), m = new THREE.Mesh(new THREE.BoxGeometry(s, s * rnd(0.2, 0.6), s * rnd(0.5, 1.2)), i % 3 ? M.dark : M.steel);
      m.visible = false; m.castShadow = true; scene.add(m); debris.push({ m, v: new THREE.Vector3(), w: new THREE.Vector3() });
    } }
  const flash = new THREE.PointLight(0xffa040, 0, 900, 1.4); scene.add(flash);
  // Crash (section 11): the ship breaks into real pieces (hull sections cut from the same profile, flaps, centre bells),
  // a scorch mark, and a flickering light from the fire that keeps burning
  const wreck = [];
  { const ws = M.steel.clone(), wt = M.tiles.clone(); ws.side = wt.side = THREE.DoubleSide; ws.color.set(0x9a948c);
    const cuts = [0, BARREL * 0.45, BARREL, LEN];
    for (let c = 0; c < 3; c++) for (const [mat, ph0] of [[ws, Math.PI], [wt, 0]]) {
      const seg = prof.filter(q => q.y >= cuts[c] - 1e-6 && q.y <= cuts[c + 1] + 1e-6); if (seg.length < 2) continue;
      const g = new THREE.LatheGeometry(seg, 24, ph0, Math.PI); g.computeBoundingBox();
      const off = g.boundingBox.getCenter(new THREE.Vector3()); g.translate(-off.x, -off.y, -off.z);
      const m = new THREE.Mesh(g, mat); m.visible = false; m.castShadow = true; scene.add(m);
      wreck.push({ m, off, v: new THREE.Vector3(), w: new THREE.Vector3(), r: 2.2, smoke: true });
    }
    flaps.forEach(f => { const g = f.pivot.children[0].geometry.clone(); g.computeBoundingBox(); const o = g.boundingBox.getCenter(new THREE.Vector3()); g.translate(-o.x, -o.y, -o.z);
      const m = new THREE.Mesh(g, M.flap); m.visible = false; m.castShadow = true; scene.add(m); wreck.push({ m, off: null, v: new THREE.Vector3(), w: new THREE.Vector3(), r: 0.4, smoke: false }); });
    for (let i = 0; i < 3; i++) { const m = bell(0.42, 0.7, BELL); m.visible = false; scene.add(m); wreck.push({ m, off: null, v: new THREE.Vector3(), w: new THREE.Vector3(), r: 0.7, smoke: true }); }
  }
  const scorch = (() => { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'), gr = g.createRadialGradient(128, 128, 10, 128, 128, 128);
    gr.addColorStop(0, 'rgba(8,6,5,0.95)'); gr.addColorStop(0.55, 'rgba(20,12,8,0.7)'); gr.addColorStop(1, 'rgba(30,18,10,0)'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.CircleGeometry(45, 48), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
    m.rotation.x = -Math.PI / 2; m.visible = false; m.renderOrder = 2; scene.add(m); return m; })();
  const fireLight = new THREE.PointLight(0xff7a30, 0, 320, 1.6); scene.add(fireLight);
  const CRASH = { burn: 40, fireball: 160, second: 0.4, ring: 220, collapse: 6 };   // burn: s the wreck keeps burning; collapse: m/s at touchdown that bottoms out the legs
  let crashT = 0; const crashAt = new THREE.Vector3(), blasts = [], junk = debris.concat(wreck);

  // ---------- Orbit and entry: the planet pass (landing-orbit.js) + the ship pass at metre scale ----------
  await step?.(0.92, 'Parking in Mars orbit');
  // In orbit the sun is low ahead (5° above the ground under the ship, near the direction of travel): the ground is lit at
  // grazing angles (long crater shadows), the sun sits ~24° above the limb in forward shots with the arc brightest under
  // it, and the ship is mostly backlit. During the entry it eases to the ground scene's sun, so the cut matches.
  const sph = (az, el) => new THREE.Vector3(Math.cos(el * DEG) * Math.cos(az * DEG), Math.sin(el * DEG), Math.cos(el * DEG) * Math.sin(az * DEG));
  const SUN_AZ = [-40, SUN_GROUND_AZ], SUN_EL = [5, SUN_GROUND_EL];
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
  const shipSun = new THREE.DirectionalLight(0xfff4e8, 3.6); shipSun.position.copy(ORB_SUN).multiplyScalar(100); shipScene.add(shipSun);
  const shipBounce = new THREE.DirectionalLight(0xff7a3a, 0.5); shipBounce.position.set(0.3, -1, 0.1).multiplyScalar(100);   // the lit ground below
  const shipRim = new THREE.DirectionalLight(0x9bb4ff, 1.0); shipRim.position.set(-0.6, 0.15, 0.8).multiplyScalar(100);
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
  { const bq = +(location.search.match(/[?&]bake=(\d+)/)?.[1] ?? 0); orbit.bake(renderer, bq || (qName === 'low' ? 1024 : 2048)); }   // the planet's surface, baked once
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
    if (state === 'entry') { const I = ent.I ?? 0; lookTarget.exposure *= 1 - 0.32 * I; lookTarget.bloom.x *= 1 - 0.3 * I; }   // the eye stops down at peak heating: the ship keeps its shape
    easeLook(look, lookTarget, 1 - Math.exp(-dt / 0.7));
    skyU.uZen.value.copy(look.zen); skyU.uMid.value.copy(look.mid); skyU.uHor.value.copy(look.hor);
    skyU.uSunCol.value.copy(look.sun); skyU.uDust.value = look.dust; skyU.uT.value = simClock; skyU.uAlt.value = camera.position.y; groundU.uTime.value = simClock;
    { const orb = inOrbit(); M.steel.roughness = orb ? 0.3 : 0.5; M.steel.metalness = orb ? 0.85 : 0.74; M.steel.envMapIntensity = orb ? 1.1 : 0.95; }   // ground scene: a broader, softer sun streak on the steel
    devils.forEach(m => m.material.uniforms.uC.value.copy(look.gHigh).lerp(look.hor, 0.5));
    scene.fog.color.copy(look.hor);   // = the sky at the horizon: far ranges fade into it scene.fog.density = look.fog;   // 1/L at ground level (the haze chunk thins it with height along each sight line)
    sun.color.copy(look.sun); sun.intensity = look.sunI;
    hemi.color.copy(look.hemiSky); hemi.groundColor.copy(look.hemiGnd); hemi.intensity = look.hemiI;
    groundU.uGShadow.value.copy(look.gShadow); groundU.uGMid.value.copy(look.gMid); groundU.uGLit.value.copy(look.gLit);
    groundU.uGHigh.value.copy(look.gHigh); groundU.uGRock.value.copy(look.gRock);
    const tvcQ = state === 'flight' && flight.s.phase === 'tvc' ? 0.45 : 1;   // the low streaks crowd the landing shots: thinner then
    skyU.uCirrus.value = (qName === 'low' ? 0.5 : 1) * (tvcQ < 1 ? 0.35 : 1);   // and the cirrus behind the long lenses looking up
    cloudMeshes.forEach(([m, o], i) => { m.material.opacity = i === 0 && shotName === 'track' ? 0.7 : o * (i === 0 ? look.clouds : look.clouds * 1.6 * tvcQ); });   // the overcast shows (with its hole) behind the tracking shot
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
    details.visible = name !== 'low'; legDetail.forEach(m => { m.visible = name !== 'low'; });
    envLow = name === 'low'; devils.forEach(m => { m.visible = name !== 'low'; }); skyU.uCirrus.value = name === 'low' ? 0.5 : 1;
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
  // Shock layer (after the onboard entry footage): a thin glowing sheet standing a metre or two off the heat shield, brightest
  // where the flow hits it head-on and where it is seen edge-on (optically thin gas: brightness ~ path length), open on the
  // leeward side, and peeling off the shield edges into the wake. The leeward steel stays dark, lit by the glow.
  const NOISE2 = `float pH(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float pN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(pH(i), pH(i + vec2(1, 0)), f.x), mix(pH(i + vec2(0, 1)), pH(i + vec2(1, 1)), f.x), f.y); }
    float pF(vec2 p){ return 0.5 * pN(p) + 0.25 * pN(p * 2.1 + 3.1) + 0.125 * pN(p * 4.3 - 1.7) + 0.125 * pN(p * 8.7 + 5.3); }`;
  const plasmaMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uI: { value: 0 }, uT: { value: 0 }, uH: { value: 0 }, uFlowL: { value: new THREE.Vector3(-1, 0, 0) } },
    vertexShader: `uniform float uI, uT; uniform vec3 uFlowL; varying vec3 vN; varying vec3 vV; varying vec3 vP; varying float vEdge; varying vec3 vNL; varying float vD; varying float vE;
      void main(){ float e = min(uv.x, 1.0 - uv.x); vEdge = 1.0 - smoothstep(0.0, 0.2, e); vNL = normal;
        vec3 p = position + normal * (0.6 + 1.3 * uI + 1.2 * vEdge * uI) + normalize(uFlowL) * vEdge * vEdge * (1.5 + 4.5 * uI);   // stand-off; edges peel back
        vP = p; vec4 mv = modelViewMatrix * vec4(p, 1.0); vD = -mv.z; vE = e; vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uI; uniform float uT; uniform float uH; uniform vec3 uFlowL; varying vec3 vN; varying vec3 vV; varying vec3 vP; varying float vEdge; varying vec3 vNL; varying float vD; varying float vE; ${HEATC} ${NOISE2}
      void main(){ float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float wind = smoothstep(-0.15, 0.75, dot(normalize(vNL), -normalize(uFlowL)));            // facing the oncoming air
        float turb = 0.55 + 0.9 * pF(vec2(vP.y * 0.35 - uT * 9.0, vP.z * 0.5 + vP.x * 0.3 + uT * 2.0));
        float b = uI * (0.08 + 1.5 * pow(f, 2.2) + 1.0 * vEdge) * (0.25 + 0.75 * wind) * turb * smoothstep(0.0, 0.06, vE) * smoothstep(3.0, 14.0, vD);   // soft outer edge; fades right by the camera
        vec3 c = mix(heatCol(uH, wind), vec3(0.62, 0.42, 1.0), (1.0 - uH) * 0.35 * (1.0 - wind));
        gl_FragColor = vec4(pow(c, vec3(2.2)) * b * 1.7, 1.0); }`,
  });
  const plasma = new THREE.Mesh(shield.geometry, plasmaMat); plasma.visible = false; airframe.add(plasma);
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
    vertexShader: `varying float vY; varying vec3 vN; varying vec3 vV; varying vec2 vUv; varying float vD;
      void main(){ vY = position.y; vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vD = -mv.z; vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uI; uniform float uT; uniform float uH; varying float vY; varying vec3 vN; varying vec3 vV; varying vec2 vUv; varying float vD; ${HEATC} ${NOISE2}
      void main(){ float along = pow(1.0 - vY, 1.3) * smoothstep(0.0, 0.03, vY); float edge = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.5);
        // eddies: noise in (angle round the cone, distance along it) scrolling downstream, stretching as they go
        float ed = pF(vec2(vUv.x * 14.0, vY * 7.0 - uT * 3.2)) * pF(vec2(vUv.x * 5.0 + 7.0, vY * 2.5 - uT * 1.4));
        float tor = smoothstep(0.24, 0.62, ed) * (0.5 + 0.9 * smoothstep(0.35, 0.0, vY));   // filaments, not a sheet
        vec3 c = heatCol(uH * (1.0 - vY), 1.0 - smoothstep(0.0, 0.25, vY));
        c = mix(c, vec3(1.0, 0.35, 0.6), smoothstep(0.15, 0.5, vY)); c = mix(c, vec3(0.5, 0.38, 1.0), smoothstep(0.45, 0.95, vY));   // orange → pink → violet
        gl_FragColor = vec4(pow(c, vec3(2.2)) * uI * along * (0.1 + 1.6 * edge) * tor * 2.6 * smoothstep(12.0, 60.0, vD), 1.0); }`,
  });
  const wake = new THREE.Mesh(wakeGeo, wakeMat); wake.visible = false; shipScene.add(wake);
  // Plasma ribbons: ragged sheets peeling off the nose, belly edges and flap tips (ship-local anchors, belly = +x),
  // streaming back along the flow and cooling white-hot → orange → violet along their length. Camera-facing strips
  // bent by turbulence in the vertex shader; flicker, split (break-up noise) and length follow the heating.
  const RIB = [[0.5, 28.5, 0], [0.6, 21, R + 4.2], [0.6, 21, -R - 4.2], [0.6, -12, R + 6.2], [0.6, -12, -R - 6.2],
    [1.2, 8, R * 0.95], [1.2, 8, -R * 0.95], [1.5, -2, R * 0.9], [1.5, -2, -R * 0.9], [1.0, 14, R * 0.97],
    [1.0, 14, -R * 0.97], [1.3, 2, R * 0.93], [1.3, 2, -R * 0.93], [0.9, 24, R * 0.8], [0.9, 24, -R * 0.8], [1.6, -8, R * 0.9]];
  const ribGeo = new THREE.PlaneGeometry(1, 1, 1, 40);
  const ribBase = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `uniform vec3 uA, uFlow; uniform float uLen, uW, uT, uSeed; varying float vS; varying float vX; varying float vCD; varying float vEO;
      void main(){ float s = position.y + 0.5; vS = s; vX = position.x * 2.0;
        vec3 f = normalize(uFlow), side = normalize(cross(f, vec3(0.0, 0.0, 1.0))), up = vec3(0.0, 0.0, 1.0);
        vec3 c = uA + f * s * uLen;
        c += side * (sin(s * 7.0 - uT * 9.0 + uSeed) * 3.0 + sin(s * 17.0 - uT * 23.0 + uSeed * 2.0) + 2.0 * sin(s * 3.1 - uT * 4.0 + uSeed * 1.3)) * s * (0.6 + 1.4 * s);
        c += up * (sin(s * 5.0 - uT * 7.0 + uSeed * 3.0) * 4.0 + 2.5 * sin(s * 11.0 - uT * 15.0 + uSeed)) * s * (0.6 + 1.4 * s);
        vec3 w = normalize(cross(f, cameraPosition - c));
        c += w * position.x * uW * (0.4 + 2.6 * s);
        vEO = smoothstep(0.18, 0.55, length(cross(f, normalize(cameraPosition - c))));   // edge-on strips read as slabs: fade them
        vCD = distance(cameraPosition, c); gl_Position = projectionMatrix * viewMatrix * vec4(c, 1.0); }`,
    fragmentShader: `uniform float uI, uH, uT, uSeed; varying float vS; varying float vX; varying float vCD; varying float vEO; ${HEATC} ${NOISE2}
      void main(){ float edge = pow(max(1.0 - abs(vX), 0.0), 2.2) * vEO;
        float brk = smoothstep(0.25, 0.7, pF(vec2(vS * 9.0 - uT * 6.0 + uSeed, vX * 1.5 + uSeed * 3.0)));   // tears into blobs
        float fade = (1.0 - vS) * smoothstep(0.0, 0.04, vS);
        vec3 c = heatCol(uH * (1.0 - vS * 0.85), 1.0 - vS);
        gl_FragColor = vec4(pow(c, vec3(2.2)) * uI * edge * mix(0.3, 1.0, brk) * fade * fade * 2.2 * smoothstep(10.0, 45.0, vCD), 1.0); }`,
  });
  const ribbons = RIB.map((a, i) => {
    const m = new THREE.Mesh(ribGeo, ribBase.clone());
    m.material.uniforms = { uA: { value: new THREE.Vector3() }, uFlow: { value: new THREE.Vector3(-1, 0, 0) }, uLen: { value: 80 }, uW: { value: 1.6 },
      uT: { value: 0 }, uSeed: { value: i * 1.7 + 0.3 }, uI: { value: 0 }, uH: { value: 0 } };
    m.frustumCulled = false; m.visible = false; shipScene.add(m);
    return { m, a: new THREE.Vector3(...a), k: 0.7 + 0.3 * ((i * 0.618) % 1) };
  });
  const RIB_N = { high: 16, medium: 9, low: 4 };
  // The plasma lights the ship from below: steel sides and flaps catch its orange light at peak
  const plasmaLight = new THREE.PointLight(0xff8040, 0, 0, 2);   // (intensity set per frame, kept moderate: the steel catches the glow, it doesn't wash out) plasmaLight.position.set(R + 6, 4, 0); ship.add(plasmaLight);
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
  // then a short hold before the result card
  let source = 'sim';
  let state = 'orbit', paused = false;
  let outcome = null, legK = 0, legT = 0, legEv = 0, land = null, trim = { x: 0, y: 0 }, trimN = 0, td = null, lost = false;
  let calls = {};                    // callouts already shown this run
  // Hero ending (finish): drone orbit after the landing (or round the wreck), the end card over it
  const HERO = { dur: 14, durWreck: 9, r: [200, 175], h: [34, 46], spd: 2.4, rW: 90, hW: 20, spdW: 1.6, fov: 38 };   // slow drone orbit: ~34° over the landed hold
  const hero = { on: false, card: true, at: 1e9, cardAt: 1e9, how: '', a0: 0, t0: 0, c: new THREE.Vector3() };
  const START = L.flightStart();
  let apSide = 1;   // which side of the pad the ship comes in from (+1/-1, random each run)
  function newFlight() { apSide = Math.random() < 0.5 ? -1 : 1; return L.createFlight(START.x0, apSide * L.DIVERT); }
  let flight = newFlight();
  const att = L.createAttitudeSim();
  let dev = { tiltX: 0, tiltY: 0, gx: 0, gy: 0 };      // the TVC source's attitude (deg), once it flies
  let rig = null, rigSeen = -1e9;
  let gustPlan = [], promptPlan = [], maxTilt = 0, maxGimbal = 0;
  let et = 0, phi = 0, ent = { h: L.ENTRY.h0, v: L.ENTRY.v0, I: 0, fade: 0, u: 0 };   // orbit/entry timeline
  let simClock = 0, endState = null, stormT = 0, fadeOut = 0;
  const trail = [];
  const tracker = L.createTracker(d => {
    feed(`Pushed to <b>${d.peak.toFixed(1)}°</b> · back in <b>${d.recover.toFixed(2)} s</b>`, d.peak > 15 ? 'warn' : 'ok');
    showTag(`Push ${d.peak.toFixed(1)}° → 0 in <b>${d.recover.toFixed(2)} s</b>`, d.peak > 15 ? 'warn' : ''); insLast = performance.now();
  });
  const fall = { v: new THREE.Vector3(), axis: new THREE.Vector3(), dir: new THREE.Vector3(1, 0, 0), ang: 0, rate: 0, t: 0, thr: 0, n: 0, gx: 0, gz: 0, bk: 0, collapse: false };

  document.addEventListener('tvc:sample', e => { rig = e.detail; rigSeen = performance.now(); });
  const rigLive = () => performance.now() - rigSeen < 1500;   // the feed is 20-100 Hz: 1.5 s of silence = no link
  const inOrbit = () => state === 'orbit' || state === 'deorbit' || state === 'entry';
  const running = () => state === 'deorbit' || state === 'entry' || state === 'flight' || state === 'falling' || state === 'tipping';
  const ended = () => state === 'landed' || state === 'crashed';

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
  // Skip to the flip: a fresh run jumped to the start of the flip (works from orbit, mid-flight or after landing)
  function skipToFlip() {
    if (source === 'rig' && !rigLive()) { callout('NO RIG DATA · CONNECT THE ARDUINO', 2600, 'warn'); return; }
    if (state !== 'orbit') reset();
    if (paused) setPaused(false);
    begin(); if (state !== 'deorbit') return;
    cutToGround();
    const s = flight.s; for (let n = 0; n < 1e5 && state === 'flight' && s.phase === 'belly'; n++) simStep();
  }
  $('lndSkip').onclick = skipToFlip;
  const CAMS = ['auto', 'chase', 'pad', 'free'];
  let camMode = 'auto';
  // The TVC link inset (your rocket's tilt and nozzle): a toggle, remembered on this computer
  let linkOn = true; try { linkOn = localStorage.getItem('tvc-landing-link') !== 'off'; } catch {}
  const linkBtn = $('lndLink');
  const setLink = on => { linkOn = on; try { localStorage.setItem('tvc-landing-link', on ? 'on' : 'off'); } catch {}
    linkBtn.querySelector('.lbl').textContent = on ? 'Link: On' : 'Link: Off'; linkBtn.classList.toggle('on', on); $('lndAtt').hidden = !on; };
  linkBtn.onclick = () => setLink(!linkOn); setLink(linkOn);
  addEventListener('keydown', e => { if ((e.key === 'i' || e.key === 'I') && !e.ctrlKey && !e.metaKey && !e.altKey && document.body.dataset.tab === 'landing' && !e.target.closest?.('input, select, textarea')) setLink(!linkOn); });
  const camBtns = [...camBtn.querySelectorAll('button')];
  camBtns.forEach(b => b.onclick = () => { camMode = b.dataset.cam; controls.enabled = camMode === 'free'; if (camMode === 'free') controls.target.copy(ship.position); refresh(); });
  // Settings menu (quality, link, auto-loop) and the ? tooltip
  const menuEl = $('lndMenu'), gearBtn = $('lndGear');
  gearBtn.onclick = e => { e.stopPropagation(); menuEl.hidden = !menuEl.hidden; gearBtn.setAttribute('aria-expanded', String(!menuEl.hidden)); };
  addEventListener('pointerdown', e => { if (!menuEl.hidden && !e.target.closest('.lnd-menu-wrap')) { menuEl.hidden = true; gearBtn.setAttribute('aria-expanded', 'false'); } });
  addEventListener('keydown', e => {
    if (document.body.dataset.tab !== 'landing' || e.target.closest('input, select, textarea')) return;
    if (e.key === 'g' || e.key === 'G') doGust();
    if (e.key === 'b' || e.key === 'B') skipToFlip();
    if (e.key === 'r' || e.key === 'R') insPin = !insPin;   // keep the Your-rocket inset on (booth)
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
    goBtn.disabled = running() || (source === 'rig' && !rigLive() && state === 'orbit');
    goBtn.hidden = running();
    pauseBtn.disabled = !running();
    pauseBtn.querySelector('.lbl').textContent = paused ? 'Play' : 'Pause';
    pauseBtn.classList.toggle('on', paused);
    srcBtns.forEach(b => { b.disabled = running(); });
    tvcBtn.querySelector('.lbl').textContent = att.tvc ? 'TVC: On' : 'TVC: Off';
    tvcBtn.classList.toggle('off', !att.tvc);
    gustBtn.querySelector('.lbl').textContent = source === 'rig' ? 'Call a gust' : 'Gust';
    gustBtn.title = source === 'rig' ? 'Shows a prompt to push the real rocket (G)' : 'Shove the ship sideways (G)';
    camBtns.forEach(b => b.classList.toggle('on', b.dataset.cam === camMode));
    goBtn.title = state === 'orbit' ? 'Begin descent (Space)' : running() ? 'In flight' : 'Fly again (Space)';
    goBtn.classList.toggle('again', ended());
  }

  let calloutTimer = 0;
  function callout(html, ms = 2200, cls = '') {
    if (!cls.includes('sys')) return;   // cinematic banners removed (distracting); only system notices show
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
    if (source === 'sim') { att.gust(rnd(0, 360), GUST_SCALE); setStrip('<b>Gust</b>', 1500, 'now'); calls.gustAt = simClock; }
    else setStrip('<b>Push the rocket</b> · now', 2500, 'now');
  }

  let loopTimer = 0;
  function reset() {
    state = 'orbit'; paused = false; $('landing').classList.remove('paused'); hero.on = false; hero.card = true; hero.at = hero.cardAt = 1e9;
    cue = null; stripMsg = null; pushOn = false; tagEl.classList.remove('on'); insLast = insSeen = -1e9; outcome = null; legK = 0; legT = 0; legEv = 0; land = null; td = null; lost = false; calls = {}; endState = null; stormT = 0; fadeOut = 0;
    flight = newFlight(); att.reset(); tracker.reset();
    trim = { x: 0, y: 0 }; trimN = 0; maxTilt = 0; maxGimbal = 0; trail.length = 0; simClock = 0;
    dev = { tiltX: 0, tiltY: 0, gx: 0, gy: 0 };
    et = 0; ent = { h: L.ENTRY.h0, v: L.ENTRY.v0, I: 0, fade: 0, u: 0 };
    fall.ang = fall.rate = 0;
    ship.visible = true; debris.forEach(d => { d.m.visible = false; }); fire.clear(); dust.clear(); glow.clear(); puffs.clear(); haze.clear();
    orbitSun(0); setVac([0, 0, 0], [], 0); rvacMat.emissiveIntensity = 0; heatPanel(false); $('lndBurn').hidden = true; deoShot = '';
    ribbons.forEach(r => { r.m.visible = false; }); plasmaLight.intensity = 0; tileT = 0; entShot = -1; if (camera.fov !== 40) { setFov(40); }
    // Fly again starts exactly like the first run: same planet turn, idle shot, look, no leftover cloud deck or tracking cam
    phi = 0; idleI = 0; idleT = 0; tBreak = null; trk = null; glint.visible = false; holeU.value.z = 0; trkMast.visible = false; Object.assign(bGust, { k: 0, d: 1, next: 2 });
    wisps.forEach(w => scene.remove(w)); wisps.length = 0; Object.assign(look, blendLooks({}, 'space', 'space', 0));
    shipScene.add(ship); ship.position.set(0, 0, 0);
    $('lndResult').hidden = true; $('lndFeed').textContent = ''; fadeAmt = 0;
    clearTimeout(loopTimer); $('lndLoopNote').textContent = '';
    legBk.fill(0); legC.fill(0); setLegs(0); shipFx(0, 0);
    wreck.forEach(d => { d.m.visible = false; }); scorch.visible = false; crashT = 0; fireLight.intensity = 0; blasts.length = 0;
    outpost.reset();
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
    plasma.visible = false; wake.visible = false; shock.visible = false; TILE_MATS.forEach(m => { m.emissiveIntensity = 0; }); glow.clear();
    ribbons.forEach(r => { r.m.visible = false; }); plasmaLight.intensity = 0; tileT = 0; burnEl.hidden = true; heatPanel(false);
    fadeOut = 0.8; tBreak = null; trk = null; holeU.value.z = 0;
    buildWisps({ high: 1, medium: 0.6, low: 0.3 }[qName] ?? 1, flight.s.x ?? 0, flight.s.z ?? 0);
    once('belly', 'BELLY FLOP · <b>INSIDE THE CLOUD DECK</b>', 2200);
    refresh();
  }
  function handover() {
    if (trimN) { trim.x /= trimN; trim.y /= trimN; }
    att.reset();
    gustPlan = source === 'sim' ? [4, 10, 17].map(t => ({ t: t + rnd(-0.6, 0.6), dir: rnd(0, 360) })) : [];
    promptPlan = source === 'rig' ? [4, 20].map(t => ({ t })) : [];   // in the divert, and in the 1-engine settle
    callout(source === 'rig' ? 'TVC CONTROL · <b>RIG ACTIVE</b>' : 'TVC CONTROL · SIMULATED', 2400);
    setStrip('<b>TVC on</b>', 2000, 'tvcon');
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
      for (const g of gustPlan) { if (!g.cued && t >= g.t - 3) { g.cued = true; cue = { at: g.t, kind: 'gust' }; } if (!g.done && t >= g.t) { g.done = true; att.gust(g.dir, GUST_SCALE); calls.gustAt = simClock; } }
      for (const p of promptPlan) { if (!p.cued && t >= p.t - 3) { p.cued = true; cue = { at: p.t, kind: 'push' }; } }
      if (source === 'sim') att.step(1 + 1.5 * sstep(80, 0, s.h));      // dust blown back up near the ground
      d = readDev(); dev = d;
      const dt = L.tiltOf(d.tiltX, d.tiltY);
      maxTilt = Math.max(maxTilt, dt); maxGimbal = Math.max(maxGimbal, Math.abs(d.gx), Math.abs(d.gy));
      tracker.step(s.t, dt);
      if (!pushOn && dt > 3) onPushStart(); else if (pushOn && dt < 1.5) pushOn = false;
      if (dt > L.ABORT_DEG) { startFall(); return; }
    } else if (source === 'rig') {
      // Rig: ask for a still rocket during the belly flop, average its resting lean through the flip as the trim
      if (s.phase === 'belly' && s.h < 5200) { if (!calls.hold) { calls.hold = true; setStrip('<b>Hold the rocket still</b> · TVC takes over after the flip', 5000); } }
      if (s.phase === 'flip' && rig && rigLive()) { trim.x += rig.tiltX; trim.y += rig.tiltY; trimN++; }
    }
    flight.step(d);
    if (wasPhase === 'belly' && s.phase === 'flip') shake = 0.5;   // the RCS kick; the relight flashes come per engine (flipFx)
    if (wasPhase === 'flip' && s.phase === 'tvc') handover();
    if (s.phase === 'tvc' && s.eng < lastEng) shake = Math.max(shake, TFX.cutKick);   // an engine shuts down: a jolt (the plume stutters out in setPlume)
    lastEng = s.phase === 'tvc' ? s.eng : 3;
    if (s.h < L.LEGS_AT) { legT += L.DT; legK = clamp(legT / LEGS_DONE, 0, 1); }
    if (s.h <= groundUnder()) touchdown(s.tilt);   // (placeShip keeps a leaning ship's low foot above the ground until then)
  }
  const groundUnder = () => heightAt(flight.s.x, flight.s.z);
  let lastEng = 3;

  function touchdown(tilt) {
    const s = flight.s, miss = flight.drift;
    td = { tilt, vs: -s.vh, miss };
    s.h = groundUnder(); outpost.onTouchdown(ship.position.clone().setY(groundUnder()));
    if (tilt > L.TIP_DEG || td.vs > CRASH.collapse) { startTip(td.vs > CRASH.collapse && tilt <= L.TIP_DEG); return; }
    const onPad = miss <= L.PAD_R, vs = Math.max(0, td.vs), clean = tilt <= L.LAND_OK_DEG && vs <= TDN.hardVs;
    land = { t0: simClock, vs, tx: s.cmd.x + s.big.tiltX, ty: s.cmd.y + s.big.tiltY, y0: ship.position.y, thr: Math.max(s.thr, 0.05), off: null,
      cPeak: Math.min(TDN.stroke, TDN.perMs * vs) };
    land.used = land.cPeak / TDN.stroke;
    shake = Math.max(shake, 0.3 + 0.12 * vs);
    outcome = { ok: true,
      title: clean ? (onPad ? 'TOUCHDOWN' : 'TOUCHDOWN · OFF THE PAD') : 'HARD LANDING',
      sub: clean
        ? (onPad ? `Upright on the pad, ${miss.toFixed(1)} m from centre` : `Upright, but ${miss.toFixed(1)} m from the pad centre`)
        : tilt > L.LAND_OK_DEG ? `It stayed up, landing at ${tilt.toFixed(1)}°` : `It stayed up, touching down at ${vs.toFixed(1)} m/s (over ${TDN.hardVs} m/s)` };
    dustStorm(s.x, s.h, s.z);
    stormT = 2.5;
    lower(outcome.title === 'TOUCHDOWN' ? 'TOUCHDOWN · LZ-1' : outcome.title, `${miss.toFixed(1)} m from centre · ${vs.toFixed(1)} m/s · ${tilt.toFixed(1)}° tilt`, 5000);
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
    state = 'falling'; pushOn = false;
    showTag(`LOST · past ${L.ABORT_DEG}°`, 'bad', 6000);
    const s = flight.s, ax = L.axisFromTilt(s.cmd.x + dev.tiltX, s.cmd.y + dev.tiltY);
    fall.axis.set(ax.z, 0, -ax.x).normalize();
    if (!isFinite(fall.axis.x)) fall.axis.set(1, 0, 0);
    fall.rate = 0.6; fall.v.set(s.vx, s.vh, s.vz); fall.h = Math.max(0, s.h - groundUnder());
    // The autopilot fights it: full throttle, nozzles hard over (gimbal only), for ~1 s; then the engines stutter out
    fall.t = 0; fall.thr = 1; fall.n = Math.max(1, s.eng || 3); fall.collapse = false;
    fall.gx = Math.sign(tvc.rotation.x || 1) * 15 * DEG; fall.gz = Math.sign(tvc.rotation.z || -1) * 15 * DEG;
    setStrip(`<b>Loss of control</b> · past ${L.ABORT_DEG}°`, 4500, 'bad');
    refresh();
  }
  // Tip-over: the legs on the lean side bottom out and the one most on that side buckles (splays out), the high side lifts
  // off, the ship pivots over the lean-side feet. collapse: landed too fast, the absorbers bottom out and a leg folds.
  function startTip(collapse = false) {
    state = 'tipping';
    const s = flight.s, ax = L.axisFromTilt(s.cmd.x + s.big.tiltX, s.cmd.y + s.big.tiltY), hl = Math.hypot(ax.x, ax.z);
    if (hl > 1e-3) fall.dir.set(ax.x / hl, 0, ax.z / hl); else { const a = rnd(0, Math.PI * 2); fall.dir.set(Math.cos(a), 0, Math.sin(a)); }
    fall.axis.set(fall.dir.z, 0, -fall.dir.x); fall.rate = collapse ? 0.35 : 0.18; fall.ang = 0;
    fall.v.set(0, 0, 0); fall.t = 0; fall.collapse = collapse; fall.thr = Math.max(s.thr, 0.05); fall.n = Math.max(1, s.eng || 1);
    ship.updateMatrixWorld(true); let best = -2;
    legs.forEach((p, i) => { p.parent.getWorldPosition(_fd); _fd.sub(ship.position); _fd.y = 0; _fd.normalize(); const d = _fd.x * fall.dir.x + _fd.z * fall.dir.z; if (d > best) { best = d; fall.bk = i; } });
    shake = Math.max(shake, collapse ? 1 : 0.5);
    setStrip(collapse ? '<b>Legs collapsed</b>' : '<b>Tipping over</b>', 4000, 'bad');
    refresh();
  }
  // Engines after it is lost: on for a moment (1 s in the air, 0.3 s on the ground), then n = -1 (all off, stuttering out)
  const fallPlume = () => { const on = state === 'falling' ? 1 : 0.3, t = fall.t; return t < on ? { thr: fall.thr, n: fall.n } : t < on + 0.8 ? { thr: fall.thr, n: -1 } : { thr: 0, n: 0 }; };
  // Lowest point of the hull's side (not the skirt), above the ground under it
  function hullLow() {
    _up.set(0, 1, 0).applyQuaternion(ship.quaternion); const sinT = Math.sqrt(Math.max(0, 1 - _up.y * _up.y)); let m = 1e9;
    for (const a of [NOSE * 0.3, NOSE * 0.6, NOSE * 0.95]) m = Math.min(m, ship.position.y + _up.y * a - R * sinT - heightAt(ship.position.x + _up.x * a, ship.position.z + _up.z * a));
    return m;
  }
  function fireball(at, n, k) {   // a rising orange ball that mushrooms, smoke rolling out of it
    for (let i = 0; i < n; i++) { const u = rnd(-1, 1), a = rnd(0, Math.PI * 2), r = Math.sqrt(1 - u * u), v = rnd(4, 22) * k;
      fire.emit({ x: at.x + rnd(-4, 4), y: at.y + rnd(2, 10), z: at.z + rnd(-4, 4), vx: r * Math.cos(a) * v, vy: Math.abs(u) * v * 0.6 + rnd(6, 16) * k, vz: r * Math.sin(a) * v,
        life: rnd(1.2, 2.6), s0: rnd(6, 10) * k, s1: rnd(22, 40) * k, a: rnd(0.2, 0.45), drag: 1.1, g: -4, fire: true }); }
    for (let i = 0; i < n * 0.6; i++) { const a = rnd(0, Math.PI * 2), v = rnd(2, 10);
      dust.emit({ x: at.x + rnd(-8, 8), y: at.y + rnd(8, 30) * k, z: at.z + rnd(-8, 8), vx: Math.cos(a) * v, vy: rnd(6, 14), vz: Math.sin(a) * v,
        life: rnd(4, 8), s0: 12, s1: rnd(50, 90) * k, a: 0.55, drag: 0.5, rgb: [0.13, 0.11, 0.1] }); }
  }
  function explode(at, why, quiet) {
    // Hull sections thrown from where they were on the ship; flaps and bells from the blast
    airframe.updateMatrixWorld(true); airframe.getWorldQuaternion(_q);
    wreck.forEach(d => { d.m.visible = true;
      if (d.off) d.m.position.copy(d.off).applyMatrix4(airframe.matrixWorld); else d.m.position.set(at.x + rnd(-6, 6), at.y + rnd(3, 14), at.z + rnd(-6, 6));
      d.m.quaternion.copy(_q); if (!d.off) d.m.rotation.set(rnd(0, 6), rnd(0, 6), rnd(0, 6));
      _fd.copy(d.m.position).sub(at); _fd.y = Math.max(_fd.y, 1); _fd.normalize(); const v = d.off ? rnd(6, 16) : rnd(14, 30);
      d.v.set(_fd.x * v + fall.v.x * 0.2, rnd(6, 16) + Math.max(0, _fd.y) * 6, _fd.z * v + fall.v.z * 0.2);
      d.w.set(rnd(-1.5, 1.5), rnd(-1.5, 1.5), rnd(-1.5, 1.5)).multiplyScalar(d.off ? 0.6 : 2.5); });
    ship.visible = false;
    fireball(at, CRASH.fireball, 1); blasts.push({ t: simClock + CRASH.second, at: at.clone() });
    for (let i = 0; i < CRASH.ring; i++) { const a = rnd(0, Math.PI * 2), v = rnd(40, 75);   // shockwave ring along the ground
      dust.emit({ x: at.x + Math.cos(a) * 6, y: at.y + rnd(0.5, 2.5), z: at.z + Math.sin(a) * 6, vx: Math.cos(a) * v, vy: rnd(0, 3), vz: Math.sin(a) * v,
        life: rnd(1.5, 3), s0: 4, s1: rnd(12, 22), a: 0.5, drag: 1.3, rgb: DUST }); }
    scorch.position.set(at.x, heightAt(at.x, at.z) + 0.4, at.z); scorch.visible = true;
    crashT = CRASH.burn; crashAt.copy(at);
    for (let i = 0; i < 350; i++) {
      const u = rnd(-1, 1), a = rnd(0, Math.PI * 2), r = Math.sqrt(1 - u * u), v = rnd(6, 48);
      fire.emit({ x: at.x, y: at.y + rnd(0, 10), z: at.z, vx: r * Math.cos(a) * v, vy: Math.abs(u) * v * 0.8 + 3, vz: r * Math.sin(a) * v, life: rnd(0.8, 2.4), s0: rnd(4, 7), s1: rnd(14, 32), a: rnd(0.35, 0.7), drag: 1.4, g: L.G, fire: true });
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
    flash.position.set(at.x, at.y + 10, at.z); flash.intensity = 2.5e5;
    shake = 2.2; flashScreen(0.5);
    if (quiet) return;
    outcome = { ok: false, title: why === 'tip' ? 'TIPPED OVER' : why === 'collapse' ? 'LEGS COLLAPSED' : 'LOSS OF CONTROL',
      sub: why === 'tip' ? `Touched down leaning ${td.tilt.toFixed(1)}° and fell over (limit ${L.TIP_DEG}°)`
        : why === 'collapse' ? `Touched down at ${Math.max(0, td.vs).toFixed(1)} m/s: the legs bottomed out (limit ${CRASH.collapse} m/s)`
        : `The TVC lost it past the ${L.ABORT_DEG}° abort at ${(fall.h ?? 0).toFixed(0)} m${source === 'sim' && !att.tvc ? ', with the TVC switched off' : ''}` };
    outcome.at = at.clone();
    finish('crashed');
  }
  // An ending: hold a moment (the absorbers and cutoff, or the blast and the second blast), then the result card
  function finish(how) {
    state = how; endState = how;
    refresh();
    // Hero ending: ~2 s on the pad cam as the dust settles, then a slow drone orbit (the wreck: slower, lower, closer), the
    // end card fading in over it. Any key or click brings the card in at once.
    hero.on = false; hero.card = false; hero.how = how; hero.at = simClock + (how === 'landed' ? 2 : 2.5); hero.cardAt = hero.at + (how === 'landed' ? HERO.dur : HERO.durWreck);
  }
  function heroStep() {
    if (hero.card || (state !== 'landed' && state !== 'crashed')) return;
    if (!hero.on && simClock >= hero.at) {
      hero.on = true; hero.t0 = simClock;
      hero.c.copy(state === 'crashed' && !td ? crashAt : ship.position); hero.c.y = heightAt(hero.c.x, hero.c.z);
      const hub = Math.atan2(150 - hero.c.z, 440 - hero.c.x); hero.a0 = hub + Math.PI - 0.5;   // start west of the ship: the habitat district behind it
    }
    if (simClock >= hero.cardAt) { hero.card = true; endCard(); }
  }
  addEventListener('keydown', () => { if (hero.on && !hero.card) { hero.card = true; endCard(); } });
  $('landing').addEventListener('pointerdown', () => { if (hero.on && !hero.card) { hero.card = true; endCard(); } });
  function endCard() {
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
      ['Touchdown speed', td ? `${Math.max(0, td.vs).toFixed(1)} m/s` : '—'],
      ['Leg travel used', land ? `${Math.round(land.used * 100)}%` : outcome.title === 'LEGS COLLAPSED' ? '100%' : '—'],
    ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    $('lndResSrc').textContent = source === 'rig' ? 'From the flip down, flown by the real rocket on the desk rig'
      : `From the flip down, simulated TVC ${att.tvc ? 'on' : 'off'} (same controller as the Nano)`;
    placeResult();
  }
  // The result card sits right under the source card (same width), clear of the bottom panels
  function placeResult() {
    const r = $('lndResult'); if (r.hidden || !r.offsetParent) return;
    const pr = r.offsetParent.getBoundingClientRect(), sr = $('lndSource').getBoundingClientRect(), att = document.querySelector('#landing .lnd-att');
    const lim = att && att.offsetParent ? att.getBoundingClientRect().top : pr.bottom;
    r.style.top = `${sr.bottom - pr.top + 10}px`; r.style.right = `${pr.right - sr.right}px`; r.style.width = `${sr.width}px`;
    r.style.maxHeight = `${Math.max(180, lim - sr.bottom - 20)}px`;
  }
  addEventListener('resize', placeResult);

  // ---------- Orbit timeline (screen time) ----------
  const qA = new THREE.Quaternion(), qB = new THREE.Quaternion(), _z = new THREE.Vector3(0, 0, 1);
  const bellyQ = a => qA.setFromAxisAngle(_z, -a * DEG).clone(), _qi = new THREE.Quaternion();
  const ENT_PACE = 0.66;   // entry profile speed on screen (×1 ≈ 20 s, 0.66 ≈ 30 s with the time-warp ramps)
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
      et += dt * wNow / E.warp * ENT_PACE;   // ~30 s on screen
      $('lndWarp').textContent = '×' + Math.max(1, Math.round(wNow)) + ' time warp'; ent.w = wNow;
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
      orbitSun(sstep(0.0, 0.2, u));   // the deorbit keeps its sunrise; through the entry the sun climbs to the afternoon's
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
    plasma.visible = wake.visible = I > 0.01; shock.visible = false;   // (the closed shell read as a bubble)
    const Hq = state === 'entry' ? ent.q ?? 0 : 0;
    plasmaMat.uniforms.uI.value = I * 0.9; plasmaMat.uniforms.uT.value = simClock; plasmaMat.uniforms.uH.value = Hq;
    shockMat.uniforms.uI.value = I * 1.3 * (1 - 0.6 * Hq); shockMat.uniforms.uT.value = simClock; shockMat.uniforms.uH.value = Hq;
    shock.scale.set(8.2, 31, 8.6).multiplyScalar(1.12 - 0.12 * I);   // the shock hugs closer as the heating rises
    const tt = state === 'entry' ? tileT : 0;                         // tiles: dull red → orange → yellow, with lag
    M.tiles.emissive.setRGB(1, 0.12 + 0.4 * tt, 0.03 + 0.14 * tt * tt); TILE_MATS.forEach(m => { m.emissiveIntensity = tt * 0.95; });   // dull red → orange: glowing, not white
    plasmaLight.intensity = I * 300; plasmaLight.color.setRGB(1, 0.4 + 0.35 * Hq, 0.2 + 0.2 * Hq);
    wakeMat.uniforms.uI.value = I * 0.6; wakeMat.uniforms.uT.value = simClock; wakeMat.uniforms.uH.value = Hq;
    const gam = (4 + 36 * ent.u) * DEG;                       // flight path angle below horizontal
    const flow = new THREE.Vector3(-Math.cos(gam), Math.sin(gam), 0);   // where the air goes, relative to the ship
    wake.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), flow);
    plasmaMat.uniforms.uFlowL.value.copy(flow).applyQuaternion(_qi.copy(ship.quaternion).invert());
    wake.scale.set(9 + 7 * I, 300 + 320 * I, 9 + 7 * I); wake.position.copy(flow).multiplyScalar(-6);
    { const L = _pv.copy(camera.position).sub(wake.position), al = L.dot(flow), rad = L.addScaledVector(flow, -al).length(), rr = wake.scale.x * clamp(1 - al / wake.scale.y, 0, 1);
      wakeMat.uniforms.uI.value *= 0.12 + 0.88 * sstep(-3, 8, al < 0 ? 99 : rad - rr); }   // seen from inside, its faces stand edge-on as slabs
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
    if (I > 0.15) {
      const n = Math.round(10 * I);
      for (let i = 0; i < n; i++) {
        const along = rnd(-22, 28), side = Math.random() < 0.5 ? -1 : 1;
        const p = new THREE.Vector3(Math.cos(-pitch * DEG) * along, Math.sin(-pitch * DEG) * along - 4, side * rnd(3, 7));
        glow.emit({ x: p.x, y: p.y, z: p.z, vx: flow.x * rnd(80, 160), vy: flow.y * rnd(80, 160), vz: side * rnd(5, 15), life: rnd(0.1, 0.22), s0: 2.2, s1: 4, a: 0.5 * I, drag: 0, rgb: [1, lerp(0.42, 0.7, Hq) + rnd(-0.05, 0.05), lerp(0.85, 0.35, Hq)] });
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
  const CG_H = () => TAIL + FOOT * sstep(0, 1, legK);   // CG above the ground when upright on its feet
  const VIS_GIMBAL = 1.6;                  // the TVC source's nozzle swing is drawn this much bigger, so it reads on screen
  // Flip: the centre engines relight one after another (s after the flip starts), rough for a moment, then steady
  const IGN = [0.25, 0.42, 0.56];
  const flipT = () => { const s = flight.s; return s.phase === 'flip' ? s.t - s.tPh : s.phase === 'tvc' ? 99 : -1; };
  const ignK = ft => IGN.reduce((a, t0) => a + sstep(t0, t0 + 0.18, ft), 0) / 3;
  const ignRough = ft => Math.max(0, 1 - Math.abs(ft - 0.6) / 0.5);
  // Flaps fold in the flip: aft first, then forward, each snapping shut with a small overshoot
  function foldFlap(ft, d) {
    const u = ft - d, base = lerp(0.3, -0.2, sstep(0, 0.8, u));
    return u > 0.8 ? base - 0.09 * Math.sin((u - 0.8) * 14) * Math.exp(-(u - 0.8) * 4) : base;
  }
  function placeShip() {
    if (state !== 'flight' && state !== 'landed') return;
    if (state === 'landed' && land) { settle(); return; }
    const s = flight.s, B = s.big, tx = s.cmd.x + B.tiltX, ty = s.cmd.y + B.tiltY, ax = L.axisFromTilt(tx, ty);   // the big ship's (heavy) attitude
    ship.rotation.set(Math.atan2(ax.z, ax.y), 0, Math.atan2(-ax.x, Math.hypot(ax.y, ax.z)));
    const ft = flipT();
    // Belly flop: hung from the trajectory point at the tail as before; from the flip on, it turns about its CG (a lean swings
    // the engines the other way), blended over the flip so nothing jumps
    const cgK = s.phase === 'belly' ? 0 : s.phase === 'flip' ? sstep(0, 4.5, ft) : 1, ch = CG_H();
    ship.position.set(s.x + ax.x * ch * (1 - cgK), s.h + ch * (ax.y * (1 - cgK) + cgK), s.z + ax.z * ch * (1 - cgK));
    if (s.phase === 'tvc' && legK > 0) {   // the last metres: lift a leaning ship so its low foot never dips into the ground
      const low = ship.position.y - ch * ax.y - FOOT_R * Math.hypot(ax.x, ax.z) * legK, g = groundUnder();
      if (low < g) ship.position.y += g - low; }
    // The autopilot's swing drawn up to ~1.9× in the flip so it reads (sim stays at ±8°), easing back after the handover
    const gb = s.phase === 'flip' ? 1 + 0.9 * sstep(0, 0.4, ft) : s.phase === 'tvc' ? TFX.gimbal + (1.9 - TFX.gimbal) * (1 - sstep(0, 1.2, s.t - s.tPh)) : 1;
    const gx = clamp(s.gA.x * gb, -16, 16) + s.big.gx * VIS_GIMBAL, gy = clamp(s.gA.y * gb, -16, 16) + s.big.gy * VIS_GIMBAL;
    tvc.rotation.set(gx * DEG, 0, -gy * DEG);
    if (s.phase === 'belly') {   // flaps steer: pitch trim from the sim, a roll fight against wobble and gusts, micro-corrections
      const wob = (2.2 * Math.sin(s.t * 1.7) + 1.1 * Math.sin(s.t * 3.9 + 1.3) + 4 * bGust.k * bGust.d) * DEG;
      ship.rotateY(wob); ship.rotateZ(0.6 * wob);
      const roll = 0.025 * s.cmd.x - (0.22 * Math.sin(s.t * 1.7 + 0.6) + 0.1 * Math.sin(s.t * 3.9 + 2.1) + 0.6 * bGust.k * bGust.d);
      for (const f of flaps) f.pivot.rotation.y = f.side * ((f.fwd ? 0.3 + 0.35 * s.flap : 0.3 - 0.35 * s.flap) + 0.5 * f.side * roll + 0.03 * Math.sin(s.t * 17 + f.side * 3 + (f.fwd ? 1 : 0)));
    }
    else setFlaps(foldFlap(ft, 0.35), foldFlap(ft, 0));
    if (state === 'flight') cbells.forEach((e, i) => {   // relight kicks (the flares are drawn in setPlume)
      const d = ft - IGN[i];
      if (d > 0 && !calls['ig' + i]) {
        calls['ig' + i] = true; shake = Math.max(shake, 0.5 + 0.25 * i);
        if (i === 0) { flashScreen(0.25); flash.position.copy(ship.position); flash.intensity = 2e5; }
      }
    });
    setLegs(legT);
    if (s.phase === 'tvc') { const tt = s.t - s.tPh; shipFx(0.65 * sstep(0, 10, tt), 0.8 * sstep(1, 8, tt)); }   // soot builds, tanks frost
  }
  // On the ground: the first leg's absorber takes the hit, the ship rocks down onto the others (a little overshoot) and
  // settles level, the absorbers spring back part way (crush cores keep TDN.rest of the stroke); the bells re-centre.
  const _fd = new THREE.Vector3();
  function settle() {
    const t = simClock - land.t0, s = flight.s, cp = land.cPeak, cs = cp * TDN.rest;
    const comp = t < TDN.comp ? cp * Math.sin(Math.PI / 2 * t / TDN.comp)
      : cs + (cp - cs) * Math.exp(-(t - TDN.comp) / TDN.bDecay) * Math.cos(2 * Math.PI * (t - TDN.comp) / TDN.bPer);
    const k = Math.exp(-t / TDN.rock) * Math.cos(2 * Math.PI * t / TDN.rockPer), ax = L.axisFromTilt(land.tx * k, land.ty * k);
    ship.rotation.set(Math.atan2(ax.z, ax.y), 0, Math.atan2(-ax.x, Math.hypot(ax.y, ax.z)));
    const y = groundUnder() + (TAIL + FOOT) * ax.y - comp;
    if (land.off === null) land.off = land.y0 - y;
    ship.position.set(s.x, y + land.off * Math.max(0, 1 - t / TDN.comp), s.z);
    ship.updateMatrixWorld(true);
    const sinT = Math.hypot(ax.x, ax.z);
    legs.forEach((p, i) => { p.parent.getWorldPosition(_fd); _fd.sub(ship.position); _fd.y = 0; _fd.normalize();
      const low = sinT > 1e-4 ? -(_fd.x * ax.x + _fd.z * ax.z) / sinT : 0;   // +1: the leg on the low side
      legC[i] = clamp(comp + FOOT_R * sinT * low, 0, TDN.stroke); });
    setLegComp(legC); setLegs(legT);
    tvc.rotation.x *= 0.92; tvc.rotation.z *= 0.92;
  }
  function lowestPoint() {
    _up.set(0, 1, 0).applyQuaternion(ship.quaternion);
    return Math.min(ship.position.y + _up.y * NOSE, ship.position.y - _up.y * (TAIL + BELL));
  }
  function fallStep(dt) {
    if (state === 'falling') {
      fall.rate += 0.9 * dt;
      ship.rotateOnWorldAxis(fall.axis, fall.rate * dt);
      fall.t += dt; fall.v.y -= L.G * dt;
      ship.position.addScaledVector(fall.v, dt);
      if (fall.t < 1.2) { const gk = 1 - Math.exp(-dt * 10), osc = 3 * DEG * Math.sin(fall.t * 11);   // nozzles hard over, hunting
        tvc.rotation.x += (fall.gx + osc - tvc.rotation.x) * gk; tvc.rotation.z += (fall.gz - osc - tvc.rotation.z) * gk; }
      flight.s.h = ship.position.y - TAIL; flight.s.vh = fall.v.y;
      if (lowestPoint() <= heightAt(ship.position.x, ship.position.z) + 0.3) explode(ship.position.clone().setY(heightAt(ship.position.x, ship.position.z)), 'air');
    } else if (state === 'tipping') {
      fall.rate += 1.4 * dt; fall.t += dt;
      const s = flight.s, ang = fall.rate * dt;
      const pivot = _pv.set(s.x + fall.dir.x * FOOT_R, groundUnder(), s.z + fall.dir.z * FOOT_R);
      _q.setFromAxisAngle(fall.axis, ang);
      ship.position.sub(pivot).applyQuaternion(_q).add(pivot);
      ship.quaternion.premultiply(_q);
      fall.ang += ang;
      if (fall.collapse && fall.t < 0.3) ship.position.y -= 2 * dt;   // drops onto the bottomed-out legs
      ship.updateMatrixWorld(true);
      legs.forEach((p, i) => { p.parent.getWorldPosition(_fd); _fd.sub(ship.position); _fd.y = 0; _fd.normalize();
        const low = _fd.x * fall.dir.x + _fd.z * fall.dir.z;   // +1: on the side it tips toward
        legC[i] = fall.collapse || low > 0.2 ? TDN.stroke * sstep(0, 0.25, fall.t) : legC[i] * Math.exp(-dt * 6); });
      legBk[fall.bk] = 40 * sstep(0.1, 0.6, fall.t);
      setLegComp(legC); setLegs(legT);
      if (hullLow() <= 0.3 || fall.ang > 1.7) explode(ship.position.clone().addScaledVector(fall.dir, 12).setY(groundUnder()), fall.collapse ? 'collapse' : 'tip');
    }
  }
  // After contact: the last engine runs on for TDN.cut s, then shuts down (n = -1: every engine off, so the plume stutters out)
  const landPlume = () => { const t = simClock - land.t0; return t < TDN.cut ? { thr: land.thr, n: 1 } : t < TDN.cut + 0.8 ? { thr: land.thr, n: -1 } : { thr: 0, n: 0 }; };
  const curThr = () => state === 'landed' && land ? landPlume().thr : state === 'falling' || state === 'tipping' ? fallPlume().thr : state === 'flight' && flight.s.phase !== 'belly' ? flight.s.thr * ignK(flipT()) : 0;

  // ---------- Camera ----------
  // Ground scene: follows the ship rigidly (it moves at 300+ m/s) and smooths only the offset; a change of shot cuts.
  const camOff = new THREE.Vector3(-105, 42, -118), lookOff = new THREE.Vector3(), _co = new THREE.Vector3(), _lo = new THREE.Vector3();
  let shake = 0, orbitA = 0, shotName = '', padCam = false, rcsSide = 0;
  const PAD_CAM = new THREE.Vector3(-82, 6, -98), REPLAY_CAM = new THREE.Vector3(70, 5, 62);
  function shot() {
    if (camMode !== 'auto') return camMode;
    if (state === 'flight') {
      const s = flight.s;
      if (s.phase === 'belly') {   // shaky close-up through the deck → long-lens tracking cam as it pierces the base
        if (tBreak === null && s.h < DECK.base + 150) { tBreak = s.t; deckHole(ship.position.x, ship.position.z); }
        // Skirt cam first (after the Flight 15 onboard view): white inside the deck, the valley opening below as it breaks
        // out, vapour tearing off the flap; then the ground tracking camera finds it and holds it to the flip
        return tBreak === null || s.t < tBreak + 2.2 ? 'skirt' : 'track';
      }
      if (s.phase === 'flip') return 'flip';   // one side profile through the whole flip
      // TVC landing, four held shots: the engine bay at the handover, the ground long lens from the sun side (the gusts play
      // out in it, no cuts), overhead from the sun side, the pad cam
      const hg = s.h - groundUnder(), tv = s.t - s.tPh;
      if (hg < TVC_CAM.padH) return 'pad';
      if (tv < 3 && hg > 1100) return 'bay';
      return hg > TVC_CAM.teleH ? 'tele' : 'over';
    }
    if (hero.on) return 'hero';
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
      case 'flip': {   // long-lens side profile drifting round; the aim follows the nose as it swings up
        const k = sstep(0, 2.5, flipT());
        _co.set(-30 - 30 * k, 4 + 10 * k, -170); _lo.copy(_up.set(0, 1, 0).applyQuaternion(ship.quaternion)).multiplyScalar(4); break;
      }
      case 'flipLow': _co.set(-80, -18, -70); _lo.set(0, -6, 0); break;   // low aft, looking up past the exhaust at the gimballing bells
      default: {   // chase
        if (state !== 'flight' || flight.s.phase !== 'belly') {   // from the flip: square on to the rocket and its TVC, level, off the sun side
          _co.set(0, -6, -120); _lo.set(0, 0, 0); break;           // (across the line of travel: the flip and the lean read in profile)
        }
        // the belly flop: from above, the pad below
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
  const bGust = { k: 0, d: 1, next: 2 };   // belly-flop gusts: a kick the flaps visibly fight
  const FLIP_H = (() => { const f = L.createFlight(START.x0); while (f.s.phase === 'belly' && f.s.t < 60) f.step(null); return f.s.h; })();
  const flipEta = s => s.phase === 'belly' ? Math.max(0, (s.h - FLIP_H) / Math.max(1, -s.vh)) : 99;
  // From far away the ship is a small bright point: sunlit steel and leftover heat
  const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: wispTex, color: 0xffd8b0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  glint.visible = false; scene.add(glint);
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  // Entry shots (u = progress through the entry profile; offsets in metres from the ship, which sits at the origin; the limb
  // lies ~14° below the horizontal at 100 km, ~6° at 30 km, so the level-ish shots keep it in frame):
  //   0 wide over the limb, the glow trailing like a meteor (eases in from the deorbit framing) · 1 hull cam: by the
  //   forward flap, looking aft past the aft flaps, plasma streaming away over the planet (ship-local) · 2 peak: low beside the belly, the shield edge
  //   on fire against the limb · 3 ahead, above: the trail streaming back over the surface · 4 long lens as the glow fades
  const ENT_SHOTS = [
    { u0: 0, u1: 0.2, p0: V3(-60, 30, -340), p1: V3(-20, 20, -300), t: V3(0, -42, 0), fov: 32 },
    { u0: 0.2, u1: 0.4, onboard: true, p0: V3(-6, 19, 6), t: V3(0, -18, 7.5), fov: 62 },
    { u0: 0.4, u1: 0.64, p0: V3(45, 2, -125), p1: V3(25, 0, -110), t: V3(0, -16, 0), fov: 36 },
    { u0: 0.64, u1: 0.8, p0: V3(70, 80, 175), p1: V3(50, 70, 160), t: V3(-10, -6, 0), fov: 40 },
    { u0: 0.8, u1: 1.01, valley: true, p0: V3(-200, 175, -70), p1: V3(-165, 140, -50), t: V3(0, -25, 0), fov: 36 },   // high behind the ship, down the approach onto the real valley (below ~33 km)
  ];
  function cloudFx(dt) {   // vapour trail and torn streamers through the deck; belly-flop speed cues and chill-down
    const s = flight.s;
    if (s.phase === 'belly' && tBreak !== null && !paused) {
      bGust.next -= dt; bGust.k *= Math.exp(-dt * 1.6);
      if (bGust.next <= 0) { bGust.k = 1; bGust.d = Math.random() < 0.5 ? -1 : 1; bGust.next = rnd(2.2, 3.8); shake = Math.max(shake, 0.6); }
      const sp = ship.position, n = Math.ceil(dt * 260 * sstep(7000, 3500, s.h) + dt * 60);
      for (let i = 0; i < n; i++)   // dust/haze motes the ship falls through: they streak up past the camera
        dust.emit({ x: sp.x + rnd(-70, 70), y: sp.y - rnd(20, 160), z: sp.z + rnd(-70, 70), vx: 0, vy: 0, vz: 0, life: 0.9, s0: 0.6, s1: 1.4, a: 0.3, drag: 0, rgb: [0.9, 0.72, 0.58] });
      for (const i of [3, 4]) { const a = ship.localToWorld(_pv.copy(ribbons[i].a));   // faint vapour curls off the aft flap tips
        dust.emit({ x: a.x, y: a.y, z: a.z, vx: rnd(-3, 3), vy: rnd(-3, 3), vz: rnd(-3, 3), life: 0.5, s0: 2, s1: 9, a: 0.12, drag: 0, rgb: [0.95, 0.92, 0.9] }); }
      if (flipEta(s) < 3) for (let i = 0; i < 3; i++) {   // engine chill-down venting from the aft skirt
        const a = ship.localToWorld(_pv.set(rnd(-R, R) * 0.6, -TAIL + 1.5, rnd(-R, R) * 0.6));
        dust.emit({ x: a.x, y: a.y, z: a.z, vx: rnd(-8, 8), vy: rnd(-5, 5), vz: rnd(-8, 8), life: rnd(0.8, 1.4), s0: 2, s1: 12, a: 0.45, drag: 0.8, rgb: [0.96, 0.96, 0.97] });
      }
    }
    if (state === 'flight' && s.phase === 'belly' && (tBreak === null || s.t < tBreak + 6) && !paused) {   // vapour trail
      const sp2 = ship.position;
      const n = Math.min(40, Math.ceil(dt * 300)); for (let i = 0; i < n; i++) { const f = i / n;
        const yy = sp2.y - s.vh * dt * f + 6;   // the trail bends with the wind shear (it differs by height), so it curls rather than ruling a line
        dust.emit({ x: sp2.x - s.vx * dt * f, y: yy, z: sp2.z - s.vz * dt * f, vx: 9 * Math.sin(yy / 520) + rnd(-1, 1), vy: rnd(-1, 1), vz: 8 * Math.cos(yy / 700 + 1) + rnd(-1, 1),
          life: 9, s0: 9, s1: 60, a: 0.75, drag: 0.5, rgb: [0.97, 0.95, 0.93] }); }
    }
    if (shotName === 'skirt' && state === 'flight' && !paused) {   // condensation tearing off the near flap's edge, streaming past the skirt cam
      for (let i = 0; i < 4; i++) { const a = ship.localToWorld(_pv.copy(ribbons[3].a).add(_lo.set(rnd(-0.5, 0.5), rnd(-1.5, 1.5), rnd(-1, 0)))); const v = -s.vh;
        dust.emit({ x: a.x, y: a.y, z: a.z, vx: rnd(-3, 3), vy: v * rnd(0.75, 0.95), vz: rnd(-2, 4), life: rnd(0.4, 0.9), s0: 1.2, s1: 9, a: 0.28, drag: 0.4, rgb: [0.97, 0.96, 0.95] }); }
    }
    if (tBreak !== null && state === 'flight' && s.phase === 'belly' && s.t < tBreak + 2.5 && !paused) {   // torn streamers off the flaps
      if (s.h < DECK.base) once('base', 'CLOUD BASE · <b>6.6 KM</b>', 2000);
      for (const i of [1, 2, 3, 4]) { const a = ship.localToWorld(_pv.copy(ribbons[i].a));
        dust.emit({ x: a.x, y: a.y, z: a.z, vx: rnd(-4, 4), vy: -s.vh * 0.85 + rnd(-10, 10), vz: rnd(-4, 4), life: rnd(0.6, 1.4), s0: 6, s1: 30, a: 0.35, drag: 0.6, rgb: [0.95, 0.9, 0.86] }); }
    }
  }
  function cameraShot(dt, use) {
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
      else {   // entry: five shots, each with the planet or the limb in frame (see ENT_SHOTS)
        const u = ent.u, sh = use[0] === 'e' ? +use.slice(1) : entShotIdx(), S = ENT_SHOTS[sh], k = clamp((u - S.u0) / (S.u1 - S.u0), 0, 1);
        if (S.onboard) { ship.updateMatrixWorld(); off = ship.localToWorld(_co.copy(S.p0)); ship.localToWorld(_ct.copy(S.t)); }
        else { off = _co.copy(S.p0).lerp(S.p1, k); _ct.copy(S.t); if (sh === 0) { const e = sstep(0, 1, k * 2.2); off.lerpVectors(deoEndPos, off, e); _ct.lerpVectors(deoEndLook, S.t, e); } }
        if (sh !== entShot) { if (entShot >= 0) { camOff.copy(off); orbLook.copy(_ct); } entShot = sh; }
        if (S.onboard) { camOff.copy(off); orbLook.copy(_ct); }   // bolted to the flap: no lag
        if (camera.fov !== S.fov) { setFov(S.fov); }
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
    const name = use, sp = ship.position;
    glint.visible = false; if (name !== 'track') trkMast.visible = false;
    if (name === 'track') {   // a long-lens operator far below: lags, overshoots and corrects, magnified wobble
      if (shotName !== 'track') {   // a tracking camera on the ground ~3 km out, looking up at the ship under the cloud deck
        const px = sp.x - 700, pz = sp.z + (sp.z > 0 ? -1 : 1) * 2900, p = new THREE.Vector3(px, heightAt(px, pz) + 3, pz);
        trk = { p, a: sp.clone().add(_lo.set(-300, -420, 120)), v: new THREE.Vector3(), t: 0, focus: 220 };
        const f = _pv.set(sp.x - px, 0, sp.z - pz).normalize(), side = _lo.set(f.z, 0, -f.x);   // the mast: near, left, out of focus
        const mx = px + f.x * 12 - side.x * 2.6, mz = pz + f.z * 12 - side.z * 2.6; trkMast.position.set(mx, heightAt(mx, mz), mz);
        trkMast.rotation.y = Math.atan2(f.x, f.z); trkMast.visible = true;
      }
      trk.t += dt;
      if (!paused) {
        _lo.copy(sp).sub(trk.a).multiplyScalar(7).addScaledVector(trk.v, -3.4);           // spring-damper aim
        trk.v.addScaledVector(_lo, dt); trk.a.addScaledVector(trk.v, dt);
        trk.a.add(_lo.set(flight.s.vx, flight.s.vh, flight.s.vz).multiplyScalar(dt * 0.97));   // pans with it (slightly behind)
        trk.a.add(_lo.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(1.6));       // hand jitter
        if (Math.random() < 0.02) trk.v.add(_lo.set(rnd(-1, 1), rnd(-1, 1), 0).multiplyScalar(25));   // a bump
      }
      camera.position.copy(trk.p); camera.lookAt(trk.a);
      glint.visible = true; glint.position.copy(sp); glint.scale.setScalar(0.035 * camera.position.distanceTo(sp) * Math.tan(camera.fov * DEG / 2));
      camera.rotateZ(0.4 * DEG * Math.sin(trk.t * 1.3));
      // The hunt: wide and soft with the ship off to one side; the aim catches it, the focus snaps, the lens zooms in
      const D = camera.position.distanceTo(sp);
      trk.focus = lerp(220, D, sstep(0.75, 1.05, trk.t));
      const z = sstep(0.9, 1.9, trk.t), fov = lerp(26, 3.6, z) * (1 + 0.06 * Math.sin(z * Math.PI) * (z > 0.8 ? 1 : 0));
      if (Math.abs(camera.fov - fov) > 0.01) { setFov(fov); }
      if (trk.t > 1.6) trkMast.visible = false;
      shotName = name; padCam = true; return;
    }
    if (name === 'skirt') {   // onboard: bolted to the aft skirt beside the flap, wide lens looking down and aft past the belly
      ship.updateMatrixWorld(); camera.position.copy(ship.localToWorld(_pv.set(1.6, -12, R + 1.5)));
      camera.up.set(-0.55, 0, -1).applyQuaternion(ship.quaternion).normalize();   // frame "up" = toward the hull: hull and flap across the top
      camera.lookAt(ship.localToWorld(_lo.set(11, -34, R + 4))); camera.up.set(0, 1, 0);
      camera.rotateZ(0.012 * Math.sin(simClock * 13) + 0.006 * Math.sin(simClock * 31));   // vibration
      if (Math.abs(camera.fov - 78) > 0.01) { setFov(78); }
      shotName = name; padCam = true; return;
    }
    if (name === 'siteT' || name === 'siteW' || name === 'tele') {   // fixed cameras (SpaceX webcast style): only the aim pans, eased
      const C = TVC_CAM[name];
      camera.position.set(C.x, heightAt(C.x, C.z) + C.h, C.z);
      const frameH = 2 * camera.position.distanceTo(sp) * Math.tan((name === 'tele' && teleFov ? teleFov : C.fov) * DEG / 2);
      _lo.copy(sp).y -= C.drop * frameH;                                          // ship above the HUD
      if (C.padK != null) {   // wide: a held composition, the pad PADK of the frame height below centre; tilts up only if the ship would leave the top
        const hd = Math.hypot(camera.position.x, camera.position.z), gp = heightAt(0, 0), half = C.fov / 2;
        const eP = Math.atan2(gp - camera.position.y, hd) / DEG + C.padK * C.fov, eS = Math.atan2(sp.y - camera.position.y, hd) / DEG;
        const e = Math.max(eP, eS - half * C.top);
        _lo.set(0, camera.position.y + hd * Math.tan(e * DEG), 0);
      }
      // The operator: on the cut the lens is wide and a little off, zooms in onto the ship (overshoots, settles), then
      // pushes in slowly; the aim holds while the ship stays in a dead zone, re-centres on a spring when it leaves
      if (name !== shotName) { siteGoal.copy(_lo); siteAim.copy(_lo).add(_pv.set(rnd(-1, 1), rnd(-0.4, 0.6), rnd(-1, 1)).multiplyScalar(0.1 * frameH)); siteVel.set(0, 0, 0); opT0 = simClock; reC = false; }
      else if (!paused) {
        const dz = 0.07 * frameH, d = siteGoal.distanceTo(_lo); if (d > dz) reC = true; if (reC) { siteGoal.lerp(_lo, 1 - Math.exp(-dt * 5)); if (d < 0.15 * dz) reC = false; }
        const w = C.aim * 1.7, z = 0.6, n = Math.ceil(dt / 0.01), h = dt / n;
        for (let i = 0; i < n; i++) { siteVel.addScaledVector(_pv.copy(siteGoal).sub(siteAim), w * w * h).multiplyScalar(1 - 2 * z * w * h); siteAim.addScaledVector(siteVel, h); }
      }
      camera.lookAt(siteAim);
      if (!paused) camera.rotateZ(-TFX.camLean * DEG * clamp(rcsK, -1, 1));   // the operator leans with the RCS, as in the flip
      shotName = name; padCam = true;
    } else if (name === 'bay') {   // onboard, on the skirt by the engines: the bells gimbal, the plume pours away below
      ship.updateMatrixWorld(); camera.position.copy(ship.localToWorld(_pv.set(R + 2.4, -TAIL - 1.2, 2.6)));
      camera.up.copy(_up.set(0, 1, 0).applyQuaternion(ship.quaternion));
      camera.lookAt(ship.localToWorld(_lo.set(0, -TAIL - 5.5, 0))); camera.up.set(0, 1, 0);
      if (Math.abs(camera.fov - 64) > 0.01) setFov(64);
      shotName = name; padCam = true; return;
    } else if (name === 'over') {   // a drone high over the pad, looking down at the plume hitting it and the dust ring
      if (name !== shotName) { overP.set(-50, heightAt(0, 0) + 420, -250); }   // sun side: the lit steel, its shadow across the pad markings
      camera.position.copy(overP).add(_pv.set(Math.sin(simClock * 0.4) * 1.5, Math.sin(simClock * 0.3) * 1, Math.cos(simClock * 0.5) * 1.5));
      camera.lookAt(_lo.set(sp.x * 0.6, lerp(heightAt(0, 0) + 4, sp.y - 8, 0.5), sp.z * 0.6));
      if (Math.abs(camera.fov - 46) > 0.01) setFov(46);
      shotName = name; padCam = true; return;
    } else if (name === 'hero') {   // drone orbit, slow float
      const wreck = hero.how === 'crashed', t = simClock - hero.t0, k = sstep(0, HERO.dur, t);
      const a = hero.a0 + (wreck ? HERO.spdW : HERO.spd) * DEG * t, r = wreck ? HERO.rW : lerp(HERO.r[0], HERO.r[1], k), hh = wreck ? HERO.hW : lerp(HERO.h[0], HERO.h[1], k);
      const x = hero.c.x + Math.cos(a) * r, z = hero.c.z + Math.sin(a) * r;
      camera.position.set(x + 0.6 * Math.sin(simClock * 0.43), Math.max(hero.c.y + hh, heightAt(x, z) + 8) + 0.5 * Math.sin(simClock * 0.31 + 1), z + 0.6 * Math.cos(simClock * 0.37));
      camera.lookAt(_lo.copy(hero.c).add(_pv.set(0, wreck ? 4 : 22, 0)));
      if (Math.abs(camera.fov - HERO.fov) > 0.01) { setFov(HERO.fov); }
      shotName = name; padCam = true;
    } else if (name === 'pad') {
      const P = name === 'pad' ? _pc.set(PAD_CAM.x, 0, -apSide * Math.abs(PAD_CAM.z)) : REPLAY_CAM;   // pad cam on the far side from the approach
      if (name === 'pad') P.y = heightAt(P.x, P.z) + PAD_CAM.y;   // 6 m above the ground there (the ground is rough now)
      if (name !== shotName) { camera.position.copy(P); lookOff.set(sp.x, Math.max(14, 0.92 * sp.y), sp.z); }
      camera.position.lerp(P, 1 - Math.exp(-dt * 2));
      _lo.set(sp.x * 0.8, Math.max(14, 0.92 * sp.y), sp.z * 0.8);   // tilts up to keep the whole ship in frame as it comes in
      lookOff.lerp(_lo, 1 - Math.exp(-dt * 4));
      camera.lookAt(lookOff);
      padCam = true;
    } else {
      camGoal(name);
      const cut = name !== shotName && shotName !== '' && (name === 'flaps' || name === 'flip' || name === 'flipLow' || name === 'close' || name === 'top' || name === 'side' || shotName === 'flaps' || shotName === 'track');
      if (padCam || cut) { camOff.copy(cut ? _co : camera.position.clone().sub(sp)); lookOff.copy(_lo); padCam = false; }
      camOff.lerp(_co, 1 - Math.exp(-dt * 1.2)); lookOff.lerp(_lo, 1 - Math.exp(-dt * 2));
      camera.position.copy(sp).add(camOff);
      const gmin = heightAt(camera.position.x, camera.position.z) + 3;
      if (camera.position.y < gmin) camera.position.y = gmin;
      camera.lookAt(_pv.copy(sp).add(lookOff));
      if (name === 'flip' && !paused) camera.rotateZ(-3 * DEG * flight.s.rcs);   // the operator leans with the swing
    }
    shotName = name;
    const s = flight.s;
    const buffet = paused ? 0 : state === 'flight' ? (s.phase === 'belly' ? clamp(s.q / 1100, 0, 1) * 0.5 : s.phase === 'flip' ? 0.8 : s.phase === 'tvc' ? Math.max(TFX.buffet[3 - s.eng] ?? 0, 0.35 * sstep(40, 0, s.h)) : 0.35 * sstep(40, 0, s.h)) : 0;
    const inDeck = s.h > DECK.base - 40 && s.h < DECK.top ? 1 : 0;
    const sh = (paused ? 0 : shake) + buffet + (name === 'close' && !paused ? 0.5 + 0.7 * inDeck + (Math.random() < 0.04 ? 1.6 : 0) : 0);
    if (sh > 0.001) camera.position.add(_co.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(sh * 0.6));
    if (!paused) shake *= Math.exp(-dt * 2.5);
    const fov = name === 'pad' ? 44 : name === 'flaps' || name === 'close' || name === 'top' ? 52 : name === 'side' ? 20 : name === 'flip' ? 34 : name === 'flipLow' ? 42 : name in TVC_CAM && TVC_CAM[name].fov ? TVC_CAM[name].fov : 40;
    if (name === 'tele') {   // one long hold through the divert: the operator rides the zoom, keeping the ship ~1/8 of the frame
      const want = clamp(2 * Math.atan(200 / camera.position.distanceTo(sp)) / DEG, 8, TVC_CAM.tele.fov);
      teleFov = teleFov === 0 ? want : teleFov + (want - teleFov) * (1 - Math.exp(-dt * 1.5));
    } else teleFov = 0;
    const fz = name === 'tele' ? teleFov * opZoom() : name === 'siteT' || name === 'siteW' ? fov * opZoom() : fov;
    if (Math.abs(camera.fov - fz) > 1e-3) setFov(fz);
  }
  // TVC landing shots after the Starship Flight 15 webcast: a far site camera (~250 m up, ~3 km out, off to the side of
  // the divert) on a long lens, then the same spot wide with the pad and the base in the lower third, then a low ground
  // telephoto looking up past the comms mast, then the pad cam. x/z/h: spot (h above the ground), drop: aim below the ship
  // (× frame height, keeps it above the HUD), pad/padY: how much the aim holds the pad area (wide), aim: pan easing rate
  const TVC_CAM = {
    wideH: 1000, rimH: 800, teleH: 250, padH: 40,
    siteT: { x: -2900, z: 350, h: 25, fov: 34, drop: 0, padK: -0.36, top: 0.7, aim: 3 },   // the ship in the upper third, the valley floor and the pad below it   // on the west rim of the valley
    siteW: { x: -2900, z: 350, h: 25, fov: 30, drop: 0, padK: 0, top: 0.85, aim: 2 },   // padK: pad this far below centre (× fov); top: ship kept below this (× half fov)
    tele: { x: -70, z: -660, h: 3, fov: 27, drop: 0.25, aim: 4 },   // on the valley floor, sun side (the sun behind it, the ship's lit face); the plant and LZ-2 in the foreground
  };
  { const e = wz(WALLS[0].e, TVC_CAM.siteT.z); let bx = e - 70, bh = -1e9;   // stand just back from the west rim's edge, on its highest point
    for (let x = e - 260; x <= e - 40; x += 10) { const hh = heightAt(x, TVC_CAM.siteT.z); if (hh > bh) { bh = hh; bx = x; } }
    TVC_CAM.siteT.x = TVC_CAM.siteW.x = bx; }
  // Every fixed camera stands on something: the pad cam poles (either side of the approach), the tele tripod, the site tower
  outpost.addCamProps([[PAD_CAM.x, PAD_CAM.z, PAD_CAM.y, 'pole'], [PAD_CAM.x, -PAD_CAM.z, PAD_CAM.y, 'pole'], [TVC_CAM.tele.x, TVC_CAM.tele.z, TVC_CAM.tele.h, 'tripod'], [TVC_CAM.siteT.x, TVC_CAM.siteT.z, TVC_CAM.siteT.h, 'hut']]);
  const planCams = { pad: [[PAD_CAM.x, PAD_CAM.z], [PAD_CAM.x, -PAD_CAM.z]], site: [TVC_CAM.siteT.x, TVC_CAM.siteT.z] }, planBad = checkPlan(outpost.objs, planCams);
  planBad.forEach(([o, why]) => console.warn(`Base plan: ${o.name} ${why}`));
  const overP = new THREE.Vector3(), _pc = new THREE.Vector3(), siteAim = new THREE.Vector3(), siteGoal = new THREE.Vector3(), siteVel = new THREE.Vector3(); let opT0 = 0, reC = false, teleFov = 0;
  const opZoom = () => { const t = simClock - opT0; return (1 + 0.6 * Math.exp(-t * 2.6) * Math.cos(t * 3.2)) * (1 - 0.08 * sstep(0, 12, t)); };   // finding the ship, then the slow push-in


  // Heat shimmer behind the nozzles: project the exhaust axis to the screen for the grade pass (High/Medium only)
  const _sA = new THREE.Vector3(), _sB = new THREE.Vector3();
  function shimmer() {
    const u = post.grade.uniforms;
    u.uShK.value = 0;
    if (!QUALITY[qName].shimmer || !plumeFx.on || paused) return;
    _sA.copy(plumeFx.exit).addScaledVector(plumeFx.dir, 2); _sB.copy(plumeFx.exit).addScaledVector(plumeFx.dir, plumeFx.len * 0.7);
    const dist = camera.position.distanceTo(_sA);
    _sA.project(camera); _sB.project(camera);
    if (_sA.z > 1 || _sB.z > 1) return;
    u.uShA.value.set(_sA.x * 0.5 + 0.5, _sA.y * 0.5 + 0.5); u.uShB.value.set(_sB.x * 0.5 + 0.5, _sB.y * 0.5 + 0.5);
    u.uShW.value = plumeFx.w / (2 * dist * Math.tan(camera.fov * DEG / 2));
    u.uShK.value = plumeFx.k;
  }

  // ---------- Section 8: the rig link, easy to read ----------
  // Tunable strengths (lengths m, times s, opacities 0–1)
  const RL = {
    tagMs: 4000,      // push result line under the dial
    insAfter: 2000,   // the inset stays this long (ms) after a recovery, then fades out
    insFade: 400,
  };
  // Instruction strip (the rig/gust prompts; the cinematic banners stay off): a fixed message, or a countdown cue
  const stripEl = $('lndPrompt');
  let stripMsg = null, cue = null, stripDig = null, stripPrev = '';   // cue: { at (s into the TVC phase), kind: 'push' | 'gust' }
  function setStrip(html, ms, cls = '') { stripMsg = { html, until: performance.now() + ms, cls }; }
  // ---------- Broadcast presentation: letterbox bars, lower-third captions, clean feed (H) ----------
  // Outside the HUD, so they stay in the clean feed. Bars (2.39:1) for the orbit idle, the deorbit burn and the hero ending.
  const barsEl = document.createElement('div'); barsEl.className = 'lnd-bars'; barsEl.innerHTML = '<i></i><i></i>'; $('landing').appendChild(barsEl);
  const lowerEl = document.createElement('div'); lowerEl.className = 'lnd-lower'; lowerEl.innerHTML = '<div class="t"></div><div class="s"></div>'; $('landing').appendChild(lowerEl);
  const hintEl = document.createElement('div'); hintEl.className = 'lnd-cleanhint'; hintEl.textContent = 'Clean feed · H shows the controls'; $('landing').appendChild(hintEl);
  let lowerT = 0;
  function lower(title, sub, ms = 4200) {
    lowerEl.querySelector('.t').textContent = title; lowerEl.querySelector('.s').textContent = sub || ''; lowerEl.querySelector('.s').hidden = !sub;
    lowerEl.classList.remove('show'); void lowerEl.offsetWidth; lowerEl.classList.add('show');
    clearTimeout(lowerT); lowerT = setTimeout(() => lowerEl.classList.remove('show'), ms);
  }
  function captions() {   // once per run each, from the run's own numbers
    const C = calls;
    if (state === 'entry') {
      if (!C.capEI && ent.h) { C.capEI = 1; lower('ENTRY INTERFACE', `${Math.round(ent.h / 1000)} km · ${Math.round(ent.v * 3.6).toLocaleString('en-US')} km/h`); }
      if (!C.capPk && ent.u > 0.57) { C.capPk = 1; lower('PEAK HEATING', `${$('lndQ').textContent} MW/m² · tiles ${$('lndTile').textContent} °C`); }
    }
    if (state === 'flight') { const s = flight.s;
      if (s.phase === 'belly' && !C.capBF && tBreak !== null) { C.capBF = 1; lower('BELLY FLOP', `${(s.h / 1000).toFixed(1)} km · ${Math.round(Math.hypot(s.vh, s.vx ?? 0) * 3.6).toLocaleString('en-US')} km/h · flaps steering`); }
      if (s.phase === 'flip' && !C.capFl) { C.capFl = 1; lower('FLIP · LANDING BURN', 'three centre engines · belly-first to upright'); }
      if (s.phase === 'tvc' && !C.capTv) { C.capTv = 1; lower('TVC IN CONTROL', source === 'rig' ? 'flown by the real rocket on the desk rig' : 'simulated Nano controller · MPU6050 + two servos'); }
      if (C.gustAt != null && simClock > C.gustAt + 1.6) { const p = $('lndPush').textContent.trim(); C.gustAt = null; lower('GUST RESPONSE', p ? p.replace(/\s+/g, ' ') : 'the controller pushes back'); }
    }
  }
  const letterbox = on => barsEl.classList.toggle('on', on);
  addEventListener('keydown', e => {
    if (document.body.dataset.tab !== 'landing' || e.target.closest?.('input, select, textarea')) return;
    if (e.key === 'h' || e.key === 'H') { const on = document.body.classList.toggle('clean-feed'); hintEl.classList.toggle('show', on); if (on) setTimeout(() => hintEl.classList.remove('show'), 2200); dispatchEvent(new Event('resize')); }
  });
  function stripStep() {
    const s = flight.s, t = s.phase === 'tvc' ? s.t - s.tPh : 0;
    let html = '', cls = '';
    const msgOn = stripMsg && performance.now() < stripMsg.until;
    if (cue && state === 'flight' && s.phase === 'tvc') {
      const rem = cue.at - t, push = cue.kind === 'push';
      if (rem < (push ? -2.5 : -1.5)) cue = null;
      else if (rem > 0.05) {   // countdown digit cross-fades (old one stacked under the new one)
        const n = Math.ceil(rem), o = stripDig !== null && stripDig !== n ? `<i class="o">${stripDig}</i>` : '';
        if (stripDig !== n) { stripPrev = o; stripDig = n; }
        html = `${msgOn && stripMsg.cls === 'tvcon' ? stripMsg.html + ' · ' : ''}${push ? 'Push the rocket in' : 'Gust in'} <b class="d">${stripPrev}<i>${n}</i></b>`;
      }
      else { html = push ? '<b>Push the rocket</b> · now' : '<b>Gust</b>'; cls = 'now'; }
    } else if (!['flight', 'falling', 'tipping'].includes(state)) cue = null;
    if (!cue) stripDig = null;
    if (!html && msgOn) { html = stripMsg.html; cls = stripMsg.cls === 'tvcon' ? '' : stripMsg.cls; }
    if (html) { if (stripEl.innerHTML !== html) stripEl.innerHTML = html; }   // empty: keep the last text and fade it out
    stripEl.className = 'lnd-prompt ' + cls + (html ? '' : ' off');
    return cue && !(cls === 'now');   // counting down
  }

  // The rig link stays off the ship: the plumes, the lean and the RCS show the TVC working
  let pushOn = false;
  function onPushStart() { pushOn = true; }

  // Push result under the TVC dial: "Push 9.0° → 0 in 0.33 s" (or LOST past the abort); fades after RL.tagMs
  const tagEl = $('lndPush');
  let tagUntil = 0, insPin = false, insLast = -1e9, insSeen = -1e9;   // insPin: R keeps the inset on; insLast: last recovery
  function showTag(html, cls = '', ms = RL.tagMs) { tagEl.innerHTML = html; tagEl.className = 'lnd-push on ' + cls; tagUntil = performance.now() + ms; }
  function tagStep() { if (tagEl.classList.contains('on') && performance.now() > tagUntil) tagEl.classList.remove('on'); }

  // Inset: our rocket (CAD, models/sldp45.glb, without the desk rig) drawn as an outline, turned to the ship's attitude
  // through the whole flight (orbit to touchdown) with its nozzle tube on the ship's gimbal angles
  const insEl = $('lndSphere'), insScene = new THREE.Scene();
  const insR = new THREE.WebGLRenderer({ alpha: true, antialias: true }); insR.setClearColor(0x000000, 0); insEl.appendChild(insR.domElement);
  const insCam = new THREE.PerspectiveCamera(30, 1, 0.01, 20);
  insCam.position.set(1.15, 0.55, 1.45); insCam.lookAt(0, 0.0, 0);
  // The sphere: a glass ball fixed to the world round your rocket (centred on its pivot). Inside: the sky above, Mars below
  // the horizon; on it, rings at 10° and 25° (abort) from straight up, and a dot where the nose points.
  const SPH_R = 0.44;
  const sphGlass = new THREE.Mesh(new THREE.SphereGeometry(SPH_R, 48, 32), new THREE.ShaderMaterial({ transparent: true, depthWrite: false,
    vertexShader: 'varying vec3 vN, vV; void main(){ vec4 w = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-w.xyz); gl_Position = projectionMatrix * w; }',
    fragmentShader: 'varying vec3 vN, vV; void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 2.5); gl_FragColor = vec4(vec3(0.9, 0.94, 1.0), 0.05 + 0.65 * f); }' }));
  sphGlass.renderOrder = 4;
  const sphIn = new THREE.Mesh(new THREE.SphereGeometry(SPH_R * 0.995, 48, 32), new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.BackSide,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vP; void main(){ float y = vP.y / ${SPH_R.toFixed(3)};
      vec3 c = y < 0.0 ? mix(vec3(0.5, 0.36, 0.28), vec3(0.3, 0.22, 0.18), -y) : mix(vec3(0.24, 0.3, 0.42), vec3(0.1, 0.12, 0.2), y);
      gl_FragColor = vec4(c, y < 0.0 ? 0.26 : 0.4); }` }));   // the ground a pale wash: it reads as Mars, not as a warning
  sphIn.renderOrder = -1;
  const ringLine = (polar, col, op, dash) => { const pts = []; for (let i = 0; i <= 96; i++) { const a = i / 96 * Math.PI * 2; pts.push(new THREE.Vector3(Math.sin(polar) * Math.cos(a) * SPH_R, Math.cos(polar) * SPH_R, Math.sin(polar) * Math.sin(a) * SPH_R)); }
    const g = new THREE.BufferGeometry().setFromPoints(pts), m = dash ? new THREE.LineDashedMaterial({ color: col, transparent: true, opacity: op, dashSize: 0.02, gapSize: 0.014, depthWrite: false }) : new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: op, depthWrite: false });
    const l = new THREE.Line(g, m); if (dash) l.computeLineDistances(); l.renderOrder = 3; return l; };
  const sphRings = [ringLine(Math.PI / 2, 0xffffff, 0.45, false), ringLine(10 * DEG, 0xffffff, 0.35, false), ringLine(25 * DEG, 0xff4d5e, 0.85, true)];
  const sphNose = new THREE.Mesh(new THREE.SphereGeometry(0.018, 12, 8), new THREE.MeshBasicMaterial({ color: 0x5b8cff, depthTest: false })); sphNose.renderOrder = 6;
  insScene.add(sphIn, sphGlass, sphNose, ...sphRings);
  insEl.insertAdjacentHTML('beforeend', '<span class="sph-lbl sky">Sky</span><span class="sph-lbl mars">Mars</span>');
  insScene.add(new THREE.HemisphereLight(0xcfd8ff, 0x3a2a20, 1.1));
  { const k = new THREE.DirectionalLight(0xffffff, 2.2); k.position.set(2, 3, 2); insScene.add(k);
    const r2 = new THREE.DirectionalLight(0xff9a60, 0.8); r2.position.set(-2, -1, -1.5); insScene.add(r2); }
  const IMM = 0.00108, I_CG = 247, I_GIM = 37, I_TUBE_BELOW = 57;
  const insRocket = new THREE.Group();
  const insAir = new THREE.Group(); insAir.position.y = -I_CG * IMM; insRocket.add(insAir);
  const insTvc = new THREE.Group(); insTvc.position.y = I_GIM * IMM; insTvc.rotation.order = 'XZY'; insAir.add(insTvc);
  const insInner = new THREE.Group(); insInner.position.y = I_GIM * IMM; insAir.add(insInner);
  insScene.add(insRocket);
  const insFlame = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.14, 16, 1, true).rotateX(Math.PI).translate(0, -0.07, 0),
    new THREE.MeshBasicMaterial({ color: 0xffa860, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
  insFlame.position.y = -I_TUBE_BELOW * IMM; insTvc.add(insFlame);
  const insArrowMat = c => new THREE.MeshBasicMaterial({ color: c, depthTest: false, transparent: true });
  const insArrow = c => { const g = new THREE.Group(); const m = insArrowMat(c);
    const sh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 10).translate(0, 0.5, 0), m), hd = new THREE.Mesh(new THREE.ConeGeometry(2.4, 4, 14).translate(0, 2, 0), m);
    sh.renderOrder = hd.renderOrder = 5; g.add(sh, hd); g.userData = { sh, hd }; insScene.add(g); return g; };
  const insGim = insArrow(0xff8a3d), insTilt = insArrow(0x5b8cff);
  function setInsArrow(g, o, d, len, alpha) {
    g.visible = alpha > 0.01; if (!g.visible) return;
    const th = 0.006, { sh, hd } = g.userData;
    g.position.copy(o); g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    sh.scale.set(th, Math.max(len - th * 4, 0.001), th); hd.position.y = Math.max(len - th * 4, 0.001); hd.scale.setScalar(th);
    sh.material.opacity = alpha;
  }
  // The outline: per part a depth-only pass, a silhouette (back faces pushed out a fixed number of pixels), a faint fill
  // and the crease edges. The fill's depth hides the far side and whatever sits inside the body.
  const OUT_COL = 0xcfe0ff, OUT_PX = 1.1;
  const outPx = { value: new THREE.Vector2(1, 1) };   // the outline width as a fraction of the canvas: OUT_PX / size
  const insDepth = new THREE.MeshBasicMaterial({ colorWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const insFill = new THREE.MeshBasicMaterial({ color: 0x0b1222, transparent: true, opacity: 0.42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const insHull = new THREE.ShaderMaterial({ side: THREE.BackSide, uniforms: { uPx: outPx, uCol: { value: new THREE.Color(OUT_COL) } },
    vertexShader: `uniform vec2 uPx; void main(){ vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      vec2 n = (projectionMatrix * vec4(normalMatrix * normal, 0.0)).xy; float l = length(n);
      if (l > 1e-6) p.xy += n / l * uPx * 2.0 * p.w; gl_Position = p; }`,
    fragmentShader: 'uniform vec3 uCol; void main(){ gl_FragColor = vec4(uCol, 0.95); }', transparent: true });
  const insEdge = new THREE.LineBasicMaterial({ color: OUT_COL, transparent: true, opacity: 0.6 });
  const RIG_PART = /^[1-6] |Head\/nut|^M3x/;   // the desk rig (collar, tabs, rings, arm, base) and its fasteners
  let insReady = false;
  new GLTFLoader().load('models/sldp45.glb', gltf => {   // same URL as the Bench tab: the browser serves it from cache
    gltf.scene.traverse(o => {
      if (!o.isMesh) return;
      const [grp, col, name = ''] = o.name.split('|');
      if (grp === 'fixed' || grp === 'middle' || RIG_PART.test(name) || col === 'sled') return;   // the rocket only (the sleds sit inside)
      const g = new THREE.Group(); g.scale.setScalar(IMM);
      const geo = o.geometry, hull = mergeVertices(geo.clone().deleteAttribute('normal').deleteAttribute('uv'), 0.05); hull.computeVertexNormals();
      const dp = new THREE.Mesh(geo, insDepth), fill = new THREE.Mesh(geo, insFill), sil = new THREE.Mesh(hull, insHull),
        edge = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 32), insEdge);
      dp.renderOrder = 0; sil.renderOrder = 1; fill.renderOrder = 2; edge.renderOrder = 2; g.add(dp, sil, fill, edge);
      if (grp === 'inner') { g.position.y = -I_GIM * IMM; insInner.add(g); }
      else if (grp === 'tube') { g.position.y = -I_GIM * IMM; insTvc.add(g); }
      else insAir.add(g);
    });
    insReady = true;
  }, undefined, err => console.warn('Inset model not loaded:', err));
  const _io = new THREE.Vector3(), _id = new THREE.Vector3(), _iu = new THREE.Vector3(), _cc = new THREE.Color();
  // Shown only when it matters: each push or gust countdown, the push, RL.insAfter after the recovery, and (rig) while
  // asked to hold still; R pins it on. Fades out over RL.insFade.
  function insetStep(counting) {
    // The sphere follows the ship from orbit to touchdown (with the link on); it lights up when it matters: each push or
    // gust countdown, the push, RL.insAfter after the recovery, and (rig) while asked to hold still.
    const s = flight.s, now = performance.now(), tvcOn = (state === 'flight' && s.phase === 'tvc') || state === 'falling' || state === 'tipping';
    const hold = source === 'rig' && state === 'flight' && ((s.phase === 'belly' && calls.hold) || s.phase === 'flip');
    const want = insPin || !!counting || pushOn || hold || (tvcOn && now - insLast < RL.insAfter);
    insEl.classList.toggle('hot', want); insEl.classList.remove('idle');
    insEl.classList.toggle('live', source === 'rig' && rigLive());
    // The landing rings mean something once the TVC has the ship: dim before
    const rk = tvcOn || state === 'landed' ? 1 : 0.35;
    sphRings[1].material.opacity = 0.35 * rk; sphRings[2].material.opacity = 0.85 * rk;
    if (!insReady) return true;
    // The ship as drawn: its attitude, and its nozzle gimbal (the flip's is drawn 1.6× larger; the tube stops at 12°)
    insRocket.quaternion.copy(ship.quaternion);
    const flipG = state === 'flight' && s.phase === 'flip' ? 1 / 1.6 : 1, lim = 12 * DEG;
    const gx = clamp(tvc.rotation.x * flipG, -lim, lim), gz = clamp(tvc.rotation.z * flipG, -lim, lim);
    insTvc.rotation.set(gx, 0, gz); insInner.rotation.x = gx;
    const firing = (state === 'flight' && (s.phase === 'tvc' || (s.phase === 'flip' && flipT() > IGN[0]))) || state === 'falling' || (state === 'deorbit' && vacLevel(et).some(x => x > 0.05));
    insFlame.visible = firing; insFlame.scale.set(1, 0.8 + 0.3 * Math.random(), 1);
    _iu.set(0, 1, 0).applyQuaternion(insRocket.quaternion); sphNose.position.copy(_iu).multiplyScalar(SPH_R);
    insRocket.updateWorldMatrix(true, true);
    const tl = Math.acos(clamp(_iu.y, -1, 1)) / DEG, gAng = Math.hypot(gx, gz) / DEG;
    _io.copy(_iu).multiplyScalar(0.36 * IMM / 0.001); _id.set(_iu.x, 0, _iu.z);
    if (tvcOn && _id.lengthSq() > 1e-8) setInsArrow(insTilt, _io, _id.normalize(), 0.05 + 0.006 * Math.min(tl, 20), sstep(0.4, 1.4, tl)); else insTilt.visible = false;
    insTvc.updateWorldMatrix(true, false);
    _id.set(0, -1, 0).transformDirection(insTvc.matrixWorld); _io.set(0, -I_TUBE_BELOW * IMM, 0).applyMatrix4(insTvc.matrixWorld);
    _id.addScaledVector(_iu, -_id.dot(_iu));
    if (firing && _id.lengthSq() > 1e-8 && gAng > 0.4) setInsArrow(insGim, _io, _id.normalize(), 0.04 + 0.008 * Math.min(gAng, 16), sstep(0.4, 1.4, gAng)); else insGim.visible = false;
    return true;
  }
  function renderInset() {
    const w = insEl.clientWidth, h = insEl.clientHeight;
    if (w < 4) return;
    const pr = Math.min(2, devicePixelRatio || 1);
    if (insR.getPixelRatio() !== pr) insR.setPixelRatio(pr);
    const c = insR.domElement; if (c.width !== Math.round(w * pr) || c.height !== Math.round(h * pr)) insR.setSize(w, h, true);
    insCam.aspect = w / h; insCam.updateProjectionMatrix(); outPx.value.set(OUT_PX / w, OUT_PX / h);
    insR.render(insScene, insCam);
  }
  function rigLinkStep(dt) {
    const counting = stripStep();
    tagStep();
    if (!linkOn) return false;
    return insetStep(counting);
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
  const engDots = [...document.querySelectorAll('#lndEng circle:not(.ring)')];
  let hudT = performance.now(), hudV = 0, hudVx = 0, hudVz = 0, gS = 0;
  // Mission clock: T+ from the deorbit burn, in mission time (the entry's time warp counts at its rate); stops at the end
  let mClock = null, mClockT = performance.now();
  function clockStep(s, orb) {
    const now = performance.now(), hdt = Math.min(0.25, (now - mClockT) / 1000); mClockT = now;
    if (state === 'orbit') mClock = null;
    else if (mClock === null) mClock = 0;
    else if (running() && !paused) mClock += hdt * (state === 'entry' ? (ent.w ?? 1) : 1);
    const t = mClock ?? 0, hh = Math.floor(t / 3600), mm = Math.floor(t / 60) % 60, ss = Math.floor(t) % 60, p2 = n => String(n).padStart(2, '0');
    $('lndClockP').textContent = 'T+'; $('lndClock').textContent = `${p2(hh)}:${p2(mm)}:${p2(ss)}`; $('lndClock').classList.toggle('dim', mClock === null);
  }
  // Timeline: the descent's events along one line (screen positions, not to time), a faint altitude trace above it,
  // and a marker riding along. Deorbit and the flip can be clicked (begin / skip to the flip).
  const TL = [
    { k: 'deorbit', x: 0.06, l: 'Deorbit', go: () => { if (state === 'orbit') goBtn.click(); } },
    { k: 'entry', x: 0.17, l: 'Entry' },
    { k: 'peak', x: 0.37, l: 'Peak heating' },
    { k: 'belly', x: 0.56, l: 'Belly flop' },
    { k: 'flip', x: 0.70, l: 'Flip', go: () => skipToFlip() },
    { k: 'burn', x: 0.76, l: 'Landing burn' },
    { k: 'td', x: 0.97, l: 'Touchdown' },
  ];
  const tlDots = $('lndTlDots');
  TL.forEach((e, i) => { const d = document.createElement(e.go ? 'button' : 'span'); d.className = 'tl-dot' + (i % 2 ? ' lo' : ''); d.style.left = (e.x * 100) + '%';
    d.innerHTML = `<i></i><em>${e.l}</em>`; if (e.go) { d.onclick = e.go; d.title = e.k === 'flip' ? 'Skip to the flip (B)' : 'Begin descent (Space)'; } e.el = d; tlDots.appendChild(d); });
  { // altitude trace (log scale, 100 m … 200 km) over the same screen positions
    const H = x => x < 0.17 ? 200e3 : x < 0.56 ? 200e3 * Math.pow(8e3 / 200e3, Math.pow((x - 0.17) / 0.39, 0.7)) : x < 0.70 ? lerp(8e3, FLIP_H, (x - 0.56) / 0.14) : x < 0.76 ? lerp(FLIP_H, 2.9e3, (x - 0.7) / 0.06) : x < 0.97 ? 2.9e3 * Math.pow(1 - (x - 0.76) / 0.21, 1.6) + 1 : 1;
    let d = ''; for (let i = 0; i <= 200; i++) { const x = i / 200, y = 38 - 34 * clamp(Math.log10(Math.max(H(x), 100) / 100) / Math.log10(2000), 0, 1); d += (i ? 'L' : 'M') + (x * 1000).toFixed(1) + ' ' + y.toFixed(1); }
    $('lndTlTrace').setAttribute('d', d); }
  let tvcH0 = 0;
  function tlStep(s) {
    let x = 0.02;
    if (state === 'deorbit') x = lerp(0.06, 0.17, clamp(et / L.ENTRY.deorbit, 0, 1));
    else if (state === 'entry') x = lerp(0.17, 0.56, ent.u ?? 0);
    else if (state === 'flight') {
      if (s.phase === 'belly') { x = lerp(0.56, 0.70, clamp((L.H_START - s.h) / (L.H_START - FLIP_H), 0, 1)); tvcH0 = 0; }
      else if (s.phase === 'flip') { x = lerp(0.70, 0.76, clamp((s.t - s.tPh) / 5, 0, 1)); tvcH0 = 0; }
      else { if (!tvcH0) tvcH0 = Math.max(1, s.h); x = lerp(0.76, 0.97, clamp(1 - s.h / tvcH0, 0, 1)); }
    } else if (state !== 'orbit') x = state === 'falling' || state === 'tipping' ? 0.9 : 0.97;
    $('lndTlNow').style.left = (x * 100) + '%'; $('lndTlFill').style.width = (x * 100) + '%';
    let next = null;
    TL.forEach(e => { const done = x >= e.x - 0.002; e.el.classList.toggle('done', done); e.el.classList.remove('next'); if (!done && !next) next = e; });
    if (next && state !== 'orbit') next.el.classList.add('next');
    TL.forEach(e => { if (e.go) e.el.disabled = e.k === 'deorbit' ? state !== 'orbit' : false; });
  }
  function hud() {
    const s = flight.s, orb = inOrbit();
    const alt = orb ? ent.h : state === 'landed' || state === 'crashed' ? 0 : Math.max(0, s.h - groundUnder());
    const blackout = state === 'entry' && ent.h < 80e3 && ent.h > 40e3 && !paused;
    $('landing').classList.toggle('lnd-blackout', blackout);
    $('lndAlt').textContent = blackout ? (Math.random() < 0.15 ? '—' : '- -') : alt >= 1000 ? (alt / 1000).toFixed(alt >= 1e5 ? 0 : alt >= 1e4 ? 1 : 2) : alt.toFixed(alt < 10 ? 1 : 0);
    $('lndAltU').textContent = alt >= 1000 ? 'km' : 'm';
    const flying = state === 'flight' || state === 'falling';
    const vs = orb ? (state === 'entry' ? -ent.v * Math.sin((4 + 36 * ent.u) * DEG) : 0) : flying ? s.vh : 0;
    $('lndVs').textContent = Math.abs(vs).toFixed(1); $('lndVsArrow').textContent = vs < -0.05 ? '↓' : vs > 0.05 ? '↑' : '·';
    const spd = orb ? ent.v : flying ? Math.hypot(s.vx, s.vh, s.vz) : 0;
    if (blackout) $('lndVs').textContent = '—';
    $('lndSpd').textContent = blackout ? '—' : (spd * 3.6).toLocaleString('en-US', { maximumFractionDigits: 0 });
    const thr = orb ? (state === 'deorbit' ? vacLevel(et).reduce((x, y) => x + y) / 3 : 0) : curThr();
    $('lndThr').style.width = `${clamp(thr, 0, 1) * 100}%`;
    $('lndThrV').textContent = `${Math.round(clamp(thr, 0, 1) * 100)}%`;
    { const fs = flight.s, n = state === 'landed' && land ? Math.max(0, landPlume().n) : state === 'flight' ? (fs.phase === 'tvc' ? fs.eng : fs.phase === 'flip' ? 3 : 0) : state === 'falling' || state === 'tipping' ? Math.max(0, fallPlume().n) : 0;
      const vac = state === 'deorbit' ? vacLevel(et) : [0, 0, 0];   // the three vacuum engines: the deorbit burn
      engDots.forEach((d, i) => d.classList.toggle('on', i < 3 ? i < n : vac[i - 3] > 0.05));
      $('lndEngN').textContent = `${Math.min(n, 3) + vac.filter(x => x > 0.05).length} / 6`; }
    // Mach (Mars air, ~240 m/s) and the felt G (what the crew would feel: acceleration minus gravity; 0 in orbit)
    { const now = performance.now(), hdt = Math.min(0.5, Math.max(1e-3, (now - hudT) / 1000)); hudT = now;
      let a = 0;
      if (orb) { const v = state === 'entry' ? ent.v : L.ENTRY.v0; a = state === 'entry' ? Math.abs(v - hudV) / hdt / Math.max(1, ent.w ?? 1) : state === 'deorbit' ? thr * 0.6 : 0; hudV = v; }
      else if (flying) { const ax = (s.vx - hudVx) / hdt, ay = (s.vh - hudV) / hdt + L.G, az = (s.vz - hudVz) / hdt; a = Math.hypot(ax, ay, az); hudV = s.vh; hudVx = s.vx; hudVz = s.vz; }
      else if (state === 'landed') a = L.G;
      gS += (a / 9.81 - gS) * Math.min(1, hdt * 3);
      const hi = orb && alt > 60e3;
      $('lndMach').textContent = blackout || hi ? 'Mach —' : 'Mach ' + (spd / 240).toFixed(spd / 240 >= 10 ? 0 : 1);
      $('lndG').textContent = gS.toFixed(2) + ' G'; }
    $('lndTtgW').hidden = !(state === 'flight' && s.phase === 'tvc');
    $('lndLegs').classList.toggle('on', state !== 'orbit' && state !== 'deorbit' && state !== 'entry' && legT >= LEGS_DONE);
    const dp = orb ? null : flight.drift;
    $('lndDrift').textContent = dp === null ? '—' : dp >= 1000 ? (dp / 1000).toFixed(2) + ' km' : dp.toFixed(0) + ' m';
    $('lndTtg').textContent = state === 'flight' && s.phase === 'tvc' ? flight.ttg.toFixed(0) + ' s' : '—';
    $('lndWarp').hidden = state !== 'entry';
    $('lndPhase').textContent = paused ? 'PAUSED' : lost ? 'SIGNAL LOST'
      : state === 'orbit' ? 'MARS ORBIT · 200 KM'
      : state === 'deorbit' ? 'DEORBIT BURN'
      : state === 'entry' ? (blackout ? 'PLASMA BLACKOUT' : ent.I > 0.15 ? 'ENTRY · PLASMA' : 'ATMOSPHERIC ENTRY')
      : state === 'flight' ? (s.phase === 'belly' ? (flipEta(s) < 3.2 ? 'FLIP IN ' + Math.ceil(flipEta(s)) : flipEta(s) < 5.5 ? 'BELLY FLOP · ENGINE CHILL' : 'BELLY FLOP') : s.phase === 'flip' ? `FLIP · GIMBAL ${Math.round(Math.max(Math.abs(tvc.rotation.x), Math.abs(tvc.rotation.z)) / DEG)}°` : s.h > 20 ? (source === 'rig' ? 'TVC LANDING · RIG' : 'TVC LANDING') : 'FINAL METRES')
      : state === 'falling' ? 'LOSS OF CONTROL' : state === 'tipping' ? 'TIPPING OVER'
      : outcome?.title ?? '';
    $('lndPhase').classList.toggle('warn', blackout || lost || state === 'falling' || state === 'tipping' || (endState === 'crashed'));
    clockStep(s, orb);
    tlStep(s);
    // TVC readouts beside the sphere: the TVC's own tilt and nozzle (without the autopilot's lean)
    // Before the TVC: the ship's pitch and its tilt off vertical; in the rig's hold-still calls, the real rocket's lean
    const tvcOn = state === 'flight' && s.phase === 'tvc' || state === 'falling' || (ended() && td);
    const rigHold = source === 'rig' && rig && rigLive() && state === 'flight' && ((s.phase === 'belly' && calls.hold) || s.phase === 'flip');
    let a = dev;
    if (!tvcOn) {
      _up.set(0, 1, 0).applyQuaternion(ship.quaternion);
      const lit = state === 'flight' && s.phase === 'flip' && flipT() > IGN[0], gk = 1 / DEG / 1.6;
      a = { tiltX: Math.asin(clamp(_up.z, -1, 1)) / DEG, tiltY: Math.atan2(_up.x, _up.y) / DEG, gx: lit ? tvc.rotation.x * gk : null, gy: lit ? -tvc.rotation.z * gk : null };
    }
    if (rigHold) {
      const t = L.tiltOf(rig.tiltX, rig.tiltY);
      $('lndTiltL').textContent = 'Rig · hold still'; $('lndTilt').textContent = t.toFixed(1) + '°'; $('lndTilt').className = t > 5 ? 'amber' : '';
    } else if (!tvcOn) {
      const pitch = orb ? ((curPitch % 360) + 360) % 360 : s.tilt;
      $('lndTiltL').textContent = 'Pitch'; $('lndTilt').textContent = pitch.toFixed(0) + '°'; $('lndTilt').className = '';
    } else {
      const t = L.tiltOf(a.tiltX, a.tiltY);
      $('lndTiltL').textContent = 'TVC tilt'; $('lndTilt').textContent = t.toFixed(1) + '°';
      $('lndTilt').className = t > 15 ? 'warn' : t > 8 ? 'amber' : '';
    }
    $('lndTX').textContent = sgn(a.tiltX) + '°'; $('lndTY').textContent = sgn(a.tiltY) + '°';
    $('lndGX').textContent = a.gx == null ? '—' : sgn(a.gx) + '°'; $('lndGY').textContent = a.gy == null ? '—' : sgn(a.gy) + '°';
    const live = rigLive(), src = $('lndSource');
    src.classList.toggle('live', source === 'rig' && live); src.classList.toggle('sim', source === 'sim');
    $('lndSrcTitle').textContent = source === 'sim' ? 'SIMULATED TVC' : live ? (rig?.demo ? 'RIG · BENCH DEMO FEED' : 'RIG · LIVE') : 'RIG · NO DATA';
    const attEl = $('lndAtt'); attEl.classList.toggle('live', source === 'rig' && live); attEl.classList.toggle('sim', source === 'sim'); attEl.classList.toggle('nodata', source === 'rig' && !live);
    $('lndAttSrc').textContent = source === 'sim' ? (att.tvc ? 'TVC · Nano · sim' : 'TVC · off') : live ? (rig?.demo ? 'TVC · rig · demo feed' : 'TVC · rig · live') : 'TVC · rig · no data';
    $('lndSrcSub').innerHTML = source === 'sim'
      ? (att.tvc ? 'Autopilot through the flip, then the Nano’s controller holds it to touchdown. <b>Gust</b> (G) shoves it.' : 'TVC is <b>off</b>: after the flip nothing holds it upright.')
      : live ? 'Autopilot through the flip, then the ship follows the real rocket. <b>Push it</b> and watch the TVC fight back.'
      : 'Connect the Arduino (top bar) or switch to <b>Sim</b>.';
    $('lndHelp').title = $('lndSrcTitle').textContent + ' — ' + $('lndSrcSub').textContent + '\nKeys: Space play · B skip to flip · G gust · I link · H clean feed';
    if (state === 'orbit') goBtn.disabled = source === 'rig' && !live;
  }

  // ---------- Effects per frame (ground scene) ----------
  const _ex = new THREE.Vector3();
  // Flip effects carried into the TVC phase (tunable)
  const TFX = { gimbal: 1.5, buffet: [0.45, 0.3, 0.18], cutKick: 0.5, rcsOn: 10, rcsKick: 0.3, camLean: 2, rcsSize: 5 };   // buffet by engines lit [3, 2, 1]; rcsOn in deg/s
  const _rv = new THREE.Vector3(), lastUp = new THREE.Vector3(0, 1, 0);
  let rcsOn = false, rcsK = 0, wispK = 1;
  function effects(dt) {
    const sp = ship.position;
    // TVC landing: the cloud deck (6.6–8.1 km) is far above; seen from the low cameras its sprites read as cartoon puffs, so fade it out
    if (state === 'flight' && wisps.length) { const k = flight.s.phase === 'tvc' ? 1 - sstep(0, 1.2, flight.s.t - flight.s.tPh) : shotName === 'track' ? 0 : 1;
      if (k !== wispK) { wispK = k; wisps.forEach(w => { w.material.opacity = w.userData.op * k; w.visible = k > 0.01; }); } }
    _up.set(0, 1, 0).applyQuaternion(ship.quaternion);
    if (state === 'flight' && flight.s.phase === 'belly') {   // dust in the air rushing past
      const s = flight.s, v = Math.hypot(s.vx, s.vh), n = Math.round(clamp((v - 60) / 60, 0, 5));
      for (let i = 0; i < n; i++) {
        const ahead = rnd(40, 200);
        dust.emit({ x: sp.x + s.vx / v * ahead + rnd(-70, 70), y: sp.y + s.vh / v * ahead + rnd(-50, 50), z: sp.z + rnd(-90, 90),
          vx: 0, vy: 0, vz: 0, life: rnd(0.5, 1.1), s0: 0.6, s1: 1.4, a: 0.35, drag: 0, rgb: STREAK });
      }
    }
    if (state === 'flight' && flight.s.rcs) {   // flip: nose RCS jets; a big burst to start the swing and to stop it
      const s = flight.s, nose = _pv.copy(sp).addScaledVector(_up, NOSE * 0.8), side = Math.sign(s.rcs);
      const burst = side !== rcsSide; rcsSide = side;
      if (burst) shake = Math.max(shake, 0.4);
      const n = burst ? 16 : Math.random() < 0.85 ? Math.round(2 + 4 * Math.abs(s.rcs)) : 0, v = burst ? 70 : 50;
      for (let i = 0; i < n; i++) dust.emit({ x: nose.x, y: nose.y, z: nose.z + rnd(-3, 3), vx: -_up.y * v * side * rnd(0.6, 1) + s.vx, vy: _up.x * v * side * rnd(0.6, 1) + s.vh, vz: rnd(-6, 6),
        life: rnd(0.4, burst ? 1.2 : 0.8), s0: 2, s1: burst ? 14 : 9, a: 0.85, drag: 2.5, rgb: [1, 1, 1] });
    } else if (state === 'flight' && flight.s.phase === 'tvc' && !paused) {
      // TVC landing: purely the gimbal (no nose jets). When the nose swings fast, the camera operators lean with it
      _rv.copy(_up).sub(lastUp).divideScalar(Math.max(dt, 1e-3)); _rv.y = 0; lastUp.copy(_up);
      const w = _rv.length() / DEG, on = w > TFX.rcsOn;
      rcsK += ((on ? Math.sign(_rv.x - _rv.z || 1) : 0) - rcsK) * (1 - Math.exp(-dt * 6));
      rcsOn = on; rcsSide = 0;
    } else { rcsSide = 0; rcsOn = false; rcsK = 0; lastUp.copy(_up); }
    // Crash: the second blast, then the wreck keeps burning (flames, a smoke column leaning downwind, a flickering light)
    while (blasts.length && simClock >= blasts[0].t) { const b = blasts.shift(); fireball(b.at, CRASH.fireball * 0.7, 0.8); flash.position.set(b.at.x, b.at.y + 12, b.at.z); flash.intensity = 1.5e5; shake = Math.max(shake, 1.2); }
    if (crashT > 0 && !paused) { crashT -= dt; const k = Math.min(1, crashT / 10);
      if (Math.random() < 0.9 * k) for (let i = 0; i < 2; i++) { const a = rnd(0, Math.PI * 2), r = rnd(0, 16);
        fire.emit({ x: crashAt.x + Math.cos(a) * r, y: heightAt(crashAt.x, crashAt.z) + rnd(0, 2), z: crashAt.z + Math.sin(a) * r, vx: rnd(-1, 1), vy: rnd(4, 9), vz: rnd(-1, 1),
          life: rnd(0.6, 1.3), s0: rnd(3, 6), s1: rnd(8, 16), a: rnd(0.4, 0.8), drag: 0.8, g: -2, fire: true }); }
      if (Math.random() < 0.6 * k) dust.emit({ x: crashAt.x + rnd(-10, 10), y: heightAt(crashAt.x, crashAt.z) + rnd(3, 8), z: crashAt.z + rnd(-10, 10), vx: rnd(1, 3), vy: rnd(6, 12), vz: rnd(-1, 1),
        life: rnd(6, 10), s0: 10, s1: rnd(45, 80), a: 0.5, drag: 0.15, rgb: [0.12, 0.1, 0.09] });
      fireLight.position.set(crashAt.x, heightAt(crashAt.x, crashAt.z) + 8, crashAt.z); fireLight.intensity = 3e4 * k * (0.75 + 0.5 * Math.random());
    } else if (crashT <= 0) fireLight.intensity = 0;
    // Landed: tank vents puff white from the aft skirt for a few seconds
    if (state === 'landed' && land && !paused) { const t = simClock - land.t0;
      if (t > 1 && t < 7 && Math.random() < 0.3 * (1 - t / 7)) { const a = rnd(0, Math.PI * 2), p = _pv.copy(ship.position).addScaledVector(_up, -TAIL + rnd(4, 9));
        p.x += Math.cos(a) * R; p.z += Math.sin(a) * R;
        for (let i = 0; i < 3; i++) dust.emit({ x: p.x, y: p.y, z: p.z, vx: Math.cos(a) * rnd(2, 6), vy: rnd(-1, 2), vz: Math.sin(a) * rnd(2, 6),
          life: rnd(1, 2.2), s0: 1, s1: rnd(5, 9), a: 0.35, drag: 1.2, rgb: [1, 1, 1] }); } }
    // Legs: a gas puff at each hinge as its latch lets go, a jolt as each one hits its lock
    if (state === 'flight' && legT > 0 && legEv < 8) for (let i = 0; i < 4; i++) {
      const t = legT - i * LEGS.stag, s = flight.s;
      if (t > 0 && !calls['lu' + i]) { calls['lu' + i] = true; legEv++;
        const h = legs[i].parent; h.getWorldPosition(_pv); _rv.set(Math.cos(-h.rotation.y), 0, Math.sin(-h.rotation.y)).transformDirection(airframe.matrixWorld);
        for (let k = 0; k < LEGS.puff; k++) dust.emit({ x: _pv.x, y: _pv.y + rnd(-0.5, 0.5), z: _pv.z, vx: _rv.x * rnd(8, 20) + s.vx + rnd(-3, 3), vy: _rv.y * rnd(8, 20) + s.vh + rnd(-3, 3), vz: _rv.z * rnd(8, 20) + s.vz + rnd(-3, 3),
          life: rnd(0.3, 0.7), s0: 0.6, s1: 3.5, a: 0.5, drag: 3, rgb: [1, 1, 1] }); }
      if (t > LEGS.swing && !calls['ll' + i]) { calls['ll' + i] = true; legEv++; shake = Math.max(shake, LEGS.kick); }
    }
    // Ground interaction (section 12): a fast flat ring of dust racing out, a curtain rising at its edge, gravel thrown in
    // arcs, and in the last metres dust swirling round the legs; all lit warm from below by the exhaust
    if (plumeFx.on && plumeFx.near > 0 && !paused) {
      const k = plumeFx.near, g = plumeFx.g, gy = g.y, f = dt * 60, D = PLUME.dust * (envLow ? 0.5 : 1) * (0.4 + 0.6 * plumeFx.nk) * (0.5 + 0.5 * plumeFx.te);
      const lit = DUST.map((c, i) => c + ([1, 0.78, 0.55][i] - c) * 0.4 * k), bx = plumeFx.dir.x * 30, bz = plumeFx.dir.z * 30;
      const em = (n, fn) => { for (let i = 0, m = Math.round(n * f + Math.random()); i < m; i++) fn(rnd(0, Math.PI * 2)); };
      em((5 + 38 * k * k) * D, a => { const v = rnd(26, 52) * (0.5 + 0.5 * k);   // the ring, hugging the ground (stops ~70 m out, short of the pad cam)
        dust.emit({ x: g.x + Math.cos(a) * 3, y: gy + 0.5, z: g.z + Math.sin(a) * 3, vx: Math.cos(a) * v + bx, vy: rnd(0.2, 2), vz: Math.sin(a) * v + bz,
          life: rnd(0.7, 1.4), s0: 2, s1: rnd(8, 16) * (0.6 + 0.6 * k), a: 0.28 + 0.2 * k, drag: 1.1, rgb: lit }); });
      em(5 * k * k * D, a => { const r = lerp(10, 32, k) * rnd(0.8, 1.1);        // the curtain rising at its edge
        dust.emit({ x: g.x + Math.cos(a) * r, y: gy + rnd(0.5, 3), z: g.z + Math.sin(a) * r, vx: Math.cos(a) * rnd(4, 12), vy: rnd(4, 12), vz: Math.sin(a) * rnd(4, 12),
          life: rnd(2.5, 4.5), s0: 6, s1: rnd(16, 28), a: 0.12, drag: 0.35, rgb: lit }); });
      if (k > 0.35) em(3 * k * D, a => { const r = rnd(2, 8), v = rnd(25, 60);      // gravel in arcs
        dust.emit({ x: g.x + Math.cos(a) * r, y: gy + 0.4, z: g.z + Math.sin(a) * r, vx: Math.cos(a) * v, vy: rnd(6, 18), vz: Math.sin(a) * v,
          life: rnd(1, 2.2), s0: 0.5, s1: 0.7, a: 0.9, drag: 0.05, g: L.G, rgb: [0.17, 0.12, 0.09] }); });
      if (sp.y - gy < TAIL + FOOT + 10) em(4 * D, a => { const r = rnd(8, 15);      // swirling round the legs
        dust.emit({ x: sp.x + Math.cos(a) * r, y: gy + rnd(0.3, 2), z: sp.z + Math.sin(a) * r, vx: -Math.sin(a) * 12 + Math.cos(a) * 4, vy: rnd(1, 4), vz: Math.cos(a) * 12 + Math.sin(a) * 4,
          life: rnd(1.5, 3), s0: 3, s1: 12, a: 0.28, drag: 0.4, rgb: lit }); });
    }
    devils.forEach(m => { const u = m.userData, t = simClock;   // dust devils wander downwind, swaying
      m.position.x = u.x0 + WX * t * 2 + 40 * Math.sin(t * 0.07 + u.ph); m.position.z = u.z0 + WZ * t * 2 + 40 * Math.cos(t * 0.05 + u.ph);
      m.position.y = heightAt(m.position.x, m.position.z); m.rotation.z = 0.06 * Math.sin(t * 0.3 + u.ph); m.material.uniforms.uT.value = t; });
    if (stormT > 0) {   // the cloud keeps rolling out after touchdown
      stormT -= dt; const s = flight.s;
      for (let i = 0; i < 8; i++) { const a = rnd(0, Math.PI * 2), v = rnd(6, 20);
        dust.emit({ x: s.x + Math.cos(a) * 12, y: s.h + rnd(0, 4), z: s.z + Math.sin(a) * 12, vx: Math.cos(a) * v, vy: rnd(1, 5), vz: Math.sin(a) * v, life: rnd(3, 6), s0: 8, s1: 30, a: 0.35, drag: 0.4, rgb: DUST }); }
    }
    dust.update(dt); fire.update(dt);
    for (const d of junk) {
      if (!d.m.visible) continue;
      d.v.y -= L.G * dt; d.m.position.addScaledVector(d.v, dt);
      d.m.rotation.x += d.w.x * dt; d.m.rotation.y += d.w.y * dt; d.m.rotation.z += d.w.z * dt;
      if (d.smoke && crashT > CRASH.burn - 6 && Math.random() < 0.5 && d.v.lengthSq() > 9) { const p = d.m.position;   // smoke trails off the flying pieces
        dust.emit({ x: p.x, y: p.y, z: p.z, vx: 0, vy: 1, vz: 0, life: rnd(1.5, 3), s0: 2, s1: rnd(6, 12), a: 0.45, drag: 0.5, rgb: [0.14, 0.12, 0.11] }); }
      const g = heightAt(d.m.position.x, d.m.position.z) + (d.r ?? 0.3);
      if (d.m.position.y < g) { d.m.position.y = g; d.v.multiplyScalar(0.35); d.v.y = Math.abs(d.v.y) * 0.4; d.w.multiplyScalar(0.5); }
    }
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
  // ---------- Director: picks the shot, whip-pans between some, then the operator's feel for the camera type ----------
  // Whip-pan: the old shot swings away (accelerating, smeared), the new one swings in (decelerating) — 0.32 s, cut at the middle.
  // Feel: tripods (site, tele, pad) near-still with wind sway, and the shake of an event arrives late, at the speed of sound on
  // Mars (~240 m/s); onboard (hull cam, skirt cam, aft flap ride-along) high-frequency vibration with the air and the engines;
  // drones and chase cameras a slow float. Depth of field on the close shots and the hero orbit (Medium/High); plasma streaks.
  const WHIP_DUR = 0.32, WHIPS = new Set();   // whip-pans: off (plain cuts read better here); add 'from>to' pairs to bring one back
  const FEEL_TRIPOD = new Set(['siteT', 'siteW', 'tele', 'pad']), FEEL_ONBOARD = new Set(['skirt', 'close', 'e1', 'bay']);
  const DOF_AP = { close: 7, flaps: 7, flip: 5, flipLow: 5, hero: 6, track: 8 };   // blur (px at 1080p) at twice the focus distance
  let whip = null, camName = '', camSince = 0;
  const shHist = new Float32Array(512), shT = new Float32Array(512).fill(-1e9); let shI = 0;
  const shakeAt = t => { let v = 0, best = -1e9; for (let i = 0; i < 512; i++) if (shT[i] <= t && shT[i] > best) { best = shT[i]; v = shHist[i]; } return v; };
  const _dA = new THREE.Vector3(), _dB = new THREE.Vector3(), _dV = new THREE.Vector3();
  const entShotIdx = () => Math.max(0, ENT_SHOTS.findIndex(S => ent.u < S.u1));
  function feel(dt, name) {
    shHist[shI] = shake; shT[shI] = simClock; shI = (shI + 1) % 512;
    if (paused) return;
    const t = simClock;
    if (FEEL_TRIPOD.has(name)) {
      camera.rotateX(DEG * (0.012 * Math.sin(t * 0.71) + 0.006 * Math.sin(t * 2.3 + 1)));
      camera.rotateY(DEG * (0.01 * Math.sin(t * 0.53 + 2) + 0.005 * Math.sin(t * 1.9)));
      const sD = shakeAt(t - camera.position.distanceTo(ship.position) / 240);   // the sound of it arrives late
      if (sD > 0.002) { camera.rotateX(rnd(-1, 1) * sD * 0.35 * DEG); camera.rotateY(rnd(-1, 1) * sD * 0.35 * DEG); }
    } else if (FEEL_ONBOARD.has(name)) {
      const q = state === 'entry' ? ent.I : clamp(Math.abs(flight.s.vh) / 320, 0, 1) * 0.6, a = DEG * (0.04 + 0.22 * q + 0.35 * curThr());
      camera.rotateX(a * (0.6 * Math.sin(t * 83) + 0.4 * Math.sin(t * 131 + 1) + rnd(-0.3, 0.3)));
      camera.rotateY(a * (0.6 * Math.sin(t * 97 + 2) + 0.4 * Math.sin(t * 157) + rnd(-0.3, 0.3)));
    } else if (name !== 'track' && name !== 'orbit' && name !== 'deorbit') {   // drone / chase: slow float
      const m = name[0] === 'e' ? 3 : name === 'hero' ? 0.8 : 1.2;
      camera.position.add(_dV.set(Math.sin(t * 0.37), 0.6 * Math.sin(t * 0.29 + 1), Math.cos(t * 0.43)).multiplyScalar(m));
      camera.rotateZ(DEG * 0.25 * Math.sin(t * 0.41));
    }
  }
  function cameraStep(dt) {
    const want = inOrbit() ? (state === 'entry' && camMode !== 'free' ? 'e' + entShotIdx() : state) : camMode === 'still' || camMode === 'free' ? camMode : shot();
    if (!whip && want !== camName) { camSince = simClock; if (camName && !paused && WHIPS.has(camName + '>' + want)) whip = { t: 0, from: camName, to: want, dir: Math.random() < 0.5 ? -1 : 1 }; else camName = want; }
    let use = camName;
    if (whip) { whip.t += paused ? 0 : dt; if (whip.t >= WHIP_DUR / 2) camName = whip.to; use = whip.t < WHIP_DUR / 2 ? whip.from : whip.to; }
    cameraShot(dt, use);
    const g = post.grade.uniforms;
    if (camMode === 'free' || camMode === 'still') { post.dof.enabled = false; g.uMBk.value = g.uStrK.value = 0; return; }
    feel(dt, use);
    if (whip) { const k = clamp(whip.t / WHIP_DUR, 0, 1), a = k < 0.5 ? (2 * k) ** 2 : -((2 * (1 - k)) ** 2);
      camera.rotateY(-whip.dir * 0.42 * a); g.uMBk.value = Math.sin(Math.PI * k); g.uMB.value.set(whip.dir * 0.1, 0); if (whip.t >= WHIP_DUR) whip = null; }
    else g.uMBk.value = 0;
    if (state === 'entry' && ent.I > 0.02 && QUALITY[qName].bloom) {   // plasma: the bright parts smear downstream on screen
      _dV.set(0, 1, 0).applyQuaternion(wake.quaternion); _dA.copy(ship.position).project(camera); _dB.copy(ship.position).addScaledVector(_dV, 60).project(camera);
      g.uStr.value.set((_dB.x - _dA.x) * 0.5, (_dB.y - _dA.y) * 0.5); const L = g.uStr.value.length(); if (L > 0.06) g.uStr.value.multiplyScalar(0.06 / L);
      g.uStrK.value = FEEL_ONBOARD.has(use) ? 0 : ent.I * 0.5;
    } else g.uStrK.value = 0;
    const ap = DOF_AP[use]; post.dof.enabled = !!(ap && QUALITY[qName].dof && !inOrbit());
    if (post.dof.enabled) { const u = post.dof.mat.uniforms; u.uFocus.value = use === 'track' && trk ? trk.focus : camera.position.distanceTo(use === 'hero' ? _dA.copy(hero.c).add(_dV.set(0, hero.how === 'crashed' ? 4 : 22, 0)) : ship.position);
      u.uAp.value = ap * renderer.domElement.height / 1080; u.uMax.value = 10 * renderer.domElement.height / 1080; }
  }
  function setFov(f) {   // zoom only (no buffer resize): projection, the orbit pass, particle sizes
    camera.fov = f; camera.updateProjectionMatrix(); orbit.resize(camera.aspect, f);
    const sc = renderer.domElement.height / (2 * Math.tan(f * DEG / 2)); dust.setScale(sc); fire.setScale(sc); glow.setScale(sc); puffs.setScale(sc); haze.setScale(sc);
  }
  new ResizeObserver(resize).observe(view);

  let last = performance.now(), acc = 0, lastHud = 0, warmed = false;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.1); last = now;
    if (document.body.dataset.tab !== 'landing') return;      // paused while another tab shows
    const sdt = paused ? 0 : dt;
    simClock += sdt;
    captions(); heroStep(); letterbox(false);
    if (inOrbit()) {
      if (!paused) orbitStep(dt); else orbitStep(0);
      cameraStep(dt);
      fadeAmt = ent.fade;
      orbit.set(ent.h / 1000, phi, camera.position, camera.quaternion, simClock);
      // ?sunrise: in the hero idle shots, put the sun disc and glare right on the limb (a film cheat; the light stays real)
      const cheat = SUNRISE && state === 'orbit' && idleI !== 1 && idleI !== 2;
      orbit.setBurstDir(cheat ? SUNRISE_DIR : null);
      orbitFlare.lf.position.copy(cheat ? SUNRISE_DIR : ORB_SUN).multiplyScalar(6e5);
      // Below ~33 km, the last entry shot looks down past the ship onto the real terrain (the ground scene, seen from the
      // ship's place on a compressed approach that ends where the belly flop starts), not the orbit planet's huge craters;
      // the orbit pass still draws the sky and anything beyond the terrain's edge. Not on Low.
      const valley = state === 'entry' && camMode !== 'free' && ENT_SHOTS[+camName.slice(1)]?.valley && camName[0] === 'e' && qName !== 'low';
      if (valley) {
        vCam.position.set(START.x0 - (ent.h - L.H_START) * 1.7, ent.h, flight.s.z ?? 0).add(camera.position); vCam.quaternion.copy(camera.quaternion);
        if (vCam.fov !== camera.fov || vCam.aspect !== camera.aspect) { vCam.fov = camera.fov; vCam.aspect = camera.aspect; vCam.updateProjectionMatrix(); }
        skyU.uAlt.value = ent.h;
      }
      groundSky.visible = !valley; cloudMeshes.forEach(([m]) => { m.visible = !valley; });   // the tiled cloud layers read as a pattern from above
      applyLook(dt);
      post.setMode(true, valley ? vCam : null);
      const insOnO = rigLinkStep(paused ? 0 : dt);
      if (!(warmed && window.tvcCovered?.())) { post.render(dt); if (insOnO) renderInset(); warmed = true; }
    } else {
      acc += sdt;
      while (acc >= L.DT) { acc -= L.DT; simStep(); }
      if (!paused) fallStep(sdt);
      if (state === 'landed' && land) { placeShip(); const lp = landPlume(); setPlume(lp.thr, simClock, 99, lp.n); }
      else if (state === 'falling' || state === 'tipping') { const fp = fallPlume(); setPlume(fp.thr, simClock, 99, fp.n); }
      else { placeShip(); setPlume(state === 'flight' && flight.s.phase !== 'belly' ? flight.s.thr : 0, simClock, state === 'flight' ? flipT() : 99, state === 'flight' && flight.s.phase === 'tvc' ? flight.s.eng : 0); }
      if (!paused) effects(sdt);
      outpost.update({ dt: sdt, t: simClock, state, phase: flight.s.phase, h: flight.s.h - groundUnder(), ship: state === 'flight' ? ship.position : null, landedAt: land?.t0 ?? null, ok: outcome?.ok && !!land });
      if (fadeOut > 0) { fadeOut = Math.max(0, fadeOut - dt); fadeAmt = fadeOut / 0.8; } else fadeAmt = 0;
      { const chase = state === 'flight' && flight.s.phase === 'tvc' && flight.s.h - groundUnder() < 1500, k = Math.floor(simClock * 10);   // in sequence while it comes down
        padLights.forEach((m, i) => { m.visible = chase ? (k % 12 === i || (k + 6) % 12 === i) : Math.floor(simClock * 2 + i / 3) % 2 === 0 || state === 'landed'; }); }
      const lp = ship.position, throwD = Math.max(lp.y, 0) / SUN.y, SC = sun.shadow.camera;
      // Sun shadows: round the ship (±90 m) for the close cameras; over the whole outpost (±760 m) for the far ones, so the
      // buildings throw their shadows across the terrain in the site shots (the cuts between them hide the switch)
      const wideSh = camera.position.distanceTo(lp) > 600, half = wideSh ? 760 : 90, far = wideSh ? 3400 : throwD + 300;
      if (wideSh) { sun.target.position.set(-60, 0, 100); sun.position.copy(sun.target.position).addScaledVector(SUN, 1600); }
      else { sun.target.position.copy(lp).addScaledVector(SUN, -throwD); sun.position.copy(sun.target.position).addScaledVector(SUN, throwD + 120); }
      if (SC.right !== half || Math.abs(SC.far - far) > 30) { SC.left = SC.bottom = -half; SC.right = SC.top = half; SC.far = far; SC.updateProjectionMatrix(); }
      cameraStep(dt);
      flare.lf.position.copy(camera.position).addScaledVector(SUN, 60000);
      applyLook(dt);
      shimmer();
      const insOn = rigLinkStep(paused ? 0 : dt);
      groundSky.visible = true; if (!cloudMeshes[0][0].visible) cloudMeshes.forEach(([m]) => { m.visible = true; }); post.setMode(false);
      if (!(warmed && window.tvcCovered?.())) { post.render(dt); if (insOn) renderInset(); warmed = true; }
    }
    if (now - lastHud > 60) { lastHud = now; hud(); }
    // Frame rate: shown with ?debug; drop a quality level if it stays under 40 fps for 3 s
    fpsN++; fpsT += dt;
    if (fpsT >= 1) {
      const fps = fpsN / fpsT; fpsN = 0; fpsT = 0;
      if (DEBUG) $('lndFps').textContent = fps.toFixed(0) + ' fps · ' + QUALITY[qName].label;
      slow = fps < 40 ? slow + 1 : 0;
      if (slow >= 3 && qName !== 'low' && !DEBUG) { slow = 0; setQuality(Q_ORDER[Q_ORDER.indexOf(qName) + 1]); callout('QUALITY LOWERED · ' + QUALITY[qName].label.toUpperCase(), 1800, 'sys'); }
    }
  }
  let fpsN = 0, fpsT = 0, slow = 0;
  const DEBUG = /[?&]debug/.test(location.search);
  if (DEBUG) {
    $('lndFps').hidden = false;
    window.__base = outpost;   // tests: the outpost (rover, lights)
    // M: the base plan from above (zones, roads, keep-outs, cameras; anything breaking a keep-out in red)
    const mapC = document.createElement('canvas'); mapC.width = mapC.height = 640; drawPlanMap(mapC, outpost.objs, planCams, planBad);
    const mapI = new Image(); mapI.src = mapC.toDataURL(); Object.assign(mapI.style, { position: 'absolute', right: '16px', top: '120px', width: '640px', zIndex: 50, display: 'none', borderRadius: '8px', pointerEvents: 'none' });
    view.appendChild(mapI); const mapC2 = mapI;
    window.addEventListener('keydown', e => { if (e.key === 'm' || e.key === 'M') mapC2.style.display = mapC2.style.display === 'none' ? 'block' : 'none'; });
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
      at(h = 1000) {   // jump the flight to h m above the ground in the TVC landing
        this.flip(0); const s = flight.s;
        for (let n = 0; n < 1e5 && state === 'flight' && !(s.phase === 'tvc' && s.h - groundUnder() <= h); n++) simStep();
      },
      flip(at = 0.4) {   // jump the flight to `at` s into the flip (from the orbit idle or the cloud deck)
        if (state !== 'flight') { if (state === 'orbit') goBtn.click(); cutToGround(); }
        const s = flight.s; for (let n = 0; n < 1e5 && s.phase !== 'tvc' && !(s.phase === 'flip' && s.t - s.tPh >= at); n++) simStep();
      },
      crash(kind = 'tip') {   // test a ground crash: 'tip' (lands leaning 18°) or 'collapse' (lands at 7 m/s)
        this.at(3); const s = flight.s; if (state !== 'flight') return;
        td = { tilt: kind === 'tip' ? 18 : 2, vs: kind === 'tip' ? 1.5 : 7, miss: flight.drift }; s.h = groundUnder(); startTip(kind === 'collapse');
      },
      shot(i, t = 4) { idleI = i; idleT = t; idleHold = true; },
      view(dx = 30, dy = 10, dz = -40, ty = 0) {   // freeze the camera at an offset from the ship (pause first), looking at it
        camMode = 'still'; controls.enabled = false; const p = ship.position; camera.position.set(p.x + dx, p.y + dy, p.z + dz); camera.lookAt(p.x, p.y + ty, p.z);
      },
      pause() { if (!paused) pauseBtn.click(); },   // freeze idle shot i at t seconds
      cam() { const s = flight.s; return { shot: shotName, side: apSide, z: Math.round(s.z), eng: s.eng, fov: +camera.fov.toFixed(1), h: Math.round(s.h - groundUnder()), t: +(s.t - s.tPh).toFixed(1), phase: s.phase, state, tag: tagEl.classList.contains('on') }; },   // TVC-scene state
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
