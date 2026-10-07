import { useEffect, useState } from 'react'
import { msUntilNextLocalMidnight, todayString } from '../utils/date'

/**
 * 오늘 날짜(YYYY-MM-DD). 마운트 시점 고정이 아니라 로컬 자정마다 갱신된다 —
 * 자정을 넘긴 창에서 '오늘' 하이라이트가 어제에 남고, Kanban이 어제 날짜를
 * 새 데이터에 박던 버그의 해법. 타이머는 절전 등으로 밀릴 수 있어 발화 때마다
 * 실제 시각으로 다시 무장한다(+50ms는 이른 발화가 자정 직전에 떨어지는 것 방지).
 */
export function useToday(): string {
  const [today, setToday] = useState(todayString)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const arm = (): void => {
      timer = setTimeout(() => {
        setToday(todayString())
        arm()
      }, msUntilNextLocalMidnight(new Date()) + 50)
    }
    arm()
    return () => clearTimeout(timer)
  }, [])
  return today
}
