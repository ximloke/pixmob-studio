// Re-send schedule for a timed PixMob light. Portable C++ (host-testable).
//
// One 9-byte envelope frame lights the wristband for its sustain time. Longer
// lights chain frames: each next frame is sent before the previous sustain
// ends, and the last one is placed so that its sustain ends at the requested
// duration. Times are frame send starts relative to the first frame; every
// frame takes the same time to transmit, so the offset cancels out.
#pragma once
#include <stdint.h>

namespace pixmob {

const uint16_t SUSTAIN_MS[8] = {0, 32, 96, 192, 480, 960, 2400, 3840};
const uint32_t MIN_LIGHT_MS = 50;
const uint32_t MAX_LIGHT_MS = 600000;
// A 9-byte frame takes about 45 ms to transmit.
const uint32_t MIN_FRAME_SPACING_MS = 60;

struct LightPlan {
  uint32_t duration;
  uint8_t sustainCode;
  uint32_t sustain;
  uint32_t step;
  uint32_t last;
  uint32_t lastEnd;
  bool started;
  bool single;
};

inline LightPlan beginLight(uint32_t durationMs) {
  LightPlan plan = {};
  plan.duration = durationMs;
  if (durationMs < SUSTAIN_MS[3] + MIN_FRAME_SPACING_MS) {
    // Too short to chain two frames: one frame with the nearest sustain.
    plan.single = true;
    uint8_t best = 1;
    for (uint8_t code = 2; code <= 3; ++code) {
      const uint32_t candidate = SUSTAIN_MS[code] > durationMs ? SUSTAIN_MS[code] - durationMs
                                                             : durationMs - SUSTAIN_MS[code];
      const uint32_t current = SUSTAIN_MS[best] > durationMs ? SUSTAIN_MS[best] - durationMs
                                                           : durationMs - SUSTAIN_MS[best];
      if (candidate < current) best = code;
    }
    plan.sustainCode = best;
  } else if (durationMs < SUSTAIN_MS[4]) {
    plan.sustainCode = 3;
  } else if (durationMs < SUSTAIN_MS[5]) {
    plan.sustainCode = 4;
  } else if (durationMs < SUSTAIN_MS[6]) {
    plan.sustainCode = 5;
  } else {
    plan.sustainCode = 6;
  }
  plan.sustain = SUSTAIN_MS[plan.sustainCode];
  // Overlap between chained frames; 2400 ms with a 2000 ms step is the
  // combination observed on the wristband.
  const uint32_t overlap = plan.sustain >= 2400 ? 400 : plan.sustain >= 480 ? 80 : 60;
  plan.step = plan.sustain - overlap;
  return plan;
}

// Returns false when no further frame is needed.
inline bool nextLightFrame(LightPlan& plan, uint32_t& atMs) {
  if (!plan.started) {
    plan.started = true;
    plan.last = 0;
    plan.lastEnd = plan.sustain;
    atMs = 0;
    return true;
  }
  if (plan.single || plan.lastEnd >= plan.duration) return false;
  const uint32_t finalAt = plan.duration - plan.sustain;
  uint32_t next = plan.last + plan.step < finalAt ? plan.last + plan.step : finalAt;
  if (next < plan.last + MIN_FRAME_SPACING_MS) next = plan.last + MIN_FRAME_SPACING_MS;
  plan.last = next;
  plan.lastEnd = next + plan.sustain;
  atMs = next;
  return true;
}

// A timed light with an optional fade in (attack code on the first frame)
// and fade out (release code on the last frame). durationMs is the time at
// full brightness; the fades are added before and after it. Codes index
// SUSTAIN_MS; attack 0 and release 0 mean "no fade" (release then keeps the
// short default).
struct LightFrameSpec {
  uint32_t atMs;
  uint8_t attack, sustain, release;
  bool varied;  // every second frame differs slightly, see the sketch
};

struct FadedLight {
  LightPlan plan;
  uint8_t attack, release;
  uint16_t index;
  bool has;
  uint32_t at;
};

inline FadedLight beginFadedLight(uint32_t durationMs, uint8_t attack, uint8_t release) {
  FadedLight light = {};
  light.plan = beginLight(durationMs);
  light.attack = attack;
  light.release = release;
  light.has = nextLightFrame(light.plan, light.at);
  return light;
}

// Returns false when no further frame is needed.
inline bool nextFadedFrame(FadedLight& light, LightFrameSpec& frame) {
  if (!light.has) return false;
  uint32_t nextAt = 0;
  const bool more = nextLightFrame(light.plan, nextAt);
  frame.varied = light.index & 1;
  // The first frame's sustain starts after its fade in, so every later frame
  // moves back by that time.
  frame.atMs = light.index == 0 ? 0 : SUSTAIN_MS[light.attack] + light.at;
  frame.attack = light.index == 0 ? light.attack : 0;
  frame.sustain = light.plan.sustainCode;
  frame.release = (!more && light.release) ? light.release : (frame.varied ? 2 : 1);
  light.at = nextAt;
  light.has = more;
  ++light.index;
  return true;
}

// From the first frame to the end of the fade out.
inline uint32_t fadedLightTotalMs(uint32_t durationMs, uint8_t attack, uint8_t release) {
  return SUSTAIN_MS[attack] + durationMs + SUSTAIN_MS[release ? release : 1];
}

}  // namespace pixmob
