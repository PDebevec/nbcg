import { createHash } from 'crypto';

/**
 * Generate a deterministic cuid2-compatible ID from a COBISS ID.
 * Same COBISS ID always produces the same ID.
 * Format matches Prisma's @default(cuid()): 25 lowercase alphanumeric chars starting with 'c'.
 */
export function generateDeterministicId(cobissId: string): string {
  const hash = createHash('sha256').update(`cobiss:${cobissId}`).digest('hex');
  // SHA256 hex → BigInt → base36 gives ~50 chars; take the first 24 after the 'c' prefix.
  const base36 = BigInt('0x' + hash).toString(36);
  return ('c' + base36).substring(0, 25);
}