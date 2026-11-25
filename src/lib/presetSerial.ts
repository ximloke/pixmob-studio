import { lightOutputs } from "./device";
import type {
  DeviceAudio,
  DeviceTransport,
  LightOutput,
  RfState,
  Status,
} from "./device";

export type PresetColor = "R" | "G" | "B" | "Y" | "C" | "M" | "W" | "K";
export type PresetMode = "manual" | "auto" | "music" | "host";
/** Bounds of the firmware's timed light command, in milliseconds. */
export const MIN_LIGHT_MS = 50;
export const MAX_LIGHT_MS = 600000;
/** Bounds of the firmware's strobe and build commands, in milliseconds. */
export const MIN_STROBE_MS = 200;
export const MAX_STROBE_MS = 60000;
/** Bounds of the firmware's rainbow command, in milliseconds. */
export const MIN_RAINBOW_MS = 500;
export const MAX_RAINBOW_MS = 600000;
export const MIN_RAINBOW_CYCLE_MS = 1000;
export const MAX_RAINBOW_CYCLE_MS = 20000;
export type CustomKind = "flash" | "light" | "strobe" | "build";
/**
 * The RF carriers the firmware may use (firmware/PixMobRFTest/PixMobRFLimits.h:
 * inside Malaysia's 433-435 and 919-923 MHz short-range bands) and its power cap.
 */
export const MAX_RF_DBM = 10;
export function validRfMhz(mhz: number) {
  return (mhz >= 433.1 && mhz <= 434.7) || (mhz >= 919.1 && mhz <= 922.9);
}
/** Browser beat digits 1 to 8, in this order; 4 to 8 need BEAT EFFECTS. */
const BEAT_COLORS = ["R", "G", "B", "Y", "C", "M", "W", "K"];
const colorToken = "[RGBYCMWK]|=[0-9A-F]{6}";
/** Levels of =RRGGBB are each at most 200 and not all near zero. */
function validColorToken(token: string) {
  if (!token.startsWith("=")) return /^[RGBYCMWK]$/.test(token);
  if (!/^=[0-9A-F]{6}$/.test(token)) return false;
  const levels = [1, 3, 5].map((at) => parseInt(token.slice(at, at + 2), 16));
  return levels.every((level) => level <= 200) && Math.max(...levels) >= 8;
}
export type PresetSerialEvent =
  | { type: "ready"; variant?: "bass" }
  | { type: "format"; format: "bass-envelope-16-bit" }
  | { type: "capability"; browserBeats: true }
  | { type: "white"; neutralCandidate: true; legacyWhitish: "K" }
  | { type: "timedLight"; ready: true }
  | { type: "light"; color: PresetColor; ms: number }
  | { type: "strobeReady"; ready: true }
  | { type: "strobe"; color: PresetColor; ms: number; build: boolean }
  | { type: "customReady"; ready: true }
  | { type: "rainbowReady"; ready: true }
  | { type: "beatEffectsReady"; ready: true }
  | {
      type: "beatStyle";
      kind: "flash" | "light" | "strobe";
      ms: number;
      fadeIn: number;
      fadeOut: number;
    }
  | { type: "beatPalette"; colors: string }
  /**
   * Rainbow while nothing controls the board; kept by the board. 0 off,
   * 1 only from power-on, 2-3600 also after that many idle seconds.
   */
  | { type: "idleRainbow"; seconds: number }
  /** Firmware that can return to the rainbow after idle seconds. */
  | { type: "idleReturnReady"; ready: true }
  /** A browser beat sent with custom levels, =RRGGBB. */
  | { type: "beatCustom"; color: string }
  | { type: "rainbow"; ms: number; cycleMs: number }
  /** What lights go out by (on, off = IR only, only = RF only), or why the radio is unavailable. */
  | { type: "rf"; state: RfState }
  /** Firmware that takes /I, /R or /B after a light, and @R2. */
  | { type: "lightOutputReady"; ready: true }
  /** Firmware that takes @RS, when RF bands may be left to sleep. */
  | { type: "rfSleepSettingReady"; ready: true }
  | { type: "rfCarrier"; mhz: number; dbm: number }
  | { type: "rfKeepAwake"; ms: number }
  /** Seconds after the last light before RF bands are left to sleep; 0 never. */
  | { type: "rfSleepAfter"; seconds: number }
  | { type: "rfFrames"; sent: number; failed: number }
  | { type: "rfWake"; ms: number }
  | {
      type: "custom";
      kind: CustomKind;
      /** A preset letter or =RRGGBB. */
      color: string;
      ms: number;
      fadeIn: number;
      fadeOut: number;
    }
  | { type: "audio"; rawLevel: number; threshold: number }
  | { type: "color"; color: PresetColor; beat: boolean }
  | { type: "mode"; mode: PresetMode }
  | { type: "sensitivity"; value: number }
  | { type: "error"; message: string };

// This is the exact text protocol in the user's preset sketch. In particular,
// M is Music, not a manual magenta command, and X does not transmit lights-off.
/** 0 off, 1 only from power-on, 2-3600 also after that many idle seconds. */
export const MAX_IDLE_RAINBOW_SECONDS = 3600;
export function validIdleSeconds(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_IDLE_RAINBOW_SECONDS
  );
}

export function parsePresetLine(input: string): PresetSerialEvent | null {
  const line = input.endsWith("\r") ? input.slice(0, -1) : input;
  if (line === "PIXMOB STUDIO V2 READY!") return { type: "ready" };
  if (line === "PIXMOB BEAT CONTROLLER READY!")
    return { type: "ready", variant: "bass" };
  if (line === "AUDIO FORMAT: BASS ENVELOPE 16-BIT")
    return { type: "format", format: "bass-envelope-16-bit" };
  if (line === "CAPABILITIES: BROWSER BEATS")
    return { type: "capability", browserBeats: true };
  // Only the derived build with the neutral-white candidate prints this exact
  // line. Without it, W is the sketch's original warm WHITISH frame.
  if (line === "WHITE PRESET: NEUTRAL CANDIDATE (K = WHITISH)")
    return { type: "white", neutralCandidate: true, legacyWhitish: "K" };
  // Firmware with the timed light command (#<color><ms>) prints this line and
  // acknowledges each light once, after its first frame.
  if (line === "TIMED LIGHT: READY") return { type: "timedLight", ready: true };
  const light = /^Light: ([RGBYCMWK]) ([1-9]\d{1,5})$/.exec(line);
  if (light) {
    const ms = Number(light[2]);
    return ms >= MIN_LIGHT_MS && ms <= MAX_LIGHT_MS
      ? { type: "light", color: light[1] as PresetColor, ms }
      : null;
  }
  // Firmware with the strobe commands (!<color><ms>, ^<color><ms>) prints this
  // line and acknowledges each strobe once, after its first flash.
  if (line === "STROBE: READY") return { type: "strobeReady", ready: true };
  const strobe = /^(Strobe|Build): ([RGBYCMWK]) ([1-9]\d{2,4})$/.exec(line);
  if (strobe) {
    const ms = Number(strobe[3]);
    return ms >= MIN_STROBE_MS && ms <= MAX_STROBE_MS
      ? {
          type: "strobe",
          color: strobe[2] as PresetColor,
          ms,
          build: strobe[1] === "Build",
        }
      : null;
  }
  // Firmware with custom colors, the "." flash and fade codes prints this
  // line. Its acknowledgements carry the color token and any fade codes.
  if (line === "CUSTOM LIGHT: READY") return { type: "customReady", ready: true };
  const customFlash = new RegExp(`^Flash: (${colorToken})$`).exec(line);
  if (customFlash)
    return validColorToken(customFlash[1])
      ? {
          type: "custom",
          kind: "flash",
          color: customFlash[1],
          ms: 0,
          fadeIn: 0,
          fadeOut: 0,
        }
      : null;
  const customLight = new RegExp(
    `^Light: (${colorToken}) ([1-9]\\d{1,5})(?: ([0-7]) ([0-7]))?$`,
  ).exec(line);
  if (customLight) {
    const ms = Number(customLight[2]);
    return validColorToken(customLight[1]) &&
      ms >= MIN_LIGHT_MS &&
      ms <= MAX_LIGHT_MS
      ? {
          type: "custom",
          kind: "light",
          color: customLight[1],
          ms,
          fadeIn: Number(customLight[3] ?? 0),
          fadeOut: Number(customLight[4] ?? 0),
        }
      : null;
  }
  const customStrobe = new RegExp(
    `^(Strobe|Build): (${colorToken}) ([1-9]\\d{2,4})$`,
  ).exec(line);
  if (customStrobe) {
    const ms = Number(customStrobe[3]);
    return validColorToken(customStrobe[2]) &&
      ms >= MIN_STROBE_MS &&
      ms <= MAX_STROBE_MS
      ? {
          type: "custom",
          kind: customStrobe[1] === "Build" ? "build" : "strobe",
          color: customStrobe[2],
          ms,
          fadeIn: 0,
          fadeOut: 0,
        }
      : null;
  }
  // Firmware whose Auto, Music and Browser beats can use a light style and a
  // color set prints this line; each @ setting is echoed back.
  if (line === "BEAT EFFECTS: READY")
    return { type: "beatEffectsReady", ready: true };
  if (line === "IDLE RETURN: READY")
    return { type: "idleReturnReady", ready: true };
  if (line === "LIGHT OUTPUT: READY")
    return { type: "lightOutputReady", ready: true };
  if (line === "RF SLEEP SETTING: READY")
    return { type: "rfSleepSettingReady", ready: true };
  if (line === "IDLE RAINBOW: ON") return { type: "idleRainbow", seconds: 1 };
  if (line === "IDLE RAINBOW: OFF") return { type: "idleRainbow", seconds: 0 };
  const idleReturn = /^IDLE RAINBOW: ON ([1-9]\d{0,3})$/.exec(line);
  if (idleReturn) {
    const seconds = Number(idleReturn[1]);
    return validIdleSeconds(seconds) && seconds >= 2
      ? { type: "idleRainbow", seconds }
      : null;
  }
  if (line === "BEAT STYLE: F")
    return { type: "beatStyle", kind: "flash", ms: 0, fadeIn: 0, fadeOut: 0 };
  const beatLight = /^BEAT STYLE: L ([1-9]\d{1,4}) ([0-7]) ([0-7])$/.exec(line);
  if (beatLight)
    return {
      type: "beatStyle",
      kind: "light",
      ms: Number(beatLight[1]),
      fadeIn: Number(beatLight[2]),
      fadeOut: Number(beatLight[3]),
    };
  const beatStrobe = /^BEAT STYLE: S ([1-9]\d{2,3})$/.exec(line);
  if (beatStrobe)
    return {
      type: "beatStyle",
      kind: "strobe",
      ms: Number(beatStrobe[1]),
      fadeIn: 0,
      fadeOut: 0,
    };
  const beatPalette = /^BEAT PALETTE: (DEFAULT|[RGBYCMWK]{1,8})$/.exec(line);
  if (beatPalette)
    return {
      type: "beatPalette",
      colors: beatPalette[1] === "DEFAULT" ? "" : beatPalette[1],
    };
  // Firmware with the rainbow command (~<ms>,<cycle>) prints this line.
  if (line === "RAINBOW: READY") return { type: "rainbowReady", ready: true };
  const rainbow = /^Rainbow: ([1-9]\d{2,5}) ([1-9]\d{3,4})$/.exec(line);
  if (rainbow) {
    const ms = Number(rainbow[1]);
    const cycleMs = Number(rainbow[2]);
    return ms >= MIN_RAINBOW_MS &&
      ms <= MAX_RAINBOW_MS &&
      cycleMs >= MIN_RAINBOW_CYCLE_MS &&
      cycleMs <= MAX_RAINBOW_CYCLE_MS
      ? { type: "rainbow", ms, cycleMs }
      : null;
  }
  // Firmware with the RF copy prints these after its other metadata and
  // after every @R setting (firmware/PixMobBeatController printRf).
  const rfStates: Record<string, RfState> = {
    "RF: ON": "on",
    "RF: OFF": "off",
    "RF: ONLY": "only",
    "RF: NOT FOUND": "not-found",
    "RF: ERROR GDO0 WIRE": "wire-error",
    "RF: ERROR RMT": "rmt-error",
    "RF: ERROR SETUP": "setup-error",
  };
  if (Object.hasOwn(rfStates, line)) return { type: "rf", state: rfStates[line] };
  const rfCarrier = /^RF CARRIER: (\d{3}\.\d{2}) MHz (0|-?[1-9]\d?) dBm$/.exec(line);
  if (rfCarrier) {
    const mhz = Number(rfCarrier[1]);
    const dbm = Number(rfCarrier[2]);
    return validRfMhz(mhz) && dbm >= -30 && dbm <= MAX_RF_DBM
      ? { type: "rfCarrier", mhz, dbm }
      : null;
  }
  const rfKeepAwake = /^RF KEEP AWAKE: (0|[1-9]\d{2,4})$/.exec(line);
  if (rfKeepAwake) {
    const ms = Number(rfKeepAwake[1]);
    return ms === 0 || (ms >= 200 && ms <= 60000) ? { type: "rfKeepAwake", ms } : null;
  }
  if (line === "RF SLEEP AFTER: OFF") return { type: "rfSleepAfter", seconds: 0 };
  const rfSleepAfter = /^RF SLEEP AFTER: ([1-9]\d{1,4}) S$/.exec(line);
  if (rfSleepAfter) {
    const seconds = Number(rfSleepAfter[1]);
    return validRfSleepSeconds(seconds) && seconds > 0
      ? { type: "rfSleepAfter", seconds }
      : null;
  }
  const rfFrames = /^RF FRAMES: (0|[1-9]\d{0,9}) SENT (0|[1-9]\d{0,9}) FAILED$/.exec(line);
  if (rfFrames) {
    const sent = Number(rfFrames[1]);
    const failed = Number(rfFrames[2]);
    return sent <= 0xffffffff && failed <= 0xffffffff
      ? { type: "rfFrames", sent, failed }
      : null;
  }
  const rfWake = /^RF WAKE: ([1-9]\d{3,4}) MS$/.exec(line);
  if (rfWake) return { type: "rfWake", ms: Number(rfWake[1]) };
  if (line === "MICROPHONE ERROR")
    return {
      type: "error",
      message: "The ESP32 microphone failed to initialize.",
    };
  if (line === "IR WORKER ERROR")
    return {
      type: "error",
      message: "The ESP32 IR worker failed to initialize.",
    };
  const modes: Record<string, PresetMode> = {
    "AUTO MODE ON": "auto",
    "MUSIC SYNC ON": "music",
    "AUTO / MUSIC STOPPED": "manual",
    "BROWSER SYNC ON": "host",
  };
  if (Object.hasOwn(modes, line)) return { type: "mode", mode: modes[line] };
  const audio = /^Level:(0|[1-9]\d{0,4}) Threshold:(0|[1-9]\d{0,4})$/.exec(
    line,
  );
  if (audio) {
    const rawLevel = Number(audio[1]);
    const threshold = Number(audio[2]);
    // Signed 16-bit mean absolute level, multiplied by a ratio up to 2.50.
    if (rawLevel <= 32768 && threshold <= 81920)
      return { type: "audio", rawLevel, threshold };
    return null;
  }
  const customBeat = /^BEAT! Color sent: (=[0-9A-F]{6})$/.exec(line);
  if (customBeat)
    return validColorToken(customBeat[1])
      ? { type: "beatCustom", color: customBeat[1] }
      : null;
  const color = /^(BEAT! )?Color sent: ([RGBYCMWK])$/.exec(line);
  if (color) {
    // Beats cycle R/G/B by default; firmware with BEAT EFFECTS can use any
    // preset color for them.
    return { type: "color", color: color[2] as PresetColor, beat: !!color[1] };
  }
  const sensitivity = /^Sensitivity: (\d\.\d{2})$/.exec(line);
  if (sensitivity) {
    const value = Number(sensitivity[1]);
    if (value >= 1.1 && value <= 2.5) return { type: "sensitivity", value };
  }
  return null;
}

type Port = {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
};

export type PresetSerialOptions = {
  commandTimeoutMs?: number;
  handshakeTimeoutMs?: number;
  handshakeRetryMs?: number;
};
type Pending = {
  match: (event: PresetSerialEvent) => boolean;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  retryTimer?: ReturnType<typeof setTimeout>;
};
type PresetCommand = {
  character:
    | "R"
    | "G"
    | "B"
    | "Y"
    | "C"
    | "W"
    | "K"
    | "A"
    | "M"
    | "X"
    | "+"
    | "-"
    | "H"
    | "1"
    | "2"
    | "3"
    | "#"
    | "!"
    | "^"
    | "."
    | "~"
    | "@"
    | "*";
  /** Whole line to write instead of the single character. */
  text?: string;
  /** Sent by IR only, RF only or both instead of the board's setting. */
  output?: LightOutput;
  match: (event: PresetSerialEvent) => boolean;
  mode?: PresetMode;
};

/** @RS range: 0 (never left to sleep) or 60 s to 24 h, whole seconds. */
export const RF_SLEEP_MIN_S = 60;
export const RF_SLEEP_MAX_S = 86400;
function validRfSleepSeconds(seconds: number) {
  return (
    Number.isInteger(seconds) &&
    (seconds === 0 || (seconds >= RF_SLEEP_MIN_S && seconds <= RF_SLEEP_MAX_S))
  );
}

/** States in which the board reported a working radio. */
function rfWorking(state: RfState | undefined) {
  return state === "on" || state === "off" || state === "only";
}
function noPayload(payload: unknown) {
  if (payload !== undefined)
    throw new Error("This preset command takes no parameters.");
}
const outputSuffix: Record<LightOutput, string> = { both: "/B", ir: "/I", rf: "/R" };
const outputOps = ["preset", "light", "strobe", "rainbow", "custom"];

function presetCommand(op: string, payload: unknown): PresetCommand {
  // A light with its own output: the same line ending in /B, /I or /R. A
  // preset letter is then sent as the "." flash, which takes the ending.
  if (
    outputOps.includes(op) &&
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    "output" in payload
  ) {
    const { output, ...rest } = payload as Record<string, unknown>;
    if (!lightOutputs.includes(output as LightOutput))
      throw new Error("Choose IR and RF, IR only or RF only.");
    // A preset keeps its own checks (M is Music there), then goes as ".".
    const base = lightCommand(op, rest);
    const line =
      op === "preset"
        ? lightCommand("custom", { kind: "flash", color: (rest as { color: string }).color })
        : base;
    return {
      ...line,
      text: (line.text ?? line.character) + outputSuffix[output as LightOutput],
      output: output as LightOutput,
    };
  }
  return lightCommand(op, payload);
}

function lightCommand(op: string, payload: unknown): PresetCommand {
  if (op === "browser") {
    noPayload(payload);
    return {
      character: "H",
      mode: "host",
      match: (event) => event.type === "mode" && event.mode === "host",
    };
  }
  if (op === "beat") {
    const value = payload as { color?: unknown } | null;
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).length !== 1 ||
      typeof value.color !== "string" ||
      !(
        BEAT_COLORS.includes(value.color) ||
        (value.color.startsWith("=") && validColorToken(value.color))
      )
    )
      throw new Error("Choose a preset color or valid levels for a browser beat.");
    const color = value.color;
    if (color.startsWith("="))
      return {
        character: "*",
        text: `*${color}`,
        match: (event) => event.type === "beatCustom" && event.color === color,
      };
    return {
      character: String(BEAT_COLORS.indexOf(color) + 1) as "1",
      match: (event) =>
        event.type === "color" && event.beat && event.color === color,
    };
  }
  if (op === "beatStyle") {
    const value = payload as {
      kind?: unknown;
      ms?: unknown;
      fadeIn?: unknown;
      fadeOut?: unknown;
    } | null;
    const whole = (number: unknown, low: number, high: number) =>
      typeof number === "number" &&
      Number.isInteger(number) &&
      number >= low &&
      number <= high;
    const keys = value && typeof value === "object" ? Object.keys(value) : [];
    const valid =
      !!value &&
      !Array.isArray(value) &&
      (value.kind === "flash"
        ? keys.length === 1
        : value.kind === "strobe"
          ? keys.length === 2 && whole(value.ms, 200, 5000)
          : value.kind === "light" &&
            keys.length === 4 &&
            whole(value.ms, 50, 10000) &&
            whole(value.fadeIn, 0, 7) &&
            whole(value.fadeOut, 0, 7));
    if (!valid)
      throw new Error(
        "Choose a quick flash, a light of 0.05 to 10 seconds with fade codes, or a strobe of 0.2 to 5 seconds for beats.",
      );
    const kind = value!.kind as "flash" | "light" | "strobe";
    const ms = kind === "flash" ? 0 : (value!.ms as number);
    const fadeIn = kind === "light" ? (value!.fadeIn as number) : 0;
    const fadeOut = kind === "light" ? (value!.fadeOut as number) : 0;
    return {
      character: "@",
      text:
        kind === "flash"
          ? "@F"
          : kind === "strobe"
            ? `@S${ms}`
            : `@L${ms},${fadeIn},${fadeOut}`,
      match: (event) =>
        event.type === "beatStyle" &&
        event.kind === kind &&
        event.ms === ms &&
        event.fadeIn === fadeIn &&
        event.fadeOut === fadeOut,
    };
  }
  if (op === "idleRainbow") {
    const value = payload as { seconds?: unknown } | null;
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).length !== 1 ||
      !validIdleSeconds(value.seconds)
    )
      throw new Error(
        "Choose off, power-on only, or 2 to 3600 seconds for the rainbow.",
      );
    const seconds = value.seconds;
    return {
      character: "@",
      text: `@I${seconds}`,
      match: (event) =>
        event.type === "idleRainbow" && event.seconds === seconds,
    };
  }
  // What lights go out by: @R1 IR and RF, @R0 IR only, @R2 RF only (kept by
  // the board; a choice with RF also wakes the bands) and @RW, a 35 s wake.
  // Each echoes the RF state lines.
  if (op === "rf") {
    const value = payload as { output?: unknown } | null;
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).length !== 1 ||
      !lightOutputs.includes(value.output as LightOutput)
    )
      throw new Error("Choose IR and RF, IR only or RF only.");
    const output = value.output as LightOutput;
    const state: RfState = output === "both" ? "on" : output === "ir" ? "off" : "only";
    return {
      character: "@",
      text: output === "both" ? "@R1" : output === "ir" ? "@R0" : "@R2",
      match: (event) => event.type === "rf" && event.state === state,
    };
  }
  if (op === "rfWake") {
    noPayload(payload);
    return {
      character: "@",
      text: "@RW",
      match: (event) => event.type === "rfWake",
    };
  }
  // @RS<s>: how long after the last light RF bands are left to sleep, 0 never
  // (kept by the board). Echoes the RF state lines.
  if (op === "rfSleep") {
    const value = payload as { seconds?: unknown } | null;
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).length !== 1 ||
      typeof value.seconds !== "number" ||
      !validRfSleepSeconds(value.seconds)
    )
      throw new Error(
        `RF sleep must be never (0) or ${RF_SLEEP_MIN_S}-${RF_SLEEP_MAX_S} whole seconds.`,
      );
    const seconds = value.seconds;
    return {
      character: "@",
      text: `@RS${seconds}`,
      match: (event) => event.type === "rfSleepAfter" && event.seconds === seconds,
    };
  }
  if (op === "beatPalette") {
    const value = payload as { colors?: unknown } | null;
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).length !== 1 ||
      typeof value.colors !== "string" ||
      !/^[RGBYCMWK]{0,8}$/.test(value.colors)
    )
      throw new Error("Choose up to eight preset colors for beats.");
    const colors = value.colors;
    return {
      character: "@",
      text: colors ? `@P${colors}` : "@P*",
      match: (event) => event.type === "beatPalette" && event.colors === colors,
    };
  }
  if (op === "light") {
    const value = payload as { color?: unknown; ms?: unknown } | null;
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).length !== 2 ||
      typeof value.color !== "string" ||
      !["R", "G", "B", "Y", "C", "M", "W", "K"].includes(value.color) ||
      typeof value.ms !== "number" ||
      !Number.isInteger(value.ms) ||
      value.ms < MIN_LIGHT_MS ||
      value.ms > MAX_LIGHT_MS
    )
      throw new Error(
        "Choose R, G, B, Y, C, M, W or K and a light time from 50 ms to 10 minutes.",
      );
    const color = value.color;
    const ms = value.ms;
    return {
      character: "#",
      text: `#${color}${ms}`,
      match: (event) =>
        event.type === "light" && event.color === color && event.ms === ms,
      mode: "manual",
    };
  }
  if (op === "strobe") {
    const value = payload as {
      color?: unknown;
      ms?: unknown;
      build?: unknown;
    } | null;
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).length !== 3 ||
      typeof value.color !== "string" ||
      !["R", "G", "B", "Y", "C", "M", "W", "K"].includes(value.color) ||
      typeof value.ms !== "number" ||
      !Number.isInteger(value.ms) ||
      value.ms < MIN_STROBE_MS ||
      value.ms > MAX_STROBE_MS ||
      typeof value.build !== "boolean"
    )
      throw new Error(
        "Choose R, G, B, Y, C, M, W or K and a strobe time from 0.2 to 60 seconds.",
      );
    const color = value.color;
    const ms = value.ms;
    const build = value.build;
    return {
      character: build ? "^" : "!",
      text: `${build ? "^" : "!"}${color}${ms}`,
      match: (event) =>
        event.type === "strobe" &&
        event.color === color &&
        event.ms === ms &&
        event.build === build,
      mode: "manual",
    };
  }
  if (op === "rainbow") {
    const value = payload as { ms?: unknown; cycleMs?: unknown } | null;
    const whole = (number: unknown, low: number, high: number) =>
      typeof number === "number" &&
      Number.isInteger(number) &&
      number >= low &&
      number <= high;
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).length !== 2 ||
      !whole(value.ms, MIN_RAINBOW_MS, MAX_RAINBOW_MS) ||
      !whole(value.cycleMs, MIN_RAINBOW_CYCLE_MS, MAX_RAINBOW_CYCLE_MS)
    )
      throw new Error(
        "Choose a rainbow time from 0.5 seconds to 10 minutes and a cycle from 1 to 20 seconds.",
      );
    const ms = value.ms as number;
    const cycleMs = value.cycleMs as number;
    return {
      character: "~",
      text: `~${ms},${cycleMs}`,
      match: (event) =>
        event.type === "rainbow" && event.ms === ms && event.cycleMs === cycleMs,
      mode: "manual",
    };
  }
  if (op === "custom") {
    const value = payload as {
      kind?: unknown;
      color?: unknown;
      ms?: unknown;
      fadeIn?: unknown;
      fadeOut?: unknown;
    } | null;
    const fail = () => {
      throw new Error(
        "Choose a color (a preset letter or levels up to 200), a valid time and fade codes from 0 to 7.",
      );
    };
    if (!value || typeof value !== "object" || Array.isArray(value)) fail();
    const { kind, color, ms, fadeIn, fadeOut } = value!;
    const allowed = ["kind", "color", "ms", "fadeIn", "fadeOut"];
    if (
      Object.keys(value!).some((key) => !allowed.includes(key)) ||
      typeof kind !== "string" ||
      !["flash", "light", "strobe", "build"].includes(kind) ||
      typeof color !== "string" ||
      !validColorToken(color)
    )
      fail();
    const fades = fadeIn !== undefined || fadeOut !== undefined;
    const code = (fade: unknown) =>
      typeof fade === "number" && Number.isInteger(fade) && fade >= 0 && fade <= 7;
    if (kind === "flash" ? ms !== undefined || fades : false) fail();
    if (kind !== "flash") {
      const [low, high] =
        kind === "light"
          ? [MIN_LIGHT_MS, MAX_LIGHT_MS]
          : [MIN_STROBE_MS, MAX_STROBE_MS];
      if (
        typeof ms !== "number" ||
        !Number.isInteger(ms) ||
        ms < low ||
        ms > high
      )
        fail();
      if (fades && (kind !== "light" || !code(fadeIn) || !code(fadeOut))) fail();
    }
    const token = color as string;
    const time = kind === "flash" ? 0 : (ms as number);
    const attack = fades ? (fadeIn as number) : 0;
    const release = fades ? (fadeOut as number) : 0;
    const prefix = { flash: ".", light: "#", strobe: "!", build: "^" }[
      kind as CustomKind
    ] as "." | "#" | "!" | "^";
    return {
      character: prefix,
      text:
        prefix +
        token +
        (kind === "flash" ? "" : String(time)) +
        (attack || release ? `,${attack},${release}` : ""),
      // A preset letter without fades is acknowledged in the earlier form.
      match: (event) =>
        (event.type === "custom" &&
          event.kind === kind &&
          event.color === token &&
          event.ms === time &&
          event.fadeIn === attack &&
          event.fadeOut === release) ||
        (kind === "light" &&
          event.type === "light" &&
          event.color === token &&
          event.ms === time &&
          !attack &&
          !release) ||
        ((kind === "strobe" || kind === "build") &&
          event.type === "strobe" &&
          event.color === token &&
          event.ms === time &&
          event.build === (kind === "build")),
      mode: "manual",
    };
  }
  if (op === "preset") {
    const value = payload as { color?: unknown } | null;
    const color = value?.color;
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).length !== 1 ||
      typeof color !== "string" ||
      !["R", "G", "B", "Y", "C", "W", "K"].includes(color)
    )
      throw new Error(
        "Choose R, G, B, Y, C, W or K. M selects Music in this sketch; manual magenta is unavailable.",
      );
    return {
      character: color as PresetCommand["character"],
      match: (event) =>
        event.type === "color" && !event.beat && event.color === color,
      mode: "manual",
    };
  }
  if (op === "sensitivity") {
    const value = payload as { direction?: unknown } | null;
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).length !== 1 ||
      !["more", "less"].includes(value.direction as string)
    )
      throw new Error("Choose more or less microphone sensitivity.");
    return {
      character: value.direction === "more" ? "+" : "-",
      match: (event) => event.type === "sensitivity",
    };
  }
  const modes: Record<
    string,
    { character: "A" | "M" | "X"; mode: PresetMode }
  > = {
    auto: { character: "A", mode: "auto" },
    music: { character: "M", mode: "music" },
    stop: { character: "X", mode: "manual" },
  };
  if (!Object.hasOwn(modes, op))
    throw new Error(
      "This sketch supports preset colors, Auto, Music, Stop and relative sensitivity only.",
    );
  noPayload(payload);
  const { character, mode } = modes[op];
  return {
    character,
    mode,
    match: (event) => event.type === "mode" && event.mode === mode,
  };
}

export class PresetSerialTransport implements DeviceTransport {
  private port: Port | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private readTask: Promise<void> | null = null;
  private connected = false;
  private confirmed = false;
  private fault: string | undefined;
  private generation = 0;
  private queue: Promise<void> = Promise.resolve();
  private handshake: Promise<Status> | null = null;
  private pending: Pending | null = null;
  private deviceMode: PresetMode = "manual";
  private bassEnvelope = false;
  private browserBeatSupported = false;
  private whiteNeutralCandidate = false;
  private timedLight = false;
  private strobeReady = false;
  private customReady = false;
  private rainbowReady = false;
  private beatEffects = false;
  private idleRainbow: number | undefined;
  private idleReturn = false;
  private lightOutput = false;
  private rfSleepSetting = false;
  private rf: NonNullable<Status["rf"]> | undefined;
  private lastBeatAt: number | undefined;
  private modeEpoch = 0;
  private presetCancelEpoch = 0;
  private lastColor: PresetColor | undefined;
  private sensitivity: number | undefined;
  private latestAudio: DeviceAudio | null = null;
  private staleTimer: ReturnType<typeof setTimeout> | undefined;
  private audioListeners = new Set<(sample: DeviceAudio) => void>();
  private statusListeners = new Set<(status: Status) => void>();
  private readonly timing: Required<PresetSerialOptions>;

  constructor(options: PresetSerialOptions = {}) {
    this.timing = {
      commandTimeoutMs: options.commandTimeoutMs ?? 2500,
      handshakeTimeoutMs: options.handshakeTimeoutMs ?? 4500,
      handshakeRetryMs: options.handshakeRetryMs ?? 1800,
    };
    if (
      Object.values(this.timing).some(
        (value) => !Number.isFinite(value) || value <= 0 || value > 10000,
      )
    )
      throw new Error(
        "Serial timing must be greater than zero and at most 10 seconds.",
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
      this.handshake = null;
      this.deviceMode = "manual";
      this.bassEnvelope = false;
      this.browserBeatSupported = false;
      this.whiteNeutralCandidate = false;
      this.timedLight = false;
      this.strobeReady = false;
      this.customReady = false;
      this.rainbowReady = false;
      this.beatEffects = false;
      this.idleRainbow = undefined;
      this.idleReturn = false;
      this.lightOutput = false;
      this.rfSleepSetting = false;
      this.rf = undefined;
      this.lastBeatAt = undefined;
      this.modeEpoch++;
      this.presetCancelEpoch++;
      this.lastColor = undefined;
      this.sensitivity = undefined;
      this.latestAudio = null;
      this.readTask = this.readLoop(this.reader);
    } catch (error) {
      await this.close().catch(() => {});
      throw error;
    }
  }

  subscribeAudio(listener: (sample: DeviceAudio) => void) {
    this.audioListeners.add(listener);
    if (this.freshAudio()) listener(this.latestAudio!);
    return () => this.audioListeners.delete(listener);
  }
  subscribeStatus(listener: (status: Status) => void) {
    this.statusListeners.add(listener);
    if (this.confirmed) listener(this.snapshot());
    return () => this.statusListeners.delete(listener);
  }
  private freshAudio() {
    return (
      this.connected &&
      this.confirmed &&
      !this.fault &&
      this.deviceMode === "music" &&
      this.latestAudio !== null &&
      Date.now() - this.latestAudio.receivedAt < 2000
    );
  }
  private snapshot(): Status {
    const active = this.connected && this.confirmed && !this.fault;
    const sample = this.freshAudio() ? this.latestAudio : null;
    return {
      name: this.bassEnvelope
        ? "ESP32 beat controller"
        : "ESP32 preset controller",
      firmware: this.bassEnvelope
        ? "Bass onset serial (unversioned)"
        : "V2 preset serial (unversioned)",
      mode: "preset-serial",
      irConfigured: !!active,
      rfSupported: rfWorking(this.rf?.state),
      micAvailable: sample !== null,
      micInitialized: !!active,
      micPins: { bclk: 26, ws: 25, data: 27 },
      irPin: 32,
      micLevel: sample?.level ?? 0,
      micRawLevel: sample?.rawLevel ?? 0,
      standaloneEnabled: !!active && this.deviceMode === "music",
      deviceMode: this.deviceMode,
      browserBeatSupported: this.browserBeatSupported,
      whitePreset: this.whiteNeutralCandidate ? "neutral-candidate" : "whitish",
      legacyWhitishSupported: this.whiteNeutralCandidate,
      timedLightSupported: this.timedLight,
      strobeSupported: this.strobeReady,
      customLightSupported: this.customReady,
      rainbowSupported: this.rainbowReady,
      beatEffectsSupported: this.beatEffects,
      ...(this.idleRainbow === undefined
        ? {}
        : { idleRainbow: this.idleRainbow }),
      ...(this.idleReturn ? { idleReturnSupported: true } : {}),
      ...(this.lightOutput ? { lightOutputSupported: true } : {}),
      ...(this.rfSleepSetting ? { rfSleepSettingSupported: true } : {}),
      ...(this.rf ? { rf: { ...this.rf } } : {}),
      ...(this.lastBeatAt === undefined ? {} : { lastBeatAt: this.lastBeatAt }),
      ...(this.lastColor ? { lastColor: this.lastColor } : {}),
      ...(this.sensitivity === undefined
        ? {}
        : { musicSensitivity: this.sensitivity }),
      ...(this.fault ? { lastError: this.fault } : {}),
    };
  }
  private publishStatus() {
    const status = this.snapshot();
    for (const listener of this.statusListeners) {
      try {
        listener(status);
      } catch {
        /* Subscribers cannot interrupt serial cleanup. */
      }
    }
  }
  private publishAudio(sample: DeviceAudio) {
    for (const listener of this.audioListeners) {
      try {
        listener(sample);
      } catch {
        /* Subscribers cannot interrupt serial parsing. */
      }
    }
  }
  private clearAudio() {
    clearTimeout(this.staleTimer);
    this.latestAudio = null;
  }
  private finishPending(error?: Error) {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    clearTimeout(pending.timer);
    clearTimeout(pending.retryTimer);
    if (error) pending.reject(error);
    else pending.resolve();
  }
  private fail(message: string) {
    this.fault = message;
    this.confirmed = false;
    this.clearAudio();
    this.finishPending(new Error(message));
    this.publishStatus();
  }
  private accept(event: PresetSerialEvent) {
    if (event.type === "capability") this.browserBeatSupported = true;
    if (event.type === "white") this.whiteNeutralCandidate = true;
    if (event.type === "timedLight") this.timedLight = true;
    if (event.type === "light") this.lastColor = event.color;
    if (event.type === "strobeReady") this.strobeReady = true;
    if (event.type === "customReady") this.customReady = true;
    if (event.type === "rainbowReady") this.rainbowReady = true;
    if (event.type === "beatEffectsReady") this.beatEffects = true;
    if (event.type === "idleRainbow") this.idleRainbow = event.seconds;
    if (event.type === "idleReturnReady") this.idleReturn = true;
    if (event.type === "lightOutputReady") this.lightOutput = true;
    if (event.type === "rfSleepSettingReady") this.rfSleepSetting = true;
    // A state line starts a fresh RF report; the detail lines follow it.
    if (event.type === "rf") this.rf = { state: event.state };
    if (this.rf && event.type === "rfCarrier") {
      this.rf.mhz = event.mhz;
      this.rf.dbm = event.dbm;
    }
    if (this.rf && event.type === "rfKeepAwake") this.rf.keepAwakeMs = event.ms;
    if (this.rf && event.type === "rfSleepAfter") this.rf.sleepAfterS = event.seconds;
    if (this.rf && event.type === "rfFrames") {
      this.rf.framesSent = event.sent;
      this.rf.framesFailed = event.failed;
    }
    if (event.type === "strobe") this.lastColor = event.color;
    if (
      event.type === "format" ||
      (event.type === "ready" && event.variant === "bass")
    )
      this.bassEnvelope = true;
    if (event.type === "error") {
      this.fail(event.message);
      return;
    }
    if (event.type === "ready") {
      // This banner follows successful I2S initialization. It is not a command ack.
      if (this.confirmed) {
        this.fail("ESP32 restarted. Reconnect before sending more commands.");
        return;
      }
      this.sensitivity = 1.35;
    }
    if (event.type === "mode") {
      this.deviceMode = event.mode;
      if (event.mode !== "music") this.clearAudio();
      this.lastBeatAt = undefined;
    }
    if (event.type === "color") {
      this.lastColor = event.color;
      if (event.beat) {
        this.lastBeatAt = Date.now();
        if (this.deviceMode !== "host") this.deviceMode = "music";
      }
    }
    if (event.type === "beatCustom") this.lastBeatAt = Date.now();
    if (event.type === "sensitivity") this.sensitivity = event.value;
    if (this.confirmed && !this.fault) {
      if (event.type === "audio" && this.deviceMode === "music") {
        this.latestAudio = {
          rawLevel: event.rawLevel,
          level: event.rawLevel / 32768,
          receivedAt: Date.now(),
          format: this.bassEnvelope
            ? "bass-envelope-16-bit"
            : "mean-absolute-16-bit",
          threshold: event.threshold,
          beat: false,
        };
        this.publishAudio(this.latestAudio);
        clearTimeout(this.staleTimer);
        this.staleTimer = setTimeout(() => this.publishStatus(), 2001);
      } else if (
        event.type === "color" &&
        event.beat &&
        this.deviceMode !== "host"
      ) {
        const sample = this.freshAudio() ? this.latestAudio : null;
        // Beat messages carry no amplitude. Do not make an old level fresh again.
        this.publishAudio({
          rawLevel: sample?.rawLevel ?? 0,
          level: sample?.level ?? 0,
          receivedAt: Date.now(),
          format: this.bassEnvelope
            ? "bass-envelope-16-bit"
            : "mean-absolute-16-bit",
          ...(sample?.threshold === undefined
            ? {}
            : { threshold: sample.threshold }),
          beat: true,
        });
      }
      this.publishStatus();
    }
    if (this.pending?.match(event)) this.finishPending();
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
          const event = parsePresetLine(buffer.slice(0, end));
          buffer = buffer.slice(end + 1);
          if (event) this.accept(event);
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
      this.clearAudio();
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
  private request(command: PresetCommand, handshake = false): Promise<void> {
    const writer = this.writer;
    if (!writer || !this.connected)
      return Promise.reject(new Error("Serial is disconnected."));
    return new Promise((resolve, reject) => {
      const bytes = new TextEncoder().encode(
        (command.text ?? command.character) + "\n",
      );
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
              ? "No preset-sketch acknowledgment. Choose the correct firmware protocol or install the supplied sketch, then reconnect."
              : "ESP32 acknowledgment timed out. Reconnect before sending more commands.",
          ),
        handshake
          ? this.timing.handshakeTimeoutMs
          : this.timing.commandTimeoutMs,
      );
      this.pending = { match: command.match, resolve, reject, timer };
      if (handshake)
        this.pending.retryTimer = setTimeout(
          send,
          this.timing.handshakeRetryMs,
        );
      send();
    });
  }
  async status(): Promise<Status> {
    if (!this.connected) throw new Error("Serial is disconnected.");
    if (this.fault) throw new Error(this.fault);
    if (this.confirmed) return this.snapshot();
    if (!this.handshake) {
      this.handshake = this.enqueue(async () => {
        await this.request(presetCommand("stop", undefined), true);
        this.confirmed = true;
        this.deviceMode = "manual";
        this.publishStatus();
        return this.snapshot();
      }).finally(() => {
        this.handshake = null;
      });
    }
    return this.handshake;
  }
  /**
   * A bare carriage return: the firmware ignores it, even inside a line
   * command, but it restarts the wait before the idle rainbow. Sent while a
   * song show plays so gaps between cues stay dark. No acknowledgement.
   */
  keepAlive(): void {
    const writer = this.writer;
    if (!writer || !this.connected || !this.confirmed || !this.idleReturn)
      return;
    writer.write(new TextEncoder().encode("\r")).catch(() => {});
  }
  async command(op: string, payload?: unknown): Promise<unknown> {
    if (op === "status") {
      noPayload(payload);
      return this.status();
    }
    // Validate before any serial write, including the initial stop handshake.
    const command = presetCommand(op, payload);
    if (op === "browser" && (!this.confirmed || !this.browserBeatSupported))
      throw new Error(
        "Reconnect with firmware that explicitly supports browser beats.",
      );
    if (
      op === "beat" &&
      (!this.confirmed ||
        !this.browserBeatSupported ||
        this.deviceMode !== "host")
    )
      throw new Error("Browser beat control is unavailable outside host mode.");
    // Older builds ignore the digits 4 to 8 and would misread an @ line.
    if (
      (op === "beatStyle" ||
        op === "beatPalette" ||
        (op === "beat" && !["1", "2", "3"].includes(command.character))) &&
      (!this.confirmed || !this.beatEffects)
    )
      throw new Error(
        "The connected firmware cannot change what beats look like.",
      );
    // K exists only in the build that reports the neutral-white candidate. The
    // original sketch would ignore it and never acknowledge.
    if (
      op === "preset" &&
      command.character === "K" &&
      (!this.confirmed || !this.whiteNeutralCandidate)
    )
      throw new Error(
        "The connected firmware has no separate warm-white (K) command.",
      );
    // Older builds would read #R1500 as separate characters, so the line is
    // only written after the firmware has reported the command.
    if (op === "light" && (!this.confirmed || !this.timedLight))
      throw new Error("The connected firmware has no timed light command.");
    if (op === "strobe" && (!this.confirmed || !this.strobeReady))
      throw new Error("The connected firmware has no strobe command.");
    if (op === "custom" && (!this.confirmed || !this.customReady))
      throw new Error(
        "The connected firmware has no custom color or fade command.",
      );
    if (op === "rainbow" && (!this.confirmed || !this.rainbowReady))
      throw new Error("The connected firmware has no rainbow command.");
    // Builds that print the setting accept @I0 / @I1; only builds that
    // report IDLE RETURN accept a number of seconds.
    if (
      op === "idleRainbow" &&
      (!this.confirmed ||
        this.idleRainbow === undefined ||
        ((payload as { seconds: number }).seconds >= 2 && !this.idleReturn))
    )
      throw new Error(
        (payload as { seconds: number }).seconds >= 2 &&
          this.idleRainbow !== undefined
          ? "The connected firmware runs the rainbow only from power-on."
          : "The connected firmware has no rainbow setting.",
      );
    // RF settings need a board that reported a working radio. It answers a
    // wake only while its setting includes RF.
    const rfReady = rfWorking(this.rf?.state);
    if (op === "rfSleep" && (!this.confirmed || !this.rfSleepSetting))
      throw new Error(
        "The connected firmware cannot change when RF wristbands sleep. Update the firmware.",
      );
    if (
      (op === "rf" || op === "rfWake" || op === "rfSleep") &&
      (!this.confirmed || !rfReady || (op === "rfWake" && this.rf?.state === "off"))
    )
      throw new Error(
        op === "rfWake" && this.rf?.state === "off"
          ? "Turn RF on before waking the wristbands."
          : "The connected board has no working RF radio.",
      );
    // RF only, for the board or for one light, and the /I /R /B endings need
    // firmware that reports them; RF in a light needs a working radio.
    const wantsRfOnly =
      op === "rf" && (payload as { output?: unknown }).output === "rf";
    if ((command.output || wantsRfOnly) && (!this.confirmed || !this.lightOutput))
      throw new Error(
        "The connected firmware cannot choose IR only or RF only. Update the firmware.",
      );
    if (command.output === "rf" && !rfReady)
      throw new Error("The connected board has no working RF radio for an RF-only light.");
    const manualColor =
      op === "preset" ||
      op === "light" ||
      op === "strobe" ||
      op === "custom" ||
      op === "rainbow";
    const beatEpoch = this.modeEpoch;
    const presetEpoch = this.presetCancelEpoch;
    if (
      [
        "preset",
        "light",
        "strobe",
        "custom",
        "rainbow",
        "auto",
        "music",
        "stop",
        "browser",
      ].includes(op)
    )
      this.modeEpoch++;
    // A later mode intent cancels colors that have not reached the wire yet.
    // Presets do not invalidate each other: normal manual R/G ordering stays
    // serialized, while pausing/seeking a song cannot replay old queued cues.
    if (["auto", "music", "stop", "browser"].includes(op))
      this.presetCancelEpoch++;
    await this.status();
    return this.enqueue(async () => {
      const assertPresetCurrent = () => {
        if (manualColor && presetEpoch !== this.presetCancelEpoch)
          throw new Error(
            "Preset command was cancelled by a later mode change.",
          );
      };
      assertPresetCurrent();
      if (
        op === "beat" &&
        (this.deviceMode !== "host" || beatEpoch !== this.modeEpoch)
      )
        throw new Error(
          "Browser beat control is unavailable outside host mode.",
        );
      // Auto also prints ordinary Color sent lines. Drain it behind a unique
      // stop acknowledgment before a preset so its last frame cannot be
      // mistaken for the acknowledgment of the new manual command.
      if (manualColor && this.deviceMode !== "manual")
        await this.request(presetCommand("stop", undefined));
      // Stop can be requested while this preset's own stop barrier is in
      // flight. Recheck after its acknowledgment, before writing any color.
      assertPresetCurrent();
      await this.request(command);
      if (command.mode) {
        this.deviceMode = command.mode;
        if (command.mode !== "music") this.clearAudio();
      }
      this.publishStatus();
      return this.snapshot();
    });
  }
  async close() {
    this.connected = false;
    this.confirmed = false;
    this.generation++;
    this.clearAudio();
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
