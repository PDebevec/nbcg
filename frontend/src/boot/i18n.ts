import { defineBoot } from '#q-app/wrappers';
import { createI18n } from 'vue-i18n';
import { Lang } from 'quasar';
import quasarLangEn from 'quasar/lang/en-US';
import quasarLangSr from 'quasar/lang/sr';

import messages from 'src/i18n';

export type MessageLanguages = keyof typeof messages;
// Type-define 'en-US' as the master schema for the resource
export type MessageSchema = (typeof messages)['en-US'];

// See https://vue-i18n.intlify.dev/guide/advanced/typescript.html#global-resource-schema-type-definition
/* eslint-disable @typescript-eslint/no-empty-object-type */
declare module 'vue-i18n' {
  // define the locale messages schema
  export interface DefineLocaleMessage extends MessageSchema {}

  // define the datetime format schema
  export interface DefineDateTimeFormat {}

  // define the number format schema
  export interface DefineNumberFormat {}
}
/* eslint-enable @typescript-eslint/no-empty-object-type */

export const LOCALE_STORAGE_KEY = 'nbcg-locale';

function initialLocale(): MessageLanguages {
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(LOCALE_STORAGE_KEY) : null;
  if (stored && stored in messages) {
    return stored as MessageLanguages;
  }
  return 'me';
}

// Module-level instance so plain services (e.g. keycloak) can translate too
export const i18n = createI18n<{ message: MessageSchema }, MessageLanguages>({
  locale: initialLocale(),
  fallbackLocale: 'en-US',
  legacy: false,
  messages,
});

// Quasar's own strings (table pagination, date picker, …). There is no Montenegrin pack; Serbian Latin is the closest.
const QUASAR_LANG: Record<MessageLanguages, typeof quasarLangEn> = {
  'en-US': quasarLangEn,
  me: quasarLangSr,
};

export function applyQuasarLang(locale: string) {
  Lang.set(QUASAR_LANG[locale as MessageLanguages] ?? quasarLangEn);
}

export default defineBoot(({ app }) => {
  app.use(i18n);
  applyQuasarLang(initialLocale());
});
