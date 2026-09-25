#!/usr/bin/env bash
# Mac App Store 빌드 전 점검.
#
# 여기서 걸러 내려는 것: 빌드는 성공하는데 업로드나 심사에서야 터지는 문제들.
# 특히 프로비저닝 프로파일이 다른 앱 것이면 빌드는 멀쩡히 끝나고 업로드에서 거절된다.
#
# 사용:  npm run mas:preflight
set -uo pipefail

# 번들 ID는 어디에도 하드코딩하지 않는다. electron-builder.yml 을 권위로 삼고,
# 소스(src/shared/app-id.ts)가 같은 값을 쓰는지 아래에서 대조한다.
BUNDLE_ID="$(awk -F': *' '/^appId:/{print $2; exit}' electron-builder.yml)"
if [ -z "$BUNDLE_ID" ]; then
  echo "ERROR: electron-builder.yml 에서 appId를 읽지 못했습니다." >&2
  exit 1
fi
echo "번들 ID: $BUNDLE_ID"
echo
PROFILE="${MAS_PROVISIONING_PROFILE:-resources/embedded.provisionprofile}"
fail=0

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; fail=1; }
note() { printf '    %s\n' "$1"; }

echo "── 1/6  인증서"

# App Store 배포용 인증서는 Developer ID(직접 배포용)와 완전히 다른 종류다.
if security find-identity -v -p codesigning | grep -qE "3rd Party Mac Developer Application|Apple Distribution"; then
  ok "앱 서명 인증서 있음 (Apple Distribution 또는 3rd Party Mac Developer Application)"
else
  bad "앱 서명 인증서 없음"
  note "developer.apple.com → Certificates → 'Apple Distribution' 발급 후 이 맥에 설치"
  note "(Developer ID Application 인증서로는 App Store에 올릴 수 없습니다)"
fi

# 여기서만은 'Apple Distribution' 을 받지 않는다. 그건 **앱** 서명 인증서고, .pkg 를
# flatten 하는 설치 인증서는 따로다 — electron-builder 는 이름으로 정확히
# '3rd Party Mac Developer Installer:' 만 찾는다(app-builder-lib 의 macPackager → findIdentity).
# 대안(|)을 하나 더 열어 두면 앱 인증서만 깔린 맥에서 이 줄이 초록으로 통과하고,
# 유니버설 빌드를 두 아키텍처 다 돌린 **뒤에야**
# 'Cannot find valid "3rd Party Mac Developer Installer" identity' 로 터진다.
# 프리플라이트가 막으려던 낭비가 정확히 그것이다. (src/main/masPreflight.test.ts 가 못박는다)
# (29행의 앱 인증서 검사는 반대로 둘 다 정당하다 — 'Apple Distribution' 이
#  '3rd Party Mac Developer Application' 의 새 이름이다. 거기는 좁히지 말 것.)
# `-p codesigning` 도 여기서는 일부러 없다 — 설치 신원은 서명 정책 신원이 아니어서
# 그 옵션을 주면 목록에서 아예 사라진다.
if security find-identity -v | grep -qE "3rd Party Mac Developer Installer"; then
  ok "설치 패키지 서명 인증서 있음"
else
  bad "설치 패키지(.pkg) 서명 인증서 없음"
  note "developer.apple.com → Certificates → 'Mac Installer Distribution' 발급 필요"
fi

echo "── 2/6  프로비저닝 프로파일"

if [ ! -f "$PROFILE" ]; then
  bad "프로파일이 없습니다: $PROFILE"
  note "developer.apple.com → Profiles → 'Mac App Store' 유형으로 발급"
  note "App ID는 반드시 $BUNDLE_ID 여야 합니다"
  note "받은 파일을 $PROFILE 로 저장하세요"
else
  # .provisionprofile은 CMS 서명된 plist다. security cms로 본문만 꺼낸다.
  decoded="$(security cms -D -i "$PROFILE" 2>/dev/null)"
  if [ -z "$decoded" ]; then
    bad "프로파일을 읽지 못했습니다 (형식이 올바른지 확인하세요)"
  else
    # macOS 프로파일은 com.apple.application-identifier 를, iOS 프로파일은 접두사 없는
    # application-identifier 를 쓴다. 둘 다 시도한다 — macOS 키만 있는 정상 프로파일을
    # iOS 키로만 찾으면 "다른 앱 것"으로 잘못 판정한다.
    #
    # plutil 이 아니라 PlistBuddy 를 쓴다: plutil 의 키 경로는 점이 구분자라
    # 'com.apple.application-identifier' 가 com → apple → ... 중첩으로 해석된다.
    # PlistBuddy 는 콜론이 구분자라 점이 든 키를 그대로 읽을 수 있다.
    tmp_plist="$(mktemp -t greenday-profile)"
    printf '%s' "$decoded" > "$tmp_plist"
    profile_app_id="$(/usr/libexec/PlistBuddy -c \
      'Print :Entitlements:com.apple.application-identifier' "$tmp_plist" 2>/dev/null)"
    if [ -z "$profile_app_id" ]; then
      profile_app_id="$(/usr/libexec/PlistBuddy -c \
        'Print :Entitlements:application-identifier' "$tmp_plist" 2>/dev/null)"
    fi
    rm -f "$tmp_plist"
    profile_team="$(printf '%s' "$decoded" \
      | plutil -extract TeamIdentifier.0 raw -o - - 2>/dev/null)"
    expires="$(printf '%s' "$decoded" | plutil -extract ExpirationDate raw -o - - 2>/dev/null)"

    # application-identifier는 "TEAMID.$BUNDLE_ID" 형태다.
    if [[ "$profile_app_id" == *".$BUNDLE_ID" ]]; then
      ok "프로파일 App ID 일치: $profile_app_id"
    else
      bad "프로파일이 다른 앱의 것입니다: ${profile_app_id:-알 수 없음}"
      note "이 프로파일로 빌드하면 업로드 단계에서 거절됩니다"
      note "$BUNDLE_ID 용 프로파일을 새로 발급하세요"
      if [[ "$profile_app_id" == *".com.supaicy.haru" ]]; then
        note "── 예상된 실패입니다. 2026-09-07에 번들 ID를 com.supaicy.haru → $BUNDLE_ID 로 바꿨고,"
        note "   저장소의 resources/embedded.provisionprofile 은 아직 옛 ID용입니다."
        note "   사람이 할 일: developer.apple.com → Identifiers 에 $BUNDLE_ID 등록 →"
        note "   Profiles → 'Mac App Store Connect' 유형으로 새로 발급 → 그 파일로 교체."
      fi
    fi

    profile_platform="$(printf '%s' "$decoded" | plutil -extract Platform.0 raw -o - - 2>/dev/null)"
    if [ "$profile_platform" = "OSX" ]; then
      ok "플랫폼: macOS"
    else
      bad "macOS용 프로파일이 아닙니다 (플랫폼: ${profile_platform:-알 수 없음})"
      note "Profiles에서 'Mac App Store Connect' 유형으로 다시 발급하세요"
    fi

    [ -n "$profile_team" ] && ok "팀: $profile_team"
    [ -n "$expires" ] && ok "만료: $expires"
  fi
fi

echo "── 3/6  샌드박스 권한"

ENT="resources/entitlements.mas.plist"
if [ ! -f "$ENT" ]; then
  bad "$ENT 없음"
else
  if grep -q "com.apple.security.app-sandbox" "$ENT"; then
    ok "app-sandbox 선언됨 (App Store 필수)"
  else
    bad "app-sandbox가 없습니다 — App Store는 샌드박스를 요구합니다"
  fi

  if grep -q "com.apple.security.network.client" "$ENT"; then
    ok "network.client 선언됨 (캘린더 동기화·AI에 필요)"
  else
    bad "network.client가 없습니다 — 캘린더 동기화가 동작하지 않습니다"
  fi

  # 2026-09-07 뒤집음. 구글 OAuth 콜백이 커스텀 스킴 → **루프백(127.0.0.1)** 으로 바뀌었다
  # (src/shared/app-id.ts — Google 이 설치형 앱에 루프백을 요구한다). 샌드박스에서 리스닝
  # 소켓을 열려면 network.server 가 **있어야** 한다. 없으면 브라우저에서 로그인은 성공하는데
  # 앱이 콜백을 영영 못 받는다. 심사에서 사유를 물으면 심사 노트의 설명(127.0.0.1 에만,
  # 로그인하는 동안만)으로 답한다. 실제로 샌드박스에서 리스너가 열리는지는 MAS 개발 서명
  # 빌드로 사람이 확인해야 한다(TODOS.md U-5).
  if grep -q "com.apple.security.network.server" "$ENT"; then
    ok "network.server 선언됨 (루프백 OAuth 콜백 — 샌드박스에서 리스너를 열려면 필요)"
  else
    bad "network.server가 없습니다 — 루프백 OAuth 콜백을 샌드박스에서 받을 수 없어 Google 로그인이 멈춥니다"
    note "resources/entitlements.mas.plist 에 com.apple.security.network.server 를 추가하세요"
  fi
fi

echo "── 4/6  MAS 빌드에서 꺼져야 하는 기능"

# 샌드박스에서 동작하지 않거나 App Store 정책에 어긋나는 것들은 꺼져 있어야 한다.
# 판정 규칙은 src/shared/capabilities.ts 한 곳에 있고 단위 테스트로 고정돼 있다.
# 여기서는 "호출부가 그 규칙을 실제로 쓰는가"만 확인한다.
#
# 예전에는 각 파일에서 `process.mas` 문자열을 찾았는데, 그러면 주석에 든 글자에도
# 통과한다(실제로 ipc-handlers.ts가 주석 때문에 통과하고 있었다). 코드만 보도록
# 주석 줄(`*`, `//` 로 시작)을 걸러낸다.
code_grep() { grep -n "$1" "$2" 2>/dev/null | grep -vE ':[[:space:]]*(\*|//|/\*)'; }

if [ -f src/shared/capabilities.ts ] && [ -f src/main/capabilities.ts ]; then
  ok "능력 판정이 capabilities.ts 한 곳에 모여 있음"
else
  bad "src/shared/capabilities.ts 또는 src/main/capabilities.ts 가 없습니다"
fi

# process.mas 원본 읽기는 main/capabilities.ts 한 곳이어야 한다. 다른 데서 직접 읽기
# 시작하면 규칙이 다시 흩어지고, 한 곳을 빼먹으면 조용히 깨진다.
stray_mas=$(grep -rln "process\.mas" src --include='*.ts' --include='*.tsx' 2>/dev/null \
  | grep -v 'src/main/capabilities.ts' \
  | while read -r f; do [ -n "$(code_grep 'process\.mas' "$f")" ] && echo "$f"; done)
if [ -z "$stray_mas" ]; then
  ok "process.mas를 직접 읽는 곳은 main/capabilities.ts 하나뿐"
else
  bad "process.mas를 직접 읽는 파일이 더 있습니다: $stray_mas"
  note "판정은 shared/capabilities.ts 로 모으고 currentCapabilities()를 쓰세요"
fi

if [ -n "$(code_grep 'canSelfUpdate' src/main/index.ts)" ]; then
  ok "자동 업데이트가 canSelfUpdate로 분기됨"
else
  bad "src/main/index.ts에 canSelfUpdate 가드가 없습니다 (App Store가 업데이트를 담당해야 함)"
fi

if [ -n "$(code_grep 'hasGlobalShortcuts' src/main/ipc-handlers.ts)" ]; then
  ok "전역 단축키가 hasGlobalShortcuts로 분기됨"
else
  bad "전역 단축키에 hasGlobalShortcuts 가드가 없습니다 (샌드박스에서 등록 불가)"
fi

echo "── 5/6  번들 ID 일관성"

# 세 곳이 어긋나면 조용히 깨진다: 구글 로그인은 브라우저에서 성공하는데 그 콜백을
# 받을 앱이 없어 앱은 영원히 기다린다. 여기서 대조해 둔다.
if grep -q "^        - $BUNDLE_ID\$" electron-builder.yml; then
  ok "URL 스킴이 appId와 일치: $BUNDLE_ID"
else
  bad "URL 스킴이 appId와 다릅니다 — 구글 로그인 후 앱으로 돌아오지 못합니다"
  note "electron-builder.yml 의 mac.protocols[].schemes 를 $BUNDLE_ID 로 맞추세요"
fi

if grep -q "APP_BUNDLE_ID = '$BUNDLE_ID'" src/shared/app-id.ts; then
  ok "소스의 APP_BUNDLE_ID가 appId와 일치"
else
  bad "src/shared/app-id.ts 의 APP_BUNDLE_ID가 appId($BUNDLE_ID)와 다릅니다"
fi

echo "── 6/6  Google OAuth 클라이언트 ID"

# 빌드 시점에 electron.vite.config.ts 가 __GOOGLE_CLIENT_ID__ 로 박아 넣는 값이다. 없이
# 나가면 Google 캘린더 연동이 "이 빌드에는 설정되어 있지 않습니다"로 통째로 죽는데,
# 빌드는 멀쩡히 성공해서 사용자가 먼저 발견한다(2026-08 감사 U-1). 여기서 미리 막는다.
# 콜백은 루프백(127.0.0.1)+PKCE 이므로 Google Cloud 콘솔에서 '데스크톱 앱' 유형으로
# 만든다 — 번들 ID를 입력하는 iOS 유형이 아니다.
if [ -n "${GOOGLE_OAUTH_CLIENT_ID:-}" ]; then
  ok "GOOGLE_OAUTH_CLIENT_ID 설정됨 (${GOOGLE_OAUTH_CLIENT_ID%%.apps.googleusercontent.com}…)"
else
  bad "GOOGLE_OAUTH_CLIENT_ID 가 비어 있습니다 — 이대로 빌드하면 Google 연동이 죽은 채 나갑니다"
  note "GOOGLE_OAUTH_CLIENT_ID=<id> npm run mas:build  로 실행하세요"
  note "(Google Cloud 콘솔 → 사용자 인증 정보 → OAuth 클라이언트 ID → '데스크톱 앱'. 비밀 아님)"
fi

# 위 6/6 을 통과했더라도 electron.vite.config.ts 가 릴리스 빌드(GREENDAY_RELEASE=1,
# package.json 의 mas:build 가 켠다)에서 다시 확인한다.

echo
if [ "$fail" = "0" ]; then
  echo "통과. 이제 빌드할 수 있습니다:"
  echo "  npm run mas:build"
else
  echo "위 항목을 먼저 해결하세요. 지금 빌드하면 업로드나 심사에서 막힙니다." >&2
  exit 1
fi
