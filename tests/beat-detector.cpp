#include "../firmware/PixMobBeatController/BeatDetector.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <functional>
#include <iostream>
#include <limits>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
constexpr uint32_t kRate = 16000;
constexpr size_t kFrame = 256;
constexpr double kPi = 3.14159265358979323846;

void require(bool condition, const std::string &message) {
  if (!condition) throw std::runtime_error(message);
}

struct Observation {
  std::vector<uint32_t> beats;
  float highestLevel = 0;
  float highestThreshold = 0;
};

template <typename Signal>
Observation simulate(uint32_t durationMs, Signal signal, float sensitivity = 1.35f) {
  BeatDetector detector(static_cast<float>(kRate));
  detector.setSensitivity(sensitivity);
  Observation result;
  std::array<int32_t, kFrame> frame{};
  const uint64_t sampleCount = static_cast<uint64_t>(durationMs) * kRate / 1000;
  for (uint64_t first = 0; first < sampleCount; first += kFrame) {
    for (size_t i = 0; i < frame.size(); ++i) {
      const uint64_t index = first + i;
      const double value = std::clamp(signal(static_cast<double>(index) / kRate, index), -0.98, 0.98);
      // INMP441 samples are signed, MSB-aligned in the 32-bit I2S slot.
      frame[i] = static_cast<int32_t>(std::llround(value * std::numeric_limits<int32_t>::max()));
    }
    const uint32_t endMs = static_cast<uint32_t>((first + kFrame) * 1000 / kRate);
    const auto sample = detector.process(frame.data(), frame.size(), endMs);
    require(std::isfinite(sample.level16) && sample.level16 >= 0 && sample.level16 <= 32768,
            "level must stay finite within signed 16-bit mean-absolute range");
    require(std::isfinite(sample.threshold16) && sample.threshold16 >= 0 && sample.threshold16 <= 81920,
            "threshold must stay finite and within the configured ratio range");
    require(std::isfinite(sample.full16) && sample.full16 >= 0 && sample.full16 <= 32768,
            "full-band RMS diagnostic must stay finite within the normalized wire scale");
    require(std::isfinite(sample.bassFraction) && sample.bassFraction >= 0 && sample.bassFraction <= 1,
            "bass power fraction diagnostic must remain finite within zero to one");
    result.highestLevel = std::max(result.highestLevel, sample.level16);
    result.highestThreshold = std::max(result.highestThreshold, sample.threshold16);
    if (sample.beat) result.beats.push_back(endMs);
  }
  return result;
}

double noise(uint64_t index) {
  uint32_t value = static_cast<uint32_t>(index) + 0x9e3779b9u;
  value ^= value >> 16;
  value *= 0x7feb352du;
  value ^= value >> 15;
  value *= 0x846ca68bu;
  value ^= value >> 16;
  return static_cast<double>(value) / std::numeric_limits<uint32_t>::max() * 2.0 - 1.0;
}

double kick(double time, double onset, double amplitude) {
  const double age = time - onset;
  if (age < 0 || age > 0.24) return 0;
  const double envelope = (1.0 - std::exp(-age / 0.002)) * std::exp(-age / 0.050);
  return amplitude * envelope * std::sin(2.0 * kPi * 75.0 * age);
}

void printBeats(const std::string &label, const Observation &result) {
  std::cout << label << " beats=" << result.beats.size() << " at";
  for (auto time : result.beats) std::cout << ' ' << time;
  std::cout << " ms\n";
}

void silenceDoesNotMakeBeats() {
  const auto result = simulate(8000, [](double, uint64_t) { return 0.0; });
  printBeats("silence", result);
  require(result.beats.empty(), "silence generated a beat without an audio onset");
  require(result.highestLevel == 0, "silence should have zero measured level");
}

void dcAndSmallNoiseDoNotMakePeriodicBeats() {
  const auto result = simulate(8000, [](double, uint64_t index) {
    return 0.35 + 0.00005 * noise(index);
  });
  printBeats("DC + low noise", result);
  require(result.beats.empty(), "DC offset/quiet noise generated recurring beat triggers");
}

void broadbandBurstsAreNotBassOnsets() {
  const std::vector<double> starts{1.35, 2.03, 2.81, 3.47, 4.36, 5.29};
  const auto result = simulate(6500, [&](double time, uint64_t index) {
    for (double onset : starts)
      if (time >= onset && time < onset + 0.080)
        return 0.80 * noise(index);
    return 0.00005 * noise(index);
  });
  printBeats("full-band noise bursts", result);
  require(result.beats.empty(), "broadband noise bursts were mistaken for bass onsets");
}

void highFrequencyBurstsDoNotBecomeBassThroughFilterLeakage() {
  const std::array<double, 12> frequencies{830, 1171, 1499, 2017, 2531, 3109,
                                            3673, 4211, 4777, 5237, 6011, 7121};
  const std::vector<double> starts{1.31, 2.07, 2.78, 3.61, 4.53};
  const auto result = simulate(6000, [&](double time, uint64_t index) {
    bool active = false;
    for (double onset : starts)
      active = active || (time >= onset && time < onset + 0.120);
    if (!active) return 0.00005 * noise(index);
    double value = 0;
    for (size_t i = 0; i < frequencies.size(); ++i)
      value += std::sin(2.0 * kPi * frequencies[i] * time + i * 0.73);
    return value * 0.30 / std::sqrt(static_cast<double>(frequencies.size()));
  });
  printBeats("830–7121 Hz noise-like bursts", result);
  require(result.beats.empty(), "high-frequency burst leakage triggered a bass beat");
}

void strongNoiseAndDcChangesDoNotCreateRhythmicPulses() {
  const auto result = simulate(8000, [](double time, uint64_t index) {
    const double dc = time < 2.13 ? 0.20 : 0.43;
    const bool louder = (time >= 3.01 && time < 3.24) ||
                        (time >= 4.37 && time < 4.71) ||
                        (time >= 5.83 && time < 6.02);
    return dc + (louder ? 0.55 : 0.20) * noise(index);
  });
  printBeats("DC changes + strong broadband noise", result);
  require(result.beats.empty(), "DC/noise amplitude changes produced a false musical beat");
}

void isolatedBroadbandEdgesDoNotCreateRepeatedBeats() {
  const std::array<uint64_t, 6> starts{
      1323 * kRate / 1000 + 3, 2071 * kRate / 1000 + 7,
      2837 * kRate / 1000 + 13, 3619 * kRate / 1000 + 1,
      4431 * kRate / 1000 + 11, 5267 * kRate / 1000 + 5};
  const auto result = simulate(6500, [&](double, uint64_t index) {
    for (size_t pulse = 0; pulse < starts.size(); ++pulse) {
      if (index < starts[pulse]) continue;
      const uint64_t age = index - starts[pulse];
      if (pulse % 3 == 0 && age == 0) return 0.95;
      if (pulse % 3 == 1 && age < 16) return age < 8 ? 0.90 : -0.90;
      if (pulse % 3 == 2 && age < 24) return 0.95 * noise(index);
    }
    return 0.00005 * noise(index);
  });
  printBeats("single-sample and 1 ms broadband transients", result);
  require(result.beats.empty(), "short broadband edges produced a false bass-onset sequence");
}

void aliasedCarrierPacketsDoNotBecomeBassOnsets() {
  // This is an adverse synthetic signal, not a claim about this board's fault.
  // A 38 kHz carrier sampled at 16 kHz aliases to 6 kHz; packet edges also
  // include short broadband transients. Quiet gaps contain no actual bass hit.
  const std::vector<double> starts{1.30, 1.45, 1.60, 2.37, 2.52, 2.67,
                                   3.83, 3.98, 4.13, 5.17};
  const auto result = simulate(6500, [&](double time, uint64_t index) {
    double value = 0.00005 * noise(index);
    for (double onset : starts) {
      const double age = time - onset;
      if (age >= 0 && age < 0.0273)
        value += 0.70 * std::sin(2.0 * kPi * 38000.0 * age);
      if ((age >= 0 && age < 0.001) ||
          (age >= 0.0273 && age < 0.0283))
        value += 0.25 * noise(index);
    }
    return value;
  });
  printBeats("aliased carrier packets + broadband edges", result);
  require(result.beats.empty(), "carrier-like artifacts were mistaken for acoustic bass onsets");
}

void heldToneDoesNotRetrigger() {
  const auto result = simulate(7000, [](double time, uint64_t index) {
    if (time < 1.2) return 0.00002 * noise(index);
    return 0.25 * std::sin(2.0 * kPi * 90.0 * (time - 1.2));
  });
  printBeats("held 90 Hz tone", result);
  require(result.beats.size() <= 1, "a held tone repeatedly triggered after its initial onset");
  require(result.beats.empty() || result.beats.front() <= 1450,
          "a held tone produced a late artificial beat");
}

void irregularKicksFollowOnsetsInsteadOfAClock() {
  const std::vector<uint32_t> onsets{1200, 1730, 2120, 2900, 3220, 3830, 4390};
  const auto result = simulate(5400, [&](double time, uint64_t index) {
    double value = 0.00005 * noise(index);
    for (auto onset : onsets) value += kick(time, onset / 1000.0, 0.55);
    return value;
  });
  printBeats("irregular bass kicks", result);
  require(result.beats.size() >= onsets.size() - 1 && result.beats.size() <= onsets.size(),
          "irregular kicks did not produce approximately one event per onset");
  std::set<size_t> matchedOnsets;
  for (auto detected : result.beats) {
    bool matched = false;
    for (size_t i = 0; i < onsets.size(); ++i) {
      if (detected + 16 >= onsets[i] && detected <= onsets[i] + 144) {
        require(matchedOnsets.insert(i).second, "one kick produced multiple beat events");
        matched = true;
        break;
      }
    }
    require(matched, "a beat occurred outside the acoustic onset windows");
  }
  std::set<uint32_t> intervals;
  for (size_t i = 1; i < result.beats.size(); ++i)
    intervals.insert(result.beats[i] - result.beats[i - 1]);
  require(intervals.size() >= 4, "irregular onsets were reduced to a repeating beat interval");
  require(*intervals.begin() < 380 && *intervals.rbegin() > 650,
          "detected timing did not preserve short and long musical gaps");
}

void weakBassKicksSurviveNoiseRejectionAndDcOffset() {
  const std::vector<uint32_t> onsets{1200, 1860, 2390, 3100, 3580, 4210, 4870};
  const std::array<double, 7> amplitudes{0.025, 0.050, 0.080, 0.035, 0.060, 0.025, 0.100};
  const auto result = simulate(5900, [&](double time, uint64_t index) {
    double value = 0.28 + 0.0005 * noise(index);
    for (size_t i = 0; i < onsets.size(); ++i)
      value += kick(time, onsets[i] / 1000.0, amplitudes[i]);
    return value;
  });
  printBeats("weak bass kicks + DC offset", result);
  require(result.beats.size() >= onsets.size() - 1 && result.beats.size() <= onsets.size(),
          "rejecting broadband artifacts also discarded most real weak bass onsets");
  std::set<size_t> matched;
  for (auto detected : result.beats) {
    bool nearOnset = false;
    for (size_t i = 0; i < onsets.size(); ++i) {
      if (detected + 16 >= onsets[i] && detected <= onsets[i] + 144) {
        require(matched.insert(i).second, "a weak kick generated repeated beat events");
        nearOnset = true;
        break;
      }
    }
    require(nearOnset, "noise rejection introduced a delayed or generated beat");
  }
}

void sensitivityChangesWeakOnsetAcceptance() {
  const std::array<double, 11> amplitudes{0.002, 0.004, 0.006, 0.008, 0.012, 0.018, 0.026, 0.040, 0.065, 0.100, 0.200};
  bool distinguished = false;
  for (double amplitude : amplitudes) {
    auto signal = [amplitude](double time, uint64_t index) {
      return 0.03 * std::sin(2.0 * kPi * 90.0 * time) +
             0.00002 * noise(index) + kick(time, 2.0, amplitude);
    };
    const auto sensitive = simulate(3200, signal, 1.10f);
    const auto strict = simulate(3200, signal, 2.50f);
    require(sensitive.beats.size() <= 1 && strict.beats.size() <= 1,
            "sensitivity created recurring beats from steady background audio");
    require(sensitive.beats.size() >= strict.beats.size(),
            "a stricter threshold accepted more isolated weak onsets");
    if (sensitive.beats.size() > strict.beats.size()) distinguished = true;
    for (const auto &result : {sensitive, strict}) {
      for (auto detected : result.beats)
        require(detected >= 1984 && detected <= 2144,
                "sensitivity produced an event unrelated to the isolated onset");
    }
  }
  require(distinguished, "sensitivity had no observable effect across the weak-onset sweep");
}

void sensitivityRemainsBounded() {
  auto signal = [](double time, uint64_t index) {
    return 0.02 * std::sin(2.0 * kPi * 90.0 * time) +
           0.00002 * noise(index) + kick(time, 1.6, 0.08);
  };
  const auto minimum = simulate(3000, signal, 1.10f);
  const auto belowRange = simulate(3000, signal, -100.0f);
  const auto maximum = simulate(3000, signal, 2.50f);
  const auto aboveRange = simulate(3000, signal, 100.0f);
  require(minimum.beats == belowRange.beats && minimum.highestThreshold == belowRange.highestThreshold,
          "sensitivity below the allowed range was not clamped");
  require(maximum.beats == aboveRange.beats && maximum.highestThreshold == aboveRange.highestThreshold,
          "sensitivity above the allowed range was not clamped");
}
}  // namespace

int main() {
  const std::vector<std::pair<std::string, std::function<void()>>> tests{
      {"silence", silenceDoesNotMakeBeats},
      {"DC and quiet noise", dcAndSmallNoiseDoNotMakePeriodicBeats},
      {"full-amplitude broadband noise bursts", broadbandBurstsAreNotBassOnsets},
      {"band-limited high-frequency bursts", highFrequencyBurstsDoNotBecomeBassThroughFilterLeakage},
      {"DC changes and strong noise", strongNoiseAndDcChangesDoNotCreateRhythmicPulses},
      {"isolated broadband edges", isolatedBroadbandEdgesDoNotCreateRepeatedBeats},
      {"aliased carrier packets", aliasedCarrierPacketsDoNotBecomeBassOnsets},
      {"held tone", heldToneDoesNotRetrigger},
      {"irregular musical onsets", irregularKicksFollowOnsetsInsteadOfAClock},
      {"weak bass kicks with DC offset", weakBassKicksSurviveNoiseRejectionAndDcOffset},
      {"sensitivity affects weak onsets", sensitivityChangesWeakOnsetAcceptance},
      {"sensitivity bounds", sensitivityRemainsBounded},
  };
  size_t failures = 0;
  for (const auto &[name, run] : tests) {
    try {
      run();
      std::cout << "PASS " << name << '\n';
    } catch (const std::exception &error) {
      std::cerr << "FAIL " << name << ": " << error.what() << '\n';
      ++failures;
    }
  }
  return failures == 0 ? 0 : 1;
}
