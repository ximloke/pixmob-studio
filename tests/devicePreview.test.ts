import test from "node:test";
import assert from "node:assert/strict";
import { deviceBeatPulse } from "../src/lib/devicePreview";

test("device preview never pulses from amplitude alone or a stale beat", () => {
  for (const time of [1000, 1500, 2000, 10000]) {
    assert.equal(deviceBeatPulse(time, 0, 1, 40), 0);
    assert.equal(deviceBeatPulse(time, time - 1000, 1, 40), 0);
  }
  assert.equal(deviceBeatPulse(1000, 1100, 1, 40), 0);
  assert.equal(deviceBeatPulse(1000, 900, NaN, 40), 0);
});

test("one measured beat creates one bounded decay, and only another beat restarts it", () => {
  const at = 10000;
  const frames = [0, 70, 140, 280, 560, 901].map((age) =>
    deviceBeatPulse(at + age, at, 0.1, 40),
  );
  assert.equal(frames[0], 1);
  assert(frames.every((v) => v >= 0 && v <= 1));
  assert(frames.every((v, i) => i === 0 || v < frames[i - 1]));
  assert.equal(frames.at(-1), 0);
  assert(
    deviceBeatPulse(at + 733, at + 733, 0.01, 10) >
      deviceBeatPulse(at + 733, at, 1, 40),
  );
});
