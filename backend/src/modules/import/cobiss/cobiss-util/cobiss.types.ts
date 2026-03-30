/**
 * COMARC/B Format for Bibliographic Data
 * TypeScript interface based on COBISS/UNIMARC documentation.
 *
 * Fields marked with RED in the source document are uncommented (actively used).
 * Fields marked in BLACK (additional COMARC/B fields) are commented out.
 *
 * Reference: https://home.izum.si/izum/e_manuals_html/COMARC_B/eng/ch1.html
 */

import type { ResolvedCode } from './cobiss-code-map';
export type { ResolvedCode } from './cobiss-code-map';

export interface DomainRecord {

  cobissId?: string;                          // COBISS record identifier passed in at fetch time

  // ============================================================
  // 0XX — IDENTIFICATION BLOCK
  // ============================================================
  
  // --- 001: Record identifier ---
  recordType?:         ResolvedCode;          // 001/b – type of record (vrsta zapisa)
  bibliographicLevel?: ResolvedCode;          // 001/c – bibliographic level (bibliografski nivo)
  materialType?:       ResolvedCode;          // 001/b+c combined – computed material type (vrsta građe)
  documentTypology?:   string;                // 001/t – document/work typology (tipologija dokumenata/djela)

  // --- 010: ISBN ---
  isbn?: string[];                            // 010/a – International Standard Book Number (ISBN) [RED]
  // isbnQualifications?: string[];           // 010/b – Qualifying information for ISBN
  // isbnCancelled?: string[];                // 010/z – Cancelled/invalid ISBN

  // --- 011: ISSN ---
  issn?: string[];                            // 011/a – International Standard Serial Number (ISSN) [RED]
  // issnKeyTitle?: string;                   // 011/e – Key title associated with the ISSN
  // issnCancelledOrInvalid?: string[];       // 011/z – Cancelled/invalid ISSN

  // --- 013: ISMN ---
  ismn?: string[];                            // 013/a – International Standard Music Number (ISMN) [RED]
  // ismnQualifications?: string[];           // 013/b – Qualifications for ISMN
  // ismnCancelled?: string[];                // 013/z – Cancelled/invalid ISMN

  // --- 016: ISRC ---
  // isrc?: string[];                         // 016/a – International Standard Recording Code (ISRC)
  // isrcQualifications?: string[];           // 016/b – ISRC qualifications
  // isrcCancelled?: string[];                // 016/z – Cancelled/erroneous ISRC

  // --- 017: Other standard identifiers ---
  // otherIdentifiers?: Array<{
  //   identifier: string;                    // 017/a – Identifier value
  //   type?: string;                         // 017/b – Type/system of identifier
  // }>;

  // --- 020: National bibliography number ---
  // nationalBibNumber?: string[];            // 020/a – National bibliography number
  // nationalBibCountryCode?: string[];       // 020/b – Country code

  // --- 071: Publisher's number ---
  // publisherNumbers?: Array<{
  //   number: string;                        // 071/a – Publisher's number
  //   publisher?: string;                    // 071/b – Source (publisher name)
  //   type?: string;                         // 071 ind1: 0=issue, 1=matrix, 2=plate, 3=other
  // }>;


  // ============================================================
  // 1XX — CODED INFORMATION BLOCK
  // ============================================================

  // --- 100: Date of publication, production, etc. [RED] ---
  publicationDate1?:    string;   // 100/c – date 1 (start year / publication year)
  publicationDate2?:    string;   // 100/d – date 2 (end year / copyright year / original year etc.)

  // --- 101: Language of the item [RED] ---
  language?: ResolvedCode[];                  // 101/a – Primary language(s) of the text [RED]
  originalLanguage?: ResolvedCode[];          // 101/c – Language of original (for translations) [RED]
  translationLanguages?: ResolvedCode[];      // 101/d – Language of summaries or abstracts [RED]
  // tableOfContentsLanguages?: string[];     // 101/f – Language of table of contents
  // subtitleLanguages?: string[];            // 101/g – Language of subtitles / title proper language
  // languageOfLibretto?: string[];           // 101/h – Language of libretto
  // languageOfOriginalTitle?: string[];      // 101/i – Language of original title (intermediate translation)
  // languageOfIntermediate?: string[];       // 101/j – Language of intermediate translation

  // --- 102: State of issuance or production [RED] ---
  country?: ResolvedCode[];                   // 102/a – Country of publication or production code(s) [RED]
  // locality?: string[];                     // 102/b – Locality within country (ISO 3166-2 code)

  // --- 105: Textual Material – Monographs [RED] ---
  textualMaterialCodes?: {
    illustrationCodes?:     ResolvedCode[];   // 105/a (repeatable)
    contentTypeCodes?:      ResolvedCode[];   // 105/b (repeatable)
    conferencePublication?: boolean;          // 105/c  1=true
    festschrift?:           boolean;          // 105/d  1=true
    indexIndicator?:        boolean;          // 105/e  1=true
    literaryForm?:          ResolvedCode;     // 105/f
    biographyCode?:         ResolvedCode;     // 105/g
  };

  // --- 106: Form of item (textual) ---
  // formOfItem?: string;                     // 106/a – Form of item code (e.g. braille, large print)

  // --- 110: Continuing Resources – General ---
  // continuingResourceCodes?: {
  //   frequency?: string;                    // 110/a – Frequency code
  //   regularity?: string;                   // 110/b – Regularity code
  //   typeOfContinuingResource?: string;     // 110/c – Type of continuing resource
  //   natureOfContents?: string;             // 110/d – Nature of contents codes (4 chars)
  //   natureOfWork?: string;                 // 110/e – Nature of work code
  //   originCode?: string;                   // 110/f – Origin code
  //   entryConvention?: string;              // 110/g – Entry convention code
  // };

  // --- 115: Visual materials / projected graphics ---
  // visualMaterialCodes?: {
  //   specificMaterialDesignation?: string;  // 115/a – Specific material designation (1 char)
  //   colour?: string;                       // 115/b – Colour characteristic (2 chars)
  //   baseOfEmulsion?: string;               // 115/c – Base of emulsion of film/sound recording
  //   soundOnMedium?: string;                // 115/d – Sound on medium or separate
  //   mediumForSound?: string;               // 115/e – Medium for sound
  //   dimensionsOfFilm?: string;             // 115/f – Dimensions of film
  //   configuration?: string;                // 115/g – Configuration of playback channels
  // };

  // --- 116: Graphics ---
  // graphicsCodes?: {
  //   specificMaterialDesignation?: string;  // 116/a – Specific material designation
  //   colour?: string;                       // 116/b – Colour characteristic
  //   primarySupportMaterial?: string;       // 116/c – Primary support material
  //   secondarySupportMaterial?: string;     // 116/d – Secondary support material
  // };

  // --- 117: Three-dimensional artefacts ---
  // artifactCodes?: {
  //   specificMaterialDesignation?: string;  // 117/a – Specific material designation
  //   colour?: string;                       // 117/b – Colour characteristic
  //   material?: string;                     // 117/c – Material
  // };

  // --- 120: Cartographic resources – general codes ---
  // cartographicGeneralCodes?: {
  //   specificMaterialDesignation?: string;  // 120/a – Specific material designation (2 chars)
  //   colour?: string;                       // 120/b – Colour characteristic
  //   physicalMedium?: string;               // 120/c – Physical medium
  //   typeOfReproduction?: string;           // 120/d – Type of reproduction
  //   productionDetails?: string;            // 120/e – Production/reproduction details
  //   positiveOrNegative?: string;           // 120/f – Positive or negative aspect
  // };

  // --- 121: Cartographic resources – physical characteristics ---
  // cartographicPhysicalCodes?: {
  //   altitude?: string;                     // 121/a – Altitude of sensor
  //   attitude?: string;                     // 121/b – Attitude of sensor
  //   cloudCover?: string;                   // 121/c – Cloud cover
  //   platform?: string;                     // 121/d – Platform construction type
  //   platformUse?: string;                  // 121/e – Platform use category
  //   sensorType?: string;                   // 121/f – Sensor type
  //   dataType?: string;                     // 121/g – Data type (remote sensing image)
  // };

  // --- 123: Cartographic resources – scale and projection ---
  // cartographicScaleCodes?: {
  //   scaleType?: string;                    // 123/a – Scale type (a/b/c)
  //   scaleExponent?: string;                // 123/b – Constant ratio linear horizontal scale
  //   verticalScaleExponent?: string;        // 123/c – Constant ratio linear vertical scale
  //   angularScale?: string;                 // 123/d – Angular scale
  //   caliper?: string;                      // 123/e – Caliper (distance from equator)
  //   projection?: string;                   // 123/f – Projection code
  //   planimetricZone?: string;              // 123/g – Zone of UTM
  //   ellipsoid?: string;                    // 123/h – Ellipsoid
  //   epochOfEllipsoid?: string;             // 123/i – Epoch of ellipsoid
  // };

  // --- 124: Cartographic resources – specific material designation ---
  // cartographicSpecificCodes?: {
  //   specificMaterialDesignation?: string;  // 124/a – Specific material designation
  //   specificMaterialDesignationAdditions?: string; // 124/b
  // };

  // --- 125: Sound recordings and music ---
  // soundRecordingCodes?: {
  //   transpositionArrangement?: string;     // 125/a – Transposition and arrangement
  //   specificMaterialDesignation?: string;  // 125/b – Specific material designation (2 chars)
  //   groove?: string;                       // 125/c – Groove width / pitch
  //   dimensionsOfDisc?: string;             // 125/d – Dimensions of disc / tape width
  //   tapeConfiguration?: string;            // 125/e – Tape configuration
  //   kindOfDisc?: string;                   // 125/f – Kind of disc, cylinder, tape
  //   kindOfMaterial?: string;               // 125/g – Kind of material
  //   kindOfCutting?: string;                // 125/h – Kind of cutting
  //   captureMode?: string;                  // 125/i – Special playback characteristics
  //   playbackMode?: string;                 // 125/j – Special reproduction characteristics
  // };

  // --- 126: Sound recordings – music ---
  // soundMusicCodes?: {
  //   compositionCode?: string;              // 126/a – Composition code (2 chars)
  //   formatOfMusic?: string;                // 126/b – Format of music code
  //   musicParts?: string;                   // 126/c – Music parts code
  //   targetAudience?: string;               // 126/d – Target audience code
  //   accompanyingMatter?: string;           // 126/e – Nature of accompanying matter (6 chars)
  //   literaryText?: string;                 // 126/f – Nature of literary text (2 chars)
  //   transpositionCode?: string;            // 126/g – Transposition and arrangement code
  // };

  // --- 127: Duration ---
  // duration?: string;                       // 127/a – Duration (HHMMSS)

  // --- 128: Music ---
  // musicCodes?: {
  //   compositionCode?: string;              // 128/a – Composition code (2 chars)
  //   formatOfMusic?: string;                // 128/b – Format of music
  //   musicParts?: string;                   // 128/c – Music parts
  // };

  // --- 130: Microform characteristics ---
  // microformCodes?: {
  //   specificMaterialDesignation?: string;  // 130/a – Specific material designation (1 char)
  //   polarity?: string;                     // 130/b – Polarity
  //   dimensions?: string;                   // 130/c – Dimensions
  //   reductionRatioRange?: string;          // 130/d – Reduction ratio range
  //   reductionRatio?: string;               // 130/e – Reduction ratio
  //   colour?: string;                       // 130/f – Colour characteristic
  //   emulsionOnFilm?: string;               // 130/g – Emulsion on film
  //   generation?: string;                   // 130/h – Generation
  //   baseOfFilm?: string;                   // 130/i – Base of film
  // };

  // --- 131: Cartographic resources – geodetic survey ---
  // geodetic?: {
  //   system?: string;                       // 131/a – Geodetic, grid and vertical measurement
  // };

  // --- 135: Electronic resources ---
  // electronicResourceCodes?: {
  //   specificMaterialDesignation?: string;  // 135/a – Specific material designation (1 char)
  //   colour?: string;                       // 135/b – Colour characteristic
  //   dimensionsCode?: string;               // 135/c – Dimensions
  //   sound?: string;                        // 135/d – Sound
  //   imageBitDepth?: string;                // 135/e – Image bit depth
  //   fileFormats?: string;                  // 135/f – File formats
  //   qualityLevel?: string;                 // 135/g – Quality level
  //   sourceOfFile?: string;                 // 135/h – Source of file
  //   levelOfCompression?: string;           // 135/i – Level of compression
  //   reformattingQuality?: string;          // 135/j – Reformatting quality
  // };

  // --- 140: Antiquarian books – general codes ---
  // antiquarianCodes?: string;              // 140/a – 10-char coded data for antiquarian books

  // --- 141: Antiquarian books – copy-specific codes ---
  // antiquarianCopySpecificCodes?: string;  // 141/a – 13-char copy-specific codes


  // ============================================================
  // 2XX — DESCRIPTIVE INFORMATION BLOCK
  // ============================================================

  // --- 200: Title and Responsibility Data [RED] ---
  title?: string;                             // 200/a – Title proper (main title) [RED]
  titleMediumDesignation?: string;            // 200/b – General material designation (e.g. "electronic resource") [RED]
  titleByAnotherAuthor?: string;              // 200/c – Title proper by another author [RED]
  parallelTitle?: string[];                   // 200/d – Parallel title(s) in other languages [RED]
  subtitle?: string;                          // 200/e – Other title information (subtitle) [RED]
  firstResponsibility?: string;               // 200/f – First statement of responsibility [RED]
  subsequentResponsibility?: string[];        // 200/g – Subsequent statements of responsibility [RED]
  // partNumber?: string[];                   // 200/h – Number of part / section
  // partName?: string[];                     // 200/i – Name of part / section
  // inclusiveDates?: string;                 // 200/j – Inclusive dates (archival collections)
  // bulkDates?: string;                      // 200/k – Bulk dates (archival collections)
  // parallelTitleLanguage?: string[];        // 200/z – Language code of parallel title (200/d)

  // --- 205: Edition [RED] ---
  edition?: string;                           // 205/a – Edition statement (e.g. "2nd edition") [RED]
  // parallelEdition?: string;               // 205/d – Parallel edition statement
  // editionResponsibility?: string;         // 205/f – Statement of responsibility relating to edition
  // additionalEditionStatement?: string;    // 205/b – Additional edition statement

  // --- 206: Cartographic Material – Mathematical Data [RED] ---
  cartographicMathematicalData?: string;      // 206/a – Mathematical data (scale, projection, etc.) [RED]

  // --- 207: Continuing Sources – Numbering [RED] ---
  numberingAndDates?: string;                 // 207/a – Numbering / publication year of continuing source [RED]

  // --- 208: Music / Musicals [RED] ---
  musicEditionStatement?: string;             // 208/a – Music edition / specific information about musicals [RED]

  // --- 210: Issuance, distribution, etc. [RED] ---
  publication?: {
    place?: string;                           // 210/a – Place of publication [RED]
    publisher?: string;                       // 210/c – Publisher / distributor name [RED]
    year?: string;                            // 210/d – Year of publication [RED]
    placeOfManufacture?: string;              // 210/e – Place of manufacture [RED]
    manufacturerName?: string;                // 210/g – Manufacturer name [RED]
    // manufacturerDate?: string;             // 210/h – Date of manufacture
  };

  // --- 211: Projected publication date ---
  // projectedPublicationDate?: string;       // 211/a – Projected publication date (YYYYMM)

  // --- 215: Physical description [RED] ---
  physicalDescription?: string;               // 215/a – Extent and specific material designation [RED]
  otherPhysicalDetails?: string;              // 215/c – Other physical details (illus., colour, sound) [RED]
  dimensions?: string;                        // 215/d – Dimensions (e.g. "24 cm") [RED]
  // accompanyingMaterial?: string;           // 215/e – Accompanying material

  // --- 225: The Collection / Series [RED] ---
  seriesTitle?: string;                       // 225/a – Series title [RED]
  seriesSubtitle?: string;                    // 225/e – Series subtitle / other series title information [RED]
  seriesResponsibility?: string;              // 225/f – Statement of responsibility for the series [RED]
  seriesIssn?: string;                        // 225/x – ISSN of the series [RED]
  seriesVolume?: string;                      // 225/v – Volume / numbering within the series [RED]
  // parallelSeriesTitle?: string[];          // 225/d – Parallel series title
  // seriesIssueNumber?: string;              // 225/h – Issue number or section number


  // ============================================================
  // 3XX — NOTES BLOCK
  // ============================================================

  // --- 300: General notes [RED] ---
  notes?: string[];                           // 300/a – General notes [RED]

  // --- 301: Notes on identifiers ---
  // notesOnIdentifiers?: string[];           // 301/a – Notes on identifiers and terms of availability

  // --- 302: Notes on coded information ---
  // notesOnCodedInfo?: string[];             // 302/a – Notes on coded information

  // --- 303: Notes on description ---
  // notesOnDescription?: string[];           // 303/a – Notes on description (general cataloguing notes)

  // --- 304: Notes on title ---
  // notesOnTitle?: string[];                 // 304/a – Notes on title (source of title, title variations)

  // --- 305: Notes on edition / history ---
  // notesOnEdition?: string[];               // 305/a – Notes on edition and bibliographic history

  // --- 306: Notes on publication, distribution, etc. ---
  // notesOnPublication?: string[];           // 306/a – Notes on publication, distribution, etc.

  // --- 307: Notes on physical description ---
  // notesOnPhysicalDesc?: string[];          // 307/a – Notes on physical description

  // --- 308: Notes on series ---
  // notesOnSeries?: string[];                // 308/a – Notes on series / multipart resources

  // --- 310: Notes on binding ---
  // notesOnBinding?: string[];               // 310/a – Notes on binding and availability

  // --- 311: Notes on linking fields ---
  // notesOnLinkingFields?: string[];         // 311/a – Notes on linking fields

  // --- 312: Notes on related titles ---
  // notesOnRelatedTitles?: string[];         // 312/a – Notes on related titles

  // --- 314: Notes on intellectual responsibility ---
  // notesOnIntellectualResp?: string[];      // 314/a – Notes on intellectual responsibility (attributions, dedications)

  // --- 315: Notes on material or type of resource ---
  // notesOnMaterialType?: string[];          // 315/a – Notes on material or type of resource

  // --- 316: Notes on copy being described (copy-specific) ---
  // notesOnCopy?: string[];                  // 316/a – Notes on copy being described (provenance, binding, etc.)

  // --- 317: Notes on provenance ---
  // notesOnProvenance?: string[];            // 317/a – Notes on provenance

  // --- 318: Notes on processing action ---
  // notesOnProcessing?: string[];            // 318/a – Notes on processing action (archival)

  // --- 320: Notes on bibliographies / indexes ---
  // notesOnBibliographies?: string[];        // 320/a – Notes on bibliographies and indexes

  // --- 321: Notes on referenced works ---
  // notesOnReferencedWorks?: string[];       // 321/a – Notes on referenced or cited works

  // --- 322: Notes on credits ---
  // notesOnCredits?: string[];               // 322/a – Credits (performers, production crew)

  // --- 323: Notes on cast ---
  // notesOnCast?: string[];                  // 323/a – Notes on cast

  // --- 324: Notes on facsimile ---
  // notesOnFacsimile?: string[];             // 324/a – Notes on facsimile or reproduction

  // --- 325: Notes on reproduction ---
  // notesOnReproduction?: string[];          // 325/a – Notes on reproduction

  // --- 326: Notes on frequency (serials) ---
  // notesOnFrequency?: string[];             // 326/a – Notes on frequency of issue (serials)

  // --- 327: Notes on contents ---
  // notesOnContents?: string[];              // 327/a – Contents note (structured or free-text)

  // --- 328: Notes on dissertation ---
  // notesOnDissertation?: string[];          // 328/a – Notes on dissertation or thesis

  // --- 330: Abstract or summary ---
  // abstract?: string;                       // 330/a – Summary or abstract

  // --- 332: Preferred citation ---
  // preferredCitation?: string;              // 332/a – Preferred citation of described materials

  // --- 333: Notes on audience ---
  // notesOnAudience?: string;                // 333/a – Notes on users / intended audience

  // --- 334: Notes on awards ---
  // notesOnAwards?: string[];                // 334/a – Notes on awards

  // --- 336: Notes on type of electronic resource ---
  // notesOnElectronicResource?: string;      // 336/a – Notes on type of electronic resource

  // --- 337: System requirements ---
  // systemRequirements?: string;             // 337/a – System requirements for electronic resources

  // --- 338: Notes on availability ---
  // notesOnAvailability?: string;            // 338/a – Notes on acquisition / financing

  // --- 345: Acquisition information ---
  // acquisitionInfo?: string[];              // 345/a – Source of acquisition; ordering address


  // ============================================================
  // 4XX — LINKING ENTRY BLOCK
  // ============================================================

  // --- 410: Series (appears in) ---
  // series?: Array<{
  //   title: string;                         // 410/t – Series title
  //   issn?: string;                         // 410/x – Series ISSN
  //   volume?: string;                       // 410/v – Volume / numbering within series
  //   recordId?: string;                     // 410/1 – Record identifier of linked record
  // }>;

  // --- 411: Subseries ---
  // subseries?: Array<{
  //   title: string;                         // 411/t – Subseries title
  //   issn?: string;                         // 411/x – Subseries ISSN
  //   volume?: string;                       // 411/v – Numbering within subseries
  // }>;

  // --- 421: Supplement to ---
  // supplementTo?: Array<{
  //   title: string;                         // 421/t – Title of parent publication
  //   issn?: string;                         // 421/x – ISSN of parent publication
  // }>;

  // --- 422: Supplement / special issue ---
  // hasSupplements?: Array<{
  //   title: string;                         // 422/t – Title of supplement
  //   issn?: string;                         // 422/x – ISSN of supplement
  // }>;

  // --- 423: Issued with ---
  // issuedWith?: Array<{
  //   title: string;                         // 423/t – Title of co-issued item
  //   recordId?: string;                     // 423/1 – Record identifier of linked record
  // }>;

  // --- 430: Continues ---
  // continues?: Array<{
  //   title: string;                         // 430/t – Title of preceding publication
  //   issn?: string;                         // 430/x – ISSN of preceding publication
  // }>;

  // --- 431: Continues in part ---
  // continuesInPart?: Array<{
  //   title: string;                         // 431/t – Title of preceding publication
  // }>;

  // --- 432: Supersedes ---
  // supersedes?: Array<{
  //   title: string;                         // 432/t – Title of superseded publication
  // }>;

  // --- 433: Supersedes in part ---
  // supersedesInPart?: Array<{
  //   title: string;                         // 433/t – Title of superseded publication (partial)
  // }>;

  // --- 434: Absorbed ---
  // absorbed?: Array<{
  //   title: string;                         // 434/t – Title of absorbed publication
  // }>;

  // --- 435: Absorbed in part ---
  // absorbedInPart?: Array<{
  //   title: string;                         // 435/t – Title of partially absorbed publication
  // }>;

  // --- 436: Formed by merger of ---
  // formedByMergerOf?: Array<{
  //   title: string;                         // 436/t – Title of merged publication
  // }>;

  // --- 437: Separated from ---
  // separatedFrom?: Array<{
  //   title: string;                         // 437/t – Title of source publication
  // }>;

  // --- 440: Continued by ---
  // continuedBy?: Array<{
  //   title: string;                         // 440/t – Title of succeeding publication
  //   issn?: string;                         // 440/x – ISSN of succeeding publication
  // }>;

  // --- 441: Continued in part by ---
  // continuedInPartBy?: Array<{
  //   title: string;                         // 441/t – Title of partial successor
  // }>;

  // --- 442: Superseded by ---
  // supersededBy?: Array<{
  //   title: string;                         // 442/t – Title of superseding publication
  // }>;

  // --- 443: Superseded in part by ---
  // supersededInPartBy?: Array<{
  //   title: string;                         // 443/t – Title of partial superseding publication
  // }>;

  // --- 444: Absorbed by ---
  // absorbedBy?: Array<{
  //   title: string;                         // 444/t – Title of absorbing publication
  // }>;

  // --- 445: Absorbed in part by ---
  // absorbedInPartBy?: Array<{
  //   title: string;                         // 445/t – Title of partially absorbing publication
  // }>;

  // --- 446: Merged with to form ---
  // mergedWithToForm?: Array<{
  //   title: string;                         // 446/t – Title of merged result publication
  // }>;

  // --- 447: Split into ---
  // splitInto?: Array<{
  //   title: string;                         // 447/t – Title of split result publication
  // }>;

  // --- 448: Changed back to ---
  // changedBackTo?: Array<{
  //   title: string;                         // 448/t – Title reverted to after temporary change
  // }>;

  // --- 451: Other edition (same language) ---
  // otherEditions?: Array<{
  //   title: string;                         // 451/t – Title of other edition
  //   isbn?: string;                         // 451/z – ISBN of other edition
  // }>;

  // --- 452: Replaced by (revised edition) ---
  // replacedBy?: Array<{
  //   title: string;                         // 452/t – Title of replacing publication
  // }>;

  // --- 453: Translation of ---
  // translationOf?: Array<{
  //   title: string;                         // 453/t – Title of original work
  //   language?: string;                     // 453/m – Language of original work
  // }>;

  // --- 454: Translated as ---
  // translatedAs?: Array<{
  //   title: string;                         // 454/t – Title of translation
  //   language?: string;                     // 454/m – Language of translation
  // }>;

  // --- 455: Reproduction of ---
  // reproductionOf?: Array<{
  //   title: string;                         // 455/t – Title of original reproduced
  //   isbn?: string;                         // 455/z – ISBN of original
  // }>;

  // --- 456: Reproduced as ---
  // reproducedAs?: Array<{
  //   title: string;                         // 456/t – Title of reproduction
  // }>;

  // --- 461: Set (part of) ---
  // partOfSet?: Array<{
  //   title: string;                         // 461/t – Title of the set
  //   isbn?: string;                         // 461/z – ISBN of the set
  //   volume?: string;                       // 461/v – Volume designation
  // }>;

  // --- 462: Subset ---
  // hasSubset?: Array<{
  //   title: string;                         // 462/t – Title of subset
  // }>;

  // --- 463: Piece ---
  // hasAnalytic?: Array<{
  //   title: string;                         // 463/t – Title of analytic piece
  //   volume?: string;                       // 463/v – Volume/issue information
  // }>;

  // --- 464: Piece-analytic ---
  // analyticIn?: Array<{
  //   title: string;                         // 464/t – Title of host publication
  //   isbn?: string;                         // 464/z – ISBN of host
  //   volume?: string;                       // 464/v – Location within host
  // }>;

  // --- 470: Item reviewed ---
  // itemReviewed?: Array<{
  //   title: string;                         // 470/t – Title of reviewed item
  // }>;

  // --- 481: Also issued as (simultaneously) ---
  // alsoIssuedAs?: Array<{
  //   title: string;                         // 481/t – Title of simultaneously issued work
  //   issn?: string;                         // 481/x – ISSN of simultaneously issued work
  // }>;

  // --- 482: Issued with (bound-with) ---
  // boundWith?: Array<{
  //   title: string;                         // 482/t – Title of bound-with item
  // }>;

  // --- 488: Other related works ---
  // otherRelatedWorks?: Array<{
  //   title: string;                         // 488/t – Title of related work
  // }>;


  // ============================================================
  // 5XX — RELATED TITLES BLOCK
  // ============================================================

  // --- 500: Uniform title ---
  // uniformTitle?: string;                   // 500/a – Uniform title (agreed form for works under varying titles)
  // uniformTitleLanguage?: string;           // 500/m – Language of item (used in uniform title)
  // uniformTitleMedium?: string;             // 500/n – Miscellaneous information (part of uniform title)
  // uniformTitleQualifier?: string;          // 500/q – Qualifier / disambiguation for uniform title

  // --- 503: Collective uniform title ---
  // collectiveUniformTitle?: string;         // 503/a – Collective uniform title for selected works

  // --- 510: Parallel title proper ---
  // parallelTitleProper?: string[];          // 510/a – Parallel title proper (added entries)

  // --- 512: Cover title ---
  // coverTitle?: string;                     // 512/a – Cover title

  // --- 513: Added title page title ---
  // addedTitlePageTitle?: string;            // 513/a – Added title page title

  // --- 514: Caption title ---
  // captionTitle?: string;                   // 514/a – Caption title

  // --- 515: Running title ---
  // runningTitle?: string;                   // 515/a – Running title

  // --- 516: Spine title ---
  // spineTitle?: string;                     // 516/a – Spine title

  // --- 517: Other variant title ---
  // otherVariantTitle?: string[];            // 517/a – Other variant title

  // --- 518: Title in another script ---
  titleInOtherScript?: string[];           // 518/a – Title in another script form

  // --- 520: Former title (serials) ---
  // formerTitle?: string[];                  // 520/a – Former title (for continuing resources)

  // --- 530: Key title ---
  // keyTitle?: string;                       // 530/a – Key title (unique name assigned by ISSN network)
  // keyTitleQualifier?: string;              // 530/b – Qualifying information for key title

  // --- 531: Abbreviated title ---
  // abbreviatedTitle?: string[];             // 531/a – Abbreviated title

  // --- 532: Expanded title ---
  // expandedTitle?: string;                  // 532/a – Expanded form of title with initials / numerals

  // --- 539: Title proper with LaTeX commands* ---
  // titleLatex?: string;                     // 539/a – Title proper with LaTeX commands (for mathematical symbols)


  // ============================================================
  // 6XX — SUBJECT ANALYSIS BLOCK
  // ============================================================

  // --- 600: Personal name subject ---
  // personalNameSubjects?: Array<{
  //   familyName: string;                    // 600/a – Family name
  //   firstName?: string;                    // 600/b – First name
  //   qualifier?: string;                    // 600/c – Qualifier (e.g. title, occupation)
  //   romanNumerals?: string;                // 600/d – Roman numerals (e.g. for royalty)
  //   dates?: string;                        // 600/f – Dates associated with name
  // }>;

  // --- 601: Corporate body subject ---
  // corporateBodySubjects?: Array<{
  //   name: string;                          // 601/a – Corporate body name
  //   subdivision?: string[];                // 601/b – Subordinate unit name
  //   location?: string;                     // 601/e – Location associated with body
  //   dates?: string;                        // 601/f – Dates associated with body
  // }>;

  // --- 602: Family name subject ---
  // familyNameSubjects?: Array<{
  //   familyName: string;                    // 602/a – Family name
  //   dates?: string;                        // 602/f – Dates associated with family
  // }>;

  // --- 604: Name/title subject ---
  // nameTitleSubjects?: Array<{
  //   name: string;                          // 604 – Combined name and title as subject
  // }>;

  // --- 605: Uniform title subject ---
  // uniformTitleSubjects?: Array<{
  //   title: string;                         // 605/a – Uniform title used as subject
  // }>;

  // --- 606: Topical subject heading ---
  // subjects?: string[];                     // 606/a – Topical subject heading (controlled vocabulary)
  // subjectSubdivisions?: string[][];        // 606/x,y,z – Form, chronological, geographic subdivisions

  // --- 607: Geographical subject ---
  // geographicalSubjects?: Array<{
  //   name: string;                          // 607/a – Geographical name as subject
  //   subdivision?: string[];                // 607/x,y,z – Topical / form / geographic subdivisions
  // }>;

  // --- 608: Form / genre subject ---
  // formGenreSubjects?: Array<{
  //   term: string;                          // 608/a – Form or genre term
  // }>;

  // --- 610: Uncontrolled subject terms ---
  // uncontrolledKeywords?: Array<{
  //   term: string;                          // 610/a – Uncontrolled index term (free keyword)
  // }>;

  // --- 615: Subject category code ---
  // subjectCategoryCodes?: Array<{
  //   code: string;                          // 615/a – Subject category code
  //   system?: string;                       // 615/2 – System code / thesaurus
  // }>;

  // --- 620: Place and date of an event ---
  // eventPlaceDate?: {
  //   country?: string;                      // 620/a – Country of event
  //   locality?: string;                     // 620/b – Locality of event
  //   date?: string;                         // 620/d – Date of event
  // };

  // --- 626: Cartographic subject data ---
  // cartographicSubjectData?: string;        // 626/a – Coordinates of cartographic subject


  // ============================================================
  // 67X — CLASSIFICATION NUMBERS
  // ============================================================

  // --- 675: Universal Decimal Classification ---
  // classifications?: string[];              // 675/a – UDC classification number(s)
  // udcAccessCodes?: string[];               // 675/c – UDC access codes (used for searching)
  // udcShortCodes?: string[];                // 675/v – Short UDC codes (for sorting / statistics)

  // --- 676: Dewey Decimal Classification ---
  // deweyClassification?: string[];          // 676/a – Dewey classification number
  // deweyEdition?: string;                   // 676/v – Edition of Dewey schedule used

  // --- 680: Library of Congress Classification ---
  // lcClassification?: string[];             // 680/a – Library of Congress call number

  // --- 686: Other classification numbers ---
  // otherClassifications?: Array<{
  //   code: string;                          // 686/a – Classification code
  //   system?: string;                       // 686/2 – Identifying the classification system
  // }>;


  // ============================================================
  // 7XX — INTELLECTUAL RESPONSIBILITY BLOCK
  // ============================================================

  /**
   * Personal name – primary intellectual responsibility (field 700) [RED]
   * Personal name – alternative intellectual responsibility (field 701) [RED]
   * Personal name – secondary intellectual responsibility (field 702) [RED]
   *
   * Consolidated into a single array with a `responsibility` discriminator.
   */
  authors?: Array<{
    familyName?: string;                      // 700–702/a – Family name or surname [RED]
    firstName?: string;                       // 700–702/b – First name or given name [RED]
    prefix?: string;                          // 700–702/c – Name prefix (e.g. "von", "de", "Dr.") [RED]
    romanNumerals?: string;                   // 700–702/d – Roman numerals (e.g. "III") [RED]
    dates?: string;                           // 700–702/f – Dates associated with name [RED]
    role?: ResolvedCode;                      // 700–702/4 – Relator code (e.g. "aut", "edt", "trl") [RED]
    responsibility?: 'primary' | 'alternative' | 'secondary'; // derived from field 700/701/702 [RED]
    // fullName?: string;                     // Computed convenience field: firstName + ' ' + familyName
    // authorityRecordId?: string;            // 700–702/3 – Authority record identifier (CONOR)
    // institutionCode?: string;              // 700–702/9 – COBISS institution code for researcher
    // researcherCode?: string;               // 700–702/r – COBISS researcher code (SICRIS)
  }>;

  /**
   * Corporate body – primary (710), alternative (711), secondary (712) intellectual responsibility [RED]
   *
   * 710/a – Corporate body name as primary creator [RED]
   */
  corporateBodies?: Array<{
    name: string;                            // 710–712/a – Corporate body name [RED]
    // subdivision?: string[];               // 710–712/b – Subordinate unit names
    // location?: string;                    // 710–712/e – Location associated with body
    // dates?: string;                       // 710–712/f – Dates associated with body
    // role?: string;                        // 710–712/4 – Relator code
    responsibility?: 'primary' | 'alternative' | 'secondary'; // derived from field 710/711/712
    // authorityRecordId?: string;           // 710–712/3 – Authority record identifier
  }>;

  // --- 720: Family name – primary intellectual responsibility ---
  // familyNameAuthors?: Array<{
  //   familyName: string;                    // 720/a – Family name
  //   dates?: string;                        // 720/f – Dates
  //   role?: string;                         // 720/4 – Relator code
  //   responsibility?: 'primary' | 'alternative' | 'secondary';
  // }>;


  // ============================================================
  // 8XX — INTERNATIONAL USE BLOCK
  // ============================================================

  // --- 801: Source of cataloguing ---
  // cataloguingSource?: Array<{
  //   country: string;                       // 801/a – Country code of cataloguing agency
  //   agency?: string;                       // 801/b – Name or code of cataloguing agency
  //   date?: string;                         // 801/c – Date of last transaction
  //   function?: string;                     // 801 ind1: 0=original, 1=transcribing, 2=modifying, 3=issuing
  // }>;

  // --- 802: ISSN network ---
  // issnNetworkCenter?: string;              // 802/a – ISSN network responsibility centre

  // --- 830: General cataloguer's note (internal) ---
  // internalNote?: string[];                 // 830/a – General cataloguer's note (not for display)

  // --- 856: Electronic location and access [RED] ---
  electronicLocation?: Array<{
    url: string;                              // 856/u – URL / web address [RED]
    // accessMethod?: string;               // 856/2 – Access method code
    // linkText?: string;                   // 856/y – Link text (anchor label)
    // publicNote?: string;                 // 856/z – Public note about the electronic resource
    // electronicFormatType?: string;       // 856/q – Electronic format type (MIME type)
  }>;

  // --- 886: Data not converted from source format ---
  // unconvertedData?: Array<{
  //   tag: string;                           // 886/2 – Tag of unconverted field
  //   data?: string;                         // 886/a – Data of unconverted field
  // }>;

}