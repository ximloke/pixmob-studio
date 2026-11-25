// Carrier frequency and output power limits of the RF bench test (no Arduino
// dependency, host-testable; tests/rf-limits.cpp checks them). The beat
// controller keeps an identical copy (tests check that the copies match).
#pragma once

#include <stdint.h>

namespace pixmobrf {

// The test may only transmit inside these ranges. Each range stays at least
// 0.1 MHz inside a band that Malaysia's MCMC Class Assignment No. 1 of 2025
// (Second Schedule, Table 2-1) opens to short-range devices. The 0.1 MHz
// margin allows for the module's crystal error.
//   433.10-434.70 MHz: item 8, 433-435 MHz, 100 mW EIRP.
//   919.10-922.90 MHz: item 10, 919-923 MHz, 500 mW EIRP, no duty-cycle
//   condition. The 916-919 and 923-924 MHz neighbours require a duty cycle
//   below 1%, frequency hopping or LBT, which this test does not do.
// At most 10 dBm (10 mW) is set below.
struct Band {
  float minMhz;
  float maxMhz;
};
constexpr Band kBands[] = {{433.10f, 434.70f}, {919.10f, 922.90f}};

constexpr bool allowedMhz(float mhz) {
  for (const Band& band : kBands)
    if (mhz >= band.minMhz && mhz <= band.maxMhz) return true;
  return false;  // also for NaN
}

// TI CC1101 datasheet SWRS061I, Table 39 (multi-layer inductors): optimum
// PATABLE values, 433 MHz and 915 MHz columns. The 915 MHz column is used for
// 919-923 MHz. The user's module is matched for 433 MHz, so its real output
// in the high band is lower by an amount nobody has measured.
struct PowerLevel {
  int8_t dbm;
  uint8_t pa433;
  uint8_t pa915;
};
constexpr PowerLevel kPowerLevels[] = {
    {-30, 0x12, 0x03}, {-20, 0x0E, 0x0E}, {-15, 0x1D, 0x1E}, {-10, 0x34, 0x27},
    {0, 0x60, 0x8E},   {5, 0x84, 0xCD},   {7, 0xC8, 0xC7},   {10, 0xC0, 0xC0},
};

constexpr bool highBand(float mhz) { return mhz > 600.0f; }

// PATABLE value for `dbm` at `mhz`; false if `dbm` is not in the table.
inline bool paValue(float mhz, int dbm, uint8_t& pa) {
  for (const PowerLevel& level : kPowerLevels)
    if (level.dbm == dbm) {
      pa = highBand(mhz) ? level.pa915 : level.pa433;
      return true;
    }
  return false;
}

}  // namespace pixmobrf
