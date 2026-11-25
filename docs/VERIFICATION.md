# Software verification record

Recorded for this implementation on 7 November 2026 (Asia/Kuala_Lumpur).

- `npm run build`: passed strict TypeScript checking and Vite production bundling.
- `npm test`: 18 tests passed, covering deterministic bounded lighting, colors and scene validation, demo signal/arrangement, tempo/onset/drop heuristics, waveform input bounds, HTTP errors/disconnect, serial message fragmentation/cleanup, and audio cancellation or missing shared audio.
- Dependency audit at installation: zero reported vulnerabilities.
- Browser UI: checked Simple and Advanced DJ rendering; HEX input and profile selection; keyboard effect selection and Music Sync; custom scene saving and persistence after reload; DJ source options and sensitivity; connection dialog; mobile navigation; disabled hardware output while disconnected.
- Layout: no document-level horizontal overflow at 1440 px desktop, 390 px iPhone-style and 412 px Android-style widths. This is browser viewport testing, not certification on physical phone models.
- Browser console: no warnings or errors in the inspected session.

No browser microphone permission or system-audio sharing was requested during these UI checks. Capture lifecycle and error paths were tested with mock streams in the automated suite. Physical browser microphone/system-audio response remains a manual check.

Firmware compile status is recorded in [firmware setup](../firmware/README.md). Controller upload, USB status and microphone telemetry have now been checked as recorded below. IR optical output, TFT, RF and physical wristband response remain unverified. Follow [TESTING.md](TESTING.md) and record measured results before claiming hardware compatibility.

## Existing ESP32 USB microphone connection

On 7 November 2026, the connected CP2102 device was observed at `/dev/cu.usbserial-0001`, running the user's existing microphone-test sketch. Arduino Serial Monitor showed changing `Sound Level: N` readings. Its monitor was closed to release the port. The user selected the USB port in desktop Chrome at `http://localhost:5173`.

The browser reported **Serial port connected**. PixMob Studio reported **ESP32 USB connected**, **ESP32 USB LIVE**, and changing raw levels, including 225, 331 and 444 in separate observations. Music Sync was enabled and the preview-level meter changed with the stream. No firmware was flashed, no IR/RF was transmitted, and the controller firmware compile/hardware status remains unchanged.

Three additional automated tests cover read-only microphone-test recognition and stale-sample expiry, malformed telemetry rejection, and controller JSON status taking precedence over microphone log lines. The final production build and all 16 tests pass.

## Controller firmware upload with preserved microphone wiring

On 7 November 2026, controller **1.1.0** was compiled and uploaded to the connected **ESP32-D0WD-V3, revision 3.1, 4 MB flash** through `/dev/cu.usbserial-0001`.

- Toolchain: Arduino CLI 1.5.1, Arduino-ESP32 3.3.12, ArduinoJson 7.4.2.
- Microphone configuration retained: SCK/BCLK GPIO26, WS GPIO25, SD GPIO27; left I2S slot, 16 kHz, 32-bit slots.
- IR output reserved on GPIO33 to avoid a conflict with microphone WS. No waveform was configured or transmitted.
- Build: 992,605 bytes program storage, 50,464 bytes static RAM. Application binary SHA-256: `c5baee08c694539deed01e03ef9279a281cba7f7abb58169dfef612818dc4d1a`.
- Full pre-upload 4,194,304-byte flash backup: `.arduino/backups/esp32-before-controller-2026-11-07.bin`, SHA-256 `a45177d6ac02674093f42169dbc758d67d4eff85c565cd18b0916d28a8c3f118`. Original microphone-test source: `.arduino/backups/microphone-test.ino`. Backups are local and ignored by Git.
- The initial 460800-baud backup read encountered serial noise; the full retry at 115200 baud completed successfully. Upload at 115200 completed with every written segment hash verified.
- `scripts/probe-controller.py` passed against the physical board. JSON status reported firmware 1.1.0, mode controller, the expected pins, `micInitialized: true`, `micAvailable: true`, `irReady: true`, `irConfigured: false`, `irTransmitting: false`, `standaloneEnabled: false`, `rfSupported: false`, and an empty `lastError`.
- The probe received 46 valid RMS telemetry events, with raw levels from 34,652 to 6,245,522. It confirmed rejection of unconfigured IR send and invalid IR config requests; standalone was stopped.
- Desktop Chrome was reconnected to the CP2102 port. PixMob Studio showed **ESP32 USB connected**, **ESP32 USB LIVE**, **24-BIT RMS**, a live reading of 282,506 during inspection, and Music Sync enabled.
- Final website production build and all 18 automated tests passed, including controller event validation and preventing telemetry from masquerading as a controller handshake.

No physical IR emission, PixMob reception, RF, TFT or standalone waveform-trigger test was performed. The HTTP service reports access-point IP `192.168.4.1`; this task verified the USB path and did not change the Mac's Wi-Fi connection to test HTTP.

## Real music synchronization test — 10 November 2026

The user's new music-sync sketch was observed running on the connected ESP32 with the existing microphone pins 26/25/27. Its real USB output was `Level:N Threshold:N Beat:0|1`; the user confirmed music was playing through an external speaker near the ESP32 microphone. Arduino Serial Monitor was closed so Chrome could receive the port exclusively. No firmware was flashed during this test.

The website was updated to accept this strict bounded text format as read-only microphone telemetry. It identifies the sketch as **ESP32 music sync test**, retains the mean-absolute 16-bit amplitude scale, and preserves controller JSON precedence. All 20 automated tests and the production build passed.

Physical/browser checks:

- Chrome showed a connected serial port and **ESP32 USB LIVE**. Audio source was **ESP32 USB microphone · live level**; the synthetic demo source was not used.
- The test used Solid temporarily, red light, brightness 100%, Music Sync on, and sensitivity 20% to isolate microphone amplitude from timed Flash effects.
- Eight native UI snapshots captured raw values 397, 397, 809, 1191, 781, 1063, 1063 and 760. Preview meter observations were 21%, 21%, 44%, 100%, 36%, 52%, 52% and 48%. These are UI observations; independently refreshing fields are not a calibrated sample-by-sample latency measurement.
- With Music Sync off and Solid selected, microphone input still varied (roughly 9–16% in the comparison views), while both visible LEDs stayed at the fixed high brightness. Turning Music Sync back on restored microphone-driven dimming, with a further 41% meter observation and visibly softer internal light.
- The white housing remained neutral and only the two internal visible emitters changed brightness. No third visible light source appeared.
- The final handoff restored Flash and kept Music Sync on, sensitivity 20%, and the ESP32 USB source connected. The live LED preview was left visible.

This verifies sound-amplitude modulation of the virtual preview. It does not establish calibrated timing, per-beat phase locking, browser spectrum from the ESP32 stream, physical wristband reception or IR/RF output. The current test sketch's Beat field is parsed as reported telemetry; the preview's Music Sync still follows amplitude.

## Preset serial integration and bass-onset update — 11 November 2026

The physical board initially replied `Auto Mode OFF`, identifying an older RGB-only sketch. A previously open Wi-Fi V2 page was insufficient evidence of the firmware currently installed. Separate explicit USB adapters now preserve the character-preset, newer Wi-Fi V2 ASCII, and original Studio JSON/microphone-test protocols. The Wi-Fi V2 adapter has mock-stream coverage but has not passed a physical handshake on this board.

The user explicitly selected uploading the supplied music sketch while retaining microphone wiring, then requested an improvement because the **physical wristband** appeared to jump regularly. GPIO32 remains the IR output; INMP441 remains BCLK26 / WS25 / SD27, left slot, 16 kHz / 32-bit.

- Complete original RGB flash backup: 4,194,304 bytes at `.arduino/backups/2026-11-11-before-music/esp32-rgb-full.bin`; SHA-256 `a4b9a566ab344ff256953f36da423f6e4ef6c7c3c1502b5d05c8eda722d9837f`. Read at 230400 baud; backup permissions are 0600, directory 0700; ignored by Git.
- Supplied source preserved byte-for-byte in `firmware/PixMobPresetSerial/PixMobPresetSerial.ino`; SHA-256 `70da1eaa9e5ac6e0d00a53ec4f3fe7485118d88222797a7f661ce20278ecaac4`. Compile: 306,035 bytes program / 23,624 bytes static RAM. Application SHA-256 `a4cd8f4d3fae50d04df10a61a993c90ea32e4ac14124f6d0b02f77b1b848678f`.
- Original music upload encountered a USB interruption at 115200 baud. Bootloader/partition segments had verified; retrying the application at 57600 completed with its hash verified. The board subsequently acknowledged the exact Stop/Music commands and emitted real telemetry.
- Separate improved firmware: `firmware/PixMobBeatController/`. Arduino-ESP32 3.3.12 and IRremote 4.7.1 compile: 308,819 bytes program / 23,680 bytes static RAM. Application SHA-256 `082c30004687b7116fee222d2ab5a61924ef0b85dc110d3a33abcb40d8d797f7`. Written at 0x10000 / 57600 baud; hash verified, board reset successfully.
- All seven raw timing arrays match the supplied source exactly. Manual/Auto retain three frames and 80 ms gaps; Music sends one frame per accepted onset. No new color, off, IR or RF protocol was invented.
- Capture/detection continue on the Arduino core while a separate worker transmits IR. One bounded pending job, generation cancellation and serialized completion messages prevent a growing output backlog. A frame already transmitting can finish after Stop.
- Bass onset detection uses 35 Hz high-pass / 200 Hz low-pass filtering, a fast RMS envelope, adaptive baseline/variation, hysteresis, one-second warmup and 180 ms minimum spacing. This is a heuristic onset detector, not musical beat classification or BPM phase locking.
- The updated website recognizes exact bass-format metadata, labels `Level` as a 16-bit bass envelope, and starts its decaying LED pulse only when a real `BEAT! Color sent:` completion arrives. Amplitude, demo tempo and a display timer cannot start a device-beat pulse. The white housing and two visible LEDs remain.

The user confirmed external-speaker playback near the microphone. A 20-second probe of the original music sketch received 68 level samples (whole-spectrum mean absolute: 68–1,191) and 20 beat messages, with completion intervals 0.447–1.755 seconds. A 20-second probe of the improved sketch received 333 level samples (filtered bass envelope: 46–364) and 12 beat messages, with intervals 0.497–3.000 seconds. These were different passages of live playback, and the amplitude definitions differ; the figures establish data flow and irregular triggers, not comparative beat accuracy. Local numeric probe records are `.arduino/preset-original-music.json` and `.arduino/beat-improved-music.json`. Each probe stops Music when it finishes.

A direct Stop followed by Red produced `AUTO / MUSIC STOPPED` and `Color sent: R`; no further colors were sent. The user reported that the physical wristband **flashed once**, establishing that continued color changes require further triggering in this observed setup. Musical alignment of the improved detector remains a listening/visual check rather than inferred from serial counters.

Production build and all **50 automated tests** passed. Coverage includes serial protocol separation, bounded telemetry, acknowledgment ordering, polling, disconnect/reboot/timeout cleanup, new format metadata and event-only visual pulses. Host C++ detector scenarios passed silence, DC/quiet noise, sustained tone, seven irregular bass bursts, sensitivity and bounds; synthetic onset processing delay was 8–16 ms, excluding actual microphone, IR transmission, browser and wristband latency. Connection dialogs were checked at 390 px and 360 px without horizontal overflow. No optical waveform measurement, universal PixMob compatibility, RF or TFT verification is claimed.

## Browser-song input and Host-mode verification

The initial microphone improvement did not resolve the user's pause comparison: the physical wristband continued flashing. With the inspected YouTube player paused, a 12-second probe still recorded 200 bass-envelope samples (52–1,363) and seven onset completions. The user subsequently clarified that the room could not be kept quiet. This was an uncontrolled ambient-input check, **not a validated silence test**; other sounds, handling and electrical interference were not isolated. No claim that the microphone can distinguish music from all environmental sound follows from it.

The microphone fallback was improved with matched-window bass-power fraction, onset persistence, an adaptive noise floor, robust baseline updates and DC-safe initialization. Twelve synthetic scenarios now pass, including stronger broadband/high-frequency bursts, DC changes, short edges and synthetic carrier interference; irregular strong and weak bass kicks both achieve 7/7 detections with 20–32 ms processing delay. These tests are distinct from field accuracy.

The user explicitly chose direct browser-song audio for the noisy environment. The final firmware adds a separate Host mode:

- Exact capability metadata `CAPABILITIES: BROWSER BEATS` is required before the website enables it.
- `H` enters Host mode and replies `BROWSER SYNC ON`.
- `1/2/3` request one R/G/B frame only while in Host mode. Microphone onsets cannot transmit in this mode. No repeating timer creates output.
- Stop and other mode-changing intents invalidate queued browser beats. Already-transmitting frames may finish.
- Final application: 310,027 bytes program / 23,696 bytes static RAM; SHA-256 `90d84d2cf9c9440d425cc886dae97584415c07f1cd39e71974bf76789c2bc33d`. Upload at 0x10000 / 57600 baud completed with its hash verified.
- `scripts/probe-browser-beats.py` passed on the board: no completion messages during two-second idle periods before and after four explicit commands, exactly four matching completed-color replies, with observed serial completion latency 45.8–73.9 ms. This probe used prescribed command timings, **not music**, and did not measure optical timing.

Browser analysis uses measured shared audio, never the demo source for physical output. An AudioWorklet supplies the analysis clock; rendering reads cached frames and cannot consume or duplicate onsets. A browser without this facility falls back to foreground analysis and the UI states that limitation. Sharing-ended, canceled startup, disconnect and queued-command cancellation have explicit cleanup. The browser beat dispatcher drops busy onsets instead of building a delayed backlog. Native capture still depends on browser/OS support; mobile/background suspension and system sleep are not guaranteed.

Final production build and **73 automated tests** passed, including six worklet/capture lifecycle tests, host capability/acknowledgment and cancellation tests, and high-baseline browser onset detection without clipped visual gain suppressing kicks.

In desktop Chrome, the final page visibly reported **ESP32 USB connected**, **USB · HOST**, **Browser song sync** active, **LIVE INPUT**, **System / browser tab audio**, and an active YouTube sharing infobar. The selected source was the user's 120 BPM drum-track tab, later navigated by the user to The Weeknd. The preview showed acknowledged R/G/B colors in Host mode, while the browser spectrum and bands changed. The audio-clock UI reported independent analysis rather than the foreground fallback. The displayed BPM is a heuristic estimate (114–115 was observed on the nominal 120 BPM track), not a calibrated phase-lock measurement.

On **12 November 2026 (Asia/Kuala_Lumpur)**, the user completed the physical pause/resume comparison in Browser song sync / USB Host mode and confirmed: **“暂停就停，恢复就闪”** — the wristband stopped flashing when the shared song was paused and resumed flashing when playback resumed. This confirms physical response to the selected song's playback in this setup. Exact per-beat phase alignment and optical latency were not measured. Browser-song Host mode remains the selected input; microphone wiring was unchanged.

## Browser-song latency optimization — 12 November 2026

The user requested tighter physical beat response and supplied a live **80 BPM, 4/4** drum track. Before loading the new browser detector, Chrome showed active song sharing, USB Host mode and an estimated 79 BPM at sensitivity 100%. A quarter note at the stated tempo is 750 ms and a bar is 3 seconds; these reference values are not used to generate fixed output events.

The previous worklet only sent visual-analysis ticks. At 48 kHz / 128-frame blocks its reset-on-tick implementation waited 13 blocks (34.67 ms) per tick. Across onset phases, that clock contributed about 17 ms average wait and up to 34.67 ms before the main-thread FFT analysis, excluding capture, FFT smoothing and downstream handling. The replacement detector analyzes PCM in approximately 5 ms windows in the audio thread and sends confirmed rising bass/drum-body onsets immediately. Spectrum refreshes remain separate and cannot trigger IR. Opposite stereo phases retain their power. BPM uses sample-derived onset times, and messages more than 100 ms late are discarded. No beat prediction or free-running tempo clock is used.

The firmware now skips blocking INMP441 reads/DSP while in Host mode; M/V still reset and warm up the standalone detector on return. No pins, carrier, seven timing arrays, frame count or worker-queue behavior changed. New compile: **310,035 bytes program / 23,696 bytes static RAM**. Application SHA-256: `0a0bdf9a943cfa46b881927f559f2e63387a66f2482ee1ccf30c9640406fb0ea`. Application-only upload at 0x10000 / 57,600 baud completed with its written-data hash verified. The prior Host application is preserved locally in `.arduino/beat-build/`.

Matched actual-board probes used the same updated `scripts/probe-browser-beats.py --samples 16`, which stops timing as soon as the matching completion line arrives:

| Serial write → completed-send reply | Before | After |
| --- | ---: | ---: |
| Median | 40.2 ms | 32.15 ms |
| Range | 33.3–57.6 ms | 31.6–32.6 ms |
| Matching completions | 16 / 16 | 16 / 16 |
| Sends during two-second idle windows | 0 | 0 |

Local raw summaries: `.arduino/host-latency-before.json` and `.arduino/host-latency-after.json`. These probes use prescribed irregular command timing, **not music**, and include the unchanged **27.3 ms** IR waveform. They establish lower and more consistent command-completion time, not acoustic-to-light or optical latency. The earlier four-sample 45.8–73.9 ms record used a coarser receive window and is not the matched baseline for this comparison.

The final production build and all **83 automated tests** passed. Eight new tests run the actual shipped processor source in a VM with real PCM blocks at 44.1/48 kHz. Irregular kick sample-to-post delay was **9.73–13.83 ms** at 44.1 kHz and **10–12 ms** at 48 kHz. An 80 BPM alternating kick/snare fixture detected every quarter hit without weaker halfway hi-hats doubling the output; its posting delay was at most 12 ms. Weak irregular kicks over a held musical pad passed 7/7. Held tones/pads, pause/silence, stereo including opposite phases, DC and isolated clicks were also covered. These are synthetic, deterministic DSP checks and exclude capture, real browser scheduling, USB, IR and receiver response.

Integration checks cover immediate onset notifications before visual ticks, sample-timestamp BPM under variable delivery delay, stale/malformed events, canceling/replacing captures and a visual tick/onset with identical rounded main-thread timestamps. Repeated flags cannot replay a beat or bypass output spacing. These checks do not establish performance on every song.

### Live 80 BPM track and physical observation

Chrome was reconnected to CP2102 and the user's **80 BPM – ROCK – 4/4 Drum Track** YouTube tab was shared with audio. The new UI showed **USB · HOST**, **LIVE INPUT**, changing acknowledged R/G/B colors, and the new onset-count/interval readout. At sensitivity 85%, snapshots included a correct 750 ms interval but also 380 ms / 156 BPM, revealing subdivision detections that the synthetic hat fixture had not fully represented. Synthetic success was therefore not treated as proof of this live track's accuracy.

Sensitivity was reduced to **45%**. The final inspected page showed **81 BPM estimated**, **735 ms latest interval**, **305 detected onsets**, browser-song sharing and Host output still active. Earlier live snapshots also showed 745 and 750 ms. These are individual UI observations, not a complete interval distribution or calibrated phase measurement. On 12 November the user observed the physical wristband for the requested comparison and confirmed **“更贴合，每拍一次”** — better alignment, one flash per beat. The live page was left at 45% sensitivity. This confirms the user's comparative observation on this track and setup; it does not establish an exact acoustic-to-light delay, perfect detection on other passages or compatibility with other wristbands.

Final local UI capture: [80 BPM live Host state](screenshots/80bpm-live-host.png). Its spectrum and LED brightness remain browser visualizations, and device completion reports remain distinct from receiver acknowledgments.

## Automatic browser sensitivity — 12 November 2026

The user requested changing songs/BPM without adjusting sensitivity each time. The browser detector now has an explicit automatic mode, enabled by default for browser microphone/shared audio. The manual detector remains available and unchanged when that mode is off. Automatic mode learns bounded 800 ms histories of band RMS (not recorded PCM), low/high energy quantiles and recent full-band drum prominence; those statistics control relative detection floors. New attacks and persistence remain mandatory, with no predicted or free-running output. An 850 ms gap permits rebasing a previously louder reference; it does not create an onset.

All **15 new automatic + 8 existing manual PCM tests** passed, along with **12 audio-engine lifecycle/settings tests**. The matrix covers 60/80/100/120/140/160/180 BPM at gains 0.2/1/2 after four acquisition attacks, weaker halfway hats including strong low-mid leakage, 2→0.2→1 volume changes at both 80 and 160 BPM, an 80→160 BPM transition without capture restart, quiet opposite-phase stereo, held pads, stationary noise, DC, isolated clicks and pause/resume. Maximum synthetic sample-to-quantum-post delay in the tempo/gain matrix was **17.33 ms**; capture, main-thread delivery, USB, IR and optical response are excluded. These fixtures establish bounded heuristic behavior, not classification of every real song.

The engine can switch automatic/manual settings without restarting capture and validates processor-confirmed automatic status, effective sensitivity and interval confidence. Malformed metadata and old-mode metadata cannot reverse the selected setting. Unsupported browsers report manual foreground fallback. The switch and manual fallback controls were checked in the local browser, including revealing/hiding manual sensitivity without requesting a new audio capture. No firmware upload, wiring or IR timing change was needed. The prior physical 80 BPM observation was in manual mode; it must not be presented as a physical validation of this new automatic detector.

For the separate automatic-mode field check, the user was asked to refresh Chrome, reconnect ESP32, share music with Automatic sensitivity enabled, change to another BPM without touching sensitivity and observe about 15 seconds. The user reported **“能自动跟随，效果正常”** — automatic following worked normally. This is a user-reported physical comparison; no optical latency, full missed/extra-hit count or exact tempo-phase measurement was taken. It does not make the earlier manual-mode measurement an automatic-mode benchmark.

## Per-song lighting programs — 12 November 2026

The user requested both personally composed shows for selected songs and free live rhythm for other music. A separate Song shows page now stores named programs with timestamped lighting cues. Local MP3/WAV playback uses media time; an external-player option explicitly uses a manually aligned clock and cannot read/control YouTube position. Programs are saved locally, while audio files remain temporary local object URLs and must be reselected after reload. Limits are 16 programs, 256 cues per program and validated bounded metadata.

Physical cue output is optional and starts disabled. It uses only the verified preset serial adapter and R/G/B/Y/C/W manual presets; preview effects, brightness, speed and HEX do not become new hardware commands. Starting a hardware show cancels browser free-rhythm analysis/output and confirms Stop. Preview-only playback does not claim the device. Pause, seek, editing, leaving, disconnect and canceled preparation invalidate pending work. Resume sends future cue crossings; late/background and busy cues are skipped rather than queued. A separate preset-cancellation epoch now also prevents a not-yet-written manual cue from escaping Stop, including while behind another acknowledgment or its own Host-exit barrier. An already-written transmission can finish.

All **117 automated tests** and the final production build passed. These include 12 song timeline/storage/output tests and 3 integrations using the actual preset serial adapter with mock streams. The latter verify manual color framing, Host-exit Stop ordering, cancellation behind sensitivity acknowledgment and cancellation during the internal Stop barrier. No new physical programmed-show reception test is inferred from those mocks.

Browser checks used a generated eight-second local WAV, not the user's saved music. A sample program named **Demo · Intro to chorus** was saved with cues at 0 / 2 / 4 seconds. Local playback reached its Fade cue at 2 seconds and paused at about 2.1 seconds; seeking to 4.2 seconds selected Flash while remaining paused. External manual-clock playback also reached Fade and paused around 2.1 seconds. After refresh, the saved program and cue times survived while the file input correctly reset. No warnings/errors were reported by the inspected local browser. Document width equaled viewport width at 390, 412 and 1440 px; this is layout testing, not physical mobile certification. The temporary viewport override was reset.

Final interface: [Song shows editor](screenshots/song-shows-editor.png). The original white housing with exactly two internal LEDs remains the preview model. The local controller service remains available; no cloud publication or firmware/wiring change was made for these features.

## Offline song rhythm analysis and automatic cue drafts — 12 November 2026

The user clarified that automatic music reading means **importing a song, finding BPM/attacks and generating lighting timestamps**, in addition to the existing live-follow mode. Song shows now retains the selected local File for explicit analysis. After media metadata confirms valid duration, Analyze song decodes mono/stereo audio in an offline 22.05 kHz context and runs the same automatic onset processor in a disposable worker, processing without waiting for real-time playback. The decoding API resamples to the context rate ([MDN decodeAudioData](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData)). Nothing is connected to an audible output or device during analysis.

Limits are 100 MB, 600 seconds and 4,096 attack timestamps. Cancellation rejects promptly, terminates an active worker and revokes its Blob URL; file/source changes, playback, reset, switching shows and unmount invalidate stale work. Browser decoding itself cannot be interrupted, so a late decoded result is ignored. The UI requires known positive media duration before beginning, avoiding decoding already-known overlength tracks. Audio and temporary analysis are not persisted or uploaded.

Generation creates a new unsaved program from selected **actual attack timestamps**, without filling gaps from a fixed BPM grid. Options are single-color or RGB pulses and every 1st/2nd/4th detected attack. Longer results increase the index stride to cover the whole track within 256 cues, with the stride reported. Existing unsaved edits must be saved first, saved programs remain unchanged, and hardware output starts off. Flash cues use an editable 120 ms single decay rather than a repeating oscillator between attacks. Other authored effects keep their existing behavior. Only exact existing preset colors receive a hardware color mapping; arbitrary HEX stays preview-only.

The production build and all **138 tests** passed. The 19 new offline tests cover actual shipped-worker PCM at 22.05 kHz, exact 80/120/160 BPM synthetic estimates at quiet/normal gains, stereo phases, irregular attacks, silence, malformed/oversized results, cancellation/stale progress/cleanup, and bounded draft generation. Two added program tests cover pulse sampling and persistence. Independent 22.05 kHz sample-to-quantum-post timing was 8.93–18.59 ms; decoding, browser scheduling and hardware are excluded. A whole-track BPM is a heuristic summary; no bar, downbeat or verse/chorus classifier is claimed.

Browser end-to-end verification used the existing generated **eight-second 80 BPM WAV**. Analyze song reported **80 estimated BPM, 11 attack timestamps and 99% interval confidence**. This confidence is a heuristic interval-agreement measure, not a calibrated accuracy probability. RGB generation produced a new program with 11 cues, starting near 0.010 / 0.758 / 1.512 seconds and ending near 7.508 seconds. The original Demo program remained present. Cue fields display milliseconds while preserving their underlying observed timestamps.

At song position 0.8 seconds the generated green pulse rendered intensity about 0.4255; at 1.0 second it rendered zero without a second cue, confirming a single decaying preview pulse. Saving and refreshing preserved all 11 cues and 120 ms settings; the audio field correctly reset. Reselecting/reanalyzing the same file again returned 80 BPM / 11 attacks. These are browser preview/metadata checks, not an optical latency or physical generated-show reception test.

The analysis panel and generated program were checked at 390, 412 and 1440 px with no document overflow. Final interface capture: [Local song rhythm analysis](screenshots/song-rhythm-analysis.png). No firmware, wiring, IR waveform or RF integration changed.

## Physical song output and controlled single-frame colors — 12 November 2026

The existing saved Blinding Lights show contained preview-only cues, and Send cue colors was initially off. A separate RGB device copy preserved its timestamps and the saved original. Device scheduling now uses a silent 20 ms AudioWorklet clock and actual media position, independently of the preview animation; a labeled foreground timer is the fallback. The editor reports confirmed transmission count, last color and unsent requests. In Chrome, the audio-clock show reached three confirmed R/G/B sends by about 11 seconds. The user confirmed physical flashes had resumed but reported poor rhythm alignment. Serial completion counts are not optical or phase measurements.

The inspected local MP3 produced approximately 165 BPM, 415 detected attacks and only 5% confidence with the current onset analysis. Its generated timestamps were irregular. This is an unsuccessful musical-alignment result, not a validated beat track. Low-confidence results now show a timing warning. Spectral/tempo experiments under the ignored `.arduino/` directory are exploratory only; no experimental tempo grid or estimated 171 BPM result is shipped as a correction.

Single-color selection previously configured only the next generated draft. **Apply pattern to current show** now explicitly updates existing cue colors/presets without changing times or IDs, stops playback and leaves changes unsaved for review. It is available on an existing local show without re-analysis. Custom HEX uses a visibly named nearest existing hardware preset, while preview HEX stays exact. In UI verification, applying single red to a three-cue test changed all three hardware selectors to Red and preview effects to 120 ms single Flash pulses while retaining times 0, 2 and 4 seconds. The saved source was not overwritten. All 145 automated tests and the production build passed.

### Firmware and USB observations

- The earlier Host-only Green command completed in 31.4 ms, with no additional color reports in the idle window. The user initially reported one flash. This did not by itself prove that repeats caused all green/white double flashes.
- Before uploading, 327,680 bytes at application offset `0x10000` were read from the connected ESP32. The used bytes exactly matched the preserved low-latency Host binary. Backup SHA256: `7c01fc9dffd22e3c53ab4e1103c7bac93133f412fec2142c3c71f5168248d754`, private mode 600. A 460,800-baud read failed with serial corruption; the 57,600-baud retry succeeded.
- The separate derived firmware now sends one frame for manual/song colors and retains three frames only for Auto. Music and Host remain one frame. Manual and Auto also skip unused blocking microphone reads. `PRESET FRAMES: 1` reports the new manual behavior. IR GPIO32, microphone GPIO26/25/27, all seven waveform arrays and 38 kHz carrier match the supplied source. The original supplied sketch remains unchanged.
- Arduino-ESP32 3.3.12 / IRremote 4.7.1 compilation used 310,063 program bytes and 23,696 static RAM bytes. Application binary SHA256: `2ec5efacf5223f808387aa30ef1194f2e3ae0b0829da067cfc6c6d491d9101f4`. Application-only upload at `0x10000` / 57,600 baud completed with written-data hash verification.
- Six manual single-frame colors R/G/B/Y/C/W completed in 30.6–31.1 ms, with no autonomous color reports during two-second observation windows. The user reported apparent double flashes in green and white. Isolated Green Host and White manual tests subsequently completed in 31.7 and 30.5 ms; the user reported one very fast flash and requested longer observation gaps. The difference remains observationally unresolved.
- A six-color repeat with five-second observation gaps completed in 30.7–33.5 ms per color. The user still could not confidently distinguish the flashes. They then indicated readiness for phone slow-motion recording; isolated Green and White were sent once each, five seconds apart, completing in 30.4 and 31.4 ms with no extra color reports. The user subsequently reported that the flashes were not recorded, so no video evidence is available. No confirmed cause or verified constant-light command is inferred from these reports.

The probe stops output and releases USB at completion. Observation gaps are not hold durations. `M` is not sent as a manual magenta command, and no raw waveform was edited to guess a different lighting effect.

Chrome was subsequently reconnected to CP2102 through the native Web Serial chooser. The website visibly reported **ESP32 USB connected**, **USB · MANUAL** and the live-control buttons. No automatic color sequence was restarted. Manual button presses after starting a phone recording provide a user-controlled way to capture the short flashes.

### User video review

The user subsequently supplied `IMG_8575.mov`. Local AVFoundation decoding read all 2,821 frames successfully, over 69.573 seconds of video presentation time. Three visible light events were found: a red/orange event around 8.817–9.685 s, green around 26.352 s with a faint residual on the following frame, and a warm yellow/white-looking event around 46.755–46.772 s. The last event is associated with the requested White test by context; no synchronized command log was recorded in the video. Both LEDs are lit in the illuminated keyframes. No separate second light episode with an intervening dark frame was visible in either green or the White-test event.

This establishes **no resolved double flash in this recording**, not proof that sub-frame pulses cannot occur. Presentation timestamps are variable, with some neighboring frames 50 ms apart; the average reported track rate is about 40.55 fps. A true optical pulse duration or a guaranteed 120/240 fps slow-motion capture cannot be inferred from that export. The red/orange event spans substantially more video time than the green/White-test events, but different original capture speeds are not ruled out. Camera color rendering is not a calibration of the White preset. Review files remain local under ignored `.arduino/video-review/`; the video review did not change firmware or send device commands.

### White waveform provenance and decoding

The subsequent source audit found the supplied WHITE timings exactly match the original author's **WHITISH** preset. The current uploaded binary and both original pasted sources preserve those timings. Read-only decoding using the published IR framing, channel encoding and checksum model gives R=204, G=176, B=92, with a valid checksum. YELLOW is a distinct valid command. All seven supplied arrays passed the same checksum model. The low blue channel provides an evidence-based explanation for a warm/yellow-looking White preset; a neutral-white replacement has not been tested. End-to-end W routing was checked and 45 targeted existing tests passed. The user-linked colorBrute repository targets a separate CC1101 RF setup, not direct KY-005 IR waveforms. See [full audit and primary sources](WHITE_IR_AUDIT.md). No firmware or hardware was changed during this audit.

## Neutral-white candidate and offline beat tracking — 12 November 2026 (evening)

### White

The upstream Flipper code table has no `WHITE` entry; the reverse-engineering repository's `FAST_WHITE` / `VERY_SLOW_WHITE` codes decode to R/G/B 204/204/204 with the published model. An independent encoder/decoder written from that model round-trips all seven supplied timing arrays exactly and reproduces the earlier audit table. The derived firmware source now sends a 6-byte single-color candidate `80 69 21 89 89 89` (checksum valid, 41 slots, 28.7 ms, R/G/B 204, body bytes identical to upstream `FAST_WHITE`) for `W`, keeps the supplied warm frame verbatim as `WHITISH[]` behind a new `K` command, and prints `WHITE PRESET: NEUTRAL CANDIDATE (K = WHITISH)` with the other metadata. The website parses only that exact line: with it, White is labeled a neutral candidate and a **Warm white (original)** button sends `K`; without it (the uploaded build, or the original sketch), White is labeled warm WHITISH with a warm preview swatch and `K` is refused before any serial write.

Compile only: `.arduino/white-candidate-build/PixMobBeatController.ino.bin`, 310,247 program bytes / 23,696 static RAM bytes, SHA256 `bb9092b038183e2d1872843193cdd53bad858cb6ffa739cf1d90a04eec14ad37`, built with the same CLI configuration as the previous build. **Nothing was uploaded, no command was sent to the board, and no wristband has displayed the candidate.** The USB port was idle at the time of this work; the earlier single-frame application (`2ec5efac…9101f4`) is still the installed build. Equal protocol channel values are not a color measurement.

### Offline beat tracking

`src/lib/songRhythm.ts` no longer reuses the live onset detector for whole-song analysis. The worker computes three-band spectral flux (1024-point frames, 220-sample hop at 22.05 kHz, channel powers averaged), normalizes each band before mixing so a kick is not outvoted by broadband snare bins, estimates the period by prior-weighted autocorrelation, prefers the doubled tempo only when both alternating beat sets carry real attacks, tracks one beat chain by dynamic programming, snaps each beat to the end of the first 1 ms block above the half-rise level in its analysis window, and drops grid beats whose attack energy is below an absolute floor or a tenth of their neighbours'. Songs without a supported tempo fall back to plain detected attacks.

Evidence, in order of strength:

- **Synthetic (deterministic):** 80/120/160 BPM kick–snare–hat fixtures at two gains, opposite-phase stereo, irregular attacks with a silent tail, silence, malformed input and service lifecycle — all 13 offline tests pass, with every reported beat between 1 sample before and 35 ms after its fixture attack and no beats generated in silence.
- **Real song (offline analysis only):** the local Blinding Lights decode gives **172 BPM, 563 beats, 28–29 beats in every 10-second window including the intro and before the fade**, confidence 0.67, median interval 349 ms (5th–95th percentile 314–385 ms). Against the earlier exploratory phase-locked 171 BPM grid, 531 of 540 reference beats match within 80 ms; the median offset is +8.7 ms and the 10th–90th percentile range is −7 to +20 ms. Analysis took about 4.5 s in Node. The previous detector had produced 165 BPM, 415 irregular attacks and 5% confidence on the same file.
- **Physical:** not observed. No wristband was lit in this session; the hardware effect of the new drafts and of the device lead is unverified.

Song shows now allow 1024 cues per show (storage budget unchanged at 1 MB), thin generated drafts by powers of two instead of arbitrary strides, and add a **Device lead** field (0–200 ms, default 40 ms, stored in the browser) that sends device cues early while the preview keeps real time. The default approximates the measured serial completion (about 31 ms) plus half the 20 ms scheduling clock; it is not a measured optical latency.

Software checks: **148 automated tests passed** (`node --import tsx --test tests/*.test.ts`, including the C++ detector test) and the production build passed. `scripts/probe-single-pulse.py` accepts `K` so a future `--colors WK` comparison can be run after the browser releases USB.

### Authorized upload and W/K serial comparison — 12 November 2026 (later)

The user authorized uploading the candidate and comparing W against K. Chrome held no serial connection (no process had the port open). `flash-id` identified the same 4 MB ESP32. Before writing, 327,680 bytes from application offset `0x10000` were read back at 57,600 baud into `.arduino/backups/2026-11-12-before-white-candidate-app.bin` (mode 600, SHA256 `1212611b4a1fc09f4448008c6f2ecd9d2f4eeb6f5a33d824a5c0270d163d2ddb`); its first 310,208 bytes equal the previously uploaded single-frame binary `2ec5efac…9101f4` byte for byte, and the remainder is stale data from earlier images rather than 0xFF. The candidate application (`bb9092b0…ad37`, 310,400 bytes, 180,578 compressed) was then written at `0x10000` / 57,600 baud in 32.2 seconds with **written-data hash verified**, followed by the hard reset.

After reset the board printed the new banner set, including `PRESET FRAMES: 1` and the exact line `WHITE PRESET: NEUTRAL CANDIDATE (K = WHITISH)`, both at boot and after `X`. Two rounds of `scripts/probe-single-pulse.py --all --colors WK --interval 5` completed:

| Round | `W` (candidate, 41 slots) | `K` (original WHITISH, 39 slots) | Autonomous output in 5 s gaps |
| --- | ---: | ---: | --- |
| 1 | 33.1 ms | 31.5 ms | none |
| 2 | 32.5 ms | 30.5 ms | none |

The 1–2 ms longer W completion matches the 1.4 ms longer candidate frame. These are serial write-to-completion times; they do not show reception or color. **The visual comparison belongs to the user's observation and is not recorded here.** The probe released the port afterwards, so Chrome can reconnect with the same **Preset controller (your sketch)** choice; the page should then label White as a neutral candidate and show **Warm white (original)**.

### Burst W/K comparison — 13 November 2026

The user reported not seeing the earlier single frames. After the board was reconnected (`/dev/cu.usbserial-0001` reappeared, no other process on the port), `scripts/probe-white-compare.py --colors WK --frames 6 --spacing 0.5 --rounds 2 --countdown 8` ran: each color as six single frames 0.5 s apart, 2.5 s dark between bursts, two rounds. All 24 frames completed (W 31.5–33.4 ms, K 30.5–31.3 ms per frame), with no autonomous output in the dark gaps, and the probe sent Stop and released the port afterwards. These are serial completions; the visual result of this burst comparison is the user's observation and is recorded only when reported.

**User observation (13 November 2026):** after reconnecting Chrome with **Preset controller (your sketch)**, the user compared the page's **White (neutral candidate)** and **Warm white (original)** buttons on the wristband and reported that the candidate is the whiter one (“这个比较白”, with a screenshot of the White button). This is a comparative visual judgement of the candidate (R/G/B 204/204/204) against the original WHITISH frame, not a calibrated color measurement, and it does not say the LED mix is exactly neutral. With it, the White issue is resolved for this wristband and firmware; the original frame stays available as `K`.

## Hold-color bench test — 13 November 2026

The user asked why the wristband only flashes and requested a standalone Arduino program that cycles through all colors, each held for 10 seconds. The flash is the wristband's own envelope for the 6-byte single-color command. The published protocol also documents a 9-byte single-color command with attack/sustain/release time codes; the upstream reverse-engineering repository contains many such codes.

`firmware/PixMobHoldColorTest/` is a separate sketch (IR GPIO32, 38 kHz, microphone unused). Its portable `PixMobFrame.h` builds both frame types. Host known-answer test (`tests/firmware-frame.test.ts`): the builder reproduces the seven timing arrays in the beat controller plus the neutral White frame, reproduces upstream `FAST_WHITE` and `VERY_SLOW_WHITE` bit for bit from their decoded fields, matches an independent Python encoder for the seven hold frames, and rejects out-of-range inputs. Of 79 upstream 9-byte codes, 77 re-encode bit-exactly from their decoded bytes; the other two carry a checksum byte that differs from the published rule.

Hold frames: attack 0 ms, sustain 2400 ms, release 32 ms, chance 100 %, no group, 63 slots / 44.1 ms each, re-sent every 2000 ms; channel values are those decoded from the existing presets (White 204/204/204). Sustain code 7 with non-zero release and release code 0 are deliberately not used because the documentation ties them to the global sustain time and to a background-color side effect.

Upload (user-requested): the port was free; `verify-flash` first confirmed that the installed application equaled `.arduino/white-candidate-build/PixMobBeatController.ino.bin` (digest matched), so that file is the restore image. The test build (280,007 program bytes / 22,488 static RAM bytes, binary SHA256 `bda80214c8fdeb393563d3625a7621d3e67d7eec650b9baa0255f09bc66e6cdb`) was written at `0x10000` / 57,600 baud with written-data hash verified. Serial output then showed `PIXMOB HOLD COLOR TEST READY`, Red, Green and Blue each starting 10.0 s apart, and five 9-byte frames per color at 0/2/4/6/8 s. **Whether the wristband actually stays lit, and whether the 2-second re-send is visible, is the user's observation and is not recorded here.** While this sketch is installed the website's preset adapter cannot connect; restoring the beat controller means writing the white build back to `0x10000`.

### First hold observation and diagnostic build — 13 November 2026

**User observation of the first hold test (envelope frames, sustain 2400 ms, re-sent every 2 s):** Red, Green, Blue and Yellow stayed lit; Magenta and White only flashed; Cyan stayed lit but looked green. So the 9-byte envelope command is accepted by this wristband and does hold a color. The three colors that failed are exactly the three that drive all three LEDs (channel sums 492–612), and the one that degraded lost its blue component. That pattern fits a supply that cannot keep the blue LED lit under sustained load (for example worn batteries), but **no cause has been measured or proven**; the earlier short flashes of the same White and Cyan frames did show their colors.

To test this, the sketch was revised (v2): it boots into a diagnostic sequence — three short red marker flashes, then White 100/75/50/25 %, Magenta 100/75/50 % and Cyan 100/50 %, each lit about 8.4 s (frames at 0/2/4/6 s) followed by about 1.6 s dark. Serial commands: `D` diagnostic, `C` normal seven-color cycle, `P<n>` limit on red+green+blue (`P0` off), `1`/`2` method, `0` stop, `N` next. The frame builder header and its host test are unchanged and pass. Build `.arduino/hold-test-v2-build/` (281,063 program bytes / 22,512 static RAM bytes, binary SHA256 `a240ad29f6c36e0154b260310c04b8889a88dcf3c5725ff3e7a8ed899c7a5178`) was written at `0x10000` / 57,600 baud with written-data hash verified; the first build is kept in `.arduino/hold-test-build/`. Serial output confirmed the marker and the first steps on schedule. Which steps hold on the wristband is the user's observation and is not recorded yet.

### Diagnostic observation and capped continuous cycle — 13 November 2026

**User observation of the v2 diagnostic sequence:** Magenta and Cyan stayed lit and were distinguishable; White stayed lit with visible differences between steps, although the 75 % step was hard to tell apart; right after the three red marker flashes the wristband flashed red and a white-like color. This is read as: the first step, White 100 % (204/204/204), is unstable and collapses toward red, while the dimmer White steps and all Magenta and Cyan steps hold when each step is followed by a dark gap. The user's wording does not pin down which neighbour the 75 % step resembled, so that detail is left open.

White turning red is what a sagging supply would produce, since the red LED needs the lowest voltage; and Magenta/Cyan 100 % holding here, after failing at the end of 40 s of continuous light in the first test, also fits a supply that recovers with rest. This remains an inference from behaviour — no voltage was measured and the batteries were not changed.

To test the continuous case without another upload, the running v2 sketch was switched over serial (`0`, `P380`, `C`): normal seven-color cycle, 10 s each with frames at 0/2/4/6/8 s, and red+green+blue limited to 380. Red, Green, Blue and Yellow are unchanged by that limit; Cyan becomes 100/152/120, Magenta 180/76/120 and White 124/124/124. Serial output confirmed `POWER CAP 380`, `SEQUENCE NORMAL` and the first colors on schedule. These settings live in RAM only: a reset, including one caused by opening a serial monitor, returns the sketch to the diagnostic default. Whether all seven colors now hold in the continuous cycle is the user's next observation.

### Capped continuous cycle observation and v3 defaults — 13 November 2026

**User observation of the continuous seven-color cycle with red+green+blue limited to 380:** Red, Blue, Yellow, Cyan (100/152/120), Magenta (180/76/120) and White (124/124/124) stayed lit for their 10 seconds; Green (132/244/0, not reduced by that limit) flashed. Green had held in the first run about half an hour earlier. Its green channel value, 244, is the highest single channel in the set. The limit of what holds therefore moved down during the session, which again fits a weakening supply; it is still an inference, with no voltage measurement or battery change.

The sketch was revised (v3) so the working values are the boot defaults: Red 132/32/0, **Green 88/164/0** (same 132:244 ratio at about two thirds), Blue 16/12/160, Yellow 132/124/0, Cyan 100/152/120, Magenta 180/76/120, White 124/124/124. It boots straight into the continuous cycle, 10 s per color, frames at 0/2/4/6/8 s, and the red marker flashes now belong to the diagnostic sequence only (`D`). `C`, `P<n>`, `1`, `2`, `0`, `N` are unchanged. Build `.arduino/hold-test-v3-build/` (281,039 program bytes / 22,496 static RAM bytes, binary SHA256 `54b52ed975057927396a55475b3d7920716563cc83cb3ab9a586e17d962173e7`) was written at `0x10000` / 57,600 baud with written-data hash verified. Serial output confirmed Red, Green (R88 G164 B0) and Blue starting 10.0 s apart with five frames each. Whether Green now holds is the user's observation. These values describe this wristband with its present batteries; a fresh set may allow the full preset values, and further drain may require lower ones.

**User observation of v3 (13 November 2026), as first reported:** all seven colors lit (“七色都能亮住”). **Corrected by the user minutes later:** a color did not stay on for 10 seconds; it came in three parts. The first report must therefore not be read as a continuous hold. See the video analysis below.

### Video of v3 and the repeat rule — 13 November 2026

The user supplied `/Users/yh/Downloads/20261113_075939.mp4` (18.9 s, 3840×2160, about 28.7 fps, 539 frames decoded locally with AVFoundation; working files stayed in the session scratchpad). Per-frame counts of saturated and colored pixels show, in video time:

| Lit | Dark | What the sketch was sending |
| --- | --- | --- |
| until about 0.4 s (White) | 0.5–1.8 s | White frame 1 sent near −2.0 s; frame 2 near 0.0 s had no effect |
| about 2.0–4.3 s (White) | 4.5–5.7 s | White frame 3 near 2.0 s lit it; frame 4 near 4.0 s had no effect |
| about 6.0–8.0 s (White), then Red at once until about 10.3 s | 10.5–11.8 s | White frame 5 near 6.0 s; Red frame 1 near 8.0 s took over while White was still lit; Red frame 2 near 10.0 s had no effect |
| about 12.0–14.3 s (Red) | 14.5–15.7 s | Red frame 3; frame 4 had no effect |
| about 16.0–18.0 s (Red), then Green at once | — | Red frame 5; Green frame 1 near 18.0 s |

Each accepted frame lights for about 2.4 s, matching the 2400 ms sustain plus 32 ms release. A frame identical to the one still showing is ignored; an identical frame arriving after the light has ended is accepted; a frame with a different color is accepted immediately even while the previous one is showing. That is the behaviour of this wristband as recorded here; the comparison the wristband actually makes (whole command, or color only) is not known. It also means the earlier “held / flashed” reports from the hold tests described 2.4-second lit parts rather than continuous light, so the supply-related readings above remain inferences only.

Sketch v4 therefore makes consecutive frames of one color differ slightly: every second frame uses release code 2 (96 ms) instead of 1 (32 ms) and lowers the strongest channel by one six-bit step (for example Red 132 → 128). `V<n>` selects the difference (0 identical, 1 release only, 2 channel only, 3 both, the default). Build `.arduino/hold-test-v4-build/` (281,439 program bytes / 22,520 static RAM bytes, binary SHA256 `ff2c93cc6fbb4665f2ac25498a69f67343219f3eed476a53744d5adfa6bd452c`) was written at `0x10000` / 57,600 baud with written-data hash verified; serial output shows the alternating frames (`R132 … release code 1`, then `R128 … release code 2`) every 2 s. Whether the light is now continuous is the user's next observation; continuous light also raises the load compared with the 60 % duty seen in the video.

**User observation of v4 (13 November 2026):** the light is now continuous (“连续亮了”). With alternate frames differing in release code and by one step on the strongest channel, re-sent every 2 s, this wristband keeps a color lit instead of showing 2.4-second parts. The report did not single out any color, and no new video was analysed, so a brief dip at each re-send or a color-specific problem under the higher continuous load is not excluded. Which of the two differences the wristband needs (`V1` or `V2` alone) was not tested. The hold method is therefore: 9-byte envelope frame, attack 0, sustain 2400 ms, re-sent every 2000 ms, never identical to the frame still showing. It exists only in the test sketch; the beat controller and the website do not use it yet, and the board still runs the test sketch.

## Timed lights in the beat controller and tap-along arranging — 13 November 2026

The user asked for cues that can either flash or stay lit, with the time adjustable in seconds, and for an easier way to arrange a show: clicking in time with the music to mark the timeline first, without the music stopping, and setting colors afterwards.

### Firmware

`PixMobBeatController` gained the command `#<color><ms>` (for example `#R1500`; colors R/G/B/Y/C/M/W/K, 50–600,000 ms). It is acknowledged once, after the first frame, with `Light: R 1500`, and advertised by the exact line `TIMED LIGHT: READY`. The light is built from the 9-byte envelope frames verified in the hold tests: `LightPlan.h` picks the sustain code and chains frames so each next frame starts before the previous sustain ends and the last frame's sustain ends at the requested time (10 s = frames at 0/2000/4000/6000/7600 ms); lights under about 250 ms use one frame with the nearest sustain. Consecutive frames differ (release 96 ms and one step less on the strongest channel) because this wristband ignores a frame identical to the one showing. Channel values are the reduced ones that held in the hold tests. Any later command ends the chain; `X` additionally sends one 32 ms frame of the same color to end the light early. The six supplied arrays, White/K, Auto, Music and Host are unchanged.

Host tests: the frame builder shipped in the controller is byte-identical to the tested one, and the plan is checked for 25 durations from 50 ms to 10 minutes (frames at least 60 ms apart, no gap between chained frames, end within 60 ms of the request). Build `.arduino/beat-hold-build/` (312,243 program bytes / 23,880 static RAM bytes, binary SHA256 `5b24d1e07b0d575977280c881afb399cac57ec0fd3b1207e03392a61bab15202`) was written at `0x10000` / 57,600 baud with written-data hash verified, replacing the hold test sketch.

Serial functional check on the board: `X` returned the metadata including `TIMED LIGHT: READY`; `#R3000` was acknowledged with `Light: R 3000` about 50 ms later; `X` 1.2 s later was acknowledged; `#G600` and the plain `W` flash were acknowledged. **No wristband observation of these timed lights, of arbitrary durations, or of the early cut exists yet**; the cut frame in particular is an untested use of the documented command.

### Website

- Song cues carry an optional light time (`holdMs`, 100–600,000 ms). Without it a cue is the quick flash as before; with it the cue is sent as a timed light. Firmware that does not report the capability gets the quick flash instead. The simulated preview shows a timed cue as steady light for its time.
- Editing a cue, adding or deleting cues, applying patterns and jumping to a position no longer pause playback; only Reset, file changes, show changes and leaving the page do.
- **Tap on the beat** marks a cue at the current song position on pointer press (or Space/Enter when focused) while the music keeps playing, using the chosen new-cue color and light time. With device output running, the tap also lights the wristband and the timeline is told not to send that cue again.
- Each cue has one-click device color chips and a Quick flash / Stay lit choice with seconds. Batch buttons apply the chosen light time to all cues, light each cue until the next one starts, or remove all cues.
- ESP32 live control offers the same Quick flash / Stay lit choice for the manual color buttons; in the timed mode Magenta is available, because `#M…` does not collide with `M` for Music.

All **155 automated tests** and the production build passed. The page was opened in the local browser: the tap pad added cues without errors and the new controls rendered; no device was attached to that browser, so this was a layout and behaviour check only.

## Quick-flash brightness and shared color levels — 13 November 2026

**User observations with build `beat-hold-build` and the website (13 November 2026):**

1. Timed lights stay lit for the set number of seconds (“能亮到设定秒数”). The report did not single out a color, a duration or the early cut by `X`, so those are not individually confirmed.
2. Quick flashes of Green, White and Warm white are weaker than those of Red, Blue, Yellow and Cyan.
3. In quick flashes White, Warm white and Green look alike. Cyan looks light green; Green looks deep green.

The quick-flash frames that build sent, decoded with the independent decoder (red/green/blue):

| Color | Values | Strongest channel | Seen |
| --- | --- | --- | --- |
| Red | 132/32/0 | 132 | bright |
| Blue | 16/12/160 | 160 | bright |
| Yellow | 132/124/0 | 132 | bright |
| Cyan (upstream TURQUOISE) | 132/200/160 | 200 | bright, light green |
| Green | 132/244/0 | 244 | weak |
| Warm white (WHITISH) | 204/176/92 | 204 | weak |
| White (neutral candidate) | 204/204/204 | 204 | weak |

Every flash seen bright has no channel above 200 and every weak one has a channel of 204 or more. The first hold test split the same way (Magenta 240/100/160 and White 204/204/204 only flashed). A rule on red plus green also separates the two groups, so these observations do not identify the cause, and nothing was measured: no supply voltage, no battery change. The White that was seen whiter than Warm white on 12–13 November was compared in bursts; whether the single flashes were already weak then is not recorded.

**Change in source:** quick flashes and timed lights now share one table, `firmware/PixMobBeatController/ColorLevels.h`, and every frame is built by the tested `PixMobFrame.h`.

| Color | Levels now | Basis |
| --- | --- | --- |
| R, B, Y | 132/32/0, 16/12/160, 132/124/0 | unchanged; the built frame is bit for bit the supplied array |
| G | 88/164/0 | stayed lit in the hold tests |
| W | 124/124/124 | stayed lit in the hold tests |
| K | 124/108/56 | WHITISH scaled like White; was already the timed-light value |
| M | 180/76/120 | stayed lit in the hold tests; as a flash it is only sent by Auto |
| C | 68/184/160 | upstream LIGHT_BLUE (6-byte code), chosen because TURQUOISE looked light green; **not observed** |

The supplied arrays moved verbatim to `OriginalFrames.h`; the firmware no longer includes them, and `K` therefore no longer sends the original WHITISH frame. Earlier binaries that do are kept (`beat-hold-build`, `white-candidate-build`). Serial commands, acknowledgements and metadata lines are unchanged except the help line `K = Warm white`. The website label **Warm white (original)** became **Warm white**.

Host test `tests/color-levels.cpp`: the eight reference arrays are rebuilt bit for bit from their documented values; R/B/Y flashes equal the supplied arrays; G/C/M/W/K differ from them; all levels are multiples of four and at most 200; the alternate timed-light frame differs from the first one for every color. All **157 automated tests** and the production build passed.

Build `.arduino/beat-levels-build/` (311,763 program bytes / 23,880 static RAM bytes, binary SHA256 `7c3a36250cc4af6911da5ea478f909169b5a2fcc0622d4f298b7b0880913bb4c`) compiled. After the user disconnected the website, the board was first verified against `beat-hold-build` (digest matched, so that binary is the exact restore point), then this build was written at `0x10000` / 57,600 baud with written-data hash verified. Serial check: the banner shows `K = Warm white` and all metadata lines; `G`, `W`, `K`, `C`, `R` were each acknowledged with `Color sent`, `#G800` and `#C800` with `Light: … 800`, and `X` with the stop lines; the port was released afterwards. These acknowledgements show transmission only. Whether the new levels look equally bright, whether White, Warm white and Green can now be told apart, and how the new Cyan looks are all unobserved.

**User observation after the upload (13 November 2026):** asked whether the Green, White and Warm white flashes are now bright enough and distinguishable, the user answered yes (“够亮也分得出”). This is a visual judgement on one wristband with its current batteries, not a measurement. The answer did not mention the new Cyan, Cyan as a timed light, or the early cut by `X`; those remain unreported.

**User observation (13 November 2026, later):** the colors are now right (“颜色已经对了”). This covers the new levels in general; it was not broken down per color or per mode, and the early cut by `X` is still unreported.

## Strobe and build-up strobe — 13 November 2026

The user asked for a fast strobe, for example during the build-up before a drop.

**Firmware source:** two commands, `!<color><ms>` (steady strobe) and `^<color><ms>` (build: starts slowly and speeds up), colors R/G/B/Y/C/M/W/K, 200–60,000 ms. They are acknowledged once after the first flash with `Strobe: W 2000` or `Build: W 2000` and advertised by the exact line `STROBE: READY`. Each flash is the 9-byte envelope frame with attack 0, sustain 32 ms and release 32 ms at the shared color levels; alternate flashes lower the strongest channel by one step so that no flash repeats the previous command. `StrobePlan.h` schedules them: the steady strobe every 125 ms (8 a second), the build from 500 ms between flashes down to 125 ms, evenly over its duration. Any later command, including `X`, ends a strobe.

**Website:** cues and the live color buttons offer **Strobe for…** and **Build-up strobe for…** next to Quick flash and Stay lit, with the time in seconds; the batch button applies them to all cues. A strobe cue is stored as `holdMs` plus `strobe: "steady" | "build"`. Firmware without `STROBE: READY` gets a steady timed light of the same length instead. The simulated preview shows the same flash times as the firmware schedule.

Host test `tests/strobe-plan.cpp` checks ten durations in both modes (first flash at zero, every gap between 125 and 500 ms, the build never slowing down, nothing scheduled past the duration). All **160 automated tests** and the production build passed. Build `.arduino/beat-strobe-build/` (312,595 program bytes / 23,896 static RAM bytes, binary SHA256 `513e3354732e0289a1c417be2d8fb7a2049255af59f2197daffb1dcba98fe9dc`) compiled. After the user disconnected the website, the board was verified against `beat-levels-build` (digest matched, the exact restore point) and this build was written at `0x10000` / 57,600 baud with written-data hash verified. Serial check: the banner includes `STROBE: READY`; `!W2000` was acknowledged with `Strobe: W 2000` and `^R3000` with `Build: R 3000`, each about 50 ms after the command; `X` during the build was acknowledged; `!G100` and `^B60001` returned `STROBE REJECTED`; `#C800` and a plain `G` flash were acknowledged as before. The port was released afterwards. These acknowledgements show transmission only.

Not known until observed: whether the wristband follows 8 flashes a second or drops some, whether the 32 ms flashes are bright enough, and whether the build reads as speeding up. The 125 ms period is a calculated choice (about 45 ms to send a frame plus about 64 ms of light), not a measured limit.

**User observation after the upload (13 November 2026):** asked whether the strobe and the build-up strobe look right on the wristband, the user answered that they do (“效果对”). This is a visual judgement on one wristband; flashes were not counted, so an occasional dropped flash at 8 a second is not excluded, and the answer did not say which colors, durations or the interruption by Stop or a following cue were tried.

## Custom colors and fades — 13 November 2026

The user asked for more colors and for lights that fade in and out.

**Firmware source:** line commands are now parsed as whole lines by the portable `LightCommand.h`.

- A color may be a preset letter or `=RRGGBB`: six hex digits for the red, green and blue levels, each at most 200 (`C8`), with the strongest at least 8. Higher levels are rejected because flashes with a channel of 204 or more were weak on this wristband.
- `.<color>` is a quick flash of any color, acknowledged with `Flash: =844000`.
- `#<color><ms>,<in>,<out>` adds fade codes 0–7 (0, 32, 96, 192, 480, 960, 2400, 3840 ms) to a timed light. The fade in is the attack of the first frame, the fade out the release of the last frame, and `<ms>` is the time at full brightness between them. Acknowledged with `Light: B 2000 5 7`.
- `!` and `^` accept custom colors too. Earlier commands and acknowledgements are unchanged; the new capability line is `CUSTOM LIGHT: READY`.

**Website:** ESP32 live control shows six extra colors (Orange, Lime, Sky blue, Ice blue, Pink, Hot pink), red/green/blue level inputs with **Send custom color**, **Save color** for the user's own named colors, and Fade in / Fade out choices for Stay lit. Song shows offers the extra and saved colors as chips for new cues and for each cue, a **+** chip with level inputs, and Fade in / Fade out per steady cue. A custom cue keeps the nearest preset letter as its fallback: firmware without `CUSTOM LIGHT: READY` gets that preset without fades. The extra colors use channel values of published PixMob codes (`ORANGE_2`, `YELLOWGREEN_3`, 9-byte `LIGHT_BLUE`, `WHITISH_BLUE`, `PINK_2` scaled by 0.9, `MAGENTA_3`); the names are upstream's and **none of these colors has been observed on the user's wristband**. Swatches on screen show only the channel ratio.

Host test `tests/light-command.cpp`: accepted and 29 rejected command lines, and eight faded lights (same frame count as the plain light, later frames moved back by the fade in, fades only on the first and last frame, no gap between frames). All **166 automated tests** and the production build passed; the page was opened locally without a device: the new chips and level inputs rendered and a tapped cue took the chosen extra color, with no console errors. Build `.arduino/beat-custom-build/` (313,599 program bytes / 23,896 static RAM bytes, binary SHA256 `912fa9362ac8eb28353df5c101eba5e8df62ace2714119b430b0c72e17285711`) compiled. After the user disconnected the website, the board was verified against `beat-strobe-build` (digest matched, the exact restore point) and this build was written at `0x10000` / 57,600 baud with written-data hash verified. Serial check: the banner includes `CUSTOM LIGHT: READY` with the earlier capability lines; `.=844000` → `Flash: =844000`, `.G` → `Flash: G`, `#=844000800,5,5` → `Light: =844000 800 5 5`, `#B1000,0,6` → `Light: B 1000 0 6`, `!=BC10A01000` → `Strobe: =BC10A0 1000`, `^=44489C1500` → `Build: =44489C 1500`; the earlier `#R1500`, `!W600`, `G`, `W`, `R` and `X` were acknowledged as before; a level above 200, fade code 8, black, an incomplete fade pair and an over-long line were each rejected, and the next command after them worked. The port was released afterwards. These acknowledgements show transmission only.

Not known until observed: whether this wristband honours the attack and long release codes (they are documented and used by upstream codes but untried here), whether a fade in looks smooth, and how each extra color looks.

**User observations after the upload (13 November 2026):**

1. Pink (184/120/144) and Hot pink (188/16/160) would not stay lit, and their quick flashes were not bright enough.
2. Magenta was missing from Quick flash.

Nothing was reported about the other four extra colors or about the fades, so those remain unobserved. Hot pink fails with no channel above 188, so the earlier split at 204 does not describe the limit for red; Magenta (180/76/120) works. The cause is still not measured. Website-only changes, no new firmware: Pink is now 164/104/128 and Hot pink 160/12/136 (the same upstream ratios scaled so red stays at or below 180 and red plus blue near 300, inside values seen to work; **not observed themselves**). Magenta is offered in Quick flash on firmware with `CUSTOM LIGHT: READY` by sending the line command `.M`, because the single letter `M` is Music, and Song shows lists Magenta (180/76/120) with the extra color chips. All 166 automated tests and the production build passed.

**User observation (13 November 2026, later):** asked whether the two pinks now stay lit and Magenta can flash, the user answered that everything works (“都正常了”). This is a visual judgement on one wristband. The other four extra colors and the fades were still not reported on.

**User observations (13 November 2026, later):** Green and Lime look the same; Magenta and Pink look the same. Website-only change: Lime 132/152/0 → 132/136/0 (between Yellow 132/124/0 and the value that looked green) and Pink 164/104/128 → 168/132/128 (toward White). Both are estimates for this wristband, no longer upstream values, and **not observed**. Orange, Sky blue, Ice blue, Hot pink and the fades were not mentioned.

**User observation (13 November 2026, later):** with Lime 132/136/0 and Pink 168/132/128 the two still looked the same as Green and Magenta, and the user asked for both to be removed. They are no longer in the extra colors (Orange, Sky blue, Ice blue and Hot pink remain; Magenta stays in Song shows). Cues or saved colors that already carry those levels are not changed. All 166 automated tests and the production build passed.

## Rainbow — 13 November 2026

The user asked for the rainbow that had been left for last.

**Firmware:** `~<ms>[,<cycle ms>]` runs a rainbow for 500–600,000 ms; the cycle (1,000–20,000 ms, default 3,000) is the time of one turn through the colors. It is acknowledged once with `Rainbow: 6000 3000` and advertised by the exact line `RAINBOW: READY`. `RainbowPlan.h` sends a 9-byte envelope frame every 120 ms with attack 0, sustain 192 ms and release 32 ms, so each color is still lit when the next arrives. The colors run in straight lines between the levels this wristband showed as red, yellow, green, cyan, blue and magenta (`ColorLevels.h`) and back to red; if rounding would repeat the previous frame exactly, its strongest channel is lowered one step, because the wristband ignores a command identical to the one showing. Any later command, including `X`, ends it.

**Website:** **Rainbow for…** is offered next to the other light choices for cues, the tap pad, the batch button and the live color buttons, with the seconds and the time of one color turn. A cue stores it as `holdMs` plus `rainbowMs`; firmware without `RAINBOW: READY` gets a steady light in the cue's own color. The preview turns through the same order of colors.

Host test `tests/rainbow-plan.cpp`: the path passes through the six preset colors and repeats each cycle; 2,788 frames over sixteen duration and cycle combinations stay inside the duration, in even steps, within levels seen to work, with no command repeated; twelve malformed commands are rejected. All **169 automated tests** and the production build passed. Build `.arduino/beat-rainbow-build/` (314,647 program bytes / 23,896 static RAM bytes, binary SHA256 `1bc892e7006208b2ae7f8a9132c6165e906687a63365c11e042d3d903dfb3039`). The serial port was free; the board was verified against `beat-custom-build` (digest matched, the exact restore point) and this build was written at `0x10000` / 57,600 baud with written-data hash verified. Serial check: the banner includes `RAINBOW: READY`; `~6000,3000` and `~4000` were acknowledged about 50 ms after the command, `X` during a rainbow was acknowledged, `~499`, `~5000,999` and `~R5000` returned `RAINBOW REJECTED`, and the earlier timed light, `.M` flash, strobe, faded custom light and plain flash were acknowledged as before. The port was released afterwards.

**Not observed:** whether the wristband changes color smoothly or dips or flickers at each 120 ms step, and whether the in-between colors look like a rainbow. Green and Lime, and Magenta and Pink, were indistinguishable on this wristband, so the turn may show fewer distinct colors than six evenly spaced ones.

**User observation (13 November 2026, later):** asked whether the rainbow changes color smoothly on the wristband, the user answered that it does (“顺滑”). This is a visual judgement on one wristband; how many distinct colors a turn shows, other cycle times and the stop were not reported.

**User observations (13 November 2026, later), with screenshots of the Light menu and the color buttons:**

1. The chosen light name did not fit in the closed select.
2. Strobe flashes continuously (as designed).
3. Build-up strobe looks like flashing; the user had understood it to be the fade in / fade out. It is the strobe that speeds up; fades belong to Stay lit. **The fade in and fade out themselves are therefore still not observed.**
4. Orange, Sky blue and Ice blue look right.
5. On the wristband Green is the deeper color and Cyan the lighter one; the request was read as making the on-screen Green swatch deeper.

Website-only changes: the light selects are wider and the options are named Quick flash, Stay lit (can fade in / out), Strobe (fast flashing), Build-up (flashing speeds up) and Rainbow (changing colors); the Green swatch is `#12b24a` instead of `#42ed76` (screen color only, the wristband levels are unchanged). All 169 automated tests and the production build passed; the wider select showed its full text in the local browser.

**User observations (13 November 2026, later):** the Green request meant the on-screen dot color, as changed. The fade in and fade out work on the wristband (“渐亮渐灭有效果”). This is a visual judgement on one wristband; which fade times were tried was not said.

**User observation (13 November 2026, later):** Stop ends a light at once on the wristband (“Stop 能立刻熄灭”). This is the first observation of the early cut: the short frame sent by `X` (same color, 32 ms sustain, strongest channel lowered by 8) does replace the light that is showing. It is a visual judgement on one wristband; which light kinds and colors were stopped was not said.

**User observations (13 November 2026, later):** Stop is confirmed above. The user then sent a screenshot of Song shows in which the Device lead box was squeezed (its explanation wrapped into a narrow column and the number field ran past the edge). Website-only change: the explanation now sits above a fixed-width field labelled "ms early", and two outdated notes were rewritten (White is described as equal red, green and blue rather than "R/G/B 204"; the note under the device status now says the wristband gets each cue's Device color and Device light and that Stop turns off a light that is still on). All 169 automated tests and the production build passed; the box was checked in the local browser.

**User observation with a real song (13 November 2026, later):** the lights come slightly after the drum hits (“灯比鼓点晚一点”) with Device lead at its default of 40 ms. The song, whether the cues came from Analyze or from tapping, and the light kind were not said, and nothing was measured. No change made yet; the user was asked to raise Device lead and report the value that looks right.

**User report with a screenshot (13 November 2026, later):** in a cue row the Rainbow seconds field could not be seen; it had fallen into the narrow first grid column meant for the cue number. Website-only change: a cue's Device color, Device light, seconds, color-turn and fade controls now sit in their own full-width row (`.song-show-cue-device`) with fixed field widths. All 169 automated tests and the production build passed; in the local browser a cue set to Rainbow showed both fields at 96 px.

**User report (13 November 2026, later):** the cue row fields are visible now, but in Song shows the fades, strobe and rainbow did not seem to work. Cause, found in the code: Song shows handed each cue to the app through an inner output that rebuilt the call from the command name and passed on only the color and, for a timed light, its time. Strobe and build arrived as a quick flash, fades and custom levels were dropped, and a rainbow arrived without a color. This had been wrong since strobes were added; the earlier strobe, custom-color, fade and rainbow confirmations were all made in ESP32 live control, which sends directly. Fix (website only): `createSongCueRelay` in `src/lib/songShow.ts` passes the cue's color, light time, strobe and extras through unchanged, and a new test sends one cue of each kind through it. All **170 automated tests** and the production build passed. **Not yet observed:** these effects played from Song shows on the wristband.

**User observation (14 November 2026):** after the relay fix, the fades, strobe and rainbow played from Song shows all work on the wristband (“都起作用了”). This is a visual judgement on one wristband; which cues and colors were tried was not said.

**User observation with a real song (14 November 2026):** with Device lead at 70 ms the lights look aligned with the drum hits (“70可以”); at 40 ms they had come slightly late. This is the first physical observation of beat alignment. It is one value judged by eye on one wristband; the song, how the cues were made and the light kinds were not said, and no latency was measured. The default Device lead is now 70 ms. A value the user already saved in the browser is kept as it is. All 170 automated tests and the production build passed.

## Show files and deleting shows — 14 November 2026

The user asked to run the site online, then to keep the saved show “14/11 coding half version” and delete the others. Nothing was published. Saved shows live in the user's own Chrome storage for `localhost:5173`; the Chrome extension's tab could not reach that address (connection refused), so the shows were not read or changed by the assistant. Instead Song shows gained four controls: **Export show to file** (a `.pixmob-show.json` download, audio not included), **Import show file**, **Delete this show** and **Delete all other shows** (both ask for confirmation and name what will be deleted). `exportSongShow` / `importSongShow` validate the file with the same rules as saved shows. All 171 automated tests and the production build passed; the buttons rendered in the local browser. **The user's shows are untouched until the user presses the buttons.**

## Online deployment — 14 November 2026

The user removed the other saved shows with the new button and asked to publish with Netlify. A new Netlify project `wristband-show-studio` was created in the user's own Netlify team and the production build was deployed to `https://wristband-show-studio.netlify.app` (deploy `6af7f593fa000649e5d22c1f`, reported ready). Only the built site was uploaded: `index.html`, one script and one stylesheet, copied to an empty folder outside the project with a `netlify.toml` that publishes that folder without a build. Source, documents, firmware, `.arduino`, music and recordings were not uploaded, and the build contains no personal strings.

The project carries Netlify's team-login protection, so the address answers `401` with a login redirect to anyone not signed in to the team. **The page itself was therefore not seen by the assistant after deployment**; the user has to open it while signed in to Netlify. Making it open to everyone is a visitor-access setting that was left unchanged. Later website changes need a new deployment. Saved shows, saved colors and Device lead are stored per address and start empty on the new one; a show can be carried over with Export show to file and Import show file.

## Beat looks for Browser sync, Auto and mic sync — 14 November 2026

The user, on the online site (screenshot: connected, `USB · HOST`), asked for Browser song sync, Auto colors and ESP32 mic sync to use the new effects: they only stepped through colors on the beat with a plain flash.

**Firmware source:** these three modes share a beat style and a color set, changed with `@` line commands that do not interrupt the running mode: `@F` quick flash (default), `@L<ms>[,<in>,<out>]` timed light of 50–10,000 ms with fade codes, `@S<ms>` strobe burst of 200–5,000 ms, `@P<letters>` one to eight preset colors for Auto and Music, `@P*` back to each mode's defaults. They are echoed as `BEAT STYLE: …` / `BEAT PALETTE: …` and advertised by `BEAT EFFECTS: READY`. Browser beats accept the digits 1–8 (R/G/B/Y/C/M/W/K) and, for a later feature, `*<color>` for a beat in any color including `=RRGGBB`. Beat and Auto acknowledgements keep the `Color sent` form.

**Website:** the three mode buttons first send the Light chosen in ESP32 live control as the beat style and the chosen colors as the palette; a row of color toggles and **Apply to the running mode** change them while a mode runs. Browser beats step through the same colors. Rainbow is not a beat look and is sent as a quick flash; Build-up is sent as a strobe burst. Firmware without the capability line behaves as before. The parser no longer rejects beat acknowledgements for colors other than R/G/B.

All **172 automated tests** and the production build passed. Build `.arduino/beat-effects-build/` (316,183 program bytes / 23,928 static RAM bytes, binary SHA256 `d29ae6b0e114d01771e3aac4e86ceb19ceaa095922f73b15db7482da44d9cdd4`) compiled. After the user disconnected the page, the board was verified against `beat-rainbow-build` (digest matched, the exact restore point) and this build was written at `0x10000` / 57,600 baud with written-data hash verified. Serial check: the banner includes `BEAT EFFECTS: READY`; in Host mode the digits `1`, `5`, `2`, `8`, `3`, `6` were acknowledged as R, C, G, K, B, M and `*=844000` as `BEAT! Color sent: =844000`; `@L300,0,4`, `@S400` and `@F` were echoed and did not leave Host mode; `@L49`, `@PRGX` and `*=CC0000` were rejected; `*R` outside Host mode sent nothing; Auto with `@PYC` stepped Y, C, Y about 1.85 s apart and with `@P*` started at R again; the earlier timed light, rainbow and flash were acknowledged as before. The settings were left at their defaults and the port was released. The new website was redeployed (deploy `6af86047d0d49f7b8a4f60e6`); Netlify now reports the site as `pizmob-control.netlify.app`, so the user renamed the project. Nothing of this is observed on the wristband.

The user also asked whether the lights could follow the colors of a playing YouTube video on the bass, like PC lighting sync. Not built yet; the firmware's `*<color>` beat is the piece it needs.

**User observation (14 November 2026):** asked whether the three modes now light in the chosen look, the user answered that they do and the effect is right (“会，效果对”). This is a visual judgement on one wristband; which looks, colors and modes were tried was not said.

## Browser beats that follow the shared video's colors — 14 November 2026

The user asked for lights that follow the colors of a playing video and pulse on the bass, like PC lighting sync, and said to build it. Website only; the firmware's `*<color>` beat from `beat-effects-build` carries it.

Browser song sync already captures a shared tab for its audio, and that share includes the picture. `src/lib/screenColor.ts` draws the current frame into a 32×18 canvas when a beat is sent, takes its main color (bright, vivid pixels weigh more than dull ones) and places its hue on the path through the six levels this wristband is known to show as red, yellow, green, cyan, blue and magenta. Dark frames give no color and the beat uses the chosen palette; bright colorless frames give white. The beat goes out as `*=RRGGBB` in the current beat style, so the timing still comes from the bass detector and the look from the Light setting. A checkbox in ESP32 live control, **Browser song sync follows the colors of the shared video**, turns it on; it needs firmware that reports `BEAT EFFECTS: READY`.

Tests: main-color and hue-mapping cases (the six pure hues map exactly to the preset levels, every result is a level set the firmware accepts), beats switching between the frame color and the palette, and the adapter's `*=RRGGBB` beat with its acknowledgement. All **175 automated tests** and the production build passed. In the local browser a synthetic 30 fps stream of a solid color was sampled through the real video and canvas path: red → 132/32/0, blue → 24/36/160, yellow → 132/112/0, near-black → none, near-white → 124/124/124. Redeployed to `pizmob-control.netlify.app` (deploy `6af864d4319d0679496ec9d9`).

**Not observed:** a real shared video tab driving the wristband. The color is one average for the whole picture, read at the moment a beat is sent, and the wristband cannot tell some hues apart (Green and Lime, Magenta and Pink looked the same), so the match is approximate by design.

**User observation (14 November 2026):** with a real video, the wristband's colors roughly follow the picture (“大致跟着”). This is a visual judgement on one wristband; the video, the beat look and how close individual colors were are not recorded.

## Breathing colors and power-on rainbow — 15 November 2026

The user asked for a breathing light that holds each color for 5 s with 0.96 s fade in and fade out, and for a rainbow to run by default while nothing controls the board, until it is controlled.

**Firmware source:** `@I1` / `@I0` turn the power-on rainbow on or off; the setting is stored with `Preferences` (on by default) and reported as `IDLE RAINBOW: ON|OFF` in the banner, after `H` and as the echo. When on, `setup()` queues a rainbow with a 3 s turn that runs until the first serial byte, which cancels it and is then handled normally. Auto now steps after 1.8 s or after the beat style's light (including fades) ends, whichever is longer, so a 5 s light is not cut by the next color. Breathing colors needs no new command: it is `@L5000,5,5`, the palette and `A`, about 6.9 s per color.

**Website:** ESP32 live control gains **Breathing colors** (uses the chosen beat colors) and a checkbox for the power-on rainbow. Both appear only when the board prints the `IDLE RAINBOW` line, because on older firmware Auto steps every 1.8 s and would cut the 5 s light. Tests cover the `@I` parsing, the adapter's `idleRainbow` command and status, and old firmware being refused. All **176 automated tests** and the production build passed. The site was redeployed to `pizmob-control.netlify.app` (deploy `6af96554743d60cc6b96a78a`, reported ready); the new controls stay hidden until the new firmware is on the board.

Build `.arduino/beat-breathe-build/` (324,823 program bytes / 23,952 static RAM bytes, binary SHA256 `acae1a860316c7572b7e6cc81f92857d9e30bbec278654d6a60ebad1064f197f`) compiled. No USB serial device was present at the first attempt. After the user plugged the board in, the port was free; the board was verified against `beat-effects-build` (digest matched, the exact restore point) and this build was written at `0x10000` / 57,600 baud with written-data hash verified.

Serial check: the banner ends with `IDLE RAINBOW: ON` and `IDLE RAINBOW RUNNING` followed about 0.1 s later; `X` as the first byte stopped it and was handled as Stop. `@I0` echoed `IDLE RAINBOW: OFF` and after a reset the banner said OFF and no rainbow started; `@I1` echoed ON and after a reset the rainbow ran again, and `H` as the first byte entered Browser sync and printed the capability lines including `IDLE RAINBOW: ON`. Breathing (`@L5000,5,5`, `@PRG`, `A`) acknowledged R, G, R 6.97 s and 6.96 s apart (the light with its fades is 6.92 s). Plain Auto with `@F` / `@P*` acknowledged R, G, B about 2.05 s apart (1.8 s after each step's three frames complete, the same rule as before). `#R1500`, `.=844000`, `!W400`, `~2000` and `R` were acknowledged as before. The setting was left ON and the port was released. **Not observed on the wristband:** the rainbow at power-on and the breathing fades.

## Rainbow returns when the board is left alone — 15 November 2026

The user confirmed the rainbow at power-on and asked for it to come back whenever nothing controls the board, not only after power-on.

**Firmware source:** `@I<s>` replaces `@I1` / `@I0`: 0 off, 1 power-on only, 2–3600 also after that many idle seconds. Idle means Manual mode (no Auto, Music or Browser sync), nothing queued or running in the IR worker (a new atomic busy flag and the time it last finished), no timed light still lit, and no serial byte and no IR frame for that many seconds; then the same endless rainbow as at power-on is queued, and any byte still ends it. The setting is stored under the new key `idlesec`; a stored on from `beat-breathe-build` becomes 10 s, and the old on/off key is written alongside so a rollback keeps a matching choice. New capability line `IDLE RETURN: READY` before `IDLE RAINBOW: OFF` / `ON` / `ON <s>`. A bare `\r` is ignored even inside a line command but restarts the wait.

**Website (not deployed by this work):** the power-on checkbox became a dropdown — Off, Only at power-on, and, with `IDLE RETURN: READY`, at power-on and after 5 / 10 / 30 / 60 s idle. `beat-breathe-build` can only be set to off or power-on, and the adapter refuses seconds and sends no keep-alive to it. While a song show plays to the board, the page writes one `\r` a second so gaps between cues do not turn into the rainbow. Tests: parser and adapter cases for the new lines, seconds, refusals on older builds and the keep-alive byte; the parser test compiles the C++ `@I` bounds. All **176 automated tests** passed. A first `npm run build` stopped at type errors in `src/SongShows.tsx`, which another session was rewriting at the same time; after that rewrite settled, the build and all 176 tests passed again.

Build `.arduino/beat-idle-build/` (327,255 program bytes / 23,968 static RAM bytes, binary SHA256 `4a92bbf40acca1af5fd9377b9fd289be1c9bae24e1d4d886209a57ace8db7c32`) compiled. With the user's go-ahead after the page was disconnected, the board was verified against `beat-breathe-build` (digest matched, the restore point) and this build was written at `0x10000` / 57,600 baud with written-data hash verified.

Serial check: the first boot printed `IDLE RETURN: READY` and `IDLE RAINBOW: ON 10` (the stored on migrated) and the rainbow ran; after `X` the rainbow came back 10.05 s later; a bare `\r` stopped it and further `\r` bytes every 6 s kept it away for 15 s. With `@I5`, after `#R1500` the rainbow returned 5.6 s after the command (the wait counts from the last IR frame, and it never starts while a timed light is still lit). During 8 s of Auto no rainbow started. With `@I1` nothing returned during 7 s idle, and after a reset the banner said `ON` and the rainbow ran; with `@I0` the banner said `OFF` after a reset and nothing ran. `@I3601` and `@I010` were rejected; `@I10` echoed `ON 10` and held across a reset. `#R1500`, `.=844000`, `!W400`, `~2000`, `R`, `@L5000,5,5` and `@F` were acknowledged as before. The setting was left at 10 s and the port was released. **Not observed on the wristband.** The website part was deployed later with the Song shows redesign (deploy `6af96a7e02fc27e8919b6e71`).

## Song shows page redesign — 15 November 2026

The user said that playing and stopping meant scrolling up and down all the time, that setting colors was still hard and that the page felt messy. A show with 237 cues made the page about 75,000 px tall, with Play at the top and each cue a 290–360 px card full of preview-only fields.

Only `src/SongShows.tsx` and `src/songShows.css` changed; the show format, the cue relay and the hardware output path are unchanged. Play / Pause, back to the start, the clock, the position slider, Tap (keyboard T) and Send to wristband now stay at the top of the screen. Under them a brush holds the color (or several colors used in turn), the light, its seconds, fades and rainbow turn; new taps and Add use it, and ticked cues (Shift-click ticks a range) can be given its color, its light, a light until the next cue, or be deleted together. Each cue is one row: tick, number (jumps the song), time, a color button that opens the palette, light, seconds and fades or rainbow turn; the name and the on-screen preview settings are behind `…`. Export / import / delete moved into a Show file menu, rhythm analysis folds away, messages show in the top bar and can be dismissed, Follow playback keeps the playing cue in view, and Space plays or pauses when no field has focus. On narrow screens the brush folds behind a Colors button.

Checked in the local browser with the 237-cue show (no change was saved): page height about 13,500 px at 1280 px wide, cue rows 46 px, top bar 150 px; a Shift range ticked cues 4–8; with Blue and Yellow in turn, Set color gave Blue, Yellow, Blue… in time order; Set light gave Stay lit 1.5 s with 0.48 s / 0.96 s fades; a cue's own palette set Hot pink; T added a cue in the brush color and light; Space without a song showed the choose-a-file message; with the external clock and Follow playback on, the page scrolled the playing cue to the middle. At 375 px the top bar is 126 px with the brush folded and nothing overflows sideways. All **176 automated tests** and the production build passed.

Deployed to `pizmob-control.netlify.app` (deploy `6af96a7e02fc27e8919b6e71`, reported ready) together with the idle-rainbow website changes above, which were waiting for this deployment. **Not yet used by the user.**

## Rolled back to beat-effects-build — 15 November 2026

The user sent a phone video (`IMG_8620.MOV`, 8.1 s, 3840×2160 at 60 fps, kept in the user's Downloads only) and said this does not look like a rainbow, to go back, and that the rainbow before the breathing work was normal. A frame scan of the video (bright-pixel counts per frame and a contact sheet, local only) shows the colors moving through orange, yellow, green, blue and purple, but the wristband is dark for much of the time: in each 3.0 s cycle it stays lit about 0.4 s around orange–yellow and 0.3 s around blue–purple, gives a few short blinks between yellow and cyan, and is dark about 0.7 s between magenta and red. The lit/dark pattern repeats exactly every 3.0 s, the rainbow's default cycle, so it follows the colors, not time.

The rainbow frames have not changed since `beat-rainbow-build`, which the user called smooth on 13 November: `RainbowPlan.h`, `ColorLevels.h`, `PixMobFrame.h`, `runRainbow` and `sendEnvelope` match that build's sketch copy line for line. The only difference is that the power-on rainbow has no end time. The settings used in the earlier observation (cycle seconds, wristband battery, distance) were not recorded, so the cause of the dark parts is not known; the dark parts fall on colors with large channel sums (around cyan), which fits the unproven low-power idea but does not prove it.

As asked, after the user's request and with the port free, the board was verified against `beat-idle-build` (digest matched, so it can be restored) and `beat-effects-build` (SHA256 `d29ae6b0…cdd4`) was written at `0x10000` / 57,600 baud with written-data hash verified. Serial check: the banner shows no `IDLE` lines and no rainbow starts; `~6000,3000`, `#R1500`, `.=844000`, `!W400` and `R` were acknowledged; `X` stopped. The board therefore has no power-on or idle rainbow, no breathing and the old 1.8 s Auto step again. The website hides Breathing colors and the rainbow setting without the `IDLE RAINBOW` line. `beat-breathe-build` and `beat-idle-build` stay in `.arduino/` for a later upload. **Not yet observed:** whether the `~` rainbow on this build looks smooth again; if it blinks the same way, the cause is outside the firmware change.

**Rainbow on the rolled-back build (15 November 2026):** the user then sent `IMG_8621.MOV` (27.8 s, 4K 60 fps, kept in the user's Downloads only), a rainbow run on `beat-effects-build` (one turn of colors took about 10 s). The same frame scan shows the same behaviour as `IMG_8620.MOV`: lit around orange–yellow and around cyan–blue–purple, but from yellow to green only short blinks about every 0.23 s (roughly every second frame) with dark in between, and mostly dark from magenta back to red. The wristband was lit about 38% of the time. Since this build's rainbow code is the code the user called smooth on 13 November and it now blinks in the same color ranges, the blinking was **not caused by the breathing or idle-rainbow changes**. Cyan, which has the largest channel sum, stayed lit, so the low-power idea does not explain it either; the cause is not known. (`IMG_8620 2.MOV` is a byte-identical copy of `IMG_8620.MOV`.)


## Handoff reconciled against the latest folder — 15 November 2026

Re-read the current handoff, verification log through the rollback video, firmware and frontend implementation. Replaced the accumulated CLAUDE entry and handoff with a consolidated current-state guide, and added version notices to the general/firmware/serial READMEs. Original handoff files are retained under `.arduino/handoff-review-2026-11-15/`.

The guide now distinguishes the last verified installed `beat-effects-build` from the newer idle-capable source, preserves the user's decision to keep the old build, and records that rainbow dark intervals persisted after rollback. It incorporates the later White/color, Stop, song-effect relay and 70 ms lead observations, the 1024-cue limit, redesigned editor, video-color sync, deployment record and origin-specific browser storage.

Recomputed the effects, idle, breathe, rainbow, custom and single-frame binary SHA256 values and three read-back backup hashes; all match the recorded values. All current firmware headers match the idle build's sketch copy after removing build line markers; the main sketch differs only by generated function declarations. The effects build retains identical frame/color/light/strobe/rainbow/detector headers, while the parser and main loop precede the idle changes.

Ran `node --import tsx --test tests/*.test.ts`: **176 passed, 0 failed, 0 skipped**. `npm run build` passed (Vite 6.4.5); resulting assets are `index-CSBZ3b3N.js` and `index-C50iYAoK.css`. Logs are retained with the handoff originals. No application code was changed, no ESP32 compilation or USB operation was performed, no browser shows were read or changed, and no site was redeployed. Hardware and online-access statements in the handoff are explicitly the latest recorded observations, not a new live check.

## CC1101 read-only wiring check — 16 November 2026

The user wired the 433M V2.0 CC1101 module by the pin plan in [wiring](WIRING.md) and asked for a check. `firmware/CC1101Check/` only reads: with a pull-up on MISO it pulls CSN low and waits for the chip to pull MISO low, then reads PARTNUM, VERSION, MARCSTATE and the reset defaults of IOCFG2/1/0 and SYNC1/0 over SPI, counts GDO0 clock edges for 20 ms and reads GDO2. It sends no strobe, writes no register and never transmits. Build `.arduino/cc1101-check-build/` (278,208 program bytes, SHA256 `361916470feadde83c7cdc441084a0c8ce82403c034bb3f2a0cffb94a57bec4e`). The port was free, the board was verified against `beat-effects-build` (digest matched, the restore point) and the check was written at `0x10000` / 57,600 baud with written-data hash verified.

First result, the same three times: MISO went low on CSN but **stayed low after CSN went high**; every register read `0x00` (defaults expected `0x29 0x2E 0x3F 0xD3 0x91`, VERSION `0x14` or `0x04`); GDO0 had **no edges** (about 2,700 expected) and GDO2 read **HIGH** (LOW expected). This fits the header being connected mirror-image (looked at from the pin side with the front-view numbering): GPIO19 would then sit on pin 1 (GND), GPIO22 on pin 2 (VCC), GPIO4 on pin 5 (SCK) and 3V3 on pin 8 (GDO2). That is an inference from the readings, not a confirmed cause. The user was asked to unplug USB and rewire counting from the square pin-1 pad. The check program stays on the board for the re-test; `beat-effects-build` is to be written back afterwards.

**Re-test after rewiring (same day):** three identical passes — MISO low on CSN and released afterwards; PARTNUM `0x00`, VERSION `0x14`; IOCFG2/1/0 `0x29 0x2E 0x3F` and SYNC1/0 `0xD3 0x91` (the reset defaults); MARCSTATE `0x01` (idle); GDO0 2,700–2,704 rising edges in 20 ms (about 135 kHz, the 26 MHz crystal divided by 192); GDO2 LOW. Result `WIRING OK`: power, SPI, CSN, GDO0 and GDO2 are connected as planned and the chip answers like a CC1101 after the earlier mis-wiring. The first failure therefore came from the wiring, and the mirror-image explanation fits but was not observed directly. `beat-effects-build` was then written back at `0x10000` with written-data hash verified, `verify-flash` matched, and the board printed its usual banner. Nothing was transmitted at any point; the wristband's RF band and protocol remain unknown.


## RF colour test with the CC1101 — 16 November 2026 (inconclusive: the band did not respond to IR either)

**Band identification (PCB photos from the user, not measured):** crystal X1 printed 27.138266 MHz, U1 an SOP-8 marked `004 2623JQ0462`, U2 AK12E, plus U3, VR1, Q1 and the LEDs — the same reference designators as the sueppchen RF board. From the CMT2210LH datasheet relation (27.1412 MHz crystal for 433.92 MHz) this points to an RF receiver near 433.87 MHz. Inference only; see [wiring](WIRING.md#rf).

**Test firmware:** `firmware/PixMobRFTest/` (`PixMobRFTest.ino` + `PixMobRFFrame.h`). The frame encoder follows the public sueppchen PixMob_waveband library (BSD licence, notice kept in the header): 9 bytes (CRC12 A, mode, G, R, B, attack/random, release/hold, group, CRC12 B), each 6 bits line-coded to 8, sent LSB first at 500 µs per bit after a 0x55 0x55 preamble and sync bits 0, 1. Only mode 0x00 (plain colour) for group 0 can be built; the library's MODE_WRITE (EEPROM) frames are not implemented. The CC1101 runs asynchronous serial OOK (own register set-up from SmartRC/SmartRF values, FSCTRL0 0), frequency limited to 433.10–434.70 MHz, power −30…+10 dBm (0 dBm after reset), each command a short burst then IDLE, nothing sent without a command, and frequency/modulation/PATABLE registers read back before every burst (calibration bits of FSCAL3/2/1 excluded after the first self-check showed the chip rewrites them). Host test `tests/rf-frame.cpp` (via `tests/firmware-rf-frame.test.ts`) reproduces all **16 captured frames** listed in the library's `basic.ino` byte for byte, including CRCs. Full suite: **177 passed**. Final build `.arduino/rf-test-build/`, SHA256 `c8179086ca5cbd6f63ba73c1a4cc47cd14c9111973b9f2f2e327fadb1d56f983`.

**Upload:** the port was free; `beat-effects-build` verified on the board first (digest matched, restore point), then the test build written at `0x10000` / 57,600 baud and verified. Status: PARTNUM 0x00, VERSION 0x14, IDLE, 433.920 MHz (FREQ 0x10B071), registers match. Self-check with black (no light) frames: every frame reached TX state (MARCSTATE 0x13), none failed.

**Run 1 (user watching, band 10–30 cm from the antenna):** red at 433.920 MHz, 0 dBm, one frame every 200 ms for 3 s (15 frames); then six 2 s steps with their own colour — red 433.700, green 433.800, blue 433.873, yellow 433.920, cyan 434.000, white 434.100 MHz (60 frames). 75 frames reached TX, 0 failed. **User: nothing lit.**

**Run 2:** 10 dBm, one frame every 100 ms (the library asks for a repeat within 120 ms): red at 433.920 MHz for 3 s, then 433.10–434.70 MHz in 36 steps of about 46 kHz, 0.5 s each, six colours from low to high (red, green, blue, yellow, cyan, white). 210 frames reached TX, 0 failed. **User: nothing lit.**

**IR control:** `beat-effects-build` restored at `0x10000` and verified (digest matched; banner `PIXMOB BEAT CONTROLLER READY!`), then `#R3000` sent (`Light: R 3000`) with the IR LED pointed at the band as usual. **User: the band did not light either.** So the band was not working during the test (likely power or assembly after it was opened for the photos), and the two RF runs say nothing about whether RF control works. Not shown: that the CC1101 actually radiated a modulated signal (only TX state was read back; no receiver or SDR was used), the band's real RF frequency, or that a 433 MHz band uses the published 868/915 MHz protocol.

The board ends on `beat-effects-build` (verified). Logs of both runs are in the session scratchpad only.

## Battery replaced — 20 November 2026

**User observation:** after fitting a new battery in the wristband, the rainbow and all colors look normal again (“换了新电池 目前rainbow和全部颜色都正常了”); the user puts the earlier dark parts and blinking down to a flat battery. This is a visual before/after judgement on one wristband; the battery voltage was not measured, and the firmware was not changed (the board still runs `beat-effects-build`). It fits the two rainbow videos of 15 November, which showed the same dark color ranges on both firmware builds. The color levels lowered on 13–15 November (Green, White, Warm white, Magenta, the pinks with red ≤ 180) were chosen while the battery may already have been weak; they have not been compared again on the new battery and are unchanged. The IR now lights the band, which was the precondition noted for retesting RF; RF was not retested.

## RF colour test, second attempt — 20 November 2026 (still inconclusive: IR control did not light)

After the user replaced the band's battery (another session recorded IR and rainbow working again) the user asked to test the CC1101. `beat-effects-build` verified on the board first (digest matched). IR control `#R3000` (`Light: R 3000`) with the band 10–30 cm from the CC1101 antenna and the IR LED pointed at it: **user: did not light**. The user noted that the Arduino code had not changed; the cause (aim/distance while next to the antenna, or the band itself) was not established.

The user asked to go ahead with the CC1101 anyway. `rf-test-build` (SHA256 `c8179086…f983`) written and verified; status and registers OK; black self-check frames reached TX. Run: 10 dBm, one frame every 100 ms, red at 433.920 MHz for 3 s, then the 433.10–434.70 MHz wide sweep (36 steps, red/green/blue/yellow/cyan/white from low to high). 210 frames reached TX, 0 failed. **User: nothing lit.** `beat-effects-build` was then restored and verified (digest matched, banner OK). No IR control was sent afterwards (the user replied with a message instead). Because the IR control before the run also failed, this run does not show that RF control fails.

## RF colour test, valid run — 20 November 2026 (band lights from IR, not from RF)

The user confirmed the band lit from IR through the web page in its test position (next to the CC1101 antenna), then disconnected the page (Chrome had held the port). `beat-effects-build` verified on the board (digest matched); `rf-test-build` (SHA256 `c8179086…f983`) written and verified; status, registers and black self-check frames OK. Run, band not moved: 10 dBm, one frame every 100 ms, red at 433.920 MHz for 3 s, then the 433.10–434.70 MHz wide sweep (36 steps of ~46 kHz, red/green/blue/yellow/cyan/white from low to high). 210 frames reached TX, 0 failed. **User: nothing lit.** `beat-effects-build` restored and verified (digest matched, banner OK), then `#R3000` over IR in the same position: **user: lit red** ("亮的是IR，RF没亮").

So with a working band, public-protocol colour frames (group 0, mode 0) sent by this CC1101 anywhere in 433.10–434.70 MHz at up to 10 dBm did not light it. Not separated: (1) the band's RF frequency is outside this band (the 433.87 MHz figure is an inference from the crystal and the CMT2210LH datasheet, and U1 is not confirmed to be a CMT2210LH); (2) the band uses a different frame than the published 868/915 MHz protocol; (3) the CC1101 did not radiate the modulated signal (only the TX state was read back; no receiver or SDR was used).

## Band identification from the case label and datasheet — 20 November 2026 (calculation, not measured)

**User photos (20 November 2026):** case label "PIXMOB, Product#: Wave2 Gen 3, Lot#: CN12-2606-5712, CAN ICES-003(B) / NMB-003(B), 6V (Lithium Cell CR2032: 3V x 2), Made in China" — no FCC ID or radio certification number, so the label does not state a frequency. PCB silkscreen "CEMENT V1.1r3 (C) 20241126", "PIXMOB", parts U1, X1, U2, U3, D1, VR1, Q1, L1, L2, LED1, LED2 — the "cement 1.1" board the sueppchen wiki documents. X1 printed "27.138266 MHz-D"; U1 (SOP-8) printed "004" over "2623JQ0462"; U2 "AK12E".

**Datasheet (CMOSTEK CMT2210/17LH v0.5, read 20 November 2026 from a public PDF copy):** CMT2210LH covers 300–480 MHz, CMT2217LH 300–960 MHz; low-IF receiver whose RF is set by the crystal; IF bandwidth 330 kHz at 433.92 MHz and 240 kHz by default elsewhere. Typical BOM crystals: 315 MHz → 26.2774, 433.92 → 27.1412, 868.35 → 26.3236, 915 → 26.152 MHz. All four fit RF = (N − 1/80) × crystal with integer N (12, 16, 33, 35). Top marking: line 1 the model name, line 2 "YYWW" plus six tracking characters. The user's U1 line 2 "2623JQ0462" matches that format (2026 week 23); line 1 "004" is not a model name. The sueppchen wiki says only "Xtal × 35" and reports U1 as a CMT2210LH "labeled 2322dQ1461" (same line-2 format).

**Calculation:** with N = 35, PixMob's US crystal 26.1522 MHz gives **915.000 MHz** (the 915 MHz of PixMob's Wave Node transmitter manual) and the EU crystal 24.8117 MHz gives 868.099 MHz. The user's 27.138266 MHz gives **949.500 MHz** with N = 35 (LO 949.839 MHz); with N = 16 it gives 433.873 MHz, the 433 MHz figure already tested without reaction on a working band. The exact round 949.500 MHz makes N = 35 the most likely reading, i.e. the band probably listens near **949.5 MHz**. This is not measured: N is set in the chip's configuration and U1's model is not printed.

Consequences recorded, nothing transmitted: 949.5 MHz is above the CC1101's specified 779–928 MHz range, the user's module is matched for 433 MHz, and in Malaysia 925–960 MHz is the licensed 900 MHz mobile downlink, not a licence-free band — so the band is not tested there. A receive-only check is possible: an RTL-SDR next to the band could look for the receiver's local oscillator near 949.84 MHz, and also confirm whether the CC1101 really emits at 433.92 MHz.

**Reassessment with the user's photos, 20 November 2026:** HopeRF AN151 specifies a 27.13827 MHz crystal for 433.92 MHz on the CMT2210B/LA, almost exactly the wristband's marked 27.138266 MHz. The CMT2210/17LB datasheet independently lists 27.1383 MHz at 433.92 MHz. These support 433.92 MHz as the leading candidate. The prior 949.5 MHz estimate is conditional on an unidentified receiver and an unverified divider. The earlier 433 MHz trial logged TX state and lack of a visible response, without an independent capture of the emitted RF. Re-ran the host frame test: 16/16 public frames match. See [RF wiring and sources](WIRING.md#rf). This reassessment did not perform a new hardware test.

## CC1101 PLL lock at 433.92 MHz — 20 November 2026

The user requested a PLL check with the existing ESP32 and wiring. Compiled the independent `firmware/CC1101PllCheck/` sketch with Arduino-ESP32 3.3.12. Verified that the installed application at `0x10000` matched `beat-effects-build` before writing the temporary application. The build configured the nominal 433.920 MHz frequency word `10 B0 71` with channel and frequency offset zero. It entered receive mode with automatic calibration, observed the PLL lock output on the already connected GDO2 (GPIO22) and read FSCAL1. Each trial returned to IDLE. See [TI silicon errata](https://www.ti.com/lit/er/swrz020e/swrz020e.pdf#page=3).

**Result: 5/5 receive-mode calibrations locked.** GDO2 started low, rose and read high in RX, and returned low in IDLE on every trial. FSCAL1 was stable in each pair of reads (0x1B, 0x1A, 0x1B, 0x1B, 0x1B). The check did not transmit RF. The radiated carrier and modulation remain unmeasured.

The original `beat-effects-build` was written back to `0x10000`, independently verified against the original application image, and answered Stop with its usual capabilities including `BEAT EFFECTS: READY`. Wiring was unchanged. Local build and test logs are in `.arduino/cc1101-pll-check-build/` and `.arduino/cc1101-pll-run/`.

## RF wake replay, then one red frame — 20 November 2026

With the existing ESP32 and CC1101 wiring, the user requested a bench trial at 433.920 MHz. Used the published edited 915 MHz [wake capture](https://github.com/danielweidman/pixmob-ir-reverse-engineering/blob/main/rf/edited_rf_captures/915Mhz/withrepeats/nothing.sub) and one frame from the [deterministic red capture](https://github.com/danielweidman/pixmob-ir-reverse-engineering/blob/main/rf/edited_rf_captures/915Mhz/wine_fade_in.sub). The wake cadence was 45.9 ms per frame plus 4.5 ms between frames. The first temporary build stopped before entering TX because RMT output setup failed. The second build drove GDO0 using GPIO with absolute microsecond deadlines and a nominal 0 dBm power setting.

The CC1101 register check matched and it entered TX. The ESP32 reported 595 wake frames over 30 seconds, one red frame from the 30-second mark, 30.0504 seconds total, a maximum logged GPIO scheduling delay of 16 µs, and a return to IDLE. **User observation: the wristband did not light.** This trial did not independently measure the radiated RF or establish whether this wristband accepts the published frame format at 433.92 MHz. Local temporary firmware and serial output are in `.arduino/rf-wake-run/`.

The original music controller was restored, independently verified against its application image, and replied with `BEAT EFFECTS: READY`. Wiring was unchanged.

## Published 868/915 MHz captures against our encoder — 20 November 2026 (offline analysis, no hardware)

The user sent [danielweidman/pixmob-ir-reverse-engineering `rf/`](https://github.com/danielweidman/pixmob-ir-reverse-engineering/tree/main/rf) (MIT License). Its README reports US bands on 915 MHz and EU/UK bands on 868.000 MHz, PCBs that differ only in the crystal, OOK with ~510 µs time units, and an aggressive sleep: a band must receive valid frames repeatedly for up to ~30 s before it reacts again, and the "nothing" code wakes bands and keeps them awake without lighting them. The repository has no 433 MHz capture and does not mention 433 MHz bands.

**Decoded here** (Flipper RAW files, this project's 6b8b table and CRC12; scripts in the session scratchpad only):

| Source | Frames | Result |
| --- | --- | --- |
| 16 cleaned single frames, 915 MHz (the 868 MHz copies carry the same data) | 16 | all CRC OK, mode 0, group 0 |
| 15 cleaned repeat files, 915 MHz | 25–336 per file | all CRC OK; `wild_combo` also has mode 16 frames |
| Cavaliers playoff 2023 venue recording `RAW_20230415-175742` | 89 decodable | CRC OK; nothing, red and gold frames |
| Lions playoff 2024 `BlueandWhite` and `WhiteGlitter` | 228 and 61 decodable | CRC OK; full-scale 63 values and mode 16 also in use |

- **Bit time:** over whole frames of the venue recordings it measures **511.6–511.9 µs** (10th–90th percentile 511.2–512.1 µs). Our colour runs used 500 µs; the 20 November wake replay used the cleaned 510 µs.
- **Frame rate:** frames start every **50.1 ms** in the venue recordings and 50.4 ms in the cleaned repeat files, a continuous stream with gaps of about 4 ms. A colour is sent dozens of times: 25–72 frames in the cleaned repeat files, 39 in a row in `WhiteGlitter`, sometimes interleaved with other colours.

**What has been sent so far:** the 16 and 20 November colour runs sent one frame every 100 ms, 3 s per colour and 0.5–2 s per sweep step, never 30 s of continuous frames. The 20 November wake replay sent 30 s of the "nothing" frame and then **one** red frame. A wake followed by a repeated colour has not been sent.

**Changes (compiled, not uploaded):**
- `PixMobRFFrame.h`: bit time 512 µs. The two captured frames are named: `kNothingTiming`, and `kWineRed` with `kWineFadeInTiming`.
- `tests/rf-frame.cpp`: checks both frames bit for bit against the published `nothing.sub` and `wine_fade_in.sub` RAW data (2/2), in addition to the 16 frames (16/16).
- `PixMobRFTest.ino`:
  - Frame interval now defaults to 50 ms (`I50`–`I1000`).
  - New `Z` command: 35 s of the "nothing" frame, then 5 s of the wine red frame, one frame every 50 ms in one TX period, at the current frequency and power. `X` stops it.
- Build `.arduino/rf-wake-test-build/PixMobRFTest.ino.bin`, SHA256 `61071ea2785f00aeaf853bf510f137915ab66435082ad154c0dd293071399619`.
- `npm test`: 177 pass.

The board still runs `beat-effects-build`. Nothing was transmitted.

## RF wake test with repeated red — 20 November 2026 (the band lit at 10 dBm)

The user asked to run `Z`.

**Preparation**
- The serial port was free.
- `beat-effects-build` verified on the board (digest matched).
- IR control first: `#R3000` (`Light: R 3000`) with the band in its test position next to the CC1101 antenna. **User: lit red.**

**First build refused before TX.** `rf-wake-test-build` SHA256 `61071ea2…9619` was written and verified.
- `Z` stopped before TX with "ERROR: GDO0 is high in IDLE; not transmitting". With IOCFG0 0x0D (serial data output) the CC1101 held GDO0 high in IDLE, and the safety check refuses that.
- The first attempt's serial log was lost to an output filter on my side. The second attempt logged the refusal. Nothing was transmitted in either attempt.
- `sendFrame()` uses the same check, so the burst commands (R, G, B, …) should refuse the same way. That was not tried separately.

**Change.**
- `Z` now keeps the CC1101 side of GDO0 high impedance (0x2E), checks that the line reads low, and drives it from the ESP32 alone, as the earlier wake replay did. In asynchronous serial TX the CC1101 takes GDO0 as its data input.
- Every run below logged the line state as: high as data output (0x0D), low with CC1101 high impedance (0x2E).
- Build SHA256 `0eef7014598f2da3bf1c2e740d1ae0582a117a208bc9acff4200f675ed3a3d66`, written and verified.

**Runs.** The band was not moved. Every run used 433.920 MHz: 700 "nothing" frames, then 100 red `wine_fade_in` frames, one frame every 50 ms, 512 µs bits. The worst edge was 2 µs late, the radio was in TX state (0x13) at the end, and it went to IDLE afterwards.

| # | Ended | Power | User, last 5 s |
| --- | --- | --- | --- |
| 1 | 18:14:07 | 0 dBm | did not light |
| 2 | 18:15:31 | 10 dBm | **lit red** ("亮了 亮了") |
| 3 | 18:17:07 | 0 dBm | did not light |
| 4 | 18:18:20 | 10 dBm | **lit red** |

**Restore.** `beat-effects-build` was written back and verified (digest matched), and its banner showed `BEAT EFFECTS: READY`. IR `#R3000` in the same position:
- About 1.5 min after the last RF red: **did not light**.
- Retried about 1 min later: **lit red**.

Whether the first IR miss came from aim or from the band ignoring IR shortly after RF is not known.

**Reading**
- This is the first RF control of this band. It receives at 433.92 MHz and accepts the published 868/915 MHz frame format, which refutes the 949.5 MHz hypothesis.
- In this position 10 dBm worked 2/2 and 0 dBm 0/2. Run 3 started under a minute after run 2 had lit the band.
- The earlier 10 dBm colour run did not light. Five things differ between it and `Z`: the 35 s wake, 50 ms instead of 100 ms frames, one continuous TX period, 512 µs instead of 500 µs bits, and the GDO0 scheme. Which of them matter is not separated.
- The evidence is the user's visual observation only; there is no video or radio capture.

Serial logs are in `.arduino/rf-wake-test-run/` (`rf-run5.log` is the empty first log; `rf-run6.log` is the refusal).

## RF follow-up: burst path, wiring, colours and range — 20 November 2026 (only within about 2–3 cm)

**Firmware** (`firmware/PixMobRFTest/`, final build `.arduino/rf-burst-test-build/`, SHA256 `484b4a321f1efbeab72e77934de89e0372286e92020e2fb8d70f815bbf423ef2`). Intermediate builds: `12922687…5a95` (shared TX path) and `ec79393b…5e1f` (adds the wire check and adjustable wake length).
- Bursts (R, G, B, …, T, Q) now use the same TX path as `Z`. The CC1101 side of GDO0 stays high impedance, and all frames of a burst go out in one TX period on a 50 ms schedule.
- Before every transmission the firmware checks the GDO0 wire. The CC1101 drives the line high (IOCFG0 0x6F), then low (0x2F), and the ESP32 must read both levels.
- TX monitor: before each frame the radio must still be in TX with an unchanged FREQ2. The result is printed after each run.
- `Z<seconds>` sets a 5–90 s wake.

**Board incidents (mine):**
- One upload command failed in zsh because the port arguments sat in one unsplit variable. Nothing was written.
- The user then unplugged the USB ("是我拔的") while my next write was starting. About an hour later, after reconnection, `verify-flash` against `beat-effects-build` failed on the same board (MAC 20:9b:a9:60:a7:08).
- The user had uploaded nothing elsewhere, and no IDE or other-session activity was found. Most likely my write had partly started.
- My command did not stop on the failed verification and wrote the test build over it.

**Runs after the reconnection.** All at 433.920 MHz and 10 dBm, with the band 10–20 cm from the antenna, unless stated otherwise:

| Run | Build | Sent | User |
| --- | --- | --- | --- |
| 12 | 12922687 | `Z`, then green, blue and red 3 s each | did not watch |
| 13 | 12922687 | same as run 12 | nothing lit |
| — | beat-effects | IR `#R3000` | lit red |
| 15 | ec79393b | `Z` (GDO0 wire OK) | did not light |
| 16 | ec79393b | `Z`, band touching the antenna | did not light |
| 17 | ec79393b | `Z90` | did not light; radio in IDLE, not TX, at the end |
| 19 | 484b4a32 | `Z` after the user pressed in all 8 wires (TX monitor OK) | not noticed |
| 20 | **0eef7014**, the build that lit at 18:15 | `Z` as in runs 8 and 10 | **did not light** |
| — | — | user rewired the CC1101 by the pin diagram, USB off | — |
| 22 | 484b4a32 | `Z` (status, wire and TX monitor OK) | **lit red** |
| 23 | 484b4a32 | green, blue, red 3 s each, no wake | not watched |
| 24 | 484b4a32 | green, blue, red 5 s each, no wake | **green, blue and red lit** |
| 25 | 484b4a32 | band at about 1 m: red 5 s at 10 dBm, then green 5 s at 0 dBm | neither lit |
| 26 | 484b4a32 | `Z` close, then the six-step sweep with the band at about 1 m | not reported |
| 27 | 484b4a32 | 90 s of red (9 × 10 s), starting close | never lit |
| 28 | 484b4a32 | `Z` close, then 65 s of red while the user moved the band away | lit; "需要非常靠近，应该距离大概2-3cm而已" |

Afterwards `beat-effects-build` was written back and verified (digest matched), and the banner showed `BEAT EFFECTS: READY`. IR `#R3000` lit red.

**Reading**
- **Wiring, not code.** The binary that lit the band at 18:15 failed after the USB unplug (run 20) and worked again once the CC1101 was rewired. SPI and the GDO0 wire passed before the rewire, so the bad contact was probably power, ground or the antenna; it was not identified.
- **Short bursts work once awake.** With the band awake, 5 s bursts of green, blue and red lit it without a new wake. These were colours built by this project's encoder (full scale, library default timing), not only captured frames.
- **Wake.** 90 s of red frames did not wake a sleeping band (run 27), while 35 s of the captured "nothing" frame did (runs 22 and 28). This is one comparison each and was not separated from position.
- **Range.** The band responded only within about 2–3 cm at 10 dBm (user's estimate). At about 1 m neither 10 dBm nor 0 dBm lit it, and 0 dBm also failed at 10–20 cm earlier today.
- **What the range implies.** A receiver tuned to 433.92 MHz should respond over metres at 10 dBm. Such a short range suggests the band is not receiving through a front-end tuned to 433.92 MHz, and the strong field next to the antenna gets into its circuit instead.
- **The band's frequency is therefore still open.** With the LH-family formula RF = (N − 1/80) × 27.138266 MHz, integer N gives 433.873 (N=16), 868.085 (N=32), 922.362 (N=34) and 949.500 MHz (N=35). 922.36 MHz lies in the 920–925 MHz bands used across Asia-Pacific (Malaysia 919–923 MHz). This is calculation only; the receiver family is unconfirmed.
- Evidence is the user's observation only; there is no video and no radio capture.

Logs are in `.arduino/rf-wake-test-run/` (`rf-run12` to `rf-run28`, the `ir-after-rf` logs and the upload and restore logs).

## RF at 922.36 MHz — 20 November 2026 (lit at 30 cm, 1 m and 3 m; 433.92 MHz control did not)

**Rules, checked before transmitting:**
- [MCMC Class Assignment No. 1 of 2025](https://www.mcmc.gov.my/skmmgovmy/media/General/registers/Class%20Assignment/Class-Assignment-No-1-of-2025.pdf), Second Schedule, Table 2-1 item 10: SRD 919–923 MHz at up to 500 mW EIRP, with no duty-cycle condition.
  - The neighbours 916–919 and 923–924 MHz need a duty cycle below 1%, frequency hopping or LBT.
  - The 2 W ERP row is RFID.
- Paragraph 4(a)(viii) requires certified, labelled devices in class-assignment bands. This applies to 433–435 MHz too, and the home-built board is not certified.
- The user read this and asked for the test ("改固件测试").

**Firmware:** `firmware/PixMobRFTest/`, build `.arduino/rf-922-test-build/`, SHA256 `75049e2cfabb3026b5a80b7c8bb9b466d5d9ec6ab16d92ac636b6999b9520a40`.
- New `PixMobRFLimits.h` allows only 433.10–434.70 MHz and 919.10–922.90 MHz, each at least 0.1 MHz inside a Malaysian SRD band, at most 10 dBm.
- PATABLE values come from TI SWRS061I Table 39 (multi-layer inductors), the 433 MHz or 915 MHz column by band. 10 dBm is 0xC0 in both; 0 dBm is 0x8E in the high band. Changing the frequency switches the value.
- Other registers unchanged: SmartRC's `Calibrate()` uses TEST0 0x09 and the high VCO both above 430.5 MHz and at 900–928 MHz.
- Host test `tests/rf-limits.cpp`: 8 allowed and 21 refused frequencies, 12 PATABLE values.
- On the board: `F923` was refused. `F922.36` gave word 0x2379B3 (922.360 MHz). `P0` gave PA 0x8E and `P10` gave 0xC0. The register readback matched.

**Board:**
- Before: `beat-effects-build` verified on the board (digest matched) as the restore point. IR `#R3000` lit red (user).
- The test build was written at `0x10000` / 57,600 baud and verified (digest matched).

**Runs:**
- All at 10 dBm with `Z`: 35 s of the published "nothing" frame, then 5 s of the published red frame, one frame every 50 ms.
- Every run: GDO0 wire OK, 700 + 100 frames, worst edge ≤5 µs late, TX monitor in TX before every checked frame.

| Run | Frequency | Band to antenna | User |
| --- | --- | --- | --- |
| 1 | 922.360 MHz | about 30 cm | lit red |
| 2 | 922.360 MHz | about 1 m | lit red |
| 3 | 922.360 MHz | about 3 m | lit red |
| 4 (control, about two minutes after run 3) | 433.920 MHz | about 30 cm | did not light |

Afterwards `beat-effects-build` was written back and verified (digest matched), and the banner showed `PIXMOB BEAT CONTROLLER READY!`. IR `#R3000` lit red (user).

**Reading**
- **The band receives near 922.36 MHz.** Only the frequency changed between the runs: same band, battery, board, antenna, frames and power setting.
  - At 922.36 MHz the band lit at 30 cm, 1 m and 3 m.
  - At 433.92 MHz it did not light at 30 cm (run 4). Earlier today it lit only within about 2–3 cm.
  - This matches the LH-family calculation for N = 34 (922.362 MHz) and lies inside Malaysia's 919–923 MHz SRD band.
- The 2–3 cm response at 433.92 MHz was most likely the strong near field reaching the band, not a receiver tuned there.
- **3 m is a lower bound.** This board is matched for 433 MHz, so its output at 922 MHz is lower by an unmeasured amount, and nothing farther was tried.
- **Not shown:**
  - the exact centre frequency or bandwidth (922.360 MHz was the only high-band frequency tried);
  - range beyond 3 m;
  - colours other than the published red at 922 MHz;
  - the receiver chip.
- One trial per row, user observation only; no video and no radio capture.

All **178 automated tests** passed. Logs are in `.arduino/rf-wake-test-run/`:
- `rf922-verify-before`, `rf922-ir-before`
- `rf922-upload`, `rf922-status`
- `rf922-run1` to `rf922-run3`, `rf922-run4-control433`
- `rf922-restore`, `rf922-ir-after`

## RF copy in the beat controller — 20–21 November 2026 (singles light when the band is awake; IR+RF looks like IR alone)

The user asked for IR and RF to light at the same time ("我要做RF 和 IR 同一时间亮") and chose: the controller itself sends every light by IR and 922 MHz RF, built from the current source (with the power-on/idle rainbow and breathing). The certification condition in the 922.36 MHz entry above still applies; the user knew it.

**Firmware** (`firmware/PixMobBeatController/`, new `RfPlan.h`; `PixMobRFFrame.h` and `PixMobRFLimits.h` are byte-for-byte copies of the bench sketch's, checked by a test):
- Every IR light frame also goes out as a PixMob RF frame at 922.36 MHz, 10 dBm, with the same seven fields as the 9-byte IR command (mode 0, group 0). The quick flash, which has no envelope fields in IR, uses RF codes 0 / 480 ms / 32 ms. RF and IR frames end together: the IR frame starts up to 19 ms after the RF waveform.
- Each RF frame is sent up to 3 times, 50 ms apart start to start, as long as each copy arrives while the band still shows the frame at full strength and before the job's next frame. A quick flash gets 3, a 0.1 s light 2, a strobe flash 1. Auto's three repeats get one each. A newer command or Stop ends the copies.
- The command is acknowledged after the IR frame and the first RF frame, before the copies.
- Between commands: three "nothing" frames every 2 s (`@RK<ms>`: 0 or 200–60000, kept by the board), none while a light may still show. 35 s of "nothing" at power-on, on `@R1` and on `@RW`.
- `@R1` / `@R0` switch RF on or off (kept by the board). Status lines: `RF: ON|OFF`, or `RF: NOT FOUND` / `RF: ERROR GDO0 WIRE|RMT|SETUP` with IR only; then `RF CARRIER`, `RF KEEP AWAKE`, `RF FRAMES n SENT m FAILED`.
- Host tests `tests/rf-plan.cpp` (fields equal the IR command for 48 frames, alignment, GDO0 waveform for 2000 random frames, copy rules for every envelope and spacing, keep-awake schedule incl. the `millis()` wrap) and `@R` parsing in `tests/light-command.cpp`.

| Build | SHA256 | Bytes | What changed |
| --- | --- | --- | --- |
| `beat-rf-build` | `25d01348b15f791e2f01f831b78d69742220d359a1238e490826db5952e4b1fe` | 355,584 | one RF frame per IR frame |
| `beat-rf-copies-build` | `6420d942c372242e72b13aefd48d8700211d7e49c095cf5c8f0de7c4260c8af8` | 356,368 | 3 copies; keep-awake in bursts of 3 |
| `beat-rf-ack-build` | `2355930ad9d639af54e8b817f8b7da33acd7d1bff1f1698de211f712a287f0c5` | 356,416 | acknowledgement before the copies; **on the board** |

Each was written after `verify-flash` of the previous image matched (the first over `beat-effects-build`), and verified after writing. Boot showed `RF: ON`, `RF CARRIER: 922.36 MHz 10 dBm`. All logged runs: 0 RF frames failed.

**Runs, IR blocked** (user observation; until run c1 "finger or box", from c2 the user reported an opaque object):

| Run | Build | Sent | User |
| --- | --- | --- | --- |
| u1 | rf | after boot: `#R3000`, `.G`, `!B2000`, `~4000` | strobe and rainbow lit; red light and green flash did not |
| u2 | rf | `@RK200`, 35 s wake (idle rainbow from 14 s), `.G`, `.R`, `#B3000` | only the blue light (2 frames) |
| u3 | rf | `#G100` (1 frame), then Auto, 3 frames per colour 80 ms apart | single frame did not light; all 5 Auto colours lit |
| — | copies | idle rainbow running | band showing the rainbow |
| c1 | copies | after boot: 33 s "nothing" wake, then `.G .R #G100 .B .Y` with copies | "看着，但都没亮" |
| c2 | copies | RF off: IR rainbow 10 s; RF on after 14 s off: 3 s wake + RF rainbow 10 s | asked to repeat |
| c3 | copies | same as c2 | neither segment lit |
| c4 | copies | 30 s rainbow, `.G`, 10 s quiet, rainbow 18 s, `.R`, 5 s quiet, `.B` | rainbow, green, red and blue all lit |
| c5 | copies | 28 s rainbow, 90 s quiet (keep-awake bursts), `.G`, `.R` | rainbow, green and red lit (on-screen seconds counter) |

**IR unblocked, c6:** `.G`, `#R1000`, `!B1000` with RF on, then the same with `@R0`: "两段看起来一样" (no extra or longer flashes). Music mode with claps did not trigger: all 268 level samples were 0, and the user then said the **INMP441 has been removed**. The earlier RF-on/off microphone comparison (`beat-rf-run/mic-interference`, level 0 throughout) therefore says nothing about RF interference.

**Acknowledgement delay** (automatic, Host beats 300 ms apart, `X` included): `beat-rf-copies-build` 150–160 ms for every beat; `beat-rf-ack-build` median 50 ms (12 of 13 at 50–60 ms, one 100 ms while a wake frame was on air). The website sends a browser beat only after the previous one is acknowledged and serializes all commands on acknowledgements, so 150 ms would have held up fast beats and cues.

**Reading**
- With the band awake, single RF commands sent as 3 copies lit 5/5 (c4, c5), including after 5 s and 90 s of quiet with keep-awake bursts every 2 s. Single RF frames without copies lit 0/5 (u1–u3), but the band's wake state in those runs is not known, so the copies are not proven necessary.
- Control: with RF off and IR blocked, the rainbow did not show (c2, c3), so the RF-only results are not IR leakage.
- After 14 s with RF off, 13 s of RF did not bring a response (c3), in line with the published aggressive sleep (up to ~30 s of frames to wake). c1 is not explained: after a 33 s "nothing"-only wake no single lit, while c4 and c5 began with about 30 s of rainbow frames. Whether this controller's "nothing" wake alone wakes a sleeping band is open.
- With IR and RF together the band looked the same as with IR alone (one comparison).
- Not measured: how late an RF-only band lights compared with IR (0–100 ms, depending on which copy it takes), range from the controller, more than one band, the copy count actually needed.
- The idle rainbow (`@I`, set to 10 s) now also goes out by RF, so an idle, powered board keeps lighting any band in range.

`npm test`: 181 pass (adds the RF plan, limits and serial-protocol RF tests). Logs: `.arduino/beat-rf-run/`, `.arduino/beat-rf-copies-run/` (`c1`–`c7`), `.arduino/beat-rf-ack-run/`.

**Website** (not deployed): reads the RF lines; the preset panel shows the carrier, an "RF copy of every light" on/off choice (`@R1`/`@R0`) and, while on, "Wake wristbands (35 s)" (`@RW`); a radio fault shows why with IR still usable. `Status.rfSupported` is true only for a working radio. Checked by `tests/presetSerial.test.ts` and a render of the panel in the three states; not yet tried with the board connected.

**Deployment attempt (21 November 2026):** the user said to deploy without first trying the RF controls with the board. All 181 tests and the production build passed; only `index.html`, one script and one stylesheet were uploaded, as before. Netlify did not publish them: deploy `6b00d381af5c600ed1fa3e23` is in state `error` with "Skipped due to account credit usage exceeded". The PixMob team is on the Free plan. **The live site is unchanged (last deploy `6af96a7e02fc27e8919b6e71`, without the RF controls).** The RF controls work only on a local copy of the site (`npm run dev`) until the credit resets or the plan changes.

**Website RF controls with the board (21 November 2026, local `npm run dev` in the user's Chrome; the built-in app browser refuses the Web Serial port chooser):** the preset panel showed "RF copy of every light: On (IR and RF)" read from the board. User observation, IR emitter covered, one try each: switched to Off (IR only), the "RF setting saved" toast appeared, then Red did not light; switched back to On, then Red lit at once. "Wake wristbands (35 s)" was acknowledged by the board (the green toast; its wording read like a failure and was changed to "Wake started: …"). Whether that wake wakes a *sleeping* band was not tested: the idle rainbow (set to 10 s) started by itself about 8 s after the last command and lit the band over RF, so the band never slept; afterwards Red lit. **New user observation:** during a rainbow the RF-only band goes dark for about 1 s (user has a video; not yet seen, cause not yet known: a missed run of RF frames on the board or reception at the band, e.g. a phone nearby, are both open). `npm test` 181 pass after the wording change.

**RF rainbow drop-out, user video (21 November 2026):** the user reported that during a rainbow the RF band goes dark for about 1 s and sent a 5.1 s video (480×360, 24.45 fps; copy and analysis in `.arduino/rf-rainbow-video-2026-11-21/`). Two bands are in view; the lower one is taken to be the RF-only band (the user's description; not stated in the video). Frame-by-frame brightness of each band (AVFoundation frame grab, top 1 % pixels per band region): the **lower band goes fully black once per 3 s rainbow cycle, at the same hue each time** — 1.79–1.91 s and 4.83–4.91 s, 3.04 s apart, roughly 0.1–0.2 s each, at the magenta-to-red turn. The upper band stays lit throughout. Everything else in the cycle lights on both.

What was checked (offline, no hardware):
- The 25 RF frames of a 3 s cycle (`rainbow-rf-frames-3s-cycle.txt`) have nothing unusual on air: longest runs 4 zero bits / 2 one bits, 56–64 level changes, all within the RMT buffer.
- `kLineCode` and the CRC12 equal the public sueppchen library (`pixmob_cement.h`), and our CRC equals the listed checksum for **all 63,917 frames** its brute-force lists (`colorBrute/blue_0.list`, `blue_1.list`) mark as accepted by a band.
- The same lists mark 1,619 combinations (2.5 %) that a band never accepted with any checksum, two thirds of them ending in CRC field 5 or 63. The frames around magenta (cycle 2400 and 2520 ms; 2520 is the only frame using line-code entry 29) are not in that class. That data is from 868 MHz bands with other timing fields, so it neither confirms nor rules out our frames.
- Earlier bench runs counted 0 failed RF frames (for example 737 sent, 0 failed), so a board-side send failure is unlikely but was not measured during this rainbow.

**Reading:** most likely the band does not take one (perhaps two) particular frames of the cycle, and the 192 ms hold of the frame before does not bridge the gap. Not proven; the exact frame and the band's RF hold times are unmeasured. A possible fix is a longer RF hold for rainbow frames, so that a frame the band ignores leaves no gap. It is neither built nor flashed.

## IR only / RF only per light, and a longer RF rainbow hold — 21 November 2026

The user asked to choose on the website which transmitter lights the bands — both, RF only or IR only — including per cue in a song show. They then chose to flash it together with the rainbow fix proposed above.

**Firmware** (`firmware/PixMobBeatController/`):
- `@R1` / `@R0` / `@R2` set what every light goes out by: IR and RF, IR only, RF only. The board keeps the setting (`rfmode`, plus the older `rf` key). IR only sends no RF at all, keep-awake included. A setting with RF wakes the bands for 35 s.
- A flash, timed light, strobe, build or rainbow line may end in `/I`, `/R` or `/B` to override the setting for that light only, e.g. `#R1500/R`.
- Each job carries its own output (`TxJob.output`), so a later setting never changes a light already running. A cut on Stop goes out the way the light did. RF asked for without a working radio sends nothing by RF.
- With RF only, the RF frame goes out at once and the IR emitter stays dark.
- The banner adds the exact line `LIGHT OUTPUT: READY`; `RF: ONLY` is the new state line.
- **Rainbow:** the RF copy of each rainbow frame now has sustain code 4 (480 ms) instead of 3 (192 ms); IR is unchanged (`RAINBOW_RF_SUSTAIN_CODE`, RainbowPlan.h). This should bridge one or two frames the band does not take. RF bands show the end of a rainbow about 0.3 s longer. Assumes the RF hold codes mean the same times as IR; not measured.

**Website:**
- ESP32 live control: "Lights go out by: IR and RF / IR only / RF only". RF only is offered only with `LIGHT OUTPUT`. The wake button shows whenever the setting includes RF.
- Song shows: each cue has an Output choice. Board setting (the default, not saved in the cue) / IR + RF / IR only / RF only is saved with the cue and kept in show files. A cue with its own output is sent as the custom line command with the ending.
- Firmware without `LIGHT OUTPUT` gets the cue by the board setting, and the page says so. The adapter refuses RF only and endings on such firmware, and refuses an RF-only light without a working radio.

**Tests:** 183 pass. Added:
- the parser's endings and `@R2`;
- the RF rainbow hold;
- the adapter writing `#R1500/R`, `.G/I`, `!B2000/B`, `~5000,3000/R`, `#=844000900/I` and `@R2`, with old-firmware refusals;
- song cues sending and saving their output.

`npm run build` passes. The cue row was checked in the local browser at narrow and wide widths.

**Build and flash:** `.arduino/beat-rf-output-build/`, 357,040 bytes, SHA256 `cc1acc7d588fa05f93e232aee6aaf53ad5038393a2b30bd08e9424eaab0a0ae1`. The user disconnected the page first. The board was verified against `beat-rf-ack-build` (digest matched, the restore point). The new build was written at 0x10000 / 57,600 baud ("Hash of data verified") and verified again (digest matched). Logs: `.arduino/beat-rf-output-run/`.

**Serial check (`serial-check.log`; receipts only, nothing observed on a band):**
- The banner lists `LIGHT OUTPUT: READY` and `RF: ON`.
- `#R1500/R` → `Light: R 1500`; `.G/I` → `Flash: G`; `!B1000/B` → `Strobe: B 1000`; `~3000,3000/R` → `Rainbow: 3000 3000`.
- `#Y600/X` → `LIGHT REJECTED`; `@R3` → `BEAT SETTING REJECTED`.
- `@R2` → `RF: ONLY`; `.C` → `Flash: C`; `@R1` → `RF: ON` (left so).
- 172 RF frames sent, 0 failed.

The website changes are local only; the live site is unchanged (Netlify credit).

**User observation after flashing (21 November 2026, local website in the user's Chrome, IR emitter covered; the user's "全都对" to the three steps asked, one try each, no video):**
1. "Lights go out by: IR only", then Red: not lit.
2. "RF only", then Red: lit.
3. A rainbow: the RF band no longer went dark at the magenta turn.

The user was asked to switch back to "IR and RF" afterwards; the board's setting was not read back. A song cue's own Output has not been watched on a band yet.

**Board default set back to IR and RF (21 November 2026):** the user asked for IR and RF as the board's default and disconnected the page. Over serial the board booted with `RF: ONLY`, the RF-only choice left from the user's test. `@R1` answered `RF: ON`. After another reset the banner read `RF: ON` (logs `set-default-ir-rf.log`, `after-reset-check.log` in `.arduino/beat-rf-output-run/`). Song cues left at "Board setting" now go out by IR and RF. A board without a saved choice also starts with IR and RF.

**Idle rainbow turned off (21 November 2026):** the user reported that after the music stopped, RF did not "sleep". Asked what was seen and what was wanted, they answered "the band is dark but RF is still sending" and chose to turn the idle rainbow off, keeping the RF keep-awake. Over serial `@I0` answered `IDLE RAINBOW: OFF`; after a reset the banner read `IDLE RAINBOW: OFF`, `RF: ON`, `RF KEEP AWAKE: 2000`, and no rainbow started (logs `idle-rainbow-off.log` and `idle-off-reset-check.log` in `.arduino/beat-rf-output-run/`). So after Stop nothing lights by IR or RF. Unchanged: RF still sends three black "nothing" frames every 2 s while nothing shows (and a 35 s wake at power-on), so RF bands stay awake but dark. `@RK0` would stop the periodic frames, keeping only the wakes, but bands would then fall asleep about 15 s after the last RF frame. Not done.

## 2026-11-21 — RF keep-awake stops 5 minutes after the last light (`beat-rf-sleep-build`)

**Request:** after the idle rainbow was turned off, the user asked "IR也能睡眠？" and "必须等30秒？", then "也停 RF 保活，然后设5分钟才睡眠": stop the RF keep-awake as well, but only after 5 minutes.

**Change (`RfPlan.h`, `RF_SLEEP_AFTER_MS = 300000`):**
- The "nothing" keep-awake frames (3 every 2 s) now go out only until 5 min after the last light ends (whole envelope plus the 300 ms margin) or after a wake ends. A boot wake therefore keeps the bands awake for 35 s plus 5 min.
- After that the controller sends no RF at all, so RF bands fall asleep, about 15 s later by the 20 November observation.
- The first light after that starts a new 35 s wake by itself (`rfLightSent` → `rfStartWake`). Bands that are asleep miss the lights of the first seconds, up to about 30 s. IR is unaffected.
- `@RW`, `@RK<ms>` and the `@R` choices work as before. A choice with RF still wakes the bands, and that wake also counts as "last activity".
- The banner and every RF status print add the exact line `RF SLEEP AFTER: 300 S`. The help adds "RF bands are left to sleep 5 min after the last light; the next light wakes them".
- **Website:** the adapter parses the line into `rf.sleepAfterS`. The RF summary on the ESP32 panel says the bands are kept awake for 5 min after the last light, then left to sleep, and that the next light wakes them again (RF-only bands may miss up to about 30 s).

**Tests:** 183 pass (`npm test`). The `rf-plan.cpp` keep-awake blocks were rewritten:
- nothing goes out before the first wake or light;
- the bands are left to sleep at the wake's end plus 5 min, and with interval 0 only the wake goes out;
- a light keeps the bands awake for 5 min after its end, and a long light counts from its end;
- the next light after that starts a wake, but no wake starts while the bands are still kept awake;
- millis wrap.

The adapter test parses `RF SLEEP AFTER` and rejects malformed lines. `npm run build` passes.

**Build and flash:** `.arduino/beat-rf-sleep-build/`, 357,312 bytes (357,164 program bytes), SHA256 `31c2184a0cd59cff8633c2600a03995ed270542bc406a86278b41a63301b079d`.
- The user disconnected the page and chose to flash and test.
- `verify-flash` matched `beat-rf-output-build`, which is the restore point.
- The new build was written at 0x10000 / 57,600 baud ("Hash of data verified") and verified again (digest matched).
- Logs: `.arduino/beat-rf-sleep-run/`.

**Serial check 1 (`serial-check.log`; frame counters only, nothing observed on a band). Disturbed, so it shows neither the stop nor the wake.**
- Banner: `LIGHT OUTPUT: READY`, `IDLE RAINBOW: OFF`, `RF: ONLY`, `RF KEEP AWAKE: 2000`, `RF SLEEP AFTER: 300 S`.
  - `RF: ONLY` was already saved on the board before this flash. The earlier check had read `RF: ON`, so RF only was chosen from the page in between.
- `RF FRAMES` (probed with `@RK2000`, which only stores the same interval and prints):

  | Time (s) | Frames |
  | ---: | ---: |
  | 8.2 | 141 |
  | 60.3 | 746 |
  | 90.3 | 791 |
  | 320.4 | 1137 |
  | 345.4 | 1173 |
  | 390.4 | 1242 |
  | 396.5 | 1251 |
  | 436.6 | 1311 |
  | 446.6 | 1326 |

  0 failed. The boot wake ran at about 20 frames/s; after it, about 1.5 frames/s (3 every 2 s) all the way to 446.6 s.
- **Disturbance:** at 145.7 s, fragments of a status print appeared. At 147.7 s, `Color sent: R` appeared. The script sent neither: they match the page's connect handshake (stop, which prints the status) and a preset Red. The script had not opened the port exclusively, so the page could open it at the same time and the two readers split the output.
- By design that Red kept the bands awake until about 448 s. The script's own `.R` at 391.5 s (`Flash: R`; 9 frames in the next 5 s, no wake, as expected while kept awake) extended it to about 692 s.
- So the log ended before any expected stop. The stop after 5 min and the wake on the next light are **not verified on the board** by this run. They are covered only by the host tests.

**Serial check 2 (`serial-check-2.log`, same day; frame counters only, nothing observed on a band):**
- The user chose to re-test and to set the board back to IR and RF.
- The script now held the port exclusively (`TIOCEXCL`), so the page could not open it meanwhile. No line appeared that the script did not ask for.
- Banner: `RF: ONLY`. `@R1` at 8.2 s answered `RF: ON`; as a choice with RF it restarted the 35 s wake, so the stop was expected at 8.2 + 35 + 300 ≈ 343 s.
- `RF FRAMES`:

  | Time (s) | Frames | Reading |
  | ---: | ---: | --- |
  | 8.2 | 141 | Wake. |
  | 60.3 | 879 | Wake to about 43 s. |
  | 90.3 | 924 | +45 in 30 s: keep-awake, 3 every 2 s. |
  | 330.3 | 1284 | +360 in 240 s: still kept awake. |
  | 355.4 | 1305 | +21: the last bursts, up to about 343 s. |
  | 400.4 | 1305 | **0 in 45 s: no RF at all.** |
  | 401.4 | — | `.R` (`Flash: R`). |
  | 406.4 | 1390 | +85 in 6 s: the light and **a new wake started by itself**, about 20 frames/s. |
  | 440.5 | 2004 | +614 in 34 s: wake until about 436 s. |
  | 450.5 | 2020 | +16 in 10 s: back to keep-awake. Expected to run until about 736 s. |

  0 failed.
- So on the board, the keep-awake stopped 5 min after the wake ended, and the next light restarted the wake and the keep-awake.
- **Not checked:**
  - that the bands actually fall asleep, or how many lights a sleeping band misses (needs eyes or video);
  - the stop after a light, as opposed to after a wake. A light uses the same `rfKeepUntil`, and the host tests cover it.
- **Readback after a reset (`ir-rf-reset-check.log`):** `IDLE RAINBOW: OFF`, `RF: ON`, `RF KEEP AWAKE: 2000`, `RF SLEEP AFTER: 300 S`. The board is left with IR and RF; its boot wake runs again and stops after 35 s + 5 min.

**User report after the 5-minute sleep (21 November 2026): "RF又不亮了".** User observation in the local page (board `beat-rf-sleep-build`, IR+RF, IR covered on the band, one try each, no video):
- No light had been sent for more than 5 min, so the keep-awake had stopped and the band was left to sleep.
- "Wake wristbands (35 s)", then Red after about 40 s: not lit. A 40 s RF rainbow, then Red: not lit ("怎样点击都不亮").
- IR uncovered, Red: lit, so the band has power.
- IR covered again, a 120 s RF rainbow: **the band started changing colour partway through** (the second was not given).

**Reading:**
- The RF transmitter works. A band that has slept for a while (here about 10 min or more) needs more than about 40 s of continuous frames to wake. The published figure of up to about 30 s does not hold for it. Under 120 s woke it this once.
- So the automatic 35 s wake on the next light, and the 35 s wake button, do not wake such a band. After a sleep, RF bands stay dark until a longer run of frames.
- Whether "nothing" frames alone can wake a deeply sleeping band is still not known: the 35 s nothing wake was too short either way.

## 2026-11-21 — RF sleep becomes a setting, never by default (`beat-rf-sleep-setting-build`)

**Request:** given the finding above, the user chose "板子通电时不睡". While the board is powered the bands are kept awake. The sleep stays available as a setting that is off by default.

**Change:**
- **Firmware (`RfPlan.h`):** `RfKeepAwake.sleepAfterMs` replaces the fixed 5 minutes.
  - `RF_SLEEP_NEVER` (0, the default): once woken, the bands are kept awake for good.
  - Otherwise they are left to sleep that long after the last light or wake.
  - `rfSetSleepAfter` applies a change. While the bands are kept awake, the new time counts from now, or from the end of a running wake or light. Bands already left to sleep stay so until the next light or wake.
- **`@RS<s>`:** 0, or 60–86400 s, no leading zeros. The board keeps it under NVS key `rfsleep`; builds without the key read it as never.
- **Status lines:**
  - `RF SLEEP AFTER: OFF` or `RF SLEEP AFTER: <s> S`.
  - The new capability line `RF SLEEP SETTING: READY`.
  - The help lines name `@RS` and say that bands which have slept can need 1–2 min of RF to wake.
- **Website:**
  - The adapter reads `OFF` as 0, sends `rfSleep` `{seconds}` as `@RS<s>`, and refuses it on firmware without the capability line.
  - The RF part of the ESP32 panel adds "Wristbands sleep": Never while the board is on / 5 min / 30 min / 1 h after the last light.
  - The RF text no longer says about 30 s wakes a sleeping band. It now says a band that has slept a while can need 1–2 min of RF, and that a long rainbow does it.
  - The panel was rendered with react-dom/server for three reports and showed:
    - never: the choice, and "kept awake while the board is powered";
    - 30 min: the sleep text;
    - the previous `beat-rf-sleep-build` (300 S, no capability line): no choice, and the 5 min text.

**Tests:** 184 pass. Added:
- `@RS` parse cases;
- the keep-awake plan: never by default (still kept 10 h later); the old 5-minute cases with a sleep time set; changing the time during a wake, while kept awake, and after the bands were left to sleep;
- adapter parsing of `OFF` and the capability line;
- a rig test writing `@RS300` and `@RS0`, with refusals for invalid payloads and old firmware.

`tsc` and `npm run build` pass.

**Build and flash:** `.arduino/beat-rf-sleep-setting-build/`, 357,760 bytes (357,604 program bytes), SHA256 `7bdc6967d51099f2fa0596e9bfb597db5eab4895097c3514f330b1e0a58c6c11`.
- The user disconnected the page.
- `verify-flash` matched `beat-rf-sleep-build`, which is the restore point.
- The new build was written at 0x10000 / 57,600 baud ("Hash of data verified") and verified again (digest matched).
- Logs: `.arduino/beat-rf-sleep-setting-run/`.

**Serial check (`serial-check.log`, port held exclusively; frame counters only, nothing observed on a band):**
- Banner: `RF SLEEP SETTING: READY`, `RF: ON`, `RF SLEEP AFTER: OFF`, `IDLE RAINBOW: OFF`.
- `RF FRAMES`:

  | Time (s) | Event or frames | Reading |
  | ---: | --- | --- |
  | 6.2 | `@RS60` → `RF SLEEP AFTER: 60 S`; frames 100 | During the boot wake, so the 60 s count from the wake's end, about 36 s. |
  | 90.3 | 790 | |
  | 105.3 | 801 | The last bursts, up to about 96 s. |
  | 130.3 | 801 | **0 in 25 s: stopped.** |
  | 131.3 | `@RS0` → `RF SLEEP AFTER: OFF` | |
  | 135.4 | 801 | Still nothing: bands already left to sleep stay so. |
  | 136.4 | `.R` (`Flash: R`) | |
  | 140.5 | 866 | The light and a wake. |
  | 240.5 | 1599 | The wake to about 171 s, then keep-awake. |
  | 250.6 | 1614 | +15 in 10 s, **79 s after the wake ended**, where a 60 s time would have stopped it. |

  0 failed.
- **Readback after a reset (`reset-check.log`):** `RF SLEEP SETTING: READY`, `IDLE RAINBOW: OFF`, `RF: ON`, `RF SLEEP AFTER: OFF`. The board is left with no sleep, IR and RF.
- **Not checked:**
  - keep-awake over hours with OFF (covered by the host tests);
  - the new choice in the page with the board connected;
  - whether the bands, possibly asleep again after about a minute without RF during the flash, need a long rainbow to wake.

**User follow-up (21 November 2026): "有亮了，只是电池没电".**
- The RF band lit again. The user puts the earlier failure down to a flat battery; when and how this was found was not stated.
- The batteries had been replaced on 20 November.
- **So the reading above, that a band which has slept needs more than about 40 s of RF to wake, was made with a weak battery and may not hold for a band with a good one.**
- IR still lit the band then, so a weak battery may affect RF reception first. This is a guess and was not tested.
- Open: whether a band with a good battery wakes, after a sleep, from the 35 s wake on the next light.
- The board stays at no sleep, the user's choice. The "Wristbands sleep" setting allows a re-test.
- Keeping the bands awake keeps their RF receivers on. That costs battery, and these batteries lasted about a day.

## 2026-11-21 — IR and RF band timing, user video (`IMG_8740.MOV`)

**Question (user):** "左边是IR 右边是RF，左慢还是右快". In the video the left band is IR and the right one RF.

**Video and scene:**
- 5.5 s, HEVC, stored as 3840×2160 and rotated 90° for playing (2160×3840 portrait). 59.78 fps nominal; 329 frames 16.73 ms apart. Created 21 Nov 2026 23:08 local.
- A local Song shows page is playing behind the bands. Cues about 0.7 s apart change colour.
- Copy (SHA256 equal to the original), per-frame data, tools and sheets are in `.arduino/ir-rf-timing-video-2026-11-21/`.

**Method (offline, no hardware):**
- Every frame was decoded in order with AVAssetReader (`readframes.swift`).
- Each band has a region in stored pixels: RF `1707,0,570,960`, the upper band in storage; IR `1671,1209,711,951`, the lower band.
- Per region, the mean luma of the brightest 1 % was taken. Lit LEDs saturate at about 241–243; light spilling from the other band stays below about 130.
- A band counts as lit at ≥ 200 (`edges.py`).
- The played orientation was checked: at 0.50 s and 1.25 s only the right-hand band is lit, and the right-hand band is the upper one in storage, so the regions are the right way round.

**Result** (`on-off-per-light.txt`): 8 lights, every one a quick flash:

| Light | Band | On | Off | Lit |
| ---: | --- | ---: | ---: | ---: |
| 1 | IR | 0.150 | 0.385 | 235 ms |
| 1 | RF | 0.150 | 0.668 | 518 ms |
| 2 | IR | 0.853 | 1.070 | 217 ms |
| 2 | RF | 0.853 | 1.355 | 502 ms |

Lights 3–7 are the same within one frame. Light 8 is cut off by the end of the video.

- **Start: both bands light in the same frame every time** (RF − IR = 0 at 16.7 ms frame resolution). Rolling shutter can shift the two regions by up to about half a frame readout, less than 10 ms, with the sign unknown.
- **End: the IR band is lit about 217–235 ms; the RF band about 502–518 ms.** RF goes dark 283–302 ms later every time.

**Reading:**
- Neither band is faster: they start together. The RF band stays lit longer.
- The firmware's quick flash sends IR as the 6-byte single-colour command. It has no envelope fields, so the band applies its own.
- The RF copy carries the nearest codes to the documented IR flash (`RF_FLASH_*` in `RfPlan.h`): attack 0, sustain 480 ms, release 32 ms, about 512 ms in all. The RF band's 502–518 ms matches that.
- The IR band's measured 217–235 ms is much shorter than the documented "about 384 ms" sustain.
- The code nearest to the measured IR flash is sustain 192 ms (code 3): 192 + 32 = 224 ms.
- Timed lights (`#…`) send the same codes by both IR and RF and were not in this video.
- The left band evidently did not take the RF copies. Had it done so, it would have stayed lit as long as the right one, through the 480 ms code and the copies.
- The colours cannot be compared: the LEDs are overexposed.

**Quick flash fixed (21 November 2026, `beat-rf-flash-build`):**
- The user added: "只有quick flash，RF会慢。其他模式正常". Only the quick flash lingers on RF; the other modes look the same on both bands.
- That fits the cause above. Only the quick flash has an IR command without envelope fields; the timed light, strobe, rainbow and beat lights send the same codes both ways.
- **Change:** `RF_FLASH_SUSTAIN` is now 192 ms instead of 480 ms, so the RF quick flash lasts 0 + 192 + 32 = 224 ms, close to the 217–235 ms measured for IR. A single quick flash still gets 3 RF copies.
  - In the video, the copies did not lengthen the RF light: 502–518 ms matches one 512 ms envelope.
- **Tests:** 184 pass. The flash case now checks 224 ms, and the keep-awake "showing" time of a flash is 524 ms.
- **Build and flash:** `.arduino/beat-rf-flash-build/`, 357,760 bytes, SHA256 `9a137a9e2ab918d3cd296406e93fec4d3f9cf39faa12dd7e9a5dab5481724709`.
  - The user disconnected the page.
  - `verify-flash` matched `beat-rf-sleep-setting-build`, which is the restore point.
  - The new build was written at 0x10000 / 57,600 baud ("Hash of data verified") and verified again (digest matched).
  - Logs: `.arduino/beat-rf-flash-run/`.
- **Serial check (`serial-check.log`):** the banner reads `RF SLEEP SETTING: READY`, `IDLE RAINBOW: OFF`, `RF: ON`, `RF SLEEP AFTER: OFF`. `.R` answered `Flash: R`; 110 RF frames sent (boot wake included), 0 failed.
- **Not yet seen on the bands:** whether the RF quick flash now goes dark together with the IR one.
- **User observation after the flash (21 November 2026; eyes, no video): "一样了".** The RF quick flash now looks as long as the IR one.

## 2026-11-21 — Second deployment attempt: skipped again (Netlify credit)

- The user asked "更新我的pizmob 网页吧".
- `npm test`: 184 pass. `npm run build` produced `index.html`, `assets/index-BT1QsYW-.js` and `assets/index-Cw3Pwhvg.css`; the script contains the RF sleep choice and the `RF SLEEP SETTING` reader.
- These three files, with `netlify.toml` (publish ".", no build command), were uploaded through the Netlify connector's `deploy-site` command from a clean folder.
- Netlify recorded deploy `6b01bd85ca01ca66e1aff42c` as `state: error`, `skipped: true`, "Skipped due to account credit usage exceeded". **The live site at pizmob-control.netlify.app is unchanged.** It still lacks the RF controls and the song-cue Output.
- The site's team "PixMob" is on the Free plan. The team record does not say when the credit resets; the Netlify dashboard's usage page does.
- The up-to-date page runs locally with `npm run dev`, in the user's Chrome.

## 2026-11-21 — Website moved to Cloudflare Pages

**Request:** with the Netlify credit used up, the user chose "换免费平台", a free host.

**Login and project:**
- `wrangler` 4.166.0 (`npx`) was not logged in. `wrangler login` opened Cloudflare's OAuth page in the user's browser; the user authorized it there, and the CLI reported "Successfully logged in".
- `wrangler pages project create pizmob-control --production-branch main` now hands Pages over to Workers. It failed for want of an assets directory and created nothing. With `--force`, as the CLI advised, it created the classic Pages project `pizmob-control`. Later commands no longer need `--force`.

**Deploy:**
- `wrangler pages deploy` of a clean folder with only the build uploaded 3 files: `index.html`, `assets/index-BT1QsYW-.js` and `assets/index-Cw3Pwhvg.css`. "Deployment complete", preview `d97108bb.pizmob-control.pages.dev`.

**Check:**
- **https://pizmob-control.pages.dev/** answered HTTP 200 with this build's `index.html`. The script it serves is byte-identical to `dist` (SHA256 `732027a7…80a0`) and contains "Wristbands sleep", `RF SLEEP SETTING: READY` and "Lights go out by".
- The preview address did not resolve yet at that moment.
- In the in-app browser the page rendered ("PixMob Studio — Lighting Console") with no console errors. Connecting the board was not tried there, because the in-app browser refuses the Web Serial chooser.

**Notes:**
- The old Netlify site still serves the older version.
- Shows, colours and lead time live in each address's own browser storage, so the new address starts empty. Export shows on the old address and import them on the new one.
- Pages serves `index.html` for unknown paths when the project has no `404.html`, as for a single-page app.

## 2026-11-25 — Findings posted upstream (sueppchen/PixMob_waveband #10)

**Request:** the user sent https://github.com/sueppchen/PixMob_waveband/issues and asked "帮我update 这个 project , IR+RF pixmob".

**Read first:** the project's 8 issues (#1, #3–#9) and README.
- In #7 the author wrote that the frequency is only a guess from integer multiples of the crystal.
- Library v0.2.1 (#6) has only EU 868 MHz and US 915 MHz.
- #9 (May 2026) asks about the CRC for a Tourmaline band.
- The last code push was 10 June 2024, so we opened an issue rather than a pull request.

**Posted:** the user read the full English draft and said "发吧". `gh issue create` from the user's logged-in GitHub account then opened [#10](https://github.com/sueppchen/PixMob_waveband/issues/10) (25 November 2026, 06:52 UTC). The posted body equals the approved draft.

**What #10 says:**
- the band markings, including the lot number;
- the 922.36 MHz result and its limits: eyes only, one try each, no SDR;
- the N = 34 crystal relation;
- 512 µs bits, and the wake and keep-awake results;
- the IR+RF timing and the quick-flash hold;
- the CRC check against 63,917 frames (re #9);
- the CC1101 registers, and that we send mode 0 / group 0 only.

**Personal details:** no name, email or country. The post only says 922 MHz is licence-free "where I am".

**Not done:** no pull request; no replies yet.

## 2026-11-25 — Public GitHub repository and GitHub Pages

**Request:** "https://pizmob-control.pages.dev/ 能放进我的github吗". I offered a private repository (recommended) or a public one served by GitHub Pages; the user chose "公开+Pages".

**Before publishing:**
- The 120 files Git would add (about 21 MB) were scanned. They hold no tokens or passwords, and no name or email of the user. `.gitignore` already keeps out `.arduino/`, `node_modules/`, `dist/` and `firmware/PixMobStudio/secrets.h`.
- Since the Cloudflare deploy (21 November, 23:55), another session had added the Song shows Cue pads on 23 November: `src/lib/cuePads.ts`, `SongShows.tsx`, `songShows.css`, `tests/cuePads.test.ts` and the README.
- `npm test`: 187 pass, 0 fail. The production build passed.
- The commit author is set for this repository only (`git config --local`): `ximloke` with GitHub's noreply address, so the Gmail address and real name are not published.

**Published:**
- `gh repo create ximloke/pixmob-studio --public`, then GitHub Pages turned on with build type "workflow".
- First commit `658dc20` on `main` (the unborn `master` branch was renamed), pushed to `origin`.
- `.github/workflows/pages.yml` runs Node 22, `npm ci`, `tsc -b` and `vite build --base=/pixmob-studio/`, then uploads and deploys.
  - Actions used: checkout v7, setup-node v7, configure-pages v6, upload-pages-artifact v5 and deploy-pages v5. Each was released at least six weeks before.

**Check:**
- Run 45565071823: build and deploy passed.
- https://ximloke.github.io/pixmob-studio/ answers HTTP 200, and its script and stylesheet load from `/pixmob-studio/assets/`.
- The served script is byte-identical to a local build with the same base. It contains "Wristbands sleep", "Lights go out by" and "Cue pads".
- In the in-app browser the page rendered with no console errors, in a secure context, with `navigator.serial` present. The board was not connected there.

**Notes:**
- The Cloudflare copy is still the 21 November build, without Cue pads.
- Each address keeps its own browser storage.
- Every push to `main` redeploys the GitHub Pages site. These notes and the README went out as a second commit.
