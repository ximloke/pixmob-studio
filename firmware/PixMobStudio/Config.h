#pragma once

// Arduino-ESP32 3.x. Pin labels below are GPIO numbers, never header positions.
// Preserve the microphone wiring already verified on this user's ESP32.
// GPIO25 is microphone WS, so IR must use a separate pin.
constexpr int IR_PIN = 33;
constexpr int MIC_BCLK = 26;
constexpr int MIC_WS = 25;
constexpr int MIC_DATA = 27;
constexpr uint32_t MIC_SAMPLE_RATE = 16000;
constexpr bool ENABLE_MICROPHONE = true;
constexpr size_t MAX_IR_DURATIONS = 512;
constexpr size_t MAX_JSON_BYTES = 8192;
constexpr uint32_t MAX_WAVEFORM_US = 200000;
static_assert(IR_PIN != MIC_BCLK && IR_PIN != MIC_WS && IR_PIN != MIC_DATA,
              "IR output must not share a microphone pin.");
static_assert(MIC_BCLK != MIC_WS && MIC_BCLK != MIC_DATA && MIC_WS != MIC_DATA,
              "Microphone signals need separate pins.");

// Optional local credentials. Copy secrets.example.h to secrets.h and edit it.
#if __has_include("secrets.h")
#include "secrets.h"
#endif
#ifndef STUDIO_WIFI_SSID
#define STUDIO_WIFI_SSID ""
#endif
#ifndef STUDIO_WIFI_PASSWORD
#define STUDIO_WIFI_PASSWORD ""
#endif
#ifndef STUDIO_AP_SSID
#define STUDIO_AP_SSID "PixMob-Studio"
#endif
#ifndef STUDIO_AP_PASSWORD
#define STUDIO_AP_PASSWORD "pixmob-local"
#endif
