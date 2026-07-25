import { Injectable } from '@nestjs/common';
import type { FieldDescriptor } from './schema.types';
import {
  getAllLanguageCodes,
  getAllCountryCodes,
  getAllRecordTypeCodes,
  getAllBibliographicLevelCodes,
  getAllMaterialTypeCodes,
  getAllIllustrationCodes,
  getAllContentTypeCodes,
  getAllLiteraryFormCodes,
  getAllBiographyCodes,
  getAllRelatorCodes,
} from '../import/cobiss/cobiss-util/cobiss-code-map';

// ─── helpers ────────────────────────────────────────────────────────────────

let order = 0;
const nextOrder = () => order++;

function resetOrder() { order = 0; }

// ─── field definitions ──────────────────────────────────────────────────────

/**
 * Build the full field descriptor list.
 * Derived from EDITABLE_BASE_METADATA_SHAPE + DOMAIN_RECORD_SHAPE + code maps.
 * Single source of truth — never hand-maintained.
 */
function buildRecordFields(): FieldDescriptor[] {
  resetOrder();

  const fields: FieldDescriptor[] = [

    // ── Base metadata ───────────────────────────────────────────────────
    {
      key: 'title', type: 'string', required: true,
      group: 'basic', order: nextOrder(),
      parentInheritable: true, issueIdentifying: false,
      levels: ['main', 'child'],
    },
    {
      key: 'collectionType', type: 'number', required: true,
      group: 'basic', order: nextOrder(),
      parentInheritable: false, issueIdentifying: false,
      levels: ['main'],
    },

    // ── Identification (0XX) ────────────────────────────────────────────
    {
      key: 'cobissId', type: 'string', required: false,
      group: 'identification', order: nextOrder(),
      parentInheritable: false, issueIdentifying: false,
      levels: ['main', 'child'],
    },
    {
      key: 'recordType', type: 'enum', required: false,
      allowedValues: getAllRecordTypeCodes(),
      group: 'identification', order: nextOrder(),
      parentInheritable: true, issueIdentifying: false,
      levels: ['main', 'child'],
    },
    {
      key: 'bibliographicLevel', type: 'enum', required: false,
      allowedValues: getAllBibliographicLevelCodes(),
      group: 'identification', order: nextOrder(),
      parentInheritable: true, issueIdentifying: false,
      levels: ['main', 'child'],
    },
    {
      key: 'materialType', type: 'enum', required: false,
      allowedValues: getAllMaterialTypeCodes(),
      group: 'identification', order: nextOrder(),
      parentInheritable: true, issueIdentifying: false,
      levels: ['main', 'child'],
    },
    {
      key: 'documentTypology', type: 'string', required: false,
      group: 'identification', order: nextOrder(),
      parentInheritable: false, issueIdentifying: false,
      levels: ['main', 'child'],
    },
    {
      key: 'isbn', type: 'array', itemType: 'string', required: false,
      group: 'identification', order: nextOrder(),
      parentInheritable: false, issueIdentifying: false,
      levels: ['main'],
    },
    {
      key: 'issn', type: 'array', itemType: 'string', required: false,
      group: 'identification', order: nextOrder(),
      parentInheritable: true, issueIdentifying: false,
      levels: ['main', 'child'],
    },
    {
      key: 'ismn', type: 'array', itemType: 'string', required: false,
      group: 'identification', order: nextOrder(),
      parentInheritable: false, issueIdentifying: false,
      levels: ['main'],
    },

    // ── Coded information (1XX) ─────────────────────────────────────────
    {
      key: 'publicationDate1', type: 'string', required: false,
      group: 'dates', order: nextOrder(),
      parentInheritable: false, issueIdentifying: false,
      levels: ['main', 'child'],
    },
    {
      key: 'publicationDate2', type: 'string', required: false,
      group: 'dates', order: nextOrder(),
      parentInheritable: false, issueIdentifying: false,
      levels: ['main', 'child'],
    },
    {
      key: 'language', type: 'array', itemType: 'enum', required: false,
      allowedValues: getAllLanguageCodes(),
      group: 'language', order: nextOrder(),
      parentInheritable: true, issueIdentifying: false,
      levels: ['main', 'child'],
    },
    {
      key: 'originalLanguage', type: 'array', itemType: 'enum', required: false,
      allowedValues: getAllLanguageCodes(),
      group: 'language', order: nextOrder(),
      parentInheritable: true, issueIdentifying: false,
      levels: ['main', 'child'],
    },
    {
      key: 'translationLanguages', type: 'array', itemType: 'enum', required: false,
      allowedValues: getAllLanguageCodes(),
      group: 'language', order: nextOrder(),
      parentInheritable: true, issueIdentifying: false,
      levels: ['main', 'child'],
    },
    {
      key: 'country', type: 'array', itemType: 'enum', required: false,
      allowedValues: getAllCountryCodes(),
      group: 'language', order: nextOrder(),
      parentInheritable: true, issueIdentifying: false,
      levels: ['main', 'child'],
    },

    // ── Textual material codes (105) ────────────────────────────────────
    {
      key: 'textualMaterialCodes', type: 'object', required: false,
      group: 'textualMaterial', order: nextOrder(),
      parentInheritable: false, issueIdentifying: false,
      levels: ['main'],
      objectShape: [
        {
          key: 'illustrationCodes', type: 'array', itemType: 'enum', required: false,
          allowedValues: getAllIllustrationCodes(),
          group: 'textualMaterial', order: 0,
          parentInheritable: false, issueIdentifying: false, levels: ['main'],
        },
        {
          key: 'contentTypeCodes', type: 'array', itemType: 'enum', required: false,
          allowedValues: getAllContentTypeCodes(),
          group: 'textualMaterial', order: 1,
          parentInheritable: false, issueIdentifying: false, levels: ['main'],
        },
        {
          key: 'conferencePublication', type: 'boolean', required: false,
          group: 'textualMaterial', order: 2,
          parentInheritable: false, issueIdentifying: false, levels: ['main'],
        },
        {
          key: 'festschrift', type: 'boolean', required: false,
          group: 'textualMaterial', order: 3,
          parentInheritable: false, issueIdentifying: false, levels: ['main'],
        },
        {
          key: 'indexIndicator', type: 'boolean', required: false,
          group: 'textualMaterial', order: 4,
          parentInheritable: false, issueIdentifying: false, levels: ['main'],
        },
        {
          key: 'literaryForm', type: 'enum', required: false,
          allowedValues: getAllLiteraryFormCodes(),
          group: 'textualMaterial', order: 5,
          parentInheritable: false, issueIdentifying: false, levels: ['main'],
        },
        {
          key: 'biographyCode', type: 'enum', required: false,
          allowedValues: getAllBiographyCodes(),
          group: 'textualMaterial', order: 6,
          parentInheritable: false, issueIdentifying: false, levels: ['main'],
        },
      ],
    },

    // ── Title & responsibility (2XX) ────────────────────────────────────
    {
      key: 'subtitle', type: 'string', required: false,
      group: 'title', order: nextOrder(),
      parentInheritable: true, issueIdentifying: false,
      levels: ['main', 'child'],
    },
    {
      key: 'parallelTitle', type: 'array', itemType: 'string', required: false,
      group: 'title', order: nextOrder(),
      parentInheritable: true, issueIdentifying: false,
      levels: ['main', 'child'],
    },
    {
      key: 'titleInOtherScript', type: 'array', itemType: 'string', required: false,
      group: 'title', order: nextOrder(),
      parentInheritable: true, issueIdentifying: false,
      levels: ['main', 'child'],
    },
    {
      key: 'titleByAnotherAuthor', type: 'string', required: false,
      group: 'title', order: nextOrder(),
      parentInheritable: false, issueIdentifying: false,
      levels: ['main'],
    },
    {
      key: 'titleMediumDesignation', type: 'string', required: false,
      group: 'title', order: nextOrder(),
      parentInheritable: true, issueIdentifying: false,
      levels: ['main', 'child'],
    },
    {
      key: 'firstResponsibility', type: 'string', required: false,
      group: 'responsibility', order: nextOrder(),
      parentInheritable: true, issueIdentifying: false,
      levels: ['main', 'child'],
    },
    {
      key: 'subsequentResponsibility', type: 'array', itemType: 'string', required: false,
      group: 'responsibility', order: nextOrder(),
      parentInheritable: true, issueIdentifying: false,
      levels: ['main', 'child'],
    },

    // ── Authors (7XX) ───────────────────────────────────────────────────
    {
      key: 'authors', type: 'array', itemType: 'object', required: false,
      group: 'responsibility', order: nextOrder(),
      parentInheritable: true, issueIdentifying: false,
      levels: ['main'],
      objectShape: [
        { key: 'familyName', type: 'string', required: false, group: 'responsibility', order: 0, parentInheritable: false, issueIdentifying: false, levels: ['main'] },
        { key: 'firstName', type: 'string', required: false, group: 'responsibility', order: 1, parentInheritable: false, issueIdentifying: false, levels: ['main'] },
        { key: 'prefix', type: 'string', required: false, group: 'responsibility', order: 2, parentInheritable: false, issueIdentifying: false, levels: ['main'] },
        { key: 'romanNumerals', type: 'string', required: false, group: 'responsibility', order: 3, parentInheritable: false, issueIdentifying: false, levels: ['main'] },
        { key: 'dates', type: 'string', required: false, group: 'responsibility', order: 4, parentInheritable: false, issueIdentifying: false, levels: ['main'] },
        {
          key: 'role', type: 'enum', required: false,
          allowedValues: getAllRelatorCodes(),
          group: 'responsibility', order: 5, parentInheritable: false, issueIdentifying: false, levels: ['main'],
        },
        {
          key: 'responsibility', type: 'enum', required: false,
          allowedValues: [
            { code: 'primary', en: 'Primary', cnr: 'Primarni' },
            { code: 'alternative', en: 'Alternative', cnr: 'Alternativni' },
            { code: 'secondary', en: 'Secondary', cnr: 'Sekundarni' },
          ],
          group: 'responsibility', order: 6, parentInheritable: false, issueIdentifying: false, levels: ['main'],
        },
      ],
    },
    {
      key: 'corporateBodies', type: 'array', itemType: 'object', required: false,
      group: 'responsibility', order: nextOrder(),
      parentInheritable: true, issueIdentifying: false,
      levels: ['main'],
      objectShape: [
        { key: 'name', type: 'string', required: true, group: 'responsibility', order: 0, parentInheritable: false, issueIdentifying: false, levels: ['main'] },
        {
          key: 'responsibility', type: 'enum', required: false,
          allowedValues: [
            { code: 'primary', en: 'Primary', cnr: 'Primarni' },
            { code: 'alternative', en: 'Alternative', cnr: 'Alternativni' },
            { code: 'secondary', en: 'Secondary', cnr: 'Sekundarni' },
          ],
          group: 'responsibility', order: 1, parentInheritable: false, issueIdentifying: false, levels: ['main'],
        },
      ],
    },

    // ── Edition / format (2XX continued) ────────────────────────────────
    {
      key: 'edition', type: 'string', required: false,
      group: 'edition', order: nextOrder(),
      parentInheritable: false, issueIdentifying: false,
      levels: ['main'],
    },
    {
      key: 'cartographicMathematicalData', type: 'string', required: false,
      group: 'edition', order: nextOrder(),
      parentInheritable: false, issueIdentifying: false,
      levels: ['main'],
    },
    {
      key: 'numberingAndDates', type: 'string', required: false,
      group: 'edition', order: nextOrder(),
      parentInheritable: false, issueIdentifying: true,
      levels: ['main', 'child'],
    },
    {
      key: 'musicEditionStatement', type: 'string', required: false,
      group: 'edition', order: nextOrder(),
      parentInheritable: false, issueIdentifying: false,
      levels: ['main'],
    },

    // ── Publication (210) ───────────────────────────────────────────────
    {
      key: 'publication', type: 'object', required: false,
      group: 'publication', order: nextOrder(),
      parentInheritable: true, issueIdentifying: false,
      levels: ['main', 'child'],
      objectShape: [
        { key: 'place', type: 'string', required: false, group: 'publication', order: 0, parentInheritable: true, issueIdentifying: false, levels: ['main', 'child'] },
        { key: 'publisher', type: 'string', required: false, group: 'publication', order: 1, parentInheritable: true, issueIdentifying: false, levels: ['main', 'child'] },
        { key: 'year', type: 'string', required: false, group: 'publication', order: 2, parentInheritable: false, issueIdentifying: true, levels: ['main', 'child'] },
        { key: 'placeOfManufacture', type: 'string', required: false, group: 'publication', order: 3, parentInheritable: false, issueIdentifying: false, levels: ['main', 'child'] },
        { key: 'manufacturerName', type: 'string', required: false, group: 'publication', order: 4, parentInheritable: false, issueIdentifying: false, levels: ['main', 'child'] },
      ],
    },

    // ── Physical description (215) ──────────────────────────────────────
    {
      key: 'physicalDescription', type: 'string', required: false,
      group: 'physical', order: nextOrder(),
      parentInheritable: false, issueIdentifying: false,
      levels: ['main', 'child'],
    },
    {
      key: 'otherPhysicalDetails', type: 'string', required: false,
      group: 'physical', order: nextOrder(),
      parentInheritable: false, issueIdentifying: false,
      levels: ['main', 'child'],
    },
    {
      key: 'dimensions', type: 'string', required: false,
      group: 'physical', order: nextOrder(),
      parentInheritable: true, issueIdentifying: false,
      levels: ['main', 'child'],
    },

    // ── Series (225) ────────────────────────────────────────────────────
    {
      key: 'seriesTitle', type: 'string', required: false,
      group: 'series', order: nextOrder(),
      parentInheritable: true, issueIdentifying: false,
      levels: ['main', 'child'],
    },
    {
      key: 'seriesSubtitle', type: 'string', required: false,
      group: 'series', order: nextOrder(),
      parentInheritable: true, issueIdentifying: false,
      levels: ['main', 'child'],
    },
    {
      key: 'seriesResponsibility', type: 'string', required: false,
      group: 'series', order: nextOrder(),
      parentInheritable: true, issueIdentifying: false,
      levels: ['main', 'child'],
    },
    {
      key: 'seriesIssn', type: 'string', required: false,
      group: 'series', order: nextOrder(),
      parentInheritable: true, issueIdentifying: false,
      levels: ['main', 'child'],
    },
    {
      key: 'seriesVolume', type: 'string', required: false,
      group: 'series', order: nextOrder(),
      parentInheritable: false, issueIdentifying: true,
      levels: ['main', 'child'],
    },

    // ── Notes (3XX) ─────────────────────────────────────────────────────
    {
      key: 'notes', type: 'array', itemType: 'string', required: false,
      group: 'notes', order: nextOrder(),
      parentInheritable: false, issueIdentifying: false,
      levels: ['main', 'child'],
    },

    // ── Electronic location (856) ───────────────────────────────────────
    {
      key: 'electronicLocation', type: 'array', itemType: 'object', required: false,
      group: 'electronic', order: nextOrder(),
      parentInheritable: false, issueIdentifying: false,
      levels: ['main', 'child'],
      objectShape: [
        { key: 'url', type: 'string', required: true, group: 'electronic', order: 0, parentInheritable: false, issueIdentifying: false, levels: ['main', 'child'] },
      ],
    },
  ];

  return fields;
}

// ─── cached result ──────────────────────────────────────────────────────────

const ALL_FIELDS = buildRecordFields();

@Injectable()
export class SchemaService {

  getRecordSchema(level?: 'main' | 'child'): { fields: FieldDescriptor[] } {
    const fields = level
      ? ALL_FIELDS.filter(f => f.levels.includes(level))
      : ALL_FIELDS;
    return { fields };
  }
}
