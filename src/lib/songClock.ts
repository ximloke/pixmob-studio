export type SongClockMode = "audio" | "foreground";

// A silent render heartbeat. The caller reads the real media position and
// crosses authored cues; this processor never generates musical beats.
export const songClockSource = String.raw`
class PixMobSongClock extends AudioWorkletProcessor {
  constructor() { super(); this.frames = 0; }
  process(inputs, outputs) {
    for (const output of outputs) for (const channel of output) channel.fill(0);
    this.frames += outputs[0]?.[0]?.length || 128;
    if (this.frames >= sampleRate * 0.02) {
      this.frames %= sampleRate * 0.02;
      this.port.postMessage('tick');
    }
    return true;
  }
}
registerProcessor('pixmob-song-clock', PixMobSongClock);
`;

/** Independent of requestAnimationFrame; every start owns its audio resources. */
export class SongPlaybackClock {
  private generation = 0;
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private fallback: ReturnType<typeof setInterval> | null = null;

  async start(onTick: () => void): Promise<SongClockMode> {
    this.stop();
    const generation = this.generation;
    let context: AudioContext | null = null;
    let url: string | undefined;
    const current = () => generation === this.generation;
    try {
      if (
        typeof AudioContext === "undefined" ||
        typeof AudioWorkletNode === "undefined"
      )
        throw new Error("Audio render clock unavailable.");
      context = new AudioContext({ latencyHint: "interactive" });
      this.context = context;
      // Resume within the Play gesture, before device preparation awaits USB.
      await context.resume();
      if (!current()) throw new DOMException("Clock cancelled.", "AbortError");
      if (!context.audioWorklet) throw new Error("AudioWorklet unavailable.");
      url = URL.createObjectURL(
        new Blob([songClockSource], { type: "application/javascript" }),
      );
      await context.audioWorklet.addModule(url);
      if (!current()) throw new DOMException("Clock cancelled.", "AbortError");
      const node = new AudioWorkletNode(context, "pixmob-song-clock", {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      this.node = node;
      node.port.onmessage = (event) => {
        if (
          event.data === "tick" &&
          current() &&
          this.node === node &&
          context?.state === "running"
        )
          onTick();
      };
      node.connect(context.destination);
      return "audio";
    } catch (error) {
      if (this.context === context) {
        this.context = null;
        const node = this.node;
        this.node = null;
        if (node) {
          node.port.onmessage = null;
          node.port.close();
          node.disconnect();
        }
        if (context && context.state !== "closed")
          void context.close().catch(() => {});
      }
      if (!current()) throw new DOMException("Clock cancelled.", "AbortError");
      // Unsupported browsers retain a clearly labeled foreground fallback.
      this.fallback = setInterval(() => {
        if (current()) onTick();
      }, 25);
      return "foreground";
    } finally {
      if (url) URL.revokeObjectURL(url);
    }
  }

  stop(): void {
    ++this.generation;
    if (this.fallback !== null) clearInterval(this.fallback);
    this.fallback = null;
    const node = this.node,
      context = this.context;
    this.node = null;
    this.context = null;
    if (node) {
      node.port.onmessage = null;
      node.port.close();
      node.disconnect();
    }
    if (context && context.state !== "closed")
      void context.close().catch(() => {});
  }
}
