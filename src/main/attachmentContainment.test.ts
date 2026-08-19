/**
 * 첨부를 여는 채널이 **폴더 밖을 못 열게** 한다.
 *
 * `shell.openPath`는 Finder에서 더블클릭하는 것과 같아서, `.app`·`.command`·`.scpt`를
 * 가리키면 실행된다. 그 채널은 무료라 잠긴 앱에서도 열려 있고, 게이트의 전제가
 * "DevTools와 `window.api.*`가 JS를 고치는 것보다 싸다"이므로 임의 경로를 받으면
 * 그 상태에서 OS 실행 원시연산을 그냥 내주는 셈이 된다.
 *
 * 쓰기 쪽(`copyAttachment`)은 처음부터 같은 판정을 하고 있었다 — 비대칭이 결함이었다.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'greenday-attach-'))

vi.mock('electron', () => ({
  app: { getPath: () => root, getVersion: () => '0.0.0-test' },
  BrowserWindow: { getAllWindows: () => [] }
}))

const { initDatabase, isInsideAttachments } = await import('./database')

const attachments = join(root, 'attachments')
const outside = join(root, 'outside')

beforeAll(() => {
  initDatabase()
  mkdirSync(outside, { recursive: true })
  writeFileSync(join(attachments, 'ok.pdf'), 'x')
  writeFileSync(join(outside, 'evil.command'), 'x')
  // 첨부 폴더 **안**에 놓인 심링크가 바깥을 가리킨다.
  symlinkSync(join(outside, 'evil.command'), join(attachments, 'looks-fine.pdf'))
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('isInsideAttachments', () => {
  it('폴더 안의 진짜 파일은 통과한다', () => {
    expect(isInsideAttachments(join(attachments, 'ok.pdf'))).toBe(true)
  })

  it('폴더 밖은 막는다', () => {
    expect(isInsideAttachments(join(outside, 'evil.command'))).toBe(false)
    expect(isInsideAttachments('/Applications/Calculator.app')).toBe(false)
  })

  it('상위로 올라가는 경로는 막는다', () => {
    expect(isInsideAttachments(join(attachments, '..', 'outside', 'evil.command'))).toBe(false)
  })

  it('이름이 앞부분만 같은 형제 폴더는 막는다 — 구분자까지 봐야 한다', () => {
    expect(isInsideAttachments(`${attachments}-evil/x`)).toBe(false)
  })

  it('폴더 자기 자신은 열 대상이 아니다', () => {
    expect(isInsideAttachments(attachments)).toBe(false)
  })

  it('**폴더 안의 심링크가 바깥을 가리키면 막는다**', () => {
    // `path.resolve`는 문자열 연산이라 심링크를 그대로 통과시킨다. 그러면 이
    // 검사가 막으려던 실행 원시연산이 그대로 돌아온다 — 첨부처럼 생긴 이름
    // 하나로 임의의 `.command`가 열린다.
    expect(isInsideAttachments(join(attachments, 'looks-fine.pdf'))).toBe(false)
  })

  it('없는 경로는 닫는 쪽으로 떨어진다', () => {
    expect(isInsideAttachments(join(attachments, 'gone.pdf'))).toBe(false)
  })
})
