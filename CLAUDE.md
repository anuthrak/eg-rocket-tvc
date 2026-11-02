# SLDP 45 — Rocket TVC desk rig (EG1004)

Whole-project repo (GitHub `anuthrak/eg-rocket-tvc`, public; Vercel deploys `visualizer/` from `main`).
Open VS Code and Claude at this folder.

## Source of truth
| Topic | File |
|---|---|
| Design, numbers, roles, schedule, requirements | `docs/PROJECT_SUMMARY.md` |
| Parts and spend | `docs/bom.md` |
| How drawings are made and named | `docs/drawing-standard.md` |
| Released drawings, print STLs, STEP | `releases/batch-001_2026-10-30/` (never edit; a new batch gets a new folder) |
| CAD models + drawing generators | `cad/` (shared code in `cad/lib/`, vendor K-9 files in `cad/vendor/`) |
| Firmware | `firmware/nano_tvc/nano_tvc.ino` (`FW_VERSION`) |
| Visualizer | `visualizer/` (`VERSION` in `main.js`) |

Local only (gitignored): `submissions/` (as submitted: Milestone 1 deck, PDI), `admin/` (shopping cart, private
team notes), `archive/` (old iterations).

## Conventions
- Axes: z = rocket axis up, +X = toward the 2× M3 TVC mount screws (body 0°). Drawings name pivot axes; firmware
  and visualizer name servos by the direction they tilt the nozzle (X servo D9 = pivot axis Y / inner gimbal).
- File names: `SLDP-[AREA]-[NUM]_details` with hyphens; areas GA, ST, TVC, AV, GS, EL.
- Visual/UI changes: feature branch → Vercel preview → user approves → merge to `main` → release (README).
- Firmware: 100 Hz loop; compile with the Arduino IDE (board Arduino Nano, libs Adafruit MPU6050 + Servo).
- Don't put team members' names or private notes in tracked files (public repo).

## Key dates (2026)
Benchmark B Nov 13 · Commissioning Dec 4 · Final submission Dec 11.
