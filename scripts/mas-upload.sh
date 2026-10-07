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

# **같은 버전의 지난 pkg를 걸러 낸다.** `mas:build`는 dist/를 비우지 않고 pkg 이름에는
# 버전만 들어가므로, 버전을 안 올린 채 소스를 고치고 빌드를 잊으면 예전 pkg가 위
# 검사를 그대로 통과했다. pkg가 마지막 커밋보다 오래됐으면 그 커밋은 들어 있지 않다.
#
# git을 못 돌리면 **멈춘다.** Xcode를 새로 깔고 라이선스에 동의하지 않은 맥에서는
# /usr/bin/git이 실패하는데, 처음 이 검사를 넣었을 때는 그때 조용히 건너뛰었다 —
# 위 유니버설 검사가 고쳐진 바로 그 "확인 못 했으니 통과" 구멍이다. Command Line
# Tools의 git은 Xcode 라이선스와 따로라 한 번 더 시도한다.
LAST_COMMIT="$(git log -1 --format=%ct 2>/dev/null || DEVELOPER_DIR=/Library/Developer/CommandLineTools git log -1 --format=%ct 2>/dev/null || true)"
if [ -z "$LAST_COMMIT" ]; then
  echo "ERROR: 마지막 커밋 시각을 알 수 없습니다 — pkg가 최신 소스로 만들어졌는지 확인하지 못했습니다." >&2
  echo "    git이 동작하는지 확인하세요 (Xcode를 새로 깔았다면: sudo xcodebuild -license accept)" >&2
  exit 1
fi
PKG_MTIME="$(stat -f %m "$PKG")"
if [ "$PKG_MTIME" -lt "$LAST_COMMIT" ]; then
  echo "ERROR: pkg가 마지막 커밋보다 오래됐습니다 — 최신 소스가 들어 있지 않습니다." >&2
  echo "    rm -rf dist/mas* && npm run mas:build" >&2
  exit 1
fi

# 유니버설인지 확인. 한쪽 아키텍처만 담겨 있으면 절반의 사용자가 못 쓴다.
#
# 실행 파일은 pkg 옆 `Greenday.app/Contents/MacOS/Greenday`로 **깊이 4**다. 예전에는
# -maxdepth 3이라 한 번도 찾지 못했고, 못 찾으면 조용히 넘어가서 이 검사는 실제로
# 돈 적이 없었다(2026-10-06 codex 검토에서 발견). 이제 못 찾거나 못 읽어도 멈춘다 —
# 확인하지 못한 것을 확인한 것처럼 올리지 않는다.
APP_BIN="$(dirname "$PKG")/$APP_NAME.app/Contents/MacOS/$APP_NAME"
if [ ! -f "$APP_BIN" ]; then
  echo "ERROR: pkg 옆에 앱 실행 파일이 없어 아키텍처를 확인할 수 없습니다: $APP_BIN" >&2
  echo "    rm -rf dist/mas* && npm run mas:build" >&2
  exit 1
fi
archs="$(lipo -archs "$APP_BIN" 2>/dev/null)"
case "$archs" in
  *arm64*x86_64*|*x86_64*arm64*) echo "  아키텍처: $archs (유니버설)" ;;
  *)
    echo "ERROR: 아키텍처가 '${archs:-알 수 없음}'입니다 — 유니버설이 아니면 일부 맥에서 실행되지 않습니다." >&2
    exit 1
    ;;
esac

echo "── 2/3  Apple 계정"

# 자격증명은 세 곳에서 찾는다. 키체인에 있으면 아무것도 묻지 않고 진행하므로
# 사람이 지켜보지 않아도 돌릴 수 있다.
KEYCHAIN_SERVICE="${MAS_KEYCHAIN_SERVICE:-AC_PASSWORD}"

APPLE_ID="${APPLE_ID:-}"
APPLE_APP_PASSWORD="${APPLE_APP_PASSWORD:-}"

if [ -z "$APPLE_APP_PASSWORD" ]; then
  # -w 는 비밀번호만 출력한다. 값이 셸 히스토리나 로그에 남지 않는다.
  keychain_pw="$(security find-generic-password -s "$KEYCHAIN_SERVICE" -w 2>/dev/null)"
  if [ -n "$keychain_pw" ]; then
    APPLE_APP_PASSWORD="$keychain_pw"
    [ -n "$APPLE_ID" ] || APPLE_ID="$(security find-generic-password -s "$KEYCHAIN_SERVICE" 2>/dev/null \
      | awk -F'"' '/"acct"/{print $4}')"
    echo "  키체인($KEYCHAIN_SERVICE)에서 자격증명을 읽었습니다."
  fi
fi

if [ -z "$APPLE_ID" ]; then
  if [ -t 0 ]; then
    read -r -p "  Apple ID: " APPLE_ID
  else
    echo "ERROR: Apple ID가 없고 입력받을 수 있는 터미널도 아닙니다." >&2
    echo "  터미널에서 직접 실행하시거나, 키체인에 한 번 저장해 두세요:" >&2
    echo "    security add-generic-password -s $KEYCHAIN_SERVICE -a '<Apple ID>' -w" >&2
    echo "  (-w 뒤에 값을 적지 않으면 화면에 안 보이게 따로 입력받습니다)" >&2
    exit 1
  fi
fi
[ -n "$APPLE_ID" ] || { echo "ERROR: Apple ID가 필요합니다." >&2; exit 1; }

if [ -z "$APPLE_APP_PASSWORD" ]; then
  if [ -t 0 ]; then
    echo "  앱 암호 (appleid.apple.com에서 발급한 xxxx-xxxx-xxxx-xxxx 형식)"
    read -r -s -p "  앱 암호: " APPLE_APP_PASSWORD
    echo
  else
    echo "ERROR: 앱 암호가 없고 입력받을 수 있는 터미널도 아닙니다." >&2
    echo "  키체인에 한 번 저장해 두면 다음부터는 묻지 않습니다:" >&2
    echo "    security add-generic-password -s $KEYCHAIN_SERVICE -a '$APPLE_ID' -w" >&2
    exit 1
  fi
fi
[ -n "$APPLE_APP_PASSWORD" ] || { echo "ERROR: 앱 암호가 필요합니다." >&2; exit 1; }

echo "── 3/3  검증 후 업로드"

# **암호는 argv에 싣지 않는다.** `-p "$APPLE_APP_PASSWORD"`로 넘기면 검증·업로드가 도는
# 몇 분 동안 같은 맥의 어떤 프로세스든 `ps`로 읽는다 — 위 머리말의 "어디에도 저장하지
# 않는다"와 어긋났다. altool은 `@env:변수명`으로 환경변수에서 읽는다.
export APPLE_APP_PASSWORD
# 로그도 정해진 /tmp 경로가 아니라 이 실행만의 임시 파일에 — 누구나 쓰는 /tmp의 고정
# 이름은 미리 심어 둔 심볼릭 링크로 다른 파일을 덮게 만들 수 있다.
VALIDATE_LOG="$(mktemp -t greenday-mas-validate)"
trap 'rm -f "$VALIDATE_LOG"' EXIT

echo "  검증 중…"
if ! xcrun altool --validate-app -f "$PKG" -t macos \
       -u "$APPLE_ID" -p @env:APPLE_APP_PASSWORD 2>&1 | tee "$VALIDATE_LOG"; then
  echo >&2
  echo "검증 실패. 위 메시지를 확인하세요. 업로드는 시도하지 않았습니다." >&2
  exit 1
fi

# altool은 성공 시 "VERIFY SUCCEEDED" 와 "No errors validating" 을 출력한다.
# 단순히 'error' 를 찾으면 그 성공 문구의 "no errors" 에 걸려 성공을 실패로 읽는다.
# 실제 실패 표식만 본다.
if grep -qE "ERROR ITMS-|\*\*\* Error|error:|VERIFY FAILED" "$VALIDATE_LOG"; then
  echo >&2
  echo "검증에서 오류가 보고됐습니다. 업로드는 시도하지 않았습니다." >&2
  exit 1
fi

if ! grep -q "VERIFY SUCCEEDED" "$VALIDATE_LOG"; then
  echo >&2
  echo "검증 성공 표식을 찾지 못했습니다. 위 출력을 확인하세요." >&2
  exit 1
fi
echo "  검증 통과"

echo "  업로드 중… (파일이 커서 몇 분 걸립니다)"
if xcrun altool --upload-app -f "$PKG" -t macos \
     -u "$APPLE_ID" -p @env:APPLE_APP_PASSWORD; then
  echo
  echo "업로드 완료."
  echo "App Store Connect에서 처리에 5~30분 걸립니다. 처리가 끝나면"
  echo "'빌드' 섹션에 나타나고, 그때 심사에 제출할 수 있습니다."
else
  echo >&2
  echo "업로드 실패. 위 메시지를 확인하세요." >&2
  exit 1
fi
