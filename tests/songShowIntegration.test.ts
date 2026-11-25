import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { PresetSerialTransport } from "../src/lib/presetSerial.ts";
import { SongCueOutput, SongCueTimeline } from "../src/lib/songShow.ts";
import type { SongShow } from "../src/lib/songShow.ts";
import { initialLighting } from "../src/lib/effects.ts";

function serialRig(
  onWrite?: (command: string, emit: (text: string) => void) => boolean,
) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const writes: string[] = [];
  let reader!: ReadableStreamDefaultController<Uint8Array>;
  const emit = (text: string) => reader.enqueue(new TextEncoder().encode(text));
  const port = {
    readable: new ReadableStream<Uint8Array>({
      start: (value) => {
        reader = value;
      },
    }),
    writable: new WritableStream<Uint8Array>({
      write(bytes) {
        const command = new TextDecoder().decode(bytes).trim();
        writes.push(command);
        if (onWrite?.(command, emit)) return;
        if (command === "X")
          emit("AUTO / MUSIC STOPPED\nCAPABILITIES: BROWSER BEATS\n");
        else if (command === "H") emit("BROWSER SYNC ON\n");
        else if (/^[RGBYCW]$/.test(command)) emit(`Color sent: ${command}\n`);
        else if (command === "+") emit("Sensitivity: 1.25\n");
      },
    }),
    async open(options: { baudRate: number }) {
      assert.equal(options.baudRate, 115200);
    },
    async close() {},
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { serial: { requestPort: async () => port } },
  });
  return {
    writes,
    emit,
    restore() {
      if (descriptor)
        Object.defineProperty(globalThis, "navigator", descriptor);
      else Reflect.deleteProperty(globalThis, "navigator");
    },
  };
}

function cueShow(): SongShow {
  return {
    id: "integration-show",
    name: "Integration",
    cues: [
      {
        id: "open",
        time: 0,
        label: "Open",
        lighting: initialLighting,
        hardwareColor: "R",
      },
      {
        id: "white",
        time: 0.25,
        label: "White",
        lighting: initialLighting,
        hardwareColor: "W",
      },
      {
        id: "missed",
        time: 0.5,
        label: "Missed",
        lighting: initialLighting,
        hardwareColor: "C",
      },
    ],
  };
}

test("song cues use the actual preset adapter's verified manual colors and Host stop barrier", async () => {
  const rig = serialRig();
  const device = new PresetSerialTransport();
  const errors: Error[] = [];
  const output = new SongCueOutput(device, (error) => errors.push(error));
  const timeline = new SongCueTimeline();
  const show = cueShow();
  try {
    await device.open();
    await device.status();
    await device.command("browser");
    output.enable();
    timeline.start(0, true);
    const opening = timeline.advance(show, 0.01)!;
    assert.equal(await output.send(opening.hardwareColor!), true);
    assert.deepEqual(rig.writes, ["X", "H", "X", "R"]);
    const white = timeline.advance(show, 0.26)!;
    assert.equal(await output.send(white.hardwareColor!), true);
    assert.deepEqual(rig.writes, ["X", "H", "X", "R", "W"]);
    assert.equal(
      timeline.advance(show, 1.1),
      null,
      "a suspended view must not replay the missed cyan cue",
    );
    timeline.seek(0.5);
    timeline.start(0.5);
    assert.equal(
      timeline.advance(show, 0.6),
      null,
      "resume must not resend a cue already behind the seek position",
    );
    assert.equal(await output.send("M" as never), false);
    assert.deepEqual(rig.writes, ["X", "H", "X", "R", "W"]);
    await output.stop();
    assert.equal(rig.writes.at(-1), "X");
    assert.deepEqual(errors, []);
  } finally {
    await device.close();
    rig.restore();
  }
});

test("Stop cancels a song cue still waiting in the actual serial adapter queue", async () => {
  const rig = serialRig((command) => command === "+");
  const device = new PresetSerialTransport();
  const errors: Error[] = [];
  const output = new SongCueOutput(device, (error) => errors.push(error));
  try {
    await device.open();
    await device.status();
    const sensitivity = device.command("sensitivity", { direction: "more" });
    for (
      let attempts = 0;
      attempts < 20 && !rig.writes.includes("+");
      attempts++
    )
      await setImmediate();
    assert.deepEqual(rig.writes, ["X", "+"]);
    output.enable();
    const pendingCue = output.send("R");
    // Let send() reach the serial queue, while the unrelated acknowledgment
    // deliberately holds the transport. This cue has not been written yet.
    await setImmediate();
    const stopped = output.stop();
    rig.emit("Sensitivity: 1.25\n");
    await sensitivity;
    assert.equal(await pendingCue, false);
    await stopped;
    assert.deepEqual(
      rig.writes,
      ["X", "+", "X"],
      "a cancelled, not-yet-written cue must never flash after Stop intent",
    );
    assert.equal(output.active, false);
    assert.deepEqual(
      errors,
      [],
      "an old cancelled cue cannot report an error into the stopped show",
    );
  } finally {
    await device.close();
    rig.restore();
  }
});

test("Stop during a song cue's Host exit barrier cancels its not-yet-written color", async () => {
  let holdStop = false;
  const rig = serialRig((command) => command === "X" && holdStop);
  const device = new PresetSerialTransport();
  const errors: Error[] = [];
  const output = new SongCueOutput(device, (error) => errors.push(error));
  try {
    await device.open();
    await device.status();
    await device.command("browser");
    output.enable();
    holdStop = true;
    const pendingCue = output.send("R");
    for (let attempts = 0; attempts < 20 && rig.writes.length < 3; attempts++)
      await setImmediate();
    assert.deepEqual(rig.writes, ["X", "H", "X"]);
    const stopped = output.stop();
    holdStop = false;
    rig.emit("AUTO / MUSIC STOPPED\n");
    assert.equal(await pendingCue, false);
    await stopped;
    assert.deepEqual(
      rig.writes,
      ["X", "H", "X", "X"],
      "the cancelled cue cannot send its color after the Host exit acknowledgement",
    );
    assert.deepEqual(errors, []);
  } finally {
    await device.close();
    rig.restore();
  }
});
