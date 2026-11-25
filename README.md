# PixMob Studio

A local React + TypeScript lighting console with a working wristband simulator, Simple Mode, and Advanced DJ audio analysis. The visual profiles are inspired by concert wristbands. This independent project is not affiliated with PixMob or the named artists.

Continuing this existing project with Claude: read [CLAUDE.md](CLAUDE.md) and the [current handoff](docs/CLAUDE_HANDOFF.md), including installed firmware, preserved wiring, backups and unresolved issues.

**Live:** [ximloke.github.io/pixmob-studio](https://ximloke.github.io/pixmob-studio/) (GitHub Pages, rebuilt from `main` on every push) and [pizmob-control.pages.dev](https://pizmob-control.pages.dev/) (Cloudflare Pages, deployed by hand, so it can lag behind). Open either one in desktop Chrome to connect the ESP32 over Web Serial. Shows, colours and lead time are stored separately for each address in the browser, so move shows with Export / Import.

**Current setup, 25 November 2026:** the board runs `beat-rf-flash-build`, built from the current source in `firmware/PixMobBeatController/`.
- Every light goes out by IR and, through a CC1101, as a PixMob RF frame at 922.36 MHz and 10 dBm. IR only or RF only can be chosen instead.
- 187 tests and the production build pass.
- The controller transmits only at 922.36 MHz and at no more than 10 dBm. The bench sketch is limited to 433.10–434.70 and 919.10–922.90 MHz.
- The home-built board is not certified. Check your local radio rules before transmitting.

**Start with the simulator. No hardware, account, cloud service, or protocol data is needed.** Artist profiles affect the virtual wristband only. Hardware control has been checked by eye on one band model only (PixMob Wave2 Gen 3, IR and 922 MHz RF); see [VERIFICATION.md](docs/VERIFICATION.md).

## Run locally

Requirements: Node.js 22 LTS and npm.

```sh
npm ci
npm run dev
```

Open the URL printed by Vite, normally `http://localhost:5173`. Dependencies are downloaded once; the running app uses no remote fonts, images, analytics, or cloud APIs.

```sh
npm run build
npm run preview
npm test
```

`dist/` is the production build and can be served with any static HTTP server. The dev and preview servers bind to the LAN to support phones. Use the printed network URL from a phone on the same trusted Wi-Fi. Stop the server with Ctrl+C when finished. Internet access is not needed after dependencies are installed; a web server is still needed (opening `index.html` as `file://` is unsupported).

## Using the studio

- **Simple Mode:** choose Taylor Swift or The Weeknd preview styling; select a color through the saturation/value field, hue slider, native picker, RGB fields, or HEX input; adjust brightness and speed; choose Solid, Flash, Fade, Strobe or Rainbow. Music Sync modulates preview brightness from the selected audio source. Strobe is capped at 3 Hz in the simulator.
- **Live preview:** the wristband’s LED color, glow and lighting pattern are computed by the reusable effect engine. Pause freezes the preview; live audio analysis can continue.
- **Advanced DJ:** use demo audio immediately, or choose microphone/shared audio and press Start. The logarithmic spectrum, frequency bands, estimated BPM, onset detection and drop detection update in the browser. Sensitivity adjusts analysis gain and onset threshold. Synthetic demo audio is 120 BPM, with a quiet passage at seconds 18–20 of each 24-second loop followed by a demo drop.
- **Scenes:** load four built-in presets or save the current color, profile, effect, brightness, speed and Music Sync setting. Custom scenes persist in this browser’s local storage and can be exported as JSON. They are not shared between devices or origins.
- **Devices:** connect by local Wi-Fi HTTP or Web Serial, inspect actual connection status, and configure explicitly verified raw IR timing. Use **Preset controller (your sketch)** for the supplied original music sketch or the derived beat controller; **Studio JSON / microphone test** and optional **Wi-Fi V2 controller (USB)** use different adapters. Select the installed protocol explicitly. The simulator remains active when hardware is connected.

BPM is a median inter-onset estimate after several detected beats; it may lock onto a subdivision. Band levels are relative FFT magnitudes, not calibrated sound-pressure measurements. Drop detection is an energy-return heuristic after a quiet interval, not a song-structure model. No microphone or shared audio is recorded, uploaded, or played back.

## Browser and local-network compatibility

| Feature                   | MacBook / desktop                                                                                                                       | iPhone / Android                                                                            |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Simulator and scenes      | Modern Safari, Chrome, Edge, Firefox                                                                                                    | Modern browsers; responsive single-column controls                                          |
| Browser microphone        | Requires permission and a secure context (`localhost` or HTTPS)                                                                         | Requires HTTPS and permission; background capture can be suspended                          |
| Shared tab / system audio | Requires `getDisplayMedia`; offered audio sources vary by browser and OS. Choose a browser tab and enable audio sharing where available | Often unavailable; use microphone on HTTPS or the demo source                               |
| Web Serial                | Feature-detected, secure context, compatible desktop browser, user-selected USB port                                                    | Do not depend on mobile Web Serial; use Wi-Fi                                               |
| ESP32 HTTP API            | Local HTTP app → local HTTP ESP32; firewall / local-network permissions may apply                                                       | Simulator and HTTP control work over LAN HTTP; microphone remains unavailable without HTTPS |

HTTPS browser pages can block HTTP device requests as mixed content, and browsers may also require local-network permissions. Use the locally served HTTP app for Wi-Fi device control. On a Mac, `http://localhost` is treated as a secure context for browser audio and Web Serial. A phone accessing `http://<Mac-LAN-IP>` is **not** accessing localhost. For phone microphone analysis use a locally trusted HTTPS setup; for standalone music sync use the ESP32 microphone instead. An HTTPS frontend cannot generally fetch the firmware’s HTTP-only API directly; a same-origin local proxy is a future integration option.

System audio capture may require sharing a video surface even though the app only analyzes the audio track. If the browser returns no audio track, the app stops all capture tracks and explains the limitation. Browser permissions always stay under user control.

Primary API references: [MDN screen capture](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia), [MDN microphone capture](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia), [MDN Web Serial](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API), [Espressif Arduino APIs](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/index.html).

## Connect the existing USB microphone sketch

If your ESP32 already prints `Sound Level: N` at 115200 baud, close Arduino Serial Monitor, open the local website in Chrome, and choose **Connect device → Studio JSON / microphone test → Connect with Web Serial → CP2102 / usbserial-0001**. The app recognizes this as a read-only microphone stream, shows live raw levels, and offers it as a Music Sync input. No firmware upload is needed. See [USB microphone setup](docs/USB_MICROPHONE.md).

## Connect the supplied preset-controller sketch

For the supplied sketch with the banner `PIXMOB STUDIO V2 READY!`, select **Preset controller (your sketch)** before opening Web Serial. This adapter sends only the sketch's character commands and confirms responses; it never sends the JSON handshake used by the other firmware. Connecting sends `X` to stop any active Auto/Music loop. Keep the existing IR GPIO32 and microphone GPIO26/25/27 wiring.

The hardware controls support six manual presets, Auto, ESP32 microphone Music Sync, Stop and relative sensitivity. `M` starts Music rather than selecting magenta; Stop ends sequencing and does not send a blackout command. Color/beat reports and Music-mode level telemetry feed the preview. RGB/HEX, brightness, speed, general effects and visual scenes remain simulator controls. This sketch has no Wi-Fi API or spectrum/BPM output. If it is already installed, no upload is needed. See [preset serial setup and limitations](docs/PRESET_SERIAL.md).

**White preset finding:** the supplied `WHITE[]` exactly matches upstream **WHITISH**, and its decoded channel values are R=204, G=176, B=92. It is a warm preset, not validated neutral white, and it is what the currently uploaded build still sends for `W`. The derived firmware source now carries a checksum-valid neutral-white candidate (R/G/B 204, the channel values of upstream `FAST_WHITE`) for `W`, keeps the warm frame behind a new `K` command, and announces this with `WHITE PRESET: NEUTRAL CANDIDATE (K = WHITISH)`. The website labels White by that report and shows a **Warm white** button only when the firmware offers it. The candidate build was uploaded with the user's authorization on 12 November 2026 (hash verified, prior application region backed up) and on 13 November the user compared the two website buttons on the wristband and reported the candidate visibly whiter than the original frame. The page now labels them **White** and **Warm white**; with the original sketch it shows **White (warm original)** instead. Later on 13 November the user found the single flashes of Green, White and Warm white weak and alike, so the source now builds every color from one level table (`firmware/PixMobBeatController/ColorLevels.h`) with lower Green, White and Warm white levels; see the end of [verification](docs/VERIFICATION.md). See [White IR audit and sources](docs/WHITE_IR_AUDIT.md).

## Derived beat controller and event-driven preview

The uploaded `firmware/PixMobBeatController/` keeps the supplied original unchanged and adds a separate IR worker and browser-controlled host mode. Manual colors, song cues and music triggers now use one frame. Auto retains three frames and 80 ms gaps. Microphone reads run only in microphone Music/diagnostic mode. The existing microphone pins remain 26/25/27 and IR remains GPIO32. Standalone microphone detection is available separately and explicitly labels its telemetry as a **bass envelope**, distinct from full-band amplitude, RMS or FFT data.

For direct music control in the noisy room: open Chrome at `http://localhost:5173`, connect with **Preset controller (your sketch)** and CP2102, then press **Browser song sync**. Choose the YouTube/music **Chrome Tab** and enable **Share tab audio**. The website observes the firmware's browser-beat capability, enters host mode and sends one RGB command only for a measured onset from that active shared track. The ESP32 microphone cannot trigger this mode. Use Audio analysis sensitivity for this path; **ESP32 music sync** is the separate room-microphone fallback.

With **Follow ESP32 events**, the two preview LEDs pulse and decay only after actual device completion reports. They do not run on the 120 BPM demo clock. The white case remains white; brightness is simulated and does not confirm physical wristband brightness or reception. HEX/RGB, effects, brightness, speed and scenes remain simulator controls. Capture and analysis stay local, with no cloud upload.

An AudioWorklet detects bass/drum onsets directly from PCM, independently of spectrum animation. Audio timestamps keep BPM estimation separate from message delivery jitter; events older than 100 ms are dropped. The audio panel shows onset count and latest interval. Browsers lacking that support use a labeled foreground fallback. Capture can still be suspended by browser/OS policy or sleep. The user confirmed that pausing the shared song stopped the physical wristband's flashing and resuming playback restored it. Exact beat phase alignment and optical latency were not measured.

Before automatic mode was added, **45% manual sensitivity** reduced subdivision triggering on the user's inspected 80 BPM 4/4 drum track; the user confirmed better physical alignment with one flash per beat. This remains a track-specific manual fallback, not a universal setting. The tempo display remains an estimate (81 BPM / latest 735 ms was observed).

### Automatic sensitivity

Browser microphone and shared-song inputs now default to **Automatic sensitivity**. It learns recent bass/drum energy and background levels, adjusts relative thresholds for quiet/loud passages, and rejects weaker subdivisions using recent drum prominence. Changing tempo does not require entering a BPM. It follows actual attacks, not a predicted clock, and pauses do not create replacement beats. Turn the switch off to use the manual sensitivity slider; that choice is remembered in this browser.

The automatic detector runs in the AudioWorklet. Older browsers show an explicit manual foreground fallback. It does not change the ESP32's standalone microphone detector, firmware or wiring. The deterministic PCM suite covers 60–180 BPM, multiple volumes, quiet/loud and tempo transitions, stereo, sustained sound and silence. Allow several real attacks to adapt after a large change; complex/syncopated music can still produce missed or additional detections. Tempo confidence describes recent interval regularity, not a verified song BPM or phase lock.

### Song shows and free rhythm

Use **Song shows** in the sidebar to compose a separate lighting program for each song. Name the show, add cue times and labels, and set preview color, Solid/Flash/Fade/Strobe/Rainbow, brightness and speed. **Save show** stores the program in this browser; select it again from Saved shows. The editor supports up to 16 saved shows and 1024 cues per show (within the 1 MB local storage budget). Audio files are not saved or uploaded.

- **Local audio:** choose an MP3/WAV and press Play show. Cue preview follows the file's audio clock. Pause freezes the show; seeking pauses and previews the new position. Select the file again after reload.
- **External player:** start YouTube/your player and the show's clock at the matching position. Align pause/seek manually; sharing tab audio does not expose YouTube's playback position to this editor.
- **Send cue colors:** optional, disabled until the verified preset serial controller is connected. Select one of the existing R/G/B/Y/C/W presets for each desired cue. **Device lead** (0–200 ms, default 40, stored in this browser) sends device cues early to offset serial, IR-frame and wristband delay; the preview keeps real time.
- **Tap on the beat:** play the song and press the tap pad in time with the music. Each press marks a cue at that moment without stopping playback; set colors afterwards with the color chips in the cue list. Editing cues and jumping to a position do not pause the show.
- **Perform and record with one-tap Cue pads.** Enable **Cue pads** in **Song shows**, load an audio file or select **External player**, and press **Start take**. Pads 1–8 each hold a complete color, light mode and duration, so a single number-row or numpad key previews the cue, sends it to an armed wristband and records it at the current song time. Use **Edit pads** before playback to change any pad to Quick flash, Stay lit, Strobe, Build-up or Rainbow; the bank is saved in this browser. Switch **Record take** to **Rehearse only** to perform without adding cues. Turn off **Cue pads** to replay the recorded timeline, then press **Save changes** to keep the take. If the controller is busy, a recorded hit can still appear in the cue list even though the device missed it.
- **Quick flash or Stay lit:** every cue is either the wristband's quick flash or a light that stays on for a chosen number of seconds (0.1–600). Batch buttons apply one light time to all cues or keep each cue lit until the next one. Timed lights need the beat controller build that reports `TIMED LIGHT: READY`; other firmware sends the quick flash. Starting device output leaves browser free-rhythm mode; preview-only playback does not take over the device. Pause, seek, editing and leaving the editor cancel further cue output. Resume sends future crossings, and skipped or busy cues are dropped rather than replayed.
- **Free rhythm:** return to Advanced DJ, choose the browser-song input and start sync for automatic live drum response. Authoring a program is optional; unprepared music can still use free rhythm.

Timeline effects, brightness and speed are simulator behavior. Physical song cues send only the selected existing color preset; they do not implement new IR fade, strobe, rainbow, hold or blackout protocols. The latest derived firmware sends one unchanged frame for each manual/song cue; the supplied original still repeats three frames. Busy cues may be dropped and a written transmission may finish after Stop. The Song shows hardware option currently uses the preset serial adapter, not the optional unverified Wi-Fi V2 adapter.

Device cue scheduling uses an independent silent audio clock and the actual song position, so it does not depend on preview animation frames. The editor shows the active clock, confirmed transmission count and last color. Unsupported browsers explicitly use a foreground timer. Browser suspension and system sleep can still interrupt output. **Make RGB device copy** creates a separate mapped test show when an older program contains only preview colors.

Choose **Single color pulse**, choose a color, then press **Apply pattern to current show** to recolor an existing program without moving its cue times. Save changes to keep it. Selecting a pattern alone configures the next draft. Custom HEX is exact only in the preview; hardware uses the closest of the six existing presets, named in the editor.

### Analyze a song and generate beat cues

In **Song shows → Local audio**, choose an MP3/WAV and press **Analyze song** in the Analyze rhythm panel. The browser reads the complete file locally and tracks beats without waiting for playback. Choose a single pulse color or RGB rotation and every 1st/2nd/4th beat, then **Create new beat draft**. Save existing edits first; generating a draft leaves saved programs unchanged and switches hardware output off.

Generated Flash cues use one 120 ms decaying preview pulse per selected timestamp, so a gap between beats does not create extra oscillating flashes. Pulse length and the rest of the cue can be edited. Above 1024 cues the draft is thinned by powers of two across the whole song so it keeps landing on the same beat of each bar; the UI reports the resulting stride. Saving the show keeps the resulting cue times, not the audio file or temporary analysis buffers.

Analysis supports mono/stereo files up to **100 MB / 10 minutes** and has a Cancel control. The worker computes a three-band spectral-flux onset envelope, estimates the tempo by prior-weighted autocorrelation, prefers the doubled tempo only when both alternating beat sets carry real attacks, tracks one beat chain by dynamic programming, snaps every beat to the rising edge of the audio around it, and drops grid beats that have no attack energy instead of filling silence. Songs without a stable tempo fall back to plain detected attacks. On the local Blinding Lights file this gives about 172 BPM with 563 beats (28–29 per 10 s throughout), within about ±20 ms of an independently phase-locked grid for 80% of beats; this is an offline analysis result, not a physical observation. Low-confidence results show a timing warning. No bars, downbeats or verse/chorus structure are inferred. Review and edit the timing before enabling hardware. External/YouTube timing remains manually aligned; offline analysis requires a selected local file.

The latest single-frame preset build (310,063 program bytes / 23,696 static RAM bytes) was uploaded with hash verification. Its six-color serial probe completed each send in about 31 ms with no additional output during observation gaps. The former Host-only optimization reduced a matched 16-command median from 40.2 to 32.15 ms. These measure software transmission completion, not optical reception or beat alignment. The original supplied sketch and prior applications are preserved. Software tests passed, but the room was not quiet enough to validate microphone silence rejection. See [setup, hashes and verification limits](docs/PRESET_SERIAL.md) and [observed verification records](docs/VERIFICATION.md).

## Optional newer Wi-Fi V2 controller by USB

For a board independently confirmed to run the separate Wi-Fi V2 firmware with `STATUS` support, select **Wi-Fi V2 controller (USB)**. This optional adapter uses newline-delimited ASCII commands and strict `STATUS` polling about every 250 ms. It has not been verified with physical V2 hardware in this setup: the visible onboard webpage was not reliable evidence of the installed firmware, and the attempted V2 handshake failed. Keep this option separate from the original/derived music controller. Its documented pins are IR GPIO32 and microphone GPIO26/25/27.

This version supports all seven presets, including **`M` for magenta**, separate `MIC LEVEL` / `MIC BEAT` modes, Auto RGB and absolute `SENS 1..100`. It reports RMS, last transmitted color and frame state, without explicit beat events or spectrum/BPM. Preview brightness changes are simulated, and a send count is not wristband reception confirmation. Its onboard HTTP API lacks CORS support, so use USB to connect this firmware to the React studio. These firmware options are selected explicitly; there is no automatic protocol identification. See [USB protocol guide](docs/PRESET_SERIAL.md).

## Hardware and firmware

The Arduino firmware targets the classic ESP32 DevKit V1 (38 pins, CP2102 USB-to-UART), KY-005 IR transmitter, and INMP441 I2S microphone. Optional TFT and future RF integrations are adapter interfaces. A specific TFT controller, RF module, carrier frequency, or PixMob packet format is not assumed.

The `PixMobStudio` JSON controller preserves microphone SCK GPIO26, WS GPIO25 and SD GPIO27, and reserves GPIO33 for IR. Firmware 1.1.0 sends live RMS amplitude events over USB after the controller status handshake. The separate supplied preset sketch and newer Wi-Fi V2 firmware use the same microphone pins and IR GPIO32. These sources drive preview levels; full spectrum/BPM analysis still uses browser audio.

Follow [firmware setup](firmware/README.md), [wiring](docs/WIRING.md), [API and protocol boundaries](docs/PROTOCOL.md), and [testing procedures](docs/TESTING.md) before using physical hardware.

| Capability                                        | Implemented status                                                                                             |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Color/effects, two profiles, animated wristband   | Fully simulated                                                                                                |
| Browser audio analysis and music-reactive preview | Real Web Audio, plus labeled synthetic demo                                                                    |
| Wi-Fi / USB device command transports             | Implemented HTTP + newline JSON serial clients and firmware handlers                                           |
| Supplied preset-sketch USB control                | Separate character-command adapter; fixed presets/modes only; physical reception requires observation          |
| Derived beat controller / browser song output     | Uploaded; host isolation probe passed; physical song pause/resume confirmed by the user                        |
| Newer Wi-Fi V2 firmware over USB                  | Optional ASCII/status adapter; physical V2 connection unverified in this setup                                 |
| Raw IR timing and carrier                         | Configurable interface; no default waveform; actual transmission requires a verified capture and bench testing |
| Standalone INMP441 sync                           | Firmware energy-peak trigger repeats the configured raw waveform; no inferred color encoding                   |
| PixMob IR lighting encoder                        | Reserved interface; protocol and compatibility unverified                                                      |
| RF                                                | Reserved interface; module, frequency and protocol unconfirmed                                                 |
| Optional 1.44-inch TFT                            | Adapter hook; controller-specific implementation deferred until hardware is identified                         |

No color or effect in Simple Mode is silently translated into a made-up IR command. The expert workbench deliberately transmits only explicitly supplied waveform data; the preset adapter uses the user's supplied sketch and its stored timings. A command acknowledgement confirms firmware acceptance, not optical reception by a wristband. Standalone mode does not convert browser lighting scenes into a verified wristband protocol.

## Project structure

```text
src/App.tsx               Console UI, scenes and input orchestration
src/ColorPicker.tsx       Saturation/value and hue interaction
src/lib/effects.ts        Pure lighting model and effect sampling
src/lib/audio.ts          Web Audio capture, FFT bands and event estimates
src/lib/device.ts         HTTP/Serial transports, IR validation, encoder/RF seams
src/lib/presetSerial.ts   Supplied sketch's allowlisted character-command adapter
src/lib/v2Serial.ts       Newer Wi-Fi V2 ASCII/status USB adapter
src/lib/browserBeat.ts    Measured browser-onset output, bounded to one pending beat
src/style.css             Responsive console and CSS wristband model
firmware/PixMobStudio/    Arduino ESP32 firmware and adapter interfaces
firmware/PixMobPresetSerial/ Unchanged supplied preset-controller sketch
firmware/PixMobBeatController/ Derived bass-onset controller and IR worker
firmware/README.md        Build and upload instructions
 docs/                   Wiring, API/protocol contract and test procedures
 tests/                  Deterministic module and transport tests
```

## Verification

`npm run build` performs strict TypeScript checking and produces the static bundle. `npm test` exercises bounded effects, color conversion and scene validation, BPM/onset/drop behavior, waveform limits, HTTP failures/disconnect, serial framing, and audio capture cancellation. Browser checks cover console rendering, basic controls, scenes, DJ input selection and responsive layouts. The physical hardware checklist is in `docs/TESTING.md`; software checks are not evidence of wristband compatibility.
