"""Draws the System check code flow chart (syscheck_flowchart.png), matching visualizer/syscheck.js.

    python flowchart_system_check.py
"""
from pathlib import Path

import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, Polygon

INK, MUTED, LINE = '#222222', '#666666', '#444444'
STEP, DEC, TERM, SAFE = '#eaf1fb', '#fff4e5', '#e9e9e9', '#fdecec'

fig, ax = plt.subplots(figsize=(11, 15), dpi=200)
ax.set_xlim(0, 110)
ax.set_ylim(-16, 140)
ax.axis('off')


def box(x, y, w, h, text, fc=STEP, ec=LINE, fs=10, bold=False, r=0.8):
    ax.add_patch(FancyBboxPatch((x - w / 2, y - h / 2), w, h, boxstyle=f'round,pad=0,rounding_size={r}', fc=fc, ec=ec, lw=1.3))
    ax.text(x, y, text, ha='center', va='center', fontsize=fs, color=INK, weight='bold' if bold else 'normal', linespacing=1.35)


def diamond(x, y, w, h, text):
    ax.add_patch(Polygon([(x, y + h / 2), (x + w / 2, y), (x, y - h / 2), (x - w / 2, y)], closed=True, fc=DEC, ec=LINE, lw=1.3))
    ax.text(x, y, text, ha='center', va='center', fontsize=9.6, color=INK, linespacing=1.3)


def arrow(x1, y1, x2, y2, label=None, lx=0.0, ly=0.0):
    ax.annotate('', xy=(x2, y2), xytext=(x1, y1), arrowprops=dict(arrowstyle='-|>', color=LINE, lw=1.2, shrinkA=0, shrinkB=0))
    if label:
        ax.text((x1 + x2) / 2 + lx, (y1 + y2) / 2 + ly, label, fontsize=9.5, color=MUTED, va='center')


CX, W, H = 36, 62, 8.6          # main column: centre, box width, box height
RX = 92                         # right column centre
ax.text(2, 137, 'System check: code flow (visualizer/syscheck.js + firmware/nano_tvc.ino)', fontsize=14, color=INK, weight='bold')

box(CX, 130, 30, 5, 'Start check', fc=TERM, bold=True, r=2.4)
arrow(CX, 127.5, CX, 123.25)
diamond(CX, 119, 36, 8.5, 'Arduino connected\nand config (CFG) received?')
arrow(CX + 18, 119, RX - 13, 119, 'no', lx=-3, ly=1.5)
box(RX, 119, 26, 7, 'Show "Connect the Arduino"\nconnect, then Start again', fc=TERM, fs=9.4)
arrow(CX, 114.75, CX, 110.3, 'yes', lx=1.2)

y = 106
for t in ['1  Power and link\nSend CAL, count CAL lines for 1 s (rate)  ·  gyro rates present?\nAsk: did the ESC play its start-up tune?',
          '2  IMU still\nBreadboard untouched for 5 s\ntilt noise, gyro offset, gyro noise',
          '3  IMU axes\nTilt toward +X, then +Y: right axis and sign?\nIntegrated gyro rate matches the change in tilt?',
          '4  Servos\nSWEEP CIRCLE, then SWEEP CORNERS, wait for SWEEP,DONE\ntravel reached?  Nano reset?  Ask: smooth?',
          '5  Control loop\nSend RUN (flight mode), you tilt +X, -X, +Y, -Y\nfit gimbal vs lean per axis (slope, r), then back to CAL']:
    box(CX, y, W, H, t)
    arrow(CX, y - H / 2, CX, y - 11 + H / 2)
    y -= 11

dy = y - 1.5
diamond(CX, dy, 36, 8.5, 'Ready to spin the motor?\n(EDF clamped, area clear)')
arrow(CX + 18, dy, RX - 11, dy, 'skip', lx=-3, ly=1.5)
box(RX, dy, 22, 7, 'Mark steps 6-8\n"Skipped"', fc=TERM, fs=9.4)
arrow(CX, dy - 4.25, CX, dy - 9.7, 'ready', lx=1.2)

y = dy - 14
for t in ['6  Motor\nARM, then THR 10, 20, 30 %: time to reach, value held\n(heartbeat THR every 150 ms)  ·  Ask: does it blow out the tail?',
          '7  Motor + servos\nTHR 25 %: 2 s still, then SWEEP with the motor on\nvibration, data gaps, Nano reset?  ·  Ask: any jitter?',
          '8  Safety cuts\nTHR 15 %, "Press Space": time to stop\nre-ARM, tilt past 25°: Nano sends THR,CUT,TILT (timed)']:
    box(CX, y, W, H, t)
    arrow(CX, y - H / 2, CX, y - 11 + H / 2)
    y -= 11

end_y = y + 0.8
box(CX, end_y, W, 6.4, 'THR 0  ·  DISARM  ·  save results\nPass / Check / Fail per step  ·  CSV  ·  summary', fc=TERM, fs=9.8)
# Skipped → straight down the clear right side to the end
ax.plot([RX, RX], [dy - 3.5, end_y], color=LINE, lw=1.2)
arrow(RX, end_y, CX + W / 2, end_y)

# Inset: what every step does
ix, iy = RX, 101
ax.text(ix, iy + 5, 'Inside every step', ha='center', fontsize=10.5, weight='bold', color=INK)
for i, t in enumerate(['Show the prompt and buttons', 'Wait for Nano data or your\nanswer (time-out = Fail)',
                       'Compute the numbers', 'Pass / Check / Fail + detail']):
    box(ix, iy - i * 7.4, 26, 5.4, t, fc='white', fs=9.2)
    if i < 3:
        arrow(ix, iy - i * 7.4 - 2.7, ix, iy - (i + 1) * 7.4 + 2.7)

# Safety band across the bottom
sy = end_y - 10.5
box(55, sy, 104, 10, '', fc=SAFE, ec='#c0392b')
ax.text(55, sy + 2.8, 'Any time during steps 6-8 (motor safety)', ha='center', fontsize=10.5, weight='bold', color='#a32020')
ax.text(55, sy - 1.7, 'Page: Stop motor, Space, Esc, leaving the Tests tab, page hidden, link lost  ->  THR 0 + DISARM, check "Stopped"\n'
        'Firmware, on its own: no serial line for 0.5 s, tilt past 25°, mode change  ->  motor cut (THR,CUT)',
        ha='center', va='center', fontsize=9.3, color=INK, linespacing=1.45)

out = Path(__file__).with_name('syscheck_flowchart.png')
fig.savefig(out, facecolor='white', bbox_inches='tight')
print('Wrote', out.name)
