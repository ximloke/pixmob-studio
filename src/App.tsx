import { useState, useEffect, useRef, type CSSProperties } from "react";
import ColorPicker from "./ColorPicker";
import PresetControls, { presetLook } from "./PresetControls";
import SongShows from "./SongShows";
import {
  SongCueOutput,
  type SongHardwareColor,
  type SongCueExtras,
  type SongStrobe,
} from "./lib/songShow";
import { PresetSerialTransport } from "./lib/presetSerial";
import { V2SerialTransport } from "./lib/v2Serial";
import { deviceBeatPulse } from "./lib/devicePreview";
import {
  BrowserBeatOutput,
  setBrowserBeatScreenSource,
} from "./lib/browserBeat";
import { createScreenColorSampler } from "./lib/screenColor";
import {
  Activity,
  AudioLines,
  Bluetooth,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Command,
  Disc3,
  Download,
  LayoutGrid,
  Lightbulb,
  Menu,
  Mic,
  Monitor,
  Music2,
  Pause,
  Play,
  Plus,
  Power,
  Radio,
  RotateCcw,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Usb,
  Waves,
  Wifi,
  X,
  Zap,
} from "lucide-react";
import {
  initialLighting,
  effects,
  hexRGB,
  rgbHex,
  sampleEffect,
  builtInScenes,
  validLighting,
  type Lighting,
  type Scene,
} from "./lib/effects";
import {
  AudioEngine,
  demoAudio,
  silentFrame,
  type AudioFrame,
} from "./lib/audio";
import {
  HttpTransport,
  SerialTransport,
  hasSerial,
  validateIR,
  type DeviceTransport,
  type DeviceAudio,
  type Status,
  type IRConfig,
} from "./lib/device";
const cx = (...v: (string | false | null | undefined)[]) =>
  v.filter(Boolean).join(" ");
function Slider({
  label,
  value,
  onChange,
  unit = "%",
  icon,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  unit?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="slider-control">
      <div className="control-label">
        <span>
          {icon}
          {label}
        </span>
        <strong>
          {value}
          <small>{unit}</small>
        </strong>
      </div>
      <input
        aria-label={label}
        type="range"
        min="0"
        max="100"
        value={value}
        style={{ "--fill": `${value}%` } as CSSProperties}
        onChange={(e) => onChange(+e.target.value)}
      />
      <div className="range-captions">
        <span>
          {label === "Speed"
            ? "Slow"
            : label === "Sensitivity"
              ? "Subtle"
              : "Low"}
        </span>
        <span>
          {label === "Speed"
            ? "Fast"
            : label === "Sensitivity"
              ? "Reactive"
              : "High"}
        </span>
      </div>
    </div>
  );
}
function Wristband({
  color,
  intensity,
  profile,
  mini = false,
}: {
  color: string;
  intensity: number;
  profile: string;
  mini?: boolean;
}) {
  return (
    <div
      className={cx("wristband", mini && "mini")}
      style={{ "--light": color, "--intensity": intensity } as CSSProperties}
    >
      <div className="band-back" />
      <div className="band-strap">
        <div className="strap-print">
          {profile === "Taylor Swift"
            ? "THE ERAS TOUR"
            : "AFTER HOURS • TIL DAWN"}
        </div>
        <div className="strap-holes">••••••</div>
      </div>
      <div className="band-shadow" />
      <div className="band-body">
        <div className="band-glow" />
        <div className="band-inner">
          <span className="band-logo">pixmob</span>
          <div className="leds">
            <i />
            <i />
          </div>
        </div>
        <div className="band-screw one" />
        <div className="band-screw two" />
      </div>
    </div>
  );
}
function Spectrum({ frame }: { frame: AudioFrame }) {
  return (
    <div className="spectrum">
      <div className="spectrum-grid" />
      <div className="bars">
        {frame.bins.map((v, i) => (
          <i
            key={i}
            style={{
              height: `${Math.max(3, v * 100)}%`,
              opacity: 0.4 + v * 0.6,
            }}
          />
        ))}
      </div>
      <div className="spectrum-labels">
        <span>30 Hz</span>
        <span>250 Hz</span>
        <span>1 kHz</span>
        <span>4 kHz</span>
        <span>16 kHz</span>
      </div>
    </div>
  );
}
export default function App() {
  const [lighting, setLighting] = useState<Lighting>(initialLighting),
    [mode, setMode] = useState<"simple" | "advanced">("simple"),
    [page, setPage] = useState("studio"),
    [running, setRunning] = useState(true),
    [elapsed, setElapsed] = useState(0),
    [menu, setMenu] = useState(false);
  const [audioSource, setAudioSource] = useState<
      "demo" | "microphone" | "system" | "esp32"
    >("demo"),
    [audioActive, setAudioActive] = useState(false),
    [audioBusy, setAudioBusy] = useState(false),
    [sensitivity, setSensitivity] = useState(60),
    [frame, setFrame] = useState<AudioFrame>(silentFrame);
  const [automaticSensitivity, setAutomaticSensitivity] = useState(() => {
    try {
      return localStorage.getItem("pixmob-auto-sensitivity") !== "manual";
    } catch {
      return true;
    }
  });
  const engine = useRef(new AudioEngine()),
    clock = useRef(0),
    [hex, setHex] = useState(lighting.color),
    [toast, setToast] = useState(""),
    [help, setHelp] = useState(false),
    [connectionOpen, setConnectionOpen] = useState(false),
    [address, setAddress] = useState("http://192.168.4.1"),
    [transport, setTransport] = useState<DeviceTransport | null>(null),
    [deviceStatus, setDeviceStatus] = useState<Status | null>(null),
    [busy, setBusy] = useState(false);
  const [serialProtocol, setSerialProtocol] = useState<
    "preset" | "studio" | "v2"
  >("preset");
  const [followDevice, setFollowDevice] = useState(true);
  const [connectionError, setConnectionError] = useState("");
  const [connectionKind, setConnectionKind] = useState<
    "serial" | "wifi" | null
  >(null);
  const [musicInput, setMusicInput] = useState<"browser" | "microphone">(
    "browser",
  );
  const presetConnected =
    deviceStatus?.mode === "preset-serial" ||
    deviceStatus?.mode === "v2-serial";
  const v2Connected = deviceStatus?.mode === "v2-serial";
  const deviceMusicActive =
    !!deviceStatus?.deviceMode &&
    ["music", "level", "beat", "host"].includes(deviceStatus.deviceMode);
  const usbConnected =
    connectionKind === "serial" ||
    presetConnected ||
    deviceStatus?.mode === "microphone-test";
  const previewAudio = useRef(1);
  const hardwareAudio = useRef<DeviceAudio | null>(null);
  const hardwareBeatAt = useRef(0);
  const hardwareMode = useRef<Status["deviceMode"]>(undefined);
  const browserBeatOutput = useRef<BrowserBeatOutput | null>(null);
  // Reads the shared tab's picture for beats that follow the video colors.
  const screenSampler = useRef<ReturnType<
    typeof createScreenColorSampler
  > | null>(null);
  const browserStartGeneration = useRef(0);
  const songOutput = useRef<SongCueOutput | null>(null);
  const songStartGeneration = useRef(0);
  const liveTransport = useRef(transport);
  liveTransport.current = transport;
  const devicePreviewFrame = useRef({ color: "#ffffff", intensity: 0 });
  const [hardwareSample, setHardwareSample] = useState<DeviceAudio | null>(
    null,
  );
  const [scenes, setScenes] = useState<Scene[]>(() => {
      try {
        const v = JSON.parse(localStorage.getItem("pixmob-scenes") || "[]");
        return Array.isArray(v)
          ? v.filter(
              (s: any) =>
                typeof s.name === "string" &&
                typeof s.id === "string" &&
                validLighting(s.lighting),
            )
          : [];
      } catch {
        return [];
      }
    }),
    [sceneName, setSceneName] = useState(""),
    [sceneDialog, setSceneDialog] = useState(false),
    [selectedScene, setSelectedScene] = useState("lime");
  const [irText, setIrText] = useState(""),
    [carrier, setCarrier] = useState(""),
    [duty, setDuty] = useState(33),
    [repeats, setRepeats] = useState(1),
    [gap, setGap] = useState(10000),
    [verified, setVerified] = useState(false),
    [standalone, setStandalone] = useState(false);
  const update = (patch: Partial<Lighting>) => {
    setLighting((s) => ({ ...s, ...patch }));
    setSelectedScene("");
    if (presetConnected && followDevice) {
      setFollowDevice(false);
      setToast(
        "Simulator preview selected. Use Follow ESP32 events to see the real device beat pulses.",
      );
    }
  };
  useEffect(() => setHex(lighting.color), [lighting.color]);
  useEffect(() => {
    if (!connectionOpen && !sceneDialog && !help) return;
    const prior = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const selector =
      "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]";
    const focusable = () =>
      Array.from(dialog?.querySelectorAll<HTMLElement>(selector) || []).filter(
        (el) => el.offsetParent !== null,
      );
    (
      dialog?.querySelector<HTMLElement>("[autofocus]") || focusable()[0]
    )?.focus();
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        setConnectionOpen(false);
        setSceneDialog(false);
        setHelp(false);
      }
      if (e.key === "Tab") {
        const els = focusable(),
          first = els[0],
          last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = before;
      document.removeEventListener("keydown", onKey);
      prior?.focus();
    };
  }, [connectionOpen, sceneDialog, help, busy]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 6000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    let id: number,
      last = performance.now(),
      draw = 0;
    const tick = (now: number) => {
      if (now - draw < 33) {
        id = requestAnimationFrame(tick);
        return;
      }
      draw = now;
      if (running) clock.current += (now - last) / 1000;
      last = now;
      setElapsed(clock.current);
      const nextFrame =
        audioSource === "demo"
          ? demoAudio(clock.current, sensitivity)
          : audioSource === "esp32"
            ? {
                ...silentFrame,
                beat: Date.now() - hardwareBeatAt.current < 200,
                level:
                  hardwareAudio.current &&
                  Date.now() - hardwareAudio.current.receivedAt < 2000
                    ? Math.min(
                        1,
                        hardwareAudio.current.level * (4 + sensitivity * 0.6),
                      )
                    : 0,
              }
            : audioActive
              ? engine.current.read(now, sensitivity, automaticSensitivity)
              : silentFrame;
      setFrame(nextFrame);
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [running, audioSource, audioActive, sensitivity, automaticSensitivity]);
  useEffect(() => {
    if (
      !transport ||
      deviceStatus?.deviceMode !== "host" ||
      audioSource !== "system" ||
      !audioActive
    )
      return;
    const output = new BrowserBeatOutput(transport, (error) => {
      setToast(`Browser beat output stopped: ${error.message}`);
      void transport.command("stop").catch(() => {});
    });
    output.enable();
    browserBeatOutput.current = output;
    const unsubscribeFrames = engine.current.subscribeFrames(
      (measuredFrame) => {
        output.process(measuredFrame, performance.now(), {
          source: "system",
          active: true,
        });
      },
    );
    return () => {
      unsubscribeFrames();
      output.disable();
      if (browserBeatOutput.current === output)
        browserBeatOutput.current = null;
    };
  }, [transport, deviceStatus?.deviceMode, audioSource, audioActive]);
  useEffect(
    () => () => {
      ++songStartGeneration.current;
      songOutput.current?.disable();
      songOutput.current = null;
      void engine.current.stop();
    },
    [],
  );
  useEffect(() => {
    if (!transport) return;
    let cancelled = false;
    const unsubscribe = transport.subscribeAudio?.((sample) => {
      hardwareAudio.current = sample;
      if (sample.beat) hardwareBeatAt.current = sample.receivedAt;
      setHardwareSample(sample);
    });
    const unsubscribeStatus = transport.subscribeStatus?.((status) => {
      if (status.lastError) {
        setDeviceStatus(null);
        setTransport(null);
        setConnectionKind(null);
        hardwareAudio.current = null;
        setToast(status.lastError);
      } else {
        setDeviceStatus(status);
        if (status.deviceMode !== hardwareMode.current) {
          hardwareBeatAt.current = 0;
          hardwareMode.current = status.deviceMode;
        }
        if (status.lastBeatAt !== undefined)
          hardwareBeatAt.current = status.lastBeatAt;
        if (!status.micAvailable) {
          hardwareAudio.current = null;
          if (status.deviceMode !== "host" && status.deviceMode !== "music")
            hardwareBeatAt.current = 0;
          setHardwareSample(null);
        }
      }
    });
    const check = async () => {
      try {
        const s = await transport.status();
        if (!cancelled) {
          setDeviceStatus(s);
          setStandalone(s.standaloneEnabled ?? false);
        }
      } catch {
        if (!cancelled) {
          setDeviceStatus(null);
          setTransport(null);
          setConnectionKind(null);
          hardwareAudio.current = null;
          setToast("Device connection lost. Preview remains available.");
        }
      }
    };
    const id = setInterval(() => void check(), 5000);
    return () => {
      cancelled = true;
      ++songStartGeneration.current;
      songOutput.current?.disable();
      songOutput.current = null;
      clearInterval(id);
      unsubscribe?.();
      unsubscribeStatus?.();
      hardwareAudio.current = null;
      hardwareBeatAt.current = 0;
      hardwareMode.current = undefined;
      void transport.close().catch(() => {});
    };
  }, [transport]);
  // While a song show plays to the ESP32, one ignored byte a second keeps
  // the board from going back to its idle rainbow between cues.
  useEffect(() => {
    if (!transport?.keepAlive) return;
    const id = setInterval(() => {
      if (songOutput.current?.active) transport.keepAlive?.();
    }, 1000);
    return () => clearInterval(id);
  }, [transport]);
  async function changeSource(value: typeof audioSource) {
    browserStartGeneration.current++;
    browserBeatOutput.current?.disable();
    if (deviceStatus?.deviceMode === "host")
      await transport?.command("stop").catch(() => {});
    await engine.current.stop();
    setAudioActive(false);
    setAudioSource(value);
    setFrame(silentFrame);
  }
  async function stopSongHardware() {
    ++songStartGeneration.current;
    const output = songOutput.current;
    songOutput.current = null;
    if (output) await output.stop();
  }
  async function prepareSongHardware() {
    if (!transport || deviceStatus?.mode !== "preset-serial")
      throw new Error("Connect a preset controller to send song cue colors.");
    const generation = ++songStartGeneration.current;
    const selectedTransport = transport;
    const previous = songOutput.current;
    songOutput.current = null;
    const current = () =>
      generation === songStartGeneration.current &&
      selectedTransport === liveTransport.current;
    if (previous) await previous.stop();
    if (!current())
      throw new DOMException("Song output cancelled.", "AbortError");
    ++browserStartGeneration.current;
    browserBeatOutput.current?.disable();
    await engine.current.stop();
    if (!current())
      throw new DOMException("Song output cancelled.", "AbortError");
    setAudioActive(false);
    await selectedTransport.command("stop");
    if (!current())
      throw new DOMException("Song output cancelled.", "AbortError");
    const output = new SongCueOutput(selectedTransport, (error) => {
      setToast(`Song cue output stopped: ${error.message}`);
    });
    output.enable();
    songOutput.current = output;
    const status = await selectedTransport.status();
    if (!current()) {
      output.disable();
      throw new DOMException("Song output cancelled.", "AbortError");
    }
    setDeviceStatus(status);
  }
  async function sendSongHardwareCue(
    color: SongHardwareColor,
    holdMs?: number,
    strobe?: SongStrobe,
    extras?: SongCueExtras,
  ) {
    // Firmware without the timed light command gets the quick flash instead,
    // and firmware without the strobe commands gets the timed light.
    const timed = holdMs !== undefined && deviceStatus?.timedLightSupported;
    // A rainbow on firmware without the command becomes a steady light in
    // the cue's own color.
    const rainbow =
      timed && deviceStatus?.rainbowSupported ? extras?.rainbowMs : undefined;
    // IR only / RF only for one cue needs firmware that reports it; older
    // firmware sends the cue by whatever the board is set to.
    const output =
      deviceStatus?.lightOutputSupported && extras?.output !== undefined
        ? { output: extras.output }
        : {};
    if (rainbow !== undefined)
      return (
        songOutput.current?.send(color, holdMs, undefined, {
          rainbowMs: rainbow,
          ...output,
        }) ?? false
      );
    return (
      songOutput.current?.send(
        color,
        timed ? holdMs : undefined,
        timed && deviceStatus?.strobeSupported ? strobe : undefined,
        // Custom colors and fades need their own capability; without it the
        // cue keeps its preset color and plain light.
        deviceStatus?.customLightSupported
          ? {
              levels: extras?.levels,
              ...(timed && !strobe
                ? { fadeInMs: extras?.fadeInMs, fadeOutMs: extras?.fadeOutMs }
                : {}),
              ...output,
            }
          : undefined,
      ) ?? false
    );
  }
  async function startAudio() {
    setAudioBusy(true);
    try {
      if (audioActive) {
        browserBeatOutput.current?.disable();
        if (deviceStatus?.deviceMode === "host")
          await transport?.command("stop").catch(() => {});
        await engine.current.stop();
        setAudioActive(false);
      } else {
        engine.current.configureAnalysis(sensitivity, automaticSensitivity);
        await engine.current.start(
          audioSource === "system" ? "system" : "microphone",
          () => {
            setAudioActive(false);
            void engine.current.stop();
            setToast("Audio sharing ended.");
          },
        );
        setAudioActive(true);
      }
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setAudioBusy(false);
    }
  }
  async function startBrowserSync() {
    if (!transport || !deviceStatus?.browserBeatSupported || busy || audioBusy)
      return;
    setBusy(true);
    setAudioBusy(true);
    const generation = ++browserStartGeneration.current;
    browserBeatOutput.current?.disable();
    const selectedTransport = transport;
    try {
      await stopSongHardware();
      await selectedTransport.command("stop");
      if (generation !== browserStartGeneration.current) return;
      engine.current.configureAnalysis(sensitivity, automaticSensitivity);
      await engine.current.start("system", () => {
        if (generation !== browserStartGeneration.current) return;
        browserStartGeneration.current++;
        browserBeatOutput.current?.disable();
        setAudioActive(false);
        void engine.current.stop();
        void selectedTransport.command("stop").catch(() => {});
        setToast("Audio sharing ended. Browser beat output stopped.");
      });
      if (generation !== browserStartGeneration.current) return;
      screenSampler.current?.stop();
      screenSampler.current = createScreenColorSampler(
        engine.current.sharedStream,
      );
      setBrowserBeatScreenSource(screenSampler.current);
      await selectedTransport.command("browser");
      if (generation !== browserStartGeneration.current) {
        await selectedTransport.command("stop").catch(() => {});
        return;
      }
      setDeviceStatus(await selectedTransport.status());
      setAudioSource("system");
      setMusicInput("browser");
      setAudioActive(true);
      setMode("advanced");
      setPage("studio");
      setFollowDevice(true);
      setToast(
        "Browser song audio controls the wristband. The ESP32 microphone does not trigger this mode.",
      );
    } catch (error) {
      if (generation === browserStartGeneration.current) {
        await engine.current.stop();
        setAudioActive(false);
        setToast((error as Error).message);
      }
    } finally {
      setBusy(false);
      setAudioBusy(false);
    }
  }
  async function connect(kind: "wifi" | "serial") {
    setBusy(true);
    setConnectionError("");
    let t: DeviceTransport | null = null;
    try {
      if (kind === "wifi") t = new HttpTransport(address);
      else {
        const s =
          serialProtocol === "preset"
            ? new PresetSerialTransport()
            : serialProtocol === "v2"
              ? new V2SerialTransport()
              : new SerialTransport();
        await s.open();
        t = s;
      }
      const status = await t.status();
      if (!status.name || typeof status.irConfigured !== "boolean")
        throw new Error("This device does not speak the PixMob Studio API.");
      await transport?.close();
      setTransport(t);
      setConnectionKind(kind);
      setDeviceStatus(status);
      setStandalone(status.standaloneEnabled ?? false);
      setConnectionOpen(false);
      if (status.mode === "preset-serial" || status.mode === "v2-serial") {
        await engine.current.stop();
        setAudioActive(false);
        setAudioSource("esp32");
        setPage("studio");
        setFollowDevice(true);
        setToast(
          status.mode === "v2-serial"
            ? "Wi-Fi V2 controller connected over USB. Live microphone and color status are available."
            : "Preset controller connected. Auto / Music stopped on connection. Choose a preset or start ESP32 music sync.",
        );
      } else if (
        kind === "serial" &&
        (status.mode === "microphone-test" ||
          status.micInitialized ||
          status.micAvailable)
      ) {
        await engine.current.stop();
        setAudioActive(false);
        setAudioSource("esp32");
        setMode("advanced");
        setPage("studio");
        setToast(
          status.mode === "microphone-test"
            ? "ESP32 USB microphone connected. Live level is available; enable Music Sync to drive the preview."
            : "ESP32 controller connected. Live microphone RMS is available; IR output requires a verified waveform.",
        );
      } else
        setToast(
          "Device connected. Lighting stays in preview until a verified protocol encoder is added.",
        );
    } catch (e) {
      await t?.close().catch(() => {});
      setConnectionError((e as Error).message);
      setToast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function disconnect() {
    await stopSongHardware().catch(() => {});
    browserStartGeneration.current++;
    browserBeatOutput.current?.disable();
    if (deviceStatus?.deviceMode === "host" || audioBusy) {
      await transport?.command("stop").catch(() => {});
    }
    await engine.current.stop();
    setAudioActive(false);
    await transport?.close().catch(() => {});
    setTransport(null);
    setConnectionKind(null);
    setDeviceStatus(null);
    setStandalone(false);
    setHardwareSample(null);
    hardwareAudio.current = null;
    hardwareBeatAt.current = 0;
    if (audioSource === "esp32") setAudioSource("demo");
  }
  async function presetCommand(op: string, payload?: unknown) {
    if (!transport || !presetConnected || busy) return;
    setBusy(true);
    // Sensitivity and the beat look can change while a sync mode keeps running.
    const keepsMode = [
      "sensitivity",
      "beatStyle",
      "beatPalette",
      "idleRainbow",
      "rf",
      "rfWake",
      "rfSleep",
    ].includes(op);
    if (!keepsMode) browserBeatOutput.current?.disable();
    try {
      if (op === "music") {
        browserStartGeneration.current++;
        await engine.current.stop();
        setAudioActive(false);
        setAudioSource("esp32");
        setFrame(silentFrame);
        setMusicInput("microphone");
      }
      await transport.command(op, payload);
      setDeviceStatus(await transport.status());
      setFollowDevice(true);
      setToast(
        op === "stop"
          ? "ESP32 stopped the sequence. The last wristband color may stay on."
          : op === "music"
            ? "ESP32 music sync started. Play music near the INMP441 microphone."
            : op === "preset"
              ? "ESP32 accepted the preset. Check your wristband for reception."
              : op === "light"
                ? "ESP32 started the timed light. Check your wristband."
                : op === "strobe"
                  ? "ESP32 started the strobe. Check your wristband."
                  : op === "custom"
                    ? "ESP32 sent the custom light. Check your wristband."
                    : op === "rainbow"
                      ? "ESP32 started the rainbow. Check your wristband."
                : op === "auto"
                  ? "ESP32 automatic color sequence started."
                  : op === "beatStyle" || op === "beatPalette"
                    ? "Beat look updated on the ESP32."
                    : op === "idleRainbow"
                      ? "Rainbow setting saved on the ESP32."
                    : op === "rf"
                      ? "RF setting saved on the ESP32."
                    : op === "rfWake"
                      ? "Wake started: the ESP32 calls RF wristbands for 35 s. They stay dark until you send a light."
                    : op === "rfSleep"
                      ? "RF sleep setting saved on the ESP32."
                    : "Microphone sensitivity confirmed by ESP32.",
      );
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function sendIR() {
    if (!transport || !verified) return;
    setBusy(true);
    try {
      const config: IRConfig = {
        carrierHz: Number(carrier),
        dutyPercent: duty,
        repeats,
        gapUs: gap,
        markFirst: true,
        durations: irText
          .split(/[\s,]+/)
          .filter(Boolean)
          .map(Number),
      };
      validateIR(config);
      await transport.command("ir/config", config);
      await transport.command("ir/send", {});
      setDeviceStatus(await transport.status());
      setToast(
        "Waveform queued by device. Wristband reception is not confirmed.",
      );
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function stopOutput() {
    if (!transport) return;
    setBusy(true);
    try {
      await transport.command("ir/stop", {});
      setStandalone(false);
      setDeviceStatus(await transport.status());
      setToast("Pending output stopped. A frame already in flight may finish.");
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function toggleStandalone() {
    if (!transport) return;
    setBusy(true);
    try {
      await transport.command("standalone", {
        enabled: !standalone,
        sensitivity: sensitivity / 100,
      });
      const status = await transport.status();
      setDeviceStatus(status);
      setStandalone(status.standaloneEnabled ?? !standalone);
      setToast(
        "Standalone mode updated. It repeats the configured raw waveform on microphone peaks.",
      );
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function saveScene() {
    const name = sceneName.trim();
    if (!name) return;
    try {
      const next = [
        ...scenes,
        {
          id:
            globalThis.crypto?.randomUUID?.() ??
            `scene-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name,
          lighting: { ...lighting },
        },
      ];
      localStorage.setItem("pixmob-scenes", JSON.stringify(next));
      setScenes(next);
      setSceneDialog(false);
      setSceneName("");
      setToast("Scene saved on this browser.");
    } catch {
      setToast("Browser storage is unavailable. Scene was not saved.");
    }
  }
  function loadScene(scene: Scene) {
    setLighting({ ...scene.lighting });
    if (presetConnected) setFollowDevice(false);
    setSelectedScene(scene.id);
    setToast(`${scene.name} loaded.`);
  }
  function exportScenes() {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([JSON.stringify(scenes, null, 2)], { type: "application/json" }),
    );
    a.download = "pixmob-scenes.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  if (running) previewAudio.current = frame.level;
  const devicePreview = presetConnected && followDevice;
  if (running)
    devicePreviewFrame.current = {
      color: deviceStatus?.lastColor
        ? presetLook(deviceStatus.lastColor, deviceStatus).hex
        : "#ffffff",
      intensity: deviceStatus?.lastColor
        ? deviceMusicActive
          ? deviceStatus.mode === "preset-serial"
            ? deviceBeatPulse(
                Date.now(),
                hardwareBeatAt.current,
                deviceStatus.deviceMode === "host"
                  ? frame.level
                  : (hardwareAudio.current?.level ?? 0),
                4 + sensitivity * 0.6,
              )
            : 0.08 +
              0.92 *
                (hardwareAudio.current &&
                Date.now() - hardwareAudio.current.receivedAt < 2000
                  ? Math.min(
                      1,
                      hardwareAudio.current.level * (4 + sensitivity * 0.6),
                    )
                  : 0)
          : 0.9
        : 0,
    };
  const rendered = devicePreview
      ? devicePreviewFrame.current
      : sampleEffect(lighting, elapsed, previewAudio.current),
    rgb = hexRGB(lighting.color);
  const nav = (key: string) => {
    setPage(key);
    setMenu(false);
  };
  const sceneCards = (all: boolean) => (
    <div className="scene-grid">
      {[...builtInScenes, ...scenes].map((scene) => (
        <button
          className={cx("scene-card", selectedScene === scene.id && "selected")}
          key={scene.id}
          onClick={() => loadScene(scene)}
        >
          <div
            className="scene-art"
            style={{ "--scene": scene.lighting.color } as CSSProperties}
          >
            <div className="scene-rays" />
            <div className="scene-orbs">
              {Array.from({ length: 22 }, (_, i) => (
                <i
                  key={i}
                  style={{
                    left: `${(i * 37) % 100}%`,
                    top: `${35 + ((i * 19) % 58)}%`,
                    opacity: 0.3 + (i % 5) * 0.15,
                  }}
                />
              ))}
            </div>
            <span className="scene-type">{scene.lighting.effect}</span>
            {selectedScene === scene.id && (
              <span className="scene-check">
                <Check size={12} />
              </span>
            )}
          </div>
          <div className="scene-name">
            {scene.name}
            <ChevronRight size={14} />
          </div>
          {all && (
            <small>
              {scene.lighting.brightness}% brightness · {scene.lighting.profile}
            </small>
          )}
        </button>
      ))}
    </div>
  );
  return (
    <div className="app-shell">
      <aside className={cx("sidebar", menu && "mobile-open")}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            nav("studio");
          }}
        >
          <span className="brand-icon">
            <AudioLines size={25} />
          </span>
          <span>
            pixmob<span className="brand-studio">STUDIO</span>
          </span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <nav>
          <button
            className={cx(page === "studio" && "active")}
            onClick={() => nav("studio")}
          >
            <SlidersHorizontal size={18} />
            Lighting studio
            <span className="nav-dot" />
          </button>
          <button
            className={cx(page === "songs" && "active")}
            onClick={() => nav("songs")}
          >
            <Music2 size={18} />
            Song shows
          </button>
          <button
            className={cx(page === "scenes" && "active")}
            onClick={() => nav("scenes")}
          >
            <LayoutGrid size={18} />
            Scene library
            <span className="count">
              {builtInScenes.length + scenes.length}
            </span>
          </button>
          <button
            className={cx(page === "devices" && "active")}
            onClick={() => nav("devices")}
          >
            <Radio size={18} />
            Devices
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="local-card">
            <span className="local-orb">
              <Wifi size={18} />
            </span>
            <strong>Made to stay local</strong>
            <p>
              Your studio. Your network.
              <br />
              No cloud required.
            </p>
            <span className="local-tag">
              <i /> LOCAL WORKSPACE
            </span>
          </div>
          <button className="help-link" onClick={() => setHelp(true)}>
            <CircleHelp size={17} />
            Setup & documentation
            <ChevronRight size={14} />
          </button>
          <div className="version">
            <span className="version-logo">P</span>PixMob Studio
            <span>v1.0.0</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="mobile-menu icon-button"
              aria-label="Toggle menu"
              onClick={() => setMenu(!menu)}
            >
              <Menu size={20} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>
              {page === "studio"
                ? "Lighting studio"
                : page === "songs"
                  ? "Song shows"
                  : page === "scenes"
                    ? "Scene library"
                    : "Devices"}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="sim-badge">
              <i />
              {deviceStatus
                ? usbConnected
                  ? "ESP32 USB connected"
                  : "ESP32 Wi-Fi connected"
                : "Simulator active"}
            </span>
            <button
              className="icon-button"
              aria-label="Help"
              onClick={() => setHelp(true)}
            >
              <CircleHelp size={18} />
            </button>
            <span className="avatar">PM</span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">LET THERE BE LIGHT</div>
              <h1>
                {page === "studio"
                  ? "Your crowd. Your colors."
                  : page === "songs"
                    ? "Your song. Your show."
                    : page === "scenes"
                      ? "Set the scene."
                      : "Connect your rig."}
              </h1>
              <p>
                {page === "studio"
                  ? "Turn a moment into a light show. Make it yours."
                  : page === "songs"
                    ? "Compose the moments. Switch back to free rhythm whenever you like."
                    : page === "scenes"
                      ? "Your favorite looks, ready for the next moment."
                      : "Start in simulation. Bring your hardware in when you’re ready."}
              </p>
            </div>
            <button
              className="button secondary connect-button"
              onClick={() => setConnectionOpen(true)}
            >
              <Usb size={16} />
              {deviceStatus ? "Device connected" : "Connect device"}
              <ChevronRight size={15} />
            </button>
          </div>
          {page === "studio" && (
            <>
              <div className="studio-toolbar">
                <div className="mode-tabs">
                  <button
                    aria-pressed={mode === "simple"}
                    className={cx(mode === "simple" && "active")}
                    onClick={() => setMode("simple")}
                  >
                    <Sun size={16} />
                    Simple mode
                  </button>
                  <button
                    aria-pressed={mode === "advanced"}
                    className={cx(mode === "advanced" && "active")}
                    onClick={() => setMode("advanced")}
                  >
                    <AudioLines size={17} />
                    Advanced DJ<span className="pro-tag">AUDIO</span>
                  </button>
                </div>
                <span className="toolbar-note">
                  <span className="tiny-dot" />
                  Preview in real time
                </span>
              </div>
              {presetConnected && (
                <PresetControls
                  onBrowserSync={() => void startBrowserSync()}
                  status={deviceStatus}
                  busy={busy}
                  onCommand={presetCommand}
                />
              )}
              <div className="studio-grid">
                <section className="panel controls">
                  <div className="panel-heading">
                    <h2>
                      <SlidersHorizontal size={16} />
                      Light controls
                    </h2>
                    <button
                      className="icon-button"
                      aria-label="Reset lighting"
                      onClick={() => {
                        setLighting(initialLighting);
                        setSelectedScene("lime");
                      }}
                    >
                      <RotateCcw size={15} />
                    </button>
                  </div>
                  <div className="control-body">
                    <div className="label-row">
                      <label htmlFor="profile">Wristband profile</label>
                      <span className="small-tag">PREVIEW</span>
                    </div>
                    <div className="select-wrap">
                      <Disc3 size={17} />
                      <select
                        id="profile"
                        value={lighting.profile}
                        onChange={(e) =>
                          update({
                            profile: e.target.value as Lighting["profile"],
                          })
                        }
                      >
                        <option>Taylor Swift</option>
                        <option>The Weeknd</option>
                      </select>
                      <ChevronDown size={15} />
                    </div>
                    <div className="section-label">
                      Color<span>RGB / HEX</span>
                    </div>
                    {presetConnected && (
                      <p className="compat-note">
                        These color, effect, brightness and speed controls shape
                        the simulator. Use ESP32 live control above to send a
                        hardware preset.
                      </p>
                    )}
                    <ColorPicker
                      color={lighting.color}
                      onChange={(color) => update({ color })}
                    />
                    <div className="color-values">
                      <label className="hex-value">
                        <span>HEX</span>
                        <input
                          aria-label="HEX color"
                          value={hex.toUpperCase()}
                          maxLength={7}
                          onChange={(e) => {
                            setHex(e.target.value);
                            if (/^#[0-9a-f]{6}$/i.test(e.target.value))
                              update({ color: e.target.value });
                          }}
                          onBlur={() => {
                            if (!/^#[0-9a-f]{6}$/i.test(hex)) {
                              setHex(lighting.color);
                              setToast(
                                "Enter a six-digit HEX color, such as #B8FA5A.",
                              );
                            }
                          }}
                        />
                      </label>
                      {rgb.map((v, i) => (
                        <label key={i}>
                          <span>{["R", "G", "B"][i]}</span>
                          <input
                            aria-label={`${["Red", "Green", "Blue"][i]} value`}
                            type="number"
                            min="0"
                            max="255"
                            value={v}
                            onChange={(e) => {
                              const next = [...rgb];
                              next[i] = +e.target.value;
                              update({ color: rgbHex(next) });
                            }}
                          />
                        </label>
                      ))}
                    </div>
                    <div className="swatches">
                      {[
                        "#b8fa5a",
                        "#6ee7f0",
                        "#6c91ff",
                        "#b487ff",
                        "#fc80c7",
                        "#ff715b",
                        "#ffcf63",
                        "#ffffff",
                      ].map((c) => (
                        <button
                          key={c}
                          aria-label={`Set color ${c}`}
                          className={cx(
                            lighting.color.toLowerCase() === c && "selected",
                          )}
                          onClick={() => update({ color: c })}
                          style={{ background: c }}
                        />
                      ))}
                    </div>
                    <div className="divider" />
                    <div className="section-label">Lighting effect</div>
                    <div className="effect-grid">
                      {effects.map((effect, i) => {
                        const Icon = [Sun, Zap, Waves, Activity, Sparkles][i];
                        return (
                          <button
                            key={effect}
                            aria-pressed={lighting.effect === effect}
                            className={cx(
                              lighting.effect === effect && "active",
                            )}
                            onClick={() => update({ effect })}
                          >
                            <Icon size={18} />
                            <span>{effect}</span>
                          </button>
                        );
                      })}
                    </div>
                    {lighting.effect === "Strobe" && (
                      <p className="strobe-note">
                        Flashing preview · capped at 3 Hz. Use Fade if sensitive
                        to flashing light.
                      </p>
                    )}
                    <Slider
                      label="Brightness"
                      value={lighting.brightness}
                      onChange={(brightness) => update({ brightness })}
                      icon={<Sun size={15} />}
                    />
                    <Slider
                      label="Speed"
                      value={lighting.speed}
                      onChange={(speed) => update({ speed })}
                      icon={<Activity size={15} />}
                    />
                    <div
                      className={cx(
                        "music-toggle",
                        (presetConnected
                          ? deviceMusicActive
                          : lighting.musicSync) && "enabled",
                      )}
                    >
                      <span className="music-icon">
                        <Music2 size={19} />
                      </span>
                      <div>
                        <strong>
                          {presetConnected
                            ? musicInput === "browser" &&
                              deviceStatus.browserBeatSupported
                              ? "Browser song sync"
                              : "ESP32 microphone sync"
                            : "Preview music sync"}
                        </strong>
                        <p>
                          {presetConnected
                            ? musicInput === "browser" &&
                              deviceStatus.browserBeatSupported
                              ? "Song beats drive your ESP32"
                              : "Control the ESP32 microphone mode"
                            : audioSource === "demo"
                              ? "Follow the demo beat"
                              : "Follow your audio input"}
                        </p>
                      </div>
                      <button
                        role="switch"
                        aria-checked={
                          presetConnected
                            ? deviceMusicActive
                            : lighting.musicSync
                        }
                        aria-label={
                          presetConnected
                            ? musicInput === "browser" &&
                              deviceStatus.browserBeatSupported
                              ? "Browser song sync"
                              : "ESP32 microphone sync"
                            : "Preview music sync"
                        }
                        className="toggle"
                        disabled={busy}
                        onClick={() =>
                          presetConnected
                            ? deviceMusicActive
                              ? void presetCommand("stop")
                              : musicInput === "browser" &&
                                  deviceStatus.browserBeatSupported
                                ? void startBrowserSync()
                                : void presetCommand("music")
                            : update({ musicSync: !lighting.musicSync })
                        }
                      >
                        <i />
                      </button>
                    </div>
                  </div>
                </section>
                <div className="right-stack">
                  <section className="panel preview-panel">
                    <div className="panel-heading">
                      <h2>
                        <Lightbulb size={17} />
                        Live preview
                      </h2>
                      <span className="live-label">
                        <i />
                        {running
                          ? devicePreview
                            ? deviceStatus.mode === "preset-serial" &&
                              deviceMusicActive
                              ? "ESP32 BEATS"
                              : "ESP32 LIVE"
                            : "SIMULATOR"
                          : "PAUSED"}
                      </span>
                    </div>
                    <div className="preview-stage">
                      <div className="stage-grid" />
                      <span className="stage-caption">
                        {lighting.profile === "Taylor Swift"
                          ? "THE ERAS TOUR"
                          : "AFTER HOURS TIL DAWN"}
                        <small>
                          {devicePreview
                            ? "ESP32 EVENTS · SIMULATED LIGHT"
                            : "WRISTBAND SIMULATOR"}
                        </small>
                      </span>
                      <div
                        className="stage-glow"
                        style={{
                          background: rendered.color,
                          opacity: rendered.intensity * 0.16,
                        }}
                      />
                      <Wristband
                        color={rendered.color}
                        intensity={rendered.intensity}
                        profile={lighting.profile}
                      />
                      <div className="preview-bottom">
                        <span>
                          <i style={{ background: rendered.color }} />
                          {devicePreview
                            ? deviceStatus.lastColor
                              ? `${presetLook(deviceStatus.lastColor, deviceStatus).name} · ${deviceStatus.deviceMode}`
                              : "Waiting for a color command"
                            : `${lighting.effect} · ${lighting.brightness}% brightness`}
                        </span>
                        <button
                          className="preview-play"
                          aria-label={
                            running ? "Pause preview" : "Play preview"
                          }
                          onClick={() => setRunning(!running)}
                        >
                          {running ? <Pause size={14} /> : <Play size={14} />}
                        </button>
                      </div>
                    </div>
                    <div className="preview-footer">
                      {presetConnected ? (
                        <button
                          className="text-button"
                          onClick={() => setFollowDevice(!followDevice)}
                        >
                          {followDevice
                            ? "Switch to simulator"
                            : "Follow ESP32 events"}
                        </button>
                      ) : (
                        <span>
                          <Monitor size={14} />
                          Virtual wristband
                        </span>
                      )}
                      <span>
                        {devicePreview
                          ? "LED diffusion is simulated"
                          : "Visual simulation"}{" "}
                        <CircleHelp size={13} />
                      </span>
                    </div>
                  </section>
                  <section className="panel audio-overview">
                    <div className="panel-heading">
                      <h2>
                        <AudioLines size={17} />
                        {mode === "simple"
                          ? "Feel the rhythm"
                          : "Audio analysis"}
                      </h2>
                      <span className="small-tag">
                        {audioSource === "demo"
                          ? "DEMO AUDIO"
                          : audioSource === "esp32"
                            ? hardwareSample &&
                              Date.now() - hardwareSample.receivedAt < 2000
                              ? "ESP32 USB LIVE"
                              : "WAITING FOR ESP32"
                            : audioActive
                              ? "LIVE INPUT"
                              : "NO INPUT"}
                      </span>
                    </div>
                    <div className="audio-top">
                      <div>
                        <span className="audio-subtitle">
                          {audioSource === "demo"
                            ? "A little rhythm. A lot of possibility."
                            : audioSource === "esp32"
                              ? "INMP441 microphone · live USB readings"
                              : audioActive
                                ? "Listening to your audio input"
                                : "Choose an input to get started"}
                        </span>
                        <div className="bpm">
                          <strong>
                            {audioSource === "esp32"
                              ? hardwareSample &&
                                Date.now() - hardwareSample.receivedAt < 2000
                                ? hardwareSample.format === "rms-normalized"
                                  ? hardwareSample.level.toFixed(4)
                                  : hardwareSample.rawLevel
                                : "—"
                              : (frame.bpm ?? "—")}
                          </strong>
                          <span>
                            {audioSource === "esp32"
                              ? hardwareSample?.format === "rms-24-bit" ||
                                hardwareSample?.format === "rms-normalized"
                                ? "RMS LEVEL"
                                : hardwareSample?.format ===
                                    "bass-envelope-16-bit"
                                  ? "BASS LEVEL"
                                  : "RAW LEVEL"
                              : "BPM"}
                            <small>
                              {audioSource === "demo"
                                ? "DEMO TEMPO"
                                : audioSource === "esp32"
                                  ? hardwareSample?.format === "rms-normalized"
                                    ? "NORMALIZED RMS"
                                    : hardwareSample?.format === "rms-24-bit"
                                      ? "24-BIT RMS"
                                      : hardwareSample?.format ===
                                          "bass-envelope-16-bit"
                                        ? "16-BIT BASS ENVELOPE"
                                        : "16-BIT MEAN ABS"
                                  : "ESTIMATED"}
                            </small>
                          </span>
                        </div>
                      </div>
                      {(audioSource !== "esp32" ||
                        deviceStatus?.mode === "preset-serial") && (
                        <div className="beat-indicators">
                          <span className={cx(frame.beat && "on")}>
                            <i />
                            BEAT
                          </span>
                          {audioSource !== "esp32" && (
                            <span className={cx(frame.drop && "on")}>
                              <i />
                              DROP
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    {audioSource === "esp32" ? (
                      <div className="hardware-level">
                        <div>
                          <span>Music sync preview level</span>
                          <strong>{Math.round(frame.level * 100)}%</strong>
                        </div>
                        <progress max={1} value={frame.level} />
                        {deviceStatus?.mode === "preset-serial" && (
                          <p>
                            Beat pulses come from ESP32 detections. Threshold:{" "}
                            {hardwareSample?.threshold ?? "—"}. Level samples
                            arrive while ESP32 music sync is active.
                            {hardwareSample?.format ===
                              "bass-envelope-16-bit" &&
                              " The detector follows bass onsets. LED pulses begin only on reported beats."}
                          </p>
                        )}
                        {v2Connected && (
                          <p>
                            Live amplitude and completed color frames from your
                            V2 controller. Frames sent:{" "}
                            {deviceStatus.completedFrames ?? 0}.
                            {deviceStatus.clipped
                              ? " Microphone clipping detected."
                              : ""}{" "}
                            Individual beat events are not exposed by this
                            firmware.
                          </p>
                        )}
                        <p>
                          This ESP32 source streams amplitude measurements only.
                          Spectrum, frequency bands, BPM and drop analysis need
                          browser audio or firmware that sends raw audio
                          samples.
                        </p>
                      </div>
                    ) : (
                      <Spectrum frame={frame} />
                    )}
                    {mode === "simple" ? (
                      <div className="audio-footer">
                        <span>Go deeper with audio-reactive lighting.</span>
                        <button onClick={() => setMode("advanced")}>
                          Open DJ mode <ChevronRight size={14} />
                        </button>
                      </div>
                    ) : (
                      <>
                        {audioSource !== "esp32" && (
                          <div className="frequency-bands">
                            {[
                              ["Bass", frame.bass, "30–250 Hz"],
                              ["Mid", frame.mid, "250 Hz–4 kHz"],
                              ["Treble", frame.treble, "4–16 kHz"],
                            ].map(([name, value, range]) => (
                              <div key={String(name)}>
                                <span>
                                  {name}
                                  <b>{Math.round(Number(value) * 100)}%</b>
                                </span>
                                <progress max="1" value={Number(value)} />
                                <small>{range}</small>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="audio-settings">
                          <label htmlFor="audio-source">Audio source</label>
                          <div className="input-action">
                            <select
                              id="audio-source"
                              value={audioSource}
                              disabled={audioBusy}
                              onChange={(e) =>
                                void changeSource(
                                  e.target.value as typeof audioSource,
                                )
                              }
                            >
                              <option value="demo">
                                Demo signal · 120 BPM
                              </option>
                              <option
                                value="esp32"
                                disabled={
                                  !(
                                    usbConnected &&
                                    deviceStatus &&
                                    (presetConnected ||
                                      deviceStatus.mode === "microphone-test" ||
                                      deviceStatus.micInitialized ||
                                      deviceStatus.micAvailable)
                                  )
                                }
                              >
                                ESP32 USB microphone · live level
                              </option>
                              <option value="microphone">Microphone</option>
                              <option value="system">
                                System / browser tab audio
                              </option>
                            </select>
                            {audioSource !== "demo" &&
                              audioSource !== "esp32" && (
                                <button
                                  className="button accent"
                                  disabled={audioBusy}
                                  onClick={() => void startAudio()}
                                >
                                  {audioActive ? (
                                    <Pause size={15} />
                                  ) : (
                                    <Mic size={15} />
                                  )}{" "}
                                  {audioBusy
                                    ? "Starting…"
                                    : audioActive
                                      ? "Stop"
                                      : "Start"}
                                </button>
                              )}
                          </div>
                          <p className="compat-note">
                            {audioSource === "demo"
                              ? "Synthetic signal for testing. No microphone is active."
                              : audioSource === "esp32"
                                ? presetConnected
                                  ? v2Connected
                                    ? "V2 sends live RMS and color status. This slider adjusts visual gain only; use More / Less sensitive above to change the hardware detector. No browser microphone is active."
                                    : "ESP32 Music sends live level and beat events. This slider adjusts visual gain only; use More / Less sensitive above to change the hardware detector. No browser microphone is active."
                                  : deviceStatus?.mode === "microphone-test"
                                    ? "Live data from your existing microphone-test sketch at 115200 baud. Sensitivity adjusts the preview gain. No microphone audio is captured by the browser."
                                    : "Live RMS amplitude from the controller's INMP441 microphone at 115200 baud. Sensitivity adjusts the preview gain. No browser microphone is active."
                                : audioSource === "microphone"
                                  ? "Microphone requires permission and HTTPS or localhost. Mobile browsers may suspend capture when backgrounded."
                                  : "Desktop capture only where supported. Select a tab and enable audio sharing. Whole-system audio varies by browser and OS; iPhone and Android may not offer it."}
                          </p>
                          {deviceStatus?.deviceMode === "host" && (
                            <p className="compat-note">
                              Song beats send one RGB frame to the ESP32.{" "}
                              {engine.current.realtimeAnalysis
                                ? "Drum onsets are detected directly in the audio thread."
                                : "Keep this controller page visible: this browser is using the foreground audio fallback."}{" "}
                              Stopping audio sharing stops new beat commands.
                            </p>
                          )}
                          {audioActive &&
                            engine.current.realtimeAnalysis &&
                            frame.detectedOnsets !== undefined && (
                              <p className="compat-note">
                                Detected onsets: {frame.detectedOnsets} · Latest
                                interval:{" "}
                                {frame.onsetIntervalMs === undefined
                                  ? "—"
                                  : `${frame.onsetIntervalMs} ms`}
                              </p>
                            )}
                          {(audioSource === "system" ||
                            audioSource === "microphone") && (
                            <div
                              className={cx(
                                "audio-adapt",
                                automaticSensitivity && "enabled",
                              )}
                            >
                              <div className="audio-adapt-heading">
                                <div>
                                  <strong>Automatic sensitivity</strong>
                                  <p>
                                    Learns volume and drum contrast as the track
                                    changes.
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  role="switch"
                                  aria-label="Automatic sensitivity"
                                  aria-checked={automaticSensitivity}
                                  className="toggle"
                                  onClick={() => {
                                    const next = !automaticSensitivity;
                                    setAutomaticSensitivity(next);
                                    engine.current.configureAnalysis(
                                      sensitivity,
                                      next,
                                    );
                                    try {
                                      localStorage.setItem(
                                        "pixmob-auto-sensitivity",
                                        next ? "auto" : "manual",
                                      );
                                    } catch {
                                      /* Keep session controls available without storage. */
                                    }
                                  }}
                                >
                                  <i />
                                </button>
                              </div>
                              {automaticSensitivity && (
                                <p className="audio-adapt-status">
                                  <span className="small-tag">
                                    {!audioActive
                                      ? "READY"
                                      : !engine.current.realtimeAnalysis
                                        ? "MANUAL FALLBACK"
                                        : !frame.automaticSensitivity
                                          ? "WARMING UP"
                                          : (frame.tempoConfidence ?? 0) >= 0.6
                                            ? "TRACKING"
                                            : "ADAPTING"}
                                  </span>
                                  {audioActive &&
                                  !engine.current.realtimeAnalysis
                                    ? "Automatic detection needs AudioWorklet support. Use the manual control below."
                                    : "Follows real audio attacks. Pausing music stops new triggers."}
                                </p>
                              )}
                            </div>
                          )}
                          {!(
                            audioSource === "system" ||
                            audioSource === "microphone"
                          ) ||
                          !automaticSensitivity ||
                          (audioActive && !engine.current.realtimeAnalysis) ? (
                            <Slider
                              label="Sensitivity"
                              value={sensitivity}
                              onChange={setSensitivity}
                            />
                          ) : null}
                          {audioSource !== "esp32" && (
                            <p className="compat-note">
                              BPM, beats and drops are heuristic estimates.
                              Drops look for energy returning after a quiet
                              section.
                            </p>
                          )}
                        </div>
                      </>
                    )}
                  </section>
                </div>
              </div>
              <section className="presets">
                <div className="presets-heading">
                  <div>
                    <h2>Instant atmosphere</h2>
                    <p>A starting point for your next great moment.</p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => setSceneDialog(true)}
                  >
                    <Plus size={15} />
                    Save current scene
                  </button>
                </div>
                {sceneCards(false)}
              </section>
              <div className="simulation-note">
                <span>
                  <span className="tiny-dot" />
                  {presetConnected
                    ? "ESP32 presets control hardware. Scene and custom lighting controls are simulated."
                    : "You’re in the simulator. Experiment freely."}
                </span>
                <button onClick={() => nav("devices")}>
                  Ready for the real thing? <ChevronRight size={14} />
                </button>
              </div>
            </>
          )}
          {page === "songs" && (
            <SongShows
              connected={Boolean(
                transport && deviceStatus?.mode === "preset-serial",
              )}
              renderPreview={(preview) => (
                <Wristband
                  color={preview.color}
                  intensity={preview.intensity}
                  profile={preview.profile}
                />
              )}
              whitePreset={deviceStatus?.whitePreset}
              timedLightSupported={deviceStatus?.timedLightSupported}
              strobeSupported={deviceStatus?.strobeSupported}
              customLightSupported={deviceStatus?.customLightSupported}
              rainbowSupported={deviceStatus?.rainbowSupported}
              lightOutputSupported={deviceStatus?.lightOutputSupported}
              prepareHardware={prepareSongHardware}
              sendHardwareCue={sendSongHardwareCue}
              stopHardware={stopSongHardware}
              onFreeRhythm={() => {
                setPage("studio");
                setMode("advanced");
              }}
            />
          )}
          {page === "scenes" && (
            <>
              <div className="library-toolbar">
                <span>
                  {builtInScenes.length + scenes.length} scenes · stored locally
                </span>
                <div>
                  <button className="button secondary" onClick={exportScenes}>
                    <Download size={16} />
                    Export custom scenes
                  </button>
                  <button
                    className="button accent"
                    onClick={() => setSceneDialog(true)}
                  >
                    <Plus size={16} />
                    Save current scene
                  </button>
                </div>
              </div>
              {sceneCards(true)}
              {scenes.length > 0 && (
                <section className="panel manage-scenes">
                  <h2>Manage custom scenes</h2>
                  {scenes.map((s) => (
                    <div key={s.id}>
                      <span>{s.name}</span>
                      <button
                        className="text-button"
                        onClick={() => {
                          const next = scenes.filter((x) => x.id !== s.id);
                          try {
                            localStorage.setItem(
                              "pixmob-scenes",
                              JSON.stringify(next),
                            );
                            setScenes(next);
                          } catch {
                            setToast("Could not update browser storage.");
                          }
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </section>
              )}
            </>
          )}
          {page === "devices" && (
            <div className="device-layout">
              <section className="panel device-card">
                <div className="panel-heading">
                  <h2>
                    <Radio size={17} />
                    Hardware workspace
                  </h2>
                  <span className="small-tag">
                    {deviceStatus ? "CONNECTED" : "OFFLINE"}
                  </span>
                </div>
                <div className="device-body">
                  <div className="device-illustration">
                    <Command size={70} />
                    <span>ESP32</span>
                  </div>
                  <h2>ESP32 DevKit V1</h2>
                  <p>38-pin · CP2102 · Arduino framework</p>
                  {deviceStatus?.mode === "microphone-test" && (
                    <div className="notice">
                      Connected to your microphone-test sketch over USB. Live
                      sound levels are available. Controller commands and IR
                      output require the separate controller firmware.
                    </div>
                  )}
                  {deviceStatus?.mode === "controller" && (
                    <div className="notice">
                      Controller firmware {deviceStatus.firmware} connected.{" "}
                      {deviceStatus.micPins && (
                        <>
                          Microphone SCK {deviceStatus.micPins.bclk}, WS{" "}
                          {deviceStatus.micPins.ws}, SD{" "}
                          {deviceStatus.micPins.data}.{" "}
                        </>
                      )}
                      {deviceStatus.irPin !== undefined && (
                        <>
                          IR output GPIO{deviceStatus.irPin}; verified waveform
                          required.
                        </>
                      )}
                    </div>
                  )}
                  {presetConnected && (
                    <div className="notice">
                      {v2Connected
                        ? "Your Wi-Fi V2 firmware is connected over USB."
                        : "Your preset sketch is connected."}{" "}
                      IR GPIO32 · microphone BCLK26 / WS25 / SD27. Auto and
                      Music run on the ESP32.
                    </div>
                  )}
                  <div className="hardware-row">
                    {usbConnected ? <Usb size={17} /> : <Wifi size={17} />}
                    <span>
                      {usbConnected
                        ? "USB Serial · 115200 baud"
                        : "Local Wi-Fi HTTP API"}
                    </span>
                    <span className={cx("status-pill", deviceStatus && "good")}>
                      {deviceStatus ? "Connected" : "Not connected"}
                    </span>
                  </div>
                  <div className="hardware-row">
                    <Radio size={17} />
                    <span>KY-005 infrared</span>
                    <span className="status-pill">
                      {presetConnected
                        ? "User-supplied presets"
                        : deviceStatus?.mode === "microphone-test"
                          ? "Read-only sketch"
                          : deviceStatus?.irConfigured
                            ? "Waveform loaded"
                            : "Needs protocol"}
                    </span>
                  </div>
                  <div className="hardware-row">
                    <Mic size={17} />
                    <span>INMP441 microphone</span>
                    <span className="status-pill">
                      {!deviceStatus
                        ? "Not connected"
                        : deviceStatus.micAvailable
                          ? "Recent samples"
                          : "No samples"}
                    </span>
                  </div>
                  <div className="hardware-row">
                    <Monitor size={17} />
                    <span>1.44″ SPI TFT</span>
                    <span className="status-pill">Optional adapter</span>
                  </div>
                  <div className="hardware-row">
                    <Bluetooth size={17} />
                    <span>RF transmitter</span>
                    <span className="status-pill">Future interface</span>
                  </div>
                  <div className="device-actions">
                    <button
                      className="button accent"
                      onClick={() => setConnectionOpen(true)}
                    >
                      <Usb size={16} />
                      {deviceStatus ? "Connection settings" : "Connect device"}
                    </button>
                    {transport && (
                      <button
                        className="button secondary"
                        onClick={() => void disconnect()}
                      >
                        Disconnect
                      </button>
                    )}
                  </div>
                  <div className="notice">
                    Artist profiles change the preview only. Your supplied IR
                    presets are available in the preset sketch. Custom HEX,
                    brightness and effects are simulated. RF remains unverified.
                  </div>
                </div>
              </section>
              {presetConnected ? (
                <PresetControls
                  onBrowserSync={() => void startBrowserSync()}
                  status={deviceStatus}
                  busy={busy}
                  onCommand={presetCommand}
                />
              ) : (
                <section className="panel">
                  <div className="panel-heading">
                    <h2>
                      <Settings2 size={17} />
                      IR protocol workbench
                    </h2>
                    <span className="small-tag">EXPERT</span>
                  </div>
                  <div className="device-body">
                    <p className="compat-note">
                      Configure a waveform from your own verified capture.
                      Nothing is transmitted automatically. Values are not
                      supplied because the wristband protocol is unverified.
                    </p>
                    <div className="form-grid">
                      <label>
                        Carrier (Hz)
                        <input
                          type="number"
                          placeholder="From verified capture"
                          value={carrier}
                          onChange={(e) => setCarrier(e.target.value)}
                        />
                      </label>
                      <label>
                        Duty (%)
                        <input
                          type="number"
                          min="10"
                          max="50"
                          value={duty}
                          onChange={(e) => setDuty(+e.target.value)}
                        />
                      </label>
                      <label>
                        Repeats
                        <input
                          type="number"
                          min="1"
                          max="5"
                          value={repeats}
                          onChange={(e) => setRepeats(+e.target.value)}
                        />
                      </label>
                      <label>
                        Repeat gap (µs)
                        <input
                          type="number"
                          min="1000"
                          max="100000"
                          value={gap}
                          onChange={(e) => setGap(+e.target.value)}
                        />
                      </label>
                    </div>
                    <label className="waveform-label">
                      Alternating mark / space durations (µs)
                      <textarea
                        placeholder="Paste measured durations, separated by commas. Starts with a mark."
                        value={irText}
                        onChange={(e) => setIrText(e.target.value)}
                      />
                    </label>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={verified}
                        onChange={(e) => setVerified(e.target.checked)}
                      />
                      I have verified this waveform and my transmitter wiring.
                    </label>
                    <button
                      className="button accent"
                      disabled={
                        !deviceStatus ||
                        deviceStatus.mode === "microphone-test" ||
                        !verified ||
                        busy
                      }
                      onClick={() => void sendIR()}
                    >
                      <Radio size={16} />
                      Configure & transmit waveform
                    </button>
                    <div className="divider" />
                    <button
                      className="button secondary stop-output"
                      disabled={
                        !deviceStatus ||
                        deviceStatus.mode === "microphone-test" ||
                        busy
                      }
                      onClick={() => void stopOutput()}
                    >
                      <Power size={15} />
                      Stop pending output
                    </button>
                    {deviceStatus?.lastError && (
                      <p className="notice">Device: {deviceStatus.lastError}</p>
                    )}
                    <h3>Standalone microphone sync</h3>
                    <p className="compat-note">
                      Repeats the configured waveform on INMP441 energy peaks,
                      without the browser. This does not encode colors or
                      lighting effects.
                    </p>
                    <button
                      className="button secondary"
                      disabled={
                        busy ||
                        !deviceStatus ||
                        (!standalone &&
                          (!deviceStatus.micAvailable ||
                            !verified ||
                            !deviceStatus.irConfigured))
                      }
                      onClick={() => void toggleStandalone()}
                    >
                      <Power size={15} />
                      {standalone
                        ? "Stop standalone sync"
                        : "Enable standalone sync"}
                    </button>
                  </div>
                </section>
              )}
            </div>
          )}
          <footer className="app-footer">
            <span>
              <AudioLines size={13} />
              Designed for the moments you feel.
            </span>
            <span>
              <a
                href="https://github.com/ximloke/pixmob-studio"
                target="_blank"
                rel="noopener noreferrer"
              >
                MIT License · 源码在 GitHub
              </a>
            </span>
            <span>
              LOCAL FIRST <i /> BUILT FOR LIGHT
            </span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {connectionOpen && (
        <div
          className="modal-backdrop"
          onClick={() => !busy && setConnectionOpen(false)}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="connect-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              aria-label="Close connection settings"
              disabled={busy}
              onClick={() => setConnectionOpen(false)}
            >
              <X size={20} />
            </button>
            <span className="modal-icon">
              <Usb size={24} />
            </span>
            <h2 id="connect-title">Bring your lights online.</h2>
            <p>
              Choose the firmware installed on your ESP32. The USB options use
              different commands.
            </p>
            <label>
              Local device address
              <input
                type="url"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </label>
            <button
              className="button accent full"
              disabled={busy || !!transport}
              onClick={() => void connect("wifi")}
            >
              <Wifi size={16} />
              {busy ? "Connecting…" : "Connect Studio JSON over Wi-Fi"}
            </button>
            <div className="or">OR CONNECT WITH A CABLE</div>
            <label htmlFor="serial-protocol">
              USB firmware
              <select
                id="serial-protocol"
                value={serialProtocol}
                disabled={busy || !!transport}
                onChange={(e) =>
                  setSerialProtocol(
                    e.target.value as "preset" | "studio" | "v2",
                  )
                }
              >
                <option value="v2">Wi-Fi V2 controller (USB)</option>
                <option value="preset">Preset controller (your sketch)</option>
                <option value="studio">Studio JSON / microphone test</option>
              </select>
            </label>
            <p className="compat-note">
              {serialProtocol === "v2"
                ? "For the newer firmware with the built-in Wi-Fi page and STATUS / MIC BEAT commands. USB reads its live microphone and completed color frames."
                : serialProtocol === "preset"
                  ? "For your R / G / B / A / M / X sketch. Connecting sends X to stop Auto / Music. This sketch supports USB only."
                  : "For the Studio JSON controller or the earlier level-only test sketch. Do not select this for the preset controller."}
              {transport && " Disconnect the current device before switching."}
            </p>
            <button
              className="button secondary full"
              disabled={busy || !!transport || !hasSerial()}
              onClick={() => void connect("serial")}
            >
              <Usb size={16} />
              Connect with Web Serial
            </button>
            <p className="compat-note">
              Web Serial requires a compatible desktop browser and a secure
              context. If unavailable, use local Wi-Fi. HTTPS pages may block
              HTTP devices; run this app locally over HTTP for the Wi-Fi
              workflow. Close Arduino Serial Monitor first so the USB port is
              free.
            </p>
            {connectionError && (
              <p className="notice" role="alert">
                {connectionError}
              </p>
            )}
            {transport && (
              <div className="notice">
                {deviceStatus
                  ? `${deviceStatus.name} · Firmware ${deviceStatus.firmware}`
                  : "Connection needs to be reopened."}
                <button
                  className="text-button"
                  onClick={() => void disconnect()}
                >
                  Disconnect
                </button>
              </div>
            )}
          </section>
        </div>
      )}
      {sceneDialog && (
        <div className="modal-backdrop" onClick={() => setSceneDialog(false)}>
          <form
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="scene-title"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              saveScene();
            }}
          >
            <button
              type="button"
              className="modal-close icon-button"
              aria-label="Close scene dialog"
              onClick={() => setSceneDialog(false)}
            >
              <X size={20} />
            </button>
            <h2 id="scene-title">Keep this feeling.</h2>
            <p>
              Save your current color, effect and controls as a reusable scene.
            </p>
            <label>
              Scene name
              <input
                autoFocus
                value={sceneName}
                maxLength={40}
                placeholder="e.g. Midnight encore"
                onChange={(e) => setSceneName(e.target.value)}
              />
            </label>
            <button
              className="button accent full"
              disabled={!sceneName.trim()}
              type="submit"
            >
              <Plus size={16} />
              Save scene
            </button>
          </form>
        </div>
      )}
      {help && (
        <div className="modal-backdrop" onClick={() => setHelp(false)}>
          <section
            className="modal help-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              aria-label="Close help"
              onClick={() => setHelp(false)}
            >
              <X size={20} />
            </button>
            <h2 id="help-title">Your studio, explained.</h2>
            <h3>01 / Start with the simulator</h3>
            <p>
              Pick a color, effect and wristband. Brightness, speed and Music
              Sync update the preview instantly. Demo audio is a synthetic 120
              BPM signal.
            </p>
            <h3>02 / Listen in DJ mode</h3>
            <p>
              Choose microphone or shared audio, then Start and grant
              permission. No audio leaves your browser. BPM and drop detection
              are estimates.
            </p>
            <h3>03 / Connect when ready</h3>
            <p>
              Install the included Arduino firmware, follow the wiring guide,
              then connect with Wi-Fi or Web Serial. Raw IR requires verified
              timing data. RF is a reserved interface only.
            </p>
            <div className="notice">
              Repository documentation: <code>README.md</code>,{" "}
              <code>docs/WIRING.md</code>, <code>docs/TESTING.md</code>, and{" "}
              <code>docs/PROTOCOL.md</code>.
            </div>
            <p className="compat-note">
              For mobile microphone capture use HTTPS. Ordinary HTTP over a LAN
              supports the simulator and device API, but does not unlock browser
              microphone access.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
