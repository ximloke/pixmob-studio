import type { DeviceAudio, DeviceTransport, Status } from "./device";

export type V2DeviceStatus = {
  mode: "manual" | "auto" | "level" | "beat";
  sensitivity: number;
  rms: number;
  micOk: boolean;
  clip: boolean;
  busy: boolean;
  color: "-" | "R" | "G" | "B" | "Y" | "C" | "M" | "W";
  frames: number;
  clients: number;
};

const statusKeys = [
  "mode",
  "sensitivity",
  "rms",
  "micOk",
  "clip",
  "busy",
  "color",
  "frames",
  "clients",
];
const uint32 = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= 0xffffffff;

export function parseV2Status(input: string): V2DeviceStatus | null {
  try {
    const value = JSON.parse(input) as V2DeviceStatus | null;
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).length !== statusKeys.length ||
      !statusKeys.every((key) => Object.hasOwn(value, key)) ||
      !["manual", "auto", "level", "beat"].includes(value.mode) ||
      !Number.isInteger(value.sensitivity) ||
      value.sensitivity < 1 ||
      value.sensitivity > 100 ||
      typeof value.rms !== "number" ||
      !Number.isFinite(value.rms) ||
      value.rms < 0 ||
      value.rms > 1 ||
      typeof value.micOk !== "boolean" ||
      typeof value.clip !== "boolean" ||
      typeof value.busy !== "boolean" ||
      !["-", "R", "G", "B", "Y", "C", "M", "W"].includes(value.color) ||
      !uint32(value.frames) ||
      !uint32(value.clients)
    )
      return null;
    return value;
  } catch {
    return null;
  }
}

type Port = {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
};
export type V2SerialOptions = {
  commandTimeoutMs?: number;
  handshakeTimeoutMs?: number;
  handshakeRetryMs?: number;
  pollIntervalMs?: number;
};
type Pending = {
  kind: "status" | "ack";
  resolve: (value: V2DeviceStatus | null) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  retryTimer?: ReturnType<typeof setTimeout>;
};
type V2Command =
  | { kind: "literal"; line: string }
  | { kind: "sensitivity"; direction: "more" | "less" };

function noPayload(payload: unknown) {
  if (payload !== undefined)
    throw new Error("This V2 command takes no parameters.");
}
function exactObject(payload: unknown, key: string): Record<string, unknown> {
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    Object.keys(payload).length !== 1 ||
    !Object.hasOwn(payload, key)
  )
    throw new Error("Invalid V2 command parameters.");
  return payload as Record<string, unknown>;
}
function toCommand(op: string, payload: unknown): V2Command {
  if (op === "preset") {
    const { color } = exactObject(payload, "color");
    if (
      typeof color !== "string" ||
      !["R", "G", "B", "Y", "C", "M", "W"].includes(color)
    )
      throw new Error("Choose a V2 preset: R, G, B, Y, C, M or W.");
    return { kind: "literal", line: color };
  }
  if (op === "sensitivity") {
    const { direction } = exactObject(payload, "direction");
    if (direction !== "more" && direction !== "less")
      throw new Error("Choose more or less microphone sensitivity.");
    return { kind: "sensitivity", direction };
  }
  if (op === "music") {
    const mode =
      payload === undefined ? "beat" : exactObject(payload, "mode").mode;
    if (mode !== "level" && mode !== "beat")
      throw new Error("Choose level or beat music synchronization.");
    return {
      kind: "literal",
      line: mode === "level" ? "MIC LEVEL" : "MIC BEAT",
    };
  }
  if (op === "auto" || op === "stop") {
    noPayload(payload);
    return { kind: "literal", line: op === "auto" ? "AUTO ON" : "STOP" };
  }
  throw new Error(
    "V2 supports preset colors, Auto, music Level/Beat, Stop and relative sensitivity only.",
  );
}

// Select this adapter explicitly. STATUS is harmless to this line-command V2
// firmware, but its letters are lighting commands in the older character sketch.
export class V2SerialTransport implements DeviceTransport {
  private port: Port | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private readTask: Promise<void> | null = null;
  private connected = false;
  private confirmed = false;
  private fault: string | undefined;
  private generation = 0;
  private queue: Promise<void> = Promise.resolve();
  private statusTask: Promise<Status> | null = null;
  private pending: Pending | null = null;
  private latest: V2DeviceStatus | null = null;
  private latestAt = 0;
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private staleTimer: ReturnType<typeof setTimeout> | undefined;
  private audioListeners = new Set<(sample: DeviceAudio) => void>();
  private statusListeners = new Set<(status: Status) => void>();
  private readonly timing: Required<V2SerialOptions>;

  constructor(options: V2SerialOptions = {}) {
    this.timing = {
      commandTimeoutMs: options.commandTimeoutMs ?? 2500,
      handshakeTimeoutMs: options.handshakeTimeoutMs ?? 4500,
      handshakeRetryMs: options.handshakeRetryMs ?? 1800,
      pollIntervalMs: options.pollIntervalMs ?? 250,
    };
    if (
      Object.entries(this.timing).some(
        ([key, value]) =>
          !Number.isFinite(value) ||
          value < (key === "pollIntervalMs" ? 0 : 1) ||
          value > 10000,
      )
    )
      throw new Error(
        "Serial timing must be within 1–10,000 ms; polling may be zero to disable it.",
      );
  }
  async open() {
    if (this.port) throw new Error("Serial port is already open.");
    const serial = (
      globalThis.navigator as Navigator & {
        serial?: { requestPort(): Promise<Port> };
      }
    )?.serial;
    if (!serial)
      throw new Error(
        "Web Serial is unavailable. Use a compatible desktop browser on localhost.",
      );
    this.port = await serial.requestPort();
    try {
      await this.port.open({ baudRate: 115200 });
      if (!this.port.readable || !this.port.writable)
        throw new Error("Serial port has no readable or writable stream.");
      this.reader = this.port.readable.getReader();
      this.writer = this.port.writable.getWriter();
      this.connected = true;
      this.confirmed = false;
      this.fault = undefined;
      this.generation++;
      this.queue = Promise.resolve();
      this.statusTask = null;
      this.latest = null;
      this.latestAt = 0;
      this.readTask = this.readLoop(this.reader);
    } catch (error) {
      await this.close().catch(() => {});
      throw error;
    }
  }
  subscribeAudio(listener: (sample: DeviceAudio) => void) {
    this.audioListeners.add(listener);
    if (this.fresh() && this.latest!.micOk) listener(this.audio(this.latest!));
    return () => this.audioListeners.delete(listener);
  }
  subscribeStatus(listener: (status: Status) => void) {
    this.statusListeners.add(listener);
    if (this.confirmed) listener(this.snapshot());
    return () => this.statusListeners.delete(listener);
  }
  private fresh() {
    return (
      this.connected &&
      this.confirmed &&
      !this.fault &&
      this.latest !== null &&
      Date.now() - this.latestAt < 2000
    );
  }
  private audio(value: V2DeviceStatus): DeviceAudio {
    return {
      rawLevel: value.rms,
      level: value.rms,
      receivedAt: this.latestAt,
      format: "rms-normalized",
    };
  }
  private snapshot(): Status {
    const value = this.latest;
    const active = this.connected && this.confirmed && !this.fault;
    const mic = !!this.fresh() && !!value?.micOk;
    return {
      name: "ESP32 PixMob Studio V2",
      firmware: "Wi-Fi V2 serial (unversioned)",
      mode: "v2-serial",
      irConfigured: !!active,
      rfSupported: false,
      micAvailable: mic,
      micInitialized: !!active && !!value?.micOk,
      micPins: { bclk: 26, ws: 25, data: 27 },
      irPin: 32,
      micLevel: mic ? value!.rms : 0,
      standaloneEnabled:
        !!active && (value?.mode === "level" || value?.mode === "beat"),
      irTransmitting: !!active && !!value?.busy,
      ...(value
        ? {
            deviceMode: value.mode,
            musicSensitivity: value.sensitivity,
            completedFrames: value.frames,
            clipped: mic && value.clip,
            ...(value.color === "-" ? {} : { lastColor: value.color }),
          }
        : {}),
      ...(this.fault ? { lastError: this.fault } : {}),
    };
  }
  private publishStatus() {
    const value = this.snapshot();
    for (const listener of this.statusListeners) {
      try {
        listener(value);
      } catch {
        /* Subscribers cannot interrupt serial cleanup. */
      }
    }
  }
  private publishAudio(value: V2DeviceStatus) {
    if (!value.micOk) return;
    const sample = this.audio(value);
    for (const listener of this.audioListeners) {
      try {
        listener(sample);
      } catch {
        /* Subscribers cannot interrupt serial parsing. */
      }
    }
  }
  private finishPending(error?: Error, value: V2DeviceStatus | null = null) {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    clearTimeout(pending.timer);
    clearTimeout(pending.retryTimer);
    if (error) pending.reject(error);
    else pending.resolve(value);
  }
  private stopTimers() {
    clearTimeout(this.pollTimer);
    clearTimeout(this.staleTimer);
  }
  private fail(message: string) {
    this.fault = message;
    this.confirmed = false;
    this.stopTimers();
    this.finishPending(new Error(message));
    this.publishStatus();
  }
  private acceptLine(input: string) {
    const line = input.endsWith("\r") ? input.slice(0, -1) : input;
    if (line.startsWith("PixMob Studio V2: ") && this.confirmed) {
      this.fail("ESP32 restarted. Reconnect before sending more commands.");
      return;
    }
    if (line === "OK") {
      if (this.pending?.kind === "ack") this.finishPending();
      return;
    }
    if (line === "ERR command" || line === "ERR line too long") {
      if (this.pending)
        this.finishPending(new Error("ESP32 rejected the V2 command."));
      return;
    }
    const value = parseV2Status(line);
    if (!value || this.fault) return;
    // Only a response to our serialized STATUS query can establish/update state.
    // Boot output, OK and foreign JSON never establish this protocol.
    if (this.pending?.kind !== "status") return;
    this.latest = value;
    this.latestAt = Date.now();
    this.confirmed = true;
    clearTimeout(this.staleTimer);
    this.staleTimer = setTimeout(() => this.publishStatus(), 2001);
    this.publishAudio(value);
    this.publishStatus();
    this.finishPending(undefined, value);
  }
  private async readLoop(reader: ReadableStreamDefaultReader<Uint8Array>) {
    let buffer = "";
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let end: number;
        while ((end = buffer.indexOf("\n")) >= 0) {
          this.acceptLine(buffer.slice(0, end));
          buffer = buffer.slice(end + 1);
        }
        if (buffer.length > 8192) buffer = "";
      }
    } catch {
      this.fault ??= "Serial connection lost. Reconnect the ESP32.";
    } finally {
      if (this.connected)
        this.fault ??= "Serial connection closed. Reconnect the ESP32.";
      this.connected = false;
      this.confirmed = false;
      this.generation++;
      this.stopTimers();
      this.finishPending(new Error("Serial connection closed."));
      reader.releaseLock();
      if (this.reader === reader) this.reader = null;
      this.publishStatus();
    }
  }
  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const generation = this.generation;
    const task = this.queue.then(() => {
      if (!this.connected || generation !== this.generation)
        throw new Error("Serial is disconnected.");
      if (this.fault) throw new Error(this.fault);
      return action();
    });
    this.queue = task.then(
      () => {},
      () => {},
    );
    return task;
  }
  private request(
    line: string,
    kind: Pending["kind"],
    handshake = false,
  ): Promise<V2DeviceStatus | null> {
    const writer = this.writer;
    if (!writer || !this.connected)
      return Promise.reject(new Error("Serial is disconnected."));
    return new Promise((resolve, reject) => {
      const bytes = new TextEncoder().encode(line + "\n");
      const send = () => {
        writer
          .write(bytes)
          .catch(() =>
            this.fail("Could not write to the ESP32. Reconnect the device."),
          );
      };
      const timer = setTimeout(
        () =>
          this.fail(
            handshake
              ? "No valid Wi-Fi V2 status response. Select the firmware protocol installed on the ESP32, then reconnect."
              : "ESP32 response timed out. Reconnect before sending more commands.",
          ),
        handshake
          ? this.timing.handshakeTimeoutMs
          : this.timing.commandTimeoutMs,
      );
      this.pending = { kind, resolve, reject, timer };
      if (handshake)
        this.pending.retryTimer = setTimeout(
          send,
          this.timing.handshakeRetryMs,
        );
      send();
    });
  }
  private schedulePoll() {
    clearTimeout(this.pollTimer);
    if (
      !this.timing.pollIntervalMs ||
      !this.connected ||
      !this.confirmed ||
      this.fault
    )
      return;
    // Recursive scheduling starts the next interval only after the last query
    // completed, so a slow serial port cannot accumulate polling work.
    this.pollTimer = setTimeout(() => {
      this.status()
        .catch(() => {})
        .finally(() => this.schedulePoll());
    }, this.timing.pollIntervalMs);
  }
  async status(): Promise<Status> {
    if (!this.connected) throw new Error("Serial is disconnected.");
    if (this.fault) throw new Error(this.fault);
    if (!this.statusTask) {
      this.statusTask = this.enqueue(async () => {
        await this.request("STATUS", "status", !this.confirmed);
        return this.snapshot();
      }).finally(() => {
        this.statusTask = null;
        this.schedulePoll();
      });
    }
    return this.statusTask;
  }
  async command(op: string, payload?: unknown): Promise<unknown> {
    if (op === "status") {
      noPayload(payload);
      return this.status();
    }
    const command = toCommand(op, payload);
    if (!this.confirmed) await this.status();
    return this.enqueue(async () => {
      const line =
        command.kind === "sensitivity"
          ? `SENS ${Math.max(1, Math.min(100, this.latest!.sensitivity + (command.direction === "more" ? 5 : -5)))}`
          : command.line;
      await this.request(line, "ack");
      // OK acknowledges dispatch only. The worker updates color/frame count
      // asynchronously; render only the values returned by STATUS and polling.
      await this.request("STATUS", "status");
      return this.snapshot();
    });
  }
  async close() {
    this.connected = false;
    this.confirmed = false;
    this.generation++;
    this.stopTimers();
    this.finishPending(new Error("Serial connection closed."));
    const reader = this.reader;
    const task = this.readTask;
    this.readTask = null;
    try {
      await reader?.cancel();
    } finally {
      await task;
      this.writer?.releaseLock();
      this.writer = null;
      const port = this.port;
      this.port = null;
      await port?.close();
      this.audioListeners.clear();
      this.statusListeners.clear();
    }
  }
}
