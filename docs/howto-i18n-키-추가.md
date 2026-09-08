# 하우투 — 번역 키 추가하기

사용자에게 보이는 문구는 두 곳에 산다. **렌더러** 문구는 i18next 로케일 JSON(`src/renderer/src/i18n/locales/{ko,en}.json`), **메인 프로세스**가 직접 띄우는 몇 안 되는 문구(시스템 알림·오류 대화상자·앱 메뉴·Keychain 안내)는 `src/shared/main-strings.ts` 다. 두 자리를 지키는 테스트가 각각 있어서, 빠뜨리면 `npx vitest run` 이 잡는다.

## 렌더러 키 추가

### 1. 두 JSON 에 같은 경로로 넣는다

키는 중첩 객체이고 코드에서 점 경로로 부른다. 최상위 그룹은 `common, date, nav, views, priority, task, detail, batch, reminder, recurring, sort, trash, calendar, kanban, timeline, eisenhower, habits, pomodoro, stats, undo, ai, quickDate, settings, shortcuts, calendarSync, googleSync, license, migration` 의 28개(2026-09-08 기준). 새 기능은 대개 기존 그룹에 들어간다.

```jsonc
// ko.json
"settings": {
  "exportFolderHint": "내보낸 파일은 선택한 폴더에 저장됩니다."
}
// en.json
"settings": {
  "exportFolderHint": "Exported files are saved to the folder you choose."
}
```

보간은 `{{name}}`. **양쪽의 보간 변수 집합이 같아야 한다** — 테스트가 비교한다.

영어 복수형은 i18next 규칙대로 `_one`/`_other` 두 키다. 한국어는 한 형태만 쓴다:

```jsonc
// en.json
"count_one": "{{count}} task",
"count_other": "{{count}} tasks"
// ko.json
"count": "{{count}}개"
```

이 경우 ko 에는 `task.count`, en 에는 `task.count_one`/`task.count_other` 가 있어 키 집합이 달라 보이지만, 아래 테스트가 `key_one`/`key_other` 를 인정한다.

배열 리소스(요일·월 이름·레벨 이름 등)는 `tList('date.months')` 로 꺼내고 **길이가 같아야 한다.**

### 2. 코드에서 부른다

```tsx
const { t } = useTranslation()
t('settings.exportFolderHint')
```

키를 **리터럴로** 적으면 테스트가 존재를 확인한다. `t(\`license.error.${code}\`)` 같은 템플릿 리터럴은 정적으로 알 수 없어 그 검사를 지나친다 — 그런 키 집합은 따로 못 박는다(아래 라이선스 문구 절).

### 3. 테스트가 잡는 것 — `src/renderer/src/i18n/locales.test.ts`

| 검사 | 실패하는 경우 |
|---|---|
| **ko 와 en 의 키 집합이 완전히 같다** | 한쪽에만 넣었다 |
| 같은 키의 `{{보간}}` 변수가 두 언어에서 일치 | `{{count}}` 를 한쪽에서 빠뜨렸다 |
| 배열 리소스 길이가 같다 | 월 이름을 12개 vs 11개 |
| 소스에서 리터럴로 참조하는 키가 전부 로케일에 있다 | 코드에 `t('settings.newKey')` 를 썼는데 JSON 에 없다. `_one`/`_other` 복수형은 인정 |
| 조합 문구 회귀 (주간 캘린더 헤더 "2026년 7월월" 등) | 템플릿과 토큰이 접미사를 이중으로 붙인다 |
| **라이선스 실패 코드 문구** — `ActivateFailure`·`DeactivateFailure` 유니온의 모든 코드가 `license.error.<code>` 로 ko·en 양쪽에 있고, 쓰지 않는 코드의 문구가 남아 있지 않다 | `shared/license.ts` 에 코드를 추가하고 문구를 안 넣었다 → **타입 에러**(`Record<ActivateFailure, true>`) + 테스트 실패 |

현재 두 파일 모두 평평하게 세면 **490개** 키다(`node` 로 세어 본 값). 테스트는 개수가 아니라 **동일성**을 본다 — 숫자는 바뀌어도 되고, 갈라지면 안 된다.

### 4. 확인

```bash
npx vitest run src/renderer/src/i18n
```

## 메인 프로세스 문구 추가

메인에서는 i18next 를 쓸 수 없다. `src/shared/main-strings.ts` 의 `MainStrings` 인터페이스에 필드를 추가하고 `STRINGS.ko`·`STRINGS.en` 양쪽에 값을 넣는다 — `Record<MainLanguage, MainStrings>` 타입이라 한쪽을 빠뜨리면 `npm run typecheck` 가 실패한다.

```ts
interface MainStrings {
  // …
  /** 무엇에 쓰는 문구인지 한 줄. */
  backupFailedTitle: string
}
```

읽을 때는 `src/main/ui-language.ts` 의 `uiStrings()` 를 쓴다. 렌더러가 언어를 바꾸면 `set-language` IPC 로 메인에 알리고(`app-ipc.ts`), 그 값으로 이 표를 고른다. 언어가 실제로 바뀐 때만 앱 메뉴를 다시 짓는다.

오늘 여기 있는 문구: 리마인더 알림 제목, 알림 권한 확인용 배너, 앱 메뉴 "보기", 데이터 파일 읽기 실패 대화상자, 새 번들 ID 첫 실행의 Keychain 안내. 렌더러가 그릴 수 있는 것은 여기 넣지 않는다 — 창이 뜨기 전에 띄워야 하거나 OS 알림처럼 렌더러 밖에 있는 것만이다.

## 브리지·마이그레이션 문구를 고칠 때

`migration.bridge.*`·`migration.arrival.*`(렌더러)와 `keychainNotice*`(메인)는 사용자 검토용 원문이 `docs/reports/2026-09-07-bridge-copy.md` 에 있다. **세 자리를 같이 고친다** — 그 문서가 맨 위에 그렇게 적어 두었다.
