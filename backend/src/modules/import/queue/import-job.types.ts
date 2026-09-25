import { ItemType, VisibilityStatus } from '../../../../generated/prisma/enums';

export type ImportSource = 'cobiss' | 'local';

export interface ImportJobData {
  source: ImportSource;
  ids: string[];
  target: ItemType;
  visibilityStatus: VisibilityStatus;
  requestedAt: string;
}

export interface ImportJobProgress {
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  errors: { id: string; reason: string }[];
  /**
   * Imported, but would not pass the save check for the state it was imported
   * as (metadata schema v2) — listed so it can be fixed later. COBISS is the catalogue of
   * record, so the import itself is never blocked. Absent on jobs queued before
   * schema v2.
   */
  warnings?: { id: string; reason: string }[];
}
