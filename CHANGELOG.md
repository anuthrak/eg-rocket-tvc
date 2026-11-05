# Changelog

Visualizer and repo versions are tagged `vX.Y.Z`. Firmware versions (`FW_VERSION`, printed at boot) are noted per entry.

## [Unreleased]
### Added
- Bench: **Free-test** button next to Calibrate, for tilting the rocket by hand. Firmware v1.5.0 `FREE ON|OFF`: no tilt abort and half gains, with the same ±8° limit. It starts off every time the Nano restarts and is never saved.
- Bench: the 3D model is built from the CAD numbers: 632 mm × Ø78.6 proportions, parts A, B, D with coupler bands, CAD fins at 45/135/225/315°, pivot at the 240 mm CG, and a motor tube that swings about the gimbal point at 57 mm. The tube sticks out 18 mm past the tail so it can be seen (flush in the CAD).
- Bench: thrust plume out of the motor tube and an arrow for the sideways force on the rocket, with a note saying what they show. On the real rig they are dim, because no motor is wired yet and they only show the command.
- Firmware v1.6.0: telemetry adds the tilt, `roll,pitch,yaw,tiltX,tiltY`. Older visualizers ignore the extra values.
### Changed
- Bench: the rocket now leans by its real tilt from the IMU, and the motor tube shows the nozzle angle (servo deflection ÷ linkage ratio). Charts, readouts and the dial still show servo angles. With older firmware the rocket stays upright and only the tube moves.
- Demo mode is a physics simulation (`demo-sim.js`) using the design numbers and the firmware's gains: every 6 s a gust knocks the rocket 10–19°, the nozzle goes to its limit, and it recovers in about a second. It is a prediction, not a measurement.
- Bench chart shows the rocket's tilt, with the ±25° abort lines, instead of servo angles. Readout cards and the dial still show servo angles, now labelled X servo and Y servo instead of Pitch and Yaw.
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
