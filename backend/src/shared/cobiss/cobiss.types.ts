export interface CobissFetchResult {
  contentType: string;
  rawXml: string;
  recordXml: string;
  recordJson: unknown;
}

export type Charset = 'utf-8' | string;

export interface DomainAuthor {
  fullName: string;
  role?: string;
}

export interface DomainRecord {
  // ===== 0XX - IDENTIFICATION BLOCK =====
  externalId?: string;                    // 001/x - Record ID
  isbn?: string[];                        // 010/a - ISBN
  isbnQualifications?: string[];          // 010/b - Qualifications
  issn?: string[];                        // 011/a - ISSN
  issnKeyTitle?: string;                  // 011/e - Key title
  fingerprint?: string[];                 // 013/a - Fingerprint
  isrc?: string[];                        // 016/a - Int'l Standard Recording Code
  isrcQualifications?: string[];          // 016/b - ISRC qualifications
  otherIdentifiers?: Array<{              // 017 - Other identifiers
    type?: string;                        // 017/b - Type of identifier
    identifier: string;                   // 017/a - Identifier
  }>;
  nationalBibNumber?: string[];           // 020/a - National bibliography number
  countryCode?: string[];                 // 020/b - Country code
  publisherNumber?: Array<{               // 071 - Publisher's number
    number: string;                       // 071/a - Number
    publisher?: string;                   // 071/b - Publisher
    type?: string;                        // ind1: 0=issue, 1=matrix, 2=plate, etc
  }>;

  // ===== 1XX - CODED INFORMATION BLOCK =====
  language?: string[];                    // 101/a - Language of text (repeatable for multilingual works)
  originalLanguage?: string[];            // 101/c - Language of original work
  subtitleLanguages?: string[];           // 101/g - Language of subtitles
  translationLanguages?: string[];        // 101/d - Language of summary
  tableOfContentsLanguages?: string[];    // 101/f - Language of table of contents
  country?: string[];                     // 102/a - Country of publication (repeatable)
  locality?: string[];                    // 102/b - Locality
  
  // Material specific codes (105, 106, 110, etc.)
  textualMaterialCodes?: {                // 105 - Textual material codes
    illustrationCodes?: string;           // 105/a - Illustration codes (4 chars)
    formOfContent?: string;               // 105/b - Form of content codes (4 chars)
    conferencePublication?: string;       // 105/c - Conference publication
    festschrift?: string;                 // 105/d - Festschrift indicator
    indexIndicator?: string;              // 105/e - Index indicator
    literaryFormCode?: string;            // 105/f - Literary form code
    biographyCode?: string;               // 105/g - Biography code
  };

  // ===== 2XX - DESCRIPTIVE INFORMATION BLOCK =====
  title?: string;                         // 200/a - Title proper
  titleMediumDesignation?: string;        // 200/b - General material designation
  titleByAnotherAuthor?: string;          // 200/c - Title proper by another author
  parallelTitle?: string[];               // 200/d - Parallel title
  subtitle?: string;                      // 200/e - Other title information (subtitle)
  parallelSubtitle?: string[];            // 200/f - Parallel other title information
  firstResponsibility?: string;           // 200/g - First statement of responsibility
  subsequentResponsibility?: string[];    // 200/h - Subsequent statements of responsibility

  edition?: string;                       // 205/a - Edition statement
  editionResponsibility?: string;         // 205/f - Statement of responsibility to edition
  parallelEdition?: string;               // 205/d - Parallel edition statement

  publication?: {
    place?: string;                       // 210/a - Place of publication
    publisher?: string;                   // 210/c - Publisher/Distributor name
    year?: number;                        // 210/d - Date of publication
    placeOfManufacture?: string;          // 210/e - Place of manufacture
    manufacturerName?: string;            // 210/g - Name of manufacturer
    manufacturerDate?: string;            // 210/h - Date of manufacture
  };

  physicalDescription?: string;           // 215/a - Specific material designation and extent
  otherPhysicalDetails?: string;          // 215/c - Other physical details
  dimensions?: string;                    // 215/d - Dimensions
  accompanyingMaterial?: string;          // 215/e - Accompanying material

  seriesTitle?: string;                   // 225/a - Series title
  seriesSubtitle?: string;                // 225/e - Series subtitle
  seriesResponsibility?: string;          // 225/f - Statement of responsibility
  seriesIssn?: string;                    // 225/x - Series ISSN
  seriesVolume?: string;                  // 225/v - Volume numbering

  // ===== 3XX - NOTES BLOCK =====
  notes?: string[];                       // 300/a - General notes
  notesOnIdentifiers?: string[];          // 301/a - Notes on identifiers
  notesOnTitle?: string[];                // 304/a - Notes on title
  notesOnEdition?: string[];              // 305/a - Notes on edition
  notesOnPublication?: string[];          // 306/a - Notes on publication
  notesOnLinkingFields?: string[];        // 311/a - Notes on linking fields
  notesOnIntellectualResp?: string[];     // 314/a - Notes on intellectual responsibility
  notesOnLanguage?: string[];             // 316/a - Notes on language
  notesOnPhysicalDesc?: string[];         // 317/a - Notes on physical description
  notesOnContents?: string[];             // 327/a - Notes on contents
  notesOnContinuation?: string[];         // 320/a - Notes on continuation
  notesOnBinding?: string[];              // 321/a - Notes on binding
  notesOnFrequency?: string[];            // 326/a - Notes on frequency
  
  abstract?: string;                      // 330/a - Summary or abstract
  notesOnUsers?: string;                  // 333/a - Notes on users/audience
  notesOnAwards?: string[];               // 334/a - Notes on awards
  notesOnElectronicResource?: string;     // 336/a - Notes on type of electronic resource
  systemRequirements?: string;            // 337/a - System requirements
  financingNotes?: string[];              // 338/a - Notes on financing

  // ===== 4XX - LINKING ENTRY BLOCK =====
  series?: Array<{                        // 410 - Series
    title: string;                        // 410/t - Title
    issn?: string;                        // 410/x - ISSN
    volume?: string;                      // 410/v - Volume
  }>;
  
  supplementTo?: Array<{                  // 421 - Supplement to
    title: string;
    issn?: string;
  }>;
  
  issuedWith?: Array<{                    // 422 - Issued with
    title: string;
  }>;

  // ===== 5XX - RELATED TITLES BLOCK =====
  uniformTitle?: string;                  // 500/a - Uniform title
  uniformTitleQualifiers?: string;        // 500/h - Number of part/section
  titleLatex?: string;                    // 539/a - Title with LaTeX commands

  // ===== 6XX - SUBJECT ANALYSIS BLOCK =====
  personalNameSubjects?: Array<{          // 600 - Personal name as subject
    familyName: string;                   // 600/a - Family name
    firstName?: string;                   // 600/b - First name
    dates?: string;                       // 600/f - Dates
    numeration?: string;                  // 600/d - Roman numerals
    qualifier?: string;                   // 600/c - Qualifier
  }>;

  corporateBodySubjects?: Array<{         // 601 - Corporate body as subject
    name: string;                         // 601/a - Corporate body name
    subdivision?: string[];               // 601/b - Subordinate units
    location?: string;                    // 601/e - Location
    dates?: string;                       // 601/f - Dates
  }>;

  familyNameSubjects?: Array<{            // 602 - Family name as subject
    familyName: string;                   // 602/a - Family name
    dates?: string;                       // 602/f - Dates
  }>;

  uniformTitleSubjects?: Array<{          // 605 - Title as subject
    title: string;                        // 605/a - Title
  }>;

  subjects?: string[];                    // 606/a - Topical subject heading
  subjectSubdivisions?: string[][];       // 606/x,y,z - Subdivisions

  geographicalSubjects?: Array<{          // 607 - Geographical name as subject
    name: string;                         // 607/a - Geographical name
    subdivision?: string[];               // 607/x,y,z - Subdivisions
  }>;

  formGenreSubjects?: Array<{             // 608 - Form/genre heading
    term: string;                         // 608/a - Form/genre term
  }>;

  uncontrolledKeywords?: Array<{          // 610 - Uncontrolled index terms
    term: string;                         // 610/a - Term
  }>;

  // ===== 67X - CLASSIFICATION NUMBERS =====
  classifications?: string[];             // 675/a - UDC classification
  udcAccessCodes?: string[];              // 675/c - UDC access codes (for searching)
  udcShortCodes?: string[];               // 675/v - Short UDC (for sorting/statistics)
  
  deweyClassification?: string[];         // 676/a - Dewey classification
  lcClassification?: string[];            // 680/a - Library of Congress classification
  otherClassifications?: Array<{          // 686 - Other classifications
    code: string;                         // 686/a - Classification code
    system?: string;                      // 686/2 - System code
  }>;

  // ===== 7XX - INTELLECTUAL RESPONSIBILITY BLOCK =====
  authors?: Array<{
    familyName?: string;                  // 700/a, 701/a, 702/a - Family name
    firstName?: string;                   // 700/b, 701/b, 702/b - First name
    fullName?: string;                    // Computed: firstName + familyName
    prefix?: string;                      // 700/c - Prefix to name
    romanNumerals?: string;               // 700/d - Roman numerals
    dates?: string;                       // 700/f - Dates
    role?: string;                        // 700/4 - Relator code or 'author' by default
    responsibility?: 'primary' | 'alternative' | 'secondary';
  }>;

  corporateBodies?: Array<{               // 710, 711, 712 - Corporate bodies
    name: string;                         // 710/a - Corporate body name
    subdivision?: string[];               // 710/b - Subordinate units
    location?: string;                    // 710/e - Location
    dates?: string;                       // 710/f - Dates
    role?: string;                        // 710/4 - Relator code
    responsibility?: 'primary' | 'alternative' | 'secondary';
  }>;

  // ===== 8XX - INTERNATIONAL USE BLOCK =====
  electronicLocation?: Array<{            // 856 - Electronic location and access
    url: string;                          // 856/u - URL
    accessMethod?: string;                // 856/2 - Access method
    linkText?: string;                    // 856/y - Link text
    publicNote?: string;                  // 856/z - Public note
  }>;
}