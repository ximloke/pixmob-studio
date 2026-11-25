import { hexRGB, initialLighting } from "./effects";
import type { Lighting } from "./effects";
import {
  MAX_HOLD_MS,
  MAX_STROBE_MS,
  MAX_SONG_CUES,
  MIN_HOLD_MS,
  MIN_RAINBOW_MS,
  DEFAULT_RAINBOW_CYCLE_MS,
  MIN_STROBE_MS,
  newSongId,
  sortedSongCues,
  validSongShow,
} from "./songShow";
import type { SongHardwareColor, SongShow } from "./songShow";
import { validateRhythmAnalysis } from "./songRhythm";
import type { RhythmAnalysis } from "./songRhythm";

export type BeatShowOptions = {
  name: string;
  profile: Lighting["profile"];
  pattern: "single" | "rgb";
  every: 1 | 2 | 4;
  color?: string;
};

// These preview colors label the existing presets; they do not encode new IR.
const presets: { color: string; hardwareColor: SongHardwareColor }[] = [
  { color: "#ff323e", hardwareColor: "R" },
  { color: "#12b24a", hardwareColor: "G" },
  { color: "#4275ff", hardwareColor: "B" },
  { color: "#ffdc45", hardwareColor: "Y" },
  { color: "#46e4ef", hardwareColor: "C" },
  { color: "#ffffff", hardwareColor: "W" },
];

/** Preview color for each device preset, in the order of the color chips. */
export const devicePresets: readonly {
  color: string;
  hardwareColor: SongHardwareColor;
}[] = presets;

export type ShowLightTiming =
  | "flash"
  | "timed"
  | "until-next"
  | "strobe"
  | "build"
  | "rainbow";

/**
 * Set the device light time of every cue without moving cues or changing
 * colors: the quick flash, one fixed time, or lit until the next cue starts
 * (the last cue uses the given seconds).
 */
export function applyShowLightTiming(
  source: SongShow,
  timing: ShowLightTiming,
  seconds = 1,
): SongShow {
  if (
    !validSongShow(source) ||
    !["flash", "timed", "until-next", "strobe", "build", "rainbow"].includes(
      timing,
    ) ||
    !Number.isFinite(seconds)
  )
    throw new Error("Choose a valid show and light time.");
  const bounded = (ms: number) =>
    Math.max(MIN_HOLD_MS, Math.min(MAX_HOLD_MS, Math.round(ms)));
  const fixed = bounded(seconds * 1000);
  const sorted = sortedSongCues(source);
  const nextTime = new Map<string, number>();
  sorted.forEach((cue, index) => {
    if (index + 1 < sorted.length) nextTime.set(cue.id, sorted[index + 1].time);
  });
  return {
    ...source,
    cues: source.cues.map((cue) => {
      const {
        holdMs: _removed,
        strobe: _strobe,
        fadeInMs,
        fadeOutMs,
        rainbowMs,
        ...rest
      } = cue;
      if (timing === "rainbow")
        return {
          ...rest,
          holdMs: Math.max(MIN_RAINBOW_MS, fixed),
          rainbowMs: rainbowMs ?? DEFAULT_RAINBOW_CYCLE_MS,
        };
      // Fades belong to steady lights only; they survive between those.
      const fades = {
        ...(fadeInMs !== undefined ? { fadeInMs } : {}),
        ...(fadeOutMs !== undefined ? { fadeOutMs } : {}),
      };
      if (timing === "flash") return rest;
      if (timing === "timed") return { ...rest, ...fades, holdMs: fixed };
      if (timing === "strobe" || timing === "build")
        return {
          ...rest,
          holdMs: Math.max(MIN_STROBE_MS, Math.min(MAX_STROBE_MS, fixed)),
          strobe: timing === "build" ? ("build" as const) : ("steady" as const),
        };
      const next = nextTime.get(cue.id);
      return {
        ...rest,
        ...fades,
        holdMs: next === undefined ? fixed : bounded((next - cue.time) * 1000),
      };
    }),
  };
}

export function nearestDevicePreset(color: string) {
  if (!/^#[0-9a-f]{6}$/i.test(color))
    throw new Error("Choose a valid pulse color.");
  const rgb = hexRGB(color);
  return presets.reduce((best, preset) => {
    const distance = (hex: string) =>
      hexRGB(hex).reduce(
        (sum, value, index) => sum + (value - rgb[index]) ** 2,
        0,
      );
    return distance(preset.color) < distance(best.color) ? preset : best;
  });
}

/** Explicitly apply pulse colors without changing authored timing or IDs. */
export function applyShowPulsePattern(
  source: SongShow,
  pattern: "single" | "rgb",
  color = "#ff323e",
): SongShow {
  if (!validSongShow(source) || !["single", "rgb"].includes(pattern))
    throw new Error("Choose a valid show and pattern.");
  const single = nearestDevicePreset(color);
  return {
    ...source,
    cues: source.cues.map((cue, index) => ({
      ...cue,
      lighting: {
        ...cue.lighting,
        color:
          pattern === "single" ? color.toLowerCase() : presets[index % 3].color,
        effect: "Flash",
        musicSync: false,
      },
      pulseMs: cue.pulseMs ?? 120,
      hardwareColor:
        pattern === "single"
          ? single.hardwareColor
          : presets[index % 3].hardwareColor,
    })),
  };
}

/** Preserve authored timing in a separate, explicit verified-color test show. */
export function createRgbDeviceCopy(source: SongShow): SongShow {
  if (!validSongShow(source) || !source.cues.length)
    throw new Error(
      "Choose a valid show with cues before creating a device copy.",
    );
  return {
    id: newSongId(),
    name: `${source.name.slice(0, 74)} · RGB`,
    cues: source.cues.map((cue, index) => ({
      ...cue,
      id: newSongId(),
      lighting: {
        ...cue.lighting,
        color: presets[index % 3].color,
        effect: "Flash",
        brightness: 100,
        musicSync: false,
      },
      pulseMs: 120,
      hardwareColor: presets[index % 3].hardwareColor,
    })),
  };
}

/** Make an unsaved draft from measured attacks, preserving their actual times. */
export function generateBeatShow(
  analysis: RhythmAnalysis,
  options: BeatShowOptions,
): { show: SongShow; usedBeats: number; stride: number } {
  if (!validateRhythmAnalysis(analysis))
    throw new Error("Analyze a valid local song before generating cues.");
  if (!analysis.beats.length)
    throw new Error("No clear drum attacks were found. Add cues manually.");
  if (
    !options ||
    typeof options.name !== "string" ||
    !options.name.trim() ||
    options.name.length > 80 ||
    !["Taylor Swift", "The Weeknd"].includes(options.profile) ||
    !["single", "rgb"].includes(options.pattern) ||
    ![1, 2, 4].includes(options.every) ||
    (options.color !== undefined && !/^#[0-9a-f]{6}$/i.test(options.color))
  )
    throw new Error("Choose a show name, valid color and beat pattern.");

  const requested = Math.ceil(analysis.beats.length / options.every);
  // Thin by powers of two only, so a thinned draft keeps landing on the same
  // beat of every bar instead of drifting one beat per cycle (a stride of 3).
  let factor = 1;
  while (Math.ceil(requested / factor) > MAX_SONG_CUES) factor *= 2;
  const stride = options.every * factor;
  const singleColor = (options.color ?? presets[0].color).toLowerCase();
  const singlePreset = nearestDevicePreset(singleColor);
  const show: SongShow = {
    id: newSongId(),
    name: options.name.trim(),
    cues: [],
  };
  for (let index = 0; index < analysis.beats.length; index += stride) {
    const selected =
      options.pattern === "rgb"
        ? presets[show.cues.length % 3]
        : { color: singleColor, hardwareColor: singlePreset?.hardwareColor };
    show.cues.push({
      id: newSongId(),
      time: analysis.beats[index],
      label: `Beat ${index + 1}`,
      lighting: {
        ...initialLighting,
        profile: options.profile,
        color: selected.color,
        effect: "Flash",
        brightness: 100,
        musicSync: false,
      },
      pulseMs: 120,
      ...(selected.hardwareColor
        ? { hardwareColor: selected.hardwareColor }
        : {}),
    });
  }
  return { show, usedBeats: show.cues.length, stride };
}
