"""Assemble the K-9 TVC mount: outer gimbal fixed, inner gimbal pinned on the outer's Y holes,
motor tube pinned on the inner's X holes. Common pivot point = outer ring hole centre."""
import os, trimesh, numpy as np
import paths
P_O = np.array([9.32, 14.00, 10.50])     # outer gimbal pivot holes (Y axis Ø3 at x=9.32; X axis Ø3 at y=14.0)
P_I = np.array([13.05, -65.36, 55.95])   # inner gimbal: Y holes Ø3 at x=13.05 z=56.3, X holes Ø3.4 at y=-65.36 z=55.8
P_T = np.array([100.0, 100.0, 57.0])     # motor tube: boss holes Ø3.5 on its Y axis
def load(n): return trimesh.load(os.path.join(paths.K9, paths.K9_FILES[n]))   # n = outer / inner / tube
def Rz(deg): return trimesh.transformations.rotation_matrix(np.radians(deg), [0, 0, 1])
def T(v): return trimesh.transformations.translation_matrix(v)
def assemble(inner_rot=0, tube_rot=90):
    o = load('outer'); i = load('inner'); t = load('tube')
    i.apply_transform(T(-P_I)); i.apply_transform(Rz(inner_rot)); i.apply_transform(T(P_O))
    t.apply_transform(T(-P_T)); t.apply_transform(Rz(tube_rot)); t.apply_transform(T(P_O))
    # put the pivot at the origin for drawing
    for m in (o, i, t): m.apply_transform(T(-P_O))
    return o, i, t
