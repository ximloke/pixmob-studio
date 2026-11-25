// Host test for firmware/PixMobBeatController/RfPlan.h: the RF copy of each IR
// frame (same fields, both frames ending together, the GDO0 waveform) and the
// keep-awake schedule.
#include <cstdio>
#include <cstdlib>
#include "../firmware/PixMobBeatController/RfPlan.h"
#include "../firmware/PixMobBeatController/ColorLevels.h"

static int failures = 0;
static void expect(bool condition, const char* label) {
  if (!condition) {
    std::printf("FAIL: %s\n", label);
    ++failures;
  }
}

static int decodeRf(uint8_t code) {
  for (int i = 0; i < 64; ++i)
    if (pixmobrf::kLineCode[i] == code) return i;
  return -1;
}

// Rebuilds the bits from the runs and compares them with the frame.
static bool runsMatchFrame(const uint8_t frame[pixmobrf::kFrameBytes], const pixmob::RfRun* runs,
                           uint8_t count, uint32_t leadUs) {
  if (count < 2 || runs[0].level != 0 || runs[0].us != leadUs) return false;
  uint8_t bit = 0;
  for (uint8_t i = 1; i < count; ++i) {
    if (runs[i].level == runs[i - 1].level || runs[i].us == 0 || runs[i].us % pixmobrf::kBitMicros)
      return false;
    for (uint16_t n = 0; n < runs[i].us / pixmobrf::kBitMicros; ++n, ++bit)
      if (bit >= pixmobrf::kFrameBits || pixmobrf::frameBit(frame, bit) != (runs[i].level == 1))
        return false;
  }
  if (runs[count - 1].level != 1) return false;
  for (; bit < pixmobrf::kFrameBits; ++bit)  // only a final low run may be left out
    if (pixmobrf::frameBit(frame, bit)) return false;
  return true;
}

int main() {
  using namespace pixmob;
  expect(pixmobrf::allowedMhz(RF_MHZ) && RF_DBM <= 10, "carrier and power inside the limits");
  expect(RF_FRAME_US == 46080, "one RF frame is 90 x 512 us");

  // Every preset color, as a quick flash and with envelopes: the RF frame
  // carries the IR command's fields, and both frames end together.
  const char colors[] = "RGBYCMWK";
  uint32_t shortestIr = 0xFFFFFFFFu, longestIr = 0, latestIrStart = 0, matched = 0;
  const uint8_t envelopes[][3] = {{0, 1, 1}, {0, 4, 1}, {2, 3, 2}, {0, 6, 7}, {4, 3, 2}};
  for (const char* color = colors; *color; ++color) {
    Levels levels;
    expect(colorLevels(*color, levels), "preset levels");
    for (int e = -1; e < int(sizeof(envelopes) / sizeof(envelopes[0])); ++e) {
      Frame ir;
      uint8_t attack = RF_FLASH_ATTACK, sustain = RF_FLASH_SUSTAIN, release = RF_FLASH_RELEASE;
      bool built;
      if (e < 0) {
        built = singleColor(levels.red, levels.green, levels.blue, ir);
      } else {
        attack = envelopes[e][0];
        sustain = envelopes[e][1];
        release = envelopes[e][2];
        built = singleColorEnvelope(levels.red, levels.green, levels.blue, attack, sustain, release, ir);
      }
      expect(built, "IR frame built");
      uint8_t rf[pixmobrf::kFrameBytes];
      pixmobrf::colorFrame(levels.red, levels.green, levels.blue, rfTiming(attack, sustain, release), rf);
      // The seven RF fields equal the 9-byte IR command's values.
      const int expected[7] = {0, levels.green >> 2, levels.red >> 2, levels.blue >> 2, attack << 3,
                               (release << 3) | sustain, 0};
      bool same = true;
      for (int i = 0; i < 7; ++i) same = same && decodeRf(rf[i + 1]) == expected[i];
      expect(same, "RF fields equal the IR command");
      if (same) ++matched;

      const uint32_t irUs = irFrameMicros(ir);
      if (irUs < shortestIr) shortestIr = irUs;
      if (irUs > longestIr) longestIr = irUs;
      const RfAlignment a = alignRf(irUs);
      expect(a.rfLeadUs >= RF_LEAD_US && a.rfLeadUs <= RF_MAX_LEAD_US, "lead-in within limits");
      expect(a.irStartUs + irUs == a.rfLeadUs + RF_FRAME_US, "IR and RF end together");
      if (a.irStartUs > latestIrStart) latestIrStart = a.irStartUs;

      RfRun runs[RF_MAX_RUNS];
      const uint8_t count = rfRuns(rf, a.rfLeadUs, runs);
      expect(count <= RF_MAX_RUNS && (count + 1) / 2 <= 64, "fits one RMT memory block");
      expect(runsMatchFrame(rf, runs, count, a.rfLeadUs), "GDO0 runs reproduce the frame");
    }
  }
  expect(shortestIr > 20000 && longestIr < 52000, "IR frames last 20-52 ms");
  expect(latestIrStart < 30000, "the IR frame waits less than 30 ms");

  // Waveforms of many random frames, and an over-long lead-in is clamped.
  std::srand(11);
  for (int n = 0; n < 2000; ++n) {
    uint8_t rf[pixmobrf::kFrameBytes];
    const pixmobrf::Timing t = {uint8_t(std::rand() & 7), uint8_t(std::rand() & 7),
                                uint8_t(std::rand() & 7), 0};
    pixmobrf::colorFrame(uint8_t(std::rand()), uint8_t(std::rand()), uint8_t(std::rand()), t, rf);
    RfRun runs[RF_MAX_RUNS];
    const uint32_t lead = RF_LEAD_US + uint32_t(std::rand() % 5000);
    const uint8_t count = rfRuns(rf, lead, runs);
    expect(runsMatchFrame(rf, runs, count, lead), "random frame runs");
  }
  {
    uint8_t rf[pixmobrf::kFrameBytes];
    pixmobrf::colorFrame(0, 0, 0, pixmobrf::kNothingTiming, rf);
    RfRun runs[RF_MAX_RUNS];
    rfRuns(rf, 90000, runs);
    expect(runs[0].us == RF_MAX_LEAD_US, "lead-in clamped");
    const RfAlignment a = alignRf(200000);
    expect(a.rfLeadUs == RF_MAX_LEAD_US && a.irStartUs == 0, "very long IR frame clamped");
  }

  // Copies: each one arrives while the first still shows at full strength and
  // ends before the job's next frame, and as many as fit, up to three.
  for (uint8_t attack = 0; attack < 8; ++attack) {
    for (uint8_t sustain = 0; sustain < 8; ++sustain) {
      for (uint32_t spacing = 0; spacing <= 4000; spacing += spacing < 300 ? 1 : 50) {
        const uint8_t n = rfCopies(attack, sustain, spacing);
        const uint32_t full = uint32_t(SUSTAIN_MS[attack]) + SUSTAIN_MS[sustain];
        const auto fits = [&](uint8_t copies) {
          const uint32_t after = uint32_t(copies - 1) * RF_COPY_MS;
          return copies <= RF_MAX_COPIES && (copies == 1 || after + RF_COPY_GUARD_MS <= full) &&
                 (copies == 1 || spacing == 0 || RF_COPY_MS + after + RF_NEXT_GUARD_MS <= spacing);
        };
        expect(n >= 1 && fits(n), "copies fit the light and the next frame");
        expect(!fits(uint8_t(n + 1)), "no further copy would fit");
      }
    }
  }
  expect(rfFlashCopies(1) == 3 && rfFlashCopies(3) == 1, "a quick flash: 3 copies, Auto's repeats 1");
  // The RF quick flash lasts as long as the IR one seen on the band (video of
  // 21 Nov 2026: 217-235 ms); with 480 ms it stayed lit about 0.3 s longer.
  {
    const uint32_t flashMs = uint32_t(SUSTAIN_MS[RF_FLASH_ATTACK]) + SUSTAIN_MS[RF_FLASH_SUSTAIN] +
                             SUSTAIN_MS[RF_FLASH_RELEASE];
    expect(flashMs == 224 && flashMs >= 217 - 17 && flashMs <= 235 + 17,
           "RF quick flash 224 ms, within a video frame of the IR flash");
  }
  expect(rfCopies(0, 2, 0) == 2 && rfCopies(0, 1, 0) == 1, "0.1 s light: 2 copies; 32 ms: 1");
  expect(rfCopies(0, 6, 100) == 1 && rfCopies(0, 6, 105) == 2 && rfCopies(0, 6, 155) == 3,
         "the next frame limits the copies");

  // Keep-awake schedule.
  {
    RfKeepAwake k;
    expect(rfNextNothing(k, 1000) == RF_NOT_PLANNED, "nothing before the first wake or light");
    rfStartWake(k, 1000);
    expect(rfNextNothing(k, 1000) == 0, "wake starts at once");
    rfNothingSent(k, 1000);
    expect(rfNextNothing(k, 1000) == RF_WAKE_PERIOD_MS, "wake every 50 ms");
    const uint32_t woke = 1000 + RF_WAKE_MS;
    expect(rfNextNothing(k, woke) == 0 && !k.waking, "after the wake, the keep-awake interval");
    rfNothingSent(k, woke);
    expect(rfNextNothing(k, woke) == RF_KEEP_AWAKE_DEFAULT_MS, "then after the interval");
    expect(rfNextNothing(k, woke + 1999) == 1 && rfNextNothing(k, woke + 2000) == 0, "interval counted");
    // By default the bands are never left to sleep once woken.
    expect(k.sleepAfterMs == RF_SLEEP_NEVER, "no sleep by default");
    const uint32_t hours = woke + 10u * 3600u * 1000u;
    rfNothingSent(k, hours - 2000);
    expect(rfNextNothing(k, hours) == 0 && !rfLeftToSleep(k, hours), "still kept awake 10 h later");
    k.intervalMs = 0;
    rfStartWake(k, 500000);
    rfNothingSent(k, 500000);
    expect(rfNextNothing(k, 500000) == RF_WAKE_PERIOD_MS, "interval 0: the wake still runs");
    expect(rfNextNothing(k, 500000 + RF_WAKE_MS) == RF_NOT_PLANNED, "interval 0: only the wake");
  }
  // With a sleep time (@RS), e.g. the 5 minutes first asked for.
  const uint32_t sleep = 300000;
  {
    RfKeepAwake k;
    k.sleepAfterMs = sleep;
    rfStartWake(k, 1000);
    const uint32_t woke = 1000 + RF_WAKE_MS;
    rfNothingSent(k, woke + sleep - 2001);
    expect(rfNextNothing(k, woke + sleep - 1) == 0, "kept awake until just before");
    expect(rfNextNothing(k, woke + sleep) == RF_NOT_PLANNED && rfLeftToSleep(k, woke + sleep),
           "left to sleep 5 min after the wake ends");
  }
  {
    // A light keeps the bands awake 5 min after it ends; after that the next
    // light starts a new wake.
    RfKeepAwake k;
    k.sleepAfterMs = sleep;
    rfStartWake(k, 0);
    rfLightSent(k, 100000, 0, 1, 1);  // 32 + 32 ms
    const uint32_t end = 100000 + 64 + RF_SHOW_MARGIN_MS;
    expect(rfNextNothing(k, end + sleep - 1) != RF_NOT_PLANNED, "kept 5 min after the light");
    expect(rfNextNothing(k, end + sleep) == RF_NOT_PLANNED, "then left to sleep");
    const uint32_t later = end + sleep + 60000;
    rfLightSent(k, later, 0, 1, 1);
    expect(k.waking && k.wakeUntil == later + RF_WAKE_MS, "the next light starts a wake");
    expect(rfNextNothing(k, later + 64 + RF_SHOW_MARGIN_MS) == 0, "wake frames once that light is over");
    // Lights while the bands are kept awake start no wake.
    RfKeepAwake busy;
    busy.sleepAfterMs = sleep;
    rfStartWake(busy, 0);
    rfNextNothing(busy, RF_WAKE_MS);
    rfLightSent(busy, RF_WAKE_MS + 1000, 0, 1, 1);
    expect(!busy.waking, "no wake while kept awake");
    // A long light counts from its end.
    RfKeepAwake held;
    held.sleepAfterMs = sleep;
    rfStartWake(held, 0);
    rfLightSent(held, 100000, 0, 7, 7);  // 3840 + 3840 ms
    const uint32_t heldEnd = 100000 + 7680 + RF_SHOW_MARGIN_MS;
    expect(rfNextNothing(held, heldEnd + sleep - 1) != RF_NOT_PLANNED &&
               rfNextNothing(held, heldEnd + sleep) == RF_NOT_PLANNED,
           "a long light counts from its end");
  }
  {
    // Changing the sleep time (@RS).
    RfKeepAwake k;
    rfSetSleepAfter(k, RF_SLEEP_NEVER, 0);  // at power-on, before the first wake
    expect(rfNextNothing(k, 0) == RF_NOT_PLANNED, "a setting alone sends nothing");
    rfStartWake(k, 1000);
    rfSetSleepAfter(k, sleep, 20000);  // during the wake: counts from its end
    const uint32_t woke = 1000 + RF_WAKE_MS;
    expect(!rfLeftToSleep(k, woke + sleep - 1) && rfLeftToSleep(k, woke + sleep),
           "set during a wake: 5 min after the wake ends");
    rfSetSleepAfter(k, 60000, 100000);  // kept awake: counts from now
    expect(!rfLeftToSleep(k, 159999) && rfLeftToSleep(k, 160000), "set while kept awake: from now");
    rfSetSleepAfter(k, RF_SLEEP_NEVER, 150000);  // back to never while still kept awake
    expect(!rfLeftToSleep(k, 150000 + 10u * 3600u * 1000u), "back to never: kept awake for good");
    RfKeepAwake asleep;
    asleep.sleepAfterMs = 60000;
    rfStartWake(asleep, 0);
    expect(rfNextNothing(asleep, RF_WAKE_MS + 60000) == RF_NOT_PLANNED, "left to sleep");
    rfSetSleepAfter(asleep, RF_SLEEP_NEVER, RF_WAKE_MS + 70000);
    expect(rfNextNothing(asleep, RF_WAKE_MS + 70000) == RF_NOT_PLANNED,
           "never, once left to sleep: nothing until the next light or wake");
    rfLightSent(asleep, RF_WAKE_MS + 80000, 0, 1, 1);
    expect(asleep.waking && !rfLeftToSleep(asleep, RF_WAKE_MS + 80000 + 10u * 3600u * 1000u),
           "then a light wakes them and they are kept awake for good");
  }
  {
    // No black frame while a light may still show: its envelope plus margin.
    RfKeepAwake k;
    k.intervalMs = 200;
    rfLightSent(k, 10000, RF_FLASH_ATTACK, RF_FLASH_SUSTAIN, RF_FLASH_RELEASE);
    expect(rfNextNothing(k, 10000) == 192 + 32 + RF_SHOW_MARGIN_MS, "quick flash shows 524 ms");
    rfStartWake(k, 10000);
    rfLightSent(k, 10100, 0, 6, 7);  // 2400 + 3840 ms
    expect(rfNextNothing(k, 10100) == 2400 + 3840 + RF_SHOW_MARGIN_MS, "even while waking");
    // A shorter light afterwards does not shorten the wait.
    rfLightSent(k, 10200, 0, 1, 1);
    expect(rfNextNothing(k, 10200) == 6540 - 100, "longest light wins");
    expect(rfNextNothing(k, 10100 + 6540) == 0, "due once the light is over");
  }
  {
    // Across the millis() wrap.
    RfKeepAwake k;
    const uint32_t now = 0xFFFFFF00u;
    rfStartWake(k, now - RF_WAKE_MS - 1000);  // woken earlier; that wake is over
    rfLightSent(k, now, 0, 1, 1);
    expect(rfNextNothing(k, now) == RF_KEEP_AWAKE_DEFAULT_MS, "interval across the wrap");
    rfStartWake(k, now);
    expect(rfNextNothing(k, now + 0x200) == 0, "wake across the wrap");
    expect(rfNextNothing(k, now + RF_WAKE_MS + 10) == 0 && k.waking == false, "wake ends across the wrap");
  }

  std::printf("RF fields equal the IR command for %u frames; IR frames %lu-%lu us, IR start up to %lu us "
              "after the RF waveform\n",
              unsigned(matched), (unsigned long)shortestIr, (unsigned long)longestIr,
              (unsigned long)latestIrStart);
  if (failures) {
    std::printf("%d failure(s)\n", failures);
    return 1;
  }
  return 0;
}
