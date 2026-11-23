// Landing tab: the orbit-scale scene (Mars from 200 km down to ~12 km), drawn behind the ship.
// Units are km. The ship stays at the origin with world up = +y and prograde = +x (the same frame as the ground scene),
// so the planet sits below at (0, -(R + h), 0) and turns about its own z axis as the ship flies over it. The ship itself
// is drawn in a second pass by landing.js at metre scale, with the same camera orientation.
//
// Procedural throughout (no texture files):
//   planet      albedo (dusty highlands, dark basaltic plains, bright dust, polar caps for late southern spring), crater fields
//               at four scales (Worley cells: bowl, raised rim, bright ejecta), a canyon system, fine grit; relief shading
//               from screen-space derivatives of the height, exaggerated so the terminator shows long crater shadows;
//               detail fades with pixel footprint so it holds from 200 km without shimmering
//   atmosphere  analytic limb glow (optical depth through a thin exponential shell), brighter sunward, a pale rim at the
//               sunlit limb, forward scattering round the sun
//   sky         ~15k stars (magnitude distribution, colour temperatures), a faint Milky Way band, a star-burst sun whose
//               visibility fades as it sets behind the limb
import * as THREE from 'three';

export const R_MARS = 3389.5;

const NOISE = /* glsl */`
  float h3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  vec3 h33(vec3 p){ return vec3(h3(p), h3(p + 19.19), h3(p + 47.31)); }
  float n3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }
`;

const PLANET_FS = /* glsl */`
  uniform vec3 uSun, uCanyonC, uCanyonA; uniform float uOct, uExag, uR;
  varying vec3 vP; varying vec3 vN; varying vec3 vW;
  ${NOISE}
  // fbm whose finest octaves fade out once they get smaller than a few pixels
  float fbmf(vec3 p, float foot){ float s = 0.0, a = 0.5, f = 1.0;
    for (int i = 0; i < 9; i++) { if (float(i) >= uOct) break;
      float k = smoothstep(foot * 3.0, foot * 10.0, 1.0 / f); s += a * n3(p * f) * k + a * 0.5 * (1.0 - k); f *= 2.03; a *= 0.5; }
    return s; }
  // One crater scale: height (in cell units) and a 'fresh ejecta' brightness
  vec2 craters(vec3 p, float scale, float density){
    vec3 q = p * scale, i = floor(q), f = fract(q); float h = 0.0, ej = 0.0;
    for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) {
      vec3 n = vec3(x, y, z), c = i + n;
      if (h3(c + 7.7) > density) continue;
      vec3 o = h33(c) * 0.7 + 0.15;
      float r = mix(0.14, 0.46, pow(h3(c + 3.3), 1.6));
      float d = length(n + o - f) / r;
      if (d > 2.2) continue;
      float bowl = -(1.0 - d * d) * step(d, 1.0);
      float rim = exp(-pow((d - 1.0) / 0.2, 2.0)) * 0.42;
      float age = h3(c + 1.1);                                    // old craters are softened
      h += r * (bowl * mix(0.9, 0.45, age) + rim * mix(1.0, 0.4, age));
      ej += exp(-pow((d - 1.25) / 0.35, 2.0)) * (1.0 - age) * step(1.0, d);
    }
    return vec2(h, ej);
  }
  void main(){
    vec3 p = normalize(vP);
    float foot = length(fwidth(p)) + 1e-6;                         // unit-sphere size of one pixel
    // Continents and plains
    float big = fbmf(p * 2.2 + 4.0, foot), dark = smoothstep(0.5, 0.62, fbmf(p * 3.4 + 9.0, foot) + 0.18 * big - 0.05);
    float grit = fbmf(p * 90.0, foot);
    // Crater fields, more in the highlands (sizes ~150, 45, 14, 4 km)
    float H = 0.0, ej = 0.0;
    float sc[4] = float[4](10.0, 34.0, 110.0, 380.0);
    float den[4] = float[4](0.35, 0.5, 0.55, 0.6);
    for (int k = 0; k < 4; k++) {
      float vis = smoothstep(foot * 2.0, foot * 8.0, 1.0 / sc[k]);
      if (vis < 0.01) continue;
      vec2 c = craters(p, sc[k], den[k] * (0.55 + 0.6 * (1.0 - dark)));
      H += c.x / sc[k] * 0.22 * vis; ej += c.y * vis * 0.5;
    }
    // Canyon system: a long trough with terraced walls
    vec3 nc = normalize(cross(uCanyonC, uCanyonA));
    float across = dot(p, nc) + 0.012 * (n3(p * 40.0) - 0.5), along = dot(p, uCanyonA);
    float cmask = smoothstep(0.26, 0.14, abs(along)) * step(0.0, dot(p, uCanyonC));
    float cw = 0.011 * (0.7 + 0.6 * n3(p * 9.0));
    float cd = exp(-pow(across / cw, 2.0)); cd = floor(cd * 5.0 + n3(p * 120.0)) / 5.0;   // terraces
    H -= 0.0022 * cd * cmask;
    H += 0.0009 * (fbmf(p * 14.0, foot) - 0.5) + 0.00015 * (grit - 0.5);
    // Relief: perturb the normal by the screen-space gradient of the height (in km), exaggerated
    float Hkm = H * uR * uExag;
    vec3 N = normalize(vN), dpx = dFdx(vW), dpy = dFdy(vW);
    vec3 r1 = cross(dpy, N), r2 = cross(N, dpx); float det = dot(dpx, r1);
    vec3 grad = sign(det) * (dFdx(Hkm) * r1 + dFdy(Hkm) * r2);
    vec3 n = normalize(abs(det) * N - grad);
    // Albedo (display colours)
    vec3 shadowC = vec3(0.30, 0.11, 0.05), rust = vec3(0.62, 0.22, 0.08), ochre = vec3(0.86, 0.38, 0.13), dust = vec3(0.97, 0.62, 0.34);
    vec3 c = mix(ochre, rust, smoothstep(0.35, 0.72, big));
    c = mix(c, dust, smoothstep(0.58, 0.8, fbmf(p * 6.0 + 2.0, foot)) * 0.45);
    c = mix(c, shadowC * 1.3, dark * 0.7);
    c = mix(c, dust, clamp(ej, 0.0, 1.0) * 0.35);
    c *= 0.82 + 0.36 * grit;
    c = mix(c, shadowC, cd * cmask * 0.5);
    // Polar caps for late southern spring (Ls ~245, sun ~18 deg south; local +z = north pole). South: the seasonal frost
    // has retreated to ~80S, patchy, round the bright residual cap (~86S). North: polar night above ~72N; a thin,
    // dusty seasonal frost from ~62N, mostly in the dark, under a faint polar hood (the haze is added after lighting)
    float lat = p.z, frostN = fbmf(p * 22.0 + 7.0, foot);
    float sCap = smoothstep(0.975, 0.99, -lat + 0.012 * (frostN - 0.5)) * smoothstep(0.3, 0.55, frostN + smoothstep(0.995, 0.998, -lat));
    sCap = max(sCap, smoothstep(0.996, 0.9985, -lat + 0.002 * grit));
    c = mix(c, vec3(0.95, 0.93, 0.9), sCap);
    float nCap = smoothstep(0.87, 0.92, lat + 0.03 * (frostN - 0.5)) * smoothstep(0.25, 0.6, frostN + smoothstep(0.92, 0.97, lat));
    c = mix(c, vec3(0.78, 0.76, 0.74), nCap * 0.7);
    // Light: a narrow red terminator band, a near-black night side with a faint cool ambient
    float mu = dot(N, uSun), d = max(dot(n, uSun), 0.0);
    float day = smoothstep(-0.04, 0.12, mu);
    vec3 term = mix(vec3(1.0, 0.42, 0.22), vec3(1.0), smoothstep(0.0, 0.25, mu));
    vec3 col = c * (d * 1.3 * term * day + 0.035 * vec3(0.55, 0.62, 0.8));
    col += vec3(0.55, 0.6, 0.68) * smoothstep(0.8, 0.95, lat) * (0.06 * day + 0.006);   // north polar hood
    // Aerial perspective toward the limb
    vec3 V = normalize(cameraPosition - vW);
    float limb = pow(1.0 - max(dot(N, V), 0.0), 4.0);
    col = mix(col, vec3(1.0, 0.56, 0.28) * smoothstep(-0.15, 0.3, mu) * 0.9, limb * 0.6);
    gl_FragColor = vec4(pow(col, vec3(2.2)) * 1.7, 1.0);
  }`;

const ATMO_FS = /* glsl */`
  uniform vec3 uSun, uC; uniform float uR, uH, uInside; varying vec3 vW;
  void main(){
    if ((uInside > 0.5) == gl_FrontFacing) discard;          // outside the shell: front faces; inside: back faces
    vec3 o = cameraPosition, d = normalize(vW - o), oc = o - uC;
    float t = -dot(oc, d); vec3 P = oc + d * t; float b = length(P);
    float od, alt; vec3 nrm;
    if (b > uR) { alt = b - uR; nrm = normalize(P); od = exp(-alt / uH); }                  // grazing: through the shell
    else {                                                                                   // over the disc: to the surface
      float th = sqrt(uR * uR - b * b); vec3 hit = oc + d * (t - th); nrm = normalize(hit);
      alt = 0.0; od = 0.18 / max(-dot(d, nrm), 0.05) * 0.12; }
    float lit = smoothstep(-0.25, 0.35, dot(nrm, uSun));
    float fwd = pow(max(dot(d, uSun), 0.0), 10.0);
    vec3 glow = vec3(1.0, 0.5, 0.22) * od * (lit * 1.0 + fwd * 1.8) * 0.85;   // broad haze; the rim line below stays full
    float fwd2 = pow(max(dot(d, uSun), 0.0), 40.0);
    float rim = exp(-alt / (uH * 0.18)) * step(uR, b);                                      // the thin bright line
    glow += vec3(1.0, 0.9, 0.82) * rim * (lit * 0.8 + fwd2 * 2.5) + vec3(0.45, 0.6, 1.0) * rim * lit * 0.2;   // white-hot line, hottest under the sun
    gl_FragColor = vec4(pow(glow, vec3(2.2)) * 1.7, 1.0);
  }`;

function starburstTex(size = 512) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d'), m = size / 2;
  const gr = g.createRadialGradient(m, m, 0, m, m, m);
  gr.addColorStop(0, 'rgba(255,255,250,1)'); gr.addColorStop(0.03, 'rgba(255,245,225,1)'); gr.addColorStop(0.12, 'rgba(255,190,130,0.35)');
  gr.addColorStop(0.4, 'rgba(255,140,80,0.06)'); gr.addColorStop(1, 'rgba(255,120,60,0)');
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = 'lighter';
  const spikes = [[0, 1, 1], [Math.PI / 2, 1, 1], [Math.PI / 4, 0.55, 0.6], [-Math.PI / 4, 0.55, 0.6], [0.35, 0.35, 0.4], [-1.2, 0.3, 0.35]];
  for (const [a, len, w] of spikes) for (const s of [1, -1]) {
    g.save(); g.translate(m, m); g.rotate(a + (s < 0 ? Math.PI : 0));
    const lg = g.createLinearGradient(0, 0, m * len, 0);
    lg.addColorStop(0, 'rgba(255,245,230,0.9)'); lg.addColorStop(0.4, 'rgba(255,200,150,0.35)'); lg.addColorStop(0.85, 'rgba(180,170,255,0.08)'); lg.addColorStop(1, 'rgba(255,150,90,0)');
    g.fillStyle = lg; g.beginPath(); g.moveTo(0, -3 * w); g.lineTo(m * len, 0); g.lineTo(0, 3 * w); g.fill(); g.restore();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function createOrbitScene(sunDir) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(40, 1, 1, 1.2e6);
  const sun = sunDir;   // shared: landing.js moves the sun (dawn timeline) and everything here follows
  const C = new THREE.Vector3();

  // Milky Way: a faint band of noise along a great circle, behind everything
  const mw = new THREE.Mesh(new THREE.SphereGeometry(9e5, 64, 32), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { uAxis: { value: new THREE.Vector3(0.3, 0.5, 0.81).normalize() } },
    vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 uAxis; varying vec3 vD; ${NOISE}
      void main(){ float b = exp(-pow(dot(vD, uAxis) / 0.16, 2.0));
        float n = n3(vD * 7.0) * 0.6 + n3(vD * 23.0) * 0.4, lanes = smoothstep(0.45, 0.7, n3(vD * 11.0 + 3.0));
        vec3 c = mix(vec3(0.55, 0.6, 0.75), vec3(0.9, 0.78, 0.65), n) * b * (0.5 + n) * (1.0 - 0.6 * lanes) * 0.012;
        gl_FragColor = vec4(c, 1.0); }`,
  }));
  scene.add(mw);

  // Stars: magnitude distribution, colour temperature, dimmed near the sun; size in pixels so they never shimmer
  const NS = 15000;
  {
    const pos = new Float32Array(NS * 3), col = new Float32Array(NS * 3), mag = new Float32Array(NS);
    const temps = [[0.65, 0.75, 1.0], [0.85, 0.9, 1.0], [1.0, 1.0, 1.0], [1.0, 0.92, 0.8], [1.0, 0.78, 0.6]];
    const axis = new THREE.Vector3(0.3, 0.5, 0.81).normalize(), v = new THREE.Vector3();
    for (let i = 0; i < NS; i++) {
      // a third of them crowd toward the Milky Way band
      do { const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u); v.set(r * Math.cos(a), u, r * Math.sin(a)); }
      while (i % 3 === 0 && Math.abs(v.dot(axis)) > 0.25 * Math.random() + 0.05);
      pos.set([v.x * 8e5, v.y * 8e5, v.z * 8e5], i * 3);
      const t = temps[Math.min(4, Math.floor(Math.pow(Math.random(), 0.7) * 5))]; col.set(t, i * 3);
      mag[i] = Math.pow(Math.random(), 9);              // most faint, a few bright
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aCol', new THREE.BufferAttribute(col, 3)); g.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
    const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uSun: { value: sun }, uPR: { value: 1 } },
      vertexShader: `uniform vec3 uSun; uniform float uPR; attribute vec3 aCol; attribute float aMag; varying vec3 vC; varying float vB;
        void main(){ vec3 d = normalize(position);
          float glare = smoothstep(0.75, 0.98, dot(d, uSun));
          vB = (0.08 + 2.6 * aMag) * (1.0 - glare); vC = aCol;
          gl_PointSize = (1.4 + 3.0 * aMag) * uPR; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec3 vC; varying float vB; void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; if (r > 1.0) discard;
        gl_FragColor = vec4(vC * vB * pow(1.0 - r, 2.0), 1.0); }` });
    const pts = new THREE.Points(g, m); pts.frustumCulled = false; scene.add(pts);
    scene.userData.starMat = m;
  }

  // Sun: a star-burst sprite, faded by how much of the disc clears the limb (set each frame)
  const burst = new THREE.Sprite(new THREE.SpriteMaterial({ map: starburstTex(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: 0xffffff }));
  burst.position.copy(sun).multiplyScalar(7e5); burst.scale.setScalar(7e5 * 0.05); scene.add(burst);

  // Planet
  const planetU = { uSun: { value: sun }, uCanyonC: { value: new THREE.Vector3(1, 0, 0) }, uCanyonA: { value: new THREE.Vector3(0, 0, 1) },
    uOct: { value: 8 }, uExag: { value: 5 }, uR: { value: R_MARS } };
  const planet = new THREE.Mesh(new THREE.SphereGeometry(R_MARS, 384, 256), new THREE.ShaderMaterial({
    uniforms: planetU,
    vertexShader: `varying vec3 vP; varying vec3 vN; varying vec3 vW;
      void main(){ vP = position; vN = normalize(mat3(modelMatrix) * normal);
        vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: PLANET_FS,
  }));
  scene.add(planet);

  // Thin cloud / dust wisps at ~20 km
  const cloud = new THREE.Mesh(new THREE.SphereGeometry(R_MARS + 20, 192, 128), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uSun: { value: sun }, uT: { value: 0 } },
    vertexShader: `varying vec3 vP; varying vec3 vN; void main(){ vP = normalize(position); vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 uSun; uniform float uT; varying vec3 vP; varying vec3 vN; ${NOISE}
      void main(){ vec3 q = vP * 9.0 + vec3(uT * 0.002, 0.0, 0.0);
        float n = n3(q) * 0.5 + n3(q * 2.7) * 0.3 + n3(vP * 70.0) * 0.2;
        float a = smoothstep(0.6, 0.82, n) * 0.4;
        float lit = smoothstep(-0.05, 0.3, dot(normalize(vN), uSun));
        gl_FragColor = vec4(pow(vec3(1.0, 0.9, 0.8) * (0.15 + 0.85 * lit), vec3(2.2)) * 1.2, a * (0.15 + 0.85 * lit)); }`,
  }));
  scene.add(cloud);

  // Atmosphere: analytic limb glow on a shell 150 km up
  const atmoU = { uSun: { value: sun }, uC: { value: C }, uR: { value: R_MARS }, uH: { value: 22 }, uInside: { value: 0 } };
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(R_MARS + 150, 192, 128), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: atmoU,
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: ATMO_FS,
  }));
  scene.add(atmo);

  const group = [planet, cloud, atmo];
  // Season: late southern spring. The planet's north pole (local +z) is tilted so the low orbit sun sits ~18 deg south of
  // Mars' equator (the most Mars' 25.2 deg obliquity allows is 25.2); that puts the ship's ground track at ~54N, over the
  // northern plains, still flying along world +X. The pole stays put while the planet turns under the ship about it.
  const POLE_TILT = -53.7 * Math.PI / 180, SPIN = 1 / Math.cos(-POLE_TILT);   // spin rate: ground track is a 54N circle
  // The canyon: centred a little ahead of the ship's starting point, running roughly along the ground track
  {
    for (const m of group) m.rotation.set(POLE_TILT, 0, 0);
    planet.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(planet.matrixWorld).invert().setPosition(0, 0, 0);
    const ahead = 6 * Math.PI / 180;
    planetU.uCanyonC.value.set(Math.sin(ahead), Math.cos(ahead), 0.12).normalize().applyMatrix4(inv).normalize();
    planetU.uCanyonA.value.set(Math.cos(ahead), -Math.sin(ahead), 0.25).normalize().applyMatrix4(inv).normalize();
  }
  const _o = new THREE.Vector3();
  let sunVis = 1, burstDir = null;
  return {
    scene, camera,
    get sunVisible() { return sunVis; },
    // Cinematic cheat (?sunrise): draw the sun disc and glare here instead of at the real sun (null = real)
    setBurstDir(v) { burstDir = v; },
    setQuality(oct, pr) { planetU.uOct.value = oct; scene.userData.starMat.uniforms.uPR.value = pr; },
    // h: ship altitude (km); phi: how far the planet has turned under the ship (rad); camOffM / quat: the ship camera's
    // offset from the ship (metres) and orientation, so both passes line up
    set(h, phi, camOffM, quat, t) {
      C.set(0, -(R_MARS + h), 0);
      for (const m of group) { m.position.copy(C); m.rotation.set(POLE_TILT, 0, phi * SPIN); }
      cloud.material.uniforms.uT.value = t;
      atmoU.uInside.value = h < 150 ? 1 : 0;
      camera.position.copy(camOffM).multiplyScalar(0.001);
      camera.quaternion.copy(quat);
      const near = Math.max(0.05, h * 0.25);
      if (Math.abs(camera.near - near) / near > 0.2) { camera.near = near; camera.updateProjectionMatrix(); }
      burst.position.copy(burstDir ?? sun).multiplyScalar(7e5);
      // How much of the sun clears the planet (+ a soft margin through the atmosphere)
      _o.copy(camera.position).sub(C);
      const sd = burstDir ?? sun, tc = -_o.dot(sd), b = tc > 0 ? _o.addScaledVector(sd, tc).length() : 1e9;
      sunVis = THREE.MathUtils.smoothstep(b, R_MARS - 5, R_MARS + 45);
      burst.material.opacity = sunVis;
      burst.visible = sunVis > 0.003;
    },
    resize(aspect, fov) { camera.aspect = aspect; camera.fov = fov; camera.updateProjectionMatrix(); },
  };
}
