# 레퍼런스 — 번들 ID 마이그레이션 파일

2026-09-08 `ebf40d6` 기준(2026-10-07 `5894ea5` 에서 `runArrival`·`applyGate`·`oldAppRemovable` 을 다시 맞췄다). 출처는 `src/main/migration/{handoff,bridge,arrival,secrets-gate,boot}.ts`, `src/shared/migration.ts`, `src/main/database.ts`. 왜 이렇게 만들었는지는 [explanation-번들-ID-마이그레이션.md](explanation-번들-ID-마이그레이션.md).

모든 경로는 `app.getPath('userData')` = `~/Library/Application Support/ticktick/` 아래다(개발 중 `--user-data-dir` 를 줬으면 그 폴더). 두 앱(옛 `com.haru.app`, 새 `com.begreen.greenday`)이 **같은 폴더**를 본다.

## 파일 한눈에

| 파일 | 상수 | 만드는 쪽 | 읽는 쪽 |
|---|---|---|---|
| `migration-state.json` | `MIGRATION_STATE_FILE` | 브리지·새 앱 | 둘 다 |
| `keycheck.sentinel` | `SENTINEL_FILE` | 브리지 (새 앱도 조건부로) | 새 앱 |
| `backup-before-greenday-2/` | `BRIDGE_BACKUP_DIR` | 브리지 (없으면 새 앱) | 사람 |
| `migration-state.json.corrupt-<stamp>` | — | `readState` 가 깨진 파일을 치울 때 | 사람 |
| `backup-before-greenday-2.partial-<stamp>` / `.incomplete-<stamp>` | — | 백업 중간 산출물 | 다음 실행이 `.partial-*` 을 치운다 |

`<stamp>` 는 `new Date().toISOString()` 에서 `:`·`.` 를 `-` 로 바꾼 것.

## `migration-state.json`

```jsonc
{
  "version": 1,
  "bridge": {                       // 브리지 v1.5.0 이 돌았으면. 아니면 null
    "appVersion": "1.5.0",
    "bundleId": "com.haru.app",
    "at": "2026-09-…Z",
    "backupDir": "/…/ticktick/backup-before-greenday-2",   // 백업을 못 만들었으면 null
    "sentinelPath": "/…/ticktick/keycheck.sentinel",       // 못 썼으면 null
    "integrity": "ok" | "missing" | "corrupt"
  },
  "arrival": {                      // 새 앱 첫 실행이 끝났으면. 아니면 null
    "appVersion": "2.0.0",
    "bundleId": "com.begreen.greenday",
    "at": "…",
    "backupDir": "…",
    "sentinel": "ok" | "missing" | "unavailable" | "denied" | "mismatch" | "corrupt" | "skipped",
    "completedAt": "…",             // 시퀀스를 끝까지 돌았을 때만. null 이면 다음 실행이 처음부터
    "oldAppHintDismissed": false
  },
  "noticeSnoozedUntil": null        // 브리지 "나중에" — ISO 시각 또는 null
}
```

실측(개발 모드, 격리 폴더, 옛 앱 없음):

```json
{ "version": 1, "bridge": null,
  "arrival": { "appVersion": "2.0.0", "bundleId": "com.begreen.greenday", "at": "2026-09-08T08:46:35.889Z",
               "backupDir": "/private/tmp/greenday-doc-verify/backup-before-greenday-2",
               "sentinel": "skipped", "completedAt": "2026-09-08T08:46:35.889Z", "oldAppHintDismissed": false },
  "noticeSnoozedUntil": null }
```

**읽기** (`readState`): 없으면 `null`. 파싱 실패·`version !== 1`·객체 아님 → `.corrupt-<stamp>` 로 rename 하고 `null`(= "처음"). `bridge`/`arrival` 은 `appVersion`·`bundleId`·`at` 이 문자열일 때만 인정, 아니면 `null`.

**쓰기** (`writeStateAtomic`): 디렉터리 확보 → 임시 파일 `.migration-state.json.<pid>.<Date.now()>.tmp` 를 `O_WRONLY|O_CREAT|O_TRUNC`, 모드 `0600` 으로 열어 JSON(들여쓰기 2) 쓰기 → `fsync` → `rename` → **부모 디렉터리 fsync**(지원 안 하는 FS 면 무시). `database.ts` 의 커밋과 같은 규약.

**멱등**: 브리지는 `bridge.appVersion === 지금 버전` 이고 `sentinelPath` 가 있고 sentinel 이 `ok` 면 1~4 를 건너뛴다. 새 앱은 `arrival.completedAt !== null && arrival.bundleId === 지금 ID` 면 백업·안내를 다시 하지 않고 **sentinel 만 매 실행 다시 잰다**(열렸는데 결과가 `ok` 가 아니면 지금 키로 다시 심는다).

## `keycheck.sentinel`

- 내용: `safeStorage.encryptString('keycheck-v1')` 의 **base64** 한 줄(`SENTINEL_PLAINTEXT = 'keycheck-v1'`). 값 자체는 비밀이 아니다.
- 쓰기 (`writeSentinel`): `crypto.available()` 아니면 `'unavailable'`; `<파일>.<pid>.tmp` 에 모드 `0600` 으로 쓰고 rename → `'written'`; 예외 → `'failed'`.
- 읽기 (`checkSentinel`) → `SentinelCheck`:

| 결과 | 조건 | 새 앱의 해석 |
|---|---|---|
| `ok` | 복호화한 값이 `keycheck-v1` | 같은 키 → 실제 비밀값을 읽어도 된다 |
| `missing` | 파일 없음 | 브리지가 안 돌았거나 실패 |
| `unavailable` | `safeStorage.isEncryptionAvailable()` 가 false | 이 환경에서 암호화 자체가 안 됨 |
| `corrupt` | 못 읽거나 base64 문자가 아님 | |
| `denied` | `decryptString` 이 던졌다 | Keychain 거부·잠김·항목 없음(새 랜덤 키) |
| `mismatch` | 풀렸는데 다른 값 | 다른 키로 만든 sentinel |

`'skipped'` 는 `checkSentinel` 의 결과가 아니라 새 앱이 **재 볼 것이 없어 안 잰 것**이다(브리지 표식도 암호문도 없을 때).

## `backup-before-greenday-2/`

`backupUserData(userData, name, { appVersion, at })`:

- 이미 `<dir>/manifest.json` 이 있으면 **아무것도 하지 않는다** (`existed: true`). "전환 전" 백업은 절대 덮이지 않는다.
- 앞선 실행의 `<name>.partial-*` 을 지운다. 매니페스트 없는 `<name>` 디렉터리가 있으면 `<name>.incomplete-<stamp>` 로 옆에 치운다.
- 스테이징 `<name>.partial-<stamp>` 에 복사 → 매니페스트 fsync → **rename** → 부모 디렉터리 fsync. 중간에 죽으면 `.partial-` 만 남는다 — 반쪽이 "백업 있음" 으로 읽히지 않는다.

복사 대상(`DATA_FILES`, `DATA_DIRS`) — 있는 것만, **암호문은 암호문 그대로**:

```
ticktick-data.json  ticktick-data.json.bak  ai-config.json  ai-chat.json
calendar-config.json  google-config.json  license.json  device-id
attachments/
```

`manifest.json`:

```json
{ "version": 1, "appVersion": "2.0.0", "createdAt": "2026-09-08T08:46:35.889Z", "files": ["attachments/"] }
```

`backupExists(userData, name)` 는 매니페스트 존재로 판단한다. 새 앱은 브리지가 만든 것이 있으면 그것을 쓰고, 없으면 자기가 만든다.

## 무결성 (`checkIntegrity`)

`ticktick-data.json` 과 `.bak` 을 파싱만 한다 — **고치지 않는다**(복구는 `database.ts` 몫). 브리지는 결과를 상태 파일의 `integrity` 에 적고, 새 앱은 옛 앱이 있을 때 `oldAppRemovable` 판정에 쓴다(`status === 'ok'` 일 때만 안내).

| primary | backup | `status` | `backupReadable` |
|---|---|---|---|
| ok | 무엇이든 | `ok` | backup ok 여부 |
| missing | not ok | `missing` | false |
| missing | ok | `ok` | true |
| corrupt | 무엇이든 | `corrupt` | backup ok 여부 |

## 스누즈 (브리지)

`SNOOZE_DAYS = 3`. `snoozeBridgeNotice` 가 `noticeSnoozedUntil = now + 3일` 을 쓰고, `clearBridgeSnooze` 가 `null` 로. `BridgeStatus.noticeDue = !(snoozedUntil > now)`.

## 렌더러가 받는 상태 (`shared/migration.ts`)

```ts
interface BridgeStatus {
  mode: 'bridge'
  noticeDue: boolean; snoozedUntil: string | null
  backupReady: boolean                       // state.bridge.backupDir != null
  integrity: 'ok' | 'missing' | 'corrupt'    // 없으면 'missing'
  sentinelReady: boolean                     // state.bridge.sentinelPath 있음
  downloadUrl: string                        // 'https://begreen.dev/greenday'
}
interface ArrivalStatus {
  mode: 'arrival'
  performed: boolean                         // 이번 실행에서 시퀀스를 실제로 돌렸는가
  bridgeMarker: boolean                      // state.bridge !== null
  sentinel: SentinelCheck | 'skipped'
  secretsLocked: boolean                     // 보호 모드
  lockReason: SentinelCheck | null           // 잠겼을 때 sentinel 결과. 'skipped' 로 잠기는 일은 없다
  googleReconnect: boolean                   // tokens_enc 가 있고 (잠겼거나 실제로 안 읽힘)
  oldAppRemovable: boolean                   // !locked && 옛 앱 존재 && 무결성 ok && !dismissed
  oldAppHintDismissed: boolean
}
type MigrationStatus = BridgeStatus | ArrivalStatus | { mode: 'none' }
```

옛 앱 존재 판정 경로: `/Applications/haru.app`, `~/Applications/haru.app`. `capabilities.inheritsLegacyData` 가 false 인 빌드(MAS — 샌드박스라 옛 데이터를 못 읽는다)에서는 언제나 "없음"이다(`boot.ts` `oldAppVisible`).

## 새 앱 첫 실행 순서 (`runArrival`)

```
singleInstance 가 false → 아무것도 안 함 (곧 quit 할 인스턴스)
holdSaves()
  이미 completedAt 있음 → sentinel 만 재고 게이트 갱신 → (열렸고 ok 가 아니면 writeSentinel) → 반환
  백업 (브리지 것이 있으면 그것)
  bridgeMarker = state.bridge !== null
  ciphertexts = hasStoredCiphertexts()   // ai-config.apiKey_enc | calendar-config.password_enc | google-config.tokens_enc
  (bridgeMarker || ciphertexts) 면: notifyKeychain() [동기 대화상자] → sentinel = checkSentinel()
  locked = applyGate(sentinel, ciphertexts)
  !locked && sentinel !== 'ok' → writeSentinel()        // 다음 실행부터 잴 수 있게 (refreshSentinelIfOpen)
  googleReconnect = tokens_enc 있음 && (locked || !googleTokensReadable())
  oldAppRemovable = !locked && oldAppPresent() && checkIntegrity(userData).status === 'ok'
  writeStateAtomic(arrival.completedAt = now)
finally releaseSaves()
```

`applyGate`: `skipped`·`ok` → 연다. 암호문이 없으면 결과가 무엇이든 → 연다(지킬 것이 없다). 암호문이 있고 `missing/unavailable/denied/mismatch/corrupt`(`LOCKING`) → `lockSecrets(reason)`.

`index.ts` 는 `holdSaves()` 를 `initDatabase()` **앞**에서 부르고, IPC 핸들러 등록 전에 `runMigrationOnBoot` 를 돌린다 — 렌더러 mutation 이 끼어들 길이 없다. 실패하면 로그만 남기고 `releaseSaves()` 한 뒤 앱은 계속 뜬다.

## 보호 모드 (`secrets-gate.ts`)

모듈 상태 `{ locked: boolean, reason: SentinelCheck | null }`. `lockSecrets(reason)` / `unlockSecrets()` / `secretsLocked()` / `secretsGate()`.

```ts
preserveCiphertext(next, existingFilePath, field, clearSecret = false)
```

잠겨 있고 `clearSecret` 가 아니고 `next[field]` 가 비어 있으면 파일에 있던 `field` 값을 되살린다. 세 writer 가 저장 직전에 부른다:

| writer | 파일 | field | `clearSecret` 가 true 인 때 |
|---|---|---|---|
| `database.saveAiConfig` | `ai-config.json` | `apiKey_enc` | — (항상 false) |
| `calendar-config.writeConfigFile` | `calendar-config.json` | `password_enc` | `calendar:disconnect` |
| `google-config.writeGoogleConfig` | `google-config.json` | `tokens_enc` | `google:disconnect` |

즉 보호 모드에서: 비밀을 못 읽은 채 설정을 저장해도 `*_enc` 가 `null` 로 덮이지 않는다; 새 값을 넣는 저장은 그대로 된다; 연결 해제는 사용자의 결정이라 지운다.

해제 경로 둘:
- 다음 실행에서 sentinel 이 `ok` 로 잰다 (사용자가 "항상 허용" 을 눌렀다).
- `migration:release-lock` — `releaseSecretsLock()` 이 **지금 키로 새 sentinel 을 심고** 열리는지 확인한 뒤 `unlockSecrets()`. 배너의 "다시 연결했습니다 — 보호 해제". 자동으로는 절대 부르지 않는다.

`migration:release-lock` 핸들러는 마지막에 `status.secretsLocked` 를 `secretsGate().locked` 로 다시 맞춘다 — 둘이 어긋나면 게이트가 맞다.

## 관련 파일 (마이그레이션이 만들지는 않지만 읽는 것)

| 파일 | 마이그레이션이 보는 칸 |
|---|---|
| `ai-config.json` | `apiKey_enc` (있으면 "암호문 있음") |
| `calendar-config.json` | `password_enc` |
| `google-config.json` | `tokens_enc` — `googleHasTokens`, 그리고 `readGoogleConfig().tokens !== null` 로 "실제로 읽히는가" |
| `ticktick-data.json`, `.bak` | 백업 복사와 무결성 판정만. **새 앱의 `arrival.ts` 는 이 파일을 쓰지 않는다** — 백업으로 복사하고 `oldAppRemovable` 의 `checkIntegrity` 로 파싱해 볼 뿐이다(테스트가 바이트 동일성을 본다) |

메인 프로세스가 Keychain 안내로 띄우는 문구는 `src/shared/main-strings.ts` 의 `keychainNotice*`, 렌더러 배너·모달 문구는 로케일 `migration.*`. 원문은 `docs/reports/2026-09-07-bridge-copy.md`.
