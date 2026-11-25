// Color schedule for a rainbow. Portable C++ (host-testable).
//
// A rainbow is a run of 9-byte envelope frames, each a slightly different
// color, sent every RAINBOW_STEP_MS with a sustain that lasts past the next
// frame. The wristband takes a different color at once while one is showing,
// so the colors follow each other without a dark part being commanded.
// The path goes through the levels this wristband showed as red, yellow,
// green, cyan, blue and magenta (ColorLevels.h) and back to red, in straight
// lines between them.
#pragma once
#include <stdint.h>
#include "ColorLevels.h"

namespace pixmob {

const uint32_t MIN_RAINBOW_MS = 500;
const uint32_t MAX_RAINBOW_MS = 600000;
const uint32_t MIN_RAINBOW_CYCLE_MS = 1000;
const uint32_t MAX_RAINBOW_CYCLE_MS = 20000;
const uint32_t DEFAULT_RAINBOW_CYCLE_MS = 3000;
// A frame takes about 45 ms to send; the sustain used is 192 ms (code 3).
const uint32_t RAINBOW_STEP_MS = 120;
const uint8_t RAINBOW_SUSTAIN_CODE = 3;
// The RF copy of a rainbow frame holds 480 ms (code 4). In the user's video
// of 21 Nov 2026 the RF-only band went dark for 0.1-0.2 s once per 3 s cycle,
// at the same hue each time, while the IR band stayed lit: it seems not to
// take one or two frames of the cycle. A longer hold keeps the color before
// them until the next frame it takes. A newer frame replaces the color at
// once, so this only matters when frames are missed, and at the end of a
// rainbow, which RF bands show about 0.3 s longer.
const uint8_t RAINBOW_RF_SUSTAIN_CODE = 4;

// Color at a time within the cycle.
inline Levels rainbowLevels(uint32_t atMs, uint32_t cycleMs) {
  const char keys[6] = {'R', 'Y', 'G', 'C', 'B', 'M'};
  const uint64_t position = uint64_t(atMs % cycleMs) * 6;  // in units of cycle / 6
  const uint8_t segment = uint8_t(position / cycleMs);
  const uint32_t within = uint32_t(position % cycleMs);
  Levels from = {}, to = {};
  colorLevels(keys[segment], from);
  colorLevels(keys[(segment + 1) % 6], to);
  const auto mix = [&](uint8_t a, uint8_t b) {
    const int32_t value = int32_t(a) + (int32_t(b) - int32_t(a)) * int32_t(within) / int32_t(cycleMs);
    return uint8_t(((value + 2) / 4) * 4);  // the command carries steps of four
  };
  return {mix(from.red, to.red), mix(from.green, to.green), mix(from.blue, to.blue)};
}

struct RainbowPlan {
  uint32_t duration, cycle;
  uint32_t next;
  bool started;
  Levels last;
};

inline RainbowPlan beginRainbow(uint32_t durationMs, uint32_t cycleMs) {
  RainbowPlan plan = {};
  plan.duration = durationMs;
  plan.cycle = cycleMs;
  return plan;
}

// Returns false when no further frame is needed. A frame never repeats the
// one before it exactly, because the wristband ignores a command identical to
// the one still showing.
inline bool nextRainbowFrame(RainbowPlan& plan, uint32_t& atMs, Levels& levels) {
  if (plan.started && plan.next >= plan.duration) return false;
  atMs = plan.next;
  levels = rainbowLevels(atMs, plan.cycle);
  if (plan.started && levels.red == plan.last.red && levels.green == plan.last.green &&
      levels.blue == plan.last.blue) {
    uint8_t& top = strongest(levels);
    top -= 4;
  }
  plan.last = levels;
  plan.started = true;
  plan.next += RAINBOW_STEP_MS;
  return true;
}

}  // namespace pixmob
