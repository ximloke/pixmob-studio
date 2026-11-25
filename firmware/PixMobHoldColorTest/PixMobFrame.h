// PixMob IR frame builder for the published single-color commands.
// Portable C++ (no Arduino dependency) so it can be tested on the host.
// Source of the format: jamesw343/PixMob_IR docs/ir_protocol.md.
// This only builds display commands; it contains no EEPROM/config commands.
#pragma once
#include <stddef.h>
#include <stdint.h>

namespace pixmob {

const uint16_t SLOT_US = 700;

// 6-bit value -> 8-bit line code, from the published encoding table.
const uint8_t ENCODE[64] = {
  0x21, 0x32, 0x54, 0x65, 0xa9, 0x9a, 0x6d, 0x29,
  0x56, 0x92, 0xa1, 0xb4, 0xb2, 0x84, 0x66, 0x2a,
  0x4c, 0x6a, 0xa6, 0x95, 0x62, 0x51, 0x42, 0x24,
  0x35, 0x46, 0x8a, 0xac, 0x8c, 0x6c, 0x2c, 0x4a,
  0x59, 0x86, 0xa4, 0xa2, 0x91, 0x64, 0x55, 0x44,
  0x22, 0x31, 0xb1, 0x52, 0x85, 0x96, 0xa5, 0x69,
  0x5a, 0x2d, 0x4d, 0x89, 0x45, 0x34, 0x61, 0x25,
  0x36, 0xad, 0x94, 0xaa, 0x8d, 0x49, 0x99, 0x26,
};

// Envelope time codes (attack / sustain / release), milliseconds:
// 0 = 0, 1 = 32, 2 = 96, 3 = 192, 4 = 480, 5 = 960, 6 = 2400, 7 = 3840.
// Avoided on purpose: sustain 7 with a non-zero release (uses the wristband's
// global sustain time instead) and release 0 (documented as changing the
// background color with a sustain multiplier that is still under study).
const uint8_t TIME_0_MS = 0, TIME_32_MS = 1, TIME_96_MS = 2, TIME_192_MS = 3;
const uint8_t TIME_480_MS = 4, TIME_960_MS = 5, TIME_2400_MS = 6;

struct Frame {
  uint16_t timings[72];  // alternating mark/space microseconds, mark first
  uint8_t count;         // number of timings
  uint8_t bytes[9];      // encoded bytes including magic and checksum
  uint8_t length;        // 6 or 9
};

// values: the 6-bit command bytes from offset 2 (flags, then the body).
inline bool buildFrame(const uint8_t* values, uint8_t valueCount, Frame& frame) {
  if (valueCount != 4 && valueCount != 7) return false;
  frame.length = valueCount + 2;
  frame.bytes[0] = 0x80;
  uint16_t sum = 0;
  for (uint8_t i = 0; i < valueCount; ++i) {
    if (values[i] > 63) return false;
    frame.bytes[i + 2] = ENCODE[values[i]];
    sum += frame.bytes[i + 2];
  }
  frame.bytes[1] = ENCODE[(sum >> 2) & 0x3F];

  // Bits go out least-significant first. Leading zeros are skipped and
  // trailing zeros dropped; equal neighbours merge into one mark or space.
  frame.count = 0;
  bool started = false;
  uint8_t level = 1;
  uint16_t run = 0;
  for (uint8_t byteIndex = 0; byteIndex < frame.length; ++byteIndex) {
    for (uint8_t bit = 0; bit < 8; ++bit) {
      const uint8_t value = (frame.bytes[byteIndex] >> bit) & 1;
      if (!started) {
        if (!value) continue;
        started = true;
        level = 1;
        run = 1;
        continue;
      }
      if (value == level) {
        ++run;
      } else {
        if (frame.count >= sizeof(frame.timings) / sizeof(frame.timings[0])) return false;
        frame.timings[frame.count++] = run * SLOT_US;
        level = value;
        run = 1;
      }
    }
  }
  if (!started) return false;
  // A final run of zeros is silence; only a final mark is transmitted.
  if (level == 1) {
    if (frame.count >= sizeof(frame.timings) / sizeof(frame.timings[0])) return false;
    frame.timings[frame.count++] = run * SLOT_US;
  }
  return frame.count > 0 && (frame.count % 2) == 1;
}

// 6-byte "Display Single Color": the wristband shows the color briefly with
// its own fixed envelope. Channels use their upper six bits.
inline bool singleColor(uint8_t red, uint8_t green, uint8_t blue, Frame& frame) {
  const uint8_t values[4] = {0, uint8_t(green >> 2), uint8_t(red >> 2), uint8_t(blue >> 2)};
  return buildFrame(values, 4, frame);
}

// 9-byte "Display Single Color (Configurable Fields)": same color fields plus
// attack / sustain / release time codes; chance 100 %, no group restriction,
// no repeat.
inline bool singleColorEnvelope(uint8_t red, uint8_t green, uint8_t blue, uint8_t attack,
                                uint8_t sustain, uint8_t release, Frame& frame) {
  if (attack > 7 || sustain > 7 || release > 7) return false;
  const uint8_t values[7] = {0, uint8_t(green >> 2), uint8_t(red >> 2), uint8_t(blue >> 2),
                             uint8_t(attack << 3), uint8_t((release << 3) | sustain), 0};
  return buildFrame(values, 7, frame);
}

}  // namespace pixmob
