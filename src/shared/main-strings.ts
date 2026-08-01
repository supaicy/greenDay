/**
 * 메인 프로세스가 직접 띄우는 문구.
 *
 * 렌더러의 i18next 인스턴스는 메인에서 쓸 수 없으므로, 메인에서 나가는 몇 안 되는
 * 사용자 대면 문자열만 여기에 둔다. 렌더러가 언어를 바꿀 때 `set-language` IPC로
 * 알려 주고, 메인은 그 값으로 이 표를 조회한다.
 */
export const MAIN_LANGUAGES = ['ko', 'en'] as const
export type MainLanguage = (typeof MAIN_LANGUAGES)[number]

const STRINGS: Record<MainLanguage, { reminder: string }> = {
  ko: { reminder: '리마인더' },
  en: { reminder: 'Reminder' }
}

export function isMainLanguage(value: unknown): value is MainLanguage {
  return typeof value === 'string' && (MAIN_LANGUAGES as readonly string[]).includes(value)
}

export function mainStrings(language: MainLanguage): { reminder: string } {
  return STRINGS[language]
}
