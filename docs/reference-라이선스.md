# 레퍼런스 — 라이선스

2026-09-08 `ebf40d6` 기준. 출처는 `src/main/licensing/*`, `src/shared/license.ts`, `src/shared/capabilities.ts`, `src/renderer/src/licensing/*`. 설계 이유는 [explanation-라이선스-게이트와-MAS.md](explanation-라이선스-게이트와-MAS.md).

## 서버와 엔드포인트 (`licensing/endpoints.ts`, `licenseClient.ts`)

| 항목 | 값 |
|---|---|
| `LICENSE_BASE_URL` | `https://pay.begreen.dev` — 리터럴, 환경변수 없음. `endpoints.test.ts` 가 못 박는다 |
| `PRODUCT_SLUG` | `greenday` |
| 구매 | `GET {base}/buy?product=greenday&src=<settings\|locked>` — 메인이 `shell.openExternal` 로 연다 |
| 복구 | `GET {base}/recover` |
| 활성화 | `POST {base}/v1/activate` `{ key, device, deviceName }` |
| 재검증 | `POST {base}/v1/validate` `{ key, device, deviceName }` |
| 해제 | `POST {base}/v1/deactivate` `{ key, device }` |
| 타임아웃 | 15초 (`AbortSignal.timeout`) |
| 리다이렉트 | `redirect: 'error'` — 따라가지 않는다(본문에 원본 키가 실린다) |

성공 응답: `200 { token: string, expiresAt: number(unix 초) }`. 캡티브 포털의 200 을 걸러내려고 형태를 검사한다 — 어긋나면 `network`.

`KNOWN_REFUSALS` — **이 표에 있는 `상태:코드` 만** 서버의 판정으로 친다. 없는 것은 전부 `network`(못 닿음 → 라이선스를 닫지 않는다):

| `status:error` | `ClientError` |
|---|---|
| `400:malformed_key`, `400:missing_fields`, `400:malformed_device` | `malformedKey` |
| `404:unknown_key` | `unknownKey` |
| `404:revoked` | `revoked` |
| `404:device_not_active` | `deviceNotActive` |
| `409:device_limit` | `deviceLimit` |
| `429:deactivation_limit` | `deactivationLimit` |

`isServerRefusal(error)` 가 `true` 인 것(라이선스를 닫는 판정): `unknownKey`, `revoked`, `deviceLimit`, `deviceNotActive`. `deactivationLimit`·`malformedKey` 는 일부러 판정이 아니다.

## 키 형식 (`licenseKey.ts`)

```
GREENDAY-XXXX-XXXX-XXXX-XXXX
```

`KEY_PREFIX = 'GREENDAY'`(서버 `products.key_prefix` 와 같다). 각 묶음은 `ABCDEFGHJKMNPQRSTVWXYZ23456789` 4자 — I·L·O·U·0·1 없음. `normalizeKey` 는 trim + 대문자. 형식이 틀리면 서버에 가지 않고 `invalidKey`.

화면 표시는 `maskKey`: `GREENDAY-••••-••••-••••-XXXX` (마지막 묶음만).

## 활성화 토큰 (`activationToken.ts`)

와이어 형식: `base64url(payload JSON) + "." + base64url(ed25519 서명)`.

| 페이로드 | 뜻 |
|---|---|
| `lic` | 정규화된 키의 SHA-256 hex (`licenseHash`) |
| `dev` | 기기 해시 |
| `prod` | 제품 slug |
| `exp`, `iat` | unix 초 |

공개키 `PRODUCTION_PUBLIC_KEY_BASE64 = 'DU0LPrFmCWTbM/6myq7+ov4fe1vPfUu1Sn0kvXLo5WM='` (raw 32바이트 → SPKI DER 로 감싸 `createPublicKey`). BicMac 과 같은 키다 — 제품 격리는 `prod` 검사가 한다.

`verifyToken(raw, { publicKey, device, nowMs, key? })` 의 판정 순서:

1. 두 조각이 base64url 인가 → 아니면 `malformed`
2. 디코드한 **그 바이트열** 위에서 서명 검증 → 실패 `badSignature`
3. 페이로드 파싱(`exp`·`iat` 는 유한한 number) → 실패 `malformed`
4. `dev !== device` → `wrongDevice`
5. `key` 를 줬고 `lic !== sha256(key)` → `wrongKey`
6. `prod !== 'greenday'` → `wrongProduct` (`prod` 가 없는 옛 토큰은 빈 문자열로 여기서 떨어진다)
7. `exp*1000 <= nowMs` → `{ ok: false, reason: 'expired', payload }` — 페이로드를 들려 보낸다(유예 마감 계산용)
8. 그 외 `{ ok: true, payload, expiresAtMs }`

권한은 **서명을 통과한 페이로드에서만** 나온다. 파일의 어떤 숫자도 권한을 만들지 못한다.

## `IS_ENFORCED` 와 실제 잠금 (`service.ts`)

```ts
export const IS_ENFORCED = false                       // 출하값
function enforcementActive() { return IS_ENFORCED && currentCapabilities().enforcesLicense }
```

- `IS_ENFORCED === false` 인 동안: 상태는 항상 `unlicensed`, `allowsPaidFeatures()` 는 `true`, 트라이얼 시작일을 **기록하지 않는다**, 게이트는 아무것도 막지 않는다. 활성화·해제·재검증 배관은 그대로 돈다(키를 넣으면 실제로 서버에 가고 토큰이 저장된다).
- 켜는 것은 상수 하나 + 서버 배포. 이미 설치된 앱에 그 플래그를 도달시키는 방법은 `docs/design/2026-08-28-minimum-supported-version.md`.
- `enforcesLicense` 가 `false` 인 빌드(개발·스토어)는 `IS_ENFORCED` 와 무관하게 잠그지 않는다.

## 상태 기계 (`licenseManager.ts`)

`LICENSE_STATUSES = ['unlicensed', 'trial', 'trialExpired', 'licensed', 'grace']` (`shared/license.ts` 가 원본, 타입은 파생).

| 상태 | 뜻 | `untilMs` |
|---|---|---|
| `unlicensed` | enforcement 꺼짐, 또는 아직 도출 전 | — |
| `trial` | 트라이얼 창 안 | 시작 + 30일 |
| `trialExpired` | 창 닫힘, 토큰 없음 | — |
| `licensed` | 유효한 토큰 | 토큰 `exp` |
| `grace` | 토큰이 만료됐지만 유예 안 | `exp` + 30일 |

`allowsPaidFeatures()` 는 매 호출마다 **실제 시각과 자기 마감을 비교**한다(절전에서 깨어난 앱이 만료된 채 돌지 않게). 마감마다 타이머(`scheduleClose`)가 걸려 상태가 스스로 넘어가고 `license:changed` 로 방송된다.

`settle()` 의 도출: 토큰 검증 ok → `licensed`; `expired` 이고 유예 마감 전 → `grace`; 그 외 → `evaluateTrial()`.

### 트라이얼·유예·시계 (`trialWindow.ts`, `bootSession.ts`)

| 상수 | 값 |
|---|---|
| `TRIAL_DURATION_MS` | 30일 |
| `GRACE_DURATION_MS` | 30일 (같은 숫자, 다른 상수) |
| `REVALIDATE_POLL_MS` | 6시간 — 반감기를 지났는지 **확인**하는 주기 |
| `RETRY_BASE_MS` → `RETRY_MAX_MS` | 못 닿았을 때 1분 → 2분 → … → 1시간 |
| `CLOCK_PERSIST_INTERVAL_MS` | 5분 — 유료 접근이 `lastSeenMs` 를 디스크에 내리는 최소 간격 |
| `MAX_TIMEOUT_MS` | 2,147,483,647 — setTimeout 상한. 그 너머의 마감은 잘라서 깨운다 |

- `effectiveNow = max(systemNow, lastSeenMs)` — 시계를 되돌려도 창은 여태 본 가장 먼 지점에서 계속 닫힌다.
- 트라이얼 시작일이 미래로 적혀 있으면 시스템 시계로 클램프해 **되쓴다**(시계 자체가 뒤로 간 경우만 예외). 프로세스당 한 번만 도출한다.
- `bootSession`: macOS `sysctl -n kern.bootsessionuuid` + `os.uptime()` 으로 벽시계와 무관한 경과의 **하한**을 낸다. 다른 부팅 세션이면 지금 uptime, 같은 세션이면 uptime 차이.
- 재검증은 토큰 수명의 **반감기**(`iat + (exp-iat)/2`, 래칫 시각으로 비교)를 지났을 때만 서버를 친다. 유예 중이면 무조건.
- 서버가 거부하면 재시도하지 않는다. 못 닿으면 물러서며 재시도.

## 활성화·해제 실패 코드 (`shared/license.ts`)

| `ActivateFailure` | 언제 |
|---|---|
| `invalidKey` | 형식 불일치 (서버 안 감) |
| `noDevice` | 기기 id 를 못 읽었다 (서버 안 감) |
| `badToken` | 서버가 준 토큰이 검증 실패 |
| `saveFailed` | 서버는 승인했는데 `license.json` 을 못 썼다 |
| `incomplete` | 활성화 도중 다른 작업(해제·재활성화)이 끼어들었다 |
| `unknownKey` `revoked` `deviceLimit` `deactivationLimit` `deviceNotActive` `malformedKey` `network` | `ClientError` 그대로 |

| `DeactivateFailure` | 언제 |
|---|---|
| `nothing` | 해제할 키가 없다 |
| `noDevice` | 기기 id 없음 |
| `deactivationLimit` | 429 |
| `refused` | 서버 거부 (`deviceNotActive` 는 거부가 아니라 성공으로 친다) |
| `saveFailed` | 서버는 풀었는데 로컬 삭제 실패 |
| `network` | |

렌더러는 `t('license.error.<code>')` 로 문구를 찾는다. 모든 코드에 ko·en 문구가 있는지 `locales.test.ts` 가 타입으로 강제한다.

## 저장 — `license.json` (`licenseStore.ts`)

`<userData>/license.json`, 할일 데이터와 별도 파일(내보내기·복원이 라이선스를 실어 나르지 않게).

```jsonc
{
  "key": "GREENDAY-…",          // null 가능
  "token": "eyJ….sig",          // 유일한 권한 증거
  "lastSeenMs": 1757…,          // 올라가기만 하는 래칫
  "trialStartMs": null,         // enforcement 켜진 뒤에만 기록
  "monotonic": { "bootId": "…", "uptimeMs": 12345 },   // 또는 null
  "blockedReason": null         // 'revoked' | 'deviceLimit' | 'deviceNotActive' | null — 표시 전용
}
```

쓰기는 임시 파일 → rename. `durable: true`(키·토큰이 실린 쓰기)일 때만 fsync. 깨진 파일은 `.corrupt-<stamp>` 로 복사해 두고 빈 레코드로 시작하며 `lastReadSalvaged()` 가 그 사실을 알린다. 파일을 지우면 트라이얼이 리셋된다 — 의도된 트레이드오프.

기기 id: `<userData>/device-id`(하드웨어를 못 읽었을 때의 난수 대체). 하드웨어 값은 macOS `/usr/sbin/ioreg -rd1 -c IOPlatformExpertDevice` 의 `IOPlatformUUID`, Windows `MachineGuid`, Linux `/etc/machine-id`. 서버에는 `sha256('greenday.device.v1:' + raw)` 만 간다(`DEVICE_SALT`, BicMac 과 다른 값).

## 빌드별 capabilities (`shared/capabilities.ts`)

```ts
canSelfUpdate:      !isDev && !isStoreBuild && !isBridge
hasGlobalShortcuts: !isMas
needsLicenseKey:    !isStoreBuild
enforcesLicense:    !isDevBuild && !isStoreBuild
updatesViaStore:    isStoreBuild
isBridge:           isBridgeBuild === true
```

| 빌드 | `canSelfUpdate` | `hasGlobalShortcuts` | `needsLicenseKey` | `enforcesLicense` | `updatesViaStore` | `isBridge` |
|---|---|---|---|---|---|---|
| 직접 배포 (`npm run release` / 태그) | ✓ | ✓ | ✓ | ✓ (잠금은 `IS_ENFORCED` 도 참일 때) | – | – |
| MAS (`mas:build`) | – | – | – | – | ✓ | – |
| 브리지 (`package:bridge`) | – | ✓ | ✓ | ✓ | – | ✓ |
| 개발 (`npm run dev`) | – | ✓ | ✓ | – | – | – |
| 로컬 `npm run build` 뒤 맨 Electron | – (`is.dev`) | ✓ | ✓ | ✓ | – | – |

`isDevBuild` 는 빌드 시점 `__IS_DEV_BUILD__`, `isDev` 는 런타임 `!app.isPackaged`. 잠금 판정에는 앞엣것만 쓴다. 판정은 `main/capabilities.ts` 한 곳에서 `process.mas` 를 읽고, `mas-preflight.sh` 4/6 이 다른 곳에서 읽지 않는지 검사한다.

## 렌더러가 받는 것 (`PublicLicenseState`)

```ts
interface PublicLicenseState {
  status: LicenseStatus
  untilMs: number | null
  allowsPaidFeatures: boolean
  enforced: boolean          // enforcementActive()
  maskedKey: string | null   // GREENDAY-••••-••••-••••-XXXX
  deviceName: string | null  // os.hostname() — 활성화에 함께 나가는 값. 화면에 미리 적는다
  blockedReason: LicenseBlockReason | null
}
```

키도 토큰도 렌더러에 가지 않는다. `useLicense()`(`useSyncExternalStore`)가 `license:state` 한 번 + `license:changed` 구독으로 렌더러 전체에 하나의 값을 준다. IPC 너머의 값은 `normalize()` 로 모양을 확인하고, 모르면 `UNKNOWN_LICENSE_STATE`(**잠그지 않는 쪽**)로 기운다.

`LicenseGate`(`licensing/LicenseGate.tsx`)는 `!enforced || allowsPaidFeatures` 면 `null`. 잠겼을 때는 닫히지 않는 Radix Dialog 하나 — 키 입력, 구매 링크(`src=locked`), **내보내기**(무료), 키 복구 링크. 제목은 `blockedReason` 이 있으면 그 사유(예: "환불된 키")로 바뀐다.

`LicenseSection`(설정)은 `needsLicenseKey` 일 때만 그려지고 활성화·해제·구매(`src=settings`)를 한다. 두 화면은 `useActivation()` 하나를 공유한다.

## 게이트 문자열

| 상수 | 값 | 어디 |
|---|---|---|
| `LICENSE_REQUIRED` | `'license_required'` | `shared/license.ts` — 메인이 던지고 렌더러 `useStore` 가 `includes` 로 본다 |
| `UNTRUSTED_SENDER` | `'untrusted_sender'` | `main/ipc-gate.ts` — 정상 렌더러는 절대 받지 않는다 |

## 테스트 자산

`licensing/testTokens.ts` 가 진짜 ed25519 키쌍을 만들어 서버와 같은 형식으로 서명한다 — 가짜 검증 함수를 주입하지 않는다. `licenseManager.test.ts`(1,550줄)·`clockAttacks.test.ts`(412줄)가 시계 조작·유예·경합을 시뮬레이션한다.
