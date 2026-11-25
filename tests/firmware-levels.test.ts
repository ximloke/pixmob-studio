import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("color levels keep the bright flashes bit for bit and stay below the weak-flash level", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "pixmob-levels-test-"));
  try {
    const executable = join(directory, "color-levels-test");
    const compilation = spawnSync(
      process.env.CXX || "c++",
      [
        "-std=c++17",
        "-O2",
        "-Wall",
        "-Wextra",
        "-Werror",
        fileURLToPath(new URL("./color-levels.cpp", import.meta.url)),
        "-o",
        executable,
      ],
      { encoding: "utf8", timeout: 30000 },
    );
    assert.ifError(compilation.error);
    assert.equal(
      compilation.status,
      0,
      `Color level C++ compilation failed:\n${compilation.stdout}${compilation.stderr}`,
    );
    const result = spawnSync(executable, [], { encoding: "utf8", timeout: 5000 });
    assert.ifError(result.error);
    assert.equal(
      result.status,
      0,
      `Color level check failed:\n${result.stdout}${result.stderr}`,
    );
    context.diagnostic(result.stdout.trim());
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the beat controller builds every frame from the shared color levels", () => {
  const sketch = readFileSync(
    fileURLToPath(
      new URL(
        "../firmware/PixMobBeatController/PixMobBeatController.ino",
        import.meta.url,
      ),
    ),
    "utf8",
  );
  // No second table and no stored waveform can drift from ColorLevels.h.
  // Preset letters are resolved in one place for single-character commands;
  // line commands resolve theirs in the tested parser.
  assert.equal(sketch.match(/pixmob::colorLevels\(/g)?.length, 2);
  assert(!/const uint16_t \w+\[\]/.test(sketch));
  assert(!sketch.includes("OriginalFrames.h"));
  // The website still gates K and timed lights on these exact lines.
  assert(
    sketch.includes(
      'Serial.println("WHITE PRESET: NEUTRAL CANDIDATE (K = WHITISH)");',
    ),
  );
  assert(sketch.includes('Serial.println("TIMED LIGHT: READY");'));
});
