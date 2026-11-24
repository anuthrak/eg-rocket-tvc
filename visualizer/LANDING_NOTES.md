# Landing tab: working notes (handoff)

Branch `landing-tab` (not merged; planned release v2.13.0 after user approval → merge to `main` → bump `VERSION` in `main.js`).
CHANGELOG "Unreleased" lists every step. Read this file first in a new session.

## How we work
- One section at a time: write a short prompt/plan → user says "go" → one patch → at most one check render → commit, push,
  pull the user's local copy (device bash: `cd $HOME/mnt/EG_SLDP && git -c core.autocrlf=true pull -q origin landing-tab`).
- Keep token use low: terse replies, targeted `sed -n`/`grep` reads, no renders unless needed or asked.
- Style: procedural only (no photo textures). The default look (not `?sunrise`) is the preferred one. No cinematic callout
  banners (`callout()` only shows `cls` containing `sys`). Visual changes stay on the branch until approved.

## Files
- `landing.js`: everything in the scene. Key parts: `PHASE_LOOKS`; terrain `terrain(x,z)` (smooth plains, 420 craters,
  7 mesas, far mountains/canyon) and the ground shader (`gMat.onBeforeCompile`, dune fields/streaks); sky shader (blue
  sun halo); cloud deck `DECK` + `buildWisps` (cumulus clusters, sprites); ship model (`R`, `LEN`, `TAIL`, flaps, RVacs,
  `vacCores`/`setVac`); entry plasma (`HEATC`, `plasmaMat`/`shockMat`/`wakeMat`, `ribbons`/`RIB`, `plasmaLight`,
  `entryHV`/`qRaw`, `tileT`, heat panel `heatPanel()`); cameras `cameraStep` (`ENT_CAM`, `shot()`, `camGoal`, `track`
  long-lens operator `trk`, `glint`); `cloudFx` (vapour trail, streamers, belly speed motes, chill-down, `bGust`);
  `placeShip` (flap steering + wobble in belly); `reset()` (full reset for Fly again); `__lnd` debug API (`?debug`):
  `still(look,x,y,z,tx,ty,tz)`, `shot(i,t)`, `entry(u)`, `ground()`, `flip(t)`, `at(h)`, `cam()` (shot name, approach side, z, fov, height, TVC time, tag shown). Plumes: `ENG`, `setPlume(thr,t,ft)`, `plumeFx`, `nozLight`/`poolLight`/`pool`, shimmer uniforms `uSh*` in the grade pass. Section 8: `setStrip`/`cue` (prompt strip), `gimArrow`/`tiltArrow`/`ghosts`/`cueRing`, `insScene` rendered after the composer with a scissor (`renderInset`), `showTag`. Strengths in `RL` (top of the Section 8 block). TVC landing shots: `TVC_CAM` (`tvcWide`, `tvcSide`: world-anchored x/z, height rides with the ship; `padH`), `apSide` (approach side, `newFlight()`), `skipToBelly()`. `callout()` still shows only `sys`; rig prompts go through the strip.
- `landing-orbit.js`: orbit planet (craters, canyon, caps for late southern spring: `POLE_TILT`, `SPIN`), clouds, atmosphere,
  stars, sun burst.
- `landing-look.js`: looks A/B/C/space (palette now matches the orbit planet), grade shader, bloom, quality, flare.
- `landing-sim.js`: physics (`createFlight`, phases belly → flip → tvc), `ENTRY` timings (entry 20 s profile, warp ramps).

## Timeline (as built)
Orbit idle → deorbit burn (`DEO`) → entry plasma (~25 s incl. warp ramp ×1→×30→×10) → hidden switch inside the cloud
deck → shaky close-up (6.6–8.1 km) → long-lens tracking cam with vapour trail → belly flop shots (flaps, top-down, side)
with chill-down and "Flip in 3·2·1" → flip → TVC landing → touchdown/crash, replay, result card.

## Done (sections)
Foundations · 1 orbit idle · 2 deorbit · real Mars season · 3 entry plasma (+ nose-up 70° AoA, smooth warp) ·
4 clouds (+ cumulus, far tracking shot) · ground look · 5 belly flop · terrain after Perseverance views · Fly-again reset · 6 flip (staggered relight, flap fold, 1.9× gimbal, RCS bursts, side → low aft shots; no slow-mo, user said no) · orbit idle 3 shots + less bloom · 7 engines & plume (per-engine plumes/gimbal, engine-out, nozzle + ground-pool lights, shimmer) · 8 rig link (prompt strip, ship arrows, Your-rocket CAD inset, push cues, recovery tag) · 8b calmer rig link (`RL` constants) · side approach (200 m divert, one overshoot) + TVC landing shots (wide → side profile → pad, cuts) + Skip to belly flop (B). User rejected: zoom/close-up shots, slow eases, inset growing.

## Next
1. Landing legs deploy (9), touchdown (10), crash (11).
2. Untested on the real rig (Demo mode feed drove one headless run of the earlier patch).
3. Optional polish left out to save tokens: heat shimmer, uneven tile glow, entry grade, focus-hunt blur, ship shadow on
   clouds/ground, flap-angle HUD graphic, mesa/canyon banding, canyon ground haze, cloud shadows.

## Tuning
- `RL` (Section 8): arrow thickness/length/opacity/easing/fade band/push brightness, ghosts, cue ring, push kick/shake, tag timing.
- `TVC_CAM` (landing.js): shot times/heights, camera x/z, height offset, aim drop, lead, fov.
- `DIVERT`, `LAT` (landing-sim.js): side offset; flip-phase pull `kFlip`, TVC-phase `kp`/`kd`/`amax`, overshoot `over` and its height ramps `hA..hD`. Re-run `node tests/landing_mc.mjs 500` after any change.

## Known issues
- Debug `still()` from ~4 km can show a pure-black block (bloom NaN); pre-existing, not seen in flight shots.
- Peak-entry shot still bright near the nose; tracking shot sky is Mars-orange (less contrast than the blue-sky refs).
- Landing Monte Carlo: `tests/landing_mc.mjs` (side approach, 3 gusts, both sides): 0/500 lost/crashed/off-pad.

## Testing (headless)
Recreate per session: `npm i three@0.160.0` in /tmp/nm, then a Playwright script (google-chrome + swiftshader) that routes the jsdelivr three URLs to /tmp/nm and serves visualizer/ from disk; wait for `window.__lnd` + ~15 s for the loader, then `[["eval",js],["wait",ms],["until",js],["shot",name]]` steps (`until` = waitForFunction) with `?debug`. Headless runs at ~3–30 fps, so flight-time screenshots need long waits; use `__lnd.ground()` to skip to the
cloud deck.
