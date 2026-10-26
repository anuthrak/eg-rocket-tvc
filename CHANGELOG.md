# Changelog

Visualizer and repo versions are tagged `vX.Y.Z`. Firmware versions (`FW_VERSION`, printed at boot) are noted per entry.

## [2.1.0] – 2026-10-26
### Changed
- Visualizer split from one 1,900-line `index.html` into six files: `index.html`, `style.css`, `loader.js`, `main.js`, `bench.js`, `mission.js`. Same look and behavior. Run locally with a static server (see README).
- Firmware moved from `nano_test/` to `firmware/nano_tvc/nano_tvc.ino`.
- Loading screen always uses the fuel look; the footer buttons replay either look without changing the default.
- App version now comes from one place (`VERSION` in `main.js`) and shows in the footer.
### Added
- Firmware v1.0.0: prints `TVC firmware v1.0.0` at boot; the LINK panel shows the firmware version.
### Fixed
- Header no longer wraps onto two lines on the Bench tab only (it shifted when switching tabs at some window widths).

## [2.0.0] – 2026-10-26
### Added
- Loading screen with real load progress: fuel look (bench rocket's tanks fill, then a ±8° gimbal check) and mission-arc look.
- Header status strip: link clock, feed rate, time since last line, baud, line count, and an amber STALE state.
- Bench: roll readout, gimbal and link tables with a saturation bar, outline view of the rocket.
- Mission: top strip (next event countdown, max speed, max altitude, peak gimbal, engine state) and a mission events list.
- Footer with source, version and links.
### Changed
- Monochrome interface with color reserved for data; Barlow type throughout; dashes instead of zeros before data arrives.
- Overview camera fits Earth, the transfer orbit and the Moon into the area not covered by the HUD.
### Fixed
- Header items no longer shift when switching tabs or as numbers change.

## [1.0.0] – 2026-10-26
- First release: Bench view over Web Serial with demo mode, Earth-to-Moon Mission sim, and Nano firmware running the PD gimbal controller.
