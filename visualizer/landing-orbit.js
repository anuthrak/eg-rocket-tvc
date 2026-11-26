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

// The surface, shared by the bake and the live pass. Mars from orbit is mostly broad colour: bright dusty highlands, dark
// basaltic plains, wind streaks trailing behind craters, a layered canyon. Craters are shallow detail, not the pattern.
// Heights are on the unit sphere (×R for km); crater gradients are analytic, so the shading never comes from pixel blocks.
const SURF = /* glsl */`
  uniform vec3 uCanyonC, uCanyonA;
  ${NOISE}
  float fbmN(vec3 p, int oct){ float s = 0.0, a = 0.5, f = 1.0; for (int i = 0; i < 9; i++) { if (i >= oct) break; s += a * n3(p * f); f *= 2.03; a *= 0.5; } return s; }
  const vec3 WIND = vec3(0.36, 0.48, 0.8);
  // One crater scale. Returns height (x, unit sphere), fresh-ejecta brightness (y), wind streak (z); adds the height's
  // gradient (unit sphere) to g
  vec3 craters(vec3 p, float scale, float density, float depth, inout vec3 g){
    vec3 q = p * scale, i = floor(q), f = fract(q); float h = 0.0, ej = 0.0, st = 0.0;
    vec3 Wt = normalize(WIND - p * dot(WIND, p));
    for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) {
      vec3 n = vec3(x, y, z), c = i + n;
      if (h3(c + 7.7) > density) continue;
      vec3 v = n + h33(c) * 0.7 + 0.15 - f;                       // to the crater's centre (cell units)
      float r = mix(0.1, 0.4, pow(h3(c + 3.3), 2.2)), d = length(v) / r, age = h3(c + 1.1);
      float al = dot(-v, Wt) / r, ac = length(-v - Wt * dot(-v, Wt)) / r;   // downwind of the crater: a pale streak
      st += exp(-ac * ac / 0.35) * smoothstep(0.8, 1.3, al) * exp(-max(al - 1.0, 0.0) / 1.6) * (0.4 + 0.6 * age);
      if (d > 2.0) continue;
      float a = mix(0.8, 0.35, age), b = mix(0.9, 0.3, age);
      float bowl = -(1.0 - d * d) * step(d, 1.0), rim = exp(-pow((d - 1.0) / 0.22, 2.0)) * 0.4;
      float dh = a * 2.0 * d * step(d, 1.0) + b * rim * (-2.0 * (d - 1.0) / 0.0484);   // d(height)/dd
      h += r * (bowl * a + rim * b);
      g += dh * (-v) / (r * max(d, 1e-3) * r) * r * depth;          // d/dq of r·shape(|v|/r), then ×depth/scale·scale
      ej += exp(-pow((d - 1.2) / 0.3, 2.0)) * (1.0 - age) * step(1.0, d);
    }
    return vec3(h * depth / scale, ej, st);
  }
  // The canyon: a long trough with terraced, layered walls
  float canyon(vec3 p, out float band){
    vec3 nc = normalize(cross(uCanyonC, uCanyonA));
    float across = dot(p, nc) + 0.012 * (n3(p * 40.0) - 0.5), along = dot(p, uCanyonA);
    float m = smoothstep(0.26, 0.14, abs(along)) * step(0.0, dot(p, uCanyonC)), w = 0.011 * (0.7 + 0.6 * n3(p * 9.0));
    float cd = exp(-pow(across / w, 2.0));
    band = smoothstep(0.08, 0.35, cd) * smoothstep(0.95, 0.6, cd) * m;   // the walls
    return (cd + 0.06 * sin(cd * 9.42)) * m;   // a smooth trough with a gentle bench on each wall
  }
`;

// Bake (once, at load): colour, and the height's gradient, into two mipmapped cube maps. uMode 0: albedo; 1: gradient.
const BAKE_FS = /* glsl */`
  uniform float uMode, uTexel, uGS; varying vec3 vP;
  ${SURF}
  float height(vec3 p, out vec3 g, out vec3 cr2){
    g = vec3(0.0); float band, dark = smoothstep(0.5, 0.62, fbmN(p * 3.4 + 9.0, 7) + 0.18 * fbmN(p * 2.2 + 4.0, 5) - 0.05);
    vec3 c0 = craters(p, 10.0, 0.25, 0.12, g), c1 = craters(p, 34.0, 0.35 * (0.6 + 0.6 * (1.0 - dark)), 0.14, g), c2 = craters(p, 110.0, 0.4 * (0.5 + 0.7 * (1.0 - dark)), 0.15, g);
    cr2 = vec3(c0.y + c1.y + c2.y, c0.z + c1.z + c2.z, dark);
    return c0.x + c1.x + c2.x - 0.0022 * canyon(p, band) + 0.0008 * (fbmN(p * 14.0, 8) - 0.5);
  }
  void main(){
    vec3 p = normalize(vP), g, cr;
    if (uMode < 0.5) {
      float H = height(p, g, cr), band, cn = canyon(p, band), dark = cr.z;
      float big = fbmN(p * 2.2 + 4.0, 8), grit = fbmN(p * 90.0, 8), dusty = smoothstep(0.55, 0.78, fbmN(p * 6.0 + 2.0, 8));
      vec3 basalt = vec3(0.36, 0.17, 0.09), rust = vec3(0.66, 0.29, 0.12), ochre = vec3(0.84, 0.45, 0.2), dust = vec3(0.93, 0.64, 0.4);
      vec3 c = mix(ochre, rust, smoothstep(0.35, 0.72, big));
      c = mix(c, dust, dusty * 0.5);
      c = mix(c, basalt, dark * 0.75);
      c = mix(c, basalt * 1.15, smoothstep(0.52, 0.7, fbmN(p * 18.0 + 5.0, 7)) * 0.5);      // dark sand sheets, a few hundred km
      c = mix(c, dust, smoothstep(0.56, 0.74, fbmN(p * 45.0 + 1.0, 6)) * 0.35);           // bright dust patches
      c = mix(c, dust, clamp(cr.y, 0.0, 1.0) * 0.25 + clamp(cr.x, 0.0, 1.0) * 0.18);   // pale streaks, a little ejecta
      c *= 0.88 + 0.24 * grit;
      c = mix(c, basalt * 1.2, smoothstep(0.6, 1.0, cn) * 0.6);   // dark sand on the floor
      c = mix(c, dust * 0.95, band * 0.35);                        // pale layered walls
      float lat = p.z, fr = fbmN(p * 22.0 + 7.0, 6);
      float sCap = smoothstep(0.975, 0.99, -lat + 0.012 * (fr - 0.5)) * smoothstep(0.3, 0.55, fr + smoothstep(0.995, 0.998, -lat));
      sCap = max(sCap, smoothstep(0.996, 0.9985, -lat));
      c = mix(c, vec3(0.95, 0.93, 0.9), sCap);
      float nCap = smoothstep(0.87, 0.92, lat + 0.03 * (fr - 0.5)) * smoothstep(0.25, 0.6, fr + smoothstep(0.92, 0.97, lat));
      c = mix(c, vec3(0.78, 0.76, 0.74), nCap * 0.7);
      gl_FragColor = vec4(c, 1.0);
    } else {
      // gradient: analytic for the craters; the canyon and the broad relief by finite differences one texel apart
      vec3 t1 = normalize(cross(abs(p.z) < 0.9 ? vec3(0, 0, 1) : vec3(1, 0, 0), p)), t2 = cross(p, t1), cr, gx, gy;
      float H0 = height(p, g, cr), e = uTexel, b;
      vec3 pa = normalize(p + t1 * e), pb = normalize(p + t2 * e);
      float s0 = -0.0022 * canyon(p, b) + 0.0008 * (fbmN(p * 14.0, 8) - 0.5);
      float sa = -0.0022 * canyon(pa, b) + 0.0008 * (fbmN(pa * 14.0, 8) - 0.5), sb = -0.0022 * canyon(pb, b) + 0.0008 * (fbmN(pb * 14.0, 8) - 0.5);
      g += (t1 * (sa - s0) + t2 * (sb - s0)) / e;
      g -= p * dot(g, p);
      gl_FragColor = vec4(clamp(g * uGS + 0.5, 0.0, 1.0), 1.0);
    }
  }`;

const PLANET_FS = /* glsl */`
  uniform vec3 uSun; uniform float uOct, uExag, uR, uGS, uAlt; uniform samplerCube uAlb, uGrad; uniform mat3 uRot;
  varying vec3 vP; varying vec3 vN; varying vec3 vW;
  ${SURF}
  float fbmf(vec3 p, float foot){ float s = 0.0, a = 0.5, f = 1.0;
    for (int i = 0; i < 6; i++) { if (float(i) >= uOct) break;
      float k = smoothstep(foot * 3.0, foot * 10.0, 1.0 / f); s += a * n3(p * f) * k + a * 0.5 * (1.0 - k); f *= 2.03; a *= 0.5; }
    return s; }
  void main(){
    vec3 p = normalize(vP);
    // the larger of the two pixel footprints: detail fades before it can break into dashes at grazing angles
    float foot = max(length(dFdx(p)), length(dFdy(p))) + 1e-7;
    vec3 c = textureCube(uAlb, p).rgb, g = (textureCube(uGrad, p).rgb - 0.5) / uGS;
    // Live: the small craters (2-7 km) and fine grit, only where they're bigger than a few pixels
    float vis = smoothstep(foot * 4.0, foot * 14.0, 0.3 / 380.0);
    if (vis > 0.01) { vec3 gl = vec3(0.0); vec3 k = craters(p, 380.0, 0.45, 0.16, gl); g += gl * vis; c = mix(c, c * 1.12, clamp(k.y, 0.0, 1.0) * 0.3 * vis); }
    c *= 0.9 + 0.2 * fbmf(p * 1500.0, foot * 1500.0);
    // Light: lit ground, a soft red terminator, a near-black night side with a faint cool ambient
    vec3 N = normalize(vN), gw = uRot * g; gw -= N * dot(gw, N);
    vec3 n = normalize(N - uExag * gw);
    float mu = dot(N, uSun), d = max(dot(n, uSun), 0.0) * 0.85 + max(mu, 0.0) * 0.15;
    float day = smoothstep(-0.04, 0.12, mu);
    vec3 term = mix(vec3(1.0, 0.45, 0.25), vec3(1.0), smoothstep(0.0, 0.22, mu));
    vec3 col = pow(c, vec3(2.2)) * (d * 1.25 * term * day + 0.004 * vec3(0.55, 0.62, 0.8) + 0.05 * day * vec3(1.0, 0.7, 0.5));   // light in linear (+ skylight)
    col += vec3(0.27, 0.32, 0.4) * smoothstep(0.8, 0.95, p.z) * (0.01 * day + 0.0005);   // north polar hood
    // Aerial perspective: toward the limb, and over everything as the air thickens below ~60 km
    vec3 V = normalize(cameraPosition - vW);
    float limb = pow(1.0 - max(dot(N, V), 0.0), 4.0);
    col = mix(col, vec3(1.0, 0.28, 0.06) * smoothstep(-0.15, 0.3, mu) * 0.8, limb * 0.6);
    float dist = distance(cameraPosition, vW), thick = smoothstep(90.0, 15.0, uAlt);
    float hz = (1.0 - exp(-dist * (0.0006 + 0.0022 * thick))) * (0.2 + 0.55 * thick);
    col = mix(col, vec3(0.72, 0.27, 0.09) * (0.25 + 0.75 * day), hz * 0.7);
    gl_FragColor = vec4(col * 1.7, 1.0);
  }`;

const ATMO_FS = /* glsl */`
  uniform vec3 uSun, uC; uniform float uR, uH, uInside, uAlt; varying vec3 vW;
  void main(){
    if ((uInside > 0.5) == gl_FrontFacing) discard;          // outside the shell: front faces; inside: back faces
    vec3 o = cameraPosition, d = normalize(vW - o), oc = o - uC;
    float t = -dot(oc, d); vec3 P = oc + d * t; float b = length(P);
    float od, alt; vec3 nrm;
    if (b > uR) { alt = (uInside > 0.5 && t < 0.0) ? uAlt : b - uR; nrm = normalize(P); od = exp(-alt / uH); }   // grazing: through the shell (inside, looking up: from here)
    else {                                                                                   // over the disc: to the surface
      float th = sqrt(uR * uR - b * b); vec3 hit = oc + d * (t - th); nrm = normalize(hit);
      alt = 0.0; od = 0.18 / max(-dot(d, nrm), 0.05) * 0.12; }
    float lit = smoothstep(-0.25, 0.35, dot(nrm, uSun));
    float fwd = pow(max(dot(d, uSun), 0.0), 10.0);
    vec3 glow = vec3(1.0, 0.5, 0.22) * od * (lit * 1.0 + fwd * 1.8) * 0.85;   // broad haze; the rim line below stays full
    float fwd2 = pow(max(dot(d, uSun), 0.0), 40.0);
    float rim = exp(-alt / (uH * 0.18)) * step(uR, b);                                      // the thin bright line
    glow += vec3(1.0, 0.9, 0.82) * rim * (lit * 0.8 + fwd2 * 2.5) + vec3(0.45, 0.6, 1.0) * rim * lit * 0.2;   // white-hot line, hottest under the sun
    // Inside the atmosphere (the entry): the sky fills in as the air thickens (11 km scale height). Black with stars above
    // ~100 km, deep violet round 60 km, dusky orange round 30 km, butterscotch by 12 km; denser toward the horizon, a bluish
    // aureole round the sun; looking down, the same haze over the ground (aerial perspective)
    if (uInside > 0.5) { vec3 up = normalize(oc); float mu = dot(d, up), dens = exp(-uAlt / 11.0), sunUp = smoothstep(-0.15, 0.4, dot(up, uSun));
      float S;
      if (b < uR && t > 0.0) S = 1.0 - exp(-(1.0 - dens) * 0.35 / max(-mu, 0.07));                                     // down to the ground: haze over it
      else { float dm = exp(-(t > 0.0 ? b - uR : uAlt) / 11.0); S = 1.0 - exp(-dm * 6.0 / (t > 0.0 ? 0.05 : max(mu, 0.05))); }   // sky: thickest where the ray skims lowest
      vec3 sky = mix(vec3(0.24, 0.2, 0.5), vec3(0.8, 0.45, 0.27), smoothstep(0.04, 0.45, S));
      sky = mix(sky, vec3(0.88, 0.66, 0.46), smoothstep(0.45, 0.95, S));
      sky += vec3(0.45, 0.6, 0.95) * pow(max(dot(d, uSun), 0.0), 12.0) * 0.5 * S;
      glow = glow * (1.0 - 0.6 * S) + sky * S * (0.25 + 0.75 * sunUp) * (mu < 0.0 ? 0.75 : 0.95); }
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
    uOct: { value: 6 }, uExag: { value: 2.2 }, uR: { value: R_MARS }, uGS: { value: 0.4 }, uAlt: { value: 200 },
    uAlb: { value: null }, uGrad: { value: null }, uRot: { value: new THREE.Matrix3() } };
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
  const atmoU = { uSun: { value: sun }, uC: { value: C }, uR: { value: R_MARS }, uH: { value: 22 }, uInside: { value: 0 }, uAlt: { value: 200 } };
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
    // Bake the surface into two cube maps (colour; the height's gradient), mipmapped and anisotropically filtered
    bake(renderer, size = 2048) {
      const bs = new THREE.Scene(), u = { uMode: { value: 0 }, uTexel: { value: Math.PI / 2 / size }, uGS: planetU.uGS, uCanyonC: planetU.uCanyonC, uCanyonA: planetU.uCanyonA };
      const mat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthTest: false, depthWrite: false, uniforms: u,
        vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: BAKE_FS });
      bs.add(new THREE.Mesh(new THREE.SphereGeometry(10, 64, 32), mat));
      const aniso = renderer.capabilities.getMaxAnisotropy(), tm = renderer.toneMapping; renderer.toneMapping = THREE.NoToneMapping;
      for (const [mode, key] of [[0, 'uAlb'], [1, 'uGrad']]) {
        planetU[key].value?.dispose?.();
        const rt = new THREE.WebGLCubeRenderTarget(size, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
        rt.texture.anisotropy = aniso; u.uMode.value = mode;
        new THREE.CubeCamera(1, 100, rt).update(renderer, bs);
        planetU[key].value = rt.texture;
      }
      renderer.toneMapping = tm; mat.dispose();
    },
    setQuality(oct, pr) { planetU.uOct.value = oct; scene.userData.starMat.uniforms.uPR.value = pr; },
    // h: ship altitude (km); phi: how far the planet has turned under the ship (rad); camOffM / quat: the ship camera's
    // offset from the ship (metres) and orientation, so both passes line up
    set(h, phi, camOffM, quat, t) {
      C.set(0, -(R_MARS + h), 0);
      for (const m of group) { m.position.copy(C); m.rotation.set(POLE_TILT, 0, phi * SPIN); }
      planet.updateMatrixWorld(); planetU.uRot.value.setFromMatrix4(planet.matrixWorld); planetU.uAlt.value = h;
      cloud.material.uniforms.uT.value = t;
      atmoU.uInside.value = h < 150 ? 1 : 0; atmoU.uAlt.value = h;
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
