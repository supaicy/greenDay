#!/usr/bin/env bash
# Mac App Store 빌드 전 점검.
#
# 여기서 걸러 내려는 것: 빌드는 성공하는데 업로드나 심사에서야 터지는 문제들.
# 특히 프로비저닝 프로파일이 다른 앱 것이면 빌드는 멀쩡히 끝나고 업로드에서 거절된다.
#
# 사용:  npm run mas:preflight
set -uo pipefail

BUNDLE_ID="com.haru.app"
PROFILE="${MAS_PROVISIONING_PROFILE:-resources/embedded.provisionprofile}"
fail=0

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; fail=1; }
note() { printf '    %s\n' "$1"; }

echo "── 1/5  인증서"

# App Store 배포용 인증서는 Developer ID(직접 배포용)와 완전히 다른 종류다.
if security find-identity -v -p codesigning | grep -qE "3rd Party Mac Developer Application|Apple Distribution"; then
  ok "앱 서명 인증서 있음 (Apple Distribution 또는 3rd Party Mac Developer Application)"
else
  bad "앱 서명 인증서 없음"
  note "developer.apple.com → Certificates → 'Apple Distribution' 발급 후 이 맥에 설치"
  note "(Developer ID Application 인증서로는 App Store에 올릴 수 없습니다)"
fi

if security find-identity -v | grep -qE "3rd Party Mac Developer Installer|Apple Distribution"; then
  ok "설치 패키지 서명 인증서 있음"
else
  bad "설치 패키지(.pkg) 서명 인증서 없음"
  note "developer.apple.com → Certificates → 'Mac Installer Distribution' 발급 필요"
fi

echo "── 2/5  프로비저닝 프로파일"

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
    profile_app_id="$(printf '%s' "$decoded" \
      | plutil -extract Entitlements.application-identifier raw -o - - 2>/dev/null)"
    profile_team="$(printf '%s' "$decoded" \
      | plutil -extract TeamIdentifier.0 raw -o - - 2>/dev/null)"
    expires="$(printf '%s' "$decoded" | plutil -extract ExpirationDate raw -o - - 2>/dev/null)"

    # application-identifier는 "TEAMID.com.haru.app" 형태다.
    if [ "${profile_app_id##*.}" = "app" ] && [[ "$profile_app_id" == *".$BUNDLE_ID" ]]; then
      ok "프로파일 App ID 일치: $profile_app_id"
    else
      bad "프로파일이 다른 앱의 것입니다: ${profile_app_id:-알 수 없음}"
      note "이 프로파일로 빌드하면 업로드 단계에서 거절됩니다"
      note "$BUNDLE_ID 용 프로파일을 새로 발급하세요"
    fi

    [ -n "$profile_team" ] && ok "팀: $profile_team"
    [ -n "$expires" ] && ok "만료: $expires"
  fi
fi

echo "── 3/5  샌드박스 권한"

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

  # 서버 권한을 요구하면 심사에서 사유를 묻는다. 커스텀 URL 스킴으로 OAuth를 받으므로
  # 필요 없어야 정상이다. 들어가 있다면 누군가 루프백 방식으로 되돌린 것이다.
  if grep -q "com.apple.security.network.server" "$ENT"; then
    bad "network.server가 선언돼 있습니다 — OAuth는 커스텀 URL 스킴으로 받으므로 불필요합니다"
  else
    ok "network.server 없음 (OAuth 콜백은 커스텀 URL 스킴으로 받음)"
  fi
fi

echo "── 4/5  MAS 빌드에서 꺼져야 하는 기능"

# 샌드박스에서 동작하지 않거나 App Store 정책에 어긋나는 것들은 process.mas로 막아 둔다.
if grep -rq "process.mas" src/main/index.ts; then
  ok "자동 업데이트가 process.mas로 분기됨"
else
  bad "src/main/index.ts에 process.mas 가드가 없습니다 (App Store가 업데이트를 담당해야 함)"
fi

if grep -q "process.mas" src/main/ipc-handlers.ts; then
  ok "전역 단축키가 process.mas로 분기됨"
else
  bad "전역 단축키에 process.mas 가드가 없습니다 (샌드박스에서 등록 불가)"
fi

echo "── 5/5  URL 스킴 등록"

if grep -q "com.haru.app" electron-builder.yml; then
  ok "electron-builder.yml에 커스텀 URL 스킴 선언됨"
else
  bad "URL 스킴이 선언되지 않았습니다 — 구글 로그인 후 앱으로 돌아오지 못합니다"
fi

echo
if [ "$fail" = "0" ]; then
  echo "통과. 이제 빌드할 수 있습니다:"
  echo "  npm run mas:build"
else
  echo "위 항목을 먼저 해결하세요. 지금 빌드하면 업로드나 심사에서 막힙니다." >&2
  exit 1
fi
