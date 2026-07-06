export interface PdfExtractionJobData {
  fileAttachmentId: string;
  originalFid: string;
  filename: string;
  /** ISO 639-2 language codes from record metadata, used to guide OCR */
  languageCodes?: string[];
  /** When false (default), only embedded text is extracted — no OCR */
  doOcr?: boolean;
}
