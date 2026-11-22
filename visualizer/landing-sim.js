// Landing tab physics (Mars), kept free of Three.js so it can be checked in Node.
// Units: metres, seconds, kilograms; degrees at the interface, radians inside.
//
// The ship is a Starship-style upper stage, 50 m x 9 m. The flight has two halves:
//   1. Entry, autopilot (createEntry): belly-first fall through the thin air, the flip, and the landing burn that
//      brings it to 16.5 m/s at 150 m over the pad. A planar rigid body: drag on the body, flaps holding the belly
//      into the wind, engine thrust through the gimbal and nose RCS turning it.
//   2. Terminal, the TVC (createTerminal): from 150 m to touchdown. Attitude comes from a source:
//        rig - the real rocket's tilt on the desk rig (bench.js 'tvc:sample' events), so pushing it pushes the ship;
//        sim - createAttitudeSim(): two axes flown by the Nano's controller (controller.js), with gusts.
//      The thrust leaves through the nozzle, which the gimbal tips off the body axis: its sideways part shoves the
//      tail and the whole ship, so leaning and gimbal both move the ship across the ground.

import { gimbalStep, AUTHORITY } from './controller.js';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export const DT = 0.01;              // 100 Hz, like the firmware
export const G = 3.71;               // Mars
const RHO0 = 0.020, HS = 11100;      // surface air density (kg/m³), scale height (m)
export const rho = h => RHO0 * Math.exp(-Math.max(h, 0) / HS);

// The ship (Starship-like numbers on the SLDP 45 shape)
export const SHIP = {
  L: 50, D: 9,                       // length, diameter
  m0: 128e3,                         // at the start of the entry (kg): dry + landing propellant
  T: 3.7e6, ISP: 350,                // full thrust (N), specific impulse (s)
  cdSide: 1.15, cdEnd: 0.75,
  I: 128e3 * 50 * 50 / 12,           // pitch inertia, a rod about its middle (kg·m²)
};
SHIP.aSide = SHIP.L * SHIP.D;                    // m² belly area
SHIP.aEnd = Math.PI * (SHIP.D / 2) ** 2;         // m² end-on area

export const H_START = 8000;         // entry starts this high
export const H_HAND = 150;           // the TVC takes over here
export const PAD_R = 25;             // landing pad radius
export const ABORT_DEG = 25;         // same tilt abort as the firmware: past this the ship is lost
export const LAND_OK_DEG = 8;        // touchdown tilt for a clean landing
export const TIP_DEG = 15;           // touchdown tilt past which it falls over
export const LEGS_AT = 400;          // legs deploy below this height

// Terminal guidance: vertical speed target vs height. 16.5 m/s at the handover, 1.5 m/s at the ground, ~24 s.
const VS_K = 0.1, VS_MIN = 1.5;
export const vsTarget = h => -(VS_MIN + VS_K * Math.max(h, 0));
export const timeToGo = h => Math.log((Math.max(h, 0) + VS_MIN / VS_K) / (VS_MIN / VS_K)) / VS_K;
export const V_HAND = -vsTarget(H_HAND);

// ---------- 1. Entry: belly flop, flip, landing burn (autopilot) ----------
// Planar: x across the ground (+x = direction of travel), h up. Pitch th: 0 = upright, +90° = belly-first, nose toward +x.
export function createEntry(x0 = 0) {
  const s = {
    phase: 'entry', t: 0, tPh: 0,
    x: x0, h: H_START, vx: 62, vh: -330,
    th: 84 * DEG, w: 0,              // pitch and pitch rate
    m: SHIP.m0, thr: 0,              // throttle 0..1
    gim: 0, flap: 0, rcs: 0,         // for the visuals: gimbal (rad), flap trim (-1..1), RCS firing (-1..1)
    q: 0, mach: 0, acc: 0,           // dynamic pressure (Pa), Mach, acceleration (Earth g) for the HUD
  };
  const T_FLIP = 4.5;
  // The height the engine needs to stop at the handover speed (with margin and the flip time)
  const stopH = () => {
    const aNet = 0.72 * (SHIP.T / s.m - G);
    return (s.vh * s.vh - V_HAND * V_HAND) / (2 * aNet) + H_HAND + Math.abs(s.vh) * T_FLIP * 0.55;
  };
  function step() {
    const v = Math.hypot(s.vx, s.vh), r = rho(s.h);
    // Angle of attack: between the body axis (sin th, cos th) and the airflow (-velocity)
    const ax = Math.sin(s.th), ah = Math.cos(s.th);
    const cosA = v > 1 ? -(ax * s.vx + ah * s.vh) / v : 1;
    const cdA = SHIP.cdSide * SHIP.aSide * Math.sqrt(Math.max(0, 1 - cosA * cosA)) + SHIP.cdEnd * SHIP.aEnd * Math.abs(cosA);
    const drag = 0.5 * r * v * v * cdA;
    let fx = v > 1 ? -drag * s.vx / v : 0, fh = (v > 1 ? -drag * s.vh / v : 0) - s.m * G;
    s.q = 0.5 * r * v * v; s.mach = v / 240;

    let thT = s.th, alphaMax = 0.08, thrust = 0;
    if (s.phase === 'entry') {
      thT = 84 * DEG;                 // belly into the wind, nose a little up; the flaps trim it
      s.flap = clamp((thT - s.th) * 4 - s.w * 2, -1, 1);
      if (s.h <= stopH()) { s.phase = 'flip'; s.tPh = s.t; }
    }
    if (s.phase === 'flip' || s.phase === 'burn') {
      // Burn guidance: the acceleration that stops the fall at the handover point over the pad
      const dh = Math.max(s.h - H_HAND, 5);
      const aH = clamp((s.vh * s.vh - V_HAND * V_HAND) / (2 * dh) * (s.vh < 0 ? 1 : -1) + G, 0, 40);
      const aX = clamp(-0.32 * s.vx - 0.022 * s.x, -9, 9);
      thT = clamp(Math.atan2(aX, aH), -25 * DEG, 25 * DEG);
      const need = Math.hypot(aX, aH) * s.m / SHIP.T;
      if (s.phase === 'flip') {
        const k = clamp((s.t - s.tPh) / T_FLIP, 0, 1);
        s.thr = (0.4 + 0.6 * k * k) * (s.th < 70 * DEG ? 1 : 0.45);
        alphaMax = 0.42;               // nose RCS + full gimbal swing it through
        if (Math.abs(s.th - thT) < 4 * DEG && Math.abs(s.w) < 0.08) s.phase = 'burn';
      } else {
        s.thr = clamp(need, 0.3, 1);
        alphaMax = 0.25;
      }
      thrust = s.thr * SHIP.T;
      s.flap *= 0.98;
      if (s.h <= H_HAND) s.phase = 'handover';
    }
    // Pitch: a rate command toward the target, limited, then the torque to reach that rate (flaps in the entry,
    // nose RCS + gimbal afterwards). Rate-limiting the swing keeps the flip from overshooting.
    const wCmd = clamp(1.3 * (thT - s.th), -0.62, 0.62);
    const alpha = clamp(4 * (wCmd - s.w), -alphaMax, alphaMax);
    s.rcs = s.phase === 'flip' ? clamp(alpha / alphaMax, -1, 1) : 0;
    s.gim = thrust > 0 ? clamp(alpha * SHIP.I / Math.max(thrust * 0.4 * SHIP.L, 1), -8 * DEG, 8 * DEG) : 0;
    s.w += alpha * DT; s.th += s.w * DT;
    // Thrust along the nozzle: the body axis turned by the gimbal
    fx += thrust * Math.sin(s.th + s.gim); fh += thrust * Math.cos(s.th + s.gim);
    s.vx += fx / s.m * DT; s.vh += fh / s.m * DT;
    s.x += s.vx * DT; s.h += s.vh * DT;
    s.m -= thrust / (SHIP.ISP * 9.81) * DT;
    s.acc = Math.hypot(fx, fh + s.m * G) / s.m / 9.81;
    s.t += DT;
  }
  return { s, step, stopH };
}
// Where the entry ends up from x = 0, and how long it takes. Runs start at minus that x, so they hand over above the pad.
function runFrom(x0) {
  const e = createEntry(x0);
  while (e.s.phase !== 'handover' && e.s.t < 200) e.step();
  return e.s;
}
export function entryStart() {
  let x0 = 0;
  for (let i = 0; i < 8; i++) x0 -= 0.8 * runFrom(x0).x;
  const s = runFrom(x0);
  return { x0, t: s.t, end: { x: s.x, vx: s.vx, vh: s.vh, m: s.m, th: s.th } };
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

// ---------- 2. Terminal: height, speed and drift from the TVC's attitude ----------
// from = { x, h, vx, vh, m } at the handover (x across the ground, z sideways = 0).
export function createTerminal(from) {
  const s = { h: from.h, vs: from.vh, x: from.x, z: 0, vx: from.vx, vz: 0, acc: G, t: 0, m: from.m };
  return {
    s,
    // One DT with attitude a = { tiltX, tiltY, gx, gy } (deg). Returns the thrust acceleration.
    step(a) {
      const n = nozzleDir(a);
      const aV = clamp((vsTarget(s.h) - s.vs) / 0.8, -3, 3);            // guidance: follow the speed profile
      const acc = clamp((G + aV) / Math.max(n.y, 0.35), 0, SHIP.T / s.m);
      s.vs += (acc * n.y - G) * DT;
      s.h += s.vs * DT;
      // Sideways: the nozzle's push, less a little drag and the RCS holding position
      s.vx += (acc * n.x - 0.2 * s.vx) * DT;
      s.vz += (acc * n.z - 0.2 * s.vz) * DT;
      s.x += s.vx * DT; s.z += s.vz * DT;
      s.m -= acc * s.m / (SHIP.ISP * 9.81) * DT;
      s.acc = acc; s.t += DT;
      return acc;
    },
    get throttle() { return s.acc * s.m / SHIP.T; },
    get drift() { return Math.hypot(s.x, s.z); },
  };
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
