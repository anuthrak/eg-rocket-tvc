// Mission tab: Earth → Moon flight sim (deliberately not to scale) with the same TVC controller as the Nano.
// step(progress, label) reports to the loading screen and yields a frame before the heavy parts.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const $ = id => document.getElementById(id);

export async function initMission(step) {
  const DEG = Math.PI / 180;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const sstep = s => { s = clamp(s, 0, 1); return s * s * (3 - 2 * s); };
  const smoothstep = (a, b, x) => sstep((x - a) / (b - a));
  const wrapPi = a => Math.atan2(Math.sin(a), Math.cos(a));

  // ---------- Geometry (scene units) ----------
  const RE = 10, RM = 3, MX = 110;            // Earth radius, Moon radius, Moon x-position
  const S2_L = 0.4, B_L = 0.55;                // upper stage length, booster length
  const RPAD = RE + B_L + S2_L / 2;            // stage-2 centre height while on the pad
  const R0 = RPAD + 4;                         // parking orbit radius
  const RL = 5.5;                              // lunar orbit radius (from Moon centre)
  const RLAND = RM + S2_L / 2;                 // stage-2 centre height when landed
  const R_APO = MX - RL;                       // transfer orbit apogee = lunar orbit arrival point
  const ECC = (R_APO - R0) / (R_APO + R0), P_ELL = R0 * (1 + ECC);
  const rEll = th => P_ELL / (1 + ECC * Math.cos(th - Math.PI)); // perigee at 180°, apogee at 360°

  // ---------- Mission timeline (seconds of sim time) ----------
  const T_ASC = 60, T_MECO = 38, T_SEP = 40, T_SES = 43;
  const T_TLI = 20, T_COAST = 100, T_LOI = 15, T_DESC = 30;
  const TH_L = 90 * DEG;     // launch site at the top of Earth
  const TH_C = 200 * DEG;    // where the TLI burn ends and the coast begins
  const W_P = 0.8 * DEG;     // parking-orbit angular rate
  const WL = 6 * DEG;        // lunar-orbit angular rate

  // Coast: angle-vs-time table so speed along the ellipse is roughly constant
  const CN = 4000, cTh = new Float64Array(CN + 1), cCum = new Float64Array(CN + 1);
  for (let i = 0; i <= CN; i++) {
    cTh[i] = TH_C + (2 * Math.PI - TH_C) * i / CN;
    if (i) cCum[i] = cCum[i - 1] + 0.5 * (rEll(cTh[i]) + rEll(cTh[i - 1])) * (cTh[i] - cTh[i - 1]);
  }
  const C_TOT = cCum[CN], H_K = C_TOT / T_COAST;
  function coastTheta(c) {
    let lo = 0, hi = CN;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cCum[m] <= c) lo = m; else hi = m; }
    const f = (c - cCum[lo]) / ((cCum[hi] - cCum[lo]) || 1);
    return cTh[lo] + (cTh[hi] - cTh[lo]) * clamp(f, 0, 1);
  }
  const W_C = H_K / rEll(TH_C);                 // angular rate at the start of the coast
  const TH_TLI0 = TH_C - (W_P + W_C) / 2 * T_TLI;
  const A_ASC = W_P * T_ASC / 2;
  const TH_A = TH_L + A_ASC;
  const T_PARK = (TH_TLI0 - TH_A) / W_P;

  const t_seco = T_ASC, t_tli0 = t_seco + T_PARK, t_tli1 = t_tli0 + T_TLI, t_coast1 = t_tli1 + T_COAST;
  const t_loi1 = t_coast1 + T_LOI, t_mcc = t_tli1 + 0.45 * T_COAST, t_flip = t_coast1 - 15, t_soi = t_coast1 - 20;
  const W0 = H_K / R_APO * R_APO / RL;          // arrival angular rate around the Moon
  const PH_LOI1 = Math.PI - (W0 + WL) / 2 * T_LOI;
  const B_D = WL * T_DESC / 3;
  let sweep = PH_LOI1 - B_D - Math.PI / 2;       // pick orbit time so we land at the top of the Moon
  while (sweep < WL * 20) sweep += 2 * Math.PI;
  while (sweep - 2 * Math.PI >= WL * 20) sweep -= 2 * Math.PI;
  const T_LO = sweep / WL;
  const t_desc0 = t_loi1 + T_LO, t_land = t_desc0 + T_DESC;
  const PH_D0 = PH_LOI1 - WL * T_LO, PH_LAND = PH_D0 - B_D;

  // Position of the upper stage at mission time t
  function posAt(t, out = new THREE.Vector3()) {
    let r, th;
    if (t <= 0) { r = RPAD; th = TH_L; }
    else if (t < T_ASC) { const s = t / T_ASC; th = TH_L + A_ASC * s * s; r = RPAD + (R0 - RPAD) * (1 - Math.pow(1 - s, 1.8)); }
    else if (t < t_tli0) { th = TH_A + W_P * (t - T_ASC); r = R0; }
    else if (t < t_tli1) {
      const tau = t - t_tli0;
      th = TH_TLI0 + W_P * tau + (W_C - W_P) * tau * tau / (2 * T_TLI);
      r = R0 + (rEll(th) - R0) * sstep(tau / T_TLI);
    }
    else if (t < t_coast1) { th = coastTheta((t - t_tli1) / T_COAST * C_TOT); r = rEll(th); }
    else {
      let ph, rr;
      if (t < t_loi1) { const tau = t - t_coast1; ph = Math.PI - (W0 * tau + (WL - W0) * tau * tau / (2 * T_LOI)); rr = RL; }
      else if (t < t_desc0) { ph = PH_LOI1 - WL * (t - t_loi1); rr = RL; }
      else if (t < t_land) { const s = (t - t_desc0) / T_DESC; ph = PH_D0 - B_D * (1 - Math.pow(1 - s, 3)); rr = RLAND + (RL - RLAND) * Math.pow(1 - s * s, 2); }
      else { ph = PH_LAND; rr = RLAND; }
      return out.set(MX + rr * Math.cos(ph), rr * Math.sin(ph), 0);
    }
    return out.set(r * Math.cos(th), r * Math.sin(th), 0);
  }
  const _pa = new THREE.Vector3(), _pb = new THREE.Vector3();
  function velAt(t, out = new THREE.Vector3()) {
    posAt(t + 0.05, _pa); posAt(t - 0.05, _pb);
    return out.subVectors(_pa, _pb).divideScalar(0.1);
  }

  // ---------- State ----------
  let simState = 'idle';  // idle | running | paused | done
  let simT = -10, warp = 1, camMode = 'chase';
  const att = { psi: TH_L, w: 0, chi: 0, wc: 0, gp: 0, gy: 0, rcsP: 0, rcsY: 0 };
  const KT = 30, GMAX = 8 * DEG, GRATE = 60 * DEG; // gimbal authority, limit, slew rate

  function engineAt(t) {
    if (simState === 'idle' || t < -3) return { on: false, thr: 0 };
    if (t < 0) return { on: true, thr: 0.85 * (t + 3) / 3, held: true };
    if (t < T_MECO) return { on: true, thr: (t >= 14 && t < 24) ? 0.72 : 1 };
    if (t < T_SES) return { on: false, thr: 0 };
    if (t < T_ASC) return { on: true, thr: 1 };
    if (t < t_tli0) return { on: false, thr: 0 };
    if (t < t_tli1) return { on: true, thr: 1 };
    if (t >= t_mcc && t < t_mcc + 3) return { on: true, thr: 0.35 };
    if (t < t_coast1) return { on: false, thr: 0 };
    if (t < t_loi1) return { on: true, thr: 1 };
    if (t < t_desc0) return { on: false, thr: 0 };
    if (t < t_land) return { on: true, thr: 0.9 - 0.4 * (t - t_desc0) / T_DESC };
    return { on: false, thr: 0 };
  }

  // Where the guidance wants the nose pointed (angle in the orbit plane)
  const _tv = new THREE.Vector3(), _tp = new THREE.Vector3();
  function targetPsi(t) {
    if (t <= 0) return TH_L;
    if (t >= t_land) { posAt(t, _tp); return Math.atan2(_tp.y, _tp.x - MX); }
    velAt(t, _tv);
    let a = Math.atan2(_tv.y, _tv.x);                 // prograde
    if (t >= t_flip) {
      a += Math.PI;                                    // retrograde for LOI + descent
      if (t > t_desc0) {                               // blend to Moon-vertical for touchdown
        posAt(t, _tp);
        const up = Math.atan2(_tp.y, _tp.x - MX);
        a += wrapPi(up - a) * smoothstep(0.75, 1, (t - t_desc0) / T_DESC);
      }
    }
    return a;
  }

  const noise = (t, s) => 0.5 * Math.sin(1.7 * t + s) + 0.3 * Math.sin(3.9 * t + 2.3 * s) + 0.2 * Math.sin(7.3 * t + 4.1 * s);

  // Attitude dynamics + TVC controller (one small sim step)
  function dynStep(dt) {
    const t = simT;
    const eng = engineAt(t);
    if (t < 0 || eng.held) { att.psi = TH_L; att.w = att.chi = att.wc = 0; att.gp *= 0.9; att.gy *= 0.9; att.rcsP = att.rcsY = 0; return; }
    if (t >= t_land) {
      att.psi = targetPsi(t); att.w = att.wc = 0; att.chi *= 0.9;
      att.gp += clamp(-att.gp, -GRATE * dt, GRATE * dt); att.gy += clamp(-att.gy, -GRATE * dt, GRATE * dt);
      att.rcsP = att.rcsY = 0; return;
    }
    const e = wrapPi(targetPsi(t) - att.psi), ec = -att.chi;
    const q = (t > 0 && t < 45) ? Math.exp(-(((t - 18) / 8) ** 2)) : 0;   // dynamic pressure (peaks at Max-Q)
    const slosh = eng.on ? 1 : 0;
    const dP = q * (1.9 * noise(t, 1.3) + 0.5) + slosh * 0.12 * noise(t * 1.4, 5.1);
    const dY = q * (1.6 * noise(t, 7.7) - 0.3) + slosh * 0.10 * noise(t * 1.2, 2.2);
    let aP, aY;
    if (eng.on && eng.thr > 0.05) {
      // PD controller -> gimbal command (thrust torque ≈ -KT·thr·sin(gimbal))
      const uP = 9 * e - 5 * att.w, uY = 9 * ec - 5 * att.wc;
      const cP = clamp(-uP / (KT * eng.thr), -GMAX, GMAX), cY = clamp(-uY / (KT * eng.thr), -GMAX, GMAX);
      att.gp += clamp(cP - att.gp, -GRATE * dt, GRATE * dt);   // servo slew-rate limit
      att.gy += clamp(cY - att.gy, -GRATE * dt, GRATE * dt);
      aP = -KT * eng.thr * Math.sin(att.gp) + dP;
      aY = -KT * eng.thr * Math.sin(att.gy) + dY;
      att.rcsP = att.rcsY = 0;
    } else {
      // Engine off: nozzle re-centres, cold-gas RCS thrusters steer instead
      att.gp += clamp(-att.gp, -GRATE * dt, GRATE * dt);
      att.gy += clamp(-att.gy, -GRATE * dt, GRATE * dt);
      att.rcsP = clamp(1.5 * e - 2.2 * att.w, -0.8, 0.8);
      att.rcsY = clamp(1.5 * ec - 2.2 * att.wc, -0.8, 0.8);
      aP = att.rcsP; aY = att.rcsY;
    }
    att.w += aP * dt; att.psi += att.w * dt;
    att.wc += aY * dt; att.chi += att.wc * dt;
  }

  // ---------- Renderer / scene ----------
  const mView = $('missionView');
  const mRenderer = new THREE.WebGLRenderer({ antialias: true });
  mRenderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  mRenderer.outputColorSpace = THREE.SRGBColorSpace;
  mView.appendChild(mRenderer.domElement);
  const mScene = new THREE.Scene();
  mScene.background = new THREE.Color(0x000000);
  const mCam = new THREE.PerspectiveCamera(45, 1, 0.02, 5000);
  const mControls = new OrbitControls(mCam, mRenderer.domElement);
  mControls.enableDamping = true; mControls.minDistance = 0.4; mControls.maxDistance = 900;

  mScene.add(new THREE.AmbientLight(0xffffff, 0.28));
  const mSun = new THREE.DirectionalLight(0xfff3e6, 2.6);
  mSun.position.set(-0.55, 0.55, 1).multiplyScalar(200);
  mScene.add(mSun);

  // Stars
  {
    const n = 4000, p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      p.set([s * Math.cos(a) * 1800, s * Math.sin(a) * 1800, u * 1800], i * 3);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    mScene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.3, sizeAttenuation: false, transparent: true, opacity: 0.8 })));
  }

  // Procedural textures (value-noise fbm sampled on the sphere — no seams, no downloads)
  function hash3(x, y, z, s) {
    let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(z, 0x9e3779b1) ^ Math.imul(s + 1, 0x85ebca77);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967295;
  }
  function vnoise(x, y, z, s) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
    const L = (a, b, k) => a + (b - a) * k;
    return L(
      L(L(hash3(xi, yi, zi, s), hash3(xi + 1, yi, zi, s), u), L(hash3(xi, yi + 1, zi, s), hash3(xi + 1, yi + 1, zi, s), u), v),
      L(L(hash3(xi, yi, zi + 1, s), hash3(xi + 1, yi, zi + 1, s), u), L(hash3(xi, yi + 1, zi + 1, s), hash3(xi + 1, yi + 1, zi + 1, s), u), v), w);
  }
  function fbm(x, y, z, s, oct) {
    let a = 0.5, f = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) { sum += a * vnoise(x * f, y * f, z * f, s + i * 17); norm += a; a *= 0.5; f *= 2.03; }
    return sum / norm;
  }
  // Works in ~50 ms slices with a frame in between, so the loading bar keeps animating while textures generate
  const breathe = () => new Promise(r => { requestAnimationFrame(() => setTimeout(r, 0)); setTimeout(r, 60); });
  async function sphereCanvas(W, H, fn) {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'), img = g.createImageData(W, H), d = img.data;
    let sliceEnd = performance.now() + 50;
    for (let y = 0; y < H; y++) {
      if (performance.now() > sliceEnd && !document.hidden) { await breathe(); sliceEnd = performance.now() + 50; }   // hidden tab: nobody's watching, don't slow down
      const lat = (0.5 - (y + 0.5) / H) * Math.PI, cl = Math.cos(lat), sl = Math.sin(lat);
      for (let x = 0; x < W; x++) {
        const lon = ((x + 0.5) / W) * Math.PI * 2;
        fn(cl * Math.cos(lon), sl, cl * Math.sin(lon), lat, d, (y * W + x) * 4);
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }
  async function earthTextures() {
    const W = 640, H = 320;
    const surf = await sphereCanvas(W, H, (x, y, z, lat, d, i) => {
      const n = fbm(x * 1.9 + 5, y * 1.9 + 5, z * 1.9 + 5, 1, 5);
      const al = Math.abs(lat) / (Math.PI / 2);
      let r, g, b;
      if (al > 0.84 + (n - 0.5) * 0.25) { r = 232; g = 238; b = 244; }
      else if (n > 0.54) {
        const m = fbm(x * 5, y * 5, z * 5, 9, 3), e = (n - 0.54) * 4;
        const dry = clamp((m - 0.42) * 2.5 + (al < 0.35 ? 0.25 : -0.1), 0, 1);
        r = 48 + 110 * dry + 60 * e; g = 92 + 40 * dry + 40 * e; b = 42 + 40 * dry + 30 * e;
      } else {
        const k = clamp(1 - (0.54 - n) * 7, 0, 1);
        r = 8 + 22 * k; g = 28 + 60 * k; b = 72 + 75 * k;
      }
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
    });
    await step(0.55, 'Generating clouds');   // split so the loading bar can repaint between the two big canvases
    const cloud = await sphereCanvas(W, H, (x, y, z, lat, d, i) => {
      const n = fbm(x * 2.6 + 20, y * 4 + 20, z * 2.6 + 20, 4, 4);
      d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = clamp((n - 0.52) * 4.5, 0, 0.9) * 255;
    });
    return [surf, cloud].map(c => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; });
  }
  async function moonTexture() {
    const MW = 768, MH = 384;
    const c = await sphereCanvas(MW, MH, (x, y, z, lat, d, i) => {
      const n = fbm(x * 3 + 2, y * 3 + 2, z * 3 + 2, 31, 5), m = fbm(x * 1.2, y * 1.2, z * 1.2, 77, 3);
      const v = 120 + (n - 0.5) * 120 - (m > 0.56 ? 38 : 0);
      d[i] = v; d[i + 1] = v; d[i + 2] = v * 0.98; d[i + 3] = 255;
    });
    const g = c.getContext('2d');
    for (let k = 0; k < 130; k++) {
      const x = Math.random() * MW, y = MH * 0.12 + Math.random() * MH * 0.76, r = 2 + Math.random() ** 2 * 24;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(30,30,30,.35)'); grd.addColorStop(0.75, 'rgba(30,30,30,.18)');
      grd.addColorStop(0.9, 'rgba(255,255,255,.22)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }

  // Earth
  await step(0.45, 'Generating Earth');
  const [earthMap, cloudMap] = await earthTextures();
  const earth = new THREE.Mesh(new THREE.SphereGeometry(RE, 96, 64), new THREE.MeshStandardMaterial({ map: earthMap, roughness: 0.85 }));
  earth.rotation.set(0.35, 0, Math.PI / 2); mScene.add(earth);   // axis in the view plane so we see continents, not the ice cap
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(RE * 1.008, 96, 64),
    new THREE.MeshStandardMaterial({ map: cloudMap, transparent: true, depthWrite: false, roughness: 1 }));
  clouds.rotation.set(0.35, 0, Math.PI / 2); mScene.add(clouds);
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(RE * 1.05, 96, 64), new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `varying vec3 vN; varying vec3 vV;
      void main(){ float i = smoothstep(0.0, 0.32, -dot(vN, vV)); gl_FragColor = vec4(vec3(0.32,0.62,1.0) * i * 0.9, 1.0); }`
  }));
  mScene.add(atmo);

  // Moon
  await step(0.65, 'Generating Moon');
  const moon = new THREE.Mesh(new THREE.SphereGeometry(RM, 72, 48), new THREE.MeshStandardMaterial({ map: await moonTexture(), roughness: 0.95 }));
  moon.position.set(MX, 0, 0); moon.rotation.set(0.2, 0, Math.PI / 2); mScene.add(moon);

  // Launch pad + tower
  {
    const pad = new THREE.Group();
    const grey = new THREE.MeshStandardMaterial({ color: 0x6b6f78, roughness: 0.8 });
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.04, 24), grey); disc.position.y = 0.02; pad.add(disc);
    const tower = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.05, 0.05), new THREE.MeshStandardMaterial({ color: 0x8a5a3a, roughness: 0.7 }));
    tower.position.set(0.14, 0.52, 0); pad.add(tower);
    pad.position.set(RE * Math.cos(TH_L), RE * Math.sin(TH_L), 0);
    pad.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), pad.position.clone().normalize());
    mScene.add(pad);
  }

  // Mission rocket: origin = upper-stage centre, long axis = local +Y
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.45, metalness: 0.1 });
  const black = new THREE.MeshStandardMaterial({ color: 0x1b1b1f, roughness: 0.6 });
  const bellMat = new THREE.MeshStandardMaterial({ color: 0x6d727b, metalness: 0.85, roughness: 0.3, side: THREE.DoubleSide });
  const RR = 0.045;
  const ship = new THREE.Group(); mScene.add(ship);

  function plumeMaterial(color, strength) {
    return new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(color) }, uK: { value: strength } },
      vertexShader: `varying float vY; varying vec3 vN; varying vec3 vV;
        void main(){ vY = position.y; vec4 mv = modelViewMatrix*vec4(position,1.0);
          vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `uniform vec3 uColor; uniform float uK; varying float vY; varying vec3 vN; varying vec3 vV;
        void main(){ float along = pow(clamp(1.0 + vY, 0.0, 1.0), 1.6);      // bright at nozzle, fades to tip
          float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.3);       // soft silhouette
          gl_FragColor = vec4(uColor * along * edge * uK, 1.0); }`
    });
  }
  function makePlume(len) {
    const g = new THREE.Group();
    const geo = new THREE.ConeGeometry(1, 1, 20, 1, true); geo.rotateX(Math.PI); geo.translate(0, -0.5, 0);
    const outer = new THREE.Mesh(geo, plumeMaterial(0xff7a2f, 0.75));
    const inner = new THREE.Mesh(geo, plumeMaterial(0xfff0c8, 1.0));
    inner.scale.set(0.45, 0.55, 0.45);
    g.add(outer, inner); g.userData.len = len;
    return g;
  }
  function makeNozzle(bellR, bellH) {
    const nz = new THREE.Group();
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(bellR * 0.45, bellR, bellH, 20, 1, true), bellMat);
    bell.position.y = -bellH / 2; nz.add(bell);
    const plume = makePlume(1); plume.position.y = -bellH; nz.add(plume);
    const light = new THREE.PointLight(0xff9a4d, 0, 2.5, 2); light.position.y = -bellH - 0.08; nz.add(light);
    nz.userData = { plume, light };
    return nz;
  }

  // Upper stage (y −0.2 … +0.2)
  {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(RR, RR, 0.24, 24), white); b.position.y = -0.04; ship.add(b);
    const n = new THREE.Mesh(new THREE.ConeGeometry(RR, 0.12, 24), white); n.position.y = 0.14; ship.add(n);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(RR * 1.01, RR * 1.01, 0.025, 24), black); band.position.y = 0.06; ship.add(band);
  }
  const nz2 = makeNozzle(0.03, 0.04); nz2.position.y = -0.16; ship.add(nz2);
  // Landing legs (fold out for descent)
  const legs = [];
  for (let i = 0; i < 4; i++) {
    const hold = new THREE.Group(); hold.rotation.y = i * Math.PI / 2 + Math.PI / 4; ship.add(hold);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.1, 0.008), black);
    leg.geometry.translate(0, -0.05, 0); leg.position.set(RR, -0.1, 0); hold.add(leg); legs.push(leg);
  }
  // Booster (group origin at its own centre so it tumbles naturally after separation)
  const BOOST_Y = -0.16 - B_L / 2;
  const booster = new THREE.Group(); booster.position.y = BOOST_Y; ship.add(booster);
  {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(RR, RR, B_L - 0.05, 24), white); b.position.y = 0.025; booster.add(b);
    const inter = new THREE.Mesh(new THREE.CylinderGeometry(RR * 1.01, RR * 1.01, 0.07, 24), black); inter.position.y = B_L / 2 - 0.035; booster.add(inter);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(RR * 1.01, RR * 1.01, 0.05, 24), black); base.position.y = -B_L / 2 + 0.075; booster.add(base);
    const fs = new THREE.Shape(); fs.moveTo(0, 0); fs.lineTo(0.05, -0.02); fs.lineTo(0.05, -0.08); fs.lineTo(0, -0.1); fs.closePath();
    const fg = new THREE.ShapeGeometry(fs);
    for (let i = 0; i < 4; i++) {
      const h = new THREE.Group(); h.rotation.y = i * Math.PI / 2; booster.add(h);
      const f = new THREE.Mesh(fg, new THREE.MeshStandardMaterial({ color: 0x23242a, side: THREE.DoubleSide })); f.position.set(RR, -B_L / 2 + 0.15, 0); h.add(f);
    }
  }
  const nz1 = makeNozzle(0.04, 0.05); nz1.position.y = -B_L / 2 + 0.05; booster.add(nz1);
  // RCS puff
  const puff = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
  ship.add(puff);
  // Overview marker (constant screen size)
  const dotTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, '#fff'); gr.addColorStop(0.3, '#ff9a5a'); gr.addColorStop(0.55, 'rgba(255,122,61,.55)'); gr.addColorStop(1, 'rgba(255,122,61,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, sizeAttenuation: false, depthTest: false, transparent: true }));
  marker.scale.set(0.035, 0.035, 1); marker.renderOrder = 10; marker.visible = false; mScene.add(marker);

  // Planned trajectory + flown trail
  await step(0.8, 'Plotting transfer orbit');
  const planPts = [];
  for (let t = 0; t <= t_land; t += 0.25) planPts.push(posAt(t));
  const planLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(planPts),
    new THREE.LineDashedMaterial({ color: 0x7aa7ff, dashSize: 0.5, gapSize: 0.35, transparent: true, opacity: 0.35 }));
  planLine.computeLineDistances(); mScene.add(planLine);
  const TRAIL_MAX = Math.ceil(t_land / 0.25) + 50;
  const trailBuf = new Float32Array(TRAIL_MAX * 3);
  const trailGeo = new THREE.BufferGeometry(); trailGeo.setAttribute('position', new THREE.BufferAttribute(trailBuf, 3));
  trailGeo.setDrawRange(0, 0);
  mScene.add(new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 })));
  let trailN = 0, lastTrailT = -1;
  const trail2D = [];
  function pushTrail(p) {
    if (trailN >= TRAIL_MAX) return;
    trailBuf.set([p.x, p.y, p.z], trailN * 3); trailN++;
    trailGeo.setDrawRange(0, trailN); trailGeo.attributes.position.needsUpdate = true;
    trail2D.push([p.x, p.y]);
  }

  // Booster separation
  const boost = { free: false, vel: new THREE.Vector3(), spin: 0, life: 0 };
  function separate() {
    if (boost.free) return;
    mScene.attach(booster);
    velAt(T_SEP, boost.vel).multiplyScalar(0.9);
    const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(ship.quaternion);
    boost.vel.addScaledVector(axis, -0.06);
    boost.spin = 0.5; boost.life = 0; boost.free = true;
    att.w += 0.12; att.wc -= 0.08;   // separation kick for the controller to null out
  }
  function boosterStep(dt) {
    if (!boost.free || !booster.visible) return;
    boost.vel.addScaledVector(_tp.copy(booster.position).normalize(), -0.02 * dt);
    booster.position.addScaledVector(boost.vel, dt);
    booster.rotateZ(boost.spin * dt);
    boost.life += dt;
    if (boost.life > 45 || booster.position.length() < RE) booster.visible = false;
  }
  function reattachBooster() {
    ship.add(booster); booster.position.set(0, BOOST_Y, 0); booster.quaternion.identity(); booster.visible = true;
    boost.free = false;
  }

  // ---------- Events / timeline ----------
  const EVENTS = [
    { t: -3, c: 'ENGINE IGNITION SEQUENCE START' },
    { t: 0, s: 'LIFTOFF', c: 'LIFTOFF' },
    { t: 14, c: 'THROTTLING DOWN FOR MAX-Q' },
    { t: 18, s: 'MAX-Q', c: 'MAX-Q · PEAK AERODYNAMIC PRESSURE' },
    { t: 24, c: 'THROTTLE UP' },
    { t: T_MECO, s: 'MECO', c: 'MAIN ENGINE CUTOFF' },
    { t: T_SEP, s: 'STAGE SEP', c: 'STAGE SEPARATION CONFIRMED' },
    { t: T_SES, c: 'SECOND ENGINE START' },
    { t: t_seco, s: 'ORBIT', c: 'ORBIT INSERTION · SECO-1' },
    { t: t_tli0, s: 'TLI', c: 'TRANS-LUNAR INJECTION BURN' },
    { t: t_tli1, c: 'TLI COMPLETE · COASTING TO THE MOON' },
    { t: t_mcc, s: 'MCC', c: 'MID-COURSE CORRECTION' },
    { t: t_flip, c: 'FLIP TO RETROGRADE · RCS' },
    { t: t_coast1, s: 'LOI', c: 'LUNAR ORBIT INSERTION BURN' },
    { t: t_desc0, s: 'DESCENT', c: 'POWERED DESCENT INITIATED' },
    { t: t_desc0 + 18, c: 'LANDING LEGS DEPLOYED' },
    { t: t_land, s: 'TOUCHDOWN', c: 'TOUCHDOWN · WELCOME TO THE MOON' },
  ];
  const tlPos = t => { const x = Math.max(0, t); return clamp(0.5 * Math.log(1 + x / 10) / Math.log(1 + t_land / 10) + 0.5 * x / t_land, 0, 1); }; // half-log scale: early events get room
  const tlEls = [];
  {
    const tl = $('timeline'), marks = EVENTS.filter(e => e.s);
    marks.forEach((e, i) => {
      const el = document.createElement('div');
      el.className = 'tl-ev ' + (i % 2 ? 'down' : 'up') + (i === 0 ? ' first' : '') + (i === marks.length - 1 ? ' last' : '');
      el.style.left = (tlPos(e.t) * 100) + '%';
      el.innerHTML = `<i></i><span>${e.s}</span>`;
      tl.appendChild(el); tlEls.push([e, el]);
    });
  }
  let calloutTimer = 0;
  function callout(text) {
    const el = $('callout'); el.textContent = text; el.classList.add('show');
    clearTimeout(calloutTimer); calloutTimer = setTimeout(() => el.classList.remove('show'), 3800);
  }
  function fireEvents(t0, t1) {
    let last = null;
    for (const e of EVENTS) if (e.t > t0 && e.t <= t1) last = e;
    if (last) callout(last.c);
  }

  // ---------- Telemetry (display numbers loosely based on a real lunar mission) ----------
  const MU = 398600, RE_KM = 6371;
  const altKm = h => 50 * h * (1 + Math.pow(h / 21.95, 3));          // ~200 km parking orbit … ~370,000 km at the Moon
  const altMoonKm = d => 43.5 * d * (1 + Math.pow(d / 6, 2));        // ~115 km lunar orbit
  const RKM0 = RE_KM + altKm(rEll(TH_C) - RPAD);
  const V_TLI = 10.95;
  const _tel = new THREE.Vector3(), _telv = new THREE.Vector3();
  function telemetry(t) {
    posAt(Math.max(t, 0), _tel);
    if (t >= t_soi) {
      let v;
      if (t < t_coast1) v = 1.9 + 0.5 * (t - t_soi) / (t_coast1 - t_soi);
      else if (t < t_loi1) v = 2.4 - 0.77 * (t - t_coast1) / T_LOI;
      else if (t < t_desc0) v = 1.63;
      else if (t < t_land) v = 1.63 * velAt(t, _telv).length() / (RL * WL);
      else v = 0;
      const d = Math.max(0, _tel.distanceTo(moon.position) - RLAND);
      return { v: v * 3600, alt: t >= t_land ? 0 : altMoonKm(d), moon: true };
    }
    let v = 0;
    if (t <= 0) v = 0;
    else if (t < T_MECO) v = 2.3 * Math.pow(t / T_MECO, 1.6);
    else if (t < T_SES) v = 2.3 - 0.02 * (t - T_MECO);
    else if (t < T_ASC) v = 2.2 + 5.6 * Math.pow((t - T_SES) / (T_ASC - T_SES), 1.3);
    else if (t < t_tli0) v = 7.8;
    else if (t < t_tli1) v = 7.8 + (V_TLI - 7.8) * sstep((t - t_tli0) / T_TLI);
    else { const rk = RE_KM + altKm(_tel.length() - RPAD); v = Math.sqrt(Math.max(0.36, V_TLI * V_TLI - 2 * MU * (1 / RKM0 - 1 / rk))); }
    return { v: v * 3600, alt: t <= 0 ? 0 : altKm(Math.max(0, _tel.length() - RPAD)), moon: false };
  }
  function phaseAt(t) {
    if (simState === 'idle') return 'READY FOR LAUNCH';
    if (t < 0) return 'TERMINAL COUNT';
    if (t < T_MECO) return 'STAGE 1 ASCENT';
    if (t < T_SES) return 'STAGE SEPARATION';
    if (t < T_ASC) return 'STAGE 2 ASCENT';
    if (t < t_tli0) return 'PARKING ORBIT';
    if (t < t_tli1) return 'TRANS-LUNAR INJECTION';
    if (t >= t_mcc && t < t_mcc + 3) return 'MID-COURSE CORRECTION';
    if (t < t_coast1) return 'TRANS-LUNAR COAST';
    if (t < t_loi1) return 'LUNAR ORBIT INSERTION';
    if (t < t_desc0) return 'LUNAR ORBIT';
    if (t < t_land) return 'POWERED DESCENT';
    return 'LANDED · MISSION COMPLETE';
  }
  const fmtClock = t => {
    const neg = t < 0, s = neg ? Math.ceil(-t) : Math.floor(t);
    const hh = String(Math.floor(s / 3600)).padStart(2, '0'), mm = String(Math.floor(s / 60) % 60).padStart(2, '0'), ss = String(s % 60).padStart(2, '0');
    return `${neg ? 'T-' : 'T+'}${hh}:${mm}:${ss}`;
  };

  // ---------- Visual update ----------
  const ZW = new THREE.Vector3(0, 0, 1), _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3(), _m4 = new THREE.Matrix4();
  function placeShip() {
    posAt(Math.max(simT, 0), ship.position);
    const cp = Math.cos(att.psi), sp = Math.sin(att.psi), cc = Math.cos(att.chi), sc = Math.sin(att.chi);
    _by.set(cp * cc, sp * cc, sc);
    _bz.copy(ZW).addScaledVector(_by, -_by.z).normalize();
    _bx.crossVectors(_by, _bz);
    _m4.makeBasis(_bx, _by, _bz); ship.quaternion.setFromRotationMatrix(_m4);
    nz1.rotation.set(att.gy, 0, att.gp); nz2.rotation.set(att.gy, 0, att.gp);
  }
  function updateEngines() {
    const eng = engineAt(simT), stage1 = simT < T_SEP;
    const inAtmo = clamp(1 - (ship.position.length() - RPAD) / 2.5, 0, 1) * (simT < T_ASC ? 1 : 0);
    [[nz1, stage1], [nz2, !stage1]].forEach(([nz, active]) => {
      const { plume, light } = nz.userData;
      const on = active && eng.on && eng.thr > 0.02;
      plume.visible = on; light.intensity = on ? 1.6 * eng.thr : 0;
      if (!on) return;
      const fl = 0.88 + Math.random() * 0.24;
      const len = eng.thr * (nz === nz1 ? 0.55 : 0.38) * fl;
      const rad = (nz === nz1 ? 0.035 : 0.026) * (1 + (1 - inAtmo) * 1.6);
      plume.scale.set(rad, len, rad);
    });
    const rcs = Math.max(Math.abs(att.rcsP), Math.abs(att.rcsY));
    puff.material.opacity = (simState === 'running' && !eng.on && rcs > 0.12) ? 0.5 + Math.random() * 0.4 : 0;
    puff.position.set(Math.sign(att.rcsP) * (Math.abs(att.rcsP) > 0.12 ? RR + 0.012 : 0), 0.1,
                      -Math.sign(att.rcsY) * (Math.abs(att.rcsY) > 0.12 ? RR + 0.012 : 0));
    const legOut = simT > t_desc0 + 18 ? smoothstep(t_desc0 + 18, t_desc0 + 21, simT) : 0;
    legs.forEach(l => l.rotation.z = -legOut * 0.6);
  }

  // ---------- Camera ----------
  const CHASE_OFFSET = new THREE.Vector3(0.9, 0.25, 2.4);
  const camGuard = { offset: null };   // last accepted camera offset from the target; cleared on camera jumps
  let mapBounds;
  {
    let x0 = -RE, x1 = MX + RM, y0 = -RE, y1 = RE;
    for (const p of planPts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
    mapBounds = { x0, x1, y0, y1 };
  }
  function setChase() {
    camMode = 'chase'; marker.visible = false; setCamLabel(); camGuard.offset = null;
    applyViewOffset();
    const k = clamp(1.25 / mCam.aspect, 1, 2.4);   // back off on tall/narrow windows
    mControls.target.copy(ship.position); mCam.position.copy(ship.position).addScaledVector(CHASE_OFFSET, k); mControls.update();
  }
  // The part of the mission view not covered by HUD panels (px, relative to the view)
  function overviewRect(w, h) {
    const base = mView.getBoundingClientRect(), box = el => el.getBoundingClientRect();
    const shown = el => el.offsetParent !== null;
    const events = document.querySelector('.m-events');
    let L = shown($('miniBench')) ? box($('miniBench')).right - base.left : 0;
    let R = box(shown(events) ? events : $('minimap')).left - base.left;
    let T = box(document.querySelector('.m-controls')).bottom - base.top;
    let B = box($('mBottom')).top - base.top + 40;   // the HUD's top padding is mostly empty gradient
    L += 16; R -= 16; T += 12; B -= 12;
    if (R - L < w * 0.35 || B - T < h * 0.3) return { L: 0, R: w, T: 0, B: h };   // small screens: panels cover too much, use it all
    return { L, R, T, B };
  }
  function applyViewOffset() {
    const w = mView.clientWidth, h = mView.clientHeight;
    if (w < 2 || h < 2) return;
    if (camMode === 'overview') {
      // Put the centre of the picture in the middle of the uncovered area
      const f = overviewRect(w, h);
      mCam.setViewOffset(w, h, w / 2 - (f.L + f.R) / 2, h / 2 - (f.T + f.B) / 2, w, h);
    } else {
      const dy = Math.round(($('mBottom').offsetHeight || 0) * 0.32);
      mCam.setViewOffset(w, h + 2 * dy, 0, 2 * dy, w, h);   // shift the picture up so the HUD doesn't cover it
    }
    mCam.updateProjectionMatrix();
  }
  function setOverview() {
    camMode = 'overview'; marker.visible = true; setCamLabel(); camGuard.offset = null;
    applyViewOffset();
    const { x0, x1, y0, y1 } = mapBounds;
    const hw = (x1 - x0) / 2 + 4, hh = (y1 - y0) / 2 + 4;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const w = mView.clientWidth, h = mView.clientHeight, f = overviewRect(w, h);
    // At distance d one world unit spans (h/2)/(d·tan(fov/2)) px; pick d so Earth→Moon fits the uncovered area
    const tv = Math.tan(mCam.fov * DEG / 2);
    const dist = Math.max(hh * h / (f.B - f.T), hw * h / (f.R - f.L)) / tv * 1.1;
    mControls.target.set(cx, cy, 0);
    mCam.position.set(cx, cy - dist * 0.18, dist); mControls.update();
  }
  $('camBtn').onclick = () => (camMode === 'chase' ? setOverview() : setChase());
  function followShip() {
    if (camMode !== 'chase') { marker.position.copy(ship.position); return; }
    const d = _tp.copy(ship.position).sub(mControls.target);
    mControls.target.add(d); mCam.position.add(d);
  }
  function mResize() {
    const w = mView.clientWidth, h = mView.clientHeight;
    if (w < 2 || h < 2) return;
    mRenderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    mRenderer.setSize(w, h, false);
    mCam.aspect = w / h;
    applyViewOffset();
    if (camMode === 'overview') setOverview();
  }
  new ResizeObserver(mResize).observe(mView);
  $('mbCollapse').addEventListener('click', () => { if (camMode === 'overview') applyViewOffset(); });

  // ---------- Controls ----------
  // Buttons hold an icon (phones) and a text label (desktop); keep both and the accessible name in sync
  function setLabel(btn, text) { btn.querySelector('.lbl').textContent = text; btn.setAttribute('aria-label', text); }
  function setCamLabel() {
    const b = $('camBtn'); b.dataset.mode = camMode;
    setLabel(b, camMode === 'chase' ? 'Cam: Chase' : 'Cam: Overview');
  }
  function refreshButtons() {
    const lb = $('launchBtn'), pb = $('pauseBtn');
    lb.disabled = simState === 'running' || simState === 'paused';
    setLabel(lb, simState === 'done' ? 'Fly again' : simState === 'idle' ? 'Launch' : 'In flight');
    pb.disabled = !(simState === 'running' || simState === 'paused');
    setLabel(pb, simState === 'paused' ? 'Resume' : 'Pause');
    pb.toggleAttribute('data-paused', simState === 'paused');
  }
  function resetSim() {
    simState = 'idle'; simT = -10;
    hudMax.v = hudMax.alt = hudMax.g = 0;
    Object.assign(att, { psi: TH_L, w: 0, chi: 0, wc: 0, gp: 0, gy: 0, rcsP: 0, rcsY: 0 });
    reattachBooster();
    trailN = 0; trail2D.length = 0; lastTrailT = -1; trailGeo.setDrawRange(0, 0);
    $('callout').classList.remove('show');
    placeShip();
    if (camMode === 'chase') setChase();
    refreshButtons();
  }
  $('launchBtn').onclick = () => {
    if (simState === 'done') resetSim();
    simState = 'running'; simT = -10; callout('TERMINAL COUNT · T-10 SECONDS'); refreshButtons();
  };
  $('pauseBtn').onclick = () => { simState = simState === 'paused' ? 'running' : 'paused'; refreshButtons(); };
  $('resetSimBtn').onclick = resetSim;
  $('warp').onchange = e => { warp = Number(e.target.value); };

  // ---------- HUD ----------
  const ARC = 197.9, CIRC = 263.9;
  const mm = $('minimap'), mmCtx = mm.getContext('2d');
  function drawMinimap() {
    const dpr = Math.min(devicePixelRatio, 2), w = mm.clientWidth, h = mm.clientHeight;
    if (!w || !h) return;
    if (mm.width !== Math.round(w * dpr)) { mm.width = Math.round(w * dpr); mm.height = Math.round(h * dpr); }
    const g = mmCtx; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const { x0, x1, y0, y1 } = mapBounds, pad = 12;
    const s = Math.min((w - 2 * pad) / (x1 - x0), (h - 2 * pad - 10) / (y1 - y0));
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const X = x => w / 2 + (x - cx) * s, Y = y => (h + 10) / 2 - (y - cy) * s;
    g.lineWidth = 1; g.setLineDash([3, 3]); g.strokeStyle = 'rgba(255,255,255,.28)'; g.beginPath();
    planPts.forEach((p, i) => (i ? g.lineTo(X(p.x), Y(p.y)) : g.moveTo(X(p.x), Y(p.y)))); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#2f6fd0'; g.beginPath(); g.arc(X(0), Y(0), Math.max(4, RE * s), 0, Math.PI * 2); g.fill();
    g.fillStyle = '#a9a9ad'; g.beginPath(); g.arc(X(MX), Y(0), Math.max(3, RM * s), 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#fff'; g.lineWidth = 1.6; g.beginPath();
    trail2D.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1])))); g.stroke();
    const px = X(ship.position.x), py = Y(ship.position.y);
    g.fillStyle = 'rgba(255,122,61,.35)'; g.beginPath(); g.arc(px, py, 6, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ff7a3d'; g.beginPath(); g.arc(px, py, 3, 0, Math.PI * 2); g.fill();
    g.font = '600 9px "Barlow Condensed", sans-serif'; g.fillStyle = 'rgba(255,255,255,.7)'; g.textAlign = 'center';
    g.fillText('EARTH', X(0), Y(0) + Math.max(4, RE * s) + 10);
    g.fillText('MOON', X(MX), Y(0) + Math.max(3, RM * s) + 10);
    g.textAlign = 'left'; g.fillText(w < 190 ? 'NOT TO SCALE' : 'TRAJECTORY · NOT TO SCALE', 8, 12);
  }
  let lastHud = 0;
  const hudMax = { v: 0, alt: 0, g: 0 };
  const metHTML = s => `<small>${s.slice(0, 2)}</small>${s.slice(2)}`;   // small grey "T+" prefix
  const fmtAlt = a => (a < 100 ? a.toFixed(1) : Math.round(a).toLocaleString('en-US'));

  // Mission events list (wide screens): every event, check when passed, ring on the next one
  const evEls = EVENTS.map(e => {
    const li = document.createElement('li');
    li.innerHTML = `<i></i><span>${e.c.split(' · ')[0]}</span><time>${fmtClock(e.t).replace(/^T([+-])/, 'T$1 ')}</time>`;
    $('evList').appendChild(li);
    return [e, li];
  });
  let lastNextEl = null;

  function updateHUD(now) {
    if (now - lastHud < 60) return; lastHud = now;
    const t = simT, tel = telemetry(t), eng = engineAt(t);
    $('met').innerHTML = metHTML(fmtClock(t));
    $('phase').textContent = phaseAt(t);

    // Top strip: only what the bottom HUD doesn't show (next event, peaks, engine state)
    if (simState !== 'idle') {
      hudMax.v = Math.max(hudMax.v, tel.v); hudMax.alt = Math.max(hudMax.alt, tel.alt);
      hudMax.g = Math.max(hudMax.g, Math.abs(att.gp), Math.abs(att.gy));
    }
    const thrOn = eng.on && eng.thr > 0.02;
    $('sSpeedMax').textContent = Math.round(hudMax.v).toLocaleString('en-US');
    $('sAltMax').textContent = fmtAlt(hudMax.alt);
    $('sGimMax').textContent = (hudMax.g / DEG).toFixed(1);
    $('sGimSub').textContent = `${Math.round(hudMax.g / GMAX * 100)}% of ±8° limit`;
    const rcs = simState === 'running' && !thrOn && Math.max(Math.abs(att.rcsP), Math.abs(att.rcsY)) > 0.12;
    $('sEng').textContent = thrOn ? 'BURNING' : rcs ? 'RCS' : 'OFF';
    $('sEngSub').textContent = `${t < T_SEP ? 'Stage 1' : 'Stage 2'} · ${thrOn ? Math.round(eng.thr * 100) : 0}% throttle`;

    let nextEv = null, nextE = null;
    evEls.forEach(([e, li]) => {
      const d = simState !== 'idle' && t >= e.t;
      li.classList.toggle('done', d); li.classList.toggle('next', !d && !nextEv);
      if (!d && !nextEv) { nextEv = li; nextE = e; }
    });
    $('sNext').textContent = nextE ? nextE.c.split(' · ')[0] : 'MISSION COMPLETE';
    $('sNextT').innerHTML = nextE ? metHTML(fmtClock(t - nextE.t)) : '';
    if (nextEv !== lastNextEl) {   // keep the upcoming event in view
      lastNextEl = nextEv;
      const list = $('evList');
      if (nextEv && list.clientHeight) list.scrollTop = nextEv.offsetTop - list.clientHeight / 2;
    }

    $('stageLabel').textContent = t < T_SEP ? 'STAGE 1 TELEMETRY' : 'STAGE 2 TELEMETRY';
    $('gSpeed').textContent = Math.round(tel.v).toLocaleString('en-US');
    $('gAlt').textContent = tel.alt < 100 ? tel.alt.toFixed(1) : Math.round(tel.alt).toLocaleString('en-US');
    $('gSpeedLabel').textContent = tel.moon ? 'SPEED · MOON' : 'SPEED';
    $('gAltLabel').textContent = tel.moon ? 'ALT · MOON' : 'ALTITUDE';
    $('gSpeedArc').style.strokeDasharray = `${clamp(tel.v / 40000, 0, 1) * ARC} ${CIRC}`;
    $('gAltArc').style.strokeDasharray = `${clamp(Math.log10(1 + tel.alt) / Math.log10(400001), 0, 1) * ARC} ${CIRC}`;
    const gp = att.gp / DEG, gy = att.gy / DEG, sgn = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1) + '°';
    $('gP').textContent = sgn(gp); $('gY').textContent = sgn(gy);
    const dx = clamp(gy / (GMAX / DEG), -1, 1) * 44, dy = -clamp(gp / (GMAX / DEG), -1, 1) * 44;
    $('gmDot').setAttribute('cx', dx); $('gmDot').setAttribute('cy', dy);
    $('gmVec').setAttribute('x2', dx); $('gmVec').setAttribute('y2', dy);
    $('gmDot').classList.toggle('sat', Math.max(Math.abs(att.gp), Math.abs(att.gy)) >= GMAX * 0.98);
    $('thrFill').style.height = (eng.on ? eng.thr * 100 : 0) + '%';
    const prog = simState === 'idle' ? 0 : tlPos(t);
    $('tlFill').style.width = (prog * 100) + '%';
    let next = null;
    tlEls.forEach(([e, el]) => { const d = simState !== 'idle' && t >= e.t; el.classList.toggle('done', d); el.classList.toggle('next', !d && !next); if (!d && !next) next = e; });
    $('tlNext').textContent = next ? `NEXT · ${next.s} ${fmtClock(t - next.t)}` : 'MISSION COMPLETE';
    drawMinimap();
  }

  // ---------- Main loop ----------
  let lastFrame = performance.now();
  // Solid bodies the camera can't pass through: Earth and the Moon (spheres), the rocket stack and the launch tower
  // (capsules: a line segment with a radius), each with a small clearance above its surface.
  //  - Dead stop: if a frame's orbit/zoom input would take the camera inside a clearance zone, the part of the move
  //    heading inward is dropped, so the camera holds still where it touched (no sliding, no bounce) however long you
  //    keep dragging. Orbiting around the target at the same height, or zooming out, still goes through.
  //  - If it ends up inside anyway (the rocket moving into it, a window resize), it's placed straight back on the edge.
  // Clearances are smaller than the pad / landing heights, so the low chase views still work.
  const padUp = new THREE.Vector3(Math.cos(TH_L), Math.sin(TH_L), 0);
  const padQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), padUp);
  const towerA = padUp.clone().multiplyScalar(RE).add(new THREE.Vector3(0.14, 0, 0).applyQuaternion(padQ));
  const towerB = towerA.clone().addScaledVector(padUp, 1.05);
  const rocketA = new THREE.Vector3(), rocketB = new THREE.Vector3();
  const BODIES = [
    { c: new THREE.Vector3(), R: RE, clear: 0.2 },           // Earth
    { c: moon.position, R: RM, clear: 0.1 },                 // Moon
    { a: rocketA, b: rocketB, R: RR, clear: 0.06 },          // rocket stack
    { a: towerA, b: towerB, R: 0.035, clear: 0.06 },         // launch tower
  ].map(b => Object.assign(b, { n: new THREE.Vector3(), p: new THREE.Vector3() }));
  const _seg = new THREE.Vector3(), _rel = new THREE.Vector3(), _cand = new THREE.Vector3();
  const _sNew = new THREE.Spherical(), _sOld = new THREE.Spherical(), _sTry = new THREE.Spherical();
  // How far the camera is inside a body's clearance zone (> 0 = inside); also leaves the outward normal in b.n
  function depthIn(b, pos) {
    if (b.c) b.p.copy(b.c);
    else {
      _seg.subVectors(b.b, b.a);
      const t = THREE.MathUtils.clamp(_rel.subVectors(pos, b.a).dot(_seg) / _seg.lengthSq(), 0, 1);
      b.p.copy(b.a).addScaledVector(_seg, t);
    }
    b.n.subVectors(pos, b.p);
    const d = b.n.length();
    b.n.divideScalar(d || 1);
    return b.R + b.clear - d;
  }
  function collideCamera() {
    // Rocket body: the whole stack until stage separation, then just the upper stage
    ship.updateMatrixWorld();
    rocketA.set(0, boost.free ? -0.24 : -0.76, 0).applyMatrix4(ship.matrixWorld);
    rocketB.set(0, 0.2, 0).applyMatrix4(ship.matrixWorld);

    // Dead stop: if this frame's move would put the camera inside a body, keep only the parts of it that don't —
    // tried in order: around + zoom, around only, zoom only, nothing (all relative to the orbit target)
    const blocked = pos => BODIES.some(b => depthIn(b, pos) > 0);
    if (camGuard.offset && blocked(mCam.position)) {
      _sNew.setFromVector3(_rel.subVectors(mCam.position, mControls.target));
      _sOld.setFromVector3(camGuard.offset);
      const tries = [[_sNew.theta, _sNew.radius], [_sNew.theta, _sOld.radius], [_sOld.theta, _sNew.radius], [_sOld.theta, _sOld.radius]];
      for (const [theta, radius] of tries) {
        _sTry.set(radius, _sOld.phi, theta);
        _cand.setFromSpherical(_sTry).add(mControls.target);
        if (!blocked(_cand) || (theta === _sOld.theta && radius === _sOld.radius)) { mCam.position.copy(_cand); break; }
      }
    }
    // Still inside (moved there by the scene, not by input)? Put it straight back on the edge
    for (const b of BODIES) {
      const depth = depthIn(b, mCam.position);
      if (depth > 0) mCam.position.addScaledVector(b.n, depth);
    }
    (camGuard.offset ??= new THREE.Vector3()).subVectors(mCam.position, mControls.target);
  }

  // Intro fly-in (after the loading screen): from a wide shot of Earth out in space, ease down to the chase view.
  // Camera controls are paused until it lands, so a stray drag can't fight it.
  let intro = null;
  const _iDir = new THREE.Vector3();
  function flyIn(seconds) {
    setChase();                                                  // the pose to land on
    const end = mCam.position.clone().sub(ship.position);
    intro = { t0: performance.now(), ms: seconds * 1000, endDist: end.length(), endDir: end.normalize(),
              startDist: 38, startDir: new THREE.Vector3(0.25, 0.55, 1).normalize() };
    mControls.enabled = false;
  }
  function introStep(now) {
    const k = clamp((now - intro.t0) / intro.ms, 0, 1);
    const dolly = 1 - Math.pow(1 - k, 3);                        // ease-out: fast start, gentle landing
    const turn = 0.5 - 0.5 * Math.cos(Math.PI * k);              // ease-in-out for the change of angle
    _iDir.copy(intro.startDir).lerp(intro.endDir, turn).normalize();
    mControls.target.copy(ship.position);
    mCam.position.copy(ship.position).addScaledVector(_iDir, intro.startDist * Math.pow(intro.endDist / intro.startDist, dolly));
    mCam.lookAt(ship.position);
    if (k >= 1) { intro = null; mControls.enabled = true; camGuard.offset = null; mControls.update(); }
  }

  let mWarmed = false;
  function missionFrame(now) {
    requestAnimationFrame(missionFrame);
    const realDt = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now;
    if (simState === 'running') {
      const t0 = simT;
      let rem = realDt * warp;
      while (rem > 1e-6 && simState === 'running') {
        const h = Math.min(rem, 1 / 120);
        dynStep(h); boosterStep(h);
        simT += h; rem -= h;
        if (!boost.free && simT >= T_SEP) { placeShip(); separate(); }
        if (simT >= 0 && simT - lastTrailT >= 0.25) { lastTrailT = simT; pushTrail(posAt(simT, _tp)); }
        if (simT >= t_land + 4) { simState = 'done'; refreshButtons(); }
      }
      fireEvents(t0, simT);
    }
    placeShip();
    updateEngines();
    clouds.rotateY(realDt * 0.004);
    if (document.body.dataset.tab !== 'mission') return;
    if (intro) introStep(now);
    else { followShip(); mControls.update(); collideCamera(); }
    // One warm-up frame (uploads the planet textures to the GPU), then skip drawing while the loading screen covers it
    if (mWarmed && window.tvcCovered?.()) return;
    mRenderer.render(mScene, mCam); mWarmed = true;
    updateHUD(now);
  }
  resetSim();
  setChase();
  requestAnimationFrame(missionFrame);
  return { flyIn };
}
