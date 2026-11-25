import test from "node:test";
import assert from "node:assert/strict";
import { AudioEngine, BeatTracker, silentFrame } from "../src/lib/audio.ts";
import { BrowserBeatOutput } from "../src/lib/browserBeat.ts";
import type { AudioFrame } from "../src/lib/audio.ts";
import type { DeviceTransport } from "../src/lib/device.ts";

const measured = { source: "system", active: true } as const;
const frame = (beat: boolean, level = 0.7): AudioFrame => ({
  ...silentFrame,
  bass: level,
  level,
  beat,
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
function fixture(command?: () => Promise<unknown>) {
  const calls: { op: string; payload: unknown }[] = [];
  const errors: Error[] = [];
  const transport: DeviceTransport = {
    status: async () => ({
      name: "test",
      firmware: "test",
      irConfigured: true,
      micAvailable: false,
      rfSupported: false,
    }),
    close: async () => {},
    command(op, payload) {
      calls.push({ op, payload });
      return command?.() ?? Promise.resolve({});
    },
  };
  return {
    calls,
    errors,
    output: new BrowserBeatOutput(transport, (error) => errors.push(error)),
  };
}

test("browser beat output requires enabled, active measured audio and a real onset", async () => {
  const { calls, output } = fixture();
  output.process(frame(true), 1000, measured);
  output.enable();
  output.process(frame(true), 1020, { source: "demo", active: true });
  output.process(frame(true), 1040, { source: "esp32", active: true });
  output.process(frame(true), 1060, { source: "system", active: false });
  output.process(frame(false), 1080, measured);
  output.process(frame(true, 0), 1100, measured);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.deepEqual(calls, []);

  output.process(frame(false), 1120, measured);
  output.process(frame(true), 1140, measured);
  await settle();
  assert.deepEqual(calls, [{ op: "beat", payload: { color: "R" } }]);
  output.disable();
  output.process(frame(false), 1160, measured);
  output.process(frame(true), 1500, measured);
  assert.equal(calls.length, 1);
  assert.equal(output.active, false);
});

test("measured onset edges rotate RGB with spacing, without repeated high flags or clocks", async () => {
  const { calls, output } = fixture();
  output.enable();
  output.process(frame(true), 1000, measured);
  await settle();
  output.process(frame(true), 1100, measured);
  output.process(frame(true), 1600, measured);
  assert.equal(calls.length, 1);
  output.process(frame(false), 1620, measured);
  output.process(frame(true), 1640, measured);
  await settle();
  output.process(frame(false), 1660, measured);
  output.process(frame(true), 1750, measured); // Too close: this onset is discarded.
  await settle();
  output.process(frame(true), 2000, measured); // Held flag cannot replay discarded onset.
  output.process(frame(false), 2020, measured);
  output.process(frame(true), 2040, measured);
  await settle();
  output.process(frame(false), 2400, measured);
  output.process(frame(true), 2500, measured);
  await settle();
  assert.deepEqual(
    calls.map((call) => call.payload),
    [{ color: "R" }, { color: "G" }, { color: "B" }, { color: "R" }],
  );
  const count = calls.length;
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(calls.length, count);
  assert(calls.every((call) => call.op === "beat"));
});

test("busy browser output drops onsets instead of queuing stale music", async () => {
  let complete!: (value: unknown) => void;
  let first = true;
  const { calls, output } = fixture(() => {
    if (!first) return Promise.resolve({});
    first = false;
    return new Promise((resolve) => {
      complete = resolve;
    });
  });
  output.enable();
  output.process(frame(true), 1000, measured);
  output.process(frame(false), 1300, measured);
  output.process(frame(true), 1500, measured);
  output.process(frame(false), 1700, measured);
  output.process(frame(true), 2000, measured);
  assert.equal(calls.length, 1);
  complete({});
  await settle();
  assert.equal(calls.length, 1);
  output.process(frame(false), 2100, measured);
  output.process(frame(true), 2200, measured);
  await settle();
  assert.deepEqual(
    calls.map((call) => call.payload),
    [{ color: "R" }, { color: "G" }],
  );
});

test("equal-clock tick/onset messages send once while stale or nonfinite times cannot dispatch", async () => {
  const { calls, output } = fixture();
  output.enable();
  output.process(frame(false), 1000, measured);
  output.process(frame(true), 999, measured);
  output.process(frame(true), NaN, measured);
  output.process(frame(true), Infinity, measured);
  assert.equal(calls.length, 0);

  // A visual tick and a fresh audio onset may arrive in one clock bucket.
  output.process(frame(true), 1000, measured);
  output.process(frame(true), 1000, measured);
  await settle();
  assert.equal(calls.length, 1);
  output.process(frame(true), 1000, measured);
  assert.equal(calls.length, 1, "a repeated high flag cannot replay the onset");

  // Even after completion, resetting the edge cannot bypass the 200 ms limit.
  output.process(frame(false), 1000, measured);
  output.process(frame(true), 1000, measured);
  await settle();
  assert.equal(calls.length, 1);
  output.process(frame(true), 1300, measured);
  assert.equal(calls.length, 1, "a discarded onset is never replayed later");
  output.process(frame(false), 1400, measured);
  output.process(frame(true), 1400, measured);
  await settle();
  assert.equal(calls.length, 2, "a later fresh onset still sends normally");
});

test("a rejected beat disables output, reports once and never retries", async () => {
  const failure = new Error("ESP32 did not acknowledge the measured beat.");
  const { calls, output, errors } = fixture(() => Promise.reject(failure));
  output.enable();
  output.process(frame(true), 1000, measured);
  await settle();
  assert.equal(output.active, false);
  assert.deepEqual(errors, [failure]);
  output.process(frame(false), 1300, measured);
  output.process(frame(true), 1500, measured);
  await settle();
  assert.equal(calls.length, 1);
});

test("disabled generations cannot change a restarted sequence or report old errors", async () => {
  let rejectOld!: (reason: unknown) => void;
  let first = true;
  const { calls, errors, output } = fixture(() => {
    if (!first) return Promise.resolve({});
    first = false;
    return new Promise((_, reject) => {
      rejectOld = reject;
    });
  });
  output.enable();
  output.process(frame(true), 1000, measured);
  output.disable();
  output.enable();
  output.process(frame(true), 1200, measured); // Old write still in flight: dropped.
  rejectOld(new Error("late old rejection"));
  await settle();
  assert.equal(output.active, true);
  assert.deepEqual(errors, []);
  output.process(frame(false), 1300, measured);
  output.process(frame(true), 1500, measured);
  await settle();
  assert.deepEqual(
    calls.map((call) => call.payload),
    [{ color: "R" }, { color: "R" }],
  );
});

test("a late success after disable does not advance the new RGB generation", async () => {
  let completeOld!: (value: unknown) => void;
  let first = true;
  const { calls, output } = fixture(() => {
    if (!first) return Promise.resolve({});
    first = false;
    return new Promise((resolve) => {
      completeOld = resolve;
    });
  });
  output.enable();
  output.process(frame(true), 1000, measured);
  output.disable();
  output.enable();
  completeOld({});
  await settle();
  output.process(frame(false), 1500, measured);
  output.process(frame(true), 1520, measured);
  await settle();
  assert.deepEqual(
    calls.map((call) => call.payload),
    [{ color: "R" }, { color: "R" }],
  );
});

test("adaptive onset contrast detects small real kicks on a high bass baseline", () => {
  const tracker = new BeatTracker();
  const observed: number[] = [];
  for (let now = 0; now <= 6000; now += 20) {
    const kick = now >= 3000 && now % 500 === 0;
    const result = tracker.process(kick ? 0.855 : 0.8, 0.65, now, 60);
    if (result.beat && now >= 3000) observed.push(now);
    if (now === 6000) assert.equal(result.bpm, 120);
  }
  assert.deepEqual(observed, [3000, 3500, 4000, 4500, 5000, 5500, 6000]);
  assert.equal(tracker.process(0, 0, 6020, 60).beat, false);
  let sustained = 0;
  for (let now = 7000; now < 10000; now += 20)
    if (tracker.process(0.85, 0.65, now, 60).beat) sustained++;
  assert(sustained <= 1, "held bass must not turn into repeated beats");
});

test("AudioEngine tracks unsaturated measured bass even when visual gain clips the meter", () => {
  let bassByte = 204; // 0.8 measured bass, already clips visually at gain 1.36.
  const engine = new AudioEngine();
  const internals = engine as unknown as {
    context: { sampleRate: number };
    analyser: {
      fftSize: number;
      frequencyBinCount: number;
      getByteFrequencyData(data: Uint8Array): void;
    };
  };
  internals.context = { sampleRate: 48000 };
  internals.analyser = {
    fftSize: 2048,
    frequencyBinCount: 1024,
    getByteFrequencyData(data) {
      data.fill(0);
      for (
        let index = Math.ceil(30 / (48000 / 2048));
        index < Math.ceil(250 / (48000 / 2048));
        ++index
      )
        data[index] = bassByte;
    },
  };
  const observed: number[] = [];
  for (let now = 0; now <= 6000; now += 20) {
    bassByte = now >= 3000 && now % 500 === 0 ? 224 : 204;
    const result = engine.read(now, 60);
    assert.equal(result.bass, 1);
    if (result.beat && now >= 3000) observed.push(now);
  }
  assert.deepEqual(observed, [3000, 3500, 4000, 4500, 5000, 5500, 6000]);
  bassByte = 0;
  const silent = engine.read(6020, 60);
  assert.equal(silent.beat, false);
  assert.equal(silent.level, 0);
});
