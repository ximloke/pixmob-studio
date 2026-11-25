import test from "node:test";
import assert from "node:assert/strict";
import { initialLighting, sampleEffect } from "../src/lib/effects.ts";
import {
  clampHardwareLead,
  createSongShow,
  DEFAULT_HARDWARE_LEAD_MS,
  MAX_HARDWARE_LEAD_MS,
  MAX_HOLD_MS,
  MAX_SONG_CUES,
  MIN_HOLD_MS,
  MAX_SONG_TIME,
  readSongShows,
  saveSongShows,
  SONG_SHOW_STORAGE_KEY,
  SongCueOutput,
  SongCueTimeline,
  songCueAt,
  sortedSongCues,
  validHoldMs,
  createSongCueRelay,
  exportSongShow,
  importSongShow,
  songShowFileName,
  rainbowPreviewColor,
  validStrobe,
  strobeFlashTimes,
  MIN_STROBE_MS,
  MAX_STROBE_MS,
  validSongShow,
  sampleSongCue,
} from "../src/lib/songShow.ts";
import type { SongShow } from "../src/lib/songShow.ts";

function show(): SongShow {
  return {
    id: "track-1",
    name: "My song",
    cues: [
      {
        id: "opening",
        time: 0,
        label: "Opening",
        lighting: { ...initialLighting, color: "#ff0000", effect: "Solid" },
        hardwareColor: "R",
      },
      {
        id: "chorus",
        time: 8,
        label: "Chorus",
        lighting: { ...initialLighting, color: "#0000ff", effect: "Fade" },
        hardwareColor: "B",
      },
      {
        id: "ending",
        time: 16,
        label: "Ending",
        lighting: { ...initialLighting, color: "#ffffff", effect: "Rainbow" },
      },
    ],
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test("song show data validates bounded timestamps, unique cues and verified hardware presets", () => {
  assert.equal(validSongShow(show()), true);
  assert.equal(validSongShow(createSongShow()), true);
  const bad: unknown[] = [
    { ...show(), name: " " },
    { ...show(), name: "x".repeat(81) },
    {
      ...show(),
      cues: Array.from({ length: MAX_SONG_CUES + 1 }, (_, index) => ({
        ...show().cues[0],
        id: `cue-${index}`,
      })),
    },
    { ...show(), cues: [show().cues[0], show().cues[0]] },
  ];
  for (const time of [-1, MAX_SONG_TIME + 1, NaN, Infinity, "8"])
    bad.push({ ...show(), cues: [{ ...show().cues[0], time }] });
  for (const hardwareColor of ["M", "OFF", "#ff0000", null])
    bad.push({ ...show(), cues: [{ ...show().cues[0], hardwareColor }] });
  bad.push({
    ...show(),
    cues: [
      { ...show().cues[0], lighting: { ...initialLighting, brightness: 101 } },
    ],
  });
  for (const value of bad) assert.equal(validSongShow(value), false);
  assert.equal(validSongShow({ ...show(), cues: [] }), true);
  assert.equal(
    validSongShow({
      ...show(),
      cues: Array.from({ length: MAX_SONG_CUES }, (_, index) => ({
        ...show().cues[0],
        id: `cue-${index}`,
      })),
    }),
    true,
  );
});

test("device lead is bounded, integer and defaults when unreadable", () => {
  assert.equal(clampHardwareLead("40"), 40);
  assert.equal(clampHardwareLead(12.6), 13);
  assert.equal(clampHardwareLead(-5), 0);
  assert.equal(clampHardwareLead(10000), MAX_HARDWARE_LEAD_MS);
  for (const value of ["abc", NaN, Infinity, null, undefined, {}])
    assert.equal(clampHardwareLead(value), DEFAULT_HARDWARE_LEAD_MS);
  assert(DEFAULT_HARDWARE_LEAD_MS > 0 && DEFAULT_HARDWARE_LEAD_MS <= MAX_HARDWARE_LEAD_MS);
});

test("a device lead crosses a cue early without replaying it at its real time", () => {
  const timeline = new SongCueTimeline();
  const program = show();
  const target = sortedSongCues(program)[1];
  const lead = 0.04;
  timeline.start(0, true);
  let hits = 0;
  for (let time = 0; time <= target.time + 0.2; time += 0.02) {
    const cue = timeline.advance(program, time + lead);
    if (cue?.id === target.id) {
      hits++;
      assert(time < target.time, "the lead must send the cue before its time");
      assert(time >= target.time - lead - 0.02);
    }
  }
  assert.equal(hits, 1);
});

test("local storage round trips validated show data while stripping unrelated fields", () => {
  let raw = "";
  const value = { ...show(), ignored: "not persisted" };
  value.cues[0].lighting.musicSync = true;
  saveSongShows([value], {
    setItem(key, next) {
      assert.equal(key, SONG_SHOW_STORAGE_KEY);
      raw = next;
    },
  });
  assert(!raw.includes("not persisted"));
  const read = readSongShows({ getItem: () => raw });
  assert.equal(read.error, undefined);
  assert.equal(read.shows.length, 1);
  assert.equal(read.shows[0].cues[0].lighting.musicSync, false);
  assert.deepEqual(
    read.shows[0].cues.map((cue) => cue.time),
    [0, 8, 16],
  );
});

test("malformed or unavailable storage has a visible error and cannot silently load unsafe cues", () => {
  for (const raw of [
    "invalid",
    JSON.stringify([
      { ...show(), cues: [{ ...show().cues[0], hardwareColor: "M" }] },
    ]),
    "x".repeat(1_000_001),
  ]) {
    const result = readSongShows({ getItem: () => raw });
    assert.deepEqual(result.shows, []);
    assert(result.error);
  }
  assert(
    readSongShows({
      getItem() {
        throw new Error("Storage denied");
      },
    }).error,
  );
  assert.throws(
    () =>
      saveSongShows([show()], {
        setItem() {
          throw new Error("Full");
        },
      }),
    /could not be saved/,
  );
  assert.throws(
    () => saveSongShows([show(), show()], { setItem() {} }),
    /valid song shows/,
  );
});

test("cue preview selects the current scene without mutating the show", () => {
  const value = show();
  value.cues.reverse();
  assert.equal(songCueAt(value, 0)?.id, "opening");
  assert.equal(songCueAt(value, 7.99)?.id, "opening");
  assert.equal(songCueAt(value, 8)?.id, "chorus");
  assert.equal(songCueAt(value, 999)?.id, "ending");
  assert.equal(songCueAt(value, NaN), null);
  assert.deepEqual(
    value.cues.map((cue) => cue.id),
    ["ending", "chorus", "opening"],
  );
  const cue = songCueAt(value, 8)!;
  const frame = sampleEffect(cue.lighting, 0.3);
  assert.equal(frame.color, "#0000ff");
  assert(frame.intensity >= 0 && frame.intensity <= 1);
});

test("generated Flash pulses decay once and remain dark between widely spaced beats", () => {
  const cue = {
    ...show().cues[0],
    time: 2,
    pulseMs: 120,
    lighting: {
      ...initialLighting,
      color: "#ff0000",
      effect: "Flash" as const,
      brightness: 100,
    },
  };
  assert.equal(sampleSongCue(cue, 1.99).intensity, 0);
  assert.equal(sampleSongCue(cue, 2).intensity, 1);
  const half = sampleSongCue(cue, 2.06).intensity;
  assert(half > 0 && half < 1);
  for (const time of [2.12, 2.5, 3, 4, 10])
    assert.equal(
      sampleSongCue(cue, time).intensity,
      0,
      "no oscillator may restart a completed pulse",
    );
  const looping = { ...cue, pulseMs: undefined };
  assert(
    sampleSongCue(looping, 3).intensity > 0,
    "manual repeating Flash remains supported",
  );
});

test("pulse durations are bounded and retained when a song show is saved and loaded", () => {
  const value = show();
  value.cues[0].pulseMs = 120;
  assert.equal(validSongShow(value), true);
  let raw = "";
  saveSongShows([value], {
    setItem(_key, next) {
      raw = next;
    },
  });
  assert.equal(
    readSongShows({ getItem: () => raw }).shows[0].cues[0].pulseMs,
    120,
  );
  for (const pulseMs of [NaN, Infinity, 0, 49.99, 2001, "120"])
    assert.equal(
      validSongShow({ ...value, cues: [{ ...value.cues[0], pulseMs }] }),
      false,
    );
});

test("timeline emits cue zero only on an explicit reset/start and resumes future cues only", () => {
  const timeline = new SongCueTimeline();
  timeline.start(0, true);
  assert.equal(timeline.advance(show(), 0)?.id, "opening");
  assert.equal(timeline.advance(show(), 0.01), null);
  timeline.seek(7.9);
  timeline.start(7.9);
  assert.equal(timeline.advance(show(), 8.01)?.id, "chorus");
  timeline.seek(8.03);
  timeline.start(8.03);
  assert.equal(timeline.advance(show(), 8.04), null);
  timeline.seek(0);
  timeline.start(0);
  assert.equal(
    timeline.advance(show(), 0.01),
    null,
    "a seek cannot replay cue zero",
  );
  timeline.start(0, true);
  assert.equal(timeline.advance(show(), 0.01)?.id, "opening");
});

test("seek, background jumps and stale crossings skip past hardware cues without a burst", () => {
  const timeline = new SongCueTimeline();
  timeline.start(0, true);
  assert.equal(timeline.advance(show(), 8.01), null);
  assert.equal(timeline.advance(show(), 8.02), null);
  timeline.seek(15.9);
  assert.equal(timeline.advance(show(), 16.01)?.id, "ending");
  assert.equal(timeline.advance(show(), 8), null);
  timeline.seek(7.9);
  assert.equal(
    timeline.advance(show(), 8.2),
    null,
    "an older crossing is not sent late",
  );
  assert.equal(timeline.advance(show(), Infinity), null);
});

test("multiple crossed cues collapse to the latest cue instead of queueing every missed event", () => {
  const value = show();
  value.cues = [0.01, 0.04, 0.08].map((time, index) => ({
    ...show().cues[0],
    id: `cue-${index}`,
    time,
  }));
  const timeline = new SongCueTimeline();
  timeline.start(0);
  assert.equal(timeline.advance(value, 0.1)?.id, "cue-2");
  assert.equal(timeline.advance(value, 0.11), null);
});

test("song output sends verified preset payloads only and drops cues while busy", async () => {
  const first = deferred<unknown>();
  const calls: unknown[] = [];
  const output = new SongCueOutput(
    {
      command(op, payload) {
        calls.push([op, payload]);
        return calls.length === 1 ? first.promise : Promise.resolve(true);
      },
    },
    () => {},
  );
  assert.equal(await output.send("R"), false);
  output.enable();
  const pending = output.send("R");
  assert.equal(await output.send("B"), false);
  assert.deepEqual(calls, [["preset", { color: "R" }]]);
  first.resolve(true);
  assert.equal(await pending, true);
  assert.equal(await output.send("W"), true);
  assert.equal(await output.send("M" as never), false);
  assert.deepEqual(calls, [
    ["preset", { color: "R" }],
    ["preset", { color: "W" }],
  ]);
});

test("Stop disables immediately and a late command completion cannot revive output", async () => {
  const command = deferred<unknown>();
  const calls: string[] = [];
  const output = new SongCueOutput(
    {
      command(op) {
        calls.push(op);
        return op === "preset" ? command.promise : Promise.resolve({});
      },
    },
    () => {},
  );
  output.enable();
  const pending = output.send("R");
  const stopped = output.stop();
  assert.equal(output.active, false);
  assert.equal(await output.send("G"), false);
  assert.deepEqual(calls, ["preset", "stop"]);
  command.resolve({});
  assert.equal(await pending, false);
  await stopped;
  assert.equal(output.active, false);
});

test("late errors from a canceled generation do not disable a newer show", async () => {
  const old = deferred<unknown>();
  let first = true;
  const errors: Error[] = [];
  const output = new SongCueOutput(
    {
      command() {
        if (first) {
          first = false;
          return old.promise;
        }
        return Promise.resolve(true);
      },
    },
    (error) => errors.push(error),
  );
  output.enable();
  const pending = output.send("R");
  output.disable();
  output.enable();
  assert.equal(
    await output.send("G"),
    false,
    "the prior physical send still owns the single in-flight slot",
  );
  old.reject(new Error("old error"));
  assert.equal(await pending, false);
  assert.deepEqual(errors, []);
  assert.equal(output.active, true);
  assert.equal(await output.send("B"), true);
});

test("current device failure disables hardware output and reports without retry", async () => {
  let calls = 0;
  const errors: Error[] = [];
  const output = new SongCueOutput(
    {
      async command() {
        calls++;
        throw new Error("Device disconnected");
      },
    },
    (error) => errors.push(error),
  );
  output.enable();
  assert.equal(await output.send("R"), false);
  assert.equal(output.active, false);
  assert.equal(await output.send("B"), false);
  assert.equal(calls, 1);
  assert.equal(errors.length, 1);
});

test("a canceled Stop rejection cannot report an error against a newer show generation", async () => {
  const oldStop = deferred<unknown>();
  const errors: Error[] = [];
  const output = new SongCueOutput(
    {
      command(operation) {
        return operation === "stop" ? oldStop.promise : Promise.resolve(true);
      },
    },
    (error) => errors.push(error),
  );
  output.enable();
  const stopping = output.stop();
  const rejected = assert.rejects(stopping, /old Stop/);
  output.enable();
  oldStop.reject(new Error("old Stop failed"));
  await rejected;
  assert.deepEqual(errors, []);
  assert.equal(output.active, true);
  assert.equal(await output.send("G"), true);
});

test("cue light time is bounded, saved, previewed as steady light and sent as a timed light", async () => {
  const base = show();
  const timed = {
    ...base,
    cues: base.cues.map((cue, index) =>
      index === 0 ? { ...cue, holdMs: 2500 } : cue,
    ),
  };
  assert.equal(validSongShow(timed), true);
  for (const holdMs of [MIN_HOLD_MS - 1, MAX_HOLD_MS + 1, 1500.5, NaN, "1500", null])
    assert.equal(
      validSongShow({
        ...base,
        cues: [{ ...base.cues[0], holdMs }],
      }),
      false,
    );
  assert.equal(validHoldMs(MIN_HOLD_MS), true);
  assert.equal(validHoldMs(MAX_HOLD_MS), true);

  let stored = "";
  saveSongShows([timed], { setItem: (_key, value) => void (stored = value) });
  const loaded = readSongShows({ getItem: () => stored });
  assert.equal(loaded.error, undefined);
  assert.equal(loaded.shows[0].cues.find((cue) => cue.holdMs)?.holdMs, 2500);
  assert.equal(
    loaded.shows[0].cues.filter((cue) => cue.holdMs !== undefined).length,
    1,
  );

  const cue = timed.cues.find((item) => item.holdMs)!;
  const lit = sampleSongCue(cue, cue.time + 2.4);
  assert.equal(lit.intensity, cue.lighting.brightness / 100);
  assert.equal(sampleSongCue(cue, cue.time + 2.6).intensity, 0);
  assert.equal(sampleSongCue(cue, cue.time - 0.1).intensity, 0);

  const sent: [string, unknown][] = [];
  const output = new SongCueOutput(
    {
      command: async (operation, payload) => {
        sent.push([operation, payload]);
        return true;
      },
    },
    () => {},
  );
  output.enable();
  assert.equal(await output.send("R", 2500), true);
  assert.equal(await output.send("G"), true);
  assert.equal(await output.send("B", 20), false);
  assert.deepEqual(sent, [
    ["light", { color: "R", ms: 2500 }],
    ["preset", { color: "G" }],
  ]);
});

test("a cue sent by hand is skipped by the timeline without losing later cues", () => {
  const program = show();
  const cues = sortedSongCues(program);
  const timeline = new SongCueTimeline();
  timeline.start(cues[1].time - 0.05);
  timeline.skipTo(cues[1].time);
  assert.equal(timeline.advance(program, cues[1].time + 0.01), null);
  timeline.skipTo(cues[1].time - 1);
  let later: string | undefined;
  for (let time = cues[1].time + 0.02; time <= cues[2].time + 0.05; time += 0.02)
    later = timeline.advance(program, time)?.id ?? later;
  assert.equal(later, cues[2].id);
});

test("a strobe cue is bounded, saved, previewed as flashes and sent as a strobe", async () => {
  const base = show();
  const withStrobe = (strobe: unknown, holdMs: unknown) => ({
    ...base,
    cues: [{ ...base.cues[0], holdMs, strobe }],
  });
  assert.equal(validSongShow(withStrobe("steady", 2000)), true);
  assert.equal(validSongShow(withStrobe("build", MAX_STROBE_MS)), true);
  for (const [strobe, holdMs] of [
    ["steady", undefined],
    ["steady", MIN_STROBE_MS - 1],
    ["build", MAX_STROBE_MS + 1],
    ["fast", 2000],
    [true, 2000],
  ])
    assert.equal(validSongShow(withStrobe(strobe, holdMs)), false);
  assert.equal(validStrobe("build", 2000), true);
  assert.equal(validStrobe(undefined, 2000), false);

  // Same schedule as the firmware (tests/strobe-plan.cpp known answers).
  assert.deepEqual(
    strobeFlashTimes(1000, "steady"),
    [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875],
  );
  assert.deepEqual(
    strobeFlashTimes(2000, "build"),
    [0, 0.5, 0.907, 1.237, 1.506, 1.724, 1.901],
  );

  const program = withStrobe("build", 2000) as SongShow;
  let stored = "";
  saveSongShows([program], { setItem: (_key, value) => void (stored = value) });
  const loaded = readSongShows({ getItem: () => stored });
  assert.equal(loaded.error, undefined);
  assert.equal(loaded.shows[0].cues[0].strobe, "build");
  assert.equal(loaded.shows[0].cues[0].holdMs, 2000);

  const cue = program.cues[0];
  assert.equal(
    sampleSongCue(cue, cue.time + 0.03).intensity,
    cue.lighting.brightness / 100,
  );
  assert.equal(sampleSongCue(cue, cue.time + 0.3).intensity, 0);
  assert.equal(
    sampleSongCue(cue, cue.time + 0.52).intensity,
    cue.lighting.brightness / 100,
  );
  assert.equal(sampleSongCue(cue, cue.time + 2.1).intensity, 0);

  const sent: [string, unknown][] = [];
  const output = new SongCueOutput(
    {
      command: async (operation, payload) => {
        sent.push([operation, payload]);
        return true;
      },
    },
    () => {},
  );
  output.enable();
  assert.equal(await output.send("W", 2000, "steady"), true);
  assert.equal(await output.send("R", 4000, "build"), true);
  assert.equal(await output.send("R", 100, "steady"), false);
  assert.equal(await output.send("R", undefined, "steady"), false);
  assert.deepEqual(sent, [
    ["strobe", { color: "W", ms: 2000, build: false }],
    ["strobe", { color: "R", ms: 4000, build: true }],
  ]);
});

test("custom cue colors and fades are bounded, saved, previewed and sent as one custom command", async () => {
  const base = show();
  const withExtras = (extras: Record<string, unknown>) => ({
    ...base,
    cues: [{ ...base.cues[0], ...extras }],
  });
  assert.equal(validSongShow(withExtras({ levels: [132, 64, 0] })), true);
  assert.equal(
    validSongShow(withExtras({ holdMs: 2000, fadeInMs: 960, fadeOutMs: 3840 })),
    true,
  );
  for (const extras of [
    { levels: [204, 0, 0] },
    { levels: [130, 64, 0] },
    { levels: [4, 4, 4] },
    { levels: [132, 64] },
    { levels: "844000" },
    { levels: [132, 64, 0], hardwareColor: undefined },
    { fadeInMs: 960 },
    { holdMs: 2000, fadeInMs: 1000 },
    { holdMs: 2000, strobe: "steady", fadeOutMs: 960 },
  ])
    assert.equal(validSongShow(withExtras(extras)), false, JSON.stringify(extras));

  const program = withExtras({
    levels: [132, 64, 0],
    holdMs: 2000,
    fadeInMs: 960,
    fadeOutMs: 2400,
  }) as SongShow;
  let stored = "";
  saveSongShows([program], { setItem: (_key, value) => void (stored = value) });
  const loaded = readSongShows({ getItem: () => stored });
  assert.equal(loaded.error, undefined);
  assert.deepEqual(loaded.shows[0].cues[0].levels, [132, 64, 0]);
  assert.equal(loaded.shows[0].cues[0].fadeInMs, 960);
  assert.equal(loaded.shows[0].cues[0].fadeOutMs, 2400);

  // Preview: ramp up, full for the set time, ramp down, dark.
  const cue = program.cues[0];
  const full = cue.lighting.brightness / 100;
  const at = (seconds: number) => sampleSongCue(cue, cue.time + seconds).intensity;
  assert.ok(Math.abs(at(0.48) - full / 2) < 1e-9);
  assert.equal(at(1.5), full);
  assert.equal(at(2.9), full);
  assert.ok(Math.abs(at(0.96 + 2 + 1.2) - full / 2) < 1e-9);
  assert.equal(at(0.96 + 2 + 2.5), 0);

  const sent: [string, unknown][] = [];
  const output = new SongCueOutput(
    {
      command: async (operation, payload) => {
        sent.push([operation, payload]);
        return true;
      },
    },
    () => {},
  );
  output.enable();
  assert.equal(await output.send("R", undefined, undefined, { levels: [132, 64, 0] }), true);
  assert.equal(
    await output.send("B", 2000, undefined, { fadeInMs: 960, fadeOutMs: 3840 }),
    true,
  );
  assert.equal(
    await output.send("R", 4000, "build", { levels: [188, 16, 160] }),
    true,
  );
  assert.equal(await output.send("G", 1500, undefined, { fadeOutMs: 96 }), true);
  // No extras: the earlier commands, unchanged.
  assert.equal(await output.send("G", 1500, undefined, {}), true);
  assert.equal(await output.send("R", undefined, undefined, { levels: [204, 0, 0] as never }), false);
  assert.equal(await output.send("R", undefined, undefined, { fadeInMs: 960 }), false);
  assert.deepEqual(sent, [
    ["custom", { kind: "flash", color: "=844000" }],
    ["custom", { kind: "light", color: "B", ms: 2000, fadeIn: 5, fadeOut: 7 }],
    ["custom", { kind: "build", color: "=BC10A0", ms: 4000 }],
    ["custom", { kind: "light", color: "G", ms: 1500, fadeIn: 0, fadeOut: 2 }],
    ["light", { color: "G", ms: 1500 }],
  ]);
});

test("a rainbow cue is bounded, saved, previewed as turning colors and sent as a rainbow", async () => {
  const base = show();
  const withFields = (fields: Record<string, unknown>) => ({
    ...base,
    cues: [{ ...base.cues[0], ...fields }],
  });
  assert.equal(validSongShow(withFields({ holdMs: 8000, rainbowMs: 3000 })), true);
  for (const fields of [
    { rainbowMs: 3000 },
    { holdMs: 400, rainbowMs: 3000 },
    { holdMs: 8000, rainbowMs: 999 },
    { holdMs: 8000, rainbowMs: 20001 },
    { holdMs: 8000, rainbowMs: 3000.5 },
    { holdMs: 8000, rainbowMs: 3000, strobe: "steady" },
    { holdMs: 8000, rainbowMs: 3000, fadeOutMs: 960 },
  ])
    assert.equal(validSongShow(withFields(fields)), false, JSON.stringify(fields));

  // Red, yellow, green, cyan, blue, magenta and back: the firmware's order.
  assert.deepEqual(
    [0, 500, 1000, 1500, 2000, 2500, 3000].map((ms) => rainbowPreviewColor(ms, 3000)),
    ["#ff0000", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#ff00ff", "#ff0000"],
  );

  const program = withFields({ holdMs: 8000, rainbowMs: 3000 }) as SongShow;
  let stored = "";
  saveSongShows([program], { setItem: (_key, value) => void (stored = value) });
  const loaded = readSongShows({ getItem: () => stored });
  assert.equal(loaded.error, undefined);
  assert.equal(loaded.shows[0].cues[0].rainbowMs, 3000);

  const cue = program.cues[0];
  assert.deepEqual(sampleSongCue(cue, cue.time + 1), {
    color: "#00ff00",
    intensity: cue.lighting.brightness / 100,
  });
  assert.equal(sampleSongCue(cue, cue.time + 8.1).intensity, 0);

  const sent: [string, unknown][] = [];
  const output = new SongCueOutput(
    {
      command: async (operation, payload) => {
        sent.push([operation, payload]);
        return true;
      },
    },
    () => {},
  );
  output.enable();
  assert.equal(await output.send("R", 8000, undefined, { rainbowMs: 3000 }), true);
  assert.equal(await output.send("R", 400, undefined, { rainbowMs: 3000 }), false);
  assert.equal(await output.send("R", undefined, undefined, { rainbowMs: 3000 }), false);
  assert.equal(await output.send("R", 8000, "steady", { rainbowMs: 3000 }), false);
  assert.deepEqual(sent, [["rainbow", { ms: 8000, cycleMs: 3000 }]]);
});

test("the Song shows relay passes every part of a cue to the device sender", async () => {
  const received: unknown[][] = [];
  let stops = 0;
  const relay = createSongCueRelay(
    async (...cue) => {
      received.push(cue);
      return true;
    },
    async () => void stops++,
    () => {},
  );
  assert.equal(await relay.send("R"), false, "nothing is sent while disabled");
  relay.enable();
  assert.equal(await relay.send("R"), true);
  assert.equal(await relay.send("G", 2500), true);
  assert.equal(await relay.send("W", 2000, "steady"), true);
  assert.equal(await relay.send("W", 4000, "build"), true);
  assert.equal(
    await relay.send("B", 2000, undefined, { fadeInMs: 960, fadeOutMs: 3840 }),
    true,
  );
  assert.equal(await relay.send("R", undefined, undefined, { levels: [132, 64, 0] }), true);
  assert.equal(
    await relay.send("R", 3000, "steady", { levels: [160, 12, 136] }),
    true,
  );
  assert.equal(await relay.send("R", 8000, undefined, { rainbowMs: 3000 }), true);
  // Invalid cues are still refused before they reach the sender.
  assert.equal(await relay.send("R", 400, undefined, { rainbowMs: 3000 }), false);
  assert.equal(await relay.send("R", 100, "steady"), false);
  assert.deepEqual(received, [
    ["R", undefined, undefined, {}],
    ["G", 2500, undefined, {}],
    ["W", 2000, "steady", {}],
    ["W", 4000, "build", {}],
    ["B", 2000, undefined, { fadeInMs: 960, fadeOutMs: 3840 }],
    ["R", undefined, undefined, { levels: [132, 64, 0] }],
    ["R", 3000, "steady", { levels: [160, 12, 136] }],
    ["R", 8000, undefined, { rainbowMs: 3000 }],
  ]);
  relay.disable();
  assert.equal(await relay.send("R"), false);
  assert.equal(stops, 0);
});

test("a show survives export to a file and import, and bad files are refused", () => {
  const base = show();
  const program: SongShow = {
    ...base,
    name: "14/11 coding half version",
    cues: [
      { ...base.cues[0], holdMs: 2000, fadeInMs: 960, levels: [132, 64, 0] },
      { ...base.cues[1], holdMs: 4000, strobe: "build" },
      { ...base.cues[2], holdMs: 8000, rainbowMs: 3000 },
    ],
  };
  const text = exportSongShow(program);
  const back = importSongShow(text);
  assert.deepEqual(back, JSON.parse(text).show);
  assert.equal(back.name, "14/11 coding half version");
  assert.equal(back.id, program.id);
  assert.deepEqual(back.cues[0].levels, [132, 64, 0]);
  assert.equal(back.cues[0].fadeInMs, 960);
  assert.equal(back.cues[1].strobe, "build");
  assert.equal(back.cues[2].rainbowMs, 3000);
  assert.equal(validSongShow(back), true);
  // Exporting the imported show gives the same file again.
  assert.equal(exportSongShow(back), text);

  assert.equal(songShowFileName(program), "14-11 coding half version.pixmob-show.json");
  assert.equal(songShowFileName({ ...program, name: "  " }), "show.pixmob-show.json");

  for (const bad of [
    "",
    "not json",
    "[]",
    JSON.stringify({ format: "other", version: 1, show: program }),
    JSON.stringify({ format: "pixmob-song-show", version: 2, show: program }),
    JSON.stringify({ format: "pixmob-song-show", version: 1 }),
    JSON.stringify({
      format: "pixmob-song-show",
      version: 1,
      show: { ...program, cues: [{ ...program.cues[0], holdMs: 5 }] },
    }),
    "x".repeat(2_000_001),
  ])
    assert.throws(() => importSongShow(bad));
  assert.throws(() => exportSongShow({ ...program, name: " " }));
});

test("a cue can go out by IR only, RF only or both, and keeps that in saved shows", async () => {
  const calls: unknown[] = [];
  const output = new SongCueOutput(
    {
      async command(op, payload) {
        calls.push([op, payload]);
        return true;
      },
    },
    () => {},
  );
  output.enable();
  assert.equal(await output.send("R", undefined, undefined, { output: "rf" }), true);
  assert.equal(await output.send("G", 1500, undefined, { output: "ir" }), true);
  assert.equal(await output.send("B", 2000, "build", { output: "both" }), true);
  assert.equal(await output.send("Y", 4000, undefined, { rainbowMs: 3000, output: "rf" }), true);
  assert.equal(await output.send("C", 900), true);
  assert.equal(await output.send("W", undefined, undefined, { output: "RF" as never }), false);
  assert.deepEqual(calls, [
    ["custom", { kind: "flash", color: "R", output: "rf" }],
    ["custom", { kind: "light", color: "G", ms: 1500, output: "ir" }],
    ["custom", { kind: "build", color: "B", ms: 2000, output: "both" }],
    ["rainbow", { ms: 4000, cycleMs: 3000, output: "rf" }],
    ["light", { color: "C", ms: 900 }],
  ]);

  const saved = show();
  saved.cues[0] = { ...saved.cues[0], output: "rf" };
  assert.equal(validSongShow(saved), true);
  assert.equal(importSongShow(exportSongShow(saved)).cues.find((cue) => cue.id === saved.cues[0].id)?.output, "rf");
  assert.equal(validSongShow({ ...saved, cues: [{ ...saved.cues[0], output: "radio" as never }] }), false);
});
