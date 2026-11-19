"""
SLDP-GS-001  Desk rig: 2-axis gimbal (nested rings) that holds the SLDP-ST-008 rocket by its CG, cantilevered off the
desk edge on an arm, so the TVC can be tested in closed loop with the rocket free in pitch + yaw and roll locked.

RIG FRAME (all coordinates here): origin = pivot point (both gimbal axes cross here), z up along the rocket axis at
neutral, +x = rocket 0 deg (= TVC gimbal axis X), +y = rocket 90 deg (avionics bay door side). Rocket tail z = -P_Z.
Desk top at z = -DESK_H, desk edge at x = -REACH (the arm runs along -x onto the desk).

Load path / kinematics (from the rocket outwards):
  COLLAR (2 halves, item 1)  bolted to the rocket through the existing B lower joint-screw holes at 90/270 deg
                             (z 215 from the tail; M3 x 10 replace the M3 x 6). Stays below z 238 (door frame).
  PIVOT TAB (x2, item 2)     at 0/180 deg on pads of the collar, slotted +/-ADJ for the pivot height (set it on the
                             measured CG). Carries the INNER pivot (axis x) and a stop peg.
  MIDDLE RING (item 3)       inner bosses at +/-x (inner pivots, stop slots), outer bosses at +/-y (outer pivots, pegs).
  OUTER RING (item 4)        bosses at +/-y (outer pivots, stop slots) + arm stub with a bolted flange at -x.
  ARM (item 5)               box beam to the desk, flange at the ring end.
  BASE (item 6)              block on the desk, 2 C-clamps; the arm bolts on top.
Pivots: no bearings -- M3 x 25 through-bolts in loose dia 3.4 holes, a washer between the parts, a nylon lock nut set
just to take out the play (the screw is the axle). Stops: a dia 4 peg on the moving part runs in a +/-30 deg arc slot in
the fixed part, on every pivot.
"""
import os, numpy as np, cadquery as cq

# ---------------- interface (SLDP-GA-004 / ST-008) ----------------
P_Z     = 247.0          # pivot height above the rocket tail = estimated CG (adjustable +/-ADJ at the tabs)
ADJ     = 5.0
REACH   = 220.0          # desk edge to rocket axis (>= 210)
DESK_H  = 40.0           # pivot above the desk top
RO      = 39.3           # rocket body radius (OD 78.6)
JOINT_Z = 215.0          # B lower joint screws (90/270 deg), from the tail
SLED_SCREW_Z = 232.0     # sled screws at 0/180 deg (heads stand ~1.7 proud) -- the collar stays below, the tab clears them
DOOR_Z0 = 238.0          # door frame bottom: no full ring above this

# ---------------- parts ----------------
COL_Z   = (205.0, 225.0)          # collar band (from the tail)
COL_T   = 2.9                     # collar wall
COL_CLR = 0.1                     # radial clearance on the body
PAD_R, PAD_W = 47.3, 9.0          # tab pads at 0/180: out to r, half-width each side of the split
TAB_T, TAB_W, TAB_TOP = 3.5, 16.0, 13.0      # tab thickness, width, top above the pin
TAB_BOLT_Y = 4.5                  # tab bolts (one per collar half) at y = +/-
GAP     = 1.0                     # washer gap at every pivot
MR      = (62.0, 68.0, 10.0)      # middle ring r in, r out, height
OR      = (75.0, 83.0, 10.0)      # outer ring r in, r out, height
BOSS_Z  = (-5.0, 12.0)            # pivot bosses z range: flush with the ring bottoms (print flat, no supports)
PEG_D, PEG_L, PEG_R = 4.0, 2.8, 8.0      # stop peg dia, length, offset above the pin axis
SLOT_W, SLOT_D, STOP = 5.0, 2.5, 30.0    # stop slot width, depth, hard stop angle
HOLE    = 3.4                     # pivot / clearance hole
ARM_W, ARM_Z = 24.0, (-5.0, 25.0) # arm box: width, z range
FL      = (-115.0, 5.0)           # flange joint plane x, flange thickness (each side)
FL_W, FL_Z = 40.0, (-5.0, 30.0)
BASE_X  = (-305.0, -230.0)        # base on the desk (front 10 behind the desk edge)
BASE_W  = 70.0

r_in = RO + COL_CLR; r_col = r_in + COL_T
x_tab0 = PAD_R; x_tab1 = PAD_R + TAB_T                      # tab radial faces
x_mb = x_tab1 + GAP                                         # middle-ring inner boss face
y_mb = 74.0                                                 # middle-ring outer boss face (outer ring flat at y_mb + GAP)
zc = lambda zt: zt - P_Z                                    # tail z -> rig z

def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane('XY').box(x1 - x0, y1 - y0, z1 - z0, centered=False).translate((x0, y0, z0))

def annulus(r0, r1, z0, z1):
    return cq.Workplane('XY').workplane(offset=z0).circle(r1).circle(r0).extrude(z1 - z0)

def cyl_x(r, x0, x1, y, z):
    return cq.Workplane('YZ').workplane(offset=x0).center(y, z).circle(r).extrude(x1 - x0)

def cyl_y(r, y0, y1, x, z):
    return cq.Workplane('XZ').workplane(offset=-y1).center(x, z).circle(r).extrude(y1 - y0)

def arc_slot_x(face_x, depth, sign=1):
    """Stop slot on a plane x = face_x (going +sign*x into the part): circle-swept arc, radius PEG_R about the
    x axis, centred on +z, the peg (dia PEG_D) stops at +/-STOP."""
    half = STOP - np.degrees((SLOT_W - PEG_D) / 2 / PEG_R)     # slot centreline half-angle so the peg stops at STOP
    s = None
    for a in np.linspace(-half, half, 25):
        y, z = -PEG_R * np.sin(np.radians(a)), PEG_R * np.cos(np.radians(a))
        x0 = face_x if sign > 0 else face_x - depth
        c = cyl_x(SLOT_W / 2, x0 - 0.01, x0 + depth + 0.01, y, z)
        s = c if s is None else s.union(c)
    return s

def arc_slot_y(face_y, depth):
    half = STOP - np.degrees((SLOT_W - PEG_D) / 2 / PEG_R)
    s = None
    for a in np.linspace(-half, half, 25):
        x, z = PEG_R * np.sin(np.radians(a)), PEG_R * np.cos(np.radians(a))
        c = cyl_y(SLOT_W / 2, face_y - 0.01, face_y + depth + 0.01, x, z)
        s = c if s is None else s.union(c)
    return s

# ---------------- item 1: collar half (+y half; the -y half is the same part turned 180 deg) ----------------
def collar_half():
    z0, z1 = zc(COL_Z[0]), zc(COL_Z[1])
    ring = annulus(r_in, r_col, z0, z1)
    for sx in (1, -1):                                       # pads at 0 and 180 deg
        x0, x1 = (r_in + 1, PAD_R) if sx > 0 else (-PAD_R, -r_in - 1)
        ring = ring.union(box(x0, x1, -PAD_W, PAD_W, z0, z1))
    ring = ring.cut(cq.Workplane('XY').workplane(offset=z0 - 1).circle(r_in).extrude(z1 - z0 + 2))
    half = ring.intersect(box(-60, 60, 0, 60, z0 - 1, z1 + 1))
    zb = zc(JOINT_Z)
    half = half.cut(cyl_y(HOLE / 2, r_in - 2, r_col + 2, 0, zb))                    # joint screw at 90 deg
    for sx in (1, -1):                                                              # tab bolt + nut trap per pad
        xa = sx * (PAD_R - 0.01)
        half = half.cut(cyl_x(HOLE / 2, min(sx * (r_in + 3.0), xa), max(sx * (r_in + 3.0), xa) + 0.01, TAB_BOLT_Y, zb))
        xn0 = r_in + 3.6                                                            # nut 2.6 thick, 5.7 a/f
        nx0, nx1 = (xn0, xn0 + 2.7) if sx > 0 else (-xn0 - 2.7, -xn0)
        half = half.cut(box(nx0, nx1, TAB_BOLT_Y - 2.9, TAB_BOLT_Y + 2.9, zb - 3.3, z1 + 1))
    return half

# ---------------- item 2: pivot tab (at +x; the -x one is the same part turned 180 deg) ----------------
def pivot_tab():
    z0, z1 = zc(COL_Z[0]) - 0.0, TAB_TOP
    t = box(x_tab0, x_tab1, -TAB_W / 2, TAB_W / 2, z0, z1)
    t = t.cut(cyl_x(HOLE / 2, x_tab0 - 1, x_tab1 + 1, 0, 0))                       # inner pivot
    zb = zc(JOINT_Z)
    for y in (TAB_BOLT_Y, -TAB_BOLT_Y):                                             # +/-ADJ slots
        t = t.cut(cq.Workplane('YZ').workplane(offset=x_tab0 - 1).center(y, zb).slot2D(2 * ADJ + HOLE, HOLE, 90).extrude(TAB_T + 2))
    t = t.union(cyl_x(PEG_D / 2, x_tab1 - 0.01, x_tab1 + PEG_L, 0, PEG_R))            # stop peg
    return t

# ---------------- item 3: middle ring ----------------
def middle_ring():
    r0, r1, h = MR
    m = annulus(r0, r1, -h / 2, h / 2)
    for sx in (1, -1):                                                              # inner bosses (axis x)
        x0, x1 = (x_mb, r0 + 1) if sx > 0 else (-r0 - 1, -x_mb)
        m = m.union(box(x0, x1, -8, 8, *BOSS_Z))
    for sy in (1, -1):                                                              # outer bosses (axis y)
        y0, y1 = (r1 - 1, y_mb) if sy > 0 else (-y_mb, -r1 + 1)
        m = m.union(box(-8, 8, y0, y1, *BOSS_Z))
    m = m.cut(cyl_x(HOLE / 2, -r1 - 1, r1 + 1, 0, 0))                                # pivot holes
    m = m.cut(cyl_y(HOLE / 2, -y_mb - 1, y_mb + 1, 0, 0))
    m = m.cut(arc_slot_x(x_mb, SLOT_D, 1))                                          # stop slots for the tab pegs
    m = m.cut(arc_slot_x(x_mb, SLOT_D, 1).rotate((0, 0, 0), (0, 0, 1), 180))
    for sy in (1, -1):                                                              # pegs for the outer stops
        p = cyl_y(PEG_D / 2, y_mb - 0.01, y_mb + PEG_L, 0, PEG_R)
        m = m.union(p if sy > 0 else p.rotate((0, 0, 0), (0, 0, 1), 180))
    return m

# ---------------- item 4: outer ring + arm stub ----------------
def outer_ring():
    r0, r1, h = OR
    yf = y_mb + GAP                                                                 # flat pivot face
    o = annulus(r0, r1, -h / 2, h / 2)
    for sy in (1, -1):
        y0, y1 = (yf, r1) if sy > 0 else (-r1, -yf)
        o = o.union(box(-18, 18, y0, y1, *BOSS_Z))
        c0, c1 = (yf - 6, yf) if sy > 0 else (-yf, -yf + 6)
        o = o.cut(box(-18, 18, c0, c1, BOSS_Z[0] - 1, BOSS_Z[1] + 1))             # flat for the middle-ring boss sweep
    o = o.cut(cyl_y(HOLE / 2, -r1 - 1, r1 + 1, 0, 0))
    s = arc_slot_y(yf, SLOT_D); o = o.cut(s).cut(s.rotate((0, 0, 0), (0, 0, 1), 180))
    # arm stub along -x with the flange
    xs = -np.sqrt(r1 ** 2 - (ARM_W / 2) ** 2) + 2
    o = o.union(box(FL[0], xs, -ARM_W / 2, ARM_W / 2, ARM_Z[0], ARM_Z[1]))
    o = o.union(box(FL[0], FL[0] + FL[1], -FL_W / 2, FL_W / 2, FL_Z[0], FL_Z[1]))
    o = o.cut(annulus(0, r0, -h / 2 - 1, ARM_Z[1] + 1))                              # keep the ring bore clear
    for y in (-14, 14):
        for z in (0, 22):
            o = o.cut(cyl_x(HOLE / 2, FL[0] - 1, FL[0] + FL[1] + 1, y, z))
    return o

# ---------------- item 5: arm ----------------
def arm():
    x0, x1 = BASE_X[0], FL[0]
    a = box(x0, x1, -ARM_W / 2, ARM_W / 2, ARM_Z[0], ARM_Z[1])
    a = a.union(box(x1 - FL[1], x1, -FL_W / 2, FL_W / 2, FL_Z[0], FL_Z[1]))
    for y in (-14, 14):
        for z in (0, 22):
            a = a.cut(cyl_x(HOLE / 2, x1 - FL[1] - 1, x1 + 1, y, z))
    for x in (BASE_X[0] + 18, BASE_X[1] - 18):                                      # 2 bolts into the base
        a = a.cut(cq.Workplane('XY').workplane(offset=ARM_Z[0] - 1).center(x, 0).circle(HOLE / 2).extrude(ARM_Z[1] - ARM_Z[0] + 2))
    return a

# ---------------- item 6: base ----------------
def base():
    z0, z1 = -DESK_H, ARM_Z[0]
    b = box(BASE_X[0], BASE_X[1], -BASE_W / 2, BASE_W / 2, z0, z1)
    b = b.cut(box(BASE_X[0] - 1, BASE_X[1] + 1, -BASE_W / 2 - 1, -BASE_W / 2 + 14, z0 + 8, z1 + 1))   # clamp ledges
    b = b.cut(box(BASE_X[0] - 1, BASE_X[1] + 1, BASE_W / 2 - 14, BASE_W / 2 + 1, z0 + 8, z1 + 1))
    for x in (BASE_X[0] + 18, BASE_X[1] - 18):
        b = b.cut(cq.Workplane('XY').workplane(offset=z1 - 15).center(x, 0).circle(HOLE / 2).extrude(16))
        b = b.cut(box(x - 2.9, x + 2.9, -ARM_W / 2 - 1, 2.9, z1 - 8.5, z1 - 5.8))            # nut trap from the side (M3x40 reaches through it)
    return b

def hardware():
    """Simple solids for the clearance check: pivot screw heads / nylon lock nuts, collar + tab screw heads."""
    hw = {}
    rh, hh, rn, hn = 2.85, 1.65, 3.2, 2.4
    # inner pivots: head inside the tab (rocket side), nut outside the middle ring
    hw['rocket'] = [cyl_x(rh, x_tab0 - hh, x_tab0, 0, 0), cyl_x(rh, -x_tab0, -x_tab0 + hh, 0, 0),
                    cyl_y(rh, r_col, r_col + hh, 0, zc(JOINT_Z)), cyl_y(rh, -r_col - hh, -r_col, 0, zc(JOINT_Z))]
    for sx in (1, -1):
        for y in (TAB_BOLT_Y, -TAB_BOLT_Y):
            hw['rocket'].append(cyl_x(rh, x_tab1, x_tab1 + hh, y, zc(JOINT_Z)) if sx > 0 else cyl_x(rh, -x_tab1 - hh, -x_tab1, y, zc(JOINT_Z)))
    hw['middle'] = [cyl_x(rn, MR[1] + 0.5, MR[1] + 0.5 + hn, 0, 0), cyl_x(rn, -MR[1] - 0.5 - hn, -MR[1] - 0.5, 0, 0),
                    cyl_y(rh, MR[0] - hh, MR[0], 0, 0), cyl_y(rh, -MR[0], -MR[0] + hh, 0, 0)]
    hw['outer'] = [cyl_y(rn, OR[1] + 0.5, OR[1] + 0.5 + hn, 0, 0), cyl_y(rn, -OR[1] - 0.5 - hn, -OR[1] - 0.5, 0, 0)]
    return hw

def parts():
    ch = collar_half(); tab = pivot_tab()
    return {'1_collar_half_a': ch, '1_collar_half_b': ch.rotate((0, 0, 0), (0, 0, 1), 180),
            '2_pivot_tab_a': tab, '2_pivot_tab_b': tab.rotate((0, 0, 0), (0, 0, 1), 180),
            '3_middle_ring': middle_ring(), '4_outer_ring': outer_ring(), '5_arm': arm(), '6_base': base()}

PRINT = {  # part -> rotation to lay it flat for printing (axis, deg), notes
    '1_collar_half_a': (None, 'collar band on the bed, no supports'),
    '2_pivot_tab_a': (((0, 1, 0), -90), 'flat (largest face) on the bed, peg up'),
    '3_middle_ring': (None, 'flat on the bed; bosses need no supports (vertical walls)'),
    '4_outer_ring': (None, 'flat on the bed'),
    '5_arm': (None, 'flat on the bed, 4 walls, 40% infill'),
    '6_base': (None, 'flat on the bed'),
}

FILE_NAMES = {'1_collar_half_a': '1-collar-half_x2', '2_pivot_tab_a': '2-pivot-tab_x2', '3_middle_ring': '3-middle-ring',
              '4_outer_ring': '4-outer-ring', '5_arm': '5-arm', '6_base': '6-base'}

if __name__ == '__main__':
    here = os.path.dirname(os.path.abspath(__file__))
    P = parts()
    for k, wp in P.items():
        cq.exporters.export(wp, os.path.join(here, f'gs001_{k}.stl'), tolerance=0.05, angularTolerance=0.1)
    asm = None
    for k, wp in P.items(): asm = wp if asm is None else asm.union(wp)
    cq.exporters.export(asm, os.path.join(here, 'gs001_asm.stl'), tolerance=0.05, angularTolerance=0.1)
    for k, (rot, note) in PRINT.items():
        wp = P[k]
        if rot: wp = wp.rotate((0, 0, 0), rot[0], rot[1])
        bb = wp.val().BoundingBox(); wp = wp.translate((-bb.center.x, -bb.center.y, -bb.zmin)); bb = wp.val().BoundingBox()
        nm = FILE_NAMES[k]
        cq.exporters.export(P[k], os.path.join(here, f'SLDP-GS-001_{nm}.step'))
        cq.exporters.export(wp, os.path.join(here, f'SLDP-GS-001_{nm}_print.stl'), tolerance=0.03, angularTolerance=0.1)
        print(f'{k}: {bb.xlen:.0f} x {bb.ylen:.0f} x {bb.zlen:.0f} mm, ~{P[k].val().Volume() / 1000 * 1.24:.0f} g solid  ({note})')
    hw = hardware()
    for g, L in hw.items():
        u = None
        for s in L: u = s if u is None else u.union(s)
        cq.exporters.export(u, os.path.join(here, f'gs001_hw_{g}.stl'), tolerance=0.05, angularTolerance=0.1)
    print('pivot at', P_Z, 'from the tail; collar z', COL_Z, '; tab adj +/-', ADJ)
