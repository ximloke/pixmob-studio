// Host test for firmware/PixMobBeatController/ColorLevels.h: the channel
// values every quick flash and timed light is built from.
#include <cstdio>
#include <vector>
#include "../firmware/PixMobBeatController/ColorLevels.h"
#include "../firmware/PixMobBeatController/OriginalFrames.h"
#include "../firmware/PixMobBeatController/PixMobFrame.h"

static int failures = 0;

static void expect(bool condition, const char* label, char color = ' ') {
  if (!condition) {
    std::printf("FAIL: %s %c\n", label, color);
    ++failures;
  }
}

template <size_t N>
static bool same(const pixmob::Frame& frame, const uint16_t (&expected)[N]) {
  if (frame.count != N) return false;
  for (size_t i = 0; i < N; ++i)
    if (frame.timings[i] != expected[i]) return false;
  return true;
}

template <size_t N>
static bool builds(uint8_t red, uint8_t green, uint8_t blue, const uint16_t (&expected)[N]) {
  pixmob::Frame frame;
  return pixmob::singleColor(red, green, blue, frame) && frame.length == 6 &&
         same(frame, expected);
}

template <size_t N>
static bool flashIs(char color, const uint16_t (&expected)[N]) {
  pixmob::Levels levels;
  return pixmob::colorLevels(color, levels) &&
         builds(levels.red, levels.green, levels.blue, expected);
}

int main() {
  using namespace pixmob;

  // The reference arrays are the published single-color frames of the channel
  // values written next to them.
  expect(builds(132, 32, 0, original::RED), "reference RED");
  expect(builds(132, 244, 0, original::GREEN), "reference GREEN");
  expect(builds(16, 12, 160, original::BLUE), "reference BLUE");
  expect(builds(132, 124, 0, original::YELLOW), "reference YELLOW");
  expect(builds(132, 200, 160, original::CYAN), "reference CYAN");
  expect(builds(240, 100, 160, original::MAGENTA), "reference MAGENTA");
  expect(builds(204, 176, 92, original::WHITISH), "reference WHITISH");
  expect(builds(204, 204, 204, original::WHITE), "reference WHITE");

  // The quick flashes seen bright keep their exact waveform.
  expect(flashIs('R', original::RED), "R keeps the supplied frame");
  expect(flashIs('B', original::BLUE), "B keeps the supplied frame");
  expect(flashIs('Y', original::YELLOW), "Y keeps the supplied frame");

  // The weak or off-color ones no longer send the supplied frame.
  expect(!flashIs('G', original::GREEN), "G changed");
  expect(!flashIs('C', original::CYAN), "C changed");
  expect(!flashIs('M', original::MAGENTA), "M changed");
  expect(!flashIs('W', original::WHITE), "W changed");
  expect(!flashIs('K', original::WHITISH), "K changed");

  struct Expected { char color; uint8_t red, green, blue; };
  const std::vector<Expected> table = {
    {'R', 132, 32, 0},   {'G', 88, 164, 0},    {'B', 16, 12, 160},  {'Y', 132, 124, 0},
    {'C', 68, 184, 160}, {'M', 180, 76, 120},  {'W', 124, 124, 124}, {'K', 124, 108, 56},
  };
  Frame frame;
  for (const Expected& item : table) {
    Levels levels{};
    expect(colorLevels(item.color, levels), "known color", item.color);
    expect(levels.red == item.red && levels.green == item.green && levels.blue == item.blue,
           "documented levels", item.color);
    // The command carries the upper six bits of each channel.
    expect(levels.red % 4 == 0 && levels.green % 4 == 0 && levels.blue % 4 == 0,
           "multiples of four", item.color);
    // No channel reaches the level at which flashes were weak.
    expect(levels.red <= MAX_LEVEL && levels.green <= MAX_LEVEL && levels.blue <= MAX_LEVEL,
           "at or below MAX_LEVEL", item.color);
    // A quick flash and both variants of a timed-light frame can be built,
    // and the variant really differs from the first frame.
    expect(singleColor(levels.red, levels.green, levels.blue, frame) && frame.length == 6,
           "quick flash builds", item.color);
    Frame first, second, cut;
    expect(singleColorEnvelope(levels.red, levels.green, levels.blue, TIME_0_MS, TIME_2400_MS,
                               TIME_32_MS, first),
           "timed frame builds", item.color);
    Levels varied = levels;
    uint8_t& top = strongest(varied);
    expect(top >= 8, "room to vary the strongest channel", item.color);
    top -= 4;
    expect(singleColorEnvelope(varied.red, varied.green, varied.blue, TIME_0_MS, TIME_2400_MS,
                               TIME_96_MS, second) &&
               !(first.count == second.count && same(second, first.timings) ),
           "alternate timed frame differs", item.color);
    Levels shortened = levels;
    strongest(shortened) -= 8;
    expect(singleColorEnvelope(shortened.red, shortened.green, shortened.blue, TIME_0_MS,
                               TIME_32_MS, TIME_32_MS, cut),
           "cut frame builds", item.color);
  }

  // White stays neutral in the command; warm white keeps red > green > blue.
  Levels white{}, warm{};
  colorLevels('W', white);
  colorLevels('K', warm);
  expect(white.red == white.green && white.green == white.blue, "W has equal channels");
  expect(warm.red > warm.green && warm.green > warm.blue, "K stays warm");

  // strongest() picks the channel the variation is applied to.
  Levels cyan{};
  colorLevels('C', cyan);
  expect(&strongest(cyan) == &cyan.green, "strongest channel of C is green");
  Levels blue{};
  colorLevels('B', blue);
  expect(&strongest(blue) == &blue.blue, "strongest channel of B is blue");

  Levels none{};
  expect(!colorLevels('X', none) && !colorLevels('A', none) && !colorLevels('r', none),
         "unknown letters rejected");

  if (failures) return 1;
  std::printf("8 reference arrays rebuilt; R/B/Y flashes unchanged; 8 color levels at or below %u\n",
              unsigned(MAX_LEVEL));
  return 0;
}
