// Host test for firmware/PixMobRFTest/PixMobRFFrame.h.
// Known answers: the 16 distinct captured colour frames listed in the public
// sueppchen PixMob_waveband example basic.ino (written MSB first there, so each
// byte is bit-reversed before comparing with the LSB-first encoder).
#include <cstdio>
#include <cstdlib>
#include "../firmware/PixMobRFTest/PixMobRFFrame.h"

static int failures = 0;

static void expect(bool condition, const char* label) {
  if (!condition) {
    std::printf("FAIL: %s\n", label);
    ++failures;
  }
}

static uint8_t reverseBits(uint8_t value) {
  uint8_t out = 0;
  for (int i = 0; i < 8; ++i) out = uint8_t(out | (((value >> i) & 1) << (7 - i)));
  return out;
}

static int decode(uint8_t code) {
  for (int i = 0; i < 64; ++i)
    if (pixmobrf::kLineCode[i] == code) return i;
  return -1;
}

struct Captured { const char* name; uint8_t bytes[9]; };

static const Captured kCaptured[] = {
    {"nothing_Black", {0x56, 0x84, 0x84, 0x84, 0x84, 0x62, 0x36, 0x84, 0x29}},
    {"gold_fadein_slow", {0x94, 0x84, 0x91, 0xb5, 0x84, 0x8c, 0x45, 0x84, 0xad}},
    {"gold_fastin_fade", {0x6d, 0x84, 0x91, 0xb5, 0x84, 0x49, 0x45, 0x84, 0x8a}},
    {"rand_gold_blink", {0x42, 0x84, 0x91, 0xb5, 0x84, 0x64, 0x6a, 0x84, 0x49}},
    {"rand_gold_fade", {0x4a, 0x84, 0x91, 0xb5, 0x84, 0x89, 0xa9, 0x84, 0x34}},
    {"rand_gold_fastfade", {0x56, 0x84, 0x91, 0xb5, 0x84, 0x29, 0x65, 0x84, 0x61}},
    {"rand_red_fade", {0xa4, 0x84, 0x84, 0xb5, 0x84, 0x89, 0x89, 0x84, 0x65}},
    {"rand_red_fast_fade", {0x4c, 0x84, 0x84, 0xb5, 0x84, 0x29, 0x65, 0x84, 0x45}},
    {"rand_red_fast_blink", {0x6d, 0x84, 0x84, 0xb5, 0x84, 0x64, 0x6a, 0x84, 0x29}},
    {"wine_fade_in", {0xa6, 0x84, 0x84, 0xb5, 0x84, 0x8c, 0x45, 0x84, 0xa1}},
    {"rand_turq_blink", {0x36, 0x84, 0xb5, 0x84, 0xb1, 0xb6, 0x4d, 0x84, 0x91}},
    {"rand_blue_fade", {0x84, 0x84, 0x32, 0x84, 0xb5, 0x89, 0x89, 0x84, 0x36}},
    {"rand_white_blink", {0x4a, 0x84, 0xb5, 0xb5, 0xb5, 0x64, 0x6a, 0x84, 0x89}},
    {"rand_white_fade", {0x65, 0x84, 0xb5, 0xb5, 0xb5, 0x89, 0x89, 0x84, 0xad}},
    {"rand_white_fast_fade", {0x9a, 0x84, 0xb5, 0xb5, 0xb5, 0x29, 0x65, 0x84, 0xa9}},
    {"white_fast_fade", {0x5a, 0x84, 0xb5, 0xb5, 0xb5, 0x49, 0x45, 0x84, 0x2c}},
};

// Published 915 MHz captures (danielweidman/pixmob-ir-reverse-engineering,
// rf/edited_rf_captures/915Mhz/nothing.sub and wine_fade_in.sub, MIT License):
// Flipper RAW_Data, carrier on (+) / off (-) in microseconds, cleaned to 510 us
// per bit. Each file ends with the last carrier-on run.
static const int kNothingRaw[] = {
    510, -510, 510, -510, 510, -510, 510, -510, 510, -510, 510, -510, 510, -510, 510, -1020,
    510, -510, 510, -510, 510, -510, 1020, -510, 510, -2040, 510, -1020, 510, -2040, 510, -1020,
    510, -2040, 510, -1020, 510, -2040, 510, -1530, 1020, -1530, 510, -1530, 1020, -510, 1020, -510,
    510, -2040, 510, -2040, 510, -510, 510, -1020, 510};
static const int kWineFadeInRaw[] = {
    510, -510, 510, -510, 510, -510, 510, -510, 510, -510, 510, -510, 510, -510, 510, -1020,
    1020, -510, 510, -1020, 1020, -510, 510, -2040, 510, -1020, 510, -2040, 510, -1020, 510, -510,
    1020, -510, 510, -510, 1020, -2040, 510, -1020, 510, -1530, 1020, -1530, 510, -1530, 510, -510,
    1020, -2040, 510, -1020, 510, -510, 510, -2040, 510};

// One frame's 90 bits as run lengths, the way the captures store them.
static bool sameAsRaw(const uint8_t frame[9], const int* raw, int rawCount) {
  int runs[100];
  int count = 0;
  for (uint8_t i = 0; i < pixmobrf::kFrameBits && count < 100;) {
    const bool level = pixmobrf::frameBit(frame, i);
    int length = 0;
    for (; i < pixmobrf::kFrameBits && pixmobrf::frameBit(frame, i) == level; ++i) ++length;
    runs[count++] = (level ? 1 : -1) * length * 510;
  }
  if (count > 0 && runs[count - 1] < 0) --count;  // trailing carrier-off time is not stored
  if (count != rawCount) return false;
  for (int i = 0; i < count; ++i)
    if (runs[i] != raw[i]) return false;
  return true;
}

int main() {
  // The line code must be a one-to-one table.
  for (int i = 0; i < 64; ++i)
    for (int j = i + 1; j < 64; ++j)
      expect(pixmobrf::kLineCode[i] != pixmobrf::kLineCode[j], "line code entries are distinct");

  int matched = 0;
  for (const Captured& frame : kCaptured) {
    uint8_t onAir[9];
    for (int i = 0; i < 9; ++i) onAir[i] = reverseBits(frame.bytes[i]);
    int fields[7];
    bool decodable = true;
    for (int i = 0; i < 7; ++i) {
      fields[i] = decode(onAir[i + 1]);
      decodable = decodable && fields[i] >= 0;
    }
    expect(decodable, frame.name);
    if (!decodable) continue;
    expect(fields[0] == 0, "captured frames are plain colour mode 0");
    expect(fields[6] == 0, "captured frames are group 0");

    const pixmobrf::Timing timing = {uint8_t(fields[4] >> 3), uint8_t(fields[5] & 7),
                                     uint8_t(fields[5] >> 3), uint8_t(fields[4] & 7)};
    uint8_t built[9];
    pixmobrf::colorFrame(uint8_t(fields[2] << 2), uint8_t(fields[1] << 2), uint8_t(fields[3] << 2),
                         timing, built);
    bool same = true;
    for (int i = 0; i < 9; ++i) same = same && built[i] == onAir[i];
    expect(same, frame.name);
    if (same) ++matched;
  }

  // Full-brightness red with library defaults, and the bit stream around it.
  uint8_t red[9];
  pixmobrf::colorFrame(255, 0, 0, pixmobrf::kDefaultTiming, red);
  expect(decode(red[1]) == 0 && decode(red[2]) == 0 && decode(red[3]) == 63 &&
             decode(red[4]) == 0 && decode(red[7]) == 0,
         "red frame fields");
  expect(pixmobrf::kFrameBits == 90, "90 bits per frame");
  for (uint8_t i = 0; i < 16; ++i)
    expect(pixmobrf::frameBit(red, i) == ((i & 1) == 0), "preamble alternates starting with 1");
  expect(!pixmobrf::frameBit(red, 16) && pixmobrf::frameBit(red, 17), "sync bits 0 then 1");
  for (uint8_t i = 0; i < 72; ++i)
    expect(pixmobrf::frameBit(red, uint8_t(18 + i)) == (((red[i / 8] >> (i % 8)) & 1) != 0),
           "payload bits LSB first");

  // Any colour/timing keeps mode 0 and group 0.
  std::srand(7);
  for (int n = 0; n < 2000; ++n) {
    uint8_t out[9];
    const pixmobrf::Timing timing = {uint8_t(std::rand()), uint8_t(std::rand()), uint8_t(std::rand()),
                                     uint8_t(std::rand())};
    pixmobrf::colorFrame(uint8_t(std::rand()), uint8_t(std::rand()), uint8_t(std::rand()), timing, out);
    expect(decode(out[1]) == 0 && decode(out[7]) == 0, "random input still mode 0 group 0");
  }

  // The two frames of the firmware's wake test (Z), bit for bit against the
  // published captures, and a frame fits the ~50 ms venue cadence.
  uint8_t nothing[9], wine[9];
  pixmobrf::colorFrame(0, 0, 0, pixmobrf::kNothingTiming, nothing);
  pixmobrf::colorFrame(pixmobrf::kWineRed, 0, 0, pixmobrf::kWineFadeInTiming, wine);
  const bool nothingSame = sameAsRaw(nothing, kNothingRaw, int(sizeof(kNothingRaw) / sizeof(int)));
  const bool wineSame = sameAsRaw(wine, kWineFadeInRaw, int(sizeof(kWineFadeInRaw) / sizeof(int)));
  expect(nothingSame, "nothing frame equals the published nothing.sub");
  expect(wineSame, "wine red frame equals the published wine_fade_in.sub");
  expect(uint32_t(pixmobrf::kStartDelayMicros) + uint32_t(pixmobrf::kFrameBits) * pixmobrf::kBitMicros <
             50000,
         "a frame fits the 50 ms venue cadence");

  std::printf("published RAW captures matched: %d/2; ", int(nothingSame) + int(wineSame));
  std::printf("captured frames matched: %d/%d; red frame:", matched,
              int(sizeof(kCaptured) / sizeof(kCaptured[0])));
  for (int i = 0; i < 9; ++i) std::printf(" %02x", red[i]);
  std::printf("\n");
  if (failures) {
    std::printf("%d failure(s)\n", failures);
    return 1;
  }
  return 0;
}
