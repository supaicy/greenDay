# 감사 후속 구현 계획

- 기준: `SUMMARY.md` 96건 (critical 8 / high 19 / medium 42 / low 27)
- 확정일: 2026-08-28
- **전부 처리한다.** 범위 축소 없음.

## 확정된 결정

| # | 결정 | 근거 |
|---|---|---|
| D1 | **C4는 정확성만 수정** — 저장 큐 직렬화 + temp/fsync/rename. JSON 유지, SQLite 이전 없음 | 실제 데이터 14 kB. 성능 동기가 약하고 회귀 위험이 이득보다 크다. 데이터 손상 경로는 이것으로 닫힌다 |
| D2 | **서버(`bicmac-license`)도 범위 안** | C8·H10은 클라이언트만으로 닫을 수 없다. **운영 D1 반영은 사람이 실행한다** |
| D3 | **H15·H16은 기능까지 구현** | 문서·판매 문구가 이미 약속한 것들이다. 축소하면 약속을 내리는 셈이 된다 |
| D4 | **서브시스템 4 × (claude 구현 + codex 적대적 검증)** | 감사에서 교차 확인이 실제로 통했다. 워크트리 분리로 파일 충돌을 없앤다 |

## 워커 배치

감사 때의 관심사가 서브시스템과 자연스럽게 맞아 그대로 옮긴다.

| 워크트리 | 브랜치 | 구현 | 검증 | 소유 파일 |
|---|---|---|---|---|
| `wt-licensing` | `audit/licensing` | gd-sec-cc | gd-sec-cx | `main/licensing/*`, `main/ipc-gate.ts`, `renderer/licensing/*`, `LicenseSection.tsx`, **+ `bicmac-license`** |
| `wt-sync` | `audit/sync` | gd-feat-cc | gd-feat-cx | `main/caldav/*`, `main/google/*`, `calendar-*.ts`, `google-*.ts`, `shared/app-id.ts`, 동기화 UI |
| `wt-data` | `audit/data` | gd-bug-cc | gd-bug-cx | `main/database.ts`, `main/validate.ts`, `store/useStore.ts` |
| `wt-shell` | `audit/shell` | gd-perf-cc | gd-perf-cx | `main/index.ts`, `main/ipc-handlers.ts`, `main/ai-service.ts`, `main/app-ipc.ts`, `renderer/components/*`, `utils/*`, `hooks/*`, `i18n/*` |

**충돌 규칙**: 소유 파일 밖은 건드리지 않는다. 경계에 걸친 항목은 아래 표에서 소유자를 못 박았다.
다른 서브시스템의 파일이 필요하면 오케스트레이터에게 올린다 — 직접 고치지 않는다.

---

## 웨이브 1 — 블로커·자격증명·데이터 손실

가장 위험한 것부터. 네 워크트리가 동시에 진행한다.

### wt-licensing (gd-sec)
`C8` 서버 제품 행 · `H2` 단조 시계 체크포인트 · `H3` 트라이얼 저장 실패 fail-closed ·
`H4` 활성화 버튼 영구 잠금 · `H9` 거절 사유 보존 · `H10` 기기 해제(클라 + 서버) ·
`H11` generation 가드 · `H17` enforcement 전환 정책 · `H19` 라이선스 파일 손상 고지

**서버 변경** — `migrations/0002_greenday.sql`(제품 행 + 확정가 ₩19,000),
`/v1/validate`를 `handleActivate`에서 분리, 기기별 tombstone, `GET`/`DELETE /v1/devices`.
**배포하지 않는다. 마이그레이션과 코드만 준비하고 사람의 승인을 기다린다.**

### wt-sync (gd-feat)
`C1` CalDAV href 출처 강제 · `C6` OAuth loopback+PKCE로 전환, scope 재설계 ·
`H16` ETag 충돌 + 반복 할일 RRULE 코어 공유 + provider/serverUrl UI ·
`M1` 자격증명 오리진 결속 · `M4` UID 이스케이프(← `validate.ts`는 wt-data 소유,
이 항목의 `validate.ts` 절반은 **wt-data가 한다**)

### wt-data (gd-bug)
`C4` 저장 큐 + 원자적 교체 · `H5` 하위작업 복원 대칭 · `H8` 읽기 실패 세션 fail-closed ·
`H15` archive 포맷 + import/restore · `M2` 끊어진 심링크 · `M4`의 `validate.ts` 절반(id 정규식) ·
`M8` 점수 원장 분리 · `M17` 첨부 GC

**codex가 `/private/tmp`에 쓴 재현 테스트 3개를 저장소 안 회귀 테스트로 옮긴다.**

### wt-shell (gd-perf)
`C2` 네비게이션 가드 + 문서 드롭 가드 (`ipc-gate.ts`의 senderFrame 검사는 **wt-licensing 소유**) ·
`C3` AI 키 오리진 결속 + SSRF 차단을 요청 시점으로 이동 · `M3` safeStorage purpose 결속

---

## 웨이브 2 — 정확성·사용자 노출

`H1` 낙관적 롤백(wt-data) · `H6` 날짜 UTC 파싱(wt-shell) · `H7` AI 설정 하이드레이트(wt-shell) ·
`H18` 한국어 문구(wt-shell) · `M7` 토큰 삭제 조건(wt-sync) · `M9` 내보내기 실패(wt-data) ·
`M10`·`M11` updater(wt-shell) · `M12` 단축키 가드(wt-shell) · `M13` 첨부 거절(wt-shell) ·
`M14`~`M16` 라이선스·완료 트랜잭션 · `M18`~`M31` 나머지 medium

## 웨이브 3 — 성능

`H12a`+`H12b` **함께 고치고 재측정** · `H13` 저장 배치 · `H14` 첨부 비동기 복사 ·
`M32`~`M42` 성능 medium

> 실제 데이터가 14 kB라 **지금 체감되는 문제가 아니다.** 정확성 웨이브 뒤로 미룬다.
> H12는 측정 → 수정 → 재측정 순서를 지킨다.

## 웨이브 4 — low 27건

---

## 사람이 해야 하는 것 (코드로 닫을 수 없음)

| 항목 | 필요한 것 | 막고 있는 것 |
|---|---|---|
| **C7** 개인정보처리방침 | 내가 ko/en 초안을 쓴다. **게시(gh-pages)와 법적 문구 승인은 사람** | enforcement 켜기 |
| **C6** Google OAuth | Google Cloud Console에서 **Desktop client 발급** + consent 설정 | 코드는 준비 가능, 왕복 검증 불가 |
| **C8** 운영 D1 | 마이그레이션을 **운영 D1에 적용** + 실결제 왕복 smoke-test | enforcement 켜기 |
| **M6** entitlement | `disable-library-validation` 제거 후 **서명·공증 재확인** | 배포 파이프라인 |

## 불변 조건

- `IS_ENFORCED = false`를 **유지한다.** 위 네 항목이 전부 닫히기 전에는 켜지 않는다.
- 각 워크트리는 머지 전 `npx tsc --build` · `npx biome lint src electron.vite.config.ts` ·
  `npx vitest run`이 전부 통과해야 한다.
- 발견 하나당 **회귀 테스트 하나**. 테스트 없이 닫힌 항목은 닫힌 것으로 세지 않는다.
- 머지 순서는 오케스트레이터가 정한다. 워커는 자기 브랜치에 푸시만 한다.
