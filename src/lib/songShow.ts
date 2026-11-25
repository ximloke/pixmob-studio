import { initialLighting, sampleEffect, validLighting } from "./effects";
import type { Lighting } from "./effects";
import { lightOutputs } from "./device";
import type { DeviceTransport, LightOutput } from "./device";
import {
  fadeCode,
  levelsToken,
  validDeviceLevels,
  validFadeMs,
} from "./deviceColors";
import type { DeviceLevels } from "./deviceColors";

export const songHardwareColors = ["R", "G", "B", "Y", "C", "W"] as const;
export type SongHardwareColor = (typeof songHardwareColors)[number];
export type SongCue = {
  id: string;
  time: number;
  label: string;
  lighting: Lighting;
  hardwareColor?: SongHardwareColor;
  pulseMs?: number;
  /**
   * Device light time in milliseconds. Absent: the quick flash of the plain
   * preset frame. Present: a timed light (short flash or long hold) that needs
   * firmware with the timed light command; older firmware falls back to the
   * quick flash.
   */
  holdMs?: number;
  /**
   * Strobe for holdMs instead of steady light: "steady" flashes at the fastest
   * rate, "build" starts slowly and speeds up to it. Needs holdMs within the
   * strobe bounds and firmware with the strobe commands; otherwise the cue is
   * sent as a timed light.
   */
  strobe?: SongStrobe;
  /**
   * Custom device color as red/green/blue levels. hardwareColor stays set to
   * the nearest preset, which is what firmware without custom colors gets.
   */
  levels?: DeviceLevels;
  /** Fade in / fade out of a steady timed light, added around holdMs. */
  fadeInMs?: number;
  fadeOutMs?: number;
  /**
   * Rainbow for holdMs: the time of one turn through the colors. The cue's
   * own color is what firmware without the rainbow command shows instead.
   */
  rainbowMs?: number;
  /**
   * IR and RF, IR only or RF only for this cue. Absent: whatever the board
   * is set to. Needs firmware that reports LIGHT OUTPUT.
   */
  output?: LightOutput;
};
export const MIN_RAINBOW_MS = 500;
export const MIN_RAINBOW_CYCLE_MS = 1000;
export const MAX_RAINBOW_CYCLE_MS = 20000;
export const DEFAULT_RAINBOW_CYCLE_MS = 3000;
/** Screen color of a rainbow at a time; an illustration of the hue only. */
export function rainbowPreviewColor(elapsedMs: number, cycleMs: number) {
  const turn = (((elapsedMs % cycleMs) + cycleMs) % cycleMs) / cycleMs;
  // Red, yellow, green, cyan, blue, magenta: the firmware's order.
  const channel = (offset: number) => {
    const k = (offset + turn * 6) % 6;
    return Math.round(255 * (1 - Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return `#${[channel(5), channel(3), channel(1)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}
/** What a cue adds to its preset color when it is sent to the device. */
export type SongCueExtras = {
  levels?: DeviceLevels;
  fadeInMs?: number;
  fadeOutMs?: number;
  rainbowMs?: number;
  output?: LightOutput;
};
export function validCueExtras(cue: {
  rainbowMs?: unknown;
  hardwareColor?: unknown;
  holdMs?: unknown;
  strobe?: unknown;
  levels?: unknown;
  fadeInMs?: unknown;
  fadeOutMs?: unknown;
  output?: unknown;
}) {
  if (cue.output !== undefined && !lightOutputs.includes(cue.output as LightOutput))
    return false;
  if (cue.levels !== undefined)
    if (!validDeviceLevels(cue.levels) || cue.hardwareColor === undefined)
      return false;
  for (const fade of [cue.fadeInMs, cue.fadeOutMs])
    if (
      fade !== undefined &&
      (!validFadeMs(fade) || cue.holdMs === undefined || cue.strobe !== undefined)
    )
      return false;
  if (cue.rainbowMs !== undefined)
    if (
      typeof cue.rainbowMs !== "number" ||
      !Number.isInteger(cue.rainbowMs) ||
      cue.rainbowMs < MIN_RAINBOW_CYCLE_MS ||
      cue.rainbowMs > MAX_RAINBOW_CYCLE_MS ||
      typeof cue.holdMs !== "number" ||
      cue.holdMs < MIN_RAINBOW_MS ||
      cue.strobe !== undefined ||
      cue.fadeInMs !== undefined ||
      cue.fadeOutMs !== undefined
    )
      return false;
  return true;
}
export type SongStrobe = "steady" | "build";
export const MIN_STROBE_MS = 200;
export const MAX_STROBE_MS = 60000;
export function validStrobe(strobe: unknown, holdMs: unknown) {
  return (
    (strobe === "steady" || strobe === "build") &&
    validHoldMs(holdMs) &&
    holdMs >= MIN_STROBE_MS &&
    holdMs <= MAX_STROBE_MS
  );
}
/** Flash times of a strobe in seconds from its start (mirrors StrobePlan.h). */
export function strobeFlashTimes(holdMs: number, strobe: SongStrobe): number[] {
  const times = [0];
  for (;;) {
    const last = times[times.length - 1];
    const period =
      strobe === "build" ? 500 - Math.floor((375 * last) / holdMs) : 125;
    const next = last + period;
    if (next >= holdMs) break;
    times.push(next);
  }
  return times.map((ms) => ms / 1000);
}
export const MIN_HOLD_MS = 100;
export const MAX_HOLD_MS = 600000;
export function validHoldMs(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_HOLD_MS &&
    value <= MAX_HOLD_MS
  );
}
export type SongShow = { id: string; name: string; cues: SongCue[] };
export const SONG_SHOW_STORAGE_KEY = "pixmob-song-shows-v1";
export const MAX_SONG_TIME = 86400;
/** Every beat of a six-minute song near 170 BPM fits without thinning. */
export const MAX_SONG_CUES = 1024;
/**
 * Device cues are sent this many milliseconds before their cue time. The
 * default approximates the measured serial write-to-completion time (about
 * 31 ms) plus half the 20 ms scheduling clock; wristband and optical delay are
 * unmeasured, so the value stays user-adjustable and never alters the preview.
 */
export const SONG_LEAD_STORAGE_KEY = "pixmob-song-hardware-lead-ms";
// 70 ms looked aligned to the user with a real song (14 Nov 2026); at 40 ms
// the lights came slightly after the drum hits.
export const DEFAULT_HARDWARE_LEAD_MS = 70;
export const MAX_HARDWARE_LEAD_MS = 200;
export function clampHardwareLead(value: unknown): number {
  if (value === null || value === undefined || value === "")
    return DEFAULT_HARDWARE_LEAD_MS;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return DEFAULT_HARDWARE_LEAD_MS;
  return Math.round(Math.max(0, Math.min(MAX_HARDWARE_LEAD_MS, number)));
}
export const MAX_SONG_SHOWS = 16;
const MAX_STORAGE_LENGTH = 1_000_000;
const identifier = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value);

export function validSongShow(value: unknown): value is SongShow {
  if (!value || typeof value !== "object") return false;
  const show = value as SongShow;
  if (
    !identifier(show.id) ||
    typeof show.name !== "string" ||
    !show.name.trim() ||
    show.name.length > 80 ||
    !Array.isArray(show.cues) ||
    show.cues.length > MAX_SONG_CUES
  )
    return false;
  const ids = new Set<string>();
  return show.cues.every((cue) => {
    if (
      !cue ||
      typeof cue !== "object" ||
      !identifier(cue.id) ||
      ids.has(cue.id) ||
      !Number.isFinite(cue.time) ||
      cue.time < 0 ||
      cue.time > MAX_SONG_TIME ||
      typeof cue.label !== "string" ||
      cue.label.length > 80 ||
      !validLighting(cue.lighting) ||
      (cue.pulseMs !== undefined &&
        (!Number.isFinite(cue.pulseMs) ||
          cue.pulseMs < 50 ||
          cue.pulseMs > 2000)) ||
      (cue.holdMs !== undefined && !validHoldMs(cue.holdMs)) ||
      (cue.strobe !== undefined && !validStrobe(cue.strobe, cue.holdMs)) ||
      !validCueExtras(cue) ||
      (cue.hardwareColor !== undefined &&
        !songHardwareColors.includes(cue.hardwareColor))
    )
      return false;
    ids.add(cue.id);
    return true;
  });
}

export function sortedSongCues(show: SongShow): SongCue[] {
  return [...show.cues].sort((a, b) => a.time - b.time);
}

/**
 * The wristband profile most of a show's cues use (on a tie, the one used
 * first); undefined for a show without cues.
 */
export function mainSongProfile(
  show: SongShow,
): Lighting["profile"] | undefined {
  const counts = new Map<Lighting["profile"], number>();
  for (const { lighting } of show.cues)
    counts.set(lighting.profile, (counts.get(lighting.profile) ?? 0) + 1);
  let main: Lighting["profile"] | undefined;
  for (const [profile, count] of counts)
    if (main === undefined || count > (counts.get(main) ?? 0)) main = profile;
  return main;
}

export function songCueAt(show: SongShow, time: number): SongCue | null {
  if (!Number.isFinite(time) || time < 0 || time > MAX_SONG_TIME) return null;
  let selected: SongCue | null = null;
  for (const cue of sortedSongCues(show)) {
    if (cue.time > time) break;
    selected = cue;
  }
  return selected;
}

/** Sample an absolute song time. A pulse cue cannot create repeated flashes. */
export function sampleSongCue(cue: SongCue, songTime: number) {
  const elapsed = songTime - cue.time;
  if (!Number.isFinite(elapsed) || elapsed < 0)
    return { color: cue.lighting.color, intensity: 0 };
  // A strobe previews as its flashes, each lit for about 64 ms.
  if (cue.holdMs !== undefined && cue.strobe !== undefined) {
    const lit =
      elapsed < cue.holdMs / 1000 &&
      strobeFlashTimes(cue.holdMs, cue.strobe).some(
        (at) => elapsed >= at && elapsed < at + 0.064,
      );
    return {
      color: cue.lighting.color,
      intensity: lit ? cue.lighting.brightness / 100 : 0,
    };
  }
  // A rainbow previews as full light turning through the colors.
  if (cue.holdMs !== undefined && cue.rainbowMs !== undefined)
    return {
      color: rainbowPreviewColor(elapsed * 1000, cue.rainbowMs),
      intensity:
        elapsed < cue.holdMs / 1000 ? cue.lighting.brightness / 100 : 0,
    };
  // A timed device light previews as steady light for its time, then dark,
  // with its fade in before and its fade out after that time.
  if (cue.holdMs !== undefined) {
    const fadeIn = (cue.fadeInMs ?? 0) / 1000;
    const fadeOut = (cue.fadeOutMs ?? 0) / 1000;
    const hold = cue.holdMs / 1000;
    const level =
      elapsed < fadeIn
        ? elapsed / fadeIn
        : elapsed < fadeIn + hold
          ? 1
          : elapsed < fadeIn + hold + fadeOut
            ? 1 - (elapsed - fadeIn - hold) / fadeOut
            : 0;
    return {
      color: cue.lighting.color,
      intensity: (level * cue.lighting.brightness) / 100,
    };
  }
  if (cue.lighting.effect === "Flash" && cue.pulseMs !== undefined) {
    const frame = sampleEffect({ ...cue.lighting, effect: "Solid" }, elapsed);
    const fraction = Math.max(0, 1 - elapsed / (cue.pulseMs / 1000));
    return {
      color: frame.color,
      intensity: frame.intensity * fraction * fraction,
    };
  }
  return sampleEffect(cue.lighting, elapsed);
}

export function newSongId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `song-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  );
}

export function createSongShow({ sampleCues = true } = {}): SongShow {
  return {
    id: newSongId(),
    name: "Untitled song",
    cues: sampleCues ? [
      {
        id: newSongId(),
        time: 0,
        label: "Opening",
        lighting: {
          ...initialLighting,
          color: "#ff4a61",
          effect: "Solid",
          musicSync: false,
        },
        hardwareColor: "R",
      },
      {
        id: newSongId(),
        time: 8,
        label: "Build",
        lighting: {
          ...initialLighting,
          color: "#6be1fc",
          effect: "Fade",
          musicSync: false,
        },
        hardwareColor: "B",
      },
      {
        id: newSongId(),
        time: 16,
        label: "Chorus",
        lighting: {
          ...initialLighting,
          color: "#ffffff",
          effect: "Flash",
          musicSync: false,
        },
        hardwareColor: "W",
      },
    ] : [],
  };
}

function cleanShow(show: SongShow): SongShow {
  return {
    id: show.id,
    name: show.name.trim(),
    cues: sortedSongCues(show).map((cue) => ({
      id: cue.id,
      time: cue.time,
      label: cue.label,
      lighting: {
        color: cue.lighting.color,
        effect: cue.lighting.effect,
        brightness: cue.lighting.brightness,
        speed: cue.lighting.speed,
        profile: cue.lighting.profile,
        musicSync: false,
      },
      ...(cue.hardwareColor ? { hardwareColor: cue.hardwareColor } : {}),
      ...(cue.pulseMs !== undefined ? { pulseMs: cue.pulseMs } : {}),
      ...(cue.holdMs !== undefined ? { holdMs: cue.holdMs } : {}),
      ...(cue.strobe !== undefined ? { strobe: cue.strobe } : {}),
      ...(cue.levels !== undefined
        ? { levels: [...cue.levels] as DeviceLevels }
        : {}),
      ...(cue.fadeInMs !== undefined ? { fadeInMs: cue.fadeInMs } : {}),
      ...(cue.fadeOutMs !== undefined ? { fadeOutMs: cue.fadeOutMs } : {}),
      ...(cue.rainbowMs !== undefined ? { rainbowMs: cue.rainbowMs } : {}),
      ...(cue.output !== undefined ? { output: cue.output } : {}),
    })),
  };
}

export function readSongShows(storage: Pick<Storage, "getItem">): {
  shows: SongShow[];
  error?: string;
} {
  try {
    const raw = storage.getItem(SONG_SHOW_STORAGE_KEY);
    if (raw === null) return { shows: [] };
    if (raw.length > MAX_STORAGE_LENGTH)
      throw new Error("Saved song shows are too large.");
    const values: unknown = JSON.parse(raw);
    if (
      !Array.isArray(values) ||
      values.length > MAX_SONG_SHOWS ||
      !values.every(validSongShow) ||
      new Set(values.map((show) => show.id)).size !== values.length
    )
      throw new Error("Saved song shows contain invalid data.");
    return { shows: values.map(cleanShow) };
  } catch (error) {
    return {
      shows: [],
      error:
        error instanceof Error
          ? error.message
          : "Saved song shows could not be read.",
    };
  }
}

export function saveSongShows(
  shows: SongShow[],
  storage: Pick<Storage, "setItem">,
): void {
  if (
    !Array.isArray(shows) ||
    shows.length > MAX_SONG_SHOWS ||
    !shows.every(validSongShow) ||
    new Set(shows.map((show) => show.id)).size !== shows.length
  )
    throw new Error(
      `Use up to ${MAX_SONG_SHOWS} valid song shows with up to ${MAX_SONG_CUES} cues each.`,
    );
  const serialized = JSON.stringify(shows.map(cleanShow));
  if (serialized.length > MAX_STORAGE_LENGTH)
    throw new Error("Song shows exceed the local storage limit.");
  try {
    storage.setItem(SONG_SHOW_STORAGE_KEY, serialized);
  } catch {
    throw new Error(
      "Song shows could not be saved. Browser storage may be full or unavailable.",
    );
  }
}

/** Crossings only: resume/seek never replays the currently selected old cue. */
export class SongCueTimeline {
  private previous = 0;
  start(time: number, includeZero = false) {
    this.previous = includeZero && time === 0 ? -0.000001 : time;
  }
  seek(time: number) {
    this.previous = time;
  }
  /** A cue already sent by hand at this time is not sent again by a tick. */
  skipTo(time: number) {
    if (Number.isFinite(time) && time > this.previous) this.previous = time;
  }
  advance(show: SongShow, time: number): SongCue | null {
    if (!Number.isFinite(time) || time < 0 || time > MAX_SONG_TIME) return null;
    const previous = this.previous;
    this.previous = time;
    // Returning from a throttled/suspended tab skips old hardware cues.
    if (time < previous || time - previous > 0.4) return null;
    const cue = songCueAt(show, time);
    return cue && cue.time > previous && time - cue.time <= 0.15 ? cue : null;
  }
}

/** One pending verified preset; late cues are dropped instead of queued. */
export class SongCueOutput {
  private enabled = false;
  private generation = 0;
  private inFlight: object | null = null;
  constructor(
    private readonly transport: Pick<DeviceTransport, "command">,
    private readonly onError: (error: Error) => void,
  ) {}
  get active() {
    return this.enabled;
  }
  enable() {
    if (!this.enabled) {
      this.enabled = true;
      ++this.generation;
    }
  }
  disable() {
    this.enabled = false;
    ++this.generation;
  }
  async send(
    color: SongHardwareColor,
    holdMs?: number,
    strobe?: SongStrobe,
    extras: SongCueExtras = {},
  ): Promise<boolean> {
    if (!this.enabled || this.inFlight || !songHardwareColors.includes(color))
      return false;
    if (holdMs !== undefined && !validHoldMs(holdMs)) return false;
    if (strobe !== undefined && !validStrobe(strobe, holdMs)) return false;
    if (!validCueExtras({ hardwareColor: color, holdMs, strobe, ...extras }))
      return false;
    // A cue with its own output goes as a custom light, which takes the ending.
    const custom =
      extras.levels !== undefined ||
      extras.fadeInMs !== undefined ||
      extras.fadeOutMs !== undefined ||
      extras.output !== undefined;
    const output = extras.output !== undefined ? { output: extras.output } : {};
    const token = {},
      generation = this.generation;
    this.inFlight = token;
    try {
      const result =
        extras.rainbowMs !== undefined
          ? await this.transport.command("rainbow", {
              ms: holdMs,
              cycleMs: extras.rainbowMs,
              ...output,
            })
          : custom
        ? await this.transport.command("custom", {
            kind:
              holdMs === undefined
                ? "flash"
                : strobe === "build"
                  ? "build"
                  : strobe === "steady"
                    ? "strobe"
                    : "light",
            color: extras.levels ? levelsToken(extras.levels) : color,
            ...(holdMs === undefined ? {} : { ms: holdMs }),
            ...(extras.fadeInMs !== undefined || extras.fadeOutMs !== undefined
              ? {
                  fadeIn: fadeCode(extras.fadeInMs),
                  fadeOut: fadeCode(extras.fadeOutMs),
                }
              : {}),
            ...output,
          })
        : holdMs === undefined
          ? await this.transport.command("preset", { color })
          : strobe !== undefined
            ? await this.transport.command("strobe", {
                color,
                ms: holdMs,
                build: strobe === "build",
              })
            : await this.transport.command("light", { color, ms: holdMs });
      return this.enabled && generation === this.generation && result !== false;
    } catch (error) {
      if (this.enabled && generation === this.generation) {
        this.disable();
        this.report(error);
      }
      return false;
    } finally {
      if (this.inFlight === token) this.inFlight = null;
    }
  }
  async stop(): Promise<void> {
    this.disable();
    const generation = this.generation;
    try {
      await this.transport.command("stop");
    } catch (error) {
      if (generation === this.generation) this.report(error);
      throw error;
    }
  }
  private report(error: unknown) {
    try {
      this.onError(error instanceof Error ? error : new Error(String(error)));
    } catch {
      /* Reporting cannot reopen or retry device output. */
    }
  }
}

/**
 * A cue output for a page that hands cues to another sender instead of a
 * device transport. Every field of the cue reaches sendCue unchanged: color,
 * light time, strobe and extras (custom levels, fades, rainbow). The output
 * keeps its own enable / in-flight / error rules.
 */
export function createSongCueRelay(
  sendCue: (
    color: SongHardwareColor,
    holdMs?: number,
    strobe?: SongStrobe,
    extras?: SongCueExtras,
  ) => Promise<boolean>,
  stop: () => Promise<unknown>,
  onError: (error: Error) => void,
): SongCueOutput {
  let pending:
    | [SongHardwareColor, number | undefined, SongStrobe | undefined, SongCueExtras]
    | null = null;
  const output = new SongCueOutput(
    {
      // send() calls this in the same tick, so pending is the cue being sent.
      command: async (operation) =>
        operation === "stop" ? stop() : pending ? sendCue(...pending) : false,
    },
    onError,
  );
  const send = output.send.bind(output);
  output.send = (color, holdMs, strobe, extras = {}) => {
    pending = [color, holdMs, strobe, extras];
    return send(color, holdMs, strobe, extras);
  };
  return output;
}

// One show as a file, for backups and for moving between browsers or sites.
const SHOW_FILE_FORMAT = "pixmob-song-show";
const MAX_SHOW_FILE_LENGTH = 2_000_000;

export function exportSongShow(show: SongShow): string {
  if (!validSongShow(show)) throw new Error("This show cannot be exported.");
  return JSON.stringify(
    { format: SHOW_FILE_FORMAT, version: 1, show: cleanShow(show) },
    null,
    2,
  );
}

/** Reads a show file. The audio is never part of it. */
export function importSongShow(text: string): SongShow {
  if (typeof text !== "string" || text.length > MAX_SHOW_FILE_LENGTH)
    throw new Error("This file is too large to be a show.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("This file is not a show file.");
  }
  const file = parsed as { format?: unknown; version?: unknown; show?: unknown };
  if (
    !file ||
    typeof file !== "object" ||
    file.format !== SHOW_FILE_FORMAT ||
    file.version !== 1 ||
    !validSongShow(file.show)
  )
    throw new Error("This file is not a valid show file.");
  return cleanShow(file.show);
}

/** A safe file name for a show, for example "14-11 coding half version". */
export function songShowFileName(show: SongShow) {
  const base = show.name
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
    .trim()
    .slice(0, 60);
  return `${base || "show"}.pixmob-show.json`;
}
