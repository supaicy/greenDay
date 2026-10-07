#!/usr/bin/env bash
# 옛 Homebrew cask `haru`(supaicy/homebrew-haru · Casks/haru.rb)를 브리지 v1.5.0 으로 올린다.
#
# 왜 따로인가: 릴리스 워크플로의 bump-cask 는 새 앱의 `greenday` cask 만 만든다. 옛 cask 로
# 설치한 사람(`brew install --cask supaicy/haru/haru`)이 `brew upgrade` 로 브리지를 받으려면
# `haru.rb` 가 v1.5.0 의 실제 자산을 가리켜야 한다. 그 뒤로는 caveats 가 새 cask 로 안내한다.
#
# SHA 는 **실제로 올라간 자산**에서 계산한다. 브리지는 서명·공증을 거쳐 사람이 올리므로,
# 릴리스가 공개된 뒤에 돌린다. 로컬에서 방금 만든 dmg 로 미리 보고 싶으면 --local.
#
# 사용:
#   scripts/bump-haru-cask.sh            # 릴리스 자산에서 SHA 계산 → homebrew-haru/ 에 커밋 (푸시 안 함)
#   scripts/bump-haru-cask.sh --local    # dist/Greenday-1.5.0-bridge-*.dmg 로 계산 (검토용)
set -euo pipefail

VERSION="1.5.0"
TAG="v${VERSION}"
BASE="https://github.com/supaicy/greenDay/releases/download/${TAG}"
TAP_DIR="${TAP_DIR:-homebrew-haru}"   # .gitignore 에 있다 — 별도 저장소의 로컬 클론
MODE="${1:-release}"

sha_of() {
  local url="$1" tmp
  tmp="$(mktemp)"
  curl -fsSL --retry 3 -o "$tmp" "$url" || { echo "ERROR: 내려받기 실패: $url" >&2; exit 1; }
  [ -s "$tmp" ] || { echo "ERROR: 빈 파일: $url" >&2; exit 1; }
  shasum -a 256 "$tmp" | cut -d' ' -f1
  rm -f "$tmp"
}

if [ "$MODE" = "--local" ]; then
  for a in arm64 x64; do
    [ -f "dist/Greenday-${VERSION}-bridge-${a}.dmg" ] || { echo "ERROR: dist/Greenday-${VERSION}-bridge-${a}.dmg 없음 — npm run package:bridge 먼저" >&2; exit 1; }
  done
  ARM_SHA="$(shasum -a 256 "dist/Greenday-${VERSION}-bridge-arm64.dmg" | cut -d' ' -f1)"
  X64_SHA="$(shasum -a 256 "dist/Greenday-${VERSION}-bridge-x64.dmg" | cut -d' ' -f1)"
else
  ARM_SHA="$(sha_of "$BASE/Greenday-${VERSION}-bridge-arm64.dmg")"
  X64_SHA="$(sha_of "$BASE/Greenday-${VERSION}-bridge-x64.dmg")"
fi
for s in "$ARM_SHA" "$X64_SHA"; do
  [[ "$s" =~ ^[0-9a-f]{64}$ ]] || { echo "ERROR: SHA 형식이 틀립니다: '$s'" >&2; exit 1; }
done

if [ ! -d "$TAP_DIR/.git" ]; then
  git clone -q https://github.com/supaicy/homebrew-haru.git "$TAP_DIR"
fi
mkdir -p "$TAP_DIR/Casks"

# 옛 사용자의 설치는 haru.app 이었지만 브리지의 번들은 Greenday.app 이다 — brew 가 옛 앱을
# 지우고 새 이름으로 놓는다. zap 은 옛 경로와 실제 데이터 경로(내부 이름 ticktick)를 함께.
cat > "$TAP_DIR/Casks/haru.rb" <<RUBY
cask "haru" do
  arch arm: "arm64", intel: "x64"

  version "${VERSION}"
  sha256 arm:   "${ARM_SHA}",
         intel: "${X64_SHA}"

  url "https://github.com/supaicy/greenDay/releases/download/v#{version}/Greenday-#{version}-bridge-#{arch}.dmg"
  name "haru"
  desc "Greenday (formerly haru) — final release under the old bundle ID"
  homepage "https://begreen.dev/greenday"

  depends_on macos: ">= :monterey"

  app "Greenday.app"

  caveats <<~EOS
    This is the last version of the "haru" cask. Greenday now ships as a new app
    (bundle ID com.begreen.greenday). Your data carries over. To move:
      brew uninstall --cask haru
      brew install --cask supaicy/haru/greenday
  EOS

  zap trash: [
    "~/Library/Application Support/haru",
    "~/Library/Application Support/ticktick",
    "~/Library/Caches/ticktick-updater",
    "~/Library/Preferences/com.haru.app.plist",
    "~/Library/Saved Application State/com.haru.app.savedState",
  ]
end
RUBY

if [ "$MODE" = "--local" ]; then
  echo "── 미리 보기 (로컬 dmg 의 SHA — 공개된 자산과 다를 수 있다, 커밋하지 않는다)"
  cat "$TAP_DIR/Casks/haru.rb"
  exit 0
fi

git -C "$TAP_DIR" add Casks/haru.rb
git -C "$TAP_DIR" commit -q -m "chore: bump haru to ${VERSION} — 옛 번들 ID의 마지막 버전(브리지), greenday cask 로 안내" \
  -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
echo "커밋했습니다 ($TAP_DIR). 확인 뒤 푸시하세요:  git -C $TAP_DIR push"
