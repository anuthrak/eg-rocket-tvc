"""
SLDP-GA-000  Drawing package cover, US Letter portrait (ANSI A, 215.9 x 279.4 mm), in the SLDP house style:
same border / zones / title block / lettering as the drawings. Colour render of the rocket on the launch mount,
key specifications, finish legend, drawing index.
Needs (next to this script): render.py, body_model.py, servos.py, asm.py, inner/outer/tube.stl, the ST-008 part STLs
in assembly position (A_lower_body.stl ...), gs003_ring/base/qd.stl. Run: python3 SLDP-GA-000_cover.py
"""
import os, numpy as np, matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Circle, Polygon, Rectangle
from matplotlib.backends.backend_pdf import PdfPages
here = os.path.dirname(os.path.abspath(__file__)); os.chdir(here)
import sldp_sheet as S
from sldp_sheet import L, poly, box, txt, leader, THICK, THIN, CL, FS, K
import render as RD, body_model as BM
LM_RO = 75.2 + 2.4                     # GS-003 QD clip shroud OD (RING_OD/2 + QD_CLR + QD_T)

DWG, REV, DATE = 'SLDP-GA-000', 'A', '2026-11-07'
SW, SH = 215.9, 279.4

def frame():
    """House frame resized to ANSI A portrait: border, 4 x 6 zones, title block (no revisions block on the cover)."""
    box(10, 10, SW - 10, SH - 10, lw=THICK * 1.3)
    nc, nr = 4, 6
    for i in range(nc):
        xm = 10 + (SW - 20) * (i + 0.5) / nc
        txt(xm, SH - 5, str(nc - i), fs=FS - 2); txt(xm, 5, str(nc - i), fs=FS - 2)
        if i: L([10 + (SW - 20) * i / nc] * 2, [SH - 10, SH - 7], THIN); L([10 + (SW - 20) * i / nc] * 2, [10, 7], THIN)
    for j in range(nr):
        ym = 10 + (SH - 20) * (j + 0.5) / nr
        txt(5, ym, 'ABCDEF'[j], fs=FS - 2); txt(SW - 5, ym, 'ABCDEF'[j], fs=FS - 2)
        if j: L([10, 7], [10 + (SH - 20) * j / nr] * 2, THIN); L([SW - 10, SW - 7], [10 + (SH - 20) * j / nr] * 2, THIN)
    tbx, tby, tbw, tbh = SW - 10 - 150, 10, 150, 12          # cover: one-row title block (no tolerances / projection)
    def cell(x, w, lab, val, fs=FS - 1):
        box(x, tby, x + w, tby + tbh, lw=THIN); txt(x + 1.2, tby + tbh - 1.2, lab, ha='left', va='top', fs=6)
        txt(x + w / 2, tby + tbh * 0.4, val, fs=fs)
    box(tbx, tby, tbx + tbw, tby + tbh, lw=THICK)
    x = tbx
    for w, lab, val, fs in ((24, 'TEAM', 'SLDP 45', FS - 2), (52, 'TITLE', 'DRAWING PACKAGE COVER', FS - 3), (36, 'DWG NO.', DWG, FS - 2),
                            (10, 'REV', REV, FS - 2), (28, 'DATE', DATE, FS - 3.5)):
        cell(x, w, lab, val, fs); x += w
    return tbx, tby, tbw, tbh

def table(x, y, cols, rows, rh=5.6, head_fs=FS - 3.5, fs=FS - 3.5, title=None):
    """Thin-ruled table, top-left at (x, y). cols = [(width, header, align)]."""
    W = sum(c[0] for c in cols)
    if title: txt(x, y + 4, title, ha='left', fs=FS - 2, fontweight='bold')
    box(x, y - rh * (len(rows) + 1), x + W, y, lw=THICK * 0.8)
    S.ax.add_patch(Rectangle((x, y - rh), W, rh, fc='#efefef', ec='none', zorder=1))
    for k, row in enumerate([[c[1] for c in cols]] + list(rows)):
        yy = y - rh * (k + 1); xx = x
        if k: L([x, x + W], [yy + rh, yy + rh], THIN)
        for (w, _, al), v in zip(cols, row):
            if xx > x: L([xx, xx], [yy, yy + rh], THIN)
            tx = xx + 1.6 if al == 'left' else xx + w / 2
            txt(tx, yy + rh / 2, v, ha='left' if al == 'left' else 'center', fs=head_fs if k == 0 else fs,
                fontweight='bold' if k == 0 else 'normal')
            xx += w
    return y - rh * (len(rows) + 1)

def swatch(x, y, rgb, label, sub=None):
    S.ax.add_patch(Rectangle((x, y - 2.6), 10, 5.2, fc=rgb, ec=K, lw=THIN, zorder=4))
    txt(x + 13, y + (1.3 if sub else 0), label, ha='left', fs=FS - 3.5)
    if sub: txt(x + 13, y - 2.4, sub, ha='left', fs=FS - 5)

if __name__ == '__main__':
    PARTS_CQ, FINS_CQ = BM.build(); _, REP = BM.report(PARTS_CQ, FINS_CQ)
    plt.rcParams.update({'font.family': 'DejaVu Sans'})
    fig = plt.figure(figsize=(8.5, 11), dpi=150, facecolor='white')
    S.ax = ax = fig.add_axes([0, 0, 1, 1]); ax.set_xlim(0, SW); ax.set_ylim(0, SH); ax.axis('off'); ax.set_aspect('equal')
    tbx, tby, tbw, tbh = frame()

    # ---------------- title band ----------------
    txt(16, 256, 'THRUST-VECTOR-CONTROLLED ROCKET', ha='left', fs=21, fontweight='bold')
    txt(16, 247.5, 'EG1004 SEMESTER DESIGN PROJECT  ·  NYU TANDON  ·  TEAM SLDP 45', ha='left', fs=FS - 2.5)
    L([16, SW - 16], [242, 242], THICK)

    # ---------------- illustration: flat colour + hidden-line outlines, scaled to fill the drawing area ----------------
    items = RD.scene()
    AZ, EL = 50.0, 16.0
    a_, e_ = np.radians(AZ), np.radians(EL)
    cam = np.array([np.cos(e_) * np.cos(a_), np.cos(e_) * np.sin(a_), np.sin(e_)])
    import hlr
    _, rg, up_ = hlr.basis(-cam, (0, 0, 1))
    V = np.vstack([it[0].vertices for it in items]); sx, sy = V @ rg, V @ up_
    y_lo, y_hi, xc = 27.0, 236.0, 108.0                      # drawing band on the sheet, centre line
    sc = (y_hi - y_lo) / np.ptp(sy)
    ref = np.zeros(3); org = (xc - sc * (sx.min() + sx.max()) / 2, y_lo - sc * sy.min())
    Pm = RD.illustrate(ax, items, az=AZ, el=EL, scale=sc, origin=org, ref=ref, lw=0.55)

    # ---------------- design callouts (leaders), auto-spaced on each side ----------------
    pol = lambda deg, r, z: np.array([r * np.cos(np.radians(deg)), r * np.sin(np.radians(deg)), z])
    RO = BM.RO
    callouts = [  # (model anchor, label)
        (pol(30, BM.nose_r(55), BM.Z_NOSE + BM.NOSE_BAND + 55), 'OGIVE NOSE, BALLAST\nCOLUMN INSIDE (CG TRIM)'),
        (pol(0, BM.nose_r(40) + 6, BM.Z_NOSE + BM.NOSE_BAND + 40), 'FORWARD FLAPS'),
        (pol(25, RO, 470), 'SHIP (UPPER STAGE), BLACK'),
        (pol(0, RO + 14, BM.Z_S2 + 25), 'AFT FLAPS'),
        (pol(28, RO - 0.5, (BM.Z_BT + BM.Z_S2) / 2), 'HOT-STAGING RING,\n20 VENT POCKETS'),
        (pol(135, RO + 2 + BM.GF_SPAN - 2, BM.GF_Z0 + BM.GF_H / 2), 'GRID FINS (4X)'),
        (pol(90, RO + 1.2, (BM.OPEN_Z0 + BM.OPEN_Z1) / 2 + 20), 'AVIONICS BAY DOOR:\nARDUINO NANO + IMU SLED'),
        (pol(15, RO, 160), 'BOOSTER, STAINLESS-LOOK'),
        (pol(55, RO + BM.STRAKE_H, 75), 'STRAKES (4X)'),
        (pol(90, RO, BM.VENT_Z), 'INTAKE VENTS (4X)'),
        (pol(20, RO, 22), 'TVC GIMBAL ±8° + 30 MM EDF\nINSIDE THE TAIL'),
        (pol(90, LM_RO, 30), 'QUICK-DISCONNECT CLIP'),
        (pol(330, 75, -10), 'LAUNCH MOUNT (SLDP-GS-003)'),
    ]
    pts = [(Pm(p3), lab) for p3, lab in callouts]
    for side in (-1, 1):
        grp = sorted([(p, l) for p, l in pts if np.sign(p[0] - xc) == side or (p[0] == xc and side == 1)], key=lambda q: -q[0][1])
        y_prev = 1e9
        for p, lab in grp:
            nl = lab.count('\n') + 1
            ty = min(p[1] + 4, y_prev - 4.2 * nl - 3.5)
            y_prev = ty - 4.2 * (nl - 1)
            tx = xc - 46 if side < 0 else xc + 46
            leader(p, (tx, ty), lab, ha='right' if side < 0 else 'left', fs=FS - 3.5)

    base = os.path.join(here, 'SLDP-GA-000_cover')
    with PdfPages(base + '.pdf') as pdf: pdf.savefig(fig, dpi=300)
    fig.savefig(base + '.png', dpi=170)
    print('ok', f'{REP["M"]:.0f} g')
