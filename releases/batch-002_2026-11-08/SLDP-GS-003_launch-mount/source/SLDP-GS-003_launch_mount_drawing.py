"""
SLDP-GS-003  Launch mount v2, Rev B -- 2 sheets.
  Sheet 1: top view + front view / half section A-A with the rocket tail and engine in phantom (1:2), detail B of a
           clamp (2:1), isometric (1:2), parts list, notes.
  Sheet 2: item 3 quick-disconnect clip: section C-C (2:1), detail E on the ring rim (1:1), view D (1:1),
           print orientation (1:2), installation view (item 3 slid off radially, 1:2), notes.
Run SLDP-GS-003_launch_mount.py first.
"""
import os, importlib.util, numpy as np, trimesh
from matplotlib.collections import LineCollection
from matplotlib.patches import Circle, Polygon
from matplotlib.backends.backend_pdf import PdfPages
from shapely.geometry import Polygon as SPoly, LineString, box as sbox
import sldp_sheet as S
from sldp_sheet import L, poly, box, txt, arrow, dim_h, dim_v, leader, balloon, draw_lines, notes_block, caption, THICK, THIN, CL, PH, CP, FS, K
import hlr

here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('lm', os.path.join(here, 'SLDP-GS-003_launch_mount.py'))
LM = importlib.util.module_from_spec(spec); spec.loader.exec_module(LM)
DWG, TITLE, DATE = 'SLDP-GS-003', 'LAUNCH MOUNT', '2026-11-07'
RING = trimesh.load(os.path.join(here, 'gs003_ring.stl')); BASE = trimesh.load(os.path.join(here, 'gs003_base.stl'))
QD = trimesh.load(os.path.join(here, 'gs003_qd.stl')); QDP = trimesh.load(os.path.join(here, 'SLDP-GS-003_3-qd-clip_print.stl'))
_A = [os.path.join(here, *q) for q in (('..', 'rocket_v8', 'A_lower_body.stl'),            # rocket part A in assembly position:
       ('..', '..', 'SLDP-ST-008_rocket-body', 'source', 'A_lower_body.stl'))]       # run the ST-008 model first
A = trimesh.load(next(f for f in _A if os.path.exists(f)))
A = A.slice_plane([0, 0, 45], [0, 0, -1], cap=False); A.merge_vertices()
QD_MASS = QD.volume / 1000 * 1.24 * 0.85                     # thin walls: 3 perimeters make it nearly solid
INFILL_MASS = (RING.volume + BASE.volume) / 1000 * 1.24 * 0.4 + QD_MASS
REVS = (('A', 'INITIAL RELEASE (SUPERSEDES SLDP-GS-002)', '2026-11-07'),
        ('B', 'ITEM 3 WRAP-AROUND QD CLIP; SHEET 2', DATE))

def view(meshes, d, up, sc, ref3, ref2, lws=None):
    lines, _, (r, u) = hlr.view_lines(meshes, d, up)
    r, u = np.asarray(r), np.asarray(u); ref3 = np.asarray(ref3, float)
    O = np.array([ref2[0] - sc * (ref3 @ r), ref2[1] - sc * (ref3 @ u)])
    for k, ls in lines.items():
        lw = (lws or {}).get(k, THICK * 0.8)
        S.ax.add_collection(LineCollection([O + sc * l for l in ls], colors=K, linewidths=lw, linestyles='-' if lw > THIN else (0, (6, 2, 1.5, 2)), zorder=3))
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

def sheet():
    fig = S.new_sheet(); sc = 0.5
    pol = lambda deg, r, z=0.0: np.array([np.cos(np.radians(deg)) * r, np.sin(np.radians(deg)) * r, z])

    # ---------------- TOP VIEW, 1:2 ----------------
    TX, TY = 82.0, 200.0
    Pt = view([RING, BASE, QD], (0, 0, -1), (0, 1, 0), sc, (0, 0, 0), (TX, TY))
    L([TX - 56, TX + 56], [TY, TY], THIN, CL); L([TX, TX], [TY - 56, TY + 56], THIN, CL)
    th = np.linspace(0, 2 * np.pi, 200); L(TX + sc * LM.BODY_OD / 2 * np.cos(th), TY + sc * LM.BODY_OD / 2 * np.sin(th), THIN, PH)
    for a in (238.6, 321.4):
        p0, p1 = Pt(pol(a, 20)), Pt(pol(a, 62)); L([p0[0], p1[0]], [p0[1], p1[1]], THIN, CL)
    leader(Pt(pol(280, 44)), (TX + 30, TY - 50), 'NO CLAMPS UNDER THE TAIL\nNOTCH (238.6°-321.4°)', fs=FS - 3.5)
    leader(Pt(pol(57.3, 36.5)), (TX + 44, TY + 52), f'{LM.CLAMP_N}X CLAMP, {LM.CLAMP_W:g} WIDE,\n{LM.CLAMP_ANG[0]:.0f}° TO {LM.CLAMP_ANG[-1]:.0f}° THRU 0°, EQ SP', fs=FS - 3.5)
    leader(Pt(pol(LM.QD_ANG + 12, 70)), (TX - 18, TY + 60), f'ITEM 3 QD CLIP, WRAPS THE\nRIM {LM.QD_ANG - LM.QD_WRAP / 2:.0f}°-{LM.QD_ANG + LM.QD_WRAP / 2:.0f}° (SHEET 2)', ha='right', fs=FS - 3.5)
    txt(TX + 58, TY + 3, '0° = ROCKET\nGIMBAL AXIS X', ha='left', fs=FS - 4)
    a0, a1 = Pt(pol(180, 102)), Pt(pol(0, 102))
    for p, s_ in ((a0, -1), (a1, 1)):
        L([p[0], p[0]], [p[1], p[1] + 0.01], THICK)
    L([a0[0] - 2, a0[0] + 4], [TY, TY], THICK, CP); L([a1[0] - 4, a1[0] + 2], [TY, TY], THICK, CP)
    for p in (a0, a1): arrow((p[0], TY), (p[0], TY - 5), ms=8); txt(p[0] + (-3 if p is a0 else 3), TY - 7, 'A', fontweight='bold', fs=FS - 1)
    caption(TX, TY - 62, 'TOP VIEW  SCALE 1:2')

    # ---------------- FRONT VIEW, HALF SECTION A-A (left: outside, right: cut on y = 0), 1:2 ----------------
    FX, FY0 = 96.0, 30.0
    lines, _, (r, u) = hlr.view_lines([RING, BASE, QD], (0, 1, 0), (0, 0, 1))
    r, u = np.asarray(r), np.asarray(u)
    O = np.array([FX, FY0 + sc * LM.SEAT_H])
    keep = sbox(-500, -500, 0.0, 500)
    segs = []
    for ls in lines.values():
        for l in ls:
            g = LineString(l).intersection(keep)
            for gg in getattr(g, 'geoms', [g]):
                if not gg.is_empty and gg.geom_type == 'LineString': segs.append(O + sc * np.array(gg.coords))
    S.ax.add_collection(LineCollection(segs, colors=K, linewidths=THICK * 0.8, zorder=3))
    # screen x = r . p ; for d = (0,1,0), up z: r = (-1, 0, 0) -> the cut half (x < 0 in the model) shows on the right
    to2d = lambda v: np.c_[FX - sc * v[:, 0], FY0 + sc * (v[:, 2] + LM.SEAT_H)]
    half = SPoly([(FX, 0), (FX + 200, 0), (FX + 200, 300), (FX, 300)])
    section(RING, (0, 1, 0), (0, 0, 0), to2d, 45, clip=half); section(BASE, (0, 1, 0), (0, 0, 0), to2d, 135, clip=half)
    zs = lambda z: FY0 + sc * (z + LM.SEAT_H)
    L([FX, FX], [FY0 - 4, zs(LM.RING_TOP + 44)], THIN, CL)
    # rocket tail wall, motor tube + EDF (phantom, cut half only), exhaust
    poly([(FX + sc * 38.1, zs(0)), (FX + sc * 39.3, zs(0)), (FX + sc * 39.3, zs(55)), (FX + sc * 38.1, zs(55))], THIN, PH)
    L([FX + sc * 17.5] * 2, [zs(-20), zs(55)], THIN, PH); L([FX, FX + sc * 17.5], [zs(-20)] * 2, THIN, PH)
    for k in range(4):
        y = zs(-26 - 13 * k); L([FX, FX + sc * (8 + 6 * k)], [y, y], THIN, PH)
    xr = FX + sc * LM.BASE_R + 6
    for z in (-LM.SEAT_H, -20, -LM.SEAT_H + LM.BASE_T + 1.6 + LM.DEFL_H, 0, LM.RING_TOP):
        x0 = FX + sc * {-LM.SEAT_H: LM.BASE_R * 0.93, -20: 17.5, 0: LM.RING_OD / 2, LM.RING_TOP: LM.RING_OD / 2}.get(z, 4)
        L([x0 + 1.5, xr + 50], [zs(z)] * 2, THIN)
    zd = -LM.SEAT_H + LM.BASE_T + 1.6 + LM.DEFL_H
    dim_v(xr + 8, zs(zd), zs(-20), f'{zd and (-20 - zd):.0f}', side='right', fs=FS - 2.5)
    dim_v(xr + 20, zs(-LM.SEAT_H), zs(-20), f'{LM.SEAT_H - 20:g}', side='right', fs=FS - 2.5)
    dim_v(xr + 32, zs(-LM.SEAT_H), zs(0), f'{LM.SEAT_H:g}', side='right', fs=FS - 2.5)
    dim_v(xr + 44, zs(-LM.SEAT_H), zs(LM.RING_TOP), f'{LM.SEAT_H + LM.RING_TOP:g}', side='right', fs=FS - 2.5)
    lx = xr + 56
    leader((FX + sc * 39.3, zs(40)), (lx, zs(52)), 'ROCKET TAIL (PHANTOM),\nSEAT = TAIL PLANE', fs=FS - 3.5)
    leader((FX + sc * 17.5, zs(-12)), (lx, zs(12)), 'MOTOR TUBE + EDF (PHANTOM),\nEXIT 20 BELOW THE SEAT', fs=FS - 3.5)
    leader((FX + sc * 14, zs(-26)), (lx, zs(-30)), 'EXHAUST', fs=FS - 3.5)
    leader((FX + sc * 10, zs(zd - 7)), (lx, zs(-80)), f'FLAME DEFLECTOR\nØ{LM.DEFL_D:g} X {LM.DEFL_H:g} CONE', fs=FS - 3.5)
    txt(FX - sc * LM.BASE_R + 2, zs(LM.RING_TOP + 30), 'OUTSIDE', ha='left', fs=FS - 3.5)
    txt(FX + sc * LM.BASE_R - 2, zs(LM.RING_TOP + 30), 'SECTION A-A', ha='right', fs=FS - 3.5)
    S.ax.add_patch(Circle((FX + sc * 44, zs(-6)), 12, fill=False, ec=K, lw=THIN, ls=PH, zorder=5)); txt(FX + sc * 44 + 12, zs(-6) + 11, 'B', fontweight='bold')
    caption(FX, FY0 - 5, 'FRONT VIEW / HALF SECTION A-A (BACKGROUND OMITTED)  1:2')

    # ---------------- DETAIL B: clamp section at 0.4 deg (≈ plane y = 0), 2:1 ----------------
    s2 = 2.0; BX, BY = 190.0, 196.0
    X = lambda r: BX + s2 * (r - LM.LEDGE_R); Y = lambda z: BY + s2 * z
    clip = sbox(LM.LEDGE_R - 6, LM.RING_BOT - 2, LM.RING_OD / 2 + 2, LM.RING_TOP + 2)
    section(RING, (0, 1, 0), (0, 0, 0), lambda v: np.c_[X(v[:, 0]), Y(v[:, 2])], 45, clip=SPoly([(X(clip.bounds[0]), Y(clip.bounds[1])), (X(clip.bounds[2]), Y(clip.bounds[1])), (X(clip.bounds[2]), Y(clip.bounds[3])), (X(clip.bounds[0]), Y(clip.bounds[3]))]), pitch=1.6)
    ri, ro = 38.1, 39.3
    poly([(X(ri), Y(0)), (X(ro), Y(0)), (X(ro), Y(22)), (X(ri), Y(22))], THIN, PH); txt(X(38.7), Y(25), 'ROCKET\nWALL', fs=FS - 4)
    for r_ in (LM.LEDGE_R, LM.RING_OD / 2):
        L([X(r_)] * 2, [Y(0 if r_ == LM.LEDGE_R else LM.RING_TOP) + 1.5, Y(LM.RING_TOP) + 30], THIN)
    dim_h(Y(LM.RING_TOP) + 26, X(LM.LEDGE_R), X(LM.RING_OD / 2), f'{LM.RING_OD / 2 - LM.LEDGE_R:g}', fs=FS - 2.5)
    for z in (LM.RING_TOP, 0, LM.RING_BOT): L([X(LM.RING_OD / 2) + 1.5, X(LM.RING_OD / 2) + 22], [Y(z)] * 2, THIN)
    dim_v(X(LM.RING_OD / 2) + 8, Y(0), Y(LM.RING_TOP), f'{LM.RING_TOP:g} LIP', side='right', fs=FS - 2.5)
    dim_v(X(LM.RING_OD / 2) + 8, Y(LM.RING_BOT), Y(0), f'{-LM.RING_BOT:g}', side='right', fs=FS - 2.5)
    txt(X((LM.LEDGE_R + LM.RING_OD / 2) / 2), Y(LM.RING_BOT) - 8,
        f'SEAT LEDGE Ø{2 * LM.LEDGE_R:g}   LIP Ø{2 * LM.R_LIP:.1f}   RING Ø{LM.RING_ID:g} / Ø{LM.RING_OD:g}', fs=FS - 3.5)
    caption(X((LM.LEDGE_R + LM.RING_OD / 2) / 2), Y(LM.RING_BOT) - 13, 'DETAIL B: TYPICAL CLAMP (CUT AT 0°)  SCALE 2:1')

    # ---------------- ISOMETRIC with the rocket tail (phantom), 1:2 ----------------
    IX, IY = 345.0, 189.0
    Pi = view([RING, BASE, QD, A], (-1, -0.8, -0.6), (0, 0, 1), sc, (0, 0, -40), (IX, IY), lws={3: THIN * 0.9})
    caption(IX, IY - 58, 'ISOMETRIC, ROCKET TAIL IN PHANTOM  SCALE 1:2')
    balloon(Pi(pol(20, LM.RING_OD / 2, LM.RING_BOT + 12)), np.array([IX + 54, IY + 6]), 1)
    balloon(Pi(pol(-10, 70, -70)), np.array([IX + 54, IY - 26]), 2)
    balloon(Pi(pol(LM.QD_ANG - 16, LM.RING_OD / 2 + 2.4, 24)), np.array([IX + 56, IY + 40]), 3)

    tbx, tby, tbw, tbh = S.frame(1, 2, DWG, TITLE, date=DATE, scale='1:2', mass=f'~{INFILL_MASS:.0f} g', material='PLA',
                                 rev='B', rev_rows=REVS)
    vr = RING.bounds; vb = BASE.bounds
    vr, vb, vq = RING.bounds, BASE.bounds, QD.bounds
    S.parts_list(tbx, tby + tbh, [(4, 1, f'SCREW, M3 X 8 SELF-TAPPING (ITEM 3 TO ITEM 1), SHEET 2', 'STEEL, BLACK'),
                                  (3, 1, f'QD CLIP, WRAPS THE RING RIM ({LM.QD_WRAP:g}° X {np.ptp(vq[:, 2]):.0f}), SHEET 2', 'PLA, BLACK'),
                                  (2, 1, f'BASE: OCTAGON + 6 COLUMNS + DEFLECTOR ({np.ptp(vb[:, 0]):.0f} X {np.ptp(vb[:, 2]):.0f})', 'PLA, GREY'),
                                  (1, 1, f'RING: 10 CLAMPS (Ø{LM.RING_OD:g} X {np.ptp(vr[:, 2]):.0f})', 'PLA, GREY')])
    notes_block(282, 125, ['NOTES:',
        '1. PRINT ITEMS 1 + 2 UPRIGHT, NO SUPPORTS, 3 WALLS, 15% INFILL. ITEM 3: SHEET 2.',
        f'2. PRESS THE 6X Ø{LM.PEG_D:g} PEGS INTO THE RING SOCKETS (CA IF LOOSE). ITEM 4 FIXES ITEM 3.',
        '3. TAIL NOTCH (280°) OVER THE CLAMP GAP: TAIL EDGE ON THE LEDGES, INSIDE THE LIPS.',
        '4. DISPLAY STAND: CLAMP THE BASE BEFORE SPINNING THE FAN; TESTS ON THE RIG (GS-001).',
        '5. CHECKED: ROCKET + SERVO SWEEP ±10° (SLDP-TVC-002) CLEAR ITEMS 1-3.',
        '6. FINISH: ITEMS 1 + 2 GREY, ITEM 3 BLACK.'], fs=FS - 3.5, pitch=4.0)
    return fig


# =========================================================================== SHEET 2: item 3 QD clip
GREY, BLACK, LINE_ON_BLACK = '#dedede', '#262626', '#9a9a9a'

def silhouette(m, r, u):
    """2D outline (shapely) of a mesh projected on the screen axes (r, u)."""
    from shapely.ops import unary_union
    V, F = m.vertices, m.faces
    t = np.stack([V[F] @ r, V[F] @ u], axis=-1)
    a = 0.5 * np.abs((t[:, 1, 0] - t[:, 0, 0]) * (t[:, 2, 1] - t[:, 0, 1]) - (t[:, 2, 0] - t[:, 0, 0]) * (t[:, 1, 1] - t[:, 0, 1]))
    return unary_union([SPoly(q) for q in t[a > 1e-4]]).buffer(0.05).buffer(-0.05)

def colour_view(items, d, up, sc, ref3, ref2):
    """items = [(mesh, colour)]: silhouettes filled in paint order, then hidden-line edges (light lines on black)."""
    meshes = [m for m, _ in items]
    lines, _, (r, u) = hlr.view_lines(meshes, d, up)
    r, u = np.asarray(r), np.asarray(u); ref3 = np.asarray(ref3, float)
    O = np.array([ref2[0] - sc * (ref3 @ r), ref2[1] - sc * (ref3 @ u)])
    # paint back-to-front by mean depth so the clip in front of the ring covers it
    order = sorted(range(len(items)), key=lambda k: -(items[k][0].vertices.mean(0) @ np.asarray(d, float) / np.linalg.norm(d)))
    for k in order:
        g = silhouette(items[k][0], r, u)
        for pg in getattr(g, 'geoms', [g]):
            if pg.geom_type == 'Polygon' and not pg.is_empty:
                S.ax.add_patch(Polygon(O + sc * np.array(pg.exterior.coords), fc=items[k][1], ec='none', zorder=1 + 0.1 * order.index(k)))
    for k, ls in lines.items():
        S.ax.add_collection(LineCollection([O + sc * l for l in ls], colors=LINE_ON_BLACK if items[k][1] == BLACK else K,
                                           linewidths=THIN * 1.1, zorder=3))
    return lambda p: O + sc * np.array([np.asarray(p, float) @ r, np.asarray(p, float) @ u])

def swatch(x, y, colour, label):
    S.ax.add_patch(Polygon([(x, y - 2.5), (x + 9, y - 2.5), (x + 9, y + 2.5), (x, y + 2.5)], fc=colour, ec=K, lw=THIN, zorder=4))
    txt(x + 12, y, label, ha='left', fs=FS - 3)

def dim_h_in(y, x0, x1, label, fs=FS - 2.5):
    """Small horizontal dimension: arrows inside pointing out, value to the left."""
    lo, hi = min(x0, x1), max(x0, x1)
    L([lo, hi], [y, y], THIN); arrow(((lo + hi) / 2, y), (lo, y), ms=7); arrow(((lo + hi) / 2, y), (hi, y), ms=7)
    txt(lo - 1.5, y, label, ha='right', fs=fs)

def dim_h_out(y, x0, x1, label, fs=FS - 2.5):
    """Small horizontal dimension across a wall: arrows outside pointing in, value to the left."""
    lo, hi = min(x0, x1), max(x0, x1)
    arrow((lo - 6, y), (lo, y)); arrow((hi + 6, y), (hi, y)); L([lo, hi], [y, y], THIN)
    txt(lo - 7.5, y, label, ha='right', fs=fs)

def profile_lines(polys, X, Y, lw=THICK * 0.8, ls='-'):
    """Outline of the union of (r, z) polygons, mapped to the sheet."""
    from shapely.ops import unary_union
    g = unary_union([SPoly(p) for p in polys])
    out = []
    for pg in getattr(g, 'geoms', [g]):
        c = np.array(pg.exterior.coords); L(X(c[:, 0]), Y(c[:, 1]), lw, ls, z=4); out.append(pg)
    return out

def sheet2():
    fig = S.new_sheet()
    pol = lambda deg, r, z=0.0: np.array([np.cos(np.radians(deg)) * r, np.sin(np.radians(deg)) * r, z])
    P = LM.qd_profile(); Ri, Ro, Rt, Rh, za, zb, z_out = (P[k] for k in ('Ri', 'Ro', 'Rt', 'Rh', 'za', 'zb', 'z_out'))
    zbot = zb - LM.QD_T; r0, r1 = P['r0'], P['r1']; tip, back, hh, th = LM.QD_HOOD
    hb = P['hb']; htop = lambda r: hb(r) + th

    # ---------------- SECTION C-C, item 3 alone, 2:1 ----------------
    s2, CX, CY = 2.0, 125.0, 140.0
    X = lambda r: CX + s2 * (np.asarray(r) - Ro); Y = lambda z: CY + s2 * np.asarray(z)
    from shapely.ops import unary_union
    from shapely.affinity import affine_transform
    zs_, hd = LM.Z_SCREW, LM.QD_SCREW[0]
    sec = unary_union([SPoly(P['clip']), SPoly(P['hood'])]).difference(sbox(Ri - 0.5, zs_ - hd / 2, Ro + 0.5, zs_ + hd / 2))
    sec = affine_transform(sec, [s2, 0, 0, s2, CX - s2 * Ro, CY])
    for pg in getattr(sec, 'geoms', [sec]):
        c = np.array(pg.exterior.coords); L(c[:, 0], c[:, 1], THICK * 0.8, z=4); hatch(pg, 135, 1.6)
    L([X(Ri) - 3, X(Ro) + 3], [Y(zs_)] * 2, THIN, CL)
    # left chain: hook 2.4 | rim gap 28.4 | hood underside 24 | hood 3
    xc = 56.0
    for z, r_ in ((zbot, Rh), (zb, Rh), (za, Rt), (za + hh, r0), (za + hh + th, r0)):
        L([X(r_) - 1.5, xc - 2], [Y(z)] * 2, THIN)
    dim_v(xc, Y(zbot), Y(zb), f'{LM.QD_T:g}', fs=FS - 2.5)
    dim_v(xc, Y(zb), Y(za), f'{za - zb:.1f} ±0.1', fs=FS - 2.5)
    dim_v(xc, Y(za), Y(za + hh), f'{hh:g}', fs=FS - 2.5)
    dim_v(xc, Y(za + hh), Y(za + hh + th), f'{th:g}', fs=FS - 2.5)
    # right: overall height, slope angle at the outer top corner
    xr = CX + 10.0
    for z in (zbot, z_out): L([X(Ro) + 1.5, xr + 2], [Y(z)] * 2, THIN)
    dim_v(xr, Y(zbot), Y(z_out), f'{z_out - zbot:.1f}', side='right', fs=FS - 2.5)
    from matplotlib.patches import Arc
    t25 = np.radians(LM.QD_SLOPE); c0 = np.array([X(Ro), Y(z_out)]); R_ = 17.0
    L([c0[0], c0[0] + (R_ + 3) * np.cos(t25)], [c0[1], c0[1] + (R_ + 3) * np.sin(t25)], THIN)
    S.ax.add_patch(Arc(c0, 2 * R_, 2 * R_, theta1=0, theta2=LM.QD_SLOPE, color=K, lw=THIN, zorder=5))
    txt(c0[0] + (R_ + 4.5) * np.cos(t25 / 2), c0[1] + (R_ + 4.5) * np.sin(t25 / 2), f'{LM.QD_SLOPE:g}°', ha='left', fs=FS - 2.5)
    # top: hood back 9, hood tip 24 (from the shroud OD)
    yt = Y(z_out) + 10
    L([X(Ro)] * 2, [Y(z_out) + 1.5, yt + 12], THIN)
    L([X(r1)] * 2, [Y(htop(r1)) + 1.5, yt + 2], THIN); L([X(r0)] * 2, [Y(htop(r0)) + 1.5, yt + 12], THIN)
    dim_h(yt, X(r1), X(Ro), f'{back:g}', fs=FS - 2.5); dim_h(yt + 10, X(r0), X(Ro), f'{tip:g}', fs=FS - 2.5)
    # in the mouth: tower/cap reach 15, hook 3.5, wall 2.4, bore R
    yb = Y(za) - 8
    L([X(Rt)] * 2, [Y(za) - 1.5, yb - 2], THIN)
    dim_h(yb, X(Rt), X(Ri), f'{LM.QD_TOWER:g}', fs=FS - 2.5)
    yh = Y(zb) + 6
    L([X(Rh)] * 2, [Y(zb) + 1.5, yh + 2], THIN)
    dim_h_in(yh, X(Rh), X(Ri), f'{LM.QD_HOOK:g}')
    dim_h_out(Y(zs_ - 6), X(Ri), X(Ro), f'{LM.QD_T:g}')
    leader((X(Ri) + 0.6, Y(zs_)), (X(Ri) - 12, Y(zs_ + 2.5)), f'Ø{hd:g} THRU', ha='right', fs=FS - 2.5)
    leader((X(Ri), Y(zs_ + 6)), (X(Ri) - 12, Y(zs_ + 8)), f'R{Ri:.1f} ±0.1', ha='right', fs=FS - 2.5)
    leader((X(r0 + 2.5), Y(hb(r0 + 2.5))), (X(r0) - 13, Y(za + hh - 9)), 'PARALLEL\nTO TOP', fs=FS - 3.5)
    # datums A (cap underside) and B (bore)
    def datum(p, letter, d=(0, -1), length=7):
        x, y = p; bx, by = x + d[0] * length, y + d[1] * length
        L([x, bx], [y, by], THIN); px, py = -d[1], d[0]
        S.ax.add_patch(Polygon([(x + px * 1.8, y + py * 1.8), (x - px * 1.8, y - py * 1.8), (x + d[0] * 2.6, y + d[1] * 2.6)], fc=K, ec=K, zorder=6))
        fx, fy = bx + d[0] * 3.5, by + d[1] * 3.5
        box(fx - 3.5, fy - 3.5, fx + 3.5, fy + 3.5, lw=THIN); txt(fx, fy, letter, fontweight='bold', fs=FS - 1)
    caption(X((Rh + Ro) / 2) - 20, Y(zbot) - 7, 'SECTION C-C (ITEM 3)  SCALE 2:1')

    # ---------------- DETAIL E: item 3 on the ring rim (plane x = 0), 1:1 ----------------
    EX, EY = 186.0, 205.0
    XE = lambda r: EX + (np.asarray(r) - 34.0); YE = lambda z: EY + np.asarray(z)
    to2d = lambda v: np.c_[XE(v[:, 1]), YE(v[:, 2])]
    clipE = SPoly([(XE(34), YE(-40)), (XE(85), YE(-40)), (XE(85), YE(48)), (XE(34), YE(48))])
    section(RING, (1, 0, 0), (0, 0, 0), to2d, 45, clip=clipE, pitch=1.2)
    section(BASE, (1, 0, 0), (0, 0, 0), to2d, 45, clip=clipE, pitch=2.4)
    section(QD, (1, 0, 0), (0, 0, 0), to2d, 135, clip=clipE, pitch=1.0)
    poly([(XE(38.1), YE(0)), (XE(39.3), YE(0)), (XE(39.3), YE(46)), (XE(38.1), YE(46))], THIN, PH)
    zs_, Ls = LM.Z_SCREW, 8.0                                         # item 4, M3 x 8 pan head (phantom)
    poly([(XE(Ro), YE(zs_ - 2.75)), (XE(Ro + 2.1), YE(zs_ - 2.75)), (XE(Ro + 2.1), YE(zs_ + 2.75)), (XE(Ro), YE(zs_ + 2.75))], THIN, PH)
    poly([(XE(Ro - Ls), YE(zs_ - 1.5)), (XE(Ro), YE(zs_ - 1.5)), (XE(Ro), YE(zs_ + 1.5)), (XE(Ro - Ls), YE(zs_ + 1.5))], THIN, PH)
    leader((XE(Ro + 2.1), YE(zs_ + 1)), (lxE if False else XE(85) + 8, YE(zs_ + 10)), f'ITEM 4 M3 X 8 SELF-TAPPING\nINTO Ø{LM.QD_SCREW[1]:g} ↧ {LM.QD_SCREW[2]:g} PILOT IN ITEM 1', fs=FS - 3.5)
    lxE = XE(85) + 8
    leader((XE(Ro - 6), YE(z_out - 4)), (lxE, YE(40)), 'ITEM 3 QD CLIP (BLACK)', fs=FS - 3.5)
    leader((XE(65), YE(-34)), (lxE, YE(-37)), 'ITEM 2 COLUMN\nAT 90° (GREY)', fs=FS - 3.5)
    leader((XE(44), YE(-10)), (XE(34) - 10, YE(-24)), 'ITEM 1 RING + CLAMP\nAT 85.8° (GREY)', ha='right', fs=FS - 3.5)
    leader((XE(39.3), YE(30)), (XE(39.3) + 9, YE(54)), 'ROCKET WALL (PHANTOM)', fs=FS - 3.5)
    caption(XE(59), YE(-40) - 4, 'DETAIL E: ITEM 3 ON THE RING RIM\n(SECTION C-C)  SCALE 1:1')

    # ---------------- VIEW D: item 3 from above, 1:1 ----------------
    DX, DY = 205.0, 42.0
    th_ = np.linspace(np.radians(LM.QD_ANG - LM.QD_WRAP / 2), np.radians(LM.QD_ANG + LM.QD_WRAP / 2), 60)
    Dp = view([QD], (0, 0, -1), (0, 1, 0), 1.0, (0, 0, 0), (DX, DY))
    for a in (LM.QD_ANG - LM.QD_WRAP / 2, LM.QD_ANG + LM.QD_WRAP / 2):
        p0, p1 = Dp(pol(a, Ro + 1.5)), Dp(pol(a, Ro + 12)); L([p0[0], p1[0]], [p0[1], p1[1]], THIN)
    ra = Ro + 9; ang = np.linspace(LM.QD_ANG - LM.QD_WRAP / 2, LM.QD_ANG + LM.QD_WRAP / 2, 40)
    L(DX + ra * np.cos(np.radians(ang)), DY + ra * np.sin(np.radians(ang)), THIN)
    for a, a2 in ((ang[0], ang[3]), (ang[-1], ang[-4])):
        arrow((DX + ra * np.cos(np.radians(a2)), DY + ra * np.sin(np.radians(a2))), (DX + ra * np.cos(np.radians(a)), DY + ra * np.sin(np.radians(a))), ms=7)
    txt(DX, DY + ra + 3, f'{LM.QD_WRAP:g}°', fs=FS - 2.5)
    # cutting plane C-C on the 90 deg radial
    y0c, y1c = DY + r0 - 6, DY + Ro + 4
    L([DX, DX], [y0c, y1c], THICK, CP)
    for yy, dd in ((y0c, -1), (y1c, 1)):
        L([DX - 1, DX + 0.4], [yy, yy], THICK)
        arrow((DX - 1, yy), (DX - 7, yy), ms=8); txt(DX - 10, yy, 'C', fontweight='bold', fs=FS - 1)
    txt(DX + 36, DY + r0 + 2, f'CENTRED ON\n{LM.QD_ANG:g}° (DOOR SIDE)', ha='left', fs=FS - 4)
    caption(DX, DY + r0 * np.sin(np.radians(LM.QD_ANG - LM.QD_WRAP / 2)) - 5, 'VIEW D (ITEM 3 FROM ABOVE)  SCALE 1:1')

    # ---------------- PRINT ORIENTATION, 1:2 ----------------
    PX, PY = 205.0, 30.0
    bb = QDP.bounds
    Pp = view([QDP], (-1, -0.7, -0.45), (0, 0, 1), 0.5, (0, 0, 0), (PX, PY + 14))
    (x0, y0, _), (x1, y1, _) = QDP.bounds - np.array([[8, 8, 0], [-8, -8, 0]])
    bed = [Pp((x, y, 0)) for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))]
    poly(bed, THIN, PH)
    leader(tuple((bed[1] + bed[2]) / 2), (max(b[0] for b in bed) + 4, PY + 6), 'BED', fs=FS - 4)
    caption(PX, PY - 2, 'PRINT ORIENTATION (ON AN END FACE)  SCALE 1:2')

    # ---------------- INSTALLATION: item 3 pulled out radially at 90 deg, 1:2 ----------------
    PULL = 50.0
    dv = np.array([np.cos(np.radians(LM.QD_ANG)), np.sin(np.radians(LM.QD_ANG)), 0.0])
    QDx = QD.copy(); QDx.apply_translation(dv * PULL)
    dI, upI, sI = (-1, -0.3, -0.65), (0, 0, 1), 0.5         # side-on to the 90 deg radial: the pull runs across the sheet
    _, rI, uI = hlr.basis(dI, upI)
    allv = np.vstack([RING.vertices, BASE.vertices, QDx.vertices])
    sx, sy = allv @ rI, allv @ uI
    bx0, bx1, by0, by1 = 300.0, 404.0, 130.0, 228.0                      # free box right of detail E, under the revisions
    cen = np.array([(sx.min() + sx.max()) / 2, (sy.min() + sy.max()) / 2])
    O = np.array([(bx0 + bx1) / 2, (by0 + by1) / 2]) - sI * cen
    lines, _, _ = hlr.view_lines([RING, BASE, QDx], dI, upI)
    for k, ls in lines.items():
        S.ax.add_collection(LineCollection([O + sI * l for l in ls], colors=K, linewidths=THICK * 0.8, zorder=3))
    Pj = lambda p: O + sI * np.array([np.asarray(p, float) @ rI, np.asarray(p, float) @ uI])
    za_ = z_out + 10
    arrow(Pj(pol(LM.QD_ANG, Ro + PULL - 8, za_)), Pj(pol(LM.QD_ANG, Ro - 2, za_)), ms=10)
    balloon(Pj(pol(-60, LM.RING_OD / 2, LM.RING_BOT + 12)), np.array([bx0, (by0 + by1) / 2 + 22]), 1)
    balloon(Pj(pol(-80, 70, -75)), np.array([bx0, by0 + 12]), 2)
    q3 = Pj(pol(LM.QD_ANG - 12, Ro, -10) + dv * PULL); balloon(q3, q3 + np.array([2, -24]), 3)
    caption((bx0 + bx1) / 2, by0 - 4, 'INSTALLATION: SLIDE ITEM 3 ONTO THE RIM AT 90°\n(ARROW), THEN FIT ITEM 4  SCALE 1:2')

    tbx, tby, tbw, tbh = S.frame(2, 2, DWG, TITLE, date=DATE, scale='AS SHOWN', mass=f'~{QD_MASS:.0f} g', material='PLA',
                                 rev='B', rev_rows=REVS)
    notes_block(282, 103, ['NOTES (ITEM 3):',
        '1. PLA, BLACK. 3 WALLS, 15% INFILL. PRINT LYING ON EITHER END FACE (ABOVE),',
        f'   NO SUPPORTS: STEEPEST OVERHANG = WRAP ANGLE ({LM.QD_WRAP:g}°).',
        f'2. BORE R{Ri:.1f} AND RIM GAP {za - zb:.1f} GIVE {LM.QD_CLR:g} CLEARANCE ON THE RING RIM',
        f'   (Ø{LM.RING_OD:g} X {LM.RING_TOP - LM.RING_BOT:g}). Ø{LM.QD_SCREW[0]:g} HOLE CENTRED IN THE RIM GAP, AT {LM.QD_ANG:g}°.',
        f'3. SLIDE ON RADIALLY FROM OUTSIDE AT {LM.QD_ANG:g}° (OVER THE COLUMN), THEN ITEM 4',
        '   THROUGH THE HOLE INTO THE PILOT IN ITEM 1. NO GLUE. HOOK CLEARS THE COLUMN BY 0.8.',
        '4. DECORATIVE: NOTHING TOUCHES THE ROCKET (MIN 13.9 CLEARANCE).'], fs=FS - 3.5, pitch=4.3)
    return fig

if __name__ == '__main__':
    figs = [sheet(), sheet2()]
    base = os.path.join(here, 'SLDP-GS-003_launch_mount')
    with PdfPages(base + '.pdf') as pdf:
        for f in figs: pdf.savefig(f)
    for n, f in enumerate(figs, 1): f.savefig(f'{base}_sheet{n}.png', dpi=170)
    print('ok')
