// Host test for firmware/PixMobBeatController/StrobePlan.h.
#include <cstdio>
#include <vector>
#include "../firmware/PixMobBeatController/StrobePlan.h"

static int failures = 0;
static void expect(bool condition, const char* label, unsigned long value) {
  if (!condition) { std::printf("FAIL: %s (duration %lu)\n", label, value); ++failures; }
}

static std::vector<uint32_t> flashes(uint32_t duration, bool build) {
  pixmob::StrobePlan plan = pixmob::beginStrobe(duration, build);
  std::vector<uint32_t> times;
  uint32_t at = 0;
  while (pixmob::nextStrobeFlash(plan, at)) {
    times.push_back(at);
    if (times.size() > 600) break;
  }
  return times;
}

int main() {
  using namespace pixmob;
  const std::vector<uint32_t> durations = {200, 250, 499, 500, 1000, 2000, 4000, 8000, 16000, 60000};
  for (uint32_t duration : durations) {
    for (int build = 0; build < 2; ++build) {
      const std::vector<uint32_t> times = flashes(duration, build);
      expect(!times.empty() && times[0] == 0, "first flash at zero", duration);
      expect(times.size() <= 600, "bounded flash count", duration);
      expect(times.back() < duration, "last flash starts inside the duration", duration);
      for (size_t i = 1; i < times.size(); ++i) {
        const uint32_t gap = times[i] - times[i - 1];
        // Never faster than the fastest period: a frame (about 45 ms) plus
        // its 64 ms of light fit, with dark time left over.
        expect(gap >= STROBE_FAST_PERIOD_MS && gap <= STROBE_SLOW_PERIOD_MS, "period in range", duration);
        if (!build) expect(gap == STROBE_FAST_PERIOD_MS, "steady strobe keeps one period", duration);
        if (build && i > 1) expect(gap <= times[i - 1] - times[i - 2], "build never slows down", duration);
      }
      // Nothing more would fit after the last flash.
      StrobePlan plan = beginStrobe(duration, build);
      expect(times.back() + strobePeriod(plan, times.back()) >= duration, "no flash left out", duration);
    }
  }
  // Known answers.
  expect(flashes(1000, false) == std::vector<uint32_t>({0, 125, 250, 375, 500, 625, 750, 875}), "1 s steady", 1000);
  expect(flashes(2000, true) == std::vector<uint32_t>({0, 500, 907, 1237, 1506, 1724, 1901}), "2 s build", 2000);
  const std::vector<uint32_t> longBuild = flashes(8000, true);
  expect(longBuild[1] - longBuild[0] == 500, "build starts at the slow period", 8000);
  expect(longBuild.back() - longBuild[longBuild.size() - 2] < 150, "build ends near the fast period", 8000);
  if (failures) return 1;
  std::printf("%zu durations planned as strobe and build; 1 s = 8 flashes, 8 s build = %zu flashes\n",
              durations.size(), longBuild.size());
  return 0;
}
