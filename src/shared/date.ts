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
