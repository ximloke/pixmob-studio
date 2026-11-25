export type Effect = "Solid" | "Flash" | "Fade" | "Strobe" | "Rainbow";
export type Lighting = {
  color: string;
  effect: Effect;
  brightness: number;
  speed: number;
  profile: "Taylor Swift" | "The Weeknd";
  musicSync: boolean;
};
export const initialLighting: Lighting = {
  color: "#b8fa5a",
  effect: "Solid",
  brightness: 80,
  speed: 50,
  profile: "Taylor Swift",
  musicSync: false,
};
export const effects: Effect[] = [
  "Solid",
  "Flash",
  "Fade",
  "Strobe",
  "Rainbow",
];
export function hexRGB(hex: string) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}
export function rgbHex(rgb: number[]) {
  return (
    "#" +
    rgb
      .map((v) =>
        Math.max(0, Math.min(255, Math.round(v)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
export function sampleEffect(s: Lighting, time: number, audioLevel = 1) {
  const hz = 0.25 + (s.speed / 100) * 2.75;
  const phase = (time * hz) % 1;
  let intensity = 1;
  if (s.effect === "Flash") intensity = phase < 0.35 ? 1 : 0.04;
  if (s.effect === "Fade")
    intensity = 0.12 + (0.88 * (Math.sin(time * hz * Math.PI * 2) + 1)) / 2;
  // Simulator intentionally caps strobe at 3 Hz.
  if (s.effect === "Strobe") intensity = phase < 0.12 ? 1 : 0.02;
  const color =
    s.effect === "Rainbow" ? `hsl(${(time * hz * 65) % 360} 95% 65%)` : s.color;
  return {
    color,
    intensity:
      ((intensity * s.brightness) / 100) *
      (s.musicSync ? Math.max(0.04, audioLevel) : 1),
  };
}
export function validLighting(v: unknown): v is Lighting {
  if (!v || typeof v !== "object") return false;
  const s = v as Lighting;
  return (
    /^#[0-9a-f]{6}$/i.test(s.color) &&
    effects.includes(s.effect) &&
    Number.isFinite(s.brightness) &&
    s.brightness >= 0 &&
    s.brightness <= 100 &&
    Number.isFinite(s.speed) &&
    s.speed >= 0 &&
    s.speed <= 100 &&
    ["Taylor Swift", "The Weeknd"].includes(s.profile) &&
    typeof s.musicSync === "boolean"
  );
}
export type Scene = { id: string; name: string; lighting: Lighting };
export const builtInScenes: Scene[] = [
  { id: "lime", name: "Electric lime", lighting: { ...initialLighting } },
  {
    id: "haze",
    name: "Purple haze",
    lighting: {
      ...initialLighting,
      color: "#b487ff",
      effect: "Fade",
      speed: 30,
    },
  },
  {
    id: "after",
    name: "After hours",
    lighting: {
      ...initialLighting,
      color: "#ff4a61",
      effect: "Flash",
      profile: "The Weeknd",
      speed: 35,
    },
  },
  {
    id: "dream",
    name: "Daydream",
    lighting: {
      ...initialLighting,
      color: "#6be1fc",
      effect: "Rainbow",
      speed: 20,
    },
  },
];
