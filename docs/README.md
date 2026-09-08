# Greenday 개발자 문서

Electron 40 + React 19 + TypeScript macOS 앱 Greenday 의 개발·릴리스 문서. [Diátaxis](https://diataxis.fr) 네 갈래로 나눴다 — **배우려면 튜토리얼, 일을 끝내려면 하우투, 사실을 찾으려면 레퍼런스, 왜 그런지 알려면 설명.**

모든 문장은 2026-09-08 기준 코드·테스트·스크립트에서 확인한 것만 적었다. 코드가 바뀌면 문서가 낡는다 — 파일 경로와 심벌 이름을 적어 두었으니 의심되면 그 자리를 연다.

## 튜토리얼 — 처음 하는 사람을 위해

| 문서 | 내용 |
|---|---|
| [tutorial-개발-환경에서-활성화까지.md](tutorial-개발-환경에서-활성화까지.md) | clone → 설치 → `npm run dev` 로 창 띄우기 → 데이터가 어디 있는지 → 라이선스 흐름을 개발 환경에서 어디까지 볼 수 있는지 → 테스트 돌리기 |

## 하우투 — 특정 작업을 끝내기 위해

| 문서 | 내용 |
|---|---|
| [howto-태그-릴리스.md](howto-태그-릴리스.md) | 직접 배포(DMG) 릴리스 — 버전 파일, CHANGELOG, 시크릿 7종, 태그 푸시 뒤 워크플로가 하는 일, 검증, Homebrew cask |
| [howto-MAS-빌드와-업로드.md](howto-MAS-빌드와-업로드.md) | `mas:preflight` 6항목, `mas:build`, `mas:upload`/Transporter, 프로파일 교체, entitlements |
| [howto-브리지-빌드.md](howto-브리지-빌드.md) | 옛 번들 ID 마지막 버전 v1.5.0 — `package:bridge`, 서명·공증, Latest 로 올리기, `bump-haru-cask.sh`, 대기 기간과 v2.0.0 순서 |
| [howto-Google-OAuth-클라이언트.md](howto-Google-OAuth-클라이언트.md) | Google Cloud 콘솔에서 데스크톱 클라이언트 만들기, ID 가 들어가는 자리, 루프백 리디렉션, MAS `network.server` |
| [howto-스크린샷-재촬영.md](howto-스크린샷-재촬영.md) | `headless-stub.js` 로 라이트/다크 2880×1800 세트와 사이트용 1440×900 세트 다시 찍기 |
| [howto-i18n-키-추가.md](howto-i18n-키-추가.md) | 렌더러 키(ko/en JSON)와 메인 프로세스 문구(`main-strings.ts`) 추가, 테스트가 잡는 것 |

## 레퍼런스 — 사실을 찾기 위해

| 문서 | 내용 |
|---|---|
| [reference-스크립트와-플래그.md](reference-스크립트와-플래그.md) | 모든 npm 스크립트, 빌드 시점 define·환경변수, electron-builder 설정 키, 워크플로 시크릿 |
| [reference-IPC-채널.md](reference-IPC-채널.md) | 모든 IPC 채널 — 이름·방향·페이로드·반환·무료/유료·담당 모듈 (migration:* 포함) |
| [reference-라이선스.md](reference-라이선스.md) | 엔드포인트, 키 형식, 토큰 검증, `IS_ENFORCED`, 트라이얼·유예, 빌드별 capabilities, 렌더러가 받는 것 |
| [reference-마이그레이션-파일.md](reference-마이그레이션-파일.md) | `migration-state.json`·`keycheck.sentinel`·`backup-before-greenday-2/` 의 경로·형식·원자적 쓰기·보호 모드 |

## 설명 — 왜 그렇게 만들었는지

| 문서 | 내용 |
|---|---|
| [explanation-번들-ID-마이그레이션.md](explanation-번들-ID-마이그레이션.md) | 왜 ID 를 바꿨나, 왜 내부 이름은 그대로인가, Keychain ACL 의 실제, 브리지와 feed 분리, 보호 모드, 트레이드오프와 대안 |
| [explanation-라이선스-게이트와-MAS.md](explanation-라이선스-게이트와-MAS.md) | 왜 게이트가 메인에 있는가, capabilities 모델, MAS 에 enforcement 가 없는 이유(3.1.1), 루프백 OAuth |
| [explanation-로컬-데이터와-safeStorage.md](explanation-로컬-데이터와-safeStorage.md) | JSON 파일 하나를 고른 이유, 저장 잠금과 배수, 백업, safeStorage 암호화, 서버가 없는 이유 |

## 이미 있던 문서

| 문서 | 내용 |
|---|---|
| [2026-09-07-브리지-릴리스.md](2026-09-07-브리지-릴리스.md) | 브리지 v1.5.0 ↔ 새 앱 v2.0.0 의 빌드·배포 순서와 업데이트 feed 분리 (원본 결정 기록) |
| [app-store-submission.md](app-store-submission.md) | App Store Connect 에 붙여 넣을 메타데이터·심사 노트·App Privacy 답안, 제출 체크리스트 |
| [DEPLOYMENT.md](DEPLOYMENT.md) | 2026-07 에 쓴 배포 준비 목록. 일부(자산 이름·`package:mas`·Pages 주소)는 이후 바뀌었다 — 이 문서군의 하우투가 최신이다 |
| [app-store/README.md](app-store/README.md) · [app-store/tools/README.md](app-store/tools/README.md) | 스크린샷 목록과 headless 촬영 도구 |
| [reports/2026-09-07-v1.4.1-shipped-build.md](reports/2026-09-07-v1.4.1-shipped-build.md) | 실제로 배포된 v1.4.1 의 Info.plist·서명 실측 — 번들 ID 결정의 근거 |
| [reports/2026-09-07-bridge-copy.md](reports/2026-09-07-bridge-copy.md) | 브리지·새 앱 첫 실행 문구 전체 (사용자 검토용) |
| [reports/2026-08-28-audit/SUMMARY.md](reports/2026-08-28-audit/SUMMARY.md) | 2026-08 코드베이스 감사 통합 리포트 |
| [design/](design/) · [plans/](plans/) · [proposals/](proposals/) | 기능별 설계·구현 계획·제안 (시간순 파일명) |
| [README.ko.md](README.ko.md) | 사용자용 한국어 README |
| [../TODOS.md](../TODOS.md) · [../CHANGELOG.md](../CHANGELOG.md) | 남은 일과 변경 이력 |

`docs/index.html`·`docs/privacy.html`·`docs/landing/` 은 GitHub Pages 로 나가는 공개 페이지이고 개발 문서가 아니다.
