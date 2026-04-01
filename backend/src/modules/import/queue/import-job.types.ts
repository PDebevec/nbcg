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
}
