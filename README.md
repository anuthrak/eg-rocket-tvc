# Rocket TVC Desk Rig (SLDP 45)

EG1004 Semester-Long Design Project: a 632 mm 3D-printed rocket with an electric ducted fan (EDF) in a two-axis gimbal. An Arduino Nano reads an MPU6050 and steers the fan's thrust with two servos to hold the rocket upright on a desk rig that pivots at its centre of mass. A browser visualizer shows the rocket live and runs an Earth-to-Moon mission sim.

**Constraints:** under $100 (spent $93.39), no lithium batteries. Full write-up: [docs/PROJECT_SUMMARY.md](docs/PROJECT_SUMMARY.md).

## How it works

MPU6050 → Arduino Nano (both on the avionic sled inside the rocket) → 2× MG90S servos → pushrods → gimbal tilts the EDF. The fan runs from a 12 V supply through a 20 A ESC, whose 5 V BEC also powers the servos. The Nano streams telemetry over USB to the web visualizer.

## Status

- [x] TVC gimbal (K-9 V7) and motor tube (V8) printed
- [x] Body, sled and assembly drawings released (batch 001)
- [x] Firmware v1.7.0: IMU → PID → servos, calibration over serial, tilt abort, free-test mode
- [x] Web visualizer: live Bench view, calibration, Mission sim
- [ ] Joint test, body and sled printed and assembled
- [ ] EDF + ESC (on order), thrust test, throttle control in firmware
- [ ] Desk rig (SLDP-GS-001) and wiring diagram (SLDP-EL-001)
- [ ] Closed-loop tuning on the rig

Due: Benchmark B Nov 13 · Commissioning Dec 4 · Final submission Dec 11 (2026).

## Repository layout

```
firmware/nano_tvc/nano_tvc.ino   Arduino Nano: MPU6050 → PID → 2 gimbal servos
visualizer/                      Web app (served by Vercel; see vercel.json)
├── index.html                   markup
├── style.css                    all styles
├── loader.js                    loading screen (plain script, runs first)
├── main.js                      entry point: start-up order, tabs, app version
├── bench.js                     Bench tab: 3D rig, Web Serial / demo feed, readouts, chart
├── calib.js                     Bench → Gimbal → Calibrate panel
├── mission.js                   Mission tab: Earth → Moon sim, cameras, HUD
└── public/                      static assets: favicon, app icons, images
cad/                             CadQuery models + drawing generators (Python)
├── lib/                         shared: sheet helpers, hidden-line removal, TVC assembly, paths
├── ST-005_rocket-body/          body model (6 printed parts + fins) and its drawing
├── AV-001_avionic-sled/         avionic sled model and its drawing
├── TVC-001_tvc-mount/           TVC mount assembly drawing
├── GA-001_rocket-ga/            whole-rocket assembly drawing
└── vendor/k9-gimbal/            K-9 TVC gimbal V7 + motor tube V8 (public domain, Thingiverse 3657663)
releases/batch-001_2026-10-30/   released drawings (PDF/PNG), print STLs, STEP, print list
docs/                            project summary, bill of materials, drawing standard
CHANGELOG.md                     what changed in each version
```

## Hardware and printing

Everything needed to build it is in [releases/batch-001_2026-10-30](releases/batch-001_2026-10-30): drawings, STLs with the print list and settings, and STEP files. Parts and prices: [docs/bom.md](docs/bom.md).

**Axes** (same in the drawings, firmware and visualizer): z = rocket axis, +X = toward the two M3 screws that hold the TVC mount (body 0°), +Y a quarter turn from there. The **X servo (D9)** tilts the nozzle toward ±X, so it drives the inner gimbal (drawing pivot axis Y); the **Y servo (D10)** drives the motor tube (pivot axis X).

To regenerate the CAD: `pip install cadquery trimesh shapely rtree scipy matplotlib numpy`, run the two models (`cad/ST-005_rocket-body/SLDP-ST-005_rocket-body.py`, `cad/AV-001_avionic-sled/SLDP-AV-001_avionic-sled.py`), then any `*_drawing.py`. Outputs are written next to each script.

## Firmware

Open `firmware/nano_tvc/nano_tvc.ino` in the Arduino IDE (board: Arduino Nano; libraries: Adafruit MPU6050, Servo). It prints `TVC firmware vX.Y.Z` at boot, which the visualizer shows in its LINK panel.

- 100 Hz loop, complementary filter, PID per axis (starting gains Kp 2.5, Kd 0.55, Ki 0.3, scaled by thrust), gimbal limited to ±8°, servo pulses in microseconds.
- Tilt beyond 25° centres the gimbal and prints `ABORT,TILT`; it re-arms after a second back within 5°.
- **Free-test** (Bench → Gimbal, or `FREE ON|OFF`) is for tilting the rocket by hand: no tilt abort, half gains, same ±8° limit. It starts off every time the Nano restarts.
- The MPU6050 can be mounted any way round (on the sled it stands on the vertical breadboard); calibration maps it to the rocket's axes.
- Throttle output arrives with the ESC; until then the controller runs as if at full throttle.

**Serial format:** `roll,pitch,yaw,tiltX,tiltY` (roll in degrees; pitch = X servo, yaw = Y servo, as servo angles, 90 = neutral; tiltX/tiltY = the rocket's lean toward +X/+Y in degrees, firmware v1.6.0+)

### Calibration

In the visualizer: **Bench → Connect Arduino → Gimbal → Calibrate**. Five steps, applied live on the Nano:

1. **Centre:** nudge each servo until the motor mount is dead straight (refit the horn one spline over if it's way off).
2. **Level:** rocket upright and still → Set level. Finds which way the sensor faces and trims it to read 0°.
3. **Sensor:** tilt the top toward +X, then +Y. If the sensor is turned on its mount, firmware v1.3.0 corrects it for you.
4. **Direction:** Test moves a servo the way the controller would for a lean toward +X/+Y; the top of the motor should tilt toward that side. Answer what you saw and it flips the direction or swaps the D9/D10 roles for you.
5. **Save:** check the linkage ratio (servo degrees per gimbal degree, about 4; a laser helper measures it), then write everything to the Nano's EEPROM.

Without the visualizer, type the same commands into the Serial Monitor (115200, newline): `CAL`, `SET XC 92`, `LEVEL`, `PULSE X`, `SAVE`, `RUN`… The full list is at the top of the sketch.

## Visualizer

Three.js and Web Serial, with no build step.

- **Mission** (home page): Earth-to-Moon flight sim with a TVC controller and a SpaceX-style dashboard.
- **Bench:** live 3D view of the rig from the Arduino, with readouts and a chart on the left and gimbal/link details on the right.

**Live:** https://eg-rocket-tvc.vercel.app (every push to `main` redeploys)

**Run locally:** the JS files are ES modules, so opening `index.html` straight from disk won't work. Serve the folder instead, then open http://localhost:8000 in Chrome or Edge:

```
cd visualizer
python -m http.server 8000
```

Click **Connect Arduino** (115200 baud), or use **Demo mode** or **Launch** without hardware.

## Versioning and releasing

Versions follow `MAJOR.MINOR.PATCH`: major for redesigns or serial-format changes, minor for features, patch for fixes. The firmware has its own version, since the board may be flashed with an older build. Drawings are released in numbered batches under `releases/`, with the revision letter on each sheet.

1. Merge the work into `main`.
2. Bump `VERSION` in `visualizer/main.js` (and `FW_VERSION` in the firmware if it changed).
3. Add an entry to `CHANGELOG.md`.
4. Tag and push: `git tag -a v2.1.0 -m "…"` then `git push origin main v2.1.0`.
