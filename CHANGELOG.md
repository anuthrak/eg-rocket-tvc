# Changelog

Visualizer and repo versions are tagged `vX.Y.Z`. Firmware versions (`FW_VERSION`, printed at boot) are noted per entry.

## [2.3.0] – 2026-10-26
### Added
- Intro transition after the loading screen. Mission: the camera flies in from a wide shot of Earth to the chase view (~1.8 s, controls paused until it lands) while the HUD boots in, with panels fading and rising one after another, the event list cascading and timeline markers lighting up left to right. Bench: HUD boot only. Same-tab reloads skip the fly-in and get a quick HUD fade; "reduce motion" keeps a plain fade.
### Changed
- The 3D scenes skip drawing while the loading screen fully covers them, and the loading bar's speed is time-based, so slower machines load noticeably faster.

## [2.2.0] – 2026-10-26
### Added
- Favicon (white tilted rocket on a black circle) plus PNG fallback and iOS home-screen icon, in `visualizer/public/`.
- Bench: gimbal dial (nozzle position inside the ±45° ring, with a trail) and a serial log (last 200 lines, boot messages highlighted) that fills the right sidebar.
- Mission camera collisions: Earth, the Moon, the rocket and the launch tower are solid; the camera dead-stops on contact (no sliding into surfaces) while orbiting at the same height and pulling away still work.
### Changed
- Mission is the first tab and the home page (returning Bench visitors still land on Bench).
- Bench layout: two sidebars around the 3D view (readouts, chart and input on the left; gimbal and link on the right) that don't scroll on normal screens.
- Phones and short windows: one-line header, line-icon controls, a one-line P/Y readout instead of the mini bench panel; Connect and baud hide where USB Web Serial can't work.
- Loading bar eases between checkpoints and keeps moving while textures generate.
- Bench zoom limited to the floor grid's scale (1.2–11 units); panning stays on the grid; orbiting is still a free 360°.
- Static assets moved into `visualizer/public/`.
### Fixed
- Callouts no longer overlap the minimap on phones; short-landscape minimap clears the bottom HUD.
- Header no longer shifts 10px between tabs in narrow desktop windows (scrollbar gutter).
- Roll footnote and servo-mode label no longer clip in narrow sidebars; help text no longer mentions the removed Processing sketch.

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
