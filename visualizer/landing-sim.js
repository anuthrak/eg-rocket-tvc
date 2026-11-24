// Landing tab physics (Mars), kept free of Three.js so it can be checked in Node.
// Units: metres, seconds, kilograms; degrees at the interface, radians inside.
//
// The ship is a Starship-style upper stage, 50 m x 9 m. The flight:
//   0. Orbit, deorbit and the plasma entry are a scripted, time-compressed sequence in the orbit scene (ENTRY below).
//   1. Belly flop and flip, autopilot (createFlight): a rigid body falling belly-first from 8 km through the thin air,
//      flaps trimming it, then nose RCS and the gimballed engines swinging it upright.
//   2. TVC landing, right after the flip: the autopilot keeps commanding the attitude it needs to stop over the pad,
//      and the TVC source's tilt and nozzle angles are added on top. That source is either
//        rig - the real rocket on the desk rig (bench.js 'tvc:sample' events), or
//        sim - createAttitudeSim(): two axes flown by the Nano's controller (controller.js), with gusts.
//      Thrust leaves through the nozzle: its sideways part shoves the tail and moves the whole ship.

import { gimbalStep, AUTHORITY } from './controller.js';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export const DT = 0.01;              // 100 Hz, like the firmware
export const G = 3.71;               // Mars
const RHO0 = 0.020, HS = 11100;      // surface air density (kg/m³), scale height (m)
export const rho = h => RHO0 * Math.exp(-Math.max(h, 0) / HS);

export const SHIP = {
  L: 50, D: 9,                       // length, diameter
  m0: 128e3,                         // at the start of the belly flop (kg): dry + landing propellant
  T: 3.7e6, ISP: 350,                // full thrust of the three centre engines (N), specific impulse (s)
  cdSide: 1.15, cdEnd: 0.75,
  I: 128e3 * 50 * 50 / 12,           // pitch inertia, a rod about its middle (kg·m²)
};
SHIP.aSide = SHIP.L * SHIP.D;
SHIP.aEnd = Math.PI * (SHIP.D / 2) ** 2;

export const H_START = 8000;         // the belly flop starts this high (the cut from the orbit scene)
export const PAD_R = 25;             // landing pad radius
export const ABORT_DEG = 25;         // TVC deviation past this = the ship is lost (same abort as the firmware)
export const LAND_OK_DEG = 8;        // touchdown tilt for a clean landing
export const TIP_DEG = 15;           // touchdown tilt past which it falls over
export const LEGS_AT = 220;          // legs deploy below this height (in the ground telephoto shot)

// Scripted orbit → entry sequence (screen seconds). The real entry takes ~6 minutes: shown about 30x faster.
export const ENTRY = { deorbit: 10.4, entry: 20.0, warp: 30, h0: 200e3, h1: 12e3, v0: 3450, v1: 420, dv: 85 };

// ---------- 1 + 2. The flight from the belly flop to touchdown ----------
// Attitude is a pair of tilts in the Bench convention (tiltY leans toward +x, the direction of travel; tiltX toward
// +z). Belly-first is tiltY = +84°. cmd = the autopilot's attitude; dev = the TVC source's deviation on top of it.
// Side approach (after the real Starship flights: the flaps steer to the target, then flip, a 3-engine landing burn that
// translates over the pad in one motion, and 3 → 2 → 1 engines for the settle). The belly flop starts DIVERT m to the left
// or right of the pad line (z); the flaps bank it toward the pad (BELLY), the flip and burn carry it the rest of the way
// with one small overshoot (LAT).
export const DIVERT = 350;
export const BELLY = { aim: 0, kp: 0.01, kd: 0.1, bankMax: 25, lift: 1.0 };   // flap bank (deg) → side force = drag·lift·sin(bank)
// Starship scale: the TVC source (the 45 cm desk rocket, or its simulation) moves ~10× faster than a 50 m ship could.
// The big ship follows it as a heavy body: the lean target holds the peak and lets go over `release` s, then a damped
// 2nd-order follow with turn rate/acceleration caps (about what its gimbal can do). The raw source still drives the
// abort, the tracker, the HUD and the inset; the big ship's attitude drives the thrust, so a push moves it off course.
export const HEAVY = { release: 0.8, wn: 3, zeta: 0.85, vMax: 12, aMax: 28, gTau: 0.25, gRate: 30 };
export const ENG3 = { to2: 0.72, to1: 0.31, h1: 100, hold: 0.3 };   // shut one engine below these 3-engine throttle fractions (to1 only below h1 m)
export const LAT = { kFlip: 0.05, kp: 0.2, kd: 0.8, amax: 8, over: 30, hA: 900, hB: 500, hC: 320, hD: 170 };
// TVC phase: sideways accel = -kd·v - kp·(z - aim), clamped to amax (m/s²). The aim swings `over` m past the pad
// between hA→hB and back by hC→hD (smoothstep ramps), so the ship overshoots once and comes back while it's still high.
export function createFlight(x0 = 0, z0 = 0) {
  const s = {
    phase: 'belly', t: 0, tPh: 0,
    x: x0, h: H_START, z: z0, vx: 28, vh: -330, vz: 0,
    cmd: { x: 0, y: 84, wx: 0, wy: 0 },   // commanded tilts (deg) and their rates (deg/s)
    gA: { x: 0, y: 0 },                   // the autopilot's own gimbal (deg), from the torque it asks for
    m: SHIP.m0, thr: 0, flap: 0, rcs: 0,
    q: 0, acc: 0,
    dev: { tiltX: 0, tiltY: 0, gx: 0, gy: 0 }, eng: 3,
    big: { tiltX: 0, tiltY: 0, gx: 0, gy: 0 },   // the big ship's deviation (heavy-body follow of dev)
    tilt: 0,                              // total tilt from vertical (deg)
  };
  const T_FLIP = 4.5, MARGIN = 0.95, side = Math.sign(z0);
  const ss = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const latAim = h => -side * LAT.over * ss(LAT.hA, LAT.hB, h) * ss(LAT.hD, LAT.hC, h);
  let aRef = 16, engT = 0;
  const hv = { ex: 0, ey: 0, vx: 0, vy: 0 };
  function heavyStep(u) {
    const H = HEAVY, b = s.big, um = Math.hypot(u.tiltX, u.tiltY), em = Math.hypot(hv.ex, hv.ey);
    if (um >= em) { hv.ex = u.tiltX; hv.ey = u.tiltY; }                                    // the peak, held
    else { const k = 1 - Math.exp(-DT / H.release); hv.ex += (u.tiltX - hv.ex) * k; hv.ey += (u.tiltY - hv.ey) * k; }   // let go slowly
    let ax = H.wn * H.wn * (hv.ex - b.tiltX) - 2 * H.zeta * H.wn * hv.vx, ay = H.wn * H.wn * (hv.ey - b.tiltY) - 2 * H.zeta * H.wn * hv.vy;
    const am = Math.hypot(ax, ay); if (am > H.aMax) { ax *= H.aMax / am; ay *= H.aMax / am; }
    hv.vx += ax * DT; hv.vy += ay * DT;
    const vm = Math.hypot(hv.vx, hv.vy); if (vm > H.vMax) { hv.vx *= H.vMax / vm; hv.vy *= H.vMax / vm; }
    b.tiltX += hv.vx * DT; b.tiltY += hv.vy * DT;
    const gk = 1 - Math.exp(-DT / H.gTau), gr = H.gRate * DT;                                // nozzles: smoothed, rate-limited
    b.gx += clamp(((u.gx ?? 0) - b.gx) * gk, -gr, gr); b.gy += clamp(((u.gy ?? 0) - b.gy) * gk, -gr, gr);
  }
  // Speed target for the TVC phase (negative = down). Deceleration a(h) = A_LOW below 40 m, ramping up to A_LOW + aRef
  // by 160 m: hard braking high up, a gentle last 40 m, 1.5 m/s at the ground. v² = 1.5² + 2∫a dh.
  const A_LOW = 4, H0 = 60, H1 = 130;
  const ramp = h => h <= H0 ? 0 : h < H1 ? (h - H0) ** 2 / (2 * (H1 - H0)) : (H1 - H0) / 2 + (h - H1);
  const vProfile = h => -Math.sqrt(2.25 + 2 * (A_LOW * h + aRef * ramp(h)));
  const aProfile = h => A_LOW + aRef * (h <= H0 ? 0 : h < H1 ? (h - H0) / (H1 - H0) : 1);
  // The height the burn needs from here (at MARGIN of full thrust), plus the flip time
  const stopH = () => {
    const aNet = MARGIN * (SHIP.T / s.m - G);
    return s.vh * s.vh / (2 * aNet) + Math.abs(s.vh) * T_FLIP * 0.55;
  };
  // Rate-limited PD of one commanded tilt toward its target; returns the angular acceleration (deg/s²)
  function drive(axis, target, alphaMax) {
    const key = axis === 'x' ? 'wx' : 'wy';
    const wCmd = clamp(1.3 * (target - s.cmd[axis]), -36, 36);
    const alpha = clamp(4 * (wCmd - s.cmd[key]), -alphaMax, alphaMax);
    s.cmd[key] += alpha * DT; s.cmd[axis] += s.cmd[key] * DT;
    return alpha;
  }
  // dev: the TVC source's attitude (deg) once it flies, else null
  function step(dev) {
    const v = Math.hypot(s.vx, s.vh, s.vz), r = rho(s.h);
    s.dev = s.phase === 'tvc' && dev ? dev : { tiltX: 0, tiltY: 0, gx: 0, gy: 0 };
    heavyStep(s.dev);
    const d = s.big;
    const tx = s.cmd.x + d.tiltX, ty = s.cmd.y + d.tiltY;
    const ax = axisFromTilt(tx, ty);
    // Drag on the body: belly area across the flow, end area along it
    const cosA = v > 1 ? -(ax.x * s.vx + ax.y * s.vh + ax.z * s.vz) / v : 1;
    const cdA = SHIP.cdSide * SHIP.aSide * Math.sqrt(Math.max(0, 1 - cosA * cosA)) + SHIP.cdEnd * SHIP.aEnd * Math.abs(cosA);
    const drag = 0.5 * r * v * v * cdA;
    let fx = v > 1 ? -drag * s.vx / v : 0, fh = (v > 1 ? -drag * s.vh / v : 0) - s.m * G, fz = v > 1 ? -drag * s.vz / v : 0;
    s.q = 0.5 * r * v * v;

    let tgtX = 0, tgtY = s.cmd.y, alphaMax = 5, need = 0;
    if (s.phase === 'belly') {
      tgtY = 84;
      // Flaps bank it toward the pad line: aim for `aim` m off at the flip (the burn does the rest)
      const zt = side * BELLY.aim, aW = -BELLY.kd * s.vz - BELLY.kp * (s.z - zt), aMax = drag / s.m * BELLY.lift;
      tgtX = clamp(Math.asin(clamp(aW / Math.max(aMax, 1e-3), -1, 1)) / DEG, -BELLY.bankMax, BELLY.bankMax);
      s.flap = clamp((84 - s.cmd.y) * 0.07 - s.cmd.wy * 0.035, -1, 1);
      if (s.h <= stopH()) { s.phase = 'flip'; s.tPh = s.t; }
    } else {
      // Guidance. Flip: a suicide burn (constant deceleration to the ground). TVC phase: follow a speed profile that
      // brakes hard high up and eases off near the ground (1.5 m/s at touchdown), steering over the pad.
      const hh = Math.max(s.h, 0);
      let aH;
      if (s.phase === 'flip') aH = (s.vh * s.vh) / (2 * Math.max(hh, 5)) * (s.vh < 0 ? 1 : -1) + G;
      else aH = G + aProfile(hh) + clamp((vProfile(hh) - s.vh) * 2.5, -6, 20);   // feed-forward + speed error
      aH = clamp(aH, 0, 40);
      const tv = s.phase === 'tvc';
      const aX = tv ? clamp(-LAT.kd * s.vx - LAT.kp * s.x, -LAT.amax, LAT.amax) : clamp(-0.32 * s.vx - 0.022 * s.x, -9, 9);   // TVC: same loop along track
      const aZ = tv ? clamp(-LAT.kd * s.vz - LAT.kp * (s.z - latAim(hh)), -LAT.amax, LAT.amax) : clamp(-0.2 * s.vz - LAT.kFlip * s.z, -9, 9);
      const lim = s.phase !== 'tvc' ? 25 : hh < 25 ? 4 : hh < 150 ? 15 : 25;    // near the ground: stand up straight
      tgtY = clamp(Math.atan2(aX, aH) / DEG, -lim, lim);
      tgtX = clamp(Math.atan2(aZ, aH) / DEG, -lim, lim);
      need = aH / Math.max(ax.y, 0.35) * s.m / SHIP.T;    // throttle for the vertical part; the lean does the sideways part
      if (s.phase === 'flip') {
        const k = clamp((s.t - s.tPh) / T_FLIP, 0, 1);
        s.thr = (0.4 + 0.6 * k * k) * (s.cmd.y < 70 ? 1 : 0.45);
        alphaMax = 24;                     // nose RCS + full gimbal swing it through
        if (Math.abs(s.cmd.y - tgtY) < 4 && Math.abs(s.cmd.wy) < 4.5) {
          s.phase = 'tvc'; s.tPh = s.t;
          aRef = Math.max((s.vh * s.vh - 2.25 - 2 * A_LOW * s.h) / (2 * ramp(Math.max(s.h, 200))), 2);   // the profile starts at the current speed
        }
      } else {
        // 3 → 2 → 1 engines as the burn eases (Flight 13 did the same); relights one if it needs more than it has
        engT = need < (s.eng === 3 ? ENG3.to2 : s.eng === 2 && hh < ENG3.h1 ? ENG3.to1 : -1) ? engT + DT : 0;
        if (engT > ENG3.hold && s.eng > 1) { s.eng--; engT = 0; }
        if (need > s.eng / 3 * 0.97 && s.eng < 3) s.eng++;
        s.thr = clamp(need, 0.05, s.eng / 3);   // fraction of three engines; one engine throttled low can hover the light ship
        alphaMax = 14;
      }
      s.flap *= 0.98;
    }
    if (s.phase === 'belly') fz += drag * BELLY.lift * Math.sin(s.cmd.x * DEG);   // the flaps' side force at the bank
    const alY = drive('y', tgtY, alphaMax), alX = drive('x', tgtX, alphaMax);
    s.rcs = s.phase === 'flip' ? clamp(alY / alphaMax, -1, 1) : 0;
    const thrust = s.phase === 'belly' ? 0 : s.thr * SHIP.T;
    // The autopilot's gimbal: the angle that makes the torque it asks for (arm 0.4 L to the CG)
    const gfor = al => thrust > 0 ? clamp(al * DEG * SHIP.I / (thrust * 0.4 * SHIP.L) / DEG, -8, 8) : 0;
    s.gA.y = gfor(alY); s.gA.x = gfor(alX);
    // Thrust along the nozzle: the body axis tipped by the gimbal (autopilot's + the TVC source's)
    const n = nozzleDir({ tiltX: tx, tiltY: ty, gx: d.gx + s.gA.x, gy: d.gy + s.gA.y });
    fx += thrust * n.x; fh += thrust * n.y; fz += thrust * n.z;
    s.vx += fx / s.m * DT; s.vh += fh / s.m * DT; s.vz += fz / s.m * DT;
    s.x += s.vx * DT; s.h += s.vh * DT; s.z += s.vz * DT;
    s.m -= thrust / (SHIP.ISP * 9.81) * DT;
    s.acc = Math.hypot(fx, fh + s.m * G, fz) / s.m / 9.81;
    s.tilt = tiltOf(tx, ty);
    s.t += DT;
  }
  return { s, step, stopH, get drift() { return Math.hypot(s.x, s.z); },
    get devTilt() { return tiltOf(s.dev.tiltX, s.dev.tiltY); },
    // Seconds to touchdown at the current deceleration (for the HUD)
    get ttg() { const a = Math.max(s.thr * SHIP.T / s.m - G, 0.5); return Math.max(0, -s.vh / a); } };
}
function runFrom(x0, z0 = 0) {   // to the start of the TVC phase, with no TVC input
  const f = createFlight(x0, z0);
  while (f.s.phase !== 'tvc' && f.s.h > 0 && f.s.t < 200) f.step(null);
  return f;
}
// Where to start the belly flop so that the TVC phase starts over the pad line along track (x ≈ 0, coasting toward it);
// the TVC loop then only trims (aiming at the landing point instead let the strong loop hide a 400 m along-track swing)
export function flightStart() {
  let x0 = 0;
  for (let i = 0; i < 10; i++) { const s = runFrom(x0, DIVERT).s; x0 -= 0.9 * (s.x + 2.0 * s.vx); }   // coast-to-stop point over the pad
  return { x0 };   // the same x0 serves both sides (mirror image in z)
}

// ---------- Simulated attitude: the demo source for the terminal phase ----------
export const GUST = { accel: 330, dur: 0.3 };   // deg/s², s: a sideways shove, as in demo-sim.js
// Thrust misalignment: a small steady torque in a random direction each run (deg/s²). The integrator trims it out;
// with the TVC off it is what tips the ship over within a few seconds.
const MISALIGN = 6;

function axis() { return { tilt: 0, rate: 0, g: 0, integ: 0 }; }

export function createAttitudeSim() {
  const x = axis(), y = axis();
  let t = 0, tvc = true, gust = null, mis = 0;
  const newMis = () => { mis = Math.random() * 360; };
  newMis();
  return {
    get tvc() { return tvc; },
    setTvc(on) { tvc = !!on; },
    // A shove toward dir (deg, 0 = +X tilt, 90 = +Y tilt). scale 1 = a standard gust.
    gust(dir, scale = 1) { gust = { dir, accel: GUST.accel * scale, end: t + GUST.dur }; },
    // Advance one DT. turb = turbulence multiplier (grows near the ground: the plume kicks up dust).
    // held = not flying it yet: held upright whatever the TVC switch says.
    step(turb = 1, held = false) {
      let px = (turb * (16 * Math.sin(t * 1.7) + 10 * Math.sin(t * 4.3 + 1)) + MISALIGN * Math.cos(mis * DEG)) * DEG;
      let py = (turb * (14 * Math.sin(t * 1.3 + 2) + 10 * Math.sin(t * 3.7)) + MISALIGN * Math.sin(mis * DEG)) * DEG;
      if (gust && t >= gust.end) gust = null;
      if (gust) { px += gust.accel * Math.cos(gust.dir * DEG) * DEG; py += gust.accel * Math.sin(gust.dir * DEG) * DEG; }
      for (const [a, push] of [[x, px], [y, py]]) {
        gimbalStep(a, a.tilt, a.rate, tvc || held ? 1 : 0, DT);   // TVC off: the nozzle re-centres and stays there
        a.rate += (push - AUTHORITY * Math.sin(a.g)) * DT;
        a.tilt += a.rate * DT;
      }
      t += DT;
    },
    read() { return { tiltX: x.tilt / DEG, tiltY: y.tilt / DEG, gx: x.g / DEG, gy: y.g / DEG }; },
    reset() { Object.assign(x, axis()); Object.assign(y, axis()); t = 0; gust = null; newMis(); },
  };
}

// Rocket axis from the two tilts, same convention as the Bench view: scene Y up,
// axis = (cos tX · sin tY, cos tX · cos tY, sin tX).
export function axisFromTilt(tiltX, tiltY) {
  const tX = tiltX * DEG, tY = tiltY * DEG;
  return { x: Math.cos(tX) * Math.sin(tY), y: Math.cos(tX) * Math.cos(tY), z: Math.sin(tX) };
}
export const tiltOf = (tiltX, tiltY) => Math.acos(clamp(axisFromTilt(tiltX, tiltY).y, -1, 1)) / DEG;
// Thrust direction: the body axis tipped by the gimbal. A positive gimbal pushes the tail (and the ship) the way a
// positive tilt leans, which is how it rights the ship (same signs as the Bench view's nozzle).
export function nozzleDir(a) {
  const ax = axisFromTilt(a.tiltX, a.tiltY);
  const n = { x: ax.x + Math.sin((a.gy || 0) * DEG), y: ax.y, z: ax.z + Math.sin((a.gx || 0) * DEG) };
  const l = Math.hypot(n.x, n.y, n.z);
  return { x: n.x / l, y: n.y / l, z: n.z / l };
}

// ---------- Disturbance tracker: "pushed to 12.4°, back in 0.58 s" ----------
// A disturbance starts when the tilt passes 4°; it is over once the tilt has stayed under 2° for 0.2 s.
// Recovery time = from the peak to back under 2°.
export function createTracker(onDone) {
  let cur = null;
  const done = [];
  return {
    done,
    get active() { return cur; },
    step(t, tilt) {
      if (!cur) {
        if (tilt > 4) cur = { t0: t, peak: tilt, tPeak: t, tUnder: null };
        return;
      }
      if (tilt > cur.peak) { cur.peak = tilt; cur.tPeak = t; cur.tUnder = null; }
      if (tilt < 2) {
        if (cur.tUnder === null) cur.tUnder = t;
        else if (t - cur.tUnder >= 0.2) {
          const d = { peak: cur.peak, recover: cur.tUnder - cur.tPeak, at: cur.t0 };
          done.push(d); cur = null; onDone?.(d);
        }
      } else cur.tUnder = null;
    },
    reset() { cur = null; done.length = 0; },
  };
}
