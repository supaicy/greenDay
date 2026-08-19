import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFileStore, EMPTY_RECORD, type LicenseRecord } from './licenseStore'

let dir: string
let path: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'greenday-license-'))
  path = join(dir, 'license.json')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const write = (raw: string): void => writeFileSync(path, raw, 'utf-8')

describe('createFileStore — 읽기', () => {
  it('파일이 없으면 빈 레코드', () => {
    expect(createFileStore(path).read()).toEqual(EMPTY_RECORD)
  })

  it('저장한 것을 그대로 돌려준다', () => {
    const record: LicenseRecord = {
      key: 'GREENDAY-A2B3-C4D5-E6F7-G8H9',
      token: 'tok.sig',
      lastSeenMs: 1_800_000_000_000,
      trialStartMs: 1_790_000_000_000
    }
    const store = createFileStore(path)
    store.write(record)
    expect(createFileStore(path).read()).toEqual(record)
  })

  it('깨진 JSON은 빈 레코드로 떨어진다', () => {
    // 여기서 던지면 앱이 시작하다 죽는다. 라이선스를 못 읽는 것보다 나쁜 결과다.
    write('{ this is not json')
    expect(createFileStore(path).read()).toEqual(EMPTY_RECORD)
  })

  it('JSON이지만 객체가 아니면 빈 레코드', () => {
    for (const raw of ['[1,2,3]', '"a string"', 'null', '42']) {
      write(raw)
      expect(createFileStore(path).read()).toEqual(EMPTY_RECORD)
    }
  })
})

describe('createFileStore — 손으로 고쳐진 값', () => {
  it('타입이 어긋난 필드는 기본값으로 되돌린다', () => {
    // lastSeenMs가 문자열이면 시각 비교가 조용히 이상해진다. 그 조용함이
    // 여기서는 곧 만료되지 않는 상태다.
    write(JSON.stringify({ key: 42, token: {}, lastSeenMs: '9999999999999', trialStartMs: 'soon' }))
    expect(createFileStore(path).read()).toEqual(EMPTY_RECORD)
  })

  it('NaN·Infinity도 받아들이지 않는다', () => {
    // JSON에 그대로는 못 쓰지만 1e999는 파싱하면 Infinity가 된다.
    write('{"lastSeenMs": 1e999, "trialStartMs": 1e999}')
    const record = createFileStore(path).read()
    expect(record.lastSeenMs).toBe(0)
    expect(record.trialStartMs).toBeNull()
  })

  it('모르는 필드는 조용히 버린다', () => {
    // 예전 설계가 신뢰하던 "마지막 확인 시각" 같은 것을 넣어봐야 실리지 않는다.
    write(JSON.stringify({ lastVerified: 4_102_444_800_000, seats: 99, lastSeenMs: 5 }))
    expect(createFileStore(path).read()).toEqual({ ...EMPTY_RECORD, lastSeenMs: 5 })
  })

  it('일부 필드만 있어도 나머지는 기본값', () => {
    write(JSON.stringify({ key: 'GREENDAY-A2B3-C4D5-E6F7-G8H9' }))
    expect(createFileStore(path).read()).toEqual({ ...EMPTY_RECORD, key: 'GREENDAY-A2B3-C4D5-E6F7-G8H9' })
  })
})

describe('createFileStore — 쓰기', () => {
  it('사람이 읽을 수 있게 쓴다', () => {
    createFileStore(path).write({ ...EMPTY_RECORD, lastSeenMs: 7 })
    expect(readFileSync(path, 'utf-8')).toContain('\n  "lastSeenMs": 7')
  })

  it('쓸 수 없어도 던지지 않되, 실패를 숨기지도 않는다', () => {
    // 디스크가 안 되면 이번 실행 동안 메모리 상태로 계속 간다. 여기서 던지면
    // 라이선스 저장 실패가 앱 전체를 죽인다. 대신 삼키지 않고 false를 낸다 —
    // 활성화가 "성공했다고 답했는데 재시작하면 사라지는" 결과를 막는 신호다.
    const unwritable = join(dir, 'nested')
    mkdirSync(unwritable)
    const store = createFileStore(unwritable) // 디렉터리에 쓰려는 시도 → EISDIR
    expect(() => store.write(EMPTY_RECORD)).not.toThrow()
    expect(store.write(EMPTY_RECORD)).toBe(false)
  })

  it('성공하면 true', () => {
    expect(createFileStore(path).write(EMPTY_RECORD)).toBe(true)
  })

  it('제자리에서 자르지 않는다 — 쓰다 끊겨도 옛 레코드가 남는다', () => {
    // 제자리 쓰기는 전원이 끊긴 순간 깨진 JSON을 남기고, 그걸 parseRecord가
    // 빈 레코드로 읽는다 — 돈 낸 사람의 활성화가 조용히 사라진다.
    const store = createFileStore(path)
    const good: LicenseRecord = { key: 'GREENDAY-A2B3-C4D5-E6F7-G8H9', token: 'tok', lastSeenMs: 7, trialStartMs: 3 }
    store.write(good)

    // 임시 파일에 쓰고 rename하는지 — 쓰기 도중의 내용이 본 파일에 닿지 않는다.
    const during = readFileSync(path, 'utf-8')
    expect(JSON.parse(during)).toEqual(good)
    expect(existsSync(`${path}.tmp`)).toBe(false)
  })

  it('실패한 쓰기가 임시 파일을 남기지 않는다', () => {
    const unwritable = join(dir, 'nested2')
    mkdirSync(unwritable)
    createFileStore(unwritable).write(EMPTY_RECORD)
    expect(existsSync(`${unwritable}.tmp`)).toBe(false)
  })
})

// `durable`은 fsync를 걸지 말지만 고른다 — 결과 파일과 실패 처리는 같아야 한다.
// 두 갈래가 갈린 뒤로 기본값(false)만 시험하면, 활성화가 쓰는 **바로 그 갈래**가
// 시험되지 않은 채 남는다. fsync 자체는 관찰할 수 없으니 나머지 전부를 겹쳐 본다.
describe.each([[false], [true]])('createFileStore — 쓰기 (durable=%s)', (durable) => {
  const record: LicenseRecord = {
    key: 'GREENDAY-A2B3-C4D5-E6F7-G8H9',
    token: 'tok.sig',
    lastSeenMs: 1_800_000_000_000,
    trialStartMs: 1_700_000_000_000
  }

  it('쓴 것을 그대로 다시 읽는다', () => {
    const store = createFileStore(path)
    expect(store.write(record, durable)).toBe(true)
    expect(store.read()).toEqual(record)
    expect(existsSync(`${path}.tmp`)).toBe(false)
  })

  it('사람이 읽을 수 있게 쓴다', () => {
    createFileStore(path).write(record, durable)
    expect(readFileSync(path, 'utf-8')).toContain('\n  "lastSeenMs": 1800000000000')
  })

  it('한글이 섞여도 깨지지 않는다', () => {
    // durable 갈래는 `writeSync(fd, string, position, encoding)`이라 인코딩을
    // 인자로 준다. 위치와 인코딩 자리를 바꿔 쓰면 latin1로 떨어져 조용히 깨진다.
    const store = createFileStore(path)
    store.write({ ...record, key: '한글-키-テスト' }, durable)
    expect(store.read().key).toBe('한글-키-テスト')
  })

  it('쓸 수 없으면 false를 내고 임시 파일을 남기지 않는다', () => {
    const unwritable = join(dir, `nested-${durable}`)
    mkdirSync(unwritable)
    const store = createFileStore(unwritable)
    expect(() => store.write(record, durable)).not.toThrow()
    expect(store.write(record, durable)).toBe(false)
    expect(existsSync(`${unwritable}.tmp`)).toBe(false)
  })
})
