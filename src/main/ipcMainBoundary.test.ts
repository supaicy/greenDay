/**
 * IPC 등록 통로가 **하나뿐인지** 소스에서 확인한다.
 *
 * 등급이 필수 인자라도, `ipcMain.handle`을 직접 부르면 그 채널은 등급을 고르지
 * 않은 채 그냥 열린다. 전에 실제로 그랬다 — 게이트가 `ipc-handlers.ts`의 파일
 * 지역 헬퍼였을 때 `index.ts`가 raw `ipcMain.handle`로 등록한 채널 셋이 열려
 * 있었고, 정책을 지키던 테스트는 그 파일을 훑지도 않아 볼 수조차 없었다.
 *
 * **린트와 겹쳐서 두 구멍을 메운다.** `biome.json`의 `noRestrictedImports`가
 * `src/main/**`에서 `ipcMain` 임포트를 막는데(별칭 `ipcMain as m`까지 잡는다),
 * `import * as el from 'electron'` 뒤의 `el.ipcMain.handle`은 임포트 이름이
 * 아니라서 못 본다. 그쪽은 호출 모양이 남으므로 여기서 잡는다.
 *
 * 이 파일에 픽스처가 없는 것이 핵심이다. `ipc-gate.test.ts`에 있었을 때는
 * 핸들러 전체를 import해야 해서, 그 그래프가 한 번 깨지면 이 가드까지 같이
 * 쓰러졌다.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** 주석이 아니라 **호출**만 센다. 이 저장소는 주석에 코드 모양을 자주 적는다. */
const DIRECT_CALL = /(?:^|[^\w.])(?:\w+\.)?ipcMain\s*\.\s*handle\s*\(/

describe('IPC 등록 경계', () => {
  it('ipcMain.handle은 게이트 안에서만 불린다', () => {
    const offenders = sourceFiles(__dirname)
      .filter((file) => !file.endsWith('ipc-gate.ts'))
      .filter((file) => DIRECT_CALL.test(stripComments(readFileSync(file, 'utf-8'))))
      .map((file) => file.slice(__dirname.length + 1))
    expect(offenders, `게이트를 우회해 등록하는 파일: ${offenders.join(', ')}`).toEqual([])
  })

  it('실제로 훑는다', () => {
    // 경로가 틀리거나 필터가 너무 세면 0개를 훑고 조용히 통과한다.
    expect(sourceFiles(__dirname).length).toBeGreaterThan(10)
  })
})

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf-8' })
    .filter((rel) => rel.endsWith('.ts') && !/\.test\.tsx?$/.test(rel))
    .map((rel) => join(dir, rel))
}

/** 블록·줄 주석을 지운다 — 문자열 안의 `//`는 이 검사에서 문제가 되지 않는다. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}
