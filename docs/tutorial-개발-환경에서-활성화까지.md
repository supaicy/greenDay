# 튜토리얼 — 개발 환경에서 활성화까지

처음 이 저장소를 받은 사람이 **창을 띄우고, 데이터가 어디 있는지 보고, 라이선스 흐름이 개발 환경에서 어디까지 보이는지 확인하고, 테스트를 돌리는** 데까지 간다. 30분 안팎.

아래 명령은 전부 2026-09-08 에 macOS 에서 실제로 돌려 본 것이다(그때는 Node 20 기준). 지금은 **Node 22.12 이상**이 필요하다 — electron 41 의 `engines` 가 그렇고, 릴리스 워크플로는 `node-version: 24` 를 쓴다.

## 1. 받고 설치하기

```bash
git clone https://github.com/supaicy/greenDay.git
cd greenDay
npm ci          # package-lock.json 그대로. npm install 도 된다
```

저장소의 정식 이름은 `supaicy/greenDay` 다(옛 이름 `haru` 는 GitHub 이 리디렉션한다). 트렁크 브랜치는 `supaicy/coordinate` 이고 `main` 은 거기서 fast-forward 로만 따라간다(`TODOS.md` 맨 위 "트렁크 결정").

`package.json` 의 `name` 은 **`ticktick`** 이다. 제품명과 다르지만 일부러 그대로 둔 것이다 — Keychain 항목 `ticktick Safe Storage` 와 데이터 폴더 이름이 이 값을 따른다. 바꾸지 말 것(→ [explanation-번들-ID-마이그레이션.md](explanation-번들-ID-마이그레이션.md)).

## 2. 개발 모드로 띄우기

```bash
npm run dev
```

`electron-vite dev` 가 main·preload 를 빌드하고 렌더러 dev 서버(`http://localhost:5173`)를 띄운 뒤 Electron 을 실행한다. 20~30초 안에 **"Greenday" 제목의 1200×800 창**이 뜬다(`src/main/main-window.ts` 의 `createWindow`).

실제 데이터 폴더를 건드리고 싶지 않으면 — 처음이라면 이쪽을 권한다 — Electron 에 격리된 데이터 폴더를 준다:

```bash
npm run dev -- --user-data-dir=/tmp/greenday-dev
```

이 형태는 `docs/app-store/README.md` 의 스크린샷 촬영 절차가 쓰는 것과 같다. 위 명령으로 실제로 창이 떴고, 아래 3절의 파일들이 `/tmp/greenday-dev` 아래 생겼다.

끝낼 때는 터미널에서 `Ctrl+C`. Electron 프로세스가 남아 있으면 `pkill -f "user-data-dir=/tmp/greenday-dev"`.

> 처음 뜰 때 오른쪽 아래에 "옛 haru 앱은 지워도 됩니다" 배너가 보일 수 있다. `/Applications/haru.app` 이 있는 맥에서 새 번들 ID 첫 실행 시퀀스가 도는 것이다(→ 3절). 개발 중에는 "알겠어요"로 닫으면 된다.

## 3. 데이터가 어디 있는지

메인 프로세스는 `app.getPath('userData')` 아래에 파일을 둔다(`src/main/database.ts` 의 `initDatabase`). 기본값은

```
~/Library/Application Support/ticktick/
```

이고, `--user-data-dir` 를 줬으면 그 폴더다. 격리 폴더로 한 번 띄우고 나면 이런 것이 생긴다(실측):

| 파일/폴더 | 무엇 | 만든 곳 |
|---|---|---|
| `ticktick-data.json` | 할일·목록·습관·포모도로·점수 전부. JSON 객체 하나 | `database.ts` |
| `ticktick-data.json.bak` | 직전 정상본. 저장마다 rename 으로 회전 | `database.ts` `rotateBackup` |
| `attachments/` | 첨부 파일 사본 | `database.ts` |
| `migration-state.json` | 새 번들 ID 첫 실행 기록 (`arrival.completedAt` 등) | `src/main/migration/` |
| `keycheck.sentinel` | safeStorage 키 확인용 암호문 | `src/main/migration/handoff.ts` |
| `backup-before-greenday-2/` | 전환 전 백업 (`manifest.json` + 데이터 파일 사본) | `src/main/migration/handoff.ts` |

빈 설치의 `ticktick-data.json` 은 이렇게 생겼다:

```json
{"lists":[{"id":"inbox","name":"기본함","color":"#4A90D9","icon":"inbox","folder_id":null,"sort_order":0,"created_at":"…"}],
 "tasks":[],"habits":[],"habitLogs":[],"folders":[],"pomodoroSessions":[],"score":{"total":0,"events":[],"taskNet":{}}}
```

설정 파일은 따로다 — `ai-config.json`(AI 키는 `apiKey_enc` 로 암호화), `calendar-config.json`(`password_enc`), `google-config.json`(`tokens_enc`), `license.json`, `device-id`. 이들은 해당 기능을 처음 쓸 때 생긴다. 참조가 사라진 첨부가 생기면 `attachments-quarantine/` 도 생긴다 — 첨부를 지우지 않고 여기 옮겨 두었다가 30일 뒤 다음 정리가 지운다. 그 안의 파일을 원래 이름 그대로 `attachments/` 로 옮기면 되살아난다(`database.ts` `gcAttachments`). 비밀값은 전부 `safeStorage` 로 암호화된 채 저장된다(→ [explanation-로컬-데이터와-safeStorage.md](explanation-로컬-데이터와-safeStorage.md)). 각 파일의 형식은 [reference-마이그레이션-파일.md](reference-마이그레이션-파일.md) 에 있다.

할일을 하나 만들어 보고 `ticktick-data.json` 을 다시 열면 300ms 디바운스 뒤에 반영돼 있다(`SAVE_DEBOUNCE_MS`).

## 4. 라이선스 흐름 — 개발 환경에서 보이는 것과 안 보이는 것

먼저 사실부터. **오늘 출하되는 앱은 아무것도 잠그지 않는다.** `src/main/licensing/service.ts` 의 `IS_ENFORCED = false` 다. 그리고 개발 빌드는 그 값과 무관하게 잠글 수 없다 — `capabilitiesFor()`(`src/shared/capabilities.ts`)가 `enforcesLicense: !facts.isDevBuild && !isStoreBuild` 로 계산하고, `npm run dev` 는 `__IS_DEV_BUILD__ = true` 로 빌드되기 때문이다(`electron.vite.config.ts`: `NODE_ENV !== 'production'`). `IS_ENFORCED` 를 `true` 로 바꿔도 `npm run dev` 에서는 트라이얼이 시작되지 않는다. 이건 버그가 아니라 설계다: enforcement 를 켜는 날 개발 환경이 30일 뒤 스스로 잠기지 않게 하려는 것이다(`capabilities.ts` 의 `enforcesLicense` 주석).

그래서 개발 환경에서 **볼 수 있는 것**은:

1. **설정 → 라이선스 칸.** `needsLicenseKey` 는 개발 빌드에서도 `true` 라 `LicenseSection`(`src/renderer/src/components/sidebar/LicenseSection.tsx`)이 그려진다. 상태는 `unlicensed`, `enforced: false` 로 온다.
2. **키 형식 검사.** `GREENDAY-XXXX-XXXX-XXXX-XXXX`(`src/main/licensing/licenseKey.ts`, I·L·O·U·0·1 없음) 가 아니면 서버에 가기 전에 `invalidKey` 로 떨어진다. 아무 문자열이나 넣어 보면 그 문구가 뜬다.
3. **실제 서버 호출.** 형식이 맞는 키를 넣으면 `https://pay.begreen.dev/v1/activate` 로 간다. 주소는 `src/main/licensing/endpoints.ts` 의 `LICENSE_BASE_URL` 리터럴이고 **환경변수로 바꿀 수 없다** — `endpoints.test.ts` 가 그 값을 못 박는다. 로컬 결제 서버(`../bicmac-license`, wrangler dev)로 보내려면 그 상수를 임시로 고쳐야 하고, 그러면 그 테스트 하나가 실패한다. 고친 채로 커밋하지 말 것.
4. **성공하면** `license.json` 에 키와 서명된 토큰이 저장되고 설정에 `GREENDAY-••••-••••-••••-XXXX` 가 뜬다. 기기 해제도 같은 화면에서 된다.

**볼 수 없는 것**은 잠금 화면(`LicenseGate`)이다. `enforced` 가 `false` 인 동안 그 컴포넌트는 `null` 을 그린다. 잠금 화면을 실제로 보려면 프로덕션 빌드(`npm run build` → `NODE_ENV=production` → `__IS_DEV_BUILD__ = false`)에 `IS_ENFORCED = true` 를 넣어야 하고, 그 조합은 이 저장소의 어떤 스크립트도 만들어 주지 않는다. 로직 자체는 테스트로 본다:

```bash
npx vitest run src/main/licensing src/renderer/src/licensing
```

`licenseManager.test.ts`(1,550줄)가 가짜 클라이언트와 진짜 ed25519 키쌍(`testTokens.ts`)으로 활성화·재검증·유예·시계 조작을 전부 시뮬레이션한다. `LicenseGate.test.tsx` 가 잠금 화면을 `enforced: true` 로 강제해서 그린다. 코드로 보이는 상태 흐름은 [reference-라이선스.md](reference-라이선스.md), 왜 이렇게 나눴는지는 [explanation-라이선스-게이트와-MAS.md](explanation-라이선스-게이트와-MAS.md).

## 5. 테스트·타입·린트

```bash
npx vitest run        # = npm test
npm run typecheck     # tsc --build (tsconfig.node.json + tsconfig.web.json)
npm run lint          # biome lint src electron.vite.config.ts
npm run verify        # 위 셋을 한 번에 — 릴리스 경로(release.sh·release.yml·mas:build)가 부르는 것
```

2026-09-08 `ebf40d6` 에서의 결과:

```
Test Files  78 passed (78)
     Tests  1441 passed (1441)
  Duration  5.26s
```

`typecheck` 는 출력 없이 종료 코드 0. `lint` 는 `Checked 209 files … Found 8 warnings. Found 4 infos.` — 에러 0. 경고는 전부 테스트 파일의 `useTemplate`·`noNonNullAssertion` 과 `useImportType` 둘이다.

테스트는 `src/**/*.test.{ts,tsx}` 만 본다(`vitest.config.ts`). `tsc --build` 가 `out/` 에 뱉는 `.test.js` 는 제외돼 있고, 시간대는 `Asia/Seoul` 로 고정된다 — 날짜 테스트가 UTC 머신에서 거짓 통과하지 않게. 시간대에 민감한 파일(`TZ_SENSITIVE`)은 `west` 프로젝트가 `America/New_York` 에서 한 번 더 돌린다 — 양수 오프셋만으로는 "쓸 때 로컬 / 읽을 때 UTC" 비대칭이 가려진다.

메인 프로세스 모듈 대부분은 electron 을 import 하지 않는 순수 모듈이라(`licensing/*`, `migration/{bridge,arrival,handoff,secrets-gate}`, `shared/*`) 그냥 node 에서 돈다. electron 이 필요한 건 `service.ts`·`ipc-gate.test.ts` 정도이고 그쪽은 `vi.mock('electron')` 을 쓴다.

## 6. 다음에 읽을 것

- 무엇을 어떻게 빌드하는지 한눈에: [reference-스크립트와-플래그.md](reference-스크립트와-플래그.md)
- 렌더러가 메인에 부탁할 수 있는 것 전부: [reference-IPC-채널.md](reference-IPC-채널.md)
- 번역 문구를 하나 추가하려면: [howto-i18n-키-추가.md](howto-i18n-키-추가.md)
- 릴리스를 내려면: [howto-태그-릴리스.md](howto-태그-릴리스.md)
