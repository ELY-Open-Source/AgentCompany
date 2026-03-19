export type AppLocale = "en" | "zh";
export const APP_LOCALES: readonly AppLocale[] = ["en", "zh"] as const;
export const LOCALE_LABELS: Record<AppLocale, string> = { en: "English", zh: "中文" };
export const DEFAULT_LOCALE: AppLocale = "en";
