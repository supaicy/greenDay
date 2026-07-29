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

PROFILE="${APPLE_KEYCHAIN_PROFILE:-haru}"

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
fail=0
for app in dist/mac-arm64/haru.app dist/mac/haru.app dist/mac-x64/haru.app; do
  [ -d "$app" ] || continue
  echo "  $app"
  codesign --verify --deep --strict "$app" || fail=1
  if spctl -a -vvv -t install "$app" 2>&1 | grep -q "Notarized Developer ID"; then
    echo "    공증 확인됨"
  else
    echo "    ERROR: 공증되지 않았습니다" >&2; fail=1
  fi
done
[ "$fail" = "0" ] || { echo "검증 실패 — 릴리스는 draft로 남겨둡니다." >&2; exit 1; }

echo
echo "완료. draft 릴리스가 올라갔습니다."
echo "공개하려면:  gh release edit v$VERSION --draft=false --latest"
