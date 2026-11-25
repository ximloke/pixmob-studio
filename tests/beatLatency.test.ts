import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { beatWorkletSource } from "../src/lib/beatWorklet.ts";

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
function renderWorklet(
  source: string,
  rate: number,
  seconds: number,
  signal: (time: number, channel: number) => number,
  channels = 1,
  sensitivity = 60,
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
  const count = Math.ceil(rate * seconds);
  let audibleSamples = 0;
  for (let offset = 0; offset < count; offset += 128) {
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

function kick(time: number, start: number, amplitude: number) {
  const age = time - start;
  if (age < 0 || age > 0.18) return 0;
  return amplitude * Math.exp(-age / 0.042) * Math.sin(2 * Math.PI * 90 * age);
}

function noise(index: number) {
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

function onsets(result: ReturnType<typeof renderWorklet>): Onset[] {
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
      onset.audioTime <= postedAt,
      "sample-derived event time cannot be in the future",
    );
    assert(
      postedAt - onset.audioTime < 0.004,
      "event time describes detection in the current rendering quantum",
    );
    return [onset];
  });
}

function matchHits(actual: Onset[], expected: number[], maximumDelay = 0.03) {
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

const irregularHits = [1, 1.53, 1.92, 2.7, 3.02, 3.63, 4.19];

for (const rate of [44100, 48000]) {
  test(`actual PCM detector posts irregular kick onsets promptly at ${rate} Hz`, (context) => {
    const result = renderWorklet(beatWorkletSource, rate, 5.5, (time) =>
      irregularHits.reduce((sum, start) => sum + kick(time, start, 0.2), 0),
    );
    const delays = matchHits(onsets(result), irregularHits);
    context.diagnostic(
      `sample onset → worklet post: ${Math.min(...delays).toFixed(2)}–${Math.max(...delays).toFixed(2)} ms; excludes capture, main thread, serial, IR and optical response`,
    );
    assert.equal(
      result.audibleSamples,
      0,
      "analysis output must remain silent instead of replaying captured music",
    );
  });
}

test("silence and a paused tail never become a free-running BPM clock", () => {
  const silent = renderWorklet(beatWorkletSource, 48000, 5, () => 0);
  assert.equal(onsets(silent).length, 0);
  assert(
    silent.messages.some(
      ({ data }) => typeof data === "object" && data.type === "tick",
    ),
  );
  const hits = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 7];
  const result = renderWorklet(beatWorkletSource, 48000, 8.5, (time) =>
    hits.reduce((sum, start) => sum + kick(time, start, 0.2), 0),
  );
  matchHits(onsets(result), hits);
});

test("held bass and synth pads cannot repeatedly trigger physical flashes", () => {
  const result = renderWorklet(
    beatWorkletSource,
    48000,
    5,
    (time) =>
      time < 0.5
        ? 0
        : 0.06 * Math.sin(2 * Math.PI * 55 * time) +
          0.04 * Math.sin(2 * Math.PI * 330 * time),
    1,
    100,
  );
  const detected = onsets(result);
  assert(
    detected.length <= 1,
    `a held pad retriggered at ${detected.map((event) => event.postedAt)}`,
  );
  assert(detected.every((event) => event.postedAt < 0.55));
});

test("weaker irregular kicks remain detectable over a continuous musical pad", () => {
  const amplitudes = [0.08, 0.12, 0.04, 0.1, 0.055, 0.09, 0.045];
  const result = renderWorklet(
    beatWorkletSource,
    48000,
    5.5,
    (time) =>
      0.012 * Math.sin(2 * Math.PI * 55 * time) +
      0.008 * Math.sin(2 * Math.PI * 330 * time) +
      irregularHits.reduce(
        (sum, start, index) => sum + kick(time, start, amplitudes[index]),
        0,
      ),
    1,
    100,
  );
  // A pad starting with capture may have its own onset; it cannot keep repeating.
  matchHits(
    onsets(result).filter((event) => event.postedAt > 0.5),
    irregularHits,
  );
});

test("80 BPM kick/snare quarters ignore weaker halfway hi-hats at high sensitivity", (context) => {
  const rate = 48000;
  const hits = Array.from({ length: 8 }, (_, index) => 1 + index * 0.75);
  const result = renderWorklet(
    beatWorkletSource,
    rate,
    7.5,
    (time) => {
      let value = 0;
      for (let index = 0; index < hits.length; index++) {
        const age = time - hits[index];
        if (index % 2 === 0) value += kick(time, hits[index], 0.22);
        else if (age >= 0 && age < 0.14)
          value +=
            noise(Math.floor(age * rate)) * 0.14 * Math.exp(-age / 0.015) +
            0.1 * Math.sin(2 * Math.PI * 180 * age) * Math.exp(-age / 0.03);
        const hatAge = time - hits[index] - 0.375;
        if (hatAge >= 0 && hatAge < 0.035)
          value +=
            (noise(Math.floor(hatAge * rate)) * 0.009 +
              Math.sin(2 * Math.PI * 7000 * hatAge) * 0.02) *
            Math.exp(-hatAge / 0.006);
      }
      return value;
    },
    1,
    100,
  );
  const delays = matchHits(onsets(result), hits);
  context.diagnostic(
    `80 BPM quarter-hit posting delay ≤${Math.max(...delays).toFixed(2)} ms; no 160 BPM hi-hat doubling`,
  );
});

test("stereo channel power detects left/right and opposite-polarity drum hits", () => {
  const hits = [1, 1.6, 2.2, 2.8];
  for (const oppositePolarity of [false, true]) {
    const result = renderWorklet(
      beatWorkletSource,
      48000,
      4,
      (time, channel) =>
        hits.reduce((sum, start, index) => {
          if (!oppositePolarity && channel !== index % 2) return sum;
          return (
            sum +
            kick(time, start, channel === 1 && oppositePolarity ? -0.2 : 0.2)
          );
        }, 0),
      2,
    );
    matchHits(onsets(result), hits);
  }
});

test("DC and isolated digital clicks do not masquerade as drum beats", () => {
  const rate = 48000;
  const result = renderWorklet(
    beatWorkletSource,
    rate,
    4,
    (time) => {
      const sample = Math.round(time * rate);
      return 0.25 + (sample === rate || sample === rate * 2 ? 0.7 : 0);
    },
    1,
    100,
  );
  assert.equal(
    onsets(result).filter((event) => event.postedAt > 0.2).length,
    0,
  );
  const hits = [1, 1.6, 2.2];
  const withKicks = renderWorklet(
    beatWorkletSource,
    rate,
    4,
    (time) =>
      0.25 + hits.reduce((sum, start) => sum + kick(time, start, 0.2), 0),
  );
  matchHits(
    onsets(withKicks).filter((event) => event.postedAt > 0.2),
    hits,
  );
});
