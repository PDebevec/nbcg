import { Injectable, Logger } from '@nestjs/common';
import { Agent, fetch as undiciFetch } from 'undici';

/** Map ISO 639-2 (COMARC) codes to Tesseract language codes */
const ISO_TO_TESSERACT: Record<string, string> = {
  srp: 'srp+srp_latn', // srp = Cyrillic model, srp_latn = Latin model (Serbian is written in both)
  scr: 'srp+srp_latn',
  cnr: 'srp_latn+hrv+bos+srp', // Montenegrin — no dedicated Tesseract model; both scripts (srp = Cyrillic)
  mne: 'srp_latn+hrv+bos+srp', // Montenegrin (alternative code)
  bos: 'bos',
  hrv: 'hrv',
  slv: 'slv',
  eng: 'eng',
  ger: 'deu',
  deu: 'deu',
  fre: 'fra',
  fra: 'fra',
  ita: 'ita',
  tur: 'tur',
  rus: 'rus',
  lat: 'lat',
  gre: 'ell',
  spa: 'spa',
  por: 'por',
  hun: 'hun',
  pol: 'pol',
  cze: 'ces',
  rum: 'ron',
  bul: 'bul',
  alb: 'sqi',
  mac: 'mkd',
  ara: 'ara',
};

// Montenegrin baseline: merged into every OCR run so wrong/missing COBISS
// metadata never leaves the primary local scripts uncovered.
const MNE_BASELINE = ['srp_latn', 'hrv', 'bos', 'srp'];
// Cap the tesseract model count — each extra model slows OCR and dilutes accuracy.
const MAX_OCR_LANGS = 6;
const DEFAULT_OCR_LANGUAGES = [...MNE_BASELINE, 'eng'].join('+');

// OCR of large scanned PDFs can take far longer than undici's default 300 s
// headers timeout, so use a dedicated dispatcher with a configurable limit.
const TIKA_TIMEOUT_MS = Number(process.env.TIKA_TIMEOUT_MS) || 30 * 60 * 1000; // 30 min

@Injectable()
export class TikaService {
  private readonly logger = new Logger(TikaService.name);
  private readonly tikaUrl = process.env.TIKA_HOST ?? 'http://localhost:9998';
  private readonly dispatcher = new Agent({
    headersTimeout: TIKA_TIMEOUT_MS,
    bodyTimeout: TIKA_TIMEOUT_MS,
  });

  /**
   * @param languageCodes Optional ISO 639-2 codes from record metadata (e.g. ['ger', 'srp'])
   * @param doOcr When false (default), only embedded text is extracted — tesseract is never invoked
   */
  async extractText(
    pdfBuffer: Buffer,
    filename: string,
    languageCodes?: string[],
    doOcr = false,
  ): Promise<string> {
    if (!doOcr) {
      // Embedded text only — kept as-is even if it looks garbled
      this.logger.log(`Extracting embedded text (no OCR) for "${filename}"`);
      return this.callTika(pdfBuffer, filename, undefined, 'no_ocr');
    }

    const ocrLang = this.resolveOcrLanguages(languageCodes);
    this.logger.log(`OCR languages for "${filename}": ${ocrLang}`);

    // First try with auto strategy (prefers embedded text, falls back to OCR)
    let text = await this.callTika(pdfBuffer, filename, ocrLang, 'auto');

    // If extracted text looks like garbled font encoding, retry with OCR-only
    if (text && this.looksGarbled(text)) {
      this.logger.warn(`Embedded text for "${filename}" looks garbled, retrying with OCR-only strategy`);
      text = await this.callTika(pdfBuffer, filename, ocrLang, 'ocr_only');
    }

    return text;
  }

  private async callTika(
    pdfBuffer: Buffer,
    filename: string,
    ocrLang: string | undefined,
    ocrStrategy: 'auto' | 'ocr_only' | 'no_ocr',
  ): Promise<string> {
    const response = await undiciFetch(`${this.tikaUrl}/tika`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/pdf',
        'Accept': 'text/plain',
        ...(ocrLang ? { 'X-Tika-OCRLanguage': ocrLang } : {}),
        'X-Tika-PDFOcrStrategy': ocrStrategy,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      },
      body: pdfBuffer,
      dispatcher: this.dispatcher,
      signal: AbortSignal.timeout(TIKA_TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '(unreadable)');
      this.logger.error(`Tika extraction failed for ${filename}: HTTP ${response.status} — ${body}`);
      throw new Error(`Tika extraction failed: HTTP ${response.status}`);
    }

    return (await response.text()).trim();
  }

  /**
   * Detects broken font-to-Unicode mappings in embedded PDF text.
   * Two signals:
   * 1. Symbols/digits sandwiched between letters within words
   *    (e.g. "&4Н1*егпед", "(5гб(1псће", "®фгШеб")
   * 2. Latin and Cyrillic mixed within the same word
   *    (e.g. "итМГепђе" next to "Schilderung" in the same passage)
   */
  looksGarbled(text: string): boolean {
    const words = text.slice(0, 5000).split(/\s+/).filter(w => w.length >= 3);
    if (words.length < 10) return false;

    const LATIN = /[a-zA-Z\u00C0-\u024F]/;
    const CYRILLIC = /[\u0400-\u04FF]/;
    // Symbols/digits that should never appear mid-word
    const SYMBOL = /[0-9*&@#$®©™§¶†‡°±×÷()\[\]|<>^~`]/;

    let suspicious = 0;
    let latinWords = 0;
    let cyrillicWords = 0;

    for (const word of words) {
      const hasLatin = LATIN.test(word);
      const hasCyrillic = CYRILLIC.test(word);

      if (hasLatin) latinWords++;
      if (hasCyrillic) cyrillicWords++;

      // Mixed scripts within a single word
      if (hasLatin && hasCyrillic) {
        suspicious++;
        continue;
      }

      // Strip leading/trailing punctuation, then check for symbols between letters
      const inner = word.replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, '');
      if (inner.length < 3) continue;
      if (/\p{L}/u.test(inner) && SYMBOL.test(inner) && /\p{L}.*[0-9*&@#$®©™§()\[\]|<>^~`].*\p{L}/u.test(inner)) {
        suspicious++;
      }
    }

    // Also flag if document has significant presence of both scripts (>15% each)
    // which suggests font encoding mapped Latin glyphs to Cyrillic codepoints
    const total = words.length;
    const bothScripts = latinWords / total > 0.15 && cyrillicWords / total > 0.15;

    return suspicious / total > 0.1 || bothScripts;
  }

  private resolveOcrLanguages(languageCodes?: string[]): string {
    // Ordered by priority: metadata languages first, then the Montenegrin
    // baseline, then eng — the cap trims from the back.
    const tessLangs = new Set<string>();
    for (const code of languageCodes ?? []) {
      const mapped = ISO_TO_TESSERACT[code];
      if (mapped) {
        for (const l of mapped.split('+')) tessLangs.add(l);
      }
    }
    for (const l of MNE_BASELINE) tessLangs.add(l);
    tessLangs.add('eng');

    const capped = [...tessLangs].slice(0, MAX_OCR_LANGS);
    return capped.length > 0 ? capped.join('+') : DEFAULT_OCR_LANGUAGES;
  }
}
