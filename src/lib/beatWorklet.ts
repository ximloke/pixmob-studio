/** Audio-thread onsets are independent of the slower spectrum animation. */
export const beatWorkletSource = String.raw`
class PixMobClock extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sensitivity = 60;
    this.automatic = false;
    this.effectiveSensitivity = 60;
    this.tempoConfidence = 0;
    this.onsetIntervals = [];
    this.fullReference = 0;
    this.hopSize = Math.max(1, Math.round(sampleRate * 0.005));
    this.hopFrames = 0;
    this.visualFrames = 0;
    this.fullPower = 0;
    this.bassPower = 0;
    this.bodyPower = 0;
    this.channels = [];
    this.bass = this.bandState();
    this.body = this.bandState();
    this.pending = null;
    this.lastOnset = -Infinity;
    this.elapsedFrames = 0;
    this.port.onmessage = (event) => {
      const data = event.data;
      if (data && data.type === 'sensitivity' && Number.isFinite(data.value)) {
        this.sensitivity = Math.max(0, Math.min(100, data.value));
      } else if (data && data.type === 'autoSensitivity' && typeof data.enabled === 'boolean') {
        if (data.enabled !== this.automatic) {
          this.automatic = data.enabled;
          this.pending = null;
          this.fullReference = 0;
          this.onsetIntervals = [];
          this.tempoConfidence = 0;
        }
      }
    };
  }

  bandState() {
    return {
      fast: 0, average: 0, deviation: 0, armed: true, release: 0,
      history: new Float32Array(160), historyIndex: 0, historyCount: 0,
      low: 0, high: 0,
    };
  }

  learnBand(state, rms) {
    state.history[state.historyIndex] = rms;
    state.historyIndex = (state.historyIndex + 1) % state.history.length;
    state.historyCount = Math.min(state.historyCount + 1, state.history.length);
    // Quantiles describe the most recent 800 ms, so a new quieter track does
    // not inherit a loud track's threshold indefinitely. No audio is stored.
    if (state.historyCount < 8 || state.historyIndex % 8 !== 0) return;
    const sorted = Array.from(state.history.subarray(0, state.historyCount)).sort((a, b) => a - b);
    state.low = sorted[Math.floor((sorted.length - 1) * 0.2)];
    state.high = sorted[Math.floor((sorted.length - 1) * 0.95)];
  }

  autoFloor(state, body) {
    const reactivity = this.effectiveSensitivity / 100;
    return Math.max(body ? 0.0002 : 0.00015,
      state.low * (body ? 1.5 : 1.3),
      state.high * (body ? 0.36 + (1 - reactivity) * 0.4 : 0.15 + (1 - reactivity) * 0.2));
  }

  observeTempo(audioTime) {
    const interval = audioTime - this.lastOnset;
    if (interval > 2) this.onsetIntervals = [];
    if (interval >= 0.25 && interval <= 1.5) this.onsetIntervals.push(interval);
    this.onsetIntervals = this.onsetIntervals.slice(-8);
    if (this.onsetIntervals.length < 4) { this.tempoConfidence = 0; return; }
    const sorted = [...this.onsetIntervals].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const error = this.onsetIntervals.reduce((sum, value) => sum + Math.min(1, Math.abs(value - median) / median), 0) / this.onsetIntervals.length;
    this.tempoConfidence = Math.max(0, Math.min(1, 1 - error * 5));
  }

  metadata(audioTime) {
    return {
      automatic: this.automatic,
      effectiveSensitivity: this.automatic ? this.effectiveSensitivity : this.sensitivity,
      tempoConfidence: audioTime - this.lastOnset < 2 ? this.tempoConfidence : 0,
    };
  }

  filter(type, frequency) {
    const omega = 2 * Math.PI * frequency / sampleRate;
    const cosine = Math.cos(omega);
    const alpha = Math.sin(omega) / Math.SQRT2;
    const a0 = 1 + alpha;
    const high = type === 'high';
    const b0 = (1 + (high ? cosine : -cosine)) / 2 / a0;
    return {
      b0, b1: (high ? -2 : 2) * b0, b2: b0,
      a1: -2 * cosine / a0, a2: (1 - alpha) / a0,
      z1: 0, z2: 0,
    };
  }

  sample(filter, value) {
    const result = filter.b0 * value + filter.z1;
    filter.z1 = filter.b1 * value - filter.a1 * result + filter.z2;
    filter.z2 = filter.b2 * value - filter.a2 * result;
    return result;
  }

  channel(firstSample) {
    const high = this.filter('high', 35);
    // Start the DC blocker at its steady state, avoiding a connection pop.
    high.z1 = -high.b0 * firstSample;
    high.z2 = high.b2 * firstSample;
    return {
      high,
      bass: this.filter('low', 220),
      bodyHigh: this.filter('high', 220),
      bodyLow: this.filter('low', 2000),
    };
  }

  bandWindow(state, rms, floor, dt) {
    const previous = state.fast;
    const timeConstant = rms > previous ? 0.004 : 0.025;
    state.fast += (rms - state.fast) * (1 - Math.exp(-dt / timeConstant));
    const rising = state.fast - previous > Math.max(floor * 0.12, state.fast * 0.07);
    if (!state.armed) {
      // A held pad need not fall to silence before a much stronger drum can
      // arrive. Otherwise the first quiet capture transient could lock it out.
      if (state.fast < state.release ||
          (rising && state.fast > state.release / 0.65 * 1.5)) state.armed = true;
      else state.release = Math.max(state.release, state.fast * 0.65);
    }
    const contrast = Math.max(floor * 0.45, state.average * 0.3, state.deviation * 1.2);
    const threshold = Math.max(floor, state.average + contrast);
    const result = { rms, fast: state.fast, threshold, rising };
    const oldAverage = state.average;
    state.average += (state.fast - state.average) * (1 - Math.exp(-dt / 0.35));
    // Let the contrast penalty recover before a quieter following drum; a
    // long memory of one loud hit otherwise masks real dynamic variations.
    state.deviation += (Math.abs(state.fast - oldAverage) - state.deviation) * (1 - Math.exp(-dt / 0.12));
    return result;
  }

  analyseWindow(audioTime) {
    const full = Math.sqrt(this.fullPower / this.hopFrames);
    const bassRms = Math.sqrt(this.bassPower / this.hopFrames);
    const bodyRms = Math.sqrt(this.bodyPower / this.hopFrames);
    const dt = this.hopFrames / sampleRate;
    if (this.automatic) {
      this.learnBand(this.bass, bassRms);
      this.learnBand(this.body, bodyRms);
      const peak = Math.max(this.bass.high, this.body.high, 0.0002);
      const background = Math.max(this.bass.low, this.body.low);
      this.effectiveSensitivity = Math.round(Math.max(20, Math.min(90, 85 - background / peak * 65)));
    }
    const sensitivity = this.sensitivity / 100;
    const bassFloor = this.automatic ? this.autoFloor(this.bass, false) : 0.007 + (1 - sensitivity) * 0.008;
    const bodyFloor = this.automatic ? this.autoFloor(this.body, true) : 0.009 + (1 - sensitivity) * 0.012;
    const fullFloor = this.automatic ? 0.0004 : 0.003;
    if (this.automatic) {
      // Kicks and snares share a full-band reference. Separate body statistics
      // alone can forget a snare between slow beats and promote a weaker hat.
      this.fullReference = Math.max(full, this.fullReference * Math.exp(-dt / 1.4));
      // A long gap in accepted attacks may mean the next song is much quieter.
      // Rebase the reference, never synthesize an onset to fill that gap.
      if (audioTime - this.lastOnset > 0.85) this.fullReference = Math.min(this.fullReference, full * 2);
    }
    const prominent = !this.automatic || full >= this.fullReference * 0.42;
    const bass = this.bandWindow(this.bass, bassRms, bassFloor, dt);
    const body = this.bandWindow(this.body, bodyRms, bodyFloor, dt);
    const fullSquared = full * full + 1e-12;
    const bassFraction = bassRms * bassRms / fullSquared;
    const bodyFraction = bodyRms * bodyRms / fullSquared;
    let emitted = false;

    if (this.pending) {
      const pending = this.pending;
      const window = pending.band === 'bass' ? bass : body;
      const state = this[pending.band];
      // A second populated window rejects an isolated click. No future beat
      // is ever generated from a tempo estimate or from this pending state.
      if (state.armed && prominent && full > fullFloor && full > pending.full * 0.2 &&
          window.rms > pending.rms * 0.35 &&
          window.fast > window.threshold * 0.85 &&
          audioTime - this.lastOnset >= 0.22) {
        const strength = Math.max(0, Math.min(1,
          (window.fast - state.average) / Math.max(window.threshold, 0.001)));
        this.observeTempo(audioTime);
        this.port.postMessage({
          type: 'onset', audioTime,
          level: Math.max(0, Math.min(1, full * 5)), strength,
          ...this.metadata(audioTime),
        });
        this.lastOnset = audioTime;
        for (const name of ['bass', 'body']) {
          const activeWindow = name === 'bass' ? bass : body;
          if (activeWindow.fast > activeWindow.threshold * 0.85) {
            this[name].armed = false;
            this[name].release = activeWindow.fast * 0.65;
          }
        }
        emitted = true;
      }
      this.pending = null;
    }

    if (!emitted && prominent && audioTime - this.lastOnset >= 0.22 && full > fullFloor) {
      const bassCandidate = this.bass.armed && bass.rising &&
        bass.fast > bass.threshold && bassFraction > 0.18;
      const bodyCandidate = this.body.armed && body.rising &&
        body.fast > body.threshold && bodyFraction > (this.automatic ? 0.2 : 0.12);
      // Treble alone cannot open the gate; hats should not double the tempo.
      if (bassCandidate || bodyCandidate) {
        const band = bassCandidate && (!bodyCandidate ||
          bass.fast / bass.threshold >= body.fast / body.threshold) ? 'bass' : 'body';
        this.pending = { band, full, rms: band === 'bass' ? bassRms : bodyRms };
      }
    }
    this.hopFrames = 0;
    this.fullPower = this.bassPower = this.bodyPower = 0;
  }

  process(inputs, outputs) {
    for (const output of outputs) for (const channel of output) channel.fill(0);
    const input = inputs[0] || [];
    const length = input[0]?.length || outputs[0]?.[0]?.length || 128;
    const blockTime = typeof currentFrame === 'number' ? currentFrame / sampleRate :
      (typeof currentTime === 'number' ? currentTime : this.elapsedFrames / sampleRate);
    for (let index = 0; index < length; index++) {
      let fullPower = 0;
      let bassPower = 0;
      let bodyPower = 0;
      for (let number = 0; number < input.length; number++) {
        const raw = Number.isFinite(input[number][index]) ? input[number][index] : 0;
        const state = this.channels[number] || (this.channels[number] = this.channel(raw));
        const full = this.sample(state.high, raw);
        const bass = this.sample(state.bass, full);
        const body = this.sample(state.bodyLow, this.sample(state.bodyHigh, full));
        // Average channel powers, never waveforms: opposite stereo phases
        // still carry the same drum energy.
        fullPower += full * full;
        bassPower += bass * bass;
        bodyPower += body * body;
      }
      const channels = Math.max(1, input.length);
      this.fullPower += fullPower / channels;
      this.bassPower += bassPower / channels;
      this.bodyPower += bodyPower / channels;
      this.hopFrames++;
      this.visualFrames++;
      const audioTime = blockTime + (index + 1) / sampleRate;
      if (this.hopFrames >= this.hopSize) this.analyseWindow(audioTime);
      if (this.visualFrames >= sampleRate / 30) {
        this.visualFrames -= sampleRate / 30;
        this.port.postMessage({ type: 'tick', audioTime, ...this.metadata(audioTime) });
      }
    }
    this.elapsedFrames += length;
    return true;
  }
}
registerProcessor('pixmob-clock', PixMobClock);
`;
