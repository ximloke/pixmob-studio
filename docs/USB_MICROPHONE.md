# Connect an existing ESP32 microphone-test sketch

PixMob Studio can read test sketches that print `Sound Level: N` or `Level:N Threshold:N Beat:0|1` at 115200 baud. This path preserves the sketch already installed on the ESP32; it does not flash or install the controller firmware.

1. Connect the CP2102 ESP32 with a data-capable USB cable.
2. Close Arduino Serial Monitor and any other serial terminal so the port is free.
3. Open `http://localhost:5173` in desktop Chrome (or another browser that supports Web Serial).
4. Select **Connect device → Connect with Web Serial**, choose **CP2102 / usbserial-0001**, and connect.
5. When recognized, the console switches to **Advanced DJ → ESP32 USB microphone · live level**. Look for **ESP32 USB connected**, **ESP32 USB LIVE**, and changing **RAW LEVEL** readings.
6. Enable **Music Sync** to modulate the virtual wristband from the ESP32 level. Sensitivity adjusts preview gain. The raw reading remains unchanged.

The input parser accepts integer amplitude readings from 0–32768. The music-sync test format also validates threshold 0–65535 and beat 0 or 1; these fields do not grant controller capabilities or imply BPM/spectrum analysis. For the current test sketch, the value is the mean absolute amplitude of the signed upper 16 bits of I2S samples. The displayed preview level applies gain and is not a calibrated sound-pressure measurement.

This sketch supplies amplitude, not raw PCM audio. The console therefore shows a level meter and does not fabricate FFT bands, BPM, beats or drops for this source. Choose browser microphone or shared audio for spectrum analysis. The microphone-test sketch has no Wi-Fi API or lighting-command handler, so IR, RF and controller commands remain unavailable.

The initial connection probes for the JSON controller API; if no controller status reply arrives but valid recent `Sound Level` samples are observed, the app explicitly identifies the read-only microphone-test mode. A controller JSON reply takes precedence. Unsupported control commands are rejected in this mode.

The observed current microphone-test sketch uses SCK GPIO26, WS GPIO25 and SD GPIO27. The controller firmware now preserves the same pins and reserves GPIO33 for IR instead of sharing GPIO25. Both sketches can use this microphone wiring without changes. Review any IR driver wiring separately before configuring output.

After refreshing the page, reconnect through the button. Disconnect in PixMob Studio before reopening Arduino Serial Monitor. Only one application can use the port at a time.
