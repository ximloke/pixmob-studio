// Picks the main color of a shared video frame and turns it into wristband
// levels, for browser beats that follow what is playing.
import type { DeviceLevels } from "./deviceColors";

/**
 * The levels this wristband showed as red, yellow, green, cyan, blue and
 * magenta (ColorLevels.h), at hues 0, 60, 120, 180, 240 and 300 degrees.
 */
const HUE_LEVELS: DeviceLevels[] = [
  [132, 32, 0],
  [132, 124, 0],
  [88, 164, 0],
  [68, 184, 160],
  [16, 12, 160],
  [180, 76, 120],
];
const WHITE_LEVELS: DeviceLevels = [124, 124, 124];
/** Below this brightness (0 to 1) a frame has no usable color. */
export const MIN_SCREEN_BRIGHTNESS = 0.12;
/** Below this saturation (0 to 1) a bright frame counts as white. */
export const MIN_SCREEN_SATURATION = 0.18;

export type ScreenColor = { red: number; green: number; blue: number };

/**
 * Main color of RGBA pixel data. Vivid, bright pixels count more than dull
 * ones, so a colored stage light wins over a large dark background.
 */
export function mainScreenColor(
  pixels: ArrayLike<number>,
): ScreenColor | null {
  let red = 0,
    green = 0,
    blue = 0,
    weight = 0;
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    const r = pixels[index],
      g = pixels[index + 1],
      b = pixels[index + 2];
    const top = Math.max(r, g, b);
    const spread = top - Math.min(r, g, b);
    // Brightness times vividness, with a small floor so gray frames still
    // average to something.
    const w = (top / 255) * (0.05 + spread / 255);
    red += r * w;
    green += g * w;
    blue += b * w;
    weight += w;
  }
  if (!(weight > 0)) return null;
  return { red: red / weight, green: green / weight, blue: blue / weight };
}

/**
 * Wristband levels for a screen color: its hue placed on the path through
 * the six colors the wristband is known to show. Returns white for bright
 * colorless frames and null for dark ones.
 */
export function screenColorLevels(color: ScreenColor | null): DeviceLevels | null {
  if (!color) return null;
  const { red, green, blue } = color;
  if (![red, green, blue].every((value) => Number.isFinite(value))) return null;
  const top = Math.max(red, green, blue);
  const bottom = Math.min(red, green, blue);
  if (top / 255 < MIN_SCREEN_BRIGHTNESS) return null;
  const spread = top - bottom;
  if (spread / top < MIN_SCREEN_SATURATION) return [...WHITE_LEVELS];
  let hue =
    top === red
      ? ((green - blue) / spread) % 6
      : top === green
        ? (blue - red) / spread + 2
        : (red - green) / spread + 4;
  if (hue < 0) hue += 6;
  const segment = Math.floor(hue) % 6;
  const within = hue - Math.floor(hue);
  const from = HUE_LEVELS[segment];
  const to = HUE_LEVELS[(segment + 1) % 6];
  return from.map(
    (level, index) =>
      Math.round((level + (to[index] - level) * within) / 4) * 4,
  ) as DeviceLevels;
}

/**
 * Reads the current frame of a shared tab or screen. Needs a browser; returns
 * null whenever no frame can be read (no video track, sharing ended).
 */
export function createScreenColorSampler(
  stream: MediaStream | null,
): (() => DeviceLevels | null) & { stop: () => void } {
  const tracks = stream?.getVideoTracks() ?? [];
  if (!tracks.length || typeof document === "undefined") {
    const none = () => null;
    return Object.assign(none, { stop: () => {} });
  }
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream(tracks);
  void video.play().catch(() => {});
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 18;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  let stopped = false;
  const sample = () => {
    if (
      stopped ||
      !context ||
      tracks[0].readyState !== "live" ||
      video.readyState < 2
    )
      return null;
    try {
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      return screenColorLevels(
        mainScreenColor(
          context.getImageData(0, 0, canvas.width, canvas.height).data,
        ),
      );
    } catch {
      return null;
    }
  };
  return Object.assign(sample, {
    stop: () => {
      stopped = true;
      video.srcObject = null;
    },
  });
}
