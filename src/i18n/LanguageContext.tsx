import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import { Language, LanguageInfo, SUPPORTED_LANGUAGES } from './types';
import { getNestedTranslation, translations } from './translations';

interface LanguageContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  currentLanguageInfo: LanguageInfo;
  availableLanguages: LanguageInfo[];
}

const STORAGE_KEY = 'nhpos_language';

const LanguageContext = createContext<LanguageContextValue | null>(null);

export const LanguageProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY) as Language;
      if (saved && saved in SUPPORTED_LANGUAGES) {
        return saved;
      }
      // Detect browser language if possible
      const browserLang = navigator.language?.toLowerCase() || '';
      if (browserLang.startsWith('zh')) return 'zh';
      if (browserLang.startsWith('km')) return 'km';
      if (browserLang.startsWith('en')) return 'en';
      if (browserLang.startsWith('id')) return 'id';
    }
    return 'id';
  });

  const setLanguage = (newLang: Language) => {
    if (newLang in SUPPORTED_LANGUAGES) {
      setLanguageState(newLang);
      if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, newLang);
        document.documentElement.lang = newLang;
      }
    }
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      document.documentElement.lang = language;
    }
  }, [language]);

  const currentLanguageInfo = useMemo(() => {
    return SUPPORTED_LANGUAGES[language] || SUPPORTED_LANGUAGES.id;
  }, [language]);

  const availableLanguages = useMemo(() => {
    return Object.values(SUPPORTED_LANGUAGES);
  }, []);

  const t = useMemo(() => {
    return (key: string, params?: Record<string, string | number>) => {
      return getNestedTranslation(language, key, params);
    };
  }, [language]);

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      t,
      currentLanguageInfo,
      availableLanguages,
    }),
    [language, t, currentLanguageInfo, availableLanguages]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};

export const useLanguage = (): LanguageContextValue => {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return ctx;
};

export const useTranslation = () => {
  const { t, language, setLanguage, currentLanguageInfo, availableLanguages } = useLanguage();
  return { t, language, setLanguage, currentLanguageInfo, availableLanguages };
};
