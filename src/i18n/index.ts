import { createI18n } from 'vue-i18n'
import { browserLocalStorage } from '@/lib/data/key-value-storage'
import en from '@/locales/en.json'
import fi from '@/locales/fi.json'

export const SUPPORTED_LOCALES = ['en', 'fi'] as const
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

const LOCALE_STORAGE_KEY = 'locale'

export function isSupportedLocale(value: string | null): value is SupportedLocale {
  return SUPPORTED_LOCALES.includes(value as SupportedLocale)
}

/** Device-default locale: a persisted choice wins, else the browser language, else `en`. */
function detectLocale(): SupportedLocale {
  const stored = browserLocalStorage().getItem(LOCALE_STORAGE_KEY)
  if (isSupportedLocale(stored)) return stored

  const deviceLanguage = navigator.language.slice(0, 2)
  return isSupportedLocale(deviceLanguage) ? deviceLanguage : 'en'
}

export const i18n = createI18n({
  legacy: false,
  locale: detectLocale(),
  fallbackLocale: 'en',
  messages: { en, fi },
})

/** Persist a locale choice and reflect it on `<html lang>` for a11y. */
export function setLocale(locale: SupportedLocale): void {
  i18n.global.locale.value = locale
  browserLocalStorage().setItem(LOCALE_STORAGE_KEY, locale)
  document.documentElement.lang = locale
}

document.documentElement.lang = i18n.global.locale.value
