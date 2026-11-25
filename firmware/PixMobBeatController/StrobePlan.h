// Flash schedule for a strobe. Portable C++ (host-testable).
//
// A strobe is a run of very short lights: 9-byte envelope frames with a
// 32 ms sustain and a 32 ms release, sent again and again. A steady strobe
// repeats at the fastest period; a build starts slowly and speeds up evenly
// until it reaches the fastest period at the end of its duration.
// Times are frame send starts relative to the first frame.
#pragma once
#include <stdint.h>

namespace pixmob {

const uint32_t MIN_STROBE_MS = 200;
const uint32_t MAX_STROBE_MS = 60000;
// A frame takes about 45 ms to send and the light lasts about 64 ms after it,
// so 125 ms (8 flashes a second) leaves a dark part between flashes.
const uint32_t STROBE_FAST_PERIOD_MS = 125;
const uint32_t STROBE_SLOW_PERIOD_MS = 500;

struct StrobePlan {
  uint32_t duration;
  bool build;
  bool started;
  uint32_t last;
};

inline StrobePlan beginStrobe(uint32_t durationMs, bool build) {
  StrobePlan plan = {};
  plan.duration = durationMs;
  plan.build = build;
  return plan;
}

// Time from a flash at atMs to the next one.
inline uint32_t strobePeriod(const StrobePlan& plan, uint32_t atMs) {
  if (!plan.build || atMs >= plan.duration) return STROBE_FAST_PERIOD_MS;
  const uint32_t span = STROBE_SLOW_PERIOD_MS - STROBE_FAST_PERIOD_MS;
  return STROBE_SLOW_PERIOD_MS - uint32_t(uint64_t(span) * atMs / plan.duration);
}

// Returns false when no further flash fits in the duration.
inline bool nextStrobeFlash(StrobePlan& plan, uint32_t& atMs) {
  if (!plan.started) {
    plan.started = true;
    plan.last = 0;
    atMs = 0;
    return true;
  }
  const uint32_t next = plan.last + strobePeriod(plan, plan.last);
  if (next >= plan.duration) return false;
  plan.last = next;
  atMs = next;
  return true;
}

}  // namespace pixmob
