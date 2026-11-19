# SLDP 45 — Handoff note (as of 2026-11-07)

Paste this at the start of a new chat and attach `SLDP45_current_package.zip`.

## Project
NYU EG1004 semester design project, team SLDP 45 (4 people). I'm the idea lead and avionics lead.
- **What it is:** a 3D-printed rocket (~632 mm) with a 30 mm EDF in a 2-axis gimballed TVC mount. Arduino Nano + MPU-6050 drive 2× MG90S servos through pushrods to keep it upright.
- **Why a rig:** it can't fly (220 g of thrust vs ~585 g of mass), so it runs on a **desk rig** that pivots it at its CG.
- **Visualizer:** a web app (Web Serial + Three.js on Vercel) with Bench, Calibration and Mission-sim tabs.
- **Styling:** ship-on-booster (Starship / Super Heavy inspired). Display stand = orbital-launch-mount-style stand.

## Current drawings (ASME Y14 style, ANSI B, single mm coordinate system)
House standard: `SLDP_Drawing_Prompt.md`. File naming: `SLDP-[AREA]-[NUM]_details`.

| Drawing | Rev | Sheets | Content |
|---|---|---|---|
| **SLDP-GA-000** Drawing package cover | A | 1 | US Letter portrait (ANSI A) in house style: technical illustration of the rocket on the launch mount (flat finish colours + hidden-line outlines) with design callouts |
| **SLDP-GA-004** Rocket general assembly | C | 4 | 1: assembled exterior (1:2, overall dims, CG) + view C from the tail (span, clocking) + parts list + general notes; 2: section A-A + detail B; 3: exploded + interface table; 4: test configuration on the desk rig (1:3) + mass properties + balancing |
| **SLDP-ST-008** Rocket body | B | 6 | 1: assembly views; 2: nose / C1 / strake details + assembly sequence; 3: part A notch + window; 4: part B door + door; 5: styling (C2 pockets, flaps, grid fin, clocking); 6: exploded print partition + parts list |
| **SLDP-TVC-002** TVC mount GA | A | 3 | 1: views with servos; 2: exploded + range-of-motion sections; 3: servo sweep clearance study |
| **SLDP-AV-001** Avionic sled V1 | A | 1 | sled holds a half-size breadboard vertically, IMU at the bottom |
| **SLDP-GS-003** Launch mount | B | 2 | 3-part display stand: ring with 10 clamps, 6 columns, octagon base, flame deflector; black wrap-around QD clip (sheet 2) |
| SLDP-GS-001 Desk rig | — | concept | sketches only (teammate designing) |
| SLDP-EL-001 Wiring | — | — | not started |

Superseded (do not use): ST-005/006/007, GA-001/002/003, TVC-001, GS-002.

## Key numbers
Z is measured from the tail. Angles are from +X (the gimbal axis X), CCW viewed from the nose.

**Body**
- OD 78.6, bore 76.2, wall 1.2.
- Parts: A 200 (z 0–200), C1 band 3, B 154 (203–357), C2 band 18 (357–375), D 140 (375–515), nose band 15 + tangent ogive 102.2. Overall 632.2.
- Couplers: 2.4 wall × 25 engagement. C1 is bonded into A; C2 is bonded into D.
- Joint screws (removable joints): Ø3.2 holes at 90°/270°, 12 from both ends of B and from the top of D. Pilot-drill the coupler Ø2.5 on assembly and fit M3×6.

**Part A**
- Strakes: 4× at 55° + 90° × 3, 3.5 wide × 1.5 proud, z 40–170, 45° ends. They replaced the old glued-on fins.
- TVC mount: gimbal point at z 37, 2× M3 at 0°/180°. Motor tube and EDF exit 20 below the tail.
- Tail notch: open from the tail, 52 wide × 32 tall, R6, centred at 280°. The riding servo swings through it (out to R48).
- Fixed-servo window: 38 × 34 at 184°, z 50–84.
- Intake vents: 4× 12×32 at z 136.

**Part B**
- Sled at z 229–329, held by 4× M3×8 at 0°/180° (z 232, 326).
- Door at 90°: opening 46×75, z 246–321, R6, with a raised frame. Two tabs hook behind the wall; 1× M3×6 at z 326 goes into the sled top ring. The 16×7 cable notch at the bottom of the door is where the tether exits.
- Grid fins: 4× at 45° + 90° × 3, z 340–348, glued on (separate prints).

**Hot-staging ring:** C2 band with 20 pockets, 4 × 12 × 2 mm deep, painted black.

**Ship**
- D has 2× aft flaps at 0°/180° (root 70, tip 42, span 22, 2 thick).
- The nose has 2× forward flaps and an Ø8 ballast column with an Ø2.5 × 20 pilot hole (M3 bolt + washers to trim the CG).

**Colours:** booster A, B, C1, C2 **and the avionics bay door** stainless-look silver (C2 pockets painted matte black). Ship D, nose and grid fins black. Launch mount ring + base grey, its QD clip black. (GA-004 Rev C note 6, ST-008 Rev B note 4 and the GA-000 cover all match.)

**Mass (estimate)**
- ~585 g, CG ~247, lever arm (CG − gimbal) 210 mm, I_cg 0.0177 kg·m².
- About 204 °/s² of authority at 8° and 220 g of thrust.
- These need weighing and updating.

**Desk rig interface (GS-001)**
- Pivot at the measured CG with pins at 0°/180°; 2-axis, roll locked.
- Rocket axis ≥210 from the desk edge, pivot 40 above the desk, ±30° stops.
- A full collar must stay below z 238 to clear the door frame.

**Launch mount (GS-003)**
- Seat 110 above the desk.
- Clamps run from 332° through 0° to 228°, with no clamps under the tail notch.
- Ring part is 150×150×28 and base part is 185×185×94, both printed upright with no supports.
- **QD clip (item 3, Rev B):** separate black part wrapping 40° of the ring rim at 90° (70°–110°): cap over the ring top, shroud down the OD, hook under the ring, tower + hood leaning toward the rocket (top 36 above the ring top, 25° slope). 0.2 clearance on the rim (bore R75.2, gap 28.4). Slides on radially from outside and is held by 1× M3×8 self-tapping (GS-003 item 4) radially through a Ø3.2 hole in the shroud into a Ø2.5 × 8 pilot in the ring OD, centred on the rim height at 90°. No glue. Prints lying on an end face, no supports (max overhang 40°). ~35 g. 13.9 clear of the rocket, 0.8 clear of the 90° column.

## Hardware and electronics
- **EDF:** QX 30 mm 6-blade QF1611 7000KV, ~35 g, about 45 long (from the listing). It sits low in the motor tube (bore Ø32).
- **ESC:** 20 A, **off-board on the desk**, running from a 12 V 10 A supply. Cap the throttle at ~85% in firmware. Run 3 twisted phase wires up inside the body and out the door notch.
- **Servos:** 5 V from the ESC's BEC; add a 470–1000 µF capacitor on the servo rail.
- **IMU:** MPU-6050 mounted flat on foam.
- **Linkage:** about 4 servo° per gimbal° (gimbal arms ~42 mm). Linkage stoppers go in the gimbal holes, with a Z-bend at the servo horn. Firmware limit ±8°; the body clears ±10°.
- **Control:**
  - Loop at 100–200 Hz; complementary filter, TAU ≈ 0.25 s; D-term taken from the gyro.
  - Starting gains Kp 2.5, Kd 0.55, Ki 0.3 (clamped); scale them with thrust.
  - On the rig the CG pivot gives a double integrator. A few mm nose-heavy turns it into an inverted pendulum for the demo.

## Open items
1. Weigh every printed part and component, then update COMPONENTS in the ST-008 model (the GA-004 sheet 4 mass table follows on re-render).
2. Measure the EDF: duct OD, total length and where it sits in the tube. Update the TVC-002 and GA-004 EDF envelope if it differs.
3. Desk rig GS-001 detailed drawing, built to the interface above.
4. Wiring diagram EL-001.
5. Print: A (strakes), C2, D, nose, 4 grid fins, GS-003 ring + base (grey) + QD clip (black). Also reprint B, C1 and the door in the right colours if needed.
6. Buy: M3 screws (6/8/12, incl. 1× M3×8 self-tapping for the GS-003 QD clip) + nylon lock nuts, kill switch, servo capacitor, filament.
7. Put the real course due dates on the schedule.

## Package contents
- `SLDP-GA-000_cover/source`: `SLDP-GA-000_cover.py` + `render.py` (`illustrate()`: flat colours + hidden-line outlines, used on the cover; `render()`: lit shaded render, kept as an option). To re-run, put next to them `body_model.py`, `servos.py`, `asm.py`, `inner/outer/tube.stl` (GA-004 / TVC-002 source), the ST-008 part STLs in assembly position (run the ST-008 model) and `gs003_ring/base/qd.stl` (run the GS-003 model). Camera: az 50°, el 16°.
- Each drawing folder has the PDF, STEP files, print-ready STLs where relevant, and `source/`.
- The drawings are generated by Python scripts (CadQuery + trimesh + matplotlib, with `hlr.py` for hidden-line removal and `sldp_sheet.py` for the frame and title block). `hlr.py` v2 (2026-11-07) is ~12× faster with identical output when `numba` is installed (`pip install numba`); without it, it falls back to plain NumPy. Full renders now take ~5 s (GS-003) and ~15 s (GA-004, mostly the CadQuery body build). To change a dimension, edit the parameter at the top of the model `.py` file and re-run the model, then the drawing script.
