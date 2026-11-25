// RF copy of the beat controller's IR output. Portable C++ (no Arduino
// dependency; tests/rf-plan.cpp).
//
// Every IR frame is also sent as a PixMob RF frame (PixMobRFFrame.h) with the
// same color and envelope codes: the RF frame carries the same seven fields as
// the 9-byte IR "Display Single Color (Configurable Fields)" command. Both
// frames are timed to end at the same moment, and the RF frame is then sent
// again (rfCopies). Between commands, RF wristbands are kept awake with the
// black "nothing" frame venue transmitters repeat.
#pragma once
#include <stdint.h>
#include "LightPlan.h"
#include "PixMobFrame.h"
#include "PixMobRFFrame.h"
#include "PixMobRFLimits.h"

namespace pixmob {

// The user's Wave2 Gen 3 lit from RF at 922.36 MHz from 30 cm, 1 m and 3 m,
// and not at 433.92 MHz from 30 cm (20 Nov 2026). 922.36 MHz lies inside
// Malaysia's 919-923 MHz short-range device band (PixMobRFLimits.h).
constexpr float RF_MHZ = 922.36f;
constexpr int RF_DBM = 10;
static_assert(pixmobrf::allowedMhz(RF_MHZ), "RF carrier outside the allowed ranges");

// One RF frame on air, and the low time on the data line between the CC1101
// reaching TX and the first bit.
constexpr uint32_t RF_FRAME_US = uint32_t(pixmobrf::kFrameBits) * pixmobrf::kBitMicros;
constexpr uint32_t RF_LEAD_US = 200;
constexpr uint32_t RF_MAX_LEAD_US = 30000;  // an RMT half-symbol holds 32767 us

// The IR quick flash (6-byte "Display Single Color") has no envelope fields:
// the band applies its own. jamesw343/PixMob_IR docs/ir_protocol.md gives
// attack 0 ms, release 32 ms and about 384 ms between, but the user's video
// of 21 Nov 2026 (IMG_8740, 8 song-show flashes) showed the IR band lit only
// 217-235 ms, while the RF band, sent sustain 480 ms, stayed lit 502-518 ms
// and went dark about 0.3 s later; both lit in the same frame. An RF frame
// always carries envelope codes, so the RF copy of a quick flash uses the
// ones nearest the measured IR flash: 0 + 192 + 32 = 224 ms.
constexpr uint8_t RF_FLASH_ATTACK = TIME_0_MS;
constexpr uint8_t RF_FLASH_SUSTAIN = TIME_192_MS;
constexpr uint8_t RF_FLASH_RELEASE = TIME_32_MS;

inline pixmobrf::Timing rfTiming(uint8_t attack, uint8_t sustain, uint8_t release) {
  return {uint8_t(attack & 7), uint8_t(sustain & 7), uint8_t(release & 7), 0};
}

// How long an IR frame lasts on air: its marks and spaces.
inline uint32_t irFrameMicros(const Frame& frame) {
  uint32_t total = 0;
  for (uint8_t i = 0; i < frame.count; ++i) total += frame.timings[i];
  return total;
}

// Microseconds after the RF waveform starts: the low lead-in before its first
// bit, and when to start the IR frame, so that both frames end together.
struct RfAlignment {
  uint32_t rfLeadUs;
  uint32_t irStartUs;
};

inline RfAlignment alignRf(uint32_t irUs) {
  uint32_t extra = irUs > RF_FRAME_US ? irUs - RF_FRAME_US : 0;
  if (extra > RF_MAX_LEAD_US - RF_LEAD_US) extra = RF_MAX_LEAD_US - RF_LEAD_US;
  RfAlignment alignment;
  alignment.rfLeadUs = RF_LEAD_US + extra;
  const uint32_t rfEnd = alignment.rfLeadUs + RF_FRAME_US;
  alignment.irStartUs = rfEnd > irUs ? rfEnd - irUs : 0;
  return alignment;
}

// The CC1101 data line (GDO0) for one RF frame: a low lead-in, then the
// frame's bits merged into runs of equal level. A final low run is left out;
// the line rests low after the frame.
struct RfRun {
  uint8_t level;
  uint16_t us;
};
constexpr uint8_t RF_MAX_RUNS = 1 + pixmobrf::kFrameBits;

inline uint8_t rfRuns(const uint8_t frame[pixmobrf::kFrameBytes], uint32_t leadUs,
                      RfRun runs[RF_MAX_RUNS]) {
  uint8_t count = 0;
  runs[count++] = {0, uint16_t(leadUs > RF_MAX_LEAD_US ? RF_MAX_LEAD_US : leadUs)};
  for (uint8_t i = 0; i < pixmobrf::kFrameBits;) {
    const uint8_t level = pixmobrf::frameBit(frame, i) ? 1 : 0;
    uint32_t us = 0;
    for (; i < pixmobrf::kFrameBits && (pixmobrf::frameBit(frame, i) ? 1 : 0) == level; ++i)
      us += pixmobrf::kBitMicros;
    if (runs[count - 1].level == level)
      runs[count - 1].us = uint16_t(runs[count - 1].us + us);
    else
      runs[count++] = {level, uint16_t(us)};
  }
  if (count > 1 && runs[count - 1].level == 0) --count;
  return count;
}

// How long the band shows one frame: attack, sustain and release.
inline uint32_t envelopeMs(uint8_t attack, uint8_t sustain, uint8_t release) {
  return uint32_t(SUSTAIN_MS[attack & 7]) + SUSTAIN_MS[sustain & 7] + SUSTAIN_MS[release & 7];
}

// A band does not always take a single RF frame. On 20 Nov 2026, with IR
// blocked, four single frames (quick flashes, a 0.1 s light) were missed,
// while three frames 80 ms apart (Auto) and the many frames of a strobe or
// rainbow were seen. The CEMENT V1.1 driver (sueppchen, pixmob_cement.cpp)
// says to send frames more often than every 120 ms, and venue transmitters
// repeat theirs every 50 ms. So every RF frame goes out up to RF_MAX_COPIES
// times, RF_COPY_MS apart from start to start; the band may light from a
// later copy, up to 100 ms after the IR frame.
//
// A copy must arrive while the band still shows the frame at full strength
// (attack and sustain), when an identical frame is ignored; later it would
// start the light again. It must also end before the job's next frame.
constexpr uint8_t RF_MAX_COPIES = 3;
constexpr uint32_t RF_COPY_MS = 50;
constexpr uint32_t RF_COPY_GUARD_MS = 20;
constexpr uint32_t RF_NEXT_GUARD_MS = 5;

// spacingMs: from the start of this frame to the start of the job's next
// frame, or 0 when none follows. The first copy ends within RF_COPY_MS of
// the start, and each further copy RF_COPY_MS later.
inline uint8_t rfCopies(uint8_t attack, uint8_t sustain, uint32_t spacingMs) {
  const uint32_t fullMs = uint32_t(SUSTAIN_MS[attack & 7]) + SUSTAIN_MS[sustain & 7];
  uint8_t copies = 1;
  while (copies < RF_MAX_COPIES) {
    const uint32_t after = uint32_t(copies) * RF_COPY_MS;  // its end after the first copy's
    if (after + RF_COPY_GUARD_MS > fullMs) break;
    if (spacingMs && RF_COPY_MS + after + RF_NEXT_GUARD_MS > spacingMs) break;
    ++copies;
  }
  return copies;
}

// Auto sends its quick flash three times, 80 ms apart, and those frames were
// seen; each of them goes out once. A single quick flash gets its copies.
inline uint8_t rfFlashCopies(uint8_t repeats) {
  return repeats > 1 ? 1 : rfCopies(RF_FLASH_ATTACK, RF_FLASH_SUSTAIN, 0);
}

// Keeping RF wristbands awake. A band stops listening when no frame arrives
// for a while, and a sleeping band reacts only after up to about 30 s of
// frames (danielweidman/pixmob-ir-reverse-engineering, rf/). Venue
// transmitters repeat the black "nothing" frame, which lights nothing. The
// controller sends it every RF_WAKE_PERIOD_MS for RF_WAKE_MS when RF starts or
// a wake is asked for, and otherwise every intervalMs after the last RF frame;
// each time it goes out RF_MAX_COPIES times, RF_COPY_MS apart, like a light.
// Black would replace a color, so no "nothing" frame goes out while a light
// may still be showing: until its whole envelope plus RF_SHOW_MARGIN_MS has
// passed.
//
// Once woken, the bands are kept awake for as long as the board is powered,
// unless a sleep time is set (@RS, kept by the board; off by default). With
// one they are only kept awake for sleepAfterMs after the last light ends or
// a wake ends; then nothing more goes out and they fall asleep (about 15 s
// later, seen on 20 Nov 2026), which saves their batteries. The next light
// then starts a new wake by itself, but that wake is too short for a band
// that has slept a while: on 21 Nov 2026 such a band did not wake from a 35 s
// wake or a 40 s RF rainbow and did partway through a 120 s one. So after a
// sleep, RF bands miss the lights of the first minute or two. The user first
// asked for 5 minutes, then, having seen this, for no sleep while the board
// is powered, with the sleep left as a choice.
constexpr uint32_t RF_WAKE_MS = 35000;
constexpr uint32_t RF_WAKE_PERIOD_MS = 50;
constexpr uint32_t RF_KEEP_AWAKE_DEFAULT_MS = 2000;
constexpr uint32_t RF_KEEP_AWAKE_MIN_MS = 200;
constexpr uint32_t RF_KEEP_AWAKE_MAX_MS = 60000;
constexpr uint32_t RF_SHOW_MARGIN_MS = 300;
constexpr uint32_t RF_SLEEP_NEVER = 0;      // the default
constexpr uint32_t RF_SLEEP_MIN_S = 60;     // @RS range, seconds
constexpr uint32_t RF_SLEEP_MAX_S = 86400;
constexpr uint32_t RF_NOT_PLANNED = 0xFFFFFFFFu;

struct RfKeepAwake {
  uint32_t intervalMs = RF_KEEP_AWAKE_DEFAULT_MS;  // 0: only the wake
  uint32_t sleepAfterMs = RF_SLEEP_NEVER;  // 0: kept awake for good once woken
  bool waking = false;
  uint32_t wakeUntil = 0;
  bool showing = false;
  uint32_t showingUntil = 0;
  bool sentAny = false;
  uint32_t lastSent = 0;  // start of the last RF frame of any kind
  bool kept = false;        // the bands are being kept awake
  uint32_t keptUntil = 0;   // and, with a sleep time, are left to sleep from then on
};

// Whether the bands are still being kept awake at `now`.
inline bool rfKeptAt(const RfKeepAwake& keep, uint32_t now) {
  return keep.kept &&
         (keep.sleepAfterMs == RF_SLEEP_NEVER || int32_t(now - keep.keptUntil) < 0);
}

// Keeps the bands awake until the sleep time after `from` at least.
inline void rfKeepFrom(RfKeepAwake& keep, uint32_t from) {
  const uint32_t until = from + keep.sleepAfterMs;
  if (!keep.kept || int32_t(until - keep.keptUntil) > 0) keep.keptUntil = until;
  keep.kept = true;
}

inline void rfStartWake(RfKeepAwake& keep, uint32_t now) {
  keep.waking = true;
  keep.wakeUntil = now + RF_WAKE_MS;
  rfKeepFrom(keep, keep.wakeUntil);
}

// Whether the bands have been left to sleep: no wake running and no light or
// wake within the sleep time.
inline bool rfLeftToSleep(const RfKeepAwake& keep, uint32_t now) {
  const bool waking = keep.waking && int32_t(now - keep.wakeUntil) < 0;
  return !waking && !rfKeptAt(keep, now);
}

// A new sleep time (@RS; 0 never). While the bands are kept awake it counts
// from now, or from the end of a wake or light still running. Bands already
// left to sleep stay so until the next light or wake.
inline void rfSetSleepAfter(RfKeepAwake& keep, uint32_t ms, uint32_t now) {
  const bool awake = !rfLeftToSleep(keep, now);
  keep.sleepAfterMs = ms;
  if (!awake) {
    keep.kept = false;
    return;
  }
  uint32_t from = now;
  if (keep.waking && int32_t(keep.wakeUntil - from) > 0) from = keep.wakeUntil;
  if (keep.showing && int32_t(keep.showingUntil - from) > 0) from = keep.showingUntil;
  keep.kept = true;
  keep.keptUntil = from + ms;
}

// A light frame (its last copy) went out at `now` with these envelope codes.
// After the bands were left to sleep it starts a new wake.
inline void rfLightSent(RfKeepAwake& keep, uint32_t now, uint8_t attack, uint8_t sustain,
                        uint8_t release) {
  const uint32_t until = now + envelopeMs(attack, sustain, release) + RF_SHOW_MARGIN_MS;
  if (rfLeftToSleep(keep, now)) rfStartWake(keep, now);
  if (!keep.showing || int32_t(until - keep.showingUntil) > 0) keep.showingUntil = until;
  keep.showing = true;
  keep.sentAny = true;
  keep.lastSent = now;
  rfKeepFrom(keep, until);
}

inline void rfNothingSent(RfKeepAwake& keep, uint32_t now) {
  keep.sentAny = true;
  keep.lastSent = now;
}

// Milliseconds until the next "nothing" frame is due (0: now), or
// RF_NOT_PLANNED.
inline uint32_t rfNextNothing(RfKeepAwake& keep, uint32_t now) {
  if (keep.waking && int32_t(now - keep.wakeUntil) >= 0) keep.waking = false;
  if (keep.showing && int32_t(now - keep.showingUntil) >= 0) keep.showing = false;
  if (keep.kept && !rfKeptAt(keep, now)) keep.kept = false;
  // Left to sleep: nothing goes out until a light or a wake.
  if (!keep.waking && !keep.kept) return RF_NOT_PLANNED;
  const uint32_t period = keep.waking ? RF_WAKE_PERIOD_MS : keep.intervalMs;
  if (period == 0) return RF_NOT_PLANNED;
  uint32_t delay = 0;
  if (keep.sentAny) {
    const uint32_t since = now - keep.lastSent;
    delay = since >= period ? 0 : period - since;
  }
  if (keep.showing && keep.showingUntil - now > delay) delay = keep.showingUntil - now;
  return delay;
}

}  // namespace pixmob
