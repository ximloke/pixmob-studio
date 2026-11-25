/** A decaying visual pulse that can only begin after a measured device beat. */
export function deviceBeatPulse(
  now: number,
  beatAt: number,
  level: number,
  gain: number,
) {
  if (![now, beatAt, level, gain].every(Number.isFinite) || beatAt <= 0)
    return 0;
  const age = now - beatAt;
  if (age < 0 || age > 900) return 0;
  const strength =
    0.65 + 0.35 * Math.sqrt(Math.max(0, Math.min(1, level * gain)));
  return Math.exp(-age / 140) * strength;
}
