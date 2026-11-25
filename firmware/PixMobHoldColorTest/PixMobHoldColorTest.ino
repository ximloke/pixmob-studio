// PixMob hold-color test. Standalone bench sketch, separate from
// PixMobBeatController; the website's preset adapter does not talk to it.
//
// Why the other sketches flash: the 6-byte color command makes the wristband
// show a color briefly and fade by itself. This test uses the published 9-byte
// single-color command with an explicit envelope (attack 0 ms, sustain
// 2400 ms, release 32 ms) and sends it again every 2 seconds, before the
// sustain ends.
//
// Observations on the user's wristband (13 Nov 2026), in order:
//  1. Full preset values: Red, Green, Blue, Yellow held; Magenta and White
//     only flashed; Cyan held but looked green (no blue).
//  2. Stepped brightness with dark gaps: White 100 % collapsed toward red;
//     dimmer White and all Magenta/Cyan steps held.
//  3. Continuous cycle with red+green+blue limited to 380: everything held
//     except Green (132/244/0), which had held in the first run.
//  4. With the NORMAL values below every color lit, but the user's video
//     showed three lit parts per color: about 2.4 s lit, 1.6 s dark, and a
//     new color taking over at once. So the wristband ignores a command that
//     is identical to the one still showing, and accepts a different one.
// Since then, consecutive frames of one color differ slightly (see
// `variation`) so that each re-send is accepted before the sustain ends.
//  5. With that change (variation 3) the user saw continuous light.
//     (Line added after that upload; the binary is unchanged.)
// The heaviest loads fail first and the limit moved down as testing went on,
// which fits a weakening supply, but nothing here measures the cause. The
// NORMAL values below are the ones seen to hold, with Green reduced.
//
// Wiring is unchanged: KY-005 IR on GPIO32, 38 kHz. The microphone is unused.
#define DISABLE_CODE_FOR_RECEIVER

#include <Arduino.h>
#include <IRremote.hpp>
#include "PixMobFrame.h"

const uint8_t IR_PIN = 32;
const uint32_t ENVELOPE_RESEND_MS = 2000;  // shorter than the 2400 ms sustain
const uint32_t BASIC_RESEND_MS = 250;      // method 2 only

struct NamedColor {
  const char* name;
  uint8_t red, green, blue;
};

// Same hues as the existing presets. Red, Blue and Yellow keep the preset
// values; Cyan, Magenta and White are the reduced values that held in the
// capped continuous cycle; Green keeps its 132:244 ratio at about two thirds.
// Full preset values for reference: Green 132/244/0, Cyan 132/200/160,
// Magenta 240/100/160, White 204/204/204.
const NamedColor NORMAL[] = {
  {"Red", 132, 32, 0},      {"Green", 88, 164, 0},    {"Blue", 16, 12, 160},
  {"Yellow", 132, 124, 0},  {"Cyan", 100, 152, 120},  {"Magenta", 180, 76, 120},
  {"White", 124, 124, 124},
};

// Same hues at reduced channel values (multiples of 4, as the command carries
// six bits per channel).
const NamedColor DIAGNOSTIC[] = {
  {"White 100%", 204, 204, 204},  {"White 75%", 152, 152, 152},
  {"White 50%", 100, 100, 100},   {"White 25%", 52, 52, 52},
  {"Magenta 100%", 240, 100, 160}, {"Magenta 75%", 180, 76, 120},
  {"Magenta 50%", 120, 48, 80},
  {"Cyan 100%", 132, 200, 160},   {"Cyan 50%", 64, 100, 80},
};

enum Method { STOPPED, ENVELOPE_HOLD, BASIC_REFRESH };
enum Sequence { NORMAL_CYCLE, DIAGNOSTIC_CYCLE };

Method method = ENVELOPE_HOLD;
Sequence sequence = NORMAL_CYCLE;
uint16_t powerCap = 0;  // 0 = off; otherwise limit on red + green + blue
uint8_t colorIndex = 0;
uint32_t colorStart = 0;
uint32_t lastSend = 0;
uint16_t framesSent = 0;
bool readingCap = false;
uint32_t capDigits = 0;
// How every second frame of a color differs from the first, so the wristband
// does not drop it as a repeat: bit 0 = release 96 ms instead of 32 ms,
// bit 1 = strongest channel one six-bit step lower. 0 = identical frames.
uint8_t variation = 3;
bool readingVariation = false;
pixmob::Frame frame;

const NamedColor* colors() { return sequence == NORMAL_CYCLE ? NORMAL : DIAGNOSTIC; }
uint8_t colorCount() {
  return sequence == NORMAL_CYCLE ? sizeof(NORMAL) / sizeof(NORMAL[0])
                                  : sizeof(DIAGNOSTIC) / sizeof(DIAGNOSTIC[0]);
}
// Normal: lit for the whole 10 s. Diagnostic: lit about 8 s, then about 2 s
// dark, so each step is visibly separate from the next.
uint32_t stepMs() { return 10000; }
uint32_t litMs() { return sequence == NORMAL_CYCLE ? 10000 : 6500; }

void applied(const NamedColor& color, uint8_t& red, uint8_t& green, uint8_t& blue) {
  red = color.red; green = color.green; blue = color.blue;
  const uint16_t sum = uint16_t(red) + green + blue;
  if (powerCap && sum > powerCap) {
    red = uint8_t(uint32_t(red) * powerCap / sum) & 0xFC;
    green = uint8_t(uint32_t(green) * powerCap / sum) & 0xFC;
    blue = uint8_t(uint32_t(blue) * powerCap / sum) & 0xFC;
  }
}

// Three short red flashes mark the start of every diagnostic cycle.
void cycleMarker() {
  Serial.println("CYCLE START (three red marker flashes)");
  for (uint8_t i = 0; i < 3; ++i) {
    if (pixmob::singleColor(132, 32, 0, frame)) IrSender.sendRaw(frame.timings, frame.count, 38);
    delay(350);
  }
  delay(1500);
}

void startColor(uint8_t index) {
  colorIndex = index % colorCount();
  if (colorIndex == 0 && method != STOPPED && sequence == DIAGNOSTIC_CYCLE) cycleMarker();
  colorStart = millis();
  framesSent = 0;
  uint8_t red, green, blue;
  applied(colors()[colorIndex], red, green, blue);
  Serial.printf("COLOR %u/%u %s (R%u G%u B%u, sum %u)\n", colorIndex + 1, colorCount(),
                colors()[colorIndex].name, red, green, blue, uint16_t(red) + green + blue);
}

void sendCurrent() {
  uint8_t red, green, blue;
  applied(colors()[colorIndex], red, green, blue);
  uint8_t release = pixmob::TIME_32_MS;
  if (method == ENVELOPE_HOLD && (framesSent & 1)) {
    if (variation & 1) release = pixmob::TIME_96_MS;
    if (variation & 2) {
      uint8_t* strongest = &red;
      if (green > *strongest) strongest = &green;
      if (blue > *strongest) strongest = &blue;
      if (*strongest >= 4) *strongest -= 4;
    }
  }
  const bool built = method == ENVELOPE_HOLD
    ? pixmob::singleColorEnvelope(red, green, blue, pixmob::TIME_0_MS, pixmob::TIME_2400_MS,
                                  release, frame)
    : pixmob::singleColor(red, green, blue, frame);
  if (!built) {
    Serial.println("FRAME ERROR");
    method = STOPPED;
    return;
  }
  lastSend = millis();
  IrSender.sendRaw(frame.timings, frame.count, 38);
  ++framesSent;
  Serial.printf("SENT %s frame %u (%u bytes, R%u G%u B%u, release code %u, %lu ms after color start)\n",
                colors()[colorIndex].name, framesSent, frame.length, red, green, blue, release,
                (unsigned long)(lastSend - colorStart));
}

void printHelp() {
  Serial.println("C = Normal cycle: seven colors, 10 s each (default)");
  Serial.println("D = Diagnostic steps: White 100/75/50/25, Magenta 100/75/50, Cyan 100/50");
  Serial.println("P<n> = Limit red+green+blue to n (e.g. P300), P0 = no limit");
  Serial.println("V<n> = How alternate frames differ: 0 identical, 1 release, 2 channel, 3 both (default)");
  Serial.println("1 = Hold with 9-byte envelope frames, resent every 2 s (default)");
  Serial.println("2 = Refresh the 6-byte flash frame every 250 ms (comparison)");
  Serial.println("0 = Stop sending, N = Next step now");
}

void finishCap() {
  if (!readingCap) return;
  readingCap = false;
  powerCap = capDigits > 765 ? 765 : uint16_t(capDigits);
  Serial.printf("POWER CAP %u\n", powerCap);
  if (method != STOPPED) startColor(0);
}

void handleSerial() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c >= 'a' && c <= 'z') c -= 32;
    if (readingVariation) {
      readingVariation = false;
      if (c >= '0' && c <= '3') {
        variation = c - '0';
        Serial.printf("VARIATION %u\n", variation);
        if (method != STOPPED) startColor(0);
        continue;
      }
    }
    if (readingCap && c >= '0' && c <= '9') {
      if (capDigits < 100000) capDigits = capDigits * 10 + (c - '0');
      continue;
    }
    finishCap();
    if (c == 'P') {
      readingCap = true;
      capDigits = 0;
    } else if (c == 'V') {
      readingVariation = true;
    } else if (c == '1' || c == '2') {
      method = c == '1' ? ENVELOPE_HOLD : BASIC_REFRESH;
      Serial.println(c == '1' ? "METHOD ENVELOPE HOLD" : "METHOD BASIC REFRESH");
      startColor(0);
    } else if (c == 'D' || c == 'C') {
      sequence = c == 'D' ? DIAGNOSTIC_CYCLE : NORMAL_CYCLE;
      if (method == STOPPED) method = ENVELOPE_HOLD;
      Serial.println(c == 'D' ? "SEQUENCE DIAGNOSTIC" : "SEQUENCE NORMAL");
      startColor(0);
    } else if (c == '0') {
      method = STOPPED;
      Serial.println("STOPPED");
    } else if (c == 'N' && method != STOPPED) {
      startColor(colorIndex + 1);
    }
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  IrSender.begin(IR_PIN);
  Serial.println("PIXMOB HOLD COLOR TEST READY (v4)");
  printHelp();
  Serial.println("METHOD ENVELOPE HOLD");
  Serial.println("SEQUENCE NORMAL");
  startColor(0);
}

void loop() {
  handleSerial();
  if (method == STOPPED) {
    delay(5);
    return;
  }
  const uint32_t elapsed = millis() - colorStart;
  if (elapsed >= stepMs()) {
    startColor(colorIndex + 1);
    return;
  }
  const uint32_t interval = method == ENVELOPE_HOLD ? ENVELOPE_RESEND_MS : BASIC_RESEND_MS;
  // No new frame once the lit part of the step is over; the last sustain then
  // runs out and leaves the dark gap of the diagnostic sequence.
  if (elapsed < litMs() && (framesSent == 0 || millis() - lastSend >= interval)) sendCurrent();
  delay(1);
}
