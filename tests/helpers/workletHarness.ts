import assert from "node:assert/strict";
import vm from "node:vm";

type WorkletMessage = {
  data: Record<string, unknown> | string;
  postedAt: number;
};
type TestProcessor = {
  port: { onmessage: ((event: { data: unknown }) => void) | null };
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
};

// This harness runs the shipped processor in rendering quanta. Posting time is
// measured independently from any timestamp supplied by the detector itself.
export function renderWorklet(
  source: string,
  rate: number,
  seconds: number,
  signal: (time: number, channel: number) => number,
  channels = 1,
  sensitivity = 60,
  automatic = false,
  changes: { at: number; data: unknown }[] = [],
) {
  const messages: WorkletMessage[] = [];
  let Processor: (new (options: unknown) => TestProcessor) | undefined;
  let blockEnd = 0;
  class AudioWorkletProcessor {
    port = {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      postMessage(data: Record<string, unknown> | string) {
        messages.push({ data, postedAt: blockEnd });
      },
    };
  }
  const scope = vm.createContext({
    AudioWorkletProcessor,
    sampleRate: rate,
    currentFrame: 0,
    currentTime: 0,
    registerProcessor(
      name: string,
      implementation: new (options: unknown) => TestProcessor,
    ) {
      assert.equal(name, "pixmob-clock");
      Processor = implementation;
    },
  });
  new vm.Script(source).runInContext(scope);
  assert(Processor, "the actual worklet must register a processor");
  const processor = new Processor({ processorOptions: { sensitivity } });
  processor.port.onmessage?.({
    data: { type: "sensitivity", value: sensitivity },
  });
  processor.port.onmessage?.({
    data: { type: "autoSensitivity", enabled: automatic },
  });
  let nextChange = 0;
  const count = Math.ceil(rate * seconds);
  let audibleSamples = 0;
  for (let offset = 0; offset < count; offset += 128) {
    while (
      nextChange < changes.length &&
      changes[nextChange].at <= offset / rate
    ) {
      processor.port.onmessage?.({ data: changes[nextChange++].data });
    }
    scope.currentFrame = offset;
    scope.currentTime = offset / rate;
    blockEnd = (offset + 128) / rate;
    const input = Array.from({ length: channels }, (_, channel) => {
      const samples = new Float32Array(128);
      for (let i = 0; i < samples.length; ++i)
        samples[i] = signal((offset + i) / rate, channel);
      return samples;
    });
    const output = [new Float32Array(128)];
    assert.equal(processor.process([input], [output], {}), true);
    audibleSamples += output[0].reduce(
      (sum, value) => sum + (value !== 0 ? 1 : 0),
      0,
    );
  }
  return { messages, audibleSamples };
}

export function kick(time: number, start: number, amplitude: number) {
  const age = time - start;
  if (age < 0 || age > 0.18) return 0;
  return amplitude * Math.exp(-age / 0.042) * Math.sin(2 * Math.PI * 90 * age);
}

export function noise(index: number) {
  let value = index | 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x80000000 - 1;
}

type Onset = {
  audioTime: number;
  postedAt: number;
  level: number;
  strength: number;
};

export function onsets(result: ReturnType<typeof renderWorklet>): Onset[] {
  return result.messages.flatMap(({ data, postedAt }) => {
    if (typeof data !== "object" || data.type !== "onset") return [];
    assert.equal(typeof data.audioTime, "number");
    assert.equal(typeof data.level, "number");
    assert.equal(typeof data.strength, "number");
    const onset = {
      audioTime: Number(data.audioTime),
      postedAt,
      level: Number(data.level),
      strength: Number(data.strength),
    };
    assert(Number.isFinite(onset.audioTime));
    assert(onset.level > 0 && onset.level <= 1);
    assert(onset.strength >= 0 && onset.strength <= 1);
    assert(
      onset.audioTime <= postedAt + 1e-9,
      "sample-derived event time cannot be in the future",
    );
    assert(
      postedAt - onset.audioTime < 0.004,
      "event time describes detection in the current rendering quantum",
    );
    return [onset];
  });
}

export function matchHits(
  actual: Onset[],
  expected: number[],
  maximumDelay = 0.03,
) {
  assert.equal(
    actual.length,
    expected.length,
    `expected hits at ${expected}; got events at ${actual.map((event) => event.postedAt)}`,
  );
  return actual.map((event, index) => {
    const delay = event.postedAt - expected[index];
    assert(
      delay >= -0.00001,
      `event preceded signal onset by ${-delay * 1000} ms`,
    );
    assert(
      delay <= maximumDelay,
      `hit ${index} took ${(delay * 1000).toFixed(2)} ms to post`,
    );
    return delay * 1000;
  });
}
