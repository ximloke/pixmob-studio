// Host test for LightCommand.h (line command parser) and the faded light
// plan in LightPlan.h.
#include <cstdio>
#include <string>
#include <vector>
#include "../firmware/PixMobBeatController/LightCommand.h"

static int failures = 0;
static void expect(bool condition, const char* label) {
  if (!condition) { std::printf("FAIL: %s\n", label); ++failures; }
}

int main() {
  using namespace pixmob;
  LightCommand c;

  // Earlier forms keep their meaning.
  expect(parseLightCommand("#R1500", c) && c.kind == '#' && c.color == 'R' && c.ms == 1500 &&
             c.levels.red == 132 && c.levels.green == 32 && c.attack == 0 && c.release == 0,
         "#R1500");
  expect(parseLightCommand("!W2000", c) && c.kind == '!' && c.color == 'W' && c.ms == 2000, "!W2000");
  expect(parseLightCommand("^M60000", c) && c.kind == '^' && c.ms == 60000, "^M60000");

  // Custom levels, flash line and fades.
  expect(parseLightCommand(".=844000", c) && c.kind == '.' && c.color == '=' &&
             c.levels.red == 0x84 && c.levels.green == 0x40 && c.levels.blue == 0,
         ".=844000");
  expect(parseLightCommand(".G", c) && c.color == 'G' && c.levels.green == 164, ".G");
  expect(parseLightCommand("#=C8C8C8,600000", c) == false, "comma is not a time separator");
  expect(parseLightCommand("#=C8C8C8600000", c) && c.ms == 600000 && c.levels.red == 200, "max levels and time");
  expect(parseLightCommand("#B2000,5,7", c) && c.attack == 5 && c.release == 7 && c.ms == 2000, "fade codes");
  expect(parseLightCommand("#=084400100,0,6", c) && c.ms == 100 && c.attack == 0 && c.release == 6, "custom with fade out");
  expect(parseLightCommand("!=440044500", c) && c.kind == '!' && c.ms == 500 && c.levels.blue == 0x44, "custom strobe");

  const char* rejected[] = {
    "", "#", "#R", "#R49", "#R600001", "#R0150", "#R1500 ", "#R1500,5", "#R1500,5,", "#R1500,8,1",
    "#R1500,1,8", "#R1500,1,2,3", "#X1500", "#=C9000050", "#=00000050", "#=04040050", "#=GG000050",
    "#=FF50", "!W199", "!W60001", "!W2000,1,1", "^W", ".R1", ".", ".=1234", ".=C80000X", "R", "$R100",
    "#R1234567",
  };
  for (const char* line : rejected) {
    if (parseLightCommand(line, c)) { std::printf("FAIL: accepted '%s'\n", line); ++failures; }
  }

  // Faded lights: frames, fades on the right frames, no gaps.
  struct Case { uint32_t ms; uint8_t attack, release; };
  const std::vector<Case> cases = {{50, 0, 0}, {100, 5, 5}, {300, 2, 7}, {1000, 4, 0}, {2500, 0, 6},
                                   {5000, 7, 7}, {10000, 3, 5}, {600000, 6, 6}};
  for (const Case& item : cases) {
    FadedLight light = beginFadedLight(item.ms, item.attack, item.release);
    LightPlan plain = beginLight(item.ms);
    std::vector<LightFrameSpec> frames;
    LightFrameSpec frame;
    while (nextFadedFrame(light, frame)) {
      frames.push_back(frame);
      if (frames.size() > 400) break;
    }
    std::vector<uint32_t> plainTimes;
    uint32_t at = 0;
    while (nextLightFrame(plain, at)) plainTimes.push_back(at);
    expect(frames.size() == plainTimes.size() && !frames.empty(), "same frame count as the plain light");
    const uint32_t fadeIn = SUSTAIN_MS[item.attack];
    for (size_t i = 0; i < frames.size(); ++i) {
      const LightFrameSpec& f = frames[i];
      expect(f.atMs == (i == 0 ? 0 : fadeIn + plainTimes[i]), "frames move back by the fade in");
      expect(f.attack == (i == 0 ? item.attack : 0), "only the first frame fades in");
      expect(f.sustain >= 1 && f.sustain <= 6, "sustain code avoids 0 and 7");
      expect(f.release >= 1 && f.release <= 7, "release is never 0");
      expect(f.varied == bool(i & 1), "alternate frames are varied");
      const bool last = i + 1 == frames.size();
      if (last && item.release) expect(f.release == item.release, "last frame fades out");
      else expect(f.release == (f.varied ? 2 : 1), "other frames keep the short release");
      if (i > 0) {
        // The next frame arrives while the previous one is still lit.
        const uint32_t previousEnd = frames[i - 1].atMs + SUSTAIN_MS[frames[i - 1].attack] + SUSTAIN_MS[frames[i - 1].sustain];
        expect(f.atMs + 40 <= previousEnd, "no gap between chained frames");
      }
    }
    const LightFrameSpec& lastFrame = frames.back();
    const uint32_t litEnd = lastFrame.atMs + SUSTAIN_MS[lastFrame.attack] + SUSTAIN_MS[lastFrame.sustain];
    const uint32_t wanted = fadeIn + item.ms;
    // Same tolerance as the plain plan: frames cannot be closer than 60 ms.
    if (frames.size() > 1) expect(litEnd >= wanted && litEnd <= wanted + 60, "full brightness ends after fade in plus the set time");
    expect(fadedLightTotalMs(item.ms, item.attack, item.release) ==
               fadeIn + item.ms + SUSTAIN_MS[item.release ? item.release : 1],
           "total time");
  }

  // Beat settings.
  expect(parseLightCommand("@F", c) && c.kind == '@' && c.color == 'F', "@F");
  expect(parseLightCommand("@L300", c) && c.color == 'L' && c.ms == 300 && c.attack == 0 && c.release == 0, "@L300");
  expect(parseLightCommand("@L10000,2,7", c) && c.ms == 10000 && c.attack == 2 && c.release == 7, "@L10000,2,7");
  expect(parseLightCommand("@S400", c) && c.color == 'S' && c.ms == 400, "@S400");
  expect(parseLightCommand("@PRGBYCMWK", c) && c.color == 'P' && std::string(c.palette) == "RGBYCMWK", "@P all");
  expect(parseLightCommand("@PW", c) && std::string(c.palette) == "W", "@PW");
  expect(parseLightCommand("@P*", c) && c.color == 'P' && c.palette[0] == 0, "@P*");
  const char* badSettings[] = {"@", "@X", "@F1", "@L", "@L49", "@L10001", "@L300,1", "@L300,8,1", "@L0300",
                               "@S199", "@S5001", "@S400,1,1", "@P", "@PX", "@PRGBYCMWKR", "@P*R", "@Pr"};
  for (const char* line : badSettings)
    if (parseLightCommand(line, c)) { std::printf("FAIL: accepted '%s'\n", line); ++failures; }

  // Idle rainbow setting: 0 off, 1 power-on only, 2-3600 seconds.
  expect(parseLightCommand("@I1", c) && c.color == 'I' && c.ms == 1, "@I1");
  expect(parseLightCommand("@I0", c) && c.color == 'I' && c.ms == 0, "@I0");
  expect(parseLightCommand("@I2", c) && c.color == 'I' && c.ms == 2, "@I2");
  expect(parseLightCommand("@I10", c) && c.color == 'I' && c.ms == 10, "@I10");
  expect(parseLightCommand("@I3600", c) && c.color == 'I' && c.ms == 3600, "@I3600");
  const char* badIdle[] = {"@I", "@I00", "@I010", "@I3601", "@I10000", "@I-1", "@I1,0", "@I 5", "@I5S"};
  for (const char* line : badIdle)
    if (parseLightCommand(line, c)) { std::printf("FAIL: accepted '%s'\n", line); ++failures; }

  // RF copy: on, off, wake, keep-awake interval 0 or 200-60000 ms.
  expect(parseLightCommand("@R1", c) && c.kind == '@' && c.color == 'R' && c.option == '1', "@R1");
  expect(parseLightCommand("@R0", c) && c.color == 'R' && c.option == '0', "@R0");
  expect(parseLightCommand("@RW", c) && c.color == 'R' && c.option == 'W', "@RW");
  expect(parseLightCommand("@RK0", c) && c.option == 'K' && c.ms == 0, "@RK0");
  expect(parseLightCommand("@RK200", c) && c.option == 'K' && c.ms == 200, "@RK200");
  expect(parseLightCommand("@RK2000", c) && c.option == 'K' && c.ms == 2000, "@RK2000");
  expect(parseLightCommand("@RK60000", c) && c.option == 'K' && c.ms == 60000, "@RK60000");
  expect(parseLightCommand("@R2", c) && c.color == 'R' && c.option == '2', "@R2 (RF only)");
  expect(parseLightCommand("@RS0", c) && c.color == 'R' && c.option == 'S' && c.ms == 0,
         "@RS0 (never sleep)");
  expect(parseLightCommand("@RS60", c) && c.option == 'S' && c.ms == 60, "@RS60");
  expect(parseLightCommand("@RS300", c) && c.option == 'S' && c.ms == 300, "@RS300 (seconds)");
  expect(parseLightCommand("@RS86400", c) && c.option == 'S' && c.ms == 86400, "@RS86400");
  const char* badRf[] = {"@R",     "@R3",    "@RX",     "@R10",    "@R1 ",     "@RW1",   "@RK",
                         "@RK00",  "@RK0200", "@RK199", "@RK60001", "@RK100000", "@RK-1", "@RK2000,1",
                         "@RS",    "@RS00",  "@RS059",  "@RS59",   "@RS86401", "@RS100000", "@RS5m",
                         "@RS300 ", "@RS-1"};
  for (const char* line : badRf)
    if (parseLightCommand(line, c)) { std::printf("FAIL: accepted '%s'\n", line); ++failures; }

  // /I, /R or /B: one light by IR only, RF only or both.
  expect(parseLightCommand("#R1500/R", c) && c.kind == '#' && c.color == 'R' && c.ms == 1500 &&
             c.output == OUTPUT_RF, "#R1500/R");
  expect(parseLightCommand(".G/I", c) && c.kind == '.' && c.color == 'G' && c.output == OUTPUT_IR, ".G/I");
  expect(parseLightCommand("!B2000/B", c) && c.kind == '!' && c.ms == 2000 && c.output == OUTPUT_BOTH,
         "!B2000/B");
  expect(parseLightCommand("^Y3000/R", c) && c.kind == '^' && c.output == OUTPUT_RF, "^Y3000/R");
  expect(parseLightCommand("~5000,3000/I", c) && c.kind == '~' && c.ms == 5000 && c.cycle == 3000 &&
             c.output == OUTPUT_IR, "~5000,3000/I");
  expect(parseLightCommand("#=C8C8C8600000,7,7/R", c) && c.color == '=' && c.ms == 600000 &&
             c.attack == 7 && c.release == 7 && c.output == OUTPUT_RF, "longest light with /R");
  expect(parseLightCommand("#R1500", c) && c.output == 0, "no suffix: the board's setting");
  const char* badOutput[] = {"#R1500/",   "#R1500/X", "#R1500/RR", "#R1500/R/I", "/R",
                             "@R1/R",     "*R/R",     "@F/I",      "#R/R",       "#R1500 /R",
                             "~5000,/R",  ".R/r"};
  for (const char* line : badOutput)
    if (parseLightCommand(line, c)) { std::printf("FAIL: accepted '%s'\n", line); ++failures; }

  // A browser beat in any color.
  expect(parseLightCommand("*=844000", c) && c.kind == '*' && c.color == '=' && c.levels.red == 0x84, "*=844000");
  expect(parseLightCommand("*C", c) && c.kind == '*' && c.color == 'C', "*C");
  expect(!parseLightCommand("*", c) && !parseLightCommand("*=CC0000", c) && !parseLightCommand("*R1", c), "bad beats");

  // Custom level limits.
  expect(validCustomLevels({200, 200, 200}) && validCustomLevels({8, 0, 0}), "valid custom levels");
  expect(!validCustomLevels({204, 0, 0}) && !validCustomLevels({4, 4, 4}) && !validCustomLevels({0, 0, 0}),
         "invalid custom levels");

  if (failures) return 1;
  std::printf("line commands parsed and %zu rejected; %zu faded lights planned\n",
              sizeof(rejected) / sizeof(rejected[0]), cases.size());
  return 0;
}
