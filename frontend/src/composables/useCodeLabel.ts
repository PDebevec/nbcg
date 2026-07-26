import { useI18n } from 'vue-i18n';
import type { ResolvedCode } from 'src/api/search';

/** Locale-aware display label for a ResolvedCode ('me' → cnr, otherwise en) */
export function useCodeLabel() {
  const { locale } = useI18n();

  function codeLabel(code: ResolvedCode): string {
    const label = locale.value === 'me' ? code.cnr : code.en;
    return label || code.en || code.cnr || code.code;
  }

  return { codeLabel };
}
