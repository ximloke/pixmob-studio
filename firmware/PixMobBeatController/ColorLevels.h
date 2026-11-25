// Channel values (red, green, blue) for each color letter. Quick flashes and
// timed lights share this one table, so a color looks the same in both.
// Portable C++ (no Arduino dependency) so it can be tested on the host.
//
// Where the values come from (the user's wristband, 13 Nov 2026):
//  R, B, Y  The supplied preset values. Their quick flashes were seen bright.
//  G, W     The values that stayed lit in the hold tests. The supplied Green
//           (132/244/0) and the neutral White (204/204/204) flashed weakly
//           and looked alike.
//  K        The supplied WHITISH (204/176/92) scaled the same way as White;
//           at full value it also flashed weakly.
//  M        The value that stayed lit in the hold tests (supplied
//           240/100/160).
//  C        Upstream LIGHT_BLUE (68/184/160). The supplied Cyan is upstream
//           TURQUOISE (132/200/160) and looked light green on the wristband.
//           The new value has not been observed yet.
// Every quick flash seen bright had no channel above 200 and every weak one
// had a channel of 204 or more. Nothing was measured, so the cause is not
// known; the table simply stays at or below MAX_LEVEL. The supplied timing
// arrays are kept in OriginalFrames.h for reference.
#pragma once
#include <stdint.h>

namespace pixmob {

const uint8_t MAX_LEVEL = 200;

struct Levels {
  uint8_t red, green, blue;
};

inline bool colorLevels(char color, Levels& levels) {
  switch (color) {
    case 'R': levels = {132, 32, 0};    return true;
    case 'G': levels = {88, 164, 0};    return true;
    case 'B': levels = {16, 12, 160};   return true;
    case 'Y': levels = {132, 124, 0};   return true;
    case 'C': levels = {68, 184, 160};  return true;
    case 'M': levels = {180, 76, 120};  return true;
    case 'W': levels = {124, 124, 124}; return true;
    case 'K': levels = {124, 108, 56};  return true;
  }
  return false;
}

// A custom color: no channel above MAX_LEVEL, and bright enough that the
// strongest channel can be varied between re-sends.
inline bool validCustomLevels(const Levels& levels) {
  const uint8_t top = levels.red > levels.green
                          ? (levels.red > levels.blue ? levels.red : levels.blue)
                          : (levels.green > levels.blue ? levels.green : levels.blue);
  return levels.red <= MAX_LEVEL && levels.green <= MAX_LEVEL && levels.blue <= MAX_LEVEL &&
         top >= 8;
}

// The channel a timed light changes slightly between re-sends.
inline uint8_t& strongest(Levels& levels) {
  uint8_t* top = &levels.red;
  if (levels.green > *top) top = &levels.green;
  if (levels.blue > *top) top = &levels.blue;
  return *top;
}

}  // namespace pixmob
