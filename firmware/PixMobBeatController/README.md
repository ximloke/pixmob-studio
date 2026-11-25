# PixMob Beat Controller

**Version distinction, 15 November 2026:** the board was rolled back to `.arduino/beat-effects-build/` and the user chose to keep it there. This source still matches the newer `beat-idle-build` (apart from generated build declarations/line markers), so `@I`, idle return and the longer Auto interval below describe source features absent from the installed build. Current W/K are 124/124/124 and 124/108/56, manual magenta uses `.M`, and the user has confirmed Stop's early cut. Earlier passages about unchanged WHITE/WHITISH frames and unobserved neutral white are historical. Use the [current handoff](../../docs/CLAUDE_HANDOFF.md) for installed capabilities, hashes, physical observations and the unresolved rainbow flicker.

This is a separate improvement of the supplied preset sketch. The exact original remains in `../PixMobPresetSerial/`. This variant has not been physically verified merely by compiling or passing host tests.

## Unchanged hardware and IR data

- ESP32 DevKit V1: KY-005 signal GPIO32.
- INMP441: BCLK GPIO26, WS GPIO25, SD GPIO27; retain the existing power, ground and L/R wiring.
- Six supplied timing arrays are copied exactly, with the same 38 kHz carrier. The supplied `WHITE[]` (upstream WHITISH, warm) is kept verbatim as `WHITISH[]` behind the `K` command, and `W` now sends an unverified neutral-white candidate (`80 69 21 89 89 89`, R/G/B 204, 41 slots / 28.7 ms) derived from the published protocol; see [the White audit](../../docs/WHITE_IR_AUDIT.md).
- Manual/song presets use one frame. Auto retains three frames with nominal 80 ms gaps.
- Music uses one frame per detected onset. Reception with a single frame needs a physical wristband check; no new PixMob protocol is assumed.

## Behavior

In microphone Music/diagnostic mode, the Arduino loop reads 256 mono 32-bit I2S samples at 16 kHz. Manual, Auto and browser Host skip unused microphone reads. A separate low-priority worker on core 0 performs IR transmission. A one-job mailbox bounds pending output, and completion events return to the main loop. Only the main loop writes serial messages.

`BeatDetector.h` has no Arduino dependencies. It removes DC with a 35 Hz high-pass filter, emphasizes bass with a 200 Hz low-pass filter, and compares a short RMS envelope with an adaptive mean and variation threshold. It requires a rising onset and rearming below a lower threshold. Music starts with a one-second warmup. A 180 ms minimum interval limits repeated triggers; there is no interval that creates a beat automatically and no BPM locking.

The revised detector also tracks a lower/background envelope and requires two consecutive qualifying sample blocks. A separate 5 Hz high-pass filter measures DC-removed full-band energy. Bass/full-band powers share a 32 ms smoothing window; a provisional 0.12 minimum bass fraction rejects many broad-band transients. Peak-limited baseline updates reduce masking of softer kicks by an earlier loud kick. These gates need comparison against actual quiet-room and music measurements; they cannot guarantee that every bass-like environmental sound is distinguishable from music.

The reported `Level` and `Threshold` are the bass envelope and its actual trigger threshold, scaled by 32,768. They are not raw ADC samples or the old whole-spectrum mean-absolute level. Telemetry is emitted at approximately 50–64 ms intervals with 16 ms sample blocks. `BEAT! Color sent: R` is printed after the IR worker completes that frame; it proves software transmission completion, not wristband reception.

## Serial compatibility

Use 115,200 baud and explicitly choose the character-command adapter in PixMob Studio. Do not send JSON or `STATUS` from a different firmware protocol.

| Command | Result |
| --- | --- |
| `R/G/B/Y/C/W` | Manual color flash; acknowledged after one frame completes. Levels come from `ColorLevels.h` (`W` = neutral white 124/124/124) |
| `K` | Warm white, the WHITISH hue at 124/108/56; `Color sent: K`. Builds up to `beat-hold-build` sent the original WHITISH frame here |
| `#<color><ms>` | Timed light, e.g. `#R1500`: colors R/G/B/Y/C/M/W/K, 50–600,000 ms; `Light: R 1500` after the first frame. Built from 9-byte envelope frames that are re-sent before the sustain ends, never identical to the frame still showing. Any later command ends it; `X` also sends a short frame to end it early |
| `!<color><ms>` / `^<color><ms>` | Strobe / build-up strobe, e.g. `!W2000`, `^W8000`: 200–60,000 ms; `Strobe: W 2000` or `Build: W 8000` after the first flash. 32 ms flashes every 125 ms; the build starts at 500 ms between flashes and speeds up. Advertised by `STROBE: READY`. Any later command ends it |
| `=RRGGBB` as `<color>` | Custom levels in any line command: six hex digits for red, green, blue, each at most `C8` (200) |
| `.<color>` | Quick flash of any color, e.g. `.=844000`; `Flash: =844000` |
| `#<color><ms>,<in>,<out>` | Timed light with fade in / fade out codes 0–7 (0, 32, 96, 192, 480, 960, 2400, 3840 ms) around `<ms>` at full brightness; `Light: B 2000 5 7`. Advertised with the two rows above by `CUSTOM LIGHT: READY` |
| `~<ms>[,<cycle ms>]` | Rainbow for 500–600,000 ms, one turn of colors per cycle (1,000–20,000 ms, default 3,000); `Rainbow: 6000 3000`. A frame every 120 ms through the red, yellow, green, cyan, blue and magenta levels. Advertised by `RAINBOW: READY` |
| `@F` / `@L<ms>[,<in>,<out>]` / `@S<ms>` | What a beat (Music, Browser) or an Auto step shows: quick flash, timed light of 50–10,000 ms with fade codes, or strobe burst of 200–5,000 ms. Echoed as `BEAT STYLE: …`; the running mode continues |
| `@P<letters>` / `@P*` | Colors Auto and Music step through (1–8 preset letters), or each mode's defaults. Echoed as `BEAT PALETTE: …`. Advertised with the row above by `BEAT EFFECTS: READY` |
| `*<color>` | One browser beat in any color, including `=RRGGBB`; Host mode only |
| `@I<s>` | Rainbow while nothing controls the board: `@I0` off, `@I1` only from power-on until the first command, `@I2`–`@I3600` also after that many idle seconds (default 10). Kept in the board's flash (`Preferences`, namespace `pixmob`, key `idlesec`; the older on/off key `idle` is kept in step) and echoed as `IDLE RAINBOW: OFF` / `ON` / `ON <s>`, a line the banner, `H` and `X` also print after `IDLE RETURN: READY` |
| `A` | Auto sequence through seven colors (R/G/B/Y/C/M/W) or the chosen palette; the next color comes after 1.8 s or, when the beat style is a longer timed light, after that light and its fades end |
| `M` | Music onset mode, cycling R/G/B |
| `H` | Browser-controlled onset mode; room microphone cannot trigger IR |
| `1`–`8` | In browser mode only, one beat in R/G/B/Y/C/M/W/K, shown in the beat style |
| `X` | Cancel queued output and stop Auto/Music; a frame already in flight finishes |
| `+` / `-` | More / less sensitivity; threshold ratio remains within 1.10–2.50 |

`M` remains Music, so manual magenta is unavailable through this character protocol. Magenta is still used by Auto. `X` does not transmit a verified lights-off command.

The distinct boot banner is `PIXMOB BEAT CONTROLLER READY!`. Boot, `M` and `X` also emit `AUDIO FORMAT: BASS ENVELOPE 16-BIT`, allowing the website to label the new measurements correctly. Mode and sensitivity acknowledgments retain the original spelling.

The uploaded single-frame build reports `PRESET FRAMES: 1`. Its application SHA256 is `2ec5efacf5223f808387aa30ef1194f2e3ae0b0829da067cfc6c6d491d9101f4`; the upload and physical observations are recorded in [verification](../../docs/VERIFICATION.md). In that build `W` is still the supplied waveform, which is upstream **WHITISH**, not validated neutral white.

The current source additionally prints the exact line `WHITE PRESET: NEUTRAL CANDIDATE (K = WHITISH)` after `PRESET FRAMES: 1`. The website offers the **Warm white** button and labels White as a candidate only after seeing that line; otherwise it labels White as warm WHITISH and refuses `K`. This source compiled to `.arduino/white-candidate-build/` (310,247 program bytes / 23,696 static RAM bytes, SHA256 `bb9092b038183e2d1872843193cdd53bad858cb6ffa739cf1d90a04eec14ad37`) and, with the user's authorization on 12 November 2026, was uploaded at `0x10000` / 57,600 baud with written-data hash verification after the previous application region was backed up. The board printed the new metadata line, and two W/K single-frame rounds completed in 33.1/31.5 and 32.5/30.5 ms with no autonomous output. Serial completion is not color evidence. On 13 November 2026 the user compared W and K from the website and reported W visibly whiter; that comparative observation, not a measurement, is the basis for calling W the White preset.

## Idle rainbow and breathing colors

With the setting on, the board queues a rainbow (3 s per turn of colors) after its banner and keeps it running until any byte arrives on the serial port; that byte cancels it and is then handled as usual. The completion line is `IDLE RAINBOW RUNNING`. With a number of seconds (`beat-idle-build` and later) the rainbow also comes back when the board is stopped (no Auto, Music or Browser sync), the IR worker has nothing queued or running, no timed light is still lit, and neither a serial byte nor an IR frame has come for that many seconds. A bare carriage return is ignored as a command, even inside a line, but restarts the wait; the website sends one every second while a song show plays, so gaps between cues stay dark. Opening the serial port from the website resets the board and the website's first command (`X`) ends the rainbow; left alone after that, the board goes back to it. Builds up to `beat-breathe-build` ran the rainbow only after power-on or reset; a stored on became 10 s on the first boot of `beat-idle-build`.

`beat-idle-build` (327,255 program bytes / 23,968 static RAM bytes, SHA256 `4a92bbf40acca1af5fd9377b9fd289be1c9bae24e1d4d886209a57ace8db7c32`) is the build with the idle seconds; see [verification](../../docs/VERIFICATION.md). On 15 November 2026 the board was rolled back to `beat-effects-build` at the user's request, so the board currently has no power-on or idle rainbow and no breathing.

Breathing colors is not a separate command: the website sends `@L5000,5,5` (5 s at full brightness with 960 ms fade in and fade out), the chosen palette and `A`. Because Auto now waits for the light to end, each color lasts about 6.9 s. This source compiled to `.arduino/beat-breathe-build/` (324,823 program bytes / 23,952 static RAM bytes, SHA256 `acae1a860316c7572b7e6cc81f92857d9e30bbec278654d6a60ebad1064f197f`); see [verification](../../docs/VERIFICATION.md) for whether it has been uploaded.

## Color levels

Quick flashes (6-byte single-color command) and timed lights (9-byte envelope command) are built from one table in `ColorLevels.h`. Red, Blue and Yellow keep the supplied values, and their flash frames are bit for bit the supplied arrays. Green (88/164/0), White (124/124/124), Warm white (124/108/56) and Magenta (180/76/120) use the values that stayed lit on the user's wristband in the hold tests, because the supplied Green (132/244/0), the neutral White (204/204/204) and WHITISH (204/176/92) flashed weakly and looked alike there on 13 November 2026. Cyan is upstream LIGHT_BLUE (68/184/160) because the supplied Cyan (upstream TURQUOISE, 132/200/160) looked light green; that value has not been observed. The weak flashes all had a channel of 204 or more and the bright ones none above 200; the cause was not measured. The supplied arrays are kept in `OriginalFrames.h` for reference and are checked by `tests/color-levels.cpp`. This source compiled to `.arduino/beat-levels-build/` (SHA256 `7c3a36250cc4af6911da5ea478f909169b5a2fcc0622d4f298b7b0880913bb4c`); see [verification](../../docs/VERIFICATION.md) for whether it has been uploaded and observed.

## Browser song synchronization

`H` cancels previous output, enters host mode, and acknowledges `BROWSER SYNC ON`. Boot, `X`, `M`, `H` and `V` publish the exact capability line `CAPABILITIES: BROWSER BEATS` after the audio-format metadata. A compatible website must observe this capability before offering browser beat transmission; the original preset sketch does not support these commands.

In host mode only, `1`, `2` and `3` request one R/G/B frame respectively. The main loop prints the existing `BEAT! Color sent: R` acknowledgment only after that frame completes. The browser should wait for acknowledgments and bound its pending work; arbitrary bursts of digits can replace the single pending job. Digits outside host mode are ignored.

Host mode skips the blocking microphone read and detector processing. The UART/completion loop therefore does not wait for an unused 256-sample I2S block (about 16 ms at 16 kHz) before accepting browser commands or reporting completed frames. The I2S peripheral remains configured; returning to `M` or `V` resets the detector and uses the existing one-second warmup to consume buffered samples before accepting onsets. Microphone and transmitter pins are unchanged.

No beat timer runs in Host mode: no incoming digit means no new IR transmission. `M` explicitly returns to microphone synchronization, while Stop, Auto and manual presets leave Host mode. A frame already in flight may finish, and these supplied presets do not include a verified lights-off command. Each supplied waveform still takes 27.3 ms to transmit; software polling optimization does not shorten that protocol frame. Measure serial completion timing again after uploading this build, and keep that measurement separate from actual optical/music alignment.

## CLI diagnostics

The administrative `V` command starts the same detector with all IR output suppressed. It cancels pending IR and prints `MIC DIAGNOSTIC ON`; detected onsets print `ONSET DETECTED`, without claiming color transmission. `M` returns to normal music transmission, and `X` stops either mode. `V` is not a normal website control.

Alongside each unmodified `Level:N Threshold:N` line, a separate line reports `Analysis:Full:N BassFraction:F`. `Full` is the 16 ms full-band RMS after the 5 Hz DC-removal filter, scaled by 32,768. `BassFraction` is the matched-window bass/full-band power fraction, bounded to 0–1. Neither line exposes raw samples. The website can ignore the analysis line without breaking the existing level parser.

Compare paused sources with the board still, first in `V`, then in `M`. Repeat with music and isolated bass hits. This separates input behavior from possible effects of IR transmission. A quiet-room failure requires further investigation; do not classify its source from envelope measurements alone.

## Validation

Run the repository test suite from the project root. The portable detector tests exercise silence, DC plus low noise, a sustained tone, irregular bass kicks, sensitivity changes and parameter bounds. These are synthetic tests, not proof of performance on all music.

After a successful compile and authorized upload, test silence, isolated claps or bass hits, and music pauses. Check that beat events stop in silence and track irregular onsets rather than a fixed interval. Confirm microphone telemetry continues during Music-mode IR transmission. Test reception of manual colors and single-frame music commands separately with the actual wristband.
