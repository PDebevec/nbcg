import { useI18n } from 'vue-i18n';
import type { Extent } from 'src/api/search';

/** "24 pages" from a numeric extent; units without a translation fall back to the raw unit. */
export function useExtentLabel() {
  const i18n = useI18n();

  function extentLabel(extent: Extent | undefined): string {
    if (!extent) return '';
    const key = `catalog.units.${extent.unit}`;
    return i18n.te(key) ? i18n.t(key, { n: extent.value }) : `${extent.value} ${extent.unit}`;
  }

  return { extentLabel };
}
