import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import {
  PresetSerialTransport,
  parsePresetLine,
} from "../src/lib/presetSerial.ts";
import type { DeviceAudio, Status } from "../src/lib/device.ts";

function installNavigator(value: unknown) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value, configurable: true });
  return () => {
    if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
    else Reflect.deleteProperty(globalThis, "navigator");
  };
}

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
  const restore = installNavigator({
    serial: { requestPort: async () => port },
  });
  return { writes, emit, port, restore, isClosed: () => closed };
}

function acknowledge(command: string, emit: (text: string) => void) {
  if (command === "X") emit("AUTO / MUSIC STOPPED\r\n");
  else if (command === "A") emit("AUTO MODE ON\r\n");
  else if (command === "M") emit("MUSIC SYNC ON\r\n");
  else if (/^[RGBYCW]$/.test(command)) emit(`Color sent: ${command}\r\n`);
  else if (command === "+") emit("Sensitivity: 1.25\r\n");
  else if (command === "-") emit("Sensitivity: 1.35\r\n");
}

async function waitForWrites(writes: string[], count: number) {
  for (let attempt = 0; attempt < 20 && writes.length < count; attempt++)
    await setImmediate();
  assert.equal(writes.length, count);
}

test("bass controller identity and audio format require exact metadata lines", () => {
  assert.deepEqual(parsePresetLine("PIXMOB BEAT CONTROLLER READY!"), {
    type: "ready",
    variant: "bass",
  });
  assert.deepEqual(parsePresetLine("PIXMOB BEAT CONTROLLER READY!\r"), {
    type: "ready",
    variant: "bass",
  });
  assert.deepEqual(parsePresetLine("AUDIO FORMAT: BASS ENVELOPE 16-BIT"), {
    type: "format",
    format: "bass-envelope-16-bit",
  });
  for (const line of [
    "PIXMOB BEAT CONTROLLER READY",
    "PIXMOB BEAT CONTROLLER READY! extra",
    " PIXMOB BEAT CONTROLLER READY!",
    "pixmob beat controller ready!",
    "AUDIO FORMAT: BASS ENVELOPE 16-BIT ",
    "AUDIO FORMAT: BASS ENVELOPE 16-BIT extra",
    "AUDIO FORMAT: BASS ENVELOPE 24-BIT",
    "AUDIO FORMAT:BASS ENVELOPE 16-BIT",
    "audio format: bass envelope 16-bit",
  ])
    assert.equal(parsePresetLine(line), null);
});

test("bass metadata on Stop and Music labels samples accurately while preserving telemetry bounds", async () => {
  const rig = serialRig((command, emit) => {
    if (command === "X")
      emit("AUTO / MUSIC STOPPED\r\nAUDIO FORMAT: BASS ENVELOPE 16-BIT\r\n");
    else if (command === "M")
      emit(
        "MUSIC SYNC ON\nAUDIO FORMAT: BASS ENVELOPE 16-BIT\nLevel:16384 Threshold:250\nBEAT! Color sent: R\n",
      );
  });
  const device = new PresetSerialTransport();
  try {
    await device.open();
    const status = await device.status();
    assert.match(status.name, /beat|bass/i);
    assert.match(status.firmware, /bass/i);
    assert.match(status.firmware, /unversioned/i);
    const samples: DeviceAudio[] = [];
    device.subscribeAudio((sample) => samples.push(sample));
    await device.command("music");
    assert.equal(samples.length, 2);
    assert(samples.every((sample) => sample.format === "bass-envelope-16-bit"));
    assert.equal(samples[0].rawLevel, 16384);
    assert.equal(samples[0].level, 0.5);
    assert.equal(samples[0].threshold, 250);
    assert.equal(samples[1].beat, true);
    rig.emit(
      "Level:32768 Threshold:81920\nLevel:32769 Threshold:250\nLevel:100 Threshold:81921\n",
    );
    await setImmediate();
    assert.equal(samples.length, 3);
    assert.equal(samples[2].rawLevel, 32768);
    assert.equal(samples[2].level, 1);
    assert.equal(samples[2].threshold, 81920);
    assert.equal(samples[2].format, "bass-envelope-16-bit");
  } finally {
    await device.close();
    rig.restore();
  }
});

test("near-match bass metadata cannot relabel legacy audio, but exact format metadata can", async () => {
  const rig = serialRig((command, emit) => {
    if (command === "X")
      emit(
        "PIXMOB BEAT CONTROLLER READY! extra\nAUDIO FORMAT: BASS ENVELOPE 16-BIT extra\nAUTO / MUSIC STOPPED\n",
      );
    else if (command === "M") emit("MUSIC SYNC ON\nLevel:100 Threshold:250\n");
  });
  const device = new PresetSerialTransport();
  try {
    await device.open();
    const legacy = await device.status();
    assert.equal(legacy.name, "ESP32 preset controller");
    const samples: DeviceAudio[] = [];
    device.subscribeAudio((sample) => samples.push(sample));
    await device.command("music");
    assert.equal(samples.at(-1)?.format, "mean-absolute-16-bit");
    rig.emit("AUDIO FORMAT: BASS ENVELOPE 16-BIT\nLevel:100 Threshold:250\n");
    await setImmediate();
    assert.equal(samples.at(-1)?.format, "bass-envelope-16-bit");
    assert.match((await device.status()).firmware, /bass.*unversioned/i);
  } finally {
    await device.close();
    rig.restore();
  }
});

test("bass banners and format metadata never substitute for the X acknowledgement handshake", async () => {
  const rig = serialRig((_command, emit) =>
    emit(
      "PIXMOB BEAT CONTROLLER READY!\nAUDIO FORMAT: BASS ENVELOPE 16-BIT\nMUSIC SYNC ON\nLevel:100 Threshold:250\n",
    ),
  );
  const device = new PresetSerialTransport({
    handshakeTimeoutMs: 80,
    handshakeRetryMs: 20,
  });
  try {
    await device.open();
    let samples = 0;
    device.subscribeAudio(() => samples++);
    await assert.rejects(
      device.status(),
      /acknowledgment|protocol|firmware|respond/i,
    );
    assert.equal(samples, 0);
    assert.deepEqual(
      rig.writes.map((value) => value.trim()),
      ["X", "X"],
    );
    await assert.rejects(device.command("music"));
    assert.equal(rig.writes.length, 2);
  } finally {
    await device.close();
    rig.restore();
  }
});

test("a bass ready banner after confirmation invalidates the serial session", async () => {
  const rig = serialRig((command, emit) => {
    if (command === "X")
      emit("PIXMOB BEAT CONTROLLER READY!\nAUTO / MUSIC STOPPED\n");
  });
  const device = new PresetSerialTransport();
  try {
    await device.open();
    const status = await device.status();
    assert.match(status.firmware, /bass/i);
    const before = rig.writes.length;
    rig.emit(
      "PIXMOB BEAT CONTROLLER READY!\nAUDIO FORMAT: BASS ENVELOPE 16-BIT\n",
    );
    await setImmediate();
    await assert.rejects(device.status(), /restart|reconnect/i);
    await assert.rejects(device.command("music"), /restart|reconnect/i);
    assert.equal(rig.writes.length, before);
  } finally {
    await device.close();
    rig.restore();
  }
});

test("browser beat capability and Host mode require exact metadata lines", () => {
  assert.deepEqual(parsePresetLine("CAPABILITIES: BROWSER BEATS"), {
    type: "capability",
    browserBeats: true,
  });
  assert.deepEqual(parsePresetLine("CAPABILITIES: BROWSER BEATS\r"), {
    type: "capability",
    browserBeats: true,
  });
  assert.deepEqual(parsePresetLine("BROWSER SYNC ON"), {
    type: "mode",
    mode: "host",
  });
  for (const line of [
    "CAPABILITIES: BROWSER BEATS extra",
    "CAPABILITIES: BROWSER BEATS ",
    "CAPABILITIES:BROWSER BEATS",
    "capabilities: browser beats",
    "BROWSER SYNC ON extra",
    "BROWSER SYNC ON ",
    "browser sync on",
  ])
    assert.equal(parsePresetLine(line), null);
});

test("browser capability alone cannot confirm the serial handshake", async () => {
  const rig = serialRig((_command, emit) =>
    emit(
      "PIXMOB BEAT CONTROLLER READY!\nCAPABILITIES: BROWSER BEATS\nBROWSER SYNC ON\n",
    ),
  );
  const device = new PresetSerialTransport({
    handshakeTimeoutMs: 80,
    handshakeRetryMs: 20,
  });
  try {
    await device.open();
    await assert.rejects(
      device.status(),
      /acknowledgment|protocol|firmware|respond/i,
    );
    assert.deepEqual(
      rig.writes.map((value) => value.trim()),
      ["X", "X"],
    );
    await assert.rejects(device.command("browser"));
    await assert.rejects(device.command("beat", { color: "R" }));
    assert.equal(rig.writes.length, 2);
  } finally {
    await device.close();
    rig.restore();
  }
});

test("unconfirmed or unsupported browser beat controls are rejected without any serial write", async () => {
  const rig = serialRig(acknowledge);
  const device = new PresetSerialTransport();
  try {
    await device.open();
    await assert.rejects(device.command("beat", { color: "R" }));
    assert.equal(
      rig.writes.length,
      0,
      "a beat cannot initiate the X handshake",
    );
    const status = await device.status();
    assert.equal(Boolean(status.browserBeatSupported), false);
    const count = rig.writes.length;
    await assert.rejects(device.command("browser"));
    await assert.rejects(device.command("beat", { color: "R" }));
    assert.equal(
      rig.writes.length,
      count,
      "old firmware receives no H or digit commands",
    );
  } finally {
    await device.close();
    rig.restore();
  }
});

test("capable browser mode sends H then only the matching RGB beat digits and preserves Host state", async () => {
  const rig = serialRig((command, emit) => {
    if (command === "X")
      emit("AUTO / MUSIC STOPPED\nCAPABILITIES: BROWSER BEATS\n");
    else if (command === "H")
      emit("BROWSER SYNC ON\nCAPABILITIES: BROWSER BEATS\n");
    else if (/^[123]$/.test(command))
      emit(`BEAT! Color sent: ${"RGB"[Number(command) - 1]}\n`);
  });
  const device = new PresetSerialTransport();
  try {
    await device.open();
    const status = await device.status();
    assert.equal(status.browserBeatSupported, true);
    await assert.rejects(device.command("beat", { color: "R" }));
    const micSamples: DeviceAudio[] = [];
    device.subscribeAudio((sample) => micSamples.push(sample));
    const before = rig.writes.length;
    await device.command("browser");
    for (const color of ["R", "G", "B"])
      await device.command("beat", { color });
    assert.deepEqual(
      rig.writes.slice(before).map((value) => value.trim()),
      ["H", "1", "2", "3"],
    );
    const host = await device.status();
    assert.equal(host.deviceMode, "host");
    assert.equal(host.lastColor, "B");
    assert(
      Number.isFinite(host.lastBeatAt),
      "a Host preview pulse is timestamped from a real completion",
    );
    assert.equal(
      host.micAvailable,
      false,
      "browser completions do not indicate live microphone samples",
    );
    assert.equal(
      micSamples.length,
      0,
      "Host completions are not relabeled as measured microphone audio",
    );
    const count = rig.writes.length;
    for (const [op, payload] of [
      ["browser", {}],
      ["beat", { color: "M" }],
      ["beat", { color: "1" }],
      ["beat", { color: "R\nX" }],
      ["beat", { color: "R", arbitrary: true }],
    ] as const)
      await assert.rejects(device.command(op, payload));
    assert.equal(rig.writes.length, count);
  } finally {
    await device.close();
    rig.restore();
  }
});

test("Host beats require a new matching BEAT completion rather than stale or plain color acknowledgements", async () => {
  const rig = serialRig((command, emit) => {
    if (command === "X")
      emit("AUTO / MUSIC STOPPED\nCAPABILITIES: BROWSER BEATS\n");
    else if (command === "H") emit("BROWSER SYNC ON\n");
  });
  const device = new PresetSerialTransport({ commandTimeoutMs: 1000 });
  try {
    await device.open();
    await device.status();
    await device.command("browser");
    rig.emit("BEAT! Color sent: R\n");
    await setImmediate();
    const before = rig.writes.length;
    let redSettled = false;
    const red = device.command("beat", { color: "R" }).then((value) => {
      redSettled = true;
      return value;
    });
    const green = device.command("beat", { color: "G" });
    await waitForWrites(rig.writes, before + 1);
    assert.equal(rig.writes.at(-1)?.trim(), "1");
    rig.emit("Color sent: R\nBEAT! Color sent: G\n");
    await setImmediate();
    assert.equal(redSettled, false);
    assert.equal(rig.writes.length, before + 1);
    rig.emit("BEAT! Color sent: R\n");
    await red;
    await waitForWrites(rig.writes, before + 2);
    assert.equal(rig.writes.at(-1)?.trim(), "2");
    let greenSettled = false;
    void green.then(() => {
      greenSettled = true;
    });
    await setImmediate();
    assert.equal(
      greenSettled,
      false,
      "the earlier wrong-color G completion was not reused",
    );
    rig.emit("BEAT! Color sent: G\n");
    await green;
    assert.equal((await device.status()).deviceMode, "host");
  } finally {
    await device.close();
    rig.restore();
  }
});

test("Stop queued before a browser beat exits Host and blocks the queued digit", async () => {
  let initialStop = true;
  const rig = serialRig((command, emit) => {
    if (command === "X" && initialStop) {
      initialStop = false;
      emit("AUTO / MUSIC STOPPED\nCAPABILITIES: BROWSER BEATS\n");
    } else if (command === "H") emit("BROWSER SYNC ON\n");
  });
  const device = new PresetSerialTransport({ commandTimeoutMs: 1000 });
  try {
    await device.open();
    await device.status();
    await device.command("browser");
    const before = rig.writes.length;
    const stopping = device.command("stop");
    const cancelled = assert.rejects(device.command("beat", { color: "R" }));
    await waitForWrites(rig.writes, before + 1);
    assert.equal(rig.writes.at(-1)?.trim(), "X");
    rig.emit("AUTO / MUSIC STOPPED\nCAPABILITIES: BROWSER BEATS\n");
    await stopping;
    await cancelled;
    assert.equal((await device.status()).deviceMode, "manual");
    assert.equal(
      rig.writes.length,
      before + 1,
      "Stop prevents the queued host beat from being transmitted",
    );
  } finally {
    await device.close();
    rig.restore();
  }
});

test("Stop intent cancels an earlier browser beat still waiting behind a sensitivity acknowledgement", async () => {
  let initialStop = true;
  const rig = serialRig((command, emit) => {
    if (command === "X" && initialStop) {
      initialStop = false;
      emit("AUTO / MUSIC STOPPED\nCAPABILITIES: BROWSER BEATS\n");
    } else if (command === "H") emit("BROWSER SYNC ON\n");
  });
  const device = new PresetSerialTransport({ commandTimeoutMs: 1000 });
  try {
    await device.open();
    await device.status();
    await device.command("browser");
    const before = rig.writes.length;
    const sensitivity = device.command("sensitivity", { direction: "more" });
    await waitForWrites(rig.writes, before + 1);
    assert.equal(rig.writes.at(-1)?.trim(), "+");
    const cancelled = assert.rejects(device.command("beat", { color: "R" }));
    const stopping = device.command("stop");
    await setImmediate();
    assert.equal(
      rig.writes.length,
      before + 1,
      "sensitivity is still awaiting its acknowledgement",
    );
    rig.emit("Sensitivity: 1.25\n");
    await sensitivity;
    await cancelled;
    await waitForWrites(rig.writes, before + 2);
    assert.deepEqual(
      rig.writes.slice(before).map((value) => value.trim()),
      ["+", "X"],
    );
    rig.emit("AUTO / MUSIC STOPPED\nCAPABILITIES: BROWSER BEATS\n");
    await stopping;
    assert.equal((await device.status()).deviceMode, "manual");
    assert.equal(
      rig.writes.length,
      before + 2,
      "a queued beat is cancelled as soon as Stop is requested",
    );
  } finally {
    await device.close();
    rig.restore();
  }
});

test("a manual preset leaves Host through the stop barrier and blocks subsequent beat digits", async () => {
  const rig = serialRig((command, emit) => {
    if (command === "X")
      emit("AUTO / MUSIC STOPPED\nCAPABILITIES: BROWSER BEATS\n");
    else if (command === "H") emit("BROWSER SYNC ON\n");
    else acknowledge(command, emit);
  });
  const device = new PresetSerialTransport();
  try {
    await device.open();
    await device.status();
    await device.command("browser");
    const before = rig.writes.length;
    await device.command("preset", { color: "W" });
    assert.deepEqual(
      rig.writes.slice(before).map((value) => value.trim()),
      ["X", "W"],
    );
    assert.equal((await device.status()).deviceMode, "manual");
    const count = rig.writes.length;
    await assert.rejects(device.command("beat", { color: "B" }));
    assert.equal(rig.writes.length, count);
  } finally {
    await device.close();
    rig.restore();
  }
});

test("preset serial handshake confirms the sketch without sending JSON", async () => {
  const rig = serialRig(acknowledge);
  const device = new PresetSerialTransport();
  try {
    await device.open();
    const status = await device.status();
    assert.equal(status.mode, "preset-serial");
    assert.equal(status.deviceMode, "manual");
    assert.equal(status.rfSupported, false);
    assert.equal(status.irPin, 32);
    assert.deepEqual(status.micPins, { bclk: 26, ws: 25, data: 27 });
    assert(rig.writes.some((value) => value.trim() === "X"));
    assert(rig.writes.every((value) => /^[\r\nX]+$/.test(value)));
    const writesAfterConnect = rig.writes.length;
    await device.status();
    assert.equal(
      rig.writes.length,
      writesAfterConnect,
      "status is local after confirmation",
    );
  } finally {
    await device.close();
    rig.restore();
  }
  assert(rig.isClosed());
  assert.equal(rig.port.readable.locked, false);
  assert.equal(rig.port.writable.locked, false);
  await assert.rejects(device.status(), /disconnect|closed/i);
});

test("preset control sends only supported characters and treats M as music", async () => {
  const rig = serialRig(acknowledge);
  const device = new PresetSerialTransport();
  try {
    await device.open();
    await device.status();
    const events: Status[] = [];
    const unsubscribe = device.subscribeStatus((value) => events.push(value));
    const before = rig.writes.length;
    for (const color of ["R", "G", "B", "Y", "C", "W"])
      await device.command("preset", { color });
    assert.equal((await device.status()).lastColor, "W");
    await device.command("auto");
    assert.equal((await device.status()).deviceMode, "auto");
    await device.command("music");
    assert.equal((await device.status()).deviceMode, "music");
    await device.command("sensitivity", { direction: "more" });
    assert.equal((await device.status()).musicSensitivity, 1.25);
    await device.command("sensitivity", { direction: "less" });
    assert.equal((await device.status()).musicSensitivity, 1.35);
    await device.command("stop");
    assert.equal((await device.status()).deviceMode, "manual");
    assert.deepEqual(
      rig.writes.slice(before).map((value) => value.trim()),
      ["R", "G", "B", "Y", "C", "W", "A", "M", "+", "-", "X"],
    );
    assert(events.some((value) => value.deviceMode === "music"));
    assert(events.some((value) => value.deviceMode === "auto"));
    const count = rig.writes.length;
    for (const [op, payload] of [
      ["preset", { color: "M" }],
      ["preset", { color: "R\nA" }],
      ["preset", { color: "#ff0000" }],
      ["sensitivity", { direction: "arbitrary" }],
      ["ir/send", {}],
      ["standalone", { enabled: true }],
      ["R", undefined],
    ] as const)
      await assert.rejects(device.command(op, payload));
    assert.equal(
      rig.writes.length,
      count,
      "unsupported operations never reach the wire",
    );
    unsubscribe();
  } finally {
    await device.close();
    rig.restore();
  }
});

test("preset telemetry reconstructs fragmented samples and associates separate beat/color messages", async () => {
  const rig = serialRig(acknowledge);
  const device = new PresetSerialTransport();
  try {
    await device.open();
    await device.status();
    await device.command("music");
    const samples: DeviceAudio[] = [];
    const statuses: Status[] = [];
    const unsubscribeAudio = device.subscribeAudio((value) =>
      samples.push(value),
    );
    const unsubscribeStatus = device.subscribeStatus((value) =>
      statuses.push(value),
    );
    rig.emit("Level:163");
    rig.emit("84 Threshold:250\r\nBEAT! Color sent: R\r\n");
    rig.emit("Level:32768 Threshold:81920\n");
    await setImmediate();
    assert(
      samples.some(
        (value) =>
          value.rawLevel === 16384 &&
          value.level === 0.5 &&
          value.threshold === 250,
      ),
    );
    assert(samples.some((value) => value.beat === true));
    assert(
      samples.some(
        (value) =>
          value.rawLevel === 32768 &&
          value.level === 1 &&
          value.threshold === 81920,
      ),
    );
    assert(
      samples.every(
        (value) =>
          value.format === "mean-absolute-16-bit" &&
          Number.isFinite(value.receivedAt),
      ),
    );
    assert.equal((await device.status()).lastColor, "R");
    assert(
      statuses.some(
        (value) => value.lastColor === "R" && value.deviceMode === "music",
      ),
    );
    const sampleCount = samples.length;
    rig.emit(
      [
        "Level:32769 Threshold:250",
        "Level:-1 Threshold:250",
        "Level:1.5 Threshold:250",
        "Level:NaN Threshold:250",
        "Level:100 Threshold:-1",
        "Level:100 Threshold:81921",
        "Level:100 Threshold:1.5",
        "Level:100 Threshold:250 extra",
        "other Level:100 Threshold:250",
        "BEAT! Color sent: Z",
        "Color sent: Z",
      ].join("\n") + "\n",
    );
    await setImmediate();
    assert.equal(
      samples.length,
      sampleCount,
      "malformed telemetry never reaches the preview",
    );
    assert.equal((await device.status()).lastColor, "R");
    unsubscribeAudio();
    unsubscribeStatus();
  } finally {
    await device.close();
    rig.restore();
  }
});

test("preset commands wait for their own acknowledgement and serialize writes", async () => {
  const rig = serialRig((command, emit) => {
    if (command === "X") acknowledge(command, emit);
  });
  const device = new PresetSerialTransport({ commandTimeoutMs: 1000 });
  try {
    await device.open();
    await device.status();
    const before = rig.writes.length;
    let redSettled = false;
    const red = device.command("preset", { color: "R" }).then((value) => {
      redSettled = true;
      return value;
    });
    const green = device.command("preset", { color: "G" });
    await waitForWrites(rig.writes, before + 1);
    assert.equal(rig.writes.at(-1)?.trim(), "R");
    rig.emit("BEAT! Color sent: R\nColor sent: G\n");
    await setImmediate();
    assert.equal(
      redSettled,
      false,
      "a beat or unrelated color is not a command acknowledgement",
    );
    assert.equal(
      rig.writes.length,
      before + 1,
      "queued command waits for the first acknowledgement",
    );
    rig.emit("Color sent: R\n");
    await red;
    await waitForWrites(rig.writes, before + 2);
    assert.equal(rig.writes.at(-1)?.trim(), "G");
    rig.emit("Color sent: G\n");
    await green;
    assert.equal((await device.status()).lastColor, "G");
  } finally {
    await device.close();
    rig.restore();
  }
});

test("a manual preset first stops Auto so its in-flight color cannot acknowledge the new command", async () => {
  let acknowledgeStop = true;
  const rig = serialRig((command, emit) => {
    if (command === "A" || (command === "X" && acknowledgeStop))
      acknowledge(command, emit);
  });
  const device = new PresetSerialTransport({ commandTimeoutMs: 1000 });
  try {
    await device.open();
    await device.status();
    await device.command("auto");
    acknowledgeStop = false;
    const before = rig.writes.length;
    let settled = false;
    const red = device.command("preset", { color: "R" }).then((value) => {
      settled = true;
      return value;
    });
    await waitForWrites(rig.writes, before + 1);
    assert.equal(rig.writes.at(-1)?.trim(), "X");
    rig.emit("Color sent: R\n");
    await setImmediate();
    assert.equal(settled, false);
    assert.equal(rig.writes.length, before + 1);
    rig.emit("AUTO / MUSIC STOPPED\n");
    await waitForWrites(rig.writes, before + 2);
    assert.equal(rig.writes.at(-1)?.trim(), "R");
    assert.equal(
      settled,
      false,
      "the Auto color did not satisfy the manual preset",
    );
    rig.emit("Color sent: R\n");
    await red;
    assert.equal((await device.status()).deviceMode, "manual");
  } finally {
    await device.close();
    rig.restore();
  }
});

test("JSON firmware and microphone-only output cannot confirm the preset serial protocol", async () => {
  const rig = serialRig((_command, emit) =>
    emit(
      '{"id":1,"name":"PixMob Studio ESP32","firmware":"1.1.0","irConfigured":false,"rfSupported":false,"micAvailable":true}\n' +
        "Sound Level: 100\nLevel:100 Threshold:250\nPIXMOB STUDIO V2 READY!\n",
    ),
  );
  const device = new PresetSerialTransport({
    handshakeTimeoutMs: 80,
    handshakeRetryMs: 20,
  });
  try {
    await device.open();
    await assert.rejects(
      device.status(),
      /timed out|confirm|handshake|firmware|respond/i,
    );
    assert.deepEqual(
      rig.writes.map((value) => value.trim()),
      ["X", "X"],
    );
    assert(rig.writes.every((value) => !/[{}:]/.test(value)));
    await assert.rejects(device.command("preset", { color: "R" }));
    assert.equal(
      rig.writes.length,
      2,
      "unconfirmed firmware receives no lighting commands",
    );
  } finally {
    await device.close();
    rig.restore();
  }
});

test("command timeout rejects queued work and prevents late acknowledgements from reviving it", async () => {
  const rig = serialRig((command, emit) => {
    if (command === "X") acknowledge(command, emit);
  });
  const device = new PresetSerialTransport({ commandTimeoutMs: 40 });
  try {
    await device.open();
    await device.status();
    const before = rig.writes.length;
    const red = assert.rejects(
      device.command("preset", { color: "R" }),
      /timed out|timeout/i,
    );
    const green = assert.rejects(device.command("preset", { color: "G" }));
    await Promise.all([red, green]);
    assert.equal(
      rig.writes.length,
      before + 1,
      "a queued lighting command is not sent after timeout",
    );
    if (rig.port.readable.locked) rig.emit("Color sent: R\n");
    await setImmediate();
    await assert.rejects(device.status());
    await assert.rejects(device.command("music"));
    assert.equal(rig.writes.length, before + 1);
  } finally {
    await device.close();
    rig.restore();
  }
});

test("disconnect rejects pending acknowledgements and releases both serial locks", async () => {
  const rig = serialRig((command, emit) => {
    if (command === "X") acknowledge(command, emit);
  });
  const device = new PresetSerialTransport();
  try {
    await device.open();
    await device.status();
    const before = rig.writes.length;
    const pending = assert.rejects(
      device.command("music"),
      /disconnect|closed/i,
    );
    await waitForWrites(rig.writes, before + 1);
    await device.close();
    await pending;
    assert(rig.isClosed());
    assert.equal(rig.port.readable.locked, false);
    assert.equal(rig.port.writable.locked, false);
    await assert.rejects(
      device.command("preset", { color: "R" }),
      /disconnect|closed/i,
    );
  } finally {
    await device.close();
    rig.restore();
  }
});

test("a firmware restart invalidates the confirmed session and requires reconnecting", async () => {
  const rig = serialRig(acknowledge);
  const device = new PresetSerialTransport();
  try {
    await device.open();
    await device.status();
    await device.command("music");
    const before = rig.writes.length;
    rig.emit("PIXMOB STUDIO V2 READY!\nLevel:100 Threshold:250\n");
    await setImmediate();
    await assert.rejects(device.status(), /restart|reconnect/i);
    await assert.rejects(
      device.command("preset", { color: "R" }),
      /restart|reconnect/i,
    );
    assert.equal(
      rig.writes.length,
      before,
      "a restarted session sends no further commands",
    );
  } finally {
    await device.close();
    rig.restore();
  }
});

test("stale preset measurements clear while initialized microphone capability remains available", async () => {
  const rig = serialRig(acknowledge);
  const device = new PresetSerialTransport();
  const originalNow = Date.now;
  try {
    await device.open();
    await device.status();
    await device.command("music");
    let now = originalNow();
    Date.now = () => now;
    rig.emit("Level:16384 Threshold:250\n");
    await setImmediate();
    assert.equal((await device.status()).micLevel, 0.5);
    now += 2001;
    const status = await device.status();
    assert.equal(
      status.micAvailable,
      false,
      "the UI's recent-samples flag expires",
    );
    assert.equal(status.micInitialized, true);
    assert.equal(status.micLevel, 0);
    assert.equal(status.micRawLevel, 0);
    let replayed = 0;
    const unsubscribe = device.subscribeAudio(() => replayed++);
    assert.equal(replayed, 0, "a new subscriber is never given a stale sample");
    unsubscribe();
  } finally {
    Date.now = originalNow;
    await device.close();
    rig.restore();
  }
});

test("the neutral-white candidate metadata line is exact and labels White per firmware", async () => {
  assert.deepEqual(
    parsePresetLine("WHITE PRESET: NEUTRAL CANDIDATE (K = WHITISH)"),
    { type: "white", neutralCandidate: true, legacyWhitish: "K" },
  );
  assert.deepEqual(
    parsePresetLine("WHITE PRESET: NEUTRAL CANDIDATE (K = WHITISH)\r"),
    { type: "white", neutralCandidate: true, legacyWhitish: "K" },
  );
  for (const line of [
    "WHITE PRESET: NEUTRAL CANDIDATE",
    "WHITE PRESET: NEUTRAL CANDIDATE (K = WHITISH) extra",
    "white preset: neutral candidate (k = whitish)",
    "WHITE PRESET: WHITISH",
  ])
    assert.equal(parsePresetLine(line), null);
  assert.deepEqual(parsePresetLine("Color sent: K"), {
    type: "color",
    color: "K",
    beat: false,
  });
  // The music sketch never cycles K on beats.
  // Firmware with BEAT EFFECTS can use any preset color for a beat.
  assert.deepEqual(parsePresetLine("BEAT! Color sent: K"), {
    type: "color",
    color: "K",
    beat: true,
  });

  // Without the line (original sketch or earlier builds), W is WHITISH and K
  // is refused before any write.
  const legacy = serialRig(acknowledge);
  const legacyDevice = new PresetSerialTransport();
  try {
    await legacyDevice.open();
    const status = await legacyDevice.status();
    assert.equal(status.whitePreset, "whitish");
    assert.equal(status.legacyWhitishSupported, false);
    const count = legacy.writes.length;
    await assert.rejects(legacyDevice.command("preset", { color: "K" }));
    assert.equal(legacy.writes.length, count);
    await legacyDevice.command("preset", { color: "W" });
    assert.equal((await legacyDevice.status()).lastColor, "W");
  } finally {
    await legacyDevice.close();
    legacy.restore();
  }

  const rig = serialRig((command, emit) => {
    if (command === "X")
      emit(
        "AUTO / MUSIC STOPPED\r\nAUDIO FORMAT: BASS ENVELOPE 16-BIT\r\nCAPABILITIES: BROWSER BEATS\r\nPRESET FRAMES: 1\r\nWHITE PRESET: NEUTRAL CANDIDATE (K = WHITISH)\r\n",
      );
    else if (/^[RGBYCWK]$/.test(command)) emit(`Color sent: ${command}\r\n`);
  });
  const device = new PresetSerialTransport();
  try {
    await device.open();
    await device.status();
    for (let attempt = 0; attempt < 20; attempt++) {
      if ((await device.status()).legacyWhitishSupported) break;
      await setImmediate();
    }
    const status = await device.status();
    assert.equal(status.whitePreset, "neutral-candidate");
    assert.equal(status.legacyWhitishSupported, true);
    const before = rig.writes.length;
    await device.command("preset", { color: "K" });
    await device.command("preset", { color: "W" });
    assert.deepEqual(
      rig.writes.slice(before).map((value) => value.trim()),
      ["K", "W"],
    );
    assert.equal((await device.status()).lastColor, "W");
  } finally {
    await device.close();
    rig.restore();
  }
});

test("timed lights need the firmware's exact capability line and their own acknowledgement", async () => {
  assert.deepEqual(parsePresetLine("TIMED LIGHT: READY"), {
    type: "timedLight",
    ready: true,
  });
  assert.equal(parsePresetLine("TIMED LIGHT: READY "), null);
  assert.equal(parsePresetLine("TIMED LIGHT"), null);
  assert.deepEqual(parsePresetLine("Light: R 1500"), {
    type: "light",
    color: "R",
    ms: 1500,
  });
  assert.deepEqual(parsePresetLine("Light: M 600000\r"), {
    type: "light",
    color: "M",
    ms: 600000,
  });
  for (const line of [
    "Light: R 49",
    "Light: R 600001",
    "Light: R 0150",
    "Light: X 1500",
    "Light: R",
    "Light: R 1500 extra",
  ])
    assert.equal(parsePresetLine(line), null);

  // Firmware without the line never receives the multi-character command.
  const legacy = serialRig(acknowledge);
  const legacyDevice = new PresetSerialTransport();
  try {
    await legacyDevice.open();
    assert.equal((await legacyDevice.status()).timedLightSupported, false);
    const count = legacy.writes.length;
    await assert.rejects(
      legacyDevice.command("light", { color: "R", ms: 1500 }),
    );
    assert.equal(legacy.writes.length, count);
  } finally {
    await legacyDevice.close();
    legacy.restore();
  }

  const rig = serialRig((command, emit) => {
    if (command === "X")
      emit("AUTO / MUSIC STOPPED\r\nPRESET FRAMES: 1\r\nTIMED LIGHT: READY\r\n");
    else if (command === "A") emit("AUTO MODE ON\r\n");
    else if (/^#[RGBYCMWK]\d+$/.test(command))
      emit(`Light: ${command[1]} ${command.slice(2)}\r\n`);
    else if (/^[RGBYCW]$/.test(command)) emit(`Color sent: ${command}\r\n`);
  });
  const device = new PresetSerialTransport();
  try {
    await device.open();
    await device.status();
    for (let attempt = 0; attempt < 20; attempt++) {
      if ((await device.status()).timedLightSupported) break;
      await setImmediate();
    }
    assert.equal((await device.status()).timedLightSupported, true);
    const before = rig.writes.length;
    await device.command("light", { color: "R", ms: 1500 });
    await device.command("light", { color: "M", ms: 250 });
    assert.deepEqual(
      rig.writes.slice(before).map((value) => value.trim()),
      ["#R1500", "#M250"],
    );
    assert.equal((await device.status()).lastColor, "M");
    assert.equal((await device.status()).deviceMode, "manual");
    // Leaving Auto goes through the same Stop barrier as a preset color.
    await device.command("auto");
    const afterAuto = rig.writes.length;
    await device.command("light", { color: "G", ms: 3000 });
    assert.deepEqual(
      rig.writes.slice(afterAuto).map((value) => value.trim()),
      ["X", "#G3000"],
    );
    const count = rig.writes.length;
    for (const payload of [
      { color: "R" },
      { color: "R", ms: 49 },
      { color: "R", ms: 600001 },
      { color: "R", ms: 1500.5 },
      { color: "R", ms: "1500" },
      { color: "Z", ms: 1500 },
      { color: "R\n", ms: 1500 },
      { color: "R", ms: 1500, extra: true },
    ])
      await assert.rejects(device.command("light", payload));
    assert.equal(rig.writes.length, count, "invalid lights never reach the wire");
  } finally {
    await device.close();
    rig.restore();
  }
});

test("strobes need the firmware's exact capability line and their own acknowledgement", async () => {
  assert.deepEqual(parsePresetLine("STROBE: READY"), {
    type: "strobeReady",
    ready: true,
  });
  assert.equal(parsePresetLine("STROBE: READY "), null);
  assert.deepEqual(parsePresetLine("Strobe: W 2000"), {
    type: "strobe",
    color: "W",
    ms: 2000,
    build: false,
  });
  assert.deepEqual(parsePresetLine("Build: B 60000\r"), {
    type: "strobe",
    color: "B",
    ms: 60000,
    build: true,
  });
  for (const line of [
    "Strobe: W 199",
    "Strobe: W 60001",
    "Strobe: W 0500",
    "Strobe: X 2000",
    "Build: W",
    "Build: W 2000 extra",
  ])
    assert.equal(parsePresetLine(line), null);

  // Firmware with timed lights but without the strobe line never receives it.
  const older = serialRig((command, emit) => {
    if (command === "X")
      emit("AUTO / MUSIC STOPPED\r\nPRESET FRAMES: 1\r\nTIMED LIGHT: READY\r\n");
  });
  const olderDevice = new PresetSerialTransport();
  try {
    await olderDevice.open();
    await olderDevice.status();
    for (let attempt = 0; attempt < 20; attempt++) {
      if ((await olderDevice.status()).timedLightSupported) break;
      await setImmediate();
    }
    assert.equal((await olderDevice.status()).strobeSupported, false);
    const count = older.writes.length;
    await assert.rejects(
      olderDevice.command("strobe", { color: "W", ms: 2000, build: false }),
    );
    assert.equal(older.writes.length, count);
  } finally {
    await olderDevice.close();
    older.restore();
  }

  const rig = serialRig((command, emit) => {
    if (command === "X")
      emit(
        "AUTO / MUSIC STOPPED\r\nPRESET FRAMES: 1\r\nTIMED LIGHT: READY\r\nSTROBE: READY\r\n",
      );
    else if (command === "A") emit("AUTO MODE ON\r\n");
    else if (/^[!^][RGBYCMWK]\d+$/.test(command))
      emit(
        `${command[0] === "^" ? "Build" : "Strobe"}: ${command[1]} ${command.slice(2)}\r\n`,
      );
  });
  const device = new PresetSerialTransport();
  try {
    await device.open();
    await device.status();
    for (let attempt = 0; attempt < 20; attempt++) {
      if ((await device.status()).strobeSupported) break;
      await setImmediate();
    }
    assert.equal((await device.status()).strobeSupported, true);
    const before = rig.writes.length;
    await device.command("strobe", { color: "W", ms: 2000, build: false });
    await device.command("strobe", { color: "M", ms: 8000, build: true });
    assert.deepEqual(
      rig.writes.slice(before).map((value) => value.trim()),
      ["!W2000", "^M8000"],
    );
    assert.equal((await device.status()).lastColor, "M");
    assert.equal((await device.status()).deviceMode, "manual");
    await device.command("auto");
    const afterAuto = rig.writes.length;
    await device.command("strobe", { color: "R", ms: 500, build: false });
    assert.deepEqual(
      rig.writes.slice(afterAuto).map((value) => value.trim()),
      ["X", "!R500"],
    );
    const count = rig.writes.length;
    for (const payload of [
      { color: "R", ms: 2000 },
      { color: "R", ms: 199, build: false },
      { color: "R", ms: 60001, build: false },
      { color: "R", ms: 2000.5, build: false },
      { color: "R", ms: 2000, build: "yes" },
      { color: "Z", ms: 2000, build: false },
      { color: "R", ms: 2000, build: false, extra: 1 },
    ])
      await assert.rejects(device.command("strobe", payload));
    assert.equal(rig.writes.length, count, "invalid strobes never reach the wire");
  } finally {
    await device.close();
    rig.restore();
  }
});

test("custom colors and fades need their capability line and echo their exact command", async () => {
  assert.deepEqual(parsePresetLine("CUSTOM LIGHT: READY"), {
    type: "customReady",
    ready: true,
  });
  assert.deepEqual(parsePresetLine("Flash: =844000"), {
    type: "custom",
    kind: "flash",
    color: "=844000",
    ms: 0,
    fadeIn: 0,
    fadeOut: 0,
  });
  assert.deepEqual(parsePresetLine("Light: B 2000 5 7"), {
    type: "custom",
    kind: "light",
    color: "B",
    ms: 2000,
    fadeIn: 5,
    fadeOut: 7,
  });
  assert.deepEqual(parsePresetLine("Light: =084400 100"), {
    type: "custom",
    kind: "light",
    color: "=084400",
    ms: 100,
    fadeIn: 0,
    fadeOut: 0,
  });
  assert.deepEqual(parsePresetLine("Build: =440044 500"), {
    type: "custom",
    kind: "build",
    color: "=440044",
    ms: 500,
    fadeIn: 0,
    fadeOut: 0,
  });
  // The earlier acknowledgements keep their own events.
  assert.equal(parsePresetLine("Light: R 1500")?.type, "light");
  assert.equal(parsePresetLine("Strobe: W 2000")?.type, "strobe");
  for (const line of [
    "Flash: =C90000",
    "Flash: =040404",
    "Flash: =84400",
    "Flash: =84400g",
    "Light: B 2000 5",
    "Light: B 2000 8 1",
    "Light: =844000 49",
    "Strobe: =844000 199",
  ])
    assert.equal(parsePresetLine(line), null, line);

  const older = serialRig((command, emit) => {
    if (command === "X")
      emit(
        "AUTO / MUSIC STOPPED\r\nPRESET FRAMES: 1\r\nTIMED LIGHT: READY\r\nSTROBE: READY\r\n",
      );
  });
  const olderDevice = new PresetSerialTransport();
  try {
    await olderDevice.open();
    await olderDevice.status();
    for (let attempt = 0; attempt < 20; attempt++) {
      if ((await olderDevice.status()).strobeSupported) break;
      await setImmediate();
    }
    assert.equal((await olderDevice.status()).customLightSupported, false);
    const count = older.writes.length;
    await assert.rejects(
      olderDevice.command("custom", { kind: "flash", color: "=844000" }),
    );
    assert.equal(older.writes.length, count);
  } finally {
    await olderDevice.close();
    older.restore();
  }

  const rig = serialRig((command, emit) => {
    if (command === "X")
      emit(
        "AUTO / MUSIC STOPPED\r\nPRESET FRAMES: 1\r\nTIMED LIGHT: READY\r\nSTROBE: READY\r\nCUSTOM LIGHT: READY\r\n",
      );
    else if (/^\.(?:[RGBYCMWK]|=[0-9A-F]{6})$/.test(command))
      emit(`Flash: ${command.slice(1)}\r\n`);
    else {
      const light = /^#([RGBYCMWK]|=[0-9A-F]{6})(\d+)(?:,(\d),(\d))?$/.exec(
        command,
      );
      if (light)
        emit(
          `Light: ${light[1]} ${light[2]}${light[3] !== undefined ? ` ${light[3]} ${light[4]}` : ""}\r\n`,
        );
      const strobe = /^([!^])([RGBYCMWK]|=[0-9A-F]{6})(\d+)$/.exec(command);
      if (strobe)
        emit(
          `${strobe[1] === "^" ? "Build" : "Strobe"}: ${strobe[2]} ${strobe[3]}\r\n`,
        );
    }
  });
  const device = new PresetSerialTransport();
  try {
    await device.open();
    await device.status();
    for (let attempt = 0; attempt < 20; attempt++) {
      if ((await device.status()).customLightSupported) break;
      await setImmediate();
    }
    assert.equal((await device.status()).customLightSupported, true);
    const before = rig.writes.length;
    await device.command("custom", { kind: "flash", color: "=844000" });
    await device.command("custom", { kind: "light", color: "=084400", ms: 100 });
    await device.command("custom", {
      kind: "light",
      color: "B",
      ms: 2000,
      fadeIn: 5,
      fadeOut: 7,
    });
    await device.command("custom", { kind: "build", color: "=440044", ms: 500 });
    // A preset letter without fades is acknowledged in the earlier form.
    await device.command("custom", { kind: "light", color: "R", ms: 1500 });
    await device.command("custom", { kind: "strobe", color: "W", ms: 2000 });
    assert.deepEqual(
      rig.writes.slice(before).map((value) => value.trim()),
      [
        ".=844000",
        "#=084400100",
        "#B2000,5,7",
        "^=440044500",
        "#R1500",
        "!W2000",
      ],
    );
    assert.equal((await device.status()).deviceMode, "manual");
    const count = rig.writes.length;
    for (const payload of [
      { kind: "flash", color: "=C90000" },
      { kind: "flash", color: "=000000" },
      { kind: "flash", color: "=844000", ms: 100 },
      { kind: "flash", color: "=84400" },
      { kind: "light", color: "=844000" },
      { kind: "light", color: "=844000", ms: 49 },
      { kind: "light", color: "R", ms: 1500, fadeIn: 8, fadeOut: 0 },
      { kind: "light", color: "R", ms: 1500, fadeIn: 1 },
      { kind: "strobe", color: "R", ms: 2000, fadeIn: 1, fadeOut: 1 },
      { kind: "strobe", color: "R", ms: 199 },
      { kind: "glow", color: "R", ms: 2000 },
      { kind: "flash", color: "R\n" },
      { kind: "flash", color: "R", extra: 1 },
    ])
      await assert.rejects(device.command("custom", payload));
    assert.equal(rig.writes.length, count, "invalid custom lights never reach the wire");
  } finally {
    await device.close();
    rig.restore();
  }
});

test("the rainbow command needs its capability line and echoes its times", async () => {
  assert.deepEqual(parsePresetLine("RAINBOW: READY"), {
    type: "rainbowReady",
    ready: true,
  });
  assert.deepEqual(parsePresetLine("Rainbow: 8000 3000"), {
    type: "rainbow",
    ms: 8000,
    cycleMs: 3000,
  });
  for (const line of [
    "Rainbow: 499 3000",
    "Rainbow: 600001 3000",
    "Rainbow: 8000 999",
    "Rainbow: 8000 20001",
    "Rainbow: 8000",
    "Rainbow: 08000 3000",
    "RAINBOW: READY ",
  ])
    assert.equal(parsePresetLine(line), null, line);

  const older = serialRig((command, emit) => {
    if (command === "X")
      emit(
        "AUTO / MUSIC STOPPED\r\nPRESET FRAMES: 1\r\nTIMED LIGHT: READY\r\nCUSTOM LIGHT: READY\r\n",
      );
  });
  const olderDevice = new PresetSerialTransport();
  try {
    await olderDevice.open();
    await olderDevice.status();
    for (let attempt = 0; attempt < 20; attempt++) {
      if ((await olderDevice.status()).customLightSupported) break;
      await setImmediate();
    }
    assert.equal((await olderDevice.status()).rainbowSupported, false);
    const count = older.writes.length;
    await assert.rejects(
      olderDevice.command("rainbow", { ms: 8000, cycleMs: 3000 }),
    );
    assert.equal(older.writes.length, count);
  } finally {
    await olderDevice.close();
    older.restore();
  }

  const rig = serialRig((command, emit) => {
    if (command === "X")
      emit(
        "AUTO / MUSIC STOPPED\r\nPRESET FRAMES: 1\r\nTIMED LIGHT: READY\r\nRAINBOW: READY\r\n",
      );
    else if (command === "A") emit("AUTO MODE ON\r\n");
    else {
      const rainbow = /^~(\d+),(\d+)$/.exec(command);
      if (rainbow) emit(`Rainbow: ${rainbow[1]} ${rainbow[2]}\r\n`);
    }
  });
  const device = new PresetSerialTransport();
  try {
    await device.open();
    await device.status();
    for (let attempt = 0; attempt < 20; attempt++) {
      if ((await device.status()).rainbowSupported) break;
      await setImmediate();
    }
    assert.equal((await device.status()).rainbowSupported, true);
    const before = rig.writes.length;
    await device.command("rainbow", { ms: 8000, cycleMs: 3000 });
    await device.command("auto");
    await device.command("rainbow", { ms: 500, cycleMs: 20000 });
    assert.deepEqual(
      rig.writes.slice(before).map((value) => value.trim()),
      ["~8000,3000", "A", "X", "~500,20000"],
    );
    assert.equal((await device.status()).deviceMode, "manual");
    const count = rig.writes.length;
    for (const payload of [
      { ms: 8000 },
      { ms: 499, cycleMs: 3000 },
      { ms: 8000, cycleMs: 999 },
      { ms: 8000.5, cycleMs: 3000 },
      { ms: "8000", cycleMs: 3000 },
      { ms: 8000, cycleMs: 3000, color: "R" },
    ])
      await assert.rejects(device.command("rainbow", payload));
    assert.equal(rig.writes.length, count, "invalid rainbows never reach the wire");
  } finally {
    await device.close();
    rig.restore();
  }
});

test("beat looks need their capability line, keep the mode and echo their setting", async () => {
  assert.deepEqual(parsePresetLine("BEAT EFFECTS: READY"), {
    type: "beatEffectsReady",
    ready: true,
  });
  assert.deepEqual(parsePresetLine("BEAT STYLE: F"), {
    type: "beatStyle",
    kind: "flash",
    ms: 0,
    fadeIn: 0,
    fadeOut: 0,
  });
  assert.deepEqual(parsePresetLine("BEAT STYLE: L 300 0 4"), {
    type: "beatStyle",
    kind: "light",
    ms: 300,
    fadeIn: 0,
    fadeOut: 4,
  });
  assert.deepEqual(parsePresetLine("BEAT STYLE: S 400"), {
    type: "beatStyle",
    kind: "strobe",
    ms: 400,
    fadeIn: 0,
    fadeOut: 0,
  });
  assert.deepEqual(parsePresetLine("BEAT PALETTE: RGBYCMW"), {
    type: "beatPalette",
    colors: "RGBYCMW",
  });
  assert.deepEqual(parsePresetLine("BEAT PALETTE: DEFAULT"), {
    type: "beatPalette",
    colors: "",
  });
  for (const line of [
    "BEAT STYLE: X",
    "BEAT STYLE: L 300",
    "BEAT STYLE: L 300 8 0",
    "BEAT PALETTE: ",
    "BEAT PALETTE: RGX",
    "BEAT PALETTE: RGBYCMWKR",
  ])
    assert.equal(parsePresetLine(line), null, line);

  const banner = (extra: string) => (command: string, emit: (text: string) => void) => {
    if (command === "X")
      emit(
        `AUTO / MUSIC STOPPED\r\nCAPABILITIES: BROWSER BEATS\r\nPRESET FRAMES: 1\r\n${extra}`,
      );
    else if (command === "H")
      emit(`BROWSER SYNC ON\r\nCAPABILITIES: BROWSER BEATS\r\n${extra}`);
    else if (command === "A") emit("AUTO MODE ON\r\n");
    else if (/^[1-8]$/.test(command))
      emit(`BEAT! Color sent: ${"RGBYCMWK"[Number(command) - 1]}\r\n`);
    else if (/^\*=[0-9A-F]{6}$/.test(command))
      emit(`BEAT! Color sent: ${command.slice(1)}\r\n`);
    else if (command === "@F") emit("BEAT STYLE: F\r\n");
    else if (/^@S\d+$/.test(command)) emit(`BEAT STYLE: S ${command.slice(2)}\r\n`);
    else if (/^@L\d+,\d,\d$/.test(command))
      emit(`BEAT STYLE: L ${command.slice(2).replaceAll(",", " ")}\r\n`);
    else if (command === "@P*") emit("BEAT PALETTE: DEFAULT\r\n");
    else if (/^@P[RGBYCMWK]+$/.test(command))
      emit(`BEAT PALETTE: ${command.slice(2)}\r\n`);
  };

  // Without the line: no @ command and only the beats 1 to 3.
  const older = serialRig(banner(""));
  const olderDevice = new PresetSerialTransport();
  try {
    await olderDevice.open();
    await olderDevice.status();
    for (let attempt = 0; attempt < 20; attempt++) {
      if ((await olderDevice.status()).browserBeatSupported) break;
      await setImmediate();
    }
    assert.equal((await olderDevice.status()).beatEffectsSupported, false);
    await olderDevice.command("browser");
    const count = older.writes.length;
    await assert.rejects(olderDevice.command("beatStyle", { kind: "flash" }));
    await assert.rejects(olderDevice.command("beatPalette", { colors: "RGB" }));
    await assert.rejects(olderDevice.command("beat", { color: "Y" }));
    await assert.rejects(olderDevice.command("beat", { color: "=844000" }));
    assert.equal(older.writes.length, count);
    await olderDevice.command("beat", { color: "G" });
    assert.equal(older.writes.at(-1)?.trim(), "2");
  } finally {
    await olderDevice.close();
    older.restore();
  }

  const rig = serialRig(banner("BEAT EFFECTS: READY\r\n"));
  const device = new PresetSerialTransport();
  try {
    await device.open();
    await device.status();
    for (let attempt = 0; attempt < 20; attempt++) {
      if ((await device.status()).beatEffectsSupported) break;
      await setImmediate();
    }
    assert.equal((await device.status()).beatEffectsSupported, true);
    await device.command("browser");
    const before = rig.writes.length;
    await device.command("beatStyle", { kind: "light", ms: 300, fadeIn: 0, fadeOut: 4 });
    await device.command("beatPalette", { colors: "RGBYCMW" });
    // The settings did not leave browser mode: a beat still goes out.
    assert.equal((await device.status()).deviceMode, "host");
    await device.command("beat", { color: "Y" });
    await device.command("beat", { color: "K" });
    await device.command("beat", { color: "=844000" });
    await device.command("beatStyle", { kind: "strobe", ms: 400 });
    await device.command("beatStyle", { kind: "flash" });
    await device.command("beatPalette", { colors: "" });
    assert.deepEqual(
      rig.writes.slice(before).map((value) => value.trim()),
      ["@L300,0,4", "@PRGBYCMW", "4", "8", "*=844000", "@S400", "@F", "@P*"],
    );
    await assert.rejects(device.command("beat", { color: "=CC0000" }));
    await assert.rejects(device.command("beat", { color: "=84400" }));
    assert.equal((await device.status()).deviceMode, "host");
    const count = rig.writes.length;
    for (const [op, payload] of [
      ["beatStyle", { kind: "flash", ms: 300 }],
      ["beatStyle", { kind: "light", ms: 300 }],
      ["beatStyle", { kind: "light", ms: 49, fadeIn: 0, fadeOut: 0 }],
      ["beatStyle", { kind: "light", ms: 10001, fadeIn: 0, fadeOut: 0 }],
      ["beatStyle", { kind: "light", ms: 300, fadeIn: 8, fadeOut: 0 }],
      ["beatStyle", { kind: "strobe", ms: 199 }],
      ["beatStyle", { kind: "strobe", ms: 400, fadeIn: 1 }],
      ["beatStyle", { kind: "rainbow" }],
      ["beatPalette", { colors: "RGX" }],
      ["beatPalette", { colors: "RGBYCMWKR" }],
      ["beatPalette", { colors: ["R"] }],
      ["beat", { color: "X" }],
    ] as const)
      await assert.rejects(device.command(op, payload), `${op} ${JSON.stringify(payload)}`);
    assert.equal(rig.writes.length, count, "invalid beat settings never reach the wire");
  } finally {
    await device.close();
    rig.restore();
  }
});

test("the idle rainbow setting is read from the banner and changed with its own command", async () => {
  assert.deepEqual(parsePresetLine("IDLE RAINBOW: ON"), { type: "idleRainbow", seconds: 1 });
  assert.deepEqual(parsePresetLine("IDLE RAINBOW: OFF"), { type: "idleRainbow", seconds: 0 });
  assert.deepEqual(parsePresetLine("IDLE RAINBOW: ON 10"), { type: "idleRainbow", seconds: 10 });
  assert.deepEqual(parsePresetLine("IDLE RAINBOW: ON 3600"), { type: "idleRainbow", seconds: 3600 });
  assert.deepEqual(parsePresetLine("IDLE RETURN: READY"), { type: "idleReturnReady", ready: true });
  // The running notice and near misses are not settings.
  for (const line of [
    "IDLE RAINBOW RUNNING",
    "IDLE RAINBOW: on",
    "IDLE RAINBOW:",
    "IDLE RAINBOW: ON 1",
    "IDLE RAINBOW: ON 0",
    "IDLE RAINBOW: ON 3601",
    "IDLE RAINBOW: ON 010",
    "IDLE RAINBOW: ON 10 s",
    "IDLE RETURN: ready",
  ])
    assert.equal(parsePresetLine(line), null, line);

  const older = serialRig(acknowledge);
  const olderDevice = new PresetSerialTransport();
  try {
    await olderDevice.open();
    assert.equal((await olderDevice.status()).idleRainbow, undefined);
    const count = older.writes.length;
    await assert.rejects(olderDevice.command("idleRainbow", { seconds: 0 }));
    olderDevice.keepAlive();
    await setImmediate();
    assert.equal(older.writes.length, count);
  } finally {
    await olderDevice.close();
    older.restore();
  }

  // beat-breathe-build: on / off only, no keep-alive.
  let onlyOn = true;
  const breathe = serialRig((command, emit) => {
    if (command === "X")
      emit(`AUTO / MUSIC STOPPED\r\nBEAT EFFECTS: READY\r\nIDLE RAINBOW: ${onlyOn ? "ON" : "OFF"}\r\n`);
    else if (command === "@I0" || command === "@I1") {
      onlyOn = command === "@I1";
      emit(`IDLE RAINBOW: ${onlyOn ? "ON" : "OFF"}\r\n`);
    }
  });
  const breatheDevice = new PresetSerialTransport();
  try {
    await breatheDevice.open();
    for (let attempt = 0; attempt < 20; attempt++) {
      if ((await breatheDevice.status()).idleRainbow !== undefined) break;
      await setImmediate();
    }
    assert.equal((await breatheDevice.status()).idleRainbow, 1);
    assert.equal((await breatheDevice.status()).idleReturnSupported, undefined);
    await breatheDevice.command("idleRainbow", { seconds: 0 });
    assert.equal((await breatheDevice.status()).idleRainbow, 0);
    const count = breathe.writes.length;
    await assert.rejects(breatheDevice.command("idleRainbow", { seconds: 10 }), /only from power-on/);
    breatheDevice.keepAlive();
    await setImmediate();
    assert.equal(breathe.writes.length, count, "no seconds or keep-alive for a build without them");
  } finally {
    await breatheDevice.close();
    breathe.restore();
  }

  let seconds = 10;
  const line = () => (seconds === 0 ? "OFF" : seconds === 1 ? "ON" : `ON ${seconds}`);
  const rig = serialRig((command, emit) => {
    if (command === "X")
      emit(`AUTO / MUSIC STOPPED\r\nPRESET FRAMES: 1\r\nBEAT EFFECTS: READY\r\nIDLE RETURN: READY\r\nIDLE RAINBOW: ${line()}\r\n`);
    else if (command === "A") emit("AUTO MODE ON\r\n");
    else if (/^@I\d+$/.test(command)) {
      seconds = Number(command.slice(2));
      emit(`IDLE RAINBOW: ${line()}\r\n`);
    }
  });
  const device = new PresetSerialTransport();
  try {
    await device.open();
    await device.status();
    for (let attempt = 0; attempt < 20; attempt++) {
      if ((await device.status()).idleRainbow !== undefined) break;
      await setImmediate();
    }
    assert.equal((await device.status()).idleRainbow, 10);
    assert.equal((await device.status()).idleReturnSupported, true);
    await device.command("auto");
    const before = rig.writes.length;
    await device.command("idleRainbow", { seconds: 0 });
    assert.equal((await device.status()).idleRainbow, 0);
    // Changing the setting does not stop the running mode.
    assert.equal((await device.status()).deviceMode, "auto");
    await device.command("idleRainbow", { seconds: 1 });
    assert.equal((await device.status()).idleRainbow, 1);
    await device.command("idleRainbow", { seconds: 30 });
    assert.equal((await device.status()).idleRainbow, 30);
    device.keepAlive();
    await setImmediate();
    assert.deepEqual(rig.writes.slice(before), ["@I0\n", "@I1\n", "@I30\n", "\r"]);
    const count = rig.writes.length;
    for (const payload of [
      {},
      { on: true },
      { seconds: -1 },
      { seconds: 3601 },
      { seconds: 2.5 },
      { seconds: "10" },
      { seconds: 10, extra: 1 },
    ])
      await assert.rejects(device.command("idleRainbow", payload), JSON.stringify(payload));
    assert.equal(rig.writes.length, count);
  } finally {
    await device.close();
    rig.restore();
  }
});

test("the RF copy is read from the board's RF lines and switched with its own commands", async () => {
  assert.deepEqual(parsePresetLine("RF: ON"), { type: "rf", state: "on" });
  assert.deepEqual(parsePresetLine("RF: OFF\r"), { type: "rf", state: "off" });
  assert.deepEqual(parsePresetLine("RF: ONLY"), { type: "rf", state: "only" });
  assert.deepEqual(parsePresetLine("LIGHT OUTPUT: READY"), { type: "lightOutputReady", ready: true });
  assert.deepEqual(parsePresetLine("RF: NOT FOUND"), { type: "rf", state: "not-found" });
  assert.deepEqual(parsePresetLine("RF: ERROR GDO0 WIRE"), { type: "rf", state: "wire-error" });
  assert.deepEqual(parsePresetLine("RF: ERROR RMT"), { type: "rf", state: "rmt-error" });
  assert.deepEqual(parsePresetLine("RF: ERROR SETUP"), { type: "rf", state: "setup-error" });
  assert.deepEqual(parsePresetLine("RF CARRIER: 922.36 MHz 10 dBm"), {
    type: "rfCarrier",
    mhz: 922.36,
    dbm: 10,
  });
  assert.deepEqual(parsePresetLine("RF CARRIER: 433.92 MHz -10 dBm"), {
    type: "rfCarrier",
    mhz: 433.92,
    dbm: -10,
  });
  assert.deepEqual(parsePresetLine("RF KEEP AWAKE: 2000"), { type: "rfKeepAwake", ms: 2000 });
  assert.deepEqual(parsePresetLine("RF KEEP AWAKE: 0"), { type: "rfKeepAwake", ms: 0 });
  assert.deepEqual(parsePresetLine("RF FRAMES: 729 SENT 0 FAILED"), {
    type: "rfFrames",
    sent: 729,
    failed: 0,
  });
  assert.deepEqual(parsePresetLine("RF WAKE: 35000 MS"), { type: "rfWake", ms: 35000 });
  assert.deepEqual(parsePresetLine("RF SLEEP AFTER: 300 S"), { type: "rfSleepAfter", seconds: 300 });
  assert.deepEqual(parsePresetLine("RF SLEEP AFTER: OFF"), { type: "rfSleepAfter", seconds: 0 });
  assert.deepEqual(parsePresetLine("RF SLEEP SETTING: READY"), {
    type: "rfSleepSettingReady",
    ready: true,
  });
  for (const line of [
    "RF SLEEP AFTER: 0 S",
    "RF SLEEP AFTER: 0300 S",
    "RF SLEEP AFTER: 300",
    "RF SLEEP AFTER: 90000 S",
    "RF SLEEP AFTER: 59 S",
    "RF SLEEP AFTER: OFF S",
    "RF SLEEP AFTER: off",
    "RF SLEEP SETTING: ON",
  ])
    assert.equal(parsePresetLine(line), null, line);
  // Carriers outside the allowed bands, too much power and near misses.
  for (const line of [
    "RF: on",
    "RF:ON",
    "RF CARRIER: 923.00 MHz 10 dBm",
    "RF CARRIER: 868.00 MHz 10 dBm",
    "RF CARRIER: 922.36 MHz 11 dBm",
    "RF CARRIER: 922.36 MHz 10dBm",
    "RF KEEP AWAKE: 199",
    "RF KEEP AWAKE: 60001",
    "RF KEEP AWAKE: 0200",
    "RF FRAMES: 4294967296 SENT 0 FAILED",
    "RF FRAMES: 01 SENT 0 FAILED",
    "RF WAKE: 35000",
  ])
    assert.equal(parsePresetLine(line), null, line);

  // Firmware without RF: no status, and no @R line is written.
  const older = serialRig(acknowledge);
  const olderDevice = new PresetSerialTransport();
  try {
    await olderDevice.open();
    const status = await olderDevice.status();
    assert.equal(status.rf, undefined);
    assert.equal(status.rfSupported, false);
    const count = older.writes.length;
    await assert.rejects(olderDevice.command("rf", { output: "both" }), /no working RF/);
    await assert.rejects(olderDevice.command("rfWake"), /no working RF/);
    assert.equal(older.writes.length, count);
  } finally {
    await olderDevice.close();
    older.restore();
  }

  // A board whose radio failed its checks reports why; IR controls stay.
  const broken = serialRig((command, emit) => {
    if (command === "X") emit("AUTO / MUSIC STOPPED\r\nRF: ERROR GDO0 WIRE\r\n");
  });
  const brokenDevice = new PresetSerialTransport();
  try {
    await brokenDevice.open();
    for (let attempt = 0; attempt < 20; attempt++) {
      if ((await brokenDevice.status()).rf) break;
      await setImmediate();
    }
    const status = await brokenDevice.status();
    assert.deepEqual(status.rf, { state: "wire-error" });
    assert.equal(status.rfSupported, false);
    await assert.rejects(brokenDevice.command("rf", { output: "ir" }), /no working RF/);
  } finally {
    await brokenDevice.close();
    broken.restore();
  }

  let on = true;
  let sent = 0;
  const report = () =>
    `RF: ${on ? "ON" : "OFF"}\r\nRF CARRIER: 922.36 MHz 10 dBm\r\nRF KEEP AWAKE: 2000\r\nRF FRAMES: ${sent} SENT 0 FAILED\r\n`;
  const rig = serialRig((command, emit) => {
    if (command === "X") emit(`AUTO / MUSIC STOPPED\r\nBEAT EFFECTS: READY\r\n${report()}`);
    else if (command === "A") emit("AUTO MODE ON\r\n");
    else if (command === "@R1" || command === "@R0") {
      on = command === "@R1";
      sent += 7;
      emit(report());
    } else if (command === "@RW") emit(on ? `RF WAKE: 35000 MS\r\n${report()}` : report());
  });
  const device = new PresetSerialTransport();
  try {
    await device.open();
    for (let attempt = 0; attempt < 20; attempt++) {
      if ((await device.status()).rf?.framesSent !== undefined) break;
      await setImmediate();
    }
    assert.deepEqual((await device.status()).rf, {
      state: "on",
      mhz: 922.36,
      dbm: 10,
      keepAwakeMs: 2000,
      framesSent: 0,
      framesFailed: 0,
    });
    assert.equal((await device.status()).rfSupported, true);
    await device.command("auto");
    const before = rig.writes.length;
    await device.command("rfWake");
    await device.command("rf", { output: "ir" });
    assert.equal((await device.status()).rf?.state, "off");
    assert.equal((await device.status()).rf?.framesSent, 7);
    // RF off: no wake, and nothing written for it.
    const count = rig.writes.length;
    await assert.rejects(device.command("rfWake"), /Turn RF on/);
    assert.equal(rig.writes.length, count);
    await device.command("rf", { output: "both" });
    assert.equal((await device.status()).rf?.state, "on");
    // Firmware without LIGHT OUTPUT: no RF only, and nothing written.
    const plain = rig.writes.length;
    await assert.rejects(device.command("rf", { output: "rf" }), /Update the firmware/);
    await assert.rejects(device.command("preset", { color: "R", output: "rf" }), /Update the firmware/);
    assert.equal(rig.writes.length, plain);
    // Changing RF does not stop the running mode.
    assert.equal((await device.status()).deviceMode, "auto");
    assert.deepEqual(rig.writes.slice(before), ["@RW\n", "@R0\n", "@R1\n"]);
    const written = rig.writes.length;
    for (const payload of [
      undefined,
      {},
      { on: true },
      { output: 1 },
      { output: "RF" },
      { output: "both", extra: 1 },
    ])
      await assert.rejects(device.command("rf", payload), JSON.stringify(payload));
    await assert.rejects(device.command("rfWake", { now: true }));
    assert.equal(rig.writes.length, written);
  } finally {
    await device.close();
    rig.restore();
  }
});

test("each light can go out by IR only, RF only or both, and the board can be set to RF only", async () => {
  let state = "ON";
  const report = () =>
    `RF: ${state}\r\nRF CARRIER: 922.36 MHz 10 dBm\r\nRF KEEP AWAKE: 2000\r\nRF SLEEP AFTER: 300 S\r\nRF FRAMES: 0 SENT 0 FAILED\r\n`;
  const rig = serialRig((command, emit) => {
    if (command === "X")
      emit(
        "AUTO / MUSIC STOPPED\r\nPRESET FRAMES: 1\r\nTIMED LIGHT: READY\r\nSTROBE: READY\r\nCUSTOM LIGHT: READY\r\nRAINBOW: READY\r\nLIGHT OUTPUT: READY\r\n" +
          report(),
      );
    else if (/^@R[012]$/.test(command)) {
      state = { "@R0": "OFF", "@R1": "ON", "@R2": "ONLY" }[command]!;
      emit(report());
    } else if (command === "@RW") emit(state === "OFF" ? report() : `RF WAKE: 35000 MS\r\n${report()}`);
    else {
      const line = command.replace(/\/[IRB]$/, "");
      if (line.startsWith("#")) {
        const token = line[1] === "=" ? line.slice(1, 8) : line[1];
        emit(`Light: ${token} ${line.slice(1 + token.length)}\r\n`);
      }
      else if (line.startsWith(".")) emit(`Flash: ${line.slice(1)}\r\n`);
      else if (line.startsWith("!")) emit(`Strobe: ${line[1]} ${line.slice(2)}\r\n`);
      else if (line.startsWith("~")) emit(`Rainbow: ${line.slice(1).replace(",", " ")}\r\n`);
      else if (/^[RGBYCW]$/.test(line)) emit(`Color sent: ${line}\r\n`);
    }
  });
  const device = new PresetSerialTransport();
  try {
    await device.open();
    for (let attempt = 0; attempt < 20; attempt++) {
      if ((await device.status()).rf?.framesSent !== undefined) break;
      await setImmediate();
    }
    assert.equal((await device.status()).lightOutputSupported, true);
    assert.equal((await device.status()).rf?.sleepAfterS, 300);
    const before = rig.writes.length;
    await device.command("light", { color: "R", ms: 1500, output: "rf" });
    await device.command("preset", { color: "G", output: "ir" });
    await device.command("strobe", { color: "B", ms: 2000, build: false, output: "both" });
    await device.command("rainbow", { ms: 5000, cycleMs: 3000, output: "rf" });
    await device.command("custom", { kind: "light", color: "=844000", ms: 900, output: "ir" });
    // Without an output the line is as before: the board's setting.
    await device.command("light", { color: "Y", ms: 600 });
    await device.command("preset", { color: "C" });
    await device.command("rf", { output: "rf" });
    assert.equal((await device.status()).rf?.state, "only");
    assert.equal((await device.status()).rfSupported, true);
    await device.command("rfWake");
    await device.command("rf", { output: "ir" });
    await assert.rejects(device.command("rfWake"), /Turn RF on/);
    assert.deepEqual(rig.writes.slice(before), [
      "#R1500/R\n",
      ".G/I\n",
      "!B2000/B\n",
      "~5000,3000/R\n",
      "#=844000900/I\n",
      "#Y600\n",
      "C\n",
      "@R2\n",
      "@RW\n",
      "@R0\n",
    ]);
    const written = rig.writes.length;
    for (const [op, payload] of [
      ["light", { color: "R", ms: 1500, output: "RF" }],
      ["light", { color: "R", ms: 1500, output: undefined }],
      ["preset", { color: "M", output: "rf" }],
      ["beat", { color: "R", output: "rf" }],
    ] as const)
      await assert.rejects(device.command(op, payload), `${op} ${JSON.stringify(payload)}`);
    assert.equal(rig.writes.length, written);
    // This rig's firmware prints a sleep time but not RF SLEEP SETTING.
    assert.equal((await device.status()).rfSleepSettingSupported, undefined);
    await assert.rejects(device.command("rfSleep", { seconds: 0 }), /Update the firmware/);
    assert.equal(rig.writes.length, written);
  } finally {
    await device.close();
    rig.restore();
  }
});

test("when RF wristbands may sleep is a board setting: never by default, or after a time", async () => {
  let sleep = "OFF";
  const report = () =>
    `RF: ON\r\nRF CARRIER: 922.36 MHz 10 dBm\r\nRF KEEP AWAKE: 2000\r\nRF SLEEP AFTER: ${sleep}\r\nRF FRAMES: 0 SENT 0 FAILED\r\n`;
  const rig = serialRig((command, emit) => {
    if (command === "X")
      emit(
        "AUTO / MUSIC STOPPED\r\nPRESET FRAMES: 1\r\nLIGHT OUTPUT: READY\r\nRF SLEEP SETTING: READY\r\n" +
          report(),
      );
    else if (/^@RS\d+$/.test(command)) {
      const seconds = Number(command.slice(3));
      sleep = seconds === 0 ? "OFF" : `${seconds} S`;
      emit(report());
    }
  });
  const device = new PresetSerialTransport();
  try {
    await device.open();
    for (let attempt = 0; attempt < 20; attempt++) {
      if ((await device.status()).rf?.framesSent !== undefined) break;
      await setImmediate();
    }
    assert.equal((await device.status()).rfSleepSettingSupported, true);
    assert.equal((await device.status()).rf?.sleepAfterS, 0, "OFF reads as never");
    const before = rig.writes.length;
    await device.command("rfSleep", { seconds: 300 });
    assert.equal((await device.status()).rf?.sleepAfterS, 300);
    await device.command("rfSleep", { seconds: 0 });
    assert.equal((await device.status()).rf?.sleepAfterS, 0);
    assert.deepEqual(rig.writes.slice(before), ["@RS300\n", "@RS0\n"]);
    const written = rig.writes.length;
    for (const payload of [
      { seconds: 59 },
      { seconds: 86401 },
      { seconds: 300.5 },
      { seconds: -60 },
      { seconds: "300" },
      { seconds: 300, extra: 1 },
      {},
      null,
    ])
      await assert.rejects(device.command("rfSleep", payload), JSON.stringify(payload));
    assert.equal(rig.writes.length, written);
  } finally {
    await device.close();
    rig.restore();
  }
});
