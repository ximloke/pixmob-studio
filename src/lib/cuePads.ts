import {
  MAX_HOLD_MS,
  MAX_STROBE_MS,
  MIN_HOLD_MS,
  MIN_RAINBOW_MS,
  MIN_STROBE_MS,
  songHardwareColors,
  type SongHardwareColor,
} from "./songShow";

export const CUE_PAD_STORAGE_KEY = "pixmob.song.cue-pads.v1";

export const cuePadModes = [
  "flash",
  "timed",
  "strobe",
  "build",
  "rainbow",
] as const;

export type CuePadMode = (typeof cuePadModes)[number];

export type CuePad = {
  color: SongHardwareColor;
  mode: CuePadMode;
  seconds: number;
};

export const defaultCuePads: readonly CuePad[] = [
  { color: "R", mode: "flash", seconds: 1 },
  { color: "B", mode: "flash", seconds: 1 },
  { color: "W", mode: "flash", seconds: 1 },
  { color: "C", mode: "flash", seconds: 1 },
  { color: "R", mode: "timed", seconds: 1 },
  { color: "B", mode: "strobe", seconds: 2 },
  { color: "W", mode: "build", seconds: 3 },
  { color: "W", mode: "rainbow", seconds: 3 },
];

const validSeconds = (mode: CuePadMode, value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  const milliseconds = value * 1000;
  const minimum =
    mode === "rainbow"
      ? MIN_RAINBOW_MS
      : mode === "strobe" || mode === "build"
        ? MIN_STROBE_MS
        : MIN_HOLD_MS;
  const maximum =
    mode === "strobe" || mode === "build" ? MAX_STROBE_MS : MAX_HOLD_MS;
  return milliseconds >= minimum && milliseconds <= maximum;
};

const validPad = (value: unknown): value is CuePad => {
  if (!value || typeof value !== "object") return false;
  const pad = value as Partial<CuePad>;
  return (
    songHardwareColors.includes(pad.color as SongHardwareColor) &&
    cuePadModes.includes(pad.mode as CuePadMode) &&
    validSeconds(pad.mode as CuePadMode, pad.seconds)
  );
};

export function readCuePads(storage: Pick<Storage, "getItem">): CuePad[] {
  try {
    const raw = storage.getItem(CUE_PAD_STORAGE_KEY);
    if (!raw) return defaultCuePads.map((pad) => ({ ...pad }));
    const value: unknown = JSON.parse(raw);
    if (
      !Array.isArray(value) ||
      value.length !== defaultCuePads.length ||
      !value.every(validPad)
    )
      return defaultCuePads.map((pad) => ({ ...pad }));
    return value.map((pad) => ({ ...pad }));
  } catch {
    return defaultCuePads.map((pad) => ({ ...pad }));
  }
}

export function saveCuePads(
  pads: readonly CuePad[],
  storage: Pick<Storage, "setItem">,
) {
  if (pads.length !== defaultCuePads.length || !pads.every(validPad))
    throw new Error("Cue pad settings are invalid.");
  storage.setItem(CUE_PAD_STORAGE_KEY, JSON.stringify(pads));
}
