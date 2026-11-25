# USB controller protocols

**Current board, 15 November 2026:** use **Preset controller (your sketch)** with the restored `beat-effects-build`. It supports custom colors, timed lights, fades, strobes, manual rainbow and beat styles; idle/breathing features remain in the newer source but are not installed. `X` can cut an active light and `.M` flashes magenta. Historical paragraphs below that restrict song output to six quick-flash presets, describe Stop as sequence-only, or call `beat-hold-build` current have been superseded. See the [consolidated handoff](CLAUDE_HANDOFF.md) for the current command table, observations and exact binary hash.

Choose the USB protocol that matches the installed firmware. The website does not automatically identify these sketches or replace firmware when an option is selected.

| USB option | Installed firmware | Meaning of `M` | Music data |
| --- | --- | --- | --- |
| **Wi-Fi V2 controller (USB)** | Newer V2 with its own `http://192.168.4.1` webpage and `STATUS` command | Manual magenta | Polled RMS, color and frame status |
| **Preset controller (your sketch)** | Supplied original sketch or derived `PixMobBeatController` | Start microphone sync | Original/derived microphone levels and beat reports; host-capable derived firmware also accepts browser song beats |
| **Studio JSON / microphone test** | Project JSON controller or supported read-only microphone test sketches | No shared character-command meaning | JSON RMS or supported test-sketch text |

The adapters use different command framing and acknowledgements. Sending `STATUS` to the old character sketch can invoke its `A` command, while sending JSON can invoke several letters as commands. Use the correct explicit option rather than trying command formats at random.

## Current workflow: browser song sync

Use **Preset controller (your sketch)** with the uploaded host-capable [PixMobBeatController.ino](../firmware/PixMobBeatController/PixMobBeatController.ino). Browser song sync analyzes the directly shared music track, so room sounds cannot cause IR triggers in this mode. The ESP32 microphone wiring remains unchanged and is available as a separate fallback. The derived firmware is a separate source folder; [PixMobPresetSerial.ino](../firmware/PixMobPresetSerial/PixMobPresetSerial.ino) remains an unchanged copy of the supplied original.

1. Close Arduino Serial Monitor, start the local website and open `http://localhost:5173` in compatible desktop Chrome. Open the music in another Chrome tab, for example YouTube.
2. Choose **Connect device → Preset controller (your sketch) → Connect with Web Serial**, then select CP2102 / `usbserial-0001`. Connection sends `X` and confirms `AUTO / MUSIC STOPPED`.
3. In **ESP32 live control**, press **Browser song sync**. In Chrome's chooser, select **Chrome Tab**, select the music tab, enable **Share tab audio**, then share it. A video-only share is rejected. Capturing an arbitrary whole-system source is not guaranteed across browser/OS combinations.
4. The website requires the firmware's `CAPABILITIES: BROWSER BEATS` report, enters host mode and confirms `BROWSER SYNC ON`. Only measured onsets from the active shared track can request one-frame RGB sends. The room microphone cannot trigger this mode.
5. Play and pause the shared music. No new onsets or outgoing beat digits should occur while that source is paused; silence does not start a tempo loop. The user has confirmed physical flashing stops on pause and resumes with playback in this setup. Exact per-beat alignment remains an uncalibrated listening/visual check.
6. Use **Follow ESP32 events** in the preview. Its two-LED pulse starts only after an actual `BEAT! Color sent: …` completion report, then decays. The white shell remains white. This does not insert 120 BPM demo pulses or turn a steady audio level into regularly timed beats.
7. Adjust browser onset sensitivity in **Audio analysis**. Standalone microphone sensitivity buttons do not control host analysis. General HEX/RGB, effects, brightness, speed and scenes remain simulator controls; changing them selects the simulator view. Return to **Follow ESP32 events** to inspect the board's reported sends.

The preview is simulated light based on device reports. It does not measure the physical wristband's brightness, prove IR reception or ensure every musical beat is detected. Stop ends Auto/Music sequencing; the previous wristband color may stay on.

### Browser mode protocol and analysis clock

| Item | Exact protocol |
| --- | --- |
| Capability metadata | `CAPABILITIES: BROWSER BEATS` |
| Enter browser/host mode | `H` → `BROWSER SYNC ON` |
| One browser beat | `1` / `2` / `3` → one R / G / B frame, only in host mode |
| White candidate metadata (current uploaded build) | `WHITE PRESET: NEUTRAL CANDIDATE (K = WHITISH)` |
| Warm white (only after that metadata). Builds up to `beat-hold-build` send the original WHITISH frame; the `beat-levels-build` source sends the same hue at 124/108/56 | `K` → `Color sent: K` |
| Timed light capability (current uploaded build) | `TIMED LIGHT: READY` |
| Timed light: flash or hold for a set time (only after that capability) | `#<color><ms>`, e.g. `#R1500` → `Light: R 1500`; colors R/G/B/Y/C/M/W/K, 50–600,000 ms; `X` ends it early |
| Strobe capability (`beat-strobe-build` source) | `STROBE: READY` |
| Strobe / build-up strobe (only after that capability) | `!<color><ms>` → `Strobe: W 2000`; `^<color><ms>` → `Build: W 8000`; colors R/G/B/Y/C/M/W/K, 200–60,000 ms |
| Custom light capability (`beat-custom-build` source) | `CUSTOM LIGHT: READY` |
| Custom color, flash line and fades (only after that capability) | `<color>` may be `=RRGGBB` (levels ≤ `C8`); `.<color>` → `Flash: <color>`; `#<color><ms>,<in>,<out>` → `Light: <color> <ms> <in> <out>` |
| Rainbow capability (`beat-rainbow-build`) | `RAINBOW: READY` |
| Rainbow (only after that capability) | `~<ms>[,<cycle ms>]` → `Rainbow: <ms> <cycle ms>`; 500–600,000 ms, cycle 1,000–20,000 ms |
| Beat effects capability (`beat-effects-build`) | `BEAT EFFECTS: READY` |
| Beat look and colors for Browser / Auto / Music (only after that capability) | `@F`, `@L<ms>[,<in>,<out>]`, `@S<ms>` → `BEAT STYLE: …`; `@P<letters>` / `@P*` → `BEAT PALETTE: …`; beat digits `1`–`8` and `*<color>` in host mode |
| Power-on rainbow setting (`beat-breathe-build`) | `IDLE RAINBOW: ON` / `IDLE RAINBOW: OFF` in the banner and after `H`; `@I1` / `@I0` change it and echo the same line |
| Idle rainbow seconds (`beat-idle-build`; rolled back, the board runs `beat-effects-build` again) | `IDLE RETURN: READY`, then `IDLE RAINBOW: OFF` / `ON` / `ON <s>`; `@I0`, `@I1` or `@I2`–`@I3600` change it. A bare `\r` is ignored but restarts the idle wait (sent every second during song-show playback, no acknowledgement) |
| Completed frame | `BEAT! Color sent: R` (or G/B) |
| Stop / return to microphone | `X` / `M` respectively |

The original supplied sketch lacks this capability; the website must not offer host commands based only on the old banner or microphone data. In host mode the ESP32 skips blocking microphone reads and its microphone detector cannot transmit. No incoming beat digit means no new IR send. The browser dispatcher uses measured onset edges only, spaces starts by at least 200 ms, drops new onsets while a prior command is pending and advances its RGB sequence only after a successful completion. It does not build a delayed queue or replay beat commands after errors. Demo and ESP32 amplitude frames cannot drive this browser output.

When supported, an AudioWorklet detects onsets directly from PCM in approximately 5 ms windows, using separate bass and drum-body bands, rising energy, adaptive thresholds and persistence. Stereo channel powers are combined without phase cancellation. Detected onsets immediately notify device control; the approximately 30 Hz spectrum updates cannot trigger hardware. View reads reuse cached frames. BPM uses audio sample timestamps rather than variable message delivery times. Events older than 100 ms are discarded instead of replayed. The worklet's output is silent, so it does not duplicate music playback. Neither the detector nor the BPM estimate generates predicted beats.

The audio panel shows the detected-onset count and latest measured interval. At 80 BPM, quarter-note spacing is 750 ms; 4/4 bars are 3 seconds. These readouts are detector observations, not confirmation of optical reception or a reason to generate a fixed 750 ms timer. Quiet/complex music can still produce missed or additional onsets. Without AudioWorklet the website falls back to foreground FFT analysis and explains that the controller page must remain visible. Background capture remains subject to browser/OS policies, suspended audio contexts and sleep; continuous operation through those conditions is not guaranteed.

Browser-song analysis now defaults to **Automatic sensitivity**, learning recent band levels and drum prominence as volume/tempo change. It does not enter a fixed target BPM or synthesize missing beats. Switch it off to reveal manual sensitivity. In the earlier manual test of the inspected 80 BPM 4/4 track, **45%** reduced halfway subdivision detection and the user confirmed better alignment with one physical flash per beat. That is a track-specific fallback; the fresh manual slider default remains 60%. Automatic browser analysis does not change the ESP32 standalone microphone detector.

The **Song shows** editor can also schedule the existing manual color presets. Its physical-output option first leaves browser-song Host mode and then sends supported preset characters at future cue crossings. Only R/G/B/Y/C/W are exposed; Fade/Strobe/Rainbow/brightness/speed and arbitrary HEX remain preview settings. Preview-only shows do not take over hardware. Stop or another mode-change intent cancels unwritten cue presets, including while they await their own Host-exit Stop barrier; a request already written can finish. There is no inferred blackout command or new PixMob protocol.

Capture and analysis stay local. No audio is uploaded to a cloud service, and only the resulting beat/color commands go to the ESP32 over USB. Stop sharing, change input or stop output to end this path. A frame already transmitting may finish.

### Standalone microphone fallback

For microphone-based operation, choose the separate **ESP32 music sync** control (`M`), place the existing INMP441 near music from speakers and allow the initial one-second detector warmup. Keep SCK/BCLK26, WS25, SD27 and L/R-to-GND unchanged; IR remains GPIO32. Hardware **More sensitive / Less sensitive** changes the standalone detector's threshold ratio. In this mode the audio-panel sensitivity affects preview gain only.

This fallback can respond to environmental sound. The room could not be made quiet during this session, so pausing the song did not provide a controlled silence test or establish the source of observed detections. Do not classify noise, transmission interference or silence rejection from those observations alone. Browser song sync avoids using the room microphone for IR decisions.

### Derived beat-controller changes

The derived firmware keeps the original seven timing arrays, 38 kHz carrier, IR GPIO32 and microphone GPIO26/25/27. It moves IR transmission to a separate worker so microphone sampling continues during sends. In the latest build, manual/song colors and music triggers send one frame. Auto retains three frames with 80 ms inter-frame gaps. `PRESET FRAMES: 1` explicitly identifies the manual single-frame behavior. Microphone sampling runs only in Music/diagnostic mode, avoiding unused blocking reads during manual/song output. A bounded one-job mailbox avoids a growing transmission backlog.

The detector follows a filtered bass envelope (approximately 35–200 Hz) with an adaptive threshold, hysteresis, onset-rise test and a minimum 180 ms trigger interval. This is an onset detector, not a tempo clock: no repeating timer creates Music-mode triggers. Silence and sustained sound can produce no triggers, and speech/noise or complex music can still produce false or missed detections. Reducing the repeat count can affect short-range reception reliability and needs an actual wristband check.

The derived firmware identifies itself with:

```text
PIXMOB BEAT CONTROLLER READY!
AUDIO FORMAT: BASS ENVELOPE 16-BIT
```

In Music mode it reports `Level:N Threshold:N` about every 50 ms. These numbers represent the filtered bass envelope and its actual adaptive threshold, scaled by 32,768 for transport compatibility. They are not the original sketch's full-band mean-absolute level, raw PCM, a calibrated loudness measurement or an FFT spectrum. The explicit format line lets the website label them **bass envelope**. `BEAT! Color sent: R/G/B` is emitted after the corresponding worker transmission completes, not as a wristband acknowledgement.

### Observed uploads and verification boundary

On 2026-11-11 the connected board first confirmed the older RGB-only firmware with `Auto Mode OFF`. Its full 4 MB flash was backed up before the authorized upload of the supplied original music sketch. The original upload completed; that build used 306,035 bytes of program storage and 23,624 bytes of static RAM. A subsequent 20-second external-music observation produced 68 level samples (raw 68–1,191) and 20 beat reports, with report intervals about 0.447–1.755 seconds. These establish a responsive stream for that original build, not rhythmic accuracy or physical wristband response.

| Artifact | SHA256 |
| --- | --- |
| Full prior RGB flash: `.arduino/backups/2026-11-11-before-music/esp32-rgb-full.bin` | `a4b9a566ab344ff256953f36da423f6e4ef6c7c3c1502b5d05c8eda722d9837f` |
| Uploaded original music app binary | `a4cd8f4d3fae50d04df10a61a993c90ea32e4ac14124f6d0b02f77b1b848678f` |
| Uploaded host-capable derived app binary | `90d84d2cf9c9440d425cc886dae97584415c07f1cd39e71974bf76789c2bc33d` |
| Current uploaded app binary with timed lights (`.arduino/beat-hold-build/`, 13 Nov 2026) | `5b24d1e07b0d575977280c881afb399cac57ec0fd3b1207e03392a61bab15202` |
| Previous neutral-white candidate app binary without timed lights (`.arduino/white-candidate-build/`, 12 Nov 2026 evening) | `bb9092b038183e2d1872843193cdd53bad858cb6ffa739cf1d90a04eec14ad37` |
| Application-region backup read back before that upload (`.arduino/backups/2026-11-12-before-white-candidate-app.bin`, mode 600) | `1212611b4a1fc09f4448008c6f2ecd9d2f4eeb6f5a33d824a5c0270d163d2ddb` |
| Uploaded low-latency Host app binary | `0a0bdf9a943cfa46b881927f559f2e63387a66f2482ee1ccf30c9640406fb0ea` |
| Uploaded single-frame manual/song app binary | `2ec5efacf5223f808387aa30ef1194f2e3ae0b0829da067cfc6c6d491d9101f4` |

The full-flash backup is private with file mode 600 under the ignored `.arduino/` directory; do not publish it. The initial host-capable derived firmware used 310,027 bytes of program storage and 23,696 bytes of static RAM. The later Host optimization used 310,035 / 23,696 bytes. The current single-frame build uses 310,063 / 23,696 bytes and is in `.arduino/beat-single-frame-build/`. Uploads used application offset `0x10000`, 57,600 baud and written-data hash verification. The previous builds remain in `.arduino/beat-build/` and `.arduino/beat-latency-build/`. Before the latest upload, 327,680 bytes of the installed application region were read back and matched the prior Host binary; backup `.arduino/backups/2026-11-12-before-single-frame-app.bin`, SHA256 `7c01fc9dffd22e3c53ab4e1103c7bac93133f412fec2142c3c71f5168248d754`, mode 600.

For an authorized controlled color test, disconnect the webpage and run `python3 scripts/probe-single-pulse.py --all --interval 5`. The script requires the explicit single-frame metadata before sending manual colors. It sends R/G/B/Y/C/W once each, checks the completion reply, observes five seconds without autonomous color reports, then stops and closes USB. The gap is observation time, not a verified five-second hold command. `M` remains microphone Music, so the manual test never sends it as magenta. Physical flash count must be observed separately.

A physical serial host-mode probe passed: no events during a two-second idle window before or after four explicit one-frame RGB commands. Serial completion times were approximately 45.8–73.9 ms. This confirms command isolation and software transmission completion on the connected ESP32; it does not measure optical timing, reception or song alignment.

The later matched 16-command comparison uses immediate line-triggered timing rather than the earlier coarse receive window. Before optimization the median was 40.2 ms (33.3–57.6 ms); after skipping unused Host-mode microphone reads it was 32.15 ms (31.6–32.6 ms). No autonomous sends occurred in either idle comparison. Each preserved IR frame is 27.3 ms. These figures exclude capture, browser onset detection and physical wristband response; see the dated verification record.

Twelve host-side synthetic microphone-detector scenarios and all 73 automated tests passed, including dispatcher gating/backpressure, high-baseline browser onsets and AudioWorklet lifecycle/cancellation. These checks do not prove performance on all music or through every browser background condition. On 12 November 2026, the user confirmed the physical wristband stopped flashing when the shared song was paused and resumed when playback resumed. Exact per-beat phase alignment and optical latency were not measured; see [VERIFICATION.md](VERIFICATION.md).

## Optional newer Wi-Fi V2 controller over USB

Use **Wi-Fi V2 controller (USB)** only for a board independently confirmed to run the separate Wi-Fi V2 firmware with `STATUS` support. Its USB protocol is newline-delimited ASCII at 115200 baud. This is distinct from both the supplied older preset sketch and the project's JSON controller. The adapter is optional and has not been verified against physical Wi-Fi V2 hardware in this setup: an earlier visible Wi-Fi page did not establish the flashed firmware, and the attempted V2 handshake failed. Do not choose this option for the connected original/derived music controller.

1. Keep the installed V2 firmware and existing IR GPIO32 / microphone GPIO26/25/27 wiring. No firmware upload is needed for this adapter.
2. Close Arduino Serial Monitor, run `npm run dev`, and open `http://localhost:5173` in a desktop browser offering Web Serial.
3. Choose **Connect device → Wi-Fi V2 controller (USB) → Connect with Web Serial**, then select CP2102 / `usbserial-0001`.
4. The adapter requests `STATUS` and requires the V2 status schema. It polls status about every 250 ms to obtain actual device mode, RMS, last transmitted color and frame count. A browser connection is not evidence that a wristband received IR.
5. Use V2's hardware preset, Auto, volume-response, beat-response, Stop and sensitivity controls. These commands operate the ESP32; the general simulator controls remain separate.

| Action | Newer V2 serial command |
| --- | --- |
| Red / Green / Blue / Yellow / Cyan / Magenta / White | `R` / `G` / `B` / `Y` / `C` / `M` / `W` |
| Auto RGB | `AUTO ON` (also accepts `A`) |
| Microphone volume response | `MIC LEVEL` |
| Microphone beat response | `MIC BEAT` |
| Stop automatic/music sending | `STOP` (also accepts `X`, `AUTO OFF`, `MIC OFF`) |
| Absolute sensitivity | `SENS N`, integer 1–100 |
| Read state | `STATUS` |

Accepted commands return the bare line `OK`; rejected commands return `ERR command`. `STATUS` returns a JSON object with `mode` (`manual`, `auto`, `level` or `beat`), `sensitivity`, `rms`, `micOk`, `clip`, `busy`, `color`, `frames` and `clients`. This JSON has no firmware version or request ID. The website validates this distinct schema rather than accepting any JSON as the project controller API.

V2 sensitivity is an absolute 1–100 setting; higher values trigger more readily. It is not the older sketch's 1.10–2.50 threshold ratio or its `+`/`-` steps. Manual presets exit Auto/Music. Auto cycles RGB every 1.5 seconds. Volume response chooses weak blue / medium green / strong red; beat response rotates RGB on detected onsets, with an initial one-second sampling warmup. Stop cancels further automatic/music sending and pending repetitions; it is not a verified wristband blackout command.

V2 samples the microphone continuously and reports normalized, DC-removed 24-bit RMS through status, including in manual mode. The preview can follow these amplitude and last-color reports. Its changing brightness remains simulated: the firmware does not confirm physical wristband brightness. `frames` counts completed IR sends, not optical reception. V2 does **not** report individual beat events; a changing color/frame count must not be presented as an explicit device beat event. It also supplies no PCM, FFT, frequency bands, BPM or drop-analysis data. Browser audio analysis retains its separate source label.

The newer V2 firmware has its own Wi-Fi webpage and HTTP API: GET `/api/status`, and POST `/api/command` using `application/x-www-form-urlencoded` field `cmd`. It provides no CORS headers or OPTIONS handler. A React page on `localhost:5173` cannot directly use that cross-origin API with the existing browser transport; use this USB option for the studio connection. Opening the onboard page directly remains a separate way to operate it. No proxy or firmware changes are silently installed.

## Supplied older preset-controller sketch

This integration is for the exact character-command sketch preserved in [PixMobPresetSerial.ino](../firmware/PixMobPresetSerial/PixMobPresetSerial.ino). It is separate from the JSON/HTTP firmware in `firmware/PixMobStudio/` and from the read-only microphone test sketches. No IR timing arrays, microphone pins or firmware behavior are changed by the website adapter.

The supplied timing arrays are user-provided preset data. The adapter does not derive a general PixMob protocol, add arbitrary colors or establish compatibility with other wristband revisions. A serial acknowledgement confirms that the sketch handled a command; verify wristband reception separately.

### Connect locally

1. If the supplied sketch is already installed, keep it installed. No firmware upload is needed for this website integration. Close Arduino Serial Monitor and other programs holding the USB port.
2. Start the website with `npm run dev` and open `http://localhost:5173` in a desktop browser offering Web Serial, such as a compatible Chrome or Edge version.
3. Open **Connect device**. Select **Preset controller (your sketch)** as the USB firmware protocol, then **Connect with Web Serial** and select the CP2102 / `usbserial-0001` port. USB runs at 115200 baud.
4. The adapter sends `X` to stop any current Auto/Music loop and expects the sketch's `AUTO / MUSIC STOPPED` acknowledgement. It may retry `X` once after 1.8 seconds while an ESP32 is booting; connection fails if the acknowledgement is absent after 4.5 seconds. This does not send a blackout command. An unrecognized device must fail the connection rather than be presented as this controller.
5. Use the separate hardware preset controls after connection. Check the reported device mode and command acknowledgement before interpreting the preview as evidence of a hardware command.

Select **Studio JSON / microphone test** only for the project's JSON controller or supported read-only microphone sketches. Never send JSON requests to the supplied character-command sketch: it interprets letters inside JSON as individual commands. Its adapter sends only the explicitly allowed characters below.

Web Serial requires a secure context (`localhost` or HTTPS), browser support and a user-selected port. Do not depend on it on iPhone or Android. This particular sketch has no Wi-Fi network, HTTP API or system-audio input; changing the website's device address cannot add them.

### Existing wiring

| Connection | ESP32 GPIO |
| --- | --- |
| KY-005 IR signal | 32 |
| INMP441 SCK / BCLK | 26 |
| INMP441 WS / LRCLK | 25 |
| INMP441 SD / data | 27 |
| INMP441 L/R | GND, matching the sketch's left-slot input |

Keep the existing microphone wiring. Use the established board/module power and emitter-driver wiring; this adapter does not change electrical requirements. The separate `PixMobStudio` JSON firmware uses IR GPIO33, so its IR-pin documentation does not apply to this supplied GPIO32 sketch.

### Actual hardware commands

| Website action | Serial character | Expected acknowledgement |
| --- | --- | --- |
| Red / Green / Blue / Yellow / Cyan / White | `R` / `G` / `B` / `Y` / `C` / `W` | `Color sent: R`, etc. |
| Auto | `A` | `AUTO MODE ON` |
| Music Sync | `M` | `MUSIC SYNC ON` |
| Stop Auto/Music | `X` | `AUTO / MUSIC STOPPED` |
| More sensitive | `+` | `Sensitivity: N.NN` |
| Less sensitive | `-` | `Sensitivity: N.NN` |

`M` enters Music Sync, so it cannot select magenta manually. Auto can still transmit the stored magenta preset internally. Auto cycles R, G, B, Y, C, M, W; Music Sync cycles R, G, B on detected beats. Selecting a manual color exits Auto/Music; the adapter first confirms Stop before sending that color, preventing an autonomous color report from being mistaken for the manual command's acknowledgement. Sensitivity changes the firmware's threshold ratio in steps of 0.10, bounded to 1.10–2.50; a lower ratio is more sensitive. The initial ratio after reset is 1.35. The website uses the printed acknowledgement for the displayed value rather than assuming a reset occurred.

Stop ends sequencing. The wristband may keep its previous state because the sketch contains no verified off command. Disconnecting USB in the website also does not establish that the ESP32 or wristband stopped; send Stop and observe its acknowledgement first when that is the intended action.

Commands are queued and wait for the matching acknowledgement, normally within 2.5 seconds. A command timeout faults the connection and requires reconnecting so that a late response cannot be mistaken for a later command. Color, mode and sensitivity commands are not retried automatically. Reconnecting sends the Stop handshake again.

The RGB/HEX picker, brightness, speed, Flash/Fade/Strobe/Rainbow, artist profiles and saved visual scenes remain simulator controls. They are not translated into this sketch's IR packets. The raw-IR workbench, standalone JSON commands and RF interface also do not belong to this serial protocol.

### Music telemetry and the two-LED preview

Music Sync uses the ESP32's INMP441. Place it near music playing through speakers; headphones normally do not supply useful acoustic input to this microphone. In Music mode the sketch emits:

```text
Level:781 Threshold:1054
BEAT! Color sent: R
```

For this unchanged original sketch, `Level` is a mean absolute sample magnitude after shifting the 32-bit I2S samples by 16 bits. The adapter normalizes it by 32,768; it is neither calibrated loudness nor RMS. Level/threshold lines occur about every 250 ms while Music mode is active. The separate `BEAT! Color sent: …` line reports a detected beat and the preset transmitted by the sketch. In the website's device-follow Music preview, these beat reports start decaying two-LED pulses; the level only influences visual strength and the displayed meter. Its white housing and lights are a visual simulation, not an optical measurement of the physical wristband. The derived firmware's bass-envelope format and 50 ms reporting interval are described above.

Manual and Auto modes do not print live microphone levels. Missing or stale telemetry must not be interpreted as live silence. This sketch does not stream PCM audio, FFT bins, bass/mid/treble, BPM or drop analysis. Advanced DJ spectrum and tempo analysis still require browser microphone/shared audio or the labeled demo source.

Every preset transmission is blocking: three 27.3 ms frames plus two 80 ms gaps take about 242 ms. Microphone sampling and serial handling pause during that work. The beat detector also enforces more than 420 ms between triggers, so closely spaced beats may be skipped; the preview is not sample-accurate music synchronization.

## Verification record

Software transport tests can verify parsing, allowlisted writes, acknowledgements, timeouts and cleanup. They cannot prove which firmware is currently flashed, emitter output or wristband response. For a physical check, record the selected protocol, actual firmware source, GPIO32 IR wiring, microphone response, command/acknowledgement, wristband revision and observed behavior. Follow the matching controller checklist in [TESTING.md](TESTING.md). Do not mark hardware results passed until observed.
