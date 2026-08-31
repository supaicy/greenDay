# 화면을 뺏지 않고 앱 화면을 찍는 법

Electron 창을 띄우지 않고 렌더러만 정적으로 띄워 headless 브라우저로 찍는다.
작업 중인 사람의 화면을 차지하지 않고, 라이트/다크·임의 크기·임의 배율로 찍을 수 있다.

```bash
npm run build                                  # out/renderer 가 나온다
rm -rf /tmp/appshot && cp -R out/renderer /tmp/appshot
cp docs/app-store/tools/headless-stub.js /tmp/appshot/stub.js
# index.html 의 <script type="module"> 바로 앞에 <script src="./stub.js"></script> 를 넣는다
cd /tmp/appshot && python3 -m http.server 8092 &

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless=new --disable-gpu --hide-scrollbars \
  --window-size=1440,900 --force-device-scale-factor=2 \
  --screenshot=out.png --virtual-time-budget=9000 \
  "http://127.0.0.1:8092/?theme=light&view=칸반%20보드"
```

`1440×900` 에 배율 2를 주면 **2880×1800** 이 나온다 — App Store 권장 크기이고
UI 크기는 그대로다.

## 알아야 하는 것 셋

- **`window.api` 를 스텁으로 채워야 한다.** 렌더러는 목록·할일·습관을 전부 IPC로
  받는다. `App.tsx` 의 호출은 옵셔널 체이닝이라 안 죽지만, 데이터가 없으면 빈 화면이다.
- **행은 스네이크케이스다.** 스토어가 `row.due_date` → `dueDate` 로 매핑한다
  (`useStore.mapTask`). 캐멀케이스로 주면 날짜·태그가 통째로 사라진다.
- **날짜는 로컬 시간 기준 `yyyy-MM-dd`.** `toISOString()` 은 UTC라 KST 새벽에
  하루 전 날짜가 나오고 "오늘"이 빈다(`utils/date.ts` 가 그 함정을 주석으로 못박고 있다).

`?theme=light|dark` 로 테마를, `?view=<사이드바 라벨>` 로 화면을 고른다.
스텁은 사본에만 넣는다 — `out/renderer` 원본은 건드리지 않는다.
