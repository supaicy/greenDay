#!/usr/bin/env bash
# 내 맥에서 직접 서명·공증·배포.
#
# 사전 준비 (한 번만):
#   1) Developer ID Application 인증서가 Keychain에 있을 것
#   2) xcrun notarytool store-credentials "haru" \
#        --apple-id <Apple ID> --team-id <팀ID> --password <앱 암호>
#
# 사용:  npm run release
set -euo pipefail

PROFILE="${APPLE_KEYCHAIN_PROFILE:-haru}"   # notarytool 에 저장해 둔 자격증명 이름(앱 이름과 무관)

# 앱 이름은 한곳에서만 정의한다. 이름이 바뀌어도 아래 경로들이 따라온다.
APP_NAME="$(awk -F': *' '/^productName:/{print $2; exit}' electron-builder.yml)"
[ -n "$APP_NAME" ] || { echo "ERROR: electron-builder.yml 에서 productName을 읽지 못했습니다." >&2; exit 1; }

echo "── 1/4  사전 확인"

# 인증서
if ! security find-identity -v -p codesigning | grep -q "Developer ID Application"; then
  echo "ERROR: Developer ID Application 인증서가 Keychain에 없습니다." >&2
  echo "  developer.apple.com → Certificates 에서 발급 후 이 맥에 설치하세요." >&2
  exit 1
fi
echo "  인증서 OK"

# 공증 자격증명. 없으면 electron-builder가 '조용히 건너뛰고' 공증 안 된 앱을 내보낸다.
if ! xcrun notarytool history --keychain-profile "$PROFILE" >/dev/null 2>&1; then
  echo "ERROR: 공증 자격증명 '$PROFILE' 을 찾을 수 없습니다." >&2
  echo "  아래를 한 번 실행하세요 (앱 암호는 appleid.apple.com 에서 발급):" >&2
  echo "    xcrun notarytool store-credentials \"$PROFILE\" \\" >&2
  echo "      --apple-id <Apple ID> --team-id <팀ID> --password <앱 암호>" >&2
  exit 1
fi
echo "  공증 자격증명 OK ($PROFILE)"

# 게시용 토큰
if [ -z "${GH_TOKEN:-}" ]; then
  GH_TOKEN="$(gh auth token 2>/dev/null || true)"
  [ -n "$GH_TOKEN" ] || { echo "ERROR: GitHub 토큰이 없습니다. 'gh auth login' 하세요." >&2; exit 1; }
  export GH_TOKEN
fi
echo "  GitHub 토큰 OK"

VERSION="$(node -p "require('./package.json').version")"
echo "  버전 v$VERSION"

echo "── 2/4  빌드"
npx electron-vite build

echo "── 3/4  패키징 + 서명 + 공증 + 게시(draft)"
export APPLE_KEYCHAIN_PROFILE="$PROFILE"
npx electron-builder --mac --arm64 --x64 --publish always

echo "── 4/4  검증"
# 사용자가 실제로 받는 건 dmg다. 빌드 중간산출물(dist/mac-*/*.app)이 아니라
# dmg를 마운트해 그 안의 앱을 검사해야 실제 Gatekeeper 판정과 일치한다.
# (dmg 컨테이너 자체는 서명하지 않는 것이 electron-builder 기본값이며,
#  안의 앱이 스테이플돼 있으면 사용자 실행에 문제가 없다.)
fail=0
found=0
for dmg in dist/"$APP_NAME"-*.dmg; do
  [ -f "$dmg" ] || continue
  found=1
  echo "  $(basename "$dmg")"
  mnt="$(mktemp -d)"
  if ! hdiutil attach "$dmg" -nobrowse -quiet -mountpoint "$mnt" 2>/dev/null; then
    echo "    ERROR: dmg 마운트 실패" >&2; fail=1; rmdir "$mnt" 2>/dev/null; continue
  fi
  app="$mnt/$APP_NAME.app"
  if [ ! -d "$app" ]; then
    echo "    ERROR: dmg 안에 $APP_NAME.app 이 없습니다" >&2; fail=1
  else
    codesign --verify --deep --strict "$app" 2>/dev/null || { echo "    ERROR: 서명 검증 실패" >&2; fail=1; }
    if xcrun stapler validate "$app" >/dev/null 2>&1; then
      echo "    스테이플 티켓 OK"
    else
      echo "    ERROR: 공증 티켓이 앱에 붙어 있지 않습니다" >&2; fail=1
    fi
    if spctl -a -vvv -t exec "$app" 2>&1 | grep -q "source=Notarized Developer ID"; then
      echo "    Gatekeeper 통과 (Notarized Developer ID)"
    else
      echo "    ERROR: Gatekeeper가 거부합니다 — 사용자가 실행하지 못합니다" >&2; fail=1
    fi
  fi
  hdiutil detach "$mnt" -quiet 2>/dev/null || true
  rmdir "$mnt" 2>/dev/null || true
done
[ "$found" = "1" ] || { echo "ERROR: 검증할 dmg가 없습니다" >&2; exit 1; }
[ "$fail" = "0" ] || { echo "검증 실패 — 릴리스는 draft로 남겨둡니다." >&2; exit 1; }

echo
echo "완료. draft 릴리스가 올라갔습니다."
echo "공개하려면:  gh release edit v$VERSION --draft=false --latest"
