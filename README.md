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

## Flight software

`visualizer/index.html`: a single page using Three.js and Web Serial, with no build step.

- **Bench:** live 3D view of the rig from the Arduino.
- **Mission:** Earth-to-Moon flight sim with a TVC controller and a SpaceX-style dashboard.

**Run:** open in Chrome or Edge, click **Connect Arduino** (115200 baud), or use **Demo mode** or **Launch** without hardware.

**Serial format:** `roll,pitch,yaw` (roll in degrees; pitch and yaw as servo angles, 90 = neutral)

**Host:** Vercel, GitHub Pages or Netlify. HTTPS is required.