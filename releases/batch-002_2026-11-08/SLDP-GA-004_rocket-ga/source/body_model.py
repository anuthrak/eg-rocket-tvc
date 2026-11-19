"""
SLDP-ST-008  Rocket body (v8) -- SLDP-ST-007 ship-on-booster stack with the glued-on tail fins (old item 7)
replaced by 4X low STRAKES printed as part of part A, like the raised chines on the real booster. Everything
else is unchanged from ST-007: TVC mount at 37, tail notch, servo window, vents, sled holes, door + frame,
joint screw holes, hot-staging C2, ship flaps, ogive nose + ballast column, grid fins (item 12).
The rocket now sits on the SLDP-GS-003 launch mount (the strakes start above its 6 mm seat lip).

Changes from SLDP-ST-007:
  * Part A: 4X strakes at 55/145/235/325 deg (the old fin positions, clear of the notch, window, vents and
    mount holes), 3.5 wide x 1.5 proud, z 40-170, 45 deg chamfered ends so they print without supports.
  * Item 7 (fin) deleted. Only part A is reprinted.

Requires: pip install cadquery numpy
Run:      python3 SLDP-ST-008_rocket_body.py  -> STEP + STL per part in assembly position (used by the drawings),
          print-ready STLs (z min = 0) in print_stl/, mass / CG report
Coordinates: z = rocket axis, 0 at the tail. x = gimbal axis X (0 deg), y = gimbal axis Y (90 deg).
"""
import os, numpy as np, cadquery as cq

# ---------------- PARAMETERS ----------------
TUBE_ID   = 76.2            # bore: TVC outer gimbal dia 75.5, sled dia 75.8
WALL      = 1.2             # body wall
CPL_WALL  = 2.4             # coupler wall
SLIP      = 0.15            # radial clearance coupler <-> tube
INSERT    = 25.0            # coupler / nose shoulder depth into each tube
A_LEN     = 200.0           # part A: TVC bay + vents
B_LEN     = 154.0           # part B: avionics sled bay
BAND1     = 3.0             # exposed ring of coupler C1
BAND2     = 18.0            # exposed interstage band of coupler C2
S2_LEN    = 140.0           # part D
NOSE_BAND = 15.0
NOSE_LEN  = 1.3             # cone length / OD
FIN_ROOT, FIN_TIP, FIN_SPAN, FIN_T = 75.0, 32.0, 30.0, 2.0
FIN_ANGLES = (55, 145, 235, 325)       # ST-007 fins (deleted) -- strakes use the same angles
STRAKE_ANGLES, STRAKE_W, STRAKE_H, STRAKE_Z = (55, 145, 235, 325), 3.5, 1.5, (40.0, 170.0)
GIMBAL_Z  = 37.0            # gimbal point above the tail (was 57 in ST-005; mount lowered 20)
TUBE_BELOW = 57.0           # motor tube bottom below the gimbal point (SLDP-TVC-002)
EDF_L     = 45.0            # QX 30 mm EDF length (listing 1.77 in) -- measure; flush with the tube bottom
HOLE_D    = 3.2             # M3 clearance
VENT_W, VENT_L, VENT_Z = 12.0, 32.0, 136.0          # 4X obround intake vents (centre z) at 0/90/180/270 deg
NOTCH_W, NOTCH_TOP, NOTCH_ANG, NOTCH_R = 52.0, 32.0, 280.0, 6.0     # open tail notch (riding servo)
WIN_W, WIN_Z0, WIN_Z1, WIN_ANG, WIN_R = 38.0, 50.0, 84.0, 184.0, 6.0  # fixed-servo window
SLED_GAP  = 1.0             # sled bottom above the C1 coupler end
SLED_H, SLED_BOSS_Z, SLED_RING = 100.0, (3.0, 97.0), 6.0            # SLDP-AV-001
JOINT_HOLE = 12.0           # coupler retention holes, from each tube end, at 90/270 deg
# avionics bay door (part B, 90 deg). Widths are chords (straight across), heights are z.
DOOR_ANG  = 90.0
OPEN_W, OPEN_Z0, OPEN_Z1, OPEN_R = 46.0, 246.0, 321.0, 6.0          # opening in B
DOOR_CLR  = 0.2             # plug clearance in the opening (each side)
FLANGE_W, FLANGE_Z0, FLANGE_Z1, FLANGE_R, FLANGE_T = 52.0, 243.0, 330.0, 8.0, 1.2
FRAME_GAP, FRAME_BAND = 0.4, 3.0                                    # raised frame around the flange
TAB_Y, TAB_Z0, TAB_Z1 = (9.0, 21.0), 238.0, 250.0                   # 2X tabs behind the wall (|y| range)
CABLE_W, CABLE_H = 16.0, 7.0                                        # cable notch in the door bottom edge
DOOR_SCREW_Z = 326.0        # M3 x 6 through door + wall into the sled top ring (drill dia 2.5 on assembly)
# ---- v7 styling ----
HS_N, HS_W, HS_H, HS_D = 20, 4.0, 12.0, 2.0                        # hot-staging pockets in the C2 band
OGIVE_TIP = 4.0             # nose tip radius (blunt, Starship-like)
COL_D, COL_PILOT, COL_PILOT_L = 8.0, 2.5, 20.0                      # ballast column in E
FLAP_ANGLES = (0, 180)      # ship flaps (clear of door 90, notch 280, window 184)
FWD_FLAP = (10.0, 58.0, 14.0, 5.0, 1.6)   # z from ogive base: start, end; span at start (45 deg lower edge), span at end; thickness
AFT_FLAP = (70.0, 42.0, 22.0, 2.0)        # root, tip, span, thickness -- starts flush with D bottom
GF_ANGLES = (45, 135, 225, 315)           # booster grid fins
GF_Z0, GF_H, GF_W, GF_SPAN, GF_PAD, GF_WALL, GF_CELL = 340.0, 8.0, 22.0, 18.0, 2.0, 1.0, 5.0
PLA, PRINTER_MAX = 1.24, 254.0
# (name, g, z) -- weigh the real parts and edit
G = GIMBAL_Z
COMPONENTS = [('EDF QX 30 mm', 35, G - TUBE_BELOW + EDF_L / 2), ('TVC mount, printed', 66, G + 3),
              ('2X MG90S servo', 27, G + 1), ('screws', 6, G), ('wiring + tether lead', 15, 140),
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
EXHAUST_Z = G - TUBE_BELOW                         # motor tube / EDF exit (negative = below the tail)

def rev(pts):
    return cq.Workplane('XZ').polyline(pts).close().revolve(360, (0, 0, 0), (0, 1, 0))
def tube(length, z0):
    return rev([(RI, z0), (RO, z0), (RO, z0 + length), (RI, z0 + length)])
def annulus(r0, r1, z0, z1):
    return rev([(r0, z0), (r1, z0), (r1, z1), (r0, z1)])
def coupler(band, zj):
    zb = zj - INSERT; zt = zj + band + INSERT
    return rev([(RCI, zb), (RC, zb), (RC, zj), (RO, zj), (RO, zj + band), (RC, zj + band), (RC, zt), (RCI, zt)])
def ogive(R, L, tip, n=40):
    """Tangent ogive radius profile from the base (x=0, r=R) to a blunt tip of radius `tip`; returns [(r, x)]."""
    rho = (R * R + L * L) / (2 * R)
    xs = np.linspace(0, L, n)
    rs = np.sqrt(np.maximum(rho ** 2 - xs ** 2, 0)) + R - rho
    keep = rs > tip
    pts = [(float(r), float(x)) for r, x in zip(rs[keep], xs[keep])]
    return pts + [(0.0, float(L))]
def nose_r(x):
    """Outer ogive radius x mm above the ogive base."""
    R, L = RO, NOSE_L; rho = (R * R + L * L) / (2 * R)
    return float(np.sqrt(max(rho ** 2 - x ** 2, 0)) + R - rho)
def nose(z0):
    zc = z0 + NOSE_BAND
    out = ogive(RO, NOSE_L, OGIVE_TIP)
    top = zc + out[-1][1]
    inn = ogive(RO - WALL, NOSE_L - 2.5 * WALL, OGIVE_TIP)
    outer = [(RC, z0 - INSERT), (RC, z0), (RO, z0)] + [(r, zc + x) for r, x in out]
    inner = [(r, zc + x) for r, x in inn][::-1] + [(RO - WALL, z0 + 3), (RCI, z0 + 3), (RCI, z0 - INSERT)]
    body = rev(outer + inner)
    col = cq.Workplane('XY').workplane(offset=z0 - INSERT).circle(COL_D / 2).extrude(top - (z0 - INSERT) - 6)
    body = body.union(col.intersect(rev(outer + [(0, z0 - INSERT)])))
    body = body.cut(cq.Workplane('XY').workplane(offset=z0 - INSERT - 1).circle(COL_PILOT / 2).extrude(COL_PILOT_L + 1))
    a, b, s0, s1, t = FWD_FLAP
    for ang in FLAP_ANGLES:
        root = [(nose_r(x) - 0.8, zc + x) for x in np.linspace(a, b, 12)]
        pts = [(nose_r(b) - 0.8, zc + b)] + [(r, z) for r, z in root[::-1][1:]] + [(nose_r(a) + s0, zc + a + s0), (nose_r(b) + s1, zc + b)]
        flap = cq.Workplane('XZ').polyline(pts).close().extrude(t / 2, both=True).rotate((0, 0, 0), (0, 0, 1), ang)
        body = body.union(flap)
    return body
def aft_flaps(D):
    root, tip, span, t = AFT_FLAP; x0 = RO - 0.6
    for ang in FLAP_ANGLES:
        pts = [(x0, Z_S2), (RO + span, Z_S2), (RO + span, Z_S2 + tip), (x0, Z_S2 + root)]
        D = D.union(cq.Workplane('XZ').polyline(pts).close().extrude(t / 2, both=True).rotate((0, 0, 0), (0, 0, 1), ang))
    return D
def hot_stage_pockets(C2):
    zc = Z_BT + BAND2 / 2
    for k in range(HS_N):
        cut = (cq.Workplane('YZ').workplane(offset=RO - HS_D).center(0, zc).rect(HS_W, HS_H).extrude(5)
               .rotate((0, 0, 0), (0, 0, 1), 360.0 * (k + 0.5) / HS_N))
        C2 = C2.cut(cut)
    return C2
def grid_fin(angle):
    """Grid fin: curved root pad + rectangular frame with a 45 deg diamond lattice; cells open along z."""
    z0, z1 = GF_Z0, GF_Z0 + GF_H
    pad = annulus(RO - 0.2, RO + GF_PAD, z0, z1).intersect(prism(GF_W * 0.75, z0, z1, 0))
    r0, r1 = RO + GF_PAD - 0.2, RO + GF_PAD + GF_SPAN
    frame = (cq.Workplane('XY').workplane(offset=z0).center((r0 + r1) / 2, 0).rect(r1 - r0, GF_W).extrude(GF_H)
             .cut(cq.Workplane('XY').workplane(offset=z0 - 1).center((r0 + r1) / 2, 0).rect(r1 - r0 - 2 * GF_WALL, GF_W - 2 * GF_WALL).extrude(GF_H + 2)))
    span = max(r1 - r0, GF_W) * 1.6
    bars = None
    for sgn in (1, -1):
        for k in np.arange(-span, span, GF_CELL):
            b = (cq.Workplane('XY').workplane(offset=z0).center((r0 + r1) / 2, k).rect(span * 2, GF_WALL).extrude(GF_H)
                 .rotate(((r0 + r1) / 2, 0, 0), ((r0 + r1) / 2, 0, 1), 45 * sgn))
            bars = b if bars is None else bars.union(b)
    inside = cq.Workplane('XY').workplane(offset=z0).center((r0 + r1) / 2, 0).rect(r1 - r0 - GF_WALL, GF_W - GF_WALL).extrude(GF_H)
    g = pad.union(frame).union(bars.intersect(inside))
    return g.rotate((0, 0, 0), (0, 0, 1), angle)
def fin(angle):
    x0 = RO - 0.6
    pts = [(x0, 0), (x0 + FIN_SPAN, 0), (x0 + FIN_SPAN, FIN_TIP), (x0, FIN_ROOT)]
    return cq.Workplane('XZ').polyline(pts).close().extrude(FIN_T / 2, both=True).rotate((0, 0, 0), (0, 0, 1), angle)

def strake(angle):
    z0, z1 = STRAKE_Z; x0 = RO - 0.4
    pts = [(x0, z0), (RO + STRAKE_H, z0 + STRAKE_H + 0.4), (RO + STRAKE_H, z1 - STRAKE_H - 0.4), (x0, z1)]
    return cq.Workplane('XZ').polyline(pts).close().extrude(STRAKE_W / 2, both=True).rotate((0, 0, 0), (0, 0, 1), angle)

def radial(shape, angle):
    return shape.rotate((0, 0, 0), (0, 0, 1), angle)
def hole(z, angle, d=HOLE_D):
    return radial(cq.Workplane('YZ').workplane(offset=RI - 3).center(0, z).circle(d / 2).extrude(8), angle)
def slot(z, angle, length, width, vertical=True):
    wp = cq.Workplane('YZ').workplane(offset=RI - 3).center(0, z)
    return radial(wp.slot2D(length, width, 90 if vertical else 0).extrude(8), angle)
def prism(w, z0, z1, r, y0=0.0, x0=0.0, depth=60.0):
    """Rounded rectangle (chord width w, z0..z1, corner r) extruded radially along +x (un-rotated)."""
    p = cq.Workplane('YZ').workplane(offset=x0).center(y0, (z0 + z1) / 2).rect(w, z1 - z0).extrude(depth)
    return p.edges('|X').fillet(r) if r > 0 else p
def panel(r0, r1, w, z0, z1, r):
    """Curved panel of the tube between radii r0..r1 whose radial outline is the rounded rectangle (at +x)."""
    return annulus(r0, r1, z0 - 1, z1 + 1).intersect(prism(w, z0, z1, r))

def door_parts():
    """Return (frame on B, door G) un-rotated (centred on +x)."""
    fo = FLANGE_W + 2 * (FRAME_GAP + FRAME_BAND); fi = FLANGE_W + 2 * FRAME_GAP
    frame = panel(RO - 0.3, RO + FLANGE_T, fo, FLANGE_Z0 - FRAME_GAP - FRAME_BAND, FLANGE_Z1 + FRAME_GAP + FRAME_BAND,
                  FLANGE_R + FRAME_GAP + FRAME_BAND).cut(prism(fi, FLANGE_Z0 - FRAME_GAP, FLANGE_Z1 + FRAME_GAP, FLANGE_R + FRAME_GAP))
    w = OPEN_W - 2 * DOOR_CLR
    plug = panel(RI, RO, w, OPEN_Z0 + DOOR_CLR, OPEN_Z1 - DOOR_CLR, OPEN_R - DOOR_CLR)
    flange = panel(RO, RO + FLANGE_T, FLANGE_W, FLANGE_Z0, FLANGE_Z1, FLANGE_R)
    door = plug.union(flange)
    for s in (-1, 1):
        y0, y1 = TAB_Y
        door = door.union(annulus(RI - 1.2, RI + 0.01, TAB_Z0, TAB_Z1)
                          .intersect(prism(y1 - y0, TAB_Z0, TAB_Z1, 0, y0=s * (y0 + y1) / 2)))
    door = door.cut(prism(CABLE_W, FLANGE_Z0 - 2, OPEN_Z0 + CABLE_H, 0))                    # cable notch
    door = door.cut(cq.Workplane('YZ').workplane(offset=RI - 3).center(0, DOOR_SCREW_Z).circle(HOLE_D / 2).extrude(10))
    return frame, door

def joint_holes(part, z_ends):
    for z in z_ends:
        for ang in (90, 270): part = part.cut(hole(z, ang))
    return part

def build():
    A = tube(A_LEN, 0)
    for ang in STRAKE_ANGLES: A = A.union(strake(ang))                       # raised strakes (booster chines)
    for ang in (0, 180): A = A.cut(hole(GIMBAL_Z, ang))                       # TVC outer gimbal, axis X
    for ang in (0, 90, 180, 270): A = A.cut(slot(VENT_Z, ang, VENT_L, VENT_W))  # intake vents
    A = A.cut(radial(prism(NOTCH_W, -20, NOTCH_TOP, NOTCH_R), NOTCH_ANG))      # open tail notch (riding servo)
    A = A.cut(radial(prism(WIN_W, WIN_Z0, WIN_Z1, WIN_R), WIN_ANG))            # fixed-servo window
    B = tube(B_LEN, Z_B0)
    for dz in SLED_BOSS_Z:
        for ang in (0, 180): B = B.cut(hole(SLED_Z0 + dz, ang))               # sled retention
    frame, door = door_parts()
    B = B.union(radial(frame, DOOR_ANG))
    B = B.cut(radial(prism(OPEN_W, OPEN_Z0, OPEN_Z1, OPEN_R), DOOR_ANG))      # door opening
    B = B.cut(hole(DOOR_SCREW_Z, DOOR_ANG))                                    # door screw
    B = joint_holes(B, [Z_B0 + JOINT_HOLE, Z_BT - JOINT_HOLE])
    D = joint_holes(tube(S2_LEN, Z_S2), [Z_NOSE - JOINT_HOLE])            # nose shoulder (removable)
    parts = {
        'A_lower_body': A,
        'B_avionics_bay': B,
        'C1_coupler': coupler(BAND1, Z_AB),
        'C2_interstage_coupler': hot_stage_pockets(coupler(BAND2, Z_BT)),
        'D_upper_body': aft_flaps(D),
        'E_nose_cone': nose(Z_NOSE),
        'G_bay_door': radial(door, DOOR_ANG),
        'H_grid_fin': grid_fin(GF_ANGLES[0]),
    }
    fins = []                                   # item 7 deleted (ST-008): strakes are part of A
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
    for name, wp in list(parts.items()) + [('F_fin', f) for f in fins[:1]]:
        V, T = tri(wp); g, zc, I = props(V, T); bb = wp.val().BoundingBox()
        n = 4 if name in ('F_fin', 'H_grid_fin') else 1
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

def export_stl(wp, path):
    """STL with zmin = 0 (ready for the slicer)."""
    bb = wp.val().BoundingBox()
    cq.exporters.export(wp.translate((0, 0, -bb.zmin)), path, tolerance=0.03, angularTolerance=0.1)

if __name__ == '__main__':
    here = os.path.dirname(os.path.abspath(__file__))
    parts, fins = build()
    os.makedirs(os.path.join(here, 'print_stl'), exist_ok=True)
    for name, wp in list(parts.items()) + [('F_fin_x4', f) for f in fins[:1]]:
        if name == 'H_grid_fin': name = 'H_grid_fin_x4'
        cq.exporters.export(wp, os.path.join(here, name + '.step'))                       # assembly position
        cq.exporters.export(wp, os.path.join(here, name + '.stl'), tolerance=0.05, angularTolerance=0.1)
        tag = name.replace('_', '-', 1).replace('_', '-')
        export_stl(wp, os.path.join(here, 'print_stl', f'SLDP-ST-008_{tag}.stl'))           # zmin = 0, print-ready
    out, r = report(parts, fins)
    print(f'Overall length {TOP:.1f} mm (+{-EXHAUST_Z:.0f} motor tube below the tail) | OD {OD:.1f} | span incl. flaps {OD + 2 * AFT_FLAP[2]:.0f}')
    for name, n, L, g in out:
        print(f'  {name:24s} x{n}  longest {L:6.1f} mm  {"OK" if L <= PRINTER_MAX else "TOO BIG"}  ~{g:5.1f} g each')
    print(f'Sled z {SLED_Z0:.0f}..{SLED_Z0 + SLED_H:.0f}, IMU z ~{IMU_Z:.0f}; door opening z {OPEN_Z0:.0f}..{OPEN_Z1:.0f}')
    print(f'Printed ~{r["printed"]:.0f} g, total ~{r["M"]:.0f} g, CG ~{r["cg"]:.0f} mm from tail, lever arm {r["arm"]*1000:.0f} mm, '
          f'I_cg {r["Icg"]:.4f} kg m^2, {r["alpha"]:.0f} deg/s^2 at {GIMBAL_DEG} deg / {THRUST_G} g')
