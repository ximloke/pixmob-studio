// Host test for firmware/PixMobBeatController/LightPlan.h.
#include <cstdio>
#include <vector>
#include "../firmware/PixMobBeatController/LightPlan.h"

static int failures = 0;
static void expect(bool condition, const char* label, unsigned long value) {
  if (!condition) { std::printf("FAIL: %s (duration %lu)\n", label, value); ++failures; }
}

int main() {
  const std::vector<uint32_t> durations = {50, 64, 100, 150, 200, 251, 252, 300, 400, 479, 480, 600,
                                           959, 960, 1500, 1920, 2000, 2399, 2400, 2450, 3000, 5000,
                                           10000, 60000, 600000};
  for (uint32_t duration : durations) {
    pixmob::LightPlan plan = pixmob::beginLight(duration);
    std::vector<uint32_t> sends;
    uint32_t at = 0;
    while (pixmob::nextLightFrame(plan, at)) {
      sends.push_back(at);
      if (sends.size() > 400) break;
    }
    expect(!sends.empty() && sends[0] == 0, "first frame at zero", duration);
    expect(sends.size() <= 400, "bounded frame count", duration);
    expect(plan.sustainCode >= 1 && plan.sustainCode <= 6, "sustain code avoids 0 and 7", duration);
    for (size_t i = 1; i < sends.size(); ++i) {
      expect(sends[i] >= sends[i - 1] + pixmob::MIN_FRAME_SPACING_MS, "frames are far enough apart to transmit", duration);
      // The next frame starts before the previous sustain ends: no dark gap.
      expect(sends[i] + 40 <= sends[i - 1] + plan.sustain, "no gap between chained frames", duration);
    }
    const uint32_t end = sends.back() + plan.sustain;
    if (duration >= 252) {
      expect(end >= duration && end <= duration + 60, "light ends at the requested duration", duration);
    } else {
      expect(sends.size() == 1, "short lights use one frame", duration);
      const uint32_t error = end > duration ? end - duration : duration - end;
      expect(error <= 60, "short light uses the nearest sustain", duration);
    }
  }
  // Spot checks of the combination observed on the wristband.
  pixmob::LightPlan ten = pixmob::beginLight(10000);
  std::vector<uint32_t> sends;
  uint32_t at = 0;
  while (pixmob::nextLightFrame(ten, at)) sends.push_back(at);
  expect(ten.sustainCode == 6 && sends == std::vector<uint32_t>({0, 2000, 4000, 6000, 7600}), "10 s plan", 10000);
  if (failures) return 1;
  std::printf("%zu durations planned without gaps; 10 s = frames at 0/2000/4000/6000/7600 ms\n", durations.size());
  return 0;
}
