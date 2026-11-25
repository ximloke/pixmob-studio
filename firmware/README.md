# PixMob Studio firmware

Local HTTP and USB Serial control for an ESP32 DevKit V1 (38-pin, CP2102). The sketch sends **user-supplied raw IR waveforms** through an active-high KY-005 driver circuit. It does not implement a PixMob command encoder or establish wristband compatibility.

The currently connected board uses the separate **PixMobBeatController** USB preset sketch with IR GPIO32 and microphone GPIO26/25/27. Its latest build sends one frame per manual/song color and music trigger; Auto retains its original repetitions. Since 20 November 2026 it also sends every light as a PixMob RF frame through the CC1101 at 922.36 MHz, 10 dBm (`RfPlan.h`: frames end with the IR frame, up to 3 copies 50 ms apart, keep-awake "nothing" bursts every 2 s while the board is powered (`RF SLEEP AFTER: OFF`, the default); `@RS<s>` instead lets the bands sleep <s> s (60-86400) after the last light, and the next light then starts a 35 s wake, which is too short for a band that has slept a while (it needed more than 40 s, under 120 s, of RF on 21 November 2026); `@R1`/`@R0`/`@RW`/`@RK<ms>`/`@RS<s>`, `RF SLEEP SETTING: READY`; without the CC1101 it runs IR only). `@R0` sends IR only (no RF at all) and `@R2` RF only; any flash, timed light, strobe, build or rainbow line may end in `/I`, `/R` or `/B` for that light alone (`LIGHT OUTPUT: READY`). Rainbow frames hold 480 ms on RF. On the board: `.arduino/beat-rf-flash-build/` (quick flash RF hold 192 ms since 21 November 2026, measured against IR on video). See [preset setup and build records](../docs/PRESET_SERIAL.md). The JSON/Wi-Fi controller instructions below describe the alternative `PixMobStudio` sketch with IR GPIO33.

**RF test sketches (16 November 2026):** `CC1101Check/` only reads the CC1101 (wiring check). `PixMobRFTest/` sends public-protocol PixMob RF colour frames (group 0, never settings/EEPROM frames) through the CC1101 at 433.10–434.70 MHz (since 20 November also 919.10–922.90 MHz, limits in `PixMobRFLimits.h`), ≤10 dBm, only on a serial command; see [verification](../docs/VERIFICATION.md). Since 20 November its bit time is 512 µs and frames repeat every 50 ms by default, as in the published venue captures; `Z` sends the published "nothing" frame for 35 s (band wake-up) and then the published red `wine_fade_in` frame for 5 s. `Z` keeps the CC1101 side of GDO0 high impedance and lit the band at 10 dBm on 20 November. Since then the burst commands use the same high-impedance GDO0 path. Every transmission first checks the GDO0 wire by letting the CC1101 drive it high and low, and reports whether the radio stayed in TX. `Z<seconds>` sets a 5–90 s wake. At 433.92 MHz the band responded only within about 2–3 cm at 10 dBm. At 922.36 MHz it lit from 30 cm, 1 m and 3 m (see verification). Neither is the installed firmware.

## Current pin configuration

This checkout preserves the microphone wiring already working on the connected ESP32: **SCK GPIO26, WS GPIO25, SD GPIO27**, left I2S slot. IR is reserved on **GPIO33** to avoid the microphone's WS line. Do not connect an IR driver to GPIO25 with this configuration. No microphone rewiring is required.

## Install and upload

1. Install Arduino IDE 2.x. In Boards Manager install **esp32 by Espressif Systems, version 3.x**. The code uses the 3.x RMT and I2S APIs; Arduino-ESP32 2.x is unsupported.
2. In Library Manager install **ArduinoJson 7.x**.
3. Open `PixMobStudio/PixMobStudio.ino` and select **ESP32 Dev Module** for a generic ESP32-WROOM DevKit V1. Confirm the actual board module and flash size; “38-pin CP2102” identifies the carrier/USB bridge, not a distinct ESP32 chip model.
4. Leave the IR emitter disconnected while first testing the API. Follow [WIRING.md](../docs/WIRING.md) before applying power to the transmitter.
5. Optionally copy `PixMobStudio/secrets.example.h` to `PixMobStudio/secrets.h`. Set a local 2.4 GHz Wi-Fi SSID/password, or leave the SSID empty for access-point operation. The secrets file is ignored by Git.
6. Select the CP2102 serial port and upload at 115200 baud. Use a data-capable USB cable. If upload does not start, hold BOOT while the IDE connects, then release it. Follow your board vendor’s instructions for CP2102 drivers if the port is absent.
7. Open Serial Monitor at **115200** and read the JSON boot status. Close Serial Monitor before using Web Serial: one application can own the port at a time.
8. Without station credentials, or after a 10-second connection failure, the device starts `PixMob-Studio` with the development password `pixmob-local`. Set your own AP password (8 or more characters) in `secrets.h`. Join it and open `http://192.168.4.1/api/status`. The ESP32 hosts the API, not the React application.
9. Start the React app on the computer (`npm run dev` from the repository root). Connect from Devices using the ESP32 address printed at boot, or use Web Serial in a compatible desktop browser.

For CLI builds after installing `arduino-cli`, with all dependencies installed:

```sh
arduino-cli core update-index --additional-urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
arduino-cli core install esp32:esp32 --additional-urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
arduino-cli lib install 'ArduinoJson@7.4.2'
arduino-cli compile --fqbn esp32:esp32:esp32 firmware/PixMobStudio
arduino-cli upload --fqbn esp32:esp32:esp32 --port /dev/cu.YOUR_PORT firmware/PixMobStudio
```

The dependency line is an example version pin for ArduinoJson 7.x, not a statement that it is the latest version. Record the actual board-core/library versions used for your bench build.

## Operation

- Every boot clears the waveform and disables standalone synchronization. There is no default carrier, packet or artist mapping.
- Configuration is RAM-only. Verify your capture and load it again after reset.
- RMT generates carrier-modulated marks with 1 µs envelope resolution. Transmission is asynchronous; the loop continues serving HTTP, Serial and microphone input.
- A request can contain 1–512 alternating mark/space durations, each 10–20,000 µs, with total duration at most 200,000 µs. Repeats are limited to 1–5, and inter-frame gaps to 1,000–100,000 µs. These are software resource limits, not PixMob specifications. Very short marks must still be checked against the measured carrier and receiver requirements.
- Firmware 1.1.0 reports its microphone pins and IR pin in status and emits normalized 24-bit RMS amplitude telemetry over USB at up to 10 Hz. It does not send raw PCM audio or an FFT.
- `ir/send` acknowledges queueing, not wristband reception. Poll `status` for `irTransmitting` and `lastError`.
- Standalone synchronization detects broad energy peaks from the INMP441 and repeats the loaded raw waveform no more often than every 500 ms. It is not FFT, BPM, color encoding or RF. Browser spectrum/BPM analysis is a separate frontend feature.
- `ir/stop` disables standalone synchronization and cancels pending repetitions. A bounded frame already in flight finishes (up to 200 ms, plus a possible 1 µs idle tail).
- An initialized I2S peripheral does not prove that an INMP441 is installed. `micAvailable` means recent nonzero samples, which must be checked against actual microphone response on the bench.
- The optional TFT needs a controller-specific `DisplayAdapter`; no display library is assumed. RF has a reserved `RFAdapter` interface only.

## Network behavior

The firmware runs on a trusted local test network. Its API has no authentication and allows cross-origin requests for local development. Do not forward it through a router or expose it to the Internet. Browser network permissions, secure-context rules, mixed-content restrictions and operating-system policies still apply. See [PROTOCOL.md](../docs/PROTOCOL.md).

## Verification status

The controller compiled successfully with **Arduino-ESP32 3.3.12** and **ArduinoJson 7.4.2** for `esp32:esp32:esp32`. The application uses 992,605 bytes of flash and 50,464 bytes of static RAM. Local build artifacts are under `.arduino/build/` (ignored by Git).

Controller 1.1.0 was uploaded to the connected 4 MB ESP32 with written-data hash verification. USB controller status and live microphone RMS samples passed physical checks with pins 26/25/27, and the website was reconnected. The previous full flash and microphone-test source are backed up under `.arduino/backups/`. The detailed upload and connection verification record is maintained in [VERIFICATION.md](../docs/VERIFICATION.md). IR optical timing, emitter current, TFT, RF and physical wristband response still require the bench tests in [TESTING.md](../docs/TESTING.md). A compiler or API check does not establish PixMob compatibility.

API references: [Espressif RMT](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/rmt.html), [Espressif I2S](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/i2s.html), [Espressif Arduino setup](https://docs.espressif.com/projects/arduino-esp32/en/latest/installing.html).
