import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import {
  initialLighting,
  effects,
  sampleEffect,
  hexRGB,
  rgbHex,
  validLighting,
} from "../src/lib/effects.ts";
import { BeatTracker, AudioEngine, demoAudio } from "../src/lib/audio.ts";
import {
  HttpTransport,
  SerialTransport,
  validateIR,
  type IRConfig,
} from "../src/lib/device.ts";

test("effects are deterministic, bounded, and respect zero brightness", () => {
  for (const effect of effects) {
    for (let t = 0; t < 5; t += 0.037) {
      const state = { ...initialLighting, effect };
      const v = sampleEffect(state, t);
      assert.deepEqual(v, sampleEffect(state, t));
      assert(v.intensity >= 0 && v.intensity <= 0.8);
      assert.equal(sampleEffect({ ...state, brightness: 0 }, t).intensity, 0);
    }
  }
  assert.equal(
    sampleEffect({ ...initialLighting, effect: "Strobe", speed: 100 }, 0)
      .intensity,
    0.8,
  );
  assert.equal(
    sampleEffect({ ...initialLighting, effect: "Strobe", speed: 100 }, 1 / 6)
      .intensity,
    0.016,
  );
  assert.notEqual(
    sampleEffect({ ...initialLighting, effect: "Rainbow" }, 0).color,
    sampleEffect({ ...initialLighting, effect: "Rainbow" }, 1).color,
  );
  assert(
    sampleEffect({ ...initialLighting, musicSync: true }, 0, 0.2).intensity <
      sampleEffect(initialLighting, 0).intensity,
  );
});
test("RGB/HEX round trips and stored scene validation reject malformed data", () => {
  assert.deepEqual(hexRGB("#b8fa5a"), [184, 250, 90]);
  assert.equal(rgbHex([184, 250, 90]), "#b8fa5a");
  assert.equal(rgbHex([-1, 300, 2.4]), "#00ff02");
  assert(validLighting(initialLighting));
  for (const patch of [
    { color: "#bad" },
    { effect: "Unknown" },
    { brightness: NaN },
    { speed: 101 },
    { profile: "Unknown" },
    { musicSync: "true" },
  ])
    assert.equal(validLighting({ ...initialLighting, ...patch }), false);
});
test("demo audio has explicit 120 BPM and a bounded spectrum", () => {
  const frame = demoAudio(7.12);
  assert.equal(frame.bpm, 120);
  assert.equal(frame.bins.length, 64);
  assert(frame.bins.every((v) => v >= 0 && v <= 1));
  assert(frame.level >= 0 && frame.level <= 1);
});
test("beat tracking estimates 120 BPM from repeated onsets and forgets stale tempo", () => {
  const tracker = new BeatTracker();
  let result;
  for (let t = 0; t <= 3500; t += 20) {
    const onset = t % 500 === 0;
    result = tracker.process(onset ? 0.9 : 0.03, onset ? 0.7 : 0.04, t, 60);
    if (t === 3000) assert.equal(result.bpm, 120);
  }
  assert.equal(result!.bpm, 120);
  assert.equal(tracker.process(0, 0, 7000, 60).bpm, null);
  assert.equal(tracker.process(0.9, 0.7, 8000, 60).bpm, null);
});
test("sustained bass is not repeatedly counted as musical beats", () => {
  const tracker = new BeatTracker();
  let beats = 0;
  for (let t = 0; t < 3000; t += 20)
    if (tracker.process(0.8, 0.7, t, 100).beat) beats++;
  assert.equal(beats, 1);
});
test("drop detection needs a quiet build-up and has a cooldown", () => {
  const tracker = new BeatTracker();
  assert.equal(tracker.process(0.8, 0.7, 0, 60).drop, false);
  tracker.process(0, 0.02, 100, 60);
  assert.equal(tracker.process(0.9, 0.7, 1500, 60).drop, true);
  tracker.process(0, 0.01, 1600, 60);
  assert.equal(tracker.process(0.9, 0.7, 3000, 60).drop, false);
  tracker.process(0, 0.01, 3100, 60);
  assert.equal(tracker.process(0.9, 0.7, 6000, 60).drop, true);
});
const waveform: IRConfig = {
  carrierHz: 38000,
  dutyPercent: 33,
  repeats: 1,
  gapUs: 10000,
  markFirst: true,
  durations: [500, 500, 500],
};
test("IR validation permits explicit bounded timing but rejects malformed and excessive waveforms", () => {
  assert.doesNotThrow(() => validateIR(waveform));
  for (const patch of [
    { carrierHz: 0 },
    { carrierHz: NaN },
    { dutyPercent: 51 },
    { repeats: 1.5 },
    { gapUs: 0 },
    { markFirst: false },
    { durations: [] },
    { durations: [0] },
    { durations: Array(11).fill(20000) },
    { durations: Array(513).fill(10) },
  ])
    assert.throws(() => validateIR({ ...waveform, ...patch }));
  assert.throws(() => validateIR(null as unknown as IRConfig));
});
const status = {
  name: "PixMob Studio ESP32",
  firmware: "1.0.0",
  irConfigured: false,
  rfSupported: false,
  micAvailable: true,
};
test("HTTP transport uses API payloads and rejects errors and incomplete status", async () => {
  const original = globalThis.fetch;
  try {
    let requested = "";
    let options: RequestInit | undefined;
    globalThis.fetch = async (url, init) => {
      requested = String(url);
      options = init;
      return new Response(JSON.stringify(status));
    };
    const device = new HttpTransport("http://192.168.4.1");
    assert.deepEqual(await device.status(), status);
    assert.equal(requested, "http://192.168.4.1/api/status");
    assert.equal(options?.method, "GET");
    await device.command("ir/config", waveform);
    assert.equal(options?.method, "POST");
    assert.equal(options?.body, JSON.stringify(waveform));
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: "No waveform configured" }), {
        status: 400,
      });
    await assert.rejects(device.command("ir/send", {}), /No waveform/);
    globalThis.fetch = async () => new Response("{}");
    await assert.rejects(device.status(), /does not speak/);
    globalThis.fetch = async () => new Response("not JSON");
    await assert.rejects(device.status(), /invalid JSON/);
    await assert.rejects(
      device.command("../outside"),
      /Invalid device operation/,
    );
    assert.throws(() => new HttpTransport("file:///tmp/device"));
    assert.throws(() => new HttpTransport("http://user:password@192.168.4.1"));
  } finally {
    globalThis.fetch = original;
  }
});
test("HTTP disconnect aborts an outstanding request", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, options) =>
      new Promise((_resolve, reject) =>
        options!.signal!.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        ),
      );
    const device = new HttpTransport("http://192.168.4.1");
    const pending = device.status();
    await device.close();
    await assert.rejects(pending, { name: "AbortError" });
  } finally {
    globalThis.fetch = original;
  }
});
function installNavigator(value: unknown) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value, configurable: true });
  return () => {
    if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
    else Reflect.deleteProperty(globalThis, "navigator");
  };
}
test("Serial transport reconstructs fragmented responses, ignores boot logs, and closes pending requests", async () => {
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let closed = false;
  let reply = true;
  const encoder = new TextEncoder();
  const port = {
    readable: new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    }),
    writable: new WritableStream<Uint8Array>({
      write(bytes) {
        const cmd = JSON.parse(new TextDecoder().decode(bytes));
        if (reply) {
          const response = JSON.stringify({ ...status, id: cmd.id }) + "\n";
          controller.enqueue(
            encoder.encode("boot log\n" + response.slice(0, 14)),
          );
          controller.enqueue(encoder.encode(response.slice(14)));
        }
      },
    }),
    async open() {},
    async close() {
      closed = true;
    },
  };
  const restore = installNavigator({
    serial: {
      async requestPort() {
        return port;
      },
    },
  });
  try {
    const device = new SerialTransport();
    await device.open();
    assert.deepEqual(await device.status(), { ...status, id: 1 });
    reply = false;
    const pending = device.command("status");
    const rejection = assert.rejects(pending, /connection closed/);
    await device.close();
    await rejection;
    assert(closed);
    await assert.rejects(device.command("status"), /disconnected/);
  } finally {
    restore();
  }
});
test("audio capture cancelled during the permission prompt stops the late stream", async () => {
  let resolveCapture!: (v: MediaStream) => void;
  let stopped = 0;
  const stream = {
    getTracks: () => [
      {
        stop() {
          stopped++;
        },
      },
    ],
    getAudioTracks: () => [{}],
  } as unknown as MediaStream;
  const restore = installNavigator({
    mediaDevices: {
      getUserMedia: () =>
        new Promise<MediaStream>((resolve) => {
          resolveCapture = resolve;
        }),
    },
  });
  try {
    const engine = new AudioEngine();
    const starting = engine.start("microphone", () => {});
    const rejection = assert.rejects(starting, { name: "AbortError" });
    await setImmediate();
    await engine.stop();
    resolveCapture(stream);
    await rejection;
    assert.equal(stopped, 1);
  } finally {
    restore();
  }
});
test("audio sharing without an audio track stops all captured tracks", async () => {
  let stopped = 0;
  const restore = installNavigator({
    mediaDevices: {
      getDisplayMedia: async () => ({
        getAudioTracks: () => [],
        getTracks: () => [
          {
            stop() {
              stopped++;
            },
          },
        ],
      }),
    },
  });
  try {
    await assert.rejects(
      new AudioEngine().start("system", () => {}),
      /No audio was shared/,
    );
    assert.equal(stopped, 1);
  } finally {
    restore();
  }
});

test("demo arrangement includes a quiet passage, drop, and adjustable sensitivity", () => {
  assert(demoAudio(19).level < 0.1);
  assert.equal(demoAudio(19).beat, false);
  assert.equal(demoAudio(20.1).drop, true);
  assert.equal(demoAudio(21).drop, false);
  assert(demoAudio(2, 20).level < demoAudio(2, 80).level);
});

test("Serial microphone-test telemetry connects read-only and expires stale samples", async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const writes: string[] = [];
  const encoder = new TextEncoder();
  const originalNow = Date.now;
  let now = 10000;
  Date.now = () => now;
  const port = {
    readable: new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    }),
    writable: new WritableStream<Uint8Array>({
      write(bytes) {
        writes.push(new TextDecoder().decode(bytes));
      },
    }),
    async open() {},
    async close() {},
  };
  const restore = installNavigator({
    serial: { requestPort: async () => port },
  });
  const device = new SerialTransport();
  try {
    await device.open();
    const samples: number[] = [];
    const unsubscribe = device.subscribeAudio((sample) => {
      samples.push(sample.rawLevel);
      assert.equal(sample.level, sample.rawLevel / 32768);
      assert.equal(sample.receivedAt, 10000);
      assert.equal(sample.format, "mean-absolute-16-bit");
    });
    const connecting = device.status();
    controller.enqueue(
      encoder.encode(
        "PixMob Microphone Test\r\nSound Level: -1\nSound Level: 1.5\nSound Level: 32769\nSound Lev",
      ),
    );
    controller.enqueue(encoder.encode("el: 16384\r\n"));
    const connected = await connecting;
    assert.deepEqual(samples, [16384]);
    assert.equal(connected.mode, "microphone-test");
    assert.equal(connected.name, "ESP32 microphone test");
    assert.equal(connected.firmware, "microphone-test (unversioned)");
    assert.equal(connected.micLevel, 0.5);
    assert.equal(connected.micRawLevel, 16384);
    assert.equal(connected.micAvailable, true);
    assert.equal(connected.irConfigured, false);
    assert.equal(connected.rfSupported, false);
    assert.equal(writes.length, 1);
    await device.status();
    for (const op of ["ir/config", "ir/send", "standalone", "ir/stop"])
      await assert.rejects(device.command(op, {}), /read-only/);
    assert.equal(writes.length, 1, "only the initial status probe is written");
    unsubscribe();
    controller.enqueue(encoder.encode("Sound Level: 32768\n"));
    await setImmediate();
    assert.deepEqual(samples, [16384]);
    now += 2001;
    assert.equal((await device.status()).micAvailable, false);
    await device.close();
    await assert.rejects(device.status(), /disconnected/);
  } finally {
    await device.close();
    restore();
    Date.now = originalNow;
  }
});

test("malformed microphone text does not establish a connected device", async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  const port = {
    readable: new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    }),
    writable: new WritableStream<Uint8Array>(),
    async open() {},
    async close() {},
  };
  const restore = installNavigator({
    serial: { requestPort: async () => port },
  });
  const device = new SerialTransport();
  try {
    await device.open();
    let samples = 0;
    device.subscribeAudio(() => samples++);
    const connecting = device.status();
    const rejection = assert.rejects(connecting, /connection closed/);
    controller.enqueue(
      encoder.encode(
        "Sound Level: NaN\nSound Level: Infinity\nSound Level: 32769\nSound Level: -1\nSound Level: 1.2\nother Sound Level: 100\n",
      ),
    );
    await setImmediate();
    assert.equal(samples, 0);
    await device.close();
    await rejection;
  } finally {
    await device.close();
    restore();
  }
});

test("a valid controller status wins over microphone log telemetry", async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  const port = {
    readable: new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    }),
    writable: new WritableStream<Uint8Array>({
      write(bytes) {
        const request = JSON.parse(new TextDecoder().decode(bytes));
        controller.enqueue(
          encoder.encode(
            "Sound Level: 100\n" +
              JSON.stringify({ ...status, id: request.id }) +
              "\n",
          ),
        );
      },
    }),
    async open() {},
    async close() {},
  };
  const restore = installNavigator({
    serial: { requestPort: async () => port },
  });
  const device = new SerialTransport();
  try {
    await device.open();
    assert.deepEqual(await device.status(), { ...status, id: 1 });
    assert.deepEqual(await device.command("ir/stop", {}), { ...status, id: 2 });
  } finally {
    await device.close();
    restore();
  }
});

test("controller RMS telemetry is validated and leaves control commands available", async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  const requests: string[] = [];
  const controllerStatus = {
    ...status,
    mode: "controller",
    micInitialized: true,
    micPins: { bclk: 26, ws: 25, data: 27 },
    irPin: 33,
  };
  const port = {
    readable: new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    }),
    writable: new WritableStream<Uint8Array>({
      write(bytes) {
        const request = JSON.parse(new TextDecoder().decode(bytes));
        requests.push(request.op);
        controller.enqueue(
          encoder.encode(
            JSON.stringify(
              request.op === "status"
                ? { ...controllerStatus, id: request.id }
                : { id: request.id, ok: true },
            ) + "\n",
          ),
        );
      },
    }),
    async open() {},
    async close() {},
  };
  const restore = installNavigator({
      serial: { requestPort: async () => port },
    }),
    device = new SerialTransport();
  try {
    await device.open();
    const received: unknown[] = [];
    device.subscribeAudio((sample) => received.push(sample));
    assert.deepEqual(await device.status(), { ...controllerStatus, id: 1 });
    const invalid = [
      { event: "audio", format: "rms-24-bit", micLevel: 1.1, micRawLevel: 100 },
      {
        event: "audio",
        format: "rms-24-bit",
        micLevel: 0.5,
        micRawLevel: 8388609,
      },
      { event: "audio", format: "rms-24-bit", micLevel: 0.5, micRawLevel: 1.5 },
      {
        event: "audio",
        format: "rms-24-bit",
        micLevel: "0.5",
        micRawLevel: 4194304,
      },
      {
        event: "audio",
        format: "unknown",
        micLevel: 0.5,
        micRawLevel: 4194304,
      },
    ];
    controller.enqueue(
      encoder.encode(
        invalid.map((v) => JSON.stringify(v)).join("\n") +
          "\nSound Level: 100\nLevel:100 Threshold:250 Beat:1\n",
      ),
    );
    const event =
      JSON.stringify({
        event: "audio",
        format: "rms-24-bit",
        micLevel: 0.25,
        micRawLevel: 2097152,
      }) + "\n";
    controller.enqueue(encoder.encode(event.slice(0, 13)));
    controller.enqueue(encoder.encode(event.slice(13)));
    await setImmediate();
    assert.equal(
      received.length,
      1,
      "invalid events and legacy logs are ignored after controller confirmation",
    );
    const sample = received[0] as {
      rawLevel: number;
      level: number;
      format: string;
      receivedAt: number;
    };
    assert.equal(sample.rawLevel, 2097152);
    assert.equal(sample.level, 0.25);
    assert.equal(sample.format, "rms-24-bit");
    assert(Number.isFinite(sample.receivedAt));
    const buffered: unknown[] = [];
    const unsubscribe = device.subscribeAudio((v) => buffered.push(v));
    assert.deepEqual(buffered, received);
    unsubscribe();
    assert.deepEqual(await device.command("ir/stop", {}), { id: 2, ok: true });
    assert.deepEqual(requests, ["status", "ir/stop"]);
  } finally {
    await device.close();
    restore();
  }
});

test("controller audio events alone never establish microphone-test or controller status", async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  const port = {
    readable: new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    }),
    writable: new WritableStream<Uint8Array>(),
    async open() {},
    async close() {},
  };
  const restore = installNavigator({
      serial: { requestPort: async () => port },
    }),
    device = new SerialTransport();
  try {
    await device.open();
    let samples = 0;
    device.subscribeAudio(() => samples++);
    const connecting = device.status();
    const rejection = assert.rejects(connecting, /connection closed/);
    let settled = false;
    void connecting.then(
      () => {
        settled = true;
      },
      () => {},
    );
    controller.enqueue(
      encoder.encode(
        JSON.stringify({
          event: "audio",
          format: "rms-24-bit",
          micLevel: 0.1,
          micRawLevel: 838861,
        }) + "\n",
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.equal(samples, 1);
    assert.equal(
      settled,
      false,
      "RMS telemetry cannot satisfy the JSON status handshake or trigger legacy fallback",
    );
    await device.close();
    await rejection;
  } finally {
    await device.close();
    restore();
  }
});

test("music-sync test telemetry connects read-only with measured threshold and beat fields", async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder(),
    writes: string[] = [];
  const port = {
    readable: new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    }),
    writable: new WritableStream<Uint8Array>({
      write(bytes) {
        writes.push(new TextDecoder().decode(bytes));
      },
    }),
    async open() {},
    async close() {},
  };
  const restore = installNavigator({
      serial: { requestPort: async () => port },
    }),
    device = new SerialTransport();
  try {
    await device.open();
    const received: {
      rawLevel: number;
      level: number;
      threshold?: number;
      beat?: boolean;
      format: string;
      receivedAt: number;
    }[] = [];
    device.subscribeAudio((sample) => received.push(sample));
    const connecting = device.status();
    controller.enqueue(encoder.encode("Level:16384 Threshold:250 Bea"));
    controller.enqueue(encoder.encode("t:1\r\n"));
    const connected = await connecting;
    assert.equal(connected.name, "ESP32 music sync test");
    assert.equal(connected.firmware, "music-sync-test (unversioned)");
    assert.equal(connected.mode, "microphone-test");
    assert.equal(connected.micAvailable, true);
    assert.equal(connected.irConfigured, false);
    assert.equal(connected.rfSupported, false);
    assert.equal(connected.standaloneEnabled, false);
    assert.equal(connected.micLevel, 0.5);
    assert.equal(connected.micRawLevel, 16384);
    assert.equal(received.length, 1);
    assert.equal(received[0].threshold, 250);
    assert.equal(received[0].beat, true);
    assert.equal(received[0].format, "mean-absolute-16-bit");
    assert(Number.isFinite(received[0].receivedAt));
    controller.enqueue(
      encoder.encode(
        "Level:0 Threshold:0 Beat:0\nLevel:32768 Threshold:65535 Beat:1\n",
      ),
    );
    await setImmediate();
    assert.equal(received.length, 3);
    assert.equal(received[1].rawLevel, 0);
    assert.equal(received[1].beat, false);
    assert.equal(received[1].threshold, 0);
    assert.equal(received[2].rawLevel, 32768);
    assert.equal(received[2].level, 1);
    assert.equal(received[2].threshold, 65535);
    await assert.rejects(device.command("ir/send", {}), /read-only/);
    await assert.rejects(
      device.command("standalone", { enabled: true }),
      /read-only/,
    );
    await device.status();
    assert.equal(
      writes.length,
      1,
      "only the initial JSON status probe is written",
    );
  } finally {
    await device.close();
    restore();
  }
});

test("malformed music-sync lines do not publish samples or infer capabilities", async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  const port = {
    readable: new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    }),
    writable: new WritableStream<Uint8Array>(),
    async open() {},
    async close() {},
  };
  const restore = installNavigator({
      serial: { requestPort: async () => port },
    }),
    device = new SerialTransport();
  try {
    await device.open();
    let received = 0;
    device.subscribeAudio(() => received++);
    const connecting = device.status();
    const rejection = assert.rejects(connecting, /connection closed/);
    let settled = false;
    void connecting.then(
      () => {
        settled = true;
      },
      () => {},
    );
    const invalid = [
      "Level:32769 Threshold:250 Beat:1",
      "Level:-1 Threshold:250 Beat:1",
      "Level:1.5 Threshold:250 Beat:1",
      "Level:100 Threshold:65536 Beat:1",
      "Level:100 Threshold:-1 Beat:1",
      "Level:100 Threshold:1.5 Beat:1",
      "Level:100 Threshold:250 Beat:2",
      "Level:100 Threshold:250 Beat:true",
      "Level:100 Threshold:250 Beat:01",
      "Level:100 Threshold:250 Beat:1 extra",
      "Sound Level:100 Threshold:250 Beat:1",
      "Level:NaN Threshold:250 Beat:1",
    ];
    controller.enqueue(encoder.encode(invalid.join("\n") + "\n"));
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.equal(received, 0);
    assert.equal(settled, false);
    await device.close();
    await rejection;
  } finally {
    await device.close();
    restore();
  }
});
