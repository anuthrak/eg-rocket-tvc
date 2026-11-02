"""
SLDP-TVC-001  Thrust Vector Control Mount - General Assembly (2 sheets).
  Sheet 1: front / top / right views (third-angle, 1:1), isometric, parts list, notes.
  Sheet 2: exploded isometric (1:1) + range-of-motion views for both gimbal axes with the EDF in phantom.
House standard: docs/drawing-standard.md. Uses cad/lib (asm.py, hlr.py) and the K-9 STLs in cad/vendor/k9-gimbal.
Model origin = gimbal point (both pivot axes intersect).
"""
import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'lib'))
import numpy as np, matplotlib, trimesh
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Circle, Polygon, Arc
from matplotlib.collections import LineCollection
from matplotlib.backends.backend_pdf import PdfPages
from asm import assemble
import hlr

MM2PT = 72 / 25.4
THICK, THIN = 0.6 * MM2PT, 0.3 * MM2PT
CL = (0, (12 / 0.85, 2 / 0.85, 2 / 0.85, 2 / 0.85))
PH = (0, (10 / 0.85, 2 / 0.85, 2 / 0.85, 2 / 0.85, 2 / 0.85, 2 / 0.85))
FS = 11
K = 'black'
SW, SH = 431.8, 279.4
plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': FS})

DWG_NO, REV, DATE = 'SLDP-TVC-001', 'A', '2026-10-30'
TITLE = 'THRUST VECTOR CONTROL MOUNT\nGENERAL ASSEMBLY'
N_SHEETS = 2
TRAVEL = 8.0                      # design gimbal travel, deg each way
EDF_OD, EDF_L, HUB_D, HUB_L = 31.6, 40.0, 16.0, 25.0   # EDF envelope (REF - measure the real unit)

ax = None
def new_sheet():
    global ax
    fig = plt.figure(figsize=(17, 11), dpi=150, facecolor='white')
    ax = fig.add_axes([0, 0, 1, 1]); ax.set_xlim(0, SW); ax.set_ylim(0, SH); ax.axis('off'); ax.set_aspect('equal')
    return fig

# ----------------------------------------------------------------- drawing helpers
def L(xs, ys, lw=THICK, ls='-', z=3): ax.plot(xs, ys, color=K, lw=lw, ls=ls, zorder=z, solid_capstyle='butt')
def poly(pts, lw=THICK, ls='-'):
    pts = list(pts) + [pts[0]]; L([p[0] for p in pts], [p[1] for p in pts], lw, ls)
def box(x0, y0, x1, y1, lw=THICK, ls='-'): poly([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], lw, ls)
def txt(x, y, s, ha='center', va='center', fs=FS, **k): ax.text(x, y, s, ha=ha, va=va, fontsize=fs, zorder=6, **k)
def arrow(p_from, p_to): ax.annotate('', xy=p_to, xytext=p_from, arrowprops=dict(arrowstyle='-|>', lw=THIN, color=K, mutation_scale=9, shrinkA=0, shrinkB=0), zorder=5)
def dim_h(y, x0, x1, label, e0=None, e1=None, gap=1.5):
    for x, e in ((x0, e0), (x1, e1)):
        if e is not None: L([x, x], [e + np.sign(y - e) * gap, y + np.sign(y - e) * 2], THIN)
    arrow(((x0 + x1) / 2, y), (x0, y)); arrow(((x0 + x1) / 2, y), (x1, y))
    txt((x0 + x1) / 2, y + 2.2, label, va='bottom')
def dim_v(x, y0, y1, label, e0=None, e1=None, gap=1.5, side='left'):
    for y, e in ((y0, e0), (y1, e1)):
        if e is not None: L([e + np.sign(x - e) * gap, x + np.sign(x - e) * 2], [y, y], THIN)
    arrow((x, (y0 + y1) / 2), (x, y0)); arrow((x, (y0 + y1) / 2), (x, y1))
    txt(x - 2.2 if side == 'left' else x + 2.2, (y0 + y1) / 2, label, ha='right' if side == 'left' else 'left')
def dim_small_v(x, y0, y1, label, e0, e1, side='left'):
    for y, e in ((y0, e0), (y1, e1)): L([e + np.sign(x - e) * 1.5, x + np.sign(x - e) * 2], [y, y], THIN)
    arrow((x, y0 - 6), (x, y0)); arrow((x, y1 + 6), (x, y1)); L([x, x], [y0, y1], THIN)
    txt(x - 2.2 if side == 'left' else x + 2.2, (y0 + y1) / 2, label, ha='right' if side == 'left' else 'left')
def leader(p, t_xy, label, ha='left', fs=FS):
    tx, ty = t_xy; shelf = 5 if ha == 'left' else -5
    L([tx, tx + shelf], [ty, ty], THIN)
    ax.annotate('', xy=p, xytext=(tx, ty), arrowprops=dict(arrowstyle='-|>', lw=THIN, color=K, mutation_scale=9, shrinkA=0, shrinkB=0), zorder=5)
    txt(tx + shelf + (1.5 if ha == 'left' else -1.5), ty, label, ha=ha, va='center', fs=fs)
def balloon(p, c, n, r=4.5):
    """ASME balloon: circle with the item number, leader ending in a dot on the part."""
    v = np.array(p) - np.array(c); v /= np.linalg.norm(v)
    L([c[0] + v[0] * r, p[0]], [c[1] + v[1] * r, p[1]], THIN, z=5)
    ax.add_patch(Circle(p, 0.75, fc=K, ec=K, zorder=7))
    ax.add_patch(Circle(c, r, fc='white', ec=K, lw=THIN, zorder=6))
    ax.text(c[0], c[1], str(n), ha='center', va='center', fontsize=FS, zorder=8)
def draw_lines(lines, origin, scale=1.0, lw=THICK * 0.85):
    ox, oy = origin
    segs = [np.c_[ox + scale * l[:, 0], oy + scale * l[:, 1]] for k in lines for l in lines[k]]
    ax.add_collection(LineCollection(segs, colors=K, linewidths=lw, capstyle='butt', joinstyle='round', zorder=3))
def proj(basis, origin, p, scale=1.0):
    r, u = basis; p = np.asarray(p, float); return np.array([origin[0] + scale * (p @ r), origin[1] + scale * (p @ u)])
def surf(m, q):
    c, _, _ = trimesh.proximity.closest_point(m, [q]); return c[0]

def frame(sheet, revisions=True):
    box(10, 10, SW - 10, SH - 10, lw=THICK * 1.3)
    for i in range(8):
        xm = 10 + (SW - 20) * (i + 0.5) / 8
        txt(xm, SH - 5, str(8 - i), fs=FS - 2); txt(xm, 5, str(8 - i), fs=FS - 2)
        if i: L([10 + (SW - 20) * i / 8] * 2, [SH - 10, SH - 7], THIN); L([10 + (SW - 20) * i / 8] * 2, [10, 7], THIN)
    for j in range(4):
        ym = 10 + (SH - 20) * (j + 0.5) / 4
        txt(5, ym, 'ABCD'[j], fs=FS - 2); txt(SW - 5, ym, 'ABCD'[j], fs=FS - 2)
    if revisions:                                   # revision history lives on sheet 1 only
        rvx, rvy, rvw = SW - 10 - 120, SH - 10 - 19, 120
        box(rvx, rvy, rvx + rvw, rvy + 19, lw=THIN)
        for yy in (rvy + 6.5, rvy + 13): L([rvx, rvx + rvw], [yy, yy], THIN)
        for xx in (rvx + 14, rvx + 92): L([xx, xx], [rvy, rvy + 13], THIN)
        txt(rvx + rvw / 2, rvy + 16, 'REVISIONS', fs=FS - 2, fontweight='bold')
        for x, t in ((rvx + 7, 'REV'), (rvx + 53, 'DESCRIPTION'), (rvx + 106, 'DATE')): txt(x, rvy + 9.8, t, fs=FS - 3)
        for x, t in ((rvx + 7, REV), (rvx + 53, 'INITIAL RELEASE'), (rvx + 106, DATE)): txt(x, rvy + 3.2, t, fs=FS - 3)
    tbx, tby, tbw, tbh = SW - 10 - 150, 10, 150, 52
    def cell(x, y, w, h, lab, val, fs=FS):
        box(x, y, x + w, y + h, lw=THIN); txt(x + 1.2, y + h - 1.2, lab, ha='left', va='top', fs=6)
        if val: txt(x + w / 2, y + h * 0.42, val, fs=fs)
    box(tbx, tby, tbx + tbw, tby + tbh, lw=THICK)
    cell(tbx, tby + 36, 52, 16, 'TEAM', 'SLDP 45', fs=FS - 1)
    cell(tbx + 52, tby + 36, 98, 16, 'TITLE', TITLE, fs=FS - 1.5)
    cell(tbx, tby + 18, 52, 18, 'UNLESS OTHERWISE SPECIFIED', '')
    txt(tbx + 1.5, tby + 31, 'DIMENSIONS ARE IN MM\nTOL: X ±0.5  X.X ±0.2\n       X.XX ±0.1  ANGLES ±1°\nDO NOT SCALE DRAWING', ha='left', va='top', fs=6.5)
    cell(tbx + 52, tby + 18, 18, 18, 'SIZE', 'B', fs=FS)
    cell(tbx + 70, tby + 18, 62, 18, 'DWG NO.', DWG_NO, fs=FS)
    cell(tbx + 132, tby + 18, 18, 18, 'REV', REV, fs=FS)
    cell(tbx, tby, 30, 18, '', '')
    cell(tbx + 30, tby, 22, 18, 'DATE', DATE, fs=7.5)
    cell(tbx + 52, tby, 24, 18, 'MATERIAL', 'SEE LIST', fs=FS - 2)
    cell(tbx + 76, tby, 20, 18, 'SCALE', '1:1', fs=FS - 1)
    cell(tbx + 96, tby, 26, 18, 'MASS', '~66 g', fs=FS - 1)
    cell(tbx + 122, tby, 28, 18, 'SHEET', f'{sheet} OF {N_SHEETS}', fs=FS - 1)
    px, py = tbx, tby
    txt(px + 15, py + 15.5, 'THIRD ANGLE PROJECTION', fs=4.8)
    cx, cy = px + 8, py + 7
    ax.add_patch(Circle((cx, cy), 4.2, fill=False, ec=K, lw=THIN * 1.4, zorder=4)); ax.add_patch(Circle((cx, cy), 2.1, fill=False, ec=K, lw=THIN * 1.4, zorder=4))
    poly([(px + 15.5, cy - 2.1), (px + 15.5, cy + 2.1), (px + 27, cy + 4.2), (px + 27, cy - 4.2)], THIN * 1.4)
    L([cx - 5.5, px + 28.5], [cy, cy], THIN * 0.8, CL); L([cx, cx], [cy - 5.5, cy + 5.5], THIN * 0.8, CL)
    return tbx, tby, tbw, tbh

def notes_block(x, y, notes):
    for i, t in enumerate(notes): txt(x, y - i * 6.3, t, ha='left', va='top', fs=FS - 1.5, fontweight='bold' if i == 0 else 'normal')

# ----------------------------------------------------------------- model
outer, inner, tube = MESHES = assemble(inner_rot=0, tube_rot=90)
VIEWS = {'front': ((0, 1, 0), (0, 0, 1)), 'top': ((0, 0, -1), (0, 1, 0)),
         'right': ((-1, 0, 0), (0, 0, 1)), 'iso': ((-1, 1, -0.8), (0, 0, 1))}
LINES, BASIS = {}, {}
for name, (d, up) in VIEWS.items():
    LINES[name], _, (r, u) = hlr.view_lines(MESHES, d, up); BASIS[name] = (np.array(r), np.array(u))
LUG = np.array([18.3 + 1.45, 0.0, -42.4])            # motor-tube servo lug boss (outer face centre)

def lug_boss(origin):
    c = proj(BASIS['right'], origin, LUG)
    ax.add_patch(Circle(c, 5.4, fill=False, ec=K, lw=THICK * 0.85, zorder=4)); ax.add_patch(Circle(c, 0.75, fill=False, ec=K, lw=THICK * 0.85, zorder=4))
    L([c[0] - 7, c[0] + 7], [c[1]] * 2, THIN, CL); L([c[0]] * 2, [c[1] - 7, c[1] + 7], THIN, CL)

# =================================================================== SHEET 1
def sheet1():
    fig = new_sheet()
    XF, YF = 85.0, 100.0
    YT = YF + 57 + 20 + 37
    XR = XF + 112
    IX, IY = 350.0, 184.0
    O = {'front': (XF, YF), 'top': (XF, YT), 'right': (XR, YF), 'iso': (IX, IY)}
    for name in VIEWS:
        draw_lines(LINES[name], O[name], lw=THIN * 1.2 if name == 'iso' else THICK * 0.85)
    S = lambda v, p: proj(BASIS[v], O[v], p)
    lug_boss(O['right'])
    L([XF, XF], [YF - 62, YF + 62], THIN, CL); L([XF - 44, XF + 44], [YF, YF], THIN, CL)
    L([XF - 44, XF + 44], [YT, YT], THIN, CL); L([XF, XF], [YT - 42, YT + 36], THIN, CL)
    L([XR, XR], [YF - 62, YF + 62], THIN, CL); L([XR - 42, XR + 36], [YF, YF], THIN, CL)
    # front view dims
    dim_v(XF - 54, YF - 57, YF + 57, '114', e0=XF - 17.5, e1=XF - 17.5)
    dim_v(XF - 44, YF - 57, YF, '57', e1=XF - 44); L([XF - 42, XF - 46], [YF, YF], THIN)
    dim_small_v(XF + 46, YF - 10.5, YF, '10.5', e0=XF + 37.7, e1=XF + 44, side='right')
    dim_h(YF - 70, XF - 37.78, XF + 37.68, 'Ø75.5', e0=YF - 10.5, e1=YF - 10.5)
    leader((XF + 1.2, YF + 1.2), (XF + 22, YF + 30), 'GIMBAL POINT')
    # top view
    txt(XF, YT + 47, 'GIMBAL AXIS Y\n(ITEM 2)', fs=FS - 2)
    txt(XF + 47, YT - 9, 'GIMBAL AXIS X\n(ITEM 3)', fs=FS - 2, ha='left')
    CP = (0, (18 / 0.85, 3 / 0.85, 3 / 0.85, 3 / 0.85, 3 / 0.85, 3 / 0.85))     # cutting-plane line (thick)
    L([XF, XF], [YT - 44, YT + 38], THICK, CP)                                 # A-A : plane x = 0
    for yy in (YT - 44, YT + 38):
        L([XF, XF + 0.1], [yy, yy], THICK); arrow((XF, yy), (XF - 8, yy)); txt(XF - 11, yy, 'A', fontweight='bold')
    L([XF - 44, XF + 44], [YT, YT], THICK, CP)                                 # B-B : plane y = 0
    for xx in (XF - 44, XF + 44):
        arrow((xx, YT), (xx, YT + 8)); txt(xx, YT + 11.5, 'B', fontweight='bold')
    a = np.radians(-50); leader((XF + 17.5 * np.cos(a), YT + 17.5 * np.sin(a)), (XF + 50, YT - 42), 'Ø35 TUBE, Ø32 BORE')
    # right view
    p0 = S('right', (-3.99, -37.19, -40.63)); p1 = S('right', (-21.82, 30.6, -10.5))
    dim_h(YF - 70, p0[0], p1[0], '67.8', e0=p0[1], e1=p1[1])
    # isometric + balloons
    txt(IX - 62, IY - 40, 'ISOMETRIC VIEW\nSCALE 1:1', fontweight='bold', fs=FS - 1)
    balloon(S('iso', surf(outer, (36, -14, 2))), (IX + 52, IY - 38), 1)
    balloon(S('iso', surf(inner, (-4, -32, 25))), (IX - 50, IY + 30), 2)
    balloon(S('iso', surf(tube, (13, -13, 48))), (IX + 40, IY + 58), 3)
    balloon(S('iso', (37.6, 0, 0)), (IX + 58, IY - 14), 4)
    notes_block(160, 262, ['NOTES:',
        '1. ASSEMBLY DRAWING. ALL DIMENSIONS ARE REFERENCE.',
        '2. PIVOTS: ITEM 4 + LOCK NUT 8 ON AXES X AND Y. DRILL',
        '   ITEM 1 AXIS-Y HOLES Ø3.2; NUTS SNUG, BACK OFF 1/8 TURN.',
        '3. ITEM 1 INTO SLDP-ST-005 PART A, 2X M3 X 6 ON AXIS X.',
        '   GIMBAL POINT 10.5 ABOVE ITEM 1 BOTTOM FACE.',
        '4. ITEM 5 IN ITEM 1 + 2 BRACKETS; CENTRE AT 90°. ITEM 9 IN',
        '   ITEM 2 TOWER HOLE + ITEM 3 LUG (FREE TO ROTATE); ITEM 6',
        '   STRAIGHT END THROUGH ITEM 9, Z-BEND END IN SERVO HORN.',
        '5. ITEM 7 FITS ITEM 3 BORE, EXHAUST FACING DOWN.',
        '6. EXPLODED VIEW, SECTIONS A-A AND B-B: SHEET 2.'])
    tbx, tby, tbw, tbh = frame(1, revisions=True)
    PL = [(1, 1, 'OUTER GIMBAL (K-9 TVC GIMBAL V7)', 'PLA'),
          (2, 1, 'INNER GIMBAL (K-9 TVC GIMBAL V7)', 'PLA'),
          (3, 1, 'MOTOR TUBE V8', 'PLA'),
          (4, 4, 'PIVOT SCREW M3 X 12 BUTTON HD', 'STEEL'),
          (5, 2, 'SERVO MG90S (NOT SHOWN)', 'PURCHASED'),
          (6, 2, 'PUSHROD Ø1 MUSIC WIRE, Z-BEND (NOT SHOWN)', 'STEEL'),
          (7, 1, 'EDF QX 30 MM (PHANTOM, SHEET 2)', 'PURCHASED'),
          (8, 4, 'NUT M3 NYLON-INSERT LOCK', 'STEEL'),
          (9, 2, 'LINKAGE STOPPER, PUSHROD (NOT SHOWN)', 'PURCHASED')]
    RH = 6.0; cols = [(0, 12, 'ITEM'), (12, 10, 'QTY'), (22, 88, 'DESCRIPTION'), (110, 40, 'MATERIAL')]
    y0 = tby + tbh
    box(tbx, y0, tbx + tbw, y0 + RH * (len(PL) + 1), lw=THICK)
    for k in range(len(PL) + 1):
        yy = y0 + RH * k
        L([tbx, tbx + tbw], [yy, yy], THIN)
        for cx, cw, head in cols:
            L([tbx + cx, tbx + cx], [yy, yy + RH], THIN)
            if k == 0: txt(tbx + cx + cw / 2, yy + RH / 2, head, fs=FS - 3)
            else:
                it = PL[k - 1]; val = {'ITEM': it[0], 'QTY': it[1], 'DESCRIPTION': it[2], 'MATERIAL': it[3]}[head]
                if head == 'DESCRIPTION': txt(tbx + cx + 1.5, yy + RH / 2, val, ha='left', fs=FS - 3)
                else: txt(tbx + cx + cw / 2, yy + RH / 2, str(val), fs=FS - 3)
    txt(tbx + 18, y0 + RH * (len(PL) + 1) + 3.5, 'PARTS LIST', fs=FS - 2, fontweight='bold', ha='left')
    return fig

# =================================================================== SHEET 2
def screw(axis, sign, pos):
    """M3 x 12 pivot screw (head dia 5.5 x 3, shank dia 3 x 12); head outward along sign*axis, head seat at pos."""
    head = trimesh.creation.cylinder(radius=2.75, height=3.0, sections=40); head.apply_translation((0, 0, 1.5))
    shank = trimesh.creation.cylinder(radius=1.5, height=12.0, sections=32); shank.apply_translation((0, 0, -6.0))
    s = trimesh.util.concatenate([head, shank])               # +z = head side
    tgt = np.zeros(3); tgt[axis] = sign
    s.apply_transform(trimesh.geometry.align_vectors((0, 0, 1), tgt)); s.apply_translation(pos)
    return s

def rot2(p, c, deg):
    a = np.radians(deg); R = np.array([[np.cos(a), -np.sin(a)], [np.sin(a), np.cos(a)]])
    return (np.asarray(p) - c) @ R.T + c

from shapely.geometry import Polygon as SPoly, LineString, MultiPolygon, box as sbox
from shapely.ops import unary_union

def section_polys(mesh, normal, idx):
    """Cut a mesh with the plane through the gimbal point; return shapely polygons in view coords (even-odd)."""
    sec = mesh.section(plane_origin=[0, 0, 0], plane_normal=normal)
    if sec is None: return []
    region = None
    for loop in sec.discrete:
        pg = SPoly(loop[:, idx]).buffer(0)
        if pg.is_empty: continue
        region = pg if region is None else region.symmetric_difference(pg)
    if region is None: return []
    return list(region.geoms) if hasattr(region, 'geoms') else [region]

def hatch(pg, origin, angle, pitch, lw=THIN * 0.8):
    """ASME general-purpose section lining: thin parallel lines clipped to the cut face."""
    x0, y0, x1, y1 = pg.bounds; d = np.hypot(x1 - x0, y1 - y0); cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    a = np.radians(angle); v = np.array([np.cos(a), np.sin(a)]); n = np.array([-v[1], v[0]])
    segs = []
    for k in np.arange(-d / 2, d / 2, pitch):
        p0 = np.array([cx, cy]) + n * k - v * d; p1 = np.array([cx, cy]) + n * k + v * d
        g = pg.intersection(LineString([p0, p1]))
        for gg in (getattr(g, 'geoms', [g])):
            if gg.is_empty or gg.geom_type != 'LineString': continue
            c = np.array(gg.coords); segs.append(c + origin)
    ax.add_collection(LineCollection(segs, colors=K, linewidths=lw, zorder=3))

def cut_face(pg, origin, angle, pitch, solid=False):
    rings = [pg.exterior] + list(pg.interiors)
    for r_ in rings:
        c = np.array(r_.coords) + origin; L(c[:, 0], c[:, 1], THICK * 0.85, z=4)
    if solid:
        ax.add_patch(Polygon(np.array(pg.exterior.coords) + origin, fc=K, ec=K, lw=0.2, zorder=4))
    else:
        hatch(pg, origin, angle, pitch)

def edf_section(c):
    """QX 30 mm EDF shown in section (REF envelope): thin duct walls solid, motor + fan unsectioned (purchased)."""
    zb, zt = -57.0, -57.0 + EDF_L; ro, ri = EDF_OD / 2, EDF_OD / 2 - 0.9
    for sgn in (-1, 1):
        cut_face(sbox(min(sgn * ro, sgn * ri), zb, max(sgn * ro, sgn * ri), zt), c, 0, 1, solid=True)
    # motor (hub) and spinner
    hz0, hz1 = zb + 6, zb + 6 + HUB_L
    box(c[0] - HUB_D / 2, c[1] + hz0, c[0] + HUB_D / 2, c[1] + hz1, THICK * 0.7)
    L([c[0] - HUB_D / 2, c[0], c[0] + HUB_D / 2], [c[1] + hz1, c[1] + hz1 + 5, c[1] + hz1], THICK * 0.7)
    # stator vanes (hub to duct) and rotor blades (thin outline band near the intake)
    for sgn in (-1, 1):
        for z in (hz0 + 3, hz0 + 9):
            L([c[0] + sgn * HUB_D / 2, c[0] + sgn * ri], [c[1] + z, c[1] + z + 4], THIN)
        box(c[0] + sgn * HUB_D / 2, c[1] + hz1 - 7, c[0] + sgn * (ri - 0.6), c[1] + hz1 - 3, THIN)
    L([c[0], c[0]], [c[1] + hz0 - 3, c[1] + hz1 + 8], THIN, CL)

def rom_view(view, origin, letter, axis_label, normal, idx):
    """Section through the gimbal point: cut faces only (background omitted for clarity),
    EDF in section, tube tilted +/-TRAVEL in phantom, angular dimension."""
    c = np.array(origin)
    for m, ang, pitch in ((outer, 45, 1.6), (inner, 135, 1.6), (tube, 45, 1.0)):
        for pg in section_polys(m, normal, idx): cut_face(pg, c, ang, pitch)
    edf_section(c)
    tube_rect = [(-17.5, -57), (17.5, -57), (17.5, 57), (-17.5, 57)]
    for sgn in (-1, 1):
        poly([rot2(c + p, c, sgn * TRAVEL) for p in tube_rect], THIN, PH)
        a0, a1 = rot2(c + (0, -78), c, sgn * TRAVEL), rot2(c + (0, -60), c, sgn * TRAVEL)
        L([a0[0], a1[0]], [a0[1], a1[1]], THIN)                            # extension of the tilted axis to the arc
    L([c[0], c[0]], [c[1] - 80, c[1] + 62], THIN, CL)                       # neutral thrust axis
    L([c[0] - 46, c[0] + 46], [c[1], c[1]], THIN, CL)
    ax.add_patch(Circle(c, 1.2, fc=K, ec=K, zorder=6))
    R = 74.0
    ax.add_patch(Arc(c, 2 * R, 2 * R, theta1=-90 - TRAVEL - 4, theta2=-90 + TRAVEL + 4, lw=THIN, color=K, zorder=5))
    for sgn in (-1, 1):
        t_end = np.radians(-90 + sgn * TRAVEL); t_out = np.radians(-90 + sgn * (TRAVEL + 4))
        arrow(c + R * np.array([np.cos(t_out), np.sin(t_out)]), c + R * np.array([np.cos(t_end), np.sin(t_end)]))
    txt(c[0] + R * np.sin(np.radians(TRAVEL + 6)) + 1, c[1] - R - 1, f'{TRAVEL:.0f}° TYP', ha='left', va='top', fs=FS - 1)
    arrow((c[0], c[1] - 60), (c[0], c[1] - 68)); txt(c[0] - 2, c[1] - 64, 'EXHAUST', ha='right', fs=FS - 3)
    arrow((c[0], c[1] + 64), (c[0], c[1] + 58)); txt(c[0] - 2, c[1] + 61, 'INTAKE', ha='right', fs=FS - 3)
    txt(c[0], c[1] - R - 9, f'SECTION {letter}-{letter}\nRANGE OF MOTION, {axis_label}', fontweight='bold', fs=FS - 1, va='top')
    return c

def sheet2():
    fig = new_sheet()
    # ---------------- exploded isometric (assembly path: everything drops in along the rocket axis) -----------
    DZ_I, DZ_T, PULL = 68.0, 162.0, 24.0
    i2 = inner.copy(); i2.apply_translation((0, 0, DZ_I))
    t2 = tube.copy(); t2.apply_translation((0, 0, DZ_T))
    # pivot screws: axis Y pair at the outer gimbal walls (y = +/-30.6), axis X pair at the inner gimbal walls
    Y_WALL, X_WALL = 30.6, (-24.14, 22.95)
    scr = [screw(1, -1, (0, -Y_WALL - PULL, 0)), screw(1, 1, (0, Y_WALL + PULL, 0)),
           screw(0, -1, (X_WALL[0] - PULL, 0, DZ_I)), screw(0, 1, (X_WALL[1] + PULL, 0, DZ_I))]
    ex = [outer, i2, t2] + scr
    d, up = VIEWS['iso']
    lines, _, (r, u) = hlr.view_lines(ex, d, up); B = (np.array(r), np.array(u))
    EO = (100.0, 56.0)
    draw_lines(lines, EO, lw=THIN * 1.3)
    P = lambda p: proj(B, EO, p)
    # assembly trail lines (centre-line style) along the rocket axis and the four screw axes
    a, b = P((0, 0, -16)), P((0, 0, DZ_T + 62)); L([a[0], b[0]], [a[1], b[1]], THIN, CL)
    for p0, p1 in [((0, -Y_WALL - PULL + 10, 0), (0, -Y_WALL + 4, 0)), ((0, Y_WALL - 4, 0), (0, Y_WALL + PULL - 10, 0)),
                   ((X_WALL[0] - PULL + 10, 0, DZ_I), (X_WALL[0] + 4, 0, DZ_I)), ((X_WALL[1] - 4, 0, DZ_I), (X_WALL[1] + PULL - 10, 0, DZ_I)),
                   ((0, -Y_WALL - 2, DZ_I), (0, -Y_WALL - 2, 0)), ((0, Y_WALL + 2, DZ_I), (0, Y_WALL + 2, 0))]:
        a, b = P(p0), P(p1); L([a[0], b[0]], [a[1], b[1]], THIN, PH)
    for (x, z) in ((X_WALL[0], DZ_I), (X_WALL[1], DZ_I)):
        a, b = P((x, 0, z)), P((np.sign(x) * 18.85, 0, DZ_T)); L([a[0], b[0]], [a[1], b[1]], THIN, PH)
    balloon(P(surf(outer, (36, -14, 2))), P((75, -20, 10)), 1)
    balloon(P(surf(i2, (-4, -32, DZ_I + 25))), P((-40, -70, DZ_I + 40)), 2)
    balloon(P(surf(t2, (13, -13, DZ_T + 40))), P((50, -30, DZ_T + 60)), 3)
    balloon(P((X_WALL[1] + PULL + 2.0, 0, DZ_I)), P((X_WALL[1] + PULL + 30, -10, DZ_I + 12)), 4)
    txt(EO[0] + 95, 34, 'EXPLODED ISOMETRIC VIEW\nSCALE 1:1', fontweight='bold', fs=FS - 1, va='top')
    # ---------------- range of motion views ----------------
    ca = rom_view('right', (240.0, 160.0), 'A', 'AXIS X (ITEM 3)', [1, 0, 0], [1, 2])
    cb = rom_view('front', (362.0, 160.0), 'B', 'AXIS Y (ITEMS 2 + 3)', [0, 1, 0], [0, 2])
    leader((ca[0] - 8, ca[1] - 40), (ca[0] - 36, ca[1] - 58), 'ITEM 7 EDF\n(SECTION, REF)', ha='right', fs=FS - 2)
    leader((ca[0] + 17.0, ca[1] + 30), (ca[0] + 40, ca[1] + 46), 'ITEM 3', fs=FS - 2)
    leader((cb[0] + 37.0, cb[1] - 6), (cb[0] + 46, cb[1] - 26), 'ITEM 1', fs=FS - 2)
    notes_block(186, 266, ['NOTES:',
        f'1. DESIGN TRAVEL ±{TRAVEL:.0f}° ON EACH GIMBAL AXIS (PHANTOM).',
        '   AXIS X CLEARS ~+10°/-15°; AXIS Y ±15° (NEEDS ST-005 WINDOW).',
        '2. SECTIONS SHOW CUT FACES ONLY FOR CLARITY.',
        '3. ITEM 7 SIZE IS REF. EXHAUST FLUSH WITH ITEM 3',
        '   BOTTOM; MEASURE DUCT OD (MAX 31.6).',
        '4. ITEMS 4, 5, 6 NOT SHOWN IN SECTION. PARTS LIST: SHEET 1.'])
    frame(2, revisions=False)
    return fig

if __name__ == '__main__':
    here = os.path.dirname(os.path.abspath(__file__))
    base = os.path.join(here, 'SLDP-TVC-001_tvc-mount-ga')
    figs = [sheet1(), sheet2()]
    with PdfPages(base + '.pdf') as pdf:
        for f in figs: pdf.savefig(f)
    for n, f in enumerate(figs, 1): f.savefig(f'{base}_sheet{n}.png', dpi=170)
    print('ok')
