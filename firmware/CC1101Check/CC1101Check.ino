// Read-only CC1101 wiring check for the ESP32 DevKit.
//
// It only reads: the chip's ID and reset-default registers over SPI, and the
// GDO0 / GDO2 pins. It sends no command strobe, writes no register and never
// switches the radio on, so nothing is transmitted.
//
// Wiring (CC1101 433M V2.0 header number -> ESP32):
//   1 GND -> GND      2 VCC  -> 3V3 (never 5 V)
//   3 GDO0 -> GPIO4   4 CSN  -> GPIO5
//   5 SCK -> GPIO18   6 MOSI -> GPIO23
//   7 MISO -> GPIO19  8 GDO2 -> GPIO22
// The IR LED (GPIO32) and microphone (GPIO26/25/27) are not touched.
//
// Serial 115200: the check repeats every 5 seconds, so a loose wire can be
// found by moving it while watching the result line.

#include <SPI.h>

const int PIN_SCK = 18;
const int PIN_MISO = 19;
const int PIN_MOSI = 23;
const int PIN_CS = 5;
const int PIN_GDO0 = 4;
const int PIN_GDO2 = 22;

const SPISettings spiSettings(1000000, MSBFIRST, SPI_MODE0);

// The chip pulls MISO low once it is ready after CSN goes low.
bool waitReady() {
  const uint32_t start = micros();
  while (digitalRead(PIN_MISO) == HIGH)
    if (micros() - start > 5000) return false;
  return true;
}

// Reads one register. Status registers (0x30-0x3D) need the burst bit.
// Returns -1 when the chip never signalled ready.
int readRegister(uint8_t address, bool statusRegister) {
  const uint8_t header = address | 0x80 | (statusRegister ? 0x40 : 0x00);
  SPI.beginTransaction(spiSettings);
  digitalWrite(PIN_CS, LOW);
  const bool ready = waitReady();
  SPI.transfer(header);
  const uint8_t value = SPI.transfer(0x00);
  digitalWrite(PIN_CS, HIGH);
  SPI.endTransaction();
  return ready ? value : -1;
}

// Before SPI starts: with a pull-up on MISO, a powered chip answers CSN low by
// pulling MISO low, and lets go when CSN goes high again.
bool rawReadyCheck(bool& releasedHigh) {
  pinMode(PIN_MISO, INPUT_PULLUP);
  digitalWrite(PIN_CS, HIGH);
  delayMicroseconds(50);
  digitalWrite(PIN_CS, LOW);
  const bool ready = waitReady();
  digitalWrite(PIN_CS, HIGH);
  delayMicroseconds(50);
  releasedHigh = digitalRead(PIN_MISO) == HIGH;
  return ready;
}

void printHex(const char* name, int value) {
  Serial.print(name);
  Serial.print(" ");
  if (value < 0) {
    Serial.print("--");
  } else {
    Serial.print("0x");
    if (value < 0x10) Serial.print("0");
    Serial.print(value, HEX);
  }
}

void check() {
  Serial.println();
  Serial.println("CC1101 CHECK (read-only, never transmits)");

  SPI.end();
  bool releasedHigh = false;
  const bool ready = rawReadyCheck(releasedHigh);
  SPI.begin(PIN_SCK, PIN_MISO, PIN_MOSI, -1);

  const int partnum = readRegister(0x30, true);
  const int version = readRegister(0x31, true);
  const int marcstate = readRegister(0x35, true);
  const int iocfg2 = readRegister(0x00, false);
  const int iocfg1 = readRegister(0x01, false);
  const int iocfg0 = readRegister(0x02, false);
  const int sync1 = readRegister(0x04, false);
  const int sync0 = readRegister(0x05, false);

  // GDO0 defaults to the crystal clock / 192 (about 135 kHz).
  uint32_t edges = 0;
  int last = digitalRead(PIN_GDO0);
  const uint32_t start = micros();
  while (micros() - start < 20000) {
    const int now = digitalRead(PIN_GDO0);
    if (now != last && now == HIGH) ++edges;
    last = now;
  }
  // GDO2 defaults to CHIP_RDYn: low while the chip is ready.
  const bool gdo2Low = digitalRead(PIN_GDO2) == LOW;

  Serial.printf("Chip answers CSN (MISO low): %s, lets go after: %s\n",
                ready ? "yes" : "NO", releasedHigh ? "yes" : "NO");
  printHex("PARTNUM", partnum);
  Serial.print(" (expect 0x00)  ");
  printHex("VERSION", version);
  Serial.println(" (expect 0x14 or 0x04)");
  printHex("IOCFG2", iocfg2);
  Serial.print(" ");
  printHex("IOCFG1", iocfg1);
  Serial.print(" ");
  printHex("IOCFG0", iocfg0);
  Serial.print(" ");
  printHex("SYNC1", sync1);
  Serial.print(" ");
  printHex("SYNC0", sync0);
  Serial.println("  (reset defaults 0x29 0x2E 0x3F 0xD3 0x91)");
  printHex("MARCSTATE", marcstate < 0 ? -1 : (marcstate & 0x1F));
  Serial.println(" (0x01 = idle)");
  Serial.printf("GDO0 rising edges in 20 ms: %lu (about 2700 expected)\n",
                (unsigned long)edges);
  Serial.printf("GDO2 level: %s (expect LOW)\n", gdo2Low ? "LOW" : "HIGH");

  const bool spiOk = partnum == 0x00 && iocfg2 == 0x29 && iocfg1 == 0x2E &&
                     iocfg0 == 0x3F && sync1 == 0xD3 && sync0 == 0x91;
  const bool gdo0Ok = edges > 500;
  if (!ready) {
    Serial.println("RESULT: NO ANSWER - check VCC->3V3, GND, CSN->GPIO5, MISO->GPIO19");
  } else if (!spiOk) {
    Serial.println("RESULT: SPI WRONG - check SCK->GPIO18, MOSI->GPIO23, MISO->GPIO19");
  } else if (!gdo0Ok || !gdo2Low) {
    Serial.printf("RESULT: SPI OK, CHECK %s%s\n", gdo0Ok ? "" : "GDO0->GPIO4 ",
                  gdo2Low ? "" : "GDO2->GPIO22");
  } else {
    Serial.println("RESULT: WIRING OK");
  }
}

void setup() {
  Serial.begin(115200);
  delay(300);
  pinMode(PIN_CS, OUTPUT);
  digitalWrite(PIN_CS, HIGH);
  pinMode(PIN_GDO0, INPUT_PULLUP);
  pinMode(PIN_GDO2, INPUT_PULLUP);
  Serial.println();
  Serial.println("CC1101 WIRING CHECK READY (read-only)");
  delay(200);
  check();
}

void loop() {
  delay(5000);
  check();
}
