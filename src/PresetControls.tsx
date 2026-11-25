import { useState, useSyncExternalStore } from "react";
import {
  extraDeviceColors,
  fadeCode,
  FADE_TIMES_MS,
  levelsHex,
  levelsToken,
  MAX_DEVICE_LEVEL,
  MAX_SAVED_COLORS,
  savedColorsStore,
  snapDeviceLevels,
} from "./lib/deviceColors";
import type { DeviceLevels } from "./lib/deviceColors";
import {
  followsScreenColors,
  setBrowserBeatColors,
  setFollowScreenColors,
} from "./lib/browserBeat";
import { Activity, Music2, Radio, Square } from "lucide-react";
import type { Status } from "./lib/device";

export const presetColors = {
  R: { name: "Red", hex: "#ff323e" },
  // Deeper than Cyan on screen, as on the wristband (user, 13 Nov 2026).
  G: { name: "Green", hex: "#12b24a" },
  B: { name: "Blue", hex: "#4275ff" },
  Y: { name: "Yellow", hex: "#ffdc45" },
  C: { name: "Cyan", hex: "#46e4ef" },
  M: { name: "Magenta", hex: "#ec58ce" },
  W: { name: "White", hex: "#ffffff" },
  // The hue of the sketch's original W frame (upstream WHITISH, R204/G176/B92).
  K: { name: "Warm white", hex: "#ccb05c" },
};

/**
 * Label W by the waveform the connected firmware reports for it. Hex values
 * are protocol channel values or preview colors, not measured LED output.
 */
export function presetLook(
  color: keyof typeof presetColors,
  status?: Pick<Status, "whitePreset">,
) {
  // The neutral frame was seen visibly whiter than the original on the
  // wristband (13 Nov 2026); that comparison, not a measurement, names it White.
  if (color === "W" && status?.whitePreset === "whitish")
    return { name: "White (warm original)", hex: "#ccb05c" };
  if (color === "W" && status?.whitePreset === "neutral-candidate")
    return { name: "White", hex: "#ffffff" };
  return presetColors[color];
}

// Why the board's RF copy is unavailable, from its RF state line.
const RF_FAULTS: Record<string, string> = {
  "not-found": "RF is unavailable: the board found no CC1101 radio.",
  "wire-error": "RF is unavailable: the GDO0 wire check failed. Check the CC1101 wiring.",
  "rmt-error": "RF is unavailable: the ESP32 could not drive the GDO0 pin.",
  "setup-error": "RF is unavailable: the CC1101 did not accept its settings.",
};

function rfSummary(rf: NonNullable<Status["rf"]>) {
  const carrier =
    rf.mhz === undefined ? "" : `${rf.mhz.toFixed(2)} MHz, ${rf.dbm ?? "?"} dBm. `;
  const failed = rf.framesFailed ? ` ${rf.framesFailed} RF frames failed.` : "";
  const sleep =
    rf.sleepAfterS === undefined
      ? ""
      : rf.sleepAfterS === 0
        ? " Once awake, wristbands are kept awake while the board is powered."
        : ` Wristbands are left to sleep ${sleepLabel(rf.sleepAfterS)} after the last light; the next light starts a 35 s wake, which may be too short for them.`;
  // 21 Nov 2026: a band that had slept a while did not wake from 35 s or a
  // 40 s RF rainbow, and did partway through a 120 s rainbow.
  const waking =
    " A wristband that has slept a while can need 1–2 min of RF to wake; a long rainbow does it.";
  return rf.state === "on"
    ? `${carrier}Every light also goes out by RF, so wristbands out of the IR beam light too.${waking}${sleep}${failed}`
    : rf.state === "only"
      ? `${carrier}Lights go out by RF only; the IR emitter stays dark.${waking}${sleep}${failed}`
      : `${carrier}Lights go out by IR only, and no RF goes out at all, so RF wristbands fall asleep. Choosing RF wakes them for 35 s.`;
}
function sleepLabel(seconds: number) {
  return seconds % 3600 === 0
    ? `${seconds / 3600} h`
    : seconds % 60 === 0
      ? `${seconds / 60} min`
      : `${seconds} s`;
}
// When RF wristbands may sleep, plus a value set some other way.
const RF_SLEEP_SECONDS = [0, 300, 1800, 3600];
function rfSleepChoices(current: number | undefined) {
  return current === undefined || RF_SLEEP_SECONDS.includes(current)
    ? RF_SLEEP_SECONDS
    : [...RF_SLEEP_SECONDS, current].sort((a, b) => a - b);
}
const RF_STATE_OUTPUT = { on: "both", off: "ir", only: "rf" } as const;

// Idle seconds offered for the rainbow, plus a value set some other way.
const IDLE_RAINBOW_SECONDS = [5, 10, 30, 60];
function idleRainbowChoices(current: number) {
  return current >= 2 && !IDLE_RAINBOW_SECONDS.includes(current)
    ? [...IDLE_RAINBOW_SECONDS, current].sort((a, b) => a - b)
    : IDLE_RAINBOW_SECONDS;
}

export default function PresetControls({
  status,
  busy,
  onCommand,
  onBrowserSync,
}: {
  status: Status;
  busy: boolean;
  onCommand: (op: string, payload?: unknown) => Promise<void>;
  onBrowserSync: () => void;
}) {
  const send = (op: string, payload?: unknown) => void onCommand(op, payload);
  const v2 = status.mode === "v2-serial";
  // Manual colors can be the quick flash or a light that stays on for a set
  // time (firmware with the timed light command only).
  const [light, setLight] = useState<
    "flash" | "timed" | "strobe" | "build" | "rainbow"
  >(
    "flash",
  );
  const timed = light !== "flash";
  const strobing = light === "strobe" || light === "build";
  const [lightSeconds, setLightSeconds] = useState(2);
  const timedOn = !v2 && timed && !!status.timedLightSupported;
  const lightMs = Math.max(
    strobing ? 200 : 100,
    Math.min(strobing ? 60000 : 600000, Math.round((lightSeconds || 0) * 1000)),
  );
  // Extra and custom colors, and fades for steady lights (firmware with the
  // custom light commands only).
  const customOn = !v2 && !!status.customLightSupported;
  const [fadeInMs, setFadeInMs] = useState<number | undefined>();
  const [fadeOutMs, setFadeOutMs] = useState<number | undefined>();
  const [levels, setLevels] = useState<DeviceLevels>([132, 64, 0]);
  const [colorName, setColorName] = useState("");
  const savedColors = useSyncExternalStore(
    savedColorsStore.subscribe,
    savedColorsStore.get,
  );
  const fading =
    customOn &&
    light === "timed" &&
    (fadeInMs !== undefined || fadeOutMs !== undefined);
  /** Sends a preset letter or =RRGGBB with the chosen light and fades. */
  const [cycleSeconds, setCycleSeconds] = useState(3);
  const rainbowOn = !v2 && light === "rainbow" && !!status.rainbowSupported;
  const sendRainbow = () =>
    send("rainbow", {
      ms: Math.max(500, lightMs),
      cycleMs: Math.max(
        1000,
        Math.min(20000, Math.round((cycleSeconds || 3) * 1000)),
      ),
    });
  const sendColor = (color: string) => {
    // Rainbow has no color of its own; any color button starts it.
    if (rainbowOn) return sendRainbow();
    const custom = color.startsWith("=");
    // The single letter M starts Music, so a Magenta flash uses the line
    // command instead.
    if (!timedOn && !custom && color !== "M") return send("preset", { color });
    if (timedOn && !custom && !fading)
      return strobing
        ? send("strobe", { color, ms: lightMs, build: light === "build" })
        : send("light", { color, ms: lightMs });
    return send("custom", {
      kind: !timedOn ? "flash" : light === "timed" ? "light" : light,
      color,
      ...(timedOn ? { ms: lightMs } : {}),
      ...(fading
        ? { fadeIn: fadeCode(fadeInMs), fadeOut: fadeCode(fadeOutMs) }
        : {}),
    });
  };
  // Auto, mic sync and browser sync show each step in the Light chosen
  // above and step through the chosen colors (firmware with beat effects).
  const beatOn = !v2 && !!status.beatEffectsSupported;
  const [beatColors, setBeatColors] = useState("RGBYCMW");
  const [followVideo, setFollowVideo] = useState(followsScreenColors);
  const beatStyle =
    light === "timed"
      ? {
          kind: "light",
          ms: Math.max(50, Math.min(10000, lightMs)),
          fadeIn: customOn ? fadeCode(fadeInMs) : 0,
          fadeOut: customOn ? fadeCode(fadeOutMs) : 0,
        }
      : light === "strobe" || light === "build"
        ? { kind: "strobe", ms: Math.max(200, Math.min(5000, lightMs)) }
        : { kind: "flash" };
  /** Sends the beat look; the running mode is not interrupted. */
  const applyBeatLook = async () => {
    if (!beatOn) return;
    await onCommand("beatStyle", beatStyle);
    await onCommand("beatPalette", { colors: beatColors });
    setBrowserBeatColors(beatColors.split(""));
  };
  /** Each color fades in 0.96 s, stays 5 s and fades out 0.96 s, in turn. */
  const startBreathing = async () => {
    await onCommand("beatStyle", {
      kind: "light",
      ms: 5000,
      fadeIn: fadeCode(960),
      fadeOut: fadeCode(960),
    });
    await onCommand("beatPalette", { colors: beatColors });
    await onCommand("auto");
  };
  const startMode = async (start: () => void | Promise<void>) => {
    await applyBeatLook();
    await start();
  };
  const musicActive = ["music", "level", "beat"].includes(
    status.deviceMode ?? "",
  );
  return (
    <section
      className="panel preset-controller"
      aria-label="ESP32 preset controls"
    >
      <div className="panel-heading">
        <h2>
          <Radio size={17} /> ESP32 live control
        </h2>
        <span className="small-tag">
          USB · {status.deviceMode?.toUpperCase() ?? "MANUAL"}
        </span>
      </div>
      <div className="preset-controller-body">
        <p>
          Send the presets from your sketch. Device replies confirm the command;
          wristband reception needs a visual check.
        </p>
        <div className="hardware-presets">
          {(v2
            ? (["R", "G", "B", "Y", "C", "M", "W"] as const)
            : timedOn || customOn
              ? (["R", "G", "B", "Y", "C", "M", "W", "K"] as const)
              : status.legacyWhitishSupported
                ? (["R", "G", "B", "Y", "C", "W", "K"] as const)
                : (["R", "G", "B", "Y", "C", "W"] as const)
          ).map((color) => (
            <button
              key={color}
              className="button secondary"
              disabled={busy}
              aria-label={`Send ${presetLook(color, status).name} to wristband`}
              onClick={() => sendColor(color)}
            >
              <i style={{ background: presetLook(color, status).hex }} />
              {presetLook(color, status).name}
            </button>
          ))}
        </div>
        {customOn && (
          <div className="preset-more-colors">
            <div className="hardware-presets">
              {[...extraDeviceColors, ...savedColors].map((extra, index) => (
                <button
                  key={`${extra.name}-${index}`}
                  className="button secondary"
                  disabled={busy}
                  title={`Levels ${extra.levels.join(" / ")}`}
                  aria-label={`Send ${extra.name} to wristband`}
                  onClick={() => {
                    setLevels(extra.levels);
                    sendColor(levelsToken(extra.levels));
                  }}
                >
                  <i style={{ background: levelsHex(extra.levels) }} />
                  {extra.name}
                  {index >= extraDeviceColors.length && (
                    <span
                      role="button"
                      tabIndex={0}
                      className="preset-remove-color"
                      aria-label={`Remove saved color ${extra.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        savedColorsStore.set(
                          savedColors.filter(
                            (_item, at) =>
                              at !== index - extraDeviceColors.length,
                          ),
                        );
                      }}
                    >
                      ×
                    </span>
                  )}
                </button>
              ))}
            </div>
            <div className="preset-light-time">
              {(["Red", "Green", "Blue"] as const).map((channel, at) => (
                <label key={channel}>
                  {channel} level
                  <input
                    type="number"
                    min={0}
                    max={MAX_DEVICE_LEVEL}
                    step={4}
                    value={levels[at]}
                    onChange={(event) =>
                      setLevels(
                        snapDeviceLevels(
                          levels.map((level, index) =>
                            index === at ? Number(event.target.value) : level,
                          ),
                        ),
                      )
                    }
                  />
                </label>
              ))}
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => sendColor(levelsToken(levels))}
              >
                <i style={{ background: levelsHex(levels) }} />
                Send custom color
              </button>
              <label>
                Name
                <input
                  type="text"
                  maxLength={24}
                  placeholder="My color"
                  value={colorName}
                  onChange={(event) => setColorName(event.target.value)}
                />
              </label>
              <button
                className="button secondary"
                disabled={
                  !colorName.trim() || savedColors.length >= MAX_SAVED_COLORS
                }
                onClick={() => {
                  if (
                    savedColorsStore.set([
                      ...savedColors,
                      { name: colorName.trim(), levels },
                    ])
                  )
                    setColorName("");
                }}
              >
                Save color
              </button>
              <span>
                Levels go from 0 to {MAX_DEVICE_LEVEL} in steps of 4; higher
                levels flashed weakly on this wristband, and pinks with red
                above 180 would not stay lit, so lower the levels if a color
                misbehaves. Extra colors use
                published values and may look different on the LEDs, so tune
                the levels by eye. Saved colors also appear in Song shows.
              </span>
            </div>
          </div>
        )}
        {!v2 && status.timedLightSupported && (
          <div className="preset-light-time">
            <label>
              Light
              <select
                value={light}
                onChange={(event) =>
                  setLight(event.target.value as typeof light)
                }
              >
                <option value="flash">Quick flash</option>
                <option value="timed">Stay lit (can fade in / out)</option>
                {status.strobeSupported && (
                  <option value="strobe">Strobe (fast flashing)</option>
                )}
                {status.strobeSupported && (
                  <option value="build">Build-up (flashing speeds up)</option>
                )}
                {status.rainbowSupported && (
                  <option value="rainbow">Rainbow (changing colors)</option>
                )}
              </select>
            </label>
            {timed && (
              <label>
                Seconds
                <input
                  type="number"
                  min={0.1}
                  max={600}
                  step={0.1}
                  value={lightSeconds}
                  onChange={(event) =>
                    setLightSeconds(Number(event.target.value) || 0)
                  }
                />
              </label>
            )}
            {customOn &&
              light === "timed" &&
              (
                [
                  ["Fade in", fadeInMs, setFadeInMs],
                  ["Fade out", fadeOutMs, setFadeOutMs],
                ] as const
              ).map(([label, value, change]) => (
                <label key={label}>
                  {label}
                  <select
                    value={value ?? ""}
                    onChange={(event) =>
                      change(
                        event.target.value
                          ? Number(event.target.value)
                          : undefined,
                      )
                    }
                  >
                    <option value="">None</option>
                    {FADE_TIMES_MS.map((ms) => (
                      <option key={ms} value={ms}>
                        {ms / 1000} s
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            {rainbowOn && (
              <label>
                One color turn, seconds
                <input
                  type="number"
                  min={1}
                  max={20}
                  step={0.5}
                  value={cycleSeconds}
                  onChange={(event) =>
                    setCycleSeconds(Number(event.target.value) || 0)
                  }
                />
              </label>
            )}
            {rainbowOn && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={sendRainbow}
              >
                Start rainbow
              </button>
            )}
            {rainbowOn && (
              <span>
                The wristband turns through red, yellow, green, cyan, blue and
                magenta for {Math.max(500, lightMs) / 1000} s. Stop sequence
                ends it early.
              </span>
            )}
            {timed && !rainbowOn && (
              <span>
                {strobing
                  ? `Colors ${light === "build" ? "strobe faster and faster" : "strobe"} for ${lightMs / 1000} s. Stop sequence ends it early.`
                  : `Colors stay lit for ${lightMs / 1000} s. Stop sequence ends a light early.`}{" "}
                Magenta is available here.
              </span>
            )}
          </div>
        )}
        {beatOn && (
          <div className="preset-beat-look">
            <span>
              Browser song sync, Auto colors and ESP32 mic sync show each beat
              in the Light chosen above (
              {beatStyle.kind === "flash"
                ? "quick flash"
                : beatStyle.kind === "strobe"
                  ? `strobe burst of ${beatStyle.ms! / 1000} s`
                  : `light of ${beatStyle.ms! / 1000} s${beatStyle.fadeIn || beatStyle.fadeOut ? " with fades" : ""}`}
              ) and step through these colors:
            </span>
            <div className="preset-beat-colors">
              {(["R", "G", "B", "Y", "C", "M", "W", "K"] as const).map(
                (color) => {
                  const on = beatColors.includes(color);
                  return (
                    <button
                      key={color}
                      type="button"
                      className={on ? "selected" : ""}
                      style={{ background: presetLook(color, status).hex }}
                      title={presetLook(color, status).name}
                      aria-label={`${on ? "Remove" : "Add"} ${presetLook(color, status).name} for beats`}
                      aria-pressed={on}
                      onClick={() =>
                        setBeatColors((current) =>
                          current.includes(color)
                            ? current.length > 1
                              ? current.replace(color, "")
                              : current
                            : current + color,
                        )
                      }
                    />
                  );
                },
              )}
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void applyBeatLook()}
              >
                Apply to the running mode
              </button>
            </div>
            <label className="preset-follow-video">
              <input
                type="checkbox"
                checked={followVideo}
                onChange={(event) => {
                  setFollowVideo(event.target.checked);
                  setFollowScreenColors(event.target.checked);
                }}
              />
              Browser song sync follows the colors of the shared video
            </label>
            {followVideo && (
              <span>
                Each beat takes the main color of the shared tab's picture, so
                share the tab that plays the video. The wristband shows one
                color and only tells some colors apart, so expect a rough
                match. Dark frames use the colors chosen above and colorless
                bright frames show white.
              </span>
            )}
            <span>
              Starting a mode applies it too.
              {status.idleRainbow !== undefined &&
                " Auto colors waits for each light to finish before the next color, and Breathing colors is Auto with a 5 s light and 0.96 s fades."}{" "}
              For a beat, short times work
              best: try Stay lit 0.3 s with a 0.5 s fade out, or Strobe 0.3 s.
              Rainbow is not a beat look and is sent as a quick flash.
            </span>
          </div>
        )}
        <div className="preset-mode-controls">
          {status.browserBeatSupported && (
            <button
              className={`button ${status.deviceMode === "host" ? "accent" : "secondary"}`}
              aria-pressed={status.deviceMode === "host"}
              disabled={busy}
              onClick={
                status.deviceMode === "host"
                  ? () => send("stop")
                  : () => void startMode(onBrowserSync)
              }
            >
              <Music2 size={15} />
              Browser song sync
            </button>
          )}
          <button
            className={`button ${status.deviceMode === "auto" ? "accent" : "secondary"}`}
            aria-pressed={status.deviceMode === "auto"}
            disabled={busy}
            onClick={() => void startMode(() => onCommand("auto"))}
          >
            <Activity size={15} />
            Auto colors
          </button>
          {beatOn && customOn && status.idleRainbow !== undefined && (
            <button
              className="button secondary"
              disabled={busy}
              title="Each chosen color fades in 0.96 s, stays 5 s and fades out 0.96 s"
              onClick={() => void startBreathing()}
            >
              <Activity size={15} />
              Breathing colors
            </button>
          )}
          <button
            className={`button ${musicActive && status.deviceMode !== "level" ? "accent" : "secondary"}`}
            aria-pressed={musicActive && status.deviceMode !== "level"}
            disabled={busy}
            onClick={() => void startMode(() => onCommand("music"))}
          >
            <Music2 size={15} />
            {v2 ? "Mic beat sync" : "ESP32 mic sync"}
          </button>
          {v2 && (
            <button
              className={`button ${status.deviceMode === "level" ? "accent" : "secondary"}`}
              aria-pressed={status.deviceMode === "level"}
              disabled={busy}
              onClick={() => send("music", { mode: "level" })}
            >
              <Activity size={15} />
              Volume sync
            </button>
          )}
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => send("stop")}
          >
            <Square size={14} />
            Stop sequence
          </button>
        </div>
        {!v2 && status.idleRainbow !== undefined && (
          <div className="preset-light-time">
            <label>
              Rainbow when nothing controls the board
              <select
                value={status.idleRainbow}
                disabled={busy}
                onChange={(event) =>
                  send("idleRainbow", { seconds: Number(event.target.value) })
                }
              >
                <option value={0}>Off</option>
                <option value={1}>Only at power-on</option>
                {status.idleReturnSupported &&
                  idleRainbowChoices(status.idleRainbow).map((seconds) => (
                    <option key={seconds} value={seconds}>
                      At power-on and after {seconds} s idle
                    </option>
                  ))}
              </select>
            </label>
            <span>
              Any command ends the rainbow. The board remembers this choice.
              {status.idleReturnSupported &&
                " Idle means stopped: it does not come back during Auto, mic sync, Browser song sync or a playing song show."}
            </span>
          </div>
        )}
        {!v2 && status.rf && (
          <div className="preset-light-time">
            {status.rf.state === "on" ||
            status.rf.state === "off" ||
            status.rf.state === "only" ? (
              <>
                <label>
                  Lights go out by
                  <select
                    value={RF_STATE_OUTPUT[status.rf.state]}
                    disabled={busy}
                    onChange={(event) =>
                      send("rf", { output: event.target.value })
                    }
                  >
                    <option value="both">IR and RF</option>
                    <option value="ir">IR only</option>
                    {(status.lightOutputSupported ||
                      status.rf.state === "only") && (
                      <option value="rf">RF only</option>
                    )}
                  </select>
                </label>
                <span>
                  {rfSummary(status.rf)} The board remembers this choice
                  {status.lightOutputSupported &&
                    "; a song show cue can choose its own"}
                  .
                </span>
                {status.rf.state !== "off" && (
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => send("rfWake")}
                  >
                    <Radio size={14} />
                    Wake wristbands (35 s)
                  </button>
                )}
                {status.rfSleepSettingSupported &&
                  status.rf.sleepAfterS !== undefined && (
                    <label>
                      Wristbands sleep
                      <select
                        value={status.rf.sleepAfterS}
                        disabled={busy}
                        onChange={(event) =>
                          send("rfSleep", {
                            seconds: Number(event.target.value),
                          })
                        }
                      >
                        {rfSleepChoices(status.rf.sleepAfterS).map(
                          (seconds) => (
                            <option key={seconds} value={seconds}>
                              {seconds === 0
                                ? "Never while the board is on"
                                : `${sleepLabel(seconds)} after the last light`}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                  )}
              </>
            ) : (
              <span>{RF_FAULTS[status.rf.state]} IR still works.</span>
            )}
          </div>
        )}
        <div className="preset-sensitivity">
          <span>
            Microphone sensitivity
            {status.deviceMode === "host" ? " · standalone only" : ""}{" "}
            <strong>
              {status.musicSensitivity === undefined
                ? "—"
                : v2
                  ? `${status.musicSensitivity}%`
                  : status.musicSensitivity.toFixed(2)}
            </strong>
          </span>
          <div>
            <button
              className="button secondary"
              disabled={busy || status.deviceMode === "host"}
              onClick={() => send("sensitivity", { direction: "less" })}
            >
              Less sensitive
            </button>
            <button
              className="button secondary"
              disabled={busy || status.deviceMode === "host"}
              onClick={() => send("sensitivity", { direction: "more" })}
            >
              More sensitive
            </button>
          </div>
        </div>
        <p className="compat-note">
          Stop ends Auto / Music; the last color may stay on.{" "}
          {v2
            ? "Beat and Volume sync use your ESP32 microphone."
            : customOn
              ? "Magenta flashes use the line command; the single letter M is Music."
              : "Magenta is available in Auto; this sketch uses M for Music."}{" "}
          Mic wiring: 26 / 25 / 27 · IR: 32.
          {status.whitePreset === "whitish" &&
            " This firmware's White is the sketch's original WHITISH frame (decodes to R204/G176/B92, warm)."}
          {status.whitePreset === "neutral-candidate" &&
            " White sends equal red, green and blue, seen whiter than the warm preset on the wristband; Warm white keeps the earlier WHITISH hue."}
          {status.deviceMode === "host" &&
            " Browser song sync uses the shared music track; adjust its sensitivity in Audio analysis. The ESP32 microphone cannot trigger this mode."}
        </p>
      </div>
    </section>
  );
}
