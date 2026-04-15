import type { DomainRecord, FieldValidator } from 'src/modules/import/cobiss/cobiss-util/cobiss.types';

/**
 * Fields that EVERY import source must populate.
 * Add new required fields here as the contract grows.
 */
export interface BaseMetadata {
  title: string;
  collectionType: number;
  childrenInDrafts: number;
  childrenInRecords: number;
  jeGlavnoGradivo: boolean;
}

// System fields managed by the DB trigger / import — never user-editable.
type SystemMetadataKeys = 'jeGlavnoGradivo' | 'childrenInDrafts' | 'childrenInRecords';

/**
 * Runtime mirror of user-editable BaseMetadata keys.
 * TypeScript enforces this matches the non-system fields of BaseMetadata.
 */
export const EDITABLE_BASE_METADATA_SHAPE: Record<Exclude<keyof BaseMetadata, SystemMetadataKeys>, FieldValidator> = {
  title:          (v) => { if (typeof v !== 'string') throw new Error('expected string'); return v; },
  collectionType: (v) => { if (typeof v !== 'number') throw new Error('expected number'); return v; },
};

export type CobissMetadata = BaseMetadata & DomainRecord & { _source: 'cobiss' };

// Extend this union as new import sources are added
export type RecordMetadata = CobissMetadata;
