// Landing tab: the SLDP 45 rocket as a 30 m lunar lander, flown by the real TVC.
//   Rig       - the lander's attitude IS the real rocket's tilt on the desk rig (bench.js 'tvc:sample' events). Push the
//               real rocket and the lander gets pushed; the real gimbal fights it back, and the lander drifts while it leans.
//   Simulated - no hardware: the same controller as the Nano (controller.js) flies a simulated attitude, with gusts,
//               a Gust button and a TVC on/off switch (TVC off shows what happens without it).
// Physics in landing-sim.js. Pure showcase: vertical speed follows a fixed guidance profile; only attitude is real.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createParticles } from './mission-fx.js';
import * as L from './landing-sim.js';

const $ = id => document.getElementById(id);
const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, k) => a + (b - a) * k;
const sstep = (a, b, x) => { const s = clamp((x - a) / (b - a), 0, 1); return s * s * (3 - 2 * s); };
const rnd = (a, b) => a + Math.random() * (b - a);
const GUST_SCALE = 0.85;   // of demo-sim's gust: with the TVC on, one gust peaks under ~20° (300 random runs, never past the 25° abort)

export async function initLanding(step) {
  await step?.(0.86, 'Generating lunar surface');

  // ---------- Renderer / scene ----------
  const view = $('landingView');
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  view.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 30000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.enabled = false; controls.maxPolarAngle = 88 * DEG;

  // Low sun: long shadows, the classic lunar look. Earthshine as a faint blue fill.
  const SUN = new THREE.Vector3(-0.62, 0.36, -0.7).normalize();   // ~21° up
  const sun = new THREE.DirectionalLight(0xfff4e6, 3.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 1200 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(0x8fa3c8, 0x1a1a1a, 0.45));

  // ---------- Terrain: craters + noise on a grid that gets coarser with distance ----------
  const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
  function vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return lerp(lerp(a, b, u), lerp(c, d, u), v) * 2 - 1;
  }
  const fbm = (x, y) => { let s = 0, a = 1, f = 1; for (let i = 0; i < 5; i++) { s += a * vnoise(x * f, y * f); a *= 0.5; f *= 2.03; } return s; };
  // Craters: a deterministic scatter, none on the pad
  const craters = [];
  { let seed = 7; const r01 = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 220; i++) {
      const R = 25 + Math.pow(r01(), 3) * 300, d = 380 + R + Math.pow(r01(), 1.3) * 3400, a = r01() * Math.PI * 2;
      craters.push([Math.cos(a) * d, Math.sin(a) * d, R]);
    }
    for (let i = 0; i < 260; i++) {   // small ones close in: they give the descent its sense of scale
      const R = 2 + Math.pow(r01(), 2) * 22, d = 30 + R + Math.pow(r01(), 0.8) * 420, a = r01() * Math.PI * 2;
      craters.push([Math.cos(a) * d, Math.sin(a) * d, R]);
    }
  }
  function terrain(x, z) {
    let h = 6 * fbm(x / 260, z / 260) + 0.6 * fbm(x / 30, z / 30), rimBright = 0;
    for (const [cx, cz, R] of craters) {
      const dx = x - cx, dz = z - cz; if (Math.abs(dx) > R * 1.8 || Math.abs(dz) > R * 1.8) continue;
      const q = Math.hypot(dx, dz) / R;
      if (q < 1) h -= 0.22 * R * (1 - q * q);
      const rim = Math.exp(-(((q - 1) / 0.22) ** 2)); h += 0.07 * R * rim; rimBright = Math.max(rimBright, rim);
    }
    const flat = sstep(26, 60, Math.hypot(x, z));    // the pad area is graded flat
    return [h * flat, rimBright * flat];
  }
  const heightAt = (x, z) => terrain(x, z)[0];
  {
    const N = 400, geo = new THREE.PlaneGeometry(2, 2, N, N); geo.rotateX(-Math.PI / 2);
    const P = geo.attributes.position, uv = geo.attributes.uv, col = new Float32Array(P.count * 3);
    const warp = u => Math.sign(u) * (110 * Math.abs(u) + 900 * u * u + 3800 * Math.abs(u) ** 4);   // 0.6 m near the pad … 4.8 km out
    for (let i = 0; i < P.count; i++) {
      const x = warp(P.getX(i)), z = warp(P.getZ(i)), [h, rim] = terrain(x, z), d = Math.hypot(x, z);
      P.setXYZ(i, x, h - d * d / (2 * 1737e3), z);                                   // the Moon's curvature at the horizon
      const g = clamp(0.3 + 0.07 * fbm(x / 90 + 9, z / 90) + 0.12 * rim, 0.15, 0.55);
      col.set([g, g * 0.97, g * 0.93], i * 3);
      uv.setXY(i, x / 14, z / 14);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    // Regolith detail: pocked grey noise tiled every 14 m, as colour and bump (the scale cue up close)
    const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
    const img = g.createImageData(512, 512);
    for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
      const v = 150 + 40 * (vnoise(x / 9, y / 9) * 0.6 + vnoise(x / 3, y / 3) * 0.4) + 18 * (Math.random() - 0.5), o = (y * 512 + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = v; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    for (let i = 0; i < 140; i++) {   // tiny craters (wrapped so the tile is seamless)
      const r = 2 + Math.pow(Math.random(), 3) * 26, cx = Math.random() * 512, cy = Math.random() * 512;
      for (const ox of [-512, 0, 512]) for (const oy of [-512, 0, 512]) {
        const gr = g.createRadialGradient(cx + ox - r * 0.25, cy + oy - r * 0.25, r * 0.1, cx + ox, cy + oy, r);
        gr.addColorStop(0, 'rgba(40,40,40,.55)'); gr.addColorStop(0.75, 'rgba(70,70,70,.25)'); gr.addColorStop(0.9, 'rgba(235,235,235,.45)'); gr.addColorStop(1, 'rgba(235,235,235,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(cx + ox, cy + oy, r, 0, 7); g.fill();
      }
    }
    for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '30,30,30' : '230,230,230'},.22)`; g.beginPath(); g.arc(Math.random() * 512, Math.random() * 512, Math.random() * 1.4 + 0.4, 0, 7); g.fill(); }
    const detail = new THREE.CanvasTexture(c); detail.wrapS = detail.wrapT = THREE.RepeatWrapping; detail.anisotropy = 8; detail.colorSpace = THREE.SRGBColorSpace;
    const bump = new THREE.CanvasTexture(c); bump.wrapS = bump.wrapT = THREE.RepeatWrapping; bump.anisotropy = 8;
    const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, map: detail, bumpMap: bump, bumpScale: 2.5, roughness: 1, metalness: 0 }));
    ground.receiveShadow = true;
    scene.add(ground);
  }

  // Landing pad: a painted disc, edge lights
  const PAD = new THREE.Group(); scene.add(PAD);
  {
    const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
    g.fillStyle = '#5b5d61'; g.beginPath(); g.arc(256, 256, 254, 0, 7); g.fill();
    for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${Math.random() * 0.06})`; g.fillRect(Math.random() * 512, Math.random() * 512, 3, 3); }
    g.strokeStyle = '#e9e9e6'; g.lineWidth = 14; g.beginPath(); g.arc(256, 256, 226, 0, 7); g.stroke();
    g.lineWidth = 6; g.beginPath(); g.arc(256, 256, 120, 0, 7); g.stroke();
    g.lineWidth = 18; g.beginPath(); g.moveTo(170, 170); g.lineTo(342, 342); g.moveTo(342, 170); g.lineTo(170, 342); g.stroke();
    g.fillStyle = '#f5a623'; for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; g.fillRect(256 + Math.cos(a) * 196 - 7, 256 + Math.sin(a) * 196 - 7, 14, 14); }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(L.PAD_R, 64), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 }));
    disc.rotation.x = -Math.PI / 2; disc.position.y = 0.04; disc.receiveShadow = true; PAD.add(disc);
  }
  const padLights = [];
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2;
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff4d5e }));
    m.position.set(Math.cos(a) * (L.PAD_R + 1.2), 0.25, Math.sin(a) * (L.PAD_R + 1.2)); PAD.add(m); padLights.push(m);
  }

  // Stars + Earth hanging over the horizon
  {
    const n = 5000, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      pos.set([r * Math.cos(a) * 20000, Math.abs(u) * 20000 - 1500, r * Math.sin(a) * 20000], i * 3);
      const b = Math.pow(Math.random(), 3) * 0.9 + 0.1; col.set([b, b, b * (0.9 + Math.random() * 0.2)], i * 3);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false })));
  }
  const earth = new THREE.Mesh(new THREE.SphereGeometry(330, 64, 48), new THREE.ShaderMaterial({
    uniforms: { uSun: { value: SUN.clone() } },
    vertexShader: `varying vec3 vN; varying vec3 vP; void main(){ vN = normalize(normal); vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uSun; varying vec3 vN; varying vec3 vP;
      float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }
      float n3(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
      void main(){ vec3 p = vP/330.0; float land = n3(p*3.0)*0.6 + n3(p*7.0)*0.3 + n3(p*15.0)*0.1;
        float cloud = smoothstep(0.55, 0.8, n3(p*5.0+7.0)*0.6 + n3(p*13.0)*0.4);
        vec3 c = land > 0.56 ? mix(vec3(0.18,0.32,0.14), vec3(0.55,0.47,0.33), n3(p*9.0)) : vec3(0.04,0.13,0.38);
        c = mix(c, vec3(0.95), cloud);
        float d = dot(normalize(vN), uSun), lit = smoothstep(-0.05, 0.25, d);
        float rim = pow(1.0 - abs(dot(normalize(vN), vec3(0,0,1))), 3.0);
        gl_FragColor = vec4(c*lit*1.3 + vec3(0.3,0.5,1.0)*rim*0.5*lit, 1.0); }`,
  }));
  earth.position.set(7600, 4300, 8600);   // opposite the sun: a nearly full Earth over the horizon
  scene.add(earth);

  await step?.(0.9, 'Fuelling the lander');

  // ---------- Lander: the rocket at 30 m tall, from the CAD model (models/sldp45.glb) ----------
  const MM = 30 / 632;                          // rocket length 632 mm → 30 m
  const CG = 247, GIMBAL = 37, TUBE_BELOW = 57, RO = 39.3, TUBE_R = 18;
  const FOOT = 0.6;                             // deployed feet reach this far below the tail
  const lander = new THREE.Group(); lander.rotation.order = 'XZY'; scene.add(lander);
  const airframe = new THREE.Group(); airframe.position.y = -CG * MM; lander.add(airframe);
  const innerG = new THREE.Group(); innerG.position.y = GIMBAL * MM; airframe.add(innerG);
  const tvc = new THREE.Group(); tvc.position.y = GIMBAL * MM; airframe.add(tvc);
  const M = {
    steel_body: new THREE.MeshStandardMaterial({ color: 0xdfe2e6, metalness: 0.55, roughness: 0.3 }),
    steel_band: new THREE.MeshStandardMaterial({ color: 0xaeb2b9, metalness: 0.6, roughness: 0.35 }),
    steel_door: new THREE.MeshStandardMaterial({ color: 0xc8cbd0, metalness: 0.5, roughness: 0.4 }),
    black: new THREE.MeshStandardMaterial({ color: 0x16171a, metalness: 0.3, roughness: 0.6 }),
    tube: new THREE.MeshStandardMaterial({ color: 0x55585f, metalness: 0.7, roughness: 0.35 }),
    other: new THREE.MeshStandardMaterial({ color: 0x8e939d, roughness: 0.6 }),
  };
  // Stand-in until the CAD model loads
  const standIn = new THREE.Group();
  { const body = new THREE.Mesh(new THREE.CylinderGeometry(RO * MM, RO * MM, 530 * MM, 48), M.steel_body); body.position.y = 265 * MM;
    const nose = new THREE.Mesh(new THREE.ConeGeometry(RO * MM, 102 * MM, 48), M.black); nose.position.y = 581 * MM;
    standIn.add(body, nose); standIn.traverse(o => { o.castShadow = true; }); airframe.add(standIn); }
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(TUBE_R * MM, TUBE_R * MM, (TUBE_BELOW + 10) * MM, 24), M.tube);
  tube.position.y = (10 - TUBE_BELOW) / 2 * MM; tube.castShadow = true; tvc.add(tube);
  new GLTFLoader().load('models/sldp45.glb', gltf => {
    const parts = []; gltf.scene.traverse(o => { if (o.isMesh) parts.push(o); });
    if (!parts.length) return;
    airframe.remove(standIn); tvc.remove(tube);
    for (const m of parts) {
      const [grp, col] = m.name.split('|');
      if (grp !== 'rocket' && grp !== 'inner' && grp !== 'tube') continue;       // no desk rig on the Moon
      const mesh = new THREE.Mesh(m.geometry, M[col] || M.other);
      mesh.geometry.computeVertexNormals(); mesh.scale.setScalar(MM); mesh.castShadow = true;
      if (grp === 'inner') { mesh.position.y = -GIMBAL * MM; innerG.add(mesh); }
      else if (grp === 'tube') { mesh.position.y = -GIMBAL * MM; tvc.add(mesh); }
      else airframe.add(mesh);
    }
  }, undefined, err => console.warn('Landing: CAD model not loaded, using the simple one:', err));

  // Landing legs (not on the real rocket): 4 struts that swing down from the tail
  const legs = [];
  { const legMat = new THREE.MeshStandardMaterial({ color: 0x1c1d21, metalness: 0.5, roughness: 0.5 });
    const LEN = 7.2, geo = new THREE.CylinderGeometry(0.16, 0.22, LEN, 10); geo.translate(0, -LEN / 2, 0);
    const footGeo = new THREE.CylinderGeometry(0.75, 0.9, 0.22, 20);
    for (let i = 0; i < 4; i++) {
      const az = (45 + 90 * i) * DEG, hinge = new THREE.Group();
      hinge.position.set(Math.cos(az) * (RO * MM + 0.1), 6.4, Math.sin(az) * (RO * MM + 0.1));
      hinge.rotation.y = -az;                       // local +X points out from the body
      const pivot = new THREE.Group(); hinge.add(pivot);
      const strut = new THREE.Mesh(geo, legMat); strut.castShadow = true; pivot.add(strut);
      const foot = new THREE.Mesh(footGeo, legMat); foot.position.y = -LEN; foot.castShadow = true; pivot.add(foot);
      airframe.add(hinge); legs.push(pivot);
    }
  }
  // Deployed: 36° out from straight down → feet 0.6 m below the tail. Stowed: folded up along the body.
  const setLegs = k => legs.forEach(p => { p.visible = k > 0.001; p.rotation.z = lerp(176, 36, k) * DEG; });

  // Plume: a vacuum plume (wide, blue-white) out of the motor tube, plus a light that washes the ground
  function plumeMat(color, k) {
    return new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(color) }, uK: { value: k }, uT: { value: 0 } },
      vertexShader: `varying float vY; varying vec3 vN; varying vec3 vV;
        void main(){ vY = position.y; vec4 mv = modelViewMatrix*vec4(position,1.0);
          vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `uniform vec3 uColor; uniform float uK; uniform float uT; varying float vY; varying vec3 vN; varying vec3 vV;
        void main(){ float along = pow(clamp(1.0 + vY, 0.0, 1.0), 2.2);
          float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
          float fl = 0.85 + 0.15 * sin(uT * 53.0 + vY * 31.0);
          gl_FragColor = vec4(uColor * along * edge * uK * fl, 1.0); }`,
    });
  }
  const plumeGeo = new THREE.ConeGeometry(1, 1, 32, 1, true); plumeGeo.rotateX(Math.PI); plumeGeo.translate(0, -0.5, 0);
  const plume = new THREE.Group(); plume.position.y = -TUBE_BELOW * MM; tvc.add(plume);
  const plumeOuter = new THREE.Mesh(plumeGeo, plumeMat(0x5c8dff, 0.9));
  const plumeInner = new THREE.Mesh(plumeGeo, plumeMat(0xe6f0ff, 1.25));
  plume.add(plumeOuter, plumeInner);
  const engineLight = new THREE.PointLight(0x9fc0ff, 0, 90, 1.6); engineLight.position.y = -3; plume.add(engineLight);
  function setPlume(thr, t) {
    plume.visible = thr > 0.01;
    const len = 9 + 16 * thr, r = 1.1 + 2.4 * thr;
    plumeOuter.scale.set(r, len, r); plumeInner.scale.set(r * 0.42, len * 0.55, r * 0.42);
    plumeOuter.material.uniforms.uT.value = plumeInner.material.uniforms.uT.value = t;
    engineLight.intensity = thr > 0.01 ? 900 * (0.5 + thr) : 0;
  }

  // ---------- Particles: regolith (grey, from mission-fx.js) and fire (additive, own) ----------
  const dust = createParticles(scene);
  const fire = (() => {
    const N = 900, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), size = new Float32Array(N), alpha = new Float32Array(N);
    const p = Array.from({ length: N }, () => ({ life: 0 }));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1)); geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uScale: { value: 500 } },
      vertexShader: `uniform float uScale; attribute vec3 aColor; attribute float aSize; attribute float aAlpha; varying vec3 vC; varying float vA;
        void main(){ vC = aColor; vA = aAlpha; vec4 mv = modelViewMatrix*vec4(position,1.0);
          gl_PointSize = min(aSize*uScale/max(-mv.z,0.01), 600.0); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `varying vec3 vC; varying float vA; void main(){ float r = length(gl_PointCoord-0.5)*2.0; if (r>1.0) discard;
        gl_FragColor = vec4(vC*vA*pow(1.0-r,1.6), 1.0); }` });
    const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; scene.add(pts);
    let next = 0;
    return {
      emit(o) { const q = p[next]; Object.assign(q, o, { age: 0, max: o.life }); pos.set([o.x, o.y, o.z], next * 3); next = (next + 1) % N; },
      update(dt) {
        for (let i = 0; i < N; i++) {
          const q = p[i]; if (q.life <= 0) { alpha[i] = 0; continue; }
          q.life -= dt; q.age += dt; const k = Math.max(0, 1 - q.drag * dt);
          q.vx *= k; q.vy = q.vy * k - L.G_MOON * dt; q.vz *= k;
          pos[i * 3] += q.vx * dt; pos[i * 3 + 1] += q.vy * dt; pos[i * 3 + 2] += q.vz * dt;
          const u = Math.min(1, q.age / q.max), heat = 1 - u;
          col.set([1, 0.35 + 0.6 * heat * heat, 0.1 + 0.5 * heat ** 4], i * 3);
          size[i] = q.s0 + (q.s1 - q.s0) * Math.sqrt(u); alpha[i] = q.a * Math.pow(1 - u, 1.2);
        }
        for (const a of ['position', 'aColor', 'aSize', 'aAlpha']) geo.attributes[a].needsUpdate = true;
      },
      clear() { p.forEach(q => { q.life = 0; }); alpha.fill(0); },
      setScale(s) { mat.uniforms.uScale.value = s; },
    };
  })();
  // Debris for the crash: chunks on slow lunar arcs
  const debris = [];
  { const dm = [M.steel_body, M.black, M.steel_band];
    for (let i = 0; i < 40; i++) {
      const s = rnd(0.3, 1.6), m = new THREE.Mesh(new THREE.BoxGeometry(s, s * rnd(0.2, 0.6), s * rnd(0.5, 1.2)), dm[i % 3]);
      m.visible = false; m.castShadow = true; scene.add(m); debris.push({ m, v: new THREE.Vector3(), w: new THREE.Vector3() });
    } }
  const flash = new THREE.PointLight(0xffa040, 0, 400, 1.4); scene.add(flash);

  // ---------- State ----------
  let source = 'sim';                 // 'rig' | 'sim'
  let state = 'idle';                 // idle | check | descent | landed | crashed (+ 'falling', 'tipping' on the way)
  let outcome = null, checkT = 0, legK = 0, trim = { x: 0, y: 0 }, trimN = 0;
  const att = L.createAttitudeSim();
  let descent = L.createDescent();
  const shown = { tiltX: 0, tiltY: 0, gx: 0, gy: 0 };   // what the lander shows (deg)
  let rig = null, rigSeen = -1e9;                          // last 'tvc:sample' and when it arrived
  let gustPlan = [], promptPlan = [], maxTilt = 0, maxGimbal = 0, td = null, lost = false, legsCalled = false;
  const trail = [];
  const tracker = L.createTracker(d => {
    feed(`Pushed to <b>${d.peak.toFixed(1)}°</b> · back in <b>${d.recover.toFixed(2)} s</b>`, d.peak > 15 ? 'warn' : 'ok');
  });
  // Falling / tipping animation
  const fall = { w: new THREE.Vector3(), v: new THREE.Vector3(), pivot: new THREE.Vector3(), axis: new THREE.Vector3(), ang: 0, rate: 0 };

  document.addEventListener('tvc:sample', e => { rig = e.detail; rigSeen = performance.now(); });
  const rigLive = () => performance.now() - rigSeen < 1500;   // the feed is 20-100 Hz: 1.5 s of silence = no link

  // ---------- UI ----------
  const goBtn = $('lndGo'), tvcBtn = $('lndTvc'), gustBtn = $('lndGust'), camBtn = $('lndCam'), loopBox = $('lndLoop');
  const srcBtns = [...document.querySelectorAll('#lndSrc button')];
  function setSource(s) {
    if (state !== 'idle' && state !== 'landed' && state !== 'crashed') return;
    source = s;
    srcBtns.forEach(b => b.classList.toggle('on', b.dataset.src === s));
    document.getElementById('landing').dataset.src = s;
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
  camBtn.onclick = () => { camMode = CAMS[(CAMS.indexOf(camMode) + 1) % CAMS.length]; controls.enabled = camMode === 'free'; if (camMode === 'free') controls.target.copy(lander.position); refresh(); };
  addEventListener('keydown', e => {
    if (document.body.dataset.tab !== 'landing' || e.target.closest('input, select, textarea')) return;
    if (e.key === 'g' || e.key === 'G') doGust();
    if (e.key === ' ' && (state === 'idle' || state === 'landed' || state === 'crashed')) { e.preventDefault(); goBtn.click(); }
  });

  function refresh() {
    const running = state === 'check' || state === 'descent' || state === 'falling' || state === 'tipping';
    goBtn.querySelector('.lbl').textContent = state === 'idle' ? 'Begin descent' : running ? 'Descending' : 'Fly again';
    goBtn.disabled = running || (source === 'rig' && !rigLive() && state === 'idle');
    srcBtns.forEach(b => { b.disabled = running; });
    tvcBtn.querySelector('.lbl').textContent = att.tvc ? 'TVC: On' : 'TVC: Off';
    tvcBtn.classList.toggle('off', !att.tvc);
    gustBtn.querySelector('.lbl').textContent = source === 'rig' ? 'Call a gust' : 'Gust';
    gustBtn.title = source === 'rig' ? 'Shows a prompt to push the real rocket (G)' : 'Shove the lander sideways (G)';
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
    if (state !== 'descent') return;
    if (source === 'sim') {
      const dir = rnd(0, 360);
      att.gust(dir, GUST_SCALE);
      callout('GUST');
    } else callout('GUST INCOMING · <b>PUSH THE ROCKET</b>', 2600, 'warn');
  }

  function reset() {
    state = 'idle'; outcome = null; checkT = 0; legK = 0; td = null; lost = false; legsCalled = false;
    descent = L.createDescent(); att.reset(); tracker.reset();
    trim = { x: 0, y: 0 }; trimN = 0; maxTilt = 0; maxGimbal = 0; trail.length = 0;
    Object.assign(shown, { tiltX: 0, tiltY: 0, gx: 0, gy: 0 });
    fall.ang = fall.rate = 0;
    lander.visible = true; debris.forEach(d => { d.m.visible = false; }); fire.clear(); dust.clear?.();
    $('lndResult').hidden = true; $('lndFeed').textContent = '';
    clearTimeout(loopTimer); $('lndLoopNote').textContent = '';
    setLegs(0);
    placeLander();
    refresh();
  }
  function begin() {
    if (source === 'rig' && !rigLive()) { callout('NO RIG DATA · CONNECT THE ARDUINO', 2600, 'warn'); return; }
    state = 'check'; checkT = 0; trim = { x: 0, y: 0 }; trimN = 0;
    // Simulated: three gusts on the way down. Rig: prompts to push the real rocket at about the same points.
    gustPlan = source === 'sim' ? [4, 11, 17].map(t => ({ t: t + rnd(-0.8, 0.8), dir: rnd(0, 360) })) : [];
    promptPlan = source === 'rig' ? [5, 13].map(t => ({ t })) : [];
    callout(source === 'rig' ? 'ATTITUDE CHECK · HOLD THE ROCKET STILL' : 'ATTITUDE CHECK', 1800);
    refresh();
  }

  // ---------- Simulation step (100 Hz) ----------
  const _ax = new THREE.Vector3();
  function readAttitude() {
    if (source === 'sim') return att.read();
    if (!rig) return { tiltX: 0, tiltY: 0, gx: 0, gy: 0 };
    return { tiltX: rig.tiltX - trim.x, tiltY: rig.tiltY - trim.y, gx: rig.gx ?? 0, gy: rig.gy ?? 0 };
  }
  function simStep() {
    const s = descent.s;
    if (state === 'check') {
      checkT += L.DT;
      if (source === 'sim') { att.step(0.6, true); Object.assign(shown, att.read()); }
      else if (rig) Object.assign(shown, { tiltX: rig.tiltX, tiltY: rig.tiltY, gx: rig.gx ?? 0, gy: rig.gy ?? 0 });
      else if (rig && checkT > 0.4) { trim.x += rig.tiltX; trim.y += rig.tiltY; trimN++; }
      if (checkT >= 2) {
        if (trimN) { trim.x /= trimN; trim.y /= trimN; }
        state = 'descent'; callout('POWERED DESCENT', 1600); refresh();
      }
    } else if (state === 'descent') {
      if (source === 'rig' && !rigLive()) { lost = true; return; }   // pause until the rig link is back
      lost = false;
      const t = s.t;
      for (const g of gustPlan) if (!g.done && t >= g.t) { g.done = true; att.gust(g.dir, GUST_SCALE); callout('GUST'); }
      for (const p of promptPlan) if (!p.done && t >= p.t) { p.done = true; callout('GUST INCOMING · <b>PUSH THE ROCKET</b>', 2600, 'warn'); }
      if (source === 'sim') att.step(1 + 1.5 * sstep(40, 0, s.h));        // regolith blast near the ground
      const a = readAttitude(), tilt = L.tiltOf(a.tiltX, a.tiltY);
      Object.assign(shown, a);
      maxTilt = Math.max(maxTilt, tilt); maxGimbal = Math.max(maxGimbal, Math.abs(a.gx), Math.abs(a.gy));
      tracker.step(t, tilt);
      if (tilt > L.ABORT_DEG) { startFall(); return; }
      const ax = L.axisFromTilt(a.tiltX, a.tiltY);
      descent.step(ax);
      legK = clamp(legK + (s.h < L.LEGS_AT ? L.DT / 2.5 : 0), 0, 1);
      if (s.h < L.LEGS_AT && !legsCalled) { legsCalled = true; callout('LEGS DEPLOYED', 1400); }
      if (s.h <= groundUnder() ) touchdown(tilt);
    }
  }
  const groundUnder = () => heightAt(descent.s.x, descent.s.z);

  function touchdown(tilt) {
    const s = descent.s, miss = descent.drift;
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
    for (let i = 0; i < 160; i++) {   // touchdown dust ring
      const a = rnd(0, Math.PI * 2), v = rnd(10, 26);
      dust.emit({ x: s.x, y: s.h + 0.3, z: s.z, vx: Math.cos(a) * v, vy: rnd(0.5, 2.5), vz: Math.sin(a) * v, life: rnd(1.5, 3.5), s0: 1.5, s1: rnd(6, 12), a: 0.4, c: 0.62, drag: 0.9 });
    }
    finish();
  }
  function startFall() {
    state = 'falling';
    const a = shown, ax = L.axisFromTilt(a.tiltX, a.tiltY);
    fall.axis.set(ax.z, 0, -ax.x).normalize();   // tumble further the way it leans
    fall.rate = 1.2; fall.v.set(descent.s.vx, descent.s.vs, descent.s.vz);
    callout('LOSS OF CONTROL', 2400, 'warn');
    refresh();
  }
  function startTip() {
    state = 'tipping';
    const a = shown, ax = L.axisFromTilt(a.tiltX, a.tiltY);
    fall.axis.set(ax.z, 0, -ax.x).normalize(); fall.rate = 0.25;
    callout('TIPPING OVER', 2000, 'warn');
    refresh();
  }
  function explode(at, why) {
    state = 'crashed';
    lander.visible = false;
    for (let i = 0; i < 520; i++) {
      const u = rnd(-1, 1), a = rnd(0, Math.PI * 2), r = Math.sqrt(1 - u * u), v = rnd(4, 30);
      fire.emit({ x: at.x, y: at.y + rnd(0, 6), z: at.z, vx: r * Math.cos(a) * v, vy: Math.abs(u) * v * 0.8 + 2, vz: r * Math.sin(a) * v, life: rnd(0.7, 2.2), s0: rnd(2, 4), s1: rnd(8, 18), a: rnd(0.5, 1), drag: 1.4 });
    }
    for (let i = 0; i < 220; i++) {
      const a = rnd(0, Math.PI * 2), v = rnd(3, 18);
      dust.emit({ x: at.x, y: at.y + rnd(0, 3), z: at.z, vx: Math.cos(a) * v, vy: rnd(1, 8), vz: Math.sin(a) * v, life: rnd(2.5, 6), s0: 3, s1: rnd(10, 22), a: 0.45, c: 0.35, drag: 0.6 });
    }
    debris.forEach(d => {
      d.m.visible = true; d.m.position.set(at.x + rnd(-3, 3), at.y + rnd(1, 12), at.z + rnd(-3, 3));
      const a = rnd(0, Math.PI * 2), v = rnd(4, 22); d.v.set(Math.cos(a) * v, rnd(6, 20), Math.sin(a) * v);
      d.w.set(rnd(-6, 6), rnd(-6, 6), rnd(-6, 6));
    });
    flash.position.set(at.x, at.y + 6, at.z); flash.intensity = 6e4;
    shake = 1.4;
    outcome = { ok: false, title: why === 'tip' ? 'TIPPED OVER' : 'LOSS OF CONTROL',
      sub: why === 'tip' ? `Touched down leaning ${td.tilt.toFixed(1)}° and fell over (limit ${L.TIP_DEG}°)`
        : `Tilted past the ${L.ABORT_DEG}° abort at ${Math.max(0, descent.s.h).toFixed(0)} m${source === 'sim' && !att.tvc ? ', with the TVC switched off' : ''}` };
    finish();
  }

  let loopTimer = 0;
  function finish() {
    refresh();
    setTimeout(() => showResult(), outcome.ok ? 1200 : 1800);
    if (loopBox.checked) {
      let n = outcome.ok ? 9 : 10;
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
    if (state !== 'landed' && state !== 'crashed') return;
    const r = $('lndResult'), d = tracker.done;
    r.hidden = false; r.classList.toggle('bad', !outcome.ok);
    $('lndResTitle').textContent = outcome.title;
    $('lndResSub').textContent = outcome.sub;
    const best = d.length ? Math.min(...d.map(x => x.recover)) : null;
    const stats = [
      ['Pushes survived', String(d.length)],
      ['Biggest push', `${maxTilt.toFixed(1)}°`],
      ['Fastest recovery', best === null ? '—' : `${best.toFixed(2)} s`],
      ['Peak gimbal', `${maxGimbal.toFixed(1)}°`],
      ['Touchdown tilt', td ? `${td.tilt.toFixed(1)}°` : '—'],
      ['From pad centre', td ? `${td.miss.toFixed(1)} m` : '—'],
    ];
    $('lndResStats').innerHTML = stats.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    $('lndResSrc').textContent = source === 'rig' ? 'Attitude: the real rocket on the desk rig' : `Attitude: simulated, TVC ${att.tvc ? 'on' : 'off'} (same controller as the Nano)`;
  }

  // ---------- Placing the lander ----------
  const _q = new THREE.Quaternion();
  function attitudeToRotation(tiltX, tiltY) {   // Bench convention: outer pivot about X by a, then inner about Z by b
    const ax = L.axisFromTilt(tiltX, tiltY);
    lander.rotation.set(Math.atan2(ax.z, ax.y), 0, Math.atan2(-ax.x, Math.hypot(ax.y, ax.z)));
  }
  const CG_H = () => CG * MM + FOOT * legK;   // CG height above the ground when upright on its feet
  function placeLander() {
    const s = descent.s;
    if (state === 'falling' || state === 'tipping') return;    // animated in fallStep
    attitudeToRotation(shown.tiltX, shown.tiltY);
    lander.position.set(s.x, s.h + CG_H(), s.z);
    tvc.rotation.set(shown.gx * DEG, 0, -shown.gy * DEG);
    innerG.rotation.x = shown.gx * DEG;
    setLegs(sstep(0, 1, legK));
  }
  function fallStep(dt) {
    if (state === 'falling') {
      fall.rate += 1.5 * dt;
      lander.rotateOnWorldAxis(fall.axis, fall.rate * dt);
      fall.v.y -= L.G_MOON * dt;
      lander.position.addScaledVector(fall.v, dt);
      descent.s.h = lander.position.y - CG * MM; descent.s.vs = fall.v.y;
      const low = lowestPoint();
      if (low <= heightAt(lander.position.x, lander.position.z) + 0.2) explode(lander.position.clone().setY(heightAt(lander.position.x, lander.position.z)), 'air');
    } else if (state === 'tipping') {
      // Rotate about the foot on the low side
      fall.rate += 2.2 * dt;
      const ang = fall.rate * dt, pivot = _pv.set(descent.s.x, groundUnder(), descent.s.z);
      const ax = L.axisFromTilt(shown.tiltX, shown.tiltY);
      pivot.x += ax.x / Math.hypot(ax.x, ax.z) * 5.3; pivot.z += ax.z / Math.hypot(ax.x, ax.z) * 5.3;
      _q.setFromAxisAngle(fall.axis, ang);
      lander.position.sub(pivot).applyQuaternion(_q).add(pivot);
      lander.quaternion.premultiply(_q);
      fall.ang += ang;
      if (fall.ang > 1.05) explode(lander.position.clone().setY(groundUnder()), 'tip');
    }
  }
  const _pv = new THREE.Vector3(), _up = new THREE.Vector3();
  function lowestPoint() {   // the lowest of nose and tail
    _up.set(0, 1, 0).applyQuaternion(lander.quaternion);
    const yNose = lander.position.y + _up.y * (632 - CG) * MM, yTail = lander.position.y - _up.y * CG * MM;
    return Math.min(yNose, yTail);
  }

  // ---------- Camera ----------
  const camPos = new THREE.Vector3(60, 260, 90), camLook = new THREE.Vector3(), _cp = new THREE.Vector3(), _cl = new THREE.Vector3();
  let shake = 0, orbit = 0;
  function camGoal(mode, out, look) {
    const p = lander.position, h = descent.s.h;
    if (mode === 'chase') {   // sun behind the camera, swinging slowly; looking down past the lander at the ground
      // High up: from above, the pad below in the same frame. Low down: a side view as it settles onto it.
      const k = sstep(35, 190, h), az = Math.atan2(SUN.z, SUN.x) + 0.55 * Math.sin(orbit), el = lerp(20, 66, k) * DEG, R = lerp(66, 96, k);
      out.set(p.x + R * Math.cos(el) * Math.cos(az), p.y + R * Math.sin(el), p.z + R * Math.cos(el) * Math.sin(az));
      look.set(p.x, p.y - 8 - 0.42 * k * h, p.z);
    } else {   // pad: low on the ground off the pad (sun side, so the lander is lit; Earth behind it), horizon in frame
      out.set(-46, 4.2, -54);
      look.set(p.x * 0.8, clamp(0.45 * (p.y + 12), 9, 40), p.z * 0.8);
    }
  }
  function cameraStep(dt) {
    if (camMode === 'free') { controls.target.lerp(lander.position, 1 - Math.exp(-dt * 3)); controls.update(); return; }
    orbit += dt * (state === 'idle' ? 0.12 : 0.03);
    let mode = camMode;
    if (mode === 'auto') mode = (state === 'descent' && descent.s.h <= 32) || state === 'landed' || state === 'tipping' || (state === 'crashed' && td) ? 'pad' : 'chase';
    camGoal(mode, _cp, _cl);
    const k = 1 - Math.exp(-dt * (mode === 'pad' ? 1.6 : 2.4));
    camPos.lerp(_cp, k); camLook.lerp(_cl, 1 - Math.exp(-dt * 4));
    camera.position.copy(camPos);
    const sh = shake + (state === 'descent' ? 0.25 * sstep(30, 0, descent.s.h) : 0);
    if (sh > 0.001) camera.position.add(_cp.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(sh * 0.6));
    camera.lookAt(camLook);
    shake *= Math.exp(-dt * 2.5);
    const fov = mode === 'pad' ? 44 : 40;
    if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); resize(); }
  }

  // ---------- HUD ----------
  const sgn = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1);
  const R_PER_DEG = 40 / 25;   // dial: 25° at r = 40
  function hud() {
    const s = descent.s, a = shown, tilt = L.tiltOf(a.tiltX, a.tiltY);
    const airborne = state !== 'landed' && state !== 'crashed';
    const alt = airborne ? Math.max(0, s.h - groundUnder()) : 0;
    $('lndAlt').textContent = alt.toFixed(alt < 10 ? 1 : 0);
    $('lndVs').textContent = (state === 'descent' || state === 'falling' ? s.vs : 0).toFixed(1);
    $('lndThr').style.width = `${(state === 'descent' ? descent.throttle : state === 'idle' || state === 'check' ? L.G_MOON / (2.6 * L.G_MOON) : 0) * 100}%`;
    $('lndThrV').textContent = `${Math.round((state === 'descent' ? descent.throttle : state === 'idle' || state === 'check' ? 1 / 2.6 : 0) * 100)}%`;
    $('lndDrift').textContent = descent.drift.toFixed(1);
    $('lndTtg').textContent = state === 'descent' ? L.timeToGo(s.h).toFixed(0) + ' s' : '—';
    $('lndPhase').textContent = lost ? 'SIGNAL LOST'
      : state === 'idle' ? 'READY FOR DESCENT'
      : state === 'check' ? 'ATTITUDE CHECK'
      : state === 'descent' ? (s.h > 150 ? 'APPROACH' : s.h > L.LEGS_AT ? 'TERMINAL DESCENT' : s.h > 20 ? 'FINAL APPROACH' : 'FINAL METRES')
      : state === 'falling' ? 'LOSS OF CONTROL' : state === 'tipping' ? 'TIPPING OVER'
      : outcome?.title ?? '';
    $('lndPhase').classList.toggle('warn', lost || state === 'falling' || state === 'tipping' || state === 'crashed');
    $('lndProg').style.width = `${clamp(1 - s.h / L.H0, 0, 1) * 100}%`;
    // Attitude dial
    const px = clamp(a.tiltY, -30, 30) * R_PER_DEG, py = -clamp(a.tiltX, -30, 30) * R_PER_DEG;
    $('lndTiltDot').setAttribute('cx', px); $('lndTiltDot').setAttribute('cy', py);
    $('lndTiltVec').setAttribute('x2', px); $('lndTiltVec').setAttribute('y2', py);
    $('lndGimDot').setAttribute('cx', a.gy * 5); $('lndGimDot').setAttribute('cy', -a.gx * 5);
    if (airborne) { trail.push([px, py]); if (trail.length > 45) trail.shift(); }
    $('lndTrail').setAttribute('points', trail.map(p => p.join(',')).join(' '));
    $('lndTilt').textContent = tilt.toFixed(1) + '°';
    $('lndTilt').className = tilt > 15 ? 'warn' : tilt > 8 ? 'amber' : '';
    $('lndTX').textContent = sgn(a.tiltX) + '°'; $('lndTY').textContent = sgn(a.tiltY) + '°';
    $('lndGX').textContent = sgn(a.gx) + '°'; $('lndGY').textContent = sgn(a.gy) + '°';
    // Source card
    const live = rigLive(), src = $('lndSource');
    src.classList.toggle('live', source === 'rig' && live); src.classList.toggle('sim', source === 'sim');
    $('lndSrcTitle').textContent = source === 'sim' ? 'SIMULATED ATTITUDE' : live ? (rig?.demo ? 'RIG · BENCH DEMO FEED' : 'RIG · LIVE') : 'RIG · NO DATA';
    $('lndSrcSub').innerHTML = source === 'sim'
      ? (att.tvc ? 'The Nano’s controller flies it. Press <b>Gust</b> (G) to shove it.' : 'TVC is <b>off</b>: nothing holds it upright.')
      : live ? 'The lander follows the real rocket. <b>Push it</b> and watch the TVC fight back.'
      : 'Connect the Arduino (top bar) or switch to <b>Simulated</b>.';
    if (state === 'idle') goBtn.disabled = source === 'rig' && !live;
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
    t += dt;
    acc += dt;
    while (acc >= L.DT) {
      acc -= L.DT;
      if (state === 'idle') {   // hover: gentle sway from the source
        if (source === 'sim') { att.step(0.5, true); Object.assign(shown, att.read()); }
        else if (rig && rigLive()) Object.assign(shown, readAttitude());
      } else simStep();
    }
    fallStep(dt);
    placeLander();
    const thr = state === 'descent' ? descent.throttle : state === 'idle' || state === 'check' ? 0.38 : state === 'falling' ? 0 : 0;
    setPlume(state === 'landed' ? 0 : thr, t);
    // Regolith blown out where the plume meets the ground
    if (plume.visible && lander.visible) {
      _up.set(0, 1, 0).applyQuaternion(lander.quaternion);
      const tail = _pv.copy(lander.position).addScaledVector(_up, -(CG + TUBE_BELOW - GIMBAL) * MM);
      const g = heightAt(tail.x, tail.z), d = (tail.y - g) / Math.max(_up.y, 0.3);
      if (d < 55) {
        const k = 1 - d / 55, gx = tail.x - _up.x * d, gz = tail.z - _up.z * d, n = Math.round(20 * k * k + 3);
        for (let i = 0; i < n; i++) {
          const a = rnd(0, Math.PI * 2), v = rnd(14, 40) * (0.4 + k);
          dust.emit({ x: gx + Math.cos(a) * 2, y: g + 0.4, z: gz + Math.sin(a) * 2, vx: Math.cos(a) * v, vy: rnd(0.2, 2.2), vz: Math.sin(a) * v,
            life: rnd(0.8, 2.4), s0: 1.2, s1: rnd(4, 11) * (0.6 + k), a: 0.3 + 0.35 * k, c: 0.66, drag: 0.7 });
        }
      }
    }
    dust.update(dt); fire.update(dt);
    debris.forEach(d => {
      if (!d.m.visible) return;
      d.v.y -= L.G_MOON * dt; d.m.position.addScaledVector(d.v, dt);
      d.m.rotation.x += d.w.x * dt; d.m.rotation.y += d.w.y * dt; d.m.rotation.z += d.w.z * dt;
      const g = heightAt(d.m.position.x, d.m.position.z) + 0.2;
      if (d.m.position.y < g) { d.m.position.y = g; d.v.multiplyScalar(0.35); d.v.y = Math.abs(d.v.y) * 0.4; d.w.multiplyScalar(0.5); }
    });
    flash.intensity *= Math.exp(-dt * 3.5);
    padLights.forEach((m, i) => { m.visible = Math.floor(t * 2 + i / 3) % 2 === 0 || state === 'landed'; });
    // Shadow box follows the lander
    const lp = lander.position;
    // Shadow box on the spot where the lander's shadow falls (the low sun throws it far to the side when high up)
    const throwD = Math.max(lp.y, 0) / SUN.y;
    sun.target.position.copy(lp).addScaledVector(SUN, -throwD); sun.position.copy(sun.target.position).addScaledVector(SUN, throwD + 80);
    if (Math.abs(sun.shadow.camera.far - (throwD + 200)) > 20) { sun.shadow.camera.far = throwD + 200; sun.shadow.camera.updateProjectionMatrix(); }
    cameraStep(dt);
    if (warmed && window.tvcCovered?.()) return;
    renderer.render(scene, camera); warmed = true;
    if (now - lastHud > 60) { lastHud = now; hud(); }
  }

  try { const s = localStorage.getItem('tvc-landing-src'); if (s === 'rig' || s === 'sim') source = s; } catch {}
  setSource(source);
  resize();
  requestAnimationFrame(frame);
  return { resize };
}
