"""Charts from a System check summary CSV (visualizer → Tests → System check → Download CSV).

    python plot_system_check.py system_check_2026-11-17_2356.csv

Writes next to the CSV:
    syscheck_servo_travel.png    servo travel reached vs expected, per servo (step 4)
    syscheck_control_loop.png    controller response, gimbal ° per lean °, per axis (step 5)

The summary CSV holds the numbers inside the 'detail' text, so they are read back with regexes.
Same look as the CT-1 charts: X servo blue, Y servo orange, headline titles, direct labels.
"""
import csv
import re
import sys
from pathlib import Path

import matplotlib.pyplot as plt

X_COL, Y_COL, REF = '#2f78d8', '#ec6b35', '#444444'
GRID, MUTED = '#e2e2e2', '#666666'
SERVO_LIMIT = 45          # servo degrees either side of centre (firmware SERVO_RANGE)
KP, THRUST_REF, THRUST_MAX, GMAX = 2.5, 150.0, 220.0, 8.0   # firmware controller constants
P_GAIN = KP * THRUST_REF / THRUST_MAX                        # flight mode assumes full thrust → 1.70


def style(ax):
    for s in ('top', 'right'):
        ax.spines[s].set_visible(False)
    for s in ('left', 'bottom'):
        ax.spines[s].set_color('#555555')
    ax.tick_params(colors='#444444', labelsize=11)
    ax.set_axisbelow(True)


def read(path):
    rows = {r['name']: r for r in csv.DictReader(open(path, encoding='utf-8'))}
    num = r'(-?\d+(?:\.\d+)?)'
    servo = re.search(rf'X ±{num}° Y ±{num}° \(expected ±{num}° / ±{num}°\)', rows['Servos']['detail'])
    loop = re.search(rf'X {num} gimbal°/lean° \(r {num}\) · Y {num} gimbal°/lean° \(r {num}\)', rows['Control loop']['detail'])
    if not servo or not loop:
        sys.exit('Could not find the servo or control-loop numbers in this CSV.')
    sx, sy, ex, ey = map(float, servo.groups())
    kx, rx, ky, ry = map(float, loop.groups())
    return dict(travel={'X': sx, 'Y': sy}, expected={'X': ex, 'Y': ey}, k={'X': kx, 'Y': ky}, r={'X': rx, 'Y': ry},
                status={'servo': rows['Servos']['status'], 'loop': rows['Control loop']['status']})


def servo_travel(d, out, date):
    fig, ax = plt.subplots(figsize=(9, 3.9), dpi=200)
    style(ax)
    ys = {'X': 1, 'Y': 0}
    for ax_name, col in (('X', X_COL), ('Y', Y_COL)):
        t, e, y = d['travel'][ax_name], d['expected'][ax_name], ys[ax_name]
        ax.barh(y, 2 * t, left=-t, height=0.42, color=col, alpha=0.9, zorder=2)
        for side in (-1, 1):          # expected travel: dark tick at each end
            ax.plot([side * e, side * e], [y - 0.3, y + 0.3], color=REF, lw=2.2, zorder=3)
        pct = 100 * t / e if e else 0
        ax.text(SERVO_LIMIT + 3, y, f'{ax_name} servo: ±{t:.0f}° of ±{e:.0f}° ({pct:.0f} %)', va='center', fontsize=11.5, color='#222222')
    for side in (-1, 1):              # the servo's own limit
        ax.axvline(side * SERVO_LIMIT, color=MUTED, lw=1, ls=(0, (4, 3)), zorder=1)
    ax.text(SERVO_LIMIT - 1.5, 1.62, 'servo limit ±45°', ha='right', fontsize=9.5, color=MUTED)
    ax.set_yticks([1, 0], ['X servo (D9)', 'Y servo (D10)'], fontsize=11.5)
    ax.set_ylim(-0.6, 1.8)
    ax.set_xlim(-SERVO_LIMIT - 6, SERVO_LIMIT + 50)
    ax.set_xticks(range(-40, 41, 20))
    ax.set_xlabel('Servo angle from centre (°)', fontsize=11.5)
    ax.grid(axis='x', color=GRID)
    reached = all(d['travel'][a] >= 0.9 * d['expected'][a] for a in 'XY')
    ax.set_title('Both servos reach their full travel' if reached else 'A servo falls short of its travel',
                 loc='left', fontsize=16, pad=26)
    ax.text(0, 1.04, f'System check {date} · circle and corner sweeps', transform=ax.transAxes, fontsize=9.5, color=MUTED)
    fig.text(0.02, 0.02, 'Dark ticks = expected travel: ±8° of gimbal × the linkage ratio, capped at the servo limit.', fontsize=9, color=MUTED)
    fig.tight_layout(rect=(0, 0.05, 1, 1))
    fig.savefig(out, facecolor='white')
    plt.close(fig)


def control_loop(d, out, date):
    fig, ax = plt.subplots(figsize=(7, 5), dpi=200)
    style(ax)
    xs = [0, 1]
    for x, (a, col) in zip(xs, (('X', X_COL), ('Y', Y_COL))):
        k, r = d['k'][a], d['r'][a]
        ax.bar(x, k, width=0.5, color=col, zorder=2)
        ax.text(x, k + 0.04, f'{k:.2f}', ha='center', va='bottom', fontsize=15, color='#222222')
        ax.text(x, k / 2, f'fit r = {r:.2f}', ha='center', va='center', fontsize=10.5, color='white')
    ax.hlines(P_GAIN, -0.45, 1.3, color=REF, lw=1.8, ls=(0, (5, 4)), zorder=3)
    ax.text(1.36, P_GAIN, f'controller P gain\n{P_GAIN:.2f}', va='center', fontsize=10.5, color=REF)
    ax.set_xticks(xs, ['X axis', 'Y axis'], fontsize=12)
    ax.set_xlim(-0.45, 1.75)
    ax.set_ylim(0, 2.1)
    ax.set_ylabel('Gimbal ° per degree of lean', fontsize=11.5)
    ax.grid(axis='y', color=GRID)
    kx, ky = d['k']['X'], d['k']['Y']
    same = abs(kx - ky) / max(kx, ky) < 0.15
    ax.set_title('Both axes follow the lean equally' if same else 'The axes respond differently', loc='left', fontsize=16, pad=26)
    ax.text(0, 1.04, f'System check {date} · tilting the breadboard by hand, flight mode, no motor',
            transform=ax.transAxes, fontsize=9.5, color=MUTED)
    lean_sat = GMAX / P_GAIN
    fig.text(0.02, 0.015, f'Measured below {P_GAIN:.2f} because the gimbal stops at ±{GMAX:.0f}° from about {lean_sat:.1f}° of lean, '
             f'and the fit runs to 8°.', fontsize=9, color=MUTED)
    fig.tight_layout(rect=(0, 0.04, 1, 1))
    fig.savefig(out, facecolor='white')
    plt.close(fig)


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    path = Path(sys.argv[1])
    d = read(path)
    m = re.search(r'(\d{4})-(\d{2})-(\d{2})', path.name)
    months = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split()
    date = f'{int(m[3])} {months[int(m[2]) - 1]} {m[1]}' if m else ''
    servo_travel(d, path.with_name('syscheck_servo_travel.png'), date)
    control_loop(d, path.with_name('syscheck_control_loop.png'), date)
    print('Wrote syscheck_servo_travel.png and syscheck_control_loop.png')


if __name__ == '__main__':
    main()
