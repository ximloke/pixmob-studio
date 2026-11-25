// PixMob RF colour-frame encoder (no Arduino dependency, host-testable). The
// beat controller keeps an identical copy (tests check that the copies match).
//
// The bit time and the two named frames below (kNothingTiming, the wine red)
// come from the published 915 MHz captures in danielweidman/
// pixmob-ir-reverse-engineering (rf/, MIT License); tests/rf-frame.cpp checks
// them against those captures.
//
// Frame layout, 6b8b line code and CRC12 parameters follow the
// public sueppchen PixMob_waveband library (pixmob_cement.h/.cpp v0.2.1,
// https://github.com/sueppchen/PixMob_waveband), whose notice is kept here:
//
//   Software License Agreement (BSD License)
//
//   Copyright (c) 2024 Sueppchen & Serge-45
//
//   All rights reserved.
//
//   Redistribution and use in source and binary forms, with or without
//   modification, are permitted provided that the following conditions are met:
//   1. Redistributions of source code must retain the above copyright
//   notice, this list of conditions and the following disclaimer.
//   2. Redistributions in binary form must reproduce the above copyright
//   notice, this list of conditions and the following disclaimer in the
//   documentation and/or other materials provided with the distribution.
//   3. Neither the name of the copyright holders nor the
//   names of its contributors may be used to endorse or promote products
//   derived from this software without specific prior written permission.
//
//   THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS ''AS IS'' AND ANY
//   EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
//   WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
//   DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER BE LIABLE FOR ANY
//   DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
//   (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
//   LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
//   ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
//   (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
//   SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
//
// Only the plain colour command (mode 0x00, the library's MODE_RX) for group 0
// (every band) can be built here. The library's MODE_WRITE (0x0F) frames
// change settings stored in the band (EEPROM); they are deliberately left out.
#pragma once

#include <stdint.h>

namespace pixmobrf {

// One bit on air. Venue captures of PixMob's own transmitter (2023 and 2024)
// measure 511.6-511.9 us per bit; the sueppchen library uses 500 us.
constexpr uint16_t kBitMicros = 512;
constexpr uint16_t kStartDelayMicros = 800;  // STX to first bit (library value)
constexpr uint8_t kPreamble = 0x55;          // sent twice, LSB first
constexpr uint8_t kFrameBytes = 9;           // crcA, 7 payload bytes, crcB
constexpr uint8_t kFrameBits = 16 + 2 + kFrameBytes * 8;  // preamble, sync, bytes

// 6b8b line code. Each code byte is sent least significant bit first.
constexpr uint8_t kLineCode[64] = {
    0x21, 0x35, 0x2c, 0x34, 0x66, 0x26, 0xac, 0x24, 0x46, 0x56, 0x44, 0x54, 0x64, 0x6d, 0x4c, 0x6c,
    0x92, 0xb2, 0xa6, 0xa2, 0xb4, 0x94, 0x86, 0x96, 0x42, 0x62, 0x2a, 0x6a, 0xb6, 0x36, 0x22, 0x32,
    0x31, 0xb1, 0x95, 0xb5, 0x91, 0x99, 0x85, 0x89, 0xa5, 0xa4, 0x8c, 0x84, 0xa1, 0xa9, 0x8d, 0xad,
    0x9a, 0x8a, 0x5a, 0x4a, 0x49, 0x59, 0x52, 0x51, 0x25, 0x2d, 0x69, 0x29, 0x4d, 0x45, 0x61, 0x65,
};

// Light envelope, each field 0-7 (library defaults: attack 1, hold 2,
// release 2, random 0).
struct Timing {
  uint8_t attack;
  uint8_t hold;
  uint8_t release;
  uint8_t random;
};
constexpr Timing kDefaultTiming = {1, 2, 2, 0};

// Published capture "nothing": black, lights nothing, but keeps bands awake
// (venue transmitters repeat it; a sleeping band needs up to ~30 s of frames).
constexpr Timing kNothingTiming = {1, 7, 1, 0};
// Published capture "wine_fade_in": red field 47 of 63, random 0 (every band).
constexpr uint8_t kWineRed = 47 << 2;
constexpr Timing kWineFadeInTiming = {4, 3, 2, 0};

inline uint8_t lineCode(uint8_t value) { return kLineCode[value & 0x3f]; }

// CRC12 over the seven line-coded payload bytes, processed LSB first with the
// reversed polynomial 0x8f3 and reversed initial value 0xc69.
inline uint16_t crc12(const uint8_t coded[7]) {
  uint16_t reg = 0xc69;
  for (uint8_t i = 0; i < 7; ++i) {
    reg ^= coded[i];
    for (uint8_t bit = 0; bit < 8; ++bit) reg = (reg & 1) ? uint16_t((reg >> 1) ^ 0x8f3) : uint16_t(reg >> 1);
  }
  return reg;
}

// The 9 bytes of a colour frame for group 0. Colours are 0-255; the band
// takes 6 bits per channel, so the two low bits are dropped.
inline void colorFrame(uint8_t red, uint8_t green, uint8_t blue, Timing timing,
                       uint8_t out[kFrameBytes]) {
  const uint8_t message[7] = {
      0x00,  // mode: plain colour (never 0x0F, the settings/EEPROM mode)
      uint8_t(green >> 2),
      uint8_t(red >> 2),
      uint8_t(blue >> 2),
      uint8_t(((timing.attack & 7) << 3) | (timing.random & 7)),
      uint8_t(((timing.release & 7) << 3) | (timing.hold & 7)),
      0x00,  // group 0: every band
  };
  for (uint8_t i = 0; i < 7; ++i) out[i + 1] = lineCode(message[i]);
  const uint16_t crc = crc12(out + 1);
  out[0] = lineCode(uint8_t(crc & 0x3f));
  out[8] = lineCode(uint8_t(crc >> 6));
}

// Bit number `index` (0 .. kFrameBits-1) of one transmission after the start
// delay: preamble 0x55 twice, sync bits 0 then 1, then the 9 bytes, every byte
// least significant bit first. A 1 bit switches the carrier on.
inline bool frameBit(const uint8_t frame[kFrameBytes], uint8_t index) {
  if (index < 16) return (kPreamble >> (index & 7)) & 1;
  if (index == 16) return false;
  if (index == 17) return true;
  index = uint8_t(index - 18);
  return (frame[index >> 3] >> (index & 7)) & 1;
}

}  // namespace pixmobrf
