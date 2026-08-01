import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import ko from './locales/ko.json'
import en from './locales/en.json'

export const LANGUAGES = ['ko', 'en'] as const
export type Language = (typeof LANGUAGES)[number]

const STORAGE_KEY = 'ticktick-language'

// 저장값 → 없으면 OS 언어 → 그래도 아니면 한국어.
// theme(`ticktick-theme`)과 같은 방식으로 localStorage에 둔다.
export function detectLanguage(): Language {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved && (LANGUAGES as readonly string[]).includes(saved)) return saved as Language
  return navigator.language?.toLowerCase().startsWith('ko') ? 'ko' : 'en'
}

export function persistLanguage(lang: Language): void {
  localStorage.setItem(STORAGE_KEY, lang)
  i18n.changeLanguage(lang)
  document.documentElement.lang = lang
}

const initial = detectLanguage()

i18n.use(initReactI18next).init({
  resources: { ko: { translation: ko }, en: { translation: en } },
  lng: initial,
  fallbackLng: 'ko',
  interpolation: { escapeValue: false }, // React가 이미 이스케이프한다
  returnNull: false
})

document.documentElement.lang = initial

export default i18n
