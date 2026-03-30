import type { DomainRecord } from 'src/modules/import/cobiss/cobiss-util/cobiss.types';

/**
 * Fields that EVERY import source must populate.
 * Add new required fields here as the contract grows.
 */
export interface BaseMetadata {
  title: string;
  collectionType: number;
  childrenNumber: number;
  jeGlavnoGradivo: boolean;
}

export type CobissMetadata = BaseMetadata & DomainRecord & { _source: 'cobiss' };

// Extend this union as new import sources are added
export type RecordMetadata = CobissMetadata;
