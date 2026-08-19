/**
 * 메인 프로세스가 직접 띄우는 문구.
 *
 * 렌더러의 i18next 인스턴스는 메인에서 쓸 수 없으므로, 메인에서 나가는 몇 안 되는
 * 사용자 대면 문자열만 여기에 둔다. 렌더러가 언어를 바꿀 때 `set-language` IPC로
 * 알려 주고, 메인은 그 값으로 이 표를 조회한다.
 */
export const MAIN_LANGUAGES = ['ko', 'en'] as const
export type MainLanguage = (typeof MAIN_LANGUAGES)[number]

interface MainStrings {
  reminder: string
  /** 권한 프롬프트를 유도하려고 띄우는 확인용 알림. */
  permProbeTitle: string
  permProbeBody: string
  /** 앱 메뉴의 보기 항목. 나머지 항목은 Electron의 role이 OS 언어로 현지화한다. */
  menuView: string
}

const STRINGS: Record<MainLanguage, MainStrings> = {
  ko: {
    reminder: '리마인더',
    permProbeTitle: 'Greenday 알림 확인',
    permProbeBody: '이 배너가 보이면 리마인더도 이렇게 도착합니다.',
    menuView: '보기'
  },
  en: {
    reminder: 'Reminder',
    permProbeTitle: 'Greenday notification check',
    permProbeBody: 'If you can see this banner, reminders will arrive the same way.',
    menuView: 'View'
  }
}

export function isMainLanguage(value: unknown): value is MainLanguage {
  return typeof value === 'string' && (MAIN_LANGUAGES as readonly string[]).includes(value)
}

export function mainStrings(language: MainLanguage): MainStrings {
  return STRINGS[language]
}
