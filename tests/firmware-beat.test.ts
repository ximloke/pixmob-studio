import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("portable ESP32 beat detector follows synthetic audio onsets without a generated beat clock", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "pixmob-beat-test-"));
  try {
    const executable = join(directory, "beat-detector-test");
    const compiler = process.env.CXX || "c++";
    const compilation = spawnSync(
      compiler,
      [
        "-std=c++17",
        "-O2",
        "-Wall",
        "-Wextra",
        "-Werror",
        fileURLToPath(new URL("./beat-detector.cpp", import.meta.url)),
        "-o",
        executable,
      ],
      { encoding: "utf8", timeout: 20000 },
    );
    assert.ifError(compilation.error);
    assert.equal(
      compilation.status,
      0,
      `Beat detector C++ compilation failed:\n${compilation.stdout}${compilation.stderr}`,
    );
    const result = spawnSync(executable, [], {
      encoding: "utf8",
      timeout: 5000,
    });
    assert.ifError(result.error);
    assert.equal(
      result.status,
      0,
      `Synthetic audio verification failed:\n${result.stdout}${result.stderr}`,
    );
    context.diagnostic(result.stdout.trim());
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
