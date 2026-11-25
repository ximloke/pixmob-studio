import { beatWorkletSource } from "./beatWorklet";

export type AudioFrame = {
  bins: number[];
  bass: number;
  mid: number;
  treble: number;
  bpm: number | null;
  beat: boolean;
  drop: boolean;
  level: number;
  onsetIntervalMs?: number;
  detectedOnsets?: number;
  automaticSensitivity?: boolean;
  effectiveSensitivity?: number;
  tempoConfidence?: number;
};
export const silentFrame: AudioFrame = {
  bins: Array(64).fill(0),
  bass: 0,
  mid: 0,
  treble: 0,
  bpm: null,
  beat: false,
  drop: false,
  level: 0,
};
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
export class BeatTracker {
  private average = 0.08;
  private deviation = 0;
  private previousBass = 0;
  private lastBeat = -10000;
  private intervals: number[] = [];
  private quietSince: number | null = null;
  private lastDrop = -10000;
  process(bass: number, level: number, now: number, sensitivity: number) {
    bass = clamp(bass, 0, 1);
    level = clamp(level, 0, 1);
    sensitivity = clamp(sensitivity, 0, 100);
    const reactivity = sensitivity / 100;
    // Add local contrast instead of multiplying a high baseline past full scale.
    // A rise is still required, so sustained bass never becomes a tempo clock.
    const contrast = Math.max(
      0.012 + (1 - reactivity) * 0.04,
      this.deviation * (1 + (1 - reactivity) * 1.5),
    );
    const rise = Math.max(0.008, 0.008 + (1 - reactivity) * 0.025);
    const beat =
      level > 0.025 &&
      bass > Math.max(0.055, this.average + contrast) &&
      bass - this.previousBass > rise &&
      now - this.lastBeat >= 220;
    if (beat) {
      const interval = now - this.lastBeat;
      if (interval > 2000) this.intervals = [];
      if (interval >= 300 && interval <= 1500) this.intervals.push(interval);
      this.intervals = this.intervals.slice(-12);
      this.lastBeat = now;
    }
    this.previousBass = bass;
    this.deviation =
      this.deviation * 0.95 + Math.abs(bass - this.average) * 0.05;
    this.average = this.average * 0.95 + bass * 0.05;
    if (level < 0.12) this.quietSince ??= now;
    const drop =
      level > 0.48 &&
      bass > 0.5 &&
      this.quietSince !== null &&
      now - this.quietSince > 1200 &&
      now - this.lastDrop > 4000;
    if (drop) this.lastDrop = now;
    if (level >= 0.12) this.quietSince = null;
    const sorted = [...this.intervals].sort((a, b) => a - b);
    const bpm =
      sorted.length >= 4 && now - this.lastBeat < 3000
        ? Math.round(60000 / sorted[Math.floor(sorted.length / 2)])
        : null;
    return { beat, drop, bpm };
  }
}
export class AudioEngine {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  /** The shared tab or screen while system audio is captured, else null. */
  get sharedStream(): MediaStream | null {
    return this.stream?.getVideoTracks().length ? this.stream : null;
  }
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private tracker = new BeatTracker();
  private generation = 0;
  private removeEndedListeners: (() => void) | null = null;
  private clockNode: AudioWorkletNode | null = null;
  private latestFrame: AudioFrame = silentFrame;
  private sensitivity = 60;
  private automaticSensitivity = true;
  private analysisStatus: Pick<
    AudioFrame,
    "automaticSensitivity" | "effectiveSensitivity" | "tempoConfidence"
  > = {};
  private onsetTimes: number[] = [];
  private lastOnsetTime = -Infinity;
  private detectedOnsets = 0;
  private onsetIntervalMs: number | undefined;
  private frameListeners = new Set<(frame: AudioFrame) => void>();
  get realtimeAnalysis() {
    return this.clockNode !== null;
  }
  subscribeFrames(listener: (frame: AudioFrame) => void) {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }
  private publishFrame(frame: AudioFrame) {
    this.latestFrame = frame;
    for (const listener of this.frameListeners) {
      try {
        listener(frame);
      } catch {
        /* A view cannot stop the analysis clock. */
      }
    }
  }
  private updateAnalysisStatus(data: Record<string, unknown>) {
    // A queued report from the previous mode cannot confirm the new setting.
    if (
      typeof data.automatic !== "boolean" ||
      data.automatic !== this.automaticSensitivity
    )
      return;
    this.analysisStatus = {
      automaticSensitivity: data.automatic,
      effectiveSensitivity:
        Number.isFinite(data.effectiveSensitivity) &&
        typeof data.effectiveSensitivity === "number" &&
        data.effectiveSensitivity >= 0 &&
        data.effectiveSensitivity <= 100
          ? data.effectiveSensitivity
          : undefined,
      tempoConfidence:
        Number.isFinite(data.tempoConfidence) &&
        typeof data.tempoConfidence === "number" &&
        data.tempoConfidence >= 0 &&
        data.tempoConfidence <= 1
          ? data.tempoConfidence
          : undefined,
    };
  }
  async start(kind: "microphone" | "system", onEnded: () => void) {
    const stopping = this.stop();
    const generation = this.generation;
    await stopping;
    if (generation !== this.generation)
      throw new DOMException("Audio capture was cancelled.", "AbortError");
    const media = globalThis.navigator?.mediaDevices;
    if (!media)
      throw new Error(
        "Audio capture needs localhost or HTTPS and a supported browser.",
      );
    if (kind === "system" && !media.getDisplayMedia)
      throw new Error(
        "System audio capture is unavailable in this browser. Use a microphone or demo audio.",
      );
    const stream =
      kind === "microphone"
        ? await media.getUserMedia({
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            },
          })
        : await media.getDisplayMedia({ video: true, audio: true });
    if (generation !== this.generation) {
      stream.getTracks().forEach((t) => t.stop());
      throw new DOMException("Audio capture was cancelled.", "AbortError");
    }
    if (!stream.getAudioTracks().length) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error(
        "No audio was shared. Choose a browser tab and enable “Share tab audio”. System audio depends on your browser and operating system.",
      );
    }
    this.stream = stream;
    try {
      const context = new AudioContext();
      this.context = context;
      await context.resume();
      if (generation !== this.generation)
        throw new DOMException("Audio capture was cancelled.", "AbortError");
      this.analyser = context.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.55;
      // Mastered songs often exceed the default -30 dB ceiling. Keep their
      // spectrum contrast; the audio-thread onset detector uses unclipped PCM.
      this.analyser.maxDecibels = 0;
      this.source = context.createMediaStreamSource(stream);
      this.source.connect(this.analyser);
      let ended = false;
      const onTrackEnded = () => {
        if (!ended && generation === this.generation) {
          ended = true;
          onEnded();
        }
      };
      stream
        .getTracks()
        .forEach((t) => t.addEventListener("ended", onTrackEnded));
      this.removeEndedListeners = () =>
        stream
          .getTracks()
          .forEach((t) => t.removeEventListener("ended", onTrackEnded));
      this.tracker = new BeatTracker();
      this.latestFrame = silentFrame;
      this.onsetTimes = [];
      this.lastOnsetTime = -Infinity;
      this.detectedOnsets = 0;
      this.onsetIntervalMs = undefined;
      this.analysisStatus = {};
      if (context.audioWorklet && typeof AudioWorkletNode !== "undefined") {
        let moduleUrl: string | undefined;
        try {
          moduleUrl = URL.createObjectURL(
            new Blob([beatWorkletSource], { type: "application/javascript" }),
          );
          await context.audioWorklet.addModule(moduleUrl);
          if (generation !== this.generation)
            throw new DOMException(
              "Audio capture was cancelled.",
              "AbortError",
            );
          const clockNode = new AudioWorkletNode(context, "pixmob-clock", {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [1],
          });
          clockNode.port.onmessage = (event) => {
            if (
              generation !== this.generation ||
              this.clockNode !== clockNode ||
              context.state !== "running"
            )
              return;
            const data = event.data;
            if (!data || typeof data !== "object") return;
            if (data.type === "tick") {
              this.updateAnalysisStatus(data);
              const frame = this.analyse(performance.now(), this.sensitivity);
              // FFT animation and drop estimates never create control beats.
              this.publishFrame({
                ...frame,
                beat: false,
                bpm: this.onsetBpm(context.currentTime),
                onsetIntervalMs: this.onsetIntervalMs,
                detectedOnsets: this.detectedOnsets,
                ...this.analysisStatus,
              });
            } else if (data.type === "onset") {
              const { audioTime, level, strength } = data;
              if (
                !Number.isFinite(audioTime) ||
                !Number.isFinite(level) ||
                level <= 0 ||
                level > 1 ||
                !Number.isFinite(strength) ||
                strength < 0 ||
                strength > 1 ||
                audioTime <= this.lastOnsetTime ||
                audioTime - context.currentTime > 0.01 ||
                context.currentTime - audioTime > 0.1
              )
                return;
              this.updateAnalysisStatus(data);
              if (audioTime - this.lastOnsetTime > 2) this.onsetTimes = [];
              this.onsetIntervalMs = Number.isFinite(this.lastOnsetTime)
                ? Math.round((audioTime - this.lastOnsetTime) * 1000)
                : undefined;
              this.lastOnsetTime = audioTime;
              ++this.detectedOnsets;
              this.onsetTimes.push(audioTime);
              this.onsetTimes = this.onsetTimes.slice(-13);
              // Notify control immediately, even before the first visual tick.
              this.publishFrame({
                ...this.latestFrame,
                beat: true,
                drop: false,
                level,
                bpm: this.onsetBpm(audioTime),
                onsetIntervalMs: this.onsetIntervalMs,
                detectedOnsets: this.detectedOnsets,
                ...this.analysisStatus,
              });
            }
          };
          this.clockNode = clockNode;
          clockNode.port.postMessage({
            type: "sensitivity",
            value: this.sensitivity,
          });
          clockNode.port.postMessage({
            type: "autoSensitivity",
            enabled: this.automaticSensitivity,
          });
          this.source.connect(clockNode);
          clockNode.connect(context.destination);
        } catch (error) {
          if (generation !== this.generation)
            throw new DOMException(
              "Audio capture was cancelled.",
              "AbortError",
            );
          this.clockNode?.disconnect();
          this.clockNode?.port.close();
          this.clockNode = null;
          // Older browsers can still analyse from the visible view's render loop.
        } finally {
          if (moduleUrl) URL.revokeObjectURL(moduleUrl);
        }
      }
    } catch (e) {
      if (generation === this.generation) await this.stop();
      throw e;
    }
  }
  configureAnalysis(sensitivity: number, automaticSensitivity = true): void {
    const nextSensitivity = clamp(sensitivity, 0, 100);
    if (nextSensitivity !== this.sensitivity) {
      this.sensitivity = nextSensitivity;
      this.clockNode?.port.postMessage({
        type: "sensitivity",
        value: nextSensitivity,
      });
    }
    if (automaticSensitivity !== this.automaticSensitivity) {
      this.automaticSensitivity = automaticSensitivity;
      this.analysisStatus = {};
      this.latestFrame = {
        ...this.latestFrame,
        automaticSensitivity: undefined,
        effectiveSensitivity: undefined,
        tempoConfidence: undefined,
      };
      this.clockNode?.port.postMessage({
        type: "autoSensitivity",
        enabled: automaticSensitivity,
      });
    }
  }
  read(
    now: number,
    sensitivity: number,
    automaticSensitivity = true,
  ): AudioFrame {
    this.configureAnalysis(sensitivity, automaticSensitivity);
    if (this.clockNode) return this.latestFrame;
    const frame = this.analyse(now, this.sensitivity);
    this.publishFrame(frame);
    return frame;
  }
  private onsetBpm(audioTime: number): number | null {
    if (audioTime - this.lastOnsetTime >= 3) return null;
    const intervals = this.onsetTimes
      .slice(1)
      .map((time, index) => (time - this.onsetTimes[index]) * 1000)
      .filter((interval) => interval >= 300 && interval <= 1500)
      .sort((a, b) => a - b);
    return intervals.length >= 4
      ? Math.round(60000 / intervals[Math.floor(intervals.length / 2)])
      : null;
  }
  private analyse(now: number, sensitivity: number): AudioFrame {
    if (!this.analyser || !this.context) return silentFrame;
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(data);
    const binHz = this.context.sampleRate / this.analyser.fftSize;
    const band = (lo: number, hi: number) => {
      let sum = 0,
        n = 0;
      for (
        let i = Math.ceil(lo / binHz);
        i < Math.min(data.length, Math.ceil(hi / binHz));
        i++
      ) {
        sum += data[i] / 255;
        n++;
      }
      return n ? sum / n : 0;
    };
    const gain = 0.4 + (clamp(sensitivity, 0, 100) / 100) * 1.6;
    const measuredBass = band(30, 250),
      measuredMid = band(250, 4000),
      measuredTreble = band(4000, 16000),
      bass = Math.min(1, measuredBass * gain),
      mid = Math.min(1, measuredMid * gain),
      treble = Math.min(1, measuredTreble * gain),
      level = (bass + mid + treble) / 3;
    const bins = Array.from({ length: 64 }, (_, i) => {
      const lo = 30 * Math.pow(16000 / 30, i / 64),
        hi = 30 * Math.pow(16000 / 30, (i + 1) / 64);
      return Math.min(1, band(lo, Math.max(hi, lo + binHz)) * gain);
    });
    return {
      bins,
      bass,
      mid,
      treble,
      level,
      automaticSensitivity: false,
      effectiveSensitivity: sensitivity,
      // Visual gain may clip the display at 1; preserve measured onset contrast.
      ...this.tracker.process(
        measuredBass,
        (measuredBass + measuredMid + measuredTreble) / 3,
        now,
        sensitivity,
      ),
    };
  }
  async stop() {
    ++this.generation;
    // Clear shared references before awaiting close: an older stop must not erase a new capture.
    const context = this.context,
      stream = this.stream,
      source = this.source;
    const clockNode = this.clockNode;
    this.clockNode = null;
    this.latestFrame = silentFrame;
    this.onsetTimes = [];
    this.lastOnsetTime = -Infinity;
    this.detectedOnsets = 0;
    this.onsetIntervalMs = undefined;
    this.analysisStatus = {};
    if (clockNode) {
      clockNode.port.onmessage = null;
      clockNode.port.close();
      clockNode.disconnect();
    }
    this.removeEndedListeners?.();
    this.removeEndedListeners = null;
    this.context = null;
    this.stream = null;
    this.source = null;
    this.analyser = null;
    stream?.getTracks().forEach((t) => t.stop());
    source?.disconnect();
    if (context && context.state !== "closed") await context.close();
  }
}
export function demoAudio(t: number, sensitivity = 60): AudioFrame {
  const pulse = Math.pow(Math.max(0, 1 - (t % 0.5) / 0.5), 3),
    cycle = t % 24;
  const gain =
    (cycle >= 18 && cycle < 20 ? 0.06 : 1) *
    (0.4 + clamp(sensitivity, 0, 100) / 100);
  const scale = (v: number) => Math.min(1, v * gain);
  return {
    bins: Array.from({ length: 64 }, (_, i) =>
      scale(
        0.12 +
          Math.abs(Math.sin(i * 0.23 + t * 2.4) * Math.cos(i * 0.09 - t)) *
            0.45 +
          pulse * 0.4 * (1 - i / 80),
      ),
    ),
    bass: scale(0.25 + pulse * 0.7),
    mid: scale(0.3 + Math.sin(t * 2) * 0.15),
    treble: scale(0.2 + Math.sin(t * 3) * 0.12),
    bpm: 120,
    beat: cycle < 18 || cycle >= 20 ? pulse > 0.8 : false,
    drop: cycle >= 20 && cycle < 20.5,
    level: scale(0.2 + pulse * 0.8),
  };
}
