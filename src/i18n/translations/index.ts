import { Language } from '../types';
import { id } from './id';
import { en } from './en';
import { zh } from './zh';
import { km } from './km';

export const translations = {
  id,
  en,
  zh,
  km,
};

export type TranslationSchema = typeof id;

/**
 * Resolves a nested key using dot notation (e.g. 'pos.cartTitle')
 * with fallback to Indonesian if key is missing in target language.
 */
export function getNestedTranslation(
  lang: Language,
  key: string,
  params?: Record<string, string | number>
): string {
  const dict = translations[lang] || translations.id;
  const parts = key.split('.');

  let value: any = dict;
  for (const part of parts) {
    if (value && typeof value === 'object' && part in value) {
      value = value[part];
    } else {
      value = undefined;
      break;
    }
  }

  // Fallback to Indonesian if missing in current language
  if (value === undefined && lang !== 'id') {
    let fallbackValue: any = translations.id;
    for (const part of parts) {
      if (fallbackValue && typeof fallbackValue === 'object' && part in fallbackValue) {
        fallbackValue = fallbackValue[part];
      } else {
        fallbackValue = undefined;
        break;
      }
    }
    value = fallbackValue;
  }

  // If still not found, return the key itself
  if (value === undefined || typeof value !== 'string') {
    return key;
  }

  // Replace interpolated params: {count}, {name}, etc.
  if (params) {
    return value.replace(/\{(\w+)\}/g, (_, paramKey) => {
      return paramKey in params ? String(params[paramKey]) : `{${paramKey}}`;
    });
  }

  return value;
}
