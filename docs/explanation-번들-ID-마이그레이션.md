# 설명 — 번들 ID 마이그레이션

2026-09-07 에 앱의 번들 ID 를 `com.haru.app` 에서 `com.begreen.greenday` 로 바꿨다. 이 문서는 그 결정과, 그 결정이 끌고 온 것들 — 브리지 릴리스, 업데이트 feed 분리, Keychain 보호 모드 — 이 **왜** 그런 모양인지를 적는다. 절차는 [howto-브리지-빌드.md](howto-브리지-빌드.md), 파일 형식은 [reference-마이그레이션-파일.md](reference-마이그레이션-파일.md), 원본 결정 기록은 [2026-09-07-브리지-릴리스.md](2026-09-07-브리지-릴리스.md).

## 왜 바꿨나 — 어차피 끊겨 있었다

저장소에는 오랫동안 `com.supaicy.haru` 가 적혀 있었다. 그런데 실제로 사용자에게 나간 v1.4.1 의 dmg 를 열어 보니(`docs/reports/2026-09-07-v1.4.1-shipped-build.md`) `CFBundleIdentifier` 는 **`com.haru.app`** 이었고, 서명은 링커가 붙인 ad-hoc 뿐이었다 — Team ID 없음, 서명 식별자 `Electron`, designated requirement 는 cdhash 하나. electron-builder 의 서명 단계가 아예 돌지 않은 채 나간 빌드였다.

이것이 뜻하는 바가 결정의 전부다. macOS 는 번들 ID 가 다른 앱을 다른 앱으로 보고, electron-updater 로 받은 새 버전이 옛 자리에 앉으려면 같은 ID 여야 한다. 그런데 `com.haru.app` 은 Apple 전역에서 이미 선점돼 있어 App ID 로 등록할 수 없었고 — 즉 그 ID 로는 서명·공증도, App Store 도 불가능하다 — `com.supaicy.haru` 는 한 번도 배포된 적이 없어 옛 사용자와 아무 관계가 없다. **어느 ID 로 가든 v1.4.1 사용자와의 자동 업데이트 연속성은 끊긴다.** 그렇다면 이왕이면 브랜드에 맞는 이름으로 간다. 추가 비용이 없었다.

Keychain 쪽도 마찬가지였다. v1.4.1 의 서명이 cdhash 기반이라 같은 ID 로 내더라도 새 바이너리는 옛 ACL 에 없다. ID 를 유지한다고 프롬프트를 피할 수 있는 것이 아니었다.

## 왜 내부 이름 `ticktick` 은 그대로인가

`package.json` 의 `name` 은 `ticktick` 이다. 제품명과 다르고 보기 싫다. 그래도 바꾸지 않는다.

Electron 은 `app.getName()` 으로 두 가지를 정한다. **userData 경로** `~/Library/Application Support/ticktick` 와, Chromium OSCrypt 가 `safeStorage` 의 키를 보관하는 **Keychain 항목 이름** `ticktick Safe Storage`. 이름을 바꾸면 새 앱은 다른 폴더를 보고(데이터가 "사라진다") 다른 Keychain 항목을 찾는다(암호문을 **프롬프트도 없이 조용히** 못 읽는다). 번들 ID 변경은 Keychain **ACL** 에만 영향을 줘서 "깨지는 게 아니라 묻는다" — 그 차이가 결정적이다. 앱 이름과 번들 ID 가 다른 것은 흔하다(Slack 이 `com.tinyspeck.slackmacgap` 인 것처럼).

그래서 마이그레이션은 "옮긴다" 보다 "같은 폴더를 다른 서명의 앱이 이어받는다" 에 가깝고, 위험은 데이터가 아니라 Keychain 한 곳에 있다.

## Keychain 과 safeStorage 의 실제

`safeStorage.encryptString` 은 Keychain 에 보관된 앱별 랜덤 키로 암호화한다. 키는 **이름**으로 찾지만 접근 권한(ACL)은 **서명 주체**로 판단한다. 새 서명의 앱이 그 항목을 열려 하면 macOS 가 사용자에게 묻는다: 허용 / 항상 허용 / 거부. 거부하면 `decryptString` 이 던진다.

문제는 그 다음이다. 세 저장소(`ai-config.json`, `calendar-config.json`, `google-config.json`)는 복호화 실패를 "비밀 없음" 으로 읽는다. 여기까지는 괜찮다. 그런데 그 상태에서 설정을 **한 번이라도 저장**하면 `*_enc` 칸이 `null` 로 덮여 원본 암호문이 사라진다. 사용자가 나중에 Keychain 을 허용해도 돌아올 것이 없다. 이 경로가 보호 모드가 존재하는 이유다(아래).

한 가지 다행: v1.4.1 코드는 `safeStorage` 를 부르지 않았다. OSCrypt 는 첫 encrypt/decrypt 때 Keychain 키를 만들므로, v1.4.1 만 쓴 사용자에게는 `ticktick Safe Storage` 항목 자체가 없다. 새 앱이 새 키를 만들고 끝이다. 복호화할 옛 암호문이 없으니 프롬프트도 없다. safeStorage 위험은 2.0.0 이후 빌드를 로컬에서 써 온 개발자 본인의 맥에 국한된다. 그래서 새 앱의 첫 실행은 **재 볼 것이 있을 때만**(브리지 표식이 있거나 암호문이 있을 때) Keychain 안내를 띄운다.

## 왜 브리지 릴리스인가

v1.4.1 사용자는 자동 업데이트로 새 앱을 받을 수 없다. 그렇다고 아무 말 없이 새 앱을 사이트에만 올려 두면, 옛 앱은 영원히 v1.4.1 이고 사용자는 새 버전이 있는 줄 모른다.

브리지 v1.5.0 은 **옛 ID 로 나가는 마지막 버전**이다. 옛 앱이 자동 업데이트로 받을 수 있는 유일한 것이고, 받아서 하는 일은 공지가 아니라 **새 앱이 안전하게 이어받을 조건을 만드는 것**이다: 데이터 파일 무결성 판정, 전환 전 백업(`backup-before-greenday-2/`, 원자적, 있으면 절대 덮지 않는다), 암호화 sentinel(`keycheck.sentinel`), 그리고 상태 파일. 그 뒤에야 "새 Greenday 를 받으세요" 안내를 띄운다. 평문 handoff 파일은 만들지 않는다 — 백업·Spotlight·크래시 수집에 노출되기 때문이다. 새 앱에 넘기는 것은 버전·시각·경로가 든 상태 파일과 암호화된 sentinel 뿐이다.

sentinel 이 핵심 장치다. `'keycheck-v1'` 을 브리지의 키로 암호화해 둔 파일이라, 새 앱은 **실제 비밀값을 건드리지 않고** "지금 이 앱이 옛 앱과 같은 키로 복호화할 수 있는가" 를 먼저 잴 수 있다. 값 자체는 비밀이 아니다.

브리지는 `capabilities.isBridge` 로 자체 업데이트를 끈다. 다음 버전은 다른 앱이다 — 업데이터가 받아 덮어쓰면 macOS 가 다른 앱으로 보는 파일이 옛 자리에 앉는다.

## 왜 업데이트 feed 를 나누나

브리지가 "옛 앱이 받는 마지막 것" 이려면 새 앱 릴리스가 옛 앱에 **닿지 않아야** 한다. electron-updater(GitHub provider)는 저장소의 Latest 릴리스에서 `<channel>-mac.yml` 을 읽고, 채널이 없으면 `latest`, 파일이 없으면 업데이트를 제안하지 않는다. 그래서 새 앱은 `publish.channel: greenday` 로 `greenday-mac.yml` 을 만들고, 브리지는 `channel: latest` 로 `latest-mac.yml` 을 만든다. v2.0.0 이 Latest 가 돼도 거기엔 `latest-mac.yml` 이 없으므로 옛 앱은 아무것도 받지 않는다. 다른 번들 ID 의 앱이 옛 자리에 앉는 사고가 **구조적으로** 없다. 업데이터 캐시 디렉터리(`greenday-updater` vs `ticktick-updater`)도 같은 이유로 나눴다 — 전환 기간에 두 앱이 나란히 깔리면 서로의 내려받은 파일을 덮어쓴다.

feed 분리가 막지 못하는 것이 하나 있다. v2.0.0 이 Latest 가 된 **뒤**에 처음 업데이트를 확인하는 v1.4.1 사용자는 브리지도 못 받는다(Latest 에 `latest-mac.yml` 이 없으므로). 그래서 브리지와 v2.0.0 사이에 2~4주 대기가 있다. 이 대기를 없애는 방법은 새 앱 릴리스를 별도 저장소(예: `greenday-releases`)로 보내 `supaicy/greenDay` 의 Latest 를 영원히 v1.5.0 으로 두는 것이다 — BicMac 이 이미 쓰는 방식이다. 채택하지 않은 이유는 저장소를 새로 만드는 것이 사람 몫이고 사이트 주소·README·워크플로 세 곳이 같이 바뀌기 때문이다. 채널 분리만으로도 "옛 앱이 새 앱을 받는" 사고는 막히므로, 남는 것은 laggard 문제 하나이고 그건 대기로 다룬다.

## 보호 모드 — 실수를 막지 결정을 뒤집지 않는다

새 앱 첫 실행에서 sentinel 이 `ok` 가 아니면(거부·잠김·항목 없음·다른 키·손상) `secrets-gate` 를 잠근다. 잠긴 동안 세 writer 는 저장 직전에 **파일에 있던 암호문을 되살린다.** 비밀을 못 읽은 채 설정을 저장해도 원본이 사라지지 않는다. 사용자가 나중에 "항상 허용" 을 누르고 다시 열면 다음 실행이 sentinel 을 다시 재고 그대로 복호화된다.

두 가지는 일부러 막지 않는다. 새 값을 넣는 저장(값이 있는 저장)은 사용자의 명시적 선택이라 그대로 쓴다. 연결 해제(`clearSecret`)도 마찬가지다 — 잠겼다고 저장된 자격증명을 못 지우게 하면 보호가 인질이 된다. 보호 모드는 실수를 막는 것이지 결정을 뒤집는 것이 아니다.

해제는 자동으로 하지 않는다. 배너의 "다시 연결했습니다 — 보호 해제" 가 지금 키로 새 sentinel 을 심고 여는 유일한 명시적 경로다. 자동으로 풀면 새 키로 만든 sentinel 이 옛 암호문을 "검증" 하는 척하게 된다.

첫 실행 시퀀스 전체는 `holdSaves()` 로 디스크 쓰기를 붙든 채 돈다. IPC 핸들러가 아직 등록되지 않은 시점이라 렌더러의 mutation 이 끼어들 길도 없고, `finally` 에서 `releaseSaves()` 하므로 중간에 던져도 앱이 영영 저장을 못 하게 되지는 않는다. 첫 버전은 **DB 스키마를 바꾸지 않는다** — `arrival.ts` 는 `ticktick-data.json` 을 읽지도 쓰지도 않는다(테스트가 바이트 동일성을 본다). 옛 앱으로 되돌아가는 길이 언제나 열려 있다.

## 트레이드오프

- **사용자는 한 번 직접 받아야 한다.** 피할 수 없다 — ad-hoc 서명·선점된 ID 라는 출발점이 그렇다. 브리지의 일은 그 한 번을 안전하고 설명된 것으로 만드는 것이다.
- **Keychain 프롬프트가 한 번 뜬다**(암호문이 있는 설치에서). 뜨기 전에 왜 뜨는지 말한다(`keychainNotice*`) — 설명 없이 뜨면 사람들은 "거부" 를 누른다.
- **대기 기간**이 생긴다. 별도 릴리스 저장소로 없앨 수 있고, 그 결정은 열려 있다.
- **MAS 판은 별개다.** 샌드박스 컨테이너라 기존 데이터를 못 읽는다. 신규 사용자용으로 취급한다.
- **옛 Homebrew cask** 는 워크플로가 건드리지 않는다. `scripts/bump-haru-cask.sh` 로 한 번 갱신하고 caveats 로 새 cask 를 안내한다.

## 관련 코드

`src/shared/app-id.ts`(두 ID 와 브리지 버전의 단일 출처), `src/main/capabilities.ts`(`isBridgeBuild`, `currentBundleId`), `src/main/migration/`(bridge·arrival·handoff·secrets-gate·boot), `electron-builder.bridge.cjs`, `src/renderer/src/components/migration/`(BridgeNotice·MigrationBanner). 문구 원본은 `docs/reports/2026-09-07-bridge-copy.md`.
