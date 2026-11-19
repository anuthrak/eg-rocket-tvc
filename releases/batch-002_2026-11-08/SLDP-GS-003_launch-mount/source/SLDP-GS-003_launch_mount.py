"""
SLDP-GS-003  Launch mount v2 -- orbital-launch-mount-style display / service stand for the SLDP-ST-008 rocket.
Supersedes SLDP-GS-002 (simple C-ring on 6 legs).

Rev B: the quick-disconnect (QD) is no longer a block on the ring top. It is a separate black clip (item 3)
that wraps 40 deg of the ring rim at 90 deg: cap over the ring top, shroud down the ring OD and a hook under
the ring bottom, with the tower + hood on top. It slides onto the rim radially from outside (the C opens toward
the axis, so nothing has to flex) and is held by one M3 x 8 self-tapping screw (item 4) radially through the
shroud into a dia 2.5 pilot in the ring OD, centred on the rim height. No glue: the C traps it vertically, the
screw stops it sliding out or rotating round the rim. Ring and base unchanged; mount grey, QD black.

Shape: a thick table RING on 6 tapered COLUMNS standing on an octagonal BASE, with a flame-deflector cone under
the engine and the wrap-around QD clip on the ring rim. The rocket stands on 10 CLAMPS inside the ring:
each clamp has a seat ledge (the tail edge sits on it) and a 6 mm locating lip. No clamp sits under the tail
notch (238.6-321.4 deg): the riding TVC servo + horn hang up to ~9 mm below the tail there and swing out to R48,
so the ring bore is R52 and the clamps run from 332 deg round through 0 to 228 deg.

Three prints, all support-free:
  1  RING  (ring + clamps), upright, underside on the bed; 6X dia 6.4 x 7 sockets underneath      -- grey
  2  BASE  (octagon + 6 columns + deflector cone), upright, base on the bed; 6X dia 6 x 6 pegs    -- grey
  3  QD CLIP, lying on one END FACE (the C-profile on the bed); max overhang = QD_WRAP (40 deg)   -- black
Press the pegs into the sockets (a drop of CA if loose). Slide the QD onto the rim at 90 deg, fit the M3 x 8.

Requires: pip install cadquery numpy.   Run: python3 SLDP-GS-003_launch_mount.py
Coordinates: z = rocket axis, 0 at the seat (= rocket tail plane); angles from +x (rocket gimbal axis X), CCW from above.
"""
import os, numpy as np, cadquery as cq

BODY_OD   = 78.6            # SLDP-ST-008 tube OD
LIP_CLR   = 0.35            # radial clearance tail <-> clamp lip
SEAT_H    = 110.0           # seat (tail plane) above the desk
# ring
RING_ID, RING_OD, RING_TOP, RING_BOT = 104.0, 150.0, 6.0, -22.0
# clamps: seat ledge r 35 .. lip, lip r_lip .. ring ID, up to the ring top
CLAMP_N, CLAMP_W, LEDGE_R = 10, 9.0, 35.0
CLAMP_ANG = tuple((332.0 + k * 256.0 / 9) % 360 for k in range(10))    # 332 .. 0 .. 228 (clear of the tail notch)
# QD clip (item 3) wrapping the ring rim. Datum A = cap underside (sits on the ring top), datum B = shroud bore
# (bears on the ring OD). The tower sits directly on the cap; its top slopes down toward the rocket; the hood is a
# plate parallel to the tower top, overhanging toward the rocket.
QD_ANG, QD_WRAP = 90.0, 40.0          # centre angle, wrap angle (<= 45 so it prints on its end face without supports)
QD_CLR, QD_T    = 0.2, 2.4            # clearance to the rim (each face), shroud wall / hook thickness
QD_TOWER, QD_HOOK = 15.0, 3.5         # tower (= cap) reach over the ring top, hook reach under the ring bottom (from B)
QD_H, QD_SLOPE  = 36.0, 25.0          # tower top at the shroud OD above A; top slope (deg) down toward the rocket
QD_HOOD = (24.0, 9.0, 24.0, 3.0)      # hood tip / hood back from the shroud OD; hood tip underside above A; thickness
QD_SCREW = (3.2, 2.5, 8.0)            # M3 x 8 self-tapping: clearance in the clip, pilot dia + depth in the ring OD
Z_SCREW = (RING_TOP + RING_BOT) / 2   # screw axis: centred on the rim height (= centred in the clip's rim gap)
# columns + base
COL_N, COL_ANG0 = 6, 30.0
COL_TOP, COL_BOT = (16.0, 12.0, 64.0), (22.0, 16.0, 74.0)          # (tangential, radial, centre radius)
PEG_D, PEG_L, SOCKET_D, SOCKET_L = 6.0, 6.0, 6.4, 7.0
BASE_R, BASE_T = 100.0, 6.0                                          # octagon circumradius, thickness
DEFL_D, DEFL_H = 56.0, 14.0                                          # flame-deflector cone

R_LIP = BODY_OD / 2 + LIP_CLR
Z_DESK = -SEAT_H
Z_BASE_TOP = Z_DESK + BASE_T

def ring_part():
    ring = (cq.Workplane('XY').workplane(offset=RING_BOT).circle(RING_OD / 2).circle(RING_ID / 2).extrude(RING_TOP - RING_BOT))
    ring = ring.edges('>Z').chamfer(1.0)
    for a in CLAMP_ANG:
        r_in = cq.Workplane('XY').workplane(offset=RING_BOT).center((LEDGE_R + RING_ID / 2 + 1) / 2, 0) \
            .rect(RING_ID / 2 + 1 - LEDGE_R, CLAMP_W).extrude(0 - RING_BOT)                       # seat ledge to z = 0
        lip = cq.Workplane('XY').workplane(offset=RING_BOT).center((R_LIP + RING_ID / 2 + 1) / 2, 0) \
            .rect(RING_ID / 2 + 1 - R_LIP, CLAMP_W).extrude(RING_TOP - RING_BOT)                   # lip to the ring top
        ring = ring.union(r_in.union(lip).rotate((0, 0, 0), (0, 0, 1), a))
    d_p, L_p = QD_SCREW[1], QD_SCREW[2]                                # pilot for the QD screw (item 4)
    ring = ring.cut(cq.Workplane('XZ', origin=(0, RING_OD / 2 + 1, Z_SCREW)).circle(d_p / 2).extrude(L_p + 1)
                    .rotate((0, 0, 0), (0, 0, 1), QD_ANG - 90))
    for k in range(COL_N):
        a = np.radians(COL_ANG0 + 60 * k)
        ring = ring.cut(cq.Workplane('XY').workplane(offset=RING_BOT - 1).center(COL_TOP[2] * np.cos(a), COL_TOP[2] * np.sin(a))
                        .circle(SOCKET_D / 2).extrude(SOCKET_L + 1))
    return ring

def qd_profile():
    """(r, z) polygons of the QD clip section: C-clip with tower, and hood."""
    Ri = RING_OD / 2 + QD_CLR; Ro = Ri + QD_T                      # shroud bore (datum B), shroud OD
    za = RING_TOP + QD_CLR; zb = RING_BOT - QD_CLR                # cap underside (datum A), hook top
    Rt, Rh = Ri - QD_TOWER, Ri - QD_HOOK
    t = np.tan(np.radians(QD_SLOPE)); z_out = za + QD_H
    ztop = lambda r: z_out - t * (Ro - r)                         # tower top line
    clip = [(Rh, zb - QD_T), (Ro, zb - QD_T), (Ro, z_out), (Rt, ztop(Rt)), (Rt, za), (Ri, za), (Ri, zb), (Rh, zb)]
    tip, back, h, th = QD_HOOD; r0, r1 = Ro - tip, Ro - back
    hb = lambda r: za + h + t * (r - r0)                          # hood underside, parallel to the tower top
    hood = [(r0, hb(r0)), (r1, hb(r1)), (r1, hb(r1) + th), (r0, hb(r0) + th)]
    return dict(clip=clip, hood=hood, Ri=Ri, Ro=Ro, Rt=Rt, Rh=Rh, za=za, zb=zb, z_out=z_out, ztop=ztop, hb=hb, r0=r0, r1=r1)

def qd_part():
    """Revolve the profile through QD_WRAP, centred on QD_ANG."""
    P = qd_profile(); q = None
    for k in ('clip', 'hood'):
        s_ = cq.Workplane('XZ').polyline(P[k]).close().revolve(QD_WRAP, (0, 0, 0), (0, 1, 0))
        q = s_ if q is None else q.union(s_)
    # the revolve sweeps from +x toward -y or +y depending on the workplane normal: find its mid-angle and centre it
    c = q.val().Center(); mid = np.degrees(np.arctan2(c.y, c.x))
    q = q.rotate((0, 0, 0), (0, 0, 1), QD_ANG - mid)
    hole = cq.Workplane('XZ', origin=(0, P['Ro'] + 1, Z_SCREW)).circle(QD_SCREW[0] / 2).extrude(QD_T + 3)   # radial, through the shroud
    return q.cut(hole.rotate((0, 0, 0), (0, 0, 1), QD_ANG - 90))

def qd_print(Q):
    """Lay the clip on its lower end face (angle QD_ANG - QD_WRAP/2) for a support-free print, z min = 0."""
    q = Q.rotate((0, 0, 0), (0, 0, 1), -(QD_ANG - QD_WRAP / 2))      # end face -> plane y = 0, body at y >= 0
    q = q.rotate((0, 0, 0), (1, 0, 0), 90)                           # y -> z
    bb = q.val().BoundingBox()
    return q.translate((-bb.center.x, -bb.center.y, -bb.zmin))

def base_part():
    pts = [(BASE_R * np.cos(np.radians(22.5 + 45 * k)), BASE_R * np.sin(np.radians(22.5 + 45 * k))) for k in range(8)]
    base = cq.Workplane('XY').workplane(offset=Z_DESK).polyline(pts).close().extrude(BASE_T).edges('>Z').chamfer(1.5)
    inner = [(0.86 * x, 0.86 * y) for x, y in pts]                                                  # raised deck plate
    base = base.union(cq.Workplane('XY').workplane(offset=Z_BASE_TOP).polyline(inner).close().extrude(1.6))
    defl = cq.Solid.makeCone(DEFL_D / 2, 3.0, DEFL_H, cq.Vector(0, 0, Z_BASE_TOP + 1.6))
    base = base.union(cq.Workplane().add(defl))
    zb, zt = Z_BASE_TOP + 1.6, RING_BOT
    for k in range(COL_N):
        col = (cq.Workplane('XY').workplane(offset=zb - 0.5).center(COL_BOT[2], 0).rect(COL_BOT[1], COL_BOT[0])
               .workplane(offset=zt - zb + 0.5).center(COL_TOP[2] - COL_BOT[2], 0).rect(COL_TOP[1], COL_TOP[0]).loft())
        peg = cq.Workplane('XY').workplane(offset=zt).center(COL_TOP[2], 0).circle(PEG_D / 2).extrude(PEG_L)
        base = base.union(col.union(peg).rotate((0, 0, 0), (0, 0, 1), COL_ANG0 + 60 * k))
    return base

if __name__ == '__main__':
    here = os.path.dirname(os.path.abspath(__file__))
    R, B, Q = ring_part(), base_part(), qd_part()
    asm = R.union(B).union(Q)
    for name, wp in (('ring', R), ('base', B), ('qd', Q), ('asm', asm)):
        cq.exporters.export(wp, os.path.join(here, f'gs003_{name}.stl'), tolerance=0.05, angularTolerance=0.1)
    for name, wp in (('1-ring', R), ('2-base', B), ('3-qd-clip', Q)):
        cq.exporters.export(wp, os.path.join(here, f'SLDP-GS-003_{name}.step'))
    for name, wp in (('1-ring', R), ('2-base', B), ('3-qd-clip', qd_print(Q))):
        if name != '3-qd-clip':
            bb = wp.val().BoundingBox(); wp = wp.translate((0, 0, -bb.zmin))
        bb = wp.val().BoundingBox()
        cq.exporters.export(wp, os.path.join(here, f'SLDP-GS-003_{name}_print.stl'), tolerance=0.03, angularTolerance=0.1)
        print(f'{name}: print {bb.xlen:.1f} x {bb.ylen:.1f} x {bb.zlen:.1f} mm (z min {bb.zmin:.2f}), ~{wp.val().Volume() / 1000 * 1.24:.1f} g solid PLA')
    bb = asm.val().BoundingBox(); print(f'assembly {bb.xlen:.1f} x {bb.ylen:.1f} x {bb.zlen:.1f} mm; clamps at', [round(a, 1) for a in CLAMP_ANG])
    # interference checks
    for nm, other in (('ring', R), ('base', B)):
        print(f'QD x {nm} overlap volume: {Q.intersect(other).val().Volume():.4f} mm^3')
    qb = Q.val().BoundingBox(); print(f'QD bbox z {qb.zmin:.1f}..{qb.zmax:.1f}, angles', round(np.degrees(np.arctan2(Q.val().Center().y, Q.val().Center().x)), 2))
