"""Hidden-line-removed line views of STL meshes (orthographic).
Edges drawn = sharp feature edges (dihedral > SHARP deg) + silhouette edges + open boundaries.
Visibility = per-sample depth test against a z-buffer of all meshes."""
import numpy as np

SHARP = 28.0      # deg
RES = 0.08        # mm per z-buffer pixel
EPS = 0.45        # depth tolerance, mm
STEP = 0.12       # edge sampling step, mm

def basis(d, up=(0, 0, 1)):
    d = np.asarray(d, float); d /= np.linalg.norm(d)
    up = np.asarray(up, float)
    if abs(np.dot(d, up)) > 0.999: up = np.array([0, 1.0, 0])
    r = np.cross(d, up); r /= np.linalg.norm(r); u = np.cross(r, d)
    return d, r, u

def _zbuffer(tris2, depth3, x0, y0, W, H):
    zb = np.full((H, W), np.inf)
    for t, z in zip(tris2, depth3):
        px = (t[:, 0] - x0) / RES; py = (t[:, 1] - y0) / RES
        i0, i1 = int(np.floor(px.min())), int(np.ceil(px.max())); j0, j1 = int(np.floor(py.min())), int(np.ceil(py.max()))
        i0, j0 = max(i0, 0), max(j0, 0); i1, j1 = min(i1, W - 1), min(j1, H - 1)
        if i1 < i0 or j1 < j0: continue
        (ax, ay), (bx, by), (cx, cy) = zip(px, py)
        den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(den) < 1e-12: continue
        I, J = np.meshgrid(np.arange(i0, i1 + 1) + 0.5, np.arange(j0, j1 + 1) + 0.5)
        l1 = ((by - cy) * (I - cx) + (cx - bx) * (J - cy)) / den
        l2 = ((cy - ay) * (I - cx) + (ax - cx) * (J - cy)) / den
        l3 = 1 - l1 - l2
        m = (l1 >= -1e-6) & (l2 >= -1e-6) & (l3 >= -1e-6)
        if not m.any(): continue
        zz = l1 * z[0] + l2 * z[1] + l3 * z[2]
        sub = zb[j0:j1 + 1, i0:i1 + 1]
        np.minimum(sub, np.where(m, zz, np.inf), out=sub)
    return zb

def feature_edges(mesh, d):
    """Return (n,2,3) array of candidate edges for view direction d."""
    adj = mesh.face_adjacency; ang = np.degrees(mesh.face_adjacency_angles)
    e = mesh.face_adjacency_edges
    fn = mesh.face_normals
    s1 = fn[adj[:, 0]] @ d; s2 = fn[adj[:, 1]] @ d
    f1, f2 = s1 < -1e-4, s2 < -1e-4                    # front-facing
    keep = ((ang > SHARP) & (f1 | f2 | (np.abs(s1) < 1e-4) | (np.abs(s2) < 1e-4))) | (f1 != f2)
    edges = [mesh.vertices[e[keep]]]
    # open boundary edges (non-watertight meshes)
    import trimesh
    ue = mesh.edges_sorted; grp = trimesh.grouping.group_rows(ue, require_count=1)
    if len(grp): edges.append(mesh.vertices[ue[grp]])
    return np.concatenate(edges)

def view_lines(meshes, d, up=(0, 0, 1), pad=3.0):
    """Returns dict per mesh index -> list of (k,2) polylines in screen mm (r, u), plus frame extents."""
    d, r, u = basis(d, up)
    P = lambda v: np.stack([v @ r, v @ u], -1)
    allv = np.vstack([m.vertices for m in meshes]); s = P(allv)
    x0, y0 = s.min(0) - pad; x1, y1 = s.max(0) + pad
    W, H = int((x1 - x0) / RES) + 1, int((y1 - y0) / RES) + 1
    tris = np.concatenate([m.triangles for m in meshes])
    zb = _zbuffer(P(tris), tris @ d, x0, y0, W, H)
    out = {}
    for k, m in enumerate(meshes):
        E = feature_edges(m, d); lines = []
        for a, b in E:
            L = np.linalg.norm(b - a); n = max(int(L / STEP), 1) + 1
            t = np.linspace(0, 1, n)[:, None]; p3 = a + (b - a) * t
            p2 = P(p3); dep = p3 @ d
            i = np.clip(((p2[:, 0] - x0) / RES).astype(int), 0, W - 1); j = np.clip(((p2[:, 1] - y0) / RES).astype(int), 0, H - 1)
            # neighbourhood min of depth buffer handles pixel-snapping at edges
            zmax = zb[j, i]
            for di in (-1, 0, 1):
                for dj in (-1, 0, 1):
                    zmax = np.maximum(zmax, zb[np.clip(j + dj, 0, H - 1), np.clip(i + di, 0, W - 1)])
            vis = dep <= zmax + EPS
            # run-length split into visible segments
            idx = np.flatnonzero(np.diff(np.r_[0, vis.astype(int), 0]))
            for s0, s1 in zip(idx[::2], idx[1::2]):
                if s1 - s0 >= 2: lines.append(p2[s0:s1])
        out[k] = lines
    return out, (x0, y0, x1, y1), (r, u)
