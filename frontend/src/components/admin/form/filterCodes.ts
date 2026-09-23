import type { ResolvedCode } from 'src/api/search';

/** Case-insensitive match on the localized label, either label, or the code itself. */
export function filterCodes(
  options: ResolvedCode[],
  input: string,
  label: (c: ResolvedCode) => string,
): ResolvedCode[] {
  const needle = input.trim().toLowerCase();
  if (!needle) return options;
  return options.filter(
    (c) =>
      label(c).toLowerCase().includes(needle) ||
      c.en.toLowerCase().includes(needle) ||
      c.cnr.toLowerCase().includes(needle) ||
      c.code.toLowerCase().startsWith(needle),
  );
}
