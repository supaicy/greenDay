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
  /** 데이터 파일을 못 읽었을 때. 렌더러가 아직 없으므로 메인이 직접 띄운다. */
  dbFailedTitle: string
  dbFailedBody: string
  /** 종료 직전 마지막 플러시가 실패했을 때. 조용히 잃는 것보다 알리는 편이 낫다. */
  quitFlushFailedTitle: string
  quitFlushFailedBody: string
  /**
   * 동기화 핸들러가 렌더러로 돌려보내는 문구. 렌더러가 그대로 출력하므로
   * 여기 있어야 영어 UI에서 한국어가 튀어나오지 않는다.
   */
  syncNotConfigured: string
  syncGoogleNotConnected: string
  /** 데이터 파일을 못 읽은 세션에서 동기화를 막을 때. */
  syncBlockedReadOnly: string
  /** 새 번들 ID 첫 실행 — sentinel을 열기 전에 띄우는 Keychain 안내 (migration/arrival.ts). */
  keychainNoticeTitle: string
  keychainNoticeBody: string
  keychainNoticeButton: string
}

const STRINGS: Record<MainLanguage, MainStrings> = {
  ko: {
    reminder: '리마인더',
    permProbeTitle: 'Greenday 알림 확인',
    permProbeBody: '이 배너가 보이면 리마인더도 이렇게 도착합니다.',
    menuView: '보기',
    dbFailedTitle: '데이터를 읽지 못했습니다',
    dbFailedBody:
      '저장된 할일 파일을 열 수 없어 빈 상태로 시작합니다. 원본은 같은 폴더에 .corrupt- 사본으로 남겨 뒀고, 이번 실행에서는 아무것도 저장하지 않습니다 — 앱을 닫아도 원본은 그대로입니다.',
    quitFlushFailedTitle: '마지막 변경을 저장하지 못했습니다',
    quitFlushFailedBody:
      '앱을 닫기 전에 저장을 시도했지만 디스크에 쓰지 못했습니다. 방금 하신 변경 일부가 다음 실행에서 보이지 않을 수 있습니다.\n\n디스크 여유 공간과 폴더 권한을 확인해 주세요.',
    syncNotConfigured: '연동 설정을 먼저 마치세요.',
    syncGoogleNotConnected: '구글 계정을 먼저 연결하세요.',
    syncBlockedReadOnly:
      '이번 실행은 할일 파일을 읽지 못해 읽기 전용입니다. 지금 동기화하면 캘린더에 올려 둔 일정이 전부 지워지므로 막았습니다 — 앱에 할일이 하나도 없는 것으로 보이기 때문입니다. 데이터를 복구한 뒤에 다시 시도하세요.',
    keychainNoticeTitle: '잠시 후 macOS가 키체인 접근을 물어봅니다',
    keychainNoticeBody:
      'Greenday가 새 앱으로 바뀌어 처음 실행됐습니다. 예전 앱이 키체인에 보관해 둔 AI 키·캘린더 앱 암호·Google 연결을 그대로 이어받으려면 "항상 허용"을 눌러 주세요.\n\n거부해도 할 일과 설정은 그대로입니다 — 그 경우 연동만 다시 연결하면 되고, 저장돼 있던 값은 지우지 않고 남겨 둡니다.',
    keychainNoticeButton: '확인'
  },
  en: {
    reminder: 'Reminder',
    permProbeTitle: 'Greenday notification check',
    permProbeBody: 'If you can see this banner, reminders will arrive the same way.',
    menuView: 'View',
    dbFailedTitle: 'Could not read your data',
    dbFailedBody:
      'The saved task file could not be opened, so the app is starting empty. A .corrupt- copy of the original was saved next to it, and nothing will be written this session — closing the app leaves your original untouched.',
    quitFlushFailedTitle: 'Could not save your last changes',
    quitFlushFailedBody:
      'The app tried to save before closing but could not write to disk. Some of what you just changed may be missing next time you open it.\n\nCheck your free disk space and the folder permissions.',
    syncNotConfigured: 'Finish setting up the connection first.',
    syncGoogleNotConnected: 'Connect your Google account first.',
    syncBlockedReadOnly:
      'This session is read-only because your task file could not be read. Syncing now would delete every event this app put in your calendar, because the app currently sees no tasks at all — so it was blocked. Recover your data and try again.',
    keychainNoticeTitle: 'macOS is about to ask for Keychain access',
    keychainNoticeBody:
      'This is the first launch of the new Greenday app. To carry over the AI key, calendar app password and Google connection the previous app kept in your Keychain, choose "Always Allow".\n\nIf you deny, your tasks and settings are unaffected — you would only need to reconnect those integrations, and the stored values are kept, not deleted.',
    keychainNoticeButton: 'OK'
  }
}

export function isMainLanguage(value: unknown): value is MainLanguage {
  return typeof value === 'string' && (MAIN_LANGUAGES as readonly string[]).includes(value)
}

export function mainStrings(language: MainLanguage): MainStrings {
  return STRINGS[language]
}
