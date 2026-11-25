import type { Lighting } from "./effects";
export type RfState =
  | "on"
  | "off"
  | "only"
  | "not-found"
  | "wire-error"
  | "rmt-error"
  | "setup-error";
/** What one light goes out by: IR and RF, IR only or RF only. */
export type LightOutput = "both" | "ir" | "rf";
export const lightOutputs: readonly LightOutput[] = ["both", "ir", "rf"];
export type Status = {
  name: string;
  firmware: string;
  irConfigured: boolean;
  rfSupported: boolean;
  micAvailable: boolean;
  standaloneEnabled?: boolean;
  irTransmitting?: boolean;
  lastError?: string;
  mode?: "controller" | "microphone-test" | "preset-serial" | "v2-serial";
  deviceMode?: "manual" | "auto" | "music" | "level" | "beat" | "host";
  browserBeatSupported?: boolean;
  lastBeatAt?: number;
  lastColor?: "R" | "G" | "B" | "Y" | "C" | "M" | "W" | "K";
  /** Which waveform the firmware transmits for W; absent when unknown. */
  whitePreset?: "whitish" | "neutral-candidate";
  /** True when the firmware also offers K, the original warm WHITISH frame. */
  legacyWhitishSupported?: boolean;
  /** True when the firmware accepts timed lights (#<color><ms>). */
  timedLightSupported?: boolean;
  /** True when the firmware reports the strobe and build commands. */
  strobeSupported?: boolean;
  /** True when the firmware reports custom colors and fades. */
  customLightSupported?: boolean;
  /** True when the firmware reports the rainbow command. */
  rainbowSupported?: boolean;
  /** True when beats and Auto can use a light style and a color set. */
  beatEffectsSupported?: boolean;
  /**
   * Rainbow while nothing controls the board: 0 off, 1 only from power-on,
   * 2-3600 also after that many idle seconds. Absent when the firmware has
   * no such setting.
   */
  idleRainbow?: number;
  /** True when the firmware can go back to the rainbow after idle seconds. */
  idleReturnSupported?: boolean;
  /**
   * True when a light can be sent by IR only, RF only or both, whatever the
   * board's setting, and the setting can be RF only.
   */
  lightOutputSupported?: boolean;
  /** True when the board takes @RS: when RF bands may be left to sleep. */
  rfSleepSettingSupported?: boolean;
  /**
   * What every light goes out by, as the board reports it: "on" IR and RF,
   * "off" IR only, "only" RF only. Absent when the firmware prints no RF
   * lines. Only these three mean a working radio.
   */
  rf?: {
    state: RfState;
    mhz?: number;
    dbm?: number;
    /** Keep-awake interval between commands; 0 means none. */
    keepAwakeMs?: number;
    /**
     * Seconds after the last light (or wake) when the bands are left to
     * sleep; 0 means never while the board is powered.
     */
    sleepAfterS?: number;
    framesSent?: number;
    framesFailed?: number;
  };
  musicSensitivity?: number;
  completedFrames?: number;
  clipped?: boolean;
  micLevel?: number;
  micRawLevel?: number;
  micInitialized?: boolean;
  micPins?: { bclk: number; ws: number; data: number };
  irPin?: number;
};
export type DeviceAudio = {
  rawLevel: number;
  level: number;
  receivedAt: number;
  format:
    | "mean-absolute-16-bit"
    | "rms-24-bit"
    | "rms-normalized"
    | "bass-envelope-16-bit";
  beat?: boolean;
  threshold?: number;
};
export type IRConfig = {
  carrierHz: number;
  dutyPercent: number;
  repeats: number;
  gapUs: number;
  markFirst: boolean;
  durations: number[];
};
export function validateIR(c: IRConfig) {
  if (!c || typeof c !== "object")
    throw new Error("An IR configuration is required.");
  if (
    !Number.isInteger(c.carrierHz) ||
    c.carrierHz < 20000 ||
    c.carrierHz > 60000
  )
    throw new Error(
      "Carrier must be 20,000–60,000 Hz. This range is an interface limit, not a verified PixMob carrier.",
    );
  if (
    !Number.isFinite(c.dutyPercent) ||
    c.dutyPercent < 10 ||
    c.dutyPercent > 50
  )
    throw new Error("Duty must be 10–50%.");
  if (!Number.isInteger(c.repeats) || c.repeats < 1 || c.repeats > 5)
    throw new Error("Repeats must be 1–5.");
  if (!Number.isInteger(c.gapUs) || c.gapUs < 1000 || c.gapUs > 100000)
    throw new Error("Gap must be 1,000–100,000 µs.");
  if (c.markFirst !== true) throw new Error("Waveform must start with a mark.");
  if (
    !Array.isArray(c.durations) ||
    !c.durations.length ||
    c.durations.length > 512 ||
    c.durations.some((v) => !Number.isInteger(v) || v < 10 || v > 20000) ||
    c.durations.reduce((a, b) => a + b, 0) > 200000
  )
    throw new Error(
      "Use 1–512 alternating mark/space durations, each 10–20,000 µs and total ≤200,000 µs.",
    );
}
function parseStatus(v: unknown): Status {
  const s = v as Status | null;
  if (
    !s ||
    typeof s.name !== "string" ||
    !s.name ||
    typeof s.firmware !== "string" ||
    typeof s.irConfigured !== "boolean" ||
    typeof s.rfSupported !== "boolean" ||
    typeof s.micAvailable !== "boolean" ||
    (s.mode !== undefined &&
      !["controller", "microphone-test"].includes(s.mode)) ||
    (s.micInitialized !== undefined && typeof s.micInitialized !== "boolean") ||
    (s.micLevel !== undefined &&
      (!Number.isFinite(s.micLevel) || s.micLevel < 0 || s.micLevel > 1)) ||
    (s.micRawLevel !== undefined &&
      (!Number.isInteger(s.micRawLevel) ||
        s.micRawLevel < 0 ||
        s.micRawLevel > 8388608)) ||
    (s.irPin !== undefined &&
      (!Number.isInteger(s.irPin) || s.irPin < 0 || s.irPin > 39)) ||
    (s.micPins !== undefined &&
      (!s.micPins ||
        [s.micPins.bclk, s.micPins.ws, s.micPins.data].some(
          (pin) => !Number.isInteger(pin) || pin < 0 || pin > 39,
        )))
  )
    throw new Error("This device does not speak the PixMob Studio API.");
  return s;
}
function validOperation(op: string) {
  if (!/^[a-z]+(?:\/[a-z]+)*$/.test(op))
    throw new Error("Invalid device operation.");
}
export interface DeviceTransport {
  status(): Promise<Status>;
  command(op: string, payload?: unknown): Promise<unknown>;
  close(): Promise<void>;
  subscribeAudio?(listener: (sample: DeviceAudio) => void): () => void;
  subscribeStatus?(listener: (status: Status) => void): () => void;
  /** One byte without acknowledgement that keeps the board from going idle. */
  keepAlive?(): void;
}
export class HttpTransport implements DeviceTransport {
  private requests = new Set<AbortController>();
  constructor(private address: string) {
    const u = new URL(address);
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
      throw new Error(
        "Use an HTTP or HTTPS device address without credentials.",
      );
    this.address = u.origin;
  }
  async command(op: string, payload?: unknown) {
    validOperation(op);
    const controller = new AbortController();
    this.requests.add(controller);
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const r = await fetch(`${this.address}/api/${op}`, {
        method: payload === undefined ? "GET" : "POST",
        headers:
          payload === undefined ? {} : { "Content-Type": "application/json" },
        body: payload === undefined ? undefined : JSON.stringify(payload),
        signal: controller.signal,
      });
      let value: unknown;
      try {
        value = await r.json();
      } catch {
        throw new Error(
          `Device returned an invalid JSON response (${r.status}).`,
        );
      }
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Device returned an invalid API response.");
      const error = (value as { error?: unknown }).error;
      if (!r.ok || error)
        throw new Error(
          typeof error === "string" ? error : `Device returned ${r.status}`,
        );
      return value;
    } finally {
      clearTimeout(timer);
      this.requests.delete(controller);
    }
  }
  async status(): Promise<Status> {
    return parseStatus(await this.command("status"));
  }
  async close() {
    this.requests.forEach((c) => c.abort());
    this.requests.clear();
  }
}
// Kept local so mobile browsers do not need a Web Serial polyfill.
type Port = {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  open(o: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
};
export function hasSerial() {
  return (
    typeof navigator !== "undefined" &&
    "serial" in navigator &&
    typeof window !== "undefined" &&
    window.isSecureContext
  );
}
export class SerialTransport implements DeviceTransport {
  private port: Port | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private buffer = "";
  private seq = 0;
  private readTask: Promise<void> | null = null;
  private connected = false;
  private microphoneTest = false;
  private microphoneTestKind: "microphone" | "music-sync" = "microphone";
  private controllerConfirmed = false;
  private latestAudio: DeviceAudio | null = null;
  private audioListeners = new Set<(sample: DeviceAudio) => void>();
  private pending = new Map<
    number,
    {
      resolve: (v: unknown) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
      fallbackTimer?: ReturnType<typeof setTimeout>;
      op: string;
    }
  >();
  async open() {
    if (this.port) throw new Error("Serial port is already open.");
    const serial = (
      globalThis.navigator as Navigator & {
        serial?: { requestPort(): Promise<Port> };
      }
    )?.serial;
    if (!serial)
      throw new Error(
        "Web Serial is unavailable in this browser. Use a compatible desktop browser or local Wi-Fi.",
      );
    const port = await serial.requestPort();
    this.port = port;
    try {
      await port.open({ baudRate: 115200 });
      if (!port.readable || !port.writable)
        throw new Error("Serial port has no readable or writable stream.");
      this.reader = port.readable.getReader();
      this.writer = port.writable.getWriter();
      this.connected = true;
      this.buffer = "";
      this.microphoneTest = false;
      this.microphoneTestKind = "microphone";
      this.controllerConfirmed = false;
      this.latestAudio = null;
      this.readTask = this.readLoop(this.reader);
    } catch (e) {
      await this.close().catch(() => {});
      throw e;
    }
  }
  private rejectPending() {
    this.pending.forEach((p) => {
      clearTimeout(p.timer);
      clearTimeout(p.fallbackTimer);
      p.reject(new Error("Serial connection closed."));
    });
    this.pending.clear();
  }
  subscribeAudio(listener: (sample: DeviceAudio) => void) {
    this.audioListeners.add(listener);
    if (this.connected && this.latestAudio) listener(this.latestAudio);
    return () => this.audioListeners.delete(listener);
  }
  private hasRecentAudio(format?: DeviceAudio["format"]) {
    return (
      this.connected &&
      this.latestAudio !== null &&
      (format === undefined || this.latestAudio.format === format) &&
      Date.now() - this.latestAudio.receivedAt < 2000
    );
  }
  private microphoneStatus(): Status {
    const musicSync = this.microphoneTestKind === "music-sync";
    return {
      name: musicSync ? "ESP32 music sync test" : "ESP32 microphone test",
      firmware: musicSync
        ? "music-sync-test (unversioned)"
        : "microphone-test (unversioned)",
      mode: "microphone-test",
      irConfigured: false,
      rfSupported: false,
      micAvailable: this.hasRecentAudio(),
      micLevel: this.latestAudio?.level ?? 0,
      micRawLevel: this.latestAudio?.rawLevel ?? 0,
      standaloneEnabled: false,
    };
  }
  private resolveMicrophoneFallback(id: number) {
    if (
      this.controllerConfirmed ||
      !this.hasRecentAudio("mean-absolute-16-bit")
    )
      return false;
    const pending = this.pending.get(id);
    if (!pending || pending.op !== "status") return false;
    this.microphoneTest = true;
    clearTimeout(pending.timer);
    clearTimeout(pending.fallbackTimer);
    this.pending.delete(id);
    pending.resolve(this.microphoneStatus());
    return true;
  }
  private acceptAudioLine(line: string) {
    // Recognize the exact text telemetry from the user's test sketches.
    // Observed samples establish read-only telemetry, never a lighting API.
    if (this.controllerConfirmed) return false;
    const match = /^Sound Level: (0|[1-9]\d{0,4})\r?$/.exec(line);
    const musicMatch =
      /^Level:(0|[1-9]\d{0,4}) Threshold:(0|[1-9]\d{0,4}) Beat:([01])\r?$/.exec(
        line,
      );
    if (!match && !musicMatch) return false;
    const rawLevel = Number((match ?? musicMatch)![1]);
    if (rawLevel > 32768) return false;
    const threshold = musicMatch ? Number(musicMatch[2]) : undefined;
    if (threshold !== undefined && threshold > 65535) return false;
    this.microphoneTestKind = musicMatch ? "music-sync" : "microphone";
    const sample: DeviceAudio = {
      rawLevel,
      level: rawLevel / 32768,
      receivedAt: Date.now(),
      format: "mean-absolute-16-bit",
      ...(musicMatch ? { threshold, beat: musicMatch[3] === "1" } : {}),
    };
    this.publishAudio(sample);
    return true;
  }
  private acceptControllerAudio(value: unknown) {
    if (!value || typeof value !== "object") return false;
    const v = value as {
      event?: unknown;
      format?: unknown;
      micLevel?: unknown;
      micRawLevel?: unknown;
    };
    if (
      v.event !== "audio" ||
      v.format !== "rms-24-bit" ||
      typeof v.micLevel !== "number" ||
      !Number.isFinite(v.micLevel) ||
      v.micLevel < 0 ||
      v.micLevel > 1 ||
      typeof v.micRawLevel !== "number" ||
      !Number.isInteger(v.micRawLevel) ||
      v.micRawLevel < 0 ||
      v.micRawLevel > 8388608
    )
      return false;
    this.publishAudio({
      rawLevel: v.micRawLevel,
      level: v.micLevel,
      receivedAt: Date.now(),
      format: "rms-24-bit",
    });
    return true;
  }
  private publishAudio(sample: DeviceAudio) {
    this.latestAudio = sample;
    for (const listener of this.audioListeners) {
      try {
        listener(sample);
      } catch {
        // A subscriber must not interrupt device parsing or lock cleanup.
      }
    }
  }
  private async readLoop(reader: ReadableStreamDefaultReader<Uint8Array>) {
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        this.buffer += decoder.decode(value, { stream: true });
        let end;
        while ((end = this.buffer.indexOf("\n")) >= 0) {
          const line = this.buffer.slice(0, end);
          this.buffer = this.buffer.slice(end + 1);
          if (this.acceptAudioLine(line)) continue;
          try {
            const msg = JSON.parse(line);
            if (this.acceptControllerAudio(msg)) continue;
            if (!msg || typeof msg !== "object" || !Number.isInteger(msg.id))
              continue;
            const p = this.pending.get(msg.id);
            if (p) {
              clearTimeout(p.timer);
              clearTimeout(p.fallbackTimer);
              this.pending.delete(msg.id);
              typeof msg.error === "string"
                ? p.reject(new Error(msg.error))
                : p.resolve(msg);
            }
          } catch {
            /* Boot messages are not protocol responses. */
          }
        }
        if (this.buffer.length > 8192) this.buffer = "";
      }
    } catch {
      /* Pending requests below receive a connection error. */
    } finally {
      this.connected = false;
      this.rejectPending();
      reader.releaseLock();
      if (this.reader === reader) this.reader = null;
    }
  }
  async command(op: string, payload?: unknown): Promise<unknown> {
    validOperation(op);
    const writer = this.writer;
    if (!writer || !this.connected) throw new Error("Serial is disconnected.");
    if (this.microphoneTest) {
      if (op === "status") return this.microphoneStatus();
      throw new Error(
        "The microphone-test sketch is read-only. Install the controller firmware to use device control commands.",
      );
    }
    const id = ++this.seq;
    const bytes = new TextEncoder().encode(
      JSON.stringify({ id, op, payload }) + "\n",
    );
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (op === "status" && this.resolveMicrophoneFallback(id)) return;
        const pending = this.pending.get(id);
        clearTimeout(pending?.fallbackTimer);
        this.pending.delete(id);
        reject(new Error("Device response timed out."));
      }, 4000);
      const fallbackTimer =
        op === "status" && !this.controllerConfirmed
          ? setTimeout(() => this.resolveMicrophoneFallback(id), 1000)
          : undefined;
      this.pending.set(id, { resolve, reject, timer, fallbackTimer, op });
      writer.write(bytes).catch((e) => {
        clearTimeout(timer);
        clearTimeout(fallbackTimer);
        this.pending.delete(id);
        reject(e);
      });
    });
  }
  async status(): Promise<Status> {
    const result = parseStatus(await this.command("status"));
    if (result.mode !== "microphone-test") this.controllerConfirmed = true;
    return result;
  }
  async close() {
    this.connected = false;
    this.latestAudio = null;
    this.audioListeners.clear();
    this.rejectPending();
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
    }
  }
}
// Deliberately no frequency, packet format or module assumed.
export interface RFAdapter {
  readonly verifiedProtocol: string;
  sendVerifiedPacket(packet: Uint8Array): Promise<void>;
}
export interface LightingEncoder {
  encode(state: Lighting): IRConfig;
}
