// Host test for firmware/PixMobHoldColorTest/PixMobFrame.h.
// Known answers: the seven supplied timing arrays (six presets plus WHITISH,
// now kept in PixMobBeatController/OriginalFrames.h), the neutral White frame, and
// two upstream 9-byte codes (FAST_WHITE, VERY_SLOW_WHITE) from
// danielweidman/pixmob-ir-reverse-engineering effect_definitions.py.
#include <cstdio>
#include <cstring>
#include <vector>
#include "../firmware/PixMobHoldColorTest/PixMobFrame.h"

static int failures = 0;

static void expect(bool condition, const char* label) {
  if (!condition) {
    std::printf("FAIL: %s\n", label);
    ++failures;
  }
}

static bool same(const pixmob::Frame& frame, const std::vector<uint16_t>& expected) {
  if (frame.count != expected.size()) return false;
  for (size_t i = 0; i < expected.size(); ++i)
    if (frame.timings[i] != expected[i]) return false;
  return true;
}

static uint32_t total(const pixmob::Frame& frame) {
  uint32_t sum = 0;
  for (uint8_t i = 0; i < frame.count; ++i) sum += frame.timings[i];
  return sum;
}

int main() {
  pixmob::Frame frame;

  struct Basic { const char* name; uint8_t r, g, b; std::vector<uint16_t> timings; };
  const std::vector<Basic> basics = {
    {"RED", 132, 32, 0, {1400,1400,700,700,700,1400,700,2800,700,2100,1400,700,700,700,700,1400,1400,2800,1400,2800,700}},
    {"GREEN", 132, 244, 0, {1400,1400,700,700,700,700,1400,2800,700,1400,700,1400,700,1400,700,1400,1400,2800,1400,2800,700}},
    {"BLUE", 16, 12, 160, {700,700,700,2100,1400,700,700,2800,700,1400,700,700,700,1400,1400,700,700,1400,700,700,700,700,700,700,700,2100,700}},
    {"YELLOW", 132, 124, 0, {1400,1400,700,700,700,700,1400,2800,700,2100,700,700,700,1400,700,1400,1400,2800,1400,2800,700}},
    {"CYAN", 132, 200, 160, {700,700,700,700,1400,1400,1400,2800,700,1400,700,700,1400,1400,700,1400,1400,2800,700,700,700,2100,700}},
    {"MAGENTA", 240, 100, 160, {700,700,700,700,1400,1400,1400,2800,700,2100,1400,2100,700,700,700,700,1400,2100,700,700,700,2100,700}},
    {"WHITISH", 204, 176, 92, {700,700,700,2100,1400,700,700,2800,700,1400,700,700,700,2800,1400,1400,700,2100,700,1400,700,1400,700}},
    {"WHITE", 204, 204, 204, {1400,1400,700,700,1400,700,700,2800,700,1400,700,1400,700,2100,1400,1400,700,2100,1400,1400,700,2100,700}},
  };
  for (const Basic& item : basics) {
    expect(pixmob::singleColor(item.r, item.g, item.b, frame), item.name);
    expect(frame.length == 6 && same(frame, item.timings), item.name);
  }

  // Upstream known answers for the 9-byte envelope command.
  const std::vector<uint16_t> fastWhite = {700,1400,700,1400,700,700,1400,2800,700,1400,700,1400,700,2100,1400,1400,700,2100,1400,1400,700,2100,1400,2800,700,2100,700,700,700,2100,1400,2800,700};
  const std::vector<uint16_t> verySlowWhite = {700,1400,700,1400,700,700,1400,2800,700,1400,700,1400,700,2100,1400,1400,700,2100,1400,1400,700,2100,1400,2800,700,1400,700,700,1400,2100,1400,2800,700};
  expect(pixmob::singleColorEnvelope(204, 204, 204, pixmob::TIME_0_MS, pixmob::TIME_96_MS, pixmob::TIME_192_MS, frame) && same(frame, fastWhite), "upstream FAST_WHITE");
  expect(pixmob::singleColorEnvelope(204, 204, 204, pixmob::TIME_0_MS, pixmob::TIME_480_MS, 7, frame) && same(frame, verySlowWhite), "upstream VERY_SLOW_WHITE");

  // The hold frames the sketch sends (attack 0, sustain 2400 ms, release
  // 32 ms), cross-checked against an independent Python encoder.
  struct Hold { const char* name; uint8_t r, g, b; std::vector<uint8_t> bytes; std::vector<uint16_t> timings; };
  const std::vector<Hold> holds = {
    {"hold Red", 132, 32, 0, {0x80,0x2D,0x21,0x56,0x86,0x21,0x21,0x66,0x21}, {1400,700,1400,700,700,1400,700,2800,700,2100,1400,700,700,700,700,1400,1400,2800,1400,2800,700,1400,700,2800,700,2100,1400,1400,1400,700,700,2800,700}},
    {"hold Green", 132, 244, 0, {0x80,0xA5,0x21,0x49,0x86,0x21,0x21,0x66,0x21}, {1400,700,700,1400,700,700,1400,2800,700,1400,700,1400,700,1400,700,1400,1400,2800,1400,2800,700,1400,700,2800,700,2100,1400,1400,1400,700,700,2800,700}},
    {"hold Blue", 16, 12, 160, {0x80,0x99,0x21,0x65,0xA9,0x22,0x21,0x66,0x21}, {1400,1400,1400,1400,1400,2800,700,1400,700,700,700,1400,1400,700,700,1400,700,700,700,700,700,700,700,2100,700,1400,700,2800,700,2100,1400,1400,1400,700,700,2800,700}},
    {"hold Yellow", 132, 124, 0, {0x80,0xA5,0x21,0x4A,0x86,0x21,0x21,0x66,0x21}, {1400,700,700,1400,700,700,1400,2800,700,2100,700,700,700,1400,700,1400,1400,2800,1400,2800,700,1400,700,2800,700,2100,1400,1400,1400,700,700,2800,700}},
    {"hold Cyan", 132, 200, 160, {0x80,0x69,0x21,0x4D,0x86,0x22,0x21,0x66,0x21}, {1400,1400,700,700,1400,700,700,2800,700,1400,700,700,1400,1400,700,1400,1400,2800,700,700,700,2100,700,1400,700,2800,700,2100,1400,1400,1400,700,700,2800,700}},
    {"hold Magenta", 240, 100, 160, {0x80,0x69,0x21,0x46,0x8D,0x22,0x21,0x66,0x21}, {1400,1400,700,700,1400,700,700,2800,700,2100,1400,2100,700,700,700,700,1400,2100,700,700,700,2100,700,1400,700,2800,700,2100,1400,1400,1400,700,700,2800,700}},
    {"hold White", 204, 204, 204, {0x80,0x46,0x21,0x89,0x89,0x89,0x21,0x66,0x21}, {700,700,1400,2100,700,700,700,2800,700,1400,700,1400,700,2100,1400,1400,700,2100,1400,1400,700,2100,1400,2800,700,2100,1400,1400,1400,700,700,2800,700}},
  };
  for (const Hold& item : holds) {
    expect(pixmob::singleColorEnvelope(item.r, item.g, item.b, pixmob::TIME_0_MS, pixmob::TIME_2400_MS, pixmob::TIME_32_MS, frame), item.name);
    expect(frame.length == 9 && std::memcmp(frame.bytes, item.bytes.data(), 9) == 0, item.name);
    expect(same(frame, item.timings) && total(frame) == 44100, item.name);
  }

  // Rejected inputs never produce a frame to transmit.
  expect(!pixmob::singleColorEnvelope(1, 2, 3, 8, 0, 0, frame), "attack out of range");
  expect(!pixmob::singleColorEnvelope(1, 2, 3, 0, 8, 0, frame), "sustain out of range");
  expect(!pixmob::singleColorEnvelope(1, 2, 3, 0, 0, 8, frame), "release out of range");
  const uint8_t bad[4] = {0, 64, 0, 0};
  expect(!pixmob::buildFrame(bad, 4, frame), "value above six bits");
  const uint8_t five[5] = {0, 0, 0, 0, 0};
  expect(!pixmob::buildFrame(five, 5, frame), "unsupported length");

  if (failures) return 1;
  std::printf("8 six-byte frames, 2 upstream nine-byte codes and 7 hold frames match; invalid inputs rejected\n");
  return 0;
}
