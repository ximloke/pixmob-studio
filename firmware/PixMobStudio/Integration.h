#pragma once
#include <Arduino.h>

// Future lighting encoders must implement a measured, documented protocol.
// There is deliberately no Taylor Swift / The Weeknd command mapping here.
struct LightingState {
  uint8_t red, green, blue, brightness, speed;
  const char *effect;
};
struct RawIRWaveform {
  uint32_t carrierHz = 0;
  float dutyPercent = 0;
  uint8_t repeats = 0;
  uint32_t gapUs = 0;
  size_t count = 0;
  uint16_t durations[512] = {};
};
class VerifiedLightingEncoder {
 public:
  virtual ~VerifiedLightingEncoder() = default;
  virtual const char *protocolEvidence() const = 0;
  virtual bool encode(const LightingState &, RawIRWaveform &) = 0;
};

// No radio driver, frequency, modulation, module, packet format or pins assumed.
class RFAdapter {
 public:
  virtual ~RFAdapter() = default;
  virtual const char *verifiedProtocolEvidence() const = 0;
  virtual bool sendVerifiedPacket(const uint8_t *packet, size_t length) = 0;
};

// A 1.44-inch size does not identify the TFT controller. Implement this adapter
// only after confirming its controller, voltage, SPI mode and initialization.
struct DisplaySnapshot {
  const char *network;
  bool waveformConfigured;
  bool transmitting;
  bool standalone;
  float microphoneLevel;
};
class DisplayAdapter {
 public:
  virtual ~DisplayAdapter() = default;
  virtual void begin() = 0;
  virtual void render(const DisplaySnapshot &) = 0;
};
