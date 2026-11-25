import test from "node:test";
import assert from "node:assert/strict";
import { beatWorkletSource } from "../src/lib/beatWorklet.ts";
import {
  renderWorklet,
  kick,
  noise,
  onsets,
  matchHits,
} from "./helpers/workletHarness.ts";

type Hit = { at: number; kind: "kick" | "snare"; gain: number };

function drumSignal(
  time: number,
  hits: Hit[],
  interval: number,
  hatBody = 0.018,
) {
  let value = 0;
  for (const hit of hits) {
    const age = time - hit.at;
    if (hit.kind === "kick") value += kick(time, hit.at, 0.22 * hit.gain);
    else if (age >= 0 && age < 0.14) {
      value +=
        hit.gain *
        (noise(Math.floor(age * 48000)) * 0.14 * Math.exp(-age / 0.015) +
          0.1 * Math.sin(2 * Math.PI * 180 * age) * Math.exp(-age / 0.03));
    }
    const hatAge = time - hit.at - interval / 2;
    if (hatAge >= 0 && hatAge < 0.045) {
      // These hats leak into the body band instead of being pure 7 kHz tones.
      // Their onset is real, but weaker subdivisions should not double drums.
      value +=
        hit.gain *
        (hatBody * Math.sin(2 * Math.PI * 1200 * hatAge) +
          0.045 * Math.sin(2 * Math.PI * 7000 * hatAge) +
          noise(Math.floor(hatAge * 48000)) * 0.012) *
        Math.exp(-hatAge / 0.009);
    }
  }
  return value;
}

test("automatic mode rejects mid-rich halfway hats after learning stronger drum attacks", () => {
  for (const bpm of [60, 80, 120])
    for (const gain of [0.2, 1]) {
      const interval = 60 / bpm;
      const hits = hitsAt(bpm, 12, gain);
      const result = renderWorklet(
        beatWorkletSource,
        48000,
        hits.at(-1)!.at + interval,
        (time) => drumSignal(time, hits, interval, 0.04),
        1,
        45,
        true,
      );
      const expected = hits.slice(4).map((hit) => hit.at);
      matchHits(
        onsets(result).filter((event) => event.postedAt >= expected[0]),
        expected,
        0.032,
      );
    }
});

function hitsAt(bpm: number, count: number, gain: number, start = 0.5): Hit[] {
  return Array.from({ length: count }, (_, index) => ({
    at: start + (index * 60) / bpm,
    kind: index % 2 ? "snare" : "kick",
    gain,
  }));
}

function automaticMessages(result: ReturnType<typeof renderWorklet>) {
  return result.messages.flatMap(({ data }) =>
    typeof data === "object" && data.type === "tick" ? [data] : [],
  );
}

for (const bpm of [60, 80, 100, 120, 140, 160, 180]) {
  test(`automatic mode follows ${bpm} BPM drums at quiet, normal and loud levels`, (context) => {
    const interval = 60 / bpm;
    for (const gain of [0.2, 1, 2]) {
      const hits = hitsAt(bpm, 12, gain);
      const rate = bpm % 40 === 0 ? 44100 : 48000;
      const result = renderWorklet(
        beatWorkletSource,
        rate,
        hits.at(-1)!.at + interval,
        (time) => drumSignal(time, hits, interval),
        1,
        45,
        true,
      );
      // Four initial hits are allowed for local energy/tempo acquisition.
      const expected = hits.slice(4).map((hit) => hit.at);
      const actual = onsets(result).filter(
        (event) => event.postedAt >= expected[0],
      );
      const delays = matchHits(actual, expected, 0.032);
      assert.equal(
        result.audibleSamples,
        0,
        "automatic analysis cannot replay audio",
      );
      const metadata = automaticMessages(result).at(-1);
      assert.equal(
        metadata?.automatic,
        true,
        "the processor must acknowledge actual auto mode",
      );
      assert(Number.isFinite(metadata?.effectiveSensitivity));
      assert(
        Number(metadata?.effectiveSensitivity) >= 0 &&
          Number(metadata?.effectiveSensitivity) <= 100,
      );
      assert(
        Number(metadata?.tempoConfidence) >= 0 &&
          Number(metadata?.tempoConfidence) <= 1,
      );
      context.diagnostic(
        `gain ${gain}: ${expected.length}/${expected.length} steady drum hits, max sample-to-post ${Math.max(...delays).toFixed(2)} ms`,
      );
    }
  });
}

test("automatic mode adapts to a track volume change without restarting capture", () => {
  for (const bpm of [80, 160]) {
    const interval = 60 / bpm;
    const hits = hitsAt(bpm, 24, 1).map((hit, index) => ({
      ...hit,
      gain: index < 8 ? 2 : index < 16 ? 0.2 : 1,
    }));
    const result = renderWorklet(
      beatWorkletSource,
      48000,
      hits.at(-1)!.at + interval,
      (time) => drumSignal(time, hits, interval),
      1,
      45,
      true,
    );
    const observed = onsets(result);
    for (const start of [4, 12, 20]) {
      const expected = hits.slice(start, start + 4).map((hit) => hit.at);
      matchHits(
        observed.filter(
          (event) =>
            event.postedAt >= expected[0] &&
            event.postedAt < expected.at(-1)! + interval - 0.01,
        ),
        expected,
        0.032,
      );
    }
  }
});

test("automatic mode reacquires a tempo change without a fixed 80 BPM clock", () => {
  const slow = hitsAt(80, 12, 1);
  const fastStart = slow.at(-1)!.at + 60 / 80;
  const fast = hitsAt(160, 16, 0.6, fastStart);
  const result = renderWorklet(
    beatWorkletSource,
    48000,
    fast.at(-1)!.at + 0.5,
    (time) =>
      drumSignal(time, slow, 60 / 80) + drumSignal(time, fast, 60 / 160),
    1,
    45,
    true,
  );
  const actual = onsets(result);
  for (const segment of [slow, fast]) {
    const expected = segment.slice(4).map((hit) => hit.at);
    const end = segment === slow ? fastStart : fast.at(-1)!.at + 0.3;
    matchHits(
      actual.filter(
        (event) => event.postedAt >= expected[0] && event.postedAt < end,
      ),
      expected,
      0.032,
    );
  }
});

test("automatic gain cannot turn silence, pauses or sustained pads into a beat timer", () => {
  assert.equal(
    onsets(renderWorklet(beatWorkletSource, 48000, 6, () => 0, 1, 45, true))
      .length,
    0,
  );
  const pad = renderWorklet(
    beatWorkletSource,
    48000,
    7,
    (time) =>
      time < 0.5
        ? 0
        : 0.03 * Math.sin(2 * Math.PI * 55 * time) +
          0.02 * Math.sin(2 * Math.PI * 330 * time),
    1,
    45,
    true,
  );
  assert(
    onsets(pad).every((event) => event.postedAt < 0.6),
    "a held pad can have one initial attack, never repeated beats",
  );
  const hits = hitsAt(120, 8, 0.2).concat(hitsAt(120, 8, 1, 7));
  const result = renderWorklet(
    beatWorkletSource,
    48000,
    12,
    (time) => drumSignal(time, hits, 0.5),
    1,
    45,
    true,
  );
  const actual = onsets(result);
  assert(
    actual.every((event) => event.postedAt < 4.4 || event.postedAt >= 7),
    "paused source produced a new event",
  );
  matchHits(
    actual.filter((event) => event.postedAt >= 9),
    hits.filter((hit) => hit.at >= 9).map((hit) => hit.at),
    0.032,
  );
});

test("automatic sensitivity can be disabled and exposes bounded mode telemetry", () => {
  const result = renderWorklet(
    beatWorkletSource,
    48000,
    5,
    (time) => kick(time, 1, 0.2),
    1,
    45,
    true,
    [{ at: 2, data: { type: "autoSensitivity", enabled: false } }],
  );
  const early = result.messages.filter((message) => message.postedAt < 2);
  const late = result.messages.filter((message) => message.postedAt > 2.1);
  const ticks = (items: typeof early) =>
    items.flatMap(({ data }) =>
      typeof data === "object" && data.type === "tick" ? [data] : [],
    );
  assert(ticks(early).some((data) => data.automatic === true));
  assert(ticks(late).every((data) => data.automatic === false));
  assert(ticks(late).every((data) => data.effectiveSensitivity === 45));
  assert(onsets(result).every((event) => event.postedAt < 1.1));
});

test("automatic gain does not promote DC, stationary hiss or isolated clicks into beats", () => {
  const rate = 48000;
  const result = renderWorklet(
    beatWorkletSource,
    rate,
    6,
    (time) => {
      const sample = Math.round(time * rate);
      return (
        0.25 +
        noise(sample) * 0.001 +
        (sample === rate || sample === rate * 3 ? 0.6 : 0)
      );
    },
    1,
    45,
    true,
  );
  assert.equal(
    onsets(result).filter((event) => event.postedAt > 0.2).length,
    0,
  );
});

test("automatic mode retains quiet stereo drums with opposite channel phases", () => {
  const interval = 60 / 100;
  const hits = hitsAt(100, 12, 0.2);
  const result = renderWorklet(
    beatWorkletSource,
    44100,
    hits.at(-1)!.at + interval,
    (time, channel) =>
      drumSignal(time, hits, interval) * (channel === 1 ? -1 : 1),
    2,
    45,
    true,
  );
  const expected = hits.slice(4).map((hit) => hit.at);
  matchHits(
    onsets(result).filter((event) => event.postedAt >= expected[0]),
    expected,
    0.032,
  );
});

test("automatic thresholds do not require a particular saved manual sensitivity", () => {
  const interval = 60 / 110;
  const hits = hitsAt(110, 12, 0.12);
  const expected = hits.slice(4).map((hit) => hit.at);
  const timelines = [0, 100].map((manualSensitivity) => {
    const result = renderWorklet(
      beatWorkletSource,
      48000,
      hits.at(-1)!.at + interval,
      (time) => drumSignal(time, hits, interval),
      1,
      manualSensitivity,
      true,
    );
    const actual = onsets(result).filter(
      (event) => event.postedAt >= expected[0],
    );
    matchHits(actual, expected, 0.032);
    return actual.map((event) => event.postedAt);
  });
  assert.deepEqual(timelines[0], timelines[1]);
});
