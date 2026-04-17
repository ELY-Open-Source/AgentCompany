import type { AppLocale } from "@shared/locale";
import { resolveLocale } from "./locale";
import * as operatingEn from "./operating-en";
import * as operatingZh from "./operating-zh";
import * as systemEn from "./system-en";
import * as systemZh from "./system-zh";

export type OperatingMessages = typeof operatingEn;
export type SystemMessages = typeof systemEn;

// zh bundles are constructed from different string literals than en, so
// their inferred types are technically distinct. Symbol sets are mirrored
// one-for-one, so the `as unknown` coercion is safe by construction.
const OPERATING: Record<AppLocale, OperatingMessages> = {
  en: operatingEn,
  zh: operatingZh as unknown as OperatingMessages,
};

const SYSTEM: Record<AppLocale, SystemMessages> = {
  en: systemEn,
  zh: systemZh as unknown as SystemMessages,
};

export function getOperatingMessages(locale: AppLocale | undefined): OperatingMessages {
  return OPERATING[resolveLocale(locale)];
}

export function getSystemMessages(locale: AppLocale | undefined): SystemMessages {
  return SYSTEM[resolveLocale(locale)];
}

export { resolveLocale };
