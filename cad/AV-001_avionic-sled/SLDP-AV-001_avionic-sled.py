"""
Avionics sled for TVC rocket v4 (EG1004).
Cylindrical sled that slides into the 76.2 mm body tube and holds a HALF-SIZE BREADBOARD vertically
(long side along the rocket axis) for the Arduino Nano + MPU-6050.

Requires:  pip install cadquery
Run:       python3 SLDP-AV-001_avionic-sled.py   -> SLDP-AV-001_avionic-sled.stl / .step + mass
Coordinates: z = rocket axis (0 = bottom face of sled), y = toward the breadboard face, x = across the board.
"""
import os, cadquery as cq

# ---------------- PARAMETERS ----------------
TUBE_ID   = 76.2
CLEAR     = 0.2                      # radial clearance to the tube wall
OD        = TUBE_ID - 2 * CLEAR      # 75.8
RING_W    = 3.0                      # ring radial wall
RING_H    = 6.0                      # ring height
H         = 100.0                    # overall sled height
PLATE_T   = 3.0                      # mounting plate thickness
FACE_Y    = -9.0                     # mounting face position (behind the axis so parts stay centred)
PLATE_HW  = 35.0                     # plate half-width
BB_L, BB_W, BB_T = 83.0, 55.0, 8.5   # half-size breadboard (REF) -- measure yours
LEDGE_D, LEDGE_H, LEDGE_HW = 4.0, 2.0, 28.0
SLOT_W, SLOT_H, SLOT_X, SLOT_Z = 2.0, 4.0, 31.5, (30.0, 70.0)   # zip-tie slots
BOSS_W, BOSS_R0, PILOT_D = 8.0, 31.0, 2.5                       # radial M3 self-tap bosses
PLA = 1.24
# ---------------------------------------------
R, RI = OD / 2, OD / 2 - RING_W

def build():
    ring = lambda z0: cq.Workplane('XY').workplane(offset=z0).circle(R).circle(RI).extrude(RING_H)
    body = ring(0).union(ring(H - RING_H))
    plate = cq.Workplane('XY').box(2 * PLATE_HW, PLATE_T, H, centered=(True, False, False)).translate((0, FACE_Y - PLATE_T, 0))
    body = body.union(plate)
    for z0 in (RING_H, H - RING_H - LEDGE_H):                      # board ledges (bottom + top)
        body = body.union(cq.Workplane('XY').box(2 * LEDGE_HW, LEDGE_D, LEDGE_H, centered=(True, False, False))
                          .translate((0, FACE_Y, z0)))
    for s in (-1, 1):                                               # screw bosses at +/-x in both rings
        for z0 in (0, H - RING_H):
            blk = (cq.Workplane('XY').box(R - BOSS_R0 + 1, BOSS_W, RING_H, centered=(False, True, False))
                   .translate((BOSS_R0, 0, z0)))
            if s < 0: blk = blk.mirror('YZ')
            body = body.union(blk)
    body = body.intersect(cq.Workplane('XY').circle(R).extrude(H))  # trim everything to the OD
    for s in (-1, 1):
        for z in (RING_H / 2, H - RING_H / 2):                      # radial pilot holes
            hole = cq.Workplane('YZ').workplane(offset=BOSS_R0 - 1 if s > 0 else -(R + 1)).center(0, z).circle(PILOT_D / 2).extrude(R - BOSS_R0 + 2)
            body = body.cut(hole)
        for z in SLOT_Z:                                            # zip-tie slots
            body = body.cut(cq.Workplane('XY').box(SLOT_W, PLATE_T + 2, SLOT_H).translate((s * SLOT_X, FACE_Y - PLATE_T / 2, z)))
    return body

if __name__ == '__main__':
    here = os.path.dirname(os.path.abspath(__file__))
    s = build()
    cq.exporters.export(s, os.path.join(here, 'SLDP-AV-001_avionic-sled.stl'), tolerance=0.03, angularTolerance=0.1)
    cq.exporters.export(s, os.path.join(here, 'SLDP-AV-001_avionic-sled.step'))
    v = s.val().Volume() / 1000
    bb = s.val().BoundingBox()
    print(f'Sled {bb.xlen:.1f} x {bb.ylen:.1f} x {bb.zlen:.1f} mm, ~{v * PLA:.1f} g (solid PLA)')
    bb_front = FACE_Y + BB_T
    print(f'Breadboard envelope: x +/-{BB_W/2}, y {FACE_Y} .. {bb_front}, z {RING_H + LEDGE_H} .. {RING_H + LEDGE_H + BB_L}')
