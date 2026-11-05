#include <Wire.h>
#include <EEPROM.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <Servo.h>

// TVC gimbal controller for the SLDP 45 desk-rig rocket.
//   IMU -> complementary filter -> PID per axis -> gimbal command (clamped to ±GMAX, slew-limited
//   to GRATE) -> servo pulse via the linkage ratio. Gains from docs/PROJECT_SUMMARY.md §7.
// Hardware: Arduino Nano + MPU6050 on the avionic sled (SLDP-AV-001) + 2 MG90S servos.
// The EDF + ESC haven't arrived, so there is no motor output yet and throttle is fixed at 1.0.
//
// Axes (rocket body frame, same as the drawings: z = rocket axis up, +X = toward the 2X M3 TVC mount
// screws at body 0°, +Y = 90° from that). Servos are named by the direction they tilt the nozzle:
//   X servo (D9)  tilts the nozzle toward ±X, correcting a lean toward ±X ("pitch" in the visualizer).
//                 It rotates the gimbal about drawing AXIS Y (inner gimbal, SLDP-TVC-001 item 2).
//   Y servo (D10) tilts the nozzle toward ±Y, correcting a lean toward ±Y ("yaw" in the visualizer).
//                 It rotates the motor tube about drawing AXIS X (SLDP-TVC-001 item 3).
// The MPU6050 can be mounted in any orientation (it sits on the vertical breadboard of the sled):
// LEVEL detects which sensor axis points up the rocket, and SET ROT turns the sensor's X/Y about that
// axis so they line up with the rocket's X/Y. The visualizer's calibration does both for you.
//
// Calibration: Bench tab → Gimbal → Calibrate (the visualizer drives the commands below), or type
// them into the Serial Monitor at 115200 with a newline. Saved values live in EEPROM and survive
// power-off and re-uploads; the DEFAULTS block is only used until something is saved.
//
//   CAL               enter calibration: controller paused, servos held at centre, streams
//                     CAL,<xServo>,<yServo>,<rawTiltX>,<rawTiltY>   (tilts in the rocket frame)
//   RUN               back to flight mode (also clears a tilt abort)
//   GET               print the config line:
//                     CFG,xc,yc,xd,yd,tx,ty,spg,swap,<SAVED|UNSAVED|DEFAULT>,up,rot
//   SET <key> <val>   keys: XC YC (servo centre, deg)  XD YD (direction ±1)  TX TY (level trim, deg)
//                           SPG (servo deg per gimbal deg)  SWAP (0/1: swap the D9/D10 roles)
//                           UP (sensor axis pointing up: 1/2/3 = X/Y/Z, negative = minus)
//                           ROT (0-3: turn the sensor's X/Y by 90° steps about the up axis)
//   LEVEL             rocket upright and still: detect the up axis, capture TX/TY
//   PULSE X|Y [deg]   (CAL only) move one servo the way the controller would for a lean toward +X/+Y
//   SAVE              write the config to EEPROM
//   LOAD              discard unsaved changes (reload EEPROM, or the defaults if nothing is saved)
//   DEFAULTS          load the DEFAULTS block (not saved until SAVE)
//   FREE ON|OFF       free-test mode on or off; replies FREE,ON or FREE,OFF
//
// Safety: the gimbal is always clamped to +-GMAX. Tilt beyond ABORT_TILT centres the gimbal and prints ABORT,TILT.
// It re-arms after the rocket is back within REARM_TILT for REARM_MS (prints ABORT,CLEAR), or on RUN.
// Free-test (FREE ON) is for tilting the rocket by hand: no tilt abort, gains x FREE_TEST_GAIN, same +-GMAX limit.
// It always starts off at power-up and is never saved.
// TODO when the ESC arrives: refuse FREE ON while the motor can run, throttle output capped at THROTTLE_CAP, motor cut on abort and when
// the serial link goes quiet, and the motor stays off after an abort until RUN.

// Printed at boot; the visualizer shows it in the LINK table. Bump with CHANGELOG.md.
const char FW_VERSION[] = "1.5.0";

// ===================== DEFAULTS =====================
const int X_SERVO_PIN = 9;
const int Y_SERVO_PIN = 10;
const int   X_CENTER = 90, Y_CENTER = 90;   // servo angle with the nozzle dead straight (deg)
const int   X_DIR = 1, Y_DIR = 1;           // -1 if that servo pushes the wrong way
const float SERVO_PER_GIMBAL = 4.0;         // linkage ratio: servo degrees per gimbal degree (~4 for the K-9)
const float TILT_X_TRIM = 0.0, TILT_Y_TRIM = 0.0;   // tilt the sensor reads when truly upright (deg)
const int8_t  UP_AXIS = 3;                  // sensor axis up the rocket: 1/2/3 = X/Y/Z, negative = minus
const uint8_t SENSOR_ROT = 0;               // sensor X/Y turned by ROT × 90° about the up axis
const int   SERVO_RANGE = 45;               // max servo travel either side of centre (deg)
// ====================================================

const int SERVO_MIN_US = 544, SERVO_MAX_US = 2400;   // Servo library's 0° and 180° pulses

Adafruit_MPU6050 mpu;
Servo xServo;
Servo yServo;

// ---------- Controller (docs/PROJECT_SUMMARY.md §7) ----------
// Gimbal degrees per degree of tilt (and per °/s, and per °·s), tuned at THRUST_REF_G and scaled by
// THRUST_REF_G / current thrust so the loop behaves the same at any throttle. Starting values: tune on the rig.
const float KP_G  = 2.5;
const float KD_G  = 0.55;             // D term from the gyro rate, never from a differentiated angle
const float KI_G  = 0.3;
const float I_MAX = 2.0 * DEG_TO_RAD;     // integrator can add at most ±2° of gimbal
const float THRUST_MAX_G = 220.0;         // EDF static thrust at full throttle (QX 30 mm @ 11.1 V)
const float THRUST_REF_G = 150.0;
const float GMAX  = 8.0 * DEG_TO_RAD;     // design gimbal travel
const float GRATE = 60.0 * DEG_TO_RAD;    // gimbal slew-rate limit (rad/s)
const float ABORT_TILT = 25.0 * DEG_TO_RAD;
const float REARM_TILT = 5.0 * DEG_TO_RAD;
const unsigned long REARM_MS = 1000;
const float FREE_TEST_GAIN = 0.5;         // free-test only: multiplies Kp, Kd and Ki
const float THROTTLE_CAP = 0.85;          // for the ESC (EDF draws ~11 A at full throttle, supply is 10 A)

// No motor yet: run as if the engine is at full throttle so the gimbal always steers.
float throttle = 1.0;

// Complementary filter: trust the gyro short-term, the accelerometer long-term
const float ALPHA = 0.98;

// Telemetry: true = servo angles (90 = neutral), matches the visualizer's default
// "Data is servo angles" checkbox. false = vehicle attitude in degrees (untick that box).
const bool TELEMETRY_SERVO = true;

const unsigned long LOOP_US = 10000;      // 100 Hz control loop
const unsigned long TELEMETRY_MS = 50;    // 20 Hz serial output

// ---------- Config (EEPROM-backed) ----------
struct Config {
  uint16_t magic;
  int16_t  xCenter, yCenter;
  int8_t   xDir, yDir;
  float    tiltXTrim, tiltYTrim, servoPerGimbal;
  uint8_t  swapPins;
  int8_t   up;      // ±1..3
  uint8_t  rot;     // 0..3
};
const uint16_t CFG_MAGIC = 0x7C13;        // changed in v1.3.0 (new fields): older saves fall back to defaults
Config cfg;
bool cfgSaved = false;   // cfg came from / matches EEPROM
bool cfgDirty = false;   // changed since last load/save

void loadDefaults() {
  cfg.magic = CFG_MAGIC;
  cfg.xCenter = X_CENTER; cfg.yCenter = Y_CENTER;
  cfg.xDir = X_DIR; cfg.yDir = Y_DIR;
  cfg.tiltXTrim = TILT_X_TRIM; cfg.tiltYTrim = TILT_Y_TRIM;
  cfg.servoPerGimbal = SERVO_PER_GIMBAL;
  cfg.swapPins = 0;
  cfg.up = UP_AXIS; cfg.rot = SENSOR_ROT;
}

bool cfgValid(const Config &c) {
  return c.magic == CFG_MAGIC &&
         c.xCenter >= 45 && c.xCenter <= 135 && c.yCenter >= 45 && c.yCenter <= 135 &&
         (c.xDir == 1 || c.xDir == -1) && (c.yDir == 1 || c.yDir == -1) &&
         fabs(c.tiltXTrim) <= 45 && fabs(c.tiltYTrim) <= 45 &&
         c.servoPerGimbal >= 0.2 && c.servoPerGimbal <= 8 && c.swapPins <= 1 &&
         c.up != 0 && abs(c.up) <= 3 && c.rot <= 3;
}

void loadConfig() {
  Config c;
  EEPROM.get(0, c);
  if (cfgValid(c)) { cfg = c; cfgSaved = true; }
  else { loadDefaults(); cfgSaved = false; }
  cfgDirty = false;
}

void saveConfig() {
  cfg.magic = CFG_MAGIC;
  EEPROM.put(0, cfg);
  cfgSaved = true; cfgDirty = false;
}

void printConfig() {
  Serial.print("CFG,");
  Serial.print(cfg.xCenter); Serial.print(',');
  Serial.print(cfg.yCenter); Serial.print(',');
  Serial.print(cfg.xDir); Serial.print(',');
  Serial.print(cfg.yDir); Serial.print(',');
  Serial.print(cfg.tiltXTrim, 2); Serial.print(',');
  Serial.print(cfg.tiltYTrim, 2); Serial.print(',');
  Serial.print(cfg.servoPerGimbal, 2); Serial.print(',');
  Serial.print(cfg.swapPins); Serial.print(',');
  Serial.print(cfgDirty ? "UNSAVED" : cfgSaved ? "SAVED" : "DEFAULT"); Serial.print(',');
  Serial.print(cfg.up); Serial.print(',');
  Serial.println(cfg.rot);
}

// Servo pulse for an angle in degrees (fractional degrees are kept: ~10 µs per degree)
int servoUs(float deg) {
  return SERVO_MIN_US + (int)(deg * (SERVO_MAX_US - SERVO_MIN_US) / 180.0 + 0.5);
}

void attachServos() {
  xServo.detach(); yServo.detach();
  xServo.attach(cfg.swapPins ? Y_SERVO_PIN : X_SERVO_PIN, SERVO_MIN_US, SERVO_MAX_US);
  yServo.attach(cfg.swapPins ? X_SERVO_PIN : Y_SERVO_PIN, SERVO_MIN_US, SERVO_MAX_US);
  xServo.writeMicroseconds(servoUs(cfg.xCenter));
  yServo.writeMicroseconds(servoUs(cfg.yCenter));
}

// ---------- State ----------
float tiltX = 0, tiltY = 0, roll = 0;     // attitude (rad), 0 = upright
float gx = 0, gy = 0;                     // gimbal angles (rad)
float ix = 0, iy = 0;                     // integrators (rad·s)
float biasX = 0, biasY = 0, biasZ = 0;    // gyro bias, sensor frame (rad/s)
unsigned long lastLoop = 0, lastTelemetry = 0;
bool aborted = false;
bool freeTest = false;                    // never saved: every power-up starts with the abort armed
unsigned long uprightSince = 0;

bool calMode = false;
char pulseAxis = 0;                       // 'X' / 'Y' while a PULSE is running
int pulseDeg = 15;
unsigned long pulseEnd = 0;

// ---------- Sensor frame -> rocket frame ----------
// up = ±(axis index + 1); the other two sensor axes, in right-handed order, become rocket X0/Y0,
// then turned by rot × 90° about the up axis.
void toBody(float sx, float sy, float sz, float b[3]) {
  float s[3] = { sx, sy, sz };
  int i = abs(cfg.up) - 1;
  float sg = cfg.up > 0 ? 1 : -1;
  float x0 = s[(i + 1) % 3], y0 = sg * s[(i + 2) % 3];
  b[2] = sg * s[i];
  switch (cfg.rot) {
    case 0:  b[0] = x0;  b[1] = y0;  break;
    case 1:  b[0] = y0;  b[1] = -x0; break;
    case 2:  b[0] = -x0; b[1] = -y0; break;
    default: b[0] = -y0; b[1] = x0;  break;
  }
}

// Tilt from gravity in the rocket frame: positive = top leaning toward +X / +Y
float tiltFromX(const float b[3]) { return atan2(-b[0], b[2]); }
float tiltFromY(const float b[3]) { return atan2(-b[1], b[2]); }
void bodyAccel(const sensors_event_t &a, float b[3]) { toBody(a.acceleration.x, a.acceleration.y, a.acceleration.z, b); }
float accelTiltX(const float b[3]) { return tiltFromX(b) - cfg.tiltXTrim * DEG_TO_RAD; }
float accelTiltY(const float b[3]) { return tiltFromY(b) - cfg.tiltYTrim * DEG_TO_RAD; }

void seedAttitude() {
  sensors_event_t a, g, temp;
  mpu.getEvent(&a, &g, &temp);
  float b[3]; bodyAccel(a, b);
  tiltX = accelTiltX(b);
  tiltY = accelTiltY(b);
  gx = gy = 0; ix = iy = 0;
  aborted = false; uprightSince = 0;
}

void calibrateGyro() {
  // Keep the rocket still during startup
  const int N = 500;
  sensors_event_t a, g, temp;
  for (int i = 0; i < N; i++) {
    mpu.getEvent(&a, &g, &temp);
    biasX += g.gyro.x; biasY += g.gyro.y; biasZ += g.gyro.z;
    delay(2);
  }
  biasX /= N; biasY /= N; biasZ /= N;
  seedAttitude();
}

// One axis of the controller. Positive tilt -> positive gimbal (the nozzle tilts the same way,
// so the thrust pushes the base back under the rocket).
void gimbalStep(float angle, float rate, float &g, float &integ, float dt) {
  if (aborted) { g = 0; integ = 0; return; }          // centre at once
  float step = GRATE * dt;
  if (throttle > 0.05) {
    float scale = THRUST_REF_G / max(THRUST_MAX_G * throttle, 50.0f);
    if (freeTest) scale *= FREE_TEST_GAIN;
    integ = constrain(integ + angle * dt, -I_MAX / KI_G, I_MAX / KI_G);
    float cmd = constrain(scale * (KP_G * angle + KD_G * rate + KI_G * integ), -GMAX, GMAX);
    g += constrain(cmd - g, -step, step);
  } else {
    integ = 0;
    g += constrain(-g, -step, step);   // engine off: nozzle re-centres
  }
}

float servoDeg(float g, int dir, int center) {
  float a = center + dir * g * RAD_TO_DEG * cfg.servoPerGimbal;
  return constrain(a, center - SERVO_RANGE, center + SERVO_RANGE);   // safe servo limits
}

void checkAbort() {
  if (freeTest) return;
  float tilt = max(fabs(tiltX), fabs(tiltY));
  if (!aborted) {
    if (tilt > ABORT_TILT) { aborted = true; uprightSince = 0; Serial.println("ABORT,TILT"); }
    return;
  }
  if (tilt > REARM_TILT) { uprightSince = 0; return; }
  if (!uprightSince) uprightSince = millis() | 1;
  else if (millis() - uprightSince >= REARM_MS) { aborted = false; uprightSince = 0; Serial.println("ABORT,CLEAR"); }
}

// ---------- Serial commands ----------
char cmdBuf[40];
byte cmdLen = 0;

void runCommand(char *line) {
  for (char *p = line; *p; p++) *p = toupper(*p);
  char *cmd = strtok(line, " ");
  if (!cmd) return;
  char *arg1 = strtok(NULL, " ");
  char *arg2 = strtok(NULL, " ");

  if (!strcmp(cmd, "CAL")) {
    calMode = true; pulseAxis = 0;
    xServo.writeMicroseconds(servoUs(cfg.xCenter)); yServo.writeMicroseconds(servoUs(cfg.yCenter));
    Serial.println("CAL,ON");
    printConfig();
  } else if (!strcmp(cmd, "RUN")) {
    calMode = false; pulseAxis = 0;
    seedAttitude();
    lastLoop = micros();
    Serial.println("CAL,OFF");
  } else if (!strcmp(cmd, "GET")) {
    printConfig();
  } else if (!strcmp(cmd, "SET") && arg1 && arg2) {
    float v = atof(arg2);
    if      (!strcmp(arg1, "XC"))   cfg.xCenter = constrain((int)round(v), 45, 135);
    else if (!strcmp(arg1, "YC"))   cfg.yCenter = constrain((int)round(v), 45, 135);
    else if (!strcmp(arg1, "XD"))   cfg.xDir = v < 0 ? -1 : 1;
    else if (!strcmp(arg1, "YD"))   cfg.yDir = v < 0 ? -1 : 1;
    else if (!strcmp(arg1, "TX"))   cfg.tiltXTrim = constrain(v, -45, 45);
    else if (!strcmp(arg1, "TY"))   cfg.tiltYTrim = constrain(v, -45, 45);
    else if (!strcmp(arg1, "SPG"))  cfg.servoPerGimbal = constrain(v, 0.2, 8);
    else if (!strcmp(arg1, "SWAP")) { cfg.swapPins = v != 0; attachServos(); }
    else if (!strcmp(arg1, "UP")) {
      int u = (int)round(v);
      if (u == 0 || abs(u) > 3) { Serial.println("ERR,UP is 1..3 or -1..-3"); return; }
      if (u != cfg.up) cfg.rot = 0;
      cfg.up = u;
    }
    else if (!strcmp(arg1, "ROT")) {
      // The trims are stored in the rocket frame, so they turn with it: each +1 step, X takes Y and Y takes -X.
      uint8_t r = (((int)round(v)) % 4 + 4) % 4;
      for (uint8_t n = (r + 4 - cfg.rot) % 4; n > 0; n--) {
        float t = cfg.tiltXTrim;
        cfg.tiltXTrim = cfg.tiltYTrim;
        cfg.tiltYTrim = -t;
      }
      cfg.rot = r;
    }
    else { Serial.println("ERR,unknown key"); return; }
    cfgDirty = true;
    printConfig();
  } else if (!strcmp(cmd, "LEVEL")) {
    // Average the accelerometer, find which sensor axis carries gravity (= up the rocket), then trim.
    sensors_event_t a, g, temp;
    float s[3] = { 0, 0, 0 };
    for (int i = 0; i < 100; i++) {
      mpu.getEvent(&a, &g, &temp);
      s[0] += a.acceleration.x; s[1] += a.acceleration.y; s[2] += a.acceleration.z;
      delay(5);
    }
    int k = 0;
    for (int i = 1; i < 3; i++) if (fabs(s[i]) > fabs(s[k])) k = i;
    int u = (s[k] > 0 ? 1 : -1) * (k + 1);
    if (u != cfg.up) { cfg.up = u; cfg.rot = 0; }
    float b[3]; toBody(s[0], s[1], s[2], b);
    cfg.tiltXTrim = constrain(tiltFromX(b) * RAD_TO_DEG, -45, 45);
    cfg.tiltYTrim = constrain(tiltFromY(b) * RAD_TO_DEG, -45, 45);
    cfgDirty = true;
    printConfig();
  } else if (!strcmp(cmd, "PULSE") && arg1) {
    if (!calMode) { Serial.println("ERR,PULSE needs CAL"); return; }
    if (arg1[0] != 'X' && arg1[0] != 'Y') { Serial.println("ERR,PULSE X or Y"); return; }
    pulseAxis = arg1[0];
    pulseDeg = arg2 ? constrain(atoi(arg2), 3, 30) : 15;
    pulseEnd = millis() + 1200;
  } else if (!strcmp(cmd, "SAVE")) {
    saveConfig();
    printConfig();
  } else if (!strcmp(cmd, "LOAD")) {
    loadConfig(); attachServos();
    printConfig();
  } else if (!strcmp(cmd, "DEFAULTS")) {
    loadDefaults(); cfgDirty = true; attachServos();
    printConfig();
  } else if (!strcmp(cmd, "FREE") && arg1 && (!strcmp(arg1, "ON") || !strcmp(arg1, "OFF"))) {
    freeTest = !strcmp(arg1, "ON");
    aborted = false; uprightSince = 0;   // switching on releases a held abort; switching off re-checks the tilt
    Serial.println(freeTest ? "FREE,ON" : "FREE,OFF");
  } else {
    Serial.println("ERR,unknown command");
  }
}

void pollSerial() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (cmdLen) { cmdBuf[cmdLen] = 0; runCommand(cmdBuf); cmdLen = 0; }
    } else if (cmdLen < sizeof(cmdBuf) - 1) {
      cmdBuf[cmdLen++] = c;
    }
  }
}

// ---------- Calibration loop ----------
void calLoop() {
  if (pulseAxis && (long)(millis() - pulseEnd) >= 0) pulseAxis = 0;
  // A pulse imitates the controller's response to a lean toward +X/+Y: the gimbal angle has
  // the same sign as the tilt, so the servo goes centre + dir*deg.
  int xa = cfg.xCenter + (pulseAxis == 'X' ? cfg.xDir * pulseDeg : 0);
  int ya = cfg.yCenter + (pulseAxis == 'Y' ? cfg.yDir * pulseDeg : 0);
  xServo.writeMicroseconds(servoUs(xa));
  yServo.writeMicroseconds(servoUs(ya));

  if (millis() - lastTelemetry >= TELEMETRY_MS) {
    lastTelemetry = millis();
    sensors_event_t a, g, temp;
    mpu.getEvent(&a, &g, &temp);
    float b[3]; bodyAccel(a, b);
    Serial.print("CAL,");
    Serial.print(xa); Serial.print(',');
    Serial.print(ya); Serial.print(',');
    Serial.print(tiltFromX(b) * RAD_TO_DEG, 2); Serial.print(',');
    Serial.println(tiltFromY(b) * RAD_TO_DEG, 2);
  }
}

void setup() {
  Serial.begin(115200);
  while (!Serial) {
    delay(10);
  }
  Serial.print("TVC firmware v");
  Serial.println(FW_VERSION);

  loadConfig();
  attachServos();   // centres the nozzle

  // Initialize MPU6050
  if (!mpu.begin()) {
    Serial.println("Failed to find MPU6050 chip");
    while (1) {
      delay(10);
    }
  }
  Wire.setClock(400000);

  mpu.setAccelerometerRange(MPU6050_RANGE_8_G);
  mpu.setGyroRange(MPU6050_RANGE_500_DEG);
  mpu.setFilterBandwidth(MPU6050_BAND_44_HZ);

  Serial.println("Calibrating gyro - keep still...");
  calibrateGyro();
  printConfig();
  Serial.println("FREE,OFF");
  Serial.println("TVC Gimbal Hardware Initialized!");
  lastLoop = micros();
}

void loop() {
  pollSerial();
  if (calMode) { calLoop(); return; }

  unsigned long now = micros();
  if (now - lastLoop < LOOP_US) return;
  float dt = (now - lastLoop) * 1e-6;
  lastLoop = now;

  sensors_event_t a, g, temp;
  mpu.getEvent(&a, &g, &temp);
  float acc[3], w[3];
  bodyAccel(a, acc);
  toBody(g.gyro.x - biasX, g.gyro.y - biasY, g.gyro.z - biasZ, w);   // body rates (rad/s)

  float rateX    = w[1];      // lean toward X = rotation about the rocket's Y axis
  float rateY    = -w[0];     // lean toward Y = rotation about the rocket's X axis
  float rollRate = w[2];      // no magnetometer, so roll is gyro-only and will drift

  tiltX = ALPHA * (tiltX + rateX * dt) + (1 - ALPHA) * accelTiltX(acc);
  tiltY = ALPHA * (tiltY + rateY * dt) + (1 - ALPHA) * accelTiltY(acc);
  roll += rollRate * dt;

  checkAbort();
  gimbalStep(tiltX, rateX, gx, ix, dt);
  gimbalStep(tiltY, rateY, gy, iy, dt);

  float xDeg = servoDeg(gx, cfg.xDir, cfg.xCenter);
  float yDeg = servoDeg(gy, cfg.yDir, cfg.yCenter);

  // Move the servos
  xServo.writeMicroseconds(servoUs(xDeg));
  yServo.writeMicroseconds(servoUs(yDeg));

  // Send comma-separated values for the visualizer: roll,pitch(X),yaw(Y)
  // Servo angles are sent relative to 90 so the visualizer's "90 = upright" still holds after trimming.
  if (millis() - lastTelemetry >= TELEMETRY_MS) {
    lastTelemetry = millis();
    Serial.print(roll * RAD_TO_DEG, 1);
    Serial.print(",");
    if (TELEMETRY_SERVO) {
      Serial.print(90 + (int)round(xDeg - cfg.xCenter));
      Serial.print(",");
      Serial.println(90 + (int)round(yDeg - cfg.yCenter));
    } else {
      Serial.print(tiltX * RAD_TO_DEG, 1);
      Serial.print(",");
      Serial.println(tiltY * RAD_TO_DEG, 1);
    }
  }
}
