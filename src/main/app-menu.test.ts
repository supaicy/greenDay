import { describe, it, expect, vi } from 'vitest'

// electron 없이 템플릿만 검사한다 — Menu.buildFromTemplate은 받은 것을 그대로 돌려준다.
const setApplicationMenu = vi.fn()
vi.mock('electron', () => ({
  Menu: {
    buildFromTemplate: (template: unknown) => template,
    setApplicationMenu: (m: unknown) => setApplicationMenu(m)
  }
}))

const { buildAppMenu, applyAppMenu, applyLanguage } = await import('./app-menu')
const { setUiLanguage, uiStrings } = await import('./ui-language')
const { mainStrings } = await import('../shared/main-strings')

/** 중첩 메뉴를 평평하게 — role과 label 문자열만 모은다. */
function entries(menu: unknown): string[] {
  if (!Array.isArray(menu)) return []
  return menu.flatMap((item: Record<string, unknown>) => [
    ...(typeof item.role === 'string' ? [item.role] : []),
    ...(typeof item.label === 'string' ? [item.label] : []),
    ...entries(item.submenu)
  ])
}

describe('앱 메뉴', () => {
  it('출하 빌드에는 개발자 도구 항목이 없다', () => {
    // 렌더러 잠금만 있던 동안 이 항목이 그대로 나갔고, 다이얼로그 DOM을 지우면
    // 잠긴 앱이 열렸다. 진짜 게이트는 이제 메인에 있지만, 우회를 한 단계 더
    // 뒤로 미루는 것이 이 설계의 목표다.
    const found = entries(buildAppMenu(false))
    expect(found).not.toContain('toggleDevTools')
    // `viewMenu` 역할을 통째로 쓰면 그 안에 toggleDevTools가 숨어 들어온다.
    expect(found).not.toContain('viewMenu')
  })

  it('편집 단축키는 살아 있다 — 메뉴를 통째로 없애면 macOS에서 Cmd+C가 죽는다', () => {
    const found = entries(buildAppMenu(false))
    expect(found).toContain('editMenu')
    expect(found).toContain('fileMenu')
    expect(found).toContain('windowMenu')
  })

  it('확대·전체화면은 남는다', () => {
    const found = entries(buildAppMenu(false))
    expect(found).toContain('zoomIn')
    expect(found).toContain('togglefullscreen')
  })

  it('보기 메뉴 라벨이 UI 언어를 따라간다', async () => {
    // 하드코딩하면 다음 사람이 "환경설정…"을 넣을 때도 하드코딩하고,
    // main-strings.ts가 막으려던 분산이 메뉴를 통해 돌아온다.
    //
    // 'ko'만 확인하면 안 된다. `uiLanguage`의 기본값이 'ko'라, 언어가 바뀌어도
    // 메뉴가 안 따라오는 상태에서 그 단언은 통과한다 — 실제로 그런 채로 한
    // 라운드를 지나갔고, 영어 사용자에게 메뉴만 한국어로 굳어 있었다.
    expect(entries(buildAppMenu(false))).toContain(mainStrings('ko').menuView)
    expect(setUiLanguage('en')).toBe(true)
    expect(entries(buildAppMenu(false))).toContain(mainStrings('en').menuView)
    // 같은 값을 다시 넣으면 '안 바뀌었다'고 답해야 한다 — index.ts가 이 답으로
    // 메뉴 재건축 여부를 정하므로, 늘 true면 언어 저장마다 메뉴가 다시 선다.
    expect(setUiLanguage('en')).toBe(false)
    setUiLanguage('ko')
  })

  it('개발 빌드는 기본 메뉴를 그대로 쓴다', () => {
    // DevTools 없이 개발할 수 없고, 여기서 막으면 CDP로 붙는 QA 하네스만 불편해진다.
    expect(buildAppMenu(true)).toBeNull()
  })
})

describe('applyAppMenu — 실제로 갈아끼우는가', () => {
  it('개발 빌드에서는 메뉴를 건드리지 않는다', () => {
    // `buildAppMenu`가 null을 돌려주는데 그걸 그대로 `setApplicationMenu(null)`로
    // 넘기면 macOS에서 Cmd+C/V/X/A가 통째로 죽는다. `if (menu)` 가드가 그것만
    // 막고 있는데, 지워도 테스트가 전부 통과했다.
    setApplicationMenu.mockClear()
    applyAppMenu(true)
    expect(setApplicationMenu).not.toHaveBeenCalled()
  })

  it('출하 빌드에서는 한 번 갈아끼운다', () => {
    setApplicationMenu.mockClear()
    applyAppMenu(false)
    expect(setApplicationMenu).toHaveBeenCalledTimes(1)
    expect(setApplicationMenu.mock.calls[0][0]).not.toBeNull()
  })
})

describe('applyLanguage — 언어와 메뉴의 연결', () => {
  it('언어가 바뀌면 메뉴를 다시 짓는다', () => {
    // 이 연결이 이 변경의 전부인데 테스트가 없었다. 두 줄을 `setUiLanguage(language)`
    // 한 줄로 바꿔도 860개가 전부 통과했다 — 메뉴가 언어를 따라간다는 것과
    // 언어가 실제로 배선돼 있다는 것은 따로 깨진다.
    setUiLanguage('ko')
    setApplicationMenu.mockClear()

    expect(applyLanguage('en', false)).toBe(true)
    expect(setApplicationMenu).toHaveBeenCalledTimes(1)
    expect(entries(setApplicationMenu.mock.calls[0][0])).toContain(mainStrings('en').menuView)

    // 같은 값을 다시 넣으면 다시 짓지 않는다 — 설정 저장마다 메뉴가 서면 안 된다.
    expect(applyLanguage('en', false)).toBe(false)
    expect(setApplicationMenu).toHaveBeenCalledTimes(1)
    setUiLanguage('ko')
  })

  it('모르는 언어는 받지도, 메뉴를 짓지도 않는다', () => {
    // 값은 렌더러가 IPC로 보내는 것이라 검증 없이 통과하면 `uiStrings()`가
    // undefined가 되고, 60초 리마인더 폴러가 매 틱 TypeError를 던진다.
    // `!isMainLanguage(value)` 항을 지워도 860개가 전부 통과했다.
    setUiLanguage('ko')
    setApplicationMenu.mockClear()
    for (const bad of ['ja', '', 42, null, undefined, {}, ['en']]) {
      expect(applyLanguage(bad, false), `${String(bad)}가 통과했다`).toBe(false)
    }
    expect(setApplicationMenu).not.toHaveBeenCalled()
    expect(uiStrings().reminder).toBe(mainStrings('ko').reminder)
  })
})
