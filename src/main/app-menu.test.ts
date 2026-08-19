import { describe, it, expect, vi } from 'vitest'

// electron 없이 템플릿만 검사한다 — Menu.buildFromTemplate은 받은 것을 그대로 돌려준다.
vi.mock('electron', () => ({
  Menu: { buildFromTemplate: (template: unknown) => template }
}))

const { buildAppMenu } = await import('./app-menu')

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

  it('보기 메뉴 라벨은 main-strings에서 온다', async () => {
    // 하드코딩하면 다음 사람이 "환경설정…"을 넣을 때도 하드코딩하고,
    // main-strings.ts가 막으려던 분산이 메뉴를 통해 돌아온다.
    const { mainStrings } = await import('../shared/main-strings')
    expect(entries(buildAppMenu(false))).toContain(mainStrings('ko').menuView)
  })

  it('개발 빌드는 기본 메뉴를 그대로 쓴다', () => {
    // DevTools 없이 개발할 수 없고, 여기서 막으면 CDP로 붙는 QA 하네스만 불편해진다.
    expect(buildAppMenu(true)).toBeNull()
  })
})
