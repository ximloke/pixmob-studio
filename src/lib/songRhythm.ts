export type RhythmAnalysis = {
  duration: number;
  bpm: number | null;
  confidence: number;
  beats: number[];
};

export const MAX_ANALYSIS_SECONDS = 600;
export const MAX_ANALYSIS_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_ANALYSIS_BEATS = 4096;
const ANALYSIS_SAMPLE_RATE = 22050;
const ANALYSIS_HOP = 220;
const MAX_ANALYSIS_SAMPLES = ANALYSIS_SAMPLE_RATE * MAX_ANALYSIS_SECONDS;

/** Metadata only: times are measured attacks, not inferred bars or downbeats. */
export function validateRhythmAnalysis(
  value: unknown,
): value is RhythmAnalysis {
  if (!value || typeof value !== "object") return false;
  const result = value as RhythmAnalysis;
  if (
    !Number.isFinite(result.duration) ||
    result.duration <= 0 ||
    result.duration > MAX_ANALYSIS_SECONDS ||
    (result.bpm !== null &&
      (!Number.isFinite(result.bpm) || result.bpm < 40 || result.bpm > 220)) ||
    !Number.isFinite(result.confidence) ||
    result.confidence < 0 ||
    result.confidence > 1 ||
    !Array.isArray(result.beats) ||
    result.beats.length > MAX_ANALYSIS_BEATS
  )
    return false;
  let previous = -Infinity;
  for (const time of result.beats) {
    if (
      !Number.isFinite(time) ||
      time < 0 ||
      time > result.duration ||
      time <= previous
    )
      return false;
    previous = time;
  }
  return true;
}

// Offline beat tracking. A spectral-flux onset envelope gives the tempo by
// autocorrelation; dynamic programming (Ellis 2007) then picks one beat chain
// that lands on measured attacks. Each beat is snapped to the rising edge of
// the audio around it, beats without any attack energy are dropped rather
// than filled from the grid, and songs without a stable tempo fall back to
// plain detected attacks. Nothing here plays audio or controls a device.
export const rhythmWorkerSource = String.raw`
const RATE = ${ANALYSIS_SAMPLE_RATE};
const HOP = ${ANALYSIS_HOP};
const FFT_SIZE = 1024;
const MAX_BEATS = ${MAX_ANALYSIS_BEATS};
const MAX_SAMPLES = ${MAX_ANALYSIS_SAMPLES};
const MIN_BPM = 55;
const MAX_BPM = 210;
const TIGHTNESS = 50;

function fftTables(size) {
  const bits = Math.round(Math.log2(size));
  const reverse = new Uint32Array(size);
  for (let i = 0; i < size; i++) {
    let k = i, value = 0;
    for (let b = 0; b < bits; b++) { value = (value << 1) | (k & 1); k >>= 1; }
    reverse[i] = value;
  }
  const cos = new Float64Array(size / 2), sin = new Float64Array(size / 2);
  for (let i = 0; i < size / 2; i++) {
    cos[i] = Math.cos(-2 * Math.PI * i / size);
    sin[i] = Math.sin(-2 * Math.PI * i / size);
  }
  return { reverse, cos, sin };
}

function fft(re, im, tables) {
  const size = re.length;
  for (let i = 0; i < size; i++) {
    const j = tables.reverse[i];
    if (j > i) {
      let swap = re[i]; re[i] = re[j]; re[j] = swap;
      swap = im[i]; im[i] = im[j]; im[j] = swap;
    }
  }
  for (let span = 2; span <= size; span *= 2) {
    const half = span / 2, step = size / span;
    for (let start = 0; start < size; start += span) {
      for (let k = 0; k < half; k++) {
        const wr = tables.cos[k * step], wi = tables.sin[k * step];
        const a = start + k, b = a + half;
        const tr = wr * re[b] - wi * im[b], ti = wr * im[b] + wi * re[b];
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
}

// Positive log-spectral change per frame in three bands (bass below 250 Hz,
// body to 4 kHz, treble to 10 kHz). Channel powers are averaged, so opposite
// stereo phases keep their drums.
function spectralFlux(channels, report) {
  const size = FFT_SIZE, length = channels[0].length;
  const frames = length >= size ? Math.floor((length - size) / HOP) + 1 : 0;
  const bands = [new Float32Array(frames), new Float32Array(frames), new Float32Array(frames)];
  if (!frames) return bands;
  const tables = fftTables(size);
  const window = new Float64Array(size);
  for (let i = 0; i < size; i++) window[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1));
  const bins = Math.min(size / 2, Math.floor(10000 / (RATE / size)));
  const band = new Uint8Array(bins);
  for (let k = 2; k < bins; k++) {
    const hz = k * RATE / size;
    band[k] = hz < 250 ? 0 : hz < 4000 ? 1 : 2;
  }
  const re = new Float64Array(size), im = new Float64Array(size);
  const power = new Float64Array(bins), previous = new Float64Array(bins);
  let reported = 0;
  for (let frame = 0; frame < frames; frame++) {
    const start = frame * HOP;
    power.fill(0);
    for (const channel of channels) {
      for (let i = 0; i < size; i++) { re[i] = channel[start + i] * window[i]; im[i] = 0; }
      fft(re, im, tables);
      for (let k = 2; k < bins; k++) power[k] += (re[k] * re[k] + im[k] * im[k]) / channels.length;
    }
    for (let k = 2; k < bins; k++) {
      const magnitude = Math.log1p(4 * Math.sqrt(power[k]));
      if (frame) bands[band[k]][frame] += Math.max(0, magnitude - previous[k]);
      previous[k] = magnitude;
    }
    const progress = Math.floor(frame * 30 / frames);
    if (progress > reported) { reported = progress; report(progress / 30); }
  }
  return bands;
}

// Scale so that strong peaks sit near 1 (95th percentile of positive values).
function normalized(values) {
  const positive = [];
  for (let i = 0; i < values.length; i++) if (values[i] > 0) positive.push(values[i]);
  if (!positive.length) return null;
  positive.sort((a, b) => a - b);
  const scale = positive[Math.floor((positive.length - 1) * 0.95)];
  if (!(scale > 0)) return null;
  const result = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) result[i] = values[i] / scale;
  return result;
}

// Subtract a centered one-second local mean, then normalize.
function bandEnvelope(flux) {
  const count = flux.length, half = 50;
  const prefix = new Float64Array(count + 1);
  for (let i = 0; i < count; i++) prefix[i + 1] = prefix[i] + flux[i];
  const envelope = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const from = Math.max(0, i - half), to = Math.min(count, i + half + 1);
    envelope[i] = Math.max(0, flux[i] - (prefix[to] - prefix[from]) / (to - from));
  }
  return normalized(envelope);
}

// Each band is normalized on its own before mixing, so a kick drum counts as
// much as a broadband snare instead of being outvoted by the number of bins.
function onsetEnvelope(bands) {
  const weights = [1, 1, 0.3];
  const count = bands[0].length;
  const combined = new Float64Array(count);
  let any = false;
  for (let index = 0; index < bands.length; index++) {
    const envelope = bandEnvelope(bands[index]);
    if (!envelope) continue;
    any = true;
    for (let i = 0; i < count; i++) combined[i] += weights[index] * envelope[i];
  }
  return any ? normalized(combined) : null;
}

function pickPeaks(envelope, distance, floor) {
  const peaks = [];
  for (let i = 0; i < envelope.length; i++) {
    const value = envelope[i];
    if (value < floor) continue;
    let highest = true;
    for (let j = Math.max(0, i - distance); j <= Math.min(envelope.length - 1, i + distance); j++) {
      if (envelope[j] > value || (envelope[j] === value && j < i)) { highest = false; break; }
    }
    if (highest) peaks.push(i);
  }
  return peaks;
}

// Prior-weighted autocorrelation. The doubled tempo is returned as a second
// candidate when it is also clearly periodic; the caller decides between them
// by checking whether every faster beat really carries an attack.
function estimateTempo(envelope, frameSeconds) {
  const count = envelope.length;
  const minLag = Math.max(1, Math.round(60 / MAX_BPM / frameSeconds));
  const maxLag = Math.min(count - 1, Math.round(60 / MIN_BPM / frameSeconds));
  if (maxLag <= minLag) return null;
  let energy = 0;
  for (let i = 0; i < count; i++) energy += envelope[i] * envelope[i];
  if (!(energy > 0)) return null;
  const raw = new Float64Array(maxLag + 1), score = new Float64Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = lag; i < count; i++) sum += envelope[i] * envelope[i - lag];
    raw[lag] = sum / energy * count / (count - lag);
    const octaves = Math.log2(lag * frameSeconds / 0.5);
    score[lag] = raw[lag] * Math.exp(-0.5 * octaves * octaves);
  }
  const refine = (index) => {
    let lag = index;
    if (index > minLag && index < maxLag) {
      const a = raw[index - 1], b = raw[index], c = raw[index + 1], curve = a - 2 * b + c;
      if (curve < 0) lag = index + 0.5 * (a - c) / curve;
    }
    return { lag, periodicity: raw[index], score: score[index] };
  };
  let best = minLag;
  for (let lag = minLag + 1; lag <= maxLag; lag++) if (score[lag] > score[best]) best = lag;
  const doubled = Math.round(best / 2);
  let faster = null;
  if (doubled >= minLag) {
    let local = doubled;
    for (let lag = Math.max(minLag, doubled - 2); lag <= Math.min(maxLag, doubled + 2); lag++) {
      if (score[lag] > score[local]) local = lag;
    }
    if (score[local] >= 0.5 * score[best]) faster = refine(local);
  }
  return { best: refine(best), faster };
}

// One beat chain whose steps stay near the period unless an attack justifies
// moving. Silence before the first attack never starts the chain.
function dynamicBeats(envelope, period) {
  const count = envelope.length;
  const low = Math.max(1, Math.round(period / 2));
  const high = Math.max(low + 1, Math.round(period * 2));
  const penalty = new Float64Array(high + 1);
  for (let delta = low; delta <= high; delta++) {
    const ratio = Math.log(delta / period);
    penalty[delta] = TIGHTNESS * ratio * ratio;
  }
  let peak = 0;
  for (let i = 0; i < count; i++) if (envelope[i] > peak) peak = envelope[i];
  const cumulative = new Float64Array(count), back = new Int32Array(count).fill(-1);
  let started = false;
  for (let i = 0; i < count; i++) {
    if (!started && envelope[i] < 0.01 * peak) { cumulative[i] = envelope[i]; continue; }
    started = true;
    let best = -Infinity, from = -1;
    for (let delta = low; delta <= high; delta++) {
      const j = i - delta;
      if (j < 0) break;
      const value = cumulative[j] - penalty[delta];
      if (value > best) { best = value; from = j; }
    }
    cumulative[i] = envelope[i] + (from >= 0 ? best : 0);
    back[i] = from;
  }
  let tail = -1;
  for (let i = Math.max(0, count - Math.round(period * 2)); i < count; i++) {
    if (tail < 0 || cumulative[i] > cumulative[tail]) tail = i;
  }
  const beats = [];
  for (let i = tail; i >= 0; i = back[i]) beats.push(i);
  beats.reverse();
  return beats;
}

// Snap a frame to the rising edge inside its analysis window using 1 ms RMS
// blocks: the end of the first block above the half-rise level. A block end
// is never earlier than the attack that raised it; without a clear rise the
// typical attack position of a flux peak (three quarters in) is used.
function snapToAttack(frame, channels) {
  const block = Math.max(1, Math.round(RATE / 1000));
  const start = frame * HOP;
  const end = Math.min(channels[0].length, start + FFT_SIZE);
  const count = Math.floor((end - start) / block);
  const fallback = Math.min(end, start + FFT_SIZE * 0.75) / RATE;
  if (count < 2) return fallback;
  const rms = new Float64Array(count);
  let max = 0, maxAt = 0, min = Infinity;
  for (let b = 0; b < count; b++) {
    let power = 0;
    for (const channel of channels) {
      const offset = start + b * block;
      for (let i = 0; i < block; i++) { const value = channel[offset + i]; power += value * value; }
    }
    rms[b] = Math.sqrt(power / block / channels.length);
    if (rms[b] > max) { max = rms[b]; maxAt = b; }
    if (rms[b] < min) min = rms[b];
  }
  if (!(max > 0)) return fallback;
  const threshold = (min + max) / 2;
  let crossing = -1;
  for (let b = maxAt - 1; b >= 0; b--) if (rms[b] <= threshold) { crossing = b; break; }
  if (crossing < 0) return fallback;
  return (start + (crossing + 2) * block) / RATE;
}

function near(frames, frame, tolerance) {
  for (const candidate of frames) if (Math.abs(candidate - frame) <= tolerance) return true;
  return false;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// Track one tempo candidate: each grid beat takes the strongest attack frame
// within an eighth of a period.
function trackCandidate(envelope, lag) {
  const radius = Math.max(2, Math.round(lag / 8));
  return dynamicBeats(envelope, lag).map((frame) => {
    let best = frame;
    for (let j = Math.max(0, frame - radius); j <= Math.min(envelope.length - 1, frame + radius); j++) {
      if (envelope[j] > envelope[best]) best = j;
    }
    return { frame: best, strength: envelope[best] };
  });
}

// A half-tempo result cannot be repaired by thinning a draft, so the doubled
// tempo is preferred whenever both of its alternating beat sets carry real
// attacks; hats alone on the off-beats leave the slower tempo in place.
function chooseTracking(envelope, tempo) {
  const slow = { lag: tempo.best.lag, items: trackCandidate(envelope, tempo.best.lag) };
  if (!tempo.faster) return slow;
  const fast = { lag: tempo.faster.lag, items: trackCandidate(envelope, tempo.faster.lag) };
  const even = median(fast.items.filter((_, index) => index % 2 === 0).map((item) => item.strength));
  const odd = median(fast.items.filter((_, index) => index % 2 === 1).map((item) => item.strength));
  const weaker = Math.min(even, odd), stronger = Math.max(even, odd);
  return fast.items.length >= 8 && stronger > 0 && weaker >= 0.5 * stronger ? fast : slow;
}

function analyse(channels, report) {
  const duration = channels[0].length / RATE;
  const frameSeconds = HOP / RATE;
  const flux = spectralFlux(channels, (fraction) => report(fraction * 0.8));
  const envelope = onsetEnvelope(flux);
  if (!envelope) return { duration, bpm: null, confidence: 0, beats: [], tracked: false };
  const peaks = pickPeaks(envelope, 8, 0.3);
  const tempo = estimateTempo(envelope, frameSeconds);
  let frames = peaks, tracked = false, support = 0;
  if (tempo && peaks.length >= 4) {
    const { lag, items } = chooseTracking(envelope, tempo);
    // Grid beats without attack energy are dropped, never filled: an absolute
    // floor removes silence, and a local comparison (about four bars either
    // way) removes beats far weaker than their surroundings.
    const kept = [];
    for (let index = 0; index < items.length; index++) {
      const local = median(items.slice(Math.max(0, index - 8), index + 9).map((item) => item.strength));
      if (items[index].strength >= Math.max(0.05, 0.1 * local)) kept.push(items[index].frame);
    }
    const tolerance = Math.max(2, Math.round(lag / 4));
    const strong = peaks.filter((peak) => envelope[peak] >= 0.5);
    const explained = strong.length ? strong.filter((peak) => near(kept, peak, tolerance)).length / strong.length : 0;
    const supported = kept.length ? kept.filter((frame) => near(peaks, frame, tolerance)).length / kept.length : 0;
    support = Math.min(explained, supported);
    if (kept.length >= 4 && support >= 0.5) { frames = kept; tracked = true; }
  }
  report(0.85);
  const beats = [];
  for (const frame of frames) {
    const time = snapToAttack(frame, channels);
    if (!(time >= 0) || time > duration) continue;
    if (beats.length && time <= beats[beats.length - 1]) continue;
    if (beats.length >= MAX_BEATS) throw new Error('Too many detected attacks.');
    beats.push(time);
  }
  report(0.95);
  const intervals = [];
  for (let index = 1; index < beats.length; index++) {
    const interval = beats[index] - beats[index - 1];
    if (interval >= 60 / 220 && interval <= 60 / 40) intervals.push(interval);
  }
  let bpm = null, confidence = 0;
  if (intervals.length >= 4) {
    const sorted = [...intervals].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    bpm = Math.max(40, Math.min(220, Math.round(60 / median)));
    const errors = intervals.map((interval) => Math.abs(interval - median) / median);
    const agreement = errors.filter((error) => error <= 0.08).length / errors.length;
    const meanError = errors.reduce((sum, error) => sum + Math.min(1, error), 0) / errors.length;
    confidence = tracked
      ? agreement * Math.min(1, support / 0.8)
      : agreement * (1 - meanError * 3);
    confidence = Math.max(0, Math.min(1, confidence));
  }
  return { duration, bpm, confidence, beats, tracked };
}

self.onmessage = (event) => {
  try {
    const data = event.data;
    if (!data || data.type !== 'analyse' || data.sampleRate !== RATE ||
        !Array.isArray(data.channels) || data.channels.length < 1 || data.channels.length > 2) {
      throw new Error('Invalid rhythm-analysis input.');
    }
    const channels = data.channels.map((buffer) => {
      if (!buffer || Object.prototype.toString.call(buffer) !== '[object ArrayBuffer]' ||
          typeof buffer.byteLength !== 'number' || buffer.byteLength % 4 !== 0)
        throw new Error('Invalid audio channel.');
      return new Float32Array(buffer);
    });
    const length = channels[0].length;
    if (!length || length > MAX_SAMPLES || channels.some((channel) => channel.length !== length))
      throw new Error('Audio exceeds the rhythm-analysis limits.');
    for (const channel of channels) {
      for (let i = 0; i < length; i++) if (!Number.isFinite(channel[i])) channel[i] = 0;
    }
    let lastProgress = 0;
    const result = analyse(channels, (fraction) => {
      const progress = Math.floor(Math.max(0, Math.min(0.98, fraction)) * 50) / 50;
      if (progress > lastProgress) {
        lastProgress = progress;
        self.postMessage({ type: 'progress', fraction: progress });
      }
    });
    self.postMessage({ type: 'result', result: {
      duration: result.duration, bpm: result.bpm, confidence: result.confidence, beats: result.beats,
    }, tracked: result.tracked });
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Rhythm analysis failed.' });
  }
};
`;

type AnalyseOptions = {
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
};
const abortError = () =>
  new DOMException("Song analysis was cancelled.", "AbortError");

/** Decode locally, then analyse faster than playback in a disposable worker. */
export async function analyseSongRhythm(
  file: File,
  { signal, onProgress }: AnalyseOptions = {},
): Promise<RhythmAnalysis> {
  if (signal?.aborted) throw abortError();
  if (
    !file ||
    !Number.isFinite(file.size) ||
    file.size <= 0 ||
    file.size > MAX_ANALYSIS_FILE_BYTES
  )
    throw new Error(
      "Choose a non-empty audio file up to 100 MB for rhythm analysis.",
    );
  if (
    typeof OfflineAudioContext === "undefined" ||
    typeof Worker === "undefined"
  )
    throw new Error("Local rhythm analysis is unavailable in this browser.");

  return new Promise<RhythmAnalysis>((resolve, reject) => {
    let settled = false;
    let worker: Worker | null = null;
    let workerUrl: string | null = null;
    let lastProgress = -1;
    const reportProgress = (fraction: number) => {
      if (
        settled ||
        !Number.isFinite(fraction) ||
        fraction < 0 ||
        fraction > 1 ||
        fraction <= lastProgress
      )
        return;
      lastProgress = fraction;
      try {
        onProgress?.(fraction);
      } catch {
        /* A view cannot interrupt cleanup. */
      }
    };
    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      if (worker) {
        worker.onmessage = worker.onerror = worker.onmessageerror = null;
        worker.terminate();
        worker = null;
      }
      if (workerUrl) {
        URL.revokeObjectURL(workerUrl);
        workerUrl = null;
      }
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        error instanceof Error
          ? error
          : new Error("Song rhythm analysis failed."),
      );
    };
    const onAbort = () => fail(abortError());
    const timeout = setTimeout(
      () =>
        fail(new Error("Song analysis timed out. Try a shorter audio file.")),
      120000,
    );
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();

    void (async () => {
      try {
        if (settled) return;
        reportProgress(0);
        if (settled) return;
        const encoded = await file.arrayBuffer();
        if (settled) return;
        if (encoded.byteLength > MAX_ANALYSIS_FILE_BYTES)
          throw new Error("Audio data exceeds the 100 MB analysis limit.");
        reportProgress(0.1);
        if (settled) return;
        // decodeAudioData resamples to the context rate. Offline contexts have
        // no close() or audible destination; no rendering is started here.
        let context: OfflineAudioContext | null = new OfflineAudioContext(
          2,
          1,
          ANALYSIS_SAMPLE_RATE,
        );
        let decoded: AudioBuffer | null =
          await context.decodeAudioData(encoded);
        context = null;
        if (settled) return;
        if (
          !Number.isFinite(decoded.duration) ||
          decoded.duration <= 0 ||
          decoded.duration > MAX_ANALYSIS_SECONDS ||
          decoded.sampleRate !== ANALYSIS_SAMPLE_RATE ||
          !Number.isInteger(decoded.length) ||
          decoded.length <= 0 ||
          decoded.length > MAX_ANALYSIS_SAMPLES ||
          Math.abs(decoded.duration - decoded.length / decoded.sampleRate) >
            1 / ANALYSIS_SAMPLE_RATE ||
          !Number.isInteger(decoded.numberOfChannels) ||
          decoded.numberOfChannels < 1 ||
          decoded.numberOfChannels > 2
        )
          throw new Error("Analyse mono/stereo songs up to 10 minutes long.");
        const decodedDuration = decoded.duration;
        const decodedSampleRate = decoded.sampleRate;
        const channels: ArrayBuffer[] = [];
        for (let index = 0; index < decoded.numberOfChannels; index++) {
          const channel = decoded.getChannelData(index);
          if (channel.length !== decoded.length)
            throw new Error("The decoded audio channels are inconsistent.");
          channels.push(channel.slice().buffer);
        }
        decoded = null;
        if (settled) return;
        reportProgress(0.2);
        if (settled) return;
        workerUrl = URL.createObjectURL(
          new Blob([rhythmWorkerSource], { type: "application/javascript" }),
        );
        worker = new Worker(workerUrl);
        worker.onmessage = (event: MessageEvent<unknown>) => {
          if (settled) return;
          const data = event.data as {
            type?: unknown;
            fraction?: unknown;
            result?: unknown;
            message?: unknown;
          } | null;
          if (!data || typeof data !== "object") {
            fail(new Error("Invalid rhythm-analysis response."));
            return;
          }
          if (data.type === "progress") {
            if (
              typeof data.fraction === "number" &&
              data.fraction >= 0 &&
              data.fraction <= 1
            )
              reportProgress(0.2 + data.fraction * 0.8);
          } else if (data.type === "result") {
            if (
              !validateRhythmAnalysis(data.result) ||
              Math.abs(data.result.duration - decodedDuration) >
                1 / ANALYSIS_SAMPLE_RATE
            ) {
              fail(new Error("The rhythm-analysis result was invalid."));
              return;
            }
            const result = {
              duration: data.result.duration,
              bpm: data.result.bpm,
              confidence: data.result.confidence,
              beats: [...data.result.beats],
            };
            reportProgress(1);
            if (settled) return;
            settled = true;
            cleanup();
            resolve(result);
          } else if (data.type === "error") {
            fail(
              new Error(
                typeof data.message === "string"
                  ? data.message.slice(0, 200)
                  : "Song rhythm analysis failed.",
              ),
            );
          } else fail(new Error("Unexpected rhythm-analysis response."));
        };
        worker.onerror = (event) => {
          event.preventDefault?.();
          fail(
            new Error(
              event.message || "The local rhythm-analysis worker failed.",
            ),
          );
        };
        worker.onmessageerror = () =>
          fail(new Error("The rhythm-analysis result could not be read."));
        worker.postMessage(
          { type: "analyse", sampleRate: decodedSampleRate, channels },
          channels,
        );
      } catch (error) {
        fail(error);
      }
    })();
  });
}
