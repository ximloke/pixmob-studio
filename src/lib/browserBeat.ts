import type { AudioFrame } from "./audio";
import type { DeviceTransport } from "./device";
import { levelsToken } from "./deviceColors";
import type { DeviceLevels } from "./deviceColors";

export type BrowserBeatInput = {
  source: "system" | "microphone" | "demo" | "esp32";
  active: boolean;
};

export type BrowserBeatColor = "R" | "G" | "B" | "Y" | "C" | "M" | "W" | "K";
const defaultBeatColors: BrowserBeatColor[] = ["R", "G", "B"];
let beatColors: BrowserBeatColor[] = defaultBeatColors;
/**
 * Colors browser beats step through. Anything but R/G/B needs firmware that
 * reports BEAT EFFECTS; an empty or invalid list restores R, G, B.
 */
export function setBrowserBeatColors(colors: readonly string[]) {
  const valid = colors.filter((color): color is BrowserBeatColor =>
    ["R", "G", "B", "Y", "C", "M", "W", "K"].includes(color),
  );
  beatColors =
    valid.length && valid.length === colors.length && valid.length <= 8
      ? valid
      : defaultBeatColors;
}
export const browserBeatColors = () => [...beatColors];

// Following the shared video: a beat takes the frame's main color when one
// can be read, and the chosen colors otherwise. Needs BEAT EFFECTS firmware.
let screenColorSource: (() => DeviceLevels | null) | null = null;
let followScreen = false;
export function setBrowserBeatScreenSource(
  source: (() => DeviceLevels | null) | null,
) {
  screenColorSource = source;
}
export function setFollowScreenColors(follow: boolean) {
  followScreen = follow;
}
export const followsScreenColors = () => followScreen;

/** Sends measured browser onsets only; it owns no clock, capture or device mode. */
export class BrowserBeatOutput {
  private enabled = false;
  private generation = 0;
  private inFlight: object | null = null;
  private colorIndex = 0;
  private beatHigh = false;
  private lastFrameAt = -Infinity;
  private lastSentAt = -Infinity;

  constructor(
    private readonly transport: DeviceTransport,
    private readonly onError: (error: Error) => void,
  ) {}

  get active() {
    return this.enabled;
  }

  // The caller must first establish the firmware's browser/host mode.
  enable() {
    if (this.enabled) return;
    this.enabled = true;
    ++this.generation;
    this.colorIndex = 0;
    this.beatHigh = false;
    this.lastFrameAt = -Infinity;
  }

  // An already-written frame cannot be recalled. Never enqueue a replacement.
  // Root orchestration owns the physical Stop command and capture lifecycle.
  disable() {
    this.enabled = false;
    ++this.generation;
    this.beatHigh = false;
  }

  process(frame: AudioFrame, now: number, input: BrowserBeatInput): void {
    if (
      !this.enabled ||
      !input.active ||
      (input.source !== "system" && input.source !== "microphone")
    ) {
      this.beatHigh = false;
      return;
    }
    // Separate tick/onset messages can share a reduced-precision clock value.
    // Edge detection and send spacing still reject repeated or replayed beats.
    if (!Number.isFinite(now) || now < this.lastFrameAt) return;
    this.lastFrameAt = now;
    const onset = frame.beat && !this.beatHigh;
    this.beatHigh = frame.beat;
    if (
      !onset ||
      !Number.isFinite(frame.level) ||
      frame.level <= 0 ||
      this.inFlight ||
      now - this.lastSentAt < 200
    )
      return;

    const generation = this.generation;
    const token = {};
    const colors = beatColors;
    let screen: DeviceLevels | null = null;
    if (followScreen && screenColorSource) {
      try {
        screen = screenColorSource();
      } catch {
        screen = null;
      }
    }
    const color = screen
      ? levelsToken(screen)
      : colors[this.colorIndex % colors.length];
    this.inFlight = token;
    this.lastSentAt = now;
    try {
      Promise.resolve(this.transport.command("beat", { color }))
        .then(
          () => {
            // A beat that took the video's color keeps the palette position.
            if (!screen && this.enabled && generation === this.generation)
              this.colorIndex = (this.colorIndex + 1) % colors.length;
          },
          (error: unknown) => this.reject(error, generation),
        )
        .finally(() => {
          if (this.inFlight === token) this.inFlight = null;
        });
    } catch (error) {
      if (this.inFlight === token) this.inFlight = null;
      this.reject(error, generation);
    }
  }

  private reject(error: unknown, generation: number) {
    if (!this.enabled || generation !== this.generation) return;
    this.disable();
    const failure = error instanceof Error ? error : new Error(String(error));
    try {
      this.onError(failure);
    } catch {
      // Reporting must not turn an already-handled device error into a rejection.
    }
  }
}
