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
    activate: async () => {
      setBusy(true)
      setError(null)
      const failure = await window.api.licenseActivate(key)
      setBusy(false)
      if (failure) {
        setError(failure)
        return false
      }
      setKey('')
      await refreshLicense()
      return true
    }
  }
}
