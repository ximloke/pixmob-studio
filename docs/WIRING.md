# Wiring and hardware boundaries

Use the GPIO labels printed on the actual ESP32 DevKit V1. A 38-pin layout varies between carrier-board vendors; do not count header positions from an unrelated diagram. The CP2102 is the USB-to-UART bridge.

## Pin plan

This controller configuration preserves the user's working microphone wiring: SCK 26, WS 25 and SD 27. IR is reserved on GPIO33 so it cannot conflict with microphone WS. No microphone rewiring is required. An IR emitter must use the separately verified GPIO33 driver circuit; GPIO25 is now exclusively microphone WS.

| Function                   | ESP32 GPIO / supply | Connection                                                                |
| -------------------------- | ------------------- | ------------------------------------------------------------------------- |
| IR envelope/carrier output | GPIO33              | Input of a verified active-high IR driver circuit                         |
| INMP441 BCLK / SCK         | GPIO26              | Microphone SCK                                                            |
| INMP441 WS / LRCLK         | GPIO25              | Microphone WS                                                             |
| INMP441 SD                 | GPIO27              | Microphone SD                                                             |
| INMP441 L/R                | GND                 | Left I2S slot, matching firmware `I2S_STD_SLOT_LEFT`                      |
| INMP441 VDD                | 3V3                 | 3.3 V supply only; place 100 nF decoupling close to module if not present |
| Common ground              | GND                 | ESP32, microphone and IR driver ground                                    |
| Optional TFT SCK           | GPIO18 reserved     | Confirm controller and module pin labels                                  |
| Optional TFT MOSI / SDA    | GPIO23 reserved     | SPI data, not I²C                                                         |
| Optional TFT CS            | GPIO21 reserved     | Chip select                                                               |
| Optional TFT DC / A0       | GPIO22 reserved     | Data/command                                                              |
| Optional TFT RESET         | GPIO19 reserved     | Display reset                                                             |
| CC1101 (wired 2026-11-16)   | GPIO18/23/19/5/4/22 | See RF below; driven by `firmware/PixMobRFTest/` and, since 20 November, by the beat controller's RF copy (GDO2 unused) |

If you later choose GPIO34 for a different configuration, it has **no internal pull-up or pull-down** and cannot be used as an output. Avoid GPIO6–11 (typically connected to flash), and leave GPIO0/2/5/12/15 boot-strapping behavior undisturbed. Confirm board-specific restrictions before changing pins in `firmware/PixMobStudio/Config.h`. GPIO UART0 is used by CP2102 and should remain free for uploads and Web Serial. GPIO characteristics and supply limits are described in the [ESP32 datasheet](https://www.espressif.com/sites/default/files/documentation/esp32_datasheet_en.pdf).

```text
ESP32                    INMP441
3V3 -------------------- VDD
GND -------------------- GND, L/R
GPIO26 ----------------- SCK
GPIO25 ----------------- WS
GPIO27 <---------------- SD

ESP32 GPIO33 ---> verified active-high driver ---> KY-005 IR emitter
ESP32 GND -------------------------------------> driver ground
```

## KY-005 transmitter

KY-005 boards vary in resistor placement, pin labels, LED current and whether a current driver is present. A KY-005 label alone is not sufficient evidence that a board can be driven directly by a 3.3 V GPIO.

1. Confirm the exact module schematic and identify its signal, supply and ground pins. Measure or calculate IR LED current using the actual LED forward voltage, supply voltage, series resistor and driver voltage drop.
2. Use a transistor/MOSFET current driver when the emitter current exceeds the GPIO rating. For an active-high NPN low-side stage: GPIO33 through a suitable base resistor to the base, emitter to GND, collector to the LED cathode, and LED anode through a correctly sized current-limiting resistor to its permitted supply. Include a base-to-emitter pull-down. A suitable logic-level MOSFET is another option, with a gate resistor and pull-down.
3. Do not place a bare LED across a supply or assume an onboard resistor exists. Confirm current, duty-cycle and thermal ratings for your actual parts. Do not feed a 5 V signal back into an ESP32 GPIO.
4. Keep the IR load disconnected while verifying logic-level waveforms with an oscilloscope/logic analyzer. Confirm idle LOW, active-high carrier, carrier frequency, duty, mark/space timing, repetitions and gaps.
5. Attach the emitter only after the driver measurements pass. A camera may show IR emission, but cannot verify carrier frequency, timing or protocol compatibility.

The software carrier range and duty limits are input bounds, not an electrical design for an unknown KY-005 board. The firmware currently supports an active-high driver. An inverting driver requires an explicitly verified firmware adaptation; do not compensate by guessing protocol parameters.

## INMP441

Use a Philips-standard I2S microphone, 16 kHz sample rate and 32-bit slots. The code reads the left slot and scales the signed upper 24 bits. Keep I2S wiring short. Confirm that clap/music input changes `micLevel`; `micInitialized` only confirms driver initialization, and nonzero data alone does not establish correct wiring. A microphone may report tiny idle noise; adjust sensitivity using the observed level.

## Optional 1.44-inch SPI TFT

Display size does not specify its controller, resolution, initialization sequence, power voltage or backlight drive. Confirm those details before connecting it. The SPI GPIOs above are a suggested reservation that does not conflict with the current IR/I2S plan. Check whether the module accepts 3.3 V logic and whether its backlight needs a separate current-limited driver. Do not power an unknown backlight from a GPIO.

Implement `DisplayAdapter` in `Integration.h` using the confirmed controller library, set the global `display` pointer before `setup()`, and render only the supplied snapshot at the existing 4 Hz update interval. Default firmware makes no TFT calls and reports `displaySupported: false`.

## RF

**CC1101 pin plan (2026-11-16).** The user received a CC1101 module. Planned connection, by the module's printed labels (pin order differs between boards): VCC → **3V3 only** (the CC1101 is rated to 3.6 V; never 5 V / VIN), GND → GND, SCK → GPIO18, MOSI/SI → GPIO23, MISO/SO/GDO1 → GPIO19, CSN → GPIO5, GDO0 → GPIO4, GDO2 → GPIO22. These are the ESP32 VSPI pins plus two free GPIOs; they do not touch IR GPIO32 or the microphone on GPIO26/25/27. They take GPIO19 and GPIO22 from the optional TFT reservation above, so a TFT would need other RESET and DC pins. Keep the antenna that matches the module's band attached.

**The module the user has (photos, 2026-11-16):** a blue board printed **433M** and **V2.0**, with an SMA antenna and a 2×4 header numbered 1–8 (front, chip side up, antenna at the top: upper row 2, 4, 6, 8 and lower row 1, 3, 5, 7 from left to right; pin 1 has the square pad). The board carries no function labels. The pinout commonly published for this board is 1 GND, 2 VCC, 3 GDO0, 4 CSN, 5 SCK, 6 MOSI, 7 MISO, 8 GDO2, so the connection is 1→GND, 2→3V3, 3→GPIO4, 4→GPIO5, 5→GPIO18, 6→GPIO23, 7→GPIO19, 8→GPIO22. That pinout comes from the board's usual documentation; the read-only check in `firmware/CC1101Check/` confirmed it on 16 November 2026 (chip ID, reset defaults, GDO0 clock and GDO2 level all correct). The header is easy to connect mirror-image from the pin side: count from the square pin-1 pad. This board is designed for 433 MHz. TI uses different matching networks for 433 MHz and 868/915 MHz, so software tuning alone does not make this a high-band module. [TI CC1101 datasheet §7.2](https://www.ti.com/lit/ds/symlink/cc1101.pdf#page=23)

**Regional samples:** PixMob describes Waveband as an RF family. Public teardown reports show the CEMENT V1.1r3 marking on boards with both 24.8117 MHz and 26.1522 MHz crystals. The sueppchen project documents those references in its 868/915 MHz samples. The board revision and case label do not identify the receiver frequency. [PixMob Waveband](https://pixmob.com/products/led-wristbands/waveband), [V1.1r3 teardown reports](https://github.com/danielweidman/pixmob-ir-reverse-engineering/issues/64), [sueppchen RF notes](https://github.com/sueppchen/PixMob_waveband/wiki/RF)

**User's Wave2 Gen 3, reassessed 20 November 2026:** the photos show CEMENT V1.1r3 (20241126), X1 marked **27.138266 MHz**, and U1 marked **004 2623JQ0462**. HopeRF AN151 gives **27.13827 MHz for 433.92 MHz** with the CMT2210B/LA configuration, a match to the photographed marking within 4 Hz at the precision shown. The CMT2210/17LB datasheet also lists 27.1383 MHz for 433.92 MHz. This made **433.92 MHz the leading candidate**. RF tests later that day changed this: the band responded only within about 2–3 cm at 433.92 MHz, but from 3 m at 922.36 MHz (below). U1 and its configuration have not been identified. The earlier 433.87 and 949.5 MHz calculations both assumed an LH-family receiver and specific synthesizer settings. A round calculated value and the negative RF trial do not verify those assumptions. The 949.5 MHz hypothesis is outside the CC1101's specified bands. [HopeRF AN151 §2.2](https://www.hoperf.com/uploads/HOPERF_AN151_CMT2210BW-CMT2210LAW_Configuration_Guideline_1695689066.pdf#page=5), [HopeRF CMT2210/17LB datasheet table 4](https://www.hoperf.com/uploads/CMT2210LB_2217LB_2217B_Datasheet_EN_V1.0_202410_1730440713.pdf#page=6), [TI CC1101 datasheet](https://www.ti.com/lit/ds/symlink/cc1101.pdf)

**RF test, 16 November 2026 (inconclusive):** `firmware/PixMobRFTest/` sent public-protocol colour frames (group 0, mode 0 only) at 433.70–434.10 MHz / 0 dBm and across 433.10–434.70 MHz / 10 dBm; the band showed nothing, but it did not answer an IR red either, so the band was not working at the time. **Valid run, 20 November 2026:** with the band lighting from IR in the same position before and after, the same frames across 433.10–434.70 MHz at 10 dBm (one every 100 ms) did not light it. The band frequency, its protocol and whether the CC1101 radiated are still not separated. Details in [verification](VERIFICATION.md).

**Published 868/915 MHz captures (checked 20 November 2026):** every frame in [danielweidman `rf/`](https://github.com/danielweidman/pixmob-ir-reverse-engineering/tree/main/rf), including 2023 and 2024 venue recordings, decodes with this project's line code and CRC. The measured bit is about 512 µs, venue transmitters send a frame about every 50 ms and repeat each colour many times, and a sleeping band needs up to about 30 s of valid frames before it reacts. A wake followed by a repeated colour had not been sent at 433.92 MHz; `Z` in `PixMobRFTest` does that. The repository has no 433 MHz data. Details in [verification](VERIFICATION.md).

**RF control at 433.92 MHz, 20 November 2026 (user observation): only within about 2–3 cm.**
- `Z` lit the band red at 10 dBm in its test position: 35 s of the published "nothing" frame, then the published red frame, one frame every 50 ms with 512 µs bits, GDO0 driven only by the ESP32. 0 dBm did not light it at 10–20 cm.
- Once the band was awake, 5 s bursts of green, blue and red lit it without a new wake. 90 s of red frames alone did not wake it (one trial).
- In a range walk at 10 dBm the band stayed lit only within about 2–3 cm of the antenna. At about 1 m neither 10 dBm nor 0 dBm lit it.
- After a USB unplug, the same binary stopped working until the CC1101 was rewired. Every transmission now checks the GDO0 wire first and monitors the TX state.
- A receiver tuned to 433.92 MHz should respond over metres at 10 dBm. The 2–3 cm range suggests the band is not receiving through a front-end tuned to 433.92 MHz, and the strong field close to the antenna is getting in. With the LH-family formula, integer N gives 433.873 (N=16), 868.085 (N=32), 922.362 (N=34) and 949.500 MHz (N=35). 922.36 MHz lies in the 920–925 MHz bands used across Asia-Pacific (Malaysia 919–923 MHz). Tested below. Details in [verification](VERIFICATION.md).

**Malaysian rules for 919–923 MHz (checked 20 November 2026):**
- [MCMC Class Assignment No. 1 of 2025](https://www.mcmc.gov.my/skmmgovmy/media/General/registers/Class%20Assignment/Class-Assignment-No-1-of-2025.pdf), Second Schedule, Table 2-1 item 10: SRD 919–923 MHz at up to 500 mW EIRP, with no duty-cycle condition.
  - Duty-cycle, hopping or LBT conditions apply only to 916–919 and 923–924 MHz.
  - The 2 W ERP row is RFID.
  - 10 dBm (10 mW) is far below the limit.
- Paragraph 4(a)(viii) of the same document requires certified, labelled devices in class-assignment bands. Special approval is available for research and development.
  - This applies to 433–435 MHz as much as to 919–923 MHz.
  - The home-built CC1101 board is not certified. The user knew this and asked for the test.
- The CC1101 chip covers 779–928 MHz. This board's matching network is designed for 433 MHz, so its output at 922 MHz is lower by an unmeasured amount.

**RF control at 922.36 MHz, 20 November 2026 (user observation): lit from 30 cm, 1 m and 3 m.**
- Only the frequency changed from the 433.92 MHz tests: same band, battery, CC1101 board, antenna, `Z` frames (35 s "nothing", then 5 s red) and 10 dBm setting. TI's 915 MHz PATABLE value was used (0xC0 for 10 dBm).
- At 922.360 MHz the band lit red at about 30 cm, 1 m and 3 m, one trial each. Right afterwards, at 433.92 MHz with the band at about 30 cm, it did not light.
- So the band receives near 922.36 MHz: N = 34 in the LH-family formula, inside Malaysia's 919–923 MHz SRD band. The 2–3 cm response at 433.92 MHz was most likely near-field pickup.
- 3 m is a lower bound: nothing farther was tried, and this 433 MHz board radiates less at 922 MHz. The exact centre frequency and bandwidth were not measured.
- `PixMobRFTest` now allows only 433.10–434.70 MHz and 919.10–922.90 MHz, each at least 0.1 MHz inside a Malaysian SRD band, at most 10 dBm, with TI's PATABLE value for the band (`PixMobRFLimits.h`). Details in [verification](VERIFICATION.md).

**RF copy in the beat controller, 20–21 November 2026 (user's request, certification condition known):** every IR light also goes out at 922.36 MHz, 10 dBm, the RF frame repeated up to 3 times 50 ms apart, with keep-awake "nothing" bursts every 2 s between commands (`@R1`/`@R0`, `@RW`, `@RK`). With the band awake and IR blocked, single flashes lit 5/5, also after 90 s of quiet; with IR unblocked, IR+RF looked the same as IR alone. After 14 s with RF off the band needed more than 13 s of RF to respond. Details in [verification](VERIFICATION.md).

**INMP441:** the user reported on 20 November that the microphone **has been removed**; the controller still starts and reads level 0. Mic Music mode needs it reconnected on 26 / 25 / 27.

**Next steps:**
- Whether a "nothing"-only wake wakes a sleeping band from this controller, and how much later an RF-only band lights than an IR band.
- Range from the controller, more than one band, the usable frequency span within 919.10–922.90 MHz.
- A 868/915 MHz CC1101 board on the same wiring would be the proper transmitter for this band.
