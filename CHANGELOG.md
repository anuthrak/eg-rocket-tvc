# Changelog

Visualizer and repo versions are tagged `vX.Y.Z`. Firmware versions (`FW_VERSION`, printed at boot) are noted per entry.

## [Unreleased]
### Added
- **Landing tab** (`visualizer/landing.js`, planet in `visualizer/landing-orbit.js`, physics in `visualizer/landing-sim.js`): a Starship-style ship (50 × 9 m, built in code: steel body, tiled belly heat shield, moving flaps, three gimballed centre engines and three vacuum bells) from Mars orbit to touchdown, for the showcase.
  - **Idle: in orbit** at 200 km over a procedural Mars (relief-shaded, deep orange, orange limb glow, stars). **Begin descent** (Space) starts a deorbit burn.
  - **Entry** (time-warped ×30, labelled): belly-first with the tiles glowing, a plasma sheath, a bow-shock rim and a trailing wake, then a cut inside the cloud deck to the ground scene.
  - **Belly flop and flip, autopilot** (`createFlight`, one 3D rigid body): drag on the belly, flaps trimming, nose RCS and gimballed thrust for the flip, fuel burn-off.
  - **TVC landing from right after the flip** (~1.9 km, ~15 s): the autopilot commands the attitude it needs to stop on the pad and the TVC source's tilt and nozzle angles are added on top. **Rig · live**: the real rocket on the desk rig (new `tvc:sample` event from the Bench feed; its resting lean is trimmed out during the flip). **Simulated**: the Nano's controller (`controller.js`) with gusts; **TVC: Off** shows it lost past the 25° abort. With the TVC on, a standard gust never crashes it (200 random runs); touchdown at 1.5 m/s.
  - The centre engines and the plume swivel with the gimbal (the TVC source's swing drawn 1.6× so it reads), and the exhaust's dust follows the nozzle.
  - World: terrain out to a curved horizon 110 km away with mountain ranges, mesas and a canyon, exponential dust haze, two cloud layers, sun glare, deeper Mars colours.
  - Cinematics: per-phase camera shots in Auto (flap close-up, flip, low pad shot), buffet shake, ignition flash, dust storm at touchdown, and a half-speed replay of the last 1.6 s before the result card.
  - **Pause / Play** (button or Space while flying), phase chips (Orbit · Entry · Belly flop · Flip · TVC landing · Touchdown), Gust (G), Cam Auto/Chase/Pad/Free, **Auto-loop** for a booth, "Signal lost" pause when the rig feed stops, live push timer and result card.
- Landing tab **look foundations** (`visualizer/landing-look.js`): post-processing with bloom (only genuinely bright things glow: plume, plasma, sun, limb, flashes), AgX tone mapping and a grading pass (contrast, saturation, split-tone, vignette, film grain, fade/flash moved out of CSS). Three looks sampled from reference photos (A clear afternoon, B golden dust, C burnt sienna) plus a space look, blended by phase from one table at the top of `landing.js`. The sky, fog, sun, fill light, cloud density, steel reflections and the ground palette all follow the active look. Procedural lens flare. Ground colour now comes from the look's palette by lightness, slope and distance; ~12,600 instanced low-poly rocks around the landing site. **Quality: High/Medium/Low** button (saved; drops by itself under 40 fps), `?debug` shows fps.
- Landing tab **orbit idle** (`visualizer/landing-orbit.js` rewritten): procedural Mars with crater fields at four scales (bowls, raised rims, bright ejecta), a terraced canyon system near the ground track, dark basaltic plains and dusty highlands, relief shading from screen-space height derivatives (long shadows at the terminator), detail that fades with pixel size; an analytic limb glow (optical depth through a thin shell, a pale rim at the sunlit limb, forward scattering); 15,000 stars with a magnitude and colour distribution and a faint Milky Way; a star-burst sun that fades as it sets behind the limb. The sun now rises over the limb ahead of the ship. The ship in orbit has its own lighting (cheated key, hard sun rim, warm planet bounce, cool limb rim) and its own reflections (black space, orange planet, limb band). Idle camera: three composed shots (hero 3/4 with the sunrise, wide, low along the belly), each a slow push with a little roll, cut through a short dip to black; the composition centres the ship on portrait screens. Planet detail drops with the Quality setting.
- Landing tab **deorbit burn** (~10 s, real time): prep, a flip to tail-first on the nose and tail RCS (puffs in opposite pairs, overshoot and settle), the burn on the three vacuum engines and the flip back belly-first into the entry, with small visible gimbal corrections and a Δv / periapsis panel. **One continuous shot** (no cuts): the ship in 3/4 profile, the sun and limb arc in frame, a slow orbit easing in for the ignition. **Engine fire**: a long core per engine (white-hot at the nozzle → blue-violet → pink), glowing fire particles streaming along it, a flare at each nozzle; engines light 0.1 s apart with stutters and an over-expanded start, and collapse back into the nozzle with a sputter and a last puff; the bells glow and cool. **Orbit light**: the sun is low ahead (5° above the ground under the ship): the ground is lit at grazing angles with long crater shadows, the sun is in frame above the limb with a star-burst and a restrained flare, the limb arc is brightest under the sun with a white-hot line, and the ship is rim-lit by the real sun (faint fill). During the entry the sun eases to the ground scene's, so the cut matches. `?sunrise` draws the sun disc and glare right on the limb in the hero idle shots (a film cheat; off by default).
- Landing tab **real Mars season** (late southern spring): the planet is tilted so the orbit sun sits 18° south of its equator (Mars' 25.2° obliquity allows at most 25°; the old view had the south pole tipped ~39° toward the sun), the ship's ground track is now over the northern plains at ~54°N with the ground speed corrected for that latitude, the south cap is shrunk to its summer size (patchy seasonal frost to ~80°S round the residual cap), and the north has thin seasonal frost under a faint polar hood, mostly in the polar night. Lighting and framing unchanged.
- Landing tab **entry plasma** (section 3): entry lengthened to ~20 s on screen, one heating curve (q ∝ √ρ·v³, peak ~65 km) drives every effect; plasma colour by temperature (faint pink-violet → orange → white-yellow at the stagnation zone); ragged plasma ribbons peel off the nose, belly edges and flap tips; sparks at peak; shock hugs closer as heating rises; lumpy wake; tiles glow with thermal lag; the plasma lights the ship from below. Ship enters nose-up (~70° angle of attack) instead of flat. Three entry shots (pull-down, low long-lens peak, side view with the wake), radio blackout 80–40 km, heating panel (heat flux, tile °C, bar).
- Landing tab **smooth time warp**: the entry warp ramps instead of switching (a 1.5 s beat at ×1 while the ship settles nose-up, ×1 → ×30 over 3 s, ×30 → ×10 into the cloud cut), the badge counts live, and the ground scroll is capped (from the orbit's ×4 to ×12) so the planet drifts instead of racing. Entry ~25 s.
- Landing tab **falling through the clouds** (section 4): a cloud deck from 6.6 to 8.1 km of sprite wisps (lit tops, grey-orange base) round the ship's path, with the overcast ceiling below; the switch from orbit to ground now happens inside the deck (shorter reveal). Two new shots: a shaky close-up riding along by the aft flap through the deck (buffeting, jolts), then a long-lens tracking cam far below that lags, overshoots and corrects as the ship pierces the cloud base, zooming in as it locks on. Torn cloud streamers off the flaps and a "Cloud base · 6.6 km" callout at the breakout.
### Removed
- **Mission tab** (Earth → Moon sim, `mission.js`, `mission-fx.js`, `nozzle-view.js`) and its mini bench panel; **Landing** is now the home page.
### Changed
- Tests → **Authority (IT-5) replaced by Stability (IT-3)** (`visualizer/stability.js`; `authority.js` removed). Motor off: the whole test is the rig balance that the old Swing X / Swing Y buttons only sampled. Settings: axes X/Y, 2/4/6 releases per axis (+ and − sides in turn), release angle 5/10/15/20°, record up to 10/20/30 s, target neutral or 5/10 mm nose-heavy, and the rocket's mass, inertia, ballast point and tab slide. Guided releases: tip, hold still (detected), let go (detected and back-dated), recorded until still, at a stop or out of time; "It stayed", "Redo last", Stop (keeps finished releases). Each release is fitted with accel = −k·(tilt − settle) − c·rate − f·sign(rate) plus peaks: CG height vs the pivot, period (fit and peaks), pull at 5°, damping ratio, dry friction torque and dead band, decay shape (dry vs viscous), settle angle and time, gyro check. Per axis and overall: best CG estimate, the axes-disagree check (the GS-001 pivots cross at one point), a friction lower bound for an axis that never moves, and the fix (tab slide, then nose grams). Six charts: live tilt, swing vs time, phase portrait, pull-back vs tilt with the fit line, swing size per half swing, CG per release. Download CSV, samples CSV, Copy summary, past runs. Demo mode runs it on a simulated rig.
- Charts: XY series accept `[x, null]` to break a line.

## [2.12.0] – 2026-11-20
Firmware v1.13.1.
### Added
- Tests → **Authority (IT-5)**: how hard the TVC turns the rocket, from balanced upright on the pivot (`visualizer/authority.js`). Options: throttle 25/40/60 %, gimbal 8/6/4/2°, axes X/Y, 1–3 repeats each way. Each tip: wait until the rocket is still within 12° of upright, motor up with the gimbal centred (drift), gimbal step so it tips across upright, and the body-rate slope after the gimbal arrives is the angular acceleration. After 5° the gimbal reverses until the rate is zero, then motor off, so tips alternate sides with no hands. Results per axis and angle: acceleration, per gimbal degree (*b*), % of design (185 °/s² at 8° and 220 g, scaled by the throttle's thrust), torque (I = 0.017 kg·m²), implied thrust, and the CG offset it could lift at 25°. Charts: rate in each tip from the gimbal step, acceleration vs gimbal with the design line, plus throttle and body rate. Download CSV, raw samples CSV, Copy summary, past runs. Stops past 20°, 120°/s, a tip the wrong way (2°) or 6° of drift with the gimbal centred; Space / Stop / Esc / leaving the tab stop the motor. A negative corrected result is shown as not valid.
- Authority → **Swing X / Swing Y (IT-3)**, motor off: tip the rocket, hold, let go; 15 s are recorded. A least-squares fit of rate − rate₀ = −k·∫tilt dt + k·eq·t − c·Δtilt + offset gives the gravity spring k (swing period, pull at 5°), the pivot damping c and where it settles; neutral and "moved a little and stopped" (friction) are recognised, and a gyro-vs-tilt check warns if they disagree. Every tip is corrected with it (the CSV keeps the uncorrected value too). Results show the time they were measured.
### Changed
- Thrust vector (CT-5): lift-off now needs 2.5° off the stop for 5 samples (100 ms) instead of 1° for 3, so motor shake and settling on the stop no longer count; the page's stop is 9° off the stop (was 6°).
- Firmware v1.13.1: every fixed serial message is in flash (`F()`), freeing ~500 bytes of RAM (77 % → ~55 %). Output unchanged.
### Fixed
- The `ARM,REST,…` reply never reached the tests (the line filter didn't pass `ARM`), so Thrust vector always failed with "No reply to ARM REST" even on firmware v1.13.0.

## [2.11.0] – 2026-11-19
Firmware v1.13.0.
### Changed
- Bench 3D model updated to **SLDP-ST-008** (batch-002): tangent-ogive nose with forward ship flaps, aft flaps, hot-staging band, 4 grid fins, 4 strakes on part A instead of the old fins, and the avionics bay door. Colours: a light stainless-steel booster, and a black ship (part D, nose band, ogive and flaps) matching the black grid fins. The TVC gimbal is at 37 mm (was 57), the motor tube ends 57 mm below it, and the rig pivot is at 247 mm. The rocket now turns through the rig's gimbal chain (outer pivot, then inner), with the same attitude as before.
- **Thrust vector (CT-5) is now a breakaway test**: how much thrust it takes to move the rocket. It starts with the rocket resting on a rig stop instead of needing it balanced upright, which the old kick test needed (a lopsided rocket rested at ~30° and tripped the 12° / 25° stops at once). For each gimbal angle (8/6/4/2°, biggest first) and repeat (1–3): rest lean and direction at 0 %, gimbal along the lean, baseline noise, then a slow ramp (1/2/4 %/s up to 25/40/60 %). Lift-off = 1° off the stop for 3 samples (or 5 × noise), detected on each IMU sample. The page cuts the motor and centres the gimbal at once, then waits for it to settle back. A curve fit (moved ∝ (t − t0)² or ³) back-dates lift-off to where it started moving. Results: lift-off and starts-moving throttle per angle (median ± spread), thrust (Throttle step-test scale readings if any, else spec), side force, torque about the pivot (× 190 mm), rest lean and direction, equivalent CG offset at 598 g, and a check that the torque agrees across angles. Charts: off the stop vs throttle for every ramp (live), starts-moving throttle vs gimbal with the constant-torque curve, and torque to move it vs gimbal (each repeat, dashed median: level means consistent). Download CSV, raw samples CSV, Copy summary, past runs. Stops past 6° off the stop or 90°/s.
### Added
- Bench → Desk rig: **the makerspace room**. A clean, modern room: light polished concrete floor (replaces the grid in this view), light grey walls with a violet accent band at bench height, a white pegboard with tools hung by size and bins, a white counter along the side wall with three enclosed 3D printers (glass doors, light strips, a part on each bed), a whiteboard, a wall-mounted fire extinguisher with its sign, a thin yellow safety line round the exhaust zone, and LED ceiling panels with neutral light. The table has a birch top and white steel legs, and the sun is softer in this view.
- Bench → Desk rig: a **test bench around the rig** (`visualizer/workshop.js`, simple shapes built in code).
  - Live props: a 12 V bench supply showing volts and approximate amps from the real throttle (output LED on while armed), a laptop whose screen shows the live tilt traces, gimbal dial and throttle, a kill switch that lights while a motor test is armed, and a warning beacon that turns while the motor runs.
  - Cables: USB and red/black 12 V cables run from the rocket near the pivot to the laptop and the supply, and follow the rocket as it tilts.
  - Bench items: Nano + MPU-6050 on a breadboard with jumpers, safety glasses, a multimeter with leads, and a tape measure.
  - Test props for the last test opened: Laser shows a laser on the motor tube and its beam and dot on an A3 sheet on the floor, Thrust vector shows coins taped on the ship, and Throttle shows a kitchen scale reading the spec thrust.
- Bench: the **detailed CAD model** (`visualizer/models/sldp45.glb`, 2.2 MB, 50 parts) from the full GA with the desk rig (`SLDP45_full_GA_with_desk_rig.step`): every body part with its vents, door, holes and flaps, the grid fins, both sleds, the TVC mount, the rig and the screws. The TVC inner gimbal and the riding servo turn with the X nozzle angle and the motor tube with both. The rig's middle ring follows the rocket on the outer pivot. The plain view shows the rocket in its rings, and Desk rig adds the arm, base, table and clamps. The simple model shows until the file loads, or if it can't. Regenerate with `cad/lib/step2glb.py <step> visualizer/models/sldp45.glb 0.08` (needs `cadquery-ocp`).
- Bench: **Desk rig** toggle (top right of the 3D view, remembered in the browser). It switches to the rocket on the real SLDP-GS-001 rig, clamped to a table: collar and pivot tabs on the rocket, the middle ring turning with it on the outer pivot, the fixed outer ring, arm, base and 2 C-clamps, and a 1200 × 700 mm table 40 mm below the pivot, with the floor at table height. Hidden in the Mission mini view.
- Laser (CT-1) **Quick** mode and **floor** target. Quick: 0, +6°, 0, −6°, 0 per axis (10 marks instead of 36). Backlash comes from the two returns to 0. Floor: the laser points down from the rig onto one sheet of paper for both axes, distance measured from the gimbal pivot to the floor. Results add the **gain on each side** (measured ÷ commanded) and the **linkage ratio for gain 1.0** for both modes. The Setup tab shows the IMU lean, and the Measure tab warns if the rocket moves more than 0.3° on the pivot during an axis. The +X / +Y preview buttons now go to 6°. The CSV format is unchanged (`dir` is start/up/down).
- Firmware v1.13.0: `ARM REST` arms the motor for a rocket resting on a rig stop. The next IMU reading is kept as the rest attitude and the motor cut becomes "more than 12° from rest" (`THR,CUT,MOVE`) instead of "past 25° from upright". It replies `ARM,REST,<tiltX>,<tiltY>`. `THR` above 0 is refused until then, and a rest lean past 40° disarms with `ERR,ARM REST lean`. Plain `ARM` is unchanged.

## [2.10.0] – 2026-11-18
Firmware v1.12.0. Brings in the laser (CT-1) and throttle (CT-4) tests, per-servo linkage ratios and the new Tests tab.
### Added
- Calibrate → Save: **separate linkage ratios for the X and Y servos** (Linkage ratio X / Y). The laser helper has Test X 20° and Test Y 20° and applies the result to the servo it measured. The Laser test summary shows both (`SPG X … Y …`). With older firmware the Y field is disabled and one ratio sets both.
- Firmware v1.11.0: `SET SPGX` / `SET SPGY` set each servo's linkage ratio (`SET SPG` still sets both). The flight loop, `GIM` and `SWEEP` use each servo's own ratio. `CFG` gains a 13th field, the Y ratio. Saves from v1.3.0–v1.10.0 load unchanged with Y = X until the next SAVE.
- Bench → Gimbal → **Throttle**: the CT-4 EDF throttle test. Safety checklist before Arm; live throttle, ESC pulse and spec thrust; slider and 0/10/25/50/85 % presets; a 9-point step test (10 → 85 %) where you type the scale reading and, optionally, the supply current; results table, **Download CSV**, **Copy summary** and past runs kept in the browser. **Stop motor** (or Space) is always on screen while armed. The motor also stops when the panel closes, the tab is hidden or switched, the link drops, or Calibrate / Laser opens. The 3D plume follows the real throttle while the panel is open. The Gimbal header now has four buttons and uses the short labels (Free / Cal / Laser / Thr) unless the side panel is very wide; on the narrowest panel the title gives way to them.
- Throttle → Safety → **ESC throttle range**: guided ESC calibration. Tick "12 V supply is OFF", Send full throttle, turn the 12 V on, press "Heard the beeps: set zero" when the ESC beeps. Shows a 15 s countdown; Cancel, Space, closing the panel or hiding the tab send zero. The header reads "ESC cal · full signal" in red meanwhile. Needs firmware v1.10.0.
- Firmware v1.10.0: `ESCCAL HIGH` / `ESCCAL LOW` (calibration mode, disarmed) for the ESC's throttle-range calibration. HIGH sends 2000 µs, held at most 15 s and dropped on a quiet link (0.5 s) or a mode change (`ESCCAL,TIMEOUT|LINK|MODE`). `HB` is a silent heartbeat.
- Firmware v1.9.0: ESC output on **D3** (servo pulse, 1000–2000 µs), held at 1000 µs from the first line of `setup()`. `ARM`, `THR <pct>` and `DISARM` work in calibration mode only. Throttle capped at 85 %, rises at most 50 %/s, drops at once. Motor cut (`THR,CUT,LINK|TILT|MODE`) when no serial line arrives for 0.5 s, on a tilt past 25° (3 readings in a row), or on `CAL` / `RUN`; it stays off until the next `ARM`. Status `THR,<ARMED|SAFE>,<target %>,<actual %>,<µs>` at 5 Hz while armed. Flight mode still holds the motor at zero.
- Bench → Gimbal → **Laser**: the CT-1 laser accuracy test in the visualizer. Setup (wall distance, zero mark, + side), then 18 points per axis. You type the dot's distance in mm and see the angle and error as you type. Redo last point, Stop. Results show PASS/FAIL per axis (error and backlash ≤ 1°), all points, **Download CSV**, **Copy summary**, and past runs kept in the browser. Laser and Calibrate close each other. When the side panel is narrow, the Gimbal header buttons read Free / Cal / Laser. The wall distance (from the gimbal pivot, not the laser tip) shows what is in use. A bad entry is explained and the old value kept (no silent reset), and the distance is locked once an axis is measured.
- Firmware v1.8.0: `GIM <x> <y>` / `GIM OFF` (calibration mode only) holds the gimbal at a commanded angle through the flight conversion, at the flight slew limit, clamped to ±8°. Replies `GIM,x,y` when there.
- `tests/ct1_laser_gimbal/`: CT-1 laser gimbal-accuracy test. The test sketch uses the flight conversion and the EEPROM calibration (read only). `laser_log.py` logs the 18-point step test per axis to `t2_gimbal.csv` and gives PASS/FAIL (error ≤ 1°, backlash ≤ 1°). It can drive the Arduino over serial.
- **Tests tab** (Mission · Bench · Tests): every bench test on one page. A numbered test list on the left (Calibrate, Free-hand, Laser CT-1, Throttle CT-4, Thrust vector CT-5), a live strip across the top (mode, tilt, gimbal, gyro rate, throttle), the open test's steps in the middle, and its charts on the right with the 3D rig view and the serial log. One test at a time; Throttle and Thrust vector stop the motor when you leave the tab. The Gimbal panel on Bench no longer has test buttons. Medium windows put the test list across the top; phones stack everything.
- Charts per test (hover for values): Tilt and Gimbal (live, home and Calibrate); Free-hand lean vs gimbal per axis and a gimbal-vs-lean scatter; Laser commanded vs measured and error per point (±1° limit); Throttle actual vs target, vibration (gyro rms, or tilt spread on older firmware) and thrust vs throttle when a scale was used; Thrust vector body rate, vibration, authority, relative thrust and trim vs throttle.
- **System check** (Tests → 0): every part in about 5 minutes with nothing rewired (IMU stays on its breadboard, EDF clamped to the desk). Eight guided steps: power and link (firmware, stream rate, gyro rates, ESC tune), IMU still (tilt noise, gyro offset and noise), IMU axes (tilt the breadboard toward +X and +Y: axis, sign, gyro agrees), servos (circle and corner sweeps: travel, no Nano reset), control loop (flight mode, tilt by hand: the gimbal follows on both axes), motor (10 → 20 → 30 %: reaches and holds each step, blows out the tail), motor + servos (25 % with a sweep: no reset, no data gaps, vibration), safety cuts (Space stop and the Nano's 25° tilt cut, both timed; the tilt cut from the last crossing past 25°). Pass / Check / Fail per step with the numbers, Download CSV, Copy summary, past checks. Stop motor / Space / Esc / leaving the tab stop the motor at once.
- **Free-hand** test: Free-test on/off (moved here from Bench), per-axis "Following" check and gimbal-per-lean fit, peak lean and gimbal, time at the ±8° limit, tilt-abort notice. Closing it turns Free-test off.
- **Thrust vector (CT-5)**: motor and gimbal together on the rig pivot, no scale. At each chosen throttle (20–70 %) the page holds the rocket upright with a gentle gimbal loop (the angle it settles at is the trim), then gives ±X and ±Y kicks (1–3°, 0.3–0.5 s, each cancelled by an equal opposite kick). From the gyro: control authority (°/s² per gimbal °), kick direction check, trim, vibration and relative thrust (authority ÷ top level, against the throttle² spec shape). Stops past 12° lean or 90°/s, on Stop / Space / Esc, leaving the tab, hiding the page or losing the link. Results table, Download CSV (and every raw sample of the latest run), Copy summary, past runs. Clamped mode runs the same sequence for vibration and servo checks only.
- Firmware v1.12.0: the `CAL` line adds the gyro rates (`CAL,xServo,yServo,tiltX,tiltY,rateX,rateY`, deg/s, bias removed) and streams at 50 Hz in calibration mode (flight telemetry stays 20 Hz). Older pages ignore the extra fields.

## [2.9.0] – 2026-11-08
### Added
- Calibrate → Direction: **Motion test** moves both servos through the full ±8° gimbal range, as a circle or corner to corner, then back to centre. Needs firmware v1.7.0 (`SWEEP CIRCLE|CORNERS|OFF`).
### Fixed
- Mission: **Hit it** waits until the rocket has recovered from the last hit. Back-to-back hits could stack up until it tumbled.

## [2.8.0] – 2026-11-05
### Added
- Mission: Director camera (now the default) that cuts between shots through the flight, with stage separation in slow motion, onboard cameras mounted against the body near the tail, looking back past it (countdown, ascent, after separation, landing legs) and overhead shots in Earth and lunar orbit. Dragging or zooming takes the camera back as a chase view. The camera button cycles Director, Chase and Overview.
- Mission: camera shake at ignition, liftoff, Max-Q, separation and hits, plus an engine glow. Shake turns off under the system's reduced-motion setting.
- Mission: pad smoke, a Max-Q vapour collar, separation puffs and landing dust.
- Mission: live nozzle close-up in the panel under the mini bench (hidden on phones and whenever it doesn't fit beside the HUD).
- Mission: **Hit it** button shoves the rocket mid-flight and reports the recovery time and peak angle. The flight path stays scripted, so a hit changes the attitude only.
### Fixed
- Mission: the landing legs swung inward through the body and were too short to reach the ground. They now stow against the body, swing outward and reach the surface.
### Changed
- Mission and the Bench demo share `controller.js`, the same algorithm and gains as the firmware, replacing the Mission's own PD controller. Thrust authority comes from the design numbers (185 °/s² at 8° and full thrust).

## [2.7.0] – 2026-11-04
### Added
- Bench: **Free-test** button next to Calibrate, for tilting the rocket by hand. Firmware v1.5.0 `FREE ON|OFF`: no tilt abort and half gains, with the same ±8° limit. It starts off every time the Nano restarts and is never saved.
- Bench: the 3D model is built from the CAD numbers: 632 mm × Ø78.6 proportions, parts A, B, D with coupler bands, CAD fins at 45/135/225/315°, pivot at the 240 mm CG, and a motor tube that swings about the gimbal point at 57 mm. The tube sticks out 18 mm past the tail so it can be seen (flush in the CAD).
- Bench: thrust plume out of the motor tube and an arrow for the sideways force on the rocket, with a note saying what they show. On the real rig they are dim, because no motor is wired yet and they only show the command.
- Firmware v1.6.0: telemetry adds the tilt, `roll,pitch,yaw,tiltX,tiltY`. Older visualizers ignore the extra values.
### Changed
- Bench: the rocket now leans by its real tilt from the IMU, and the motor tube shows the nozzle angle (servo deflection ÷ linkage ratio). Charts, readouts and the dial still show servo angles. With older firmware the rocket stays upright and only the tube moves.
- Demo mode is a physics simulation (`demo-sim.js`) using the design numbers and the firmware's gains: every 6 s a gust knocks the rocket 10–19°, the nozzle goes to its limit, and it recovers in about a second. It is a prediction, not a measurement. You can also drag the rocket up to ±24° and let go to watch it recover; dragging anywhere else still orbits the camera.
- Bench chart shows the rocket's tilt, with the ±25° abort lines, instead of servo angles. Readout cards and the dial still show servo angles.
- Firmware v1.5.0: the tilt abort is back on by default; `TILT_ABORT_ENABLED` is gone.
### Fixed
- Firmware v1.5.0: `SET ROT` now turns the level trims with the sensor mapping, so an upright rocket still reads upright after the sensor step. Run Level once to clear a trim saved before this fix.

## [2.6.0] – 2026-11-04
### Changed
- Firmware v1.4.0: the tilt abort is off for hand testing (`TILT_ABORT_ENABLED = false`); the gimbal keeps steering at any tilt, clamped to ±8°. The abort code is unchanged. Turn it back on before the motor runs.

## [2.5.0] – 2026-11-02
### Added
- The whole project is now one repository: CAD models and drawing generators (`cad/`), the batch 001 drawing release with print STLs and STEP files (`releases/`), and the project summary, bill of materials and drawing standard (`docs/`) sit next to the firmware and visualizer. Paths of the existing files are unchanged.
- Firmware v1.3.0: the MPU6050 can be mounted in any orientation. Level detects which sensor axis points up the rocket and the sensor check turns its X/Y to match (`SET UP`, `SET ROT`; `CFG` gains `up,rot` at the end).
- Firmware v1.3.0: tilt abort. Beyond 25° the gimbal centres at once and `ABORT,TILT` is printed; it re-arms after 1 s back within 5° (`ABORT,CLEAR`) or on `RUN`. The serial log shows these lines.
- Calibrate → Save: a laser helper that measures the linkage ratio from a 20° servo pulse.
### Changed
- Firmware v1.3.0: PID with the starting gains from the project summary (Kp 2.5, Kd 0.55, Ki 0.3 clamped to ±2° of gimbal, scaled by thrust) instead of the sim's PD gains; servo pulses via `writeMicroseconds` with fractional degrees; linkage ratio default 4.0 (range 0.2–8). Saved configs from v1.2.0 fall back to defaults once (the EEPROM layout changed), so calibrate again after uploading.
- Axes are named the same way everywhere: +X is toward the two M3 TVC mount screws (body 0°); the X servo tilts the nozzle toward ±X and drives the drawings' pivot axis Y.
- Calibration's sensor step corrects a turned sensor instead of asking for a remount (firmware v1.3.0; older firmware keeps the old advice).
- README covers the whole project (EDF, sled, drawings, axes) instead of the original A2212 plan.

## [2.4.0] – 2026-11-02
### Added
- Bench: gimbal calibration (Gimbal → Calibrate). A five-step panel over the 3D view: centre each servo, set level, check the sensor's axes, test each servo's direction (flips it or swaps the D9/D10 roles from your answer), then save to the Nano. The rig and gimbal dial follow the servos while it's open. Sent commands show in the serial log.
- Firmware v1.2.0: serial commands (`CAL`, `RUN`, `GET`, `SET`, `LEVEL`, `PULSE`, `SAVE`, `LOAD`, `DEFAULTS`) and an EEPROM-stored config, so calibrating needs no re-upload. Prints `CFG,…` at boot. Replaces the Serial Monitor `CAL_MODE` helper from v1.1.0.
- Per-servo centre trim and a `SERVO_RANGE` limit around it.
### Changed
- Firmware names the servos by axis: D9 = X-axis servo (visualizer "pitch"), D10 = Y-axis servo (visualizer "yaw"). Same pins and behaviour as before, and the telemetry format is unchanged (servo angles still read 90 = neutral after trimming).

## [2.3.0] – 2026-10-26
### Added
- Intro transition after the loading screen. Mission: the camera flies in from a wide shot of Earth to the chase view (~1.8 s, controls paused until it lands) while the HUD boots in, with panels fading and rising one after another, the event list cascading and timeline markers lighting up left to right. Bench: HUD boot only. Same-tab reloads skip the fly-in and get a quick HUD fade; "reduce motion" keeps a plain fade.
### Changed
- The 3D scenes skip drawing while the loading screen fully covers them, and the loading bar's speed is time-based, so slower machines load noticeably faster.

## [2.2.0] – 2026-10-26
### Added
- Favicon (white tilted rocket on a black circle) plus PNG fallback and iOS home-screen icon, in `visualizer/public/`.
- Bench: gimbal dial (nozzle position inside the ±45° ring, with a trail) and a serial log (last 200 lines, boot messages highlighted) that fills the right sidebar.
- Mission camera collisions: Earth, the Moon, the rocket and the launch tower are solid; the camera dead-stops on contact (no sliding into surfaces) while orbiting at the same height and pulling away still work.
### Changed
- Mission is the first tab and the home page (returning Bench visitors still land on Bench).
- Bench layout: two sidebars around the 3D view (readouts, chart and input on the left; gimbal and link on the right) that don't scroll on normal screens.
- Phones and short windows: one-line header, line-icon controls, a one-line P/Y readout instead of the mini bench panel; Connect and baud hide where USB Web Serial can't work.
- Loading bar eases between checkpoints and keeps moving while textures generate.
- Bench zoom limited to the floor grid's scale (1.2–11 units); panning stays on the grid; orbiting is still a free 360°.
- Static assets moved into `visualizer/public/`.
### Fixed
- Callouts no longer overlap the minimap on phones; short-landscape minimap clears the bottom HUD.
- Header no longer shifts 10px between tabs in narrow desktop windows (scrollbar gutter).
- Roll footnote and servo-mode label no longer clip in narrow sidebars; help text no longer mentions the removed Processing sketch.

## [2.1.0] – 2026-10-26
### Changed
- Visualizer split from one 1,900-line `index.html` into six files: `index.html`, `style.css`, `loader.js`, `main.js`, `bench.js`, `mission.js`. Same look and behavior. Run locally with a static server (see README).
- Firmware moved from `nano_test/` to `firmware/nano_tvc/nano_tvc.ino`.
- Loading screen always uses the fuel look; the footer buttons replay either look without changing the default.
- App version now comes from one place (`VERSION` in `main.js`) and shows in the footer.
### Added
- Firmware v1.0.0: prints `TVC firmware v1.0.0` at boot; the LINK panel shows the firmware version.
### Fixed
- Header no longer wraps onto two lines on the Bench tab only (it shifted when switching tabs at some window widths).

## [2.0.0] – 2026-10-26
### Added
- Loading screen with real load progress: fuel look (bench rocket's tanks fill, then a ±8° gimbal check) and mission-arc look.
- Header status strip: link clock, feed rate, time since last line, baud, line count, and an amber STALE state.
- Bench: roll readout, gimbal and link tables with a saturation bar, outline view of the rocket.
- Mission: top strip (next event countdown, max speed, max altitude, peak gimbal, engine state) and a mission events list.
- Footer with source, version and links.
### Changed
- Monochrome interface with color reserved for data; Barlow type throughout; dashes instead of zeros before data arrives.
- Overview camera fits Earth, the transfer orbit and the Moon into the area not covered by the HUD.
### Fixed
- Header items no longer shift when switching tabs or as numbers change.

## [1.0.0] – 2026-10-26
- First release: Bench view over Web Serial with demo mode, Earth-to-Moon Mission sim, and Nano firmware running the PD gimbal controller.
