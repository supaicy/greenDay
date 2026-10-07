# 2026-08-28 버그 정확성 감사 — Codex

## Critical

[critical] src/main/database.ts:81 — 저장 세대가 직렬화되지 않아 오래된 비동기 스냅샷이 더 최신 종료 플러시를 뒤늦게 덮어쓴다 / `writeFile`을 지연시킨 재현에서 A 저장을 진행 중인 채 B를 추가하고 `closeDatabase()`로 `[A,B]`를 쓴 뒤, A 콜백이 착륙하자 파일이 `[A]`로 되돌아갔으며 구형 콜백은 새 저장의 `savePending`까지 `false`로 만들 수 있다 / revision을 가진 단일 저장 큐로 쓰기를 직렬화하고 종료 시 in-flight 쓰기를 drain한 뒤 최신 revision만 커밋한다.

[critical] src/main/database.ts:84 — 유일한 할일 DB를 대상 파일에 직접 잘라 쓰므로 프로세스 종료·전원 손실·동시 `writeFile` 하나가 전체 JSON을 훼손한다 / 모든 엔티티가 한 파일에 있어 부분 쓰기는 다음 실행을 읽기 전용 빈 세션으로 만들고, 이전 정상본으로 되돌릴 원자적 커밋도 없다 / 같은 볼륨의 임시 파일에 완전히 쓰고 필요 시 `fsync`한 뒤 `rename`하며 이전 정상본을 보존한다.

## High

[high] src/main/database.ts:78 — DB 읽기 실패 세션에서도 mutator는 메모리를 먼저 바꾸고 `save()`만 조용히 반환해 IPC가 성공한 유령 데이터를 만든다 / 기존 회귀 테스트도 이 상태에서 `createTask({title:'ghost'})`가 원본에는 안 쓰이는 것을 확인하며, 사용자는 오류 대화상자 뒤 빈 앱에서 한 세션치 편집을 한 후 재시작 때 전부 잃는다 / 읽기 전용 상태에서는 mutation 전에 명시적 오류를 던져 모든 쓰기 IPC를 막고 렌더러도 편집 불가·복구 UI를 표시한다.

[high] src/main/database.ts:84 — 정상적으로 읽은 세션의 디스크 쓰기 실패도 콘솔에만 기록되고 호출 IPC는 이미 성공한다 / `create-task` 등은 `void`를 즉시 반환하므로 ENOSPC·EACCES 뒤 메인 메모리와 렌더러는 변경됐지만 디스크는 옛 상태이고, 종료 플러시 실패도 사용자에게 전달되지 않는다 / 저장 API를 `Promise`로 만들고 IPC가 내구성 있는 커밋을 await하게 하며 실패 시 재시도 또는 권위 상태 재로드와 사용자 오류를 수행한다.

[high] src/renderer/src/store/useStore.ts:333 — 유료 IPC가 거절돼도 모든 낙관적 mutation이 렌더러에 그대로 남는다 / `updateTask`를 `license_required`로 거절한 재현에서 제목은 계속 `ghost`였고 라이선스 상태만 새로고침됐으므로, 잠금 해제 뒤에도 존재하지 않는 엔티티·편집이 보이다 재시작 때 사라진다 / mutation별 이전 스냅샷 또는 명령 로그를 보관해 거절 시 롤백하거나 메인의 권위 스냅샷을 다시 로드하고 실패를 화면에 표시한다.

[high] src/main/licensing/licenseManager.ts:677 — 권한 확인은 시계 바닥을 읽기만 하고 실제 경과를 올려 저장하지 않아, 벽시계를 되돌린 뒤 6시간 폴보다 자주 재실행하면 트라이얼·토큰 만료·취소 재검증을 무기한 피할 수 있다 / 5시간 경과 후 `allowsPaidFeatures()`를 호출해도 디스크 `lastSeenMs`가 그대로였고 시계를 원래 값으로 되돌려 manager를 재생성하자 다시 `licensed`였으며, 재실행은 `setTimeout`의 단조 경과도 함께 버린다 / 프로세스 단조 시계와 OS 부팅 식별자·uptime을 체크포인트로 저장해 종료/재실행을 이어 계산하고, 유료 접근 및 종료 시 그 바닥을 내구성 있게 전진시키거나 주기적으로 서명된 서버 시각을 요구한다.

[high] src/main/licensing/licenseManager.ts:632 — 같은 키의 낡은 재검증 응답이 더 새 수동 활성화를 취소할 수 있다 / 지연된 옛 `/validate`를 걸어 둔 뒤 같은 키로 새 토큰을 활성화하고 옛 `revoked` 응답을 착륙시키자 키 비교가 통과해 새 토큰이 삭제되고 `trialExpired`가 됐다 / await 전 자격증명 generation과 토큰을 캡처하고 응답 시 둘 다 일치할 때만 적용하며 활성화·갱신·해제를 직렬화한다.

[high] src/main/licensing/licenseManager.ts:489 — 해제와 백그라운드 재검증의 서버 작업이 반대 순서로 끝나면 앱은 해제 성공인데 서버 슬롯은 다시 점유된다 / 서버 `/v1/validate`가 activate와 같은 INSERT 경로인 계약에서, 해제 응답으로 로컬 키를 지운 뒤 늦은 validate가 슬롯을 재생성하면 line 608의 키 가드가 토큰만 버려 서버에는 유령 슬롯이 남는 순서를 재현했다 / 해제 전에 진행 중인 재검증을 취소·await하고 자격증명 작업을 mutex로 묶어 해제 커밋 뒤에는 같은 device의 validate가 서버에 도달하지 않게 한다.

[high] src/main/licensing/licenseManager.ts:309 — 첫 enforced 실행의 트라이얼 시작 저장 실패를 무시하고도 30일 권한을 반환한다 / `store.write=false`인 같은 빈 디스크 레코드로 manager를 두 번 만들자 둘 다 새 30일 `trial`을 받았고 `trialStartMs`는 계속 `null`이어서, 파일 삭제 없이 쓰기 불가 상태만 유지해도 무한 트라이얼이다 / 최초 트라이얼은 시작일과 clock floor의 원자적 커밋이 성공해야만 부여하고, 실패하면 명시적 저장 오류 상태로 fail closed하거나 별도 내구 저장소에 기록한다.

## Medium

[medium] src/main/licensing/licenseManager.ts:693 — 벽시계가 앞으로 뛰면 메인 게이트는 즉시 거절하지만 공개 `state`는 타이머가 울릴 때까지 `licensed`/`trial`로 남아 렌더러에 변화 방송이 없다 / 주입 시계를 60일 전진시킨 재현에서 `allowsPaidFeatures()`는 `false`인데 `getState()`는 계속 `licensed`였고, 첫 낙관적 편집만 거절된 뒤에야 렌더러가 상태를 다시 묻게 된다 / 권한 조회에서 마감을 넘긴 상태를 동기적으로 `settle/apply`해 방송하거나 시스템 시각 변경·resume 이벤트에서 상태를 재평가한다.

[medium] src/renderer/src/store/useStore.ts:656 — 할일 완료 한 번이 완료 행·점수·반복 원본 수정·다음 회차 생성을 서로 독립적인 유료 IPC로 나뉘어 저장된다 / 마감 경계나 한 호출의 실패에서 앞 호출만 통과하면 디스크에는 완료됐지만 점수가 없거나 다음 반복 회차가 없는 절반짜리 결과가 남고, 어느 호출도 보상하지 않는다 / 메인 프로세스에 단일 transactional `complete-task`/`batch-complete` 명령을 두어 관련 행을 한 revision으로 검증·커밋한다.

[medium] src/renderer/src/licensing/useActivation.ts:42 — 활성화 IPC가 reject하면 `busy`를 되돌리지 않고 rejection도 처리하지 않는다 / reject를 주입한 훅 재현에서 `activate()`가 그대로 reject하고 `busy===true`가 영구 유지됐으며, 설정의 해제도 `LicenseSection.tsx:70`에서 같은 구조라 `releasing`이 고착된다 / 두 경로를 `try/catch/finally`로 감싸 unknown IPC 오류를 사용자용 실패로 매핑하고 busy 플래그는 반드시 `finally`에서 해제한다.

[medium] src/renderer/src/components/sidebar/CalendarSyncSection.tsx:79 — 캘린더·Google 유료 IPC 호출은 게이트 rejection을 잡거나 라이선스 상태를 새로고침하지 않는다 / `try/finally`만 있는 연결·동기화와 catch조차 없는 선택 핸들러는 초기/낡은 렌더러 상태에서 `license_required`가 오면 React 이벤트의 unhandled rejection이 되고 사용자는 원인을 보지 못한다 / 공통 paid-IPC 래퍼로 거절을 catch해 `refreshLicense`, 오류 표시, 필요한 롤백을 수행하고 모든 async 이벤트 핸들러가 자체 종결되게 한다.

[medium] src/main/database.ts:409 — 첨부 복사본은 참조 제거·영구 삭제·휴지통 비우기 어느 경로에서도 삭제되지 않는다 / 파일을 복사해 유일한 참조 task를 영구 삭제한 재현에서도 `existsSync(copied)===true`였고, 여러 파일 복사 중 오류나 뒤이은 유료 `update-task` 거절도 이미 복사된 파일을 orphan으로 남긴다 / 첨부 추가를 task 커밋과 묶고 실패 시 즉시 정리하며, 참조가 0인 UUID 파일을 삭제하는 reference-count/GC를 영구 삭제와 시작 시점에 실행한다.

[medium] src/main/database.ts:403 — 부모 할일 복원은 함께 삭제된 하위작업을 복원하지 않는다 / 부모와 child를 만든 뒤 `deleteTask(parent)`→`restoreTask(parent)`를 실행하자 부모만 active로 돌아오고 child는 `getTrashTasks()`에 남았으며, 단일 삭제 undo도 부모 id 하나만 보낸다 / 삭제 시 실제 영향 id 집합을 저장하고 복원 IPC가 부모와 그 하위작업을 동일하게 원자 복원하도록 한다.

[medium] src/renderer/src/store/useStore.ts:817 — 일괄 완료는 다음 반복 인스턴스에 미래 `scheduledOverrides`를 넘기면서 완료 원본에서는 제거하지 않는다 / 미래 override가 있는 반복 task를 `batchComplete()`한 재현에서 완료본과 spawn 양쪽이 동일한 override를 소유했지만 단일 `toggleTask` 경로는 명시적으로 완료본에서 제거한다 / batch 계산이 각 원본의 남길 override patch도 만들고 완료·원본 patch·spawn을 한 트랜잭션으로 저장한다.

[medium] src/renderer/src/store/useStore.ts:996 — 완료 취소 점수 회수를 최근 200개로 잘린 이벤트 배열에서 계산해 오래된 완료 점수를 되돌리지 못한다 / DB와 렌더러가 line 990 및 `database.ts:508`에서 과거 이벤트를 버리지만 `score.total`은 유지하므로, 해당 task 이벤트가 밀려난 뒤 완료 취소→재완료하면 점수가 다시 지급돼 누적이 부풀 수 있다 / 회계용 task별 순점수나 전체 ledger를 별도로 보존하고 200개 제한은 표시용 history에만 적용한다.

[medium] src/main/ipc-handlers.ts:411 — Google 토큰 갱신의 모든 오류가 저장된 refresh token 삭제로 이어진다 / `refreshTokens`는 취소된 토큰의 `invalid_grant`뿐 아니라 네트워크 단절·잘못된 응답·일시적 5xx도 던지므로 잠깐의 장애가 영구 로그아웃과 재인증을 만든다 / `invalid_grant` 같은 확정 거부에서만 토큰을 지우고 retryable 오류에는 기존 자격증명을 유지한 채 backoff와 오류 상태만 저장한다.

[medium] src/renderer/src/store/usePomodoroStore.ts:78 — 포모도로 deadline과 경과 점수 계산이 조정 가능한 `Date.now()` 벽시계에만 의존한다 / 실행 중 시계를 뒤로 돌리면 타이머가 늘어나고 elapsed가 음수가 되어 세션이 기록되지 않으며, 앞으로 돌리면 즉시 완료되어 실제 1분 미만 작업도 정격 세션·점수를 받을 수 있다 / 진행 시간은 단조 시계로 계산하고 벽시계 ISO는 표시용으로만 보관하며 sleep/resume 시 단조 경과를 명시적으로 재조정한다.

[medium] src/main/index.ts:197 — 자동 업데이트 검사 Promise를 시작·매시간 모두 버려 실패가 처리되지 않은 rejection이 된다 / 설치된 `electron-updater`의 `checkForUpdates()`는 네트워크·manifest 오류를 로깅한 뒤 다시 throw하므로 direct 배포 빌드에서 흔한 오프라인 실패가 매시간 unhandled로 누적되고 런타임 정책에 따라 메인 프로세스 종료까지 가능하다 / `void autoUpdater.checkForUpdates().catch(...)`로 종결하고 중복 체크·종료를 관리하는 단일 async 스케줄러를 둔다.

## Low

[low] src/main/index.ts:157 — 리마인더 watermark를 뒤로 간 벽시계 값으로 무조건 갱신해 이미 발송한 알림을 다시 발송한다 / 10:00 알림을 보낸 뒤 시계가 09:59로 보정되면 cursor도 09:59가 되고 10:00을 다시 지날 때 같은 `(from,to]` 구간이 재포함된다 / watermark를 단조 증가시키고 task+reminder occurrence의 발송 id를 짧게 보존해 중복을 제거한다.

[low] src/renderer/src/components/tasks/AttachmentList.tsx:14 — 첨부 메타데이터를 `name|path` 문자열로 합쳐 macOS에서 합법인 `|` 포함 파일명을 파싱하지 못한다 / `foo|bar.pdf`는 첫 구분자 뒤 전부가 path로 읽혀 표시명이 잘리고 `open-attachment`에는 존재하지 않는 경로가 전달된다 / `{name,path}` 구조체를 JSON으로 저장하고 기존 문자열은 명시적 migration으로 변환한다.

[low] src/main/licensing/licenseManager.ts:645 — 서버의 revoked/unknown-key 원인을 토큰 삭제 시 버려 유료 사용자를 체험판 또는 “체험판 종료”로 오표시한다 / `clearLocalLicense(true)` 뒤 public state에는 거절 reason이 없고 `LicenseSection.tsx:226`은 남은 모든 상태를 `trialExpired`로 렌더링해 복구 행동도 안내할 수 없다 / 마지막 권위 거절 reason을 public state에 보존하고 취소·키 없음·기기 한도별 메시지와 재활성화 경로를 렌더링한다.
