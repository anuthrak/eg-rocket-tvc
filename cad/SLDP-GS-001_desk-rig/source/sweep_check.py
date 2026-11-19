"""Clearance sweep for SLDP-GS-001: rocket group (rocket + collar + tabs) rotates Rx(a) in the middle ring, the middle
ring (+ rocket) rotates Ry(b) in the outer ring. Reports minimum clearances and where the stops engage."""
import sys, os, numpy as np, trimesh
from trimesh.collision import CollisionManager
from trimesh.transformations import rotation_matrix as Rm, translation_matrix as Tm
GA = '/home/claude/work/ga004/source'; sys.path.insert(0, GA)
import importlib.util
spec = importlib.util.spec_from_file_location('LM', 'SLDP-GS-001_desk_rig.py'); LM = importlib.util.module_from_spec(spec); spec.loader.exec_module(LM)
os.chdir(GA)
import body_model as BM
from servos import assemble_servos
os.chdir(os.path.dirname(os.path.abspath(__file__)))
L = lambda f: trimesh.load(f)
body = [L(f'{GA}/{n}.stl') for n in ('A_lower_body', 'B_avionics_bay', 'C1_coupler', 'C2_interstage_coupler', 'D_upper_body', 'E_nose_cone', 'G_bay_door')]
gf = L(f'{GA}/H_grid_fin_x4.stl')
for k in range(4): g = gf.copy(); g.apply_transform(Rm(np.radians(90 * k), [0, 0, 1])); body.append(g)
cwd = os.getcwd(); os.chdir(GA); tvc = assemble_servos(0, 0); os.chdir(cwd)
for m in tvc: m = m.copy(); m.apply_translation((0, 0, BM.GIMBAL_Z)); body.append(m)
rocket = trimesh.util.concatenate(body); rocket.apply_translation((0, 0, -LM.P_Z))         # rig frame
collar = trimesh.util.concatenate([L('gs001_1_collar_half_a.stl'), L('gs001_1_collar_half_b.stl'), L('gs001_hw_rocket.stl')])
tabs = trimesh.util.concatenate([L('gs001_2_pivot_tab_a.stl'), L('gs001_2_pivot_tab_b.stl')])
middle = trimesh.util.concatenate([L('gs001_3_middle_ring.stl'), L('gs001_hw_middle.stl')])
fixed = trimesh.util.concatenate([L('gs001_4_outer_ring.stl'), L('gs001_5_arm.stl'), L('gs001_6_base.stl'), L('gs001_hw_outer.stl')])
desk = trimesh.creation.box(extents=(800, 800, 760)); desk.apply_translation((-LM.REACH - 400, 0, -LM.DESK_H - 380))

def dist(a, Ta, b, Tb):
    cm = CollisionManager(); cm.add_object('b', b, transform=Tb)
    return cm.min_distance_single(a, transform=Ta)

I = np.eye(4)
def rocket_grp(dz):          # rocket + collar move together when the tab is adjusted (pivot moves -dz on the rocket)
    r = rocket.copy(); c = collar.copy(); r.apply_translation((0, 0, dz)); c.apply_translation((0, 0, dz))
    return trimesh.util.concatenate([r, c])
res = {}
for dz in (-LM.ADJ, 0.0, LM.ADJ):
    RG = rocket_grp(dz); RGT = trimesh.util.concatenate([RG, tabs])
    # rocket+collar vs tabs never move relative to each other; tabs + rocket vs middle ring (inner axis only)
    m_in = min(dist(RGT, Rm(np.radians(a), [1, 0, 0]), middle, I) for a in np.arange(-29, 30, 4.0))
    m_fx = 1e9; worst = None
    for a in np.arange(-29, 30, 7.25):
        for b in np.arange(-29, 30, 7.25):
            T = Rm(np.radians(b), [0, 1, 0]) @ Rm(np.radians(a), [1, 0, 0])
            d1 = dist(RGT, T, fixed, I); d2 = dist(RGT, T, desk, I)
            if min(d1, d2) < m_fx: m_fx, worst = min(d1, d2), (a, b, 'rig' if d1 < d2 else 'desk')
    res[dz] = (m_in, m_fx, worst)
    print(f'pivot shift {dz:+.0f}: rocket/collar/tabs vs middle ring min {m_in:.2f} mm; vs outer ring/arm/base/desk min {m_fx:.2f} mm at a,b={worst}')
m_mo = min(dist(middle, Rm(np.radians(b), [0, 1, 0]), fixed, I) for b in np.arange(-29, 30, 2.0))
print(f'middle ring vs outer ring/arm (outer axis, +/-29): min {m_mo:.2f} mm')
# stops: find the angle where the pegs touch
RGT = trimesh.util.concatenate([rocket_grp(0), tabs])
for name, A, B, ax in (('inner (tab peg in middle ring)', RGT, middle, [1, 0, 0]), ('outer (middle-ring peg in outer ring)', middle, fixed, [0, 1, 0])):
    for sgn in (1, -1):
        hit = None
        for a in np.arange(28.0, 36.0, 0.25):
            if dist(A, Rm(np.radians(sgn * a), ax), B, I) < 0.05: hit = a; break
        print(f'stop {name}, {"+" if sgn > 0 else "-"}: contact at {hit} deg')
