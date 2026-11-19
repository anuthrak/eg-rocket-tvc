"""Shaded colour render of the SLDP-ST-008 rocket seated on the SLDP-GS-003 launch mount (for the cover sheet).
Orthographic camera, painter's algorithm with back-face culling, per-face Lambert + Blinn-Phong lighting.
Rocket and mount share coordinates: z = rocket axis, 0 = tail = mount seat; angles from +x (gimbal axis X)."""
import os, numpy as np, trimesh
from matplotlib.collections import PolyCollection

here = os.path.dirname(os.path.abspath(__file__))
P_ = lambda n: os.path.join(here, n)

# finish palette: (base RGB, ambient, diffuse, specular, shininess)
STAINLESS = (np.array([0.84, 0.86, 0.89]), 0.42, 0.50, 0.65, 10)     # booster A, B, C1, C2 + door
SHIP      = (np.array([0.11, 0.11, 0.12]), 0.60, 0.55, 0.28, 18)     # ship D, nose E, grid fins
MATTE_BLK = (np.array([0.06, 0.06, 0.06]), 0.70, 0.40, 0.05, 8)      # C2 pockets (painted matte black), QD clip
MOUNT     = (np.array([0.58, 0.60, 0.62]), 0.40, 0.60, 0.12, 10)     # launch mount ring + base (grey PLA)
TVC_C     = (np.array([0.22, 0.22, 0.24]), 0.50, 0.55, 0.20, 16)     # motor tube / gimbal seen below the tail

def _T(m, v=(0, 0, 0), rz=0.0):
    g = m.copy()
    if rz: g.apply_transform(trimesh.transformations.rotation_matrix(np.radians(rz), [0, 0, 1]))
    g.apply_translation(v); return g

def scene():
    """[(mesh, palette or per-face palette function)] in rocket / mount coordinates."""
    import body_model as BM
    from servos import assemble_servos
    L = lambda n: trimesh.load(P_(n + '.stl'))
    items = []
    for n in ('A_lower_body', 'B_avionics_bay', 'C1_coupler', 'G_bay_door'): items.append((L(n), STAINLESS))
    c2 = L('C2_interstage_coupler')                                   # pocket faces -> matte black
    tc = c2.triangles_center; r = np.hypot(tc[:, 0], tc[:, 1])
    pocket = (r < BM.RO - 0.05) & (r > BM.RO - BM.HS_D - 0.05) & (tc[:, 2] > BM.Z_BT + 0.05) & (tc[:, 2] < BM.Z_S2 - 0.05)
    items.append((c2, np.where(pocket, 1, 0), (STAINLESS, MATTE_BLK)))
    for n in ('D_upper_body', 'E_nose_cone'): items.append((L(n), SHIP))
    gf = L('H_grid_fin_x4')
    for k in range(4): items.append((_T(gf, rz=90 * k), SHIP))
    for m in assemble_servos(0, 0)[:3]: items.append((_T(m, (0, 0, BM.GIMBAL_Z)), TVC_C))   # outer, inner, tube
    items.append((L('gs003_ring'), MOUNT)); items.append((L('gs003_base'), MOUNT)); items.append((L('gs003_qd'), MATTE_BLK))
    return items

FLAT = {'stainless': '#d9dde2', 'ship': '#262628', 'matte': '#1c1c1c', 'mount': '#a9acb0', 'tvc': '#5a5c60'}
_FLAT_OF = lambda pal: ({id(STAINLESS): 'stainless', id(SHIP): 'ship', id(MATTE_BLK): 'matte', id(MOUNT): 'mount', id(TVC_C): 'tvc'})[id(pal)]

def illustrate(ax, items, az=50.0, el=16.0, scale=0.25, origin=(0, 0), ref=(0, 0, 0), lw=0.75, line_dark='black',
               line_light='#9a9a9a', rasterized=True):
    """Technical-illustration style: flat part colours (painter's algorithm, no lighting) + hidden-line-removed
    black outlines on top (light grey outlines on the black parts). Returns the 3D -> sheet mapping."""
    import hlr
    from matplotlib.collections import LineCollection
    a, e = np.radians(az), np.radians(el)
    cam = np.array([np.cos(e) * np.cos(a), np.cos(e) * np.sin(a), np.sin(e)]); d = -cam
    _, rgt, u = hlr.basis(d, (0, 0, 1))
    ref = np.asarray(ref, float); O = np.asarray(origin, float)
    polys, cols, depth = [], [], []
    for it in items:
        m = it[0]; vis = m.face_normals @ cam > 1e-6
        if len(it) == 2: names = np.array([_FLAT_OF(it[1])] * len(m.faces))
        else: names = np.array([_FLAT_OF(p) for p in it[2]])[it[1]]
        tri = m.triangles[vis]
        polys.append(np.stack([(tri - ref) @ rgt, (tri - ref) @ u], -1) * scale + O)
        cols.append([FLAT[n] for n in names[vis]]); depth.append(tri.mean(1) @ cam)
    polys = np.concatenate(polys); cols = np.concatenate(cols); order = np.argsort(np.concatenate(depth))
    pc = PolyCollection(polys[order], facecolors=cols[order], edgecolors=cols[order], linewidths=0.35, zorder=2,
                        antialiaseds=False)          # no seams between sub-pixel slivers (outlines stay antialiased)
    pc.set_rasterized(rasterized); ax.add_collection(pc)
    lines, _, _ = hlr.view_lines([it[0] for it in items], d, (0, 0, 1))
    off = O - scale * np.array([ref @ rgt, ref @ u])
    for k, ls in lines.items():
        it = items[k]
        dark_part = (len(it) == 2 and _FLAT_OF(it[1]) in ('ship', 'matte'))
        ax.add_collection(LineCollection([off + scale * l for l in ls], colors=line_light if dark_part else line_dark,
                                         linewidths=lw, capstyle='round', joinstyle='round', zorder=3))
    return lambda p: (np.asarray(p, float) - ref) @ np.stack([rgt, u], 1) * scale + O

def render(ax, items, az=62.0, el=16.0, scale=0.25, origin=(0, 0), ref=(0, 0, 0), light=(-0.55, 0.35, 0.75), rasterized=True):
    """Draw on ax (sheet mm). az: camera azimuth from +x (deg, CCW from above), el: elevation (deg).
    ref (model point) is placed at origin (sheet mm). Returns the 3D -> sheet mapping."""
    a, e = np.radians(az), np.radians(el)
    cam = np.array([np.cos(e) * np.cos(a), np.cos(e) * np.sin(a), np.sin(e)])      # toward the camera
    d = -cam; up = np.array([0, 0, 1.0])
    rgt = np.cross(d, up); rgt /= np.linalg.norm(rgt); u = np.cross(rgt, d)
    Lw = np.asarray(light, float); Lw /= np.linalg.norm(Lw)
    # light given in camera space (x right, y up, z toward the camera) -> world
    Lw = Lw[0] * rgt + Lw[1] * u + Lw[2] * cam; Lw /= np.linalg.norm(Lw)
    H = (Lw + cam); H /= np.linalg.norm(H)
    ref = np.asarray(ref, float); O = np.asarray(origin, float)
    polys, cols, depth = [], [], []
    for it in items:
        m = it[0]
        n = m.face_normals; vis = n @ cam > 1e-6                                     # back-face culling
        if len(it) == 2: pal = [it[1]]; idx = np.zeros(len(m.faces), int)
        else: idx, pal = it[1], it[2]
        tri = m.triangles[vis]; nn = n[vis]; ii = idx[vis]
        base = np.array([p[0] for p in pal])[ii]; amb = np.array([p[1] for p in pal])[ii]
        dif = np.array([p[2] for p in pal])[ii]; spc = np.array([p[3] for p in pal])[ii]; shn = np.array([p[4] for p in pal])[ii]
        lam = np.clip(nn @ Lw, 0, 1); sky = 0.5 + 0.5 * nn[:, 2]                     # soft sky term: up-facing faces brighter
        spec = np.clip(nn @ H, 0, 1) ** shn
        c = base * (amb * (0.75 + 0.25 * sky) + dif * lam)[:, None] + (spc * spec)[:, None]
        c = np.clip(c, 0, 1)
        p2 = np.stack([(tri - ref) @ rgt, (tri - ref) @ u], -1) * scale + O
        polys.append(p2); cols.append(c); depth.append(tri.mean(1) @ cam)
    polys = np.concatenate(polys); cols = np.concatenate(cols); depth = np.concatenate(depth)
    order = np.argsort(depth)                                                        # far first
    pc = PolyCollection(polys[order], facecolors=cols[order], edgecolors=cols[order], linewidths=0.05, zorder=2)
    pc.set_rasterized(rasterized); ax.add_collection(pc)
    return lambda p: (np.asarray(p, float) - ref) @ np.stack([rgt, u], 1) * scale + O

if __name__ == '__main__':
    import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt, time
    t = time.time(); items = scene()
    fig = plt.figure(figsize=(4, 8), dpi=200); ax = fig.add_axes([0, 0, 1, 1]); ax.set_xlim(-60, 60); ax.set_ylim(-40, 200); ax.set_aspect('equal'); ax.axis('off')
    render(ax, items, scale=0.25, ref=(0, 0, 0))
    fig.savefig(P_('render_test.png'), dpi=200, facecolor='white'); print('ok %.1fs' % (time.time() - t))
