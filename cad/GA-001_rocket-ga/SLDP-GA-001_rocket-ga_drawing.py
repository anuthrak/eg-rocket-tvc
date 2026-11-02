"""
SLDP-GA-001  Rocket general assembly: rocket body (SLDP-ST-005) + TVC mount (SLDP-TVC-001)
+ avionic sled (SLDP-AV-001), EDF and electronics in phantom. 2 sheets:
  Sheet 1: section A-A of the whole rocket (1:2), detail B of the tail with +/-8 deg tube travel (1:1),
           parts list, notes.
  Sheet 2: exploded isometric along the assembly path (1:4) + interface table.
All meshes in rocket coordinates: z = axis (0 at the tail), x = gimbal axis X, y = gimbal axis Y.
"""
import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'lib'))
import numpy as np, trimesh
from matplotlib.patches import Circle, Polygon, Arc
from matplotlib.collections import LineCollection
from matplotlib.backends.backend_pdf import PdfPages
from shapely.geometry import Polygon as SPoly, LineString, box as sbox
import sldp_sheet as S
from sldp_sheet import (L, poly, box, txt, arrow, dim_h, dim_v, leader, balloon, draw_lines, notes_block,
                        caption, cg_symbol, THICK, THIN, CL, PH, CP, FS, K)
import hlr, paths
BM = paths.body_model()          # SLDP-ST-005 model (run it first: it writes the body STLs read below)
from asm import assemble

here = os.path.dirname(os.path.abspath(__file__)); os.chdir(here)
DWG, TITLE, NSH = 'SLDP-GA-001', 'ROCKET GENERAL ASSEMBLY', 2
TRAVEL = 8.0
EDF_OD, EDF_L, HUB_D, HUB_L = 31.6, 40.0, 16.0, 25.0
BB_L, BB_W, BB_T = 83.0, 55.0, 8.5

def T(m, v=(0, 0, 0), rz=0.0):
    g = m.copy()
    if rz: g.apply_transform(trimesh.transformations.rotation_matrix(np.radians(rz), [0, 0, 1]))
    g.apply_translation(v); return g

# ---------------------------------------------------------------- model in rocket coordinates
BODY = {n: trimesh.load(os.path.join(paths.ST005, BM.stem(n) + '.stl')) for n in
        ['A_lower_body', 'B_avionics_bay', 'C1_coupler', 'C2_interstage_coupler', 'D_upper_body', 'E_nose_cone']}
FIN0 = trimesh.load(os.path.join(paths.ST005, BM.stem('F_fin_x4') + '.stl')); FINS = [T(FIN0, rz=90 * k) for k in range(4)]
outer, inner, tube = [T(m, (0, 0, BM.GIMBAL_Z)) for m in assemble(0, 90)]
TVC = [outer, inner, tube]
SLED = T(trimesh.load(os.path.join(paths.AV001, 'SLDP-AV-001_avionic-sled.stl')), (0, 0, BM.SLED_Z0))
_, REP = BM.report(*BM.build())
CGZ, Z0 = REP['cg'], BM.SLED_Z0
FY = -9.0                                            # sled mounting face (SLDP-AV-001)

def boxmesh(x0, x1, y0, y1, z0, z1):
    b = trimesh.creation.box(extents=(x1 - x0, y1 - y0, z1 - z0)); b.apply_translation(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)); return b

# ---------------------------------------------------------------- section helpers
def section_polys(mesh, origin, normal, to2d):
    sec = mesh.section(plane_origin=origin, plane_normal=normal)
    if sec is None: return []
    region = None
    for loop in sec.discrete:
        pg = SPoly(to2d(loop)).buffer(0)
        if pg.is_empty: continue
        region = pg if region is None else region.symmetric_difference(pg)
    if region is None or region.is_empty: return []
    return list(region.geoms) if hasattr(region, 'geoms') else [region]

def hatch(pg, angle, pitch, lw=THIN * 0.7):
    x0, y0, x1, y1 = pg.bounds; d = np.hypot(x1 - x0, y1 - y0) + 1; c = np.array([(x0 + x1) / 2, (y0 + y1) / 2])
    a = np.radians(angle); v = np.array([np.cos(a), np.sin(a)]); n = np.array([-v[1], v[0]]); segs = []
    for k in np.arange(-d / 2, d / 2, pitch):
        g = pg.intersection(LineString([c + n * k - v * d, c + n * k + v * d]))
        for gg in getattr(g, 'geoms', [g]):
            if not gg.is_empty and gg.geom_type == 'LineString': segs.append(np.array(gg.coords))
    S.ax.add_collection(LineCollection(segs, colors=K, linewidths=lw, zorder=3))

def cut_face(pg, solid=False, angle=45, pitch=1.0, lw=THICK * 0.6):
    for r_ in [pg.exterior] + list(pg.interiors):
        c = np.array(r_.coords); L(c[:, 0], c[:, 1], lw, z=4)
    if solid:
        S.ax.add_patch(Polygon(np.array(pg.exterior.coords), fc=K, ec=K, lw=0.1, zorder=4))
        for h in pg.interiors: S.ax.add_patch(Polygon(np.array(h.coords), fc='white', ec=K, lw=0.1, zorder=4))
    else:
        hatch(pg, angle, pitch)

def draw_section(meshes_styles, to2d, clip=None):
    """meshes_styles: [(mesh, solid, angle, pitch)] cut by plane x = 0."""
    for m, solid, ang, pitch in meshes_styles:
        for pg in section_polys(m, [0, 0, 0], [1, 0, 0], to2d):
            if clip is not None:
                pg = pg.intersection(clip)
                if pg.is_empty: continue
            for gg in getattr(pg, 'geoms', [pg]):
                if gg.geom_type == 'Polygon' and gg.area > 1e-3: cut_face(gg, solid, ang, pitch)

def rot2(p, c, deg):
    a = np.radians(deg); R = np.array([[np.cos(a), -np.sin(a)], [np.sin(a), np.cos(a)]])
    return (np.asarray(p, float) - c) @ R.T + c

def phantom_rect(P, z0, z1, h0, h1):
    """Phantom outline of a box in section coordinates (z along, h = -y across)."""
    poly([P(z0, h0), P(z1, h0), P(z1, h1), P(z0, h1)], THIN, PH)

def edf_section(P, deg=0.0, c=None):
    """EDF (REF envelope) in section: thin duct walls solid, motor + rotor outlined (purchased, not hatched)."""
    zb = BM.GIMBAL_Z - 57.0; ro, ri = EDF_OD / 2, EDF_OD / 2 - 0.9
    def q(z, h): p = np.array(P(z, h)); return rot2(p, c, deg) if c is not None else p
    for s in (-1, 1):
        S.ax.add_patch(Polygon([q(zb, s * ri), q(zb + EDF_L, s * ri), q(zb + EDF_L, s * ro), q(zb, s * ro)], fc=K, ec=K, lw=0.1, zorder=4))
    hz0, hz1 = zb + 6, zb + 6 + HUB_L
    poly([q(hz0, -HUB_D / 2), q(hz1, -HUB_D / 2), q(hz1, HUB_D / 2), q(hz0, HUB_D / 2)], THICK * 0.6)
    a, b, c2 = q(hz1, -HUB_D / 2), q(hz1 + 5, 0), q(hz1, HUB_D / 2); L([a[0], b[0], c2[0]], [a[1], b[1], c2[1]], THICK * 0.6)
    for s in (-1, 1):
        for z in (hz0 + 3, hz0 + 9):
            a, b = q(z, s * HUB_D / 2), q(z + 4, s * ri); L([a[0], b[0]], [a[1], b[1]], THIN)

def electronics_phantom(P):
    """Breadboard on sled face C, Nano + MPU-6050 on the board (all phantom, REF)."""
    zb = Z0 + 8
    phantom_rect(P, zb, zb + BB_L, -FY, -(FY + BB_T))                      # h = -y
    phantom_rect(P, zb + 38, zb + 81, -(FY + BB_T), -(FY + BB_T + 7))      # Nano on top of the board
    phantom_rect(P, zb + 4, zb + 20, -(FY + BB_T), -(FY + BB_T + 3))       # IMU

# =========================================================================== SHEET 1
def sheet1():
    fig = S.new_sheet()
    sc = 0.5; SX, SY = 45.0, 206.0
    P = lambda z, h: (SX + sc * z, SY + sc * h)                            # section coords: z right, h = -y up
    to2d = lambda v: np.c_[SX + sc * v[:, 2], SY - sc * v[:, 1]]
    styles = ([(m, True, 0, 1) for m in BODY.values()] +
              [(outer, False, 45, 0.7), (inner, False, 135, 0.7), (tube, False, 45, 0.55), (SLED, False, 135, 0.7)])
    draw_section(styles, to2d)
    edf_section(P); electronics_phantom(P)
    L([SX - 6, SX + sc * BM.TOP + 6], [SY, SY], THIN, CL)
    S.ax.add_patch(Circle(P(BM.GIMBAL_Z, 0), 0.9, fc=K, ec=K, zorder=6))
    cg_symbol(P(CGZ, 0), 2.6)
    # balloons (above the section)
    yb = SY + 34
    def bal(item, z, h, dx=0):
        p = P(z, h); balloon(p, (p[0] + dx, yb), item)
    bal(1, 420, -BM.RO, 8); bal(2, BM.GIMBAL_Z + 30, 30.5, -8); bal(3, Z0 + 3, 34, -6)
    bal(4, 20, -12, -14); bal(5, Z0 + 70, -(FY + BB_T / 2), 4); bal(6, Z0 + 70, -(FY + BB_T + 5), 16)
    bal(7, Z0 + 18, -(FY + BB_T + 2), 6)
    # interface stations (baseline from the tail, below the section)
    yy = SY - sc * BM.RO
    stations = [(BM.GIMBAL_Z, f'{BM.GIMBAL_Z:g}', 'GIMBAL POINT'), (Z0, f'{Z0:g}', 'SLED BOTTOM'),
                (Z0 + BM.SLED_H, f'{Z0 + BM.SLED_H:g}', 'SLED TOP'), (BM.TOP, f'{BM.TOP:.1f}', 'OVERALL')]
    L([SX, SX], [yy - 1.5, SY - 42 - 7 * len(stations)], THIN)
    for k, (z, lab, name) in enumerate(stations):
        y = SY - 40 - 7 * k
        L([SX + sc * z] * 2, [SY - 1.5 if z not in (BM.TOP,) else SY - 2, y - 2], THIN)
        arrow(((SX + SX + sc * z) / 2, y), (SX, y)); arrow(((SX + SX + sc * z) / 2, y), (SX + sc * z, y))
        txt(SX + sc * z + 2.5, y, f'{lab}  {name}' if z < 400 else lab, ha='left', fs=FS - 2)
    leader(P(CGZ + 1.8, -1.8), (SX + sc * CGZ + 40, SY - 27), f'CG ~{CGZ:.0f} (REF) = RIG PIVOT', fs=FS - 2.5)
    leader(P(BM.IMU_Z, -(FY + BB_T + 3)), (SX + sc * BM.IMU_Z + 62, SY + 24), f'IMU ~{BM.IMU_Z:.0f} (REF)', fs=FS - 2.5)
    # cutting plane note + detail B circle
    txt(SX + sc * BM.TOP - 6, SY - 30, 'CUT ON PLANE X = 0\n(CONTAINS GIMBAL AXIS Y)', fs=FS - 3, style='italic')
    S.ax.add_patch(Circle(P(60, 0), 31, fill=False, ec=K, lw=THIN, ls=PH, zorder=5)); txt(SX + sc * 60 + 24, SY + 25, 'B', fontweight='bold')
    caption(SX + sc * BM.TOP / 2 + 40, SY - 70, 'SECTION A-A  SCALE 1:2  (BACKGROUND OMITTED)')

    # ---------------- DETAIL B (1:1): tail, motor tube +/-8 deg about gimbal axis X ----------------
    DX, DY = 30.0, 66.0                                                  # sheet point of z = 0, h = 0
    zlo, zhi, hlim = -6.0, 126.0, 44.0
    clip = sbox(zlo, -hlim, zhi, hlim)
    Pd = lambda z, h: (DX + (z - zlo), DY + h)
    to2d_d = lambda v: np.c_[v[:, 2], -v[:, 1]]
    styles_d = [(BODY['A_lower_body'], True, 0, 1), (outer, False, 45, 1.4), (inner, False, 135, 1.4), (tube, False, 45, 1.0)]
    for m, solid, ang, pitch in styles_d:
        for pg in section_polys(m, [0, 0, 0], [1, 0, 0], to2d_d):
            pg = pg.intersection(clip)
            for gg in getattr(pg, 'geoms', [pg]):
                if gg.is_empty or gg.geom_type != 'Polygon': continue
                sp = SPoly(np.c_[DX + np.array(gg.exterior.coords)[:, 0] - zlo, DY + np.array(gg.exterior.coords)[:, 1]],
                           [np.c_[DX + np.array(h.coords)[:, 0] - zlo, DY + np.array(h.coords)[:, 1]] for h in gg.interiors])
                cut_face(sp, solid, ang, pitch, lw=THICK * 0.8)
    c = np.array(Pd(BM.GIMBAL_Z, 0))
    edf_section(Pd)
    for s in (-1, 1):                                                    # tilted tube outline (phantom)
        rect = [Pd(0, -17.5), Pd(114, -17.5), Pd(114, 17.5), Pd(0, 17.5)]
        poly([rot2(p, c, s * TRAVEL) for p in rect], THIN, PH)
        a0, a1 = rot2(Pd(-14, 0), c, s * TRAVEL), rot2(Pd(4, 0), c, s * TRAVEL); L([a0[0], a1[0]], [a0[1], a1[1]], THIN)
    L([Pd(zlo - 6, 0)[0], Pd(zhi + 4, 0)[0]], [DY, DY], THIN, CL)
    S.ax.add_patch(Circle(c, 1.0, fc=K, ec=K, zorder=6))
    R = BM.GIMBAL_Z + 12
    S.ax.add_patch(Arc(c, 2 * R, 2 * R, theta1=180 - TRAVEL - 4, theta2=180 + TRAVEL + 4, lw=THIN, color=K, zorder=5))
    for s in (-1, 1):
        te, to = np.radians(180 + s * TRAVEL), np.radians(180 + s * (TRAVEL + 4))
        arrow(c + R * np.array([np.cos(to), np.sin(to)]), c + R * np.array([np.cos(te), np.sin(te)]))
    txt(c[0] - R - 2, c[1] + R * np.sin(np.radians(TRAVEL + 6)) + 3, f'{TRAVEL:.0f}° TYP', ha='right', fs=FS - 2)
    rad = BM.RI - 17.5 * np.cos(np.radians(TRAVEL)) - 57 * np.sin(np.radians(TRAVEL))
    leader(Pd(BM.GIMBAL_Z + 20, 32), (DX + 142, DY + 34), 'ITEM 2 TVC MOUNT', fs=FS - 2.5)
    leader(Pd(20, -10), (DX + 142, DY - 20), 'ITEM 4 EDF (SECTION, REF)', fs=FS - 2.5)
    leader(Pd(BM.WIN_Z - 2, BM.RO - 0.6), (DX + 142, DY + 18), 'CLEARANCE WINDOW\n(AXIS Y SWING, ST-005)', fs=FS - 2.5)
    leader(Pd(110, BM.RO), (DX + 142, DY + 46), 'ITEM 1 BODY, PART A', fs=FS - 2.5)
    txt(DX + 142, DY - 32, f'TUBE-TO-BORE CLEARANCE AT {TRAVEL:.0f}°: ~{rad:.0f} MM', ha='left', fs=FS - 2.5, style='italic')
    caption(DX + (zhi - zlo) / 2, DY - 50, 'DETAIL B  SCALE 1:1')

    # ---------------- NOTES ----------------
    txt(178, 22, 'NOTES: SHEET 2.', ha='left', fs=FS - 2.5, fontweight='bold')
    tbx, tby, tbw, tbh = S.frame(1, NSH, DWG, TITLE, scale='1:2', mass=f'~{REP["M"]:.0f} g', material='SEE LIST')
    rows = [(1, 1, 'ROCKET BODY  (SLDP-ST-005)', 'ASSY'), (2, 1, 'TVC MOUNT  (SLDP-TVC-001)', 'ASSY'),
            (3, 1, 'AVIONIC SLED V1  (SLDP-AV-001)', 'PLA'), (4, 1, 'EDF QX 30 MM 7000KV', 'PURCHASED'),
            (5, 1, 'BREADBOARD, HALF-SIZE', 'PURCHASED'), (6, 1, 'ARDUINO NANO', 'PURCHASED'),
            (7, 1, 'MPU-6050 IMU', 'PURCHASED'), (8, 1, 'ESC SURPASS 20 A (NOT SHOWN)', 'PURCHASED'),
            (9, 2, 'SCREW M3 X 6 BUTTON HD', 'STEEL'), (10, 4, 'SCREW M3 X 8 BUTTON HD', 'STEEL')]
    S.parts_list(tbx, tby + tbh, rows, rh=5.2)
    return fig

# =========================================================================== SHEET 2
def screw(axis, sign, pos, length):
    head = trimesh.creation.cylinder(radius=2.85, height=1.65, sections=32); head.apply_translation((0, 0, 0.825))
    shank = trimesh.creation.cylinder(radius=1.5, height=length, sections=24); shank.apply_translation((0, 0, -length / 2))
    s = trimesh.util.concatenate([head, shank]); tgt = np.zeros(3); tgt[axis] = sign
    s.apply_transform(trimesh.geometry.align_vectors((0, 0, 1), tgt)); s.apply_translation(pos); return s

def sheet2():
    fig = S.new_sheet()
    DZ = {'tvc': -150.0, 'A': 0.0, 'sled': 70.0, 'B': 200.0, 'D': 235.0, 'E': 270.0}
    PULL = 22.0
    ex, tag = [], []
    def add(m, dz, t): ex.append(T(m, (0, 0, dz))); tag.append(t)
    for m in TVC: add(m, DZ['tvc'], 2)
    add(BODY['A_lower_body'], DZ['A'], 1); add(BODY['C1_coupler'], DZ['A'], 1)
    for f in FINS: add(f, DZ['A'], 1)
    add(SLED, DZ['sled'], 3)
    add(BODY['B_avionics_bay'], DZ['B'], 1)
    add(BODY['C2_interstage_coupler'], DZ['D'], 1); add(BODY['D_upper_body'], DZ['D'], 1)
    add(BODY['E_nose_cone'], DZ['E'], 1)
    RO = BM.RO
    for s in (-1, 1): add(screw(0, s, (s * (RO + PULL), 0, BM.GIMBAL_Z), 6.0), 0, 9)
    for dz in BM.SLED_BOSS_Z:
        for s in (-1, 1): add(screw(0, s, (s * (RO + PULL), 0, Z0 + dz), 8.0), DZ['B'], 10)
    d, up = (-0.35, 0.8, -0.5), (-1, 0, 0)
    lines, _, (r, u) = hlr.view_lines(ex, d, up)
    sc = 0.25
    allv = np.vstack([m.vertices for m in ex]); P2 = np.c_[allv @ r, allv @ u]; cc = (P2.min(0) + P2.max(0)) / 2
    OX, OY = 215 - sc * cc[0], 196 - sc * cc[1]
    draw_lines(lines, (OX, OY), sc, lw=THIN * 1.3)
    Pj = lambda p: np.array([OX + sc * (np.asarray(p, float) @ r), OY + sc * (np.asarray(p, float) @ u)])
    a0, a1 = Pj((0, 0, DZ['tvc'] - 10)), Pj((0, 0, BM.TOP + DZ['E'] + 15)); L([a0[0], a1[0]], [a0[1], a1[1]], THIN, CL)
    for s in (-1, 1):                                                    # screw trail lines
        for z, dzb in [(BM.GIMBAL_Z, 0)] + [(Z0 + dz, DZ['B']) for dz in BM.SLED_BOSS_Z]:
            a, b = Pj((s * (RO + 1), 0, z + dzb)), Pj((s * (RO + PULL - 8), 0, z + dzb)); L([a[0], b[0]], [a[1], b[1]], THIN, PH)
    def surf(m, q):
        cp, _, _ = trimesh.proximity.closest_point(m, [q]); return cp[0]
    def bl(item, mesh, q, off):
        p = Pj(surf(mesh, q)); balloon(p, p + np.array(off), item)
    bl(1, ex[3], (0, -RO, 120), (-8, -26)); bl(1, ex[11], (0, -RO, 280 + DZ['B']), (-4, -26))
    bl(2, ex[2], (0, -17.5, BM.GIMBAL_Z + DZ['tvc'] - 20), (-14, -22))
    bl(3, ex[10], (0, FY, Z0 + 50 + DZ['sled']), (-6, -30))
    p = Pj((-(RO + PULL + 2), 0, BM.GIMBAL_Z)); balloon(p, p + np.array([-12, 18]), 9)
    p = Pj((-(RO + PULL + 2), 0, Z0 + BM.SLED_BOSS_Z[1] + DZ['B'])); balloon(p, p + np.array([-6, 20]), 10)
    caption(215, 140, 'EXPLODED ISOMETRIC VIEW (ASSEMBLY PATH)  SCALE 1:4')
    # interface table
    tx, ty, rh = 18.0, 118.0, 6.0
    cols = [(0, 62, 'INTERFACE'), (62, 64, 'FASTENING'), (126, 104, 'LOCATION / NOTE')]
    rows = [('2 TVC MOUNT -> BODY PART A', '2X ITEM 9, M3 X 6', 'Z 57, 0°/180° (GIMBAL AXIS X). MAX 6 LONG.'),
            ('3 SLED -> BODY PART B', '4X ITEM 10, M3 X 8', f'Z {Z0 + 3:.0f} / {Z0 + 97:.0f}, 0°/180°. SLED IN FROM BELOW.'),
            ('4 EDF -> MOTOR TUBE', 'TAPE SHIM + HOT GLUE', 'EXHAUST FLUSH WITH TAIL, DUCT OD MAX 31.6.'),
            ('5 BREADBOARD -> SLED', 'ADHESIVE + 2 ZIP TIES', 'FACE C, IMU AT BOTTOM OF BOARD.'),
            ('BODY A <-> B', 'C1 SLIP FIT + TAPE', f'Z {BM.Z_AB:g}-{BM.Z_B0:g}. REMOVABLE FOR SLED ACCESS.'),
            ('BODY B <-> D', 'C2 SLIP FIT + TAPE', f'Z {BM.Z_BT:g}-{BM.Z_S2:g}. REMOVABLE.'),
            ('BODY D <-> NOSE', 'SHOULDER SLIP FIT', f'Z {BM.Z_NOSE:g}.'),
            ('ROCKET -> DESK RIG', 'RIG COLLAR (SLDP-GS-001)', f'AT MEASURED CG (~{CGZ:.0f} REF), ON PART B.')]
    W = 230
    box(tx, ty - rh * len(rows), tx + W, ty + rh, THICK)
    for k in range(len(rows) + 1):
        y = ty - rh * k
        L([tx, tx + W], [y, y], THIN)
        for i, (cx, cw, head) in enumerate(cols):
            L([tx + cx, tx + cx], [y, y + rh], THIN)
            if k == 0: txt(tx + cx + cw / 2, y + rh / 2, head, fs=FS - 3, fontweight='bold')
            else: txt(tx + cx + 1.5, y + rh / 2, rows[k - 1][i], ha='left', fs=FS - 3.5)
    txt(tx + W / 2, ty + rh + 4, 'INTERFACE TABLE', fs=FS - 2, fontweight='bold')
    notes_block(18, 56, ['NOTES:',
        '1. ORDER: TVC INTO A FROM TAIL (9) -> SLED INTO B FROM BELOW (10) -> WIRES THROUGH C1 ->',
        '   B ONTO C1 -> D + C2 ONTO B -> NOSE. FULL SEQUENCE: SLDP-ST-005 SHEET 2.',
        '2. BALANCE THE COMPLETE ROCKET (WITH RIG COLLAR) TO SET THE RIG PIVOT.',
        '3. ASSEMBLY DRAWING; ALL DIMENSIONS REFERENCE. SUB-ASSEMBLIES PER THEIR OWN DRAWINGS.',
        '4. CLOCKING: GIMBAL AXIS X = BODY 0° (M3 HOLES); IMU X/Y ALIGNED TO GIMBAL AXES X/Y.',
        '5. ITEMS 4-7 SHOWN PHANTOM / ENVELOPE (REF). PARTS LIST: SHEET 1.'], fs=FS - 3, pitch=5.4)
    S.frame(2, NSH, DWG, TITLE, scale='1:4', mass=f'~{REP["M"]:.0f} g', material='SEE LIST', revisions=False)
    return fig

if __name__ == '__main__':
    base = os.path.join(here, 'SLDP-GA-001_rocket-ga')
    figs = [sheet1(), sheet2()]
    with PdfPages(base + '.pdf') as pdf:
        for f in figs: pdf.savefig(f)
    for n, f in enumerate(figs, 1): f.savefig(f'{base}_sheet{n}.png', dpi=170)
    print('ok')
