#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <Servo.h>

// TVC gimbal controller — mirrors dynStep() in tvc-visualizer.html (Mission tab):
//   PD controller -> gimbal command, clamped to ±GMAX, slew-rate limited to GRATE.
// Hardware: Arduino Nano + MPU6050 + 2 servos. No A2212 motor/ESC yet, so throttle is fixed.

Adafruit_MPU6050 mpu;
Servo pitchServo;
Servo yawServo;

// Define servo pins
const int pitchServoPin = 9;
const int yawServoPin = 10;

// ---------- Controller constants (same as the visualizer) ----------
const float KP    = 9.0;            // proportional gain   (uP = 9·e − 5·w)
const float KD    = 5.0;            // derivative gain
const float KT    = 30.0;           // gimbal authority (thrust torque ≈ −KT·thr·sin(gimbal))
const float GMAX  = 8.0 * DEG_TO_RAD;   // gimbal limit
const float GRATE = 60.0 * DEG_TO_RAD;  // servo slew-rate limit (rad/s)

// No motor yet: run as if the engine is at full throttle so the gimbal always steers.
// Once the A2212 + ESC is in, set this from the throttle command (below 0.05 the nozzle re-centres).
float throttle = 1.0;

// ---------- Hardware mapping ----------
const float SERVO_PER_GIMBAL = 1.0; // servo degrees per gimbal degree (linkage ratio)
const int   PITCH_DIR = 1;          // flip to -1 if that servo pushes the wrong way
const int   YAW_DIR   = 1;
const float PITCH_TRIM = 0.0;       // degrees; adjust if "upright" doesn't read 0
const float YAW_TRIM   = 0.0;

// Complementary filter: trust the gyro short-term, the accelerometer long-term
const float ALPHA = 0.98;

// Telemetry: true = servo angles (90 = neutral), matches the visualizer's default
// "Data is servo angles" checkbox. false = vehicle attitude in degrees (untick that box).
const bool TELEMETRY_SERVO = true;

const unsigned long LOOP_US = 10000;      // 100 Hz control loop
const unsigned long TELEMETRY_MS = 50;    // 20 Hz serial output

// ---------- State ----------
float pitch = 0, yaw = 0, roll = 0;       // attitude (rad), pitch/yaw 0 = upright
float gp = 0, gy = 0;                     // gimbal angles (rad)
float biasX = 0, biasY = 0, biasZ = 0;    // gyro bias (rad/s)
unsigned long lastLoop = 0, lastTelemetry = 0;

// Tilt from gravity, sensor Z axis = rocket long axis (pointing up)
float accelPitch(const sensors_event_t &a) { return atan2(-a.acceleration.x, a.acceleration.z) - PITCH_TRIM * DEG_TO_RAD; }
float accelYaw(const sensors_event_t &a)   { return atan2(-a.acceleration.y, a.acceleration.z) - YAW_TRIM * DEG_TO_RAD; }

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

  mpu.getEvent(&a, &g, &temp);
  pitch = accelPitch(a);
  yaw = accelYaw(a);
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

int servoAngle(float g, int dir) {
  int angle = round(90 + dir * g * RAD_TO_DEG * SERVO_PER_GIMBAL);
  return constrain(angle, 45, 135);   // safe servo limits
}

void setup() {
  Serial.begin(115200);
  while (!Serial) {
    delay(10);
  }

  // Attach servos and centre the nozzle
  pitchServo.attach(pitchServoPin);
  yawServo.attach(yawServoPin);
  pitchServo.write(90);
  yawServo.write(90);

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
  Serial.println("TVC Gimbal Hardware Initialized!");
  lastLoop = micros();
}

void loop() {
  unsigned long now = micros();
  if (now - lastLoop < LOOP_US) return;
  float dt = (now - lastLoop) * 1e-6;
  lastLoop = now;

  sensors_event_t a, g, temp;
  mpu.getEvent(&a, &g, &temp);

  // Body rates (rad/s), signs chosen to match the accel angles above
  float pitchRate = g.gyro.y - biasY;
  float yawRate   = -(g.gyro.x - biasX);
  float rollRate  = g.gyro.z - biasZ;   // no magnetometer, so roll is gyro-only and will drift

  pitch = ALPHA * (pitch + pitchRate * dt) + (1 - ALPHA) * accelPitch(a);
  yaw   = ALPHA * (yaw + yawRate * dt)     + (1 - ALPHA) * accelYaw(a);
  roll += rollRate * dt;

  gimbalStep(pitch, pitchRate, gp, dt);
  gimbalStep(yaw, yawRate, gy, dt);

  int pitchAngle = servoAngle(gp, PITCH_DIR);
  int yawAngle   = servoAngle(gy, YAW_DIR);

  // Move the servos
  pitchServo.write(pitchAngle);
  yawServo.write(yawAngle);

  // Send comma-separated values for the visualizer: roll,pitch,yaw
  if (millis() - lastTelemetry >= TELEMETRY_MS) {
    lastTelemetry = millis();
    Serial.print(roll * RAD_TO_DEG, 1);
    Serial.print(",");
    if (TELEMETRY_SERVO) {
      Serial.print(pitchAngle);
      Serial.print(",");
      Serial.println(yawAngle);
    } else {
      Serial.print(pitch * RAD_TO_DEG, 1);
      Serial.print(",");
      Serial.println(yaw * RAD_TO_DEG, 1);
    }
  }
}
