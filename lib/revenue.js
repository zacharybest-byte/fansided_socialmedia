// Headline earnings: Meta's all-tools approximate figure when available, otherwise the sum of
// the program-specific metrics (they would double count if added to the approximate figure).
export function earningsCents(approx, cm, adbreak) {
  if (approx !== null) return approx;
  if (cm === null && adbreak === null) return null;
  return (cm || 0) + (adbreak || 0);
}
