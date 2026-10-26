# Rocket TVC Simulator

EG1004 design project: a desktop rocket on a 2-axis gimbal that uses thrust vector control (TVC) to stay upright, plus a browser visualizer and flight sim.

**Constraints:** under $100, no lithium batteries.

## How it works

MPU6050 (on rocket) → Arduino Nano (on base) → 2× MG90S servos tilt the motor mount. The Arduino streams telemetry over USB to the web visualizer.

## Hardware

- Arduino Nano, MPU6050, 2× MG90S servos
- 3D-printed gimbal (V7) and motor tube (V8)
- A2212 motor + ESC (power source TBD)

## Status

- [x] Gimbal and motor tube printed
- [x] Firmware: IMU → PD controller → servos, serial telemetry
- [x] Web visualizer + flight sim
- [ ] Desk rig
- [ ] Rocket body
- [ ] Motor power + thrust tests
- [ ] Hardware-in-the-loop testing of the PD loop

## Repository layout

```
firmware/nano_tvc/nano_tvc.ino   Arduino Nano: MPU6050 → PD controller → 2 gimbal servos
visualizer/                      Web app (served by Vercel; see vercel.json)
├── index.html                   markup
├── style.css                    all styles
├── loader.js                    loading screen (plain script, runs first)
├── main.js                      entry point: start-up order, tabs, app version
├── bench.js                     Bench tab: 3D rig, Web Serial / demo feed, readouts, chart
├── mission.js                   Mission tab: Earth → Moon sim, cameras, HUD
└── public/                      static assets: favicon, app icons, images
CHANGELOG.md                     what changed in each version
```

## Firmware

Open `firmware/nano_tvc/nano_tvc.ino` in the Arduino IDE (board: Arduino Nano; libraries: Adafruit MPU6050, Servo). It runs the same PD gimbal controller as the Mission sim and prints `TVC firmware vX.Y.Z` at boot, which the visualizer shows in its LINK panel.

**Serial format:** `roll,pitch,yaw` (roll in degrees; pitch and yaw as servo angles, 90 = neutral)

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

Versions follow `MAJOR.MINOR.PATCH`: major for redesigns or serial-format changes, minor for features, patch for fixes. The firmware has its own version, since the board may be flashed with an older build.

1. Merge the work into `main`.
2. Bump `VERSION` in `visualizer/main.js` (and `FW_VERSION` in the firmware if it changed).
3. Add an entry to `CHANGELOG.md`.
4. Tag and push: `git tag -a v2.1.0 -m "…"` then `git push origin main v2.1.0`.