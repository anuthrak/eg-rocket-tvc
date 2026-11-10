# CT-1 · Laser gimbal-accuracy test

Checks that the gimbal goes where the flight code tells it to. A laser on the motor tube marks each
commanded angle on a wall, and the marks are compared with the commands. This covers the servo/linkage
calibration test (CT-1 in `docs/PROJECT_SUMMARY.md` §11). **No motor/EDF connected. Only the gimbal moves.**

There are two ways to run it. Both give the same 18 points, the same pass criteria and the same CSV.

| Way | Needs |
|---|---|
| **Website (recommended):** Bench → Gimbal → **Laser** | Flight firmware v1.8.0+ on the Nano, Chrome or Edge |
| Backup: `ct1_laser_gimbal.ino` + `laser_log.py` here | Upload the test sketch, Python (+ pyserial for `--port`), then re-upload the flight firmware |

## Pass criteria (per axis)
- Accuracy: max |measured − commanded| ≤ **1.0°** over all 18 points.
- Backlash: max |up − down| at the same command ≤ **1.0°**.

## What you need
- A laser pointer and tape, a flat wall, a tape measure, a pencil or sticky notes.
- The rocket held still on the rig or bench, **pivot 1000 mm from the wall** (another distance works: enter it).
- The calibration done and **saved** first (Bench → Gimbal → Calibrate → Save). The test measures what is saved on the Nano.

## Run it from the website
1. **Connect:** open the visualizer in Chrome/Edge, **Connect Arduino**, then Bench → Gimbal → **Laser**.
2. **Setup tab:**
   - Tape the laser along the motor tube and aim it at the wall.
   - Measure from the gimbal pivot to the wall and type it in.
   - Press **Centre** and mark the dot: that is the **zero mark**.
   - Press **+X 8°** and mark which side the dot goes: that side is **+** for X. Do the same with **+Y 8°**.
   - If the panel warns that the calibration is unsaved or default, save it in Calibrate first.
3. **Measure tab:** pick **X axis** and press **Start X**. The gimbal steps −8° → +8° (up), then back down to −8°.
   At each point it waits until the gimbal settles, then shows **MARK THE DOT · X −4°**:
   - Mark the dot on the wall.
   - Measure its distance from the zero mark along that axis, with a sign: **+** on the + side, **−** on the other.
   - Type the mm and press **Enter**. The angle and error appear as you type. Enter records the point and moves to the next one.
   - Typed a wrong number? Press **Redo last point** and enter the mark you already made again.
   - The bars at the top fill green (within 1°) or red as you go.
   - **Stop** centres the gimbal and throws away that run. A finished earlier result for that axis is kept.
4. Pick **Y axis**, press **Start Y**, and do the same.
5. **Results tab:** PASS/FAIL per axis, max error, backlash, and all 18 points.
   - **Download CSV** saves `t2_gimbal_<date>_<time>.csv` (`axis,cmd_deg,meas_deg,dir`).
   - **Copy summary** copies the run-sheet text (firmware, calibration, results) with the CSV.
   - Runs are also kept in this browser under **Past runs**, so a page refresh doesn't lose them.
6. Close the panel. The Nano goes back to flight mode. There's nothing to re-upload.

Note: −8 can only be reached from above, because travel stops at ±8. So both −8 points, and both +8 points
(with no move between them), mostly show repeatability, not backlash. The ±2…±6 and 0 points show the backlash.

## Run it with the sketch (backup, e.g. without Chrome)
1. Calibrate and Save with the flight firmware, then upload `ct1_laser_gimbal.ino` and close the Serial Monitor.
2. Put the pivot 1000 mm from the wall. Send `zero` and mark the dot; `x 8` / `y 8` shows the + side.
3. `pip install pyserial`, then `python laser_log.py --port COM5` (your port). Choose axis x, then y.
4. At each prompt, type the signed mm (`r` = redo the last entry, `q` = quit). It shows PASS/FAIL per axis at the end.
5. Keep `t2_gimbal.csv` with the run sheet, then **re-upload `firmware/nano_tvc/nano_tvc.ino`** (the calibration is still in EEPROM).

Without pyserial: run `python laser_log.py` and type `step x`, `n`, … into the Serial Monitor yourself.
Sketch commands: `x <deg>`, `y <deg>`, `zero`, `step x|y` (`n` next, `q` abort), `circle [deg] [s]` (video), `help`.

## If it fails
- The same error at every point, growing with angle: the linkage ratio (SPG) is off. Use the measured slope to
  correct it in Calibrate → Save, then run the test again.
- An offset at 0: re-centre the servo (Calibrate → Centre).
- Up and down differ: there is slop in the pushrods, linkage stoppers or pivots. Snug the pivots (⅛ turn back off)
  and check that the Z-bends sit tight in the horn.
- The laser sits off the pivot axis, which adds a small error (< 0.1° for a few cm offset at 1 m). This is fine.
