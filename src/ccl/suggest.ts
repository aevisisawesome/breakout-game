/**
 * "Did you mean …?" support for diagnostics (TDD §5.4).
 * Small bounded Levenshtein — candidate lists are tiny (API names + variables).
 */

export function editDistance(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  const row = new Array<number>(lb + 1);
  for (let j = 0; j <= lb; j++) row[j] = j;
  for (let i = 1; i <= la; i++) {
    let prevDiag = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= lb; j++) {
      const tmp = row[j] ?? 0;
      row[j] = Math.min(
        (row[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        prevDiag + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prevDiag = tmp;
    }
  }
  return row[lb] ?? 0;
}

/** Closest candidate within a distance budget scaled to the name's length, or null. */
export function suggestName(name: string, candidates: Iterable<string>): string | null {
  const maxDistance = name.length <= 4 ? 1 : 2;
  let best: string | null = null;
  let bestDistance = maxDistance + 1;
  for (const candidate of candidates) {
    if (candidate === name) continue;
    const d = editDistance(name.toLowerCase(), candidate.toLowerCase());
    if (d < bestDistance) {
      bestDistance = d;
      best = candidate;
    }
  }
  return bestDistance <= maxDistance ? best : null;
}
