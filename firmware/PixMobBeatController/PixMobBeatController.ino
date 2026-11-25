
#define DISABLE_CODE_FOR_RECEIVER

#include <Arduino.h>
#include <IRremote.hpp>
#include <ESP_I2S.h>
#include <SPI.h>
#include <atomic>
#include <Preferences.h>
#include "BeatDetector.h"
#include "PixMobFrame.h"
#include "ColorLevels.h"
#include "LightPlan.h"
#include "StrobePlan.h"
#include "LightCommand.h"
#include "PixMobRFFrame.h"
#include "PixMobRFLimits.h"
#include "RfPlan.h"

// Hardware
const uint8_t IR_PIN = 32;
const int MIC_SCK = 26;
const int MIC_WS  = 25;
const int MIC_SD  = 27;

I2SClass I2S;
int32_t audioSamples[256];

// Sampling runs on the Arduino loop/core 1. Only the worker/core 0 touches
// IrSender. A one-job mailbox bounds latency; no repeating timer emits beats.
enum Mode {
  MANUAL_MODE,
  AUTO_MODE,
  MUSIC_MODE,
  HOST_MODE
};

Mode currentMode = MANUAL_MODE;
BeatDetector detector;
float sensitivity = 1.35f;
unsigned long lastAuto = 0;
unsigned long lastPrint = 0;
uint8_t colorIndex = 0;
bool autoAwaiting = false;
bool transmitBeats = false;
std::atomic<uint32_t> txGeneration{0};
struct TxJob {
  uint32_t generation;
  char color;             // preset letter, or '=' for custom levels
  pixmob::Levels levels;  // what is transmitted
  uint8_t repeats;
  bool beat;
  uint32_t lightMs;  // > 0: timed light built from envelope frames
  bool cut;          // end a timed light early
  uint8_t strobe;    // 1: steady strobe for lightMs, 2: build (speeds up)
  uint8_t attack;    // timed light: fade in code, 0 = none
  uint8_t release;   // timed light: fade out code, 0 = none
  bool line;         // quick flash asked for with the '.' line command
  uint32_t cycle;    // > 0: rainbow for lightMs with this cycle time
  bool styled;       // a beat or Auto step: acknowledged as "Color sent"
  bool idle;         // the power-on rainbow: runs until any command
  uint8_t output;    // pixmob::OUTPUT_* bits: IR, RF or both (0: nothing goes out)
};
QueueHandle_t txQueue = nullptr;
QueueHandle_t completedQueue = nullptr;

// Whether the IR worker is running a job, and when it last finished one.
// Written by the worker, read by the main loop for the idle rainbow.
std::atomic<bool> txBusy{false};
std::atomic<uint32_t> txIdleSince{0};

// Timed light bookkeeping for Stop; touched by the main loop only.
pixmob::Levels lightLevels = {};
uint8_t lightOutput = pixmob::OUTPUT_BOTH;  // what the light that may be showing went out by
uint32_t lightStart = 0;
uint32_t lightSpan = 0;  // 0 = no timed light may still be showing

// Worker-only scratch frame; every transmitted frame is built into it.
pixmob::Frame lightFrame;

// ---------------------------------------------------------------- RF output
// The CC1101 board (docs/WIRING.md: CS 5, SCK 18, MOSI 23, MISO 19, GDO0 4;
// GDO2 22 is not used) sends every IR frame again as a PixMob RF frame at
// 922.36 MHz, 10 dBm (RfPlan.h). The CC1101 runs in asynchronous serial OOK as
// in firmware/PixMobRFTest: in TX it reads GDO0 as its data, and a high level
// switches the carrier on. The RMT peripheral drives GDO0 with the frame's
// bits, so the worker sends the IR frame meanwhile. The CC1101 side of GDO0
// stays high impedance. Without the board the controller runs IR only.
const int RF_SCK = 18, RF_MISO = 19, RF_MOSI = 23, RF_CS = 5, RF_GDO0 = 4, RF_GDO2 = 22;
const SPISettings rfSpi(1000000, MSBFIRST, SPI_MODE0);

enum : uint8_t {
  CC_IOCFG2 = 0x00, CC_IOCFG0 = 0x02, CC_FIFOTHR = 0x03, CC_PKTCTRL1 = 0x07, CC_PKTCTRL0 = 0x08,
  CC_CHANNR = 0x0A, CC_FSCTRL1 = 0x0B, CC_FSCTRL0 = 0x0C, CC_FREQ2 = 0x0D, CC_FREQ1 = 0x0E,
  CC_FREQ0 = 0x0F, CC_MDMCFG4 = 0x10, CC_MDMCFG3 = 0x11, CC_MDMCFG2 = 0x12, CC_MDMCFG1 = 0x13,
  CC_MDMCFG0 = 0x14, CC_DEVIATN = 0x15, CC_MCSM1 = 0x17, CC_MCSM0 = 0x18, CC_FOCCFG = 0x19,
  CC_BSCFG = 0x1A, CC_AGCCTRL2 = 0x1B, CC_AGCCTRL1 = 0x1C, CC_AGCCTRL0 = 0x1D, CC_FREND1 = 0x21,
  CC_FREND0 = 0x22, CC_FSCAL3 = 0x23, CC_FSCAL2 = 0x24, CC_FSCAL1 = 0x25, CC_FSCAL0 = 0x26,
  CC_FSTEST = 0x29, CC_TEST2 = 0x2C, CC_TEST1 = 0x2D, CC_TEST0 = 0x2E, CC_PATABLE = 0x3E,
  CC_PARTNUM = 0x30, CC_VERSION = 0x31, CC_MARCSTATE = 0x35,
  CC_SRES = 0x30, CC_STX = 0x35, CC_SIDLE = 0x36,
};
const uint8_t CC_GDO_HIGH_Z = 0x2E;
const uint8_t CC_GDO_LOW = 0x2F;   // constant 0
const uint8_t CC_GDO_HIGH = 0x6F;  // constant 0, inverted: constant 1
const uint8_t CC_STATE_IDLE = 0x01;
const uint8_t CC_STATE_TX = 0x13;

struct CcSetting {
  uint8_t address;
  uint8_t value;
};
// The register set of firmware/PixMobRFTest (TI SmartRF / SmartRC values; it
// serves 433 MHz and 900-928 MHz alike, only the PATABLE value differs).
const CcSetting kRfSetup[] = {
    {CC_IOCFG2, CC_GDO_HIGH_Z}, {CC_IOCFG0, CC_GDO_HIGH_Z}, {CC_FIFOTHR, 0x47},
    {CC_PKTCTRL1, 0x04},        {CC_PKTCTRL0, 0x32},        {CC_CHANNR, 0x00},
    {CC_FSCTRL1, 0x06},         {CC_FSCTRL0, 0x00},         {CC_MDMCFG4, 0x07},
    {CC_MDMCFG3, 0x93},         {CC_MDMCFG2, 0x30},         {CC_MDMCFG1, 0x02},
    {CC_MDMCFG0, 0xF8},         {CC_DEVIATN, 0x47},         {CC_MCSM1, 0x30},
    {CC_MCSM0, 0x18},           {CC_FOCCFG, 0x16},          {CC_BSCFG, 0x1C},
    {CC_AGCCTRL2, 0xC7},        {CC_AGCCTRL1, 0x00},        {CC_AGCCTRL0, 0xB2},
    {CC_FREND1, 0x56},          {CC_FREND0, 0x11},          {CC_FSCAL3, 0xE9},
    {CC_FSCAL2, 0x2A},          {CC_FSCAL1, 0x00},          {CC_FSCAL0, 0x1F},
    {CC_FSTEST, 0x59},          {CC_TEST2, 0x81},           {CC_TEST1, 0x35},
    {CC_TEST0, 0x09},
};

enum RfStatus : uint8_t { RF_NOT_FOUND, RF_SETUP_FAILED, RF_WIRE_FAILED, RF_RMT_FAILED, RF_READY };
RfStatus rfStatus = RF_NOT_FOUND;  // set in setup() before the worker starts
uint32_t rfFrequencyWord = 0;
uint8_t rfPa = 0;
// Settings the main loop changes and the worker reads. defaultOutput is what
// a light goes out by unless its command says otherwise (@R0 IR only, @R1 IR
// and RF, @R2 RF only).
std::atomic<uint8_t> defaultOutput{pixmob::OUTPUT_BOTH};
std::atomic<uint32_t> rfKeepAwakeMs{pixmob::RF_KEEP_AWAKE_DEFAULT_MS};
std::atomic<bool> rfWakeRequest{false};
// How long after the last light the RF bands are left to sleep (@RS), 0
// never; the worker applies a change.
std::atomic<uint32_t> rfSleepAfterMs{pixmob::RF_SLEEP_NEVER};
std::atomic<bool> rfSleepChange{false};
std::atomic<uint32_t> rfFramesSent{0};
std::atomic<uint32_t> rfFramesFailed{0};
// Worker only.
pixmob::RfKeepAwake rfKeep;
rmt_data_t rfSymbols[(pixmob::RF_MAX_RUNS + 1) / 2];
size_t rfSymbolCount = 0;
uint32_t rfBitsAt = 0;           // micros() at the first bit of the frame on air
uint32_t runningGeneration = 0;  // generation of the job the worker runs
uint8_t runningOutput = pixmob::OUTPUT_BOTH;  // what that job goes out by

bool ccWaitReady() {
  const uint32_t start = micros();
  while (digitalRead(RF_MISO) == HIGH)
    if (micros() - start > 5000) return false;
  return true;
}

void ccWrite(uint8_t address, uint8_t value) {
  SPI.beginTransaction(rfSpi);
  digitalWrite(RF_CS, LOW);
  ccWaitReady();
  SPI.transfer(address);
  SPI.transfer(value);
  digitalWrite(RF_CS, HIGH);
  SPI.endTransaction();
}

int ccReadHeader(uint8_t header) {
  SPI.beginTransaction(rfSpi);
  digitalWrite(RF_CS, LOW);
  const bool ready = ccWaitReady();
  SPI.transfer(header);
  const uint8_t value = SPI.transfer(0x00);
  digitalWrite(RF_CS, HIGH);
  SPI.endTransaction();
  return ready ? value : -1;
}

int ccRead(uint8_t address) { return ccReadHeader(address | 0x80); }
int ccStatus(uint8_t address) { return ccReadHeader(address | 0xC0); }

void ccStrobe(uint8_t command) {
  SPI.beginTransaction(rfSpi);
  digitalWrite(RF_CS, LOW);
  ccWaitReady();
  SPI.transfer(command);
  digitalWrite(RF_CS, HIGH);
  SPI.endTransaction();
}

// MARCSTATE can glitch while the state changes, so read until two agree.
int ccState() {
  int last = -2;
  for (int i = 0; i < 6; ++i) {
    const int now = ccStatus(CC_MARCSTATE);
    if (now == last) return now < 0 ? now : (now & 0x1F);
    last = now;
  }
  return last < 0 ? last : (last & 0x1F);
}

bool ccWaitState(uint8_t state, uint32_t timeoutMicros) {
  const uint32_t start = micros();
  while (micros() - start < timeoutMicros)
    if (ccState() == state) return true;
  return false;
}

void ccWritePa() {
  SPI.beginTransaction(rfSpi);
  digitalWrite(RF_CS, LOW);
  ccWaitReady();
  SPI.transfer(CC_PATABLE | 0x40);
  SPI.transfer(0x00);  // OOK "0": carrier off
  SPI.transfer(rfPa);
  digitalWrite(RF_CS, HIGH);
  SPI.endTransaction();
}

// PATABLE[1], or -1 if PATABLE[0] is not 0 (carrier off for a 0 bit).
int ccPaOne() {
  SPI.beginTransaction(rfSpi);
  digitalWrite(RF_CS, LOW);
  ccWaitReady();
  SPI.transfer(CC_PATABLE | 0xC0);
  const uint8_t zero = SPI.transfer(0x00);
  const uint8_t one = SPI.transfer(0x00);
  digitalWrite(RF_CS, HIGH);
  SPI.endTransaction();
  return zero == 0x00 ? one : -1;
}

bool ccReset() {
  digitalWrite(RF_CS, HIGH);
  delayMicroseconds(5);
  digitalWrite(RF_CS, LOW);
  delayMicroseconds(10);
  digitalWrite(RF_CS, HIGH);
  delayMicroseconds(45);
  SPI.beginTransaction(rfSpi);
  digitalWrite(RF_CS, LOW);
  bool ok = ccWaitReady();
  SPI.transfer(CC_SRES);
  ok = ccWaitReady() && ok;
  digitalWrite(RF_CS, HIGH);
  SPI.endTransaction();
  return ok;
}

// The frequency and power registers as written (a CC1101 that restarted reads
// its reset values instead, FREQ2 0x1E).
bool ccStillConfigured() {
  return ccRead(CC_FREQ2) == int(rfFrequencyWord >> 16 & 0xFF) &&
         ccRead(CC_FREQ1) == int(rfFrequencyWord >> 8 & 0xFF) &&
         ccRead(CC_FREQ0) == int(rfFrequencyWord & 0xFF) && ccPaOne() == rfPa;
}

// Writes the whole set-up; true when it reads back as written.
bool ccConfigure() {
  for (const CcSetting& setting : kRfSetup) ccWrite(setting.address, setting.value);
  ccWrite(CC_FREQ2, uint8_t(rfFrequencyWord >> 16));
  ccWrite(CC_FREQ1, uint8_t(rfFrequencyWord >> 8));
  ccWrite(CC_FREQ0, uint8_t(rfFrequencyWord));
  ccWritePa();
  ccStrobe(CC_SIDLE);
  if (!ccWaitState(CC_STATE_IDLE, 5000)) return false;
  for (const CcSetting& setting : kRfSetup) {
    // Calibration writes its results into FSCAL3[3:0], FSCAL2[4:0] and FSCAL1.
    uint8_t mask = 0xFF;
    if (setting.address == CC_FSCAL3) mask = 0xF0;
    if (setting.address == CC_FSCAL2) mask = 0x20;
    if (setting.address == CC_FSCAL1) continue;
    const int value = ccRead(setting.address);
    if (value < 0 || (value & mask) != (setting.value & mask)) return false;
  }
  return ccStillConfigured();
}

// Runs in setup(), before the worker starts.
RfStatus rfInit() {
  pinMode(RF_CS, OUTPUT);
  digitalWrite(RF_CS, HIGH);
  pinMode(RF_GDO0, INPUT_PULLDOWN);
  pinMode(RF_GDO2, INPUT_PULLUP);
  SPI.begin(RF_SCK, RF_MISO, RF_MOSI, -1);
  if (!ccReset()) return RF_NOT_FOUND;
  const int partnum = ccStatus(CC_PARTNUM);
  const int version = ccStatus(CC_VERSION);
  if (partnum != 0x00 || (version != 0x14 && version != 0x04)) return RF_NOT_FOUND;
  rfFrequencyWord = uint32_t(double(pixmob::RF_MHZ) * 65536.0 / 26.0 + 0.5);
  if (!pixmobrf::paValue(pixmob::RF_MHZ, pixmob::RF_DBM, rfPa) || !ccConfigure())
    return RF_SETUP_FAILED;
  // The GDO0 wire: the CC1101 drives it high, then low, and the ESP32 must
  // read both (a loose wire reads low twice).
  ccWrite(CC_IOCFG0, CC_GDO_HIGH);
  delayMicroseconds(5);
  const int high = digitalRead(RF_GDO0);
  ccWrite(CC_IOCFG0, CC_GDO_LOW);
  delayMicroseconds(5);
  const int low = digitalRead(RF_GDO0);
  ccWrite(CC_IOCFG0, CC_GDO_HIGH_Z);
  if (high != HIGH || low != LOW) return RF_WIRE_FAILED;
  if (!rmtInit(RF_GDO0, RMT_TX_MODE, RMT_MEM_NUM_BLOCKS_1, 1000000) || !rmtSetEOT(RF_GDO0, LOW))
    return RF_RMT_FAILED;
  return RF_READY;
}

// RF is part of the board's setting: the keep-awake frames go out.
bool rfActive() { return rfStatus == RF_READY && (defaultOutput.load() & pixmob::OUTPUT_RF); }

// The GDO0 waveform of one frame, into rfSymbols.
void rfLoad(const uint8_t frame[pixmobrf::kFrameBytes], uint32_t leadUs) {
  pixmob::RfRun runs[pixmob::RF_MAX_RUNS];
  const uint8_t count = pixmob::rfRuns(frame, leadUs, runs);
  rfSymbolCount = 0;
  for (uint8_t i = 0; i < count; i += 2) {
    rmt_data_t& symbol = rfSymbols[rfSymbolCount++];
    symbol.level0 = runs[i].level;
    symbol.duration0 = runs[i].us;
    symbol.level1 = i + 1 < count ? runs[i + 1].level : 0;
    symbol.duration1 = i + 1 < count ? runs[i + 1].us : 10;
  }
}

bool rfWrite(uint32_t leadUs) {
  const uint32_t now = micros();
  if (!rmtWriteAsync(RF_GDO0, rfSymbols, rfSymbolCount)) return false;
  rfBitsAt = now + leadUs;
  return true;
}

// Puts the CC1101 into TX and starts the frame's waveform on GDO0. False:
// nothing was sent and the radio is back in IDLE.
bool rfStart(const uint8_t frame[pixmobrf::kFrameBytes], uint32_t leadUs) {
  rfLoad(frame, leadUs);
  // A CC1101 that restarted (a dip in its supply) has lost its set-up.
  if (!ccStillConfigured() && !ccConfigure()) {
    rfFramesFailed.fetch_add(1);
    return false;
  }
  ccStrobe(CC_STX);
  if (!ccWaitState(CC_STATE_TX, 3000) || !rfWrite(leadUs)) {
    ccStrobe(CC_SIDLE);
    ccWaitState(CC_STATE_IDLE, 3000);
    rfFramesFailed.fetch_add(1);
    return false;
  }
  return true;
}

// Waits for the waveform to end. A frame counts as sent when the radio was
// still in TX at its end.
bool rfWaitFrame() {
  const uint32_t start = millis();
  while (!rmtTransmitCompleted(RF_GDO0) && millis() - start < 100) vTaskDelay(1);
  const bool sent = rmtTransmitCompleted(RF_GDO0) && ccState() == CC_STATE_TX;
  (sent ? rfFramesSent : rfFramesFailed).fetch_add(1);
  return sent;
}

// The same frame again, its first bit RF_COPY_MS after the last one's; the
// radio is still in TX and sends no carrier between the frames.
bool rfRepeat(const uint8_t frame[pixmobrf::kFrameBytes]) {
  uint32_t leadUs = pixmob::RF_LEAD_US;
  const int32_t untilUs = int32_t(rfBitsAt + pixmob::RF_COPY_MS * 1000 - micros());
  if (untilUs > int32_t(leadUs)) leadUs = uint32_t(untilUs);
  if (leadUs > pixmob::RF_MAX_LEAD_US) leadUs = pixmob::RF_MAX_LEAD_US;
  rfLoad(frame, leadUs);
  if (rfWrite(leadUs)) return true;
  rfFramesFailed.fetch_add(1);
  return false;
}

// After the first frame from rfStart has gone out: its further copies
// (RfPlan.h), then back to IDLE. A newer command waiting stops them; inJob,
// so does a change of the job generation (Stop, a mode change).
void rfFinish(const uint8_t frame[pixmobrf::kFrameBytes], bool firstSent, uint8_t copies,
              bool inJob) {
  bool sent = firstSent;
  for (uint8_t copy = 1; sent && copy < copies; ++copy) {
    if (uxQueueMessagesWaiting(txQueue) > 0) break;
    if (inJob && txGeneration.load() != runningGeneration) break;
    sent = rfRepeat(frame) && rfWaitFrame();
  }
  ccStrobe(CC_SIDLE);
  ccWaitState(CC_STATE_IDLE, 3000);
}

// Hands a job to the main loop, which prints its acknowledgement.
void acknowledge(const TxJob* job) {
  if (job && job->generation == txGeneration.load()) xQueueSend(completedQueue, job, 0);
}

// Sends the light by what the running job goes out by: the IR frame in
// lightFrame and/or the same color and envelope as an RF frame. With both,
// they are timed to end together. Then the RF frame's further copies. `ack`
// is acknowledged before the copies, so the website's next command is not
// held up by them.
// rfSustain: the RF frame's sustain code when it differs from the IR one.
void transmitLight(const pixmob::Levels& levels, uint8_t attack, uint8_t sustain,
                   uint8_t release, uint8_t copies, const TxJob* ack,
                   uint8_t rfSustain = 0xFF) {
  if (rfSustain > 7) rfSustain = sustain;
  uint8_t frame[pixmobrf::kFrameBytes];
  const bool ir = runningOutput & pixmob::OUTPUT_IR;
  bool rf = false;
  if (rfStatus == RF_READY && (runningOutput & pixmob::OUTPUT_RF)) {
    pixmobrf::colorFrame(levels.red, levels.green, levels.blue,
                         pixmob::rfTiming(attack, rfSustain, release), frame);
    const pixmob::RfAlignment alignment =
        ir ? pixmob::alignRf(pixmob::irFrameMicros(lightFrame))
           : pixmob::RfAlignment{pixmob::RF_LEAD_US, 0};
    rf = rfStart(frame, alignment.rfLeadUs);
    if (rf && ir) {
      const uint32_t start = rfBitsAt - alignment.rfLeadUs;  // the waveform's start
      for (;;) {
        const uint32_t elapsed = micros() - start;
        if (elapsed >= alignment.irStartUs) break;
        if (alignment.irStartUs - elapsed > 3000) vTaskDelay(1);
      }
    }
  }
  if (ir) IrSender.sendRaw(lightFrame.timings, lightFrame.count, 38);
  const bool firstSent = rf && rfWaitFrame();
  acknowledge(ack);
  if (rf) rfFinish(frame, firstSent, copies, true);
  pixmob::rfLightSent(rfKeep, millis(), attack, rfSustain > sustain ? rfSustain : sustain, release);
}

// The black frames that keep RF wristbands awake (RfPlan.h).
void rfSendNothing() {
  uint8_t frame[pixmobrf::kFrameBytes];
  pixmobrf::colorFrame(0, 0, 0, pixmobrf::kNothingTiming, frame);
  pixmob::rfNothingSent(rfKeep, millis());
  if (rfStart(frame, pixmob::RF_LEAD_US))
    rfFinish(frame, rfWaitFrame(), pixmob::RF_MAX_COPIES, false);
}

// spacingMs: from this frame to the job's next one, 0 if none (rfCopies).
// rfSustain: see transmitLight.
void sendEnvelope(pixmob::Levels levels, bool varied, uint8_t attack, uint8_t sustain,
                  uint8_t release, uint32_t spacingMs, const TxJob* ack,
                  uint8_t rfSustain = 0xFF) {
  // The wristband ignores a frame identical to the one still showing (seen
  // in the user's video), so every second frame of a light or strobe is one
  // step lower on the strongest channel.
  if (varied) {
    uint8_t& top = pixmob::strongest(levels);
    if (top >= 4) top -= 4;
  }
  if (pixmob::singleColorEnvelope(levels.red, levels.green, levels.blue, attack, sustain,
                                  release, lightFrame))
    transmitLight(levels, attack, sustain, release, pixmob::rfCopies(attack, sustain, spacingMs),
                  ack, rfSustain);
  else
    acknowledge(ack);  // as before RF: the job is acknowledged either way
}

// Ends a timed light early: the same color with a 32 ms sustain is a
// different command, so it should replace the one showing and fade at once.
// This use has not been observed on the wristband yet.
void sendCutFrame(pixmob::Levels levels) {
  uint8_t& top = pixmob::strongest(levels);
  if (top >= 8) top -= 8;
  if (pixmob::singleColorEnvelope(levels.red, levels.green, levels.blue, pixmob::TIME_0_MS,
                                  pixmob::TIME_32_MS, pixmob::TIME_32_MS, lightFrame))
    transmitLight(levels, pixmob::TIME_0_MS, pixmob::TIME_32_MS, pixmob::TIME_32_MS,
                  pixmob::rfCopies(pixmob::TIME_0_MS, pixmob::TIME_32_MS, 0), nullptr);
}

// Quick flash: the 6-byte single-color command. The wristband applies its
// own short envelope. For R, B and Y the built frame is bit for bit the
// supplied timing array (tests/color-levels.cpp); the other colors use the
// levels explained in ColorLevels.h. The 38 kHz carrier and the GPIO are
// unchanged. The RF copy carries the nearest envelope codes (RfPlan.h).
void sendFrame(const pixmob::Levels& levels, uint8_t rfCopies, const TxJob* ack) {
  if (pixmob::singleColor(levels.red, levels.green, levels.blue, lightFrame))
    transmitLight(levels, pixmob::RF_FLASH_ATTACK, pixmob::RF_FLASH_SUSTAIN,
                  pixmob::RF_FLASH_RELEASE, rfCopies, ack);
  else
    acknowledge(ack);
}

// Sends the flashes of one strobe or build: light for 32 ms, fade over
// 32 ms, again and again. A newer command ends it.
void runStrobe(const TxJob& job) {
  pixmob::StrobePlan plan = pixmob::beginStrobe(job.lightMs, job.strobe == 2);
  const uint32_t start = millis();
  uint32_t at = 0;
  uint16_t index = 0;
  while (pixmob::nextStrobeFlash(plan, at)) {
    while (millis() - start < at) {
      if (job.generation != txGeneration.load()) return;
      vTaskDelay(pdMS_TO_TICKS(2));
    }
    if (job.generation != txGeneration.load()) return;
    // A 32 ms flash is over before an RF copy could follow (rfCopies).
    sendEnvelope(job.levels, index & 1, pixmob::TIME_0_MS, pixmob::TIME_32_MS,
                 pixmob::TIME_32_MS, 0, index == 0 ? &job : nullptr);
    ++index;
  }
}

// Sends the frames of one rainbow: a new color every step, each lit until
// after the next one arrives. A newer command ends it.
void runRainbow(const TxJob& job) {
  // The power-on rainbow has no end of its own.
  pixmob::RainbowPlan plan =
      pixmob::beginRainbow(job.idle ? 0xFFFFFF00u : job.lightMs, job.cycle);
  const uint32_t start = millis();
  uint32_t at = 0;
  pixmob::Levels levels;
  bool first = true;
  while (pixmob::nextRainbowFrame(plan, at, levels)) {
    pixmob::RainbowPlan ahead = plan;
    uint32_t nextAt = 0;
    pixmob::Levels nextLevels;
    const uint32_t spacing = pixmob::nextRainbowFrame(ahead, nextAt, nextLevels) ? nextAt - at : 0;
    while (millis() - start < at) {
      if (job.generation != txGeneration.load()) return;
      vTaskDelay(pdMS_TO_TICKS(2));
    }
    if (job.generation != txGeneration.load()) return;
    sendEnvelope(levels, false, pixmob::TIME_0_MS, pixmob::RAINBOW_SUSTAIN_CODE,
                 pixmob::TIME_32_MS, spacing, first ? &job : nullptr,
                 pixmob::RAINBOW_RF_SUSTAIN_CODE);
    first = false;
  }
}

// Sends the chained frames of one timed light. Alternate frames also use a
// 96 ms release instead of 32 ms; a fade in is the attack of the first frame
// and a fade out the release of the last one. A newer command changes the
// generation and ends the chain within a few milliseconds; a frame already
// transmitting finishes.
void runLight(const TxJob& job) {
  pixmob::FadedLight light = pixmob::beginFadedLight(job.lightMs, job.attack, job.release);
  const uint32_t start = millis();
  pixmob::LightFrameSpec frame;
  bool first = true;
  while (pixmob::nextFadedFrame(light, frame)) {
    pixmob::FadedLight ahead = light;
    pixmob::LightFrameSpec next;
    const uint32_t spacing = pixmob::nextFadedFrame(ahead, next) ? next.atMs - frame.atMs : 0;
    while (millis() - start < frame.atMs) {
      if (job.generation != txGeneration.load()) return;
      vTaskDelay(pdMS_TO_TICKS(5));
    }
    if (job.generation != txGeneration.load()) return;
    // Acknowledge once, with the first frame, not after the whole light.
    sendEnvelope(job.levels, frame.varied, frame.attack, frame.sustain, frame.release, spacing,
                 first ? &job : nullptr);
    first = false;
  }
}

void runJob(const TxJob& job) {
  if (job.cut) {
    if (job.generation == txGeneration.load()) sendCutFrame(job.levels);
    return;
  }
  if (job.cycle) {
    runRainbow(job);
    return;
  }
  if (job.strobe) {
    runStrobe(job);
    return;
  }
  if (job.lightMs) {
    runLight(job);
    return;
  }
  // A single flash is acknowledged with its first frame, before the RF
  // copies; Auto's repeated flash after its last repeat.
  const bool single = job.repeats == 1;
  bool completed = true;
  for (uint8_t repeat = 0; repeat < job.repeats; ++repeat) {
    if (job.generation != txGeneration.load()) { completed = false; break; }
    sendFrame(job.levels, pixmob::rfFlashCopies(job.repeats), single ? &job : nullptr);
    if (repeat + 1 < job.repeats) {
      // Auto keeps the original 80 ms gaps. Cancellation can interrupt
      // the waiting gap, but never changes a waveform already transmitting.
      for (uint8_t wait = 0; wait < 8; ++wait) {
        if (job.generation != txGeneration.load()) break;
        vTaskDelay(pdMS_TO_TICKS(10));
      }
    }
  }
  if (!single && completed) acknowledge(&job);
}

// Between jobs the worker sends the RF "nothing" frames that keep wristbands
// awake (RfPlan.h); a job that arrives meanwhile waits for at most one frame.
void txWorker(void*) {
  IrSender.begin(IR_PIN);
  TxJob job;
  for (;;) {
    TickType_t wait = portMAX_DELAY;
    if (rfStatus == RF_READY) {
      if (rfSleepChange.exchange(false))
        pixmob::rfSetSleepAfter(rfKeep, rfSleepAfterMs.load(), millis());
      if (rfWakeRequest.exchange(false)) pixmob::rfStartWake(rfKeep, millis());
      rfKeep.intervalMs = rfKeepAwakeMs.load();
      uint32_t waitMs = 200;  // settings are looked at again at least this often
      if (defaultOutput.load() & pixmob::OUTPUT_RF) {
        const uint32_t due = pixmob::rfNextNothing(rfKeep, millis());
        if (due < waitMs) waitMs = due;
      }
      wait = pdMS_TO_TICKS(waitMs);
    }
    if (xQueueReceive(txQueue, &job, wait) == pdTRUE) {
      txBusy.store(true);
      runningGeneration = job.generation;
      runningOutput = job.output;
      runJob(job);
      txIdleSince.store(millis());
      txBusy.store(false);
      continue;
    }
    if (rfActive() && pixmob::rfNextNothing(rfKeep, millis()) == 0) rfSendNothing();
  }
}

void changeMode(Mode next) {
  txGeneration.fetch_add(1);
  xQueueReset(txQueue);
  currentMode = next;
  transmitBeats = false;
  colorIndex = 0;
  lastAuto = 0;
  autoAwaiting = false;
  lightSpan = 0;
  if (next == MUSIC_MODE) {
    detector.reset();
    detector.setSensitivity(sensitivity);
  }
}

// What a beat (Music, Browser) or an Auto step shows, and the colors Auto
// and Music step through. Set with the @ line commands; main loop only.
char beatStyle = 'F';  // 'F' quick flash, 'L' timed light, 'S' strobe burst
uint32_t beatMs = 0;
uint8_t beatAttack = 0, beatRelease = 0;
char beatPalette[9] = "";  // empty: each mode's own default colors

// Rainbow while nothing controls the board, ended by any serial byte. The
// choice is kept in the board's own settings storage (not in the wristband):
// 0 off, 1 only from power-on, 2-3600 also after that many seconds without
// serial input or IR output.
Preferences settings;
uint16_t idleSeconds = 10;
bool idleActive = false;
uint32_t lastInput = 0;  // millis() of the last serial byte

// Time between Auto steps: the length of one step's light, at least the
// original 1.8 s. A timed light with fades therefore breathes: fade in,
// stay, fade out, next color.
uint32_t autoInterval() {
  uint32_t length = 0;
  if (beatStyle == 'L') length = pixmob::fadedLightTotalMs(beatMs, beatAttack, beatRelease);
  else if (beatStyle == 'S') length = beatMs;
  return length > 1800 ? length : 1800;
}

TxJob newJob(char color, const pixmob::Levels& levels) {
  TxJob job = {};
  job.generation = txGeneration.load();
  job.color = color;
  job.levels = levels;
  job.repeats = 1;
  // Without a working radio everything goes out by IR.
  job.output = rfStatus == RF_READY ? defaultOutput.load() : pixmob::OUTPUT_IR;
  return job;
}

bool queueColor(char color, bool beat = false, uint8_t repeats = 1) {
  // Manual/song cues are also single-frame: repeated frames retrigger the
  // observed wristband (confirmed with the one-frame Green comparison).
  pixmob::Levels levels;
  if (!pixmob::colorLevels(color, levels)) return false;
  TxJob job = newJob(color, levels);
  job.beat = beat;
  job.repeats = repeats;
  return xQueueOverwrite(txQueue, &job) == pdPASS;
}

// One beat or Auto step in the chosen style. flashRepeats applies to the
// quick flash only (Auto keeps its three frames).
bool queueStepLevels(char color, const pixmob::Levels& levels, bool beat, uint8_t flashRepeats) {
  TxJob job = newJob(color, levels);
  job.beat = beat;
  job.styled = true;
  if (beatStyle == 'F') {
    job.repeats = flashRepeats;
    return xQueueOverwrite(txQueue, &job) == pdPASS;
  }
  job.lightMs = beatMs;
  if (beatStyle == 'S') {
    job.strobe = 1;
  } else {
    job.attack = beatAttack;
    job.release = beatRelease;
  }
  if (xQueueOverwrite(txQueue, &job) != pdPASS) return false;
  if (beatStyle == 'L') {
    lightLevels = levels;
    lightOutput = job.output;
    lightStart = millis();
    lightSpan = pixmob::fadedLightTotalMs(beatMs, beatAttack, beatRelease) + 150;
  }
  return true;
}

bool queueStep(char color, bool beat, uint8_t flashRepeats) {
  pixmob::Levels levels;
  if (!pixmob::colorLevels(color, levels)) return false;
  return queueStepLevels(color, levels, beat, flashRepeats);
}

// Next color of a mode: the chosen palette, or the mode's own defaults.
char stepColor(const char* defaults) {
  const char* colors = beatPalette[0] ? beatPalette : defaults;
  const uint8_t count = uint8_t(strlen(colors));
  const char color = colors[colorIndex % count];
  colorIndex = (colorIndex + 1) % count;
  return color;
}

// Exact lines: the rainbow setting the website shows and changes.
void printIdleRainbow() {
  if (idleSeconds == 0) Serial.println("IDLE RAINBOW: OFF");
  else if (idleSeconds == 1) Serial.println("IDLE RAINBOW: ON");
  else Serial.printf("IDLE RAINBOW: ON %u\n", unsigned(idleSeconds));
}

// Exact lines: the website shows RF and offers its settings only when
// "RF: ON", "RF: OFF" or "RF: ONLY" is seen (IR and RF, IR only, RF only).
// RF FRAMES counts frames since power-on.
void printRf() {
  if (rfStatus != RF_READY) {
    Serial.println(rfStatus == RF_NOT_FOUND     ? "RF: NOT FOUND"
                   : rfStatus == RF_WIRE_FAILED ? "RF: ERROR GDO0 WIRE"
                   : rfStatus == RF_RMT_FAILED  ? "RF: ERROR RMT"
                                                : "RF: ERROR SETUP");
    return;
  }
  const uint8_t output = defaultOutput.load();
  Serial.println(output == pixmob::OUTPUT_BOTH ? "RF: ON"
                 : output == pixmob::OUTPUT_RF ? "RF: ONLY"
                                               : "RF: OFF");
  Serial.printf("RF CARRIER: %.2f MHz %d dBm\n", pixmob::RF_MHZ, pixmob::RF_DBM);
  Serial.printf("RF KEEP AWAKE: %lu\n", (unsigned long)rfKeepAwakeMs.load());
  // Exact line: "OFF" (kept awake while the board is powered) or how long
  // after the last light the bands are left to sleep.
  const uint32_t sleepAfterMs = rfSleepAfterMs.load();
  if (sleepAfterMs == pixmob::RF_SLEEP_NEVER) Serial.println("RF SLEEP AFTER: OFF");
  else Serial.printf("RF SLEEP AFTER: %lu S\n", (unsigned long)(sleepAfterMs / 1000));
  Serial.printf("RF FRAMES: %lu SENT %lu FAILED\n", (unsigned long)rfFramesSent.load(),
                (unsigned long)rfFramesFailed.load());
}

// @R1 / @R0 / @R2: every light by IR and RF, IR only or RF only (kept by the
// board; a choice with RF also wakes the wristbands), @RW wakes them, @RK
// sets the keep-awake interval and @RS how long after the last light they
// are left to sleep, 0 never (both kept by the board).
void applyRfSetting(const pixmob::LightCommand& command) {
  if (rfStatus == RF_READY) {
    if (command.option == '1' || command.option == '0' || command.option == '2') {
      const uint8_t mode = uint8_t(command.option - '0');
      defaultOutput.store(mode == 1 ? pixmob::OUTPUT_BOTH
                          : mode == 2 ? pixmob::OUTPUT_RF
                                      : pixmob::OUTPUT_IR);
      settings.putUChar("rfmode", mode);
      // The earlier on/off key, so an older build keeps a matching choice.
      settings.putBool("rf", mode != 0);
      if (mode != 0) rfWakeRequest.store(true);
    } else if (command.option == 'W') {
      if (defaultOutput.load() & pixmob::OUTPUT_RF) {
        rfWakeRequest.store(true);
        Serial.printf("RF WAKE: %lu MS\n", (unsigned long)pixmob::RF_WAKE_MS);
      }
    } else if (command.option == 'K') {
      rfKeepAwakeMs.store(command.ms);
      settings.putUInt("rfkeep", command.ms);
    } else if (command.option == 'S') {
      rfSleepAfterMs.store(command.ms * 1000);  // seconds as written
      settings.putUInt("rfsleep", command.ms);
      rfSleepChange.store(true);
    }
  }
  printRf();
}

// Applies an @ command. The mode keeps running.
void applyBeatSetting(const pixmob::LightCommand& command) {
  if (command.color == 'R') {
    applyRfSetting(command);
    return;
  }
  if (command.color == 'I') {
    idleSeconds = uint16_t(command.ms);
    settings.putUShort("idlesec", idleSeconds);
    // The earlier on/off key, so an older build keeps a matching choice.
    settings.putBool("idle", idleSeconds != 0);
    printIdleRainbow();
    return;
  }
  if (command.color == 'P') {
    strcpy(beatPalette, command.palette);
    colorIndex = 0;
    Serial.printf("BEAT PALETTE: %s\n", beatPalette[0] ? beatPalette : "DEFAULT");
    return;
  }
  beatStyle = command.color;
  beatMs = command.ms;
  beatAttack = command.attack;
  beatRelease = command.release;
  if (beatStyle == 'F') Serial.println("BEAT STYLE: F");
  else if (beatStyle == 'S') Serial.printf("BEAT STYLE: S %lu\n", (unsigned long)beatMs);
  else
    Serial.printf("BEAT STYLE: L %lu %u %u\n", (unsigned long)beatMs, beatAttack, beatRelease);
}

// Runs one parsed line command (see LightCommand.h).
bool queueCommand(const pixmob::LightCommand& command) {
  TxJob job = newJob(command.color, command.levels);
  // /I, /R or /B: this light only. RF asked for without a radio sends nothing
  // by RF.
  if (command.output)
    job.output = rfStatus == RF_READY ? command.output : command.output & pixmob::OUTPUT_IR;
  if (command.kind == '~') {
    job.lightMs = command.ms;
    job.cycle = command.cycle;
  } else if (command.kind == '.') {
    job.line = true;
  } else {
    job.lightMs = command.ms;
    if (command.kind == '#') {
      job.attack = command.attack;
      job.release = command.release;
    } else {
      job.strobe = command.kind == '^' ? 2 : 1;
    }
  }
  if (xQueueOverwrite(txQueue, &job) != pdPASS) return false;
  if (command.kind == '#') {
    lightLevels = command.levels;
    lightOutput = job.output;
    lightStart = millis();
    lightSpan = pixmob::fadedLightTotalMs(command.ms, command.attack, command.release) + 150;
  }
  return true;
}

void queueCut(const pixmob::Levels& levels) {
  TxJob job = newJob('=', levels);
  job.cut = true;
  job.output = lightOutput;  // ended the way it went out
  xQueueOverwrite(txQueue, &job);
}

// R, or =RRGGBB for custom levels.
void printColor(const TxJob& job) {
  if (job.color == '=')
    Serial.printf("=%02X%02X%02X", job.levels.red, job.levels.green, job.levels.blue);
  else
    Serial.print(job.color);
}

void publishCompleted() {
  TxJob job;
  while (xQueueReceive(completedQueue, &job, 0) == pdTRUE) {
    if (job.generation != txGeneration.load()) continue;
    if (job.idle) {
      Serial.println("IDLE RAINBOW RUNNING");
      continue;
    }
    if (job.styled) {
      // A beat or Auto step: the same acknowledgement as a quick flash.
    } else if (job.cycle) {
      Serial.printf("Rainbow: %lu %lu\n", (unsigned long)job.lightMs, (unsigned long)job.cycle);
      continue;
    } else if (job.strobe) {
      Serial.print(job.strobe == 2 ? "Build: " : "Strobe: ");
      printColor(job);
      Serial.printf(" %lu\n", (unsigned long)job.lightMs);
      continue;
    } else if (job.lightMs) {
      Serial.print("Light: ");
      printColor(job);
      Serial.printf(" %lu", (unsigned long)job.lightMs);
      if (job.attack || job.release) Serial.printf(" %u %u", job.attack, job.release);
      Serial.println();
      continue;
    }
    if (job.line) {
      Serial.print("Flash: ");
      printColor(job);
      Serial.println();
      continue;
    }
    // One serial-output owner prevents fragments from interleaving. This line
    // acknowledges completed transmission, not verified wristband reception.
    if (job.beat) Serial.print("BEAT! ");
    Serial.print("Color sent: ");
    printColor(job);
    Serial.println();
    if (currentMode == AUTO_MODE) {
      autoAwaiting = false;
      lastAuto = millis();
    }
  }
}

void publishMetadata() {
  Serial.println("AUDIO FORMAT: BASS ENVELOPE 16-BIT");
  Serial.println("CAPABILITIES: BROWSER BEATS");
  Serial.println("PRESET FRAMES: 1");
  // Exact line: the website labels White and offers K only when it is seen.
  Serial.println("WHITE PRESET: NEUTRAL CANDIDATE (K = WHITISH)");
  // Exact line: the website sends #<color><ms> only when it is seen.
  Serial.println("TIMED LIGHT: READY");
  // Exact line: the website sends !<color><ms> and ^<color><ms> only when it
  // is seen.
  Serial.println("STROBE: READY");
  // Exact line: the website sends =RRGGBB colors, the '.' flash and fade
  // codes only when it is seen.
  Serial.println("CUSTOM LIGHT: READY");
  // Exact line: the website sends ~<ms>,<cycle> only when it is seen.
  Serial.println("RAINBOW: READY");
  // Exact line: the website sends the @ beat settings and the beat digits
  // 4-8 only when it is seen.
  Serial.println("BEAT EFFECTS: READY");
  // Exact line: the website offers the idle seconds only when it is seen.
  Serial.println("IDLE RETURN: READY");
  // Exact line: the website offers IR only / RF only per light (/I /R /B)
  // and @R2 only when it is seen.
  Serial.println("LIGHT OUTPUT: READY");
  // Exact line: the website offers when RF bands may sleep (@RS) only when it
  // is seen.
  Serial.println("RF SLEEP SETTING: READY");
  printIdleRainbow();
  printRf();
}

// Line commands (see LightCommand.h) are collected until the line ends.
char lineBuffer[24];
uint8_t lineLength = 0;
bool lineActive = false;
bool lineOverflow = false;

void handleSerial() {
  // A bounded serial pass cannot starve the microphone when a host sends data.
  for (uint8_t n = 0; n < 32 && Serial.available(); ++n) {
    char c = Serial.read();
    lastInput = millis();
    if (idleActive) {
      // The first byte from a controller ends the rainbow.
      idleActive = false;
      txGeneration.fetch_add(1);
      xQueueReset(txQueue);
    }
    if (c >= 'a' && c <= 'z') c -= 32;
    if (lineActive) {
      if (c == '\r') continue;
      if (c != '\n') {
        if (lineLength + 1 < sizeof(lineBuffer)) lineBuffer[lineLength++] = c;
        else lineOverflow = true;
        continue;
      }
      lineActive = false;
      lineBuffer[lineLength] = 0;
      pixmob::LightCommand command;
      if (!lineOverflow && pixmob::parseLightCommand(lineBuffer, command)) {
        if (command.kind == '@') {
          applyBeatSetting(command);
        } else if (command.kind == '*') {
          // A browser beat in any color; like the digits, Host mode only.
          if (currentMode == HOST_MODE)
            queueStepLevels(command.color, command.levels, true, 1);
        } else {
          changeMode(MANUAL_MODE);
          queueCommand(command);
        }
      } else {
        Serial.println(lineBuffer[0] == '*' ? "BEAT REJECTED"
                       : lineBuffer[0] == '@' ? "BEAT SETTING REJECTED"
                       : lineBuffer[0] == '~' ? "RAINBOW REJECTED"
                       : lineBuffer[0] == '#' ? "LIGHT REJECTED"
                       : lineBuffer[0] == '.' ? "FLASH REJECTED" : "STROBE REJECTED");
      }
      continue;
    }
    if (c == '#' || c == '!' || c == '^' || c == '.' || c == '~' || c == '@' || c == '*') {
      lineActive = true;
      lineOverflow = false;
      lineBuffer[0] = c;
      lineLength = 1;
      continue;
    }
    if (c == '\r' || c == '\n' || c == ' ') continue;
    if (c == 'A') {
      changeMode(AUTO_MODE);
      Serial.println("AUTO MODE ON");
    }
    else if (c == 'M') {
      changeMode(MUSIC_MODE);
      transmitBeats = true;
      Serial.println("MUSIC SYNC ON");
      publishMetadata();
    }
    else if (c == 'H') {
      // Host mode has no local beat source. Only explicit digits received from
      // the browser can queue a one-frame color; silence/disconnect adds none.
      changeMode(HOST_MODE);
      Serial.println("BROWSER SYNC ON");
      publishMetadata();
    }
    else if (c >= '1' && c <= '8') {
      // 1-3 are R/G/B as before; 4-8 add Y/C/M/W/K.
      if (currentMode == HOST_MODE) {
        const char colors[] = {'R', 'G', 'B', 'Y', 'C', 'M', 'W', 'K'};
        queueStep(colors[c - '1'], true, 1);
      }
    }
    else if (c == 'V') {
      // CLI diagnostics only: use the same detector with IR disabled to help
      // distinguish microphone input artifacts from transmitter interference.
      changeMode(MUSIC_MODE);
      Serial.println("MIC DIAGNOSTIC ON");
      publishMetadata();
    }
    else if (c == 'X') {
      // A timed light that may still be showing is ended with a cut frame.
      const bool lit = lightSpan && millis() - lightStart < lightSpan;
      const pixmob::Levels litLevels = lightLevels;
      changeMode(MANUAL_MODE);
      if (lit) queueCut(litLevels);
      Serial.println("AUTO / MUSIC STOPPED");
      publishMetadata();
    }
    else if (c == '+') {
      sensitivity = max(1.10f, sensitivity - 0.10f);
      detector.setSensitivity(sensitivity);
      Serial.printf("Sensitivity: %.2f\n", sensitivity);
    }
    else if (c == '-') {
      sensitivity = min(2.50f, sensitivity + 0.10f);
      detector.setSensitivity(sensitivity);
      Serial.printf("Sensitivity: %.2f\n", sensitivity);
    }
    else if (c == 'R' || c == 'G' || c == 'B' || c == 'Y' || c == 'C' || c == 'W' ||
             c == 'K') {
      changeMode(MANUAL_MODE);
      queueColor(c);
    }
  }
}

void readMicrophone() {
  // Only microphone Music/diagnostics need audio data. A 256-sample read otherwise
  // blocks this UART/completion loop for about 16 ms at 16 kHz, both before
  // accepting a host command and before reporting its completed IR frame.
  // M/V reset the detector and retain its one-second warmup when capture resumes.
  if (currentMode != MUSIC_MODE) return;
  const size_t bytesRead = I2S.readBytes((char*)audioSamples, sizeof(audioSamples));
  const size_t count = bytesRead / sizeof(int32_t);
  if (count == 0) return;
  const uint32_t now = millis();
  const auto result = detector.process(audioSamples, count, now);
  if (currentMode != MUSIC_MODE) return;
  if (now - lastPrint >= 50) {
    Serial.printf("Level:%.0f Threshold:%.0f\n", result.level16, result.threshold16);
    Serial.printf("Analysis:Full:%.0f BassFraction:%.6f\n", result.full16, result.bassFraction);
    lastPrint = now;
  }
  if (result.beat) {
    if (!transmitBeats) {
      Serial.println("ONSET DETECTED");
      return;
    }
    queueStep(stepColor("RGB"), true, 1);
  }
}

// The endless rainbow that any serial byte ends.
void startIdleRainbow() {
  TxJob job = newJob('~', {});
  job.idle = true;
  job.cycle = pixmob::DEFAULT_RAINBOW_CYCLE_MS;
  job.lightMs = 1;
  idleActive = xQueueOverwrite(txQueue, &job) == pdPASS;
}

// Back to the rainbow once the board has been left alone: stopped (no Auto,
// Music or Browser sync), nothing sending or still lit, and no serial byte,
// each for the chosen number of seconds.
void maybeStartIdleRainbow() {
  if (idleSeconds < 2 || idleActive || currentMode != MANUAL_MODE || lineActive) return;
  if (txBusy.load() || uxQueueMessagesWaiting(txQueue)) return;
  const uint32_t now = millis();
  if (lightSpan && now - lightStart < lightSpan) return;
  const uint32_t wait = uint32_t(idleSeconds) * 1000;
  if (now - lastInput < wait || now - txIdleSince.load() < wait) return;
  startIdleRainbow();
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  I2S.setPins(MIC_SCK, MIC_WS, -1, MIC_SD);
  I2S.setTimeout(50);

  if (!I2S.begin(
    I2S_MODE_STD,
    16000,
    I2S_DATA_BIT_WIDTH_32BIT,
    I2S_SLOT_MODE_MONO,
    I2S_STD_SLOT_LEFT
  )) {
    Serial.println("MICROPHONE ERROR");
    while (true) delay(1000);
  }

  settings.begin("pixmob", false);
  // Builds before beat-idle-build kept only on/off; on becomes 10 s.
  if (settings.isKey("idlesec"))
    idleSeconds = min<uint16_t>(settings.getUShort("idlesec", 10), 3600);
  else
    idleSeconds = settings.getBool("idle", true) ? 10 : 0;
  // Builds before LIGHT OUTPUT kept only RF on/off.
  const uint8_t rfMode = settings.isKey("rfmode") ? settings.getUChar("rfmode", 1)
                                                  : (settings.getBool("rf", true) ? 1 : 0);
  defaultOutput.store(rfMode == 2 ? pixmob::OUTPUT_RF
                      : rfMode == 0 ? pixmob::OUTPUT_IR
                                    : pixmob::OUTPUT_BOTH);
  const uint32_t keepAwake = settings.getUInt("rfkeep", pixmob::RF_KEEP_AWAKE_DEFAULT_MS);
  if (keepAwake == 0 ||
      (keepAwake >= pixmob::RF_KEEP_AWAKE_MIN_MS && keepAwake <= pixmob::RF_KEEP_AWAKE_MAX_MS))
    rfKeepAwakeMs.store(keepAwake);
  // No key (every build before @RS): never left to sleep.
  const uint32_t sleepAfter = settings.getUInt("rfsleep", 0);
  if (sleepAfter >= pixmob::RF_SLEEP_MIN_S && sleepAfter <= pixmob::RF_SLEEP_MAX_S)
    rfSleepAfterMs.store(sleepAfter * 1000);
  rfSleepChange.store(true);
  // Before the worker starts: afterwards only the worker talks to the CC1101.
  rfStatus = rfInit();
  if (rfActive()) rfWakeRequest.store(true);

  txQueue = xQueueCreate(1, sizeof(TxJob));
  completedQueue = xQueueCreate(8, sizeof(TxJob));
  if (!txQueue || !completedQueue ||
      xTaskCreatePinnedToCore(txWorker, "pixmob-ir", 6144, nullptr, 1, nullptr, 0) != pdPASS) {
    Serial.println("IR WORKER ERROR");
    while (true) delay(1000);
  }
  Serial.println("PIXMOB BEAT CONTROLLER READY!");
  publishMetadata();
  Serial.println("R/G/B/Y/C/W = Preset color");
  Serial.println("K = Warm white");
  Serial.println("#<color><ms> = Timed light, e.g. #R1500 (RGBYCMWK, 50-600000 ms)");
  Serial.println("!<color><ms> = Strobe, ^<color><ms> = Build (speeds up), 200-60000 ms");
  Serial.println("<color> may be =RRGGBB (hex levels, each up to C8); .<color> = Flash");
  Serial.println("#<color><ms>,<in>,<out> = Timed light with fade codes 0-7");
  Serial.println("~<ms>,<cycle ms> = Rainbow (500-600000 ms, cycle 1000-20000 ms)");
  Serial.println("@F / @L<ms>,<in>,<out> / @S<ms> = Beat style; @P<letters> or @P* = Beat colors");
  Serial.println("A = Auto");
  Serial.println("M = Music Sync");
  Serial.println("H = Browser Sync");
  Serial.println("1-8 = Browser beat R/G/B/Y/C/M/W/K (Host mode only); *<color> = beat in any color");
  Serial.println("X = Stop");
  Serial.println("+ = More sensitive");
  Serial.println("- = Less sensitive");
  Serial.println("@I<s> = Rainbow when nothing controls the board: 0 off, 1 only at power-on,");
  Serial.println("        2-3600 also after that many seconds without commands");
  Serial.println("@R1 / @R0 / @R2 = every light by IR and RF (922.36 MHz) / IR only / RF only");
  Serial.println("<light>/I, /R or /B = that light by IR only, RF only or both, e.g. #R1500/R");
  Serial.println("@RW = wake RF bands (35 s)");
  Serial.println("@RK<ms> = RF keep-awake frame interval: 0 or 200-60000 ms");
  Serial.println("@RS<s> = let RF bands sleep <s> s after the last light: 0 never (default) or 60-86400");
  Serial.println("        bands that have slept can need 1-2 min of RF to wake");
  // Nothing has been received yet: run the rainbow until something is.
  if (idleSeconds) startIdleRainbow();
}

void loop() {
  handleSerial();
  publishCompleted();
  readMicrophone();
  publishCompleted();
  maybeStartIdleRainbow();
  if (currentMode == AUTO_MODE) {
    const uint32_t now = millis();
    if (!autoAwaiting && (lastAuto == 0 || now - lastAuto >= autoInterval())) {
      if (queueStep(stepColor("RGBYCMW"), false, 3)) autoAwaiting = true;
    }
  }

  delay(1);
}
