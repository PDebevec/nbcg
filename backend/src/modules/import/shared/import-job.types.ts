export type ImportSource = 'cobiss' | 'local';

export interface ImportJobData {
  source: ImportSource;
  ids: string[];
  requestedAt: string;
}

export interface ImportJobProgress {
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  errors: { id: string; reason: string }[];
}