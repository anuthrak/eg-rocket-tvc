// Bench demo: the rocket on its CG pivot, simulated with the design numbers and the firmware's controller.
// It leaves out sensor lag, friction and fan response, so it is a prediction, not a measurement.

const DEG = Math.PI / 180, DT = 0.01;   // same 100 Hz step as the firmware

// docs/PROJECT_SUMMARY.md §5: 220 g of thrust on a 183 mm lever arm, I_cg 0.017 kg·m² (185 °/s² at 8° of gimbal)
const THRUST_N = 0.220 * 9.81, ARM_M = 0.183, I_CG = 0.017;

// firmware/nano_tvc: gains, gimbal limit and slew limit at full throttle
const SCALE = 150 / 220, KP = 2.5, KD = 0.55, KI = 0.3, I_MAX = 2 * DEG;
const GMAX = 8 * DEG, GRATE = 60 * DEG;

// Gusts: a short sideways shove, as a torque on the rocket. `dir` is the way the top is pushed (0° = +X, 90° = +Y).
const GUST_EVERY_S = 6;
const GUSTS = [
  { dir: 0, accel: 330, dur: 0.30 },
  { dir: 120, accel: 315, dur: 0.30 },
  { dir: 250, accel: 340, dur: 0.30 },
  { dir: 45, accel: 325, dur: 0.30 },
  { dir: 180, accel: 300, dur: 0.30 },
];

function axis() { return { tilt: 0, rate: 0, g: 0, integ: 0 }; }

// One controller + physics step for one axis. `push` is the outside angular acceleration (rad/s²).
function stepAxis(a, push) {
  a.integ = Math.max(-I_MAX / KI, Math.min(I_MAX / KI, a.integ + a.tilt * DT));
  const cmd = Math.max(-GMAX, Math.min(GMAX, SCALE * (KP * a.tilt + KD * a.rate + KI * a.integ)));
  a.g += Math.max(-GRATE * DT, Math.min(GRATE * DT, cmd - a.g));
  a.rate += (push - THRUST_N * ARM_M * Math.sin(a.g) / I_CG) * DT;
  a.tilt += a.rate * DT;
}

export function createDemoSim() {
  const x = axis(), y = axis();
  let t = 0, next = 2, n = 0, gust = null;   // first gust soon after the demo starts

  return {
    // Advance 10 ms. Returns the gust if one starts on this step.
    step() {
      let started = null;
      if (t >= next) {
        gust = { ...GUSTS[n % GUSTS.length], end: t + GUSTS[n % GUSTS.length].dur };
        started = gust; n++; next += GUST_EVERY_S;
      }
      if (gust && t >= gust.end) gust = null;
      // Light turbulence, so it is never perfectly still between gusts
      let px = (16 * Math.sin(t * 1.7) + 10 * Math.sin(t * 4.3 + 1)) * DEG;
      let py = (14 * Math.sin(t * 1.3 + 2) + 10 * Math.sin(t * 3.7)) * DEG;
      if (gust) {
        px += gust.accel * Math.cos(gust.dir * DEG) * DEG;
        py += gust.accel * Math.sin(gust.dir * DEG) * DEG;
      }
      stepAxis(x, px); stepAxis(y, py);
      t += DT;
      return started;
    },
    // Degrees
    read() {
      return { tiltX: x.tilt / DEG, tiltY: y.tilt / DEG, gimbalX: x.g / DEG, gimbalY: y.g / DEG };
    },
  };
}
