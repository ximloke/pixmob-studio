import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import {
  extraDeviceColors,
  magentaDeviceColor,
  FADE_TIMES_MS,
  levelsHex,
  MAX_DEVICE_LEVEL,
  savedColorsStore,
  snapDeviceLevels,
} from "./lib/deviceColors";
import type { DeviceLevels } from "./lib/deviceColors";
import {
  Plus,
  Play,
  Pause,
  RotateCcw,
  Save,
  Trash2,
  Music2,
  ArrowLeft,
  Upload,
  AudioLines,
  WandSparkles,
  X,
  Ellipsis,
  ChevronDown,
  Keyboard,
} from "lucide-react";
import { effects, initialLighting } from "./lib/effects";
import type { Lighting } from "./lib/effects";
import {
  clampHardwareLead,
  createSongShow,
  DEFAULT_HARDWARE_LEAD_MS,
  MAX_HARDWARE_LEAD_MS,
  MAX_HOLD_MS,
  MAX_SONG_CUES,
  MIN_HOLD_MS,
  MIN_STROBE_MS,
  MAX_STROBE_MS,
  type SongStrobe,
  type SongCueExtras,
  createSongCueRelay,
  exportSongShow,
  importSongShow,
  songShowFileName,
  MIN_RAINBOW_MS,
  MIN_RAINBOW_CYCLE_MS,
  MAX_RAINBOW_CYCLE_MS,
  DEFAULT_RAINBOW_CYCLE_MS,
  MAX_SONG_TIME,
  newSongId,
  SONG_LEAD_STORAGE_KEY,
  readSongShows,
  saveSongShows,
  SongCueOutput,
  SongCueTimeline,
  songCueAt,
  songHardwareColors,
  sortedSongCues,
  sampleSongCue,
} from "./lib/songShow";
import type { SongCue, SongHardwareColor, SongShow } from "./lib/songShow";
import {
  applyShowLightTiming,
  applyShowPulsePattern,
  createRgbDeviceCopy,
  devicePresets,
  generateBeatShow,
  nearestDevicePreset,
} from "./lib/autoSongCues";
import {
  analyseSongRhythm,
  MAX_ANALYSIS_FILE_BYTES,
  MAX_ANALYSIS_SECONDS,
} from "./lib/songRhythm";
import type { RhythmAnalysis } from "./lib/songRhythm";
import { SongPlaybackClock, type SongClockMode } from "./lib/songClock";
import {
  cuePadModes,
  defaultCuePads,
  readCuePads,
  saveCuePads,
  type CuePad,
  type CuePadMode,
} from "./lib/cuePads";
import "./songShows.css";

export type SongShowsProps = {
  connected: boolean;
  /** Which waveform the connected firmware transmits for White cues. */
  whitePreset?: "whitish" | "neutral-candidate";
  /** True when the connected firmware can keep a cue lit for a set time. */
  timedLightSupported?: boolean;
  /** True when the connected firmware can strobe a cue. */
  strobeSupported?: boolean;
  /** True when the connected firmware accepts custom colors and fades. */
  customLightSupported?: boolean;
  /** True when the connected firmware has the rainbow command. */
  rainbowSupported?: boolean;
  /** True when a cue can go out by IR only or RF only (LIGHT OUTPUT). */
  lightOutputSupported?: boolean;
  renderPreview: (frame: {
    color: string;
    intensity: number;
    profile: string;
  }) => ReactNode;
  prepareHardware: () => Promise<void>;
  sendHardwareCue: (
    color: SongHardwareColor,
    holdMs?: number,
    strobe?: SongStrobe,
    extras?: SongCueExtras,
  ) => Promise<boolean>;
  stopHardware: () => Promise<void>;
  onFreeRhythm: () => void;
};
const deviceColorNames: Record<SongHardwareColor, string> = {
  R: "Red",
  G: "Green",
  B: "Blue",
  Y: "Yellow",
  C: "Cyan",
  W: "White",
};
const lightMs = (value: number) =>
  Math.max(
    MIN_HOLD_MS,
    Math.min(
      MAX_HOLD_MS,
      Math.round((Number.isFinite(value) ? value : 1) * 1000),
    ),
  );
/** What a cue adds to its preset color when sent: custom levels and fades. */
const cueExtras = (cue: SongCue): SongCueExtras => ({
  levels: cue.levels,
  fadeInMs: cue.fadeInMs,
  fadeOutMs: cue.fadeOutMs,
  rainbowMs: cue.rainbowMs,
  ...(cue.output !== undefined ? { output: cue.output } : {}),
});
/** Cue fields for a custom device color; the preset letter is the fallback. */
const customColor = (levels: DeviceLevels) => {
  const color = levelsHex(levels);
  return {
    levels,
    color,
    hardwareColor: nearestDevicePreset(color).hardwareColor,
  };
};
const sameLevels = (a: DeviceLevels | undefined, b: DeviceLevels) =>
  !!a && a.every((level, index) => level === b[index]);
type LightChoice = CuePadMode;
type CueLightSettings = {
  choice: LightChoice;
  seconds: number;
  cycleMs: number;
  fadeInMs?: number;
  fadeOutMs?: number;
};
/** Cue fields for one light choice; strobes are kept inside their bounds. */
const cueLight = (
  choice: LightChoice,
  value: number,
  cycleMs = DEFAULT_RAINBOW_CYCLE_MS,
): Partial<SongCue> =>
  choice === "flash"
    ? {
        holdMs: undefined,
        strobe: undefined,
        fadeInMs: undefined,
        fadeOutMs: undefined,
        rainbowMs: undefined,
      }
    : choice === "rainbow"
      ? {
          holdMs: Math.max(MIN_RAINBOW_MS, lightMs(value)),
          strobe: undefined,
          fadeInMs: undefined,
          fadeOutMs: undefined,
          rainbowMs: cycleMs,
        }
      : choice === "timed"
        ? { holdMs: lightMs(value), strobe: undefined, rainbowMs: undefined }
        : {
            rainbowMs: undefined,
            holdMs: Math.max(
              MIN_STROBE_MS,
              Math.min(MAX_STROBE_MS, lightMs(value)),
            ),
            strobe: choice === "build" ? "build" : "steady",
            fadeInMs: undefined,
            fadeOutMs: undefined,
          };
const lightChoice = (cue: {
  holdMs?: number;
  strobe?: SongStrobe;
  rainbowMs?: number;
}): LightChoice =>
  cue.holdMs === undefined
    ? "flash"
    : cue.rainbowMs !== undefined
      ? "rainbow"
      : cue.strobe === "build"
        ? "build"
        : cue.strobe === "steady"
          ? "strobe"
          : "timed";
/** One color of the brush: a preset letter, or custom levels with a name. */
type BrushColor = {
  key: string;
  name: string;
  color: string;
  hardwareColor: SongHardwareColor;
  levels?: DeviceLevels;
};
const presetBrush = (preset: {
  color: string;
  hardwareColor: SongHardwareColor;
}): BrushColor => ({
  key: preset.hardwareColor,
  name: deviceColorNames[preset.hardwareColor],
  color: preset.color,
  hardwareColor: preset.hardwareColor,
});
const levelsBrush = (extra: {
  name: string;
  levels: DeviceLevels;
}): BrushColor => ({
  key: extra.levels.join("/"),
  name: extra.name,
  ...customColor(extra.levels),
});
const LIGHT_NAMES: Record<LightChoice, string> = {
  flash: "Quick flash",
  timed: "Stay lit (can fade in / out)",
  strobe: "Strobe (fast flashing)",
  build: "Build-up (flashing speeds up)",
  rainbow: "Rainbow (changing colors)",
};
const SHORT_LIGHT_NAMES: Record<LightChoice, string> = {
  flash: "Quick flash",
  timed: "Stay lit",
  strobe: "Strobe",
  build: "Build-up",
  rainbow: "Rainbow",
};
const fadeLabel = (ms: number) => `${ms / 1000} s`;
const seconds = (value: number) =>
  `${Math.floor(value / 60)}:${(value % 60).toFixed(1).padStart(4, "0")}`;
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export default function SongShows(props: SongShowsProps) {
  const callbacks = useRef(props);
  callbacks.current = props;
  const [saved, setSaved] = useState(() => {
    try {
      return readSongShows(localStorage);
    } catch {
      return {
        shows: [] as SongShow[],
        error:
          "Browser storage is unavailable; shows can only be edited this session.",
      };
    }
  });
  const [show, setShow] = useState<SongShow>(
    () => saved.shows[0] ?? createSongShow(),
  );
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState(saved.error ?? "");
  const [source, setSource] = useState<"local" | "external">("local");
  const [audioUrl, setAudioUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [metadataStatus, setMetadataStatus] = useState<
    "empty" | "loading" | "ready" | "error"
  >("empty");
  const [rhythm, setRhythm] = useState<RhythmAnalysis | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [draftPattern, setDraftPattern] = useState<"single" | "rgb">("single");
  const [draftEvery, setDraftEvery] = useState<1 | 2 | 4>(1);
  const [draftColor, setDraftColor] = useState("#ff323e");
  const savedColors = useSyncExternalStore(
    savedColorsStore.subscribe,
    savedColorsStore.get,
  );
  const moreColors = [magentaDeviceColor, ...extraDeviceColors, ...savedColors];
  const palette: BrushColor[] = [
    ...devicePresets.map(presetBrush),
    ...moreColors.map(levelsBrush),
  ].filter(
    (option, index, all) =>
      all.findIndex((other) => other.key === option.key) === index,
  );
  // The brush: color(s) and light for new taps and for ticked cues.
  const [brush, setBrush] = useState<BrushColor[]>(() => [
    presetBrush(devicePresets[0]),
  ]);
  const [brushMix, setBrushMix] = useState(false);
  const [brushFadeIn, setBrushFadeIn] = useState<number | undefined>();
  const [brushFadeOut, setBrushFadeOut] = useState<number | undefined>();
  const [brushCycleMs, setBrushCycleMs] = useState(DEFAULT_RAINBOW_CYCLE_MS);
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const lastPicked = useRef<string | null>(null);
  const [openCue, setOpenCue] = useState<{
    id: string;
    panel: "color" | "more";
  } | null>(null);
  const [follow, setFollow] = useState(false);
  // Narrow screens only: the brush folds away to keep the player small.
  const [brushShown, setBrushShown] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(
    () => !(saved.shows[0]?.cues.length ?? 0),
  );
  const [draftProfile, setDraftProfile] =
    useState<Lighting["profile"]>("Taylor Swift");
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [starting, setStarting] = useState(false);
  const [hardware, setHardware] = useState(false);
  const [lightTiming, setLightTiming] = useState<LightChoice>("flash");
  const [lightSeconds, setLightSeconds] = useState(1);
  const [tapCount, setTapCount] = useState(0);
  const [performanceMode, setPerformanceMode] = useState(false);
  const performanceModeRef = useRef(false);
  const [recordPerformance, setRecordPerformance] = useState(true);
  const [performanceCue, setPerformanceCue] = useState<SongCue | null>(null);
  const [cuePads, setCuePads] = useState<CuePad[]>(() => {
    try {
      return readCuePads(localStorage);
    } catch {
      return defaultCuePads.map((pad) => ({ ...pad }));
    }
  });
  const [editPads, setEditPads] = useState(false);
  const editPadsRef = useRef(false);
  const [selectedPad, setSelectedPad] = useState(0);
  const [lastPad, setLastPad] = useState<number | null>(null);
  performanceModeRef.current = performanceMode;
  editPadsRef.current = editPads;
  const [hardwareLeadMs, setHardwareLeadMs] = useState(() => {
    try {
      const stored = localStorage.getItem(SONG_LEAD_STORAGE_KEY);
      return stored === null
        ? DEFAULT_HARDWARE_LEAD_MS
        : clampHardwareLead(stored);
    } catch {
      return DEFAULT_HARDWARE_LEAD_MS;
    }
  });
  const hardwareLead = useRef(hardwareLeadMs);
  hardwareLead.current = hardwareLeadMs;
  const [clockMode, setClockMode] = useState<SongClockMode | null>(null);
  const [confirmedCues, setConfirmedCues] = useState(0);
  const [unsentCues, setUnsentCues] = useState(0);
  const [lastSentColor, setLastSentColor] = useState<SongHardwareColor | null>(
    null,
  );
  const playbackClock = useRef(new SongPlaybackClock());
  const audio = useRef<HTMLAudioElement>(null);
  const url = useRef("");
  const mounted = useRef(true);
  const playingRef = useRef(false);
  const startingRef = useRef(false);
  const hardwareOwner = useRef(false);
  const ignoredPause = useRef(false);
  const ignoredSeek = useRef<number | null>(null);
  const generation = useRef(0);
  const analysisAbort = useRef<AbortController | null>(null);
  const analysisGeneration = useRef(0);
  const currentPosition = useRef(0);
  const base = useRef({ position: 0, at: 0 });
  const zeroArmed = useRef(true);
  const timeline = useRef(new SongCueTimeline());
  const currentShow = useRef(show);
  currentShow.current = show;
  const output = useRef<SongCueOutput | null>(null);
  if (!output.current)
    output.current = createSongCueRelay(
      (...cue) => callbacks.current.sendHardwareCue(...cue),
      () => callbacks.current.stopHardware(),
      (error) => {
        if (mounted.current) setMessage(error.message);
      },
    );

  useEffect(() => {
    try {
      saveCuePads(cuePads, localStorage);
    } catch {
      /* The pad bank still works for this session. */
    }
  }, [cuePads]);

  function stopPlayback(forceStop = false) {
    const wasPlaying = playingRef.current;
    const mustStop =
      hardwareOwner.current || output.current!.active || forceStop;
    const token = ++generation.current;
    hardwareOwner.current = false;
    playingRef.current = startingRef.current = false;
    setPlaying(false);
    setStarting(false);
    setPerformanceCue(null);
    setLastPad(null);
    output.current!.disable();
    playbackClock.current.stop();
    setClockMode(null);
    if (audio.current && !audio.current.paused) {
      ignoredPause.current = true;
      audio.current.pause();
    }
    if (wasPlaying) {
      const time =
        source === "local" && audio.current
          ? audio.current.currentTime
          : base.current.position +
            (performance.now() - base.current.at) / 1000;
      currentPosition.current = Math.max(0, Math.min(MAX_SONG_TIME, time));
      setPosition(currentPosition.current);
    }
    timeline.current.seek(currentPosition.current);
    if (mustStop)
      void output.current!.stop().catch((error) => {
        if (mounted.current && token === generation.current)
          setMessage(errorText(error));
      });
  }

  function seek(value: number, reset = false) {
    if (reset) cancelAnalysis();
    // Jumping while the show plays keeps it playing; only a reset pauses.
    const keepPlaying = !reset && playingRef.current;
    if (!keepPlaying) stopPlayback();
    const time = Math.max(
      0,
      Math.min(MAX_SONG_TIME, Number.isFinite(value) ? value : 0),
    );
    currentPosition.current = time;
    setPerformanceCue(null);
    setLastPad(null);
    timeline.current.seek(time);
    if (keepPlaying) base.current = { position: time, at: performance.now() };
    zeroArmed.current = reset && time === 0;
    setPosition(time);
    if (
      source === "local" &&
      audio.current &&
      Math.abs(audio.current.currentTime - time) > 0.02
    ) {
      ignoredSeek.current = time;
      audio.current.currentTime = time;
    }
  }

  async function play() {
    if (playingRef.current || startingRef.current) return;
    if (analysisAbort.current) cancelAnalysis();
    if (source === "local" && !audioUrl) {
      setMessage(
        "Choose a local MP3/WAV file, or select the external-player clock.",
      );
      return;
    }
    if (editPadsRef.current) {
      editPadsRef.current = false;
      setEditPads(false);
    }
    const token = ++generation.current;
    startingRef.current = true;
    setStarting(true);
    setMessage("");
    // Native audio controls can request Play too. Hold playback until the
    // device has left free-rhythm mode and acknowledged the preparation.
    if (source === "local" && audio.current && !audio.current.paused) {
      ignoredPause.current = true;
      audio.current.pause();
    }
    try {
      if (hardware) {
        if (!props.connected)
          throw new Error(
            "Connect the preset controller before enabling hardware cues.",
          );
        hardwareOwner.current = true;
        setConfirmedCues(0);
        setUnsentCues(0);
        setLastSentColor(null);
        const mode = await playbackClock.current.start(() => {
          if (
            !playingRef.current ||
            !hardwareOwner.current ||
            performanceModeRef.current ||
            token !== generation.current
          )
            return;
          const time =
            source === "local" && audio.current
              ? audio.current.currentTime
              : base.current.position +
                (performance.now() - base.current.at) / 1000;
          // Device cues cross early by the lead; the preview uses real time.
          const cue = timeline.current.advance(
            currentShow.current,
            time + hardwareLead.current / 1000,
          );
          if (!cue?.hardwareColor) return;
          const color = cue.hardwareColor;
          void output
            .current!.send(color, cue.holdMs, cue.strobe, cueExtras(cue))
            .then((sent) => {
              if (!mounted.current || token !== generation.current) return;
              if (sent) {
                setConfirmedCues((count) => count + 1);
                setLastSentColor(color);
              } else setUnsentCues((count) => count + 1);
            });
        });
        if (!mounted.current || token !== generation.current) return;
        setClockMode(mode);
        await callbacks.current.prepareHardware();
      }
      if (!mounted.current || token !== generation.current) {
        return;
      }
      if (hardware) output.current!.enable();
      timeline.current.start(currentPosition.current, zeroArmed.current);
      zeroArmed.current = false;
      base.current = {
        position: currentPosition.current,
        at: performance.now(),
      };
      if (source === "local" && audio.current) await audio.current.play();
      if (token !== generation.current || !mounted.current) {
        return;
      }
      playingRef.current = true;
      setPlaying(true);
    } catch (error) {
      if (token === generation.current && mounted.current) {
        stopPlayback();
        setMessage(errorText(error));
      }
    } finally {
      if (token === generation.current && mounted.current) {
        startingRef.current = false;
        setStarting(false);
      }
    }
  }

  useEffect(() => {
    mounted.current = true;
    let request = 0,
      lastView = -Infinity;
    const tick = (now: number) => {
      if (playingRef.current) {
        const time =
          source === "local" && audio.current
            ? audio.current.currentTime
            : base.current.position + (now - base.current.at) / 1000;
        const bounded = Math.max(0, Math.min(MAX_SONG_TIME, time));
        currentPosition.current = bounded;
        // Rendering may pause in a background tab. Device cue crossings are
        // driven separately by the audio clock and the real media position.
        if (now - lastView >= 33) {
          setPosition(bounded);
          lastView = now;
        }
        if (bounded >= MAX_SONG_TIME) stopPlayback();
      }
      request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [source]);

  useEffect(
    () => () => {
      mounted.current = false;
      ++generation.current;
      ++analysisGeneration.current;
      analysisAbort.current?.abort();
      analysisAbort.current = null;
      playingRef.current = startingRef.current = false;
      playbackClock.current.stop();
      audio.current?.pause();
      const ownsHardware = hardwareOwner.current || output.current!.active;
      hardwareOwner.current = false;
      output.current!.disable();
      if (ownsHardware) void output.current!.stop().catch(() => {});
      if (url.current) URL.revokeObjectURL(url.current);
    },
    [],
  );
  useEffect(() => {
    if (!props.connected && hardware) {
      stopPlayback();
      setHardware(false);
    }
  }, [props.connected]);

  // The Show file menu closes on a click anywhere else.
  const fileMenu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      const menu = fileMenu.current;
      if (
        menu?.open &&
        !(event.target instanceof Node && menu.contains(event.target))
      )
        menu.open = false;
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  // Ticks and open panels belong to one show.
  useEffect(() => {
    setSelected(new Set());
    setOpenCue(null);
    lastPicked.current = null;
  }, [show.id]);
  const keys = useRef({
    tap: () => {},
    toggle: () => {},
    pad: (_index: number) => {},
  });
  keys.current = {
    tap: () => {
      if (!performanceModeRef.current) tapCue();
    },
    toggle: () =>
      playingRef.current || startingRef.current ? stopPlayback() : void play(),
    pad: hitPerformancePad,
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        document.querySelector('[aria-modal="true"]')
      )
        return;
      const target = event.target instanceof Element ? event.target : null;
      if (
        target?.closest(
          "input, select, textarea, audio, [contenteditable]:not([contenteditable='false']), [role='textbox']",
        )
      )
        return;
      const key = event.key.toUpperCase();
      let action: (() => void) | undefined;
      if (key === "T" && !performanceModeRef.current) action = keys.current.tap;
      else if (key === " " && !target?.closest("button, summary, a"))
        action = keys.current.toggle;
      else if (performanceModeRef.current && !editPadsRef.current) {
        const match = /^(?:Digit|Numpad)([1-8])$/.exec(event.code);
        if (match) action = () => keys.current.pad(Number(match[1]) - 1);
      }
      if (action) {
        event.preventDefault();
        if (!event.repeat) action();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Editing never pauses the show: the running timeline reads the newest cues.
  function edit(update: (current: SongShow) => SongShow) {
    setShow(update);
    setDirty(true);
  }
  function songTimeNow() {
    if (!playingRef.current) return currentPosition.current;
    return source === "local" && audio.current
      ? audio.current.currentTime
      : base.current.position + (performance.now() - base.current.at) / 1000;
  }
  function togglePerformanceMode() {
    const enabled = !performanceModeRef.current;
    performanceModeRef.current = enabled;
    setPerformanceMode(enabled);
    setPerformanceCue(null);
    setLastPad(null);
    if (!enabled) {
      editPadsRef.current = false;
      setEditPads(false);
    }
    if (!enabled && playingRef.current)
      timeline.current.seek(songTimeNow() + hardwareLead.current / 1000);
  }
  function hitPerformancePad(index: number) {
    if (
      !performanceModeRef.current ||
      !playingRef.current ||
      editPadsRef.current
    )
      return;
    const pad = cuePads[index];
    if (!pad) return;
    const option = palette.find((item) => item.key === pad.color);
    if (!option) return;
    setLastPad(index);
    tapCue(option, recordPerformance, true, {
      choice: pad.mode,
      seconds: pad.seconds,
      cycleMs: DEFAULT_RAINBOW_CYCLE_MS,
    });
  }
  function updateCuePad(index: number, update: Partial<CuePad>) {
    setCuePads((current) =>
      current.map((pad, at) => (at === index ? { ...pad, ...update } : pad)),
    );
  }
  // Performance hits and ordinary taps share the song clock and device output.
  function tapCue(
    option?: BrushColor,
    record = true,
    performance = false,
    light?: CueLightSettings,
  ) {
    const time = Math.max(
      0,
      Math.min(MAX_SONG_TIME, Number(songTimeNow().toFixed(3))),
    );
    const count = currentShow.current.cues.length;
    const canRecord = record && count < MAX_SONG_CUES;
    if (record && !canRecord) {
      setMessage(`A show holds up to ${MAX_SONG_CUES} cues.`);
      if (!performance) return;
    }
    const selectedColor =
      option ?? brush[(performance ? tapCount : count) % brush.length];
    const choice = light?.choice ?? lightTiming;
    const cue = brushCue(
      time,
      performance
        ? `${selectedColor.name} · ${SHORT_LIGHT_NAMES[choice]}`
        : `Tap ${count + 1}`,
      selectedColor,
      light,
    );
    if (canRecord)
      edit((current) =>
        current.cues.length >= MAX_SONG_CUES
          ? current
          : { ...current, cues: [...current.cues, cue] },
      );
    if (performance) setPerformanceCue(cue);
    setTapCount((value) => value + 1);
    // With device output running, the tap itself lights the wristband and
    // the timeline is told not to send the same cue again.
    if (playingRef.current && hardwareOwner.current && output.current!.active) {
      const token = generation.current;
      const color = selectedColor.hardwareColor;
      if (!performance)
        timeline.current.skipTo(time + hardwareLead.current / 1000);
      void output
        .current!.send(color, cue.holdMs, cue.strobe, cueExtras(cue))
        .then((sent) => {
          if (!mounted.current || token !== generation.current) return;
          if (sent) {
            setConfirmedCues((value) => value + 1);
            setLastSentColor(color);
          } else setUnsentCues((value) => value + 1);
        });
    }
  }
  /** Light fields of the brush, with its fades for a steady light. */
  function brushLight(settings?: CueLightSettings): Partial<SongCue> {
    const choice = settings?.choice ?? lightTiming;
    const light = cueLight(
      choice,
      settings?.seconds ?? lightSeconds,
      settings?.cycleMs ?? brushCycleMs,
    );
    return choice === "timed"
      ? {
          ...light,
          fadeInMs: settings ? settings.fadeInMs : brushFadeIn,
          fadeOutMs: settings ? settings.fadeOutMs : brushFadeOut,
        }
      : light;
  }
  /** A new cue in the brush color (in turn when mixing) and light. */
  function brushCue(
    time: number,
    label: string,
    option: BrushColor,
    settings?: CueLightSettings,
  ): SongCue {
    const cue: SongCue = {
      id: newSongId(),
      time,
      label,
      lighting: {
        ...initialLighting,
        profile: draftProfile,
        color: option.color,
        effect: "Flash",
        brightness: 100,
        musicSync: false,
      },
      pulseMs: 120,
      hardwareColor: option.hardwareColor,
      ...(option.levels ? { levels: option.levels } : {}),
    };
    if ((settings?.choice ?? lightTiming) === "flash") return cue;
    const light = brushLight(settings);
    for (const [key, value] of Object.entries(light))
      if (value !== undefined) (cue as Record<string, unknown>)[key] = value;
    return cue;
  }
  function pickBrush(option: BrushColor) {
    setBrush((current) => {
      if (!brushMix) return [option];
      const without = current.filter((item) => item.key !== option.key);
      if (without.length < current.length)
        return without.length ? without : current;
      return [...current, option];
    });
  }
  function pickCue(id: string, range: boolean) {
    const order = sortedSongCues(currentShow.current).map((item) => item.id);
    setSelected((current) => {
      const next = new Set(current);
      const from = lastPicked.current ? order.indexOf(lastPicked.current) : -1;
      const to = order.indexOf(id);
      if (range && from >= 0 && to >= 0) {
        const on = !current.has(id);
        for (const item of order.slice(
          Math.min(from, to),
          Math.max(from, to) + 1,
        ))
          if (on) next.add(item);
          else next.delete(item);
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    lastPicked.current = id;
  }
  /** Gives the ticked cues the brush color(s), light, or light until the next cue. */
  function applyBrush(kind: "color" | "light" | "until-next") {
    const picked = sortedSongCues(currentShow.current).filter((item) =>
      selected.has(item.id),
    );
    if (!picked.length) return;
    const order = new Map(picked.map((item, index) => [item.id, index]));
    try {
      let untilNext: Map<string, SongCue> | null = null;
      if (kind === "until-next")
        untilNext = new Map(
          applyShowLightTiming(
            currentShow.current,
            "until-next",
            lightSeconds,
          ).cues.map((item) => [item.id, item]),
        );
      edit((current) => ({
        ...current,
        cues: current.cues.map((item) => {
          const at = order.get(item.id);
          if (at === undefined) return item;
          if (kind === "color") {
            const option = brush[at % brush.length];
            return {
              ...item,
              hardwareColor: option.hardwareColor,
              levels: option.levels,
              lighting: {
                ...item.lighting,
                color: option.color,
                musicSync: false,
              },
            };
          }
          if (kind === "light") return { ...item, ...brushLight() };
          const timed = untilNext?.get(item.id);
          if (!timed) return item;
          return {
            ...item,
            holdMs: timed.holdMs,
            strobe: undefined,
            rainbowMs: undefined,
            ...(lightTiming === "timed"
              ? { fadeInMs: brushFadeIn, fadeOutMs: brushFadeOut }
              : { fadeInMs: timed.fadeInMs, fadeOutMs: timed.fadeOutMs }),
          };
        }),
      }));
      const count = `${picked.length} cue${picked.length === 1 ? "" : "s"}`;
      setMessage(
        kind === "color"
          ? `${count} now use ${brush.map((option) => option.name).join(", ")}${brush.length > 1 ? " in turn" : ""}. Save when ready.`
          : kind === "light"
            ? `${count} now use ${LIGHT_NAMES[lightTiming].toLowerCase()}. Save when ready.`
            : `${count} now stay lit until the next cue. Save when ready.`,
      );
    } catch (error) {
      setMessage(errorText(error));
    }
  }
  function deleteSelected() {
    const count = sortedSongCues(currentShow.current).filter((item) =>
      selected.has(item.id),
    ).length;
    if (!count) return;
    if (
      count > 1 &&
      !window.confirm(
        `Delete the ${count} ticked cues? Saved shows change only when you save.`,
      )
    )
      return;
    edit((current) => ({
      ...current,
      cues: current.cues.filter((item) => !selected.has(item.id)),
    }));
    setSelected(new Set());
    setMessage(
      `Deleted ${count} cue${count === 1 ? "" : "s"}. Save when ready.`,
    );
  }
  function editCue(id: string, change: Partial<SongCue>) {
    edit((current) => ({
      ...current,
      cues: current.cues.map((cue) =>
        cue.id === id ? { ...cue, ...change } : cue,
      ),
    }));
  }
  function setCueLevels(cue: SongCue, levels: readonly number[]) {
    const custom = customColor(snapDeviceLevels(levels));
    editCue(cue.id, {
      hardwareColor: custom.hardwareColor,
      levels: custom.levels,
      lighting: { ...cue.lighting, color: custom.color, musicSync: false },
    });
  }
  function editLighting(cue: SongCue, change: Partial<Lighting>) {
    editCue(cue.id, {
      lighting: { ...cue.lighting, ...change, musicSync: false },
    });
  }
  function save() {
    stopPlayback();
    const shows = [...saved.shows.filter((item) => item.id !== show.id), show];
    try {
      saveSongShows(shows, localStorage);
      setSaved({ shows });
      setDirty(false);
      setMessage("Saved on this browser. Audio files are not stored.");
    } catch (error) {
      setMessage(errorText(error));
    }
  }
  const isSaved = saved.shows.some((item) => item.id === show.id);
  function exportShow() {
    try {
      const url = URL.createObjectURL(
        new Blob([exportSongShow(show)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = songShowFileName(show);
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(
        `Exported "${show.name}" to your downloads. The audio file is not included.`,
      );
    } catch (error) {
      setMessage(errorText(error));
    }
  }
  async function importShow(file: File | undefined) {
    if (!file) return;
    try {
      const imported = importSongShow(await file.text());
      // A show with the same id is already here: keep both.
      const loaded = saved.shows.some((item) => item.id === imported.id)
        ? { ...imported, id: newSongId() }
        : imported;
      const shows = [...saved.shows, loaded];
      saveSongShows(shows, localStorage);
      stopPlayback();
      setSaved({ shows });
      setShow(structuredClone(loaded));
      setDirty(false);
      seek(0, true);
      setMessage(
        `Imported and saved "${loaded.name}". Choose its audio file to play it.`,
      );
    } catch (error) {
      setMessage(errorText(error));
    }
  }
  function deleteShows(remove: (item: SongShow) => boolean, done: string) {
    const shows = saved.shows.filter((item) => !remove(item));
    try {
      saveSongShows(shows, localStorage);
      setSaved({ shows });
      if (!shows.some((item) => item.id === show.id)) {
        stopPlayback();
        setShow(createSongShow());
        setDirty(true);
        seek(0, true);
      }
      setMessage(done);
    } catch (error) {
      setMessage(errorText(error));
    }
  }
  function chooseFile(file: File | undefined) {
    if (!file) return;
    cancelAnalysis(true);
    stopPlayback();
    if (!/\.(mp3|wav)$/i.test(file.name)) {
      setMessage("Choose an MP3 or WAV audio file.");
      return;
    }
    if (file.size > 512 * 1024 * 1024) {
      setMessage("Choose an audio file smaller than 512 MB.");
      return;
    }
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = URL.createObjectURL(file);
    setAudioUrl(url.current);
    setFileName(file.name);
    setSelectedFile(file);
    setMetadataStatus("loading");
    setDuration(0);
    currentPosition.current = 0;
    setPosition(0);
    timeline.current.seek(0);
    zeroArmed.current = true;
    setMessage("");
  }
  function cancelAnalysis(clearResult = false, notice = false) {
    const wasRunning = analysisAbort.current !== null;
    ++analysisGeneration.current;
    analysisAbort.current?.abort();
    analysisAbort.current = null;
    setAnalysing(false);
    if (clearResult) {
      setRhythm(null);
      setAnalysisProgress(0);
    }
    if (wasRunning && notice) setMessage("Rhythm analysis canceled.");
  }
  async function analyzeRhythm() {
    if (!selectedFile) {
      setMessage("Choose a local MP3 or WAV file first.");
      return;
    }
    if (metadataStatus !== "ready" || duration <= 0) {
      setMessage("Wait for valid track information before analyzing rhythm.");
      return;
    }
    if (
      selectedFile.size > MAX_ANALYSIS_FILE_BYTES ||
      duration > MAX_ANALYSIS_SECONDS
    ) {
      setMessage(
        "Rhythm analysis supports files up to 100 MB and 10 minutes. Local playback remains available.",
      );
      return;
    }
    stopPlayback();
    cancelAnalysis(true);
    const token = ++analysisGeneration.current;
    const controller = new AbortController();
    analysisAbort.current = controller;
    setAnalysing(true);
    setAnalysisProgress(0);
    setMessage("");
    try {
      const result = await analyseSongRhythm(selectedFile, {
        signal: controller.signal,
        onProgress: (value) => {
          if (
            mounted.current &&
            token === analysisGeneration.current &&
            !controller.signal.aborted &&
            Number.isFinite(value)
          )
            setAnalysisProgress(Math.max(0, Math.min(1, value)));
        },
      });
      if (
        !mounted.current ||
        token !== analysisGeneration.current ||
        controller.signal.aborted
      )
        return;
      setRhythm(result);
      setAnalysisProgress(1);
      if (!result.beats.length)
        setMessage(
          "No clear beat attacks were found. You can still compose cues manually.",
        );
    } catch (error) {
      if (mounted.current && token === analysisGeneration.current)
        setMessage(errorText(error));
    } finally {
      if (mounted.current && token === analysisGeneration.current) {
        analysisAbort.current = null;
        setAnalysing(false);
      }
    }
  }
  function generateDraft() {
    if (!rhythm || !rhythm.beats.length) return;
    if (dirty) {
      setMessage(
        "Save your current show changes before creating a new beat draft.",
      );
      return;
    }
    stopPlayback();
    try {
      const name = `${fileName.replace(/\.(mp3|wav)$/i, "").slice(0, 55)}${rhythm.bpm ? ` · ~${Math.round(rhythm.bpm)} BPM` : " · beat draft"}`;
      const generated = generateBeatShow(rhythm, {
        name,
        profile: draftProfile,
        pattern: draftPattern,
        every: draftEvery,
        color: draftColor,
      });
      setHardware(false);
      setShow(generated.show);
      setDirty(true);
      seek(0, true);
      setMessage(
        `Created a new editable draft with ${generated.usedBeats} cues. ${generated.stride > 1 ? `Uses one cue per ${generated.stride} detected beats to cover the song within ${MAX_SONG_CUES} cues. ` : ""}Your saved shows are unchanged. Hardware output is off; save this draft when ready.`,
      );
    } catch (error) {
      setMessage(errorText(error));
    }
  }
  const cue = performanceMode ? performanceCue : songCueAt(show, position);
  const preview = cue
    ? sampleSongCue(
        cue,
        performanceMode ? Math.max(position, cue.time) : position,
      )
    : { color: "#ffffff", intensity: 0 };
  const cues = sortedSongCues(show);
  const selectedCount = cues.filter((item) => selected.has(item.id)).length;
  const editedPad = cuePads[selectedPad] ?? cuePads[0];
  // Follow playback: keep the cue that is playing in view.
  useEffect(() => {
    if (!follow || !playing || !cue) return;
    document
      .getElementById(`song-cue-${cue.id}`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [follow, playing, cue?.id]);
  const extent =
    source === "local" && duration > 0
      ? duration
      : Math.min(
          MAX_SONG_TIME,
          Math.max(180, position, (cues.at(-1)?.time ?? 0) + 30),
        );

  return (
    <section className="song-shows" aria-label="Song shows editor">
      <div className="song-shows-header">
        <div>
          <span className="song-show-kicker">MAKE IT YOURS</span>
          <h2>
            <Music2 size={22} /> Song shows
          </h2>
          <p>Compose a lighting timeline for each song.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            cancelAnalysis();
            stopPlayback(true);
            callbacks.current.onFreeRhythm();
          }}
        >
          <ArrowLeft size={16} /> Free rhythm
        </button>
      </div>
      <div className="song-show-toolbar">
        <label>
          Saved shows
          <select
            value={
              saved.shows.some((item) => item.id === show.id) ? show.id : ""
            }
            onChange={(event) => {
              const chosen = saved.shows.find(
                (item) => item.id === event.target.value,
              );
              if (chosen) {
                stopPlayback();
                setShow(structuredClone(chosen));
                setDirty(false);
                seek(0, true);
              }
            }}
          >
            <option value="" disabled>
              Unsaved show
            </option>
            {saved.shows.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="song-show-name">
          Song / show name
          <input
            maxLength={80}
            value={show.name}
            onChange={(event) =>
              edit((current) => ({ ...current, name: event.target.value }))
            }
          />
        </label>
        <button type="button" onClick={save}>
          <Save size={16} /> {dirty ? "Save changes" : "Save show"}
        </button>
        <button
          type="button"
          onClick={() => {
            stopPlayback();
            setShow(createSongShow({ sampleCues: false }));
            setDirty(true);
            seek(0, true);
          }}
        >
          <Plus size={16} /> New show
        </button>
        <details
          className="song-show-file-menu"
          ref={fileMenu}
          onClick={(event) => {
            // Choosing an item closes the menu (the file picker stays open).
            if (
              event.target instanceof Element &&
              event.target.closest(".song-show-files button")
            )
              event.currentTarget.open = false;
          }}
        >
          <summary>
            Show file <ChevronDown size={15} />
          </summary>
          <div className="song-show-files">
            <button
              type="button"
              onClick={exportShow}
              disabled={dirty && !isSaved}
            >
              Export show to file
            </button>
            <label className="song-show-import">
              Import show file
              <input
                type="file"
                accept=".json,application/json"
                onChange={(event) => {
                  void importShow(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </label>
            <button
              type="button"
              disabled={!isSaved}
              onClick={() => {
                if (
                  window.confirm(
                    `Delete the saved show "${show.name}"? This cannot be undone. Export it first if you may want it back.`,
                  )
                )
                  deleteShows(
                    (item) => item.id === show.id,
                    `Deleted "${show.name}".`,
                  );
              }}
            >
              Delete this show
            </button>
            <button
              type="button"
              disabled={!isSaved || saved.shows.length < 2}
              onClick={() => {
                const others = saved.shows.filter(
                  (item) => item.id !== show.id,
                );
                if (
                  window.confirm(
                    `Keep only "${show.name}" and delete the other ${others.length} saved show${others.length === 1 ? "" : "s"} (${others
                      .map((item) => item.name)
                      .join(", ")
                      .slice(0, 300)})? This cannot be undone.`,
                  )
                )
                  deleteShows(
                    (item) => item.id !== show.id,
                    `Kept "${show.name}" and deleted ${others.length} other show${others.length === 1 ? "" : "s"}.`,
                  );
              }}
            >
              Delete all other shows
            </button>
          </div>
        </details>
      </div>
      <div className="song-show-sticky">
        <div className="song-show-player">
          <button
            className="song-show-play"
            type="button"
            onClick={() => (playing || starting ? stopPlayback() : void play())}
          >
            {playing ? <Pause size={17} /> : <Play size={17} />}
            {starting
              ? "Cancel"
              : playing
                ? performanceMode
                  ? "End take"
                  : "Pause"
                : performanceMode
                  ? "Start take"
                  : "Play"}
          </button>
          <button
            type="button"
            className="song-show-icon-button"
            title="Back to the start"
            aria-label="Back to the start"
            onClick={() => seek(0, true)}
          >
            <RotateCcw size={16} />
          </button>
          <output className="song-show-clock">
            {seconds(position)}
            <small> / {seconds(extent)}</small>
          </output>
          <input
            className="song-show-scrub"
            aria-label="Show position"
            type="range"
            min={0}
            max={extent}
            step={0.01}
            value={Math.min(extent, position)}
            onChange={(event) => seek(Number(event.target.value))}
          />
          <button
            type="button"
            className="song-show-tap-button"
            title={
              performanceMode
                ? "Use pads 1–8 while Cue pads are open"
                : "Trigger the current brush with T"
            }
            disabled={performanceMode}
            onPointerDown={(event) => {
              event.preventDefault();
              keys.current.tap();
            }}
            onKeyDown={(event) => {
              if (
                (event.key === " " || event.key === "Enter") &&
                !event.repeat
              ) {
                event.preventDefault();
                keys.current.tap();
              }
            }}
          >
            Tap <kbd>T</kbd>
            {tapCount > 0 && <small>{tapCount}</small>}
          </button>
          <label
            className="song-show-send"
            title={
              props.connected
                ? "Send each cue to the wristband while the show plays"
                : "Connect a preset controller to send cues"
            }
          >
            <input
              type="checkbox"
              checked={hardware}
              disabled={!props.connected}
              onChange={(event) => {
                stopPlayback();
                setHardware(event.target.checked);
              }}
            />
            Send to wristband
          </label>
          <button
            type="button"
            className="song-show-live-toggle"
            aria-pressed={performanceMode}
            onClick={togglePerformanceMode}
          >
            <Keyboard size={16} /> Cue pads
          </button>
          <button
            type="button"
            className="song-show-brush-toggle"
            aria-expanded={brushShown}
            onClick={() => setBrushShown((value) => !value)}
          >
            Colors{selectedCount ? ` · ${selectedCount} ticked` : ""}
            <ChevronDown size={15} className="song-show-chevron" />
          </button>
        </div>
        {performanceMode && (
          <section className="song-show-live" aria-label="Performance cue pads">
            <div className="song-show-live-header">
              <div>
                <h3>Performance pads</h3>
                <p className="song-show-note">
                  {starting
                    ? "Getting playback ready…"
                    : playing
                      ? hardware
                        ? "Wristband armed. One key fires one complete cue."
                        : "Preview take. One key fires one complete cue."
                      : editPads
                        ? "Choose a pad, then set its color, light and time."
                        : "Choose a song or External player, then press Start take."}
                </p>
              </div>
              <div className="song-show-live-actions">
                <button
                  type="button"
                  className="song-show-record"
                  aria-pressed={recordPerformance}
                  onClick={() => setRecordPerformance((previous) => !previous)}
                >
                  <span aria-hidden="true" />
                  {recordPerformance ? "Record take" : "Rehearse only"}
                </button>
                <button
                  type="button"
                  aria-pressed={editPads}
                  disabled={playing || starting}
                  onClick={() => {
                    const next = !editPadsRef.current;
                    editPadsRef.current = next;
                    setEditPads(next);
                  }}
                >
                  {editPads ? "Done editing" : "Edit pads"}
                </button>
              </div>
            </div>
            <div
              className="song-show-cue-pads"
              role="group"
              aria-label={editPads ? "Choose a cue pad to edit" : "Fire a cue"}
            >
              {cuePads.map((pad, index) => {
                const preset = devicePresets.find(
                  (option) => option.hardwareColor === pad.color,
                )!;
                const selected = editPads && selectedPad === index;
                return (
                  <button
                    type="button"
                    className={`${lastPad === index ? "last-hit" : ""}${selected ? " editing" : ""}`}
                    style={{ borderColor: preset.color }}
                    key={index}
                    aria-keyshortcuts={String(index + 1)}
                    aria-pressed={selected || undefined}
                    disabled={!editPads && !playing}
                    onClick={() =>
                      editPads
                        ? setSelectedPad(index)
                        : hitPerformancePad(index)
                    }
                    onKeyDown={(event) => {
                      if (event.key === " " && !event.repeat) {
                        event.preventDefault();
                        keys.current.toggle();
                      }
                    }}
                  >
                    <kbd>{index + 1}</kbd>
                    <i
                      style={{ background: preset.color }}
                      aria-hidden="true"
                    />
                    <span>
                      <strong>{deviceColorNames[pad.color]}</strong>
                      <small>
                        {SHORT_LIGHT_NAMES[pad.mode]}
                        {pad.mode !== "flash" && ` · ${pad.seconds} s`}
                      </small>
                    </span>
                  </button>
                );
              })}
            </div>
            {editPads && editedPad && (
              <div className="song-show-pad-editor">
                <strong>Pad {selectedPad + 1}</strong>
                <label>
                  Color
                  <select
                    aria-label="Cue pad color"
                    value={editedPad.color}
                    onChange={(event) =>
                      updateCuePad(selectedPad, {
                        color: event.target.value as SongHardwareColor,
                      })
                    }
                  >
                    {devicePresets.map((preset) => (
                      <option
                        key={preset.hardwareColor}
                        value={preset.hardwareColor}
                      >
                        {deviceColorNames[preset.hardwareColor]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Light
                  <select
                    aria-label="Cue pad light"
                    value={editedPad.mode}
                    onChange={(event) =>
                      updateCuePad(selectedPad, {
                        mode: event.target.value as CuePadMode,
                      })
                    }
                  >
                    {cuePadModes.map((mode) => (
                      <option key={mode} value={mode}>
                        {SHORT_LIGHT_NAMES[mode]}
                      </option>
                    ))}
                  </select>
                </label>
                {editedPad.mode !== "flash" && (
                  <label>
                    Time
                    <span className="song-show-pad-time">
                      <input
                        type="number"
                        aria-label="Cue pad time in seconds"
                        min={0.5}
                        max={60}
                        step={0.1}
                        value={editedPad.seconds}
                        onChange={(event) =>
                          updateCuePad(selectedPad, {
                            seconds: Math.max(
                              0.5,
                              Math.min(60, Number(event.target.value) || 0.5),
                            ),
                          })
                        }
                      />
                      s
                    </span>
                  </label>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (
                      window.confirm(
                        "Restore all eight Cue pads to their default colors and light modes?",
                      )
                    )
                      setCuePads(defaultCuePads.map((pad) => ({ ...pad })));
                  }}
                >
                  Restore defaults
                </button>
                <small>Pad settings are saved in this browser.</small>
              </div>
            )}
            {hardware && (
              <p className="song-show-note" role="status">
                Confirmed sends: {confirmedCues}
                {unsentCues > 0 && ` · Unsent requests: ${unsentCues}`}
              </p>
            )}
            <p className="song-show-note">
              Keys 1–8 also work on the number row or numpad. Turn off Cue pads
              to play the recorded timeline.
            </p>
          </section>
        )}
        <div
          className={`song-show-brush${brushShown ? "" : " folded"}`}
          role="group"
          aria-label="Color and light for new taps and ticked cues"
        >
          <div className="song-show-brush-colors">
            <span className="song-show-brush-label">Color</span>
            <div className="song-show-swatches">
              {palette.map((option) => {
                const on = brush.some((item) => item.key === option.key);
                return (
                  <button
                    type="button"
                    key={option.key}
                    className={on ? "selected" : ""}
                    style={{ background: option.color }}
                    title={option.name}
                    aria-label={option.name}
                    aria-pressed={on}
                    onClick={() => pickBrush(option)}
                  />
                );
              })}
            </div>
            <label
              className="song-show-check"
              title="Pick several colors; taps and ticked cues get them in turn"
            >
              <input
                type="checkbox"
                checked={brushMix}
                onChange={(event) => {
                  setBrushMix(event.target.checked);
                  if (!event.target.checked)
                    setBrush((current) => current.slice(0, 1));
                }}
              />
              Several in turn
            </label>
          </div>
          <div className="song-show-brush-light">
            <span className="song-show-brush-label">Light</span>
            <select
              aria-label="Light for new taps and ticked cues"
              value={lightTiming}
              onChange={(event) =>
                setLightTiming(event.target.value as LightChoice)
              }
            >
              {(Object.keys(LIGHT_NAMES) as LightChoice[]).map((choice) => (
                <option key={choice} value={choice}>
                  {LIGHT_NAMES[choice]}
                </option>
              ))}
            </select>
            {lightTiming !== "flash" && (
              <label className="song-show-inline">
                <input
                  type="number"
                  aria-label="Seconds"
                  min={MIN_HOLD_MS / 1000}
                  max={MAX_HOLD_MS / 1000}
                  step={0.1}
                  value={lightSeconds}
                  onChange={(event) =>
                    setLightSeconds(Number(event.target.value) || 0)
                  }
                />
                s
              </label>
            )}
            {lightTiming === "timed" && (
              <>
                <select
                  aria-label="Fade in"
                  value={brushFadeIn ?? ""}
                  onChange={(event) =>
                    setBrushFadeIn(
                      event.target.value
                        ? Number(event.target.value)
                        : undefined,
                    )
                  }
                >
                  <option value="">No fade in</option>
                  {FADE_TIMES_MS.map((ms) => (
                    <option key={ms} value={ms}>
                      Fade in {fadeLabel(ms)}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Fade out"
                  value={brushFadeOut ?? ""}
                  onChange={(event) =>
                    setBrushFadeOut(
                      event.target.value
                        ? Number(event.target.value)
                        : undefined,
                    )
                  }
                >
                  <option value="">No fade out</option>
                  {FADE_TIMES_MS.map((ms) => (
                    <option key={ms} value={ms}>
                      Fade out {fadeLabel(ms)}
                    </option>
                  ))}
                </select>
              </>
            )}
            {lightTiming === "rainbow" && (
              <label className="song-show-inline">
                <input
                  type="number"
                  aria-label="Seconds for one turn of colors"
                  min={MIN_RAINBOW_CYCLE_MS / 1000}
                  max={MAX_RAINBOW_CYCLE_MS / 1000}
                  step={0.5}
                  value={brushCycleMs / 1000}
                  onChange={(event) =>
                    setBrushCycleMs(
                      Math.max(
                        MIN_RAINBOW_CYCLE_MS,
                        Math.min(
                          MAX_RAINBOW_CYCLE_MS,
                          Math.round((Number(event.target.value) || 3) * 1000),
                        ),
                      ),
                    )
                  }
                />
                s per turn
              </label>
            )}
          </div>
          <div className="song-show-brush-apply">
            <span className="song-show-brush-label">
              {selectedCount
                ? `${selectedCount} ticked`
                : "Tick cues below to change them"}
            </span>
            <button
              type="button"
              disabled={!selectedCount}
              onClick={() => applyBrush("color")}
            >
              Set color
            </button>
            <button
              type="button"
              disabled={!selectedCount}
              onClick={() => applyBrush("light")}
            >
              Set light
            </button>
            <button
              type="button"
              disabled={!selectedCount}
              title="Each ticked cue stays lit until the next cue starts"
              onClick={() => applyBrush("until-next")}
            >
              Lit until next cue
            </button>
            <button
              type="button"
              className="song-show-icon-button"
              disabled={!selectedCount}
              title="Delete the ticked cues"
              aria-label="Delete the ticked cues"
              onClick={deleteSelected}
            >
              <Trash2 size={15} />
            </button>
            {selectedCount > 0 && (
              <button type="button" onClick={() => setSelected(new Set())}>
                Untick all
              </button>
            )}
          </div>
        </div>
        {message && (
          <p className="song-show-message" role="status">
            <span>{message}</span>
            <button
              type="button"
              className="song-show-icon-button"
              aria-label="Dismiss message"
              onClick={() => setMessage("")}
            >
              <X size={14} />
            </button>
          </p>
        )}
      </div>
      <div className="song-show-grid">
        <div className="song-show-playback">
          <h3>Song</h3>
          <div
            className="song-show-source"
            role="group"
            aria-label="Show timing source"
          >
            <button
              type="button"
              aria-pressed={source === "local"}
              onClick={() => {
                stopPlayback();
                setSource("local");
                seek(0, true);
              }}
            >
              Local audio
            </button>
            <button
              type="button"
              aria-pressed={source === "external"}
              onClick={() => {
                stopPlayback();
                setSource("external");
                seek(0, true);
              }}
            >
              External player
            </button>
          </div>
          {source === "local" ? (
            <>
              <label className="song-show-upload">
                <Upload size={18} />
                <span>{fileName || "Choose an MP3 or WAV"}</span>
                <input
                  type="file"
                  accept=".mp3,.wav,audio/mpeg,audio/wav,audio/x-wav"
                  onChange={(event) => chooseFile(event.target.files?.[0])}
                />
              </label>
              <audio
                key={audioUrl || "no-track"}
                ref={audio}
                src={audioUrl || undefined}
                controls
                preload="metadata"
                onLoadedMetadata={() => {
                  const value = audio.current?.duration;
                  setDuration(
                    value && Number.isFinite(value)
                      ? Math.min(MAX_SONG_TIME, value)
                      : 0,
                  );
                  setMetadataStatus(
                    value && Number.isFinite(value) && value > 0
                      ? "ready"
                      : "error",
                  );
                  if (!value || !Number.isFinite(value) || value <= 0)
                    setMessage(
                      "Track duration could not be read. Rhythm analysis is unavailable for this file.",
                    );
                }}
                onPlay={() => {
                  if (!playingRef.current && !startingRef.current) void play();
                }}
                onPause={() => {
                  if (ignoredPause.current) {
                    ignoredPause.current = false;
                    return;
                  }
                  if (playingRef.current || startingRef.current) stopPlayback();
                }}
                onSeeking={() => {
                  if (audio.current) {
                    if (
                      ignoredSeek.current !== null &&
                      Math.abs(
                        audio.current.currentTime - ignoredSeek.current,
                      ) < 0.05
                    )
                      return;
                    seek(audio.current.currentTime);
                  }
                }}
                onSeeked={() => {
                  ignoredSeek.current = null;
                }}
                onEnded={() => stopPlayback()}
                onError={() => {
                  cancelAnalysis();
                  setMetadataStatus("error");
                  stopPlayback();
                  setMessage(
                    "This audio file could not be played in the browser.",
                  );
                }}
              />
              <p className="song-show-note">
                Playback follows this file’s audio clock. Files stay on your
                device and must be selected again after reload.
              </p>
              <details
                className="song-show-analysis"
                open={analysisOpen}
                onToggle={(event) => setAnalysisOpen(event.currentTarget.open)}
              >
                <summary>
                  <AudioLines size={16} /> Analyze rhythm and make a draft
                  <ChevronDown size={16} className="song-show-chevron" />
                </summary>
                <div className="song-show-analysis-heading">
                  <span>
                    {rhythm ? "Song analyzed" : "Find the beats of this song"}
                  </span>
                  {analysing ? (
                    <button
                      type="button"
                      onClick={() => cancelAnalysis(false, true)}
                    >
                      <X size={14} /> Cancel
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={
                        !selectedFile ||
                        metadataStatus !== "ready" ||
                        duration <= 0 ||
                        selectedFile.size > MAX_ANALYSIS_FILE_BYTES ||
                        duration > MAX_ANALYSIS_SECONDS
                      }
                      onClick={() => void analyzeRhythm()}
                    >
                      {rhythm ? "Analyze again" : "Analyze song"}
                    </button>
                  )}
                </div>
                <p className="song-show-note">
                  Find estimated BPM and beat attacks locally, then create an
                  editable draft. Up to 10 minutes / 100 MB. Nothing is uploaded
                  and analysis sends no lighting cues.
                </p>
                {metadataStatus === "loading" && (
                  <p className="song-show-note" role="status">
                    Loading track information…
                  </p>
                )}
                {metadataStatus === "error" && (
                  <p className="song-show-note">
                    Track information is unavailable. Choose another file to
                    analyze rhythm.
                  </p>
                )}
                {analysing && (
                  <div className="song-show-analysis-progress" role="status">
                    <span>
                      Analyzing song · {Math.round(analysisProgress * 100)}%
                    </span>
                    <progress
                      aria-label="Rhythm analysis progress"
                      max={1}
                      value={analysisProgress}
                    />
                  </div>
                )}
                {rhythm && (
                  <>
                    <dl className="song-show-rhythm-stats">
                      <div>
                        <dt>Estimated BPM</dt>
                        <dd>
                          {rhythm.bpm === null
                            ? "Uncertain"
                            : Math.round(rhythm.bpm)}
                        </dd>
                      </div>
                      <div>
                        <dt>Beats found</dt>
                        <dd>{rhythm.beats.length}</dd>
                      </div>
                      <div>
                        <dt>Confidence</dt>
                        <dd>{Math.round(rhythm.confidence * 100)}%</dd>
                      </div>
                    </dl>
                    {rhythm.confidence < 0.35 && (
                      <p className="song-show-note" role="status">
                        Low rhythm confidence. These attacks may not follow the
                        main drum beat; preview and edit the timing before using
                        the draft on a device.
                      </p>
                    )}
                  </>
                )}
                {(rhythm || show.cues.length > 0) && (
                  <>
                    <div className="song-show-draft-options">
                      <label>
                        Pattern to apply
                        <select
                          value={draftPattern}
                          onChange={(event) =>
                            setDraftPattern(
                              event.target.value as "single" | "rgb",
                            )
                          }
                        >
                          <option value="single">Single color pulse</option>
                          <option value="rgb">RGB pulses</option>
                        </select>
                      </label>
                      <label>
                        New draft spacing
                        <select
                          disabled={!rhythm}
                          value={draftEvery}
                          onChange={(event) =>
                            setDraftEvery(
                              Number(event.target.value) as 1 | 2 | 4,
                            )
                          }
                        >
                          <option value={1}>Every detected beat</option>
                          <option value={2}>Every second beat</option>
                          <option value={4}>Every fourth beat</option>
                        </select>
                      </label>
                      {draftPattern === "single" && (
                        <label>
                          Pulse color
                          <input
                            type="color"
                            aria-label="Generated pulse color"
                            value={draftColor}
                            onChange={(event) =>
                              setDraftColor(event.target.value)
                            }
                          />
                        </label>
                      )}
                      <label>
                        Preview profile
                        <select
                          value={draftProfile}
                          onChange={(event) =>
                            setDraftProfile(
                              event.target.value as Lighting["profile"],
                            )
                          }
                        >
                          <option>Taylor Swift</option>
                          <option>The Weeknd</option>
                        </select>
                      </label>
                    </div>
                    {draftPattern === "single" && (
                      <p className="song-show-note">
                        Single device preset:{" "}
                        {
                          {
                            R: "Red",
                            G: "Green",
                            B: "Blue",
                            Y: "Yellow",
                            C: "Cyan",
                            W: "White",
                          }[nearestDevicePreset(draftColor).hardwareColor]
                        }
                        . The device uses the closest verified preset to the
                        preview color.
                      </p>
                    )}
                    <button
                      type="button"
                      className="song-show-generate"
                      disabled={!show.cues.length || analysing}
                      onClick={() => {
                        try {
                          edit(() =>
                            applyShowPulsePattern(
                              show,
                              draftPattern,
                              draftColor,
                            ),
                          );
                          setMessage(
                            `${draftPattern === "single" ? "Single color pulses" : "RGB pulses"} applied to the current show. Cue times are unchanged. Press Play show to resume, then save your changes.`,
                          );
                        } catch (error) {
                          setMessage(errorText(error));
                        }
                      }}
                    >
                      Apply pattern to current show
                    </button>
                    <button
                      className="song-show-generate"
                      type="button"
                      disabled={!rhythm?.beats.length || dirty || analysing}
                      onClick={generateDraft}
                    >
                      <WandSparkles size={16} /> Create new beat draft
                    </button>
                    <p className="song-show-note">
                      {dirty
                        ? "Save current show changes before creating another draft. "
                        : "Creates a new unsaved show; saved shows stay unchanged. "}
                      Preview pulses are 120 ms. Long tracks are thinned by
                      powers of two to at most {MAX_SONG_CUES} cues across the
                      song. Tracked beats may still miss or add hits; review and
                      edit the draft. Hardware output starts off.
                    </p>
                  </>
                )}
              </details>
            </>
          ) : (
            <p className="song-show-note">
              Start your YouTube or external player, then press Play here. This
              clock cannot read or control that player’s position; pause, seek
              and align both by hand.
            </p>
          )}
          <label className="song-show-seek">
            Go to second
            <input
              type="number"
              min={0}
              max={MAX_SONG_TIME}
              step={0.1}
              value={Number(position.toFixed(1))}
              onChange={(event) => seek(Number(event.target.value))}
            />
          </label>
          <h3 className="song-show-subhead">Wristband output</h3>
          <label className="song-show-lead">
            <span>
              Device lead
              <small>
                Sends device cues this many milliseconds early to make up for
                the serial, infrared and wristband delay. Raise it if the lights
                come after the beat, lower it if they come before. The on-screen
                preview is not affected.
              </small>
            </span>
            <span className="song-show-lead-value">
              <input
                type="number"
                min={0}
                max={MAX_HARDWARE_LEAD_MS}
                step={5}
                value={hardwareLeadMs}
                aria-label="Device lead in milliseconds"
                onChange={(event) => {
                  const value = clampHardwareLead(event.target.value);
                  setHardwareLeadMs(value);
                  try {
                    localStorage.setItem(SONG_LEAD_STORAGE_KEY, String(value));
                  } catch {
                    /* The lead still applies for this session. */
                  }
                }}
              />
              ms early
            </span>
          </label>
          <div className="song-show-device-status" role="status">
            <strong>
              {!hardware
                ? "Preview only · device output off"
                : !playing
                  ? "Device output enabled · press Play show"
                  : clockMode === "audio"
                    ? "ESP32 output · audio clock"
                    : "ESP32 output · foreground fallback"}
            </strong>
            {hardware && (
              <span>
                Confirmed sends: {confirmedCues}
                {lastSentColor ? ` · Last ${lastSentColor}` : ""}
                {unsentCues ? ` · Unsent requests: ${unsentCues}` : ""}
              </span>
            )}
            {props.connected && props.whitePreset === "whitish" && (
              <span>
                White cues send this firmware’s original warm WHITISH frame.
              </span>
            )}
            {props.connected && props.whitePreset === "neutral-candidate" && (
              <span>
                White cues send neutral white (equal red, green and blue).
              </span>
            )}
            {hardware && playing && clockMode === "foreground" && (
              <span>Keep this controller page visible in this browser.</span>
            )}
            {hardware &&
              !performanceMode &&
              !show.cues.some((item) => item.hardwareColor) && (
                <span>
                  No cue has a hardware color. Select a Hardware preset in the
                  cue list.
                </span>
              )}
            {props.connected &&
              show.cues.length > 0 &&
              !show.cues.some((item) => item.hardwareColor) && (
                <button
                  type="button"
                  disabled={dirty}
                  onClick={() => {
                    stopPlayback();
                    try {
                      setShow(createRgbDeviceCopy(show));
                      setDirty(true);
                      setHardware(true);
                      seek(0, true);
                      setMessage(
                        "Created a separate RGB device copy with the same cue times. Your saved original is unchanged. Select the song and press Play show to test.",
                      );
                    } catch (error) {
                      setMessage(errorText(error));
                    }
                  }}
                >
                  Make RGB device copy
                </button>
              )}
          </div>
          <p className="song-show-note">
            The wristband gets each cue's color and light. Preview settings
            (under … on a cue) only change the on-screen preview. Pause ends the
            show and turns off a light that is still on. Strobe flashes about 8
            times a second; Build-up starts at 2 a second and speeds up, for the
            bars before a drop.
            {!props.timedLightSupported &&
              " Timed lights need the firmware that reports TIMED LIGHT; other firmware sends a quick flash instead."}
            {props.connected &&
              !props.customLightSupported &&
              " Extra colors and fades need the firmware that reports CUSTOM LIGHT; this firmware sends the nearest preset color without fades."}
            {props.timedLightSupported &&
              !props.rainbowSupported &&
              " Rainbows need the firmware that reports RAINBOW; this firmware sends a steady light in the cue's color instead."}
            {props.timedLightSupported &&
              !props.strobeSupported &&
              " Strobes need the firmware that reports STROBE; this firmware sends a steady light instead."}
            {
              ' Output: Board setting follows the ESP32\'s "Lights go out by" choice; IR + RF, IR only or RF only applies to that cue alone.'
            }
            {props.connected &&
              !props.lightOutputSupported &&
              " A cue's own output needs the firmware that reports LIGHT OUTPUT; this firmware uses the board setting."}
          </p>
        </div>
        <div className="song-show-preview">
          <h3>
            Show preview <span>SIMULATED LIGHT</span>
          </h3>
          {props.renderPreview({
            ...preview,
            profile: cue?.lighting.profile ?? "Taylor Swift",
          })}
          <div className="song-show-now">
            <span>{cue?.label || "Waiting for first cue"}</span>
            <strong>
              {cue
                ? `${seconds(cue.time)} · ${performanceMode ? SHORT_LIGHT_NAMES[lightChoice(cue)] : cue.lighting.effect}`
                : "No active cue"}
            </strong>
          </div>
        </div>
      </div>
      <div className="song-show-cues-heading">
        <div>
          <h3>
            Lighting cues <span>{cues.length}</span>
          </h3>
          <p>
            Tick cues (Shift-click ticks a range), then use Set color or Set
            light above. The number jumps the song to that cue. Space plays or
            pauses, T taps.
          </p>
        </div>
        <div className="song-show-cues-actions">
          <label className="song-show-check">
            <input
              type="checkbox"
              checked={follow}
              onChange={(event) => setFollow(event.target.checked)}
            />
            Follow playback
          </label>
          <button
            type="button"
            disabled={!cues.length}
            onClick={() =>
              setSelected(
                selectedCount === cues.length
                  ? new Set()
                  : new Set(cues.map((item) => item.id)),
              )
            }
          >
            {selectedCount === cues.length && cues.length
              ? "Untick all"
              : "Tick all"}
          </button>
          <button
            type="button"
            disabled={cues.length >= MAX_SONG_CUES}
            onClick={() =>
              edit((current) => ({
                ...current,
                cues: [
                  ...current.cues,
                  brushCue(
                    Number(position.toFixed(2)),
                    `Cue ${current.cues.length + 1}`,
                    brush[current.cues.length % brush.length],
                  ),
                ],
              }))
            }
          >
            <Plus size={16} /> Add at {seconds(position)}
          </button>
          <button
            type="button"
            disabled={!cues.length}
            onClick={() => {
              if (
                window.confirm(
                  "Remove every cue from this show? Saved shows change only when you save.",
                )
              ) {
                edit((current) => ({ ...current, cues: [] }));
                setTapCount(0);
                setMessage("All cues removed. Tap along to mark new ones.");
              }
            }}
          >
            Remove all
          </button>
        </div>
      </div>
      {cues.length > 0 && (
        <div className="song-show-cue-columns" aria-hidden="true">
          <span />
          <span>#</span>
          <span>Time (s)</span>
          <span>Color</span>
          <span>Light</span>
          <span>Seconds</span>
          <span>Output · fades / turn</span>
        </div>
      )}
      <div className="song-show-cues">
        {cues.length === 0 && (
          <p className="song-show-note">
            No cues yet. Press Play and Tap along, or Add at the current
            position.
          </p>
        )}
        {cues.map((item, index) => {
          const name = item.label || `cue ${index + 1}`;
          const colorOpen =
            openCue?.id === item.id && openCue.panel === "color";
          const moreOpen = openCue?.id === item.id && openCue.panel === "more";
          const choice = lightChoice(item);
          const swatch = !item.hardwareColor
            ? "transparent"
            : item.levels
              ? levelsHex(item.levels)
              : (devicePresets.find(
                  (preset) => preset.hardwareColor === item.hardwareColor,
                )?.color ?? item.lighting.color);
          const colorName = !item.hardwareColor
            ? "Preview only"
            : item.levels
              ? (moreColors.find((extra) =>
                  sameLevels(item.levels, extra.levels),
                )?.name ?? "Custom")
              : deviceColorNames[item.hardwareColor];
          return (
            <article
              id={`song-cue-${item.id}`}
              className={`song-show-cue${cue?.id === item.id ? " active" : ""}${selected.has(item.id) ? " ticked" : ""}`}
              key={item.id}
            >
              <div className="song-show-cue-row">
                <input
                  type="checkbox"
                  className="song-show-cue-tick"
                  aria-label={`Tick cue ${index + 1}`}
                  checked={selected.has(item.id)}
                  onChange={(event) =>
                    pickCue(
                      item.id,
                      (event.nativeEvent as MouseEvent).shiftKey === true,
                    )
                  }
                />
                <button
                  type="button"
                  className="song-show-cue-index"
                  onClick={() => seek(item.time)}
                  title="Jump the song here"
                  aria-label={`Go to cue ${index + 1}`}
                >
                  {String(index + 1).padStart(2, "0")}
                </button>
                <input
                  className="song-show-cue-time"
                  type="number"
                  aria-label={`Time of cue ${index + 1} in seconds`}
                  min={0}
                  max={MAX_SONG_TIME}
                  step={0.001}
                  value={Number(item.time.toFixed(3))}
                  onChange={(event) =>
                    editCue(item.id, {
                      time: Math.max(
                        0,
                        Math.min(
                          MAX_SONG_TIME,
                          Number(event.target.value) || 0,
                        ),
                      ),
                    })
                  }
                />
                <button
                  type="button"
                  className="song-show-cue-color"
                  aria-expanded={colorOpen}
                  aria-label={`Color of cue ${index + 1}: ${colorName}`}
                  onClick={() =>
                    setOpenCue(
                      colorOpen ? null : { id: item.id, panel: "color" },
                    )
                  }
                >
                  <i
                    className={item.hardwareColor ? "" : "none"}
                    style={{ background: swatch }}
                  />
                  <span>{colorName}</span>
                </button>
                <select
                  className="song-show-cue-light"
                  aria-label={`Light of cue ${index + 1}`}
                  value={choice}
                  onChange={(event) =>
                    editCue(
                      item.id,
                      cueLight(
                        event.target.value as LightChoice,
                        item.holdMs === undefined
                          ? lightSeconds
                          : item.holdMs / 1000,
                      ),
                    )
                  }
                >
                  {(Object.keys(SHORT_LIGHT_NAMES) as LightChoice[]).map(
                    (option) => (
                      <option key={option} value={option}>
                        {SHORT_LIGHT_NAMES[option]}
                      </option>
                    ),
                  )}
                </select>
                {item.holdMs !== undefined ? (
                  <input
                    className="song-show-cue-seconds"
                    type="number"
                    aria-label={`Seconds of cue ${index + 1}`}
                    min={MIN_HOLD_MS / 1000}
                    max={MAX_HOLD_MS / 1000}
                    step={0.1}
                    value={item.holdMs / 1000}
                    onChange={(event) =>
                      editCue(
                        item.id,
                        cueLight(
                          choice,
                          Number(event.target.value),
                          item.rainbowMs,
                        ),
                      )
                    }
                  />
                ) : (
                  <span className="song-show-cue-seconds" />
                )}
                <div className="song-show-cue-extra">
                  <select
                    className="song-show-cue-output"
                    aria-label={`Output of cue ${index + 1}`}
                    title="IR, RF or both for this cue"
                    value={item.output ?? ""}
                    onChange={(event) =>
                      editCue(item.id, {
                        output: (event.target.value || undefined) as
                          SongCue["output"] | undefined,
                      })
                    }
                  >
                    <option value="">Board setting</option>
                    <option value="both">IR + RF</option>
                    <option value="ir">IR only</option>
                    <option value="rf">RF only</option>
                  </select>
                  {choice === "timed" &&
                    (["fadeInMs", "fadeOutMs"] as const).map((field) => (
                      <select
                        key={field}
                        aria-label={`${field === "fadeInMs" ? "Fade in" : "Fade out"} of cue ${index + 1}`}
                        title={field === "fadeInMs" ? "Fade in" : "Fade out"}
                        value={item[field] ?? ""}
                        onChange={(event) =>
                          editCue(item.id, {
                            [field]: event.target.value
                              ? Number(event.target.value)
                              : undefined,
                          })
                        }
                      >
                        <option value="">
                          {field === "fadeInMs" ? "In: none" : "Out: none"}
                        </option>
                        {FADE_TIMES_MS.map((ms) => (
                          <option key={ms} value={ms}>
                            {field === "fadeInMs" ? "In" : "Out"}{" "}
                            {fadeLabel(ms)}
                          </option>
                        ))}
                      </select>
                    ))}
                  {item.rainbowMs !== undefined && (
                    <label className="song-show-inline">
                      <input
                        type="number"
                        aria-label={`Seconds for one turn of colors in cue ${index + 1}`}
                        min={MIN_RAINBOW_CYCLE_MS / 1000}
                        max={MAX_RAINBOW_CYCLE_MS / 1000}
                        step={0.5}
                        value={item.rainbowMs / 1000}
                        onChange={(event) =>
                          editCue(item.id, {
                            rainbowMs: Math.max(
                              MIN_RAINBOW_CYCLE_MS,
                              Math.min(
                                MAX_RAINBOW_CYCLE_MS,
                                Math.round(
                                  (Number(event.target.value) || 3) * 1000,
                                ),
                              ),
                            ),
                          })
                        }
                      />
                      s / turn
                    </label>
                  )}
                </div>
                <button
                  type="button"
                  className="song-show-icon-button song-show-cue-more-button"
                  aria-expanded={moreOpen}
                  title="Name and on-screen preview settings"
                  aria-label={`More settings for cue ${index + 1}`}
                  onClick={() =>
                    setOpenCue(moreOpen ? null : { id: item.id, panel: "more" })
                  }
                >
                  <Ellipsis size={16} />
                </button>
                <button
                  type="button"
                  className="song-show-delete"
                  aria-label={`Delete ${name}`}
                  onClick={() =>
                    edit((current) => ({
                      ...current,
                      cues: current.cues.filter(
                        (value) => value.id !== item.id,
                      ),
                    }))
                  }
                >
                  <Trash2 size={16} />
                </button>
              </div>
              {colorOpen && (
                <div className="song-show-cue-panel">
                  <div className="song-show-chips">
                    <span>Device color</span>
                    <div>
                      {devicePresets.map((preset) => (
                        <button
                          type="button"
                          key={preset.hardwareColor}
                          className={
                            !item.levels &&
                            item.hardwareColor === preset.hardwareColor
                              ? "selected"
                              : ""
                          }
                          style={{ background: preset.color }}
                          aria-label={`${deviceColorNames[preset.hardwareColor]} for ${item.label || `cue ${index + 1}`}`}
                          aria-pressed={
                            !item.levels &&
                            item.hardwareColor === preset.hardwareColor
                          }
                          onClick={() =>
                            editCue(item.id, {
                              hardwareColor: preset.hardwareColor,
                              levels: undefined,
                              lighting: {
                                ...item.lighting,
                                color: preset.color,
                                musicSync: false,
                              },
                            })
                          }
                        />
                      ))}
                      <button
                        type="button"
                        className={`none${item.hardwareColor ? "" : " selected"}`}
                        aria-label={`Preview only for ${item.label || `cue ${index + 1}`}`}
                        aria-pressed={!item.hardwareColor}
                        onClick={() =>
                          editCue(item.id, {
                            hardwareColor: undefined,
                            levels: undefined,
                          })
                        }
                      >
                        ×
                      </button>
                    </div>
                    <div>
                      {moreColors.map((extra, extraIndex) => (
                        <button
                          type="button"
                          key={`${extra.name}-${extraIndex}`}
                          className={
                            sameLevels(item.levels, extra.levels)
                              ? "selected"
                              : ""
                          }
                          style={{ background: levelsHex(extra.levels) }}
                          title={`${extra.name} (${extra.levels.join("/")})`}
                          aria-label={`${extra.name} for ${item.label || `cue ${index + 1}`}`}
                          aria-pressed={sameLevels(item.levels, extra.levels)}
                          onClick={() => setCueLevels(item, extra.levels)}
                        />
                      ))}
                      <button
                        type="button"
                        className={`none${item.levels && !moreColors.some((extra) => sameLevels(item.levels, extra.levels)) ? " selected" : ""}`}
                        title="Custom red / green / blue levels"
                        aria-label={`Custom color for ${item.label || `cue ${index + 1}`}`}
                        onClick={() =>
                          setCueLevels(item, item.levels ?? [100, 100, 100])
                        }
                      >
                        +
                      </button>
                    </div>
                    {item.levels && (
                      <div className="song-show-levels">
                        {(["R", "G", "B"] as const).map(
                          (channel, channelIndex) => (
                            <label key={channel}>
                              {channel}
                              <input
                                type="number"
                                min={0}
                                max={MAX_DEVICE_LEVEL}
                                step={4}
                                value={item.levels![channelIndex]}
                                aria-label={`${channel} level for ${item.label || `cue ${index + 1}`}`}
                                onChange={(event) =>
                                  setCueLevels(
                                    item,
                                    item.levels!.map((level, at) =>
                                      at === channelIndex
                                        ? Number(event.target.value)
                                        : level,
                                    ),
                                  )
                                }
                              />
                            </label>
                          ),
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {moreOpen && (
                <div className="song-show-cue-panel song-show-cue-more">
                  <label className="song-show-cue-label">
                    Cue name
                    <input
                      maxLength={80}
                      value={item.label}
                      onChange={(event) =>
                        editCue(item.id, { label: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Preview color
                    <input
                      aria-label={`Preview color for ${item.label}`}
                      type="color"
                      value={item.lighting.color}
                      onChange={(event) =>
                        editLighting(item, { color: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Preview effect
                    <select
                      value={item.lighting.effect}
                      onChange={(event) =>
                        editLighting(item, {
                          effect: event.target.value as Lighting["effect"],
                        })
                      }
                    >
                      {effects.map((effect) => (
                        <option key={effect}>{effect}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Brightness
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={item.lighting.brightness}
                      onChange={(event) =>
                        editLighting(item, {
                          brightness: Math.max(
                            0,
                            Math.min(100, Number(event.target.value) || 0),
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    Speed
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={item.lighting.speed}
                      onChange={(event) =>
                        editLighting(item, {
                          speed: Math.max(
                            0,
                            Math.min(100, Number(event.target.value) || 0),
                          ),
                        })
                      }
                    />
                  </label>
                  {item.lighting.effect === "Flash" && (
                    <label className="song-show-pulse">
                      Flash preview timing
                      <select
                        value={item.pulseMs === undefined ? "" : item.pulseMs}
                        onChange={(event) =>
                          editCue(item.id, {
                            pulseMs: event.target.value
                              ? Number(event.target.value)
                              : undefined,
                          })
                        }
                      >
                        <option value="">Repeating preview</option>
                        {[50, 80, 120, 160, 240, 500, 1000, 2000].map(
                          (value) => (
                            <option key={value} value={value}>
                              Single pulse · {value} ms
                            </option>
                          ),
                        )}
                        {item.pulseMs !== undefined &&
                          ![50, 80, 120, 160, 240, 500, 1000, 2000].includes(
                            item.pulseMs,
                          ) && (
                            <option value={item.pulseMs}>
                              Single pulse · {item.pulseMs} ms
                            </option>
                          )}
                      </select>
                    </label>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
