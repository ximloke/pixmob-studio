import test from "node:test";
import assert from "node:assert/strict";
import {
  applyShowLightTiming,
  applyShowPulsePattern,
  createRgbDeviceCopy,
  generateBeatShow,
  nearestDevicePreset,
} from "../src/lib/autoSongCues.ts";
import {
  MAX_HOLD_MS,
  MAX_SONG_CUES,
  MIN_HOLD_MS,
  validSongShow,
} from "../src/lib/songShow.ts";
import type { RhythmAnalysis } from "../src/lib/songRhythm.ts";
import type { BeatShowOptions } from "../src/lib/autoSongCues.ts";

const options: BeatShowOptions = {
  name: "My measured song",
  profile: "Taylor Swift",
  pattern: "rgb",
  every: 1,
};
const analysis = (beats = [0.41, 1.07, 1.89, 2.35, 3.64]): RhythmAnalysis => ({
  duration: 10,
  bpm: 100,
  confidence: 0.8,
  beats,
});

test("a hardware-ready RGB copy preserves cue timing and the saved preview-only original", () => {
  const source = generateBeatShow(analysis(), {
    ...options,
    pattern: "single",
    color: "#ac17e0",
  }).show;
  source.cues = source.cues.map((cue) => ({
    ...cue,
    hardwareColor: undefined,
  }));
  const before = structuredClone(source);
  const copy = createRgbDeviceCopy(source);
  assert.deepEqual(source, before);
  assert(source.cues.every((cue) => cue.hardwareColor === undefined));
  assert.notEqual(copy.id, source.id);
  assert.deepEqual(
    copy.cues.map((cue) => cue.time),
    source.cues.map((cue) => cue.time),
  );
  assert.deepEqual(
    copy.cues.map((cue) => cue.hardwareColor),
    ["R", "G", "B", "R", "G"],
  );
  assert(
    copy.cues.every(
      (cue, index) => cue.id !== source.cues[index].id && cue.pulseMs === 120,
    ),
  );
  assert.equal(validSongShow(copy), true);
});

test("generated drafts preserve irregular measured beat times instead of inventing a BPM grid", () => {
  const input = analysis();
  const before = structuredClone(input);
  const generated = generateBeatShow(input, options);
  assert.deepEqual(
    generated.show.cues.map((cue) => cue.time),
    input.beats,
  );
  assert.deepEqual(
    generated.show.cues.map((cue) => cue.hardwareColor),
    ["R", "G", "B", "R", "G"],
  );
  assert.deepEqual(
    generated.show.cues.map((cue) => cue.lighting.color),
    ["#ff323e", "#12b24a", "#4275ff", "#ff323e", "#12b24a"],
  );
  assert.equal(generated.usedBeats, input.beats.length);
  assert.equal(generated.stride, 1);
  for (const cue of generated.show.cues) {
    assert.equal(cue.lighting.effect, "Flash");
    assert.equal(cue.lighting.brightness, 100);
    assert.equal(cue.lighting.musicSync, false);
    assert.equal(cue.pulseMs, 120);
  }
  assert.equal(validSongShow(generated.show), true);
  assert.deepEqual(
    input,
    before,
    "generation must not modify the measured analysis",
  );
});

test("every 1, 2 or 4 selects actual source beat indices and keeps the chosen profile", () => {
  const input = analysis([0.3, 0.92, 1.42, 2.18, 2.77, 3.61, 4.02, 4.8, 5.23]);
  for (const every of [1, 2, 4] as const) {
    const generated = generateBeatShow(input, {
      ...options,
      every,
      profile: "The Weeknd",
    });
    assert.deepEqual(
      generated.show.cues.map((cue) => cue.time),
      input.beats.filter((_, index) => index % every === 0),
    );
    assert(
      generated.show.cues.every((cue) => cue.lighting.profile === "The Weeknd"),
    );
    assert.equal(generated.stride, every);
  }
});

test("large songs thin cues across the whole song instead of truncating the opening", () => {
  const input = {
    ...analysis(Array.from({ length: 3000 }, (_, index) => 0.05 + index * 0.2)),
    duration: 600,
  };
  // Thinning doubles the stride so every kept cue stays on the same beat of
  // the bar; 3000 beats need a factor of 4 at every beat, 2 at every second.
  const expectedFactor = { 1: 4, 2: 2, 4: 1 } as const;
  for (const every of [1, 2, 4] as const) {
    const generated = generateBeatShow(input, { ...options, every });
    const expectedStride = every * expectedFactor[every];
    assert.equal(generated.stride, expectedStride);
    assert(generated.show.cues.length <= MAX_SONG_CUES);
    assert.equal(generated.usedBeats, generated.show.cues.length);
    assert.deepEqual(
      generated.show.cues.map((cue) => cue.time),
      input.beats.filter((_, index) => index % expectedStride === 0),
    );
    assert(
      generated.show.cues.at(-1)!.time > input.duration * 0.8,
      "thinning must preserve late-song coverage",
    );
    const finalSelectedIndex =
      (generated.show.cues.length - 1) * generated.stride;
    assert(input.beats.length - 1 - finalSelectedIndex < generated.stride);
    assert.equal(validSongShow(generated.show), true);
  }
});

test("each generation creates a new show and unique cue IDs without altering another draft", () => {
  const first = generateBeatShow(analysis(), options).show;
  const snapshot = structuredClone(first);
  const second = generateBeatShow(analysis(), options).show;
  const ids = [
    first.id,
    second.id,
    ...first.cues.map((cue) => cue.id),
    ...second.cues.map((cue) => cue.id),
  ];
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(first, snapshot);
});

test("single colors use one existing preset with an explicit closest-preset approximation for custom HEX", () => {
  const red = generateBeatShow(analysis(), {
    ...options,
    pattern: "single",
    color: "#FF323E",
  }).show;
  assert(
    red.cues.every(
      (cue) => cue.hardwareColor === "R" && cue.lighting.color === "#ff323e",
    ),
  );
  const white = generateBeatShow(analysis(), {
    ...options,
    pattern: "single",
    color: "#FFFFFF",
  }).show;
  assert(white.cues.every((cue) => cue.hardwareColor === "W"));
  const custom = generateBeatShow(analysis(), {
    ...options,
    pattern: "single",
    color: "#ac17e0",
  }).show;
  assert(
    custom.cues.every(
      (cue) => cue.hardwareColor === "B" && cue.lighting.color === "#ac17e0",
    ),
  );
  const defaultColor = generateBeatShow(analysis(), {
    ...options,
    pattern: "single",
  }).show;
  assert(defaultColor.cues.every((cue) => cue.hardwareColor === "R"));
});

test("applying single color changes the current RGB show without moving cues or mutating its saved source", () => {
  const source = generateBeatShow(analysis(), options).show;
  const snapshot = structuredClone(source);
  const single = applyShowPulsePattern(source, "single", "#ff323e");
  assert.equal(single.id, source.id);
  assert.deepEqual(
    single.cues.map((cue) => [cue.id, cue.time]),
    source.cues.map((cue) => [cue.id, cue.time]),
  );
  assert(
    single.cues.every(
      (cue) => cue.hardwareColor === "R" && cue.lighting.color === "#ff323e",
    ),
  );
  assert.deepEqual(source, snapshot);
  assert.equal(nearestDevicePreset("#0000ff").hardwareColor, "B");
  assert.equal(validSongShow(single), true);
});

test("silence, malformed analyses and invalid generator choices fail before creating a show", () => {
  assert.throws(
    () =>
      generateBeatShow(
        { duration: 10, bpm: null, confidence: 0, beats: [] },
        options,
      ),
    /No clear drum/,
  );
  const invalidAnalyses = [
    { ...analysis(), duration: Number.NaN },
    { ...analysis(), duration: 601 },
    { ...analysis(), confidence: 2 },
    { ...analysis(), beats: [1, 1] },
    { ...analysis(), beats: [2, 1] },
    { ...analysis(), beats: [Number.NaN] },
    { ...analysis(), beats: [11] },
  ];
  for (const input of invalidAnalyses)
    assert.throws(() => generateBeatShow(input, options), /valid local song/);
  for (const choice of [
    { ...options, name: " " },
    { ...options, name: "x".repeat(81) },
    { ...options, profile: "Unknown" },
    { ...options, pattern: "random" },
    { ...options, every: 3 },
    { ...options, every: "2" },
    { ...options, color: "red" },
    { ...options, color: "#fff" },
  ])
    assert.throws(
      () => generateBeatShow(analysis(), choice as BeatShowOptions),
      /show name, valid color/,
    );
});

test("light time is applied to every cue without moving cues or changing colors", () => {
  const source = generateBeatShow(
    analysis([1, 1.5, 2.25, 4, 4.04]),
    options,
  ).show;
  const snapshot = structuredClone(source);
  const timed = applyShowLightTiming(source, "timed", 2.5);
  assert(timed.cues.every((cue) => cue.holdMs === 2500));
  const untilNext = applyShowLightTiming(source, "until-next", 3);
  assert.deepEqual(
    untilNext.cues.map((cue) => cue.holdMs),
    // Gaps of 500, 750 and 1750 ms; 40 ms is raised to the minimum; the last
    // cue has no next cue and uses the given seconds.
    [500, 750, 1750, MIN_HOLD_MS, 3000],
  );
  // Fades stay on steady lights and are dropped for flashes and strobes.
  const faded = {
    ...timed,
    cues: timed.cues.map((cue) => ({ ...cue, fadeInMs: 960, fadeOutMs: 2400 })),
  };
  assert(applyShowLightTiming(faded, "timed", 1).cues.every((cue) => cue.fadeInMs === 960 && cue.fadeOutMs === 2400));
  assert(applyShowLightTiming(faded, "until-next", 1).cues.every((cue) => cue.fadeOutMs === 2400));
  for (const kind of ["flash", "strobe", "build"] as const)
    assert(applyShowLightTiming(faded, kind, 1).cues.every((cue) => !("fadeInMs" in cue) && !("fadeOutMs" in cue)));
  const rainbow = applyShowLightTiming(faded, "rainbow", 0.2);
  assert(rainbow.cues.every((cue) => cue.rainbowMs === 3000 && cue.holdMs === 500 && !("fadeInMs" in cue) && !("strobe" in cue)));
  for (const kind of ["flash", "timed", "until-next", "strobe", "build"] as const)
    assert(applyShowLightTiming(rainbow, kind, 1).cues.every((cue) => !("rainbowMs" in cue)));
  const strobe = applyShowLightTiming(untilNext, "strobe", 0.05);
  assert(strobe.cues.every((cue) => cue.strobe === "steady" && cue.holdMs === 200));
  const build = applyShowLightTiming(strobe, "build", 4);
  assert(build.cues.every((cue) => cue.strobe === "build" && cue.holdMs === 4000));
  assert.equal(applyShowLightTiming(build, "build", 999).cues[0].holdMs, 60000);
  assert(applyShowLightTiming(build, "timed", 2).cues.every((cue) => !("strobe" in cue)));
  assert(applyShowLightTiming(build, "until-next", 2).cues.every((cue) => !("strobe" in cue)));
  const flash = applyShowLightTiming(build, "flash");
  assert(flash.cues.every((cue) => !("strobe" in cue)));
  assert(flash.cues.every((cue) => !("holdMs" in cue)));
  for (const result of [timed, untilNext, flash]) {
    assert.equal(validSongShow(result), true);
    assert.deepEqual(
      result.cues.map((cue) => [cue.id, cue.time, cue.hardwareColor]),
      source.cues.map((cue) => [cue.id, cue.time, cue.hardwareColor]),
    );
  }
  assert.equal(applyShowLightTiming(source, "timed", 9999).cues[0].holdMs, MAX_HOLD_MS);
  assert.deepEqual(source, snapshot);
  assert.throws(() => applyShowLightTiming(source, "blink" as never));
  assert.throws(() => applyShowLightTiming(source, "timed", NaN));
});
