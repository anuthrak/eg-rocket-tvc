#!/usr/bin/env python3
"""CT-1 laser gimbal-accuracy logger (pairs with ct1_laser_gimbal.ino).

Walks through the 18 step-test points per axis (-8..8 up, then 8..-8 down), asks for the laser
dot's signed distance from the zero mark in mm, converts it to degrees with atan(mm / D) and
appends the rows to a CSV (axis,cmd_deg,meas_deg,dir). With --port it also drives the Arduino,
so one person can run the whole test.

  python laser_log.py                       # manual: someone types the commands in the Serial Monitor
  python laser_log.py --port COM5           # drives the Arduino over serial (pip install pyserial)
  python laser_log.py --distance 1500       # pivot-to-wall distance other than 1000 mm

Standard library only; pyserial is needed only for --port.
"""
import argparse
import csv
import math
import os
import sys
import time

POINTS = [(c, "up") for c in (-8, -6, -4, -2, 0, 2, 4, 6, 8)] + \
         [(c, "down") for c in (8, 6, 4, 2, 0, -2, -4, -6, -8)]
MAX_ERR_DEG = 1.0
MAX_BACKLASH_DEG = 1.0


class Abort(Exception):
    pass


# ---------- Serial (optional) ----------
class Board:
    def __init__(self, port, baud):
        try:
            import serial  # pyserial
        except ImportError:
            sys.exit("--port needs pyserial:  pip install pyserial")
        self.ser = serial.Serial(port, baud, timeout=0.2)
        # Opening the port resets a Nano: wait for the banner. If it didn't reset, poke it.
        if not self.wait_for(lambda l: l == "READY", 4, quiet_errors=True):
            self.send("zero")
            if not self.wait_for(lambda l: l.startswith("OK"), 5):
                sys.exit("No reply from the Arduino. Is ct1_laser_gimbal.ino uploaded, and is the port right?")

    def send(self, text):
        self.ser.write((text + "\n").encode())

    def readline(self):
        return self.ser.readline().decode(errors="replace").strip()

    def wait_for(self, match, timeout, quiet_errors=False):
        """Read lines until match(line) is true; echo anything informative. Returns the line or None."""
        end = time.time() + timeout
        while time.time() < end:
            line = self.readline()
            if not line:
                continue
            if match(line):
                return line
            if line.startswith(("ERR", "STEP ABORTED")) and not quiet_errors:
                raise Abort("Arduino: " + line)
            print("   [arduino] " + line)
        return None

    def expect_step(self, axis, cmd, direction, index):
        line = self.wait_for(lambda l: l.startswith("STEP "), 15)
        if line is None:
            raise Abort("Arduino did not report the next step point (timed out)")
        if line.split() != ["STEP", axis, str(cmd), direction, str(index)]:
            raise Abort(f"Out of step with the Arduino: expected point {index} ({cmd} {direction}), got '{line}'")

    def close(self):
        self.ser.close()


# ---------- Measurement entry ----------
def mm_to_deg(mm, distance):
    return round(math.degrees(math.atan(mm / distance)), 2)


def ask_mm(prompt):
    """Returns a float, 'r' (redo last) or raises Abort on q."""
    while True:
        s = input(prompt).strip().lower()
        if s == "q":
            raise Abort("Stopped by user")
        if s == "r":
            return "r"
        try:
            v = float(s)
            if math.isfinite(v):
                return v
        except ValueError:
            pass
        print("   Enter a number in mm (negative allowed), r to redo the last entry, or q to quit.")


def run_axis(axis, distance, board):
    """Collects the 18 points for one axis. Returns a list of row dicts."""
    rows = []
    if board:
        board.send("step " + axis.lower())
    i, arrived = 0, -1
    while i < len(POINTS):
        cmd, direction = POINTS[i]
        if board and arrived != i:  # read the STEP line once per point, not again after a redo
            board.expect_step(axis, cmd, direction, i)
            arrived = i
        ans = ask_mm(f"Axis {axis}, cmd {cmd} ({direction}): dot distance from zero mark in mm (signed)? ")
        if ans == "r":
            if not rows:
                print("   Nothing to redo yet.")
                continue
            pc, pd = POINTS[len(rows) - 1]
            note = " (re-measure the mark you made; the gimbal has moved on)" if board else ""
            ans2 = ask_mm(f"   Redo axis {axis}, cmd {pc} ({pd}){note}: mm? ")
            if ans2 == "r":
                continue
            rows[-1]["meas_deg"] = mm_to_deg(ans2, distance)
            print(f"   -> {rows[-1]['meas_deg']:+.2f} deg (replaced)")
            continue
        deg = mm_to_deg(ans, distance)
        rows.append({"axis": axis, "cmd_deg": cmd, "meas_deg": deg, "dir": direction})
        print(f"   -> {deg:+.2f} deg  (error {deg - cmd:+.2f})")
        if board:
            board.send("n")
        i += 1
    if board:
        if board.wait_for(lambda l: l == "STEP DONE", 10) is None:
            print("   (Arduino did not confirm STEP DONE; check it is back at zero)")
    return rows


def append_csv(path, rows):
    new = not os.path.exists(path) or os.path.getsize(path) == 0
    with open(path, "a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["axis", "cmd_deg", "meas_deg", "dir"])
        if new:
            w.writeheader()
        for r in rows:
            w.writerow({**r, "meas_deg": f"{r['meas_deg']:.2f}"})


# ---------- Results ----------
def summarize(axis, rows):
    max_err = max(abs(r["meas_deg"] - r["cmd_deg"]) for r in rows)
    up = {r["cmd_deg"]: r["meas_deg"] for r in rows if r["dir"] == "up"}
    down = {r["cmd_deg"]: r["meas_deg"] for r in rows if r["dir"] == "down"}
    backlash = max(abs(up[c] - down[c]) for c in up if c in down)
    ok = max_err <= MAX_ERR_DEG and backlash <= MAX_BACKLASH_DEG
    print(f"\nAxis {axis}:  cmd   up     down")
    for c in sorted(up):
        print(f"          {c:+3d}  {up[c]:+6.2f} {down.get(c, float('nan')):+6.2f}")
    print(f"  max |meas - cmd| = {max_err:.2f} deg (limit {MAX_ERR_DEG})  "
          f"{'PASS' if max_err <= MAX_ERR_DEG else 'FAIL'}")
    print(f"  max up-vs-down   = {backlash:.2f} deg (limit {MAX_BACKLASH_DEG})  "
          f"{'PASS' if backlash <= MAX_BACKLASH_DEG else 'FAIL'}")
    print(f"  Axis {axis}: {'PASS' if ok else 'FAIL'}")
    return ok


def main():
    ap = argparse.ArgumentParser(description="CT-1 laser gimbal-accuracy logger")
    ap.add_argument("--distance", type=float, default=1000.0, help="gimbal pivot to wall, mm (default 1000)")
    ap.add_argument("--port", help="Arduino serial port (e.g. COM5 or /dev/ttyUSB0); drives the step test")
    ap.add_argument("--baud", type=int, default=115200)
    ap.add_argument("--out", default="t2_gimbal.csv", help="CSV to append to (default t2_gimbal.csv)")
    args = ap.parse_args()
    if args.distance <= 0:
        sys.exit("--distance must be positive")

    board = Board(args.port, args.baud) if args.port else None
    print(f"Wall distance {args.distance:g} mm. Enter mm as signed numbers (+ = the side the dot goes for +cmd).")
    print("At each prompt: number, r = redo last entry, q = quit (nothing from that axis is saved).")
    if not board:
        print("Manual mode: send 'step x' / 'step y' in the Serial Monitor and 'n' after each entry.")

    results = {}
    try:
        while True:
            axis = input("\nAxis to test (x / y, blank to finish)? ").strip().upper()
            if not axis:
                break
            if axis not in ("X", "Y"):
                print("   x or y")
                continue
            try:
                rows = run_axis(axis, args.distance, board)
            except Abort as e:
                print(f"   {e}. Axis {axis} not saved.")
                if board:
                    board.send("q")
                continue
            append_csv(args.out, rows)
            print(f"   Saved {len(rows)} rows to {args.out}")
            results[axis] = rows
    except (KeyboardInterrupt, EOFError):
        print()
        if board:
            board.send("q")
    finally:
        if board:
            board.close()

    if not results:
        print("No complete axis recorded.")
        return 1
    print("\n===== CT-1 results =====")
    all_ok = all([summarize(a, results[a]) for a in sorted(results)])
    print(f"\nOverall: {'PASS' if all_ok else 'FAIL'}" + ("" if len(results) == 2 else " (only one axis tested)"))
    return 0 if all_ok else 2


if __name__ == "__main__":
    sys.exit(main())
