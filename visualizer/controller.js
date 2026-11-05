// The Nano's TVC controller, for the simulations. Same algorithm and numbers as gimbalStep() in
// firmware/nano_tvc/nano_tvc.ino: keep the two in step when tuning.

const DEG = Math.PI / 180;

export const GMAX = 8 * DEG, GRATE = 60 * DEG;   // gimbal limit and slew limit
const KP = 2.5, KD = 0.55, KI = 0.3;
const I_MAX = 2 * DEG;                           // the integrator can add at most ±2° of gimbal
const THRUST_MAX_G = 220, THRUST_REF_G = 150;

// docs/PROJECT_SUMMARY.md §5: 220 g of thrust on a 183 mm lever arm, I_cg 0.017 kg·m².
// Angular acceleration at full thrust, per radian of sin(gimbal): 185 °/s² at 8°.
export const AUTHORITY = 0.220 * 9.81 * 0.183 / 0.017;

const clamp = (v, lim) => Math.max(-lim, Math.min(lim, v));

// One axis. a = { g, integ } in radians; angle and rate are the tilt and tilt rate; throttle is 0..1.
export function gimbalStep(a, angle, rate, throttle, dt) {
  const step = GRATE * dt;
  if (throttle > 0.05) {
    const scale = THRUST_REF_G / Math.max(THRUST_MAX_G * throttle, 50);
    a.integ = clamp(a.integ + angle * dt, I_MAX / KI);
    const cmd = clamp(scale * (KP * angle + KD * rate + KI * a.integ), GMAX);
    a.g += clamp(cmd - a.g, step);
  } else {
    a.integ = 0;
    a.g += clamp(-a.g, step);   // engine off: nozzle re-centres
  }
}
