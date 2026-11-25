import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { V2SerialTransport, parseV2Status } from "../src/lib/v2Serial.ts";
import type { DeviceAudio, Status } from "../src/lib/device.ts";

const initialStatus = {
  mode: "manual",
  sensitivity: 40,
  rms: 0.25,
  micOk: true,
  clip: false,
  busy: false,
  color: "-",
  frames: 0,
  clients: 1,
};

function serialRig(
  onWrite?: (command: string, emit: (text: string) => void) => void,
) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let closed = false;
  const writes: string[] = [];
  const encoder = new TextEncoder();
  const emit = (text: string) => controller.enqueue(encoder.encode(text));
  const port = {
    readable: new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    }),
    writable: new WritableStream<Uint8Array>({
      write(bytes) {
        const command = new TextDecoder().decode(bytes);
        writes.push(command);
        onWrite?.(command.trim(), emit);
      },
    }),
    async open(options: { baudRate: number }) {
      assert.equal(options.baudRate, 115200);
    },
    async close() {
      closed = true;
    },
  };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    value: { serial: { requestPort: async () => port } },
    configurable: true,
  });
  const restore = () => {
    if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
    else Reflect.deleteProperty(globalThis, "navigator");
  };
  return { writes, emit, port, restore, isClosed: () => closed };
}

function firmware() {
  const state = { ...initialStatus };
  return {
    state,
    write(command: string, emit: (text: string) => void) {
      if (command === "STATUS") {
        emit(JSON.stringify(state) + "\r\n");
        return;
      }
      if (/^[RGBYCMW]$/.test(command)) {
        state.mode = "manual";
        state.color = command;
        state.frames += 3;
      } else if (command === "A" || command === "AUTO ON") state.mode = "auto";
      else if (command === "X" || command === "STOP") state.mode = "manual";
      else if (command === "MIC LEVEL") state.mode = "level";
      else if (command === "MIC BEAT") state.mode = "beat";
      else if (/^SENS (\d+)$/.test(command))
        state.sensitivity = Number(command.slice(5));
      else {
        emit("ERR command\r\n");
        return;
      }
      emit("OK\r\n");
    },
  };
}

async function waitForWrites(writes: string[], count: number) {
  for (let attempt = 0; attempt < 20 && writes.length < count; attempt++)
    await setImmediate();
  assert.equal(writes.length, count);
}

test("V2 STATUS parser requires the complete typed, bounded firmware schema", () => {
  assert.deepEqual(parseV2Status(JSON.stringify(initialStatus)), initialStatus);
  for (const mode of ["manual", "auto", "level", "beat"])
    assert.equal(
      parseV2Status(JSON.stringify({ ...initialStatus, mode }))?.mode,
      mode,
    );
  for (const color of ["-", "R", "G", "B", "Y", "C", "M", "W"])
    assert.equal(
      parseV2Status(JSON.stringify({ ...initialStatus, color }))?.color,
      color,
    );
  assert(
    parseV2Status(JSON.stringify({ ...initialStatus, sensitivity: 1, rms: 0 })),
  );
  assert(
    parseV2Status(
      JSON.stringify({
        ...initialStatus,
        sensitivity: 100,
        rms: 1,
        frames: 4294967295,
        clients: 4294967295,
      }),
    ),
  );
  for (const patch of [
    { mode: "music" },
    { mode: 1 },
    { sensitivity: 0 },
    { sensitivity: 101 },
    { sensitivity: 40.5 },
    { sensitivity: "40" },
    { rms: -0.01 },
    { rms: 1.01 },
    { rms: null },
    { rms: "0.25" },
    { micOk: 1 },
    { clip: "false" },
    { busy: null },
    { color: "Z" },
    { color: "#ff0000" },
    { frames: -1 },
    { frames: 0.5 },
    { frames: 4294967296 },
    { clients: -1 },
    { clients: 1.5 },
    { clients: 4294967296 },
  ])
    assert.equal(
      parseV2Status(JSON.stringify({ ...initialStatus, ...patch })),
      null,
    );
  for (const key of Object.keys(initialStatus)) {
    const value = { ...initialStatus } as Record<string, unknown>;
    delete value[key];
    assert.equal(parseV2Status(JSON.stringify(value)), null, `missing ${key}`);
  }
  for (const line of [
    "OK",
    "PIXMOB STUDIO V2 READY!",
    "Level:100 Threshold:250",
    "null",
    "[]",
    "{}",
    '{"rms":NaN}',
  ])
    assert.equal(parseV2Status(line), null);
});

test("V2 serial confirms fragmented STATUS JSON using only an ASCII STATUS request", async () => {
  const rig = serialRig((command, emit) => {
    assert.equal(command, "STATUS");
    const reply = JSON.stringify(initialStatus);
    emit("PixMob Studio V2: http://192.168.4.1\n" + reply.slice(0, 17));
    emit(reply.slice(17) + "\r\n");
  });
  const device = new V2SerialTransport({ pollIntervalMs: 0 });
  try {
    await device.open();
    const status = await device.status();
    assert.equal(status.mode, "v2-serial");
    assert.equal(status.deviceMode, "manual");
    assert.equal(status.musicSensitivity, 40);
    assert.equal(status.micLevel, 0.25);
    assert.equal(status.irPin, 32);
    assert.deepEqual(status.micPins, { bclk: 26, ws: 25, data: 27 });
    assert.equal(status.rfSupported, false);
    assert.deepEqual(
      rig.writes.map((value) => value.trim()),
      ["STATUS"],
    );
    assert(rig.writes.every((value) => !/[{}]/.test(value)));
  } finally {
    await device.close();
    rig.restore();
  }
  assert(rig.isClosed());
  assert.equal(rig.port.readable.locked, false);
  assert.equal(rig.port.writable.locked, false);
});

test("V2 commands support all seven colors, explicit microphone modes and absolute sensitivity", async () => {
  const board = firmware();
  const rig = serialRig(board.write);
  const device = new V2SerialTransport({ pollIntervalMs: 0 });
  try {
    await device.open();
    await device.status();
    const before = rig.writes.length;
    for (const color of ["R", "G", "B", "Y", "C", "M", "W"])
      await device.command("preset", { color });
    await device.command("auto");
    await device.command("music", { mode: "level" });
    await device.command("music");
    await device.command("sensitivity", { direction: "more" });
    await device.command("sensitivity", { direction: "less" });
    await device.command("stop");
    const expected = [
      "R",
      "G",
      "B",
      "Y",
      "C",
      "M",
      "W",
      "AUTO ON",
      "MIC LEVEL",
      "MIC BEAT",
      "SENS 45",
      "SENS 40",
      "STOP",
    ];
    assert.deepEqual(
      rig.writes.slice(before).map((value) => value.trim()),
      expected.flatMap((command) => [command, "STATUS"]),
    );
    assert.equal(board.state.mode, "manual");
    assert.equal(board.state.sensitivity, 40);
    const count = rig.writes.length;
    for (const [op, payload] of [
      ["preset", { color: "R\nA" }],
      ["preset", { color: "#ff0000" }],
      ["music", { mode: "unknown" }],
      ["sensitivity", { direction: "arbitrary" }],
      ["ir/send", {}],
      ["standalone", { enabled: true }],
      ["SENS 100", undefined],
    ] as const)
      await assert.rejects(device.command(op, payload));
    assert.equal(rig.writes.length, count);
  } finally {
    await device.close();
    rig.restore();
  }
});

test("queued V2 sensitivity changes use the last confirmed value at execution time", async () => {
  const board = firmware();
  const rig = serialRig(board.write);
  const device = new V2SerialTransport({ pollIntervalMs: 0 });
  try {
    await device.open();
    await device.status();
    const before = rig.writes.length;
    await Promise.all([
      device.command("sensitivity", { direction: "more" }),
      device.command("sensitivity", { direction: "more" }),
      device.command("sensitivity", { direction: "less" }),
    ]);
    assert.deepEqual(
      rig.writes.slice(before).map((value) => value.trim()),
      ["SENS 45", "STATUS", "SENS 50", "STATUS", "SENS 45", "STATUS"],
    );
    board.state.sensitivity = 98;
    await device.status();
    await device.command("sensitivity", { direction: "more" });
    assert.equal(board.state.sensitivity, 100);
    board.state.sensitivity = 3;
    await device.status();
    await device.command("sensitivity", { direction: "less" });
    assert.equal(board.state.sensitivity, 1);
  } finally {
    await device.close();
    rig.restore();
  }
});

test("V2 command acknowledgement requires bare OK followed by a fresh status response", async () => {
  let initial = true;
  const rig = serialRig((command, emit) => {
    if (command === "STATUS" && initial) {
      initial = false;
      emit(JSON.stringify(initialStatus) + "\n");
    }
  });
  const device = new V2SerialTransport({
    pollIntervalMs: 0,
    commandTimeoutMs: 1000,
  });
  try {
    await device.open();
    await device.status();
    let settled = false;
    const command = device.command("music", { mode: "beat" }).then((value) => {
      settled = true;
      return value as Status;
    });
    await waitForWrites(rig.writes, 2);
    assert.equal(rig.writes.at(-1)?.trim(), "MIC BEAT");
    rig.emit(
      "OK extra\n" + JSON.stringify({ ...initialStatus, mode: "beat" }) + "\n",
    );
    await setImmediate();
    assert.equal(settled, false);
    assert.equal(
      rig.writes.length,
      2,
      "status cannot substitute for an OK acknowledgement",
    );
    rig.emit("OK\r\n");
    await waitForWrites(rig.writes, 3);
    assert.equal(rig.writes.at(-1)?.trim(), "STATUS");
    assert.equal(
      settled,
      false,
      "bare OK is not enough to claim the new device state",
    );
    rig.emit(JSON.stringify({ ...initialStatus, mode: "beat" }) + "\n");
    const status = await command;
    assert.equal(status.deviceMode, "beat");
  } finally {
    await device.close();
    rig.restore();
  }
});

test("V2 polling and control share one queue, with no stray OK or status matching the wrong phase", async () => {
  let requests = 0;
  const rig = serialRig((command, emit) => {
    if (command === "STATUS" && requests++ === 0)
      emit(JSON.stringify(initialStatus) + "\n");
  });
  const device = new V2SerialTransport({
    pollIntervalMs: 20,
    commandTimeoutMs: 1000,
  });
  try {
    await device.open();
    await device.status();
    await new Promise((resolve) => setTimeout(resolve, 35));
    assert.deepEqual(
      rig.writes.map((value) => value.trim()),
      ["STATUS", "STATUS"],
    );
    const music = device.command("music", { mode: "beat" });
    rig.emit("OK\n");
    await setImmediate();
    assert.equal(
      rig.writes.length,
      2,
      "stray OK cannot satisfy a pending poll",
    );
    rig.emit(JSON.stringify(initialStatus) + "\n");
    await waitForWrites(rig.writes, 3);
    assert.equal(rig.writes.at(-1)?.trim(), "MIC BEAT");
    rig.emit(JSON.stringify({ ...initialStatus, mode: "beat" }) + "\n");
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(
      rig.writes.length,
      3,
      "a poll cannot write STATUS while a command is awaiting OK",
    );
    rig.emit("OK\n");
    await waitForWrites(rig.writes, 4);
    assert.equal(rig.writes.at(-1)?.trim(), "STATUS");
    rig.emit(JSON.stringify({ ...initialStatus, mode: "beat" }) + "\n");
    await music;
  } finally {
    await device.close();
    rig.restore();
  }
});

test("V2 RMS telemetry remains normalized and never invents beats from frame/color changes", async () => {
  const board = firmware();
  const rig = serialRig(board.write);
  const device = new V2SerialTransport({ pollIntervalMs: 0 });
  const originalNow = Date.now;
  try {
    await device.open();
    const samples: DeviceAudio[] = [];
    device.subscribeAudio((sample) => samples.push(sample));
    await device.status();
    board.state.mode = "beat";
    board.state.color = "G";
    board.state.frames = 7;
    board.state.rms = 0.75;
    const current = await device.status();
    assert.equal(current.lastColor, "G");
    assert.equal(samples.at(-1)?.level, 0.75);
    assert.equal(
      samples.at(-1)?.rawLevel,
      0.75,
      "normalized RMS is not relabeled as an ADC raw count",
    );
    assert(
      samples.every(
        (sample) =>
          sample.format === "rms-normalized" && sample.beat === undefined,
      ),
    );
    assert(
      samples.every((sample) => !("bpm" in sample) && !("bins" in sample)),
    );
    const count = samples.length;
    board.state.micOk = false;
    const unavailable = await device.status();
    assert.equal(unavailable.micAvailable, false);
    assert.equal(unavailable.micLevel, 0);
    assert.equal(
      samples.length,
      count,
      "a stale hardware RMS value does not become a new audio sample",
    );
    board.state.micOk = true;
    await device.status();
    const now = originalNow();
    Date.now = () => now + 2001;
    let replayed = 0;
    const unsubscribe = device.subscribeAudio(() => replayed++);
    assert.equal(replayed, 0);
    unsubscribe();
  } finally {
    Date.now = originalNow;
    await device.close();
    rig.restore();
  }
});

test("V2 preset dispatch does not optimistically claim an asynchronously completed IR color", async () => {
  const board = firmware();
  const rig = serialRig((command, emit) => {
    if (command === "R") {
      board.state.mode = "manual";
      board.state.busy = true;
      emit("OK\n");
    } else board.write(command, emit);
  });
  const device = new V2SerialTransport({ pollIntervalMs: 0 });
  try {
    await device.open();
    await device.status();
    const accepted = (await device.command("preset", { color: "R" })) as Status;
    assert.equal(
      accepted.lastColor,
      undefined,
      "OK confirms dispatch, not a completed IR transmission",
    );
    assert.equal(accepted.irTransmitting, true);
    board.state.busy = false;
    board.state.color = "R";
    board.state.frames = 1;
    const completed = await device.status();
    assert.equal(completed.lastColor, "R");
    assert.equal(completed.irTransmitting, false);
  } finally {
    await device.close();
    rig.restore();
  }
});

test("old character firmware, bare OK and foreign JSON cannot confirm V2 STATUS", async () => {
  const rig = serialRig((_command, emit) =>
    emit(
      "PIXMOB STUDIO V2 READY!\nAUTO / MUSIC STOPPED\nOK\nLevel:100 Threshold:250\n" +
        JSON.stringify({
          name: "PixMob Studio ESP32",
          firmware: "1.1.0",
          irConfigured: false,
          rfSupported: false,
          micAvailable: true,
        }) +
        "\n" +
        JSON.stringify({ ...initialStatus, id: 1 }) +
        "\n",
    ),
  );
  const device = new V2SerialTransport({
    pollIntervalMs: 0,
    handshakeTimeoutMs: 80,
    handshakeRetryMs: 20,
  });
  try {
    await device.open();
    await assert.rejects(device.status(), /status|protocol|firmware|respond/i);
    assert.deepEqual(
      rig.writes.map((value) => value.trim()),
      ["STATUS", "STATUS"],
    );
    await assert.rejects(device.command("preset", { color: "R" }));
    assert.equal(rig.writes.length, 2);
  } finally {
    await device.close();
    rig.restore();
  }
});

test("V2 may retry a lost initial STATUS but a later firmware reboot invalidates the session", async () => {
  let requests = 0;
  const rig = serialRig((command, emit) => {
    assert.equal(command, "STATUS");
    if (++requests === 2) emit(JSON.stringify(initialStatus) + "\n");
  });
  const device = new V2SerialTransport({
    pollIntervalMs: 0,
    handshakeTimeoutMs: 100,
    handshakeRetryMs: 20,
  });
  try {
    await device.open();
    await device.status();
    assert.deepEqual(
      rig.writes.map((value) => value.trim()),
      ["STATUS", "STATUS"],
    );
    rig.emit(
      "PixMob Studio V2: http://192.168.4.1 | Wi-Fi PixMob-Studio-V2 / pixmob2026\n",
    );
    await setImmediate();
    await assert.rejects(device.status(), /restart|reconnect/i);
    await assert.rejects(
      device.command("preset", { color: "R" }),
      /restart|reconnect/i,
    );
    assert.equal(rig.writes.length, 2);
  } finally {
    await device.close();
    rig.restore();
  }
});

test("V2 command timeout faults queued controls without retrying lighting instructions", async () => {
  const rig = serialRig((command, emit) => {
    if (command === "STATUS") emit(JSON.stringify(initialStatus) + "\n");
  });
  const device = new V2SerialTransport({
    pollIntervalMs: 0,
    commandTimeoutMs: 40,
  });
  try {
    await device.open();
    await device.status();
    const timeout = assert.rejects(
      device.command("auto"),
      /timed out|timeout/i,
    );
    const queued = assert.rejects(device.command("preset", { color: "G" }));
    await Promise.all([timeout, queued]);
    assert.deepEqual(
      rig.writes.map((value) => value.trim()),
      ["STATUS", "AUTO ON"],
    );
    await assert.rejects(device.status());
    await assert.rejects(device.command("music"));
    assert.equal(rig.writes.length, 2);
  } finally {
    await device.close();
    rig.restore();
  }
});

test("V2 disconnect rejects pending work, stops polling and releases serial locks", async () => {
  const rig = serialRig((command, emit) => {
    if (command === "STATUS") emit(JSON.stringify(initialStatus) + "\n");
  });
  const device = new V2SerialTransport({ pollIntervalMs: 20 });
  try {
    await device.open();
    await device.status();
    const pending = assert.rejects(
      device.command("music"),
      /disconnect|closed/i,
    );
    await waitForWrites(rig.writes, 2);
    await device.close();
    await pending;
    const count = rig.writes.length;
    await new Promise((resolve) => setTimeout(resolve, 35));
    assert.equal(rig.writes.length, count);
    assert(rig.isClosed());
    assert.equal(rig.port.readable.locked, false);
    assert.equal(rig.port.writable.locked, false);
    await assert.rejects(device.status(), /disconnect|closed/i);
  } finally {
    await device.close();
    rig.restore();
  }
});
