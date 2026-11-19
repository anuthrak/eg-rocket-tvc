"""MG90S servo envelopes placed on the K-9 gimbal (frame of asm.assemble(): origin = gimbal point,
z = rocket axis, gimbal axis Y = inner gimbal pivot, gimbal axis X = motor tube pivot).
Dimensions: MG90S datasheet (body 22.8 x 12.2 x 22.5, tabs 32.2 at 15.9 from the base, gear dome to 28.5)
+ a 1-arm horn (pushrod hole 12 mm from the shaft). Placement from the tab-screw holes of the printed parts:
  riding servo  (on ITEM 2 inner gimbal): tab holes y=-30.7, z=-11.6/-38.6, base on the web x=-11.0, shaft +x
  fixed servo   (on ITEM 1 outer gimbal): tab holes x=-30.55, z=13.0/40.0, base on the web y=+13.7, shaft -y
"""
import numpy as np, trimesh
from asm import assemble
L, W, HB = 22.8, 12.2, 22.5           # body
TAB_L, TAB_Z, TAB_T = 32.2, 15.9, 2.5
DOME_R, DOME_H, SHAFT_OFF = 5.9, 28.5, 5.5   # shaft 5.5 from body centre toward one end
HUB_R, HUB_TOP = 3.5, 32.0
HORN_L, HORN_W, HORN_T = 15.0, 6.0, 1.6      # 1-arm horn, hole at 12
RATIO = 4.0                                  # servo deg per gimbal deg (SLDP-TVC linkage)

def servo_local(horn_deg=0.0):
    """Local frame: base at h=0 (+z local = height), length along local x (shaft at +SHAFT_OFF), width local y.
    Horn arm at neutral points along local +x (away from the body centre)."""
    parts = [trimesh.creation.box((L, W, HB), trimesh.transformations.translation_matrix((0, 0, HB / 2))),
             trimesh.creation.box((TAB_L, W, TAB_T), trimesh.transformations.translation_matrix((0, 0, TAB_Z + TAB_T / 2))),
             trimesh.creation.cylinder(DOME_R, DOME_H - HB, transform=trimesh.transformations.translation_matrix((SHAFT_OFF, 0, (HB + DOME_H) / 2))),
             trimesh.creation.cylinder(HUB_R, HUB_TOP - DOME_H, transform=trimesh.transformations.translation_matrix((SHAFT_OFF, 0, (DOME_H + HUB_TOP) / 2)))]
    horn = trimesh.creation.box((HORN_L, HORN_W, HORN_T), trimesh.transformations.translation_matrix((HORN_L / 2 - 2, 0, HUB_TOP - HORN_T / 2)))
    horn.apply_transform(trimesh.transformations.rotation_matrix(np.radians(horn_deg), (0, 0, 1), (0, 0, 0)))
    horn.apply_translation((SHAFT_OFF, 0, 0))
    return trimesh.util.concatenate(parts + [horn])

def frame(h, l, origin):
    """4x4 that maps local (x=length dir l, z=height dir h) to the gimbal frame, base centre at origin."""
    h, l = np.asarray(h, float), np.asarray(l, float); w = np.cross(h, l)
    M = np.eye(4); M[:3, 0], M[:3, 1], M[:3, 2], M[:3, 3] = l, w, h, origin
    return M

# riding servo: height +x, shaft end toward -z (horn toward the tube lug at z=-42), centre z between tab holes
RIDE = frame((1, 0, 0), (0, 0, -1), (-11.0, -30.7, (-11.6 - 38.6) / 2))
# fixed servo: height -y, shaft end toward +z (horn toward the inner-gimbal tower at z=41)
FIX = frame((0, -1, 0), (0, 0, 1), (-30.55, 13.7, (13.0 + 40.0) / 2))

def Ry(deg): return trimesh.transformations.rotation_matrix(np.radians(deg), (0, 1, 0))
def Rx(deg): return trimesh.transformations.rotation_matrix(np.radians(deg), (1, 0, 0))

def assemble_servos(ay=0.0, ax=0.0):
    """Gimbal deflected ay about axis Y (inner gimbal + everything on it) and ax about axis X (motor tube).
    Returns outer, inner, tube, fixed servo, riding servo meshes."""
    o, i, t = assemble()
    sf = servo_local(-RATIO * ay); sf.apply_transform(FIX)          # fixed servo horn turns with axis Y command
    sr = servo_local(RATIO * ax); sr.apply_transform(RIDE)          # riding servo horn turns with axis X command
    t.apply_transform(Rx(ax))
    for m in (i, t, sr): m.apply_transform(Ry(ay))
    return o, i, t, sf, sr

if __name__ == '__main__':
    o, i, t, sf, sr = assemble_servos()
    for n, m in (('fixed', sf), ('riding', sr)):
        v = m.vertices; r = np.hypot(v[:, 0], v[:, 1])
        print(n, v.min(0).round(1), v.max(0).round(1), 'r max', r.max().round(2))
