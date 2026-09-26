import {
  DOMAIN_RECORD_SHAPE,
  type DomainRecord,
  type FieldValidator,
} from '../../modules/import/cobiss/cobiss-util/cobiss.types';

/**
 * Fields that EVERY import source must populate.
 * Add new required fields here as the contract grows.
 */
export interface BaseMetadata {
  title: string;
  collectionType: number;
  childrenInDrafts: number;
  childrenInRecords: number;
}

// System fields managed by the DB trigger — never user-editable.
type SystemMetadataKeys = 'childrenInDrafts' | 'childrenInRecords';

/**
 * Runtime mirror of user-editable BaseMetadata keys.
 * TypeScript enforces this matches the non-system fields of BaseMetadata.
 */
export const EDITABLE_BASE_METADATA_SHAPE: Record<Exclude<keyof BaseMetadata, SystemMetadataKeys>, FieldValidator> = {
  title:          (v) => { if (typeof v !== 'string') throw new Error('expected string'); return v; },
  collectionType: (v) => { if (typeof v !== 'number') throw new Error('expected number'); return v; },
};

/**
 * Every metadata key the API accepts from a client → its sanitizer. Derived from
 * the type shapes, so it stays in sync with DomainRecord and BaseMetadata.
 * Unknown keys are dropped; known keys with the wrong type throw (→ 400).
 * The schema v2 self-check verifies every advertised field against this map.
 */
export const METADATA_VALIDATORS = new Map<string, FieldValidator>([
  ...Object.entries(EDITABLE_BASE_METADATA_SHAPE),
  ...Object.entries(DOMAIN_RECORD_SHAPE),
]);

export type CobissMetadata = BaseMetadata & DomainRecord & { _source: 'cobiss' };

// Extend this union as new import sources are added
export type RecordMetadata = CobissMetadata;
