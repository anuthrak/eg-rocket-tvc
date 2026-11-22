// Landing tab physics, kept free of Three.js so it can be checked in Node.
// Units: metres, seconds, degrees at the interface; radians inside.
//
// The lander is the SLDP 45 rocket scaled up to 30 m. Its attitude comes from one of two sources:
//   rig  - the real rocket's tilt from the desk rig (bench.js 'tvc:sample' events), so pushing the real
//          rocket pushes the lander;
//   sim  - createAttitudeSim() below: two axes flown by the Nano's controller (controller.js), with gusts.
// Either way the descent (createDescent) turns that attitude into sideways drift: the thrust leans with the
// rocket. Vertical speed follows a fixed guidance profile; only attitude is flown by the TVC.

import { gimbalStep, AUTHORITY } from './controller.js';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export const DT = 0.01;            // 100 Hz, like the firmware
export const G_MOON = 1.62;
export const H0 = 220;             // descent starts this high (feet above the ground)
export const PAD_R = 15;           // landing pad radius
export const ABORT_DEG = 25;       // same tilt abort as the firmware: past this the lander is lost
export const LAND_OK_DEG = 8;      // touchdown tilt for a clean landing
export const TIP_DEG = 15;         // touchdown tilt past which it falls over
export const LEGS_AT = 90;         // legs deploy below this height

// Guidance: vertical speed target vs height. Reaches the ground at 1.5 m/s ~27 s after H0. The slow-down it asks for
// (VS_K × speed, 2.4 m/s² at the start) stays inside what the engine can give (2.6 g_moon thrust − 1 g_moon).
const VS_K = 0.1, VS_MIN = 1.5;
export const vsTarget = h => -(VS_MIN + VS_K * Math.max(h, 0));
export const timeToGo = h => Math.log((Math.max(h, 0) + VS_MIN / VS_K) / (VS_MIN / VS_K)) / VS_K;

// ---------- Simulated attitude: the demo source ----------
export const GUST = { accel: 330, dur: 0.3 };   // deg/s², s: a sideways shove, as in demo-sim.js

function axis() { return { tilt: 0, rate: 0, g: 0, integ: 0 }; }

// Thrust misalignment: a small steady torque in a random direction each run (deg/s²). The integrator trims it out;
// with the TVC off it is what tips the lander over within a few seconds.
const MISALIGN = 6;

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
    // Advance one DT. turb = turbulence multiplier (grows near the ground: the plume kicks up regolith).
    // held = before the descent: the lander is held upright whatever the TVC switch says.
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

// ---------- Descent: height, vertical speed, sideways drift ----------
export function createDescent() {
  const s = { h: H0, vs: vsTarget(H0), x: 0, z: 0, vx: 0, vz: 0, acc: G_MOON, t: 0 };
  return {
    s,
    // One DT with the rocket axis `ax` (unit vector, scene axes). Returns the thrust acceleration used.
    step(ax) {
      const aV = clamp((vsTarget(s.h) - s.vs) / 0.8, -3, 3);            // guidance: follow the speed profile
      const acc = clamp((G_MOON + aV) / Math.max(ax.y, 0.35), 0, 2.6 * G_MOON);   // lean → more throttle to hold the profile
      s.vs += (acc * ax.y - G_MOON) * DT;
      s.h += s.vs * DT;
      // Sideways: the thrust leans with the rocket. Light damping stands in for the lander's RCS.
      s.vx += (acc * ax.x - 0.2 * s.vx) * DT;
      s.vz += (acc * ax.z - 0.2 * s.vz) * DT;
      s.x += s.vx * DT; s.z += s.vz * DT;
      s.acc = acc; s.t += DT;
      return acc;
    },
    get throttle() { return s.acc / (2.6 * G_MOON); },     // 0..1 of the engine's full thrust
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
