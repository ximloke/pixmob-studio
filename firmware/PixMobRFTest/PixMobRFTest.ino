// PixMob RF colour test for the ESP32 DevKit + CC1101 433 MHz module.
//
// Sends PixMob RF colour frames (public protocol, see PixMobRFFrame.h) so we
// can see whether the user's band reacts to radio at all. Limits enforced here:
//   - only plain colour frames for group 0; settings / EEPROM frames cannot be
//     built (PixMobRFFrame.h has no such function);
//   - carrier only at 433.10-434.70 MHz or 919.10-922.90 MHz, inside
//     Malaysian short-range device bands (see PixMobRFLimits.h); 433.92 MHz
//     after every reset;
//   - output power -30 .. +10 dBm, 0 dBm after every reset;
//   - each colour command sends one short burst (default 3 s, at most 10 s),
//     Z one fixed 40 s wake test, and the radio then goes back to IDLE;
//     nothing is sent at power-up;
//   - before every burst the frequency, modulation and power registers are read
//     back, and the burst is refused if they differ from what was written.
//
// Wiring, as checked with firmware/CC1101Check/ (header number -> ESP32):
//   1 GND -> GND      2 VCC  -> 3V3 (never 5 V)
//   3 GDO0 -> GPIO4   4 CSN  -> GPIO5
//   5 SCK -> GPIO18   6 MOSI -> GPIO23
//   7 MISO -> GPIO19  8 GDO2 -> GPIO22 (not used, left high-impedance)
// The IR LED (GPIO32) and microphone (GPIO26/25/27) are not touched.
//
// CC1101 runs in asynchronous serial OOK: while in TX, GDO0 is the data input
// and a high level switches the carrier on. GDO0 stays high-impedance on the
// CC1101 side (IOCFG0 0x2E) and is driven by the ESP32 only while in TX.
//
// Serial 115200, one command per line:
//   ?            help
//   S            status: chip ID, frequency, power, register check
//   F433.92      set frequency in MHz (433.10-434.70 or 919.10-922.90)
//   P0           set power in dBm: -30 -20 -15 -10 0 5 7 10 (TI PATABLE value
//                for the band in use)
//   D3000        burst length in ms (200 - 10000)
//   R G B Y C M W  send red / green / blue / yellow / cyan / magenta / white
//   K            send black (all LEDs off)
//   #RRGGBB      send a hex colour
//   I50          frame interval in ms (50 - 1000); venue captures repeat a
//                frame every ~50 ms, so 50 ms is the default
//   Z / Z60      wake test: 35 s (or 5-90 s) of the published "nothing" frame (wakes a
//                sleeping band, lights nothing), then 5 s of the published
//                red "wine_fade_in" frame, every 50 ms, in one TX period
//   T            sweep: 6 frequencies, each with its own colour, 2 s each
//   Q            wide sweep: 433.10-434.70 MHz in 36 steps of ~46 kHz, 0.5 s
//                each; every 6 steps share a colour (red, green, blue,
//                yellow, cyan, white from low to high frequency)
//   X            stop a running burst or sweep
//   LINK         433.92 MHz reference pulse capture, alternating RF and control

#include <SPI.h>
#include "PixMobRFFrame.h"
#include "PixMobRFLimits.h"

const int PIN_SCK = 18;
const int PIN_MISO = 19;
const int PIN_MOSI = 23;
const int PIN_CS = 5;
const int PIN_GDO0 = 4;
const int PIN_GDO2 = 22;
// Temporary input only. Use after identifying the wristband DOUT and its voltage.
const int PIN_BAND_DATA = 34;

const SPISettings spiSettings(1000000, MSBFIRST, SPI_MODE0);

// Registers and strobes used here.
enum : uint8_t {
  IOCFG2 = 0x00, IOCFG0 = 0x02, FIFOTHR = 0x03, PKTCTRL1 = 0x07, PKTCTRL0 = 0x08,
  CHANNR = 0x0A, FSCTRL1 = 0x0B, FSCTRL0 = 0x0C, FREQ2 = 0x0D, FREQ1 = 0x0E,
  FREQ0 = 0x0F, MDMCFG4 = 0x10, MDMCFG3 = 0x11, MDMCFG2 = 0x12, MDMCFG1 = 0x13,
  MDMCFG0 = 0x14, DEVIATN = 0x15, MCSM1 = 0x17, MCSM0 = 0x18, FOCCFG = 0x19,
  BSCFG = 0x1A, AGCCTRL2 = 0x1B, AGCCTRL1 = 0x1C, AGCCTRL0 = 0x1D, FREND1 = 0x21,
  FREND0 = 0x22, FSCAL3 = 0x23, FSCAL2 = 0x24, FSCAL1 = 0x25, FSCAL0 = 0x26,
  FSTEST = 0x29, TEST2 = 0x2C, TEST1 = 0x2D, TEST0 = 0x2E, PATABLE = 0x3E,
  PARTNUM = 0x30, VERSION = 0x31, MARCSTATE = 0x35,
  SRES = 0x30, STX = 0x35, SIDLE = 0x36,
};
const uint8_t GDO_HIGH_Z = 0x2E;
const uint8_t GDO_ASYNC_DATA = 0x0D;
const uint8_t GDO_DRIVE_LOW = 0x2F;   // constant 0
const uint8_t GDO_DRIVE_HIGH = 0x6F;  // constant 0, inverted: constant 1
const uint8_t STATE_IDLE = 0x01;
const uint8_t STATE_TX = 0x13;

struct Setting { uint8_t address; uint8_t value; };
// Asynchronous serial OOK transmit set-up; values as used by the SmartRC
// CC1101 driver / TI SmartRF for the 433 MHz band, FSCTRL0 left at 0.
// The same values serve 919-923 MHz: SmartRC's Calibrate() sets TEST0 0x09
// and the high VCO (FSCAL2 bit 5) above 430.5 MHz in the 433 MHz band and
// for 900-928 MHz alike; only the PATABLE value changes (PixMobRFLimits.h).
const Setting kSetup[] = {
    {IOCFG2, GDO_HIGH_Z}, {IOCFG0, GDO_HIGH_Z}, {FIFOTHR, 0x47}, {PKTCTRL1, 0x04},
    {PKTCTRL0, 0x32},  // asynchronous serial mode, infinite length
    {CHANNR, 0x00}, {FSCTRL1, 0x06}, {FSCTRL0, 0x00},
    {MDMCFG4, 0x07}, {MDMCFG3, 0x93},  // ~5 kBaud sampling for the 2 kBaud bits
    {MDMCFG2, 0x30},                   // OOK, no sync word
    {MDMCFG1, 0x02}, {MDMCFG0, 0xF8}, {DEVIATN, 0x47},
    {MCSM1, 0x30},                     // back to IDLE after TX
    {MCSM0, 0x18},                     // calibrate on IDLE -> TX
    {FOCCFG, 0x16}, {BSCFG, 0x1C}, {AGCCTRL2, 0xC7}, {AGCCTRL1, 0x00}, {AGCCTRL0, 0xB2},
    {FREND1, 0x56}, {FREND0, 0x11},    // OOK: PATABLE[0] for 0, PATABLE[1] for 1
    {FSCAL3, 0xE9}, {FSCAL2, 0x2A}, {FSCAL1, 0x00}, {FSCAL0, 0x1F},
    {FSTEST, 0x59}, {TEST2, 0x81}, {TEST1, 0x35}, {TEST0, 0x09},
};

float currentMhz = 433.92f;
int currentDbm = 0;
uint8_t currentPa = 0x60;
uint32_t burstMs = 3000;
uint32_t framePeriodMs = 50;
bool chipOk = false;
String line;

// Result of sending frames in one TX period. Defined before the first function
// so the prototypes the Arduino builder generates can use it.
struct TxStats {
  uint32_t frames = 0;
  uint32_t worstLate = 0;
  bool stopped = false;
  // TX monitor: first frame before which the radio was found out of TX or
  // with its frequency register changed (a CC1101 reset restores FREQ2 0x1E).
  bool lost = false;
  uint32_t lostBefore = 0;
  int lostState = -1;
  int lostFreq2 = -1;
};

// ---------------------------------------------------------------- SPI access

bool waitReady() {
  const uint32_t start = micros();
  while (digitalRead(PIN_MISO) == HIGH)
    if (micros() - start > 5000) return false;
  return true;
}

void writeRegister(uint8_t address, uint8_t value) {
  SPI.beginTransaction(spiSettings);
  digitalWrite(PIN_CS, LOW);
  waitReady();
  SPI.transfer(address);
  SPI.transfer(value);
  digitalWrite(PIN_CS, HIGH);
  SPI.endTransaction();
}

int readRegister(uint8_t address, bool statusRegister = false) {
  SPI.beginTransaction(spiSettings);
  digitalWrite(PIN_CS, LOW);
  const bool ready = waitReady();
  SPI.transfer(address | 0x80 | (statusRegister ? 0x40 : 0x00));
  const uint8_t value = SPI.transfer(0x00);
  digitalWrite(PIN_CS, HIGH);
  SPI.endTransaction();
  return ready ? value : -1;
}

void strobe(uint8_t command) {
  SPI.beginTransaction(spiSettings);
  digitalWrite(PIN_CS, LOW);
  waitReady();
  SPI.transfer(command);
  digitalWrite(PIN_CS, HIGH);
  SPI.endTransaction();
}

// MARCSTATE can glitch while the state changes, so read until two agree.
int radioState() {
  int last = -2;
  for (int i = 0; i < 6; ++i) {
    const int now = readRegister(MARCSTATE, true);
    if (now == last) return now < 0 ? now : (now & 0x1F);
    last = now;
  }
  return last < 0 ? last : (last & 0x1F);
}

bool waitState(uint8_t state, uint32_t timeoutMicros) {
  const uint32_t start = micros();
  while (micros() - start < timeoutMicros)
    if (radioState() == state) return true;
  return false;
}

void writePaTable() {
  SPI.beginTransaction(spiSettings);
  digitalWrite(PIN_CS, LOW);
  waitReady();
  SPI.transfer(PATABLE | 0x40);
  SPI.transfer(0x00);  // OOK "0": carrier off
  SPI.transfer(currentPa);
  digitalWrite(PIN_CS, HIGH);
  SPI.endTransaction();
}

void readPaTable(uint8_t& zero, uint8_t& one) {
  SPI.beginTransaction(spiSettings);
  digitalWrite(PIN_CS, LOW);
  waitReady();
  SPI.transfer(PATABLE | 0xC0);
  zero = SPI.transfer(0x00);
  one = SPI.transfer(0x00);
  digitalWrite(PIN_CS, HIGH);
  SPI.endTransaction();
}

// ---------------------------------------------------------------- radio set-up

uint32_t frequencyWord(float mhz) { return uint32_t(double(mhz) * 65536.0 / 26.0 + 0.5); }

void writeFrequency(float mhz) {
  const uint32_t word = frequencyWord(mhz);
  writeRegister(FREQ2, uint8_t(word >> 16));
  writeRegister(FREQ1, uint8_t(word >> 8));
  writeRegister(FREQ0, uint8_t(word));
}

bool resetChip() {
  digitalWrite(PIN_CS, HIGH);
  delayMicroseconds(5);
  digitalWrite(PIN_CS, LOW);
  delayMicroseconds(10);
  digitalWrite(PIN_CS, HIGH);
  delayMicroseconds(45);
  SPI.beginTransaction(spiSettings);
  digitalWrite(PIN_CS, LOW);
  bool ok = waitReady();
  SPI.transfer(SRES);
  ok = waitReady() && ok;
  digitalWrite(PIN_CS, HIGH);
  SPI.endTransaction();
  return ok;
}

// Every register this test relies on, compared with what was written.
bool registersMatch(bool print) {
  bool ok = true;
  for (const Setting& setting : kSetup) {
    if (setting.address == IOCFG0) continue;  // changes around each frame
    // Calibration (IDLE -> TX) writes its results into FSCAL3[3:0],
    // FSCAL2[4:0] and FSCAL1; only the configuration bits are compared.
    uint8_t mask = 0xFF;
    if (setting.address == FSCAL3) mask = 0xF0;
    if (setting.address == FSCAL2) mask = 0x20;
    if (setting.address == FSCAL1) continue;
    const int value = readRegister(setting.address);
    if (value < 0 || (value & mask) != (setting.value & mask)) {
      ok = false;
      if (print) Serial.printf("  register 0x%02X reads 0x%02X, wrote 0x%02X\n", setting.address,
                               value < 0 ? 0 : value, setting.value);
    }
  }
  const uint32_t word = frequencyWord(currentMhz);
  const int f2 = readRegister(FREQ2), f1 = readRegister(FREQ1), f0 = readRegister(FREQ0);
  if (f2 != int(word >> 16 & 0xFF) || f1 != int(word >> 8 & 0xFF) || f0 != int(word & 0xFF)) {
    ok = false;
    if (print) Serial.println("  frequency registers do not match");
  }
  uint8_t zero = 0, one = 0;
  readPaTable(zero, one);
  if (zero != 0x00 || one != currentPa) {
    ok = false;
    if (print) Serial.printf("  PATABLE reads %02X %02X, wrote 00 %02X\n", zero, one, currentPa);
  }
  return ok;
}

bool setupRadio() {
  pinMode(PIN_GDO0, INPUT_PULLDOWN);
  pinMode(PIN_GDO2, INPUT_PULLUP);
  if (!resetChip()) return false;
  const int partnum = readRegister(PARTNUM, true);
  const int version = readRegister(VERSION, true);
  if (partnum != 0x00 || (version != 0x14 && version != 0x04)) return false;
  for (const Setting& setting : kSetup) writeRegister(setting.address, setting.value);
  writeFrequency(currentMhz);
  writePaTable();
  strobe(SIDLE);
  return waitState(STATE_IDLE, 5000) && registersMatch(false);
}

// ---------------------------------------------------------------- sending

bool stopRequested() {
  while (Serial.available()) {
    const int c = Serial.peek();
    if (c == 'X' || c == 'x') {
      while (Serial.available()) Serial.read();
      return true;
    }
    if (c == '\r' || c == '\n' || c == ' ') {
      Serial.read();
      continue;
    }
    return false;  // another command: leave it for after the burst
  }
  return false;
}

void releaseGdo0() {
  digitalWrite(PIN_GDO0, LOW);
  pinMode(PIN_GDO0, INPUT_PULLDOWN);
  writeRegister(IOCFG0, GDO_HIGH_Z);
}

void outputFrameBits(const uint8_t frame[pixmobrf::kFrameBytes], uint32_t start) {
  for (uint8_t i = 0; i < pixmobrf::kFrameBits; ++i) {
    digitalWrite(PIN_GDO0, pixmobrf::frameBit(frame, i) ? HIGH : LOW);
    const uint32_t end = uint32_t(i + 1) * pixmobrf::kBitMicros;
    while (micros() - start < end) {
    }
  }
  digitalWrite(PIN_GDO0, LOW);
}

// GDO0 stays high impedance on the CC1101 side (IOCFG0 0x2E): in asynchronous
// serial TX the CC1101 reads it as its data input whatever IOCFG0 says, so only
// the ESP32 drives the line, and only while the radio is in TX. (With 0x0D the
// CC1101 drives GDO0 in IDLE; on 20 November it held it high.)
// The GDO0 data wire is checked by letting the CC1101 drive it high, then low
// (the ESP32 pin is an input with pull-down meanwhile). A loose wire reads low
// both times. Leaves the CC1101 side high impedance.
bool gdo0WireOk(int& high, int& low) {
  writeRegister(IOCFG0, GDO_DRIVE_HIGH);
  delayMicroseconds(5);
  high = digitalRead(PIN_GDO0);
  writeRegister(IOCFG0, GDO_DRIVE_LOW);
  delayMicroseconds(5);
  low = digitalRead(PIN_GDO0);
  writeRegister(IOCFG0, GDO_HIGH_Z);
  delayMicroseconds(5);
  return high == HIGH && low == LOW;
}

bool enterTx() {
  int high = 0, low = 0;
  if (!gdo0WireOk(high, low)) {
    Serial.printf("REFUSED: GDO0 wire check failed (CC1101 high reads %s, low reads %s); nothing sent\n",
                  high == HIGH ? "high" : "LOW", low == HIGH ? "HIGH" : "low");
    return false;
  }
  writeRegister(IOCFG0, GDO_HIGH_Z);
  delayMicroseconds(5);
  if (readRegister(IOCFG0) != GDO_HIGH_Z || digitalRead(PIN_GDO0) != LOW) {
    Serial.println("REFUSED: GDO0 is not free with the CC1101 side high impedance; nothing sent");
    return false;
  }
  pinMode(PIN_GDO0, OUTPUT);
  digitalWrite(PIN_GDO0, LOW);
  strobe(STX);
  if (!waitState(STATE_TX, 5000)) {
    strobe(SIDLE);
    waitState(STATE_IDLE, 5000);
    releaseGdo0();
    Serial.println("REFUSED: CC1101 did not enter TX; nothing sent");
    return false;
  }
  return true;
}

// Back to IDLE; returns the state read just before (0x13 while still in TX).
int leaveTx() {
  digitalWrite(PIN_GDO0, LOW);
  const int state = radioState();
  strobe(SIDLE);
  waitState(STATE_IDLE, 5000);
  releaseGdo0();
  return state;
}

// One frame with every bit edge at an absolute time; returns the worst lateness.
uint32_t frameAt(const uint8_t frame[pixmobrf::kFrameBytes], uint32_t startUs) {
  uint32_t worst = 0;
  for (uint8_t i = 0; i <= pixmobrf::kFrameBits; ++i) {
    const uint32_t edgeAt = startUs + uint32_t(i) * pixmobrf::kBitMicros;
    while (int32_t(micros() - edgeAt) < 0) {
    }
    digitalWrite(PIN_GDO0, i < pixmobrf::kFrameBits && pixmobrf::frameBit(frame, i) ? HIGH : LOW);
    const uint32_t late = micros() - edgeAt;
    if (late > worst) worst = late;
  }
  return worst;
}

// `count` copies of `frame`, one every `periodUs`, the first at `nextStart`,
// which is left at the slot after the last frame. The radio must be in TX.
void sendFrames(const uint8_t frame[pixmobrf::kFrameBytes], uint32_t count, uint32_t periodUs,
                uint32_t& nextStart, TxStats& stats) {
  const int freq2 = int(frequencyWord(currentMhz) >> 16 & 0xFF);
  for (uint32_t n = 0; n < count && !stats.stopped; ++n) {
    // Between frames: is the radio still in TX with our frequency?
    if (!stats.lost && int32_t(nextStart - micros()) > 1000) {
      const int state = radioState();
      const int f2 = readRegister(FREQ2);
      if (state != STATE_TX || f2 != freq2) {
        stats.lost = true;
        stats.lostBefore = stats.frames;
        stats.lostState = state;
        stats.lostFreq2 = f2;
      }
    }
    // Carrier is off between frames: let other tasks run and watch for X.
    while (int32_t(nextStart - micros()) > 2000) {
      if (stopRequested()) {
        stats.stopped = true;
        return;
      }
      delay(1);
    }
    const uint32_t late = frameAt(frame, nextStart);
    if (late > stats.worstLate) stats.worstLate = late;
    ++stats.frames;
    nextStart += periodUs;
  }
}

void printTxMonitor(const TxStats& stats, uint32_t total) {
  if (!stats.lost) Serial.printf("TX MONITOR: in TX at %.3f MHz before every checked frame (%lu frames)\n", currentMhz, (unsigned long)total);
  else Serial.printf("TX MONITOR: LOST before frame %lu of %lu: state 0x%02X, FREQ2 0x%02X%s\n", (unsigned long)stats.lostBefore,
                     (unsigned long)total, stats.lostState & 0xFF, stats.lostFreq2 & 0xFF,
                     stats.lostFreq2 == 0x1E ? " (reset value: the CC1101 restarted)" : "");
}

// One frame on its own (LINK). Returns false if TX was not reached.
bool sendFrame(const uint8_t frame[pixmobrf::kFrameBytes], uint32_t* bitStart = nullptr) {
  if (!enterTx()) return false;
  const uint32_t start = micros() + pixmobrf::kStartDelayMicros;
  if (bitStart) *bitStart = start;
  frameAt(frame, start);
  leaveTx();
  return true;
}

void printFrame(const uint8_t frame[pixmobrf::kFrameBytes]) {
  for (uint8_t i = 0; i < pixmobrf::kFrameBytes; ++i) Serial.printf("%s%02x", i ? " " : "", frame[i]);
}

// Sends one colour for `durationMs`. Returns false when stopped or refused.
bool burst(uint8_t r, uint8_t g, uint8_t b, const char* name, uint32_t durationMs, bool quiet = false) {
  if (!chipOk) {
    Serial.println("REFUSED: CC1101 not ready (S for details)");
    return false;
  }
  if (radioState() != STATE_IDLE || !registersMatch(true)) {
    Serial.println("REFUSED: register check failed; nothing sent");
    return false;
  }
  uint8_t frame[pixmobrf::kFrameBytes];
  pixmobrf::colorFrame(r, g, b, pixmobrf::kDefaultTiming, frame);
  const uint32_t count = durationMs >= framePeriodMs ? durationMs / framePeriodMs : 1;
  if (!quiet) {
    Serial.printf("SEND %s (%u,%u,%u) %.3f MHz %d dBm %lu ms every %lu ms frame ", name, r, g, b,
                  currentMhz, currentDbm, (unsigned long)durationMs, (unsigned long)framePeriodMs);
    printFrame(frame);
    Serial.println();
    Serial.flush();
  }
  if (!enterTx()) return false;
  uint32_t next = micros() + pixmobrf::kStartDelayMicros;
  TxStats stats;
  sendFrames(frame, count, framePeriodMs * 1000, next, stats);
  const int state = leaveTx();
  const bool idle = radioState() == STATE_IDLE;
  Serial.printf("DONE %s %.3f MHz: %lu frames in one TX period, worst edge %lu us late, state 0x%02X before IDLE%s; radio %s\n",
                name, currentMhz, (unsigned long)stats.frames, (unsigned long)stats.worstLate, state & 0xFF,
                stats.stopped ? ", stopped by X" : "", idle ? "IDLE" : "NOT IDLE");
  printTxMonitor(stats, stats.frames);
  return !stats.stopped && state == STATE_TX && idle;
}

// Also switches the PATABLE value to the new band's entry for the current power.
bool setFrequency(float mhz) {
  uint8_t pa = 0;
  if (!pixmobrf::allowedMhz(mhz) || !pixmobrf::paValue(mhz, currentDbm, pa)) {
    Serial.printf("REFUSED: %.3f MHz is outside 433.10-434.70 and 919.10-922.90 MHz\n", mhz);
    return false;
  }
  strobe(SIDLE);
  waitState(STATE_IDLE, 5000);
  currentMhz = mhz;
  writeFrequency(currentMhz);
  currentPa = pa;
  writePaTable();
  return true;
}

constexpr uint16_t MAX_CAPTURE_EDGES = 512;
volatile uint32_t edgeTimes[MAX_CAPTURE_EDGES];
volatile uint8_t edgeLevels[MAX_CAPTURE_EDGES];
volatile uint16_t captureCount = 0;
volatile bool captureOverflow = false;

void ARDUINO_ISR_ATTR captureBandEdge() {
  const uint16_t slot = captureCount;
  if (slot >= MAX_CAPTURE_EDGES) {
    captureOverflow = true;
    return;
  }
  edgeTimes[slot] = micros();
  edgeLevels[slot] = digitalRead(PIN_BAND_DATA);
  captureCount = slot + 1;
}

// GDO0 toggles identically for the two trials. The control keeps the
// transmitter in IDLE so wired pickup can be distinguished from reception.
void captureLinkTrial(const uint8_t frame[pixmobrf::kFrameBytes], bool rf, unsigned trial) {
  captureCount = 0;
  captureOverflow = false;
  const int initial = digitalRead(PIN_BAND_DATA);
  uint32_t bitStart = 0;
  attachInterrupt(digitalPinToInterrupt(PIN_BAND_DATA), captureBandEdge, CHANGE);
  bool ready;
  if (rf) {
    ready = sendFrame(frame, &bitStart) && radioState() == STATE_IDLE;
  } else {
    ready = radioState() == STATE_IDLE &&
            readRegister(IOCFG0) == GDO_HIGH_Z && digitalRead(PIN_GDO0) == LOW;
    if (ready) {
      pinMode(PIN_GDO0, OUTPUT);
      bitStart = micros();
      outputFrameBits(frame, bitStart);
      releaseGdo0();
    }
  }
  delayMicroseconds(3000);
  detachInterrupt(digitalPinToInterrupt(PIN_BAND_DATA));
  const uint16_t count = captureCount;
  Serial.printf("LINK trial=%u rf=%u valid=%u initial=%d edges=%u overflow=%u\n",
                trial, rf, ready && !captureOverflow, initial, unsigned(count), captureOverflow);
  if (!ready || captureOverflow) return;
  for (uint16_t i = 0; i < count; ++i) {
    const int32_t offset = int32_t(edgeTimes[i] - bitStart);
    Serial.printf("%ld %u\n", long(offset), unsigned(edgeLevels[i]));
  }
}

void checkWristbandLink() {
  if (!chipOk || radioState() != STATE_IDLE) {
    Serial.println("LINK REFUSED: radio is not ready in IDLE");
    return;
  }
  const float previousMhz = currentMhz;
  const int previousDbm = currentDbm;
  const uint8_t previousPa = currentPa;
  pinMode(PIN_BAND_DATA, INPUT);
  setFrequency(433.92f);
  currentDbm = -10;
  currentPa = 0x34;
  writePaTable();
  if (registersMatch(true) && radioState() == STATE_IDLE) {
    uint8_t frame[pixmobrf::kFrameBytes];
    pixmobrf::colorFrame(0, 0, 0, pixmobrf::kDefaultTiming, frame);
    Serial.print("LINK 433.920 MHz, GPIO34, reference frame ");
    printFrame(frame);
    Serial.println();
    for (unsigned trial = 1; trial <= 6 && !stopRequested(); ++trial) {
      captureLinkTrial(frame, trial % 2 == 0, trial);
      delay(60);
    }
  } else {
    Serial.println("LINK REFUSED: register check failed");
  }
  setFrequency(previousMhz);
  currentDbm = previousDbm;
  currentPa = previousPa;
  writePaTable();
  Serial.println("LINK DONE");
}

// Each step has its own colour, so the colours seen tell which frequencies work.
struct SweepStep { float mhz; uint8_t r, g, b; const char* name; };
const SweepStep kSweep[] = {
    {433.70f, 255, 0, 0, "red"},     {433.80f, 0, 255, 0, "green"},
    {433.873f, 0, 0, 255, "blue"},   {433.92f, 255, 255, 0, "yellow"},
    {434.00f, 0, 255, 255, "cyan"},  {434.10f, 255, 255, 255, "white"},
};

void sweep() {
  const float keep = currentMhz;
  Serial.println("SWEEP start: red 433.700, green 433.800, blue 433.873, yellow 433.920, cyan 434.000, white 434.100");
  for (const SweepStep& step : kSweep) {
    if (!setFrequency(step.mhz)) break;
    if (!burst(step.r, step.g, step.b, step.name, 2000)) break;
    const uint32_t pause = millis();
    bool stopped = false;
    while (millis() - pause < 1500)
      if (stopRequested()) {
        stopped = true;
        break;
      } else {
        delay(5);
      }
    if (stopped) {
      Serial.println("SWEEP stopped by X");
      break;
    }
  }
  setFrequency(keep);
  Serial.printf("SWEEP end; frequency back to %.3f MHz\n", currentMhz);
}

bool pauseOrStop(uint32_t ms) {
  const uint32_t start = millis();
  while (millis() - start < ms) {
    if (stopRequested()) return true;
    delay(5);
  }
  return false;
}

// The 433 MHz range only.
void wideSweep() {
  const float keep = currentMhz;
  const float MIN_MHZ = pixmobrf::kBands[0].minMhz;
  const float MAX_MHZ = pixmobrf::kBands[0].maxMhz;
  const SweepStep colours[] = {{0, 255, 0, 0, "red"},     {0, 0, 255, 0, "green"},
                               {0, 0, 0, 255, "blue"},    {0, 255, 255, 0, "yellow"},
                               {0, 0, 255, 255, "cyan"},  {0, 255, 255, 255, "white"}};
  Serial.printf("WIDE SWEEP start: %.2f-%.2f MHz, %d dBm, frame every %lu ms\n", MIN_MHZ, MAX_MHZ,
                currentDbm, (unsigned long)framePeriodMs);
  bool stopped = false;
  for (int c = 0; c < 6 && !stopped; ++c) {
    const SweepStep& colour = colours[c];
    for (int i = 0; i < 6 && !stopped; ++i) {
      const int step = c * 6 + i;
      const float mhz = MIN_MHZ + (MAX_MHZ - MIN_MHZ) * float(step) / 35.0f;
      if (!setFrequency(mhz) || !burst(colour.r, colour.g, colour.b, colour.name, 500, true)) stopped = true;
    }
    if (!stopped) stopped = pauseOrStop(1000);
  }
  if (stopped) Serial.println("WIDE SWEEP stopped");
  setFrequency(keep);
  Serial.printf("WIDE SWEEP end; frequency back to %.3f MHz\n", currentMhz);
}

// ---------------------------------------------------------------- wake test

// Z follows the published captures (danielweidman/pixmob-ir-reverse-engineering,
// rf/): a sleeping band reacts only after up to ~30 s of valid frames, and the
// venue transmitter sends a frame every ~50 ms, repeating each command many
// times. Sends the captured "nothing" frame for 35 s, then the captured red
// "wine_fade_in" frame for 5 s, at the current frequency and power.
const uint32_t kWakeMs = 35000;  // default; Z<seconds> sets 5-90 s
const uint32_t kWakeRedMs = 5000;
const uint32_t kWakePeriodUs = 50000;

void wakeTest(uint32_t wakeMs) {
  if (!chipOk) {
    Serial.println("REFUSED: CC1101 not ready (S for details)");
    return;
  }
  if (radioState() != STATE_IDLE || !registersMatch(true)) {
    Serial.println("REFUSED: register check failed; nothing sent");
    return;
  }
  uint8_t nothing[pixmobrf::kFrameBytes], red[pixmobrf::kFrameBytes];
  pixmobrf::colorFrame(0, 0, 0, pixmobrf::kNothingTiming, nothing);
  pixmobrf::colorFrame(pixmobrf::kWineRed, 0, 0, pixmobrf::kWineFadeInTiming, red);
  const uint32_t wakeFrames = wakeMs * 1000 / kWakePeriodUs;
  const uint32_t redFrames = kWakeRedMs * 1000 / kWakePeriodUs;
  Serial.printf("WAKE %.3f MHz %d dBm: nothing x %lu, then red x %lu, a frame every %lu us, %u us per bit\n",
                currentMhz, currentDbm, (unsigned long)wakeFrames, (unsigned long)redFrames,
                (unsigned long)kWakePeriodUs, unsigned(pixmobrf::kBitMicros));
  Serial.print("WAKE frames: nothing ");
  printFrame(nothing);
  Serial.print(" | red ");
  printFrame(red);
  Serial.println();
  Serial.flush();
  if (!enterTx()) return;
  uint32_t next = micros() + pixmobrf::kStartDelayMicros;
  TxStats wake, colour;
  sendFrames(nothing, wakeFrames, kWakePeriodUs, next, wake);
  if (!wake.stopped) sendFrames(red, redFrames, kWakePeriodUs, next, colour);
  const int state = leaveTx();
  const bool idle = radioState() == STATE_IDLE;
  const uint32_t worst = wake.worstLate > colour.worstLate ? wake.worstLate : colour.worstLate;
  Serial.printf("WAKE DONE %.3f MHz: %lu nothing + %lu red frames, worst edge %lu us late, state 0x%02X before IDLE%s; radio %s\n",
                currentMhz, (unsigned long)wake.frames, (unsigned long)colour.frames, (unsigned long)worst,
                state & 0xFF, wake.stopped || colour.stopped ? ", stopped by X" : "", idle ? "IDLE" : "NOT IDLE");
  if (wake.lost) printTxMonitor(wake, wake.frames + colour.frames);
  else if (colour.lost) {
    colour.lostBefore += wake.frames;
    printTxMonitor(colour, wake.frames + colour.frames);
  } else printTxMonitor(colour, wake.frames + colour.frames);
}

// ---------------------------------------------------------------- commands

void printStatus() {
  const int partnum = readRegister(PARTNUM, true);
  const int version = readRegister(VERSION, true);
  Serial.printf("STATUS chip %s (PARTNUM 0x%02X VERSION 0x%02X), state 0x%02X, %.3f MHz (word 0x%06lX), %d dBm (PA 0x%02X), burst %lu ms, frame every %lu ms\n",
                chipOk ? "OK" : "NOT READY", partnum < 0 ? 0xFF : partnum, version < 0 ? 0xFF : version,
                radioState() & 0xFF, currentMhz, (unsigned long)frequencyWord(currentMhz), currentDbm, currentPa,
                (unsigned long)burstMs, (unsigned long)framePeriodMs);
  Serial.printf("REGISTERS %s\n", registersMatch(true) ? "match" : "MISMATCH");
  int high = 0, low = 0;
  const bool wire = gdo0WireOk(high, low);
  const int freeLevel = digitalRead(PIN_GDO0);
  Serial.printf("GDO0 wire %s (CC1101 high reads %s, low reads %s); %s with CC1101 high impedance\n",
                wire ? "OK" : "FAILED", high == HIGH ? "high" : "LOW", low == HIGH ? "HIGH" : "low",
                freeLevel == HIGH ? "HIGH" : "low");
}

void printHelp() {
  Serial.println("Commands: S status | F433.92 freq MHz (433.10-434.70 or 919.10-922.90) | P0 power dBm (-30 -20 -15 -10 0 5 7 10)");
  Serial.println("          D3000 burst ms (200-10000) | I50 frame interval ms (50-1000) | R G B Y C M W colour | K black");
  Serial.println("          #RRGGBB | T 6-step sweep | Q wide sweep 433.10-434.70 | Z[s] wake (35 s, Z5-Z90) then 5 s red | X stop");
  Serial.println("          LINK capture on GPIO34 after wristband pin and voltage verification");
  Serial.println("Only colour frames for group 0 are sent; nothing is sent without a command.");
}

void runCommand(String command) {
  command.trim();
  if (command.isEmpty()) return;
  if (command.equalsIgnoreCase("LINK")) {
    checkWristbandLink();
    return;
  }
  const char head = toupper(command[0]);
  const String rest = command.substring(1);
  switch (head) {
    case '?': printHelp(); break;
    case 'S': printStatus(); break;
    case 'F':
      if (setFrequency(rest.toFloat())) Serial.printf("OK frequency %.3f MHz\n", currentMhz);
      break;
    case 'P': {
      const int dbm = rest.toInt();
      uint8_t pa = 0;
      const bool found = rest.length() > 0 && pixmobrf::paValue(currentMhz, dbm, pa);
      if (found) {
        currentDbm = dbm;
        currentPa = pa;
        writePaTable();
      }
      if (found) Serial.printf("OK power %d dBm (PA 0x%02X)\n", currentDbm, currentPa);
      else Serial.println("REFUSED: power must be -30 -20 -15 -10 0 5 7 or 10");
      break;
    }
    case 'D': {
      const long ms = rest.toInt();
      if (ms >= 200 && ms <= 10000) {
        burstMs = uint32_t(ms);
        Serial.printf("OK burst %lu ms\n", (unsigned long)burstMs);
      } else {
        Serial.println("REFUSED: burst must be 200-10000 ms");
      }
      break;
    }
    case 'R': burst(255, 0, 0, "red", burstMs); break;
    case 'G': burst(0, 255, 0, "green", burstMs); break;
    case 'B': burst(0, 0, 255, "blue", burstMs); break;
    case 'Y': burst(255, 255, 0, "yellow", burstMs); break;
    case 'C': burst(0, 255, 255, "cyan", burstMs); break;
    case 'M': burst(255, 0, 255, "magenta", burstMs); break;
    case 'W': burst(255, 255, 255, "white", burstMs); break;
    case 'K': burst(0, 0, 0, "black", burstMs); break;
    case '#': {
      if (rest.length() != 6) {
        Serial.println("REFUSED: use #RRGGBB");
        break;
      }
      const uint32_t rgb = strtoul(rest.c_str(), nullptr, 16);
      burst(uint8_t(rgb >> 16), uint8_t(rgb >> 8), uint8_t(rgb), "hex", burstMs);
      break;
    }
    case 'T': sweep(); break;
    case 'Q': wideSweep(); break;
    case 'Z': {
      const long seconds = rest.toInt();
      if (rest.length() == 0) wakeTest(kWakeMs);
      else if (seconds >= 5 && seconds <= 90) wakeTest(uint32_t(seconds) * 1000);
      else Serial.println("REFUSED: wake must be Z (35 s) or Z5-Z90 seconds");
      break;
    }
    case 'I': {
      const long ms = rest.toInt();
      if (ms >= 50 && ms <= 1000) {
        framePeriodMs = uint32_t(ms);
        Serial.printf("OK frame interval %lu ms\n", (unsigned long)framePeriodMs);
      } else {
        Serial.println("REFUSED: frame interval must be 50-1000 ms");
      }
      break;
    }
    case 'X': Serial.println("OK idle"); break;
    default: Serial.println("Unknown command; ? for help"); break;
  }
}

void setup() {
  Serial.begin(115200);
  delay(300);
  pinMode(PIN_CS, OUTPUT);
  digitalWrite(PIN_CS, HIGH);
  pinMode(PIN_GDO0, INPUT_PULLDOWN);
  SPI.begin(PIN_SCK, PIN_MISO, PIN_MOSI, -1);
  chipOk = setupRadio();
  Serial.println();
  Serial.println("PIXMOB RF TEST READY (433 / 919-923 MHz colour frames only; nothing sent without a command)");
  printStatus();
  printHelp();
}

void loop() {
  while (Serial.available()) {
    const char c = char(Serial.read());
    if (c == '\n' || c == '\r') {
      runCommand(line);
      line = "";
    } else if (line.length() < 40) {
      line += c;
    }
  }
  delay(2);
}
