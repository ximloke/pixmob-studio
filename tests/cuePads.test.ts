import assert from "node:assert/strict";
import test from "node:test";
import {
  CUE_PAD_STORAGE_KEY,
  defaultCuePads,
  readCuePads,
  saveCuePads,
} from "../src/lib/cuePads";

test("cue pads use a safe eight-pad default bank", () => {
  const pads = readCuePads({ getItem: () => null });
  assert.equal(pads.length, 8);
  assert.deepEqual(pads, defaultCuePads);
  assert.notEqual(pads[0], defaultCuePads[0]);
});

test("cue pads round-trip through browser storage", () => {
  const pads = defaultCuePads.map((pad) => ({ ...pad }));
  pads[0] = { color: "G", mode: "strobe", seconds: 2.5 };
  let stored = "";
  saveCuePads(pads, {
    setItem(key, value) {
      assert.equal(key, CUE_PAD_STORAGE_KEY);
      stored = value;
    },
  });
  assert.deepEqual(readCuePads({ getItem: () => stored }), pads);
});

test("cue pads reject malformed saved settings", () => {
  const malformed = JSON.stringify([{ color: "R", mode: "flash", seconds: 1 }]);
  assert.deepEqual(readCuePads({ getItem: () => malformed }), defaultCuePads);
  assert.throws(
    () =>
      saveCuePads([{ color: "R", mode: "unknown", seconds: 1 }] as never, {
        setItem() {},
      }),
    /invalid/i,
  );

  const impossibleStrobe = defaultCuePads.map((pad) => ({ ...pad }));
  impossibleStrobe[5] = { color: "B", mode: "strobe", seconds: 100 };
  assert.deepEqual(
    readCuePads({ getItem: () => JSON.stringify(impossibleStrobe) }),
    defaultCuePads,
  );
});
