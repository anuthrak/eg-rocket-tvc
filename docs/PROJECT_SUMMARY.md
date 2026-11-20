# SLDP 45 — EDF Thrust-Vector-Control Rocket on a Desk Rig
Project summary as of 2026-11-02 (EG1004 Semester-Long Design Project, team of 4)

## 1. What the project is
A ~632 mm 3D-printed rocket with an electric ducted fan (EDF) in a 2-axis gimballed motor tube (thrust vector
control, TVC). An Arduino Nano reads an MPU-6050 IMU and drives two MG90S servos through pushrods to keep the
rocket upright. The rocket cannot fly (220 g max thrust vs ~600 g). It is held on a desk rig at its centre of
mass, so the TVC loop can be tested and tuned safely, continuously and repeatably. A web visualizer (Web Serial +
Three.js, hosted on Vercel) shows the rocket live (Bench tab, calibration tools) and runs a SpaceX-style
Earth-to-Moon Mission sim / hardware-in-the-loop.

**Pitch:** "A safe, reusable, low-cost desk rig to test and tune rocket thrust vector control — the same
closed-loop control used on real launch vehicles — with real-time visualization, for under $100."

## 2. Team roles
| Role | Scope |
|---|---|
| Avionics / integration | firmware (IMU, filter, PID, servos), safety logic, web visualizer + HIL, interface table, drawing control |
| Propulsion | QX 30 mm EDF + 20 A ESC, 12 V supply, wiring diagram (SLDP-EL-001), kill switch, thrust tests, safety checklist |
| Structures | print + fit + assemble body, sled, TVC; pushrods; weigh parts; balance; EDF retainer |
| Systems | desk rig SLDP-GS-001 (design + build), base layout, stretch: catch tower |

Changes since the PDI / Milestone 1 (Oct 26–28): A2212 + propeller → 30 mm EDF; SLA / NiMH / 4×AA → 12 V supply
+ ESC BEC (5 V) for the servos; Nano moved from the static base onto the avionic sled in the rocket; "rocket under
250 g" → ~600 g with the CG on the rig pivot (it never has to fly).

## 3. Hardware and budget
- Arduino Nano, MPU-6050, 2× MG90S, QX-Motor 30 mm 6-blade EDF (QF1611 7000 KV: ~220 g @ 11.1 V, 11.2 A),
  Surpass 20 A ESC (XT60, 5.5 V/4 A BEC), 12 V 10 A supply + barrel-to-XT60 adapter, 20 A inline fuse holder /
  kill switch. See [bom.md](bom.md).
- **Spend: $93.39 of $100.** Shopping cart $83.41 (supply, adapter, ESC, fuse holder, EDF) + pushrod and
  linkage-stopper kit $9.98. 3D printing is free (NYU), so filament doesn't count.
- Already on hand (no purchase): M3 screws (6, 8, 12 mm) + nylon lock nuts, half-size breadboard + jumpers,
  CA / epoxy / hot glue, Nano USB cable.
- Delivery: the cart (EDF, ESC, supply, adapter, fuse holder) has arrived; first motor spin-up Nov 16 (see §11).
- Power caution: EDF full throttle ≈ 11+ A > 10 A supply → cap throttle at 85 % in firmware.

## 4. Drawings (ASME Y14 style, ANSI B, house standard in [drawing-standard.md](drawing-standard.md))
Released as batch 001 (Rev A, 2026-10-30) in `releases/batch-001_2026-10-30/`; sources in `cad/`.

| Drawing | Content |
|---|---|
| **SLDP-GA-001 Rocket General Assembly** (2 sh) | Section A-A of the whole rocket with TVC, sled, EDF and electronics; detail B tail at ±8°; parts list; exploded view along the assembly path; interface table |
| **SLDP-ST-005 Rocket Body** (3 sh) | Exterior + section, coupler detail C (2:1), vent section, tail view; part details (nose, couplers, fin) + assembly sequence; exploded print partition, build-volume check, parts list |
| **SLDP-TVC-001 TVC Mount GA** (2 sh) | K-9 Gimbal V7 + Motor Tube V8 assembled (3 views + iso, parts list incl. pivots, lock nuts, pushrods, linkage stoppers); exploded view; sections A-A/B-B range of motion with EDF in section |
| **SLDP-AV-001 Avionic Sled V1** (1 sh) | Fully dimensioned + GD&T; holds a half-size breadboard vertically, IMU at the bottom |
| SLDP-GS-001 desk rig | Not started. Systems will supply the sketches. |
| SLDP-EL-001 wiring | Not started (Propulsion). |

File naming: `SLDP-[AREA]-[NUM]_details` with hyphens; areas GA, ST, TVC, AV, GS (rig), EL (wiring).
Known drawing note: TVC-001 lists Ø1 music-wire pushrods; the team uses the 1.2 mm Z-pushrod kit (no redraw needed).

## 5. Key design numbers
- **Body:** OD 78.6 / bore 76.2, wall 1.2 mm; parts A 200, B 154, D 140 mm, nose 142 mm incl. shoulder; overall
  632 mm; every part ≤ 200 mm (Bambu 254 mm limit).
- **Couplers:** separate sleeves, **2.4 mm wall × 25 mm engagement**, 0.15 mm radial slip (v2's 0.8 mm printed
  shoulder snapped along a layer line). Print the joint test piece first.
- **TVC:** gimbal point 57 mm above the tail (motor tube flush with tail), mounted by 2× M3×6 on gimbal axis X;
  design travel ±8° (axis X clears ~+10/−15°, axis Y ±15° thanks to the clearance window in part A).
- **Clearance window** (30×12 obround at 270°, 19 mm from tail): the inner-gimbal servo bracket swings to R38.6
  at ±8°, beyond the 38.1 bore.
- **Intake vents:** 4× 12×32 obround at 136 mm (fan needs air from above).
- **Sled:** 100 mm tall, Ø75.8, in a 104 mm clear bay at 229–329 mm, 4× M3×8; inserted into part B from below.
  The MPU-6050 sits at the bottom of the vertical breadboard, as drawn on SLDP-AV-001.
- **Mass / CG:** ~598 g total (estimate), CG ~240 mm from tail, IMU ~249 mm; lever arm 183 mm;
  I_cg ≈ 0.017 kg·m²; ~185 °/s² authority at 8° and 220 g.
- **Fins** clocked at 45/135/225/315° so holes, vents and window sit between them.

## 6. Axes (one convention everywhere)
- Rocket body frame, as in the drawings: z = rocket axis (up), **+X = toward the 2× M3 TVC mount screws (body 0°)**,
  +Y = 90° from that.
- Drawings name the **pivot** axes: axis X = motor tube pin (TVC-001 item 3), axis Y = inner gimbal pin (item 2).
- Firmware and visualizer name the **servos by the direction they tilt the nozzle**: the X servo (D9) tilts it
  toward ±X and corrects a lean toward ±X, so it drives the inner gimbal (pivot axis Y). The Y servo (D10) drives
  the motor tube (pivot axis X). Calibration can swap the pins if they're wired the other way round.
- The IMU's own axes don't need to line up with anything: firmware v1.3.0 maps them to the rocket frame
  (Level finds which sensor axis is up; the sensor step turns X/Y to match).

## 7. TVC assembly lessons
- Pivots: M3×12 + nylon lock nuts as axles; drill outer-gimbal axis-Y holes to Ø3.2; snug then back off ⅛ turn.
  The printed pivot holes (Ø3.4 inner gimbal, Ø3.5 motor tube) are accepted as is.
- Pushrods: 1.2 mm Z-pushrod + linkage-stopper kit (from the BPS.space Signal R2 approach the K-9 is based on).
  **Linkage stopper in the gimbal hole** (inner-gimbal tower Ø2.5, motor-tube lug ~Ø1.5 → drill to stopper
  shank ~2 mm), free to rotate; straight rod end through the stopper; Z-bend in the servo horn. Zig-zag bends
  only where a rod must jog around brackets.
- **Linkage ratio:** gimbal lever arms ≈ 42.4 mm (axis X, tube lug) and 41.4 mm (axis Y, tower). Set per servo
  from firmware v1.11.0: CT-1 (Nov 16, SPG 5.5 both) measured X at 0.78× commanded → **X ≈ 7.1**, Y ≈ 5.5. X centre
  is 112 (horn ~25° off square; can't be moved), so X is ~10 % weaker on the minus side, and at 7.1 the ±45° servo
  limit caps X at ≈ ±6.3° of gimbal.
  Ratio ≈ r_horn / 42 → ~0.25 gimbal°/servo° (≈ 4 servo° per gimbal°) for a 10 mm horn hole. A 2.5 servo/gimbal
  setting gave only about half the travel. Firmware default is 4.0; measure it with the laser helper in
  Calibrate → Save (8° ≈ 14 cm at 1 m) and store it.
- ±8° looks small (tube end moves ~8 mm) — that is normal.

## 8. Firmware and control
Current firmware **v1.6.0** (`firmware/nano_tvc`):
- 100 Hz loop, complementary filter (α 0.98), MPU DLPF 44 Hz, gyro ±500 °/s, D-term from the gyro rate.
- PID per axis with the starting gains below, gimbal clamped to ±8° and slew-limited, servo pulses via
  `writeMicroseconds` (fractional degrees), linkage ratio and trims from EEPROM.
- Tilt abort > 25°: gimbal centres immediately, re-arms after 1 s back within 5° (or `RUN`).
- Free-test (`FREE ON|OFF`) for tilting by hand: no abort, half gains, same ±8° limit; off at every restart, never saved.
- IMU mounting remap (any orientation), set by calibration.
- Throttle test (v1.9.0): ESC on D3, motor runs only in calibration mode after `ARM`, 85 % cap, 50 %/s ramp-up, cut on
  lost link (0.5 s), tilt > 25° or mode change. Driven by the visualizer's Bench → Throttle panel (CT-4).
- Not yet: throttle in flight mode with the thrust-scaled gains, binary telemetry.

Engineering notes:
- Rig pivot at the CG means **gravity gives no tipping torque** — the plant is a double integrator (neutral), not
  an inverted pendulum. TVC fights pushes, imbalance, misalignment and cable tug. A few mm of nose weight makes it
  a true inverted pendulum (max ~3–4 mm CG offset at full thrust) — good demo.
- The bottleneck is the servos (50 Hz frames, ~30–40 ms total lag) → design for **~1–2 Hz** closed-loop
  bandwidth; 100 Hz control is plenty for that.
- Vibration: balance the fan; foam-mount the MPU; complementary α ≈ 0.98.
- Coupling: fan gyroscopics ~3 % of control torque; the real coupling is IMU clocking, handled by the remap.
- Deadband ≈ 0.3–0.5° at the gimbal after the ~4:1 linkage; no software error deadband; small clamped integrator.
- Starting gains (b ≈ 16 rad/s² per rad at ~150 g thrust, 1 Hz, ζ 0.7): **Kp ≈ 2.5 °/°, Kd ≈ 0.55 °/(°/s),
  Ki ≈ 0.3 /s** clamped; **scaled by thrust** (×150 g / current thrust). Untuned: tune on the rig.

## 9. Desk rig (SLDP-GS-001)
Owned by Systems, who will supply the design sketches; the earlier rough concept is not the design. Requirements
from the rest of the system: 2-axis pivot at the CG (~240 mm from the tail, on part B, roll locked), clear of the
sled screw heads at 232 mm and 326 mm, rocket axis clear of the desk, exhaust to the floor, mechanical stops
(±30° suggested, beyond the 25° firmware abort), tether (USB + 12 V) routed through or near the pivot.
Stretch: a catch tower on the same base.

## 10. Schedule
| Due | Date | Goal |
|---|---|---|
| Week of Nov 2 | Nov 2–8 | joint test + body/sled printing, rig design from Systems, wiring diagram, IMU calibration |
| **Benchmark B** | **Nov 13** | rocket + wiring assembled, EDF thrust test, rig built and balanced |
| Weeks of Nov 16–29 | | first closed loop, tuning, disturbance + abort tests (Thanksgiving = buffer) |
| **Commissioning** | **Dec 4** | verification against the requirements, endurance run, demo video |
| **Final submission** | **Dec 11** | report, final presentation, demo |

Critical path: the desk rig (no design yet) and the EDF/ESC delivery.

## 11. Test plan
Requirements: hold ±2° RMS for 30 s; recover from 10° in < 2 s with < 30 % overshoot; < 1° steady-state error
under offset load; abort < 100 ms; 100 Hz control loop; 5-min run with servos < 60 °C and no brownout.
Tests: CT-1…5 (servo/linkage cal, IMU at rest, loop timing, EDF thrust vs throttle, kill switch); IT-1…5 (fit,
balance/CG, swing for I + friction, motor-on noise, open-loop gimbal step → b); ST-1…7 (hold, tap recovery,
offset weight, throttle sweep, aborts, endurance, catch tower).
CT-1 laser gimbal accuracy: `tests/ct1_laser_gimbal/` (18-point step test per axis; pass = error ≤ 1.0°,
backlash ≤ 1.0°).
CT-4 first spin-up (Nov 16, firmware v1.10.0, Bench → Throttle, EDF clamped, ≤ 25 %): ESC arms normally (3 beeps,
tune, silence); D3 → ESC → motor works; fan starts at **15 %** (1150 µs), so the ESC range calibration is still to
do. Spun backwards at first: swapped 2 of the 3 motor wires, now blows out the tail (label the joints).
Bench wiring (battery pack retired): 12 V → ESC (XT60); ESC BEC 5.5 V (thin red) → + rail → both servos;
Nano on USB (power + visualizer link); MPU VCC on the Nano 5V pin only; one common ground rail (ESC, servos,
Nano, MPU); D3 ESC, D9 X servo, D10 Y servo. The servos only have power with the 12 V on, even with the motor off.
Never put the Nano 5V pin or VIN on the + rail: 5V clashes with USB (the ESC beeped continuously), and VIN needs
7–12 V (at 5.5 V the Nano browns out and resets). Running without USB = 12 V to VIN from the thick supply wire,
added with the kill-switch rewire. ESC and motor bullets don't match (joined by hand for now).
Power-up: Nano on USB → connect the visualizer → 12 V on (ESC tune, then silence) → test. Power-down: stop the
motor → 12 V off → disconnect → unplug USB. Next: watch for servo jitter with the motor at 15–20 %; if so, add
470–1000 µF across the rails.
Record every run: CSV log (t, dt, mode, throttle, raw gyro/accel, filtered angles, setpoints, errors, P/I/D terms,
gimbal commands in ° and µs, abort flag), a run sheet (test ID, firmware version, gains, filters, throttle,
rig config, pass/fail, notes) and synced video (tap/LED marker).

## 12. Future work
Rig-tested TVC → hover ("mini Grasshopper": thrust/weight ≥ 1.5, ~64 mm EDF on LiPo, roll control via
counter-rotating fans or vanes, height + drift sensing, tether) → targeted translation and precision landing →
higher outdoor hops (FAA recreational rules, TRUST, registration > 250 g) → propulsive landing from flight →
tower catch with the chopstick tower → full reusable mini mission.

## 13. Open items
- Kill switch / fuse holder has female XT60 on both ends and doesn't fit the adapter's female XT60: cut one end of
  each and join the wires (or get a male XT60), check polarity with a meter, then CT-5. Until then, runs ≤ 25 %
  only, with the 12 V plug as the stop.
- Visualizer Tests tab (Nov 17): all bench tests on one page with live charts. **CT-5 thrust vector** (Nov 19, firmware v1.13.0 `ARM REST`) is a breakaway test. The rocket starts resting on a rig stop, the gimbal points against the lean and the throttle ramps until the IMU sees it come off the stop. It gives the thrust and torque needed to move it, and the equivalent CG offset. It replaces the kick test, which needed a balanced, upright rocket.
- CT-4 (Nov 20): ESC range calibrated (Throttle → Safety). The fan now starts at ~6–7 % and stops at ~5–6 % (was
  15 %). Next: the full step test 10 → 85 % on a scale with hearing protection (no scale yet; the spec curve is
  ~15–20 % high at 40 %).
- Rig balance (Nov 20): at the original pivot the bare rocket swings back in ~1.6 s (CG ~40 mm below the pivot,
  from 107 / T² mm with I ≈ 0.017 kg·m²). With the pivot on part A it falls away with the nose cone on and swings
  back without it, so the balance point of the complete rocket is between part A and the original position: the
  real CG is lower than the ~240 mm estimate. The ESC pulls it sideways (needs a small weight at pivot height on
  the opposite side). Cables were ruled out as the spring. GS-001: an adjustable collar, or a pivot position
  between part A and part B, so the complete rocket is neutral with no added weight.
- Visualizer Authority test (IT-5, Nov 20): gimbal step from upright on the pivot, with the IT-3 swing fit
  removing gravity and friction. First real runs were invalid (gravity 40–75 °/s² at 5° against ~30 °/s² from
  the TVC at 40 %); rerun once the rocket is near neutral.
- EDF + ESC arrived: measure the duct OD (≤ 31.6 mm fits the Ø32 bore), real EDF dimensions, ESC location
  (assumed ~172 mm in part A) and design the EDF retainer.
- Weigh every part and update COMPONENTS in the body model (real CG, mass).
- Rig collar position vs the sled screws at 232 mm (CG ~240 mm).
- Check the 2× M3×6 TVC mount screws grip in the outer gimbal's Ø3 holes.
- Desk rig GS-001 (Systems) and wiring diagram EL-001 (Propulsion).
- Firmware: throttle in flight mode (gains scaled by the real thrust). The wiring diagram EL-001 should show the ESC signal on D3.
