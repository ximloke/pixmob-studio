# API and protocol integration

The HTTP API and Web Serial transport share the same command handler. They operate the raw-IR workbench, not PixMob lighting commands. Artist profiles and frontend lighting effects are visual simulations.

## HTTP

Default access-point address: `http://192.168.4.1`. With station Wi-Fi, use the address in the boot status. Responses are JSON and are not cached.

| Route             | Method | Body                                 | Result                                                       |
| ----------------- | ------ | ------------------------------------ | ------------------------------------------------------------ |
| `/api/status`     | GET    | None                                 | Device state and capability flags                            |
| `/api/ir/config`  | POST   | `IRConfig` below                     | Validates/stores waveform in RAM; does not transmit          |
| `/api/ir/send`    | POST   | `{}`                                 | Queues the configured waveform; no reception confirmation    |
| `/api/ir/stop`    | POST   | `{}`                                 | Stops standalone and pending repeats; current frame finishes |
| `/api/standalone` | POST   | `{"enabled":true,"sensitivity":0.6}` | Enables microphone energy-peak synchronization               |
| `/api/standalone` | POST   | `{"enabled":false}`                  | Disables standalone synchronization                          |

Known routes accept OPTIONS for local browser preflight. Wrong methods return 405. Unknown routes return 404. Invalid requests return 400 with `{"error":"…"}`. JSON request bodies larger than 8,192 bytes are rejected. Avoid sending requests while the device is reconnecting or booting.

Example status shape:

```json
{
  "name": "PixMob Studio ESP32",
  "firmware": "1.1.0",
  "mode": "controller",
  "irConfigured": false,
  "irReady": true,
  "irTransmitting": false,
  "rfSupported": false,
  "micAvailable": false,
  "micInitialized": true,
  "micLevel": 0,
  "micRawLevel": 0,
  "micPins": { "bclk": 26, "ws": 25, "data": 27 },
  "irPin": 33,
  "standaloneEnabled": false,
  "sensitivity": 0.6,
  "displaySupported": false,
  "lightingEncoderAvailable": false,
  "ip": "192.168.4.1",
  "lastError": ""
}
```

Values above illustrate the schema. They are not a claim of connected hardware. `micAvailable` becomes true after recent nonzero I2S samples; noise or floating inputs can resemble samples, so validate with actual sound response. `irConfigured` only means an accepted waveform is loaded.

### IRConfig

| Field         | Type / limits                                                                               |
| ------------- | ------------------------------------------------------------------------------------------- |
| `carrierHz`   | Integer, 20,000–60,000 Hz, supplied from verified measurement                               |
| `dutyPercent` | Finite number, 10–50                                                                        |
| `repeats`     | Integer, 1–5                                                                                |
| `gapUs`       | Integer, 1,000–100,000 µs, measured from frame completion to next frame                     |
| `markFirst`   | Boolean `true`                                                                              |
| `durations`   | Array of 1–512 integer µs durations; alternating mark/space, each 10–20,000; total ≤200,000 |

No production sample waveform is supplied. A mark is a carrier burst; a space is idle LOW. With an odd number of durations, a final 1 µs idle tail is added for RMT symbol packing. The output is idle LOW after transmission. Software bounds do not certify the carrier, driver or receiver. Reject or adapt protocols that cannot fit these limits rather than truncating their timings.

`ir/config` is rejected during transmission or standalone sync. Manual `ir/send` is rejected during standalone sync and rate-limited to a minimum 300 ms between starts. Standalone starts are at least 500 ms apart and never overlap a prior transmission. Asynchronous peripheral failure disables standalone sync and appears in `lastError`.

### USB Serial

CP2102 serial settings: 115200 baud, 8N1. Send one JSON object per newline, at most 8,192 bytes excluding newline:

```json
{"id":1,"op":"status"}
{"id":2,"op":"standalone","payload":{"enabled":false}}
```

Responses repeat `id` at the top level alongside result fields or an `error`. Supported `op` values are `status`, `ir/config`, `ir/send`, `ir/stop`, and `standalone`. IDs must be positive signed 32-bit integers. Boot output has `event: "boot"` and no request ID; clients should ignore unrelated boot/log lines. An unparsable line cannot return a usable request ID and should time out on the client. Close Arduino Serial Monitor before connecting.

### Browser constraints

- Microphone access requires a secure context: localhost or HTTPS, plus permission. A phone visiting ordinary `http://COMPUTER_LAN_IP:5173` can use the simulator and local HTTP API but generally cannot capture microphone audio.
- Web Serial is feature-detected at runtime and requires a compatible desktop browser/secure context and the user’s port selection. Use local Wi-Fi when it is absent. Mobile support should not be assumed.
- Shared tab/system audio uses `getDisplayMedia`, with a mandatory user chooser. Audio tracks depend on browser, operating system and selected source. If the user shares video without audio, the app stops the capture and explains how to select audio.
- An HTTPS frontend may be blocked from fetching an HTTP ESP32 by mixed-content or local-network policy. For Wi-Fi development, use the frontend over local HTTP and keep browser capture limitations in mind. A future HTTPS reverse proxy could combine secure capture with device access; none is silently provisioned.
- No microphone audio is uploaded. Browser audio analysis is local, and firmware microphone analysis is independent.

See [MDN getDisplayMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia), [MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia), and [MDN Web Serial](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API).

## Adding a verified protocol

1. Identify the exact wristband revision and record reproducible captures from a known controller. Keep carrier and envelope measurements, repetition behavior, state transitions, packet fields, checksums and observed results together.
2. Build a `VerifiedLightingEncoder` (firmware) or `LightingEncoder` (frontend) that maps supported commands to bounded raw waveforms. State which color/effect commands are unsupported. Profile names must not imply universal compatibility across tour revisions.
3. Validate logic-level output, then IR emission, then actual receiver response. Include repeatability and negative tests. A request acknowledgement is not an observed wristband action.
4. Only after those tests, advertise `lightingEncoderAvailable: true` and wire Simple Mode commands to that encoder. The current frontend intentionally never forwards its color/effect state to raw IR.
5. Implement an RF adapter only after confirming module, electrical requirements and protocol evidence. Do not infer an RF band or packet format from the product name or from the ESP32’s own Wi-Fi/Bluetooth radios.

## Controller microphone telemetry

Firmware 1.1.0 emits at most ten newline-delimited USB audio events per second while recent microphone samples are available:

```json
{
  "event": "audio",
  "format": "rms-24-bit",
  "micLevel": 0.01,
  "micRawLevel": 83886
}
```

`micLevel` is RMS normalized to 0–1; `micRawLevel` is RMS scaled to the signed 24-bit full scale (0–8,388,608). These are amplitude measurements, not raw PCM audio, spectrum or BPM. The website requires a valid JSON controller status handshake to enable controller commands. Audio events do not satisfy that handshake or activate legacy microphone-test fallback.

The reported microphone pins are SCK GPIO26, WS GPIO25 and SD GPIO27. IR GPIO33 is separate. The current firmware retains no default IR waveform and does not add a PixMob lighting encoder or RF compatibility.
