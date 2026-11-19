"""Hidden-line-removed line views of STL meshes (orthographic).
Edges drawn = sharp feature edges (dihedral > SHARP deg) + silhouette edges + open boundaries.
Visibility = per-sample depth test against a z-buffer of all meshes.

v2 (2026-11-07): same algorithm and identical output to v1, much faster.
  * z-buffer: compiled with Numba when it is installed (pip install numba); otherwise a vectorised NumPy
    fallback (batched small triangles + scanline spans for large ones).
  * edges: all edges sampled and depth-tested in one vectorised pass instead of one Python loop per edge."""
import numpy as np
try:
    from numba import njit
except ImportError:                     # NumPy fallback below
    njit = None

SHARP = 28.0      # deg
RES = 0.08        # mm per z-buffer pixel
EPS = 0.45        # depth tolerance, mm
STEP = 0.12       # edge sampling step, mm
_CHUNK = 4e6      # max candidate pixels per rasterisation batch (memory bound)
_BIG = 4096       # triangles with a bigger pixel bbox are rasterised one at a time

def basis(d, up=(0, 0, 1)):
    d = np.asarray(d, float); d /= np.linalg.norm(d)
    up = np.asarray(up, float)
    if abs(np.dot(d, up)) > 0.999: up = np.array([0, 1.0, 0])
    r = np.cross(d, up); r /= np.linalg.norm(r); u = np.cross(r, d)
    return d, r, u

if njit is not None:
    @njit(cache=True)
    def _zb_kernel(px, py, z, W, H):
        zb = np.full((H, W), np.inf)
        for k in range(px.shape[0]):
            ax, bx, cx = px[k, 0], px[k, 1], px[k, 2]; ay, by, cy = py[k, 0], py[k, 1], py[k, 2]
            i0 = max(int(np.floor(min(ax, bx, cx))), 0); i1 = min(int(np.ceil(max(ax, bx, cx))), W - 1)
            j0 = max(int(np.floor(min(ay, by, cy))), 0); j1 = min(int(np.ceil(max(ay, by, cy))), H - 1)
            if i1 < i0 or j1 < j0: continue
            den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
            if abs(den) < 1e-12: continue
            for j in range(j0, j1 + 1):
                J = j + 0.5
                for i in range(i0, i1 + 1):
                    I = i + 0.5
                    l1 = ((by - cy) * (I - cx) + (cx - bx) * (J - cy)) / den
                    l2 = ((cy - ay) * (I - cx) + (ax - cx) * (J - cy)) / den
                    l3 = 1 - l1 - l2
                    if l1 >= -1e-6 and l2 >= -1e-6 and l3 >= -1e-6:
                        zz = l1 * z[k, 0] + l2 * z[k, 1] + l3 * z[k, 2]
                        if zz < zb[j, i]: zb[j, i] = zz
        return zb

def _zbuffer(tris2, depth3, x0, y0, W, H):
    if njit is not None:
        px = np.ascontiguousarray((tris2[:, :, 0] - x0) / RES); py = np.ascontiguousarray((tris2[:, :, 1] - y0) / RES)
        return _zb_kernel(px, py, np.ascontiguousarray(depth3, dtype=np.float64), W, H)
    return _zbuffer_np(tris2, depth3, x0, y0, W, H)

def _zbuffer_np(tris2, depth3, x0, y0, W, H):
    """Rasterise all triangles (n,3,2 screen mm; n,3 depth) into a min-depth buffer (H, W).
    Pixel centres at +0.5, barycentric inclusion with -1e-6 slack -- identical rule to v1."""
    zb = np.full(H * W, np.inf)
    px = (tris2[:, :, 0] - x0) / RES; py = (tris2[:, :, 1] - y0) / RES
    i0 = np.maximum(np.floor(px.min(1)).astype(int), 0); i1 = np.minimum(np.ceil(px.max(1)).astype(int), W - 1)
    j0 = np.maximum(np.floor(py.min(1)).astype(int), 0); j1 = np.minimum(np.ceil(py.max(1)).astype(int), H - 1)
    ax, bx, cx = px.T; ay, by, cy = py.T
    den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    ok = (i1 >= i0) & (j1 >= j0) & (np.abs(den) >= 1e-12)
    w, h = i1 - i0 + 1, j1 - j0 + 1
    big = ok & (w * h > _BIG)
    # large triangles: scanline spans (only pixels near the triangle, not its whole bbox), batched
    bt = np.flatnonzero(big)
    rows = h[bt]; rstart = np.r_[0, np.cumsum(rows)]
    per_rows = int(_CHUNK // 64)
    k0 = 0
    while k0 < len(bt):
        k1 = int(np.searchsorted(rstart, rstart[k0] + per_rows, 'right')) - 1
        k1 = max(k1, k0 + 1)
        t_ = bt[k0:k1]; n_ = rows[k0:k1]
        tr = np.repeat(t_, n_)                                            # triangle per row
        J = np.repeat(j0[t_], n_) + (np.arange(n_.sum()) - np.repeat(np.r_[0, np.cumsum(n_)[:-1]], n_))
        yc = J + 0.5
        lo = np.full(len(tr), np.inf); hi = np.full(len(tr), -np.inf)
        for (xa, ya, xb, yb) in ((ax, ay, bx, by), (bx, by, cx, cy), (cx, cy, ax, ay)):
            xa_, ya_, xb_, yb_ = xa[tr], ya[tr], xb[tr], yb[tr]
            dy = yb_ - ya_
            hit = ((ya_ - yc) * (yb_ - yc) <= 0) & (dy != 0)
            x = np.where(hit, xa_ + (yc - ya_) * (xb_ - xa_) / np.where(dy == 0, 1, dy), np.nan)
            lo = np.fmin(lo, np.where(hit, x, np.inf)); hi = np.fmax(hi, np.where(hit, x, -np.inf))
        has = np.isfinite(lo)                                             # rows with no crossing: whole bbox row (rare)
        s0 = np.where(has, np.ceil(lo - 0.5) - 1, i0[tr]).astype(int); s1 = np.where(has, np.floor(hi - 0.5) + 1, i1[tr]).astype(int)
        s0 = np.maximum(s0, i0[tr]); s1 = np.minimum(s1, i1[tr])
        cnt = np.maximum(s1 - s0 + 1, 0)
        tp = np.repeat(tr, cnt); Jp = np.repeat(J, cnt)
        Ip = np.repeat(s0, cnt) + (np.arange(cnt.sum()) - np.repeat(np.r_[0, np.cumsum(cnt)[:-1]], cnt))
        _raster(zb, W, tp, Ip, Jp, ax, ay, bx, by, cx, cy, den, depth3, per_pixel=True)
        k0 = k1
    # small triangles: batches of equal (2^bw x 2^bh) bbox grids
    small = np.flatnonzero(ok & ~big)
    bw = np.ceil(np.log2(w[small])).astype(int); bh = np.ceil(np.log2(h[small])).astype(int)
    key = bw * 64 + bh
    for kk in np.unique(key):
        sw, sh = 1 << int(kk // 64), 1 << int(kk % 64)
        idx = small[key == kk]
        per = max(1, int(_CHUNK // (sw * sh)))
        oi, oj = np.meshgrid(np.arange(sw), np.arange(sh)); oi, oj = oi.ravel(), oj.ravel()
        for k in range(0, len(idx), per):
            t = idx[k:k + per]
            I = i0[t, None] + oi[None]; J = j0[t, None] + oj[None]
            inb = (I <= i1[t, None]) & (J <= j1[t, None])
            _raster(zb, W, t, I, J, ax, ay, bx, by, cx, cy, den, depth3, inb)
    return zb.reshape(H, W)

def _raster(zb, W, t, I, J, ax, ay, bx, by, cx, cy, den, depth3, inb=None, per_pixel=False):
    """Depth-test candidate pixels (I, J) of triangle(s) t and keep the minimum depth in zb (flat).
    Batched: t (n,), I/J (n, k). per_pixel: t, I, J all (n,) -- one triangle index per pixel."""
    sl = (lambda v: v[t]) if per_pixel else (lambda v: v[t, None])
    Ic, Jc = I + 0.5, J + 0.5
    ax_, ay_, bx_, by_, cx_, cy_, dn = (sl(v) for v in (ax, ay, bx, by, cx, cy, den))
    l1 = ((by_ - cy_) * (Ic - cx_) + (cx_ - bx_) * (Jc - cy_)) / dn
    l2 = ((cy_ - ay_) * (Ic - cx_) + (ax_ - cx_) * (Jc - cy_)) / dn
    l3 = 1 - l1 - l2
    m = (l1 >= -1e-6) & (l2 >= -1e-6) & (l3 >= -1e-6)
    if inb is not None: m &= inb
    if not m.any(): return
    z = depth3[t]
    if per_pixel: zz = (l1 * z[:, 0] + l2 * z[:, 1] + l3 * z[:, 2])[m]
    else: zz = (l1 * z[:, 0, None] + l2 * z[:, 1, None] + l3 * z[:, 2, None])[m]
    np.minimum.at(zb, (J * W + I)[m], zz)

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

def _visible_runs(E, zb, d, r, u, x0, y0, W, H):
    """Sample every edge at STEP, depth-test against zb (3x3 neighbourhood max), return visible polylines."""
    if not len(E): return []
    a, b = E[:, 0], E[:, 1]
    n = np.maximum((np.linalg.norm(b - a, axis=1) / STEP).astype(int), 1) + 1
    eid = np.repeat(np.arange(len(E)), n)
    start = np.r_[0, np.cumsum(n)[:-1]]
    t = (np.arange(n.sum()) - np.repeat(start, n)) / np.repeat(n - 1, n)
    p3 = a[eid] + (b - a)[eid] * t[:, None]
    p2 = np.stack([p3 @ r, p3 @ u], -1); dep = p3 @ d
    i = np.clip(((p2[:, 0] - x0) / RES).astype(int), 0, W - 1); j = np.clip(((p2[:, 1] - y0) / RES).astype(int), 0, H - 1)
    zmax = zb[j, i]
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            zmax = np.maximum(zmax, zb[np.clip(j + dj, 0, H - 1), np.clip(i + di, 0, W - 1)])
    vis = dep <= zmax + EPS
    # runs of visible samples within the same edge; keep runs of >= 2 samples (as v1)
    brk = np.r_[True, (eid[1:] != eid[:-1]) | (vis[1:] != vis[:-1])]
    rs = np.flatnonzero(brk); re = np.r_[rs[1:], len(vis)]
    keep = vis[rs] & (re - rs >= 2)
    return [p2[s0:s1] for s0, s1 in zip(rs[keep], re[keep])]

def view_lines(meshes, d, up=(0, 0, 1), pad=3.0):
    """Returns dict per mesh index -> list of (k,2) polylines in screen mm (r, u), plus frame extents."""
    d, r, u = basis(d, up)
    P = lambda v: np.stack([v @ r, v @ u], -1)
    allv = np.vstack([m.vertices for m in meshes]); s = P(allv)
    x0, y0 = s.min(0) - pad; x1, y1 = s.max(0) + pad
    W, H = int((x1 - x0) / RES) + 1, int((y1 - y0) / RES) + 1
    tris = np.concatenate([m.triangles for m in meshes])
    zb = _zbuffer(P(tris), tris @ d, x0, y0, W, H)
    out = {k: _visible_runs(feature_edges(m, d), zb, d, r, u, x0, y0, W, H) for k, m in enumerate(meshes)}
    return out, (x0, y0, x1, y1), (r, u)
