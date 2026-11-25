import test from "node:test";
import assert from "node:assert/strict";
import { AudioEngine, silentFrame } from "../src/lib/audio.ts";
import type { AudioFrame } from "../src/lib/audio.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function audioEnvironment(
  options: {
    worklet?: boolean;
    addModule?: (contextIndex: number) => Promise<void>;
  } = {},
) {
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const install = (name: string, value: unknown) => {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  };
  const tracks = [
    { stops: 0, listeners: new Map<string, Set<() => void>>() },
    { stops: 0, listeners: new Map<string, Set<() => void>>() },
  ].map((state) => ({
    ...state,
    stop() {
      this.stops++;
    },
    addEventListener(kind: string, listener: () => void) {
      if (!this.listeners.has(kind)) this.listeners.set(kind, new Set());
      this.listeners.get(kind)!.add(listener);
    },
    removeEventListener(kind: string, listener: () => void) {
      this.listeners.get(kind)?.delete(listener);
    },
  }));
  const stream = {
    getTracks: () => tracks,
    getAudioTracks: () => [tracks[0]],
  };
  const contexts: MockContext[] = [];
  const clocks: MockClock[] = [];
  const moduleUrls: string[] = [];
  const revoked: string[] = [];
  class MockContext {
    state = "suspended";
    sampleRate = 48000;
    currentTime = 1;
    destination = {};
    closeCount = 0;
    source = {
      connections: [] as unknown[],
      disconnectCount: 0,
      connect(target: unknown) {
        this.connections.push(target);
      },
      disconnect() {
        this.disconnectCount++;
      },
    };
    analyser = {
      fftSize: 2048,
      frequencyBinCount: 1024,
      smoothingTimeConstant: 0,
      reads: 0,
      levelByte: 204,
      getByteFrequencyData(data: Uint8Array) {
        this.reads++;
        data.fill(this.levelByte);
      },
    };
    audioWorklet: { addModule(url: string): Promise<void> } | undefined;
    constructor() {
      const index = contexts.length;
      contexts.push(this);
      if (options.worklet !== false)
        this.audioWorklet = {
          addModule(url) {
            moduleUrls.push(url);
            return options.addModule?.(index) ?? Promise.resolve();
          },
        };
    }
    async resume() {
      this.state = "running";
    }
    async close() {
      this.closeCount++;
      this.state = "closed";
    }
    createAnalyser() {
      return this.analyser;
    }
    createMediaStreamSource() {
      return this.source;
    }
  }
  class MockClock {
    port = {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      posted: [] as unknown[],
      postMessage(value: unknown) {
        this.posted.push(value);
      },
      closeCount: 0,
      close() {
        this.closeCount++;
      },
    };
    connections: unknown[] = [];
    disconnectCount = 0;
    constructor(
      readonly context: MockContext,
      readonly name: string,
      readonly nodeOptions: unknown,
    ) {
      clocks.push(this);
    }
    connect(target: unknown) {
      this.connections.push(target);
    }
    disconnect() {
      this.disconnectCount++;
    }
    emit(value: unknown) {
      this.port.onmessage?.({ data: value });
    }
  }
  install("navigator", {
    mediaDevices: {
      getDisplayMedia: async () => stream,
      getUserMedia: async () => stream,
    },
  });
  install("AudioContext", MockContext);
  install("AudioWorkletNode", MockClock);
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  let nextUrl = 0;
  URL.createObjectURL = () => `blob:audio-clock-${++nextUrl}`;
  URL.revokeObjectURL = (url) => {
    revoked.push(url);
  };
  return {
    contexts,
    clocks,
    tracks,
    moduleUrls,
    revoked,
    restore() {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      for (const [name, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    },
  };
}

test("AudioWorklet spectrum ticks publish visuals without creating control beats", async () => {
  const environment = audioEnvironment();
  const engine = new AudioEngine();
  const frames: AudioFrame[] = [];
  engine.subscribeFrames((frame) => frames.push(frame));
  try {
    await engine.start("system", () => {});
    assert.equal(engine.realtimeAnalysis, true);
    assert.equal(frames.length, 0);
    const context = environment.contexts[0];
    const clock = environment.clocks[0];
    assert.deepEqual(context.source.connections, [context.analyser, clock]);
    assert.deepEqual(clock.connections, [context.destination]);
    assert(!context.source.connections.includes(context.destination));
    assert.deepEqual(environment.revoked, environment.moduleUrls);

    clock.emit("unrelated");
    assert.equal(context.analyser.reads, 0);
    clock.emit({ type: "tick", audioTime: context.currentTime });
    assert.equal(context.analyser.reads, 1);
    assert.equal(frames.length, 1);
    assert(frames[0].level > 0);
    assert.equal(
      frames[0].beat,
      false,
      "a loud FFT frame alone must not flash the device",
    );
  } finally {
    await engine.stop();
    environment.restore();
  }
});

test("a PCM onset notifies immediately and cached view reads cannot steal or replay it", async () => {
  const environment = audioEnvironment();
  const engine = new AudioEngine();
  const frames: AudioFrame[] = [];
  engine.subscribeFrames((frame) => frames.push(frame));
  try {
    await engine.start("system", () => {});
    const context = environment.contexts[0];
    const { analyser } = context;
    const clock = environment.clocks[0];
    clock.emit({
      type: "onset",
      audioTime: context.currentTime,
      level: 0.7,
      strength: 0.8,
    });
    assert.equal(
      frames.length,
      1,
      "physical control receives an onset before the next visual tick",
    );
    assert.equal(frames[0].beat, true);
    assert(
      frames[0].level > 0,
      "the first onset must be usable before a spectrum frame has arrived",
    );
    const readsAfterOnset = analyser.reads;
    assert.equal(engine.read(1000, 0), frames[0]);
    assert.equal(engine.read(1020, 0), frames[0]);
    assert.equal(analyser.reads, readsAfterOnset);
    assert.equal(frames.length, 1);
    assert(
      clock.port.posted.some(
        (value) =>
          typeof value === "object" &&
          value !== null &&
          (value as { type: unknown }).type === "sensitivity" &&
          (value as { value: unknown }).value === 0,
      ),
      "sensitivity updates reach the audio-thread detector",
    );

    clock.emit({ type: "tick", audioTime: context.currentTime });
    assert.equal(analyser.reads, readsAfterOnset + 1);
    assert.equal(frames.length, 2);
    assert.equal(frames[1].beat, false);
  } finally {
    await engine.stop();
    environment.restore();
  }
});

test("stale or malformed onset times cannot send a delayed burst of physical flashes", async () => {
  const environment = audioEnvironment();
  const engine = new AudioEngine();
  const frames: AudioFrame[] = [];
  engine.subscribeFrames((frame) => frames.push(frame));
  try {
    await engine.start("system", () => {});
    const context = environment.contexts[0];
    const clock = environment.clocks[0];
    for (const audioTime of [
      0.8,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      "1",
      undefined,
    ])
      clock.emit({ type: "onset", audioTime, level: 0.7, strength: 0.8 });
    assert.equal(frames.filter((frame) => frame.beat).length, 0);
    clock.emit({
      type: "onset",
      audioTime: context.currentTime - 0.05,
      level: 0.7,
      strength: 0.8,
    });
    assert.equal(
      frames.filter((frame) => frame.beat).length,
      1,
      "a fresh event still reaches device control",
    );
  } finally {
    await engine.stop();
    environment.restore();
  }
});

test("BPM uses sample-derived onset times instead of variable message arrival times", async () => {
  const environment = audioEnvironment();
  const engine = new AudioEngine();
  const frames: AudioFrame[] = [];
  engine.subscribeFrames((frame) => frames.push(frame));
  try {
    await engine.start("system", () => {});
    const context = environment.contexts[0];
    const clock = environment.clocks[0];
    for (let index = 0; index < 8; index++) {
      const audioTime = 1 + index * 0.75;
      context.currentTime = audioTime + (index % 2 === 0 ? 0.08 : 0.001);
      clock.emit({ type: "onset", audioTime, level: 0.7, strength: 0.8 });
    }
    assert.equal(frames.filter((frame) => frame.beat).length, 8);
    assert.equal(frames.at(-1)?.bpm, 80);
  } finally {
    await engine.stop();
    environment.restore();
  }
});

test("stop closes clock/capture and late worklet messages cannot revive analysis", async () => {
  const environment = audioEnvironment();
  const engine = new AudioEngine();
  const frames: AudioFrame[] = [];
  engine.subscribeFrames((frame) => frames.push(frame));
  try {
    await engine.start("system", () => {});
    const context = environment.contexts[0];
    const clock = environment.clocks[0];
    const lateHandler = clock.port.onmessage!;
    clock.emit({ type: "tick", audioTime: context.currentTime });
    assert.equal(frames.length, 1);
    await engine.stop();
    assert.equal(engine.realtimeAnalysis, false);
    assert.equal(clock.port.onmessage, null);
    assert.equal(clock.port.closeCount, 1);
    assert.equal(clock.disconnectCount, 1);
    assert.equal(context.source.disconnectCount, 1);
    assert.equal(context.closeCount, 1);
    assert(environment.tracks.every((track) => track.stops === 1));
    assert(
      environment.tracks.every(
        (track) => track.listeners.get("ended")?.size === 0,
      ),
    );
    lateHandler({ data: { type: "tick", audioTime: context.currentTime } });
    lateHandler({
      data: {
        type: "onset",
        audioTime: context.currentTime,
        level: 0.7,
        strength: 0.8,
      },
    });
    assert.equal(context.analyser.reads, 1);
    assert.equal(frames.length, 1);
    assert.equal(engine.read(2000, 60), silentFrame);
  } finally {
    await engine.stop();
    environment.restore();
  }
});

test("cancelled module loading cannot revive old capture or stop a newer capture", async () => {
  const firstModule = deferred<void>();
  const moduleRequested = deferred<void>();
  const environment = audioEnvironment({
    addModule(index) {
      if (index > 0) return Promise.resolve();
      moduleRequested.resolve();
      return firstModule.promise;
    },
  });
  const engine = new AudioEngine();
  const frames: AudioFrame[] = [];
  engine.subscribeFrames((frame) => frames.push(frame));
  try {
    const oldStarting = engine.start("system", () => {});
    const oldRejection = assert.rejects(oldStarting, { name: "AbortError" });
    await moduleRequested.promise;
    await engine.stop();
    await engine.start("system", () => {});
    assert.equal(environment.contexts.length, 2);
    assert.equal(environment.clocks.length, 1);
    assert.equal(engine.realtimeAnalysis, true);
    firstModule.resolve();
    await oldRejection;
    assert.equal(environment.contexts[0].state, "closed");
    assert.equal(environment.contexts[1].state, "running");
    assert.equal(engine.realtimeAnalysis, true);
    assert.equal(environment.clocks.length, 1);
    assert.deepEqual(environment.revoked.sort(), environment.moduleUrls.sort());
    environment.clocks[0].emit({
      type: "tick",
      audioTime: environment.contexts[1].currentTime,
    });
    assert.equal(frames.length, 1);
  } finally {
    firstModule.resolve();
    await engine.stop();
    environment.restore();
  }
});

test("without AudioWorklet, explicit measured reads publish frames and unsubscribe works", async () => {
  const environment = audioEnvironment({ worklet: false });
  const engine = new AudioEngine();
  const frames: AudioFrame[] = [];
  const unsubscribe = engine.subscribeFrames((frame) => frames.push(frame));
  try {
    await engine.start("system", () => {});
    assert.equal(engine.realtimeAnalysis, false);
    assert.equal(environment.clocks.length, 0);
    assert.deepEqual(environment.moduleUrls, []);
    assert.equal(frames.length, 0);
    const first = engine.read(1000, 60);
    assert.equal(frames.length, 1);
    assert.equal(first, frames[0]);
    assert(first.level > 0);
    environment.contexts[0].analyser.levelByte = 0;
    const paused = engine.read(1040, 60);
    assert.equal(paused.level, 0);
    assert.equal(paused.beat, false);
    unsubscribe();
    engine.read(1080, 60);
    assert.equal(frames.length, 2);
  } finally {
    await engine.stop();
    environment.restore();
  }
});

test("unavailable worklet module falls back to measured reads and releases its URL", async () => {
  const environment = audioEnvironment({
    addModule: async () => {
      throw new Error("AudioWorklet unavailable");
    },
  });
  const engine = new AudioEngine();
  const frames: AudioFrame[] = [];
  engine.subscribeFrames((frame) => frames.push(frame));
  try {
    await engine.start("system", () => {});
    assert.equal(engine.realtimeAnalysis, false);
    assert.deepEqual(environment.revoked, environment.moduleUrls);
    engine.read(1000, 60);
    assert.equal(frames.length, 1);
    assert(frames[0].level > 0);
  } finally {
    await engine.stop();
    environment.restore();
  }
});

test("automatic sensitivity is enabled by default and mode changes update the running processor once", async () => {
  const environment = audioEnvironment();
  const engine = new AudioEngine();
  try {
    await engine.start("system", () => {});
    const clock = environment.clocks[0];
    assert.deepEqual(clock.port.posted, [
      { type: "sensitivity", value: 60 },
      { type: "autoSensitivity", enabled: true },
    ]);
    engine.read(1000, 45, false);
    engine.read(1020, 45, false);
    assert.deepEqual(clock.port.posted.slice(2), [
      { type: "sensitivity", value: 45 },
      { type: "autoSensitivity", enabled: false },
    ]);
    engine.read(1040, 45, true);
    engine.read(1060, 45, true);
    assert.deepEqual(clock.port.posted.at(-1), {
      type: "autoSensitivity",
      enabled: true,
    });
    assert.equal(clock.port.posted.length, 5);
    assert.equal(environment.contexts.length, 1);
    assert.equal(environment.clocks.length, 1);
    assert.equal(environment.contexts[0].closeCount, 0);
    assert(environment.tracks.every((track) => track.stops === 0));
  } finally {
    await engine.stop();
    environment.restore();
  }
});

test("processor automatic metadata is bounded and never turns a spectrum tick into a beat", async () => {
  const environment = audioEnvironment();
  const engine = new AudioEngine();
  const frames: AudioFrame[] = [];
  engine.subscribeFrames((frame) => frames.push(frame));
  try {
    await engine.start("system", () => {});
    const context = environment.contexts[0];
    const clock = environment.clocks[0];
    clock.emit({
      type: "tick",
      audioTime: context.currentTime,
      automatic: true,
      effectiveSensitivity: 73.5,
      tempoConfidence: 0.82,
    });
    assert.equal(frames.at(-1)?.automaticSensitivity, true);
    assert.equal(frames.at(-1)?.effectiveSensitivity, 73.5);
    assert.equal(frames.at(-1)?.tempoConfidence, 0.82);
    assert.equal(frames.at(-1)?.beat, false);
    for (const value of [NaN, Infinity, -1, 101, "75"]) {
      clock.emit({
        type: "tick",
        audioTime: context.currentTime,
        automatic: true,
        effectiveSensitivity: value,
        tempoConfidence: value,
      });
      assert.equal(frames.at(-1)?.effectiveSensitivity, undefined);
      assert.equal(frames.at(-1)?.tempoConfidence, undefined);
      assert.equal(frames.at(-1)?.beat, false);
    }
    clock.emit({
      type: "onset",
      audioTime: context.currentTime,
      level: 0.5,
      strength: 0.6,
      automatic: true,
      effectiveSensitivity: 86,
      tempoConfidence: 0.95,
    });
    assert.equal(frames.at(-1)?.automaticSensitivity, true);
    assert.equal(frames.at(-1)?.effectiveSensitivity, 86);
    assert.equal(frames.at(-1)?.tempoConfidence, 0.95);
    assert.equal(frames.filter((frame) => frame.beat).length, 1);
  } finally {
    await engine.stop();
    environment.restore();
  }
});

test("a queued automatic report cannot confirm manual mode after a toggle", async () => {
  const environment = audioEnvironment();
  const engine = new AudioEngine();
  const frames: AudioFrame[] = [];
  engine.subscribeFrames((frame) => frames.push(frame));
  try {
    await engine.start("system", () => {});
    const clock = environment.clocks[0];
    const time = environment.contexts[0].currentTime;
    clock.emit({
      type: "tick",
      audioTime: time,
      automatic: true,
      effectiveSensitivity: 90,
      tempoConfidence: 0.8,
    });
    engine.read(1000, 45, false);
    clock.emit({
      type: "tick",
      audioTime: time,
      automatic: true,
      effectiveSensitivity: 95,
      tempoConfidence: 0.9,
    });
    assert.notEqual(frames.at(-1)?.automaticSensitivity, true);
    assert.notEqual(frames.at(-1)?.effectiveSensitivity, 95);
    assert.equal(frames.at(-1)?.tempoConfidence, undefined);
    clock.emit({
      type: "tick",
      audioTime: time,
      automatic: false,
      effectiveSensitivity: 45,
      tempoConfidence: 0,
    });
    assert.equal(frames.at(-1)?.automaticSensitivity, false);
    assert.equal(frames.at(-1)?.effectiveSensitivity, 45);
    const oldHandler = clock.port.onmessage!;
    const frameCount = frames.length;
    await engine.stop();
    oldHandler({
      data: {
        type: "tick",
        audioTime: time,
        automatic: true,
        effectiveSensitivity: 100,
        tempoConfidence: 1,
      },
    });
    assert.equal(frames.length, frameCount);
    assert.equal(engine.read(2000, 45, false), silentFrame);
    assert.equal(frames.at(-1)?.automaticSensitivity, undefined);
  } finally {
    await engine.stop();
    environment.restore();
  }
});

test("settings selected before capture survive startup and fallback never claims automatic analysis", async () => {
  const environment = audioEnvironment();
  const engine = new AudioEngine();
  const frames: AudioFrame[] = [];
  engine.subscribeFrames((frame) => frames.push(frame));
  try {
    engine.configureAnalysis(45, false);
    assert.equal(
      frames.length,
      0,
      "configuration cannot publish control frames",
    );
    await engine.start("system", () => {});
    assert.deepEqual(environment.clocks[0].port.posted, [
      { type: "sensitivity", value: 45 },
      { type: "autoSensitivity", enabled: false },
    ]);
    engine.configureAnalysis(45, true);
    assert.equal(frames.length, 0);
    assert.equal(environment.contexts[0].analyser.reads, 0);
  } finally {
    await engine.stop();
    environment.restore();
  }
  const fallback = audioEnvironment({ worklet: false });
  const fallbackEngine = new AudioEngine();
  try {
    await fallbackEngine.start("system", () => {});
    const frame = fallbackEngine.read(1000, 45, true);
    assert.equal(frame.automaticSensitivity, false);
    assert.equal(frame.effectiveSensitivity, 45);
    assert.equal(frame.tempoConfidence, undefined);
  } finally {
    await fallbackEngine.stop();
    fallback.restore();
  }
});
