import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { setImmediate } from "node:timers/promises";
import {
  analyseSongRhythm,
  MAX_ANALYSIS_SECONDS,
  MAX_ANALYSIS_FILE_BYTES,
  MAX_ANALYSIS_BEATS,
  rhythmWorkerSource,
  validateRhythmAnalysis,
} from "../src/lib/songRhythm.ts";
import type { RhythmAnalysis } from "../src/lib/songRhythm.ts";
import { beatWorkletSource } from "../src/lib/beatWorklet.ts";
import { renderWorklet, matchHits } from "./helpers/workletHarness.ts";

const rate = 22050;
const kick = (time: number, start: number, gain = 1) => {
  const age = time - start;
  return age < 0 || age > 0.18
    ? 0
    : 0.22 * gain * Math.sin(2 * Math.PI * 90 * age) * Math.exp(-age / 0.042);
};
function noise(index: number) {
  let value = index | 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x80000000 - 1;
}
function drumTrack(bpm: number, gain: number, count = 16) {
  const interval = 60 / bpm;
  const hits = Array.from(
    { length: count },
    (_, index) => 0.5 + index * interval,
  );
  const length = Math.ceil((hits.at(-1)! + interval) * rate);
  const channel = Float32Array.from({ length }, (_, sample) => {
    const time = sample / rate;
    let value = 0;
    for (let index = 0; index < hits.length; index++) {
      const age = time - hits[index];
      if (index % 2 === 0) value += kick(time, hits[index], gain);
      else if (age >= 0 && age < 0.14)
        value +=
          gain *
          (noise(Math.floor(age * rate)) * 0.14 * Math.exp(-age / 0.015) +
            0.1 * Math.sin(2 * Math.PI * 180 * age) * Math.exp(-age / 0.03));
      const hatAge = age - interval / 2;
      if (hatAge >= 0 && hatAge < 0.045)
        value +=
          gain *
          (Math.sin(2 * Math.PI * 1200 * hatAge) * 0.04 +
            Math.sin(2 * Math.PI * 7000 * hatAge) * 0.045 +
            noise(Math.floor(hatAge * rate)) * 0.012) *
          Math.exp(-hatAge / 0.009);
    }
    return value;
  });
  return { channel, hits, duration: length / rate };
}

function runWorker(channels: Float32Array[], inputRate = rate) {
  const messages: Record<string, unknown>[] = [];
  const worker = {
    onmessage: null as ((event: { data: unknown }) => void) | null,
    postMessage(data: Record<string, unknown>) {
      messages.push(data);
    },
  };
  const scope = vm.createContext({ self: worker, Float32Array, ArrayBuffer });
  new vm.Script(rhythmWorkerSource).runInContext(scope);
  assert(
    worker.onmessage,
    "the actual shipped worker must install its handler",
  );
  worker.onmessage({
    data: {
      type: "analyse",
      sampleRate: inputRate,
      channels: channels.map((channel) => channel.buffer),
    },
  });
  const error = messages.find((message) => message.type === "error");
  return {
    messages,
    error,
    result: messages.find((message) => message.type === "result")?.result as
      RhythmAnalysis | undefined,
  };
}

function assertMeasuredTimes(
  actual: number[],
  expected: number[],
  tolerance = 0.035,
) {
  assert.equal(
    actual.length,
    expected.length,
    `expected ${expected}; got ${actual}`,
  );
  for (let index = 0; index < expected.length; index++) {
    assert(
      actual[index] >= expected[index] - 1 / rate,
      "analysis invented a beat before its signal attack",
    );
    assert(
      actual[index] - expected[index] <= tolerance,
      `beat ${index} moved ${(actual[index] - expected[index]) * 1000} ms away from its actual attack`,
    );
  }
}

for (const bpm of [80, 120, 160]) {
  test(`actual offline worker measures ${bpm} BPM from quiet and normal PCM`, (context) => {
    for (const gain of [0.2, 1]) {
      const fixture = drumTrack(bpm, gain);
      const run = runWorker([fixture.channel]);
      assert.equal(run.error, undefined);
      assert(validateRhythmAnalysis(run.result));
      assert(Math.abs(run.result.duration - fixture.duration) <= 1 / rate);
      assert(run.result.bpm !== null && Math.abs(run.result.bpm - bpm) <= 1);
      assert(run.result.confidence >= 0.7 && run.result.confidence <= 1);
      // Energy learning may use the opening four attacks. Steady attacks must
      // then correspond to the actual PCM, without halfway-hat doubling.
      assertMeasuredTimes(
        run.result.beats.filter((time) => time >= fixture.hits[4]),
        fixture.hits.slice(4),
      );
      const progress = run.messages
        .filter((message) => message.type === "progress")
        .map((message) => Number(message.fraction));
      assert(progress.length <= 49);
      assert(
        progress.every(
          (value, index) =>
            value > 0 && value < 1 && (!index || value > progress[index - 1]),
        ),
      );
      context.diagnostic(
        `gain ${gain}: estimated ${run.result.bpm} BPM, confidence ${run.result.confidence.toFixed(3)}; actual attack positions retained`,
      );
    }
  });
}

test("offline worker preserves stereo energy with opposite phases", () => {
  const fixture = drumTrack(120, 0.2);
  const run = runWorker([
    fixture.channel,
    fixture.channel.map((value) => -value),
  ]);
  assert.equal(run.error, undefined);
  assert(validateRhythmAnalysis(run.result));
  assertMeasuredTimes(
    run.result.beats.filter((time) => time >= fixture.hits[4]),
    fixture.hits.slice(4),
  );
});

test("the 22.05 kHz detector reports actual processing-quantum times without backdating", (context) => {
  const fixture = drumTrack(120, 0.2);
  const rendered = renderWorklet(
    beatWorkletSource,
    rate,
    fixture.duration,
    (time, channel) => {
      const value = fixture.channel[Math.round(time * rate)] ?? 0;
      return channel === 1 ? -value : value;
    },
    2,
    45,
    true,
  );
  const expected = fixture.hits.slice(4);
  const actual = rendered.messages
    .flatMap(({ data, postedAt }) => {
      if (typeof data !== "object" || data.type !== "onset") return [];
      const audioTime = Number(data.audioTime);
      assert(Number.isFinite(audioTime));
      assert(audioTime <= postedAt + 1e-9);
      // A 128-frame quantum is 5.8 ms at this analysis rate, rather than the
      // under-4 ms quanta used by the 44.1/48 kHz live-audio fixture helper.
      assert(postedAt - audioTime <= 128 / rate + 1e-9);
      return [
        {
          audioTime,
          postedAt,
          level: Number(data.level),
          strength: Number(data.strength),
        },
      ];
    })
    .filter((event) => event.postedAt >= expected[0]);
  const delays = matchHits(actual, expected, 0.032);
  assert.equal(rendered.audibleSamples, 0);
  context.diagnostic(
    `independent sample onset → quantum post: ${Math.min(...delays).toFixed(2)}–${Math.max(...delays).toFixed(2)} ms; excludes decoding and physical output`,
  );
});

test("offline results retain irregular attacks and do not fill silence with a uniform beat grid", () => {
  const hits = [0.5, 1.17, 1.74, 2.68, 3.11, 4.05, 4.59];
  const samples = Float32Array.from({ length: rate * 7 }, (_, sample) =>
    hits.reduce((sum, start) => sum + kick(sample / rate, start), 0),
  );
  const run = runWorker([samples]);
  assert.equal(run.error, undefined);
  assert(validateRhythmAnalysis(run.result));
  assertMeasuredTimes(run.result.beats, hits);
  assert(
    run.result.beats.every((time) => time < 4.65),
    "the quiet tail must not be filled using an estimated tempo",
  );
  const silent = runWorker([new Float32Array(rate * 3)]);
  assert(validateRhythmAnalysis(silent.result));
  assert.equal(silent.result.bpm, null);
  assert.equal(silent.result.confidence, 0);
  assert.deepEqual(Array.from(silent.result.beats), []);
});

test("worker rejects unsupported sample rate, missing channels and inconsistent channel lengths", () => {
  for (const run of [
    runWorker([], rate),
    runWorker([new Float32Array(128)], 48000),
    runWorker([new Float32Array(128), new Float32Array(256)], rate),
    runWorker([new Float32Array(0)], rate),
  ]) {
    assert(run.error);
    assert.equal(run.result, undefined);
  }
});

test("rhythm result validation bounds metadata and requires ordered finite real positions", () => {
  const valid: RhythmAnalysis = {
    duration: 5,
    bpm: 120,
    confidence: 0.9,
    beats: [0.5, 1, 1.5, 2],
  };
  assert.equal(validateRhythmAnalysis(valid), true);
  assert.equal(
    validateRhythmAnalysis({
      duration: 5,
      bpm: null,
      confidence: 0,
      beats: [],
    }),
    true,
  );
  for (const value of [
    { ...valid, duration: 0 },
    { ...valid, duration: Number.NaN },
    { ...valid, duration: MAX_ANALYSIS_SECONDS + 1 },
    { ...valid, bpm: 500 },
    { ...valid, bpm: "120" },
    { ...valid, confidence: -0.1 },
    { ...valid, confidence: Infinity },
    { ...valid, beats: [1, 1] },
    { ...valid, beats: [2, 1] },
    { ...valid, beats: [-1] },
    { ...valid, beats: [6] },
    { ...valid, beats: [Number.NaN] },
    {
      ...valid,
      beats: Array.from(
        { length: MAX_ANALYSIS_BEATS + 1 },
        (_, index) => index / 10000,
      ),
    },
  ])
    assert.equal(validateRhythmAnalysis(value), false);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

function hostEnvironment(
  options: { decode?: Promise<unknown>; duration?: number } = {},
) {
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const install = (name: string, value: unknown) => {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  };
  const duration = options.duration ?? 5;
  const channel = new Float32Array(Math.ceil(duration * rate));
  const decoded = {
    duration,
    sampleRate: rate,
    length: channel.length,
    numberOfChannels: 1,
    getChannelData: () => channel,
  };
  const contexts: unknown[][] = [];
  class MockOfflineContext {
    constructor(...arguments_: unknown[]) {
      contexts.push(arguments_);
    }
    decodeAudioData() {
      return options.decode ?? Promise.resolve(decoded);
    }
  }
  const workers: MockWorker[] = [];
  class MockWorker {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    terminated = 0;
    messages: { data: unknown; transfer: unknown }[] = [];
    constructor(readonly url: string) {
      workers.push(this);
    }
    postMessage(data: unknown, transfer: unknown) {
      this.messages.push({ data, transfer });
    }
    terminate() {
      this.terminated++;
    }
    emit(data: unknown) {
      this.onmessage?.({ data });
    }
  }
  install("OfflineAudioContext", MockOfflineContext);
  install("Worker", MockWorker);
  const created: string[] = [],
    revoked: string[] = [];
  const create = URL.createObjectURL,
    revoke = URL.revokeObjectURL;
  URL.createObjectURL = () => {
    const value = `blob:rhythm-${created.length}`;
    created.push(value);
    return value;
  };
  URL.revokeObjectURL = (value) => {
    revoked.push(value);
  };
  const file = {
    name: "local.wav",
    size: 32,
    type: "audio/wav",
    arrayBuffer: async () => new ArrayBuffer(32),
  } as File;
  return {
    contexts,
    workers,
    created,
    revoked,
    decoded,
    file,
    restore() {
      URL.createObjectURL = create;
      URL.revokeObjectURL = revoke;
      for (const [name, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    },
  };
}

async function workerReady(environment: ReturnType<typeof hostEnvironment>) {
  for (
    let attempts = 0;
    attempts < 30 && !environment.workers.length;
    attempts++
  )
    await setImmediate();
  assert.equal(environment.workers.length, 1);
  return environment.workers[0];
}
const hostResult = (): RhythmAnalysis => ({
  duration: 5,
  bpm: 120,
  confidence: 0.9,
  beats: [0.5, 1, 1.5, 2, 2.5, 3],
});

test("analysis service returns validated metadata and disposes its worker and Blob URL", async () => {
  const environment = hostEnvironment();
  const progress: number[] = [];
  try {
    const pending = analyseSongRhythm(environment.file, {
      onProgress: (value) => progress.push(value),
    });
    const worker = await workerReady(environment);
    assert.deepEqual(environment.contexts[0], [2, 1, rate]);
    const sent = worker.messages[0].data as {
      type: string;
      sampleRate: number;
      channels: ArrayBuffer[];
    };
    assert.equal(sent.type, "analyse");
    assert.equal(sent.sampleRate, rate);
    assert.equal(sent.channels.length, 1);
    assert.deepEqual(worker.messages[0].transfer, sent.channels);
    worker.emit({ type: "progress", fraction: 0.5 });
    worker.emit({ type: "progress", fraction: -1 });
    worker.emit({ type: "progress", fraction: 0.2 });
    const result = hostResult();
    worker.emit({ type: "result", result });
    const received = await pending;
    assert.deepEqual(received, result);
    assert.notEqual(received.beats, result.beats);
    assert.equal(progress.at(-1), 1);
    assert(
      progress.every(
        (value, index) =>
          value >= 0 && value <= 1 && (!index || value > progress[index - 1]),
      ),
    );
    assert.equal(worker.terminated, 1);
    assert.deepEqual(environment.revoked, environment.created);
    assert.equal(worker.onmessage, null);
  } finally {
    environment.restore();
  }
});

test("abort before start or during decode ignores late decoding without creating a worker", async () => {
  const decode = deferred<unknown>();
  const environment = hostEnvironment({ decode: decode.promise });
  try {
    const before = new AbortController();
    before.abort();
    await assert.rejects(
      analyseSongRhythm(environment.file, { signal: before.signal }),
      { name: "AbortError" },
    );
    assert.equal(environment.contexts.length, 0);
    const controller = new AbortController();
    const pending = analyseSongRhythm(environment.file, {
      signal: controller.signal,
    });
    const rejected = assert.rejects(pending, { name: "AbortError" });
    await setImmediate();
    assert.equal(environment.contexts.length, 1);
    controller.abort();
    await rejected;
    decode.resolve(environment.decoded);
    await setImmediate();
    assert.equal(environment.workers.length, 0);
    assert.equal(environment.created.length, 0);
  } finally {
    environment.restore();
  }
});

test("abort after decoding terminates the worker and late worker messages cannot publish a result", async () => {
  const environment = hostEnvironment();
  const progress: number[] = [];
  try {
    const controller = new AbortController();
    const pending = analyseSongRhythm(environment.file, {
      signal: controller.signal,
      onProgress: (value) => progress.push(value),
    });
    const rejected = assert.rejects(pending, { name: "AbortError" });
    const worker = await workerReady(environment);
    const oldHandler = worker.onmessage!;
    controller.abort();
    await rejected;
    const afterAbort = [...progress];
    oldHandler({ data: { type: "progress", fraction: 1 } });
    oldHandler({ data: { type: "result", result: hostResult() } });
    assert.deepEqual(progress, afterAbort);
    assert.equal(worker.terminated, 1);
    assert.deepEqual(environment.revoked, environment.created);
  } finally {
    environment.restore();
  }
});

test("aborting inside a progress callback cannot leak a subsequently created worker", async () => {
  const environment = hostEnvironment();
  try {
    const controller = new AbortController();
    await assert.rejects(
      analyseSongRhythm(environment.file, {
        signal: controller.signal,
        onProgress: (value) => {
          if (value >= 0.2) controller.abort();
        },
      }),
      { name: "AbortError" },
    );
    await setImmediate();
    assert.equal(environment.workers.length, 0);
    assert.equal(environment.created.length, 0);
  } finally {
    environment.restore();
  }
});

test("service rejects invalid results and oversized files before retaining resources", async () => {
  const environment = hostEnvironment();
  try {
    await assert.rejects(
      analyseSongRhythm({
        ...environment.file,
        size: MAX_ANALYSIS_FILE_BYTES + 1,
      } as File),
      /100 MB/,
    );
    assert.equal(environment.contexts.length, 0);
    const pending = analyseSongRhythm(environment.file);
    const rejected = assert.rejects(pending, /result was invalid/);
    const worker = await workerReady(environment);
    worker.emit({ type: "result", result: { ...hostResult(), duration: 6 } });
    await rejected;
    assert.equal(worker.terminated, 1);
    assert.deepEqual(environment.revoked, environment.created);
  } finally {
    environment.restore();
  }
});
