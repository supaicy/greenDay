/**
 * 메인 프로세스가 직접 띄우는 문구.
 *
 * 렌더러의 i18next 인스턴스는 메인에서 쓸 수 없으므로, 메인에서 나가는 몇 안 되는
 * 사용자 대면 문자열만 여기에 둔다. 렌더러가 언어를 바꿀 때 `set-language` IPC로
 * 알려 주고, 메인은 그 값으로 이 표를 조회한다.
 */
export const MAIN_LANGUAGES = ['ko', 'en'] as const
export type MainLanguage = (typeof MAIN_LANGUAGES)[number]

/**
 * 연동 오류 문구의 키 — **에러 객체의 `code`와 같은 값이다.**
 *
 * 원본은 `CalDavError.code`(main/caldav/client.ts)와 `GoogleApiError.code`
 * (main/google/calendar.ts), `OAuthError.code`(main/google/oauth.ts·
 * main/google-auth-flow.ts)다. 여기 한 번 더 적는 이유는 방향 때문이다 —
 * shared는 렌더러도 import하므로 main을 끌어올 수 없다. 대신 ipc-handlers가
 * `caldavErrors[error.code]`로 인덱싱하니, CalDAV 쪽 code가 하나 늘고 여기에
 * 없으면 **컴파일이 깨져서** 번역 누락이 조용히 지나가지 않는다.
 */
export type CalDavErrorKey = 'unauthorized' | 'forbidden' | 'not_found' | 'conflict' | 'network' | 'protocol' | 'server'

export type GoogleErrorKey =
  // GoogleApiError
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limit'
  | 'server'
  | 'network'
  // OAuthError — 연결·갱신 흐름. `code`가 `string`이라 타입이 전부를 못 잡는다.
  | 'not_connected'
  | 'no_refresh_token'
  | 'invalid_grant'
  | 'token_failed'
  | 'access_denied'
  | 'auth_failed'
  | 'state_mismatch'
  | 'no_code'
  | 'no_token'
  | 'invalid_callback'
  | 'bad_response'
  | 'cancelled'
  | 'timeout'
  | 'open_failed'
  | 'listen_failed'

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
  /** 라이선스 파일이 깨져 옆으로 치웠을 때. 말하지 않으면 유료 활성화가 조용히 사라진다. */
  licenseSalvagedTitle: string
  licenseSalvagedBody: string
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
  /** 첨부 고르기 다이얼로그의 형식 이름. macOS가 이 문자열을 그대로 띄운다. */
  filterAllFiles: string
  filterImages: string
  filterDocuments: string
  /** CalDAV 연결을 누를 때 계정·앱 암호가 비어 있으면. */
  calendarCredentialsMissing: string
  /** 빌드에 구글 OAuth 클라이언트 ID가 주입되지 않았으면. */
  googleClientIdMissing: string
  /**
   * 연동 오류 문구. **키는 에러 객체의 `code`다.**
   *
   * CalDavError·GoogleApiError·OAuthError의 `message`는 개발자용이다 — 한국어로
   * 박혀 있고 `일정 조회:` 같은 컨텍스트까지 붙는다. 렌더러(CalendarSyncSection·
   * GoogleSyncSection)는 `response.message`를 **그대로** 출력하므로, 그 message가
   * 나가면 영어 UI에 한국어가 튄다. 그래서 밖으로 나가는 문장은 전부 여기서 온다.
   */
  caldavErrors: Record<CalDavErrorKey, string>
  googleErrors: Record<GoogleErrorKey, string>
  /** 모르는 code와 우리 오류 타입이 아닌 예외. 내부 정보가 새지 않게 일반 문구로 접는다. */
  syncErrorUnknown: string
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
    licenseSalvagedTitle: '라이선스 정보를 읽지 못했습니다',
    licenseSalvagedBody:
      '저장된 라이선스 파일이 깨져 있어 등록 정보 없이 시작합니다. 원본은 같은 폴더에 .corrupt- 사본으로 남겨 뒀습니다.\n\n설정 → 라이선스에서 키를 다시 넣으면 그대로 복구됩니다. 키가 기억나지 않으면 같은 화면의 "키를 잃어버렸다면"을 눌러 주세요.',
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
    keychainNoticeButton: '확인',
    filterAllFiles: '모든 파일',
    filterImages: '이미지',
    filterDocuments: '문서',
    calendarCredentialsMissing: '계정과 앱 암호를 먼저 입력하세요.',
    googleClientIdMissing: '구글 OAuth 클라이언트 ID가 설정되지 않았습니다. 빌드 설정을 확인하세요.',
    caldavErrors: {
      unauthorized: '로그인하지 못했습니다. iCloud는 계정 암호가 아니라 앱 암호가 필요합니다.',
      forbidden: '이 캘린더에 접근할 권한이 없습니다.',
      not_found: '캘린더를 찾지 못했습니다. 다시 고른 뒤 시도하세요.',
      conflict: '캘린더 쪽에서 먼저 바뀌었습니다. 다시 동기화해 주세요.',
      network: '캘린더 서버에 연결하지 못했습니다.',
      protocol: '캘린더 서버의 응답을 이해할 수 없습니다. 서버 주소를 확인하세요.',
      server: '캘린더 서버가 오류를 돌려줬습니다.'
    },
    googleErrors: {
      unauthorized: '구글 인증이 만료되었습니다. 다시 연결해 주세요.',
      forbidden: '이 캘린더에 접근할 권한이 없습니다.',
      not_found: '대상을 찾지 못했습니다.',
      conflict: '캘린더 쪽에서 먼저 바뀌었습니다.',
      rate_limit: '요청이 너무 잦습니다. 잠시 후 다시 시도하세요.',
      server: '구글 캘린더가 오류를 돌려줬습니다.',
      network: '구글 서버에 연결하지 못했습니다.',
      not_connected: '구글 계정이 연결되어 있지 않습니다.',
      no_refresh_token: '구글 연결이 만료되었습니다. 다시 연결해 주세요.',
      invalid_grant: '구글 연결이 만료되었습니다. 다시 연결해 주세요.',
      token_failed: '구글에서 토큰을 받지 못했습니다. 다시 시도하세요.',
      access_denied: '권한 요청을 취소했습니다.',
      auth_failed: '구글 인증에 실패했습니다. 다시 시도하세요.',
      state_mismatch: '인증 응답이 이 요청과 일치하지 않습니다. 다시 시도하세요.',
      no_code: '인증 코드를 받지 못했습니다. 다시 시도하세요.',
      no_token: '액세스 토큰을 받지 못했습니다. 다시 시도하세요.',
      invalid_callback: '인증 응답을 이해할 수 없습니다. 다시 시도하세요.',
      bad_response: '구글 응답을 이해할 수 없습니다. 다시 시도하세요.',
      cancelled: '로그인이 취소되었습니다.',
      timeout: '로그인 시간이 초과되었습니다. 다시 시도하세요.',
      open_failed: '브라우저를 열지 못했습니다.',
      listen_failed: '로그인 응답을 받을 자리를 열지 못했습니다. 다시 시도하세요.'
    },
    syncErrorUnknown: '알 수 없는 오류가 발생했습니다.'
  },
  en: {
    reminder: 'Reminder',
    permProbeTitle: 'Greenday notification check',
    permProbeBody: 'If you can see this banner, reminders will arrive the same way.',
    menuView: 'View',
    dbFailedTitle: 'Could not read your data',
    dbFailedBody:
      'The saved task file could not be opened, so the app is starting empty. A .corrupt- copy of the original was saved next to it, and nothing will be written this session — closing the app leaves your original untouched.',
    licenseSalvagedTitle: 'Could not read your license',
    licenseSalvagedBody:
      'The saved license file was damaged, so the app is starting without your registration. A .corrupt- copy of the original was saved next to it.\n\nEnter your key again in Settings → License to restore it. If you no longer have the key, use "Lost your key?" on the same screen.',
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
    keychainNoticeButton: 'OK',
    filterAllFiles: 'All Files',
    filterImages: 'Images',
    filterDocuments: 'Documents',
    calendarCredentialsMissing: 'Enter your account and app password first.',
    googleClientIdMissing: 'This build has no Google OAuth client ID. Check the build settings.',
    caldavErrors: {
      unauthorized: 'Sign-in failed. iCloud needs an app-specific password, not your account password.',
      forbidden: 'You do not have permission to use this calendar.',
      not_found: 'That calendar could not be found. Pick it again and retry.',
      conflict: 'The calendar changed first. Sync again.',
      network: 'Could not reach the calendar server.',
      protocol: 'Could not make sense of the calendar server reply. Check the server address.',
      server: 'The calendar server returned an error.'
    },
    googleErrors: {
      unauthorized: 'Your Google sign-in expired. Connect again.',
      forbidden: 'You do not have permission to use this calendar.',
      not_found: 'That item could not be found.',
      conflict: 'The calendar changed first.',
      rate_limit: 'Too many requests. Try again in a moment.',
      server: 'Google Calendar returned an error.',
      network: 'Could not reach Google.',
      not_connected: 'No Google account is connected.',
      no_refresh_token: 'Your Google connection expired. Connect again.',
      invalid_grant: 'Your Google connection expired. Connect again.',
      token_failed: 'Google did not issue a token. Try again.',
      access_denied: 'You cancelled the permission request.',
      auth_failed: 'Google sign-in failed. Try again.',
      state_mismatch: 'That sign-in reply does not match this request. Try again.',
      no_code: 'No authorization code came back. Try again.',
      no_token: 'No access token came back. Try again.',
      invalid_callback: 'The sign-in reply could not be read. Try again.',
      bad_response: 'The reply from Google could not be read. Try again.',
      cancelled: 'Sign-in was cancelled.',
      timeout: 'Sign-in timed out. Try again.',
      open_failed: 'Could not open your browser.',
      listen_failed: 'Could not open a port to receive the sign-in reply. Try again.'
    },
    syncErrorUnknown: 'Something went wrong.'
  }
}

export function isMainLanguage(value: unknown): value is MainLanguage {
  return typeof value === 'string' && (MAIN_LANGUAGES as readonly string[]).includes(value)
}

export function mainStrings(language: MainLanguage): MainStrings {
  return STRINGS[language]
}
