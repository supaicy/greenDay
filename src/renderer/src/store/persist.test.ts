// @vitest-environment jsdom
/**
 * 잠긴 채널의 거절이 **어디로 가는가**.
 *
 * 메인의 게이트가 유료 채널을 거절할 때(`ipc-gate.ts`) 렌더러는 이미 낙관적으로
 * 화면을 바꾼 뒤다. 그 거절을 아무도 받지 않으면 처리되지 않은 rejection이 되고,
 * 사용자에게는 편집이 된 것처럼 보이다가 재시작하면 사라진다 — 게이트가 던지는
 * 이유로 적어 둔 "유령 편집"이 정확히 그것인데, 한동안 렌더러 쪽이 비어 있었다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const licenseGetState = vi.fn(async () => ({
  status: 'trialExpired',
  untilMs: null,
  allowsPaidFeatures: false,
  enforced: true,
  maskedKey: null,
  deviceName: null
}))

beforeEach(() => {
  licenseGetState.mockClear()
  ;(window as unknown as Record<string, unknown>).api = {
    licenseGetState,
    onLicenseChanged: vi.fn(() => () => {})
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

const { useStore } = await import('./useStore')

describe('잠긴 채널의 거절', () => {
  it('처리되지 않은 rejection으로 새지 않는다', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      // 유료 채널이 전부 거절하는 잠긴 상태.
      ;(window as unknown as { api: Record<string, unknown> }).api.deleteTask = vi.fn(() =>
        Promise.reject(new Error("Error invoking remote method 'delete-task': Error: license_required"))
      )
      useStore.getState().removeTask('nope')
      await new Promise((r) => setTimeout(r, 10))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
      errors.mockRestore()
    }
  })

  it('잠김이면 라이선스 상태를 다시 받아온다 — 그래야 잠금 화면이 뜬다', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      ;(window as unknown as { api: Record<string, unknown> }).api.deleteTask = vi.fn(() =>
        Promise.reject(new Error("Error invoking remote method 'delete-task': Error: license_required"))
      )
      licenseGetState.mockClear()
      useStore.getState().removeTask('nope')
      await new Promise((r) => setTimeout(r, 10))
      // Electron이 문구를 감싸므로 포함 검사여야 한다. `===`면 여기가 0이 된다.
      expect(licenseGetState).toHaveBeenCalled()
    } finally {
      errors.mockRestore()
    }
  })

  it('잠김이 아닌 실패로는 라이선스를 다시 묻지 않는다', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      ;(window as unknown as { api: Record<string, unknown> }).api.deleteTask = vi.fn(() =>
        Promise.reject(new Error('EACCES: permission denied'))
      )
      licenseGetState.mockClear()
      useStore.getState().removeTask('nope')
      await new Promise((r) => setTimeout(r, 10))
      expect(licenseGetState).not.toHaveBeenCalled()
    } finally {
      errors.mockRestore()
    }
  })
})
