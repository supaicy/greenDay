import { useEffect, useRef } from 'react'
import { usePomodoroStore } from '../store/usePomodoroStore'
import i18n from '../i18n'

/**
 * 포모도로 1초 틱을 앱 루트에서 한 번만 돌린다.
 * 타이머 화면 안에서 돌리면 다른 뷰로 옮기는 순간 언마운트돼 카운트다운이 멈췄다(2026-08-05 검증).
 */
export function usePomodoroTicker(): void {
  // 0 도달 처리를 한 번만 하기 위한 가드. 틱과 전환 사이 렌더에서 중복 발화하는 걸 막는다.
  const finishing = useRef(false)
  // 진행 중일 때만 인터벌을 건다. 멈춰 있을 때까지 매초 깨울 이유가 없다.
  const running = usePomodoroStore((s) => s.running)

  useEffect(() => {
    if (!running) return
    const id = setInterval(() => {
      const { deadline, mode, tick, skip } = usePomodoroStore.getState()
      if (!deadline) return

      // 남은 시간은 벽시계로 판단한다. 스토어의 timeLeft는 직전 틱 값이라,
      // 창이 가려져 틱이 스로틀되면 완료를 한 틱(최대 1분) 늦게 알아챈다.
      if (Date.now() < deadline) {
        tick()
        return
      }

      if (finishing.current) return
      finishing.current = true
      tick()
      new Notification(i18n.t('pomodoro.title'), {
        body: i18n.t(mode === 'work' ? 'pomodoro.workDone' : 'pomodoro.breakDone')
      })
      // 세션 기록이 실패해도 다음 모드로는 넘어가야 한다. 예전에는 finally에서 가드를
      // 풀기만 해서, 저장이 실패하면 timeLeft가 0에 머문 채 매초 알림이 다시 떴다.
      void skip()
        .catch((e) => console.error('[pomodoro] 세션 저장 실패', e))
        .finally(() => {
          finishing.current = false
        })
    }, 1000)
    return () => clearInterval(id)
  }, [running])
}
