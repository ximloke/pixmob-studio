# White preset audit — 12 November 2026

## Finding

The supplied sketch's `WHITE[]` is an exact numerical match for **WHITISH** in the original author's [PixMob_main.ir](https://github.com/danielweidman/flipper-pixmob-ir-codes/blob/main/PixMob_main.ir#L427-L431). It should not be represented as a validated neutral-white command. Its warm appearance has a payload-based explanation, beyond possible camera color rendering.

The current derived sketch, preserved original sketch and both pasted attachments contain identical timing arrays. The application binary uploaded during the preceding single-frame tests contains the same WHITE sequence exactly once; its SHA256 is `2ec5efacf5223f808387aa30ef1194f2e3ae0b0829da067cfc6c6d491d9101f4`. WHITE and YELLOW are different waveforms, both 27,300 µs at 38 kHz.

## Routing

The live-control White button sends `{color: "W"}`. The preset adapter writes `W\n` and waits for the exact W completion reply. Firmware dispatches W to WHITE and Y to YELLOW. A pure-white generated preview color also maps to W rather than Y. No W/Y routing substitution, copied-array mismatch or length error was found. The existing targeted preset, song-show and automatic-cue tests passed, 45/45.

## Read-only protocol interpretation

Using the published [IR decoder and encoding/checksum rules](https://github.com/jamesw343/PixMob_IR/blob/master/pixmob_ir_protocol.py#L105-L216), the 39 time-slot envelope decodes as a six-byte single-color command. Optional leading/trailing zero slots are accounted for as in that decoder; no waveform was edited or transmitted for this analysis.

| Supplied label | Encoded bytes | Checksum | Decoded R | Decoded G | Decoded B |
| --- | --- | --- | --- | --- | --- |
| WHITE | `80 62 21 85 89 24` | Valid | 204 | 176 | 92 |
| YELLOW | `80 A9 21 4A 86 21` | Valid | 132 | 124 | 0 |

The [documented fields](https://github.com/jamesw343/PixMob_IR/blob/master/docs/ir_protocol.md#ir-command-display-single-color) carry six significant bits per channel. These numbers are protocol channel values, not calibrated sRGB or measured LED intensities. The low blue value in WHITE is consistent with the warm yellow appearance. All seven supplied presets pass the same checksum interpretation, providing a cross-check of framing rather than relying on the color name alone. The neutral-white replacement still needs validation on the actual wristband.

## User-linked colorBrute project

The [sueppchen project README](https://github.com/sueppchen/PixMob_waveband/blob/main/README.md) targets a **cement v1.1 RF wristband**, a European 868 MHz setup and a **TI CC1101**. Those particulars belong to that project and do not identify this user's wristband or future RF hardware.

Its [colorBrute/readme.md](https://github.com/sueppchen/PixMob_waveband/blob/main/colorBrute/readme.md) describes six-bit G/R/B values, validity and two checksum fields in brute-force result lists. `confirmValues.py` rechecks results by sending them through that project's separate Arduino serial interface. These are not KY-005 raw IR timings and must not be pasted into WHITE or executed against the currently connected preset sketch. The repository is useful research, but its RF packet/checksum path is not a direct IR replacement.

## Outcome

The issue is a **neutral-white labeling/expectation error in the supplied preset data**. The present audit did not change or upload firmware, issue device commands, or alter wiring. Preserve the legacy waveform for reproducibility; select and separately validate a documented neutral-white IR command before replacing it or claiming neutral-white hardware output. Browser white previews remain simulations rather than color measurements.

## Neutral-white candidate prepared — 12 November 2026

The upstream Flipper file contains no `WHITE` entry, only `WHITISH` and its fade variants, so no captured neutral-white 6-byte frame exists to copy. The original reverse-engineering repository ([effect_definitions.py](https://github.com/danielweidman/pixmob-ir-reverse-engineering/blob/main/python_tools/effect_definitions.py)) does list 9-byte codes named `FAST_WHITE` and `VERY_SLOW_WHITE`; decoded with the same published model they carry **R=204, G=204, B=204** (body bytes `89 89 89`), while `WHITE_FAST_IO_ONCE` and `WHITE_FADE_OUT_ONCE` carry 188/188/188. Those 9-byte codes also set attack/sustain/release fields and take 44.1 ms per frame.

The candidate keeps the exact 6-byte **Display Single Color** framing the wristband already answers for the seven supplied presets and only changes the channel values to the upstream white 204/204/204:

| Candidate | Encoded bytes | Checksum | Slots | Frame | Decoded R/G/B |
| --- | --- | --- | --- | --- | --- |
| `WHITE[]` (new) | `80 69 21 89 89 89` | Valid | 41 | 28.7 ms | 204 / 204 / 204 |
| `WHITISH[]` (previous `WHITE[]`) | `80 62 21 85 89 24` | Valid | 39 | 27.3 ms | 204 / 176 / 92 |

Raw timing array (38 kHz, 700 µs slots):

```text
1400,1400,700,700,1400,700,700,2800,700,1400,700,1400,700,2100,1400,1400,700,2100,1400,1400,700,2100,700
```

Provenance checks, all read-only:

- An independent encoder/decoder written from the published protocol description reproduces every one of the seven supplied timing arrays exactly from their decoded values (round trip) and reproduces the audit table above.
- The candidate's body bytes `89 89 89` are bit-identical to the body bytes of upstream `FAST_WHITE` (`80 A4 21 89 89 89 21 8A 21`), which is the same channel encoding in the longer frame.
- The 41-slot length is a consequence of the checksum byte `0x69`; the firmware's `sendRaw` call takes the array length, so no other code changes.

Firmware status: `firmware/PixMobBeatController/PixMobBeatController.ino` now transmits this candidate for `W`, keeps the previous warm frame verbatim as `WHITISH[]` behind the new `K` command, and prints the exact metadata line `WHITE PRESET: NEUTRAL CANDIDATE (K = WHITISH)` so the website can label White correctly and offer the comparison button. It compiled to `.arduino/white-candidate-build/PixMobBeatController.ino.bin` (310,247 program bytes / 23,696 static RAM bytes, SHA256 `bb9092b038183e2d1872843193cdd53bad858cb6ffa739cf1d90a04eec14ad37`). With the user's authorization later the same evening it was uploaded (application region backed up first, written-data hash verified) and the board printed the metadata line. Two rounds of `python3 scripts/probe-single-pulse.py --all --colors WK --interval 5` completed (W 33.1 / 32.5 ms, K 31.5 / 30.5 ms, no autonomous output). Equal protocol channel values do not guarantee a neutral-looking LED mix, and serial completion is not color evidence: the visual W-versus-K result is the user's observation and should be recorded in the verification log. The user later reported not seeing those single frames; `scripts/probe-white-compare.py` sends each color as a burst of repeated single frames (default six at 0.5 s spacing, two rounds, with a countdown) for an easier side-by-side look, and ran after the board was reconnected (24 frames completed). The user then compared the two website buttons directly and reported the candidate **visibly whiter** than the original WHITISH frame (13 November 2026). That is a comparative observation on one wristband, not a calibrated measurement of neutrality; it closes the labeling error that this audit identified, while `K` keeps the original frame available for reference. If the candidate is not received at all, the previous application binary `2ec5efac…9101f4` and the backup remain available for restoring the earlier behavior.

**Later on 13 November 2026:** the user reported that single quick flashes of White (204/204/204), Warm white (WHITISH) and Green were weak and looked alike on the wristband, while Red, Blue, Yellow and Cyan were bright. The firmware source therefore sends White as 124/124/124 (equal channels, the value that stayed lit in the hold tests) and Warm white as the WHITISH hue at 124/108/56; the original arrays are kept in `firmware/PixMobBeatController/OriginalFrames.h` for reference only. Details, the decoded values and the upload state are at the end of `docs/VERIFICATION.md`.
