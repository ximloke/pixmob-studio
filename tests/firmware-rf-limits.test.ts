import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("RF bench test transmits only at 433.10-434.70 and 919.10-922.90 MHz, at most 10 dBm, with TI's PATABLE value for each band", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "pixmob-rf-limits-test-"));
  try {
    const executable = join(directory, "pixmob-rf-limits-test");
    const compilation = spawnSync(
      process.env.CXX || "c++",
      [
        "-std=c++17",
        "-O2",
        "-Wall",
        "-Wextra",
        "-Werror",
        fileURLToPath(new URL("./rf-limits.cpp", import.meta.url)),
        "-o",
        executable,
      ],
      { encoding: "utf8", timeout: 30000 },
    );
    assert.ifError(compilation.error);
    assert.equal(
      compilation.status,
      0,
      `RF limits C++ compilation failed:\n${compilation.stdout}${compilation.stderr}`,
    );
    const result = spawnSync(executable, [], { encoding: "utf8", timeout: 5000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `RF limits check failed:\n${result.stdout}${result.stderr}`);
    context.diagnostic(result.stdout.trim());
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
