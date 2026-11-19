"""
SLDP-GS-001  Desk rig (2-axis gimbal on a desk-edge arm), Rev A -- 3 sheets.
  Sheet 1: elevation with the rocket on the rig at the desk edge (1:3, +/-30 deg swing, balloons), notes, parts list.
  Sheet 2: top view (1:2) with cutting planes, section A-A (inner pivot) and B-B (outer pivot) at 2:1, detail C stop (3:1).
  Sheet 3: view D collar half and view E pivot tab (2:1), pivot setup notes.
Run SLDP-GS-001_desk_rig.py first. The rocket outline needs the ST-008 part STLs in assembly position (run the ST-008
model; looked for in ../../SLDP-ST-008_rocket-body/source or ../../st008/source).
"""
import os, importlib.util, numpy as np, trimesh
from matplotlib.collections import LineCollection
from matplotlib.patches import Circle, Polygon, Arc
from matplotlib.backends.backend_pdf import PdfPages
from shapely.geometry import Polygon as SPoly, LineString, box as sbox
import sldp_sheet as S
from sldp_sheet import L, poly, box, txt, arrow, dim_h, dim_v, leader, balloon, notes_block, caption, cg_symbol, THICK, THIN, CL, PH, CP, FS, K
import hlr

here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('rig', os.path.join(here, 'SLDP-GS-001_desk_rig.py'))
R = importlib.util.module_from_spec(spec); spec.loader.exec_module(R)
DWG, TITLE, DATE = 'SLDP-GS-001', 'DESK RIG (2-AXIS GIMBAL)', '2026-11-09'
LD = lambda n: trimesh.load(os.path.join(here, n))
ITEMS = {k: LD(f'gs001_{k}.stl') for k in ('1_collar_half_a', '1_collar_half_b', '2_pivot_tab_a', '2_pivot_tab_b',
                                            '3_middle_ring', '4_outer_ring', '5_arm', '6_base')}
HW = [LD(f'gs001_hw_{g}.stl') for g in ('rocket', 'middle', 'outer')]
RIG = list(ITEMS.values())
_st = next(d for d in (os.path.join(here, '..', '..', 'SLDP-ST-008_rocket-body', 'source'), os.path.join(here, '..', '..', 'st008', 'source'))
           if os.path.exists(os.path.join(d, 'A_lower_body.stl')))
ROCKET = []
for n in ('A_lower_body', 'B_avionics_bay', 'C2_interstage_coupler', 'D_upper_body', 'E_nose_cone', 'G_bay_door'):
    m = trimesh.load(os.path.join(_st, n + '.stl')); m.apply_translation((0, 0, -R.P_Z)); ROCKET.append(m)
gf = trimesh.load(os.path.join(_st, 'H_grid_fin_x4.stl')); gf.apply_translation((0, 0, -R.P_Z))
for k in range(4):
    g = gf.copy(); g.apply_transform(trimesh.transformations.rotation_matrix(np.radians(90 * k), [0, 0, 1])); ROCKET.append(g)
tube = trimesh.creation.cylinder(radius=17.5, segment=(( 0, 0, -R.P_Z - 20), (0, 0, -R.P_Z + 12)), sections=64); ROCKET.append(tube)
MASS_PRINT = sum(m.volume for k, m in ITEMS.items()) / 1000 * 1.24 * 0.5
pol = lambda deg, r, z=0.0: np.array([np.cos(np.radians(deg)) * r, np.sin(np.radians(deg)) * r, z])

def view(meshes, d, up, sc, ref3, ref2, lws=None, default=THICK * 0.8):
    lines, _, (r, u) = hlr.view_lines(meshes, d, up)
    r, u = np.asarray(r), np.asarray(u); ref3 = np.asarray(ref3, float)
    O = np.array([ref2[0] - sc * (ref3 @ r), ref2[1] - sc * (ref3 @ u)])
    for k, ls in lines.items():
        lw = (lws or {}).get(k, default)
        S.ax.add_collection(LineCollection([O + sc * l for l in ls], colors=K, linewidths=lw, zorder=3))
    return lambda p: O + sc * np.array([np.asarray(p, float) @ r, np.asarray(p, float) @ u])

def hatch(pg, angle, pitch, lw=THIN * 0.8):
    x0, y0, x1, y1 = pg.bounds; d = np.hypot(x1 - x0, y1 - y0) + 1; c = np.array([(x0 + x1) / 2, (y0 + y1) / 2])
    a = np.radians(angle); v = np.array([np.cos(a), np.sin(a)]); n = np.array([-v[1], v[0]]); segs = []
    for k in np.arange(-d / 2, d / 2, pitch):
        g = pg.intersection(LineString([c + n * k - v * d, c + n * k + v * d]))
        for gg in getattr(g, 'geoms', [g]):
            if not gg.is_empty and gg.geom_type == 'LineString': segs.append(np.array(gg.coords))
    S.ax.add_collection(LineCollection(segs, colors=K, linewidths=lw, zorder=3))

def section(mesh, normal, origin, to2d, angle, clip=None, pitch=1.2):
    sec = mesh.section(plane_origin=origin, plane_normal=normal)
    if sec is None: return
    region = None
    for loop in sec.discrete:
        pg = SPoly(to2d(loop)).buffer(0)
        region = pg if region is None else region.symmetric_difference(pg)
    if clip is not None: region = region.intersection(clip)
    for pg in getattr(region, 'geoms', [region]):
        if pg.is_empty or pg.geom_type != 'Polygon': continue
        for ring_ in [pg.exterior] + list(pg.interiors):
            c = np.array(ring_.coords); L(c[:, 0], c[:, 1], THICK * 0.8, z=4)
        hatch(pg, angle, pitch)

REVS = (('A', 'INITIAL RELEASE (REPLACES CONCEPT SKETCHES)', '2026-11-09'),
        ('B', 'ITEM 6 NUT TRAPS RAISED 5; ITEM 12 NOW M3 X 16', '2026-11-11'),)
PARTS = [(1, 2, 'COLLAR HALF (SAME PART X2), SHEET 3 VIEW D', 'PLA'),
         (2, 2, 'PIVOT TAB, PEG FOR THE STOP, SHEET 3 VIEW E', 'PLA'),
         (3, 1, f'MIDDLE RING Ø{2 * R.MR[0]:g}/Ø{2 * R.MR[1]:g} X {R.MR[2]:g}', 'PLA'),
         (4, 1, f'OUTER RING Ø{2 * R.OR[0]:g}/Ø{2 * R.OR[1]:g} X {R.OR[2]:g} + ARM STUB', 'PLA'),
         (5, 1, f'ARM {R.FL[0] - R.BASE_X[0]:.0f} X {R.ARM_W:g} X {R.ARM_Z[1] - R.ARM_Z[0]:g}', 'PLA, 40% INFILL'),
         (6, 1, f'BASE {R.BASE_X[1] - R.BASE_X[0]:.0f} X {R.BASE_W:g} X {R.DESK_H + R.ARM_Z[0]:g}', 'PLA, 40% INFILL'),
         (7, 4, 'SCREW M3 X 25 (PIVOT AXLES)', 'STEEL'),
         (8, 4, 'NUT M3 NYLON-INSERT LOCK (PIVOTS)', 'STEEL'),
         (9, 8, 'WASHER M3 (2 PER PIVOT)', 'STEEL'),
         (10, 2, 'SCREW M3 X 10, ITEM 1 TO ROCKET (WAS M3 X 6)', 'STEEL'),
         (11, 4, 'SCREW M3 X 8 + NUT (ITEM 2 TO ITEM 1)', 'STEEL'),
         (12, 4, 'SCREW M3 X 16 + NUT (ITEM 4 TO ITEM 5 FLANGE)', 'STEEL'),
         (13, 2, 'SCREW M3 X 40 + NUT (ITEM 5 TO ITEM 6)', 'STEEL'),
         (14, 2, 'C-CLAMP, 50 MM+ OPENING (ITEM 6 TO THE DESK)', 'PURCHASED')]

# ======================================================================== SHEET 1
def sheet1():
    fig = S.new_sheet()
    # ---------------- ELEVATION, 1:4, from -Y (+x right) ----------------
    sc, EX, EY = 1 / 3, 162.0, 128.0
    Pe = view(RIG + HW + ROCKET, (0, 1, 0), (0, 0, 1), sc, (0, 0, 0), (EX, EY),
              lws={k: THIN * 0.9 for k in range(len(RIG) + len(HW), len(RIG) + len(HW) + len(ROCKET))})
    X = lambda x: EX + sc * x; Z = lambda z: EY + sc * z
    ztail = -R.P_Z; ztop = 632.2 - R.P_Z; zex = ztail - 20
    L([X(0), X(0)], [Z(zex) - 4, Z(ztop) + 4], THIN, CL)
    L([X(-340), X(95)], [Z(0), Z(0)], THIN, CL)                                     # pivot plane trace
    cg_symbol((X(0), Z(0)), 2.2)
    # desk (top board) with a break line, clamps in phantom
    dx0 = -420.0; dpg = SPoly([(X(dx0), Z(-R.DESK_H - 25)), (X(-R.REACH), Z(-R.DESK_H - 25)), (X(-R.REACH), Z(-R.DESK_H)), (X(dx0), Z(-R.DESK_H))])
    for a_, b_ in ((( -R.REACH, -R.DESK_H - 25), (-R.REACH, -R.DESK_H)), ((dx0, -R.DESK_H), (-R.REACH, -R.DESK_H)), ((dx0, -R.DESK_H - 25), (-R.REACH, -R.DESK_H - 25))):
        L([X(a_[0]), X(b_[0])], [Z(a_[1]), Z(b_[1])], THICK * 0.8)
    hatch(dpg, 45, 1.6)
    zz = np.linspace(-R.DESK_H - 28, -R.DESK_H + 3, 7); xx = X(dx0) + np.array([0, 1.2, -1.2, 1.2, -1.2, 1.2, 0])
    L(xx, Z(zz), THIN)
    txt(X(dx0) + 6, Z(-R.DESK_H - 12.5), 'DESK', ha='left', fs=FS - 3.5, bbox=dict(fc='white', ec='none', pad=0.6))
    for xc in (R.BASE_X[0] + 12, R.BASE_X[1] - 12):                                  # C-clamps (phantom)
        pts = [(xc - 7, -R.DESK_H + 8), (xc - 7, -R.DESK_H + 14), (xc + 7, -R.DESK_H + 14), (xc + 7, -R.DESK_H - 50),
               (xc - 7, -R.DESK_H - 50), (xc - 7, -R.DESK_H - 44), (xc + 1, -R.DESK_H - 44), (xc + 1, -R.DESK_H - 25)]
        L([X(p[0]) for p in pts], [Z(p[1]) for p in pts], THIN, PH)
    leader((X(R.BASE_X[0] + 19), Z(-R.DESK_H - 40)), (X(-400), Z(-R.DESK_H - 70)), '2X C-CLAMP (14)', ha='left', fs=FS - 3.5)
    # +/-30 deg swing of the nose and the exhaust
    for sgn in (-1, 1):
        for rr, base in ((ztop, 90), (-zex, -90)):
            a_ = np.radians(np.linspace(base, base + sgn * R.STOP, 40))
            L(X(rr * np.cos(a_)), Z(rr * np.sin(a_)), THIN, PH)
    txt(X(ztop * np.sin(np.radians(R.STOP))) + 2, Z(ztop * np.cos(np.radians(R.STOP))) - 3, '±30° STOPS', ha='left', fs=FS - 3.5)
    for n, p3, off in ((1, (-30, -45, -32), (-24, -8)), (2, (R.x_tab1, -8, 6), (6, 28)), (3, (R.MR[1] - 2, -20, 2), (24, 2)),
                       (4, (R.OR[1] - 2, -20, -2), (26, -10)), (5, (-170, -12, 20), (0, 14))):
        p = Pe(p3); balloon(p, p + np.array(off), n)
    p = Pe((-305, -35, -30)); balloon(p, p + np.array([-14.0, 26.0]), 6)
    # dimensions (REF interface)
    yd = Z(zex) - 8
    L([X(-R.REACH)] * 2, [Z(-R.DESK_H - 25) - 1.5, yd - 2], THIN)
    dim_h(yd, X(-R.REACH), X(0), f'{R.REACH:g} (≥210)', fs=FS - 2.5)
    xv = X(-335)
    L([X(dx0) + 2, xv - 2], [Z(-R.DESK_H)] * 2, THIN)
    dim_v(xv, Z(-R.DESK_H), Z(0), f'{R.DESK_H:g}', fs=FS - 2.5)
    xr = X(90)
    L([X(R.RO) + 1.5, xr + 2], [Z(ztail)] * 2, THIN); L([X(95), xr + 2], [Z(0)] * 2, THIN)
    dim_v(xr, Z(ztail), Z(0), f'{R.P_Z:g} ±{R.ADJ:g}', side='right', fs=FS - 2.5)
    leader((X(-8), Z(5)), (X(-60), Z(120)), 'PIVOT AT THE MEASURED CG\n(BOTH AXES CROSS HERE)', ha='right', fs=FS - 3.5)
    leader((X(4), Z(zex + 4)), (X(150), Z(zex - 12)), 'EXHAUST DOWN, CLEAR\nOF THE DESK', fs=FS - 3.5)
    caption(EX - 20, yd - 9, 'ELEVATION AT THE DESK EDGE, ROCKET ON THE RIG (FROM -Y)  SCALE 1:3')

    tbx, tby, tbw, tbh = S.frame(1, 3, DWG, TITLE, rev='B', date='2026-11-11', scale='AS SHOWN', mass=f'~{MASS_PRINT:.0f} g', material='SEE LIST',
                                 rev_rows=REVS)
    S.parts_list(tbx, tby + tbh, PARTS[::-1], rh=4.4)
    notes_block(tbx + 1, 236, ['NOTES:',
        '1. ROCKET (SLDP-GA-004) HANGS ON ITEM 1, BOLTED THROUGH THE B LOWER',
        '   JOINT HOLES (90°/270°, Z 215). NOTHING CLAMPS ABOVE Z 238 (DOOR',
        '   FRAME). TETHER LEAVES THE DOOR NOTCH AT PIVOT HEIGHT.',
        '2. 2 AXES, ROLL LOCKED. INNER AXIS = TVC AXIS X (0°/180°), OUTER',
        '   AXIS = TVC AXIS Y (90°/270°). TOP VIEW AND SECTIONS: SHEET 2.',
        f'3. SET THE PIVOT ON THE MEASURED CG WITH THE ITEM 2 SLOTS (±{R.ADJ:g});',
        '   TRIM WITH THE NOSE BALLAST. A FEW MM NOSE-HEAVY = INVERTED PENDULUM.',
        '4. HARD STOPS ±30° ON EVERY PIVOT (PEG IN SLOT, SHEET 2 DETAIL C).',
        '   CHECKED: ROCKET CLEARS THE RIG BY ≥4.5 AND THE DESK BY ≥150',
        '   THROUGH ±29° ON BOTH AXES AT ALL PIVOT SETTINGS.',
        '5. CLAMP ITEM 6 WITH 2 C-CLAMPS BEFORE POWER-UP; KEEP THE FLOOR',
        '   UNDER THE EXHAUST CLEAR.',
        '6. PRINT ALL PARTS FLAT, NO SUPPORTS, 3 WALLS, 15-20% INFILL. PIVOT SETUP: SHEET 3.'], fs=FS - 3.5, pitch=4.5)
    return fig

# ======================================================================== SHEET 2
def pivot_hw(Xf, Yf, axis_pts, head_side, nut_side):
    """Pivot screw (not sectioned): head, shank, washers, nylon lock nut, drawn along a horizontal axis on the sheet.
    axis_pts: (x_head_face, x_nut_face, y) in sheet mm, scale already applied by the caller."""
    pass

def sheet2():
    fig = S.new_sheet(); sc = 2.0

    # ---------------- SECTION A-A (plane y = 0), +x inner pivot, 2:1 ----------------
    AX, AZ = 30.0, 205.0                                  # sheet position of model (x 36, z 0)
    XA = lambda x: AX + sc * (np.asarray(x) - 36.0); ZA = lambda z: AZ + sc * np.asarray(z)
    to2d = lambda v: np.c_[XA(v[:, 0]), ZA(v[:, 2])]
    clipA = sbox(XA(36.0), ZA(-46.0), XA(74.0), ZA(16.0))
    section(ITEMS['1_collar_half_a'], (0, 1, 0), (0, 0.01, 0), to2d, 45, clipA, pitch=1.3)
    section(ITEMS['2_pivot_tab_a'], (0, 1, 0), (0, 0.01, 0), to2d, 135, clipA, pitch=1.3)
    section(ITEMS['3_middle_ring'], (0, 1, 0), (0, 0.01, 0), to2d, 45, clipA, pitch=2.2)
    zt, zb = -R.P_Z + 203, -R.P_Z + 357
    poly([(XA(38.1), ZA(-46)), (XA(39.3), ZA(-46)), (XA(39.3), ZA(16)), (XA(38.1), ZA(16))], THIN, PH)   # rocket wall
    txt(XA(37.2), ZA(-43), 'ROCKET\nWALL', ha='right', fs=FS - 4)
    # pivot screw: head inside the tab, nyloc outside the middle ring
    xh0, xh1 = R.x_tab0 - 1.65, R.x_tab0
    poly([(XA(xh0), ZA(-2.85)), (XA(xh1), ZA(-2.85)), (XA(xh1), ZA(2.85)), (XA(xh0), ZA(2.85))], THIN)
    poly([(XA(xh1), ZA(-1.5)), (XA(R.MR[1] + 3.6), ZA(-1.5)), (XA(R.MR[1] + 3.6), ZA(1.5)), (XA(xh1), ZA(1.5))], THIN)
    poly([(XA(R.MR[1] + 0.5), ZA(-3.2)), (XA(R.MR[1] + 2.9), ZA(-3.2)), (XA(R.MR[1] + 2.9), ZA(3.2)), (XA(R.MR[1] + 0.5), ZA(3.2))], THIN)
    poly([(XA(R.x_tab1), ZA(-3.5)), (XA(R.x_tab1 + 0.5), ZA(-3.5)), (XA(R.x_tab1 + 0.5), ZA(3.5)), (XA(R.x_tab1), ZA(3.5))], THIN)
    poly([(XA(R.MR[1]), ZA(-3.5)), (XA(R.MR[1] + 0.5), ZA(-3.5)), (XA(R.MR[1] + 0.5), ZA(3.5)), (XA(R.MR[1]), ZA(3.5))], THIN)
    L([XA(36), XA(74)], [ZA(0), ZA(0)], THIN, CL)
    # dimensions: radial positions from the rocket axis (along the top), heights on the left
    yT = ZA(16) + 6
    L([XA(R.x_tab0)] * 2, [ZA(R.TAB_TOP) + 1.5, yT + 12], THIN); L([XA(R.x_tab1)] * 2, [ZA(R.TAB_TOP) + 1.5, yT + 2], THIN)
    L([XA(R.x_mb)] * 2, [ZA(R.BOSS_Z[1]) + 1.5, yT + 2], THIN); L([XA(R.MR[1])] * 2, [ZA(R.MR[2] / 2) + 1.5, yT + 12], THIN)
    dim_h(yT, XA(R.x_tab0), XA(R.x_tab1), f'{R.TAB_T:g}', fs=FS - 2.5)
    dim_h(yT + 10, XA(R.x_tab0), XA(R.MR[1]), f'R{R.x_tab0:g} → R{R.MR[1]:g} FROM THE ROCKET AXIS', fs=FS - 2.5)
    xl = XA(36) - 6
    L([XA(R.x_tab0) - 1.5, xl - 2], [ZA(R.TAB_TOP)] * 2, THIN); L([XA(36), xl - 2], [ZA(0)] * 2, THIN)
    zj = -R.P_Z + R.JOINT_Z
    L([XA(R.x_tab0) - 1.5, xl - 2], [ZA(zj)] * 2, THIN)
    dim_v(xl, ZA(zj), ZA(0), f'{-zj:g} ±{R.ADJ:g}', fs=FS - 2.5)
    dim_v(xl, ZA(0), ZA(R.TAB_TOP), f'{R.TAB_TOP:g}', fs=FS - 2.5)
    xr_ = XA(72)
    leader((XA(R.x_tab1 + 1.4), ZA(R.PEG_R + 1)), (xr_, ZA(16)), f'STOP PEG Ø{R.PEG_D:g} (ITEM 2) IN THE ±30° SLOT (DETAIL C)', fs=FS - 3.5)
    leader((XA(R.MR[1] + 1.7), ZA(3.2)), (xr_, ZA(6)), 'ITEMS 7, 8, 9: M3 X 25, HEAD INSIDE THE TAB,\nWASHER IN THE GAP, NYLON LOCK NUT', fs=FS - 3.5)
    leader((XA(57), ZA(-3.5)), (xr_, ZA(-8)), 'ITEM 3 INNER BOSS', fs=FS - 3.5)
    leader((XA(49), ZA(-15)), (xr_, ZA(-18)), 'ITEM 2 PIVOT TAB', fs=FS - 3.5)
    leader((XA(44), ZA(zj - 6)), (xr_, ZA(zj - 6)), 'ITEM 1 PAD + NUT TRAP (ITEM 11 AT Y ±4.5)', fs=FS - 3.5)
    caption(XA(55), ZA(-46) - 5, 'SECTION A-A (INNER PIVOT)  SCALE 2:1')

    # ---------------- TOP VIEW, 1:2 ----------------
    s2, TX, TY = 0.5, 358.0, 212.0
    Pt = view(RIG + HW, (0, 0, -1), (0, 1, 0), s2, (0, 0, 0), (TX, TY))
    Xt = lambda x: TX + s2 * x; Yt = lambda y: TY + s2 * y
    th = np.linspace(0, 2 * np.pi, 200)
    L(TX + s2 * R.RO * np.cos(th), TY + s2 * R.RO * np.sin(th), THIN, PH)
    L([Xt(-100), Xt(100)], [TY, TY], THIN, CL); L([TX, TX], [Yt(-95), Yt(95)], THIN, CL)
    L([Xt(-R.REACH)] * 2, [Yt(-60), Yt(60)], THIN, PH); txt(Xt(-R.REACH) - 1.5, Yt(52), 'DESK\nEDGE', ha='right', fs=FS - 4)
    # cutting planes A-A (y = 0, inner pivots) and B-B (x = 0, outer pivots)
    for (p0, p1, lab, dvec) in (((Xt(36), TY), (Xt(98), TY), 'A', (0, 1)), ((TX, Yt(56)), (TX, Yt(90)), 'B', (-1, 0))):
        L([p0[0], p1[0]], [p0[1], p1[1]], THICK, CP)
        for p in (p0, p1):
            arrow(p, (p[0] + 6 * dvec[0], p[1] + 6 * dvec[1]), ms=8)
        txt(p1[0] + 9 * dvec[0] + (3 if dvec[0] == 0 else 0), p1[1] + 9 * dvec[1] + (0 if dvec[0] == 0 else 3), lab, fontweight='bold', fs=FS - 1)
    txt(Xt(0), Yt(R.RO - 9), 'DOOR 90° (+Y)', fs=FS - 4)
    leader((Xt(-R.x_tab1 - 1), Yt(-7)), (Xt(-110), Yt(-62)), 'INNER PIVOTS 0°/180° (TVC AXIS X)', ha='right', fs=FS - 3.5)
    leader((Xt(8), Yt(-R.y_mb - 2)), (Xt(-110), Yt(-78)), 'OUTER PIVOTS 90°/270° (TVC AXIS Y)', ha='right', fs=FS - 3.5)
    caption(TX - 60, Yt(-100), 'TOP VIEW (ROCKET Ø78.6 PHANTOM)  SCALE 1:2')

    # ---------------- SECTION B-B (plane x = 0), +y outer pivot, 2:1 ----------------
    BX, BZ = 215.0, 103.0
    XB = lambda y: BX + sc * (np.asarray(y) - 56.0); ZB = lambda z: BZ + sc * np.asarray(z)
    to2dB = lambda v: np.c_[XB(v[:, 1]), ZB(v[:, 2])]
    clipB = sbox(XB(56.0), ZB(-10.0), XB(92.0), ZB(16.0))
    section(ITEMS['3_middle_ring'], (1, 0, 0), (0.01, 0, 0), to2dB, 45, clipB, pitch=2.2)
    section(ITEMS['4_outer_ring'], (1, 0, 0), (0.01, 0, 0), to2dB, 135, clipB, pitch=1.3)
    yh0 = R.MR[0] - 1.65
    poly([(XB(yh0), ZB(-2.85)), (XB(R.MR[0]), ZB(-2.85)), (XB(R.MR[0]), ZB(2.85)), (XB(yh0), ZB(2.85))], THIN)
    poly([(XB(R.MR[0]), ZB(-1.5)), (XB(R.OR[1] + 3.6), ZB(-1.5)), (XB(R.OR[1] + 3.6), ZB(1.5)), (XB(R.MR[0]), ZB(1.5))], THIN)
    poly([(XB(R.OR[1] + 0.5), ZB(-3.2)), (XB(R.OR[1] + 2.9), ZB(-3.2)), (XB(R.OR[1] + 2.9), ZB(3.2)), (XB(R.OR[1] + 0.5), ZB(3.2))], THIN)
    L([XB(56), XB(92)], [ZB(0)] * 2, THIN, CL)
    yTB = ZB(16) + 6
    for y_ in (R.MR[0], R.MR[1], R.y_mb, R.y_mb + R.GAP, R.OR[1]):
        L([XB(y_)] * 2, [ZB(R.BOSS_Z[1] if y_ > R.MR[1] - 0.5 else R.MR[2] / 2) + 1.5, yTB + 2], THIN)
    dim_h(yTB, XB(R.MR[0]), XB(R.MR[1]), f'{R.MR[1] - R.MR[0]:g}', fs=FS - 2.5)
    dim_h(yTB, XB(R.y_mb), XB(R.y_mb + R.GAP), f'{R.GAP:g} GAP', fs=FS - 2.5)
    L([XB(R.MR[0])] * 2, [yTB + 2, yTB + 12], THIN); L([XB(R.OR[1])] * 2, [yTB + 2, yTB + 12], THIN)
    dim_h(yTB + 10, XB(R.MR[0]), XB(R.OR[1]), f'R{R.MR[0]:g} → R{R.OR[1]:g}', fs=FS - 2.5)
    xlB = XB(56) - 5
    for z_ in R.BOSS_Z: L([XB(R.MR[1]) - 1.5, xlB - 2], [ZB(z_)] * 2, THIN)
    dim_v(xlB, ZB(R.BOSS_Z[0]), ZB(R.BOSS_Z[1]), f'{R.BOSS_Z[1] - R.BOSS_Z[0]:g} BOSS', fs=FS - 2.5)
    leader((XB(R.y_mb + 1.6), ZB(R.PEG_R + 1)), (XB(90), ZB(19)), 'STOP: PEG ON ITEM 3,\nSLOT IN ITEM 4', fs=FS - 3.5)
    leader((XB(R.OR[1] + 2.9), ZB(1)), (XB(94), ZB(4)), 'ITEMS 7, 8, 9', fs=FS - 3.5)
    leader((XB(R.y_mb + R.GAP + 0.3), ZB(-4)), (XB(70), ZB(-12)), 'FLAT ON ITEM 4 (BOSS SWEEP)', ha='right', fs=FS - 3.5)
    caption(XB(74), ZB(-10) - 14, 'SECTION B-B (OUTER PIVOT)  SCALE 2:1')

    # ---------------- DETAIL C: the stop (view along a pivot axis), 4:1 ----------------
    s4, CXc, CYc = 3.0, 80.0, 36.0
    half = np.radians(R.STOP - np.degrees((R.SLOT_W - R.PEG_D) / 2 / R.PEG_R))
    P = lambda r, a: np.array([CXc + s4 * r * np.sin(a), CYc + s4 * r * np.cos(a)])
    ri, ro, w2 = R.PEG_R - R.SLOT_W / 2, R.PEG_R + R.SLOT_W / 2, R.SLOT_W / 2
    a_ = np.linspace(-half, half, 80)
    outline = [P(ro, a) for a in a_]
    c = P(R.PEG_R, half); rh_ = np.array([np.sin(half), np.cos(half)]); th_ = np.array([np.cos(half), -np.sin(half)])
    outline += [c + s4 * w2 * (rh_ * np.cos(f) + th_ * np.sin(f)) for f in np.linspace(0, np.pi, 30)]
    outline += [P(ri, a) for a in a_[::-1]]
    c = P(R.PEG_R, -half); rh_ = np.array([np.sin(-half), np.cos(half)]); th_ = np.array([-np.cos(half), -np.sin(half)])
    outline += [c + s4 * w2 * (-rh_ * np.cos(f) + th_ * np.sin(f)) for f in np.linspace(0, np.pi, 30)]
    outline.append(outline[0]); o = np.array(outline); L(o[:, 0], o[:, 1], THICK * 0.8)
    S.ax.add_patch(Circle(tuple(P(R.PEG_R, 0)), s4 * R.PEG_D / 2, fill=False, ec=K, lw=THICK * 0.8, zorder=4))
    for sg in (-1, 1):
        S.ax.add_patch(Circle(tuple(P(R.PEG_R, sg * np.radians(R.STOP))), s4 * R.PEG_D / 2, fill=False, ec=K, lw=THIN, ls=(0, (6, 2, 1.5, 2)), zorder=4))
        e = P(R.PEG_R + 9, sg * np.radians(R.STOP)); L([CXc, e[0]], [CYc, e[1]], THIN, CL)
    S.ax.add_patch(Circle((CXc, CYc), s4 * R.HOLE / 2, fill=False, ec=K, lw=THIN, zorder=4))
    L([CXc - 26, CXc + 26], [CYc] * 2, THIN, CL); L([CXc] * 2, [CYc - 10, CYc + s4 * (R.PEG_R + 10)], THIN, CL)
    rA = s4 * (R.PEG_R + 7.5)
    S.ax.add_patch(Arc((CXc, CYc), 2 * rA, 2 * rA, theta1=90 - R.STOP, theta2=90 + R.STOP, color=K, lw=THIN, zorder=5))
    for sg in (-1, 1):
        q = P(R.PEG_R + 7.5, sg * np.radians(R.STOP)); arrow(P(R.PEG_R + 7.5, sg * np.radians(R.STOP - 6)), tuple(q), ms=7)
        t = P(R.PEG_R + 7.5, sg * np.radians(R.STOP / 2)); txt(t[0], t[1] + 2.5, f'{R.STOP:g}°', fs=FS - 2.5)
    leader(tuple(P(ro, np.radians(-14))), (CXc + 40, CYc + 36), f'SLOT {R.SLOT_W:g} W X {R.SLOT_D:g} DEEP\nON R{R.PEG_R:g} (FIXED PART)', fs=FS - 3.5)
    leader(tuple(P(R.PEG_R, 0) + np.array([s4 * 1.4, -s4 * 1.4])), (CXc + 40, CYc + 18), f'PEG Ø{R.PEG_D:g} X {R.PEG_L:g} (MOVING\nPART); PHANTOM = STOPS', fs=FS - 3.5)
    leader((CXc + s4 * 1.2, CYc - s4 * 1.2), (CXc + 40, CYc - 6), 'PIVOT AXIS (Ø3.4)', fs=FS - 3.5)
    caption(CXc + 20, CYc - 14, 'DETAIL C: ±30° STOP, ALL 4 PIVOTS  SCALE 3:1')

    S.frame(2, 3, DWG, TITLE, rev='B', date='2026-11-11', scale='AS SHOWN', mass=f'~{MASS_PRINT:.0f} g', material='SEE LIST', revisions=False)
    return fig

# ======================================================================== SHEET 3
def sheet3():
    fig = S.new_sheet(); sd = 2.0
    # ---------------- VIEW D: collar half from above, 2:1 ----------------
    DX, DY = 125.0, 122.0
    view([ITEMS['1_collar_half_a']], (0, 0, -1), (0, 1, 0), sd, (0, 0, 0), (DX, DY), default=THICK * 0.8)
    L([DX - 106, DX + 106], [DY] * 2, THIN, CL); L([DX] * 2, [DY - 6, DY + 98], THIN, CL)
    c_ = lambda r, a: (DX + sd * r * np.cos(np.radians(a)), DY + sd * r * np.sin(np.radians(a)))
    leader(c_(R.r_in, 130), (DX - 104, DY + 96), f'BORE Ø{2 * R.r_in:.1f}', fs=FS - 3)
    leader(c_(R.r_col, 50), (DX + 72, DY + 94), f'OD Ø{2 * R.r_col:.1f}, {R.COL_Z[1] - R.COL_Z[0]:g} TALL', fs=FS - 3)
    leader((DX, DY + sd * R.r_col + 0.6), (DX + 22, DY + 108), f'Ø{R.HOLE:g} AT 90° FOR ITEM 10 (B LOWER JOINT HOLE)', fs=FS - 3)
    xp = DX + sd * R.PAD_R
    L([xp + 1.5, xp + 20], [DY + sd * R.PAD_W] * 2, THIN)
    dim_v(xp + 18, DY, DY + sd * R.PAD_W, f'{R.PAD_W:g}', side='right', fs=FS - 2.5)
    L([xp] * 2, [DY - 1.5, DY - 14], THIN); L([DX - sd * R.PAD_R] * 2, [DY - 1.5, DY - 14], THIN)
    dim_h(DY - 12, DX - sd * R.PAD_R, xp, f'{2 * R.PAD_R:g} OVER PADS', fs=FS - 2.5)
    leader((DX + sd * (R.r_in + 4.9), DY + sd * R.TAB_BOLT_Y), (xp + 12, DY + 48), f'Ø{R.HOLE:g} + M3 NUT TRAP FROM\nTHE TOP, {R.TAB_BOLT_Y:g} FROM THE SPLIT', fs=FS - 3)
    caption(DX, DY - 22, 'VIEW D: ITEM 1 COLLAR HALF (TOP)  SCALE 2:1')

    # ---------------- VIEW E: pivot tab, 2:1 (looking along -x at its outer face) ----------------
    EXe, EYe = 330.0, 182.0
    view([ITEMS['2_pivot_tab_a']], (-1, 0, 0), (0, 0, 1), sd, (R.x_tab1, 0, 0), (EXe, EYe), default=THICK * 0.8)
    Ye = lambda z: EYe + sd * z; Xe = lambda y: EXe - sd * y
    zj = -R.P_Z + R.JOINT_Z; zc0 = -R.P_Z + R.COL_Z[0]
    L([Xe(10), Xe(-10)], [EYe] * 2, THIN, CL); L([EXe] * 2, [Ye(zc0 - 3), Ye(R.TAB_TOP + 4)], THIN, CL)
    xe = Xe(-R.TAB_W / 2) + 8
    for z_ in (zj, 0, R.PEG_R, R.TAB_TOP): L([Xe(-R.TAB_W / 2) + 1.5, xe + 16], [Ye(z_)] * 2, THIN)
    dim_v(xe, Ye(zj), Ye(0), f'{-zj:g} (PIN TO SLOT CENTRE)', side='right', fs=FS - 2.5)
    dim_v(xe + 14, Ye(0), Ye(R.PEG_R), f'{R.PEG_R:g} PEG', side='right', fs=FS - 2.5)
    leader((Xe(-R.TAB_BOLT_Y), Ye(zj + R.ADJ)), (EXe - 34, Ye(zj - 8)), f'2X SLOT {R.HOLE:g} WIDE, ±{R.ADJ:g}\nAT Y ±{R.TAB_BOLT_Y:g}', ha='right', fs=FS - 3)
    leader((Xe(1.2), Ye(1.2)), (EXe - 34, Ye(12)), f'Ø{R.HOLE:g} PIVOT', ha='right', fs=FS - 3)
    L([Xe(R.TAB_W / 2)] * 2, [Ye(zc0) - 1.5, Ye(zc0) - 14], THIN); L([Xe(-R.TAB_W / 2)] * 2, [Ye(zc0) - 1.5, Ye(zc0) - 14], THIN)
    dim_h(Ye(zc0) - 12, Xe(R.TAB_W / 2), Xe(-R.TAB_W / 2), f'{R.TAB_W:g}', fs=FS - 2.5)
    txt(EXe, Ye(zc0) - 20, f'{R.TAB_T:g} THICK', fs=FS - 3)
    caption(EXe, Ye(zc0) - 25, 'VIEW E: ITEM 2 PIVOT TAB  SCALE 2:1')

    S.frame(3, 3, DWG, TITLE, rev='B', date='2026-11-11', scale='AS SHOWN', mass=f'~{MASS_PRINT:.0f} g', material='SEE LIST', revisions=False)
    notes_block(16, 70, ['PIVOT SETUP (ALL 4):',
        '1. NO BEARINGS: THE M3 SCREW IS THE AXLE. BOTH PARTS HAVE LOOSE Ø3.4 HOLES.',
        '2. WASHER IN THE 1.0 GAP AND UNDER THE NUT. TIGHTEN THE NYLON LOCK NUT UNTIL',
        '   THE PLAY JUST GOES, THEN BACK OFF 1/8 TURN: IT MUST SWING FREELY TO THE STOPS.',
        '3. OPTIONAL: A DAB OF GREASE OR GRAPHITE IN THE HOLES. PIVOT FRICTION FIGHTS THE',
        '   CONTROLLER, SO CHECK EACH AXIS SWINGS AND SETTLES ON ITS OWN BEFORE TESTS.',
        '4. ASSEMBLE: PIVOT SCREWS INTO ITEMS 2 (HEADS INSIDE) -> ITEMS 2 ON ITEMS 1 ->',
        '   ITEMS 1 ON THE ROCKET (ITEM 10) -> ITEM 3 ON THE PINS -> ITEM 4 -> ITEMS 5, 6.',
        f'5. CG: BALANCE THE COMPLETE ROCKET, SET THE PIVOT WITH THE ITEM 2 SLOTS (±{R.ADJ:g}).'], fs=FS - 3.5, pitch=4.5)
    return fig

if __name__ == '__main__':
    figs = [sheet1(), sheet2(), sheet3()]
    base = os.path.join(here, 'SLDP-GS-001_desk_rig')
    with PdfPages(base + '.pdf') as pdf:
        for f in figs: pdf.savefig(f)
    for n, f in enumerate(figs, 1): f.savefig(f'{base}_sheet{n}.png', dpi=170)
    print('ok')
