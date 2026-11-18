#include <EEPROM.h>
#include <Servo.h>

// CT-1 laser gimbal-accuracy test for the SLDP 45 TVC rocket (see README.md in this folder).
// Moves the gimbal only: no IMU, no controller, no motor. A laser on the motor tube marks each
// commanded angle on a wall 1000 mm from the pivot; laser_log.py turns the marks into angles.
//
// It uses the flight firmware's calibration: the Config saved in EEPROM by the visualizer's
// Calibrate → Save (centres, directions, linkage ratio, D9/D10 swap), or the flight DEFAULTS if
// nothing is saved. This sketch only READS the EEPROM, so re-flashing nano_tvc.ino afterwards
// finds the calibration untouched.
//
// Axes as in the flight code: X = the X servo (D9), tilts the nozzle toward ±X (drawing pivot
// axis Y, inner gimbal); Y = the Y servo (D10), tilts it toward ±Y (pivot axis X, motor tube).
//
// Serial Monitor at 115200, newline. Commands (case-insensitive), all in GIMBAL degrees:
//   x <deg> | y <deg>      move that axis, the other stays put        -> OK X=<deg> Y=<deg>
//   zero                   both axes to 0                              -> OK X=0.00 Y=0.00
//   step x | step y        18-point step test, waits for n / q at each point:
//                            STEP <axis> <cmd_deg> <up|down> <index 0-17>  ...  STEP DONE | STEP ABORTED
//   circle [deg] [s]       one circle of radius deg (default 8, max 8) over s seconds
//                          (default 10, 2-60) at 50 Hz, then back to 0. q stops it.
//   help                   this list
// Every command is clamped to ±8°. Bad input prints ERR and moves nothing.

const char TEST_VERSION[] = "1.0.0";

// ======================================================================================
// FLIGHT CONVERSION — copied from firmware/nano_tvc/nano_tvc.ino v1.8.0. Keep identical.
// If the flight code changes any of this (or the Config struct / CFG_MAGIC), change it here.
// ======================================================================================
const int X_SERVO_PIN = 9;
const int Y_SERVO_PIN = 10;
const int   X_CENTER = 90, Y_CENTER = 90;   // default servo centres (deg)
const int   X_DIR = 1, Y_DIR = 1;           // default directions (±1)
const float SERVO_PER_GIMBAL = 4.0;         // default linkage ratio: servo deg per gimbal deg
const int   SERVO_RANGE = 45;               // max servo travel either side of centre (deg)
const int   SERVO_MIN_US = 544, SERVO_MAX_US = 2400;   // Servo library's 0° and 180° pulses
const float GMAX_DEG  = 8.0;                // gimbal travel limit (flight GMAX)
const float GRATE_DEG = 60.0;               // gimbal slew limit, deg/s (flight GRATE)

// Same layout and magic as the flight firmware, so EEPROM.get() reads its saved calibration.
struct Config {
  uint16_t magic;
  int16_t  xCenter, yCenter;
  int8_t   xDir, yDir;
  float    tiltXTrim, tiltYTrim, servoPerGimbal;
  uint8_t  swapPins;
  int8_t   up;
  uint8_t  rot;
};
const uint16_t CFG_MAGIC = 0x7C13;

bool cfgValid(const Config &c) {
  return c.magic == CFG_MAGIC &&
         c.xCenter >= 45 && c.xCenter <= 135 && c.yCenter >= 45 && c.yCenter <= 135 &&
         (c.xDir == 1 || c.xDir == -1) && (c.yDir == 1 || c.yDir == -1) &&
         fabs(c.tiltXTrim) <= 45 && fabs(c.tiltYTrim) <= 45 &&
         c.servoPerGimbal >= 0.2 && c.servoPerGimbal <= 8 && c.swapPins <= 1 &&
         c.up != 0 && abs(c.up) <= 3 && c.rot <= 3;
}

// Servo pulse for an angle in degrees (fractional degrees kept: ~10 µs per degree)
int servoUs(float deg) {
  return SERVO_MIN_US + (int)(deg * (SERVO_MAX_US - SERVO_MIN_US) / 180.0 + 0.5);
}

Config cfg;

// Gimbal angle (deg) -> servo angle (deg). Flight: center + dir * g[rad] * RAD_TO_DEG * spg.
float servoDeg(float gDeg, int dir, int center) {
  float a = center + dir * gDeg * cfg.servoPerGimbal;
  return constrain(a, center - SERVO_RANGE, center + SERVO_RANGE);
}
// ======================================================================================

Servo xServo, yServo;
bool cfgSaved = false;
float curX = 0, curY = 0;                  // gimbal angles now on the servos (deg)

const unsigned long TICK_MS = 10;          // 100 Hz moves, like the flight loop
const unsigned long SETTLE_MS = 600;       // step test: wait before reporting a point
const unsigned long CIRCLE_TICK_MS = 20;   // 50 Hz

float clampG(float g) { return constrain(g, -GMAX_DEG, GMAX_DEG); }

void loadConfig() {
  EEPROM.get(0, cfg);
  cfgSaved = cfgValid(cfg);
  if (!cfgSaved) {
    cfg.magic = CFG_MAGIC;
    cfg.xCenter = X_CENTER; cfg.yCenter = Y_CENTER;
    cfg.xDir = X_DIR; cfg.yDir = Y_DIR;
    cfg.tiltXTrim = 0; cfg.tiltYTrim = 0;
    cfg.servoPerGimbal = SERVO_PER_GIMBAL;
    cfg.swapPins = 0; cfg.up = 3; cfg.rot = 0;
  }
}

void printConfig() {
  Serial.print(F("CFG xc=")); Serial.print(cfg.xCenter);
  Serial.print(F(" yc="));   Serial.print(cfg.yCenter);
  Serial.print(F(" xd="));   Serial.print(cfg.xDir);
  Serial.print(F(" yd="));   Serial.print(cfg.yDir);
  Serial.print(F(" spg="));  Serial.print(cfg.servoPerGimbal, 2);
  Serial.print(F(" swap=")); Serial.print(cfg.swapPins);
  Serial.println(cfgSaved ? F(" (SAVED in EEPROM)") : F(" (DEFAULT, nothing saved)"));
}

// Put a gimbal angle pair on the servos, through the flight conversion.
void writeGimbal(float gx, float gy) {
  curX = clampG(gx); curY = clampG(gy);
  xServo.writeMicroseconds(servoUs(servoDeg(curX, cfg.xDir, cfg.xCenter)));
  yServo.writeMicroseconds(servoUs(servoDeg(curY, cfg.yDir, cfg.yCenter)));
}

// Slew both axes to the target at the flight slew limit (blocking, < 0.3 s for a full 16° move).
void moveTo(float tx, float ty) {
  tx = clampG(tx); ty = clampG(ty);
  const float step = GRATE_DEG * TICK_MS / 1000.0;
  while (curX != tx || curY != ty) {
    float nx = fabs(tx - curX) <= step ? tx : curX + (tx > curX ? step : -step);
    float ny = fabs(ty - curY) <= step ? ty : curY + (ty > curY ? step : -step);
    writeGimbal(nx, ny);
    delay(TICK_MS);
  }
}

void reportOk() {
  Serial.print(F("OK X=")); Serial.print(curX, 2);
  Serial.print(F(" Y="));   Serial.println(curY, 2);
}

// ---------- Serial line input ----------
char line[40];
byte lineLen = 0;
bool lineOverflow = false;

// Collects characters; true when a whole line is in `line` (lower-cased, trimmed by the parser).
bool pollLine() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (!lineLen && !lineOverflow) continue;
      line[lineLen] = 0;
      bool bad = lineOverflow;
      lineLen = 0; lineOverflow = false;
      if (bad) { Serial.println(F("ERR line too long")); continue; }
      for (char *p = line; *p; p++) *p = tolower(*p);
      return true;
    }
    if (lineLen < sizeof(line) - 1) line[lineLen++] = c;
    else lineOverflow = true;
  }
  return false;
}

// Strict number parse: the whole token must be a number.
bool parseNum(const char *s, float &out) {
  if (!s) return false;
  char *end;
  double v = strtod(s, &end);
  if (end == s || *end != 0 || isnan(v) || isinf(v)) return false;
  out = v;
  return true;
}

// True if the user sent q (checked during the circle).
bool quitRequested() {
  return pollLine() && !strcmp(line, "q");
}

// ---------- Step test ----------
// Up -8..8 then down 8..-8 in 2° steps: 18 points, the same order as laser_log.py.
const int8_t SEQ[18] = { -8, -6, -4, -2, 0, 2, 4, 6, 8,   8, 6, 4, 2, 0, -2, -4, -6, -8 };

// Waits for n (true) or q (false); anything else gets a reminder.
bool waitNext() {
  for (;;) {
    if (!pollLine()) continue;
    char *t = strtok(line, " \t");
    if (!t) continue;
    if (!strcmp(t, "n")) return true;
    if (!strcmp(t, "q")) return false;
    Serial.println(F("ERR send n (next) or q (abort)"));
  }
}

void runStep(char axis) {
  // Start from 0/0, then go to -8 from 0 (the limit stops us coming from below -8).
  moveTo(0, 0);
  for (byte i = 0; i < 18; i++) {
    float c = SEQ[i];
    if (axis == 'x') moveTo(c, 0); else moveTo(0, c);
    delay(SETTLE_MS);
    Serial.print(F("STEP ")); Serial.print(axis == 'x' ? 'X' : 'Y');
    Serial.print(' '); Serial.print((int)c);
    Serial.print(i < 9 ? F(" up ") : F(" down "));
    Serial.println(i);
    if (!waitNext()) { moveTo(0, 0); Serial.println(F("STEP ABORTED")); return; }
  }
  moveTo(0, 0);
  Serial.println(F("STEP DONE"));
}

// ---------- Circle (for the video) ----------
void runCircle(float r, float secs) {
  moveTo(0, 0);
  moveTo(r, 0);                                   // ease out to the start of the circle
  unsigned long n = (unsigned long)(secs * 1000 / CIRCLE_TICK_MS);
  unsigned long t0 = millis();
  for (unsigned long i = 1; i <= n; i++) {
    while (millis() - t0 < i * CIRCLE_TICK_MS) {
      if (quitRequested()) { moveTo(0, 0); Serial.println(F("CIRCLE STOPPED")); reportOk(); return; }
    }
    float a = TWO_PI * i / n;
    writeGimbal(r * cos(a), r * sin(a));
  }
  moveTo(0, 0);
  Serial.println(F("CIRCLE DONE"));
  reportOk();
}

void printHelp() {
  Serial.println(F("Commands (gimbal degrees, clamped to +-8):"));
  Serial.println(F("  x <deg> | y <deg>   move one axis"));
  Serial.println(F("  zero                both axes to 0"));
  Serial.println(F("  step x | step y     18-point step test; n = next point, q = abort"));
  Serial.println(F("  circle [deg] [s]    one circle (default 8 deg, 10 s); q stops it"));
  Serial.println(F("  help                this list"));
}

void runCommand() {
  char *cmd = strtok(line, " \t");
  if (!cmd) return;
  char *a1 = strtok(NULL, " \t");
  char *a2 = strtok(NULL, " \t");
  char *extra = strtok(NULL, " \t");
  if (extra) { Serial.println(F("ERR too many arguments (try help)")); return; }

  float v, s;
  if ((!strcmp(cmd, "x") || !strcmp(cmd, "y")) && !a2) {
    if (!parseNum(a1, v)) { Serial.println(F("ERR usage: x <deg> or y <deg>")); return; }
    if (fabs(v) > GMAX_DEG) Serial.println(F("NOTE clamped to +-8"));
    if (cmd[0] == 'x') moveTo(v, curY); else moveTo(curX, v);
    reportOk();
  } else if (!strcmp(cmd, "zero") && !a1) {
    moveTo(0, 0);
    reportOk();
  } else if (!strcmp(cmd, "step") && a1 && !a2 && (!strcmp(a1, "x") || !strcmp(a1, "y"))) {
    runStep(a1[0]);
  } else if (!strcmp(cmd, "circle")) {
    v = GMAX_DEG; s = 10;
    if (a1 && !parseNum(a1, v)) { Serial.println(F("ERR usage: circle [deg] [seconds]")); return; }
    if (a2 && !parseNum(a2, s)) { Serial.println(F("ERR usage: circle [deg] [seconds]")); return; }
    if (v <= 0) { Serial.println(F("ERR radius must be > 0")); return; }
    if (v > GMAX_DEG) Serial.println(F("NOTE radius clamped to 8"));
    v = min(v, GMAX_DEG);
    s = constrain(s, 2, 60);
    runCircle(v, s);
  } else if (!strcmp(cmd, "help") && !a1) {
    printHelp();
  } else {
    Serial.println(F("ERR unknown command (try help)"));
  }
}

void setup() {
  Serial.begin(115200);
  loadConfig();
  xServo.attach(cfg.swapPins ? Y_SERVO_PIN : X_SERVO_PIN, SERVO_MIN_US, SERVO_MAX_US);
  yServo.attach(cfg.swapPins ? X_SERVO_PIN : Y_SERVO_PIN, SERVO_MIN_US, SERVO_MAX_US);
  writeGimbal(0, 0);                         // start centred

  Serial.print(F("CT-1 laser gimbal test v")); Serial.println(TEST_VERSION);
  printConfig();
  Serial.println(F("Type help for commands."));
  Serial.println(F("READY"));
}

void loop() {
  if (pollLine()) runCommand();
}
