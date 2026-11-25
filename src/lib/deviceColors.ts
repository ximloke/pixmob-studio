// Device colors beyond the eight presets: red/green/blue levels as the
// wristband command carries them, and the fade times it supports.

/** Flashes with a channel of 204 or more were weak on the user's wristband. */
export const MAX_DEVICE_LEVEL = 200;
export type DeviceLevels = [number, number, number];

/** Whole levels in steps of four, none above the maximum, not near black. */
export function validDeviceLevels(value: unknown): value is DeviceLevels {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every(
      (level) =>
        typeof level === "number" &&
        Number.isInteger(level) &&
        level >= 0 &&
        level <= MAX_DEVICE_LEVEL &&
        level % 4 === 0,
    ) &&
    Math.max(...(value as number[])) >= 8
  );
}

/** Nearest valid levels for free input such as sliders. */
export function snapDeviceLevels(value: readonly number[]): DeviceLevels {
  const snapped = [0, 1, 2].map((index) => {
    const level = Number.isFinite(value[index]) ? value[index] : 0;
    return Math.max(0, Math.min(MAX_DEVICE_LEVEL, Math.round(level / 4) * 4));
  }) as DeviceLevels;
  if (Math.max(...snapped) < 8)
    snapped[snapped.indexOf(Math.max(...snapped))] = 8;
  return snapped;
}

/** The firmware's color token for custom levels, for example =843C00. */
export const levelsToken = (levels: DeviceLevels) =>
  `=${levels.map((level) => level.toString(16).toUpperCase().padStart(2, "0")).join("")}`;

/**
 * A screen color for a swatch or preview: the same channel ratio at full
 * brightness. It is an illustration, not what the LEDs will look like.
 */
export function levelsHex(levels: DeviceLevels) {
  const top = Math.max(...levels, 1);
  return `#${levels
    .map((level) =>
      Math.round((level / top) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/**
 * Ready-made extra colors. Values come from published PixMob codes (named in
 * the comments) kept at or below the maximum level; none has been observed on
 * the user's wristband yet.
 */
// Removed on the user's request (13 Nov 2026): Lime looked the same as Green
// and Pink the same as Magenta at every value tried (Lime 132/152/0 and
// 132/136/0; Pink 184/120/144, 164/104/128 and 168/132/128).
export const extraDeviceColors: readonly {
  name: string;
  levels: DeviceLevels;
}[] = [
  { name: "Orange", levels: [132, 64, 0] }, // ORANGE_2
  { name: "Sky blue", levels: [68, 72, 160] }, // LIGHT_BLUE (9-byte code)
  { name: "Ice blue", levels: [104, 132, 160] }, // WHITISH_BLUE
  // MAGENTA_3 (188/16/160) scaled by 0.85: at full value it would not stay
  // lit on the user's wristband; the scaled value was seen to work.
  { name: "Hot pink", levels: [160, 12, 136] },
];

/**
 * The firmware's Magenta preset levels. Song shows offers it with the extra
 * colors because the preset letter M cannot be a cue's fallback color.
 */
export const magentaDeviceColor: { name: string; levels: DeviceLevels } = {
  name: "Magenta",
  levels: [180, 76, 120],
};

/** Fade times the command supports (envelope codes 2 to 7), milliseconds. */
export const FADE_TIMES_MS = [96, 192, 480, 960, 2400, 3840] as const;
export function validFadeMs(value: unknown): value is number {
  return (
    typeof value === "number" &&
    (FADE_TIMES_MS as readonly number[]).includes(value)
  );
}
/** Envelope code for a fade time; 0 for no fade. */
export const fadeCode = (ms: number | undefined) =>
  ms === undefined ? 0 : (FADE_TIMES_MS as readonly number[]).indexOf(ms) + 2;

// The user's own saved colors, shared by the live control and Song shows.
export type SavedDeviceColor = { name: string; levels: DeviceLevels };
export const SAVED_COLORS_STORAGE_KEY = "pixmob.deviceColors.v1";
export const MAX_SAVED_COLORS = 24;

export function validSavedColors(value: unknown): value is SavedDeviceColor[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_SAVED_COLORS &&
    value.every(
      (item) =>
        item &&
        typeof item === "object" &&
        typeof item.name === "string" &&
        item.name.length >= 1 &&
        item.name.length <= 24 &&
        validDeviceLevels(item.levels),
    )
  );
}

export function readSavedColors(
  storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage,
): SavedDeviceColor[] {
  try {
    const parsed: unknown = JSON.parse(
      storage?.getItem(SAVED_COLORS_STORAGE_KEY) ?? "[]",
    );
    return validSavedColors(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

let saved: SavedDeviceColor[] | null = null;
const listeners = new Set<() => void>();
export const savedColorsStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
  get(): SavedDeviceColor[] {
    return (saved ??= readSavedColors());
  },
  /** Returns false when the list is invalid or cannot be stored. */
  set(
    next: SavedDeviceColor[],
    storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage,
  ) {
    if (!validSavedColors(next)) return false;
    try {
      storage?.setItem(SAVED_COLORS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      return false;
    }
    saved = next;
    listeners.forEach((listener) => listener());
    return true;
  },
};
