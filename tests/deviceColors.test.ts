import test from "node:test";
import assert from "node:assert/strict";
import {
  extraDeviceColors,
  magentaDeviceColor,
  fadeCode,
  FADE_TIMES_MS,
  levelsHex,
  levelsToken,
  MAX_SAVED_COLORS,
  readSavedColors,
  SAVED_COLORS_STORAGE_KEY,
  savedColorsStore,
  snapDeviceLevels,
  validDeviceLevels,
  validFadeMs,
  validSavedColors,
} from "../src/lib/deviceColors.ts";

test("device levels are whole steps of four up to 200 and not near black", () => {
  for (const levels of [[200, 200, 200], [8, 0, 0], [132, 64, 0]])
    assert.equal(validDeviceLevels(levels), true);
  for (const levels of [
    [204, 0, 0],
    [130, 64, 0],
    [4, 4, 4],
    [0, 0, 0],
    [132, 64],
    [132, 64, 0, 0],
    ["132", 64, 0],
    [-4, 64, 0],
    [NaN, 64, 0],
    null,
  ])
    assert.equal(validDeviceLevels(levels), false, JSON.stringify(levels));
  assert.deepEqual(snapDeviceLevels([131, 65, -5]), [132, 64, 0]);
  assert.deepEqual(snapDeviceLevels([999, NaN, 3]), [200, 0, 4]);
  assert.deepEqual(snapDeviceLevels([0, 0, 0]), [8, 0, 0]);
  assert.equal(validDeviceLevels(snapDeviceLevels([1, 2, 3])), true);
});

test("level tokens, swatches, extras and fade codes match the firmware command", () => {
  assert.equal(levelsToken([132, 64, 0]), "=844000");
  assert.equal(levelsToken([200, 8, 160]), "=C808A0");
  assert.equal(levelsHex([100, 50, 0]), "#ff8000");
  assert.equal(levelsHex([124, 124, 124]), "#ffffff");
  for (const extra of [...extraDeviceColors, magentaDeviceColor]) {
    assert.equal(validDeviceLevels(extra.levels), true, extra.name);
    // Pinks with red at 184 and 188 would not stay lit on the wristband.
    assert.ok(extra.levels[0] <= 180, extra.name);
  }
  // Same levels as the firmware's M preset (ColorLevels.h).
  assert.deepEqual(magentaDeviceColor.levels, [180, 76, 120]);
  assert.equal(new Set(extraDeviceColors.map((extra) => extra.name)).size, extraDeviceColors.length);
  // Envelope codes 2 to 7 of the published table.
  assert.deepEqual([...FADE_TIMES_MS], [96, 192, 480, 960, 2400, 3840]);
  assert.deepEqual(FADE_TIMES_MS.map((ms) => fadeCode(ms)), [2, 3, 4, 5, 6, 7]);
  assert.equal(fadeCode(undefined), 0);
  assert.equal(validFadeMs(960), true);
  assert.equal(validFadeMs(1000), false);
  assert.equal(validFadeMs("960"), false);
});

test("saved colors are validated on read and write", () => {
  const good = [{ name: "Sunset", levels: [180, 60, 20] }];
  assert.equal(validSavedColors(good), true);
  assert.deepEqual(
    readSavedColors({ getItem: () => JSON.stringify(good) }),
    good,
  );
  for (const bad of [
    "not json",
    JSON.stringify([{ name: "", levels: [180, 60, 20] }]),
    JSON.stringify([{ name: "x".repeat(25), levels: [180, 60, 20] }]),
    JSON.stringify([{ name: "Bright", levels: [255, 0, 0] }]),
    JSON.stringify({ name: "Sunset" }),
    JSON.stringify(
      Array.from({ length: MAX_SAVED_COLORS + 1 }, () => good[0]),
    ),
  ])
    assert.deepEqual(readSavedColors({ getItem: () => bad }), []);

  const written: [string, string][] = [];
  let notified = 0;
  const unsubscribe = savedColorsStore.subscribe(() => void notified++);
  const storage = {
    setItem: (key: string, value: string) => void written.push([key, value]),
  };
  assert.equal(
    savedColorsStore.set([{ name: "Sunset", levels: [180, 60, 20] }], storage),
    true,
  );
  assert.deepEqual(written, [[SAVED_COLORS_STORAGE_KEY, JSON.stringify(good)]]);
  assert.deepEqual(savedColorsStore.get(), good);
  assert.equal(notified, 1);
  assert.equal(
    savedColorsStore.set([{ name: "Bad", levels: [255, 0, 0] as never }], storage),
    false,
  );
  assert.deepEqual(savedColorsStore.get(), good);
  assert.equal(notified, 1);
  unsubscribe();
});
