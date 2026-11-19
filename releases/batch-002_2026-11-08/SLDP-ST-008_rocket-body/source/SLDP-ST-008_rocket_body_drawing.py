"""
SLDP-ST-008  Rocket body (v8, ship-on-booster, tail fins replaced by printed strakes) -- 6 sheets.
  Sheet 1: assembled body, 1:2 (front view, section A-A, section B-B, view D) + detail C at 2:1.
  Sheet 2: part details (ogive nose, C1 coupler, strake) + assembly sequence.
  Sheet 3: part A features at 1:1 -- tail notch, fixed-servo window (unchanged from ST-006).
  Sheet 4: part B door opening + frame, door (item 8), section J-J at 3:1 (unchanged from ST-006).
  Sheet 5: styling -- hot-staging C2, ship aft flaps, grid fin (item 12), clocking diagram.
  Sheet 6: exploded print partition (every part <= 254 mm for the Bambu) + parts list.
Run SLDP-ST-008_rocket_body.py first (it writes the STLs this script reads).
"""
import os, importlib.util, numpy as np, trimesh
from matplotlib.patches import Circle, Polygon
from matplotlib.collections import LineCollection
from matplotlib.backends.backend_pdf import PdfPages
from shapely.geometry import Polygon as SPoly, LineString, box as sbox
import sldp_sheet as S
from sldp_sheet import L, poly, box, txt, arrow, dim_h, dim_v, leader, balloon, draw_lines, notes_block, caption, cg_symbol, THICK, THIN, CL, PH, CP, FS, K
import hlr

here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('body', os.path.join(here, 'SLDP-ST-008_rocket_body.py'))
B = importlib.util.module_from_spec(spec); spec.loader.exec_module(B)

DWG, TITLE, NSH = 'SLDP-ST-008', 'ROCKET BODY', 6
DATE = '2026-11-07'
_frame = S.frame
S.frame = lambda *a, **k: _frame(*a, date=DATE, rev_rows=(('A', 'INITIAL RELEASE (SUPERSEDES SLDP-ST-007)', DATE),
                                                          ('B', 'FINISH: DOOR AS BODY; STAND REF GS-003', DATE)), **{'rev': 'B', **k})
PARTS = ['A_lower_body', 'B_avionics_bay', 'C1_coupler', 'C2_interstage_coupler', 'D_upper_body', 'E_nose_cone', 'G_bay_door']
M = {n: trimesh.load(os.path.join(here, n + '.stl')) for n in PARTS}
def rotz(m, deg):
    g = m.copy(); g.apply_transform(trimesh.transformations.rotation_matrix(np.radians(deg), [0, 0, 1])); return g
FINS = []                                   # item 7 fins deleted in ST-008 (strakes are part of item 1)
GF0 = trimesh.load(os.path.join(here, 'H_grid_fin_x4.stl'))
GFINS = [rotz(GF0, 90 * k) for k in range(4)]
ALL = [M[n] for n in PARTS] + FINS + GFINS
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
    FX, FY = 45.0, 216.5                       # front view: tail on the axis (Rev B: down 5.5 to clear the revisions block)
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
    for z in st: L([fz(z)] * 2, [yb - 1.5 if z not in (0, B.TOP) else FY - 2, FY - 50.5 if z in (0, B.TOP) else FY - 44], THIN)
    yd = FY - 42
    for z0, z1 in ((0, B.Z_AB), (B.Z_B0, B.Z_BT), (B.Z_S2, B.Z_NOSE), (B.Z_NOSE, B.TOP)):
        arrow(((fz(z0) + fz(z1)) / 2, yd), (fz(z0), yd)); arrow(((fz(z0) + fz(z1)) / 2, yd), (fz(z1), yd))
        txt((fz(z0) + fz(z1)) / 2, yd + 1.8, f'{z1 - z0:.1f}'.rstrip('0').rstrip('.'), va='bottom')
    arrow(((fz(0) + fz(B.TOP)) / 2, FY - 48.5), (fz(0), FY - 48.5)); arrow(((fz(0) + fz(B.TOP)) / 2, FY - 48.5), (fz(B.TOP), FY - 48.5))
    txt((fz(0) + fz(B.TOP)) / 2, FY - 46.7, f'{B.TOP:.1f}', va='bottom')
    # feature callouts
    leader((fz(B.VENT_Z) + 1.5, FY + 4), (fz(B.VENT_Z) + 40, FY + 30), '4X OBROUND 12 X 32 THRU\nAT 0°, 90°, 180°, 270°', fs=FS - 2)
    leader((fz((B.WIN_Z0 + B.WIN_Z1) / 2), FY + sc * RO + 0.2), (fz(20), FY + 39),
           f'WINDOW {B.WIN_W:g} X {B.WIN_Z1 - B.WIN_Z0:g} THRU AT {B.WIN_ANG:g}°, {B.WIN_Z0:g}-{B.WIN_Z1:g} FROM TAIL\n(FIXED SERVO CLEARANCE, SEE SHEET 3)', fs=FS - 2)
    leader((fz(B.NOTCH_TOP), FY - sc * 12), (fz(0) - 4, FY - 12), 'TAIL NOTCH\n(SHEET 3)', ha='right', fs=FS - 2)
    leader((fz((B.OPEN_Z0 + B.OPEN_Z1) / 2), FY + sc * RO + 0.2), (fz(B.OPEN_Z1) - 18, FY + 40), 'DOOR, ITEM 8, AT 90°\n(FAR SIDE, SHEET 4)', fs=FS - 2)
    leader((fz(B.Z_AB + 1.5), yb + 0.3), (fz(B.Z_AB) + 6, FY - 33), 'BAND 3 (C1)', fs=FS - 2)
    leader((fz(B.Z_BT + 9), yb + 0.3), (fz(B.Z_BT) + 14, FY - 33), 'BAND 18 (C2) = HOT-STAGING\nRING, 20X POCKETS (SHEET 5)', fs=FS - 2.5)
    leader((fz(B.GF_Z0 + 4), FY - sc * (RO + 12) * 0.71), (fz(B.GF_Z0) - 8, FY - 33), '4X GRID FIN,\nITEM 12', ha='right', fs=FS - 2.5)
    leader((fz(B.Z_S2 + 30), FY + sc * (RO + 15)), (fz(440), FY + 31), '2X AFT FLAP\nAT 0°/180°', fs=FS - 2.5)
    leader((fz(B.Z_NOSE + B.NOSE_BAND + 40), FY - sc * (B.nose_r(40) + 8)), (fz(600), FY - 28), 'OGIVE NOSE,\n2X FWD FLAP', fs=FS - 2.5)
    leader((fz(B.Z_NOSE + 7), yb + 0.3), (fz(B.Z_NOSE) + 14, FY - 33), 'BAND 15', fs=FS - 2)
    leader((fz(110), FY - sc * RO * np.cos(np.radians(35))), (fz(0) - 4, FY - 33), '4X STRAKE\n(SHEET 2)', ha='right', fs=FS - 2)

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
    leader((SX + sc * zs, ytop), (SX + sc * zs - 12, SY + 30), f'4X Ø3.2 THRU AT 0°/180°, {B.SLED_Z0 + 3:.0f} + {zs:.0f}\nFROM TAIL (SLED M3)', ha='right', fs=FS - 2.5)
    # bays + CG
    txt(SX + sc * 60, SY, 'TVC BAY', fs=FS - 3, style='italic', bbox=dict(fc='white', ec='none', pad=0.6))
    txt(SX + sc * (B.SLED_Z0 + 50), SY + 6, f'SLED BAY, {B.B_LEN - 2 * B.INSERT:.0f} CLEAR', fs=FS - 3, style='italic', bbox=dict(fc='white', ec='none', pad=0.6))
    cg_symbol((SX + sc * CGZ, SY), 2.6)
    leader((SX + sc * CGZ + 1.8, SY - 1.8), (SX + sc * CGZ + 12, SY - 10), f'CG ~{CGZ:.0f} FROM TAIL (REF)\n= DESK-RIG PIVOT', fs=FS - 2.5)
    leader((SX + sc * 470, ytop), (SX + sc * 470 + 10, SY + 31), f'Ø{2 * RO:.1f}, Ø{2 * RI:.1f} BORE, WALL {B.WALL:g}', fs=FS - 2.5)
    leader((SX + sc * (B.Z_NOSE - 10), SY + 2), (SX + sc * 440, SY + 12), f'BALLAST COLUMN Ø{B.COL_D:g}\n(SHEET 2)', ha='right', fs=FS - 2.5)
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
    txt(VX + 16, VY + 31, f'4X STRAKE AT {B.STRAKE_ANGLES[0]}°\n+ 90° X', fs=FS - 2.5)
    caption(VX, VY - 38, 'VIEW D (TAIL END)\nSCALE 1:2')

    # ---------- NOTES ----------
    notes_block(275, 103, ['NOTES:',
        '1. PLA, 0.6 NOZZLE: TUBES 2 WALLS, COUPLERS 4 WALLS. NO SUPPORTS.',
        f'2. FITS SLDP-TVC-002 (GIMBAL {B.GIMBAL_Z:g}, TUBE {-B.EXHAUST_Z:g} BELOW TAIL) + SLDP-AV-001 (SLED {B.SLED_Z0:.0f}-{B.SLED_Z0 + B.SLED_H:.0f}).',
        '3. SLED INTO B FROM BELOW, DOOR (8) OFF. BOND C1 INTO A, C2 INTO D.',
        f'4. RIG PIVOT AT THE MEASURED CG (~{CGZ:.0f} REF); A FULL COLLAR STAYS BELOW 238.',
        '5. ANGLES FROM +X, CCW FROM NOSE. ESC OFF-BOARD; TETHER EXITS THE DOOR NOTCH.',
        '6. BOOSTER = 1 (STRAKES) + 2 + GRID FINS 12; RING = 4; SHIP = 5 + 6. STAND: SLDP-GS-003.',
        '7. DETAILS: SHEETS 2-5. EXPLODED VIEW + PARTS LIST: SHEET 6.'], fs=FS - 3, pitch=4.8)
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
    g = M['G_bay_door'].copy(); g.apply_translation((0, 45, shift['B_avionics_bay'])); ex.append(g); tag.append('G')
    for k, gfm in enumerate(GFINS):
        a = np.radians(B.GF_ANGLES[0] + 90 * k); g = gfm.copy(); g.apply_translation((35 * np.cos(a), 35 * np.sin(a), shift['B_avionics_bay'])); ex.append(g); tag.append('H')
    FPULL = 40.0
    for k, f in enumerate(FINS):
        a = np.radians(B.FIN_ANGLES[0] + 90 * k); g = f.copy(); g.apply_translation((FPULL * np.cos(a), FPULL * np.sin(a), 0)); ex.append(g); tag.append('F')
    d, up = (-0.35, -0.8, -0.5), (-1, 0, 0)
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
        if n in ('F', 'G', 'H'): continue
        zc = (m.vertices[:, 2].min() + m.vertices[:, 2].max()) / 2
        p = Pj(surf(m, (RO * 0.2, RO * 1.2, zc)))
        cpos = p + np.array([-6, -24]) if item[n] % 2 else p + np.array([6, -34])
        balloon(p, cpos, item[n])
    gm = ex[tag.index('G')]; p = Pj(surf(gm, gm.vertices.mean(0) + (0, 20, 0))); balloon(p, p + np.array([14, 22]), 8)
    hm = [m for m, n in zip(ex, tag) if n == 'H']
    hb = max(hm, key=lambda m: (m.vertices @ u).mean()); p = Pj(hb.vertices.mean(0)); balloon(p, p + np.array([10, 20]), 12)
    caption(215, 146, 'EXPLODED ISOMETRIC VIEW (PRINT PARTITION)  SCALE 1:4')
    # parts list
    names = {1: 'A  LOWER BODY (TVC BAY, NOTCH, VENTS, 4X STRAKE)', 2: 'B  AVIONICS BAY (SLED, DOOR FRAME)', 3: 'C1 COUPLER, BAND 3',
             4: 'C2 COUPLER, HOT-STAGING RING (20 POCKETS)', 5: 'D  SHIP BODY, 2X AFT FLAP', 6: 'E  OGIVE NOSE, 2X FWD FLAP, BALLAST', 7: 'F  FIN, 2 THK', 8: 'G  AVIONICS BAY DOOR'}
    out, _ = B.report(*B.build())
    by = {o[0]: o for o in out}
    keys = {1: 'A_lower_body', 2: 'B_avionics_bay', 3: 'C1_coupler', 4: 'C2_interstage_coupler', 5: 'D_upper_body', 6: 'E_nose_cone', 7: 'F_fin', 8: 'G_bay_door'}
    rows = []
    for i in range(8, 0, -1):
        if i == 7:
            rows.insert(0, (7, '-', 'DELETED: ST-007 FIN (NOW STRAKES ON ITEM 1)', '-', '-')); continue
        o = by[keys[i]]
        rows.insert(0, (i, o[1], names[i], f'{o[2]:.0f}', 'PLA'))
    hgf = by['H_grid_fin']
    rows += [(9, 9, 'SCREW M3 X 6 BUTTON HD (TVC 2, JOINTS 6, DOOR 1)', '6', 'STEEL'),
             (10, 4, 'SCREW M3 X 8 BUTTON HD (SLED)', '8', 'STEEL'),
             (11, 'AR', 'ADHESIVE: CA + 5-MIN EPOXY', '-', '-'),
             (12, 4, 'H  GRID FIN (BONDED TO 2)', f'{hgf[2]:.0f}', 'PLA')]
    tbx, tby, tbw, tbh = S.frame(6, NSH, DWG, TITLE, scale='1:4', mass=MASS, material='PLA', revisions=False)
    S.parts_list(tbx, tby + tbh, rows, cols=((0, 11, 'ITEM'), (11, 10, 'QTY'), (21, 79, 'DESCRIPTION'), (100, 26, 'MAX DIM'), (126, 24, 'MATERIAL')))
    notes_block(20, 132, ['NOTES:',
        f'1. EVERY PART FITS THE BAMBU BUILD VOLUME (254 X 254 X 254). LONGEST: ITEM 1, {by["A_lower_body"][2]:.0f} MM.',
        '2. PRINT TUBES (1, 2, 5) AND COUPLERS (3, 4) UPRIGHT ON THEIR END FACES (5: FLAPS ON THE BED).',
        '   ITEM 6 TIP UP. 8 UPRIGHT (TABS DOWN), 12 FLAT (CELLS VERTICAL). BRIM ON TUBES. NO SUPPORTS.',
        '3. ASSEMBLY ORDER: TVC MOUNT INTO 1; SLED INTO 2 FROM BELOW; 3 JOINS 1-2; 4 JOINS 2-5; 6 INTO 5; DOOR 8.',
        '   BOND 3 INTO 1 AND 4 INTO 5 ONLY; JOINTS 2/3, 2/4, 5/6 SCREWED (ITEM 9), SO 2 STAYS REMOVABLE.',
        f'4. ITEM 1 STRAKES (4X AT {B.STRAKE_ANGLES[0]}° + 90° X) PRINT WITH 1. ITEM 7 DELETED. DISPLAY ON SLDP-GS-003.',
        f'5. GRID FINS (12) BONDED TO 2 AT {", ".join(f"{a}°" for a in B.GF_ANGLES)}, Z {B.GF_Z0:g}-{B.GF_Z0 + B.GF_H:g}. PAINT C2 POCKETS BLACK.'], fs=FS - 2.5, pitch=5.6)
    # ---------- build-volume check: every part in a 254 x 254 bed elevation, 1:5 ----------
    s5 = 0.2; bw = 254 * s5; gx = 9.0; X0, Y0 = 24.0, 20.0
    RC, RCI, RO_, INS = B.RC, B.RCI, B.RO, B.INSERT
    def tube_prof(Lz): return [(B.RI, 0), (RO_, 0), (RO_, Lz), (B.RI, Lz)]
    def cpl_prof(band): return [(RCI, 0), (RC, 0), (RC, INS), (RO_, INS), (RO_, INS + band), (RC, INS + band), (RC, 2 * INS + band), (RCI, 2 * INS + band)]
    zc = INS + B.NOSE_BAND
    nose_prof = [(RCI, 0), (RC, 0), (RC, INS), (RO_, INS), (RO_, zc)] + [(r, zc + x) for r, x in B.ogive(RO_, B.NOSE_L, B.OGIVE_TIP, 16)]
    def outline(prof, cx, y0):
        right = [(cx + s5 * r, y0 + s5 * z) for r, z in prof]
        left = [(cx - s5 * r, y0 + s5 * z) for r, z in prof[::-1]]
        poly(right + left, THIN * 1.4)
    plates = [[(1, tube_prof(B.A_LEN))], [(2, tube_prof(B.B_LEN)), (5, tube_prof(B.S2_LEN))],
              [(6, nose_prof), (3, cpl_prof(B.BAND1)), (4, cpl_prof(B.BAND2))], [('8', None)]]
    # plate 4: door (item 8) + grid fins (item 12)
    for k, pl in enumerate(plates):
        bx = X0 + k * (bw + gx)
        box(bx, Y0, bx + bw, Y0 + bw, THIN, PH)
        n = len(pl); slot = bw / n
        for j, (it, prof) in enumerate(pl):
            cx = bx + slot * (j + 0.5)
            if prof is None:
                dh = B.FLANGE_Z1 - B.TAB_Z0; box(bx + bw / 2 - s5 * B.FLANGE_W / 2, Y0 + 22, bx + bw / 2 + s5 * B.FLANGE_W / 2, Y0 + 22 + s5 * dh, THIN * 1.4)
                txt(bx + bw / 2, Y0 + 22 + s5 * dh + 4, '8 (UPRIGHT)', fs=FS - 3.5)
                for f in range(4): box(bx + 34 + (f % 2) * 6, Y0 + 24 + (f // 2) * 6, bx + 34 + (f % 2) * 6 + s5 * 20, Y0 + 24 + (f // 2) * 6 + s5 * 22, THIN * 1.4)
                txt(bx + 40, Y0 + 38, '12 (4X)', fs=FS - 3.5)
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
    # ---------------- ITEM 6 OGIVE NOSE, SECTION ON THE FLAP PLANE (Y = 0), 1:1 ----------------
    cx, by = 112.0, 92.0
    zb0 = B.Z_NOSE - INS
    zc = INS + B.NOSE_BAND; Ln = B.NOSE_L; top = zc + Ln
    to2d = lambda v: np.c_[cx + v[:, 0], by + (v[:, 2] - zb0)]
    for pg in section_polys(M['E_nose_cone'], [0, 0, 0], [0, 1, 0], to2d): cut_face(pg, solid=True)
    L([cx, cx], [by - 5, by + top + 5], THIN, CL)
    xl = cx - 56
    for z in (0, INS, zc, top): L([cx - (RC if z <= INS else (RO_ if z < top else 0)) - 1.5, xl - 30], [by + z] * 2, THIN)
    for z0, z1, lab in ((0, INS, f'{INS:g}'), (INS, zc, f'{B.NOSE_BAND:g}'), (zc, top, f'{Ln:.1f}')):
        dim_v(xl - 10, by + z0, by + z1, lab, fs=FS - 1)
    dim_v(xl - 26, by, by + top, f'{top:.1f}', fs=FS - 1)
    dim_h(by - 9, cx - RC, cx + RC, f'Ø{dC:.1f}', e0=by, e1=by, fs=FS - 1)
    a, b_, s0, s1, t = B.FWD_FLAP
    fa, fb = by + zc + a, by + zc + b_
    ra, rb = B.nose_r(a), B.nose_r(b_)
    # flap dims (right flap, 0 deg)
    L([cx + rb + s1 + 1.5, cx + 76], [fb] * 2, THIN); L([cx + ra + 1.5, cx + 76], [fa] * 2, THIN); L([cx + RO_ + 1.5, cx + 76], [by + zc] * 2, THIN)
    dim_v(cx + 66, by + zc, fa, f'{a:g}', side='right', fs=FS - 2)
    dim_v(cx + 74, by + zc, fb, f'{b_:g}', side='right', fs=FS - 2)
    dim_h(fb + 7, cx + rb, cx + rb + s1, f'{s1:g}', e0=fb, e1=fb, fs=FS - 2)
    dim_h(fa - 6, cx + ra, cx + ra + s0, f'{s0:g}', e0=fa, e1=fa + s0, fs=FS - 2)
    leader((cx + ra + s0 * 0.5, fa + s0 * 0.5), (cx + 60, fa - 18), f'45°, FLAP {t:g} THK', fs=FS - 3)
    leader((cx + B.COL_D / 2, by + 12), (cx + 46, by - 14), f'BALLAST COLUMN Ø{B.COL_D:g},\nPILOT Ø{B.COL_PILOT:g} X {B.COL_PILOT_L:g} (M3 + WASHERS)', fs=FS - 3)
    leader((cx - RCI + 0.3, by + 8), (xl - 4, by - 14), f'Ø{dCI:.1f} BORE', ha='right', fs=FS - 3)
    leader((cx + B.nose_r(85) - 0.4, by + zc + 85), (cx + 34, by + top + 4), f'TANGENT OGIVE L {Ln:.1f}, WALL {W:g},\n2X FWD FLAP AT 0°/180°', fs=FS - 3)
    caption(cx, by - 22, 'ITEM 6 OGIVE NOSE, SECTION ON\nTHE FLAP PLANE, SCALE 1:1')

    # ---------------- ITEM 3 C1 COUPLER, SECTION, 1:1 ----------------
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
    coupler_sheet(258.0, 182.0, B.BAND1, 3, 'C1 COUPLER')

    # ---------------- ITEM 1 STRAKE (4X, PRINTED ON 1): face view 1:1, section K-K 5:1 ----------------
    z0s, z1s = B.STRAKE_Z; ws, hs = B.STRAKE_W, B.STRAKE_H
    fx0, fy0 = 214.0, 66.0                                       # face view: x = tangential, y = z from tail - z0s
    yk = lambda z: fy0 + 0.5 * (z - z0s)                         # 1:2 along z so it fits
    box(fx0 - ws / 2, yk(z0s), fx0 + ws / 2, yk(z1s), THICK)
    for z in (z0s + hs + 0.4, z1s - hs - 0.4): L([fx0 - ws / 2, fx0 + ws / 2], [yk(z)] * 2, THIN)
    L([fx0, fx0], [yk(z0s) - 4, yk(z1s) + 4], THIN, CL)
    for z in (z0s, z1s): L([fx0 - ws / 2 - 1.5, fx0 - 26], [yk(z)] * 2, THIN)
    dim_v(fx0 - 20, yk(z0s), yk(z1s), f'{z1s - z0s:g}', fs=FS - 1)
    txt(fx0 - 4, yk(z0s) - 4, f'START {z0s:g}\nFROM TAIL', ha='right', fs=FS - 3)
    dim_h(yk(z1s) + 7, fx0 - ws / 2, fx0 + ws / 2, f'{ws:g}', e0=yk(z1s), e1=yk(z1s), fs=FS - 1.5)
    for yy in (yk((z0s + z1s) / 2),):
        L([fx0 - 6, fx0 - 3], [yy, yy], THICK, CP); L([fx0 + 3, fx0 + 6], [yy, yy], THICK, CP)
        txt(fx0 - 8, yy, 'K', fontweight='bold', ha='right'); txt(fx0 + 8, yy, 'K', fontweight='bold', ha='left')
    caption(fx0, fy0 - 10, 'ITEM 1 STRAKE (4X), FACE VIEW\n1:1 ACROSS, 1:2 ALONG Z')
    # section K-K at 5:1: wall arc + strake
    kx, ky, k5 = 262.0, 96.0, 5.0
    th = np.radians(np.linspace(-9, 9, 60))
    for rr, lw in ((B.RI, THICK), (RO_, THICK)):
        L(kx + k5 * (rr * np.sin(th)), ky + k5 * (rr * np.cos(th) - RO_), lw)
    for sx in (-1, 1): L([kx + k5 * sx * B.RI * np.sin(np.radians(9)), kx + k5 * sx * RO_ * np.sin(np.radians(9))],
                         [ky + k5 * (B.RI * np.cos(np.radians(9)) - RO_), ky + k5 * (RO_ * np.cos(np.radians(9)) - RO_)], THIN, PH)
    wall = SPoly([(kx + k5 * r * np.sin(t), ky + k5 * (r * np.cos(t) - RO_)) for r, t in [(B.RI, a) for a in th] + [(RO_, a) for a in th[::-1]]])
    cut_face(wall, solid=False, angle=45, pitch=1.2, lw=THICK * 0.8)
    st = SPoly([(kx - k5 * ws / 2, ky - k5 * 0.4), (kx + k5 * ws / 2, ky - k5 * 0.4), (kx + k5 * ws / 2, ky + k5 * hs), (kx - k5 * ws / 2, ky + k5 * hs)])
    cut_face(st, solid=False, angle=45, pitch=1.2, lw=THICK * 0.8)
    dim_h(ky + k5 * hs + 7, kx - k5 * ws / 2, kx + k5 * ws / 2, f'{ws:g}', e0=ky + k5 * hs, e1=ky + k5 * hs, fs=FS - 1.5)
    L([kx + k5 * ws / 2 + 1.5, kx + k5 * ws / 2 + 14], [ky + k5 * hs] * 2, THIN); L([kx + k5 * 2.5, kx + k5 * ws / 2 + 14], [ky] * 2, THIN)
    dim_v(kx + k5 * ws / 2 + 11, ky, ky + k5 * hs, f'{hs:g}', side='right', fs=FS - 1.5)
    caption(kx, ky - 14, 'SECTION K-K  SCALE 5:1\nENDS CHAMFERED 45°')

    # ---------------- ASSEMBLY SEQUENCE ----------------
    notes_block(306, 149, ['ASSEMBLY SEQUENCE:',
        '1. PRINT ITEMS 1-8, 12 (SHEET 6). DRY-FIT 3, 4;',
        '   SAND THE INSERT OD IF TIGHT.',
        '2. MARK A 0° WITNESS LINE ON 1, 2, 5.',
        '3. (NO FINS: STRAKES ARE PRINTED ON 1.)',
        '4. BOND 3 INTO TOP OF 1 (BAND 3 SHOWING).',
        '5. BOND 4 INTO BOTTOM OF 5.',
        '6. TVC MOUNT INTO 1 FROM TAIL: 2X ITEM 9,',
        '   RIDING SERVO CENTRED IN THE TAIL NOTCH.',
        '7. SLED INTO 2 FROM BOTTOM: 4X ITEM 10.',
        '8. TETHER UP THROUGH 3, OUT THE DOOR NOTCH.',
        '9. 2 ONTO 3, 5 + 4 ONTO 2, LINES ALIGNED;',
        '   DRILL Ø2.5 THROUGH THE HOLES, 4X ITEM 9.',
        '10. 6 INTO 5: DRILL Ø2.5, 2X ITEM 9.',
        '11. DOOR 8: TABS IN, DRILL SLED RING Ø2.5,',
        '   1X ITEM 9. BALANCE; SET RIG PIVOT AT CG.',
        '12. BOND 4X ITEM 12 TO 2 AT 45° + 90° X.'], fs=FS - 3, pitch=4.7)
    S.frame(2, NSH, DWG, TITLE, scale='1:1', mass=MASS, material='PLA', revisions=False)
    return fig

# =========================================================================== SHEETS 3 + 4 (v6 features)
def view(meshes, d, up, sc, ref3, ref2, lw=THICK * 0.8):
    """HLR view; returns Pj mapping 3D -> sheet so that ref3 lands on ref2."""
    lines, _, (r, u) = hlr.view_lines(meshes, d, up)
    r, u = np.asarray(r), np.asarray(u); ref3 = np.asarray(ref3, float)
    OX, OY = ref2[0] - sc * (ref3 @ r), ref2[1] - sc * (ref3 @ u)
    draw_lines(lines, (OX, OY), sc, lw=lw)
    return lambda p: np.array([OX + sc * (np.asarray(p, float) @ r), OY + sc * (np.asarray(p, float) @ u)])

def crop(m, zmax):
    c = m.slice_plane([0, 0, zmax], [0, 0, -1], cap=False); c.merge_vertices(); return c

def radial_dir(deg):
    a = np.radians(deg); return np.array([np.cos(a), np.sin(a), 0.0])

def sheet_item1():
    fig = S.new_sheet()
    ZC = 95.0
    Acrop = crop(M['A_lower_body'], ZC)
    ty = 148.0
    # ---------------- VIEW F: tail notch, looking at 280 deg ----------------
    n = radial_dir(B.NOTCH_ANG); t = np.array([-n[1], n[0], 0.0]); cx = 92.0
    Pj = view([Acrop] + FINS, -n, (0, 0, 1), 1.0, (0, 0, 0), (cx, ty))
    ctr = lambda w, z: Pj(t * w + n * RO + (0, 0, z))
    L([cx, cx], [ty - 6, ty + ZC + 4], THIN, CL)
    hw, zt = B.NOTCH_W / 2, B.NOTCH_TOP
    p0, p1 = ctr(-hw, 0), ctr(hw, 0)
    dim_h(ty - 9, p0[0], p1[0], f'{B.NOTCH_W:g}', fs=FS - 1)
    q = ctr(hw, zt)
    L([q[0] + 1.5, cx + 66], [q[1]] * 2, THIN); L([cx + 52, cx + 66], [ty, ty], THIN)
    dim_v(cx + 62, ty, q[1], f'{zt:g}', side='right', fs=FS - 1)
    leader(ctr(-hw + B.NOTCH_R * 0.3, zt - B.NOTCH_R * 0.3), (cx - 50, ty + 62), f'2X R{B.NOTCH_R:g}', ha='right', fs=FS - 2)
    leader(Pj(radial_dir(325) * (RO + 0.8) + (0, 0, 70)), (cx + 52, ty + 70), f'STRAKE AT 325°\n(235° OPPOSITE)', fs=FS - 3)
    L([cx - 52, cx + 52], [ty + ZC] * 2, THIN, PH)
    caption(cx, ty - 17, f'VIEW F  TAIL NOTCH, CENTRED ON {B.NOTCH_ANG:g}°\nOPEN AT THE TAIL, SCALE 1:1')

    # ---------------- VIEW H: fixed-servo window, looking at 184 deg ----------------
    n = radial_dir(B.WIN_ANG); t = np.array([-n[1], n[0], 0.0]); cx = 285.0
    Pj = view([Acrop] + FINS, -n, (0, 0, 1), 1.0, (0, 0, 0), (cx, ty))
    ctr = lambda w, z: Pj(t * w + n * RO + (0, 0, z))
    L([cx, cx], [ty - 6, ty + ZC + 4], THIN, CL)
    hw = B.WIN_W / 2
    pa, pb = ctr(-hw, B.WIN_Z1), ctr(hw, B.WIN_Z1)
    pa, pb = ctr(-hw, B.WIN_Z0), ctr(hw, B.WIN_Z0)
    dim_h(pa[1] - 7, pa[0], pb[0], f'{B.WIN_W:g}', e0=pa[1], e1=pb[1], fs=FS - 1)
    for z in (B.WIN_Z0, B.WIN_Z1):
        q = ctr(hw, z); L([q[0] + 1.5, cx + 70], [q[1]] * 2, THIN)
    L([cx + 56, cx + 70], [ty, ty], THIN)
    dim_v(cx + 58, ty, ctr(hw, B.WIN_Z0)[1], f'{B.WIN_Z0:g}', side='right', fs=FS - 1)
    dim_v(cx + 67, ctr(hw, B.WIN_Z0)[1], ctr(hw, B.WIN_Z1)[1], f'{B.WIN_Z1 - B.WIN_Z0:g}', side='right', fs=FS - 1)
    leader(ctr(-hw + B.WIN_R * 0.3, B.WIN_Z1 - B.WIN_R * 0.3), (cx - 52, ty + 72), f'4X R{B.WIN_R:g}', ha='right', fs=FS - 2)
    leader(Pj(radial_dir(180) * RO + (0, 0, B.GIMBAL_Z)), (cx - 52, ty + 20), f'Ø3.2 TVC MOUNT AT 180°,\n{B.GIMBAL_Z:g} FROM TAIL', ha='right', fs=FS - 3)
    L([cx - 52, cx + 52], [ty + ZC] * 2, THIN, PH)
    caption(cx, ty - 17, f'VIEW H  FIXED-SERVO WINDOW, CENTRED ON {B.WIN_ANG:g}°\nSCALE 1:1')
    for xx in (92.0, 285.0): txt(xx + 54, ty + ZC, 'BREAK', ha='left', fs=FS - 4)

    notes_block(20, 108, ['NOTES (ITEM 1, PART A):',
        '1. NOTCH AND WINDOW ARE SIZED FROM THE MG90S SWEEP AT ±10° ON BOTH GIMBAL AXES (SLDP-TVC-002) + 1.5 MM.',
        '   THE RIDING-SERVO HORN AND THE FIXED-SERVO HORN SWING OUTSIDE THE BODY THROUGH THEM (TO R48 / R44).',
        '2. WIDTHS ARE STRAIGHT CHORDS; CUT EDGES ARE PARALLEL TO THE CENTRE RADIUS (280° / 184°).',
        f'3. STRAKES AT {", ".join(f"{a}°" for a in B.STRAKE_ANGLES)} FRAME THE NOTCH ({B.NOTCH_ANG - 41.4:.0f}°-{B.NOTCH_ANG + 41.4:.0f}° AT THE OD) AND START {B.STRAKE_Z[0]:g} FROM THE TAIL.',
        f'4. MOTOR TUBE + EDF EXIT {-B.EXHAUST_Z:g} BELOW THE TAIL. 4X INTAKE VENTS AT {B.VENT_Z:g} UNCHANGED (SHEET 1).',
        '5. REPRINT OF ST-005 PART A REQUIRED; PART B ALSO CHANGES (SHEET 4). ALL OTHER PARTS UNCHANGED.'], fs=FS - 3, pitch=5.6)
    S.frame(3, NSH, DWG, TITLE, scale='1:1', mass=MASS, material='PLA', revisions=False)
    return fig

def sheet_item2():
    fig = S.new_sheet()
    Bm = M['B_avionics_bay']; Gm = M['G_bay_door']
    # ---------------- VIEW E: item 2 door opening, looking at 90 deg (door off) ----------------
    cx, by = 92.0, 96.0
    view([Bm], (0, -1, 0), (0, 0, 1), 1.0, (0, 0, B.Z_B0), (cx, by))
    zb = lambda z: by + (z - B.Z_B0)
    L([cx, cx], [by - 5, zb(B.Z_BT) + 5], THIN, CL)
    hw = B.OPEN_W / 2; xl, xr = cx - RO, cx + RO
    dim_h(zb(B.OPEN_Z1) + 14, cx - hw, cx + hw, f'{B.OPEN_W:g}', e0=zb(B.OPEN_Z1), e1=zb(B.OPEN_Z1), fs=FS - 1)
    for z in (B.Z_B0, B.OPEN_Z0, B.OPEN_Z1, B.Z_B0 + B.JOINT_HOLE, B.Z_BT - B.JOINT_HOLE, B.Z_BT):
        xs = cx - (hw if z in (B.OPEN_Z0, B.OPEN_Z1) else (RO if z in (B.Z_B0, B.Z_BT) else 2))
        L([xs - 1.5, xl - 21], [zb(z)] * 2, THIN)
    for z in (B.Z_B0, B.DOOR_SCREW_Z, B.Z_BT):
        xs = cx + (RO if z in (B.Z_B0, B.Z_BT) else 2); L([xs + 1.5, xr + 21], [zb(z)] * 2, THIN)
    dim_v(xl - 8, zb(B.Z_B0), zb(B.Z_B0 + B.JOINT_HOLE), f'{B.JOINT_HOLE:g}', fs=FS - 1)
    dim_v(xl - 8, zb(B.OPEN_Z0), zb(B.OPEN_Z1), f'{B.OPEN_Z1 - B.OPEN_Z0:g}', fs=FS - 1)
    dim_v(xl - 8, zb(B.Z_BT - B.JOINT_HOLE), zb(B.Z_BT), f'{B.JOINT_HOLE:g}', fs=FS - 1)
    dim_v(xl - 18, zb(B.Z_B0), zb(B.OPEN_Z0), f'{B.OPEN_Z0 - B.Z_B0:g}', fs=FS - 1)
    dim_v(xr + 8, zb(B.Z_B0), zb(B.DOOR_SCREW_Z), f'{B.DOOR_SCREW_Z - B.Z_B0:g}', side='right', fs=FS - 1)
    dim_v(xr + 18, zb(B.Z_B0), zb(B.Z_BT), f'{B.B_LEN:g}', side='right', fs=FS - 1)
    leader((cx + 1.2, zb(B.DOOR_SCREW_Z) + 1.2), (cx + 14, zb(B.Z_BT) + 8), 'Ø3.2 THRU (DOOR SCREW)', fs=FS - 2.5)
    leader((cx - 1.2, zb(B.Z_BT - B.JOINT_HOLE) + 1.2), (cx - 14, zb(B.Z_BT) + 8), '4X Ø3.2 THRU AT 90°/270°\n(JOINT SCREWS)', ha='right', fs=FS - 2.5)
    leader((cx + hw - 1.0, zb(B.OPEN_Z0) + 1.0), (xr + 26, zb(B.OPEN_Z0) - 14), f'4X R{B.OPEN_R:g}', fs=FS - 2.5)
    fo = B.FLANGE_W / 2 + B.FRAME_GAP + B.FRAME_BAND
    leader((cx + fo - 0.8, zb(B.OPEN_Z0 + 8)), (xr + 26, zb(B.OPEN_Z0) - 34),
           f'RAISED FRAME, {B.FLANGE_T:g} HIGH X {B.FRAME_BAND:g} WIDE,\n{B.FLANGE_W + 2 * B.FRAME_GAP:.1f} X {B.FLANGE_Z1 - B.FLANGE_Z0 + 2 * B.FRAME_GAP:.1f} INSIDE, '
           f'R{B.FLANGE_R + B.FRAME_GAP:.1f},\n{B.FLANGE_Z0 - B.FRAME_GAP - B.Z_B0:.1f} FROM BOTTOM', fs=FS - 2.5)
    caption(cx, by - 8, 'VIEW E  ITEM 2 FROM 90° (DOOR OFF)\nSCALE 1:1, Z FROM ITEM 2 BOTTOM')

    # ---------------- ITEM 8 DOOR: outside + inside views ----------------
    fz0 = B.FLANGE_Z0; by = 150.0; zb = lambda z: by + (z - fz0)
    for cx, d, lab in ((250.0, (0, -1, 0), 'OUTSIDE'), (316.0, (0, 1, 0), 'INSIDE')):
        view([Gm], d, (0, 0, 1), 1.0, (0, 0, fz0), (cx, by))
        L([cx, cx], [zb(B.TAB_Z0) - 4, zb(B.FLANGE_Z1) + 4], THIN, CL)
        caption(cx, zb(B.TAB_Z0) - 8, f'ITEM 8 DOOR\n{lab} VIEW, 1:1')
    cx = 250.0; hw = B.FLANGE_W / 2
    dim_h(zb(B.FLANGE_Z1) + 8, cx - hw, cx + hw, f'{B.FLANGE_W:g}', e0=zb(B.FLANGE_Z1) - 4, e1=zb(B.FLANGE_Z1) - 4, fs=FS - 1)
    L([cx - hw - 1.5, cx - hw - 13], [zb(B.FLANGE_Z0)] * 2, THIN); L([cx - hw + 4, cx - hw - 13], [zb(B.FLANGE_Z1)] * 2, THIN)
    dim_v(cx - hw - 9, zb(B.FLANGE_Z0), zb(B.FLANGE_Z1), f'{B.FLANGE_Z1 - B.FLANGE_Z0:g}', fs=FS - 1)
    leader((cx + 1.1, zb(B.DOOR_SCREW_Z) + 1.1), (cx + 8, zb(B.FLANGE_Z1) + 17), f'Ø3.2, {B.FLANGE_Z1 - B.DOOR_SCREW_Z:g} FROM TOP', fs=FS - 3)
    leader((cx - hw + 1.5, zb(B.FLANGE_Z1) - 1.5), (cx - hw - 6, zb(B.FLANGE_Z1) + 10), f'4X R{B.FLANGE_R:g}', ha='right', fs=FS - 3)
    cw = B.CABLE_W / 2
    dim_h(zb(B.FLANGE_Z0) - 13, cx - cw, cx + cw, f'{B.CABLE_W:g}', e0=zb(B.FLANGE_Z0), e1=zb(B.FLANGE_Z0), fs=FS - 1.5)
    leader((cx - cw + 0.4, zb(B.OPEN_Z0 + B.CABLE_H) - 0.5), (cx - hw - 8, zb(B.FLANGE_Z0) - 9),
           f'CABLE NOTCH,\n{B.OPEN_Z0 + B.CABLE_H - B.FLANGE_Z0:g} DEEP', ha='right', fs=FS - 3)
    cx = 316.0
    y0, y1 = B.TAB_Y
    leader((cx + (y0 + y1) / 2, zb(B.TAB_Z0 + 2)), (cx + hw + 6, zb(B.TAB_Z0 + 6)),
           f'2X TAB {y1 - y0:g} W X {B.TAB_Z1 - B.TAB_Z0:g},\n{y0:g}-{y1:g} FROM CL, {B.FLANGE_Z0 - B.TAB_Z0:g}\nBELOW FLANGE, {1.2:g} THK', fs=FS - 3)
    leader((cx + (B.OPEN_W / 2 - B.DOOR_CLR) - 0.5, zb(B.OPEN_Z1 - 20)), (cx + hw + 6, zb(B.OPEN_Z1 - 30)),
           f'PLUG {B.OPEN_W - 2 * B.DOOR_CLR:.1f} X {B.OPEN_Z1 - B.OPEN_Z0 - 2 * B.DOOR_CLR:.1f},\nR{B.OPEN_R - B.DOOR_CLR:.1f}, {B.WALL:g} THK\n'
           f'(OPENING - {B.DOOR_CLR:g}/SIDE),\n{B.OPEN_Z0 + B.DOOR_CLR - B.FLANGE_Z0:g} ABOVE FLANGE\nBOTTOM. FLANGE {B.FLANGE_T:g} THK', fs=FS - 3)
    # cutting plane J-J on the inside view (through a tab)
    xJ = (B.TAB_Y[0] + B.TAB_Y[1]) / 2; xs = cx + xJ
    for yy, sgn in ((zb(B.FLANGE_Z1) + 3, 1), (zb(B.TAB_Z0) - 1.5, -1)):
        L([xs, xs], [yy, yy + sgn * 4], THICK, CP)
        arrow((xs, yy + sgn * 4), (xs - 5, yy + sgn * 4), ms=8)
        txt(xs + 3, yy + sgn * 4, 'J', fontweight='bold', fs=FS - 1)

    # ---------------- SECTION J-J (partial, 3:1): tab hooked behind the item 2 wall, door installed ----------
    z0k, z1k, r0k, r1k = 233.0, 252.0, RI - 3.0, RO + 2.5
    kx, ky, ks = 374.0, 84.0, 3.0
    X = lambda r: kx + ks * (r - r0k); Y = lambda z: ky + ks * (z - z0k)
    clip = sbox(r0k, z0k, r1k, z1k)
    to2dk = lambda v: np.c_[v[:, 1], v[:, 2]]
    for mesh, ang in ((Gm, 135), (Bm, 45)):
        for pg in section_polys(mesh, [xJ, 0, 0], [1, 0, 0], to2dk):
            g = pg.intersection(clip)
            for gg in getattr(g, 'geoms', [g]):
                if gg.is_empty or gg.geom_type != 'Polygon': continue
                cc = np.array(gg.exterior.coords)
                cut_face(SPoly(np.c_[X(cc[:, 0]), Y(cc[:, 1])]), solid=False, angle=ang, pitch=0.9, lw=THICK * 0.8)
    poly([(X(r0k), Y(z0k)), (X(r1k), Y(z0k)), (X(r1k), Y(z1k)), (X(r0k), Y(z1k))], THIN, PH)
    rs = B.SLED_Z0 + B.SLED_RING
    L([X(r0k), X(r1k) + 1], [Y(rs)] * 2, THIN, PH); txt(X(r1k) + 2, Y(rs), f'SLED RING TOP\n({rs:g} FROM TAIL)', ha='left', fs=FS - 4)
    dim_v(X(r1k) + 5, Y(B.TAB_Z0), Y(B.OPEN_Z0), f'{B.OPEN_Z0 - B.TAB_Z0:g}', e0=X(RI - 1.2), e1=X(RO), side='right', fs=FS - 2)
    leader((X(RI - 0.6), Y(B.TAB_Z0 + 4)), (X(r0k) - 4, Y(B.TAB_Z0 + 7)), 'TAB (8)', ha='right', fs=FS - 3)
    leader((X(RO + 0.6), Y(B.OPEN_Z0 + 3)), (X(r1k) + 4, Y(z1k) + 5), 'ITEM 8', fs=FS - 3)
    leader((X(RI + 0.6), Y(B.FLANGE_Z0 - 6)), (X(r0k) - 4, Y(z0k) + 2), 'ITEM 2 WALL', ha='right', fs=FS - 3)
    txt(X((r0k + r1k) / 2), Y(z1k) + 3, 'BORE  |  OUTSIDE', fs=FS - 4)
    caption(X((r0k + r1k) / 2), Y(z0k) - 4, 'SECTION J-J (PARTIAL)\nSCALE 3:1')

    notes_block(20, 72, ['NOTES (ITEM 2 AND ITEM 8):',
        '1. DOOR AT 90° FACES THE BREADBOARD. TO FIT: HOOK THE TABS BEHIND THE WALL, SWING IN, 1X M3 X 6',
        '   (ITEM 9) THROUGH DOOR + WALL INTO THE SLED TOP RING (DRILL THE RING Ø2.5 ON ASSEMBLY).',
        '2. THE SLED GOES INTO ITEM 2 FROM THE BOTTOM WITH THE DOOR OFF (TABS SIT IN THE SLED PATH).',
        '3. TETHER (USB, SERVO 5 V, 3 TWISTED MOTOR PHASES) EXITS THE CABLE NOTCH, CLOSE TO THE RIG PIVOT.',
        '4. PRINT ITEM 8 UPRIGHT, TABS DOWN, NO SUPPORTS. CLEAR PETG OPTIONAL. SAND THE PLUG IF TIGHT.',
        '5. RIG COLLAR CLAMPS AT 17-33 FROM ITEM 2 BOTTOM (220-236 FROM TAIL), BELOW THE FRAME.'], fs=FS - 3, pitch=5.4)
    S.frame(4, NSH, DWG, TITLE, scale='1:1', mass=MASS, material='PLA', revisions=False)
    return fig

# =========================================================================== SHEET 5 (styling)
def sheet_styling():
    fig = S.new_sheet()
    # ---------------- ITEM 4 C2 HOT-STAGING RING: view from -Y, 1:1 ----------------
    C2 = M['C2_interstage_coupler']; cx, by = 78.0, 176.0; z0 = B.Z_BT - B.INSERT
    view([C2], (0, 1, 0), (0, 0, 1), 1.0, (0, 0, z0), (cx, by))
    zb = lambda z: by + (z - z0)
    L([cx, cx], [by - 5, zb(B.Z_S2 + B.INSERT) + 5], THIN, CL)
    hz0, hz1 = B.Z_BT + (B.BAND2 - B.HS_H) / 2, B.Z_BT + (B.BAND2 + B.HS_H) / 2
    xr = cx + RO
    for z in (B.Z_BT, hz0, hz1, B.Z_S2): L([xr + 1.5, xr + 26], [zb(z)] * 2, THIN)
    dim_v(xr + 10, zb(hz0), zb(hz1), f'{B.HS_H:g}', side='right', fs=FS - 1.5)
    dim_v(xr + 22, zb(B.Z_BT), zb(B.Z_S2), f'{B.BAND2:g}', side='right', fs=FS - 1.5)
    pa = 360.0 * 0.5 / B.HS_N
    leader((cx + 4.5, zb(hz1) - 2), (cx - 42, zb(B.Z_S2 + B.INSERT) + 10),
           f'{B.HS_N}X POCKET {B.HS_W:g} W X {B.HS_H:g} H X {B.HS_D:g} DEEP, EQ SP {360 / B.HS_N:g}°,\nFIRST AT {pa:g}° (NOT THROUGH). PAINT OR PRINT BLACK', fs=FS - 3)
    caption(cx, by - 9, 'ITEM 4 C2 HOT-STAGING RING, SCALE 1:1\n(OTHER DIMENSIONS AS C1, SHEET 2)')

    # ---------------- ITEM 5 SHIP BODY: aft flaps, view from -Y, 1:2 ----------------
    D = M['D_upper_body']; cx, by, s2 = 200.0, 150.0, 0.5
    view([D], (0, 1, 0), (0, 0, 1), s2, (0, 0, B.Z_S2), (cx, by))
    zb = lambda z: by + s2 * (z - B.Z_S2)
    root, tip, span, t = B.AFT_FLAP
    xf = cx + s2 * (RO + span)
    L([cx, cx], [by - 5, zb(B.Z_NOSE) + 5], THIN, CL)
    dim_h(by - 7, cx + s2 * RO, xf, f'{span:g}', e0=by, e1=by, fs=FS - 1.5)
    for z in (B.Z_S2 + tip, B.Z_S2 + root): L([xf + 1.5 if z == B.Z_S2 + tip else cx + s2 * RO + 1.5, xf + 22], [zb(z)] * 2, THIN)
    L([xf + 1.5, xf + 22], [by] * 2, THIN)
    dim_v(xf + 8, by, zb(B.Z_S2 + tip), f'{tip:g}', side='right', fs=FS - 1.5)
    dim_v(xf + 18, by, zb(B.Z_S2 + root), f'{root:g}', side='right', fs=FS - 1.5)
    leader((xf - 2, zb(B.Z_S2 + tip * 0.4)), (xf + 4, zb(B.Z_S2 + root) + 16), f'2X AFT FLAP AT 0°/180°, {t:g} THK,\nFLUSH WITH THE BOTTOM OF 5', fs=FS - 3)
    caption(cx, by - 15, 'ITEM 5 SHIP BODY, SCALE 1:2')

    # ---------------- ITEM 12 GRID FIN, 2:1 ----------------
    H0 = rotz(GF0, -B.GF_ANGLES[0]); s3 = 2.0
    gx, gy = 330.0, 196.0
    r0 = B.RO - 0.2; r1 = B.RO + B.GF_PAD + B.GF_SPAN
    view([H0], (0, 0, -1), (0, 1, 0), s3, ((r0 + r1) / 2, 0, 0), (gx, gy), lw=THICK * 0.6)
    X = lambda r: gx + s3 * (r - (r0 + r1) / 2)
    hw = B.GF_W / 2
    dim_h(gy + s3 * hw + 7, X(B.RO + B.GF_PAD), X(r1), f'{B.GF_SPAN:g}', e0=gy + s3 * hw, e1=gy + s3 * hw, fs=FS - 1.5)
    dim_h(gy + s3 * hw + 15, X(B.RO), X(B.RO + B.GF_PAD), f'{B.GF_PAD:g}', e0=gy + s3 * hw * 0.75, e1=gy + s3 * hw, fs=FS - 1.5)
    L([X(r1) + 1.5, X(r1) + 14], [gy - s3 * hw] * 2, THIN); L([X(r1) + 1.5, X(r1) + 14], [gy + s3 * hw] * 2, THIN)
    dim_v(X(r1) + 10, gy - s3 * hw, gy + s3 * hw, f'{B.GF_W:g}', side='right', fs=FS - 1.5)
    leader((X(B.RO + 6), gy - s3 * 3), (X(r0) - 6, gy - s3 * hw - 12),
           f'45° DIAMOND LATTICE,\nBARS {B.GF_WALL:g} THK AT {B.GF_CELL:g} PITCH', ha='right', fs=FS - 3)
    leader((X(B.RO + 0.8), gy + s3 * 4), (X(r0) - 6, gy + s3 * hw + 6), f'ROOT PAD R{B.RO:g}\n(BODY OD)', ha='right', fs=FS - 3)
    txt(gx, gy - s3 * hw - 22, f'HEIGHT {B.GF_H:g} (CELLS OPEN ALONG THE ROCKET AXIS)', fs=FS - 3)
    caption(gx, gy - s3 * hw - 29, 'ITEM 12 GRID FIN (4X), TOP VIEW, SCALE 2:1')

    # ---------------- CLOCKING DIAGRAM (looking from the nose, -Z), 1:2 ----------------
    px, py, s4 = 82.0, 100.0, 0.5
    P = lambda deg, r: (px + s4 * r * np.cos(np.radians(deg)), py + s4 * r * np.sin(np.radians(deg)))
    th = np.linspace(0, 2 * np.pi, 361)
    L(px + s4 * RO * np.cos(th), py + s4 * RO * np.sin(th), THICK)
    L([px - 52, px + 52], [py, py], THIN, CL); L([px, px], [py - 46, py + 46], THIN, CL)
    def ray(deg, r0, r1, lw, ls='-'):
        a0, a1 = P(deg, r0), P(deg, r1); L([a0[0], a1[0]], [a0[1], a1[1]], lw, ls)
    for f in B.STRAKE_ANGLES: ray(f, RO, RO + 6, THICK * 2.4)
    for f in B.FLAP_ANGLES: ray(f, RO, RO + B.AFT_FLAP[2], THICK * 2.2)
    for f in B.GF_ANGLES:
        a = np.radians(f); c = np.array(P(f, RO + B.GF_PAD + B.GF_SPAN / 2)); tvec = np.array([-np.sin(a), np.cos(a)]); nvec = np.array([np.cos(a), np.sin(a)])
        q = [c + s4 * (sx * B.GF_SPAN / 2 * nvec + sy * B.GF_W / 2 * tvec) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        poly(q, THIN * 1.5)
    for d0, d1, lab in ((B.DOOR_ANG - 36, B.DOOR_ANG + 36, 'DOOR'), (B.NOTCH_ANG - 41, B.NOTCH_ANG + 41, 'NOTCH'), (B.WIN_ANG - 29, B.WIN_ANG + 29, 'WINDOW')):
        aa = np.radians(np.linspace(d0, d1, 40)); L(px + s4 * (RO + 4) * np.cos(aa), py + s4 * (RO + 4) * np.sin(aa), THICK * 1.6)
    def lab(deg, r, s_, **k):
        q = P(deg, r); txt(q[0], q[1], s_, fs=FS - 4, **k)
    lab(0, 80, 'FLAPS 0°\n(SHIP)'); lab(180, 80, 'FLAPS\n180°'); lab(90, 62, 'DOOR 90°'); lab(280, 64, 'TAIL NOTCH\n280°')
    lab(198, 60, 'WINDOW\n184°'); lab(45, 76, 'GRID FIN 45°\n+ 90° X'); lab(145, 62, 'STRAKE 145°'); lab(325, 66, 'STRAKE 55° + 90° X')
    caption(px, py - 58, 'CLOCKING, LOOKING FROM THE NOSE (-Z), SCALE 1:2\nSTRAKES ON 1 (SHOWN 4X PROUD), GRID FINS (12) ON 2, FLAPS ON 5 + 6')

    notes_block(170, 110, ['NOTES (STYLING):',
        '1. BOOSTER = ITEMS 1 + 2 WITH 4X GRID FIN (12); HOT-STAGING RING = BAND OF 4;',
        '   SHIP = ITEMS 5 + 6 WITH 2X AFT + 2X FWD FLAPS. OVERALL LENGTH UNCHANGED.',
        '2. FLAPS ARE PRINTED WITH 5 AND 6 (NO SUPPORTS: LOWER FLAP EDGES ARE FLAT OR 45°).',
        f'3. GRID FINS: BOND TO 2 WITH CA, Z {B.GF_Z0:g}-{B.GF_Z0 + B.GF_H:g}, CLEAR OF THE DOOR FRAME AND JOINT SCREWS.',
        '4. FINISH: BOOSTER 1-4 + DOOR 8 STAINLESS-LOOK SILVER; SHIP 5 + 6, GRID FINS 12 + C2 POCKETS BLACK.',
        '5. BALLAST: M3 BOLT + WASHERS IN THE ITEM 6 COLUMN; RE-BALANCE AFTER ANY CHANGE.'], fs=FS - 3, pitch=5.2)
    S.frame(5, NSH, DWG, TITLE, scale='AS SHOWN', mass=MASS, material='PLA', revisions=False)
    return fig

if __name__ == '__main__':
    base = os.path.join(here, 'SLDP-ST-008_rocket_body')
    figs = [sheet1(), sheet3(), sheet_item1(), sheet_item2(), sheet_styling(), sheet2()]   # 2 details, 3 A, 4 B + door, 5 styling, 6 exploded
    with PdfPages(base + '.pdf') as pdf:
        for f in figs: pdf.savefig(f)
    for n, f in enumerate(figs, 1): f.savefig(f'{base}_sheet{n}.png', dpi=170)
    print('ok', REP)
