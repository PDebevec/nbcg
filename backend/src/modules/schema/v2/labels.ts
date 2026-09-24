import type { Label } from './schema-v2.types';

// Field and group captions for schema v2, in every UI language.
//
// Taken from the web frontend's `src/i18n/*/index.ts` (`admin.edit.fields`,
// `admin.edit.hints`, `admin.history.fields`) where a caption already existed.
// Entries marked NEW had no caption anywhere before v2 and need a Montenegrin
// check by the library (listed in docs/backend/reference.md#schema-v2).

/** Keyed by group key. */
export const GROUP_LABELS: Record<string, Label> = {
  basic:           { en: 'Basic', cnr: 'Osnovno' },                                  // NEW
  issue:           { en: 'Issue', cnr: 'Podaci o broju' },                           // NEW
  identification:  { en: 'Identification', cnr: 'Identifikacija' },
  title:           { en: 'Title', cnr: 'Naslov' },
  responsibility:  { en: 'Responsibility', cnr: 'Odgovornost' },
  edition:         { en: 'Edition and specific data', cnr: 'Izdanje i posebni podaci' }, // NEW
  publication:     { en: 'Publication', cnr: 'Izdavanje' },
  physical:        { en: 'Physical description', cnr: 'Fizički opis' },
  series:          { en: 'Series', cnr: 'Edicija' },
  dates:           { en: 'Coded dates', cnr: 'Kodirani datumi' },                    // NEW
  language:        { en: 'Languages and countries', cnr: 'Jezici i države' },
  textualMaterial: { en: 'Coded data (105)', cnr: 'Kodirani podaci (105)' },
  subject:         { en: 'Subject', cnr: 'Predmet' },                                // NEW
  notes:           { en: 'Notes', cnr: 'Napomene' },
  electronic:      { en: 'Online locations', cnr: 'Lokacije na internetu' },
};

/** Keyed by dotted field path: `publisher` lives at `publication.publisher`. */
export const FIELD_LABELS: Record<string, Label> = {
  title:                        { en: 'Title', cnr: 'Naslov' },
  collectionType:               { en: 'Collection type', cnr: 'Vrsta zbirke' },

  issue:                        { en: 'Issue', cnr: 'Podaci o broju' },            // NEW
  'issue.volume':               { en: 'Volume', cnr: 'Godište' },                  // NEW
  'issue.number':               { en: 'Issue number', cnr: 'Broj' },               // NEW
  'issue.date':                 { en: 'Issue date', cnr: 'Datum izlaska' },        // NEW

  cobissId:                     { en: 'COBISS ID', cnr: 'COBISS ID' },
  recordType:                   { en: 'Record type', cnr: 'Vrsta zapisa' },
  bibliographicLevel:           { en: 'Bibliographic level', cnr: 'Bibliografski nivo' },
  materialType:                 { en: 'Material type', cnr: 'Vrsta građe' },
  documentTypology:             { en: 'Document typology', cnr: 'Tipologija dokumenta' },
  isbn:                         { en: 'ISBN', cnr: 'ISBN' },
  issn:                         { en: 'ISSN', cnr: 'ISSN' },
  ismn:                         { en: 'ISMN', cnr: 'ISMN' },

  subtitle:                     { en: 'Subtitle', cnr: 'Podnaslov' },
  parallelTitle:                { en: 'Parallel titles', cnr: 'Paralelni naslovi' },
  titleInOtherScript:           { en: 'Title in other script', cnr: 'Naslov na drugom pismu' },
  titleByAnotherAuthor:         { en: 'Title by another author', cnr: 'Naslov drugog autora' },
  titleMediumDesignation:       { en: 'Material designation', cnr: 'Opšta oznaka građe' },

  firstResponsibility:          { en: 'Statement of responsibility', cnr: 'Podatak o odgovornosti' },
  subsequentResponsibility:     { en: 'Further statements of responsibility', cnr: 'Ostali podaci o odgovornosti' },
  authors:                      { en: 'Authors', cnr: 'Autori' },
  'authors.familyName':         { en: 'Family name', cnr: 'Prezime' },
  'authors.firstName':          { en: 'First name', cnr: 'Ime' },
  'authors.prefix':             { en: 'Prefix', cnr: 'Prefiks' },
  'authors.romanNumerals':      { en: 'Roman numerals', cnr: 'Rimski brojevi' },
  'authors.dates':              { en: 'Dates', cnr: 'Godine' },
  'authors.role':               { en: 'Role', cnr: 'Uloga' },
  'authors.responsibility':     { en: 'Responsibility', cnr: 'Odgovornost' },
  corporateBodies:              { en: 'Corporate bodies', cnr: 'Korporativna tijela' },
  'corporateBodies.name':       { en: 'Corporate body name', cnr: 'Naziv korporativnog tijela' },
  'corporateBodies.responsibility': { en: 'Responsibility', cnr: 'Odgovornost' },

  edition:                      { en: 'Edition', cnr: 'Izdanje' },
  cartographicMathematicalData: { en: 'Mathematical data (maps)', cnr: 'Matematički podaci (karte)' },
  numberingAndDates:            { en: 'Numbering and dates (serials)', cnr: 'Numeracija i datumi (serijske publikacije)' },
  musicEditionStatement:        { en: 'Music edition statement', cnr: 'Podatak o muzičkom izdanju' },

  publication:                  { en: 'Publication', cnr: 'Izdavanje' },
  'publication.place':          { en: 'Place of publication', cnr: 'Mjesto izdavanja' },
  'publication.publisher':      { en: 'Publisher', cnr: 'Izdavač' },
  'publication.year':           { en: 'Year', cnr: 'Godina' },
  'publication.placeOfManufacture': { en: 'Place of manufacture', cnr: 'Mjesto štampanja' },
  'publication.manufacturerName':   { en: 'Manufacturer', cnr: 'Štamparija' },

  // The web editor called 215/a "Extent"; v2 has a numeric `extent`, so the
  // free-text statement is renamed. NEW caption.
  physicalDescription:          { en: 'Extent statement', cnr: 'Podatak o obimu' },
  extent:                       { en: 'Extent', cnr: 'Obim' },                     // NEW
  otherPhysicalDetails:         { en: 'Other physical details', cnr: 'Ostali fizički detalji' },
  dimensions:                   { en: 'Dimensions', cnr: 'Dimenzije' },

  seriesTitle:                  { en: 'Series title', cnr: 'Naslov edicije' },
  seriesSubtitle:               { en: 'Series subtitle', cnr: 'Podnaslov edicije' },
  seriesResponsibility:         { en: 'Series responsibility', cnr: 'Odgovornost za ediciju' },
  seriesIssn:                   { en: 'Series ISSN', cnr: 'ISSN edicije' },
  seriesVolume:                 { en: 'Volume in series', cnr: 'Sveska u ediciji' },

  publicationDate1:             { en: 'Date 1', cnr: 'Datum 1' },
  publicationDate2:             { en: 'Date 2', cnr: 'Datum 2' },

  language:                     { en: 'Languages', cnr: 'Jezici' },
  originalLanguage:             { en: 'Original languages', cnr: 'Izvorni jezici' },
  translationLanguages:         { en: 'Summary languages', cnr: 'Jezici sažetka' },
  country:                      { en: 'Countries', cnr: 'Države' },

  textualMaterialCodes:         { en: 'Coded data (105)', cnr: 'Kodirani podaci (105)' },
  'textualMaterialCodes.illustrationCodes':     { en: 'Illustrations', cnr: 'Ilustracije' },
  'textualMaterialCodes.contentTypeCodes':      { en: 'Content types', cnr: 'Vrste sadržaja' },
  'textualMaterialCodes.conferencePublication': { en: 'Conference publication', cnr: 'Konferencijska publikacija' },
  'textualMaterialCodes.festschrift':           { en: 'Festschrift', cnr: 'Spomenica' },
  'textualMaterialCodes.indexIndicator':        { en: 'Has an index', cnr: 'Ima registar' },
  'textualMaterialCodes.literaryForm':          { en: 'Literary form', cnr: 'Književna forma' },
  'textualMaterialCodes.biographyCode':         { en: 'Biography', cnr: 'Biografija' },

  keywords:                     { en: 'Keywords', cnr: 'Ključne riječi' },         // NEW
  summaryNote:                  { en: 'Summary', cnr: 'Sažetak' },
  notes:                        { en: 'Notes', cnr: 'Napomene' },

  electronicLocation:           { en: 'Online locations', cnr: 'Lokacije na internetu' },
  'electronicLocation.url':     { en: 'URL', cnr: 'URL' },
};

/** Optional tooltips, keyed like FIELD_LABELS. */
export const FIELD_HELP: Record<string, Label> = {
  cobissId:                     { en: 'Optional. Locks the item to this COBISS record.', cnr: 'Neobavezno. Vezuje zapis za ovaj COBISS zapis.' },
  titleMediumDesignation:       { en: 'e.g. "electronic resource"', cnr: 'npr. „elektronski izvor“' },
  firstResponsibility:          { en: 'As printed on the title page', cnr: 'Kako je odštampano na naslovnoj strani' },
  'publication.year':           { en: 'As printed (210d)', cnr: 'Kako je odštampano (210d)' },
  publicationDate1:             { en: 'Coded year (100c)', cnr: 'Kodirana godina (100c)' },
  publicationDate2:             { en: 'End / copyright year (100d)', cnr: 'Završna godina / godina autorskog prava (100d)' },
  physicalDescription:          { en: 'e.g. "312 p."', cnr: 'npr. „312 str.“' },
  dimensions:                   { en: 'e.g. "24 cm"', cnr: 'npr. „24 cm“' },
  originalLanguage:             { en: 'For translations', cnr: 'Za prevode' },
  translationLanguages:         { en: 'Languages of summaries or abstracts', cnr: 'Jezici sažetaka ili apstrakata' },
  cartographicMathematicalData: { en: 'Scale, projection …', cnr: 'Razmjera, projekcija …' },
  numberingAndDates:            { en: 'e.g. "Vol. 1 (1927)-"', cnr: 'npr. „God. 1 (1927)-“' },
  keywords:                     { en: 'Free keywords (610)', cnr: 'Slobodne ključne riječi (610)' },   // NEW
  'issue.date':                 { en: 'YYYY, YYYY-MM or YYYY-MM-DD', cnr: 'GGGG, GGGG-MM ili GGGG-MM-DD' }, // NEW
};

/** Captions and tooltips that rules switch to. All NEW. */
export const RULE_LABELS = {
  extentPages:   { en: 'Number of pages', cnr: 'Broj strana' },
  extentMinutes: { en: 'Duration', cnr: 'Trajanje' },
  extentSheets:  { en: 'Number of sheets', cnr: 'Broj listova' },
  scale:         { en: 'Scale', cnr: 'Razmjera' },
  scaleHelp:     { en: 'e.g. 1:25 000', cnr: 'npr. 1:25 000' },
  cobissIdLocked: { en: 'Cannot be changed after creation.', cnr: 'Ne može se mijenjati nakon kreiranja.' },
  partialDate:   { en: 'YYYY, YYYY-MM or YYYY-MM-DD', cnr: 'GGGG, GGGG-MM ili GGGG-MM-DD' },
} satisfies Record<string, Label>;
