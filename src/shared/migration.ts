/**
 * 번들 ID 마이그레이션의 **렌더러가 보는** 상태. 메인이 부팅 때 계산해 두고
 * `migration:status` IPC로 넘긴다. 비밀값·경로 원문은 싣지 않는다.
 *
 * 두 앱이 이 형식을 본다:
 *   - 브리지(v1.5.0, com.haru.app): "새 앱으로 옮겨가세요" 안내 — `mode: 'bridge'`
 *   - 새 앱(v2.0.0+, com.begreen.greenday): 첫 실행 마이그레이션 결과 — `mode: 'arrival'`
 */

export type SentinelCheck = 'ok' | 'missing' | 'unavailable' | 'denied' | 'mismatch' | 'corrupt'

export interface BridgeStatus {
  mode: 'bridge'
  /** 안내를 지금 띄워야 하는가(스누즈 중이면 false). 설정에서 언제든 다시 열 수 있다. */
  noticeDue: boolean
  /** 스누즈 만료 시각. 없으면 null. */
  snoozedUntil: string | null
  /** 전환 전 백업이 만들어졌는가(또는 이미 있었는가). */
  backupReady: boolean
  /** 데이터 파일 상태. 'corrupt'면 안내 문구가 그 사실을 말한다. */
  integrity: 'ok' | 'missing' | 'corrupt'
  /** 암호화 sentinel이 만들어졌는가. 안 됐으면 새 앱에서 Keychain 검증을 건너뛴다. */
  sentinelReady: boolean
  downloadUrl: string
}

export interface ArrivalStatus {
  mode: 'arrival'
  /** 이번 실행에서 첫 실행 시퀀스를 실제로 돌렸는가(이미 끝난 설치면 false). */
  performed: boolean
  /** 브리지가 남긴 표식이 있었는가. */
  bridgeMarker: boolean
  sentinel: SentinelCheck | 'skipped'
  /**
   * 저장된 비밀값(AI 키·앱 암호·Google 토큰)을 읽지 못해 **보호 모드**인가.
   * 이 동안 기존 암호문은 절대 덮어쓰지 않는다 — 사용자가 Keychain 접근을 허용하고
   * 다시 열면 그대로 복호화된다.
   */
  secretsLocked: boolean
  /** 왜 잠겼는가. 잠기지 않았으면 null. */
  lockReason: SentinelCheck | null
  /** Google 캘린더를 다시 연결해야 하는가. */
  googleReconnect: boolean
  /** 옛 앱(haru.app)이 아직 있고, 새 앱이 정상이라 지워도 되는가. */
  oldAppRemovable: boolean
  /** 옛 앱 안내를 사용자가 닫았는가(영구). */
  oldAppHintDismissed: boolean
}

export interface NoMigrationStatus {
  mode: 'none'
}

export type MigrationStatus = BridgeStatus | ArrivalStatus | NoMigrationStatus

/** 새 앱을 받는 곳. 안내 화면의 유일한 링크. */
export const GREENDAY_DOWNLOAD_URL = 'https://begreen.dev/greenday'
