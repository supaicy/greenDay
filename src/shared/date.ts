/**
 * 로컬 시간 기준 날짜 문자열. 메인·렌더러 양쪽에서 쓴다.
 *
 * `new Date().toISOString().split('T')[0]`은 UTC라 KST 00:00~09:00에 하루 전 날짜를 준다.
 * 2026-08-05 전수 검증에서 통계 '오늘 완료', Cmd+D 마감일, 점수 이벤트 날짜,
 * 아이젠하워 지연 표시, AI 프롬프트의 '오늘'이 한꺼번에 이 버그를 갖고 있었다 —
 * 화면마다 고치는 대신 여기 하나만 쓰게 한다.
 */
export function toLocalDateString(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * 'YYYY-MM-DD'를 **로컬 자정**으로 되읽는다. `toLocalDateString`의 짝이다.
 *
 * `new Date('2026-09-25')`는 ECMAScript 규격상 **UTC 자정**으로 해석된다.
 * 쓸 때는 위 함수가 로컬 기준으로 적고 읽을 때는 UTC로 읽으니, 오프셋이 음수인
 * 지역에서 두 기준이 하루 어긋났다. 2026-09-25 진단 실측:
 *
 *   Asia/Seoul(+9)  new Date('오늘') → 오늘 09:00  isToday=true
 *   America/NY(-4)  new Date('오늘') → 어제 20:00  isToday=false, isOverdue=true
 *
 * 그래서 미주 사용자에게는 **오늘 마감인 할일이 "어제"로 뜨고 연체로 표시**됐고,
 * 내일 마감이 "오늘"로 떴다. '내일'·'다음 7일' 스마트 리스트도 하루씩 밀렸다.
 *
 * 테스트가 못 잡은 이유는 `vitest.config.ts`가 TZ를 Asia/Seoul로 고정하기
 * 때문이다. 그 고정은 UTC 머신에서 드리프트가 가려지는 것을 막으려던 것인데,
 * UTC+9로 묶으면 반대쪽(음수 오프셋)이 통째로 가려진다. `date.test.ts`가
 * 이제 양쪽을 다 본다.
 *
 * 날짜만 있는 문자열에만 쓴다 — 시각이 붙은 ISO 문자열은 그대로 `new Date()`가 맞다.
 */
export function fromLocalDateString(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  // 형식이 아니면 예전 동작으로 돌려보낸다 — 여기서 NaN Date를 만들어 조용히
  // 퍼뜨리는 것보다, 호출처가 늘 보던 값을 주는 편이 낫다.
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return new Date(dateStr)
  return new Date(y, m - 1, d)
}
