/**
 * 리마인더 순수 함수 모듈
 * Date.now() / new Date() 호출 없음 — 외부에서 시각을 주입받는다.
 */

/**
 * fromISO와 toISO 사이에 도래한 리마인더를 가진 태스크를 반환한다.
 * (from, to] 구간: fromISO < reminder_at <= toISO
 * 완료(completed truthy) 및 삭제(deleted_at non-null) 태스크는 제외.
 */
export function dueReminders(
  tasks: Record<string, unknown>[],
  fromISO: string,
  toISO: string
): Record<string, unknown>[] {
  return tasks.filter((task) => {
    const reminderAt = task.reminder_at
    // reminder_at이 비어있거나 문자열이 아닌 경우 제외
    if (typeof reminderAt !== 'string' || !reminderAt) return false
    // (from, to] 구간 검사: 사전순 비교는 UTC ISO 8601 문자열에서 시간 순서와 동일
    if (reminderAt <= fromISO || reminderAt > toISO) return false
    // 완료된 태스크 제외 (DB에서 0/1 정수로 저장되나 truthy 체크)
    if (task.completed) return false
    // 삭제된 태스크 제외
    if (task.deleted_at != null) return false
    return true
  })
}
