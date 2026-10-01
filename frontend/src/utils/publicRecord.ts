import type { ResolvedCode, SearchHit } from 'src/api/search';

// Small helpers the public pages share for one search hit: badge tone and
// icon by material type, the creator line and the cover image.

/**
 * Tone of the soft badge for a COMARC material type: the code's first letter is
 * the record type (a text, e/f maps, k graphics …), the second the bibliographic
 * level (m monograph, s serial).
 */
export function materialTone(type: ResolvedCode | undefined): string {
  const code = type?.code ?? '';
  if (code === 'am') return 'primary';
  if (code === 'as') return 'warm';
  if (code.startsWith('e') || code.startsWith('f')) return 'positive';
  if (code.startsWith('k')) return 'warning';
  return 'muted';
}

export function materialIcon(type: ResolvedCode | undefined): string {
  const code = type?.code ?? '';
  if (code === 'as') return 'o_newspaper';
  if (code.startsWith('e') || code.startsWith('f')) return 'o_map';
  if (code.startsWith('k')) return 'o_image';
  return 'o_menu_book';
}

/** The first responsibility, else "place: publisher". */
export function creatorLine(hit: SearchHit): string {
  const m = hit.source.metadata;
  if (m.firstResponsibility) return m.firstResponsibility;
  return [m.publication?.place, m.publication?.publisher].filter(Boolean).join(': ');
}

/** URL of the first image attachment, or undefined when the item has no cover. */
export function coverUrl(hit: SearchHit): string | undefined {
  const img = hit.source.file_attachments?.find((f) => f.fileType === 'IMAGE');
  return img ? `/api/files/${img.id}/download` : undefined;
}

/** True when the item has no file at all — the public pages say "Not yet scanned". */
export function hasNoFiles(hit: SearchHit): boolean {
  return (hit.source.file_attachments?.length ?? 0) === 0;
}
