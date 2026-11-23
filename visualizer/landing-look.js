// Landing tab: the look. Colour presets sampled from reference photos, the post-processing chain (bloom, tone mapping,
// grade), a procedural lens flare, and the quality setting. Used by landing.js.
//
// Looks (sky, light, ground palette, grade, bloom), all colours as sRGB hex:
//   A "clear afternoon"  blue zenith → peach horizon, rich orange ground (landing)
//   B "golden dust"      warm hazy sky (belly flop, cloud deck)
//   C "burnt sienna"     deep and dramatic (entry, crash)
//   space                orbit and deorbit: deep blacks, bright limb
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';

const preset = o => o;
export const LOOKS = {
  A: preset({
    zen: '#4a2a24', mid: '#a0603e', hor: '#d79a6a', dust: 0.2,
    sun: '#fff0dc', sunI: 4.4, hemiSky: '#b08070', hemiGnd: '#5a2410', hemiI: 0.45, fog: 0.6e-5, exposure: 1.2, clouds: 0.12,
    gShadow: '#2a0f06', gMid: '#7a2e10', gLit: '#b8521e', gHigh: '#dca066', gRock: '#1e0d07',
    contrast: 1.2, sat: 1.2, tintLo: [0.94, 0.96, 1.06], tintHi: [1.05, 1.0, 0.93], vig: 0.32, grain: 0.03,
    bloom: [0.55, 0.45, 1.25], flare: 0.6,
  }),
  B: preset({
    zen: '#5e2c16', mid: '#b0642c', hor: '#d28a50', dust: 0.4,
    sun: '#ffdcaa', sunI: 3.8, hemiSky: '#c88050', hemiGnd: '#4a1806', hemiI: 0.55, fog: 1.0e-5, exposure: 1.15, clouds: 0.55,
    gShadow: '#2e0f05', gMid: '#82300f', gLit: '#bc561e', gHigh: '#e0a058', gRock: '#200d06',
    contrast: 1.18, sat: 1.2, tintLo: [1.04, 0.95, 0.92], tintHi: [1.04, 1.0, 0.9], vig: 0.38, grain: 0.035,
    bloom: [0.65, 0.55, 1.2], flare: 0.45,
  }),
  C: preset({
    zen: '#3a1400', mid: '#6c2b01', hor: '#984806', dust: 0.45,
    sun: '#ffc890', sunI: 3.4, hemiSky: '#a04a10', hemiGnd: '#2a0e02', hemiI: 0.55, fog: 1.8e-5, exposure: 1.3, clouds: 0.08,
    gShadow: '#4f1f08', gMid: '#773816', gLit: '#a5541f', gHigh: '#c6733c', gRock: '#2e1204',
    contrast: 1.18, sat: 1.2, tintLo: [0.96, 0.9, 0.88], tintHi: [1.06, 0.98, 0.88], vig: 0.48, grain: 0.04,
    bloom: [0.8, 0.6, 1.15], flare: 0.7,
  }),
  space: preset({
    zen: '#000000', mid: '#000000', hor: '#000000', dust: 0,
    sun: '#fff4e6', sunI: 3.4, hemiSky: '#8a96b8', hemiGnd: '#6a3018', hemiI: 0.4, fog: 0, exposure: 1.05, clouds: 0.7,
    gShadow: '#4f1f08', gMid: '#773816', gLit: '#a5541f', gHigh: '#c6733c', gRock: '#2e1204',
    contrast: 1.16, sat: 1.15, tintLo: [0.9, 1.0, 1.06], tintHi: [1.06, 1.0, 0.92], vig: 0.5, grain: 0.025,
    bloom: [0.85, 0.55, 1.25], flare: 1.0,
  }),
};
const COLOR_KEYS = ['zen', 'mid', 'hor', 'sun', 'hemiSky', 'hemiGnd', 'gShadow', 'gMid', 'gLit', 'gHigh', 'gRock'];
// Working copy: colours as linear THREE.Color, vectors as THREE.Vector3
function toLive(p) {
  const o = {};
  for (const [k, v] of Object.entries(p)) {
    if (COLOR_KEYS.includes(k)) o[k] = new THREE.Color(v);
    else if (Array.isArray(v)) o[k] = new THREE.Vector3(...v);
    else o[k] = v;
  }
  return o;
}
const LIVE = Object.fromEntries(Object.entries(LOOKS).map(([k, v]) => [k, toLive(v)]));
export function blendLooks(out, a, b, k) {   // out = a·(1-k) + b·k  (a, b: names)
  const A = LIVE[a], B = LIVE[b ?? a];
  for (const key of Object.keys(A)) {
    const va = A[key], vb = B[key];
    if (va.isColor) (out[key] ??= new THREE.Color()).copy(va).lerp(vb, k);
    else if (va.isVector3) (out[key] ??= new THREE.Vector3()).copy(va).lerp(vb, k);
    else out[key] = va + (vb - va) * k;
  }
  return out;
}
export function easeLook(cur, target, f) {   // move cur toward target by fraction f
  for (const key of Object.keys(target)) {
    const t = target[key];
    if (t.isColor) cur[key].lerp(t, f);
    else if (t.isVector3) cur[key].lerp(t, f);
    else cur[key] += (t - cur[key]) * f;
  }
}
export const newLook = name => blendLooks({}, name, name, 0);

// Grade: runs after OutputPass (display space). Saturation, contrast, split-tone, vignette, grain, fade and flash.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, uContrast: { value: 1 }, uSat: { value: 1 }, uTintLo: { value: new THREE.Vector3(1, 1, 1) },
    uTintHi: { value: new THREE.Vector3(1, 1, 1) }, uVig: { value: 0.3 }, uGrain: { value: 0.03 }, uTime: { value: 0 },
    uChroma: { value: 0 }, uFade: { value: 0 }, uFadeCol: { value: new THREE.Color(1, 0.95, 0.9) }, uFlash: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uContrast, uSat, uVig, uGrain, uTime, uChroma, uFade, uFlash;
    uniform vec3 uTintLo, uTintHi, uFadeCol; uniform vec2 uRes; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec3 c;
      if (uChroma > 0.0) { vec2 d = (vUv - 0.5) * uChroma * length(vUv - 0.5);
        c = vec3(texture2D(tDiffuse, vUv + d).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - d).b); }
      else c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSat);
      c = (c - 0.5) * uContrast + 0.5;
      c *= mix(uTintLo, uTintHi, smoothstep(0.08, 0.75, l));
      float r = length((vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0)) / 0.9;
      c *= 1.0 - uVig * smoothstep(0.3, 1.0, r);
      c += (h(vUv * uRes + fract(uTime) * 97.0) - 0.5) * uGrain;
      c = mix(c, uFadeCol, uFade);
      c = mix(c, vec3(1.0), uFlash);
      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }`,
};

// Quality levels
export const QUALITY = {
  high:   { label: 'High',   bloom: true,  grain: true,  shadow: 2048, rocks: 1.0,  pr: 2 },
  medium: { label: 'Medium', bloom: true,  grain: false, shadow: 1024, rocks: 0.55, pr: 1.5 },
  low:    { label: 'Low',    bloom: false, grain: false, shadow: 1024, rocks: 0.25, pr: 1 },
};
export const Q_ORDER = ['high', 'medium', 'low'];

// The chain: ground pass, or orbit planet pass + ship pass; bloom; output (tone mapping, sRGB); grade
export function createPost(renderer, ground, orbitScene, orbitCam, shipScene, camera) {
  const composer = new EffectComposer(renderer);
  const rpGround = new RenderPass(ground, camera);
  const rpOrbit = new RenderPass(orbitScene, orbitCam);
  const rpShip = new RenderPass(shipScene, camera); rpShip.clear = false; rpShip.clearDepth = true;
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.5, 1.2);
  const output = new OutputPass();
  const grade = new ShaderPass(GradeShader);
  [rpGround, rpOrbit, rpShip, bloom, output, grade].forEach(p => composer.addPass(p));
  return {
    composer, bloom, grade,
    setMode(orbit) { rpGround.enabled = !orbit; rpOrbit.enabled = rpShip.enabled = orbit; },
    apply(look, quality, t) {
      bloom.enabled = quality.bloom;
      bloom.strength = look.bloom.x; bloom.radius = look.bloom.y; bloom.threshold = look.bloom.z;
      const u = grade.uniforms;
      u.uContrast.value = look.contrast; u.uSat.value = look.sat; u.uTintLo.value.copy(look.tintLo); u.uTintHi.value.copy(look.tintHi);
      u.uVig.value = look.vig; u.uGrain.value = quality.grain ? look.grain : 0; u.uTime.value = t;
      renderer.toneMappingExposure = look.exposure;
    },
    setSize(w, h, pr) { composer.setPixelRatio(pr); composer.setSize(w, h); grade.uniforms.uRes.value.set(w * pr, h * pr); },
    render(dt) { composer.render(dt); },
  };
}

// Lens flare with procedural textures: a soft glow, a ring and a hexagon
function glowTex(size, stops) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([o, col]) => gr.addColorStop(o, col)); g.fillStyle = gr; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function ringTex(size) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
  g.strokeStyle = 'rgba(255,220,180,0.35)'; g.lineWidth = size * 0.03; g.beginPath(); g.arc(size / 2, size / 2, size * 0.42, 0, 7); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function hexTex(size) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
  g.fillStyle = 'rgba(255,200,150,0.22)'; g.beginPath();
  for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + i * Math.PI / 3; g.lineTo(size / 2 + Math.cos(a) * size * 0.45, size / 2 + Math.sin(a) * size * 0.45); }
  g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export function createFlare() {
  const glow = glowTex(256, [[0, 'rgba(255,250,240,1)'], [0.08, 'rgba(255,236,210,0.9)'], [0.3, 'rgba(255,200,150,0.25)'], [1, 'rgba(255,160,100,0)']]);
  const soft = glowTex(128, [[0, 'rgba(255,210,170,0.5)'], [1, 'rgba(255,180,120,0)']]);
  const ring = ringTex(256), hex = hexTex(128);
  const lf = new Lensflare();
  const els = [
    new LensflareElement(glow, 600, 0, new THREE.Color(1, 0.95, 0.88)),
    new LensflareElement(soft, 160, 0.25, new THREE.Color(1, 0.7, 0.45)),
    new LensflareElement(hex, 70, 0.45, new THREE.Color(1, 0.75, 0.5)),
    new LensflareElement(ring, 220, 0.62, new THREE.Color(1, 0.8, 0.6)),
    new LensflareElement(hex, 110, 0.8, new THREE.Color(0.85, 0.7, 1.0)),
    new LensflareElement(soft, 260, 1.0, new THREE.Color(0.9, 0.6, 0.4)),
  ];
  const base = els.map(e => e.size);
  els.forEach(e => lf.addElement(e));
  return { lf, setStrength(k) { els.forEach((e, i) => { e.size = base[i] * k; }); } };
}
