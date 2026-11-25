import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("timed-light re-send plan covers each duration without gaps", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "pixmob-light-plan-test-"));
  try {
    const executable = join(directory, "light-plan-test");
    const compilation = spawnSync(
      process.env.CXX || "c++",
      [
        "-std=c++17",
        "-O2",
        "-Wall",
        "-Wextra",
        "-Werror",
        fileURLToPath(new URL("./light-plan.cpp", import.meta.url)),
        "-o",
        executable,
      ],
      { encoding: "utf8", timeout: 30000 },
    );
    assert.ifError(compilation.error);
    assert.equal(
      compilation.status,
      0,
      `Light plan C++ compilation failed:\n${compilation.stdout}${compilation.stderr}`,
    );
    const result = spawnSync(executable, [], { encoding: "utf8", timeout: 5000 });
    assert.ifError(result.error);
    assert.equal(
      result.status,
      0,
      `Light plan check failed:\n${result.stdout}${result.stderr}`,
    );
    context.diagnostic(result.stdout.trim());
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the beat controller ships the same tested frame builder as the hold test sketch", () => {
  const read = (path: string) =>
    readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
  assert.equal(
    read("../firmware/PixMobBeatController/PixMobFrame.h"),
    read("../firmware/PixMobHoldColorTest/PixMobFrame.h"),
  );
  const sketch = read(
    "../firmware/PixMobBeatController/PixMobBeatController.ino",
  );
  // Capability line and acknowledgement text the website depends on.
  assert(sketch.includes('Serial.println("TIMED LIGHT: READY");'));
  assert(sketch.includes('Serial.print("Light: ");'));
  assert(sketch.includes('Serial.println("CUSTOM LIGHT: READY");'));
  assert(sketch.includes('Serial.println("RAINBOW: READY");'));
  assert(sketch.includes('Serial.println("BEAT EFFECTS: READY");'));
  assert(sketch.includes('Serial.println("BEAT STYLE: F");'));
  assert(sketch.includes('Serial.println("IDLE RETURN: READY");'));
  assert(sketch.includes('Serial.println("IDLE RAINBOW: OFF");'));
  assert(sketch.includes('Serial.println("IDLE RAINBOW: ON");'));
  assert(sketch.includes('Serial.printf("IDLE RAINBOW: ON %u\\n", unsigned(idleSeconds));'));
  // Any serial byte, even a bare carriage return, restarts the idle wait.
  assert(sketch.includes("lastInput = millis();"));
  assert(sketch.includes('now - lastAuto >= autoInterval()'));
  assert(sketch.includes('Serial.printf("Rainbow: %lu %lu\\n"'));
  assert(sketch.includes('Serial.println("STROBE: READY");'));
  assert(sketch.includes('job.strobe == 2 ? "Build: " : "Strobe: "'));
});

test("strobe and build schedules stay inside their duration and never outrun the frame time", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "pixmob-strobe-plan-test-"));
  try {
    const executable = join(directory, "strobe-plan-test");
    const compilation = spawnSync(
      process.env.CXX || "c++",
      [
        "-std=c++17",
        "-O2",
        "-Wall",
        "-Wextra",
        "-Werror",
        fileURLToPath(new URL("./strobe-plan.cpp", import.meta.url)),
        "-o",
        executable,
      ],
      { encoding: "utf8", timeout: 30000 },
    );
    assert.ifError(compilation.error);
    assert.equal(
      compilation.status,
      0,
      `Strobe plan C++ compilation failed:\n${compilation.stdout}${compilation.stderr}`,
    );
    const result = spawnSync(executable, [], { encoding: "utf8", timeout: 5000 });
    assert.ifError(result.error);
    assert.equal(
      result.status,
      0,
      `Strobe plan check failed:\n${result.stdout}${result.stderr}`,
    );
    context.diagnostic(result.stdout.trim());
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("line commands parse strictly and faded lights chain without gaps", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "pixmob-light-command-test-"));
  try {
    const executable = join(directory, "light-command-test");
    const compilation = spawnSync(
      process.env.CXX || "c++",
      [
        "-std=c++17",
        "-O2",
        "-Wall",
        "-Wextra",
        "-Werror",
        fileURLToPath(new URL("./light-command.cpp", import.meta.url)),
        "-o",
        executable,
      ],
      { encoding: "utf8", timeout: 30000 },
    );
    assert.ifError(compilation.error);
    assert.equal(
      compilation.status,
      0,
      `Light command C++ compilation failed:\n${compilation.stdout}${compilation.stderr}`,
    );
    const result = spawnSync(executable, [], { encoding: "utf8", timeout: 5000 });
    assert.ifError(result.error);
    assert.equal(
      result.status,
      0,
      `Light command check failed:\n${result.stdout}${result.stderr}`,
    );
    context.diagnostic(result.stdout.trim());
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rainbow frames follow the preset colors in even steps and never repeat a command", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "pixmob-rainbow-plan-test-"));
  try {
    const executable = join(directory, "rainbow-plan-test");
    const compilation = spawnSync(
      process.env.CXX || "c++",
      [
        "-std=c++17",
        "-O2",
        "-Wall",
        "-Wextra",
        "-Werror",
        fileURLToPath(new URL("./rainbow-plan.cpp", import.meta.url)),
        "-o",
        executable,
      ],
      { encoding: "utf8", timeout: 30000 },
    );
    assert.ifError(compilation.error);
    assert.equal(
      compilation.status,
      0,
      `Rainbow plan C++ compilation failed:\n${compilation.stdout}${compilation.stderr}`,
    );
    const result = spawnSync(executable, [], { encoding: "utf8", timeout: 5000 });
    assert.ifError(result.error);
    assert.equal(
      result.status,
      0,
      `Rainbow plan check failed:\n${result.stdout}${result.stderr}`,
    );
    context.diagnostic(result.stdout.trim());
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
