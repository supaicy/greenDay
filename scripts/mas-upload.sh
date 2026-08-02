#!/usr/bin/env bash
# 만들어진 App Store용 pkg를 검증하고 App Store Connect에 올린다.
#
# 검증(--validate-app)을 먼저 하는 이유: 업로드는 100MB가 넘는 전송이라
# 실패하면 그 시간을 통째로 날린다. 검증은 같은 규칙을 몇 초 만에 확인한다.
#
# 사용:  npm run mas:upload
#
# 비밀번호는 입력받아 그 자리에서만 쓰고 어디에도 저장하지 않는다.
set -uo pipefail

APP_NAME="$(awk -F': *' '/^productName:/{print $2; exit}' electron-builder.yml)"
VERSION="$(node -p "require('./package.json').version")"

echo "── 1/3  올릴 파일 확인"

# 유니버설 빌드 산출물. App Store Connect는 버전당 빌드 하나만 받으므로
# 아키텍처별 pkg가 여러 개 있으면 어느 것을 올릴지 사람이 정해야 한다.
#
# macOS 기본 bash는 3.2라 mapfile이 없다. 배열 대신 개행 구분 문자열로 다룬다.
PKG_LIST="$(find dist -name "$APP_NAME-$VERSION*.pkg" 2>/dev/null | sort)"
PKG_COUNT="$(printf '%s' "$PKG_LIST" | grep -c . || true)"

if [ "$PKG_COUNT" -eq 0 ]; then
  echo "ERROR: 올릴 pkg가 없습니다. 먼저 빌드하세요:" >&2
  echo "  npm run mas:build" >&2
  exit 1
fi

if [ "$PKG_COUNT" -gt 1 ]; then
  echo "ERROR: pkg가 ${PKG_COUNT}개 있습니다. App Store는 버전당 하나만 받습니다." >&2
  printf '  %s\n' "$PKG_LIST" >&2
  echo "  아키텍처별로 나뉜 빌드입니다. dist/를 지우고 유니버설로 다시 빌드하세요:" >&2
  echo "    rm -rf dist/mas* && npm run mas:build" >&2
  exit 1
fi

PKG="$PKG_LIST"
echo "  $PKG ($(du -h "$PKG" | cut -f1))"

# 유니버설인지 확인. 한쪽 아키텍처만 담겨 있으면 절반의 사용자가 못 쓴다.
APP_BIN="$(find "$(dirname "$PKG")" -maxdepth 3 -path "*$APP_NAME.app/Contents/MacOS/*" -type f 2>/dev/null | head -1)"
if [ -n "$APP_BIN" ]; then
  archs="$(lipo -archs "$APP_BIN" 2>/dev/null)"
  if [ -n "$archs" ]; then
    case "$archs" in
      *arm64*x86_64*|*x86_64*arm64*) echo "  아키텍처: $archs (유니버설)" ;;
      *) echo "  경고: 아키텍처가 '$archs' 뿐입니다 — 나머지 맥에서는 실행되지 않습니다" >&2 ;;
    esac
  fi
fi

echo "── 2/3  Apple 계정"

APPLE_ID="${APPLE_ID:-}"
if [ -z "$APPLE_ID" ]; then
  read -r -p "  Apple ID: " APPLE_ID
fi
[ -n "$APPLE_ID" ] || { echo "ERROR: Apple ID가 필요합니다." >&2; exit 1; }

# 앱 암호는 화면에 찍지 않고 파일에도 남기지 않는다.
APPLE_APP_PASSWORD="${APPLE_APP_PASSWORD:-}"
if [ -z "$APPLE_APP_PASSWORD" ]; then
  echo "  앱 암호 (appleid.apple.com에서 발급한 xxxx-xxxx-xxxx-xxxx 형식)"
  read -r -s -p "  앱 암호: " APPLE_APP_PASSWORD
  echo
fi
[ -n "$APPLE_APP_PASSWORD" ] || { echo "ERROR: 앱 암호가 필요합니다." >&2; exit 1; }

echo "── 3/3  검증 후 업로드"

echo "  검증 중…"
if ! xcrun altool --validate-app -f "$PKG" -t macos \
       -u "$APPLE_ID" -p "$APPLE_APP_PASSWORD" 2>&1 | tee /tmp/mas-validate.log; then
  echo >&2
  echo "검증 실패. 위 메시지를 확인하세요. 업로드는 시도하지 않았습니다." >&2
  exit 1
fi

if grep -qi "error" /tmp/mas-validate.log; then
  echo >&2
  echo "검증에서 오류가 보고됐습니다. 업로드는 시도하지 않았습니다." >&2
  exit 1
fi
echo "  검증 통과"

echo "  업로드 중… (파일이 커서 몇 분 걸립니다)"
if xcrun altool --upload-app -f "$PKG" -t macos \
     -u "$APPLE_ID" -p "$APPLE_APP_PASSWORD"; then
  echo
  echo "업로드 완료."
  echo "App Store Connect에서 처리에 5~30분 걸립니다. 처리가 끝나면"
  echo "'빌드' 섹션에 나타나고, 그때 심사에 제출할 수 있습니다."
else
  echo >&2
  echo "업로드 실패. 위 메시지를 확인하세요." >&2
  exit 1
fi
