# 브리지 릴리스 문구 — 사용자 검토용

v1.5.0(옛 번들 ID `com.haru.app`의 마지막 버전)과 v2.0.0(새 번들 ID 첫 버전)이 사용자에게
보여 주는 문구 전부. 코드의 원본은 `src/renderer/src/i18n/locales/{ko,en}.json`의 `migration`
블록과 `src/shared/main-strings.ts`(Keychain 안내)이며, **여기 문구를 고치면 그 두 파일도
같이 고친다.** 톤 기준: 따뜻하고 솔직하게, 과장 없이. 무엇이 바뀌고 무엇이 안 바뀌는지를
먼저 말하고, 사용자가 해야 할 일은 하나(받기)뿐이라는 것을 분명히 한다.

---

## 1. 브리지 안내 화면 (v1.5.0, 앱 안 모달)

첫 실행에 뜬다. "나중에"를 누르면 3일 뒤 다시 뜨고, 설정 → 버전에서 언제든 다시 열 수 있다.
버튼은 둘 — **새 Greenday 받기**(https://begreen.dev/greenday 를 브라우저로), **나중에**.

### 한국어

**제목**
> Greenday가 새 앱으로 옮겨갑니다

**본문 1 — 무슨 일인가**
> 이 버전(1.5.0)은 지금 쓰시는 앱의 마지막 업데이트입니다. 다음 버전부터는 새 이름표(번들 ID)를 단 새 앱으로 나갑니다 — macOS가 두 앱을 다른 앱으로 보기 때문에, 자동 업데이트로는 이어지지 않아 직접 한 번 받아 주셔야 합니다.

**본문 2 — 무엇이 이어지는가**
> 새 앱을 설치하면 할 일·목록·습관·설정·캘린더 연동이 그대로 이어집니다. 같은 폴더의 같은 데이터를 읽습니다.

**본문 3 — 백업 (셋 중 하나가 뜬다)**
- 백업이 됐을 때:
  > 옮기기 전에 이 앱이 지금 데이터의 사본을 만들어 두었습니다 (backup-before-greenday-2). 무슨 일이 있어도 되돌릴 수 있습니다.
- 백업을 못 만들었을 때:
  > 데이터 사본을 아직 만들지 못했습니다. 새 앱을 받기 전에 설정 → 데이터 내보내기로 한 번 저장해 두시길 권합니다.
- 데이터 파일이 손상돼 있을 때:
  > 저장된 데이터 파일 하나가 손상돼 있습니다. 새 앱은 백업본(.bak)에서 복구를 시도하지만, 그 전에 설정 → 데이터 내보내기로 사본을 남겨 두세요.

**본문 4 — Keychain 예고 (sentinel이 만들어졌을 때만)**
> 새 앱을 처음 열 때 macOS가 키체인 접근을 한 번 물어봅니다. "항상 허용"을 누르시면 AI 키·앱 암호·Google 연결이 그대로 넘어갑니다.

**버튼**
> 새 Greenday 받기 · 나중에

**"나중에" 툴팁**
> 며칠 뒤 다시 알려드립니다. 설정 → 버전에서 언제든 다시 열 수 있습니다.

**설정 → 버전 줄**
> 이 버전은 마지막 업데이트입니다 — 새 앱으로 옮겨가세요. · [안내 다시 보기]

### English

**Title**
> Greenday is moving to a new app

**Body 1 — what's happening**
> This version (1.5.0) is the last update for the app you're using. From the next version on, Greenday ships as a new app with a new identifier (bundle ID). macOS treats the two as different apps, so it can't arrive as an automatic update — you'll need to download it once.

**Body 2 — what carries over**
> Installing the new app keeps your tasks, lists, habits, settings and calendar connections. It reads the same data from the same folder.

**Body 3 — backup (one of three)**
- Backup done:
  > Before anything moves, this app has made a copy of your current data (backup-before-greenday-2). Whatever happens, you can go back.
- Backup could not be made:
  > A data copy could not be made yet. Before downloading, we recommend Settings → Export data once.
- Data file damaged:
  > One of your saved data files is damaged. The new app will try to recover from the backup (.bak), but please save a copy first via Settings → Export data.

**Body 4 — Keychain heads-up (only when the sentinel exists)**
> The first time you open the new app, macOS will ask once for Keychain access. Choose "Always Allow" and your AI key, app password and Google connection carry over.

**Buttons**
> Get the new Greenday · Later

**"Later" tooltip**
> We'll remind you in a few days. You can reopen this anytime from Settings → Version.

**Settings → Version row**
> This version is the last update — please move to the new app. · [Show the notice again]

---

## 2. 새 앱 첫 실행 — Keychain 안내 (v2.0.0, macOS 대화상자, 창이 뜨기 전에)

sentinel을 열기 **전에** 띄운다. 브리지 표식이 있거나 저장된 암호문이 있을 때만이다 —
v1.4.1에서 바로 온 사용자(암호문 없음)에게는 뜨지 않는다.

### 한국어
**제목** 잠시 후 macOS가 키체인 접근을 물어봅니다
**본문**
> Greenday가 새 앱으로 바뀌어 처음 실행됐습니다. 예전 앱이 키체인에 보관해 둔 AI 키·캘린더 앱 암호·Google 연결을 그대로 이어받으려면 "항상 허용"을 눌러 주세요.
>
> 거부해도 할 일과 설정은 그대로입니다 — 그 경우 연동만 다시 연결하면 되고, 저장돼 있던 값은 지우지 않고 남겨 둡니다.

**버튼** 확인

### English
**Title** macOS is about to ask for Keychain access
**Body**
> This is the first launch of the new Greenday app. To carry over the AI key, calendar app password and Google connection the previous app kept in your Keychain, choose "Always Allow".
>
> If you deny, your tasks and settings are unaffected — you would only need to reconnect those integrations, and the stored values are kept, not deleted.

**Button** OK

---

## 3. 새 앱 상태 배너 (v2.0.0, 오른쪽 아래, 해당하는 것만)

### 3-1. 보호 모드 (Keychain 거부·잠김·항목 없음)

**ko**
> **저장된 연동 정보를 아직 읽지 못했습니다**
> 키체인 접근이 허용되지 않아 AI 키·캘린더 앱 암호·Google 연결을 읽을 수 없습니다. 저장돼 있던 값은 지우지 않고 그대로 두었습니다 — 앱을 다시 열어 "항상 허용"을 누르면 그대로 돌아옵니다. 지금 바로 쓰시려면 설정에서 다시 연결하세요.
> [설정 열기] [다시 연결했습니다 — 보호 해제]

표식 없이 암호문만 있을 때(2.0.x 개발 빌드를 쓰던 맥)는 본문이 이것으로 바뀐다:
> 예전 앱이 남긴 확인용 표식이 없어, 저장된 연동 정보가 이 앱에서 읽히는지 확인할 수 없습니다. 값은 그대로 두었습니다. 설정에서 다시 연결하시거나, 이미 확인하셨다면 아래에서 보호를 해제하세요.

**en**
> **Stored connection details couldn't be read yet**
> Keychain access wasn't granted, so the AI key, calendar app password and Google connection can't be read. Nothing stored has been deleted — reopen the app and choose "Always Allow" and they come back. To use them right now, reconnect in Settings.
> [Open Settings] [I've reconnected — release protection]

No-marker variant:
> The previous app left no verification marker, so we can't tell whether the stored connection details are readable here. They have been left untouched. Reconnect in Settings, or if you've already checked, release the protection below.

### 3-2. Google 재연결

**ko**
> **Google 캘린더를 다시 연결해 주세요**
> 새 앱에서 Google 연결을 한 번 다시 해야 합니다. 이미 올라간 일정은 그대로 있습니다.
> [알겠어요] [설정 열기]

**en**
> **Please reconnect Google Calendar**
> The new app needs a fresh Google sign-in once. Events already published are unaffected.
> [Got it] [Open Settings]

### 3-3. 옛 앱 제거 (정상 확인 뒤에만)

**ko**
> **옛 haru 앱은 지워도 됩니다**
> 새 Greenday가 데이터를 정상적으로 읽었습니다. 응용 프로그램 폴더의 haru.app는 이제 필요 없습니다.
> [알겠어요]

**en**
> **The old haru app can be removed**
> The new Greenday read your data successfully. haru.app in your Applications folder is no longer needed.
> [Got it]

---

## 검토하실 때 봐 주실 것

1. "번들 ID"라는 말을 사용자에게 보여도 되는가 — 괄호로 한 번만 쓴다. 빼면 "왜 자동으로 안 되나"에 답이 없다.
2. "항상 허용" 안내가 macOS 프롬프트의 실제 버튼 이름(Always Allow / 항상 허용)과 같은지 — 실제 서명 빌드로 확인한다(docs/27 4단계 매트릭스).
3. 백업 폴더 이름(`backup-before-greenday-2`)을 화면에 노출하는 것 — 되돌릴 방법이 있다는 것을 구체적으로 말하려고 넣었다.
4. 새 앱의 다운로드 주소는 `https://begreen.dev/greenday` 하나다. 릴리스 페이지가 아니라 사이트로 보낸다.
