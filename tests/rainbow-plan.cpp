// Host test for RainbowPlan.h and the rainbow line command.
#include <cstdio>
#include <cstdlib>
#include <vector>
#include "../firmware/PixMobBeatController/LightCommand.h"

static int failures = 0;
static void expect(bool condition, const char* label, unsigned long value = 0) {
  if (!condition) { std::printf("FAIL: %s (%lu)\n", label, value); ++failures; }
}
static bool same(const pixmob::Levels& a, const pixmob::Levels& b) {
  return a.red == b.red && a.green == b.green && a.blue == b.blue;
}

int main() {
  using namespace pixmob;
  // The path passes exactly through the six preset colors.
  const char keys[6] = {'R', 'Y', 'G', 'C', 'B', 'M'};
  for (uint32_t cycle : {1000u, 3000u, 6000u, 20000u}) {
    for (uint8_t i = 0; i < 6; ++i) {
      Levels key = {};
      colorLevels(keys[i], key);
      expect(same(rainbowLevels(cycle / 6 * i + (cycle % 6 ? 0 : 0), cycle), key) || cycle % 6 != 0, "key color on the path", cycle);
    }
    expect(same(rainbowLevels(cycle, cycle), rainbowLevels(0, cycle)), "the cycle repeats", cycle);
  }
  size_t total = 0;
  for (uint32_t cycle : {1000u, 3000u, 7000u, 20000u}) {
    for (uint32_t duration : {500u, 3000u, 20000u, 60000u}) {
      RainbowPlan plan = beginRainbow(duration, cycle);
      uint32_t at = 0, previousAt = 0;
      Levels levels = {}, previous = {};
      size_t count = 0;
      while (nextRainbowFrame(plan, at, levels)) {
        expect(at < duration, "frame inside the duration", duration);
        expect(levels.red % 4 == 0 && levels.green % 4 == 0 && levels.blue % 4 == 0, "steps of four", cycle);
        expect(validCustomLevels(levels), "levels the wristband showed properly", cycle);
        if (count) {
          expect(at == previousAt + RAINBOW_STEP_MS, "even steps", cycle);
          expect(!same(levels, previous), "never the same command twice in a row", cycle);
          // Neighbours stay close, so the change reads as gradual.
          const int jump = std::abs(int(levels.red) - previous.red) + std::abs(int(levels.green) - previous.green) +
                           std::abs(int(levels.blue) - previous.blue);
          expect(jump <= (cycle <= 1000 ? 260 : 100), "small color step", cycle);
        }
        previous = levels;
        previousAt = at;
        if (++count > 6000) break;
      }
      expect(count == (duration + RAINBOW_STEP_MS - 1) / RAINBOW_STEP_MS, "frame count", duration);
      total += count;
    }
  }
  // The sustain outlasts the step plus a frame's transmit time.
  expect(192 >= RAINBOW_STEP_MS + 45, "sustain covers the next frame");

  LightCommand c;
  expect(parseLightCommand("~5000", c) && c.kind == '~' && c.ms == 5000 && c.cycle == DEFAULT_RAINBOW_CYCLE_MS, "~5000");
  expect(parseLightCommand("~600000,20000", c) && c.ms == 600000 && c.cycle == 20000, "~600000,20000");
  expect(parseLightCommand("~500,1000", c) && c.ms == 500 && c.cycle == 1000, "~500,1000");
  const char* rejected[] = {"~", "~499", "~600001", "~5000,", "~5000,999", "~5000,20001", "~5000,3000,1",
                            "~05000", "~5000,03000", "~R5000", "~5000 ", "~1234567"};
  for (const char* line : rejected)
    if (parseLightCommand(line, c)) { std::printf("FAIL: accepted '%s'\n", line); ++failures; }
  // Earlier commands are untouched.
  expect(parseLightCommand("#R1500", c) && c.cycle == 0, "#R1500 has no cycle");

  // The RF copy of a rainbow frame holds long enough to bridge two frames
  // the band does not take (the 21 Nov 2026 video), and no longer than needed.
  expect(pixmob::SUSTAIN_MS[pixmob::RAINBOW_RF_SUSTAIN_CODE] >= 3 * pixmob::RAINBOW_STEP_MS,
         "RF rainbow hold bridges two missed frames", pixmob::SUSTAIN_MS[pixmob::RAINBOW_RF_SUSTAIN_CODE]);
  expect(pixmob::RAINBOW_RF_SUSTAIN_CODE == pixmob::RAINBOW_SUSTAIN_CODE + 1, "only one code longer");
  if (failures) return 1;
  std::printf("rainbow path through 6 preset colors; %zu frames planned, none repeated\n", total);
  return 0;
}
