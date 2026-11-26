// Landing tab: the Mars outpost round the pad, laid out from one plan (section 14).
//
// PLAN is the single source for the base: where everything stands, its footprint (levelled into the terrain), the roads,
// rover tracks, pipe racks and cable runs (painted into a ground map the terrain shader reads per pixel), and the keep-outs
// the landing shots need (the approach corridor, the pad cams' and site cameras' view over the pad). landing.js uses it to
// level the footprints and shade the ground, then calls buildBase() once the ship exists (the parked ships are its clones).
//
// Zones, from the active pad LZ-1 at the origin (x east, z south-to-north; the approach crosses along z over LZ-1):
//   landing zone   LZ-1 (active), LZ-2 (cargo ship), LZ-3 in a row to the west-south-west, each in a low blast berm
//   propellant     tank farm, processing building, radiators, vent stack, pipe racks to LZ-1 and LZ-2 (south)
//   power          gridded solar farm with service roads (north), two small reactors behind regolith berms (north-west)
//   habitat        half-buried modules round a hub with covered tunnels, the greenhouse dome glowing inside, airlock and
//                  rover garage with two pressurised rovers, a landing light tower, a weather mast (north-east)
//   comms          mast and tracking dish on the nearest rise to the north-west
//   history        the first ship, retired and leaning on its old pad (south-west)
// Distances are compressed (real concepts put pads 1–3 km from the habitats); the berms make that read as deliberate.
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, k) => a + (b - a) * k;
const sstep = (a, b, x) => { const s = clamp((x - a) / (b - a), 0, 1); return s * s * (3 - 2 * s); };

export const PLAN = {
  pads: [{ id: 'LZ-1', x: 0, z: 0, active: true }, { id: 'LZ-2', x: -300, z: -125, cargo: true }, { id: 'LZ-3', x: -600, z: -250 }],
  oldPad: { x: -430, z: -560 },
  berm: { r: 47, h: 2.6 },                               // blast berm round each pad: radius, height
  plant: { x: 95, z: -345 },
  solar: { x: -50, z: 480, cols: 3, rows: 2, panels: 9, lines: 8 },   // blocks of `lines` rows × `panels` panels
  reactors: [{ x: -500, z: 560 }, { x: -640, z: 470 }],
  hub: { x: 440, z: 150 },
  garage: { x: 352, z: 104 },
  lightTower: { x: 392, z: 222, h: 42 },
  weather: { x: 545, z: 200 },
  padMast: { x: -175, z: 95, h: 120 },                   // instrument / floodlight mast by LZ-1 (the tele cam looks up past it)
  comms: { box: [-320, 640, -60, 900], x: -190, z: 760 },   // mast and dish on the highest point in the box (resolvePlan)
  roads: [   // [width, points]
    [9, [[-600, -250], [-300, -125], [0, 0]]],
    [8, [[0, 0], [40, -120], [95, -330]]],
    [8, [[0, 0], [150, 55], [300, 95], [352, 104], [440, 150]]],
    [7, [[95, -345], [260, -260], [420, -60], [440, 150]]],
    [7, [[440, 150], [300, 330], [120, 430], [52, 452]]],
    [6, [[-152, 480], [-330, 520], [-500, 560], [-640, 470]]],
    [6, [[-600, -250], [-430, -560]]],
  ],
  tracks: [   // off-road rover trails (wander)
    [[352, 104], [520, 30], [700, -60], [880, -40], [1000, 60]],
    [[-300, -125], [-120, -260], [95, -345]],
    [[440, 150], [620, 260], [760, 420], [700, 640]],
    [[-640, 470], [-820, 380], [-900, 180]],
    [[0, 0], [-120, 160], [-150, 330]],
  ],
  cables: [[[-50, 419], [200, 260], [440, 150]], [[-640, 470], [-500, 560], [-250, 470], [-147, 470]]],
  racks: [[[95, -320], [40, -120], [28, -40]], [[80, -340], [-120, -250], [-262, -150]]],   // pipe racks: plant → LZ-1, plant → LZ-2
  lowCams: [[-82, 98], [-82, -98], [-330, 60]],   // the pad cams and the tele cam (landing.js PAD_CAM, TVC_CAM.tele): LZ-1's berm is open toward them
  // Keep-outs. The TVC phase starts within ~170 m of LZ-1 at ~1.9 km and is within 60 m of it below 1 km (landing-sim):
  // a cone over the pad. Wedges: nothing tall straight behind the pad as the pad cams (±10°) and site cameras (±4°) see it.
  keep: { cone: { r: 200, maxH: 10, slope: 0.5 }, wedge: { deg: 10, siteDeg: 4, len: 1500, maxH: 8 } },
};
// Footprints levelled into the terrain: [x, z, radius]
export function footprints() {
  const P = PLAN, fp = [];
  for (const p of P.pads) if (!p.active) fp.push([p.x, p.z, 36]);
  fp.push([P.oldPad.x, P.oldPad.z, 30], [P.plant.x, P.plant.z, 72], [P.solar.x, P.solar.z, 118], [P.hub.x, P.hub.z, 72],
    [P.garage.x, P.garage.z, 24], [P.lightTower.x, P.lightTower.z, 9], [P.weather.x, P.weather.z, 6], ...P.reactors.map(r => [r.x, r.z, 34]));
  return fp;
}
// Pick the comms rise once the terrain exists; add its road
export function resolvePlan(heightAt) {
  const [x0, z0, x1, z1] = PLAN.comms.box; let best = -1e9;
  for (let x = x0; x <= x1; x += 20) for (let z = z0; z <= z1; z += 20) { const h = heightAt(x, z); if (h > best) { best = h; PLAN.comms.x = x; PLAN.comms.z = z; } }
  PLAN.roads.push([5, [[-150, 541], [lerp(-150, PLAN.comms.x, 0.5), lerp(541, PLAN.comms.z, 0.5) + 30], [PLAN.comms.x + 14, PLAN.comms.z - 10]]]);
}
// Is (x, z) on a road, a pad or a footprint? (rocks stay off)
export function onBase(x, z, pad = 4) {
  for (const [w, pts] of PLAN.roads) for (let i = 1; i < pts.length; i++) if (segDist(x, z, pts[i - 1], pts[i]) < w / 2 + pad) return true;
  for (const [fx, fz, r] of footprints()) if (Math.hypot(x - fx, z - fz) < r * 0.85) return true;
  return false;
}
function segDist(x, z, a, b) {
  const vx = b[0] - a[0], vz = b[1] - a[1], t = clamp(((x - a[0]) * vx + (z - a[1]) * vz) / (vx * vx + vz * vz), 0, 1);
  return Math.hypot(x - a[0] - vx * t, z - a[1] - vz * t);
}
function densify(pts, step) {   // points every `step` m along a polyline, with headings
  const out = [];
  for (let i = 1; i < pts.length; i++) { const [ax, az] = pts[i - 1], [bx, bz] = pts[i], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / step));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) out.push([lerp(ax, bx, k / n), lerp(az, bz, k / n), Math.atan2(bz - az, bx - ax)]); }
  return out;
}

// ---------- Ground map: what the terrain shader paints under the base ----------
// R: graded / compacted (roads, pad aprons, footprints)   G: darkening (rover tracks, contact shade, soot)
// B: blast scour round the pads (dust blown off, dark grit showing in radial streaks)
export const MAP = { min: -1100, size: 2200, px: 2048 };
export function makeBaseMap(THREE) {
  const N = MAP.px, k = N / MAP.size, X = x => (x - MAP.min) * k;
  const layer = () => { const c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, N, N); g.globalCompositeOperation = 'lighter'; return [c, g]; };
  const [cR, R] = layer(), [cG, G] = layer(), [cB, B] = layer();
  let s = 7; const r01 = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const line = (g, pts, w, a, dash) => { g.strokeStyle = `rgba(255,255,255,${a})`; g.lineWidth = Math.max(1, w * k); g.lineCap = g.lineJoin = 'round'; g.setLineDash(dash || []);
    g.beginPath(); pts.forEach(([x, z], i) => i ? g.lineTo(X(x), X(z)) : g.moveTo(X(x), X(z))); g.stroke(); g.setLineDash([]); };
  const blob = (g, x, z, r, a) => { const gr = g.createRadialGradient(X(x), X(z), 0, X(x), X(z), r * k); gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(X(x) - r * k, X(z) - r * k, 2 * r * k, 2 * r * k); };
  const wobble = (pts, amp) => densify(pts, 14).map(([x, z], i, a) => { const t = i / a.length; return [x + amp * Math.sin(t * 23 + x * 0.01), z + amp * Math.cos(t * 19 + z * 0.01)]; });
  // Roads: graded bed, softer shoulders (windrows), two wheel tracks each way
  for (const [w, pts] of PLAN.roads) {
    line(R, pts, w + 5, 0.25); line(R, pts, w, 0.75);
    for (const o of [-0.32, -0.12, 0.12, 0.32]) line(G, offset(pts, o * w), 0.55, 0.22);
  }
  // Solar farm service roads (a grid between the blocks and round the edge)
  { const S = PLAN.solar, bw = S.panels * 6.6, bd = S.lines * 7, W = S.cols * bw + (S.cols - 1) * 10, D = S.rows * bd + (S.rows - 1) * 10, x0 = S.x - W / 2, z0 = S.z - D / 2;
    for (let i = 0; i <= S.cols; i++) { const x = x0 + i * (bw + 10) - 5; line(R, [[x, z0 - 6], [x, z0 + D + 6]], 5, 0.6); }
    for (let j = 0; j <= S.rows; j++) { const z = z0 + j * (bd + 10) - 5; line(R, [[x0 - 6, z], [x0 + W + 6, z]], 5, 0.6); } }
  // Off-road trails, faint, and their wheel lines
  for (const pts of PLAN.tracks) { const p = wobble(pts, 9); line(G, offset(p, -1.1), 0.6, 0.2); line(G, offset(p, 1.1), 0.6, 0.2); line(R, p, 3, 0.12); }
  // Footprints: graded, a little compacted
  for (const [x, z, r] of footprints()) blob(R, x, z, r * 1.05, 0.35);
  // Pads: graded aprons, soot ring, radial scour streaks out to ~130 m (stronger at the active pad), the old pad sooty
  for (const p of [...PLAN.pads, { ...PLAN.oldPad, old: true }]) {
    const act = p.active ? 1 : p.old ? 0.8 : 0.55;
    blob(R, p.x, p.z, 44, 0.5); blob(G, p.x, p.z, 38 * (p.old ? 1.2 : 1), 0.35 * act);
    for (let i = 0; i < 160 * act; i++) { const a = r01() * 6.283, r0 = 27 + r01() * 8, r1 = r0 + 25 + Math.pow(r01(), 1.5) * 100 * act;
      B.strokeStyle = `rgba(255,255,255,${0.05 + 0.12 * r01()})`; B.lineWidth = (1.5 + 4 * r01()) * k; B.beginPath();
      B.moveTo(X(p.x + Math.cos(a) * r0), X(p.z + Math.sin(a) * r0)); B.lineTo(X(p.x + Math.cos(a + (r01() - 0.5) * 0.08) * r1), X(p.z + Math.sin(a + (r01() - 0.5) * 0.08) * r1)); B.stroke(); }
  }
  // Contact shade under buildings (the low sun's shadows are baked into the terrain only for terrain)
  for (const [x, z, r] of PLAN.contact || []) blob(G, x, z, r, 0.32);
  // Pack R, G, B into one texture (linear data)
  const out = document.createElement('canvas'); out.width = out.height = N; const o = out.getContext('2d'), img = o.createImageData(N, N);
  const dR = R.getImageData(0, 0, N, N).data, dG = G.getImageData(0, 0, N, N).data, dB = B.getImageData(0, 0, N, N).data;
  for (let i = 0; i < N * N * 4; i += 4) { img.data[i] = dR[i]; img.data[i + 1] = dG[i]; img.data[i + 2] = dB[i]; img.data[i + 3] = 255; }
  o.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(out); t.flipY = false; t.colorSpace = THREE.NoColorSpace; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
function offset(pts, d) {   // a polyline shifted sideways by d
  return pts.map(([x, z], i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
    return [x - dz / L * d, z + dx / L * d]; });
}
// Contact shade spots, registered by the builder (drawn into the map: the map is made after the plan is final)
PLAN.contact = [];

// ---------- Pad paint: grey disc, edge ring with hazard dashes, cross, number ----------
export function padTexture(THREE, label, worn = 0) {
  const c = document.createElement('canvas'); c.width = c.height = 1024; const g = c.getContext('2d'), S = 2;
  g.fillStyle = worn ? '#5e5853' : '#6b6662'; g.beginPath(); g.arc(512, 512, 510, 0, 7); g.fill();
  for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(${Math.random() < 0.55 ? '70,34,16' : '255,255,255'},${Math.random() * (0.06 + 0.1 * worn)})`; g.fillRect(Math.random() * 1024, Math.random() * 1024, 4, 4); }
  for (let i = 0; i < 64; i++) { const a = i / 64 * Math.PI * 2; g.strokeStyle = i % 2 ? '#1e1c1b' : '#e8b324'; g.lineWidth = 30; g.beginPath(); g.arc(512, 512, 482, a, a + Math.PI * 2 / 64); g.stroke(); }
  g.strokeStyle = '#ecebe6'; g.lineWidth = 12 * S; g.beginPath(); g.arc(512, 512, 440, 0, 7); g.stroke();
  g.lineWidth = 6 * S; g.beginPath(); g.arc(512, 512, 240, 0, 7); g.stroke();
  g.lineWidth = 18 * S; g.beginPath(); g.moveTo(340, 340); g.lineTo(684, 684); g.moveTo(684, 340); g.lineTo(340, 684); g.stroke();
  g.fillStyle = '#f5a623'; for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; g.fillRect(512 + Math.cos(a) * 392 - 14, 512 + Math.sin(a) * 392 - 14, 28, 28); }
  g.fillStyle = '#ecebe6'; g.font = 'bold 120px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, 512, 512 + 330);
  if (worn) { const gr = g.createRadialGradient(512, 512, 40, 512, 512, 520); gr.addColorStop(0, 'rgba(20,12,8,0.75)'); gr.addColorStop(1, 'rgba(20,12,8,0)'); g.fillStyle = gr; g.fillRect(0, 0, 1024, 1024); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

// ---------- Keep-outs: the landing shots must stay clear ----------
// objs: [{ name, x, z, h }]. cams: { pad: [[x, z], ...], site: [x, z] }. Returns the violations (also drawn on the map).
export function checkPlan(objs, cams) {
  const out = [], K = PLAN.keep;
  for (const o of objs) {
    const d0 = Math.hypot(o.x, o.z); if (!o.atPad && o.h > K.cone.maxH + Math.max(0, d0 - K.cone.r) * K.cone.slope) out.push([o, 'in the landing cone over LZ-1']);
    for (const [cx, cz, deg] of [...cams.pad.map(c => [...c, K.wedge.deg]), [...cams.site, K.wedge.siteDeg]]) {
      const ax = Math.atan2(-cz, -cx), ao = Math.atan2(o.z - cz, o.x - cx), d = Math.hypot(o.x - cx, o.z - cz), dp = Math.hypot(cx, cz);
      let da = Math.abs(ao - ax); if (da > Math.PI) da = 2 * Math.PI - da;
      if (d > dp + 20 && d < dp + K.wedge.len && da < deg * DEG && o.h > K.wedge.maxH) out.push([o, `behind the pad from the camera at ${cx.toFixed(0)}, ${cz.toFixed(0)}`]);
    }
  }
  return out;
}
// Top-down map of the plan (?debug, M): zones, roads, keep-outs, cameras, violations in red
export function drawPlanMap(canvas, objs, cams, bad) {
  const g = canvas.getContext('2d'), W = canvas.width, sc = W / 2200, X = x => (x + 1100) * sc;
  g.fillStyle = 'rgba(30,18,12,0.92)'; g.fillRect(0, 0, W, W);
  g.fillStyle = 'rgba(255,200,80,0.12)'; const K = PLAN.keep;
  g.beginPath(); g.arc(X(0), X(0), K.cone.r * sc, 0, 7); g.fill();
  for (const [cx, cz, deg] of [...cams.pad.map(c => [...c, K.wedge.deg]), [...cams.site, K.wedge.siteDeg]]) { const a = Math.atan2(-cz, -cx), dp = Math.hypot(cx, cz);
    g.fillStyle = 'rgba(120,180,255,0.14)'; g.beginPath(); g.moveTo(X(cx), X(cz));
    for (const s of [-1, 1]) { const b = a + s * deg * DEG; g.lineTo(X(cx + Math.cos(b) * (dp + K.wedge.len)), X(cz + Math.sin(b) * (dp + K.wedge.len))); }
    g.closePath(); g.fill(); g.fillStyle = '#7fb4ff'; g.fillRect(X(cx) - 4, X(cz) - 4, 8, 8); }
  g.strokeStyle = 'rgba(230,200,160,0.7)'; g.lineCap = 'round';
  for (const [w, pts] of PLAN.roads) { g.lineWidth = Math.max(1.5, w * sc); g.beginPath(); pts.forEach(([x, z], i) => i ? g.lineTo(X(x), X(z)) : g.moveTo(X(x), X(z))); g.stroke(); }
  g.strokeStyle = 'rgba(255,255,255,0.35)'; for (const [x, z, r] of footprints()) { g.lineWidth = 1; g.beginPath(); g.arc(X(x), X(z), r * sc, 0, 7); g.stroke(); }
  const badSet = new Set(bad.map(b => b[0]));
  for (const o of objs) { g.fillStyle = badSet.has(o) ? '#ff4d5e' : o.h > 20 ? '#ffd27a' : '#e8e2da'; g.beginPath(); g.arc(X(o.x), X(o.z), Math.max(2.5, Math.min(7, o.h / 8)), 0, 7); g.fill(); }
  g.fillStyle = '#fff'; g.font = '12px sans-serif'; g.fillText('PLAN  ·  +z down  ·  +x right  ·  1 px = ' + (1 / sc).toFixed(1) + ' m  ·  amber: landing cone  ·  blue: camera wedges', 10, 18);
  for (const p of PLAN.pads) g.fillText(p.id, X(p.x) + 6, X(p.z) - 6);
  bad.forEach(([o, why], i) => { g.fillStyle = '#ff8b95'; g.fillText(`${o.name}: ${why}`, 10, W - 12 - 15 * i); });
}

// ---------- The builder ----------
// ctx: { THREE, scene, groundAt(x, z) (the drawn ground's height), heightAt, groundU (look palette), wind: [x, z],
//        parkedShip({ lean, dusty }) → Group with its feet at y = 0, dust (particles), lamp/red (light materials) }
export function buildBase(ctx) {
  const { THREE, scene, groundAt } = ctx;
  const objs = [];                                     // for the keep-out check and the map
  const reg = (name, x, z, h, extra) => objs.push({ name, x, z, h, ...extra });
  // Shared dust: orange dust on every surface facing the wind, on tops, thickest near the ground
  const dustU = { uWind: { value: new THREE.Vector3(ctx.wind[0], 0, ctx.wind[1]).normalize() }, uDustA: ctx.groundU.uGLit, uDustB: ctx.groundU.uGHigh };
  const dusty = (mat, k = 1) => {
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, dustU); sh.uniforms.uDustK = { value: k };
      sh.vertexShader = 'varying vec3 vDN; varying vec3 vDP; varying float vDY;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vDN = normalize(inverseTransformDirection(transformedNormal, viewMatrix)); vDY = position.y;
        vec4 dWP = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          dWP = instanceMatrix * dWP;
        #endif
        vDP = (modelMatrix * dWP).xyz;`);
      sh.fragmentShader = 'uniform vec3 uWind, uDustA, uDustB; uniform float uDustK; varying vec3 vDN; varying vec3 vDP; varying float vDY;\n'
        + 'float dh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        { vec3 n = normalize(vDN); float wf = smoothstep(-0.15, 0.75, dot(n, -uWind)), top = smoothstep(0.45, 0.95, n.y), low = 1.0 - smoothstep(0.0, 3.0, vDY);
          float mott = 0.75 + 0.5 * dh(floor(vDP.xz * 0.7) + floor(vDP.y * 0.7));
          float d = clamp((0.42 * wf + 0.38 * top + 0.5 * low) * mott, 0.0, 0.85) * uDustK;
          diffuseColor.rgb = mix(diffuseColor.rgb, mix(uDustA, uDustB, 0.45) * 1.05, d); }`);
    };
    mat.customProgramCacheKey = () => 'dusty' + k; return mat;
  };
  const M = {
    white: dusty(new THREE.MeshStandardMaterial({ color: 0xd6cfc4, metalness: 0.1, roughness: 0.66 })),
    grey: dusty(new THREE.MeshStandardMaterial({ color: 0xb4afa7, metalness: 0.5, roughness: 0.45 })),
    dark: dusty(new THREE.MeshStandardMaterial({ color: 0x24262b, metalness: 0.4, roughness: 0.5 }), 0.6),
    window: new THREE.MeshStandardMaterial({ color: 0x0d1016, metalness: 0.9, roughness: 0.12 }),
    panel: dusty(new THREE.MeshStandardMaterial({ color: 0x2d4566, metalness: 0.75, roughness: 0.22 }), 0.35),
    rad: dusty(new THREE.MeshStandardMaterial({ color: 0xd9d6d0, metalness: 0.3, roughness: 0.4 })),
    orange: dusty(new THREE.MeshStandardMaterial({ color: 0xd0632a, metalness: 0.1, roughness: 0.6, emissive: 0x3a1206 }), 0.4),
    reg: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 }),
    glass: new THREE.MeshStandardMaterial({ color: 0xd2e2e6, metalness: 0.5, roughness: 0.08, transparent: true, opacity: 0.38, depthWrite: false }),
    glow: new THREE.MeshBasicMaterial({ color: 0xffb36a }),
    lamp: ctx.lamp, red: ctx.red,
  };
  M.reg.onBeforeCompile = sh => { Object.assign(sh.uniforms, { uGMid: ctx.groundU.uGMid, uGLit: ctx.groundU.uGLit, uGHigh: ctx.groundU.uGHigh });   // regolith: the ground's own colour
    sh.vertexShader = 'varying vec3 vRP;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vRP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'uniform vec3 uGMid, uGLit, uGHigh; varying vec3 vRP;\nfloat rh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n'
      + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      diffuseColor.rgb = mix(uGLit, uGHigh, 0.35 + 0.18 * rh(floor(vRP.xz * 0.5))) * 0.92 * (0.9 + 0.2 * rh(floor(vRP.xz * 2.0) + 3.0));`); };
  M.glow.defines = { HAZE_K: '0.6' };

  // Static geometry is merged per material: few draw calls however much is built
  const batch = new Map(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sv = new THREE.Vector3();
  const add = (geo, mat, x, y, z, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    const g = geo.index ? geo.clone() : geo.clone(); e.set(rx, ry, rz, 'YXZ'); m4.compose(v.set(x, y, z), q.setFromEuler(e), sv.set(sx, sy, sz)); g.applyMatrix4(m4);
    if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    (batch.get(mat) || batch.set(mat, []).get(mat)).push(g);
  };
  const G = {
    box: new THREE.BoxGeometry(1, 1, 1), cyl: new THREE.CylinderGeometry(1, 1, 1, 24), cyl8: new THREE.CylinderGeometry(1, 1, 1, 8),
    hcyl: new THREE.CylinderGeometry(1, 1, 1, 24).rotateZ(Math.PI / 2), sph: new THREE.SphereGeometry(1, 24, 12), dome: new THREE.SphereGeometry(1, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    lampS: new THREE.SphereGeometry(1, 8, 6),
  };
  const box = (mat, x, y, z, w, h, d, ry = 0) => add(G.box, mat, x, y + h / 2, z, ry, 0, 0, w, h, d);
  const post = (mat, x, y, z, r, h) => add(G.cyl8, mat, x, y + h / 2, z, 0, 0, 0, r, h, r);
  const gy = (x, z) => groundAt(x, z);
  const rot = (x, z, a, ox, oz) => [x + ox * Math.cos(a) - oz * Math.sin(a), z + ox * Math.sin(a) + oz * Math.cos(a)];
  const lamps = [], beacons = [];   // animated lights
  const lamp = (x, y, z, r = 0.35, red = false, period = 0, phase = 0) => { const m = new THREE.Mesh(G.lampS, red ? M.red : M.lamp); m.position.set(x, y, z); m.scale.setScalar(r); scene.add(m);
    (red ? beacons : lamps).push({ m, period, phase }); return m; };
  const contact = (x, z, r) => PLAN.contact.push([x, z, r]);
  // Lattice tower: four legs, cross bracing every 4 m
  const lattice = (x, z, H, W = 3.5) => { const y = gy(x, z);
    for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) add(G.cyl8, M.grey, x + a * W / 2, y + H / 2, z + b * W / 2, 0, 0, 0, 0.18, H, 0.18);
    for (let h = 2; h < H - 2; h += 4) for (let s = 0; s < 4; s++) { const L = Math.hypot(W, 4);
      if (s < 2) add(G.cyl8, M.grey, x, y + h + 2, z + (s ? 1 : -1) * W / 2, 0, 0, Math.atan2(W, 4) * (h % 8 ? 1 : -1), 0.08, L, 0.08);
      else add(G.cyl8, M.grey, x + (s === 2 ? 1 : -1) * W / 2, y + h + 2, z, 0, Math.atan2(W, 4) * (h % 8 ? 1 : -1), 0, 0.08, L, 0.08); }
    contact(x, z, W * 2); return y; };
  // Regolith berm along an arc or polyline, draped on the ground; gaps where roads cross
  const bermGeo = (pts, H, B) => {   // pts: [[x, z], ...] dense; cross-section 9 points, width B, height H
    const pos = [], uv = [], idx = [], S = 9;
    pts.forEach(([x, z], i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1, nx = -dz / L, nz = dx / L;
      const tip = Math.min(1, Math.min(i, pts.length - 1 - i) / 3);   // ends taper
      for (let j = 0; j < S; j++) { const u = j / (S - 1) * 2 - 1, px = x + nx * u * B / 2, pz = z + nz * u * B / 2, hh = H * tip * Math.pow(Math.max(0, 1 - u * u), 0.8);
        pos.push(px, gy(px, pz) + hh - 0.25, pz); uv.push(j / (S - 1), i / 10); } });
    for (let i = 0; i < pts.length - 1; i++) for (let j = 0; j < S - 1; j++) { const a = i * S + j, b = a + S; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
  };
  const roadNear = (x, z, m) => PLAN.roads.some(([w, pts]) => pts.some((p, i) => i && segDist(x, z, pts[i - 1], p) < w / 2 + m));
  const ringBerm = (cx, cz, R, H, B, from = 0, to = Math.PI * 2, sight = false) => {   // split into runs between road (and sight-line) gaps
    let run = [];
    const seen = (x, z) => sight && PLAN.lowCams.some(c => segDist(x, z, [cx, cz], c) < 11);
    const flush = () => { if (run.length > 3) add(bermGeo(run, H, B), M.reg, 0, 0, 0); run = []; };
    for (let a = from; a <= to + 1e-6; a += 2 / R) { const x = cx + Math.cos(a) * R, z = cz + Math.sin(a) * R; if (roadNear(x, z, 3) || seen(x, z)) flush(); else run.push([x, z]); }
    flush();
  };

  // ---- Landing zone: three pads in blast berms; the cargo ship on LZ-2 with a gantry crane and containers ----
  const pads = [];
  for (const p of PLAN.pads) {
    const y = gy(p.x, p.z);
    if (!p.active) { const disc = new THREE.Mesh(new THREE.CircleGeometry(25, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: padTexture(THREE, p.id, 0.3), roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 }));
      disc.position.set(p.x, y + 0.08, p.z); disc.receiveShadow = true; scene.add(disc); }
    ringBerm(p.x, p.z, PLAN.berm.r, PLAN.berm.h, 13, 0, Math.PI * 2, p.active);
    if (!p.active) for (let i = 0; i < 8; i++) { const a = i / 8 * 6.283 + 0.2, x = p.x + Math.cos(a) * 29, z = p.z + Math.sin(a) * 29; post(M.dark, x, gy(x, z), z, 0.12, 1.2); lamp(x, gy(x, z) + 1.35, z, 0.28, true, p.active ? 0 : 2.4, i / 8); }
    pads.push({ ...p, y });
    reg(p.id, p.x, p.z, PLAN.berm.h, { atPad: true });
  }
  { const p = PLAN.pads[1], s = ctx.parkedShip({ lean: 0 }); s.position.set(p.x, gy(p.x, p.z), p.z); s.rotation.y = 2.1; scene.add(s); reg('cargo ship', p.x, p.z, 50);
    // gantry crane beside it: two towers 26 m out, a beam between them, a jib over the cargo door, a hook line; containers set down
    const ca = -0.9, [cx, cz] = rot(p.x, p.z, ca, 26, 0), y = gy(cx, cz);
    for (const s2 of [-1, 1]) { const [tx, tz] = rot(p.x, p.z, ca, 26, s2 * 10); lattice(tx, tz, 34, 2.4); }
    add(G.box, M.orange, cx, y + 34.6, cz, -ca, 0, 0, 1.4, 1.4, 22);
    { const [jx, jz] = rot(p.x, p.z, ca, 19, 0); add(G.box, M.orange, jx, y + 35.4, jz, -ca, 0, 0, 15, 1.1, 1.1); const [hx, hz] = rot(p.x, p.z, ca, 13, 0);
      add(G.cyl8, M.dark, hx, y + 23, hz, 0, 0, 0, 0.05, 24, 0.05); box(M.grey, hx, y + 9.5, hz, 2.6, 1.2, 2.6, -ca); }
    contact(cx, cz, 14); contact(p.x + 32, p.z + 9, 16); reg('gantry crane', cx, cz, 35);
  }
  // Floodlight / instrument mast by LZ-1 (lights come on for the landing)
  const flood = [];
  { const P = PLAN.padMast, y = lattice(P.x, P.z, P.h, 4); add(G.box, M.grey, P.x, y + P.h + 0.5, P.z, 0, 0, 0, 6, 1, 6);
    for (let i = 0; i < 6; i++) { const a = 0.5 + i * 0.22, x = P.x + Math.cos(a) * 2.5, z = P.z - Math.sin(a) * 2.5; box(M.dark, x, y + P.h - 3, z, 1.4, 1.2, 0.7, -a); flood.push(lamp(x + Math.cos(a) * 0.4, y + P.h - 2.4, z - Math.sin(a) * 0.4, 0.5)); }
    lamp(P.x, y + P.h + 1.6, P.z, 0.9, true, 1.6, 0); lamp(P.x, y + P.h * 0.5, P.z, 0.7, true, 1.6, 0.5); reg('pad mast', P.x, P.z, P.h, { atPad: true }); }

  // ---- Propellant plant: tank farm, processing building, radiators, vent stack; pipe racks to LZ-1 and LZ-2 ----
  const vents = [];
  { const P = PLAN.plant, a = -0.35, Y = gy(P.x, P.z);
    const at = (ox, oz) => rot(P.x, P.z, a, ox, oz);
    [[-30, -12, 32], [-18, -12, 32], [-30, 0, 32], [-18, 0, 32], [-24, 13, 22], [-6, 13, 22]].forEach(([ox, oz, h]) => { const [x, z] = at(ox, oz);
      add(G.cyl, M.white, x, Y + h / 2, z, 0, 0, 0, 4.6, h, 4.6); add(G.dome, M.white, x, Y + h, z, 0, 0, 0, 4.6, 1.4, 4.6); post(M.grey, x + 4.7, Y, z, 0.12, h); lamp(x, Y + h + 1.7, z, 0.4, true, 2.2, ox * 0.01); });
    { const [x, z] = at(14, -4); box(M.white, x, Y, z, 30, 11, 15, -a); box(M.grey, x, Y + 11, z, 26, 1.2, 11, -a);
      for (let i = 0; i < 5; i++) { const [wx, wz] = at(2 + i * 6, -11.6); box(M.window, wx, Y + 6, wz, 3, 1.2, 0.2, -a); }
      for (let i = 0; i < 6; i++) { const [rx, rz] = at(0.5 + i * 5.4, -11.55); box(M.grey, rx, Y, rz, 0.35, 11, 0.3, -a); }   // wall ribs
      for (const [ox, oz, w, h] of [[6, -2, 5, 3], [16, 1, 4, 2.4], [24, -3, 3, 4]]) { const [rx, rz] = at(ox, oz); box(M.grey, rx, Y + 12.2, rz, w, h, 3.5, -a); }   // roof plant
      { const [dx, dz] = at(-0.6, -4); box(M.orange, dx, Y, dz, 0.3, 5, 4.4, -a); }   // door
      for (const oz of [-8, -6.8]) { const [px, pz] = at(-6, oz); add(G.hcyl, M.grey, px, Y + 7 + oz * 0.1, pz, -a, 0, 0, 12, 0.3, 0.3); } }
    { const [x, z] = at(26, 4); add(G.cyl8, M.grey, x, Y + 11, z, 0, 0, 0, 0.9, 22, 0.9); vents.push([x, Y + 22.5, z]); lamp(x, Y + 23, z, 0.4, true, 1.9, 0.3); }
    for (let r = 0; r < 2; r++) for (let i = 0; i < 7; i++) { const [x, z] = at(4 + i * 4, 14 + r * 7); add(G.box, M.rad, x, Y + 6, z, -a, 0, 0, 0.2, 9, 3.4); post(M.grey, x, Y, z, 0.1, 1.5); }
    contact(P.x - 10, P.z, 40); contact(P.x + 12, P.z, 22);
    reg('tank farm', ...at(-24, 0), 33); reg('processing', ...at(14, -4), 12); reg('vent stack', ...at(26, 4), 22); reg('radiators', ...at(16, 17), 10);
    for (const R of PLAN.racks) for (const [x, z, h] of densify(R, 10)) { const y = gy(x, z); post(M.grey, x, y, z, 0.15, 3.6); add(G.box, M.grey, x, y + 3.6, z, -h + Math.PI / 2, 0, 0, 2.4, 0.2, 0.3); }
    for (const R of PLAN.racks) { const D = densify(R, 10); for (let i = 1; i < D.length; i++) { const [x0, z0] = D[i - 1], [x1, z1] = D[i], y0 = gy(x0, z0) + 3.85, y1 = gy(x1, z1) + 3.85, L = Math.hypot(x1 - x0, z1 - z0, y1 - y0);
      for (const o of [-0.7, 0, 0.7]) { const nx = -(z1 - z0) / Math.hypot(x1 - x0, z1 - z0) * o, nz = (x1 - x0) / Math.hypot(x1 - x0, z1 - z0) * o;
        add(G.hcyl, o ? M.white : M.grey, (x0 + x1) / 2 + nx, (y0 + y1) / 2, (z0 + z1) / 2 + nz, -Math.atan2(z1 - z0, x1 - x0), 0, Math.asin((y1 - y0) / L), L, 0.22, 0.22); } } }
  }

  // ---- Power: gridded solar farm, two reactors behind regolith berms with radiator fins ----
  { const S = PLAN.solar, bw = S.panels * 6.6, bd = S.lines * 7, W = S.cols * bw + (S.cols - 1) * 10, D = S.rows * bd + (S.rows - 1) * 10, x0 = S.x - W / 2, z0 = S.z - D / 2;
    const pan = new THREE.BoxGeometry(6.2, 0.12, 3.1), leg = new THREE.CylinderGeometry(0.08, 0.08, 1, 6), n = S.cols * S.rows * S.panels * S.lines;
    const im = new THREE.InstancedMesh(pan, M.panel, n), il = new THREE.InstancedMesh(leg, M.grey, n), o = new THREE.Object3D(); let k = 0;
    for (let bi = 0; bi < S.cols; bi++) for (let bj = 0; bj < S.rows; bj++) for (let i = 0; i < S.panels; i++) for (let j = 0; j < S.lines; j++) {
      const x = x0 + bi * (bw + 10) + i * 6.6 + 3.3, z = z0 + bj * (bd + 10) + j * 7 + 3.5, y = gy(x, z);
      o.position.set(x, y + 1.6, z); o.rotation.set(-0.55, 0, 0); o.scale.set(1, 1, 1); o.updateMatrix(); im.setMatrixAt(k, o.matrix);   // tilted to the low sun (south, -z)
      o.position.set(x, y + 0.8, z); o.rotation.set(0, 0, 0); o.scale.set(1, 1.6, 1); o.updateMatrix(); il.setMatrixAt(k, o.matrix); k++; }
    for (const m of [im, il]) { m.castShadow = m.receiveShadow = true; scene.add(m); }
    box(M.white, x0 - 14, gy(x0 - 14, S.z), S.z, 8, 4, 6); lamp(x0 - 14, gy(x0 - 14, S.z) + 4.5, S.z, 0.3);   // inverter hut
    reg('solar farm', S.x, S.z, 2.5);
  }
  for (const [ri, R] of PLAN.reactors.entries()) {
    const y = gy(R.x, R.z), open = Math.atan2(R.z - PLAN.hub.z, R.x - PLAN.hub.x);   // berm open away from the base
    ringBerm(R.x, R.z, 24, 8, 18, open + 0.9, open + 2 * Math.PI - 0.9);
    add(G.cyl, M.white, R.x, y + 5, R.z, 0, 0, 0, 4.5, 10, 4.5); add(G.dome, M.white, R.x, y + 10, R.z, 0, 0, 0, 4.5, 2.2, 4.5); box(M.grey, R.x, y + 12, R.z, 2, 1.2, 2);
    for (let f = 0; f < 5; f++) { const a = open + (f - 2) * 0.4, x = R.x + Math.cos(a) * 12, z = R.z + Math.sin(a) * 12;
      add(G.box, M.rad, x, y + 10.5, z, -a, 0, 0, 9, 18, 0.25); post(M.grey, x, y, z, 0.2, 1.5); }
    lamp(R.x, y + 13.2, R.z, 0.5, true, 2.8, ri * 0.4); contact(R.x, R.z, 18); reg('reactor ' + (ri + 1), R.x, R.z, 19);
  }
  for (const C of PLAN.cables) for (const [x, z] of densify(C, 30)) { const y = gy(x, z); post(M.orange, x, y, z, 0.07, 0.9); }   // buried cable markers

  // ---- Habitat district: half-buried modules round a hub, covered tunnels, the dome, airlock, garage, rovers ----
  let dome = null;
  { const H = PLAN.hub, Y = gy(H.x, H.z);
    const module = (x, z, a, L, r) => { const y = gy(x, z); add(G.hcyl, M.white, x, y + r * 0.55, z, -a, 0, 0, L, r, r);
      for (const s of [-1, 1]) { const ex = x + Math.cos(a) * s * L / 2, ez = z + Math.sin(a) * s * L / 2; add(G.sph, M.white, ex, y + r * 0.55, ez, -a, 0, 0, 0.6, r, r);
        add(G.box, M.window, ex + Math.cos(a) * s * 0.55 * r, y + r * 0.7, ez + Math.sin(a) * s * 0.55 * r, -a, 0, 0, 0.1, 1.4, 1.4); lamp(ex + Math.cos(a) * s * 0.62 * r, y + r * 1.3, ez + Math.sin(a) * s * 0.62 * r, 0.25); }
      add(G.dome, M.reg, x, y - 0.4, z, -a, 0, 0, L * 0.47, r * 1.75, r * 1.45);   // regolith cover, ends left open
      contact(x, z, L * 0.6); };
    add(G.cyl, M.white, H.x, Y + 3, H.z, 0, 0, 0, 7, 6, 7); add(G.dome, M.reg, H.x, Y - 0.5, H.z, 0, 0, 0, 10.5, 9, 10.5); lamp(H.x, Y + 9, H.z, 0.4, true, 2.5, 0.2);
    for (const [ox, oz, a] of [[26, 0, 0], [0, 26, Math.PI / 2], [0, -26, Math.PI / 2], [-26, 0, 0]]) module(H.x + ox, H.z + oz, a, 24, 4.2);
    // Greenhouse dome: a geodesic frame over a warm glow (grow lights)
    { const x = H.x + 34, z = H.z + 44, y = gy(x, z), R = 16;
      const inner = new THREE.Mesh(new THREE.SphereGeometry(R * 0.96, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.glow); inner.position.set(x, y, z); scene.add(inner);
      const shell = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.glass); shell.position.set(x, y, z); shell.renderOrder = 2; scene.add(shell);
      const fr = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(R * 1.005, 2)), new THREE.LineBasicMaterial({ color: 0xd8d2c8 }));
      fr.position.set(x, y, z); scene.add(fr); const cut = fr.geometry.attributes.position;   // keep the upper half of the frame
      for (let i = 0; i < cut.count; i += 2) if (cut.getY(i) < -0.5 || cut.getY(i + 1) < -0.5) { cut.setXYZ(i, 0, 0, 0); cut.setXYZ(i + 1, 0, 0, 0); }
      add(G.cyl, M.white, x, y + 0.6, z, 0, 0, 0, R + 0.6, 1.2, R + 0.6); dome = inner; contact(x, z, R * 1.4); reg('greenhouse', x, z, R);
      // its tunnel to the north module
      const tx0 = H.x + 6, tz0 = H.z + 38; module((tx0 + x) / 2 - 4, (tz0 + z) / 2 - 4, Math.atan2(z - tz0, x - tx0), Math.hypot(x - tx0, z - tz0) - 8, 1.8); }
    // Covered tunnel west to the airlock and garage
    { const G0 = PLAN.garage, x0 = H.x - 40, z0 = H.z, a = Math.atan2(G0.z + 6 - z0, G0.x + 10 - x0), L = Math.hypot(G0.x + 10 - x0, G0.z + 6 - z0);
      module(x0 + Math.cos(a) * L / 2, z0 + Math.sin(a) * L / 2, a, L, 1.9); }
    { const G0 = PLAN.garage, y = gy(G0.x, G0.z), a = -0.25;
      box(M.white, G0.x, y, G0.z, 22, 7.5, 15, a); box(M.dark, G0.x - 11.1, y, G0.z, 0.3, 6, 11, a); box(M.grey, G0.x, y + 7.5, G0.z, 18, 0.6, 11, a);
      for (let i = 0; i < 8; i++) for (const sd of [-1, 1]) { const [rx, rz] = rot(G0.x, G0.z, -a, -9.5 + i * 2.7, sd * 7.55); box(M.grey, rx, y, rz, 0.3, 7.5, 0.25, a); }   // ribs
      for (const sd of [-1, 1]) { const [sx, sz] = rot(G0.x, G0.z, -a, -11.15, sd * 5.8); box(M.orange, sx, y, sz, 0.35, 6.2, 0.6, a); }   // door frame
      for (let i = 0; i < 3; i++) { const [rx, rz] = rot(G0.x, G0.z, -a, -5 + i * 6, 0); box(M.rad, rx, y + 8.1, rz, 4, 0.15, 9, a); }   // roof radiators
      box(M.white, G0.x + 13, y, G0.z + 4, 5, 4.2, 5, a); lamp(G0.x - 11.5, y + 7.2, G0.z - 5, 0.3); lamp(G0.x - 11.5, y + 7.2, G0.z + 5, 0.3); lamp(G0.x, y + 8.5, G0.z, 0.35, true, 2, 0.6);
      contact(G0.x, G0.z, 16); reg('garage', G0.x, G0.z, 8); }
    { const T = PLAN.lightTower, y = lattice(T.x, T.z, T.h, 3); add(G.box, M.grey, T.x, y + T.h, T.z, 0, 0, 0, 5, 0.8, 5);
      for (let i = 0; i < 4; i++) { const a = -2.6 + i * 0.25; box(M.dark, T.x + Math.cos(a) * 2, y + T.h + 0.8, T.z + Math.sin(a) * 2, 1.3, 1.1, 0.7, -a); flood.push(lamp(T.x + Math.cos(a) * 2.4, y + T.h + 1.35, T.z + Math.sin(a) * 2.4, 0.45)); }
      lamp(T.x, y + T.h + 2.4, T.z, 0.7, true, 1.6, 0.25); reg('light tower', T.x, T.z, T.h); }
    { const W = PLAN.weather, y = gy(W.x, W.z); post(M.grey, W.x, y, W.z, 0.12, 10); box(M.white, W.x, y + 10, W.z, 1.2, 0.5, 0.5); add(G.cyl8, M.grey, W.x + 0.9, y + 9.2, W.z, 0, 0, Math.PI / 2, 0.04, 1.8, 0.04);
      box(M.white, W.x, y + 1.2, W.z, 0.8, 0.8, 0.8); reg('weather mast', W.x, W.z, 10); }
  }
  // Pressurised rovers: one parked by the garage, one that drives out to the pad after a landing
  const makeRover = () => { const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(6.6, 2.5, 3), M.white); body.position.y = 2.25; g.add(body);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.4, 2.6), M.window); cab.position.set(3.0, 2.4, 0); g.add(cab);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.4, 3.2), M.dark); deck.position.y = 0.95; g.add(deck);
    const wheels = [];
    for (const wx of [-2.4, 0, 2.4]) for (const s of [-1, 1]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.55, 14).rotateX(Math.PI / 2), M.dark); w.position.set(wx, 0.75, s * 1.75); g.add(w); wheels.push(w); }
    const l = new THREE.Mesh(G.lampS, M.lamp); l.scale.setScalar(0.18); l.position.set(3.85, 2.0, 0.9); g.add(l); const l2 = l.clone(); l2.position.z = -0.9; g.add(l2);
    const b = new THREE.Mesh(G.lampS, M.red); b.scale.setScalar(0.2); b.position.set(-2, 3.7, 0); g.add(b);
    g.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); g.userData.wheels = wheels; g.userData.beacon = b; return g; };
  const parkRover = (r, x, z, a) => { r.position.set(x, gy(x, z), z); r.rotation.set(0, -a, 0); };
  const rover2 = makeRover(); { const G0 = PLAN.garage; parkRover(rover2, G0.x - 18, G0.z + 12, -0.25 + 0.4); scene.add(rover2); }
  const rover = makeRover(); scene.add(rover);
  const roverPath = densify([[205, 70], [150, 55], [62, 24]], 4);   // from a pull-off on the road (it waits there for the landing) to LZ-1's berm gap
  const RV = { t: -1, speed: 9, len: (roverPath.length - 1) * 4 };
  const placeRover = s => {   // s: metres along the path
    const f = clamp(s / 4, 0, roverPath.length - 1.001), i = f | 0, t = f - i, [x0, z0] = roverPath[i], [x1, z1] = roverPath[i + 1];
    const x = lerp(x0, x1, t), z = lerp(z0, z1, t), a = Math.atan2(z1 - z0, x1 - x0), ca = Math.cos(a), sa = Math.sin(a);
    const hf = gy(x + ca * 2.5, z + sa * 2.5), hb = gy(x - ca * 2.5, z - sa * 2.5), hl = gy(x - sa * 1.6, z + ca * 1.6), hr = gy(x + sa * 1.6, z - ca * 1.6);
    rover.position.set(x, (hf + hb + hl + hr) / 4, z); rover.rotation.set(Math.atan2(hl - hr, 3.2), -a, Math.atan2(hf - hb, 5), 'YZX'); return [x, z, a];
  };
  placeRover(0);

  // ---- Comms: lattice mast and a tracking dish on the rise ----
  let dish = null;
  { const C = PLAN.comms, y = lattice(C.x, C.z, 55, 3); lamp(C.x, y + 56.5, C.z, 0.7, true, 1.6, 0.75); lamp(C.x, y + 28, C.z, 0.5, true, 1.6, 0.1);
    add(G.box, M.white, C.x, y + 50, C.z, 0, 0, 0, 1.2, 1.6, 2.4); reg('comms mast', C.x, C.z, 55);
    const dx = C.x + 14, dz = C.z - 10, dy = gy(dx, dz); add(G.cyl8, M.grey, dx, dy + 2.5, dz, 0, 0, 0, 0.9, 5, 0.9); box(M.white, dx, dy, dz, 3, 1.2, 3);
    const yaw = new THREE.Group(), pitch = new THREE.Group(); yaw.position.set(dx, dy + 5.2, dz); yaw.add(pitch);
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(5, 28, 8, 0, Math.PI * 2, 0, 0.75), dusty(new THREE.MeshStandardMaterial({ color: 0xe9e4dc, metalness: 0.15, roughness: 0.5, side: THREE.DoubleSide }))); bowl.rotation.x = -Math.PI / 2; bowl.position.z = 5.6;   // cap opens toward +z
    const feed = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3.4, 6), M.grey); feed.rotation.x = Math.PI / 2; feed.position.z = 2.7;
    pitch.add(bowl, feed); scene.add(yaw); yaw.traverse(m => { if (m.isMesh) m.castShadow = m.receiveShadow = true; });
    dish = { yaw, pitch, a: 2.4, e: 0.5 }; yaw.rotation.y = dish.a; pitch.rotation.x = -dish.e; reg('dish', dx, dz, 10); }

  // ---- History: the first ship, retired on its old pad, leaning a little ----
  { const P = PLAN.oldPad, y = gy(P.x, P.z);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(22, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: padTexture(THREE, 'LZ-0', 1), roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2 }));
    disc.position.set(P.x, y + 0.08, P.z); scene.add(disc);
    const s = ctx.parkedShip({ lean: 6 * DEG, dusty: true }); s.position.set(P.x + 2, y - 0.6, P.z - 1); s.rotation.y = 0.9; scene.add(s); reg('first ship', P.x, P.z, 50);
    contact(P.x, P.z, 18); }

  // Marker posts along the roads (reflective tops), every 25 m, alternating sides
  { const pts = []; for (const [w, R] of PLAN.roads) densify(R, 25).forEach(([x, z, h], i) => { const s = i % 2 ? 1 : -1, px = x - Math.sin(h) * s * (w / 2 + 1.2), pz = z + Math.cos(h) * s * (w / 2 + 1.2);
      if (!PLAN.pads.some(p => Math.hypot(px - p.x, pz - p.z) < 52)) pts.push([px, pz]); });
    const geo = new THREE.CylinderGeometry(0.07, 0.07, 1.5, 5), top = new THREE.SphereGeometry(0.12, 6, 4), im = new THREE.InstancedMesh(geo, M.dark, pts.length), it = new THREE.InstancedMesh(top, M.orange, pts.length), o = new THREE.Object3D();
    pts.forEach(([x, z], i) => { const y = gy(x, z); o.position.set(x, y + 0.75, z); o.updateMatrix(); im.setMatrixAt(i, o.matrix); o.position.y = y + 1.55; o.updateMatrix(); it.setMatrixAt(i, o.matrix); });
    scene.add(im, it); }

  // Camera props: each fixed camera stands on something
  const addCamProps = list => { for (const [x, z, h, kind] of list) { const y = gy(x, z);
    if (kind === 'hut') { box(M.white, x - 6, y, z + 3, 3.2, 2.4, 2.4, 0.3); post(M.dark, x - 1.5, y, z, 0.06, h - 0.8); box(M.dark, x - 1.5, y + h - 0.8, z, 0.6, 0.45, 0.4); }
    else { post(M.grey, x, y, z, kind === 'pole' ? 0.18 : 0.08, h - 0.9); box(M.dark, x, y + h - 0.95, z, 0.5, 0.35, 0.35); }
    merge(); } };

  // Merge the static batches into one mesh per material
  const merged = [];
  function merge() {
    for (const [mat, geos] of batch) { if (!geos.length) continue; const g = mergeGeometries(geos, false); const m = new THREE.Mesh(g, mat); m.castShadow = mat !== M.glass; m.receiveShadow = true; scene.add(m); merged.push(m); geos.length = 0; }
  }
  merge();

  // ---------- Per frame: reactions to the landing ----------
  // info: { dt (0 when paused), t, state, phase, h (ship above ground), ship (position), landedAt }
  const _v = new THREE.Vector3();
  let ventT = 4, floodK = 0;
  function update(info) {
    const { dt, t } = info, flying = info.state === 'flight', landed = info.state === 'landed';
    // Beacons: slow red blinks, each on its own phase; LZ-1's ring chases while the ship is below 1.5 km
    const near = flying && info.phase === 'tvc' && info.h < 1500;
    for (const b of beacons) { if (b.period) b.m.visible = (t / b.period + b.phase) % 1 < 0.18; }
    // Floodlights come up for the landing
    floodK = lerp(floodK, near || landed ? 1 : 0, 1 - Math.exp(-dt * 1.5));
    flood.forEach(l => { l.visible = floodK > 0.05; l.scale.setScalar((l.userData.r0 ??= l.scale.x) * (0.4 + 0.6 * floodK)); });
    // The dish tracks the ship (eased), parks after the landing
    if (dish) { let ta = dish.a, te = 0.5;
      if (flying && info.ship) { _v.copy(info.ship).sub(dish.yaw.position); ta = Math.atan2(_v.x, _v.z); te = Math.atan2(_v.y, Math.hypot(_v.x, _v.z)); }
      let d = ta - dish.a; d = Math.atan2(Math.sin(d), Math.cos(d)); dish.a += d * (1 - Math.exp(-dt * 1.2)); dish.e += (clamp(te, 0.05, 1.45) - dish.e) * (1 - Math.exp(-dt * 1.2));
      dish.yaw.rotation.y = dish.a; dish.pitch.rotation.x = -dish.e; }
    // Frost vent at the plant: a puff now and then, drifting downwind
    if (dt > 0) { ventT -= dt; if (ventT < 0) { ventT = 7 + 5 * Math.random(); for (const [x, y, z] of vents) for (let i = 0; i < 26; i++)
      ctx.dust.emit({ x, y, z, vx: ctx.wind[0] * 2 + (Math.random() - 0.5) * 1.5, vy: 2.5 + Math.random() * 3, vz: ctx.wind[1] * 2 + (Math.random() - 0.5) * 1.5, life: 4 + Math.random() * 3, s0: 1.5, s1: 12, a: 0.32, drag: 0.25, rgb: [0.97, 0.95, 0.93] }); } }
    // The rover drives out to the pad a few seconds after a good landing, kicking up dust
    if (landed && info.landedAt != null && info.ok) {
      const s = clamp((t - info.landedAt - 2) * RV.speed, 0, RV.len);
      const [x, z, a] = placeRover(s), moving = s > 0 && s < RV.len;
      rover.userData.wheels.forEach(w => { w.rotation.z = -s / 0.75; });
      rover.userData.beacon.visible = (t * 1.5) % 1 < 0.3;
      if (moving && dt > 0 && Math.random() < 0.8) ctx.dust.emit({ x: x - Math.cos(a) * 3.6 + (Math.random() - 0.5), y: rover.position.y + 0.5, z: z - Math.sin(a) * 3.6 + (Math.random() - 0.5),
        vx: -Math.cos(a) * 2 + ctx.wind[0], vy: 0.8 + Math.random(), vz: -Math.sin(a) * 2 + ctx.wind[1], life: 2.5 + Math.random() * 1.5, s0: 1.2, s1: 6, a: 0.22, drag: 0.6, rgb: [0.72, 0.5, 0.36] });
    } else if (info.state !== 'landed') { placeRover(0); rover.userData.beacon.visible = false; }
  }
  // Touchdown: a dust wave runs out along the ground and piles up against LZ-1's berm, some of it thrown up over the crest
  function onTouchdown(at) {
    const D = [0.74, 0.53, 0.38], R = PLAN.berm.r;
    for (let i = 0; i < 220; i++) { const a = Math.random() * 6.283, v0 = 35 + Math.random() * 30, y = at.y + 0.6 + Math.random() * 1.5;
      ctx.dust.emit({ x: at.x + Math.cos(a) * 8, y, z: at.z + Math.sin(a) * 8, vx: Math.cos(a) * v0, vy: 0.5 + Math.random() * 2, vz: Math.sin(a) * v0, life: 3 + Math.random() * 2, s0: 3, s1: 11, a: 0.34, drag: v0 / (R - 6), rgb: D }); }
    for (let i = 0; i < 90; i++) { const a = Math.random() * 6.283, x = at.x + Math.cos(a) * (R - 3), z = at.z + Math.sin(a) * (R - 3);
      ctx.dust.emit({ x, y: gy(x, z) + 1.5, z, vx: Math.cos(a) * 4, vy: 5 + Math.random() * 6, vz: Math.sin(a) * 4, life: 3 + Math.random() * 2, s0: 4, s1: 14, a: 0.2, drag: 0.5, g: 0.6, rgb: D }); }
  }
  function reset() { placeRover(0); floodK = 0; }
  return { objs, update, onTouchdown, reset, addCamProps, dome, flood, M, rover };
}
