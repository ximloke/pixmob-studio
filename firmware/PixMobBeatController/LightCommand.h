// Parser for the line commands of the beat controller. Portable C++
// (host-testable).
//
//   .<color>                    quick flash
//   #<color><ms>[,<in>,<out>]   timed light, optional fade in / fade out codes
//   !<color><ms>                strobe
//   ^<color><ms>                build (strobe that speeds up)
//   ~<ms>[,<cycle ms>]          rainbow for <ms>, one turn of colors per cycle
//   @F | @L<ms>[,<in>,<out>] | @S<ms>   what a beat or Auto step shows:
//                               quick flash, timed light or strobe burst
//   @I<s>                       rainbow while nothing controls the board
//                               (kept by the board): 0 off, 1 only from
//                               power-on until the first command, 2-3600
//                               also after that many seconds without
//                               commands or output
//   *<color>                    one browser beat in any color (Host mode)
//   @P<letters> | @P*           colors Auto and Music step through (1-8
//                               preset letters), or * for the defaults
//   @R1 | @R0 | @R2             every light by IR and RF / IR only / RF only
//                               (kept by the board; with IR only no RF at
//                               all goes out, keep-awake included)
//   @RW                         wake RF wristbands: 35 s of "nothing" frames
//   @RK<ms>                     "nothing" frame interval between commands: 0
//                               (only the wake) or 200-60000 ms (kept by the
//                               board)
//   @RS<s>                      RF bands left to sleep <s> s after the last
//                               light: 0 never (the default) or 60-86400 s
//                               (kept by the board)
//
// A flash, timed light, strobe, build or rainbow line may end in /I, /R or /B:
// that light only goes out by IR, only by RF, or by both, whatever the
// board's @R setting is, e.g. #R1500/R.
//
// <color> is a letter (R G B Y C M W K) or =RRGGBB, six hex digits giving the
// red, green and blue levels, each at most MAX_LEVEL. Fade codes are the
// envelope time codes 0-7 (0, 32, 96, 192, 480, 960, 2400, 3840 ms); 0 means
// no fade. The line is expected in upper case without its line ending.
#pragma once
#include <stdint.h>
#include <string.h>
#include "ColorLevels.h"
#include "LightPlan.h"
#include "StrobePlan.h"
#include "RainbowPlan.h"
#include "RfPlan.h"

namespace pixmob {

struct LightCommand {
  char kind;    // '.', '#', '!', '^' or '~'
  char color;   // preset letter, or '=' for custom levels
  Levels levels;
  uint32_t ms;
  uint8_t attack, release;
  uint32_t cycle;  // rainbow only
  char palette[9];  // '@' with color 'P': letters, empty for the defaults
  char option;      // '@' with color 'R': '1', '0', '2', 'W', 'K' or 'S'
  uint8_t output;   // /I, /R or /B: OUTPUT_IR, OUTPUT_RF or OUTPUT_BOTH; 0: the board's setting
};

// Which transmitters a light goes out by (bits).
const uint8_t OUTPUT_IR = 1;
const uint8_t OUTPUT_RF = 2;
const uint8_t OUTPUT_BOTH = OUTPUT_IR | OUTPUT_RF;

// Longest wait, in seconds, before the rainbow returns on an idle board.
const uint32_t MAX_IDLE_RAINBOW_SECONDS = 3600;

// Bounds of a beat's timed light and strobe burst.
const uint32_t MIN_BEAT_LIGHT_MS = 50;
const uint32_t MAX_BEAT_LIGHT_MS = 10000;
const uint32_t MIN_BEAT_STROBE_MS = 200;
const uint32_t MAX_BEAT_STROBE_MS = 5000;

inline int hexValue(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

inline bool parseLightCommandBody(const char* line, LightCommand& command) {
  command = {};
  const char kind = line[0];
  if (kind != '.' && kind != '#' && kind != '!' && kind != '^' && kind != '~' && kind != '@' &&
      kind != '*')
    return false;
  command.kind = kind;
  const char* p = line + 1;
  if (kind == '@') {
    const char style = *p++;
    command.color = style;
    if (style == 'F') return *p == 0;
    if (style == 'I') {
      // 0, or 1-3600 without leading zeros.
      if (p[0] == '0') {
        if (p[1] != 0) return false;
        command.ms = 0;
        return true;
      }
      uint32_t seconds = 0;
      uint8_t digits = 0;
      while (*p >= '0' && *p <= '9') {
        if (++digits > 4) return false;
        seconds = seconds * 10 + uint32_t(*p - '0');
        ++p;
      }
      if (digits == 0 || *p != 0 || seconds > MAX_IDLE_RAINBOW_SECONDS) return false;
      command.ms = seconds;
      return true;
    }
    if (style == 'R') {
      const char option = *p++;
      command.option = option;
      if (option == '1' || option == '0' || option == '2' || option == 'W') return *p == 0;
      if (option != 'K' && option != 'S') return false;
      // K: 0, or 200-60000 ms; S: 0, or 60-86400 s; no leading zeros.
      // command.ms holds the number as written (seconds for S).
      if (p[0] == '0') {
        if (p[1] != 0) return false;
        command.ms = 0;
        return true;
      }
      uint32_t value = 0;
      uint8_t digits = 0;
      while (*p >= '0' && *p <= '9') {
        if (++digits > 5) return false;
        value = value * 10 + uint32_t(*p - '0');
        ++p;
      }
      if (digits == 0 || *p != 0) return false;
      if (option == 'K' ? value < RF_KEEP_AWAKE_MIN_MS || value > RF_KEEP_AWAKE_MAX_MS
                        : value < RF_SLEEP_MIN_S || value > RF_SLEEP_MAX_S)
        return false;
      command.ms = value;
      return true;
    }
    if (style == 'P') {
      if (p[0] == '*' && p[1] == 0) return true;
      uint8_t count = 0;
      Levels unused;
      while (*p) {
        if (count >= 8 || !colorLevels(*p, unused)) return false;
        command.palette[count++] = *p++;
      }
      command.palette[count] = 0;
      return count > 0;
    }
    if (style != 'L' && style != 'S') return false;
    if (*p < '1' || *p > '9') return false;
    uint32_t ms = 0;
    uint8_t digits = 0;
    while (*p >= '0' && *p <= '9') {
      if (++digits > 5) return false;
      ms = ms * 10 + uint32_t(*p - '0');
      ++p;
    }
    command.ms = ms;
    if (style == 'S') return *p == 0 && ms >= MIN_BEAT_STROBE_MS && ms <= MAX_BEAT_STROBE_MS;
    if (ms < MIN_BEAT_LIGHT_MS || ms > MAX_BEAT_LIGHT_MS) return false;
    if (*p == 0) return true;
    if (p[0] != ',' || p[1] < '0' || p[1] > '7' || p[2] != ',' || p[3] < '0' || p[3] > '7' ||
        p[4] != 0)
      return false;
    command.attack = uint8_t(p[1] - '0');
    command.release = uint8_t(p[3] - '0');
    return true;
  }
  if (kind == '~') {
    // Two plain numbers without leading zeros; the cycle is optional.
    uint32_t value[2] = {0, DEFAULT_RAINBOW_CYCLE_MS};
    for (uint8_t i = 0; i < 2; ++i) {
      if (*p < '1' || *p > '9') return false;
      uint32_t number = 0;
      uint8_t digits = 0;
      while (*p >= '0' && *p <= '9') {
        if (++digits > 6) return false;
        number = number * 10 + uint32_t(*p - '0');
        ++p;
      }
      value[i] = number;
      if (*p == 0) break;
      if (i == 1 || *p != ',') return false;
      ++p;
    }
    if (*p != 0) return false;
    command.color = '~';
    command.ms = value[0];
    command.cycle = value[1];
    return value[0] >= MIN_RAINBOW_MS && value[0] <= MAX_RAINBOW_MS &&
           value[1] >= MIN_RAINBOW_CYCLE_MS && value[1] <= MAX_RAINBOW_CYCLE_MS;
  }
  if (*p == '=') {
    uint8_t value[3];
    for (uint8_t i = 0; i < 3; ++i) {
      const int high = hexValue(p[1 + 2 * i]);
      if (high < 0) return false;
      const int low = hexValue(p[2 + 2 * i]);
      if (low < 0) return false;
      value[i] = uint8_t(high * 16 + low);
    }
    command.color = '=';
    command.levels = {value[0], value[1], value[2]};
    if (!validCustomLevels(command.levels)) return false;
    p += 7;
  } else {
    if (!colorLevels(*p, command.levels)) return false;
    command.color = *p;
    ++p;
  }
  if (kind == '.' || kind == '*') return *p == 0;
  if (*p < '1' || *p > '9') return false;  // no leading zero, not empty
  uint32_t ms = 0;
  uint8_t digits = 0;
  while (*p >= '0' && *p <= '9') {
    if (++digits > 6) return false;
    ms = ms * 10 + uint32_t(*p - '0');
    ++p;
  }
  command.ms = ms;
  if (kind == '#') {
    if (ms < MIN_LIGHT_MS || ms > MAX_LIGHT_MS) return false;
    if (*p == 0) return true;
    // ,<in>,<out>
    if (p[0] != ',' || p[1] < '0' || p[1] > '7' || p[2] != ',' || p[3] < '0' || p[3] > '7' ||
        p[4] != 0)
      return false;
    command.attack = uint8_t(p[1] - '0');
    command.release = uint8_t(p[3] - '0');
    return true;
  }
  return *p == 0 && ms >= MIN_STROBE_MS && ms <= MAX_STROBE_MS;
}

// A line command, with the optional /I, /R or /B of a light.
inline bool parseLightCommand(const char* line, LightCommand& command) {
  const char* slash = strchr(line, '/');
  if (!slash) return parseLightCommandBody(line, command);
  const char kind = line[0];
  if (kind != '.' && kind != '#' && kind != '!' && kind != '^' && kind != '~') return false;
  uint8_t output = 0;
  if (slash[1] == 'I') output = OUTPUT_IR;
  else if (slash[1] == 'R') output = OUTPUT_RF;
  else if (slash[1] == 'B') output = OUTPUT_BOTH;
  else return false;
  if (slash[2] != 0) return false;
  char body[32];
  const size_t length = size_t(slash - line);
  if (length >= sizeof(body)) return false;
  memcpy(body, line, length);
  body[length] = 0;
  if (!parseLightCommandBody(body, command)) return false;
  command.output = output;
  return true;
}

}  // namespace pixmob
