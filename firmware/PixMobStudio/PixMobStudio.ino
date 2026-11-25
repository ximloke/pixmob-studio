/* PixMob Studio — local raw-IR workbench, not a PixMob protocol implementation.
 * Requires Arduino-ESP32 3.x and ArduinoJson 7.x.
 * Boots with IR idle, no waveform and standalone disabled. RAM-only configuration.
 */
#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <ArduinoJson.h>
#include <ESP_I2S.h>
#include <esp32-hal-rmt.h>
#include <math.h>
#include "Config.h"
#include "Integration.h"

WebServer server(80);
I2SClass microphone;
RawIRWaveform waveform;
rmt_data_t symbols[(MAX_IR_DURATIONS + 1) / 2] = {};
size_t symbolCount = 0;
bool irReady = false, irConfigured = false, micInitialized = false;
bool standaloneEnabled = false, transmitting = false;
bool irAwaitingCompletion = false;
uint8_t repeatsRemaining = 0;
uint32_t nextRepeatAt = 0, lastTransmissionAt = 0, lastMicDataAt = 0;
uint32_t lastDisplayAt = 0;
uint32_t lastAudioTelemetryAt = 0;
float sensitivity = 0.6f, micLevel = 0, meanLevel = 0.005f;
String lastError, serialBuffer;
bool discardSerialLine = false;
DisplayAdapter *display = nullptr;  // Optional, controller-specific implementation.
RFAdapter *radio = nullptr;        // Reserved, deliberately unconfigured.

bool finiteNumber(JsonVariantConst value) {
  return value.is<double>() && isfinite(value.as<double>());
}
bool integerInRange(JsonVariantConst value, long minimum, long maximum) {
  if (!finiteNumber(value)) return false;
  const double number = value.as<double>();
  return number >= minimum && number <= maximum && floor(number) == number;
}
void error(JsonDocument &response, const char *message) {
  response["error"] = message;
}
void status(JsonDocument &response) {
  response["name"] = "PixMob Studio ESP32";
  response["firmware"] = "1.1.0";
  response["mode"] = "controller";
  response["irConfigured"] = irConfigured;
  response["irReady"] = irReady;
  response["irTransmitting"] = transmitting;
  response["rfSupported"] = false;
  // I2S has no device-ID probe: this means nonzero samples arrived recently.
  response["micAvailable"] = micInitialized && lastMicDataAt != 0 && millis() - lastMicDataAt < 2000;
  response["micInitialized"] = micInitialized;
  response["micLevel"] = micLevel;
  response["micRawLevel"] = static_cast<uint32_t>(micLevel * 8388608.0f);
  response["micPins"]["bclk"] = MIC_BCLK;
  response["micPins"]["ws"] = MIC_WS;
  response["micPins"]["data"] = MIC_DATA;
  response["irPin"] = IR_PIN;
  response["standaloneEnabled"] = standaloneEnabled;
  response["sensitivity"] = sensitivity;
  response["displaySupported"] = display != nullptr;
  response["lightingEncoderAvailable"] = false;
  response["ip"] = WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : WiFi.softAPIP().toString();
  response["lastError"] = lastError;
}

bool configureIR(JsonVariantConst payload, JsonDocument &response) {
  if (transmitting || standaloneEnabled) { error(response, "Stop transmission and standalone sync before changing IR configuration."); return false; }
  if (!irReady) { error(response, "IR peripheral initialization failed."); return false; }
  if (!payload.is<JsonObjectConst>() ||
      !integerInRange(payload["carrierHz"], 20000, 60000) ||
      !finiteNumber(payload["dutyPercent"]) || payload["dutyPercent"].as<double>() < 10 || payload["dutyPercent"].as<double>() > 50 ||
      !integerInRange(payload["repeats"], 1, 5) ||
      !integerInRange(payload["gapUs"], 1000, 100000) ||
      !payload["markFirst"].is<bool>() || !payload["markFirst"].as<bool>()) {
    error(response, "Invalid IR parameters. Use carrier 20000-60000 Hz, duty 10-50%, repeats 1-5, gap 1000-100000 us, markFirst true."); return false;
  }
  JsonArrayConst durations = payload["durations"].as<JsonArrayConst>();
  if (durations.isNull() || durations.size() < 1 || durations.size() > MAX_IR_DURATIONS) {
    error(response, "Expected 1-512 alternating mark/space durations."); return false;
  }
  uint32_t total = 0;
  for (JsonVariantConst v : durations) {
    if (!integerInRange(v, 10, 20000)) { error(response, "Every duration must be an integer between 10 and 20000 us."); return false; }
    total += v.as<uint32_t>();
  }
  if (total > MAX_WAVEFORM_US) { error(response, "Waveform total must not exceed 200000 us."); return false; }
  const uint32_t carrier = payload["carrierHz"].as<uint32_t>();
  const float duty = payload["dutyPercent"].as<float>();
  if (!rmtSetCarrier(IR_PIN, true, true, carrier, duty / 100.0f)) {
    irConfigured = false; error(response, "RMT could not configure the requested carrier."); return false;
  }
  waveform.carrierHz = carrier;
  waveform.dutyPercent = duty;
  waveform.repeats = payload["repeats"].as<uint8_t>();
  waveform.gapUs = payload["gapUs"].as<uint32_t>();
  waveform.count = durations.size();
  size_t i = 0;
  for (JsonVariantConst v : durations) waveform.durations[i++] = v.as<uint16_t>();
  memset(symbols, 0, sizeof(symbols));
  symbolCount = (waveform.count + 1) / 2;
  for (size_t n = 0; n < symbolCount; ++n) {
    symbols[n].level0 = 1;
    symbols[n].duration0 = waveform.durations[n * 2];
    symbols[n].level1 = 0;
    // Odd sequences end with a mark. A 1-us idle tail ensures no zero-duration
    // half-symbol truncates the last mark. EOT remains low.
    symbols[n].duration1 = n * 2 + 1 < waveform.count ? waveform.durations[n * 2 + 1] : 1;
  }
  irConfigured = true;
  lastError = "";
  response["ok"] = true;
  response["durationUs"] = total;
  response["irConfigured"] = true;
  return true;
}

bool queueTransmission() {
  if (!irReady || !irConfigured || transmitting) return false;
  transmitting = true;
  irAwaitingCompletion = false;
  repeatsRemaining = waveform.repeats;
  nextRepeatAt = micros();
  lastTransmissionAt = millis();
  return true;
}
void stopTransmission() {
  // A bounded frame already in flight is allowed to complete. No more repeats.
  standaloneEnabled = false;
  repeatsRemaining = 0;
  if (!irAwaitingCompletion) transmitting = false;
}
void serviceIR() {
  if (!transmitting) return;
  if (irAwaitingCompletion) {
    if (!rmtTransmitCompleted(IR_PIN)) return;
    irAwaitingCompletion = false;
    if (repeatsRemaining == 0) { transmitting = false; return; }
    nextRepeatAt = micros() + waveform.gapUs;
  }
  if (static_cast<int32_t>(micros() - nextRepeatAt) < 0) return;
  if (repeatsRemaining == 0) { transmitting = false; return; }
  if (!rmtWriteAsync(IR_PIN, symbols, symbolCount)) {
    transmitting = false;
    repeatsRemaining = 0;
    standaloneEnabled = false;
    lastError = "IR transmission could not start; standalone sync stopped.";
    return;
  }
  --repeatsRemaining;
  irAwaitingCompletion = true;
}

void processCommand(const String &op, JsonVariantConst payload, JsonDocument &response) {
  if (op == "status") { status(response); return; }
  if (op == "ir/config") { configureIR(payload, response); return; }
  if (op == "ir/send") {
    if (standaloneEnabled) { error(response, "Stop standalone sync before a manual transmission."); return; }
    if (!irConfigured) { error(response, "No verified waveform configured."); return; }
    if (millis() - lastTransmissionAt < 300 && lastTransmissionAt != 0) { error(response, "Transmission rate limit; wait at least 300 ms."); return; }
    if (!queueTransmission()) { error(response, "IR transmitter busy or unavailable."); return; }
    response["ok"] = true; response["accepted"] = true; return;
  }
  if (op == "ir/stop") {
    stopTransmission(); response["ok"] = true; response["finishingCurrentFrame"] = irAwaitingCompletion; return;
  }
  if (op == "standalone") {
    if (!payload["enabled"].is<bool>()) { error(response, "enabled must be a boolean."); return; }
    const bool enable = payload["enabled"].as<bool>();
    if (!enable) { stopTransmission(); response["ok"] = true; response["standaloneEnabled"] = false; return; }
    if (!finiteNumber(payload["sensitivity"]) || payload["sensitivity"].as<double>() < 0 || payload["sensitivity"].as<double>() > 1) { error(response, "sensitivity must be between 0 and 1."); return; }
    if (!irConfigured || !micInitialized || lastMicDataAt == 0 || millis() - lastMicDataAt > 2000) { error(response, "Configure a waveform and verify microphone samples before enabling standalone sync."); return; }
    sensitivity = payload["sensitivity"].as<float>();
    standaloneEnabled = true; response["ok"] = true; response["standaloneEnabled"] = true; return;
  }
  error(response, "Unknown operation. No lighting encoder or RF protocol is installed.");
}

void cors() {
  // For a trusted local network only. Browser permissions and network policy
  // still apply. No Internet service, authentication, or cloud relay is used.
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
  server.sendHeader("Access-Control-Allow-Private-Network", "true");
  server.sendHeader("Cache-Control", "no-store");
}
void handleHTTP(const String &op) {
  cors();
  if (server.method() == HTTP_OPTIONS) { server.send(204); return; }
  const bool isStatus = op == "status";
  if ((isStatus && server.method() != HTTP_GET) || (!isStatus && server.method() != HTTP_POST)) {
    server.send(405, "application/json", "{\"error\":\"Method not allowed.\"}"); return;
  }
  JsonDocument request, response;
  if (!isStatus) {
    const String body = server.arg("plain");
    if (body.length() > MAX_JSON_BYTES) { server.send(413, "application/json", "{\"error\":\"Request too large.\"}"); return; }
    if (deserializeJson(request, body) || !request.is<JsonObject>()) { server.send(400, "application/json", "{\"error\":\"Expected a JSON object.\"}"); return; }
  }
  processCommand(op, request.as<JsonVariantConst>(), response);
  String body; serializeJson(response, body);
  server.send(response["error"].isNull() ? 200 : 400, "application/json", body);
}
void serviceSerial() {
  // Bounded work per loop keeps Wi-Fi, audio and IR servicing responsive.
  for (size_t i = 0; i < 256 && Serial.available(); ++i) {
    const char c = static_cast<char>(Serial.read());
    if (c == '\r') continue;
    if (c != '\n') {
      if (!discardSerialLine) {
        if (serialBuffer.length() < MAX_JSON_BYTES) serialBuffer += c;
        else { serialBuffer = ""; discardSerialLine = true; }
      }
      continue;
    }
    JsonDocument request, response;
    if (discardSerialLine) error(response, "Serial request too large.");
    else if (deserializeJson(request, serialBuffer) || !request.is<JsonObject>()) error(response, "Invalid serial JSON object.");
    else if (!integerInRange(request["id"], 1, 2147483647) || !request["op"].is<const char *>()) error(response, "Serial request needs integer id and string op.");
    else {
      response["id"] = request["id"];
      processCommand(request["op"].as<String>(), request["payload"].as<JsonVariantConst>(), response);
    }
    serializeJson(response, Serial); Serial.println();
    serialBuffer = ""; discardSerialLine = false;
  }
}
void serviceMicrophone() {
  if (!micInitialized || microphone.available() < 4) return;
  int32_t samples[128];
  size_t bytes = min(static_cast<size_t>(microphone.available()), sizeof(samples));
  bytes -= bytes % sizeof(int32_t);
  const size_t count = microphone.readBytes(reinterpret_cast<char *>(samples), bytes) / sizeof(int32_t);
  if (!count) return;
  double squareSum = 0;
  bool nonzero = false;
  for (size_t i = 0; i < count; ++i) {
    // INMP441: signed 24-bit data in a 32-bit I2S slot, normalized after shift.
    const int32_t signed24 = samples[i] >> 8;
    const float normalized = static_cast<float>(signed24) / 8388608.0f;
    squareSum += normalized * normalized;
    nonzero = nonzero || signed24 != 0;
  }
  if (nonzero) lastMicDataAt = millis();
  micLevel = sqrt(squareSum / count);
  const float threshold = max(0.002f, meanLevel * (2.5f - sensitivity * 1.2f));
  const bool peak = micLevel > threshold;
  meanLevel = meanLevel * 0.96f + micLevel * 0.04f;
  if (standaloneEnabled && peak && millis() - lastTransmissionAt >= 500) queueTransmission();
}
void setupNetwork() {
  if (strlen(STUDIO_WIFI_SSID)) {
    WiFi.mode(WIFI_STA);
    WiFi.begin(STUDIO_WIFI_SSID, STUDIO_WIFI_PASSWORD);
    const uint32_t start = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - start < 10000) delay(50);
    if (WiFi.status() == WL_CONNECTED) return;
  }
  WiFi.mode(WIFI_AP);
  if (!WiFi.softAP(STUDIO_AP_SSID, STUDIO_AP_PASSWORD)) lastError = "Wi-Fi AP failed. Check password length; use Serial.";
}
void serviceAudioTelemetry() {
  if (!micInitialized || millis() - lastAudioTelemetryAt < 100 ||
      lastMicDataAt == 0 || millis() - lastMicDataAt > 2000) return;
  lastAudioTelemetryAt = millis();
  JsonDocument event;
  event["event"] = "audio";
  event["format"] = "rms-24-bit";
  event["micLevel"] = micLevel;
  event["micRawLevel"] = static_cast<uint32_t>(micLevel * 8388608.0f);
  serializeJson(event, Serial); Serial.println();
}
void setup() {
  Serial.begin(115200);
  serialBuffer.reserve(MAX_JSON_BYTES);
  pinMode(IR_PIN, OUTPUT); digitalWrite(IR_PIN, LOW);
  irReady = rmtInit(IR_PIN, RMT_TX_MODE, RMT_MEM_NUM_BLOCKS_4, 1000000);
  if (irReady) irReady = rmtSetEOT(IR_PIN, 0);
  if (!irReady) lastError = "RMT initialization failed.";
  if (ENABLE_MICROPHONE) {
    pinMode(MIC_DATA, INPUT);
    microphone.setPins(MIC_BCLK, MIC_WS, -1, MIC_DATA);
    micInitialized = microphone.begin(I2S_MODE_STD, MIC_SAMPLE_RATE, I2S_DATA_BIT_WIDTH_32BIT, I2S_SLOT_MODE_MONO, I2S_STD_SLOT_LEFT);
  }
  setupNetwork();
  const char *routes[] = {"status", "ir/config", "ir/send", "ir/stop", "standalone"};
  for (const char *route : routes) {
    const String op(route);
    server.on(String("/api/") + op, HTTP_ANY, [op]() { handleHTTP(op); });
  }
  server.onNotFound([]() { cors(); server.send(404, "application/json", "{\"error\":\"Unknown API route.\"}"); });
  server.begin();
  if (display) display->begin();
  JsonDocument boot; status(boot); boot["event"] = "boot";
  serializeJson(boot, Serial); Serial.println();
}
void loop() {
  server.handleClient();
  serviceSerial();
  serviceIR();
  serviceMicrophone();
  serviceAudioTelemetry();
  if (display && millis() - lastDisplayAt > 250) {
    lastDisplayAt = millis();
    const String ip = WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : WiFi.softAPIP().toString();
    const DisplaySnapshot snapshot{ip.c_str(), irConfigured, transmitting, standaloneEnabled, micLevel};
    display->render(snapshot);
  }
  delay(1);
}
