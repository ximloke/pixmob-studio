import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { SongPlaybackClock, songClockSource } from "../src/lib/songClock.ts";
import { SongCueTimeline, SongCueOutput } from "../src/lib/songShow.ts";
import { initialLighting } from "../src/lib/effects.ts";

for (const sampleRate of [44100, 48000]) {
  test(`silent song clock posts a stable 20 ms heartbeat at ${sampleRate} Hz`, () => {
    let Processor: any;
    const ticks: number[] = [];
    let end = 0;
    class AudioWorkletProcessor {
      port = {
        postMessage: (value: unknown) => {
          assert.equal(value, "tick");
          ticks.push(end);
        },
      };
    }
    const scope = vm.createContext({
      sampleRate,
      AudioWorkletProcessor,
      registerProcessor: (name: string, implementation: any) => {
        assert.equal(name, "pixmob-song-clock");
        Processor = implementation;
      },
    });
    new vm.Script(songClockSource).runInContext(scope);
    const processor = new Processor();
    for (let offset = 0; offset < sampleRate * 2; offset += 128) {
      end = (offset + 128) / sampleRate;
      const channel = new Float32Array(128).fill(0.5);
      assert.equal(processor.process([], [[channel]]), true);
      assert(
        channel.every((value) => value === 0),
        "clock must not duplicate audible music",
      );
    }
    assert.equal(ticks.length, 100);
    for (let index = 0; index < ticks.length; index++)
      assert(Math.abs(ticks[index] - (index + 1) * 0.02) <= 128 / sampleRate);
  });
}

function environment(
  addModule?: (index: number) => Promise<void>,
  unavailable = false,
) {
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const install = (key: string, value: unknown) => {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  };
  const contexts: Context[] = [],
    nodes: Node[] = [],
    revoked: string[] = [];
  const intervals = new Set<() => void>();
  class Context {
    state = "suspended";
    destination = {};
    closes = 0;
    audioWorklet: { addModule: () => Promise<void> } | undefined;
    constructor() {
      const index = contexts.length;
      contexts.push(this);
      if (!unavailable)
        this.audioWorklet = {
          addModule: () => addModule?.(index) ?? Promise.resolve(),
        };
    }
    async resume() {
      this.state = "running";
    }
    async close() {
      this.closes++;
      this.state = "closed";
    }
  }
  class Node {
    disconnected = false;
    connections: unknown[] = [];
    port = {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      closed: false,
      close() {
        this.closed = true;
      },
    };
    constructor(
      readonly context: Context,
      name: string,
      options: unknown,
    ) {
      assert.equal(name, "pixmob-song-clock");
      assert.deepEqual(options, {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      nodes.push(this);
    }
    connect(target: unknown) {
      this.connections.push(target);
    }
    disconnect() {
      this.disconnected = true;
    }
    tick() {
      this.port.onmessage?.({ data: "tick" });
    }
  }
  install("AudioContext", Context);
  install("AudioWorkletNode", Node);
  install("setInterval", (callback: () => void) => {
    intervals.add(callback);
    return callback;
  });
  install("clearInterval", (callback: () => void) =>
    intervals.delete(callback),
  );
  const create = URL.createObjectURL,
    revoke = URL.revokeObjectURL;
  URL.createObjectURL = () => "blob:song-clock";
  URL.revokeObjectURL = (url) => {
    revoked.push(url);
  };
  return {
    contexts,
    nodes,
    revoked,
    intervals,
    restore() {
      URL.createObjectURL = create;
      URL.revokeObjectURL = revoke;
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

test("audio ticks cross real media cue positions with no animation frames", async () => {
  const env = environment(),
    clock = new SongPlaybackClock();
  const calls: string[] = [];
  const output = new SongCueOutput(
    {
      command: async (_op, payload) => {
        calls.push((payload as { color: string }).color);
        return {};
      },
    },
    () => {},
  );
  const timeline = new SongCueTimeline();
  const show = {
    id: "test",
    name: "Background",
    cues: [
      {
        id: "r",
        time: 0.135,
        label: "R",
        lighting: initialLighting,
        hardwareColor: "R" as const,
      },
      {
        id: "g",
        time: 0.35,
        label: "G",
        lighting: initialLighting,
        hardwareColor: "G" as const,
      },
    ],
  };
  let mediaPosition = 0;
  try {
    output.enable();
    timeline.start(0, true);
    assert.equal(
      await clock.start(() => {
        const cue = timeline.advance(show, mediaPosition);
        if (cue?.hardwareColor) void output.send(cue.hardwareColor);
      }),
      "audio",
    );
    assert.equal(
      env.intervals.size,
      0,
      "audio mode must not depend on page timers",
    );
    for (const time of [0.02, 0.14, 0.2, 0.36, 0.4]) {
      mediaPosition = time;
      env.nodes[0].tick();
      await Promise.resolve();
      await Promise.resolve();
    }
    assert.deepEqual(calls, ["R", "G"]);
    const late = env.nodes[0].port.onmessage!;
    clock.stop();
    mediaPosition = 1;
    late({ data: "tick" });
    assert.deepEqual(calls, ["R", "G"]);
    assert.equal(env.contexts[0].closes, 1);
    assert.equal(env.nodes[0].port.closed, true);
    assert.equal(env.nodes[0].disconnected, true);
    assert.deepEqual(env.revoked, ["blob:song-clock"]);
  } finally {
    clock.stop();
    env.restore();
  }
});

test("cancelled module loading cannot revive an old song clock or close a newer one", async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const env = environment((index) =>
    index === 0 ? pending : Promise.resolve(),
  );
  const clock = new SongPlaybackClock();
  let oldTicks = 0,
    newTicks = 0;
  try {
    const oldStart = clock.start(() => oldTicks++);
    const rejected = assert.rejects(oldStart, { name: "AbortError" });
    await Promise.resolve();
    await Promise.resolve();
    clock.stop();
    assert.equal(await clock.start(() => newTicks++), "audio");
    finish();
    await rejected;
    env.nodes[0].tick();
    assert.equal(oldTicks, 0);
    assert.equal(newTicks, 1);
    assert.equal(env.contexts[0].state, "closed");
    assert.equal(env.contexts[1].state, "running");
    assert.equal(env.nodes.length, 1);
  } finally {
    clock.stop();
    env.restore();
  }
});

test("unavailable worklets have an explicit cancellable foreground fallback", async () => {
  const env = environment(undefined, true),
    clock = new SongPlaybackClock();
  let ticks = 0;
  try {
    assert.equal(await clock.start(() => ticks++), "foreground");
    assert.equal(env.contexts[0].state, "closed");
    const callback = [...env.intervals][0];
    callback();
    assert.equal(ticks, 1);
    clock.stop();
    callback();
    assert.equal(ticks, 1);
    assert.equal(env.intervals.size, 0);
  } finally {
    clock.stop();
    env.restore();
  }
});
