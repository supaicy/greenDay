import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import ko from './locales/ko.json'
import en from './locales/en.json'

export const LANGUAGES = ['ko', 'en'] as const
export type Language = (typeof LANGUAGES)[number]

const STORAGE_KEY = 'ticktick-language'

// 이 모듈은 유틸(date.ts 등)에서도 import되고 그 유틸에는 DOM 없이 도는 테스트가 있다.
// 그래서 localStorage/navigator/document 접근은 전부 존재 여부를 확인하고 쓴다.
const hasDom = typeof window !== 'undefined'

// 저장값 → 없으면 OS 언어 → 그래도 아니면 영어.
// theme(`ticktick-theme`)과 같은 방식으로 localStorage에 둔다.
export function detectLanguage(): Language {
  if (!hasDom) return 'ko'
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved && (LANGUAGES as readonly string[]).includes(saved)) return saved as Language
  return navigator.language?.toLowerCase().startsWith('ko') ? 'ko' : 'en'
}

export function persistLanguage(lang: Language): void {
  if (hasDom) {
    localStorage.setItem(STORAGE_KEY, lang)
    document.documentElement.lang = lang
  }
  i18n.changeLanguage(lang)
}

// 배열 리소스(요일 이름, 레벨 이름 등)를 꺼낸다. i18next는 returnObjects 없이는
// 배열을 문자열로 눌러 버리고, 타입은 여전히 unknown이라 여기서 한 번만 좁힌다.
// language를 넘기면 그 언어로 고정한다 — useMemo 의존성을 실제 값으로 드러낼 때 쓴다.
export function tList(key: string, language?: string): string[] {
  const translate = language ? i18n.getFixedT(language) : i18n.t.bind(i18n)
  const value = translate(key, { returnObjects: true })
  return Array.isArray(value) ? (value as string[]) : []
}

const initial = detectLanguage()

i18n.use(initReactI18next).init({
  resources: { ko: { translation: ko }, en: { translation: en } },
  lng: initial,
  fallbackLng: 'ko',
  interpolation: { escapeValue: false }, // React가 이미 이스케이프한다
  returnNull: false
})

if (hasDom) document.documentElement.lang = initial

export default i18n
