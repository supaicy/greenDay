import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FREE_CHANNELS, isChannelLocked } from './freeChannels'

/**
 * 허용 목록이 실제 채널 집합과 붙어 있는지 지킨다.
 *
 * 잠금은 메인 프로세스에서 걸리므로, 여기서 한 글자 어긋나면 두 방향 모두 조용하다:
 * 무료여야 할 채널이 빠지면 **돈 낸 사람이 잠기고**, 유료여야 할 채널이 들어가면
 * **게이트가 새어 나간다.** 어느 쪽도 타입체크나 린트가 잡지 못한다.
 */

const SOURCE = readFileSync(join(__dirname, '..', 'ipc-handlers.ts'), 'utf-8')

/** `setupIpcHandlers` 안에서 등록되는 채널 전부. */
const registered = [...SOURCE.matchAll(/^ {2}handle\(\s*'([^']+)'/gm)].map((m) => m[1])

describe('IPC 잠금 허용 목록', () => {
  it('채널을 실제로 걷어 온다', () => {
    // 정규식이 조용히 0건이 되면 아래 검사가 전부 공짜로 통과한다.
    expect(registered.length).toBeGreaterThan(50)
  })

  it('허용 목록에 존재하지 않는 채널이 없다', () => {
    // 채널 이름을 바꾸면서 여기를 안 고치면, 그 채널은 이름만 남고 유료가 된다.
    const ghosts = [...FREE_CHANNELS].filter((c) => !registered.includes(c))
    expect(ghosts, `등록되지 않은 채널이 허용 목록에 있다: ${ghosts.join(', ')}`).toEqual([])
  })

  it('읽기 채널은 전부 무료다 — 잠긴 화면도 자기를 그릴 수 있어야 한다', () => {
    const reads = registered.filter((c) => /(^|:)get-/.test(c))
    const locked = reads.filter((c) => !FREE_CHANNELS.has(c))
    expect(locked, `읽기인데 잠긴 채널: ${locked.join(', ')}`).toEqual([])
  })

  it('내보내기와 라이선스 자체는 무료다 — 데이터를 인질로 잡지 않는다', () => {
    for (const channel of ['export-data', 'license:state', 'license:activate', 'license:deactivate']) {
      expect(FREE_CHANNELS.has(channel), `${channel}이 잠겨 있다`).toBe(true)
    }
  })

  it('쓰기 채널은 하나도 무료가 아니다', () => {
    // 이게 게이트다. 하나라도 새면 그 기능만 무료가 된다.
    const writes = registered.filter((c) =>
      /^(create|update|delete|restore|permanent-delete|reorder|batch|empty|toggle|save|add|pick)-/.test(c)
    )
    expect(writes.length).toBeGreaterThan(15)
    const leaked = writes.filter((c) => FREE_CHANNELS.has(c))
    expect(leaked, `쓰기인데 무료로 열린 채널: ${leaked.join(', ')}`).toEqual([])
  })

  it('동기화와 AI 동작도 유료다', () => {
    const paid = [
      'ai:create-task',
      'ai:interpret-action',
      'ai:stream-chat',
      'ai:set-config',
      'calendar:sync-now',
      'google:sync-now',
      'google:connect'
    ]
    const leaked = paid.filter((c) => FREE_CHANNELS.has(c))
    expect(leaked, `유료여야 하는데 무료인 채널: ${leaked.join(', ')}`).toEqual([])
    // 목록에 오타가 나면 위 검사가 공짜로 통과하므로, 실제 등록 여부도 본다.
    expect(paid.filter((c) => !registered.includes(c))).toEqual([])
  })

  it('새로 생긴 채널은 기본이 유료다', () => {
    // 허용 목록에 없는 것이 잠긴다는 뜻이고, 그게 안전한 실패 방향이다.
    // 이 테스트는 그 기본값이 뒤집히면(예: 유료 목록으로 바뀌면) 빨개진다.
    const unknown = registered.filter((c) => !FREE_CHANNELS.has(c))
    expect(unknown.length).toBeGreaterThan(0)
    expect(unknown).toContain('create-task')
  })
})

describe('isChannelLocked — 게이트가 실제로 막는가', () => {
  const paid = registered.filter((c) => !FREE_CHANNELS.has(c))
  const free = registered.filter((c) => FREE_CHANNELS.has(c))

  it('유료 상태가 아니면 유료 채널을 전부 막는다', () => {
    // 이게 게이트의 전부다. 확인 한 줄을 지워도 통과하던 시절이 있었으므로,
    // 실제 채널 목록을 열거해서 못 박는다.
    expect(paid.length).toBeGreaterThan(30)
    const leaked = paid.filter((c) => !isChannelLocked(c, false))
    expect(leaked, `잠겨야 하는데 열린 채널: ${leaked.join(', ')}`).toEqual([])
  })

  it('유료 상태면 아무것도 막지 않는다', () => {
    const blocked = registered.filter((c) => isChannelLocked(c, true))
    expect(blocked, `돈 낸 사람에게 막힌 채널: ${blocked.join(', ')}`).toEqual([])
  })

  it('잠긴 상태에서도 읽기·내보내기·라이선스는 열린다', () => {
    expect(free.length).toBeGreaterThan(15)
    const blocked = free.filter((c) => isChannelLocked(c, false))
    expect(blocked, `잠긴 화면에서 막히면 안 되는 채널: ${blocked.join(', ')}`).toEqual([])
  })

  it('초기화에 실패한 빌드는 아무도 잠그지 않는다', () => {
    // 우리 실수로 돈 낸 사람을 막는 것보다, 못 막는 편이 낫다.
    const blocked = registered.filter((c) => isChannelLocked(c, null))
    expect(blocked).toEqual([])
  })
})
