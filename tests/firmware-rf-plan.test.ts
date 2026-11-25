import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const firmware = (path: string) => fileURLToPath(new URL(`../firmware/${path}`, import.meta.url));

test("RF copy of each IR frame carries the same fields, ends with the IR frame, repeats only while the light shows, and keeps bands awake only while nothing shows", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "pixmob-rf-plan-test-"));
  try {
    const executable = join(directory, "pixmob-rf-plan-test");
    const compilation = spawnSync(
      process.env.CXX || "c++",
      [
        "-std=c++17",
        "-O2",
        "-Wall",
        "-Wextra",
        "-Werror",
        fileURLToPath(new URL("./rf-plan.cpp", import.meta.url)),
        "-o",
        executable,
      ],
      { encoding: "utf8", timeout: 30000 },
    );
    assert.ifError(compilation.error);
    assert.equal(
      compilation.status,
      0,
      `RF plan C++ compilation failed:\n${compilation.stdout}${compilation.stderr}`,
    );
    const result = spawnSync(executable, [], { encoding: "utf8", timeout: 5000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `RF plan check failed:\n${result.stdout}${result.stderr}`);
    context.diagnostic(result.stdout.trim());
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the controller's RF headers are the bench test's, and every IR frame goes through the RF copy", () => {
  for (const header of ["PixMobRFFrame.h", "PixMobRFLimits.h"]) {
    assert.equal(
      readFileSync(firmware(`PixMobBeatController/${header}`), "utf8"),
      readFileSync(firmware(`PixMobRFTest/${header}`), "utf8"),
      `${header} copies differ`,
    );
  }
  const sketch = readFileSync(firmware("PixMobBeatController/PixMobBeatController.ino"), "utf8");
  const sends = sketch.match(/IrSender\.sendRaw\(/g) ?? [];
  assert.equal(sends.length, 1, "IrSender.sendRaw is called in one place");
  const transmit = sketch.slice(sketch.indexOf("void transmitLight("));
  assert.ok(
    transmit.slice(0, transmit.indexOf("\n}\n")).includes("IrSender.sendRaw("),
    "that place is transmitLight",
  );
});
