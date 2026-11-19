# SLDP-GS-001 Desk rig (Rev B)

2-axis gimbal that holds the rocket at its CG on the edge of a desk, so the TVC can be tested with the EDF running.
The rocket can tilt ±30° in any direction (hard stops) but cannot roll.

## Files

| File | What it is |
|---|---|
| `SLDP-GS-001_desk_rig.pdf` | Drawing, 3 sheets: 1 elevation + notes + parts list, 2 top view + pivot sections + stop detail, 3 collar half + pivot tab + pivot setup |
| `SLDP-GS-001_desk_rig_assembly.step` | All 8 printed parts in place, one file. Coordinates match the rocket files: Z up, 0 at the rocket tail, pivot at Z 247. Open it in Fusion with File → Open (or Insert into your rocket design) |
| `SLDP-GS-001_desk_rig_with_rocket.step` | Fully assembled: the rig, the rocket (body parts, door, 4 grid fins, avionics sled) and the rig screws (pivot axles, nuts, collar and tab screws), as named sub-assemblies. Same coordinates. The TVC mount is not included (it only exists as a mesh) |
| `SLDP-GS-001_<item>.step` | Each part on its own, for editing in Fusion |
| `SLDP-GS-001_<item>_print.stl` | Each part already laid flat for printing. Load straight into the slicer |
| `source/` | Python that generates the model and the drawing (CadQuery) |

## Print list and order (PLA, no supports, 3 walls, 15-20% infill, 0.20 mm, ~220 g total)

Print in this order: the first prints let you test-fit on the rocket and check the CG before the big parts.
Times are rough Bambu (P1S/X1C) estimates, so check the slicer; if one goes over 2 h, use the 0.28 mm draft profile.

| Session | Part(s) | Print file | ~Mass | ~Time |
|---|---|---|---|---|
| 1 | 2 collar halves + 2 pivot tabs, one plate (items 1, 2) | `1-collar-half_x2_print.stl` ×2, `2-pivot-tab_x2_print.stl` ×2 | 28 g | 50-60 min |
| 2 | Middle ring (item 3) | `3-middle-ring_print.stl` | 29 g | 50-60 min |
| 3 | Outer ring + arm stub (item 4) | `4-outer-ring_print.stl` | 49 g | 1.3-1.7 h |
| 4 | Arm (item 5) | `5-arm_print.stl` | 59 g | 1.4-1.9 h |
| 5 | Base (item 6) | `6-base_print.stl` | 51 g | 1.2-1.6 h |

## Hardware (all M3, plus 2 C-clamps)

| Item | Part | Qty | Where |
|---|---|---|---|
| 7 | M3 × 25 screw | 4 | pivot axles (2 inner, 2 outer) |
| 8 | M3 washer | 8 | one in each 1 mm pivot gap (+ spares) |
| 9 | M3 nylon lock nut | 4 | on the pivot axles |
| 10 | M3 × 10 screw (M3 × 8 also works and sticks into the bay less) | 2 | collar to rocket, through the B lower joint holes, replacing the 2 stock M3 × 6 |
| 11 | M3 × 8 screw + nut | 4 | pivot tab to collar |
| 12 | M3 × 16 screw + nut | 4 | arm flange to outer ring stub (Rev B: was M3 × 12, too short to fully engage the nut) |
| 13 | M3 × 40 screw + nut | 2 | arm to base (Rev B: base nut traps raised 5 mm so the M3 × 40 reaches through the nut) |
| – | C-clamp, 50 mm+ opening | 2 | base to desk |

Totals: screws 4× M3×25, 2× M3×10, 4× M3×8, 4× M3×16, 2× M3×40; nuts 10 plain + 4 nylon lock; 8 washers.

## Assembly (outside in)

1. Bolt the **arm (5)** onto the **base (6)** with the 2 M3 × 40 (nuts go in the side nut traps).
2. Bolt the **outer ring stub (4)** to the arm flange with the 4 M3 × 12.
3. Clamp the base to the desk with 2 C-clamps on the side ledges. The arm sticks out about 220 mm past the edge.
4. Close the **2 collar halves (1)** around the avionics bay, 205-225 mm up from the tail, screwing through the
   B lower joint holes (90°/270°) with item 10. Bolt the halves together at the pads.
5. Bolt the **pivot tabs (2)** to the collar pads at 0° and 180° with the M3 × 8. Leave them finger-tight for now.
6. Hang the **middle ring (3)** on the tabs: M3 × 25 through tab + ring, washer in the gap, lock nut.
7. Hang the middle ring in the **outer ring (4)** the same way, at the door side and the opposite side.
8. Pivot nuts: snug, then back off until it swings freely with no wobble.

## Setting the balance (do this with the EDF in, battery in, everything as it will run)

1. Slide the pivot tabs in their slots (±5 mm) until the rocket balances, then tighten them.
2. Fine-trim with nose ballast.
3. Set it **5-10 mm nose-heavy** (pivot slightly below the CG): let go of it with the EDF off and it should tip over
   slowly (about a second). If it swings back to vertical by itself it is tail-heavy: that hides the controller.
   Much more than 10 mm and the gimbal can't hold it.

## Checks before every power-up

- C-clamps tight, nothing loose on the pivots.
- Free swing to ±30° on both axes, no rubbing.
- Floor under the exhaust clear, kill switch in reach.
- The ±30° stops are emergency limits only. Repeated hard hits can snap the printed Ø4 pegs: add a bit of foam tape in
  the slots, or replace the pegs with M3 screws.

## Numbers

- Pivot 247 mm above the tail (the estimated CG), adjustable ±5 mm.
- Clearances checked through ±29° on both axes: rocket to rig ≥ 4.5 mm, rocket to desk ≥ 150 mm.
- Load ~7 N at 230 mm out: arm bending stress ~0.5 MPa (PLA ~20-40 MPa), sag ~0.5 mm.
