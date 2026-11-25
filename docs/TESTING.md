# Testing procedures

Keep simulated behavior, transport validation and physical compatibility results separate in the test record. A successful API response is not proof that a wristband changed state.

## Frontend and simulator

1. Run `npm install`, `npm test`, and `npm run build` from the repository root.
2. Start `npm run dev`. Open the printed localhost URL at desktop, 390 px iPhone and 412 px Android viewport widths. Check that navigation, controls and dialogs are reachable without horizontal scrolling.
3. In Simple Mode, change HEX, RGB and color swatches. Confirm the preview color updates. Enter invalid HEX, then leave the field; confirm it restores a valid color.
4. Test Solid, Flash, Fade, Strobe and Rainbow. Brightness 0 must extinguish the illuminated face. Pause must freeze the preview; Play resumes. Strobe is a visual simulation capped at 3 Hz and may be unsuitable for people sensitive to flashing.
5. Select each artist profile. Confirm the wristband label changes while hardware capability status remains unchanged.
6. Enable Music Sync with demo audio. Confirm brightness follows the synthetic pulse. Open Advanced DJ mode; the demo is explicitly marked and reads 120 BPM.
7. Save a custom scene, refresh, load it and verify its settings. Delete it. Export custom scenes and inspect the JSON. Browser storage is per origin/browser, not cloud sync.
8. Choose Microphone, grant permission and test silence, speech, a steady tone and music. Verify spectrum and frequency-band response. Beat/BPM/drop results are heuristics: record false positives, uncertain tempo and failures in quiet/complex music rather than expecting studio-grade measurements.
9. Deny microphone permission and stop the browser sharing indicator. Confirm the app reports a useful state and capture stops. Check that microphone tracks are released when switching sources or pressing Stop.
10. On a browser offering shared audio, choose System / browser tab audio. Test a tab with audio enabled, then a video-only share. Video-only capture must be rejected and tracks stopped. On iPhone/Android or browsers lacking capture support, verify the limitation is explained.

## Derived beat controller and device-follow preview

Use `firmware/PixMobBeatController/` as a separate derived source; keep `firmware/PixMobPresetSerial/` unchanged. Both use **Preset controller (your sketch)**, IR GPIO32 and microphone GPIO26/25/27. The derived firmware reports `PIXMOB BEAT CONTROLLER READY!` and `AUDIO FORMAT: BASS ENVELOPE 16-BIT`.

1. Run the host-side detector tests and frontend tests/build. Six synthetic detector scenarios have passed; keep those software results separate from physical music and receiver tests. Confirm the supplied timing arrays and carrier remain unchanged and no repeating timer generates Music-mode beat events.
2. Before an authorized upload, preserve the actual prior flash and record its hash. The prior RGB-only 4 MB backup from this session is `.arduino/backups/2026-11-11-before-music/esp32-rgb-full.bin`, SHA256 `a4b9a566ab344ff256953f36da423f6e4ef6c7c3c1502b5d05c8eda722d9837f`, private file mode 600. Keep full-flash backups out of source control and public output.
3. Record the authorized host-capable derived upload: 310,027 program bytes / 23,696 static RAM bytes, app SHA256 `90d84d2cf9c9440d425cc886dae97584415c07f1cd39e71974bf76789c2bc33d`, uploaded at `0x10000` / 57,600 baud with written-data hash verification. An original-sketch upload or a compile-only success is not proof of this build. Confirm the ready banner and `CAPABILITIES: BROWSER BEATS` metadata. The latest authorized upload (12 November 2026 evening) is the neutral-white candidate build, app SHA256 `bb9092b038183e2d1872843193cdd53bad858cb6ffa739cf1d90a04eec14ad37`, which additionally prints `WHITE PRESET: NEUTRAL CANDIDATE (K = WHITISH)`; its pre-upload application backup is `.arduino/backups/2026-11-12-before-white-candidate-app.bin`.
4. Close other serial programs. Connect with **Preset controller (your sketch)**, confirm `AUTO / MUSIC STOPPED`, then choose the intended source: **Browser song sync** for directly shared music or **ESP32 music sync** for the existing microphone. Choose **Follow ESP32 events** in the preview. For microphone mode, allow its one-second detector warmup.
5. Check that Music-mode `Level:N Threshold:N` lines arrive about every 50 ms and are labeled bass envelope. Confirm they represent the filtered 35–200 Hz envelope and actual adaptive threshold on the transport's 16-bit scale, not PCM, calibrated loudness, full FFT or BPM. Compare silence, steady bass, speech, percussion and real music at several hardware sensitivity settings.
6. Verify the two preview LEDs start a decaying pulse only on a received `BEAT! Color sent: R/G/B` message. A steady level with no new beat reports must not create repeated flashes. Stop or silence the music and check that old pulses decay. The device-follow mode must not use the 120 BPM demo clock. Confirm irregularly spaced reports remain irregular in the preview.
7. Verify microphone levels continue while the IR worker transmits in Music mode. In the current derived build, manual/song colors and Music triggers use one IR frame; Auto uses three with 80 ms gaps. Manual/Host/Auto skip unused microphone reads. Confirm `PRESET FRAMES: 1` before interpreting a manual color as a single-frame test. Check latency and event loss under rapid onsets, cancellation during a send and bounded queued work. The 180 ms minimum detector interval is a limit, not an automatic flashing period or guaranteed tempo accuracy.
8. Confirm HEX/RGB, brightness, speed, effects and scenes change only the simulator. Return to **Follow ESP32 events** to inspect device reports. The audio gain slider changes visual strength only; hardware sensitivity buttons change the detector. The case stays white with exactly two internal light spots.
9. With the actual emitter and identified wristband, compare each one-frame manual color separately. With the website disconnected, `python3 scripts/probe-single-pulse.py --all --interval 5` sends six colors once each. For a 120/240 fps slow-motion comparison use `--all --colors GW --interval 5`. A five-second observation gap does not lengthen the receiver's pulse. Log missed/false beats, microphone placement, music passage, serial event times, IR output and observed receiver response separately. An emitted event confirms completed sending, not reception. Stop cancels sequencing but provides no verified blackout command.
10. Record USB disconnect/reconnect, stale audio and restart behavior. Do not present prior samples or demo pulses as live ESP32 music. The host-capable upload and isolated serial probe have passed; shared-song and physical beat alignment still require observation. Append those results to [VERIFICATION.md](VERIFICATION.md).

## Browser song sync: current end-to-end check

1. In desktop Chrome open `http://localhost:5173`, choose **Preset controller (your sketch)** and connect CP2102. Confirm the actual browser-beat capability metadata rather than enabling host writes for the old original sketch.
2. Press **Browser song sync**. Choose **Chrome Tab**, select the YouTube/music tab, enable **Share tab audio**, and share. A share without audio must fail and release all captured tracks. Do not assume whole-system audio is available on every browser/OS or on mobile.
3. Confirm `H` enters host mode with `BROWSER SYNC ON`. In this mode only explicit `1`/`2`/`3` host requests may queue one R/G/B frame; the room microphone must not trigger IR. The completed frame reports `BEAT! Color sent: …`, which is not a receiver acknowledgement.
4. With music playing, record detected browser onset times, outgoing RGB commands, completed-send reports, preview pulses and observed wristband action separately. Measured onset edges must drive output, not demo frames, ESP32 amplitude or a tempo timer. Busy output drops new onsets instead of building a delayed queue, and failed output disables dispatch rather than retrying beats.
5. Pause and resume the actual shared music tab. While paused, verify no new measured onsets, host digits or send completions after any in-flight frame finishes; old visual pulses should decay. Inspect irregular music as well as steady rhythm. A known song BPM alone is not proof of per-beat alignment.
6. With AudioWorklet support, switch to the music tab and confirm analysis/output continues without depending on the controller page's animation frames. Check that view reads reuse cached frames rather than consuming detections a second time. Only PCM onsets may trigger output; spectrum ticks must have `beat:false`. Vary message delivery delay and confirm the BPM estimate still uses sample-derived onset timestamps. Discard onset messages more than 100 ms old. Output buffers must remain silent. For the unsupported fallback, verify the foreground-only message and keep the controller page visible.
7. End sharing, change source, Stop or disconnect. Disable new host dispatch immediately, cancel capture/listeners, ignore late clock events and allow only an already-transmitting frame to finish. Check capture cancellation while the chooser/module is pending. Browser/OS capture suspension, audio-context suspension and sleep remain limitations; do not claim background operation through them without testing.
8. Keep the INMP441 wiring unchanged. The room was not quiet during prior paused-song observations; those are not controlled silence tests and do not establish the source of microphone detections. Browser-host isolation must be tested independently from standalone microphone noise rejection.

The hardware host probe passed two-second idle windows before and after four explicit one-frame RGB commands, with approximately 45.8–73.9 ms serial completion times. It did not measure optical timing or song alignment. All 73 automated tests passed. Separately, on 12 November 2026 the user confirmed the physical wristband stopped flashing when the shared song was paused and resumed with playback. This is a physical pause/resume observation, not a calibrated per-beat phase measurement.

### Low-latency regression check

Run `node --import tsx --test tests/beatLatency.test.ts tests/audioClock.test.ts` to execute the actual shipped worklet source against PCM fixtures at 44.1/48 kHz. Count posting delay at the processing-quantum end, not just the event's timestamp. Cover irregular strong/weak kicks, sustained pads, 80 BPM alternating kick/snare with weaker eighth-note hats, stereo/opposite phases, DC, isolated clicks, pause and resume. These deterministic fixtures do not measure browser capture or physical wristband latency.

With Chrome disconnected, compare firmware using the same instrument: `python3 scripts/probe-browser-beats.py --samples 16 --output .arduino/host-latency-after.json`. The probe measures host write to completed-send reply and checks idle isolation. It deliberately uses prescribed command timings, not music. The low-latency firmware measured a 32.15 ms median (31.6–32.6 ms), versus 40.2 ms (33.3–57.6 ms) before this change. The preserved IR waveform itself lasts 27.3 ms. Optical response and song phase require a separate visual/listening or instrumented test.

For the user's 80 BPM 4/4 track, inspect latest onset intervals near 750 ms and an estimated tempo near 80 after several hits. Watch for 375 ms/160 BPM hat doubling or 1,500 ms/40 BPM missed alternating drums; do not force the output clock to the target tempo. Pause the shared source: onset count and physical flashing should stop, apart from a frame already sending. Resume and require new audio attacks before output resumes.

### Automatic sensitivity

Run `node --import tsx --test tests/autoSensitivity.test.ts tests/beatLatency.test.ts tests/audioClock.test.ts`. The automatic fixtures cover 60/80/100/120/140/160/180 BPM at three gains, low-mid-rich weaker hats, loud-to-quiet changes at both 80 and 160 BPM, a tempo change without restarting capture, opposite stereo phases, held pads, stationary noise, DC, isolated clicks and pause/resume. The fixture matrix allows four real attacks for acquisition before checking the following beats. Keep the manual detector regression suite intact.

In the UI select System / browser tab audio or Microphone and confirm Automatic sensitivity defaults on. Switching it off reveals the manual slider; switching back on does not restart a live capture. Check the saved choice after refresh. Demo and ESP32 amplitude sources must not claim automatic browser detection. When AudioWorklet is unavailable or fails, show manual fallback and keep manual controls available. Metadata must be finite, bounded, and confirmed by the currently selected processor mode; queued metadata from the old mode must not reverse the setting.

For physical validation, share actual music in Chrome / USB Host mode, change tracks and volume, and observe several real attacks before assessing recovery. Compare detected intervals and actual wristband behavior separately. Synthetic fixtures establish algorithm behavior, not universal song classification or optical timing. No new firmware upload is required for this browser feature.

## Per-song lighting programs

1. Open Song shows. Rename the example, edit cue times/effects/colors and save. Refresh and select the saved show; audio must be reselected. Check storage errors, duplicate IDs, invalid colors/effects, oversized data, the 16-show / 1024-cue caps and rejection of unsupported hardware `M`. With a preset controller connected, check that the Device lead field (0–200 ms, default 40) persists across reload and that the device-status line names the firmware's White waveform (warm original or neutral).
2. Import a local MP3/WAV. Play through cue boundaries and verify the preview follows media time. Pause and verify time/effect phase freezes. Seek while paused and playing: playback pauses, preview selects the appropriate cue, and resuming does not replay older cues. File playback errors must not start output.
3. Select External player. Verify the separate manual clock runs/pauses/seeks correctly and the page explains that it cannot read the external player's timeline. It must not claim automatic YouTube seeking or song recognition.
4. With hardware off, play, pause, edit and leave the editor while free-rhythm device output exists: no physical Stop may be sent merely for previewing. Enable Send cue colors only with the verified preset adapter. Starting hardware show output must first cancel browser analysis/dispatch and confirm Stop. Late preparation completion after cancellation must not start the old show or stop a newer session.
5. Verify output uses `preset` with only the selected R/G/B/Y/C/W, never unsupported magenta or invented effect commands. One pending send maximum; rapid crossings, >400 ms suspended/background jumps and cues more than 150 ms late must not accumulate/replay. Pause/seek/Stop must cancel an unwritten cue even if it is queued behind another acknowledgment or its own Host-exit Stop barrier. Already-written sends may finish.
6. Replace audio files, change source, disconnect and leave/re-enter the page. Release audio object URLs and pause media on cleanup. Test layouts at 1440, 390 and 412 px without horizontal document overflow. Browser programs/effects and completed sends remain separate from physical receiver confirmation.

Run `node --import tsx --test tests/songShow.test.ts tests/songShowIntegration.test.ts` for pure timeline/storage/output and actual preset-adapter framing/cancellation regression checks. Local playback and live receiver checks complement, rather than follow from, those tests.

### Offline rhythm analysis and draft generation

1. Select a local mono/stereo MP3/WAV, wait for metadata, and Analyze rhythm. Confirm progress, estimated BPM, detected-attack count and confidence. Analysis must not play audio, acquire a microphone, connect hardware or send any cue. Check empty/corrupt/unsupported audio, limits of 100 MB / 10 minutes, failed decoding/worker and a result inconsistent with decoded duration.
2. Cancel before/during file read, decode and worker processing. Select a different file, change timing source, reset/start playback, switch shows or leave during analysis. Late results/progress must not replace the new state. Worker handlers, worker, Blob URL and timeout must be cleaned up. Decode itself cannot be interrupted, but its stale completion must be ignored.
3. With valid analysis, generate single-color or RGB drafts at every 1st/2nd/4th detected attack. Original saved shows must remain unchanged; unsaved edits require saving first. A new draft starts with hardware off. All selected cue timestamps must come from the analysis, with no fixed-BPM filling of gaps. Above 1024 cues, thin by powers of two across the full track and report the stride. For a real song, confirm the estimated BPM is the felt beat (not half of it) and that beats continue through the whole track except silent passages.
4. Sample generated Flash pulses at the onset, during the 120 ms decay, after expiry and before the cue. They must emit one preview pulse and remain off until another cue; ordinary authored Flash without pulse length keeps its original effect. Confirm pulse duration validates/persists and other effects retain their normal preview behavior. A simulated expired pulse must not send an unverified hardware blackout.
5. Preview, save, reload and reopen a generated show. Times/pulse settings persist; the local file and temporary analysis do not. Playback/seek/cancellation and optional hardware cues retain the previous Song shows boundaries. Check new panel layout on desktop, 390 px and 412 px, and inspect browser errors.

Run `node --import tsx --test tests/songRhythm.test.ts tests/autoSongCues.test.ts tests/songShow.test.ts`. The actual exported worker source is tested at 22.05 kHz with 80/120/160 BPM, gain differences, opposite stereo phases, irregular attacks and quiet tails. Service mocks test cancellation/cleanup and result bounds; generation tests verify new IDs, exact observed times, supported color mapping, pulse duration and whole-track thinning. Synthetic success does not establish accuracy on every real recording.

## Optional newer Wi-Fi V2 controller over USB

Use this checklist only for a board independently confirmed to run the separate Wi-Fi V2 firmware with `STATUS` support. Select **Wi-Fi V2 controller (USB)** explicitly; the original/derived music sketches and JSON controller use different protocols. See [PRESET_SERIAL.md](PRESET_SERIAL.md). A visible Wi-Fi webpage did not establish the installed firmware in this session, and the attempted V2 handshake failed. The V2 adapter's physical connection remains unverified. Its documented wiring is IR GPIO32 / microphone GPIO26/25/27.

1. Run software tests/build. Verify strict V2 status-schema validation, newline ASCII framing, queued commands and `OK`/`ERR command` handling, polling cancellation, disconnect and timeout recovery. No JSON controller handshake or older `M`-for-Music assumption may enter this adapter.
2. Close Arduino Serial Monitor, select the V2 USB option and connect CP2102. Confirm the adapter obtains valid `STATUS` JSON and polls about every 250 ms. Confirm device mode, RMS, microphone availability, last color and frame count come from received state. Selecting another protocol must not be silently attempted as an automatic fallback.
3. With emitter disconnected, test all seven manual preset commands including `M` for magenta. Test Auto RGB, `MIC LEVEL`, `MIC BEAT`, Stop and absolute `SENS 1..100`; verify reported mode and sensitivity. General HEX, brightness, speed, effects, visual scenes, raw-IR and RF controls must not generate unsupported commands.
4. Play external music near the existing microphone. Confirm RMS changes and microphone state remains current in manual and music modes. Confirm the preview follows last-color and amplitude data with exactly two internal LED lights in a white housing. Its brightness is simulated, not measured physical brightness.
5. Verify no explicit beat-event indicator, BPM, FFT, band or drop data is attributed to this V2 status stream. It reports no individual beat event; do not infer one merely from frame or color changes. Browser microphone/shared-audio and demo analysis retain separate source labels.
6. Test Stop during Auto/Music. It stops further sequencing/pending repeats and does not claim a physical blackout. Record behavior when the website disconnects. On USB unplug, invalid status or timeout, show stale/disconnected state and stop presenting old samples as live.
7. Confirm the onboarding explains that this V2 firmware's HTTP API lacks CORS and its USB connection is used for the React studio. Do not modify firmware or add a proxy merely to bypass that limitation.
8. After electrical/output checks, observe the identified wristband and log commands, firmware acceptance, frame count and actual optical result separately. A frame count or `OK` response does not confirm wristband reception or general tour compatibility.

## Supplied older preset-controller serial adapter

Use [PRESET_SERIAL.md](PRESET_SERIAL.md) and the unchanged `firmware/PixMobPresetSerial/PixMobPresetSerial.ino` source for this checklist. Its IR signal is GPIO32 and its microphone stays on GPIO26/25/27. The JSON-controller procedures in later sections use a different firmware and IR pin; do not send their JSON examples to this character-command sketch.

1. Run the software tests/build. Check the serial mock tests cover exact command allowlisting, no JSON handshake, fragmented telemetry, separate beat/color messages, queued command acknowledgements, unsupported operations, timeout and connection cleanup.
2. With emitter disconnected, close Arduino Serial Monitor and choose **Connect device → Preset controller (your sketch) → Connect with Web Serial**. Confirm connection sends `X` and receives `AUTO / MUSIC STOPPED`; it must not claim success from unrelated boot text or microphone levels. Test a wrong firmware and confirm an explanatory failure instead of automatic command-protocol guessing.
3. Send the six manual presets R/G/B/Y/C/W one at a time. Confirm the matching `Color sent: …` acknowledgement. The website must not offer `M` as a manual magenta command. Exercise Auto, Music and Stop and confirm their exact mode acknowledgements. A different color report in Auto/Music must not accidentally acknowledge a pending manual preset.
4. Use more/less sensitivity and confirm the printed numeric value is displayed. Check bounds 1.10 and 2.50. Do not infer the initial value when reconnecting without a reset. Unsupported HEX, brightness, speed, effect, scene, raw-IR and RF controls must not generate character writes.
5. Play music through speakers near the INMP441. In Music mode confirm `Level:N Threshold:N` data, the separate `BEAT! Color sent: R/G/B` reports and corresponding preview pulses. Each pulse must start from an actual beat report, not a repeating demo or level-based timer. In Manual/Auto modes confirm old level samples are not shown as fresh live audio. The white housing must remain white with exactly two illuminated preview LEDs.
6. Compare silence, speech and music at several sensitivity settings. Record skipped/false beats and latency. The sketch's approximately 242 ms blocking preset transmission interrupts sampling, and its >420 ms beat interval can skip close beats. Do not require sample-accurate or one-trigger-per-beat behavior.
7. Confirm Advanced DJ does not present spectrum, BPM, bands or drop analysis as originating from this amplitude-only ESP32 sketch. Browser audio and demo analysis must keep their own source labels.
8. Test a lost acknowledgement, USB unplug and reconnect. Show timeout/disconnected state; do not claim successful wristband output. Do not replay color or mode commands automatically after a timeout. Confirm Stop ends Auto/Music but does not claim to extinguish the physical wristband. Test device behavior after browser disconnect separately.
9. Only after electrical/output checks for the actual GPIO32 circuit, attach the emitter and observe the identified wristband. Record command, acknowledgement, receiver response, distance/orientation and repeated trials. No software test or serial response establishes general PixMob compatibility.

## JSON controller transport contract without an emitter

1. Compile the firmware for your actual board/core, with warnings visible. Record dependency versions and build result.
2. Power the ESP32 over USB with transmitter disconnected. Check the boot JSON at 115200. Confirm no waveform is configured, standalone is false and RF support is false after every reset.
3. Check GET `/api/status` and Web Serial `{"id":1,"op":"status"}`. Confirm serial IDs match and both transports expose the same capability fields.
4. Test invalid JSON, strings instead of numbers, fractional durations, missing `markFirst`, `NaN`/non-JSON input, empty durations, >512 durations, out-of-range carrier/duty/gap/repeat, and waveform total >200 ms. All must fail without transmitting or replacing a valid waveform.
5. Send a line larger than 8,192 bytes over Serial followed by a valid request. Confirm the large line is discarded and parsing recovers at the newline. Test an unknown operation and wrong HTTP methods.
6. Attempt `ir/send` before configuration. It must fail. Standalone enable must fail without a configured waveform and recent microphone samples.
7. Unplug USB or disconnect Wi-Fi during use. The app should show connection loss or a timeout without claiming successful hardware output. Reconnect and reload configuration after a reset.

## JSON controller logic-level IR output

Use a logic analyzer/oscilloscope on GPIO33 while the emitter is disconnected. Supply a deliberately artificial bench waveform from your test equipment; label it **non-PixMob test data**.

1. Check idle LOW at boot and after configuration. Loading a waveform must not transmit it.
2. Measure requested carrier frequency and duty within the actual peripheral’s quantization. Check each mark/space duration, final idle state and inter-frame gap. For an odd list, account for the documented 1 µs idle tail.
3. Check repeats 1 and 5, shortest/longest accepted durations, max permitted total, and a 512-entry sequence that remains within the total bound.
4. Confirm `ir/send` returns accepted before completion, `irTransmitting` tracks activity, and a second overlapping send is rejected.
5. POST `ir/stop` during a multi-frame send. Confirm the current bounded frame finishes and no additional frames begin. Verify HTTP and Serial remain responsive during a long waveform.
6. Confirm changes to IR configuration are rejected while transmitting or in standalone mode. Reset and confirm all waveform data and standalone state clear.

## JSON controller microphone standalone

1. Connect the INMP441 per [WIRING.md](WIRING.md). Observe actual I2S clock/slot data and verify `micLevel` responds to sound. Disconnect SD, tie it safely to GND and confirm it no longer appears as live samples. Do not infer a working microphone from driver initialization alone.
2. With a bench waveform and a disconnected emitter, enable standalone. Test clap/music peaks at several sensitivity values. Confirm no overlapping starts and ≥500 ms between starts.
3. Disconnect/stop the browser. The ESP32 should continue energy-peak synchronization. This tests standalone operation; it does not validate color encoding, BPM or protocol compatibility.
4. Disable standalone over either transport. Confirm pending repetitions stop after the current bounded frame. Test reset behavior.

## Physical IR / wristband validation

Only after electrical and logic-level tests pass, attach the verified driver/emitter. Measure supply and LED current, carrier output and temperature against component ratings. Use an IR photodiode/scope or suitable receiver to verify actual optical bursts. A phone camera can only give a rough indication of emission.

Test a wristband only with captured, documented timings for that exact revision. Log controller/capture source, wristband identification, distance, orientation, ambient light, requested command, observed action and repetition count. Repeat successes and test unsupported commands. Do not label a tour profile compatible based on a single band or a raw transmission acknowledgement.

## Optional integrations

For a confirmed TFT, test voltage, backlight current and SPI transactions before its controller-specific adapter. RF tests remain pending until module and protocol are identified. No RF frequency or module is assumed by this project.

## Current verification boundary

Controller firmware 1.1.0 has been compiled, uploaded and verified over USB on the connected ESP32, with working INMP441 RMS telemetry on GPIO26/25/27. See [VERIFICATION.md](VERIFICATION.md) for the exact checks. KY-005 electrical/optical output, standalone waveform transmission, TFT, RF and physical wristband compatibility remain unverified. The procedures above describe further tests and do not imply they have all passed.

That historical JSON-controller result does not establish which sketch is currently installed. In this session the prior RGB-only firmware replied `Auto Mode OFF`; after its full-flash backup, the authorized supplied original music-sketch upload completed (306,035 program bytes, 23,624 static RAM bytes; app SHA256 `a4cd8f4d3fae50d04df10a61a993c90ea32e4ac14124f6d0b02f77b1b848678f`). A 20-second external-music observation returned 68 level samples, raw 68–1,191, and 20 beat reports spaced approximately 0.447–1.755 seconds apart. That does not establish accurate beat alignment or physical wristband response.

The host-capable derived beat controller was uploaded with written-data hash verification and passed the isolated host-mode serial probe described above. Twelve synthetic microphone-detector scenarios and all 73 automated tests passed; they do not establish microphone rejection of all room noise. The user separately confirmed physical shared-song pause/resume behavior. Exact optical timing and per-beat phase alignment remain unmeasured. Physical Wi-Fi V2 connection remains unverified after its failed handshake. See [VERIFICATION.md](VERIFICATION.md); the procedures above do not imply unrecorded checks passed.
