// Host test for firmware/PixMobRFTest/PixMobRFLimits.h: where the RF bench test
// may transmit, and the PATABLE value it uses for each power and band.
#include <cmath>
#include <cstdio>
#include "../firmware/PixMobRFTest/PixMobRFLimits.h"

static int failures = 0;

static void expect(bool condition, const char* label, float mhz = 0.0f) {
  if (!condition) {
    std::printf("FAIL: %s (%.3f)\n", label, double(mhz));
    ++failures;
  }
}

int main() {
  const float allowed[] = {433.10f, 433.873f, 433.92f, 434.70f, 919.10f, 921.0f, 922.36f, 922.90f};
  for (const float mhz : allowed) expect(pixmobrf::allowedMhz(mhz), "allowed", mhz);

  // Outside both ranges: other ISM / SRD bands, the band edges themselves, the
  // 916-919 and 923-924 MHz duty-cycle bands, the 900 MHz mobile downlink.
  const float refused[] = {0.0f,   -433.92f, 315.0f,  433.0f,   433.05f, 434.79f, 435.0f,
                           868.0f, 868.085f, 915.0f,  916.5f,   919.0f,  919.05f, 922.95f,
                           923.0f, 923.5f,   925.0f,  949.5f,   2440.0f, NAN,     INFINITY};
  for (const float mhz : refused) expect(!pixmobrf::allowedMhz(mhz), "refused", mhz);

  // Each range keeps at least 0.1 MHz inside a Malaysian SRD band of Class
  // Assignment No. 1 of 2025, Table 2-1: 433-435 MHz or 919-923 MHz.
  for (const pixmobrf::Band& band : pixmobrf::kBands) {
    const bool in433 = band.minMhz >= 433.0999f && band.maxMhz <= 434.9001f;
    const bool in919 = band.minMhz >= 919.0999f && band.maxMhz <= 922.9001f;
    expect(band.minMhz < band.maxMhz && (in433 || in919), "range inside an SRD band", band.minMhz);
  }

  // TI SWRS061I Table 39 (multi-layer inductors), 433 MHz and 915 MHz columns.
  struct Expected { float mhz; int dbm; uint8_t pa; };
  const Expected expected[] = {
      {433.92f, -30, 0x12}, {433.92f, -10, 0x34}, {433.92f, 0, 0x60}, {433.92f, 10, 0xC0},
      {922.36f, -30, 0x03}, {922.36f, -20, 0x0E}, {922.36f, -15, 0x1E}, {922.36f, -10, 0x27},
      {922.36f, 0, 0x8E},   {922.36f, 5, 0xCD},   {922.36f, 7, 0xC7},  {922.36f, 10, 0xC0},
  };
  for (const Expected& e : expected) {
    uint8_t pa = 0;
    expect(pixmobrf::paValue(e.mhz, e.dbm, pa) && pa == e.pa, "PATABLE value", e.mhz);
  }

  // Nothing above 10 dBm, and no value for a power that is not in the table.
  for (const pixmobrf::PowerLevel& level : pixmobrf::kPowerLevels)
    expect(level.dbm >= -30 && level.dbm <= 10, "power -30..10 dBm", float(level.dbm));
  uint8_t pa = 0x55;
  expect(!pixmobrf::paValue(922.36f, 12, pa) && pa == 0x55, "no +12 dBm entry");
  expect(!pixmobrf::paValue(433.92f, 1, pa) && pa == 0x55, "no +1 dBm entry");

  std::printf("allowed ranges:");
  for (const pixmobrf::Band& band : pixmobrf::kBands)
    std::printf(" %.2f-%.2f MHz", double(band.minMhz), double(band.maxMhz));
  std::printf("; checked %d allowed, %d refused frequencies, %d PATABLE values\n",
              int(sizeof(allowed) / sizeof(allowed[0])), int(sizeof(refused) / sizeof(refused[0])),
              int(sizeof(expected) / sizeof(expected[0])));
  if (failures) {
    std::printf("%d failure(s)\n", failures);
    return 1;
  }
  return 0;
}
