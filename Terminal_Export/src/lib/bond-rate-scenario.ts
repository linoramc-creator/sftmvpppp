export function bondRateEstimate(duration: number, shockBp: number): number | null {
  if (!Number.isFinite(duration) || !Number.isFinite(shockBp) || duration < 0 || duration > 30 || Math.abs(shockBp) > 200) return null;
  const change = -duration * shockBp / 100;
  return Object.is(change, -0) ? 0 : change;
}

export function bondRateScenario(duration: number, selectedShock: number) {
  if (bondRateEstimate(duration, selectedShock) === null) return [];
  return [...new Set([-200, -100, -50, -25, 0, 25, 50, 100, 200, selectedShock])]
    .sort((a, b) => a - b).map(shock => ({shock, change: bondRateEstimate(duration, shock)!}));
}
