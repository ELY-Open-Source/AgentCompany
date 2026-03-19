import { createContext, useContext } from "react";
import type { AppLocale } from "@shared/locale";
import { DEFAULT_LOCALE } from "@shared/locale";
import { en } from "./en";
import { zh } from "./zh";

const translations: Record<AppLocale, Record<string, string>> = { en, zh };

export type TranslationFn = (key: string, fallback?: string) => string;

export function createTranslator(locale: AppLocale): TranslationFn {
  const dict = translations[locale] ?? translations[DEFAULT_LOCALE];
  return (key: string, fallback?: string) => dict[key] ?? fallback ?? key;
}

export const LocaleContext = createContext<AppLocale>(DEFAULT_LOCALE);
export const TranslationContext = createContext<TranslationFn>(createTranslator(DEFAULT_LOCALE));

export function useLocale(): AppLocale {
  return useContext(LocaleContext);
}

export function useT(): TranslationFn {
  return useContext(TranslationContext);
}
