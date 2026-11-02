SLDP 45 - BATCH 001 RELEASE (Rev A, 2026-10-30)
Files renamed to the hyphen convention on 2026-11-02; contents unchanged.

DRAWINGS (drawings/)
  SLDP-GA-001  Rocket general assembly (2 sh)  -> top level, points to the three below
  SLDP-ST-005  Rocket body (3 sh)              -> printed body, part details, print partition
  SLDP-TVC-001 TVC mount assembly (2 sh)       -> K-9 gimbal + motor tube, range of motion
  SLDP-AV-001  Avionic sled v1 (1 sh)          -> holds breadboard / Nano / MPU-6050

PRINT LIST (print/, PLA, 0.6 nozzle, 225-230 C, fan ~40%, no supports unless noted)
  0. FIRST: SLDP-ST-005_test-coupler-C1 x1 + SLDP-ST-005_test-tube-stub x2  -> check slip fit + bend test
  1. SLDP-ST-005_A-lower-body              x1  (200 tall, brim)
  2. SLDP-ST-005_B-avionics-bay            x1  (154 tall, brim)
  3. SLDP-ST-005_C1-coupler                x1
  4. SLDP-ST-005_C2-interstage-coupler     x1
  5. SLDP-ST-005_D-upper-body              x1  (140 tall, brim)
  6. SLDP-ST-005_E-nose-cone               x1  (tip up)
  7. SLDP-ST-005_F-fin-x4                  x4 (+1 spare), flat
  8. SLDP-AV-001_avionic-sled              x1  (tree support under top ring only)
  9. SLDP-TVC-001_k9-outer-gimbal-v7, _k9-inner-gimbal-v7, _motor-tube-v8  x1 each (follow the K-9 print notes)
  Filament: ~520 g printed parts -> one 1 kg spool covers it with room for reprints (NYU printing, free).

STEP (cad/): one per body part and the sled, for other CAD tools.

HARDWARE (all on hand)
  M3 x 6 button head  x2   (TVC mount -> body)
  M3 x 8 button head  x4   (sled -> body)
  M3 x 12 button head x4 + M3 nylon-insert lock nuts x4   (gimbal pivots)
  1.2 mm Z-pushrods + linkage stoppers (kit), CA glue + 5-min epoxy, hot glue, zip ties, electrical tape
  Half-size breadboard + jumper wires, Nano USB cable

SOURCE
  Regenerate from cad/ in the repo (pip install cadquery trimesh shapely rtree scipy matplotlib numpy):
    1. cad/ST-005_rocket-body/SLDP-ST-005_rocket-body.py      (model: body STL + STEP)
    2. cad/AV-001_avionic-sled/SLDP-AV-001_avionic-sled.py    (model: sled STL + STEP)
    3. any *_drawing.py                                        (drawings: PDF + PNG)
  Outputs land beside each script; copy them here for a new batch.
