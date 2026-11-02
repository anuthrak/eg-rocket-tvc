"""
SLDP-ST-005  Rocket body (v5) -- 2 sheets.
  Sheet 1: assembled body, 1:2 (front view, section A-A, section B-B, view D) + detail C at 2:1.
  Sheet 2: exploded print partition (every part <= 254 mm for the Bambu) + parts list.
Run SLDP-ST-005_rocket-body.py first (it writes the STLs this script reads).
"""
import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'lib'))
import numpy as np, trimesh
from matplotlib.patches import Circle, Polygon
from matplotlib.collections import LineCollection
from matplotlib.backends.backend_pdf import PdfPages
from shapely.geometry import Polygon as SPoly, LineString, box as sbox
import sldp_sheet as S
from sldp_sheet import L, poly, box, txt, arrow, dim_h, dim_v, leader, balloon, draw_lines, notes_block, caption, cg_symbol, THICK, THIN, CL, PH, CP, FS, K
import hlr, paths

here = os.path.dirname(os.path.abspath(__file__))
B = paths.body_model()

DWG, TITLE, NSH = 'SLDP-ST-005', 'ROCKET BODY', 3
PARTS = ['A_lower_body', 'B_avionics_bay', 'C1_coupler', 'C2_interstage_coupler', 'D_upper_body', 'E_nose_cone']
M = {n: trimesh.load(os.path.join(here, B.stem(n) + '.stl')) for n in PARTS}
FIN0 = trimesh.load(os.path.join(here, B.stem('F_fin_x4') + '.stl'))
def rotz(m, deg):
    g = m.copy(); g.apply_transform(trimesh.transformations.rotation_matrix(np.radians(deg), [0, 0, 1])); return g
FINS = [rotz(FIN0, 90 * k) for k in range(4)]
ALL = [M[n] for n in PARTS] + FINS
_, REP = B.report(*B.build())
MASS = f'~{REP["printed"]:.0f} g'
CGZ = REP['cg']
RO, RI = B.RO, B.RI

# --------------------------------------------------------------------------- section helpers
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

def hatch(pg, angle, pitch, lw=THIN * 0.8):
    x0, y0, x1, y1 = pg.bounds; d = np.hypot(x1 - x0, y1 - y0) + 1; c = np.array([(x0 + x1) / 2, (y0 + y1) / 2])
    a = np.radians(angle); v = np.array([np.cos(a), np.sin(a)]); n = np.array([-v[1], v[0]]); segs = []
    for k in np.arange(-d / 2, d / 2, pitch):
        g = pg.intersection(LineString([c + n * k - v * d, c + n * k + v * d]))
        for gg in getattr(g, 'geoms', [g]):
            if not gg.is_empty and gg.geom_type == 'LineString': segs.append(np.array(gg.coords))
    S.ax.add_collection(LineCollection(segs, colors=K, linewidths=lw, zorder=3))

def cut_face(pg, solid=True, angle=45, pitch=1.0, lw=THICK * 0.6):
    for r_ in [pg.exterior] + list(pg.interiors):
        c = np.array(r_.coords); L(c[:, 0], c[:, 1], lw, z=4)
    if solid:
        S.ax.add_patch(Polygon(np.array(pg.exterior.coords), fc=K, ec=K, lw=0.1, zorder=4))
        for h in pg.interiors: S.ax.add_patch(Polygon(np.array(h.coords), fc='white', ec=K, lw=0.1, zorder=4))
    else:
        hatch(pg, angle, pitch)

def cutting_plane(p0, p1, view_dir, letter, tick=7):
    """Thick cutting-plane line p0-p1 with arrows (pointing in the viewing direction) and letters at both ends."""
    p0, p1 = np.array(p0, float), np.array(p1, float); v = np.array(view_dir, float); v /= np.linalg.norm(v)
    L([p0[0], p1[0]], [p0[1], p1[1]], THICK, CP)
    for p in (p0, p1):
        arrow(p, p + v * tick, ms=11); txt(*(p + v * (tick + 3.5)), letter, fontweight='bold')

# =========================================================================== SHEET 1
def sheet1():
    fig = S.new_sheet()
    sc = 0.5
    FX, FY = 45.0, 222.0                       # front view: tail on the axis
    SX, SY = 45.0, 133.0                       # section A-A
    fz = lambda z: FX + sc * z
    # ---------- FRONT VIEW (from -Y; screen right = +Z, up = -X) ----------
    lines, _, _ = hlr.view_lines(ALL, (0, 1, 0), (-1, 0, 0))
    draw_lines(lines, (FX, FY), sc, lw=THICK * 0.8)
    L([FX - 6, fz(B.TOP) + 6], [FY, FY], THIN, CL)
    cutting_plane((fz(B.VENT_Z), FY + 27), (fz(B.VENT_Z), FY - 27), (-1, 0), 'B')
    yb = FY - sc * RO
    # part lengths + overall
    st = [0, B.Z_AB, B.Z_B0, B.Z_BT, B.Z_S2, B.Z_NOSE, B.TOP]
    for z in st: L([fz(z)] * 2, [yb - 1.5 if z not in (0, B.TOP) else FY - 2, FY - 52 if z in (0, B.TOP) else FY - 45], THIN)
    yd = FY - 43
    for z0, z1 in ((0, B.Z_AB), (B.Z_B0, B.Z_BT), (B.Z_S2, B.Z_NOSE), (B.Z_NOSE, B.TOP)):
        arrow(((fz(z0) + fz(z1)) / 2, yd), (fz(z0), yd)); arrow(((fz(z0) + fz(z1)) / 2, yd), (fz(z1), yd))
        txt((fz(z0) + fz(z1)) / 2, yd + 1.8, f'{z1 - z0:.1f}'.rstrip('0').rstrip('.'), va='bottom')
    arrow(((fz(0) + fz(B.TOP)) / 2, FY - 50), (fz(0), FY - 50)); arrow(((fz(0) + fz(B.TOP)) / 2, FY - 50), (fz(B.TOP), FY - 50))
    txt((fz(0) + fz(B.TOP)) / 2, FY - 48.2, f'{B.TOP:.1f}', va='bottom')
    # feature callouts
    leader((fz(B.VENT_Z) + 1.5, FY + 4), (fz(B.VENT_Z) + 40, FY + 30), '4X OBROUND 12 X 32 THRU\nAT 0°, 90°, 180°, 270°', fs=FS - 2)
    leader((fz(B.WIN_Z + 6), FY + 2), (fz(20), FY + 39), 'OBROUND 30 X 12 THRU AT 270°, CTR 19 FROM TAIL\n(INNER GIMBAL BRACKET CLEARANCE)', fs=FS - 2)
    leader((fz(B.Z_AB + 1.5), yb + 0.3), (fz(B.Z_AB) + 6, FY - 33), 'BAND 3 (C1)', fs=FS - 2)
    leader((fz(B.Z_BT + 9), yb + 0.3), (fz(B.Z_BT) + 14, FY - 33), 'BAND 18 (C2)', fs=FS - 2)
    leader((fz(B.Z_NOSE + 7), yb + 0.3), (fz(B.Z_NOSE) + 14, FY - 33), 'BAND 15', fs=FS - 2)
    leader((fz(30), FY - sc * (RO + 12)), (fz(0) - 4, FY - 33), '4X FIN, 2 THK\n(SEE VIEW D)', ha='right', fs=FS - 2)
    caption(fz(B.TOP / 2), FY + 46, 'FRONT VIEW  SCALE 1:2') if False else None

    # ---------- SECTION A-A (plane Y = 0, viewed from -Y) ----------
    to2d = lambda v: np.c_[SX + sc * v[:, 2], SY - sc * v[:, 0]]
    for n in PARTS:
        for pg in section_polys(M[n], [0, 0, 0], [0, 1, 0], to2d): cut_face(pg, solid=True)
    L([SX - 6, SX + sc * B.TOP + 6], [SY, SY], THIN, CL)
    ytop, ybot = SY + sc * RO, SY - sc * RO
    # stations below the section
    for z, lab, yy in ((B.GIMBAL_Z, f'{B.GIMBAL_Z:g}', SY - 30), (B.VENT_Z, f'{B.VENT_Z:g}', SY - 38)):
        L([SX, SX], [ybot - 1.5, yy - 2], THIN); L([SX + sc * z] * 2, [ybot - 1.5, yy - 2], THIN)
        arrow(((SX + SX + sc * z) / 2, yy), (SX, yy)); arrow(((SX + SX + sc * z) / 2, yy), (SX + sc * z, yy))
        txt((SX + SX + sc * z) / 2, yy + 1.8, lab, va='bottom')
    leader((SX + sc * B.GIMBAL_Z, ybot), (SX + sc * B.GIMBAL_Z + 22, SY - 26), '2X Ø3.2 THRU AT 0°/180°\n(TVC MOUNT M3 = GIMBAL POINT)', fs=FS - 2.5)
    zs = B.SLED_Z0 + B.SLED_BOSS_Z[1]
    leader((SX + sc * zs, ytop), (SX + sc * zs + 14, SY + 31), f'4X Ø3.2 THRU AT 0°/180°, {B.SLED_Z0 + 3:.0f} AND {zs:.0f}\nFROM TAIL (SLED RETENTION M3)', fs=FS - 2.5)
    # bays + CG
    txt(SX + sc * 60, SY, 'TVC BAY', fs=FS - 3, style='italic', bbox=dict(fc='white', ec='none', pad=0.6))
    txt(SX + sc * (B.SLED_Z0 + 50), SY + 6, f'SLED BAY, {B.B_LEN - 2 * B.INSERT:.0f} CLEAR', fs=FS - 3, style='italic', bbox=dict(fc='white', ec='none', pad=0.6))
    cg_symbol((SX + sc * CGZ, SY), 2.6)
    leader((SX + sc * CGZ + 1.8, SY - 1.8), (SX + sc * CGZ + 30, SY - 24), f'CG ~{CGZ:.0f} FROM TAIL (REF)\n= DESK-RIG PIVOT', fs=FS - 2.5)
    leader((SX + sc * 470, ytop), (SX + sc * 470 + 10, SY + 31), f'Ø{2 * RO:.1f}, Ø{2 * RI:.1f} BORE, WALL {B.WALL:g}', fs=FS - 2.5)
    ax_c = (SX + sc * B.Z_AB, ytop - 1)
    S.ax.add_patch(Circle(ax_c, 9, fill=False, ec=K, lw=THIN, ls=PH, zorder=5)); txt(ax_c[0] - 10, ax_c[1] + 9, 'C', fontweight='bold')
    caption(205, SY - 33, 'SECTION A-A  SCALE 1:2')

    # ---------- DETAIL C (2:1) : C1 joint, top wall ----------
    z0, z1, h0, h1 = B.Z_AB - B.INSERT - 4, B.Z_AB + B.BAND1 + B.INSERT + 4, RI - 4.5, RO + 1.0
    DX, DY, ds = 27.0, 40.0, 2.0
    clip = sbox(z0, h0, z1, h1)
    to2d_d = lambda v: np.c_[v[:, 2], -v[:, 0]]
    for n, ang in (('A_lower_body', 45), ('C1_coupler', 135), ('B_avionics_bay', 45)):
        for pg in section_polys(M[n], [0, 0, 0], [0, 1, 0], to2d_d):
            g = pg.intersection(clip)
            for gg in getattr(g, 'geoms', [g]):
                if gg.is_empty or gg.geom_type != 'Polygon': continue
                sp = SPoly(np.c_[DX + ds * (np.array(gg.exterior.coords)[:, 0] - z0), DY + ds * (np.array(gg.exterior.coords)[:, 1] - h0)])
                cut_face(sp, solid=False, angle=ang, pitch=0.9, lw=THICK * 0.8)
    X = lambda z: DX + ds * (z - z0); Y = lambda h: DY + ds * (h - h0)
    poly([(X(z0), Y(h0)), (X(z1), Y(h0)), (X(z1), Y(h1)), (X(z0), Y(h1))], THIN, PH)       # detail boundary
    dim_h(Y(h1) + 6, X(B.Z_AB - B.INSERT), X(B.Z_AB), f'{B.INSERT:g}', e0=Y(B.RC), e1=Y(RO), fs=FS - 1)
    dim_h(Y(h1) + 6, X(B.Z_B0), X(B.Z_B0 + B.INSERT), f'{B.INSERT:g}', e0=Y(RO), e1=Y(B.RC), fs=FS - 1)
    dim_h(Y(h1) + 13, X(B.Z_AB), X(B.Z_B0), f'{B.BAND1:g}', e0=Y(RO), e1=Y(RO), fs=FS - 1)
    dim_v(X(z1) + 6, Y(RI), Y(RO), f'{B.WALL:g}', e0=X(z1) + 1, e1=X(z1) + 1, side='right', fs=FS - 1)
    dim_v(X(z0) - 6, Y(B.RCI), Y(B.RC), f'{B.CPL_WALL:g}', e0=X(z0) + 1, e1=X(z0) + 1, side='left', fs=FS - 1)
    leader((X(B.Z_AB - 10), Y(B.RC) + 0.2), (X(B.Z_AB - 10) + 8, Y(h0) - 8), f'SLIP FIT, {B.SLIP:g} RADIAL', fs=FS - 2.5)
    caption(X((z0 + z1) / 2), Y(h0) - 14, 'DETAIL C  SCALE 2:1\n(C2 SIMILAR, BAND 18)')

    # ---------- SECTION B-B (Z = vent centre, looking toward the tail) ----------
    BX, BY = 182.0, 58.0
    to2d_b = lambda v: np.c_[BX + sc * v[:, 1], BY - sc * v[:, 0]]
    for pg in section_polys(M['A_lower_body'], [0, 0, B.VENT_Z], [0, 0, 1], to2d_b): cut_face(pg, solid=True)
    L([BX - 26, BX + 26], [BY, BY], THIN, CL); L([BX, BX], [BY - 26, BY + 26], THIN, CL)
    txt(BX + 21, BY + 22, '90° TYP', fs=FS - 2.5)
    caption(BX, BY - 26, 'SECTION B-B\nSCALE 1:2')

    # ---------- VIEW D (tail end, looking +Z) ----------
    VX, VY = 238.0, 58.0
    lines, _, _ = hlr.view_lines(ALL, (0, 0, 1), (-1, 0, 0))
    draw_lines(lines, (VX, VY), sc, lw=THICK * 0.8)
    L([VX - 33, VX + 33], [VY, VY], THIN, CL)
    cutting_plane((VX, VY + 36), (VX, VY - 36), (-1, 0), 'A', tick=5)
    a = np.radians(45); r0 = sc * RO
    txt(VX + 23, VY + 31, '4X 45°', fs=FS - 2.5)
    caption(VX, VY - 38, 'VIEW D (TAIL END)\nSCALE 1:2')

    # ---------- NOTES ----------
    notes_block(275, 106, ['NOTES:',
        '1. PLA, 0.6 NOZZLE: TUBES 2 WALLS, COUPLERS 4 WALLS. NO SUPPORTS.',
        f'2. FITS SLDP-TVC-001 (GIMBAL POINT {B.GIMBAL_Z:g}) AND SLDP-AV-001 (SLED {B.SLED_Z0:.0f}-{B.SLED_Z0 + B.SLED_H:.0f}).',
        '3. INSERT SLED INTO B FROM THE BOTTOM BEFORE C1. BOND COUPLERS, FINS.',
        '4. RIG PIVOT AT ACTUAL CG: BALANCE THE BUILT ROCKET TO CONFIRM.',
        '5. ANGLES FROM +X (GIMBAL AXIS X), CCW VIEWED FROM NOSE.',
        '6. PART DETAILS + ASSEMBLY: SHEET 2. PARTS LIST: SHEET 3.'], fs=FS - 3, pitch=5.4)
    S.frame(1, NSH, DWG, TITLE, scale='1:2', mass=MASS, material='PLA')
    return fig

# =========================================================================== SHEET 2
def sheet2():
    fig = S.new_sheet()
    # exploded along the axis (assembly order), fins pulled out radially
    GAP = 60.0
    order = ['A_lower_body', 'C1_coupler', 'B_avionics_bay', 'C2_interstage_coupler', 'D_upper_body', 'E_nose_cone']
    shift = {n: GAP * k for k, n in enumerate(order)}
    ex, tag = [], []
    for n in order:
        g = M[n].copy(); g.apply_translation((0, 0, shift[n])); ex.append(g); tag.append(n)
    FPULL = 40.0
    for k, f in enumerate(FINS):
        a = np.radians(45 + 90 * k); g = f.copy(); g.apply_translation((FPULL * np.cos(a), FPULL * np.sin(a), 0)); ex.append(g); tag.append('F')
    d, up = (-0.35, 0.8, -0.5), (-1, 0, 0)
    d = np.array(d) / np.linalg.norm(d)
    lines, ext, (r, u) = hlr.view_lines(ex, d, up)
    sc = 0.25
    allv = np.vstack([m.vertices for m in ex]); P2 = np.c_[allv @ r, allv @ u]
    c = (P2.min(0) + P2.max(0)) / 2
    OX, OY = 215 - sc * c[0], 190 - sc * c[1]
    draw_lines(lines, (OX, OY), sc, lw=THIN * 1.3)
    Pj = lambda p: np.array([OX + sc * (np.asarray(p, float) @ r), OY + sc * (np.asarray(p, float) @ u)])
    a0, a1 = Pj((0, 0, -30)), Pj((0, 0, B.TOP + GAP * 5 + 20)); L([a0[0], a1[0]], [a0[1], a1[1]], THIN, CL)
    def surf(m, q):
        cpt, _, _ = trimesh.proximity.closest_point(m, [q]); return cpt[0]
    item = {'A_lower_body': 1, 'B_avionics_bay': 2, 'C1_coupler': 3, 'C2_interstage_coupler': 4, 'D_upper_body': 5, 'E_nose_cone': 6}
    for m, n in zip(ex, tag):
        if n == 'F': continue
        zc = (m.vertices[:, 2].min() + m.vertices[:, 2].max()) / 2
        p = Pj(surf(m, (RO * 0.2, -RO * 1.2, zc)))
        cpos = p + np.array([-6, -24]) if item[n] % 2 else p + np.array([6, -34])
        balloon(p, cpos, item[n])
    fm = ex[-1]; p = Pj(surf(fm, fm.vertices.mean(0) + (0, -20, 0))); balloon(p, p + np.array([-22, -12]), 7)
    caption(215, 146, 'EXPLODED ISOMETRIC VIEW (PRINT PARTITION)  SCALE 1:4')
    # parts list
    names = {1: 'A  LOWER BODY (TVC BAY, VENTS)', 2: 'B  AVIONICS BAY (SLED)', 3: 'C1 COUPLER, BAND 3',
             4: 'C2 INTERSTAGE COUPLER, BAND 18', 5: 'D  UPPER BODY', 6: 'E  NOSE CONE + SHOULDER', 7: 'F  FIN, 2 THK'}
    out, _ = B.report(*B.build())
    by = {o[0]: o for o in out}
    keys = {1: 'A_lower_body', 2: 'B_avionics_bay', 3: 'C1_coupler', 4: 'C2_interstage_coupler', 5: 'D_upper_body', 6: 'E_nose_cone', 7: 'F_fin'}
    rows = []
    for i in range(7, 0, -1):
        o = by[keys[i]]
        rows.insert(0, (i, o[1], names[i], f'{o[2]:.0f}', 'PLA'))
    rows += [(8, 2, 'SCREW M3 X 6 BUTTON HD (TVC MOUNT)', '6', 'STEEL'),
             (9, 4, 'SCREW M3 X 8 BUTTON HD (SLED)', '8', 'STEEL'),
             (10, 'AR', 'ADHESIVE: CA + 5-MIN EPOXY', '-', '-')]
    tbx, tby, tbw, tbh = S.frame(3, NSH, DWG, TITLE, scale='1:4', mass=MASS, material='PLA', revisions=False)
    S.parts_list(tbx, tby + tbh, rows, cols=((0, 11, 'ITEM'), (11, 10, 'QTY'), (21, 79, 'DESCRIPTION'), (100, 26, 'MAX DIM'), (126, 24, 'MATERIAL')))
    notes_block(20, 132, ['NOTES:',
        f'1. EVERY PART FITS THE BAMBU BUILD VOLUME (254 X 254 X 254). LONGEST: ITEM 1, {by["A_lower_body"][2]:.0f} MM.',
        '2. PRINT TUBES (1, 2, 5) AND COUPLERS (3, 4) UPRIGHT ON THEIR END FACES. ITEM 6 TIP UP.',
        '   ITEM 7 FLAT. BRIM ON TUBES. NO SUPPORTS.',
        '3. ASSEMBLY ORDER: TVC MOUNT INTO 1; SLED INTO 2 FROM BELOW; 3 JOINS 1-2; 4 JOINS 2-5; 6 INTO 5.',
        '   BOND 3 INTO 1 AND 4 INTO 5 ONLY, SO 2 STAYS REMOVABLE FOR SLED ACCESS.',
        '4. FINS (7) BONDED TO 1 AT 45°, 135°, 225°, 315°, TRAILING EDGE FLUSH WITH THE TAIL.'], fs=FS - 2.5, pitch=6.0)
    # ---------- build-volume check: every part in a 254 x 254 bed elevation, 1:5 ----------
    s5 = 0.2; bw = 254 * s5; gx = 9.0; X0, Y0 = 24.0, 20.0
    RC, RCI, RO_, INS = B.RC, B.RCI, B.RO, B.INSERT
    def tube_prof(Lz): return [(B.RI, 0), (RO_, 0), (RO_, Lz), (B.RI, Lz)]
    def cpl_prof(band): return [(RCI, 0), (RC, 0), (RC, INS), (RO_, INS), (RO_, INS + band), (RC, INS + band), (RC, 2 * INS + band), (RCI, 2 * INS + band)]
    zc = INS + B.NOSE_BAND
    nose_prof = [(RCI, 0), (RC, 0), (RC, INS), (RO_, INS), (RO_, zc), (3.0, zc + B.NOSE_L - 3), (0, zc + B.NOSE_L)]
    def outline(prof, cx, y0):
        right = [(cx + s5 * r, y0 + s5 * z) for r, z in prof]
        left = [(cx - s5 * r, y0 + s5 * z) for r, z in prof[::-1]]
        poly(right + left, THIN * 1.4)
    plates = [[(1, tube_prof(B.A_LEN))], [(2, tube_prof(B.B_LEN)), (5, tube_prof(B.S2_LEN))],
              [(6, nose_prof), (3, cpl_prof(B.BAND1)), (4, cpl_prof(B.BAND2))], [('7', None)]]
    for k, pl in enumerate(plates):
        bx = X0 + k * (bw + gx)
        box(bx, Y0, bx + bw, Y0 + bw, THIN, PH)
        n = len(pl); slot = bw / n
        for j, (it, prof) in enumerate(pl):
            cx = bx + slot * (j + 0.5)
            if prof is None:
                for f in range(4): box(bx + 6, Y0 + 1 + f * 4, bx + 6 + s5 * B.FIN_ROOT, Y0 + 1 + f * 4 + s5 * B.FIN_T * 2, THIN * 1.4)
                txt(bx + 6 + s5 * B.FIN_ROOT + 6, Y0 + 8, '7 (4X, FLAT)', ha='left', fs=FS - 3.5)
            else:
                outline(prof, cx, Y0 + 0.5); txt(cx, Y0 + s5 * max(z for _, z in prof) + 4, str(it), fs=FS - 2.5)
        txt(bx + bw / 2, Y0 - 3.5, f'PLATE {k + 1}', fs=FS - 3.5)
    txt(X0 + 2 * bw + 1.5 * gx, Y0 + bw + 9, 'BUILD-VOLUME CHECK, 254 X 254 BED ELEVATION (PHANTOM)  SCALE 1:5', fontweight='bold', fs=FS - 2)
    return fig

# =========================================================================== SHEET 3
def fill_half(prof, cx, by, side):
    """Solid (thin-wall) section of a revolved profile, one half."""
    pts = [(cx + side * r, by + z) for r, z in prof]
    S.ax.add_patch(Polygon(pts, closed=True, fc=K, ec=K, lw=THIN * 0.6, zorder=4))

def rev_section(prof, cx, by, inner_edges=()):
    fill_half(prof, cx, by, 1); fill_half(prof, cx, by, -1)
    for r, z in inner_edges: L([cx - r, cx + r], [by + z] * 2, THICK * 0.8)    # far-side edges seen through the bore
    zmax = max(z for _, z in prof)
    L([cx, cx], [by - 5, by + zmax + 5], THIN, CL)

def sheet3():
    fig = S.new_sheet()
    RC, RCI, RO_, RI_, INS, W = B.RC, B.RCI, B.RO, B.RI, B.INSERT, B.WALL
    dO, dC, dCI = 2 * RO_, 2 * RC, 2 * RCI
    # ---------------- ITEM 6 NOSE CONE, SECTION, 1:1 ----------------
    cx, by = 100.0, 98.0
    zc = INS + B.NOSE_BAND; Ln = B.NOSE_L; top = zc + Ln; it = top - 3 * W - 6.0
    prof = [(RC, 0), (RC, INS), (RO_, INS), (RO_, zc), (3.0, top - 3.0), (0, top), (0, it), (0.6, it), (RI_, zc), (RI_, INS + 3), (RCI, INS + 3), (RCI, 0)]
    rev_section(prof, cx, by, inner_edges=((RCI, INS + 3), (RI_, zc)))
    xl = cx - RO_
    for z in (0, INS, zc, top): L([xl - 2 if z else cx - RC - 1.5, xl - 34], [by + z] * 2, THIN)
    for z0, z1, lab in ((0, INS, f'{INS:g}'), (INS, zc, f'{B.NOSE_BAND:g}'), (zc, top, f'{Ln:.1f}')):
        dim_v(xl - 12, by + z0, by + z1, lab, fs=FS - 1)
    dim_v(xl - 30, by, by + top, f'{top:.1f}', fs=FS - 1)
    dim_h(by - 9, cx - RC, cx + RC, f'Ø{dC:.1f}', e0=by, e1=by, fs=FS - 1)
    leader((cx + RO_, by + zc - 6), (cx + RO_ + 10, by + zc - 14), f'Ø{dO:.1f} BAND', fs=FS - 2)
    leader((cx + RCI - 0.3, by + 8), (cx + RO_ + 10, by + 4), f'Ø{dCI:.1f} BORE, {INS + 3:g} DEEP', fs=FS - 2)
    leader((cx + RI_ * 0.55, by + zc + Ln * 0.45), (cx + RO_ + 10, by + zc + 40), f'WALL {W:g} TYP', fs=FS - 2)
    leader((cx + 0.5, by + top - 1.5), (cx + 18, by + top + 8), '90° POINT ON Ø6', fs=FS - 2)
    leader((cx + 0.6, by + it), (cx + RO_ + 10, by + it - 12), f'INNER APEX {top - it:.1f}\nBELOW TIP', fs=FS - 2)
    caption(cx, by - 18, 'ITEM 6 NOSE CONE\nSECTION, SCALE 1:1')

    # ---------------- ITEMS 3 + 4 COUPLERS, SECTION, 1:1 ----------------
    def coupler_sheet(cx, by, band, item, name):
        prof = [(RCI, 0), (RC, 0), (RC, INS), (RO_, INS), (RO_, INS + band), (RC, INS + band), (RC, 2 * INS + band), (RCI, 2 * INS + band)]
        rev_section(prof, cx, by)
        H = 2 * INS + band; xr = cx + RO_
        for z in (0, INS, INS + band, H): L([cx + (RO_ if INS <= z <= INS + band else RC) + 1.5, xr + 24], [by + z] * 2, THIN)
        for z0, z1, lab in ((0, INS, f'{INS:g}'), (INS, INS + band, f'{band:g}'), (INS + band, H, f'{INS:g}')):
            dim_v(xr + 10, by + z0, by + z1, lab, side='right', fs=FS - 1)
        dim_v(xr + 21, by, by + H, f'{H:g}', side='right', fs=FS - 1)
        dim_h(by + H + 7, cx - RC, cx + RC, f'Ø{dC:.1f}', e0=by + H, e1=by + H, fs=FS - 1)
        dim_h(by - 8, cx - RCI, cx + RCI, f'Ø{dCI:.1f}', e0=by, e1=by, fs=FS - 1)
        dim_h(by - 17, cx - RO_, cx + RO_, f'Ø{dO:.1f} BAND', e0=by + INS, e1=by + INS, fs=FS - 1)
        caption(cx, by - 24, f'ITEM {item} {name}\nSECTION, SCALE 1:1')
    coupler_sheet(232.0, 184.0, B.BAND2, 4, 'C2 COUPLER')
    coupler_sheet(232.0, 84.0, B.BAND1, 3, 'C1 COUPLER')

    # ---------------- ITEM 7 FIN, 1:1 (flat view + edge view) ----------------
    fx0, fy0 = 338.0, 178.0
    pts = [(0, 0), (B.FIN_SPAN, 0), (B.FIN_SPAN, B.FIN_TIP), (0, B.FIN_ROOT)]
    poly([(fx0 + a, fy0 + b) for a, b in pts], THICK)
    ex = fx0 + B.FIN_SPAN + 16
    box(ex, fy0, ex + B.FIN_T, fy0 + B.FIN_ROOT, THICK); L([ex + B.FIN_T, ex + B.FIN_T], [fy0, fy0 + B.FIN_ROOT], THICK)
    for y in (fy0, fy0 + B.FIN_ROOT): L([fx0 - 1.5, fx0 - 12], [y, y], THIN)
    dim_v(fx0 - 9, fy0, fy0 + B.FIN_ROOT, f'{B.FIN_ROOT:g}', fs=FS - 1)
    L([fx0 + B.FIN_SPAN + 1.5, fx0 + B.FIN_SPAN + 9], [fy0 + B.FIN_TIP] * 2, THIN)
    dim_v(fx0 + B.FIN_SPAN + 7, fy0, fy0 + B.FIN_TIP, f'{B.FIN_TIP:g}', side='right', fs=FS - 1)
    dim_h(fy0 - 8, fx0, fx0 + B.FIN_SPAN, f'{B.FIN_SPAN:g}', e0=fy0, e1=fy0, fs=FS - 1)
    dim_h(fy0 + B.FIN_ROOT + 7, ex, ex + B.FIN_T, f'{B.FIN_T:g}', e0=fy0 + B.FIN_ROOT, e1=fy0 + B.FIN_ROOT, fs=FS - 1)
    txt(fx0 - 3, fy0 + B.FIN_ROOT + 5, 'ROOT', fs=FS - 3, ha='right'); txt(fx0 + 15, fy0 - 15, 'TRAILING EDGE (TAIL)', fs=FS - 3)
    caption(fx0 + 22, fy0 - 21, 'ITEM 7 FIN (4X), SCALE 1:1')

    # ---------------- ASSEMBLY SEQUENCE ----------------
    notes_block(306, 146, ['ASSEMBLY SEQUENCE:',
        '1. PRINT ITEMS 1-7 (SHEET 3). DRY-FIT 3, 4;',
        '   SAND THE INSERT OD IF TIGHT.',
        '2. MARK A 0° WITNESS LINE ON 1, 2, 5.',
        '3. BOND 4X ITEM 7 TO ITEM 1 AT 45° + 90° X,',
        '   TRAILING EDGE FLUSH WITH TAIL (CA + EPOXY).',
        '4. BOND 3 INTO TOP OF 1 (BAND 3 SHOWING).',
        '5. BOND 4 INTO BOTTOM OF 5.',
        '6. TVC MOUNT INTO 1 FROM TAIL: 2X ITEM 8.',
        '7. SLED INTO 2 FROM BOTTOM: 4X ITEM 9.',
        '8. RUN WIRES 1 -> 2 THROUGH THE ITEM 3 BORE.',
        '9. 2 ONTO 3, THEN 5 + 4 ONTO 2, LINES ALIGNED.',
        '10. ITEM 6 INTO 5. TAPE JOINTS 2/3 AND 2/4.',
        '11. BALANCE FOR CG; SET RIG PIVOT THERE.'], fs=FS - 3, pitch=5.4)
    S.frame(2, NSH, DWG, TITLE, scale='1:1', mass=MASS, material='PLA', revisions=False)
    return fig

if __name__ == '__main__':
    base = os.path.join(here, 'SLDP-ST-005_rocket-body')
    figs = [sheet1(), sheet3(), sheet2()]     # sheet 2 = part details, sheet 3 = exploded view
    with PdfPages(base + '.pdf') as pdf:
        for f in figs: pdf.savefig(f)
    for n, f in enumerate(figs, 1): f.savefig(f'{base}_sheet{n}.png', dpi=170)
    print('ok', REP)
