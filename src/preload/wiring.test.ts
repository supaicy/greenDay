import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

/**
 * IPC 배관이 양쪽 끝에서 실제로 쓰이는지 지킨다.
 *
 * 2026-08-05 전수 검증에서 렌더러가 한 번도 부르지 않는 IPC가 7개 쌓여 있었다
 * (reorder-lists, get-attachments-dir, show-notification, ai:chat …). 타입체크·린트·테스트를
 * 전부 통과하므로 사람이 눈으로 찾기 전까지 계속 늘어난다. 이 테스트가 다음 라운드를 막는다.
 */

const ROOT = path.resolve(__dirname, '..')
const PRELOAD = readFileSync(path.join(ROOT, 'preload/index.ts'), 'utf-8')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

/**
 * 채널을 등록하는 두 형태를 모두 잡는다.
 *
 * 메인은 `ipcMain.handle`을 직접 부르지 않고 라이선스 게이트(`main/ipc-gate.ts`의
 * `handle(channel, tier, listener)`)로만 등록한다. `ipcMain.handle`만 찾으면 채널
 * 60여 개가 통째로 안 보이고, 이 파일의 검사가 전부 공짜로 통과한다.
 */
const CHANNEL_RE = /(?:ipcMain\.)?\bhandle\(\s*['"]([^'"]+)['"]/g

const mainSource = walk(path.join(ROOT, 'main'))
  .map((f) => readFileSync(f, 'utf-8'))
  .join('\n')

const rendererSource = walk(path.join(ROOT, 'renderer'))
  .map((f) => readFileSync(f, 'utf-8'))
  .join('\n')

describe('IPC wiring', () => {
  it('exposes every main-process channel through preload', () => {
    const channels = [...mainSource.matchAll(CHANNEL_RE)].map((m) => m[1])
    expect(channels.length).toBeGreaterThan(20) // 정규식이 조용히 0건이 되는 걸 막는 하한

    const orphans = channels.filter((c) => !PRELOAD.includes(`'${c}'`))
    expect(orphans, `preload에서 부르지 않는 IPC 채널: ${orphans.join(', ')}`).toEqual([])
  })

  it('has a main handler for every channel preload invokes', () => {
    // 이 방향이 런타임에 터진다 — 핸들러를 지우면 'No handler registered for X'.
    const handled = new Set([...mainSource.matchAll(CHANNEL_RE)].map((m) => m[1]))
    const invoked = [...PRELOAD.matchAll(/invoke\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1])
    expect(invoked.length).toBeGreaterThan(20)

    const missing = invoked.filter((c) => !handled.has(c))
    expect(missing, `main에 핸들러가 없는 채널: ${missing.join(', ')}`).toEqual([])
  })

  it('has a renderer caller for every api method preload exposes', () => {
    // `  name: (...)` 형태의 최상위 키만 뽑는다(들여쓰기 2칸).
    const methods = [...PRELOAD.matchAll(/^ {2}([a-zA-Z][a-zA-Z0-9]*):/gm)].map((m) => m[1])
    expect(methods.length).toBeGreaterThan(30)

    // 호출 형태(api.x)로 찾는다. 이름만 맞대면 스토어 액션과 겹치는 이름(updateTask,
    // removeTask, exportData …)이 전부 통과해 버려서, 정작 잡으려던 고아 API를 놓친다.
    const unused = methods.filter((m) => !new RegExp(`api\\s*\\.\\s*${m}\\b`).test(rendererSource))
    expect(unused, `렌더러가 부르지 않는 preload API: ${unused.join(', ')}`).toEqual([])
  })
})
