"""Shared SLDP 45 drawing-sheet helpers (house standard: ANSI B, mm sheet coordinates, Y14.2 lines,
DejaVu Sans, light title block). Call new_sheet() before drawing; helpers draw on the current sheet."""
import numpy as np, matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Circle, Polygon
from matplotlib.collections import LineCollection

MM2PT = 72 / 25.4
THICK, THIN = 0.6 * MM2PT, 0.3 * MM2PT
HD = (0, (3 / 0.85, 1 / 0.85))
CL = (0, (12 / 0.85, 2 / 0.85, 2 / 0.85, 2 / 0.85))
PH = (0, (10 / 0.85, 2 / 0.85, 2 / 0.85, 2 / 0.85, 2 / 0.85, 2 / 0.85))
CP = (0, (18 / 0.85, 3 / 0.85, 3 / 0.85, 3 / 0.85, 3 / 0.85, 3 / 0.85))
FS = 11
K = 'black'
SW, SH = 431.8, 279.4
plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': FS})
ax = None

def new_sheet():
    global ax
    fig = plt.figure(figsize=(17, 11), dpi=150, facecolor='white')
    ax = fig.add_axes([0, 0, 1, 1]); ax.set_xlim(0, SW); ax.set_ylim(0, SH); ax.axis('off'); ax.set_aspect('equal')
    return fig

def L(xs, ys, lw=THICK, ls='-', z=3): ax.plot(xs, ys, color=K, lw=lw, ls=ls, zorder=z, solid_capstyle='butt')
def poly(pts, lw=THICK, ls='-'):
    pts = list(pts) + [pts[0]]; L([p[0] for p in pts], [p[1] for p in pts], lw, ls)
def box(x0, y0, x1, y1, lw=THICK, ls='-'): poly([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], lw, ls)
def txt(x, y, s, ha='center', va='center', fs=FS, **k): ax.text(x, y, s, ha=ha, va=va, fontsize=fs, zorder=6, **k)
def arrow(p_from, p_to, ms=9): ax.annotate('', xy=p_to, xytext=p_from, arrowprops=dict(arrowstyle='-|>', lw=THIN, color=K, mutation_scale=ms, shrinkA=0, shrinkB=0), zorder=5)
def dim_h(y, x0, x1, label, e0=None, e1=None, gap=1.5, fs=FS):
    for x, e in ((x0, e0), (x1, e1)):
        if e is not None: L([x, x], [e + np.sign(y - e) * gap, y + np.sign(y - e) * 2], THIN)
    if abs(x1 - x0) < 12:                       # small: arrows outside, text beside
        arrow((x0 - 6, y), (x0, y)); arrow((x1 + 6, y), (x1, y)); L([x0, x1], [y, y], THIN)
        txt(x1 + 7, y, label, ha='left', fs=fs)
    else:
        arrow(((x0 + x1) / 2, y), (x0, y)); arrow(((x0 + x1) / 2, y), (x1, y))
        txt((x0 + x1) / 2, y + 2.0, label, va='bottom', fs=fs)
def dim_v(x, y0, y1, label, e0=None, e1=None, gap=1.5, side='left', fs=FS):
    for y, e in ((y0, e0), (y1, e1)):
        if e is not None: L([e + np.sign(x - e) * gap, x + np.sign(x - e) * 2], [y, y], THIN)
    if abs(y1 - y0) < 10:
        lo, hi = min(y0, y1), max(y0, y1)
        arrow((x, lo - 6), (x, lo)); arrow((x, hi + 6), (x, hi)); L([x, x], [lo, hi], THIN)
    else:
        arrow((x, (y0 + y1) / 2), (x, y0)); arrow((x, (y0 + y1) / 2), (x, y1))
    txt(x - 2.0 if side == 'left' else x + 2.0, (y0 + y1) / 2, label, ha='right' if side == 'left' else 'left', fs=fs)
def leader(p, t_xy, label, ha='left', fs=FS):
    tx, ty = t_xy; shelf = 5 if ha == 'left' else -5
    L([tx, tx + shelf], [ty, ty], THIN)
    ax.annotate('', xy=p, xytext=(tx, ty), arrowprops=dict(arrowstyle='-|>', lw=THIN, color=K, mutation_scale=9, shrinkA=0, shrinkB=0), zorder=5)
    txt(tx + shelf + (1.5 if ha == 'left' else -1.5), ty, label, ha=ha, va='center', fs=fs)
def balloon(p, c, n, r=4.5):
    v = np.array(p, float) - np.array(c, float); v /= np.linalg.norm(v)
    L([c[0] + v[0] * r, p[0]], [c[1] + v[1] * r, p[1]], THIN, z=5)
    ax.add_patch(Circle(p, 0.7, fc=K, ec=K, zorder=7))
    ax.add_patch(Circle(c, r, fc='white', ec=K, lw=THIN, zorder=6))
    ax.text(c[0], c[1], str(n), ha='center', va='center', fontsize=FS, zorder=8)
def draw_lines(lines, origin, scale=1.0, lw=THICK * 0.85):
    ox, oy = origin
    segs = [np.c_[ox + scale * l[:, 0], oy + scale * l[:, 1]] for k in lines for l in lines[k]]
    ax.add_collection(LineCollection(segs, colors=K, linewidths=lw, capstyle='butt', joinstyle='round', zorder=3))
def notes_block(x, y, notes, fs=FS - 1.5, pitch=6.3):
    for i, t in enumerate(notes): txt(x, y - i * pitch, t, ha='left', va='top', fs=fs, fontweight='bold' if i == 0 else 'normal')
def caption(x, y, s): txt(x, y, s, fontweight='bold', fs=FS - 1, va='top')
def cg_symbol(c, r=3.0):
    """Centre-of-gravity symbol: circle with alternating filled quadrants."""
    from matplotlib.patches import Wedge
    ax.add_patch(Circle(c, r, fill=False, ec=K, lw=THIN, zorder=7))
    for a0 in (0, 180): ax.add_patch(Wedge(c, r, a0, a0 + 90, fc=K, ec=K, lw=THIN, zorder=7))

def frame(sheet, n_sheets, dwg_no, title, rev='A', date='2026-10-30', material='SEE LIST', scale='1:2', mass='', revisions=True,
          rev_rows=(('A', 'INITIAL RELEASE', '2026-10-30'),)):
    box(10, 10, SW - 10, SH - 10, lw=THICK * 1.3)
    for i in range(8):
        xm = 10 + (SW - 20) * (i + 0.5) / 8
        txt(xm, SH - 5, str(8 - i), fs=FS - 2); txt(xm, 5, str(8 - i), fs=FS - 2)
        if i: L([10 + (SW - 20) * i / 8] * 2, [SH - 10, SH - 7], THIN); L([10 + (SW - 20) * i / 8] * 2, [10, 7], THIN)
    for j in range(4):
        ym = 10 + (SH - 20) * (j + 0.5) / 4
        txt(5, ym, 'ABCD'[j], fs=FS - 2); txt(SW - 5, ym, 'ABCD'[j], fs=FS - 2)
    if revisions:
        rvx, rvw = SW - 10 - 120, 120; nrow = len(rev_rows); rvh = 13 + 6.5 * nrow; rvy = SH - 10 - rvh
        box(rvx, rvy, rvx + rvw, rvy + rvh, lw=THIN)
        for k in range(1, nrow + 2): L([rvx, rvx + rvw], [rvy + 6.5 * k] * 2, THIN)
        for xx in (rvx + 14, rvx + 92): L([xx, xx], [rvy, rvy + rvh - 6.5], THIN)
        txt(rvx + rvw / 2, rvy + rvh - 3.2, 'REVISIONS', fs=FS - 2, fontweight='bold')
        yh = rvy + rvh - 9.7
        for x, t in ((rvx + 7, 'REV'), (rvx + 53, 'DESCRIPTION'), (rvx + 106, 'DATE')): txt(x, yh, t, fs=FS - 3)
        for k, row in enumerate(rev_rows):
            for x, t in zip((rvx + 7, rvx + 53, rvx + 106), row): txt(x, yh - 6.5 * (k + 1), t, fs=FS - 3)
    tbx, tby, tbw, tbh = SW - 10 - 150, 10, 150, 52
    def cell(x, y, w, h, lab, val, fs=FS):
        box(x, y, x + w, y + h, lw=THIN); txt(x + 1.2, y + h - 1.2, lab, ha='left', va='top', fs=6)
        if val: txt(x + w / 2, y + h * 0.42, val, fs=fs)
    box(tbx, tby, tbx + tbw, tby + tbh, lw=THICK)
    cell(tbx, tby + 36, 52, 16, 'TEAM', 'SLDP 45', fs=FS - 1)
    cell(tbx + 52, tby + 36, 98, 16, 'TITLE', title, fs=FS - 1)
    cell(tbx, tby + 18, 52, 18, 'UNLESS OTHERWISE SPECIFIED', '')
    txt(tbx + 1.5, tby + 31, 'DIMENSIONS ARE IN MM\nTOL: X ±0.5  X.X ±0.2\n       X.XX ±0.1  ANGLES ±1°\nDO NOT SCALE DRAWING', ha='left', va='top', fs=6.5)
    cell(tbx + 52, tby + 18, 18, 18, 'SIZE', 'B', fs=FS)
    cell(tbx + 70, tby + 18, 62, 18, 'DWG NO.', dwg_no, fs=FS if len(dwg_no) < 14 else FS - 1.5)
    cell(tbx + 132, tby + 18, 18, 18, 'REV', rev, fs=FS)
    cell(tbx, tby, 30, 18, '', '')
    cell(tbx + 30, tby, 22, 18, 'DATE', date, fs=7.5)
    cell(tbx + 52, tby, 24, 18, 'MATERIAL', material, fs=FS - 2 if len(material) > 4 else FS - 1)
    cell(tbx + 76, tby, 20, 18, 'SCALE', scale, fs=FS - 1)
    cell(tbx + 96, tby, 26, 18, 'MASS', mass, fs=FS - 1)
    cell(tbx + 122, tby, 28, 18, 'SHEET', f'{sheet} OF {n_sheets}', fs=FS - 1)
    px, py = tbx, tby
    txt(px + 15, py + 15.5, 'THIRD ANGLE PROJECTION', fs=4.8)
    cx, cy = px + 8, py + 7
    ax.add_patch(Circle((cx, cy), 4.2, fill=False, ec=K, lw=THIN * 1.4, zorder=4)); ax.add_patch(Circle((cx, cy), 2.1, fill=False, ec=K, lw=THIN * 1.4, zorder=4))
    poly([(px + 15.5, cy - 2.1), (px + 15.5, cy + 2.1), (px + 27, cy + 4.2), (px + 27, cy - 4.2)], THIN * 1.4)
    L([cx - 5.5, px + 28.5], [cy, cy], THIN * 0.8, CL); L([cx, cx], [cy - 5.5, cy + 5.5], THIN * 0.8, CL)
    return tbx, tby, tbw, tbh

def parts_list(tbx, y0, rows, cols=((0, 12, 'ITEM'), (12, 10, 'QTY'), (22, 88, 'DESCRIPTION'), (110, 40, 'MATERIAL')), rh=6.0, w=150):
    box(tbx, y0, tbx + w, y0 + rh * (len(rows) + 1), lw=THICK)
    for k in range(len(rows) + 1):
        yy = y0 + rh * k
        L([tbx, tbx + w], [yy, yy], THIN)
        for i, (cx, cw, head) in enumerate(cols):
            L([tbx + cx, tbx + cx], [yy, yy + rh], THIN)
            if k == 0: txt(tbx + cx + cw / 2, yy + rh / 2, head, fs=FS - 3)
            else:
                val = rows[k - 1][i]
                if head == 'DESCRIPTION': txt(tbx + cx + 1.5, yy + rh / 2, val, ha='left', fs=FS - 3)
                else: txt(tbx + cx + cw / 2, yy + rh / 2, str(val), fs=FS - 3)
    txt(tbx + w / 2, y0 + rh * (len(rows) + 1) + 3.5, 'PARTS LIST', fs=FS - 2, fontweight='bold')
