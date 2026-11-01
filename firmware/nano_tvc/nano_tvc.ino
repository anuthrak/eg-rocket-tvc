#include <Wire.h>
#include <EEPROM.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <Servo.h>

// TVC gimbal controller — mirrors dynStep() in tvc-visualizer.html (Mission tab):
//   PD controller -> gimbal command, clamped to ±GMAX, slew-rate limited to GRATE.
// Hardware: Arduino Nano + MPU6050 + 2 servos. No A2212 motor/ESC yet, so throttle is fixed.
//
// Axes (as printed on the MPU6050 board, Z pointing up the rocket):
//   D9  = X-axis servo: corrects lean toward ±X  (shown as "pitch" in the visualizer)
//   D10 = Y-axis servo: corrects lean toward ±Y  (shown as "yaw"   in the visualizer)
//
// Calibration: Bench tab → Gimbal → Calibrate (the visualizer drives the commands below), or type
// them into the Serial Monitor at 115200 with a newline. Saved values live in EEPROM and survive
// power-off and re-uploads; the DEFAULTS block is only used until something is saved.
//
//   CAL               enter calibration: controller paused, servos held at centre, streams
//                     CAL,<xServo>,<yServo>,<rawTiltX>,<rawTiltY>
//   RUN               back to flight mode
//   GET               print the config line: CFG,xc,yc,xd,yd,tx,ty,spg,swap,<SAVED|UNSAVED|DEFAULT>
//   SET <key> <val>   keys: XC YC (servo centre, deg)  XD YD (direction ±1)  TX TY (level trim, deg)
//                           SPG (servo deg per gimbal deg)  SWAP (0/1: swap the D9/D10 roles)
//   LEVEL             rocket upright and still: capture TX/TY from the accelerometer
//   PULSE X|Y [deg]   (CAL only) move one servo the way the controller would for a lean toward +X/+Y
//   SAVE              write the config to EEPROM
//   LOAD              discard unsaved changes (reload EEPROM, or the defaults if nothing is saved)
//   DEFAULTS          load the DEFAULTS block (not saved until SAVE)

// Printed at boot; the visualizer shows it in the LINK table. Bump with CHANGELOG.md.
const char FW_VERSION[] = "1.2.0";

// ===================== DEFAULTS =====================
const int X_SERVO_PIN = 9;
const int Y_SERVO_PIN = 10;
const int   X_CENTER = 90, Y_CENTER = 90;   // write() angle with the nozzle dead straight
const int   X_DIR = 1, Y_DIR = 1;           // -1 if that servo pushes the wrong way
const float SERVO_PER_GIMBAL = 1.0;         // linkage ratio: servo degrees per gimbal degree
const float TILT_X_TRIM = 0.0, TILT_Y_TRIM = 0.0;   // tilt the sensor reads when truly upright (deg)
const int   SERVO_RANGE = 45;               // max servo travel either side of centre (deg)
// ====================================================

Adafruit_MPU6050 mpu;
Servo xServo;
Servo yServo;

// ---------- Controller constants (same as the visualizer) ----------
const float KP    = 9.0;            // proportional gain   (uP = 9·e − 5·w)
const float KD    = 5.0;            // derivative gain
const float KT    = 30.0;           // gimbal authority (thrust torque ≈ −KT·thr·sin(gimbal))
const float GMAX  = 8.0 * DEG_TO_RAD;   // gimbal limit
const float GRATE = 60.0 * DEG_TO_RAD;  // servo slew-rate limit (rad/s)

// No motor yet: run as if the engine is at full throttle so the gimbal always steers.
// Once the A2212 + ESC is in, set this from the throttle command (below 0.05 the nozzle re-centres).
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
};
const uint16_t CFG_MAGIC = 0x7C12;
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
}

bool cfgValid(const Config &c) {
  return c.magic == CFG_MAGIC &&
         c.xCenter >= 45 && c.xCenter <= 135 && c.yCenter >= 45 && c.yCenter <= 135 &&
         (c.xDir == 1 || c.xDir == -1) && (c.yDir == 1 || c.yDir == -1) &&
         fabs(c.tiltXTrim) <= 45 && fabs(c.tiltYTrim) <= 45 &&
         c.servoPerGimbal >= 0.2 && c.servoPerGimbal <= 5 && c.swapPins <= 1;
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
  Serial.println(cfgDirty ? "UNSAVED" : cfgSaved ? "SAVED" : "DEFAULT");
}

void attachServos() {
  xServo.detach(); yServo.detach();
  xServo.attach(cfg.swapPins ? Y_SERVO_PIN : X_SERVO_PIN);
  yServo.attach(cfg.swapPins ? X_SERVO_PIN : Y_SERVO_PIN);
  xServo.write(cfg.xCenter);
  yServo.write(cfg.yCenter);
}

// ---------- State ----------
float tiltX = 0, tiltY = 0, roll = 0;     // attitude (rad), 0 = upright
float gx = 0, gy = 0;                     // gimbal angles (rad)
float biasX = 0, biasY = 0, biasZ = 0;    // gyro bias (rad/s)
unsigned long lastLoop = 0, lastTelemetry = 0;

bool calMode = false;
char pulseAxis = 0;                       // 'X' / 'Y' while a PULSE is running
int pulseDeg = 15;
unsigned long pulseEnd = 0;

// Tilt from gravity, sensor Z axis = rocket long axis (pointing up)
float rawTiltX(const sensors_event_t &a) { return atan2(-a.acceleration.x, a.acceleration.z); }
float rawTiltY(const sensors_event_t &a) { return atan2(-a.acceleration.y, a.acceleration.z); }
float accelTiltX(const sensors_event_t &a) { return rawTiltX(a) - cfg.tiltXTrim * DEG_TO_RAD; }
float accelTiltY(const sensors_event_t &a) { return rawTiltY(a) - cfg.tiltYTrim * DEG_TO_RAD; }

void seedAttitude() {
  sensors_event_t a, g, temp;
  mpu.getEvent(&a, &g, &temp);
  tiltX = accelTiltX(a);
  tiltY = accelTiltY(a);
  gx = gy = 0;
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

// One axis of the TVC controller. e = target − angle (target = upright = 0).
void gimbalStep(float angle, float rate, float &g, float dt) {
  float step = GRATE * dt;
  if (throttle > 0.05) {
    float u = KP * (0 - angle) - KD * rate;
    float cmd = constrain(-u / (KT * throttle), -GMAX, GMAX);
    g += constrain(cmd - g, -step, step);
  } else {
    g += constrain(-g, -step, step);   // engine off: nozzle re-centres
  }
}

int servoAngle(float g, int dir, int center) {
  int angle = round(center + dir * g * RAD_TO_DEG * cfg.servoPerGimbal);
  return constrain(angle, center - SERVO_RANGE, center + SERVO_RANGE);   // safe servo limits
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
    xServo.write(cfg.xCenter); yServo.write(cfg.yCenter);
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
    else if (!strcmp(arg1, "SPG"))  cfg.servoPerGimbal = constrain(v, 0.2, 5);
    else if (!strcmp(arg1, "SWAP")) { cfg.swapPins = v != 0; attachServos(); }
    else { Serial.println("ERR,unknown key"); return; }
    cfgDirty = true;
    printConfig();
  } else if (!strcmp(cmd, "LEVEL")) {
    sensors_event_t a, g, temp;
    float sx = 0, sy = 0;
    for (int i = 0; i < 100; i++) {
      mpu.getEvent(&a, &g, &temp);
      sx += rawTiltX(a); sy += rawTiltY(a);
      delay(5);
    }
    cfg.tiltXTrim = constrain(sx / 100 * RAD_TO_DEG, -45, 45);
    cfg.tiltYTrim = constrain(sy / 100 * RAD_TO_DEG, -45, 45);
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
  // the same sign as the tilt (u = -KP*tilt, g = -u/KT), so the servo goes centre + dir*deg.
  int xa = cfg.xCenter + (pulseAxis == 'X' ? cfg.xDir * pulseDeg : 0);
  int ya = cfg.yCenter + (pulseAxis == 'Y' ? cfg.yDir * pulseDeg : 0);
  xServo.write(xa);
  yServo.write(ya);

  if (millis() - lastTelemetry >= TELEMETRY_MS) {
    lastTelemetry = millis();
    sensors_event_t a, g, temp;
    mpu.getEvent(&a, &g, &temp);
    Serial.print("CAL,");
    Serial.print(xa); Serial.print(',');
    Serial.print(ya); Serial.print(',');
    Serial.print(rawTiltX(a) * RAD_TO_DEG, 2); Serial.print(',');
    Serial.println(rawTiltY(a) * RAD_TO_DEG, 2);
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

  // Body rates (rad/s), signs chosen to match the accel angles above
  float rateX    = g.gyro.y - biasY;      // lean toward X = rotation about the Y axis
  float rateY    = -(g.gyro.x - biasX);   // lean toward Y = rotation about the X axis
  float rollRate = g.gyro.z - biasZ;      // no magnetometer, so roll is gyro-only and will drift

  tiltX = ALPHA * (tiltX + rateX * dt) + (1 - ALPHA) * accelTiltX(a);
  tiltY = ALPHA * (tiltY + rateY * dt) + (1 - ALPHA) * accelTiltY(a);
  roll += rollRate * dt;

  gimbalStep(tiltX, rateX, gx, dt);
  gimbalStep(tiltY, rateY, gy, dt);

  int xAngle = servoAngle(gx, cfg.xDir, cfg.xCenter);
  int yAngle = servoAngle(gy, cfg.yDir, cfg.yCenter);

  // Move the servos
  xServo.write(xAngle);
  yServo.write(yAngle);

  // Send comma-separated values for the visualizer: roll,pitch(X),yaw(Y)
  // Servo angles are sent relative to 90 so the visualizer's "90 = upright" still holds after trimming.
  if (millis() - lastTelemetry >= TELEMETRY_MS) {
    lastTelemetry = millis();
    Serial.print(roll * RAD_TO_DEG, 1);
    Serial.print(",");
    if (TELEMETRY_SERVO) {
      Serial.print(90 + (xAngle - cfg.xCenter));
      Serial.print(",");
      Serial.println(90 + (yAngle - cfg.yCenter));
    } else {
      Serial.print(tiltX * RAD_TO_DEG, 1);
      Serial.print(",");
      Serial.println(tiltY * RAD_TO_DEG, 1);
    }
  }
}
