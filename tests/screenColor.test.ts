import test from "node:test";
import assert from "node:assert/strict";
import {
  mainScreenColor,
  screenColorLevels,
} from "../src/lib/screenColor.ts";
import { validDeviceLevels } from "../src/lib/deviceColors.ts";
import {
  BrowserBeatOutput,
  setBrowserBeatColors,
  setBrowserBeatScreenSource,
  setFollowScreenColors,
} from "../src/lib/browserBeat.ts";

const pixels = (...colors: [number, number, number][]) =>
  colors.flatMap(([r, g, b]) => [r, g, b, 255]);

test("the main screen color favours vivid bright pixels over a dark background", () => {
  assert.equal(mainScreenColor([]), null);
  assert.equal(mainScreenColor(pixels([0, 0, 0], [0, 0, 0])), null);
  // One red stage light on a mostly black frame is still red.
  const stage = mainScreenColor(
    pixels(...Array.from({ length: 30 }, () => [8, 8, 10] as [number, number, number]), [250, 20, 20], [240, 30, 25]),
  )!;
  assert.ok(stage.red > 200 && stage.green < 60 && stage.blue < 60, JSON.stringify(stage));
  // A vivid blue outweighs the same number of gray pixels.
  const mixed = mainScreenColor(pixels([120, 120, 120], [20, 40, 240]))!;
  assert.ok(mixed.blue > mixed.red + 80, JSON.stringify(mixed));
  const gray = mainScreenColor(pixels([200, 200, 200], [180, 180, 180]))!;
  assert.ok(Math.abs(gray.red - gray.blue) < 1);
});

test("screen colors land on the levels the wristband is known to show", () => {
  const levels = (r: number, g: number, b: number) =>
    screenColorLevels({ red: r, green: g, blue: b });
  // The six pure hues are exactly the firmware's preset levels.
  assert.deepEqual(levels(255, 0, 0), [132, 32, 0]);
  assert.deepEqual(levels(255, 255, 0), [132, 124, 0]);
  assert.deepEqual(levels(0, 255, 0), [88, 164, 0]);
  assert.deepEqual(levels(0, 255, 255), [68, 184, 160]);
  assert.deepEqual(levels(0, 0, 255), [16, 12, 160]);
  assert.deepEqual(levels(255, 0, 255), [180, 76, 120]);
  // In between: orange sits between red and yellow.
  assert.deepEqual(levels(255, 128, 0), [132, 80, 0]);
  // Dim but colored frames keep their hue; the wristband has one brightness.
  assert.deepEqual(levels(80, 0, 0), [132, 32, 0]);
  // Dark frames have no color; bright colorless ones are white.
  assert.equal(levels(20, 10, 10), null);
  assert.equal(levels(0, 0, 0), null);
  assert.deepEqual(levels(230, 225, 220), [124, 124, 124]);
  assert.equal(screenColorLevels(null), null);
  assert.equal(levels(NaN, 0, 0), null);
  // Every result is a color the firmware accepts.
  for (let r = 0; r <= 255; r += 51)
    for (let g = 0; g <= 255; g += 51)
      for (let b = 0; b <= 255; b += 51) {
        const result = levels(r, g, b);
        if (result) assert.equal(validDeviceLevels(result), true, `${r},${g},${b}`);
      }
});

test("browser beats take the video color when following and the palette otherwise", async () => {
  const sent: unknown[] = [];
  const transport = {
    command: async (_op: string, payload: unknown) => void sent.push(payload),
  };
  const output = new BrowserBeatOutput(transport as never, () => {});
  const input = { source: "system" as const, active: true };
  let now = 1000;
  const beat = async () => {
    output.process({ beat: true, level: 0.8 } as never, (now += 300), input);
    output.process({ beat: false, level: 0.1 } as never, (now += 10), input);
    await new Promise((resolve) => setImmediate(resolve));
  };
  let frame: [number, number, number] | null = [132, 32, 0];
  try {
    setBrowserBeatColors(["Y", "C"]);
    setBrowserBeatScreenSource(() => frame);
    output.enable();
    await beat(); // not following yet: palette
    setFollowScreenColors(true);
    await beat(); // follows the frame
    frame = null;
    await beat(); // dark frame: palette continues where it was
    frame = [16, 12, 160];
    await beat();
    setBrowserBeatScreenSource(() => {
      throw new Error("capture failed");
    });
    await beat(); // a failing source falls back to the palette
    setFollowScreenColors(false);
    setBrowserBeatScreenSource(() => [132, 32, 0]);
    await beat();
    assert.deepEqual(sent, [
      { color: "Y" },
      { color: "=842000" },
      { color: "C" },
      { color: "=100CA0" },
      { color: "Y" },
      { color: "C" },
    ]);
  } finally {
    setFollowScreenColors(false);
    setBrowserBeatScreenSource(null);
    setBrowserBeatColors([]);
  }
});
