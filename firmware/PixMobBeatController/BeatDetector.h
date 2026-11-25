#pragma once

#include <cmath>
#include <cstddef>
#include <cstdint>

// Standalone onset detector, independent of Arduino, IR, clocks and I/O.
// Inputs are INMP441-style signed 24-bit samples, MSB aligned in int32_t.
// It detects bass onsets; it never generates beats from a tempo or timer.
class BeatDetector {
 public:
  struct Result {
    float level16;
    float threshold16;
    bool beat;
    float full16;
    float bassFraction;
  };

  explicit BeatDetector(float sampleRate = 16000.0f)
      : rate_(sampleRate > 0 ? sampleRate : 16000.0f),
        highPass_(std::exp(-2.0f * pi_ * 35.0f / rate_)),
        fullHighPass_(std::exp(-2.0f * pi_ * 5.0f / rate_)),
        lowPass_(1.0f - std::exp(-2.0f * pi_ * 200.0f / rate_)) {}

  void setSensitivity(float ratio) {
    if (std::isfinite(ratio)) ratio_ = clamp(ratio, 1.10f, 2.50f);
  }
  float sensitivity() const { return ratio_; }
  void reset() {
    started_ = false;
    hasBeat_ = false;
    armed_ = true;
    previousInput_ = highState_ = fullState_ = lowState_ = 0;
    fast_ = baseline_ = deviation_ = noise_ = bassPower_ = fullPower_ = 0;
    candidateFrames_ = 0;
    startedAt_ = lastBeat_ = 0;
  }

  Result process(const int32_t* samples, size_t count, uint32_t frameEndMs) {
    if (!samples || count == 0) return {fast_ * 32768.0f, threshold() * 32768.0f, false, 0, 0};
    double square = 0, fullSquare = 0;
    // Start from the present input DC level rather than synthesizing an edge
    // from zero when the detector is enabled on an already running microphone.
    if (!started_) previousInput_ = static_cast<float>(samples[0] >> 8) / 8388608.0f;
    for (size_t i = 0; i < count; ++i) {
      const float input = static_cast<float>(samples[i] >> 8) / 8388608.0f;
      highState_ = highPass_ * (highState_ + input - previousInput_);
      fullState_ = fullHighPass_ * (fullState_ + input - previousInput_);
      previousInput_ = input;
      lowState_ += lowPass_ * (highState_ - lowState_);
      square += static_cast<double>(lowState_) * lowState_;
      fullSquare += static_cast<double>(fullState_) * fullState_;
    }
    const float energy = clamp(static_cast<float>(std::sqrt(square / count)), 0, 1);
    const float fullEnergy = clamp(static_cast<float>(std::sqrt(fullSquare / count)), 0, 1);
    const float seconds = static_cast<float>(count) / rate_;
    if (!started_) {
      started_ = true;
      startedAt_ = frameEndMs;
      fast_ = baseline_ = noise_ = energy;
      bassPower_ = energy * energy;
      fullPower_ = fullEnergy * fullEnergy;
    }
    const float previousFast = fast_;
    fast_ += (1.0f - std::exp(-seconds / 0.025f)) * (energy - fast_);
    const float powerAlpha = 1.0f - std::exp(-seconds / 0.032f);
    bassPower_ += powerAlpha * (energy * energy - bassPower_);
    fullPower_ += powerAlpha * (fullEnergy * fullEnergy - fullPower_);
    const float fraction = fullPower_ > 1e-12f ? clamp(bassPower_ / fullPower_, 0, 1) : 0;
    const float trigger = threshold();
    const bool warming = static_cast<uint32_t>(frameEndMs - startedAt_) < 1000;
    if (fast_ < trigger * 0.72f) armed_ = true;
    const float rise = fast_ - previousFast;
    const bool validEnergy = fast_ > trigger && energy > trigger * 0.72f && fraction >= 0.12f;
    const bool ready = !warming && armed_ &&
      (!hasBeat_ || static_cast<uint32_t>(frameEndMs - lastBeat_) >= 180);
    if (!ready || !validEnergy) candidateFrames_ = 0;
    else if (candidateFrames_ > 0 || rise > larger(0.00008f, baseline_ * 0.06f))
      ++candidateFrames_;
    const bool onset = candidateFrames_ >= 2;
    if (onset) {
      armed_ = false;
      hasBeat_ = true;
      lastBeat_ = frameEndMs;
      candidateFrames_ = 0;
    }
    // Estimate the lower/background envelope, with fast release and slow rise.
    // Large onsets cannot immediately redefine that background as silence.
    const float noiseSeconds = warming ? 0.15f : (fast_ < noise_ ? 0.25f : 5.0f);
    noise_ += (1.0f - std::exp(-seconds / noiseSeconds)) * (fast_ - noise_);
    // Limit peak contamination so a loud kick does not mask a following softer
    // kick. Sustained energy can still raise the reference over successive frames.
    const float limit = larger(baseline_ * 1.5f, noise_ * 2.0f + 0.00075f);
    const float tracked = !warming && energy > limit ? limit : energy;
    const float delta = std::fabs(tracked - baseline_);
    deviation_ += (1.0f - std::exp(-seconds / 0.75f)) * (delta - deviation_);
    baseline_ += (1.0f - std::exp(-seconds / 0.65f)) * (tracked - baseline_);
    return {fast_ * 32768.0f, trigger * 32768.0f, onset, fullEnergy * 32768.0f, fraction};
  }

 private:
  static constexpr float pi_ = 3.14159265358979323846f;
  static float clamp(float v, float lo, float hi) { return v < lo ? lo : (v > hi ? hi : v); }
  static float larger(float a, float b) { return a > b ? a : b; }
  float threshold() const {
    // Absolute silence floor plus a local mean and variability estimate. The
    // reported threshold is the actual threshold used, in the legacy wire scale.
    const float noiseMultiplier = 1.8f + 1.6f * (ratio_ - 1.10f);
    return clamp(larger(larger(0.00075f, noise_ * noiseMultiplier),
      larger(baseline_ * ratio_, baseline_ + deviation_ * (ratio_ - 1.0f) * 3.5f)), 0, 2.5f);
  }
  const float rate_, highPass_, fullHighPass_, lowPass_;
  float ratio_ = 1.35f;
  float previousInput_ = 0, highState_ = 0, fullState_ = 0, lowState_ = 0;
  float fast_ = 0, baseline_ = 0, deviation_ = 0;
  float noise_ = 0, bassPower_ = 0, fullPower_ = 0;
  uint32_t startedAt_ = 0, lastBeat_ = 0;
  bool started_ = false, hasBeat_ = false, armed_ = true;
  uint8_t candidateFrames_ = 0;
};
