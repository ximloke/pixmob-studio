// The timing arrays this sketch transmitted before the color levels were
// tuned to the user's wristband (see ColorLevels.h). Reference only: the
// firmware now builds every frame with PixMobFrame.h and does not include
// this file. tests/color-levels.cpp rebuilds each array bit for bit from the
// channel values noted here (red/green/blue), so the captures and the
// published model stay tied together. 38 kHz carrier, microseconds, mark
// first.
#pragma once
#include <stdint.h>

namespace pixmob {
namespace original {
// 132/32/0. Still what R sends.
const uint16_t RED[] = {
  1400,1400,700,700,700,1400,700,2800,
  700,2100,1400,700,700,700,700,1400,
  1400,2800,1400,2800,700
};

// 132/244/0. Flashed weakly on the wristband (13 Nov 2026).
const uint16_t GREEN[] = {
  1400,1400,700,700,700,700,1400,2800,
  700,1400,700,1400,700,1400,700,1400,
  1400,2800,1400,2800,700
};

// 16/12/160. Still what B sends.
const uint16_t BLUE[] = {
  700,700,700,2100,1400,700,700,2800,
  700,1400,700,700,700,1400,1400,700,
  700,1400,700,700,700,700,700,700,
  700,2100,700
};

// 132/124/0. Still what Y sends.
const uint16_t YELLOW[] = {
  1400,1400,700,700,700,700,1400,2800,
  700,2100,700,700,700,1400,700,1400,
  1400,2800,1400,2800,700
};

// 132/200/160 (upstream TURQUOISE). Bright, but looked light green.
const uint16_t CYAN[] = {
  700,700,700,700,1400,1400,1400,2800,
  700,1400,700,700,1400,1400,700,1400,
  1400,2800,700,700,700,2100,700
};

// 240/100/160. Only flashed in the first hold test.
const uint16_t MAGENTA[] = {
  700,700,700,700,1400,1400,1400,2800,
  700,2100,1400,2100,700,700,700,700,
  1400,2100,700,700,700,2100,700
};

// 204/176/92. The sketch called this WHITE; it is upstream WHITISH
// (warm). Flashed weakly on 13 Nov 2026.
const uint16_t WHITISH[] = {
  700,700,700,2100,1400,700,700,2800,
  700,1400,700,700,700,2800,1400,1400,
  700,2100,700,1400,700,1400,700
};

// 204/204/204, bytes 80 69 21 89 89 89. Neutral-white candidate built
// from the published framing with the channel values of upstream FAST_WHITE.
// Seen whiter than WHITISH on 13 Nov 2026 in a burst comparison; later the
// same day its single flashes were weak.
const uint16_t WHITE[] = {
  1400,1400,700,700,1400,700,700,2800,
  700,1400,700,1400,700,2100,1400,1400,
  700,2100,1400,1400,700,2100,700
};

}  // namespace original
}  // namespace pixmob
