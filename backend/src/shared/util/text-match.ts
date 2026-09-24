/**
 * Fold text for typeahead matching: no accents (`Nikšić` → `niksic`, `đ` → `d`),
 * lower case, and punctuation collapsed to single spaces, so `Beograd : Prosveta`
 * matches `beograd prosveta` the way OpenSearch's tokenised phrase match did.
 */
export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Keep the items one of whose texts matches `q`, best first: an exact match,
 * then a prefix, then a substring. Order within a tier is kept (for suggest:
 * most used first). No `q` → the first `limit` items unfiltered.
 */
export function rankByQuery<T>(
  items: T[],
  q: string | undefined,
  texts: (item: T) => Array<string | undefined>,
  limit: number,
): T[] {
  return rankNormalized(
    items,
    q ? normalizeForMatch(q) : '',
    (item) =>
      texts(item)
        .filter((t): t is string => typeof t === 'string' && t !== '')
        .map(normalizeForMatch),
    limit,
  );
}

/** `rankByQuery` for callers that normalised their texts once, up front. */
export function rankNormalized<T>(
  items: T[],
  needle: string,
  haystacksOf: (item: T) => string[],
  limit: number,
): T[] {
  if (!needle) return items.slice(0, limit);

  const tiers: T[][] = [[], [], []];
  for (const item of items) {
    const haystacks = haystacksOf(item);
    if (haystacks.some((h) => h === needle)) tiers[0].push(item);
    else if (haystacks.some((h) => h.startsWith(needle))) tiers[1].push(item);
    else if (haystacks.some((h) => h.includes(needle))) tiers[2].push(item);
  }
  return tiers.flat().slice(0, limit);
}
