import { useState } from 'react'
import { refreshLicense } from './useLicense'
import type { ActivateFailure } from '../../../shared/license'

/**
 * 키 입력 → 활성화 흐름. **잠금 화면과 설정 화면이 같은 것을 쓴다.**
 *
 * 두 벌로 두면 앞으로 붙일 것들(붙여넣기 시 공백 제거, Enter 제출, 재입력하면
 * 오류 지우기, 새 실패 코드 분기)을 매번 두 곳에 해야 하고, 어긋나는 순간
 * 게이트와 설정이 같은 키에 대해 서로 다르게 실패한다. 게이트 쪽이 잠긴
 * 유료 사용자가 보는 화면이라, 드리프트하면 비싼 쪽이 드리프트한다.
 */
export interface Activation {
  key: string
  setKey: (value: string) => void
  busy: boolean
  error: ActivateFailure | null
  /** 성공하면 true. 화면마다 다르게 축하하므로 결과만 알린다. */
  activate: () => Promise<boolean>
  canSubmit: boolean
}

export function useActivation(): Activation {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ActivateFailure | null>(null)

  return {
    key,
    // 다시 입력하기 시작하면 옛 오류를 치운다 — 고친 것을 두고 계속 빨간 줄이
    // 떠 있으면 사용자는 자기가 뭘 잘못했는지 모른다.
    setKey: (value) => {
      setKey(value)
      if (error) setError(null)
    },
    busy,
    error,
    canSubmit: !busy && key.trim() !== '',
    /**
     * **`finally`가 이 흐름의 유일한 탈출구다.**
     *
     * 예전에는 `setBusy(false)`가 `await` 바로 다음 줄이었다. IPC가 *거절*되면
     * 그 줄에 도달하지 못해 `busy`가 영원히 참으로 남고 `canSubmit`이 영영
     * false가 된다 — 잠금 화면(LicenseGate)에서는 그게 **키를 넣을 유일한
     * 경로**라 사용자가 빠져나올 방법이 사라진다. 설정 화면에서는 같은 값이
     * 해제 버튼까지 잠근다(LicenseSection의 `busy`가 둘을 묶는다).
     *
     * 거절을 삼키지도 않는다. 호출처가 `void activate()`라 여기서 던지면
     * unhandled rejection으로 사라지고 화면에는 아무 문구도 안 뜬다 —
     * "눌렀는데 아무 일도 안 일어난다"가 된다. `network`로 갈아 끼운다:
     * 메인이 답을 못 준 것이므로 "서버에 못 닿았다"와 같은 종류의 모름이고,
     * 그 문구가 이미 "잠시 후 다시 시도"를 말한다.
     */
    activate: async () => {
      setBusy(true)
      setError(null)
      try {
        const failure = await window.api.licenseActivate(key)
        if (failure) {
          setError(failure)
          return false
        }
        setKey('')
        await refreshLicense()
        return true
      } catch (error) {
        console.error('[license] 활성화 요청이 거절됐다', error)
        setError('network')
        return false
      } finally {
        setBusy(false)
      }
    }
  }
}
