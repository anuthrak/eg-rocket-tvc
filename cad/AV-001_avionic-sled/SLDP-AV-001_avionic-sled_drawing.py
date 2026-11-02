"""
ASME-style detail drawing of the avionic sled v1 (SLDP-AV-001), ANSI B sheet (17 x 11 in).
The whole sheet is one coordinate system in MILLIMETRES, so every orthographic view is exactly 1:1
and aligned by construction (third-angle: top view above front, right-side view to the right).
Line widths per ASME Y14.2: thick 0.6 mm visible/outline, thin 0.3 mm hidden/center/phantom/dimension.
Lettering >= 3 mm. Reads the model SLDP-AV-001_avionic-sled.py in the same folder.
"""
import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'lib'))
import re, numpy as np, matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle, Circle, Polygon, Ellipse
import cadquery as cq
import paths
S = paths.sled_model()

MM2PT = 72 / 25.4
THICK, THIN = 0.6 * MM2PT, 0.3 * MM2PT
HD, CL, PH = (0, (3 / 0.85, 1 / 0.85)), (0, (12 / 0.85, 2 / 0.85, 2 / 0.85, 2 / 0.85)), (0, (10 / 0.85, 2 / 0.85, 2 / 0.85, 2 / 0.85, 2 / 0.85, 2 / 0.85))
FS = 11            # ~3 mm cap height
K = 'black'
SW, SH = 431.8, 279.4
plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': FS})
fig = plt.figure(figsize=(17, 11), dpi=150, facecolor='white')
ax = fig.add_axes([0, 0, 1, 1]); ax.set_xlim(0, SW); ax.set_ylim(0, SH); ax.axis('off'); ax.set_aspect('equal')

R, RI, H, FY, PT, PHW = S.R, S.RI, S.H, S.FACE_Y, S.PLATE_T, S.PLATE_HW
XF, YF = 85.0, 40.0              # front view: model (x, z) -> sheet
YT = YF + H + 34 + R             # top view centre (y)
XR = XF + R + 50 + R             # right view centre (x)

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
    txt(x - 2.2 if side == 'left' else x + 2.2, (y0 + y1) / 2, label, ha='right' if side == 'left' else 'left', rotation=0)
def dim_small_v(x, y0, y1, label, e0, e1, side='left'):
    """Arrows outside for small dimensions."""
    for y, e in ((y0, e0), (y1, e1)): L([e + np.sign(x - e) * 1.5, x + np.sign(x - e) * 2], [y, y], THIN)
    arrow((x, y0 - 6), (x, y0)); arrow((x, y1 + 6), (x, y1)); L([x, x], [y0, y1], THIN)
    txt(x - 2.2 if side == 'left' else x + 2.2, y1 + 4 if y1 > y0 else y0 + 4, label, ha='right' if side == 'left' else 'left')
def leader(p, t_xy, label, ha='left'):
    tx, ty = t_xy; shelf = 5 if ha == 'left' else -5
    L([p[0], tx], [p[1], ty], THIN); L([tx, tx + shelf], [ty, ty], THIN); arrow((tx, ty), p) if False else None
    ax.annotate('', xy=p, xytext=(tx, ty), arrowprops=dict(arrowstyle='-|>', lw=THIN, color=K, mutation_scale=9, shrinkA=0, shrinkB=0), zorder=5)
    txt(tx + shelf + (1.5 if ha == 'left' else -1.5), ty, label, ha=ha, va='center')
def fcf(x, y, cells, h=6.5):
    cx = x
    for i, c in enumerate(cells):
        w = 7.5 if i == 0 else max(7.0, len(c) * 2.6 + 3)
        box(cx, y, cx + w, y + h, lw=THIN)
        m = (cx + w / 2, y + h / 2)
        if c == 'POS':
            ax.add_patch(Circle(m, 1.6, fill=False, ec=K, lw=THIN, zorder=6)); L([m[0] - 2.6, m[0] + 2.6], [m[1]] * 2, THIN); L([m[0]] * 2, [m[1] - 2.6, m[1] + 2.6], THIN)
        elif c == 'FLAT':
            poly([(m[0] - 2.6, m[1] - 1.2), (m[0] + 1.6, m[1] - 1.2), (m[0] + 2.6, m[1] + 1.2), (m[0] - 1.6, m[1] + 1.2)], THIN)
        elif c == 'PERP':
            L([m[0] - 2.6, m[0] + 2.6], [m[1] - 2] * 2, THIN); L([m[0]] * 2, [m[1] - 2, m[1] + 2.4], THIN)
        else:
            txt(m[0], m[1], c, fs=FS - 1)
        cx += w
    return cx
def datum(p, letter, d=(0, -1), length=9):
    """Datum feature symbol: filled triangle on the feature at p, frame offset along d."""
    x, y = p; bx, by = x + d[0] * length, y + d[1] * length
    L([x, bx], [y, by], THIN)
    px, py = -d[1], d[0]
    ax.add_patch(Polygon([(x + px * 1.8, y + py * 1.8), (x - px * 1.8, y - py * 1.8), (x + d[0] * 2.6, y + d[1] * 2.6)], fc=K, ec=K, zorder=6))
    fx, fy = bx + d[0] * 3.5, by + d[1] * 3.5
    box(fx - 3.5, fy - 3.5, fx + 3.5, fy + 3.5, lw=THIN); txt(fx, fy, letter, fontweight='bold')
def basic(x, y, label):
    txt(x, y, label, fs=FS - 1, bbox=dict(boxstyle='square,pad=0.25', fc='white', ec=K, lw=THIN))

# ======================= FRONT VIEW =======================
fx = lambda x: XF + x; fz = lambda z: YF + z
box(fx(-R), fz(0), fx(R), fz(S.RING_H)); box(fx(-R), fz(H - S.RING_H), fx(R), fz(H))
L([fx(-PHW)] * 2, [fz(S.RING_H), fz(H - S.RING_H)]); L([fx(PHW)] * 2, [fz(S.RING_H), fz(H - S.RING_H)])
for z0 in (S.RING_H, H - S.RING_H - S.LEDGE_H): box(fx(-S.LEDGE_HW), fz(z0), fx(S.LEDGE_HW), fz(z0 + S.LEDGE_H))
for s in (-1, 1):
    for z in S.SLOT_Z: box(fx(s * S.SLOT_X - S.SLOT_W / 2), fz(z - S.SLOT_H / 2), fx(s * S.SLOT_X + S.SLOT_W / 2), fz(z + S.SLOT_H / 2))
    for zc in (S.RING_H / 2, H - S.RING_H / 2):
        for dz in (-S.PILOT_D / 2, S.PILOT_D / 2): L([fx(s * S.BOSS_R0), fx(s * R)], [fz(zc + dz)] * 2, THIN, HD)
        L([fx(s * (S.BOSS_R0 - 2.5)), fx(s * (R + 3))], [fz(zc)] * 2, THIN, CL)
        for xb in (S.BOSS_W / 2, -S.BOSS_W / 2): pass
bz0 = S.RING_H + S.LEDGE_H
box(fx(-S.BB_W / 2), fz(bz0), fx(S.BB_W / 2), fz(bz0 + S.BB_L), THIN, PH)
box(fx(-10.5), fz(bz0 + 4), fx(10.5), fz(bz0 + 20), THIN, PH)            # IMU (phantom)
box(fx(-9), fz(bz0 + 38), fx(9), fz(bz0 + 81), THIN, PH)                 # Nano (phantom)
L([fx(0)] * 2, [fz(-6), fz(H + 6)], THIN, CL)
# dimensions
dim_v(fx(-R - 18), fz(0), fz(H), '100', e0=fx(-R), e1=fx(-R))
dim_v(fx(-R - 8), fz(0), fz(S.SLOT_Z[0]), '30', e0=fx(-S.SLOT_X), e1=fx(-S.SLOT_X - 1))
dim_v(fx(-R - 8), fz(S.SLOT_Z[0]), fz(S.SLOT_Z[1]), '40', e1=fx(-S.SLOT_X - 1))
dim_small_v(fx(R + 9), fz(0), fz(S.RING_H), '6\n2X', e0=fx(R), e1=fx(R), side='right')
dim_h(fz(-11), fx(-S.SLOT_X), fx(S.SLOT_X), '63', e0=fz(S.SLOT_Z[0] - 2.5), e1=fz(S.SLOT_Z[0] - 2.5))
dim_h(fz(-22), fx(-PHW), fx(PHW), '70', e0=fz(S.RING_H), e1=fz(S.RING_H))
dim_h(fz(H + 11), fx(-R), fx(R), 'Ø75.8 ±0.1', e0=fz(H), e1=fz(H))
datum((fx(R - 10), fz(H + 11)), 'B', d=(0, 1), length=6)
leader((fx(S.SLOT_X + 1), fz(S.SLOT_Z[1] + 1.5)), (fx(R + 6), fz(S.SLOT_Z[1] + 14)), '4X SLOT 2X4 THRU')
leader((fx(S.LEDGE_HW - 6), fz(H - S.RING_H - 1)), (fx(R + 6), fz(H - 8)), '2X LEDGE 56X4X2')
L([fx(-R - 1.5), fx(-R - 9)], [fz(0)] * 2, THIN)
datum((fx(-R - 7), fz(0)), 'A', d=(0, -1), length=5)
txt(fx(0), fz(bz0 + 30), 'HALF-SIZE\nBREADBOARD\n(PHANTOM)', fs=FS - 2, style='italic')
txt(fx(0), fz(bz0 + 12), 'IMU', fs=FS - 3, style='italic'); txt(fx(0), fz(bz0 + 60), 'NANO', fs=FS - 3, style='italic')

# ======================= TOP VIEW =======================
tx = lambda x: XF + x; ty = lambda y: YT + y
ax.add_patch(Circle((tx(0), ty(0)), R, fill=False, ec=K, lw=THICK, zorder=3)); ax.add_patch(Circle((tx(0), ty(0)), RI, fill=False, ec=K, lw=THICK, zorder=3))
xi = np.sqrt(RI ** 2 - (FY - PT) ** 2); xf = np.sqrt(RI ** 2 - FY ** 2)
poly([(tx(-xi), ty(FY - PT)), (tx(xi), ty(FY - PT)), (tx(xf), ty(FY)), (tx(-xf), ty(FY))])
box(tx(-S.LEDGE_HW), ty(FY), tx(S.LEDGE_HW), ty(FY + S.LEDGE_D))
for s in (-1, 1):
    xb = np.sqrt(RI ** 2 - (S.BOSS_W / 2) ** 2)
    L([tx(s * S.BOSS_R0)] * 2, [ty(-S.BOSS_W / 2), ty(S.BOSS_W / 2)])
    for yy in (S.BOSS_W / 2, -S.BOSS_W / 2): L([tx(s * S.BOSS_R0), tx(s * xb)], [ty(yy)] * 2)
    for yy in (S.PILOT_D / 2, -S.PILOT_D / 2): L([tx(s * S.BOSS_R0), tx(s * R)], [ty(yy)] * 2, THIN, HD)
box(tx(-S.BB_W / 2), ty(FY), tx(S.BB_W / 2), ty(FY + S.BB_T), THIN, PH)
L([tx(-R - 6), tx(R + 6)], [ty(0)] * 2, THIN, CL); L([tx(0)] * 2, [ty(-R - 6), ty(R + 6)], THIN, CL)
dim_v(tx(-R - 9), ty(FY), ty(0), '9.0', e0=tx(-xf), e1=tx(-R - 6))
dim_small_v(tx(-R - 20), ty(FY - PT), ty(FY), '3', e0=tx(-xi), e1=tx(-xf))
dim_small_v(tx(R + 9), ty(FY), ty(FY + S.LEDGE_D), '4', e0=tx(S.LEDGE_HW), e1=tx(S.LEDGE_HW), side='right')
dim_h(ty(R + 9), tx(-S.BOSS_R0), tx(S.BOSS_R0), '62', e0=ty(S.BOSS_W / 2), e1=ty(S.BOSS_W / 2))
a = np.radians(40); leader((tx(RI * np.cos(a)), ty(RI * np.sin(a))), (tx(R + 14), ty(R + 2)), 'Ø69.8 ±0.2')
leader((tx(S.BOSS_R0 + 3), ty(-S.BOSS_W / 2)), (tx(R + 14), ty(-R + 4)), '2X BOSS 8 WIDE\nBOTH RINGS')
FX0, FY0 = tx(-R - 30), ty(-R - 10)
fcf(FX0, FY0, ['FLAT', '0.3'])
L([FX0 + 3.75] * 2, [FY0 + 6.5, ty(FY)], THIN); L([FX0 + 3.75, tx(-xf + 0.5)], [ty(FY)] * 2, THIN)
arrow((tx(-xf - 5), ty(FY)), (tx(-xf + 0.5), ty(FY)))

# ======================= RIGHT SIDE VIEW (h = -y) =======================
rx = lambda h: XR + h; rz = lambda z: YF + z
box(rx(-R), rz(0), rx(R), rz(S.RING_H)); box(rx(-R), rz(H - S.RING_H), rx(R), rz(H))
box(rx(-FY), rz(S.RING_H), rx(-FY + PT), rz(H - S.RING_H))
for z0 in (S.RING_H, H - S.RING_H - S.LEDGE_H): box(rx(-(FY + S.LEDGE_D)), rz(z0), rx(-FY), rz(z0 + S.LEDGE_H))
for zc in (S.RING_H / 2, H - S.RING_H / 2):
    L([rx(-S.BOSS_W / 2)] * 2, [rz(zc - S.RING_H / 2), rz(zc + S.RING_H / 2)]); L([rx(S.BOSS_W / 2)] * 2, [rz(zc - S.RING_H / 2), rz(zc + S.RING_H / 2)])
    ax.add_patch(Circle((rx(0), rz(zc)), S.PILOT_D / 2, fill=False, ec=K, lw=THICK, zorder=4))
    L([rx(-3.5), rx(3.5)], [rz(zc)] * 2, THIN, CL)
box(rx(-(FY + S.BB_T)), rz(bz0), rx(-FY), rz(bz0 + S.BB_L), THIN, PH)
L([rx(0)] * 2, [rz(-6), rz(H + 6)], THIN, CL)
leader((rx(0.9), rz(H - S.RING_H / 2 + 0.9)), (rx(16), rz(H + 16)), '4X Ø2.5 ↧ 7')
fcf(rx(21.5), rz(H + 6.5), ['POS', 'Ø0.4', 'A', 'B'])
dim_small_v(rx(R + 6), rz(0), rz(S.RING_H / 2), '', e0=rx(R), e1=rx(1.5), side='right'); basic(rx(R + 6), rz(-9), '3')
dim_v(rx(R + 14), rz(S.RING_H / 2), rz(H - S.RING_H / 2), '', e0=rx(1.5), e1=rx(1.5), side='right'); basic(rx(R + 14), rz(H / 2), '94')
datum((rx(-FY), rz(42)), 'C', d=(-1, 0), length=40)
fcf(rx(-R - 30), rz(62), ['PERP', '0.3', 'A'])
L([rx(-R - 30) + 7, rx(-R - 30) + 7], [rz(62), rz(56)], THIN); L([rx(-R - 30) + 7, rx(-FY - 0.3)], [rz(56)] * 2, THIN)
arrow((rx(-FY - 6), rz(56)), (rx(-FY), rz(56)))

# ======================= ISOMETRIC (hidden lines removed, from the CAD model) =======================
here = os.path.dirname(os.path.abspath(__file__))
svg_path = os.path.join(here, '_iso.svg')
cq.exporters.export(S.build(), svg_path, opt={'width': 400, 'height': 400, 'showAxes': False,
                                              'projectionDir': (1, -1, 0.8), 'showHidden': False, 'strokeWidth': 0.3})
svg = open(svg_path).read(); os.remove(svg_path)
solid = svg.split('<!-- solid lines -->')[1]
paths = [np.array([[float(a), float(b)] for a, b in re.findall(r'(-?[\d.]+),(-?[\d.]+)', d)]) for d in re.findall(r' d="([^"]+)"', solid)]
allp = np.vstack(paths); c0 = (allp.min(0) + allp.max(0)) / 2
IX, IY, IS = 352.0, 196.0, 0.5
for p in paths:
    if len(p) > 1: L(IX + IS * (p[:, 0] - c0[0]), IY + IS * (p[:, 1] - c0[1]), THIN * 1.2)
txt(IX, IY - IS * (allp[:, 1].max() - allp[:, 1].min()) / 2 - 7, 'ISOMETRIC VIEW (REF)\nSCALE 1:2', fontweight='bold', fs=FS - 1)

# ======================= NOTES =======================
notes = ['NOTES:',
         '1. MATERIAL: PLA. FDM, 3+ WALLS, 25% INFILL.',
         '2. PRINT WITH DATUM A ON BED. TREE SUPPORT',
         '   UNDER TOP RING ONLY.',
         '3. SLIDE INTO SLDP-ST-005 PART B FROM BELOW.',
         '   RETAIN WITH 4X M3 X 8 THROUGH THE PART B',
         '   Ø3.2 HOLES (SEE SLDP-GA-001).',
         '4. BOND BREADBOARD TO FACE C (ADHESIVE BACK)',
         '   + 2 ZIP TIES. MPU-6050 AT BOTTOM OF BOARD',
         '   (NEAR ROCKET CG), X/Y ALIGNED TO GIMBAL AXES.']
for i, t in enumerate(notes): txt(288, 152 - i * 6.3, t, ha='left', va='top', fs=FS - 1.5, fontweight='bold' if i == 0 else 'normal')

# ======================= BORDER, ZONES, REVISION + TITLE BLOCK =======================
box(10, 10, SW - 10, SH - 10, lw=THICK * 1.3)
for i in range(8):
    xm = 10 + (SW - 20) * (i + 0.5) / 8
    txt(xm, SH - 5, str(8 - i), fs=FS - 2); txt(xm, 5, str(8 - i), fs=FS - 2)
    if i: L([10 + (SW - 20) * i / 8] * 2, [SH - 10, SH - 7], THIN); L([10 + (SW - 20) * i / 8] * 2, [10, 7], THIN)
for j in range(4):
    ym = 10 + (SH - 20) * (j + 0.5) / 4
    txt(5, ym, 'ABCD'[j], fs=FS - 2); txt(SW - 5, ym, 'ABCD'[j], fs=FS - 2)
# revision block (top right)
rvx, rvy, rvw = SW - 10 - 120, SH - 10 - 19, 120
box(rvx, rvy, rvx + rvw, rvy + 19, lw=THIN)
for yy in (rvy + 6.5, rvy + 13): L([rvx, rvx + rvw], [yy, yy], THIN)
for xx in (rvx + 14, rvx + 92): L([xx, xx], [rvy, rvy + 13], THIN)
txt(rvx + rvw / 2, rvy + 16, 'REVISIONS', fs=FS - 2, fontweight='bold')
for x, t in ((rvx + 7, 'REV'), (rvx + 53, 'DESCRIPTION'), (rvx + 106, 'DATE')): txt(x, rvy + 9.8, t, fs=FS - 3)
for x, t in ((rvx + 7, 'A'), (rvx + 53, 'INITIAL RELEASE'), (rvx + 106, '2026-10-30')): txt(x, rvy + 3.2, t, fs=FS - 3)
# title block (bottom right)
tbx, tby, tbw, tbh = SW - 10 - 150, 10, 150, 52
def cell(x, y, w, h, lab, val, fs=FS, bold=False):
    box(x, y, x + w, y + h, lw=THIN); txt(x + 1.2, y + h - 1.2, lab, ha='left', va='top', fs=6)
    if val: txt(x + w / 2, y + h * 0.42, val, fs=fs, fontweight='bold' if bold else 'normal')
box(tbx, tby, tbx + tbw, tby + tbh, lw=THICK)
cell(tbx, tby + 36, 52, 16, 'TEAM', 'SLDP 45', fs=FS - 1)
cell(tbx + 52, tby + 36, 98, 16, 'TITLE', 'AVIONIC SLED V1', fs=FS - 1)
cell(tbx, tby + 18, 52, 18, 'UNLESS OTHERWISE SPECIFIED', '')
txt(tbx + 1.5, tby + 31, 'DIMENSIONS ARE IN MM\nTOL: X ±0.5  X.X ±0.2\n       X.XX ±0.1  ANGLES ±1°\nDO NOT SCALE DRAWING', ha='left', va='top', fs=6.5)
cell(tbx + 52, tby + 18, 18, 18, 'SIZE', 'B', fs=FS)
cell(tbx + 70, tby + 18, 62, 18, 'DWG NO.', 'SLDP-AV-001', fs=FS)
cell(tbx + 132, tby + 18, 18, 18, 'REV', 'A', fs=FS)
cell(tbx, tby, 30, 18, '', '')
cell(tbx + 30, tby, 22, 18, 'DATE', '2026-10-30', fs=7.5)
cell(tbx + 52, tby, 24, 18, 'MATERIAL', 'PLA', fs=FS - 1)
cell(tbx + 76, tby, 20, 18, 'SCALE', '1:1', fs=FS - 1)
cell(tbx + 96, tby, 26, 18, 'MASS', '~38 g', fs=FS - 1)
cell(tbx + 122, tby, 28, 18, 'SHEET', '1 OF 1', fs=FS - 1)
# third-angle projection symbol: end view (circles) left, frustum right, small end toward the circles
px, py = tbx, tby
txt(px + 15, py + 15.5, 'THIRD ANGLE PROJECTION', fs=4.8)
cx, cy = px + 8, py + 7
ax.add_patch(Circle((cx, cy), 4.2, fill=False, ec=K, lw=THIN * 1.4, zorder=4)); ax.add_patch(Circle((cx, cy), 2.1, fill=False, ec=K, lw=THIN * 1.4, zorder=4))
poly([(px + 15.5, cy - 2.1), (px + 15.5, cy + 2.1), (px + 27, cy + 4.2), (px + 27, cy - 4.2)], THIN * 1.4)
L([cx - 5.5, px + 28.5], [cy, cy], THIN * 0.8, CL); L([cx, cx], [cy - 5.5, cy + 5.5], THIN * 0.8, CL)

fig.savefig(os.path.join(here, 'SLDP-AV-001_avionic-sled.pdf'))
fig.savefig(os.path.join(here, 'SLDP-AV-001_avionic-sled.png'), dpi=170)
print('ok')
