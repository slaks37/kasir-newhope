export type Language = 'id' | 'en' | 'zh' | 'km';

export interface LanguageInfo {
  code: Language;
  name: string;
  nativeName: string;
  flag: string;
  shortLabel: string;
}

export const SUPPORTED_LANGUAGES: Record<Language, LanguageInfo> = {
  id: {
    code: 'id',
    name: 'Bahasa Indonesia',
    nativeName: 'Bahasa Indonesia',
    flag: '🇮🇩',
    shortLabel: 'ID',
  },
  en: {
    code: 'en',
    name: 'English',
    nativeName: 'English',
    flag: '🇺🇸',
    shortLabel: 'EN',
  },
  zh: {
    code: 'zh',
    name: 'Chinese (Simplified)',
    nativeName: '简体中文',
    flag: '🇨🇳',
    shortLabel: 'ZH',
  },
  km: {
    code: 'km',
    name: 'Khmer (Cambodia)',
    nativeName: 'ភាសាខ្មែរ',
    flag: '🇰🇭',
    shortLabel: 'KM',
  },
};
