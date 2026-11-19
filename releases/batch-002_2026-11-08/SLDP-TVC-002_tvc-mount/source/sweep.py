"""Sweep both gimbal axes and report where the servos / horns / tube leave the R38.1 bore."""
import numpy as np
from servos import assemble_servos
BORE = 38.1
def sweep(lim=10.0, n=9, margin=1.0):
    pts = []
    A = np.linspace(-lim, lim, n)
    for ay in A:
        for ax in A:
            ms = assemble_servos(ay, ax)
            for k, m in enumerate(ms):
                v = np.vstack([m.vertices, m.sample(30000 if k >= 3 else 20000)])
                r = np.hypot(v[:, 0], v[:, 1]); sel = r > BORE - margin
                for p in v[sel]: pts.append((k, *p, ay, ax))
    return np.array(pts)
if __name__ == '__main__':
    import sys
    lim = float(sys.argv[1]) if len(sys.argv) > 1 else 10
    P = sweep(lim)
    names = ['outer', 'inner', 'tube', 'fixed servo', 'riding servo']
    for k in range(5):
        Q = P[P[:, 0] == k]
        if not len(Q): print(names[k], 'inside'); continue
        ang = np.degrees(np.arctan2(Q[:, 2], Q[:, 1])) % 360
        r = np.hypot(Q[:, 1], Q[:, 2])
        print(f'{names[k]:13s} n={len(Q):6d} ang {ang.min():6.1f}..{ang.max():6.1f}  z {Q[:,3].min():6.1f}..{Q[:,3].max():6.1f}  r max {r.max():.2f}')
