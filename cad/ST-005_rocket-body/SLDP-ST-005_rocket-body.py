"""
SLDP-ST-005  Rocket body (v5) -- rocket_v4 updated to fit the TVC mount (SLDP-TVC-001) and the
avionic sled (SLDP-AV-001). Pre-partitioned for a Bambu printer (every part <= 254 mm).

Changes from rocket_v4:
  * Gimbal point moved to 57 mm above the tail (motor tube flush with the tail).
  * Part A lengthened to 200 mm and given: 2X M3 TVC mount holes at the gimbal point (gimbal axis X),
    4X intake vents above the fan, and a clearance window for the inner-gimbal servo bracket
    (it swings to R38.6 at +/-8 deg, the bore is R38.1).
  * Couplers 2.4 mm wall x 25 mm engagement (v2's 0.8 mm shoulder snapped off along a layer line).
  * Part B lengthened to 154 mm so the 100 mm sled fits between the couplers (104 mm clear), with
    4X M3 holes matching the sled's radial bosses.
  * Fins clocked to 45/135/225/315 deg so the holes, vents and window sit between them.

Requires: pip install cadquery numpy
Run:      python3 SLDP-ST-005_rocket-body.py  -> STL + STEP per part (SLDP-ST-005_<part>), mass / CG / clearance report
Coordinates: z = rocket axis, 0 at the tail. x = gimbal axis X, y = gimbal axis Y.
"""
import os, numpy as np, cadquery as cq

# ---------------- PARAMETERS ----------------
TUBE_ID   = 76.2            # bore: TVC outer gimbal Ø75.5, sled Ø75.8
WALL      = 1.2             # body wall
CPL_WALL  = 2.4             # coupler wall (4 lines of a 0.6 nozzle; was 1.8)
SLIP      = 0.15            # radial clearance coupler <-> tube
INSERT    = 25.0            # coupler / nose shoulder depth into each tube (was 18)
A_LEN     = 200.0           # part A: TVC bay + vents + ESC
B_LEN     = 154.0           # part B: avionics sled bay (104 clear between coupler ends)
BAND1     = 3.0             # exposed ring of coupler C1
BAND2     = 18.0            # exposed interstage band of coupler C2
S2_LEN    = 140.0           # part D
NOSE_BAND = 15.0
NOSE_LEN  = 1.3             # cone length / OD
FIN_ROOT, FIN_TIP, FIN_SPAN, FIN_T = 75.0, 32.0, 30.0, 2.0
FIN_ANGLES = (45, 135, 225, 315)
GIMBAL_Z  = 57.0            # gimbal point above the tail (SLDP-TVC-001)
HOLE_D    = 3.2             # M3 clearance
VENT_W, VENT_L, VENT_Z = 12.0, 32.0, 136.0          # 4X obround intake vents (centre z), at 0/90/180/270 deg
WIN_L, WIN_W, WIN_Z, WIN_ANG = 30.0, 12.0, 19.0, 270.0   # gimbal-bracket clearance window
SLED_GAP  = 1.0             # sled bottom above the C1 coupler end
SLED_H, SLED_BOSS_Z = 100.0, (3.0, 97.0)            # SLDP-AV-001
PLA, PRINTER_MAX = 1.24, 254.0
# (name, g, z) -- weigh the real parts and edit
COMPONENTS = [('EDF QX 30 mm', 30, 20), ('TVC mount, printed', 66, 60), ('2X MG90S servo', 27, 58),
              ('screws', 6, 57), ('ESC 20 A', 25, 172), ('wiring', 15, 150),
              ('sled + breadboard + Nano + IMU', 83, None)]
THRUST_G, GIMBAL_DEG = 220, 8
# ---------------------------------------------

RI = TUBE_ID / 2; RO = RI + WALL; OD = 2 * RO
RC = RI - SLIP; RCI = RC - CPL_WALL
Z_AB = A_LEN; Z_B0 = Z_AB + BAND1; Z_BT = Z_B0 + B_LEN
Z_S2 = Z_BT + BAND2; Z_NOSE = Z_S2 + S2_LEN
NOSE_L = NOSE_LEN * OD; TOP = Z_NOSE + NOSE_BAND + NOSE_L
SLED_Z0 = Z_B0 + INSERT + SLED_GAP                 # sled bottom face
IMU_Z = SLED_Z0 + 20.0                             # MPU-6050 centre on the board (SLDP-AV-001)

def rev(pts):
    return cq.Workplane('XZ').polyline(pts).close().revolve(360, (0, 0, 0), (0, 1, 0))
def tube(length, z0):
    return rev([(RI, z0), (RO, z0), (RO, z0 + length), (RI, z0 + length)])
def coupler(band, zj):
    zb = zj - INSERT; zt = zj + band + INSERT
    return rev([(RCI, zb), (RC, zb), (RC, zj), (RO, zj), (RO, zj + band), (RC, zj + band), (RC, zt), (RCI, zt)])
def nose(z0):
    zc = z0 + NOSE_BAND; tip_r = 3.0
    outer = [(RC, z0 - INSERT), (RC, z0), (RO, z0), (RO, zc), (tip_r, zc + NOSE_L - tip_r), (0, zc + NOSE_L)]
    inner_top = zc + NOSE_L - 3 * WALL - tip_r * 2
    inner = [(0, inner_top), (0.6, inner_top), (RO - WALL, zc), (RO - WALL, z0 + 3), (RCI, z0 + 3), (RCI, z0 - INSERT)]
    return rev(outer + inner)
def fin(angle):
    x0 = RO - 0.6
    pts = [(x0, 0), (x0 + FIN_SPAN, 0), (x0 + FIN_SPAN, FIN_TIP), (x0, FIN_ROOT)]
    return cq.Workplane('XZ').polyline(pts).close().extrude(FIN_T / 2, both=True).rotate((0, 0, 0), (0, 0, 1), angle)

def radial(shape2d, angle):
    """A cutter that goes radially through the wall at the given angle (built on +x, rotated)."""
    return shape2d.rotate((0, 0, 0), (0, 0, 1), angle)
def hole(z, angle, d=HOLE_D):
    return radial(cq.Workplane('YZ').workplane(offset=RI - 3).center(0, z).circle(d / 2).extrude(8), angle)
def slot(z, angle, length, width, vertical=True):
    wp = cq.Workplane('YZ').workplane(offset=RI - 3).center(0, z)
    return radial(wp.slot2D(length, width, 90 if vertical else 0).extrude(8), angle)

def build():
    A = tube(A_LEN, 0)
    for ang in (0, 180): A = A.cut(hole(GIMBAL_Z, ang))                       # TVC outer gimbal, axis X
    for ang in (0, 90, 180, 270): A = A.cut(slot(VENT_Z, ang, VENT_L, VENT_W))  # intake vents
    A = A.cut(slot(WIN_Z, WIN_ANG, WIN_L, WIN_W, vertical=False))            # bracket clearance window
    B = tube(B_LEN, Z_B0)
    for dz in SLED_BOSS_Z:
        for ang in (0, 180): B = B.cut(hole(SLED_Z0 + dz, ang))               # sled retention
    parts = {
        'A_lower_body': A,
        'B_avionics_bay': B,
        'C1_coupler': coupler(BAND1, Z_AB),
        'C2_interstage_coupler': coupler(BAND2, Z_BT),
        'D_upper_body': tube(S2_LEN, Z_S2),
        'E_nose_cone': nose(Z_NOSE),
    }
    fins = [fin(a) for a in FIN_ANGLES]
    return parts, fins

def tri(wp, tol=0.12):
    v, t = wp.val().tessellate(tol, 0.15)
    return np.array([(p.x, p.y, p.z) for p in v]), np.array(t)
def props(V, T):
    t = V[T]; v6 = np.einsum('ij,ij->i', t[:, 0], np.cross(t[:, 1], t[:, 2])) / 6
    vol = v6.sum(); zc = (v6 * t.sum(1)[:, 2] / 4).sum() / vol
    s = t.sum(1); q = (t ** 2).sum(1) + s ** 2
    Ix = (v6 * (q[:, 1] + q[:, 2]) / 20).sum()
    return abs(vol) / 1000 * PLA, zc, abs(Ix) * PLA / 1000

def report(parts, fins):
    out, items = [], []
    for name, wp in list(parts.items()) + [('F_fin', fins[0])]:
        V, T = tri(wp); g, zc, I = props(V, T); bb = wp.val().BoundingBox()
        n = 4 if name == 'F_fin' else 1
        out.append((name, n, max(bb.zlen, bb.xlen, bb.ylen), g))
        items.append((g * n, zc, I * n))
    comps = [(m, z if z is not None else SLED_Z0 + SLED_H / 2) for _, m, z in COMPONENTS]
    M = sum(i[0] for i in items) + sum(m for m, _ in comps)
    cg = (sum(g * z for g, z, _ in items) + sum(m * z for m, z in comps)) / M
    I0 = sum(i[2] for i in items) + sum(m * z * z for m, z in comps)
    Icg = (I0 - M * cg * cg) * 1e-9
    arm = (cg - GIMBAL_Z) / 1000
    alpha = THRUST_G / 1000 * 9.81 * np.sin(np.radians(GIMBAL_DEG)) * arm / Icg
    return out, dict(M=M, cg=cg, Icg=Icg, arm=arm, alpha=np.degrees(alpha),
                     printed=sum(o[1] * o[3] for o in out))

def stem(name):
    """Release file name for a part: 'A_lower_body' -> 'SLDP-ST-005_A-lower-body' (house naming: hyphens)."""
    return 'SLDP-ST-005_' + name.replace('_', '-')

if __name__ == '__main__':
    here = os.path.dirname(os.path.abspath(__file__))
    parts, fins = build()
    for name, wp in list(parts.items()) + [('F_fin_x4', fins[0])]:
        cq.exporters.export(wp, os.path.join(here, stem(name) + '.stl'), tolerance=0.05, angularTolerance=0.1)
        cq.exporters.export(wp, os.path.join(here, stem(name) + '.step'))
    # coupler joint test piece: 2X 35 mm tube stub + the real C1 coupler
    stub = tube(INSERT + 10, 0)
    cq.exporters.export(stub, os.path.join(here, 'SLDP-ST-005_test-tube-stub.stl'), tolerance=0.05, angularTolerance=0.1)
    cq.exporters.export(parts['C1_coupler'], os.path.join(here, 'SLDP-ST-005_test-coupler-C1.stl'), tolerance=0.05, angularTolerance=0.1)
    out, r = report(parts, fins)
    print(f'Overall length {TOP:.1f} mm | OD {OD:.1f} | span incl. fins {OD + 2 * FIN_SPAN:.0f}')
    for name, n, L, g in out:
        print(f'  {name:24s} x{n}  longest {L:6.1f} mm  {"OK" if L <= PRINTER_MAX else "TOO BIG"}  ~{g:5.1f} g each')
    print(f'Sled bay clear length {B_LEN - 2 * INSERT:.0f} mm (sled {SLED_H:.0f}); sled z {SLED_Z0:.0f}..{SLED_Z0 + SLED_H:.0f}, IMU z ~{IMU_Z:.0f}')
    print(f'Printed ~{r["printed"]:.0f} g, total ~{r["M"]:.0f} g, CG ~{r["cg"]:.0f} mm from tail, lever arm {r["arm"]*1000:.0f} mm, '
          f'I_cg {r["Icg"]:.4f} kg m^2, {r["alpha"]:.0f} deg/s^2 at {GIMBAL_DEG} deg / {THRUST_G} g')
