// Landing Monte Carlo (side approach): Simulated source, TVC on, 3 random gusts, random side. node tests/landing_mc.mjs [N] [kd]
const L = await import('../visualizer/landing-sim.js');
if (process.argv[3]) L.LAT.kd = +process.argv[3]; const N = +process.argv[2] || 200, rnd = (a, b) => a + Math.random() * (b - a);
const { x0 } = L.flightStart();
let crash = 0, offPad = 0, lost = 0, maxMiss = 0, maxDev = 0, maxTD = 0, sumMiss = 0;
for (let i = 0; i < N; i++) {
  const f = L.createFlight(x0, (Math.random() < 0.5 ? -1 : 1) * L.DIVERT), s = f.s, att = L.createAttitudeSim();
  let plan = null, gone = false;
  while (s.h > 0 && s.t < 300) {
    let d = null;
    if (s.phase === 'tvc') {
      if (!plan) { att.reset(); plan = [2, 6, 10].map(t => ({ t: t + rnd(-0.6, 0.6), dir: rnd(0, 360) })); }
      const t = s.t - s.tPh;
      for (const g of plan) if (!g.done && t >= g.t) { g.done = true; att.gust(g.dir, 0.85); }
      att.step(1 + 1.5 * Math.min(1, Math.max(0, (80 - s.h) / 80)));
      d = att.read(); const dt = L.tiltOf(d.tiltX, d.tiltY); maxDev = Math.max(maxDev, dt);
      if (dt > L.ABORT_DEG) { gone = true; break; }
    }
    f.step(d);
  }
  if (gone) { lost++; continue; }
  const miss = f.drift; sumMiss += miss; maxMiss = Math.max(maxMiss, miss); maxTD = Math.max(maxTD, s.tilt);
  if (s.tilt > L.TIP_DEG || -s.vh > 6) crash++; else if (miss > L.PAD_R) offPad++;
}
console.log(`N${N} lost${lost} crash${crash} offPad${offPad} missAvg${(sumMiss / N).toFixed(1)} missMax${maxMiss.toFixed(1)} tdTiltMax${maxTD.toFixed(1)} devMax${maxDev.toFixed(1)}`);
