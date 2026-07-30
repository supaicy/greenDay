# App Store 스크린샷

2880×1800 (Retina 1440×900). Mac App Store 권장 규격.

| 파일 | 화면 | 보여주는 것 |
|---|---|---|
| `01-오늘.png` | 오늘 | 마감·우선순위·태그가 붙은 할 일 목록 |
| `02-캘린더-주.png` | 캘린더(주) | 시간 블록 배치 |
| `03-칸반보드.png` | 칸반 보드 | 할 일 / 진행 중 / 완료 |
| `04-아이젠하워.png` | 아이젠하워 | 중요도·긴급도 4분면 자동 분류 |
| `05-습관.png` | 습관 트래커 | 주간 체크와 연속 기록 |
| `06-설정-프라이버시.png` | 설정 | 로컬 전용 잠금 · 로컬 AI (차별점) |

## 재현 방법

스크린샷에 **실제 개인 할 일이 들어가면 안 되므로** 데모 데이터로 찍는다.

```bash
DEMO=/tmp/haru-demo && mkdir -p "$DEMO"
cp docs/app-store/demo-data.json "$DEMO/ticktick-data.json"
npx electron-vite dev -- --user-data-dir="$DEMO"

# 창을 1440×900 으로 (Retina 캡처 시 2880×1800)
osascript -e 'tell application "System Events" to tell process "Electron" \
  to set size of window 1 to {1440, 900}'
```

`demo-data.json`의 날짜는 **고정값**이라 오늘과 어긋나면 "오늘" 뷰가 빈다.
날짜를 다시 맞추려면 `due_date`/`scheduled_*`를 촬영일 기준으로 바꾼다.

## 주의

- 규격이 어긋나면 App Store Connect가 업로드를 거부한다. 허용: 2880×1800 / 2560×1600 / 1440×900 / 1280×800
- 촬영 전 실제 데이터 폴더(`~/Library/Application Support/ticktick`)를 쓰지 않는지 확인할 것
