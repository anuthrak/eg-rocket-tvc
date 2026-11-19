# Wokwi simulation of the avionics

A [Wokwi](https://wokwi.com) project for the Nano, MPU-6050 and gimbal servos, wired as on the bench. It runs the real
firmware (`firmware/nano_tvc/nano_tvc.ino`), so you can try the controller and the serial commands without hardware.

| Part | Pin | Bench wiring |
|---|---|---|
| MPU-6050 SDA / SCL | A4 / A5 | I²C, address 0x68 |
| MPU-6050 VCC / GND | Nano 5V / GND | the IMU is the only thing on the Nano's 5V pin |
| X servo signal (blue horn) | D9 | tilts the nozzle toward ±X |
| Y servo signal (orange horn) | D10 | tilts the nozzle toward ±Y |
| ESC signal (grey horn, stand-in) | D3 | Wokwi has no ESC or motor; the horn angle shows the throttle pulse |
| All grounds | GND | one common ground, as on the bench |

**Not in the simulation:** the 12 V supply, the ESC, the EDF and the ESC's 5.5 V BEC. On the real rig the servos' **V+ goes to
the BEC + rail, never to the Nano's 5V or VIN**, so the diagram leaves servo V+ unconnected rather than show that wiring.
(Wokwi doesn't simulate power, so the servos move anyway. If yours don't, wire V+ to 5V *in the simulation only*.)

## Run it

1. Go to [wokwi.com](https://wokwi.com) → **New project** → **Arduino Nano**.
2. Replace `diagram.json` with the one in this folder, and add `libraries.txt` (Library Manager tab → `+`, or paste the file).
3. Replace `sketch.ino` with the contents of `firmware/nano_tvc/nano_tvc.ino`.
4. Press **Start**. The serial monitor shows `TVC firmware v1.12.0`, then the telemetry.

## Things to try

- **Controller:** click the MPU-6050 and drag its tilt sliders. The X and Y servo horns follow the lean (flight mode).
  Past 25° the gimbal centres (`ABORT,TILT`); `FREE ON` turns that off.
- **Calibration mode:** type `CAL` in the serial monitor: servos centre, `CAL,…` lines stream at 50 Hz with the gyro rates.
  `SWEEP CIRCLE`, `GIM 4 0`, `PULSE X` move the gimbal.
- **Motor signal:** in `CAL`, type `ARM`, then `THR 30`: the grey "ESC" horn starts to move (1000 µs = 0 %,
  2000 µs = 100 %), then drops back within half a second with `THR,CUT,LINK`. That's the link watchdog working: the
  visualizer sends a heartbeat every 150 ms, and nobody can type that fast. The same thing cuts the real motor if the page
  stops talking to it.

The visualizer can't connect to Wokwi (Web Serial needs a real USB port), so use Wokwi's serial monitor for commands.
