"""
SLDP-GA-004  Rocket general assembly: ship-on-booster rocket body with strakes (SLDP-ST-008) + TVC mount with servos (SLDP-TVC-002)
+ avionic sled (SLDP-AV-001), EDF and electronics in phantom. Supersedes SLDP-GA-003. 3 sheets (Rev C order):
  Sheet 1: assembled exterior (1:2) with overall dimensions + CG, view C from the tail (span, clocking),
           parts list, general notes.
  Sheet 2: section A-A of the whole rocket (1:2), detail B of the tail with +/-8 deg tube travel (1:1).
  Sheet 3: exploded isometric along the assembly path (1:4), interface table.
  Sheet 4: test configuration on the desk rig (1:3, full assembly, interface envelope), mass properties,
           balancing procedure.
All meshes in rocket coordinates: z = axis (0 at the tail), x = gimbal axis X, y = gimbal axis Y.
"""
import os, numpy as np, trimesh
from matplotlib.patches import Circle, Polygon, Arc
from matplotlib.collections import LineCollection
from matplotlib.backends.backend_pdf import PdfPages
from shapely.geometry import Polygon as SPoly, LineString, box as sbox
import sldp_sheet as S
from sldp_sheet import (L, poly, box, txt, arrow, dim_h, dim_v, leader, balloon, draw_lines, notes_block,
                        caption, cg_symbol, THICK, THIN, CL, PH, CP, FS, K)
import hlr, body_model as BM
from servos import assemble_servos

here = os.path.dirname(os.path.abspath(__file__)); os.chdir(here)
DWG, TITLE, NSH = 'SLDP-GA-004', 'ROCKET GENERAL ASSEMBLY', 4
DATE = '2026-11-07'
_frame = S.frame
S.frame = lambda *a, **k: _frame(*a, date=DATE, rev_rows=(('A', 'INITIAL RELEASE (SUPERSEDES SLDP-GA-003)', DATE),
                                                          ('B', 'ADDED SHEET 3: CONFIGURATIONS + MASS PROPS', DATE),
                                                          ('C', '4 SHEETS: ASSEMBLY VIEWS ADDED, REORDERED', DATE)), **{'rev': 'C', **k})
TRAVEL = 8.0
EDF_OD, EDF_L, HUB_D, HUB_L = 31.6, 45.0, 16.0, 28.0
G = None
BB_L, BB_W, BB_T = 83.0, 55.0, 8.5

def T(m, v=(0, 0, 0), rz=0.0):
    g = m.copy()
    if rz: g.apply_transform(trimesh.transformations.rotation_matrix(np.radians(rz), [0, 0, 1]))
    g.apply_translation(v); return g

# ---------------------------------------------------------------- model in rocket coordinates
BODY = {n: trimesh.load(n + '.stl') for n in
        ['A_lower_body', 'B_avionics_bay', 'C1_coupler', 'C2_interstage_coupler', 'D_upper_body', 'E_nose_cone', 'G_bay_door']}
FINS = []                                   # ST-008: tail fins deleted (strakes are part of body part A)
GF0 = trimesh.load('H_grid_fin_x4.stl'); GFINS = [T(GF0, rz=90 * k) for k in range(4)]
outer, inner, tube, servo_f, servo_r = [T(m, (0, 0, BM.GIMBAL_Z)) for m in assemble_servos(0, 0)]
TVC = [outer, inner, tube, servo_f, servo_r]
G = BM.GIMBAL_Z
SLED = T(trimesh.load('sled.stl'), (0, 0, BM.SLED_Z0))
PARTS_CQ, FINS_CQ = BM.build()
_, REP = BM.report(PARTS_CQ, FINS_CQ)
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
def sheet_section():
    fig = S.new_sheet()
    sc = 0.5; SX, SY = 45.0, 206.0
    P = lambda z, h: (SX + sc * z, SY + sc * h)                            # section coords: z right, h = -y up
    to2d = lambda v: np.c_[SX + sc * v[:, 2], SY - sc * v[:, 1]]
    styles = ([(m, True, 0, 1) for m in BODY.values()] +
              [(outer, False, 45, 0.7), (inner, False, 135, 0.7), (tube, False, 45, 0.55), (SLED, False, 135, 0.7),
               (servo_r, False, 0, 0.8)])
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
    bal(4, 0, -12, -14); bal(5, Z0 + 70, -(FY + BB_T / 2), 4); bal(6, Z0 + 70, -(FY + BB_T + 5), 16)
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
    S.ax.add_patch(Circle(P(38, 0), 33, fill=False, ec=K, lw=THIN, ls=PH, zorder=5)); txt(SX + sc * 38 + 26, SY + 26, 'B', fontweight='bold')
    leader(P(BM.Z_NOSE + 20, 0), (SX + sc * (BM.Z_NOSE + 20) - 4, SY - 47), 'NOSE BALLAST COLUMN', fs=FS - 2.5)
    leader(P((BM.OPEN_Z0 + BM.OPEN_Z1) / 2, -BM.RO - 1), (SX + sc * 440, SY - 24), 'DOOR AT 90° (ST-008 ITEM 8)', fs=FS - 2.5)
    caption(SX + sc * BM.TOP / 2 + 40, SY - 70, 'SECTION A-A  SCALE 1:2  (BACKGROUND OMITTED)')

    # ---------------- DETAIL B (1:1): tail, motor tube +/-8 deg about gimbal axis X ----------------
    DX, DY = 30.0, 66.0                                                  # sheet point of z = 0, h = 0
    zlo, zhi, hlim = -28.0, 104.0, 46.0
    clip = sbox(zlo, -hlim, zhi, hlim)
    Pd = lambda z, h: (DX + (z - zlo), DY + h)
    to2d_d = lambda v: np.c_[v[:, 2], -v[:, 1]]
    styles_d = [(BODY['A_lower_body'], True, 0, 1), (outer, False, 45, 1.4), (inner, False, 135, 1.4), (tube, False, 45, 1.0),
                (servo_r, False, 0, 1.2)]
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
        rect = [Pd(G - 57, -17.5), Pd(G + 57, -17.5), Pd(G + 57, 17.5), Pd(G - 57, 17.5)]
        poly([rot2(p, c, s * TRAVEL) for p in rect], THIN, PH)
        a0, a1 = rot2(Pd(G - 71, 0), c, s * TRAVEL), rot2(Pd(G - 53, 0), c, s * TRAVEL); L([a0[0], a1[0]], [a0[1], a1[1]], THIN)
    L([Pd(zlo - 6, 0)[0], Pd(zhi + 4, 0)[0]], [DY, DY], THIN, CL)
    S.ax.add_patch(Circle(c, 1.0, fc=K, ec=K, zorder=6))
    R = BM.GIMBAL_Z + 12
    S.ax.add_patch(Arc(c, 2 * R, 2 * R, theta1=180 - TRAVEL - 4, theta2=180 + TRAVEL + 4, lw=THIN, color=K, zorder=5))
    for s in (-1, 1):
        te, to = np.radians(180 + s * TRAVEL), np.radians(180 + s * (TRAVEL + 4))
        arrow(c + R * np.array([np.cos(to), np.sin(to)]), c + R * np.array([np.cos(te), np.sin(te)]))
    txt(c[0] - R - 2, c[1] + R * np.sin(np.radians(TRAVEL + 6)) + 3, f'{TRAVEL:.0f}° TYP', ha='right', fs=FS - 2)
    rad = BM.RI - 17.5 * np.cos(np.radians(TRAVEL)) - 57 * np.sin(np.radians(TRAVEL))
    leader(Pd(BM.GIMBAL_Z + 20, 32), (DX + 142, DY + 18), 'ITEM 2 TVC MOUNT', fs=FS - 2.5)
    leader(Pd(5, -10), (DX + 142, DY - 20), 'ITEM 4 EDF (SECTION, REF)', fs=FS - 2.5)
    leader(Pd(BM.NOTCH_TOP - 4, BM.RO + 0.5), (DX + 142, DY + 33), 'TAIL NOTCH, RIDING SERVO\n(ST-008; SERVO IN SECTION)', fs=FS - 2.5)
    leader(Pd(90, BM.RO), (DX + 142, DY + 46), 'ITEM 1 BODY, PART A', fs=FS - 2.5)
    yq = DY - 40
    L([Pd(G - 57, 0)[0]] * 2, [Pd(0, -17.5)[1] - 1.5, yq - 2], THIN); L([Pd(0, 0)[0]] * 2, [Pd(0, -BM.RO)[1] - 1.5, yq - 2], THIN)
    S.dim_h(yq, Pd(G - 57, 0)[0], Pd(0, 0)[0], f'{57 - G:g}', fs=FS - 2)
    txt(DX + 142, DY - 32, f'MOTOR TUBE + EDF EXIT {57 - G:g} BELOW THE TAIL', ha='left', fs=FS - 2.5, style='italic')
    caption(DX + (zhi - zlo) / 2, DY - 50, 'DETAIL B  SCALE 1:1')

    # ---------------- NOTES ----------------
    txt(178, 21.5, 'PARTS LIST AND NOTES: SHEET 1.', ha='left', fs=FS - 2.5, fontweight='bold')
    S.frame(2, NSH, DWG, TITLE, scale='AS SHOWN', mass=f'~{REP["M"]:.0f} g', material='SEE LIST', revisions=False)
    return fig

# =========================================================================== SHEET 2
def screw(axis, sign, pos, length):
    head = trimesh.creation.cylinder(radius=2.85, height=1.65, sections=32); head.apply_translation((0, 0, 0.825))
    shank = trimesh.creation.cylinder(radius=1.5, height=length, sections=24); shank.apply_translation((0, 0, -length / 2))
    s = trimesh.util.concatenate([head, shank]); tgt = np.zeros(3); tgt[axis] = sign
    s.apply_transform(trimesh.geometry.align_vectors((0, 0, 1), tgt)); s.apply_translation(pos); return s

def sheet_exploded():
    fig = S.new_sheet()
    DZ = {'tvc': -150.0, 'A': 0.0, 'sled': 70.0, 'B': 200.0, 'D': 235.0, 'E': 270.0}
    PULL = 22.0
    ex, tag = [], []
    def add(m, dz, t): ex.append(T(m, (0, 0, dz))); tag.append(t)
    for m in TVC: add(m, DZ['tvc'], 2)
    add(BODY['A_lower_body'], DZ['A'], 'A'); add(BODY['C1_coupler'], DZ['A'], 1)
    for f in FINS: add(f, DZ['A'], 1)
    for k, gf in enumerate(GFINS):
        a = np.radians(45 + 90 * k); add(T(gf, (18 * np.cos(a), 18 * np.sin(a), 0)), DZ['B'], 'H')
    add(SLED, DZ['sled'], 3)
    add(BODY['B_avionics_bay'], DZ['B'], 'B')
    ex.append(T(BODY['G_bay_door'], (0, 30, DZ['B']))); tag.append('G')
    add(screw(1, 1, (0, BM.RO + 30 + 14, BM.DOOR_SCREW_Z), 6.0), DZ['B'], 9)
    add(BODY['C2_interstage_coupler'], DZ['D'], 1); add(BODY['D_upper_body'], DZ['D'], 1)
    add(BODY['E_nose_cone'], DZ['E'], 1)
    RO = BM.RO
    for s in (-1, 1): add(screw(0, s, (s * (RO + PULL), 0, BM.GIMBAL_Z), 6.0), 0, 9)
    for dz in BM.SLED_BOSS_Z:
        for s in (-1, 1): add(screw(0, s, (s * (RO + PULL), 0, Z0 + dz), 8.0), DZ['B'], 10)
    d, up = (-0.35, -0.8, -0.5), (-1, 0, 0)
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
    bl(1, ex[tag.index('A')], (0, RO, 120), (-8, -26)); bl(1, ex[tag.index('B')], (0, RO, 230 + DZ['B']), (-4, -26))
    bl(2, ex[2], (0, 17.5, BM.GIMBAL_Z + DZ['tvc'] + 20), (-14, -22))
    bl(3, ex[tag.index(3)], (0, FY, Z0 + 50 + DZ['sled']), (-6, -30))
    gm = ex[tag.index('G')]; q = Pj(surf(gm, gm.vertices.mean(0) + (0, 10, 0))); leader(q, q + np.array([18, 16]), 'DOOR (ST-008 ITEM 8)', fs=FS - 3)
    p = Pj((-(RO + PULL + 2), 0, BM.GIMBAL_Z)); balloon(p, p + np.array([-12, 18]), 9)
    p = Pj((-(RO + PULL + 2), 0, Z0 + BM.SLED_BOSS_Z[1] + DZ['B'])); balloon(p, p + np.array([-6, 20]), 10)
    caption(215, 147, 'EXPLODED ISOMETRIC VIEW (ASSEMBLY PATH)  SCALE 1:4')
    # interface table
    tx, ty, rh = 18.0, 128.0, 5.6
    cols = [(0, 62, 'INTERFACE'), (62, 64, 'FASTENING'), (126, 104, 'LOCATION / NOTE')]
    rows = [('2 TVC MOUNT -> BODY PART A', '2X ITEM 9, M3 X 6', f'Z {G:g}, 0°/180°. RIDING SERVO IN THE TAIL NOTCH (280°).'),
            ('3 SLED -> BODY PART B', '4X ITEM 10, M3 X 8', f'Z {Z0 + 3:.0f} / {Z0 + 97:.0f}, 0°/180°. IN FROM BELOW, DOOR OFF.'),
            ('4 EDF -> MOTOR TUBE', 'TAPE SHIM + HOT GLUE', f'EXHAUST {57 - G:g} BELOW THE TAIL. DUCT OD MAX 31.6.'),
            ('5 BREADBOARD -> SLED', 'ADHESIVE + 2 ZIP TIES', 'FACE C (TOWARD THE DOOR), IMU AT THE BOTTOM.'),
            ('BODY A <-> B', 'C1 + 2X ITEM 9', f'Z {BM.Z_AB:g}-{BM.Z_B0:g}. DRILL C1 Ø2.5. REMOVABLE (SLED ACCESS).'),
            ('BODY B <-> D', 'C2 + 2X ITEM 9', f'Z {BM.Z_BT:g}-{BM.Z_S2:g}. DRILL C2 Ø2.5. REMOVABLE.'),
            ('BODY D <-> NOSE', 'SHOULDER + 2X ITEM 9', f'Z {BM.Z_NOSE:g}. DRILL SHOULDER Ø2.5.'),
            ('DOOR -> B + SLED RING', '2 TABS + 1X ITEM 9', f'90°, Z {BM.OPEN_Z0:g}-{BM.OPEN_Z1:g}. DRILL SLED RING Ø2.5.'),
            ('ESC 8 (DESK) -> EDF', '3 TWISTED PHASE WIRES', 'UP INSIDE A + B, OUT THE DOOR CABLE NOTCH.'),
            ('GRID FINS -> BODY PART B', 'CA, BONDED', f'4X AT 45° + 90° X, Z {BM.GF_Z0:g}-{BM.GF_Z0 + BM.GF_H:g} (BOOSTER STYLING).'),
            ('ROCKET -> DESK RIG', 'RIG COLLAR (SLDP-GS-001)', f'PIVOT AT MEASURED CG (~{CGZ:.0f} REF); FULL COLLAR BELOW 238.'),
            ('ROCKET -> LAUNCH MOUNT', 'SEATED, NO FASTENERS', 'SLDP-GS-003: TAIL ON 10 CLAMP LEDGES, NOTCH OVER THE GAP.')]
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
    txt(18, 40, 'PARTS LIST AND NOTES: SHEET 1.  ASSEMBLY SEQUENCE: SHEET 1 NOTE 2.', ha='left', fs=FS - 2.5, fontweight='bold')
    S.frame(3, NSH, DWG, TITLE, scale='1:4', mass=f'~{REP["M"]:.0f} g', material='SEE LIST', revisions=False)
    return fig

# =========================================================================== SHEET 2: test configuration + mass properties
def mass_rows():
    names = {'A_lower_body': 'A LOWER BODY + STRAKES', 'B_avionics_bay': 'B AVIONICS BAY', 'C1_coupler': 'C1 COUPLER',
             'C2_interstage_coupler': 'C2 HOT-STAGING RING', 'D_upper_body': 'D SHIP BODY + AFT FLAPS',
             'E_nose_cone': 'E NOSE + BALLAST COLUMN', 'G_bay_door': 'G DOOR', 'H_grid_fin': 'H GRID FINS (4X)'}
    rows = []
    for n, wp in PARTS_CQ.items():
        V, Tt = BM.tri(wp); g, zc, _ = BM.props(V, Tt)
        rows.append((names[n], g * (4 if n == 'H_grid_fin' else 1), zc))
    for nm, m, z in BM.COMPONENTS:
        rows.append((nm.upper(), m, z if z is not None else BM.SLED_Z0 + BM.SLED_H / 2))
    return rows

def sheet_test():
    fig = S.new_sheet()
    d, up = (0, -1, 0), (0, 0, 1)                         # from +Y: the door side

    # ---------------- TEST CONFIGURATION ON THE DESK RIG, 1:3, full assembly ----------------
    s2, TX, py = 1 / 3, 160.0, 124.0                      # rocket axis x, pivot (CG) height on the sheet
    meshes = list(BODY.values()) + GFINS + TVC + [SLED]
    lines, _, (r, u) = hlr.view_lines(meshes, d, up)
    r, u = np.asarray(r), np.asarray(u); ref = np.array([0, 0, CGZ])
    O = np.array([TX - s2 * (ref @ r), py - s2 * (ref @ u)])
    S.ax.add_collection(LineCollection([O + s2 * l for ls in lines.values() for l in ls], colors=K, linewidths=THICK * 0.7,
                                       capstyle='butt', joinstyle='round', zorder=3))
    ytail, ytop = py - s2 * CGZ, py + s2 * (BM.TOP - CGZ)
    L([TX, TX], [ytail + s2 * BM.EXHAUST_Z - 4, ytop + 5], THIN, CL)
    reach, ph = 210.0, 40.0
    dtop, dedge = py - s2 * ph, TX - s2 * reach
    desk_pg = SPoly([(dedge - 50, dtop - 8), (dedge, dtop - 8), (dedge, dtop), (dedge - 50, dtop)])
    L(*np.array(desk_pg.exterior.coords).T, THICK * 0.8); hatch(desk_pg, 45, 1.6)
    txt(dedge - 25, dtop - 12, 'DESK', fs=FS - 3.5)
    # rig envelope (phantom, SLDP-GS-001 concept): base, post, arm, pivot ring with pins at 0/180 deg
    rr = s2 * 58
    poly([(dedge - 44, dtop), (dedge - 4, dtop), (dedge - 4, dtop + 2), (dedge - 44, dtop + 2)], THIN, PH)
    L([dedge - 12, dedge - 12], [dtop + 2, py], THIN, PH); L([dedge - 12, TX - rr], [py, py], THIN, PH)
    poly([(TX - rr, py - 1.6), (TX + rr, py - 1.6), (TX + rr, py + 1.6), (TX - rr, py + 1.6)], THIN, PH)
    for sx in (-1, 1): S.ax.add_patch(Circle((TX + sx * s2 * BM.RO, py), 1.1, fc='white', ec=K, lw=THIN, zorder=6))
    cg_symbol((TX, py), r=2.6)
    for sgn in (-1, 1):                                   # +/-30 deg swing arcs of the exhaust and the nose
        a_ = np.radians(np.linspace(-90, -90 + sgn * 30, 40))
        rt = s2 * (CGZ - BM.EXHAUST_Z); rn = s2 * (BM.TOP - CGZ)
        L(TX + rt * np.cos(a_), py + rt * np.sin(a_), THIN, PH)
        L(TX - rn * np.cos(a_), py - rn * np.sin(a_), THIN, PH)
    rt = s2 * (CGZ - BM.EXHAUST_Z)
    txt(TX + rt * 0.5 + 3, py - rt * 0.87 + 1, '±30° STOPS', ha='left', fs=FS - 3)
    # envelope dimensions (REF): reach from the desk edge, pivot height
    yd = ytail + s2 * BM.EXHAUST_Z - 6
    L([dedge, dedge], [dtop - 9.5, yd - 2], THIN)
    dim_h(yd, dedge, TX, f'≥{reach:g}', fs=FS - 2.5)
    L([dedge - 52, dedge - 60], [dtop] * 2, THIN); L([dedge - 14, dedge - 60], [py] * 2, THIN)
    dim_v(dedge - 57, dtop, py, f'{ph:g}', fs=FS - 2.5)
    lx = TX + 34
    leader((TX + s2 * BM.RO + 1.2, py), (lx, py + 26), f'PIVOT AT THE MEASURED CG (~{CGZ:.0f} REF),\nPINS AT 0°/180°, 2-AXIS, ROLL LOCKED.\nA FULL COLLAR MUST STAY BELOW Z 238\n(DOOR FRAME).', fs=FS - 3.5)
    leader((TX + s2 * 8, py - s2 * (CGZ - BM.OPEN_Z0 - 4)), (lx, py - 6), 'TETHER OUT THE\nDOOR CABLE NOTCH', fs=FS - 3.5)
    leader((TX + s2 * 10, ytail + s2 * BM.EXHAUST_Z + 3), (lx, py - 50), 'EXHAUST DOWN, PAST\nTHE DESK EDGE', fs=FS - 3.5)
    caption(TX - 20, yd - 9, 'TEST CONFIGURATION ON THE DESK RIG (SLDP-GS-001 ENVELOPE)  SCALE 1:3')

    # ---------------- MASS PROPERTIES ----------------
    rows = mass_rows()
    M = sum(m for _, m, _ in rows); cg = sum(m * z for _, m, z in rows) / M
    kx, ky, kw, kh = 287.0, 252.0, 26.6, 13.0
    kpis = [('MASS', f'{M:.0f} g'), ('CG', f'{cg:.0f} mm'), ('LEVER ARM', f'{REP["arm"] * 1000:.0f} mm'),
            ('I_CG', f'{REP["Icg"] * 1e4:.0f} kg·cm²'), ('AUTHORITY', f'{REP["alpha"]:.0f} °/s²')]
    for j, (lab, val) in enumerate(kpis):
        x = kx + j * kw; box(x, ky - kh, x + kw, ky, lw=THIN)
        txt(x + kw / 2, ky - 3.2, lab, fs=FS - 4.5); txt(x + kw / 2, ky - 8.5, val, fs=FS - 2, fontweight='bold')
    txt(kx, ky + 4, 'MASS PROPERTIES (ESTIMATE, WEIGH AND UPDATE)', ha='left', fontweight='bold', fs=FS - 2.5)
    txt(kx, ky - kh - 3.5, f'AUTHORITY AT {BM.GIMBAL_DEG}° GIMBAL, {BM.THRUST_G} G THRUST. Z FROM THE TAIL.', ha='left', fs=FS - 4.5)
    ty, rh, cw = ky - kh - 8, 4.6, (75, 29, 29)
    for j, row in enumerate([('PART / COMPONENT', 'MASS g', 'Z mm')] + [(n, f'{m:.0f}', f'{z:.0f}') for n, m, z in rows]):
        y = ty - j * rh; x = kx
        if j == 0: S.ax.add_patch(Polygon([(kx, y - rh), (kx + sum(cw), y - rh), (kx + sum(cw), y), (kx, y)], fc='#efefef', ec='none', zorder=1))
        for k, (w, v) in enumerate(zip(cw, row)):
            txt(x + (2 if k == 0 else w / 2), y - rh / 2, v, ha='left' if k == 0 else 'center', fs=FS - 4.5,
                fontweight='bold' if j == 0 else 'normal'); x += w
        L([kx, kx + sum(cw)], [y - rh] * 2, THIN * (1.0 if j == 0 else 0.5))
    yb = ty - (len(rows) + 1) * rh
    box(kx, yb, kx + sum(cw), ty, lw=THIN)
    txt(kx + sum(cw) - 2, yb - 3.5, f'TOTAL {M:.0f} g, CG {cg:.0f}', ha='right', fs=FS - 4, fontweight='bold')
    notes_block(kx, yb - 9, ['BALANCING PROCEDURE:',
        '1. WEIGH EVERY PART; UPDATE COMPONENTS IN SLDP-ST-008.',
        '2. ASSEMBLE COMPLETE (DOOR ON, TETHER CONNECTED).',
        '3. BALANCE ON A KNIFE EDGE ACROSS 0°/180°; MARK THE CG.',
        '4. TRIM: NOSE BALLAST WASHERS RAISE THE CG, TAIL WEIGHT',
        '   LOWERS IT. SET THE RIG PIVOT ON THE MARK.',
        '5. A FEW MM NOSE-HEAVY = INVERTED-PENDULUM DEMO.'], fs=FS - 3.5, pitch=4.5)
    S.frame(4, NSH, DWG, TITLE, scale='AS SHOWN', mass=f'~{REP["M"]:.0f} g', material='SEE LIST', revisions=False)
    return fig


# =========================================================================== SHEET 1: assembly views, parts list, notes
PARTS = [(1, 1, 'ROCKET BODY, SHIP ON BOOSTER  (SLDP-ST-008)', 'ASSY'), (2, 1, 'TVC MOUNT + 2X MG90S  (SLDP-TVC-002)', 'ASSY'),
         (3, 1, 'AVIONIC SLED V1  (SLDP-AV-001)', 'PLA'), (4, 1, 'EDF QX 30 MM 7000KV', 'PURCHASED'),
         (5, 1, 'BREADBOARD, HALF-SIZE', 'PURCHASED'), (6, 1, 'ARDUINO NANO', 'PURCHASED'),
         (7, 1, 'MPU-6050 IMU', 'PURCHASED'), (8, 1, 'ESC 20 A - OFF-BOARD, ON DESK', 'PURCHASED'),
         (9, 9, 'SCREW M3 X 6 BUTTON HD', 'STEEL'), (10, 4, 'SCREW M3 X 8 BUTTON HD', 'STEEL')]

def sheet_assembly():
    fig = S.new_sheet()
    meshes = list(BODY.values()) + GFINS + TVC + [SLED]
    sc = 0.5
    # ---------------- FRONT VIEW (from +Y, door side), axis horizontal, tail left, 1:2 ----------------
    FX, AY = 48.0, 202.0                                   # sheet x of z = 0, axis height
    d, up = (0, -1, 0), (1, 0, 0)
    lines, _, (r, u) = hlr.view_lines(meshes, d, up)
    r, u = np.asarray(r), np.asarray(u)
    Pf = lambda p: np.array([FX + sc * (np.asarray(p, float) @ r), AY + sc * (np.asarray(p, float) @ u)])
    O = Pf((0, 0, 0)) - 0
    S.ax.add_collection(LineCollection([np.array([FX, AY]) + sc * l for ls in lines.values() for l in ls], colors=K,
                                       linewidths=THICK * 0.75, capstyle='butt', joinstyle='round', zorder=3))
    xz = lambda z: FX + sc * z
    L([xz(BM.EXHAUST_Z) - 5, xz(BM.TOP) + 6], [AY, AY], THIN, CL)
    cg_symbol((xz(CGZ), AY), 2.6)
    leader((xz(CGZ) + 1.8, AY + 1.8), (xz(CGZ) + 22, AY + 44), f'CG ~{CGZ:.0f} FROM THE TAIL (REF, SHEET 4)', fs=FS - 3)
    span = BM.RO + BM.AFT_FLAP[2]
    yd = AY - sc * span - 10
    L([xz(0)] * 2, [AY - sc * BM.RO - 1.5, yd - 2], THIN); L([xz(BM.TOP)] * 2, [AY - 1.5, yd - 2], THIN)
    L([xz(BM.EXHAUST_Z)] * 2, [AY - sc * 17.5 - 1.5, yd - 12], THIN); L([xz(0)] * 2, [yd - 2, yd - 12], THIN)
    dim_h(yd, xz(0), xz(BM.TOP), f'{BM.TOP:.1f}', fs=FS - 2)
    S.dim_h(yd - 10, xz(BM.EXHAUST_Z), xz(0), f'{-BM.EXHAUST_Z:g} MOTOR TUBE BELOW THE TAIL', fs=FS - 3)
    p = Pf((0, 0, 120)) + np.array([0, sc * BM.RO]); balloon(p, p + np.array([-8, 22]), 1)
    p = Pf((0, 0, BM.EXHAUST_Z + 6)) + np.array([0, sc * 17.5]); balloon(p, p + np.array([-10, 24]), 2)
    leader(Pf((0, 0, (BM.OPEN_Z0 + BM.OPEN_Z1) / 2)) + np.array([sc * 15, sc * 8]), (xz(330), AY + 40), 'DOOR AT 90° (FACING THE VIEWER)', fs=FS - 3)
    caption(xz(BM.TOP / 2), yd - 16, 'ASSEMBLED, FROM THE DOOR SIDE (+Y)  SCALE 1:2')

    # ---------------- VIEW C: looking forward from the tail, 1:2 ----------------
    CX, CY = 70.0, 92.0
    dC, upC = (0, 0, 1), (0, 1, 0)
    linesC, _, (rC, uC) = hlr.view_lines(meshes, dC, upC)
    S.ax.add_collection(LineCollection([np.array([CX, CY]) + sc * l for ls in linesC.values() for l in ls], colors=K,
                                       linewidths=THICK * 0.7, capstyle='butt', joinstyle='round', zorder=3))
    rC, uC = np.asarray(rC), np.asarray(uC)
    Pc = lambda deg, rad: np.array([CX, CY]) + sc * rad * np.array([np.cos(np.radians(deg)) * rC[0] + np.sin(np.radians(deg)) * rC[1],
                                                                    np.cos(np.radians(deg)) * uC[0] + np.sin(np.radians(deg)) * uC[1]])
    for deg in (0, 90):
        a0, a1 = Pc(deg, span + 6), Pc(deg + 180, span + 6); L([a0[0], a1[0]], [a0[1], a1[1]], THIN, CL)
    yS = CY + sc * span + 9
    for deg in (0, 180):
        q = Pc(deg, span); L([q[0]] * 2, [q[1] + 1.5, yS + 2], THIN)
    dim_h(yS, min(Pc(0, span)[0], Pc(180, span)[0]), max(Pc(0, span)[0], Pc(180, span)[0]), f'{2 * span:.1f} OVER FLAPS', fs=FS - 3)
    scr = lambda deg, rad: np.array([CX + sc * rad * np.cos(np.radians(deg)), CY + sc * rad * np.sin(np.radians(deg))])   # screen polar
    pb = scr(200, BM.RO); leader(pb, pb + np.array([-12, -26]), f'Ø{BM.OD:.1f} BODY', ha='right', fs=FS - 3)
    t0 = Pc(0, span + 8); txt(t0[0] + (2 if t0[0] > CX else -2), t0[1] + 3.5, '0° = GIMBAL\nAXIS X', ha='left' if t0[0] > CX else 'right', fs=FS - 4)
    t9 = Pc(90, BM.RO + 9); txt(t9[0], t9[1], 'DOOR 90°', fs=FS - 4)
    leader(Pc(280, BM.RO - 6), Pc(280, BM.RO) + np.array([26, -18]), 'TAIL NOTCH 280°', fs=FS - 3)
    gfa = max((45, 135, 225, 315), key=lambda a: (Pc(a, 1)[0] - CX) + (Pc(a, 1)[1] - CY))       # the fin at upper right on screen
    pg = Pc(gfa, BM.RO + 2 + BM.GF_SPAN); leader(pg, pg + np.array([8, 14]), 'GRID FINS\n45° + 90° X', fs=FS - 3)
    sa = max(BM.STRAKE_ANGLES, key=lambda a: (Pc(a, 1)[0] - CX) - (Pc(a, 1)[1] - CY))     # strake at lower right on screen
    ps = Pc(sa, BM.RO + BM.STRAKE_H - 0.3); leader(ps, ps + np.array([22, -6]), 'STRAKES\n55° + 90° X', fs=FS - 3)
    caption(CX, CY - sc * span - 14, 'VIEW C: FROM THE TAIL, LOOKING FORWARD\n(ANGLES CW HERE, CCW FROM THE NOSE)  SCALE 1:2')

    # ---------------- NOTES ----------------
    notes_block(132, 140, ['NOTES:',
        '1. ASSEMBLY DRAWING: ALL DIMENSIONS REFERENCE. SUB-ASSEMBLIES PER THEIR OWN DRAWINGS.',
        '2. ORDER: TVC INTO A FROM THE TAIL (9) -> SLED INTO B FROM BELOW, DOOR OFF (10) -> TETHER',
        '   THROUGH C1 -> B ONTO C1 -> D + C2 ONTO B -> NOSE -> DOOR. EXPLODED: SHEET 3;',
        '   FULL SEQUENCE: SLDP-ST-008 SHEET 2. INTERFACES + FASTENING: SHEET 3.',
        '3. CLOCKING: GIMBAL AXIS X = BODY 0° (M3 HOLES); IMU X/Y ALIGNED TO GIMBAL AXES X/Y.',
        '4. ITEMS 4-7 ARE INTERNAL: PHANTOM / ENVELOPE ON SHEET 2. ITEM 8 ESC IS OFF-BOARD ON THE DESK.',
        '5. BALANCE THE COMPLETE ROCKET (RIG COLLAR + TETHER ON) TO SET THE RIG PIVOT: SHEET 4.',
        '6. FINISH: BOOSTER A, B, C1, C2 + DOOR STAINLESS-LOOK SILVER; SHIP D, E, GRID FINS + C2 POCKETS BLACK.',
        '7. DISPLAY ON THE SLDP-GS-003 LAUNCH MOUNT, TAIL NOTCH OVER ITS CLAMP GAP.',
        '',
        'SHEETS: 1 ASSEMBLY + PARTS LIST   2 SECTION A-A + DETAIL B   3 EXPLODED + INTERFACES',
        '        4 TEST CONFIGURATION + MASS PROPERTIES'], fs=FS - 4, pitch=4.3)
    tbx, tby, tbw, tbh = S.frame(1, NSH, DWG, TITLE, scale='1:2', mass=f'~{REP["M"]:.0f} g', material='SEE LIST')
    S.parts_list(tbx, tby + tbh, PARTS, rh=5.2)
    return fig

if __name__ == '__main__':
    base = os.path.join(here, 'SLDP-GA-004_rocket_ga')
    figs = [sheet_assembly(), sheet_section(), sheet_exploded(), sheet_test()]
    with PdfPages(base + '.pdf') as pdf:
        for f in figs: pdf.savefig(f)
    for n, f in enumerate(figs, 1): f.savefig(f'{base}_sheet{n}.png', dpi=170)
    print('ok')
