// Temporary, receive-only 433.92 MHz PLL check for the wired CC1101.
// Serial 115200: P runs five calibrations, ending in IDLE.
// No TX strobe, IR output, microphone changes or persistent radio settings.
#include <SPI.h>

constexpr int SCK_PIN = 18, MISO_PIN = 19, MOSI_PIN = 23, CS_PIN = 5;
constexpr int DATA_PIN = 4, LOCK_PIN = 22;
const SPISettings settings(1000000, MSBFIRST, SPI_MODE0);

constexpr uint8_t SRES = 0x30, SRX = 0x34, SIDLE = 0x36;
constexpr uint8_t PARTNUM = 0x30, VERSION = 0x31, MARCSTATE = 0x35;
constexpr uint8_t FSCAL1 = 0x25;
constexpr int STATE_IDLE = 0x01, STATE_RX = 0x0D;
constexpr uint8_t TRIALS = 5;

struct RegisterSetting { uint8_t address, value; };
constexpr RegisterSetting setupRegisters[] = {
  {0x00, 0x0A}, // IOCFG2: PLL lock output
  {0x02, 0x2E}, // IOCFG0: high impedance
  {0x0A, 0x00}, // CHANNR: channel zero
  {0x0C, 0x00}, // FSCTRL0: no frequency offset
  {0x0D, 0x10}, {0x0E, 0xB0}, {0x0F, 0x71}, // 433.92 MHz, nominal 26 MHz crystal
  {0x17, 0x3C}, // MCSM1: remain in RX after a received packet
  {0x18, 0x18}, // MCSM0: calibrate on IDLE to RX
  // Same 433 MHz synthesizer settings as PixMobRFTest.
  {0x23, 0xE9}, {0x24, 0x2A}, {FSCAL1, 0x00}, {0x26, 0x1F},
  {0x2E, 0x09}, // TEST0: VCO calibration setting
};
volatile bool lockRise = false;

void ARDUINO_ISR_ATTR recordLockRise() { lockRise = true; }

bool waitReady() {
  const uint32_t start = micros();
  while (digitalRead(MISO_PIN) == HIGH)
    if (micros() - start >= 5000) return false;
  return true;
}

bool transfer(uint8_t header, int data, uint8_t *read = nullptr) {
  SPI.beginTransaction(settings);
  digitalWrite(CS_PIN, LOW);
  bool ok = waitReady();
  if (ok) {
    SPI.transfer(header);
    if (data >= 0) {
      const uint8_t value = SPI.transfer(uint8_t(data));
      if (read) *read = value;
    } else if (header == SRES) {
      ok = waitReady();
    }
  }
  digitalWrite(CS_PIN, HIGH);
  SPI.endTransaction();
  return ok;
}

int readReg(uint8_t address, bool status = false) {
  uint8_t value = 0;
  return transfer(address | (status ? 0xC0 : 0x80), 0, &value) ? value : -1;
}

int readState() {
  const int state = readReg(MARCSTATE, true);
  return state < 0 ? state : state & 0x1F;
}

bool waitState(int expected) {
  const uint32_t start = micros();
  int previous = -1;
  while (micros() - start < 15000) {
    const int now = readState();
    if (now == expected && previous == expected) return true;
    previous = now;
    delayMicroseconds(40);
  }
  return false;
}

bool configure() {
  digitalWrite(CS_PIN, HIGH);
  delayMicroseconds(5);
  digitalWrite(CS_PIN, LOW);
  delayMicroseconds(10);
  digitalWrite(CS_PIN, HIGH);
  delayMicroseconds(45);
  if (!transfer(SRES, -1) || !waitState(STATE_IDLE)) return false;
  const int part = readReg(PARTNUM, true), version = readReg(VERSION, true);
  Serial.printf("PARTNUM=%02X VERSION=%02X\n", unsigned(part), unsigned(version));
  if (part != 0 || (version != 0x14 && version != 0x04)) return false;
  for (const RegisterSetting& reg : setupRegisters)
    if (!transfer(reg.address, reg.value) || readReg(reg.address) != reg.value) return false;
  Serial.println("FREQ=10B071 nominal 433.920 MHz; CHANNR=0; FSCTRL0=0");
  return true;
}

void checkPll() {
  Serial.println("PLL CHECK BEGIN (RX only)");
  if (!configure()) {
    Serial.println("PLL RESULT setup failed");
    return;
  }
  unsigned passed = 0;
  attachInterrupt(digitalPinToInterrupt(LOCK_PIN), recordLockRise, RISING);
  for (unsigned trial = 1; trial <= TRIALS; ++trial) {
    const bool idleBefore = transfer(SIDLE, -1) && waitState(STATE_IDLE);
    const bool lowBefore = digitalRead(LOCK_PIN) == LOW;
    lockRise = false;
    const bool reachedRx = idleBefore && transfer(SRX, -1) && waitState(STATE_RX);
    const int cal = readReg(FSCAL1);
    delayMicroseconds(1000);
    const int confirm = readReg(FSCAL1);
    const bool inRx = reachedRx && waitState(STATE_RX);
    const bool rise = lockRise, high = digitalRead(LOCK_PIN) == HIGH;
    const bool idleAfter = transfer(SIDLE, -1) && waitState(STATE_IDLE);
    const bool lowAfter = digitalRead(LOCK_PIN) == LOW;
    // TI errata SWRZ020E: use an interrupt for the lock signal, or a valid
    // FSCAL1 value other than 0x3F after calibration. Require both indicators.
    const bool locked = inRx && cal >= 0 && cal < 0x3F && cal == confirm &&
                        lowBefore && (rise || high) && idleAfter && lowAfter;
    if (locked) ++passed;
    Serial.printf("trial=%u RX=%u FSCAL1=%02X/%02X GDO2 idle_low=%u rise=%u rx_high=%u "
                  "exit_idle=%u idle_low=%u %s\n",
                  trial, inRx, unsigned(cal), unsigned(confirm), lowBefore, rise, high,
                  idleAfter, lowAfter, locked ? "LOCK" : "UNCONFIRMED");
    delay(100);
  }
  detachInterrupt(digitalPinToInterrupt(LOCK_PIN));
  Serial.printf("PLL RESULT %u/%u locked (RX only)\n", passed, TRIALS);
}

void setup() {
  Serial.begin(115200);
  pinMode(CS_PIN, OUTPUT);
  digitalWrite(CS_PIN, HIGH);
  pinMode(DATA_PIN, INPUT);
  pinMode(LOCK_PIN, INPUT);
  SPI.begin(SCK_PIN, MISO_PIN, MOSI_PIN, -1);
  Serial.println("CC1101 PLL CHECK READY (P, RX only)");
}

void loop() {
  if (Serial.available() && Serial.read() == 'P') checkPll();
  delay(1);
}
