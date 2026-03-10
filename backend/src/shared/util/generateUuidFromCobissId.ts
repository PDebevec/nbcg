import { createHash } from 'crypto';

/**
 * Generate a deterministic UUID from COBISS ID
 * Same COBISS ID always produces the same UUID
 */
export function generateDeterministicId(cobissId: string): string {
  const hash = createHash('sha256').update(`cobiss:${cobissId}`).digest('hex');
  
  // Format as UUID (8-4-4-4-12)
  return [
    hash.substring(0, 8),
    hash.substring(8, 12),
    hash.substring(12, 16),
    hash.substring(16, 20),
    hash.substring(20, 32),
  ].join('-');
}