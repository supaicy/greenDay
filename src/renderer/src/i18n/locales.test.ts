import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import i18n, { tList } from './index'
import type { ActivateFailure, DeactivateFailure } from '../../../shared/license'
import ko from './locales/ko.json'
import en from './locales/en.json'

type Json = Record<string, unknown>

/** 중첩 객체를 'a.b.c' 형태의 평평한 키 집합으로. 배열은 잎으로 취급한다. */
function flatten(obj: Json, prefix = ''): Set<string> {
  const keys = new Set<string>()
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      for (const nested of flatten(v as Json, path)) keys.add(nested)
    } else {
      keys.add(path)
    }
  }
  return keys
}

/** {{name}} 보간 변수 목록 */
function placeholders(value: string): Set<string> {
  return new Set(Array.from(value.matchAll(/\{\{(\w+)\}\}/g), (m) => m[1]))
}

function leaves(obj: Json, prefix = ''): [string, unknown][] {
  const out: [string, unknown][] = []
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...leaves(v as Json, path))
    } else {
      out.push([path, v])
    }
  }
  return out
}

const koKeys = flatten(ko as Json)
const enKeys = flatten(en as Json)

describe('locale files', () => {
  it('ko와 en의 키 집합이 완전히 같다', () => {
    expect([...koKeys].filter((k) => !enKeys.has(k)).sort()).toEqual([])
    expect([...enKeys].filter((k) => !koKeys.has(k)).sort()).toEqual([])
  })

  it('같은 키의 보간 변수가 두 언어에서 일치한다', () => {
    const mismatches: string[] = []
    const enMap = new Map(leaves(en as Json))
    for (const [key, koValue] of leaves(ko as Json)) {
      const enValue = enMap.get(key)
      if (typeof koValue !== 'string' || typeof enValue !== 'string') continue
      const a = [...placeholders(koValue)].sort()
      const b = [...placeholders(enValue)].sort()
      if (a.join(',') !== b.join(',')) mismatches.push(`${key}: ko(${a}) vs en(${b})`)
    }
    expect(mismatches).toEqual([])
  })

  it('배열 리소스는 두 언어에서 길이가 같다', () => {
    const mismatches: string[] = []
    const enMap = new Map(leaves(en as Json))
    for (const [key, koValue] of leaves(ko as Json)) {
      const enValue = enMap.get(key)
      if (!Array.isArray(koValue) || !Array.isArray(enValue)) continue
      if (koValue.length !== enValue.length) {
        mismatches.push(`${key}: ko(${koValue.length}) vs en(${enValue.length})`)
      }
    }
    expect(mismatches).toEqual([])
  })

  it('소스에서 리터럴로 참조하는 키가 모두 로케일에 있다', () => {
    // t('a.b') / i18n.t('a.b') / tList('a.b') / i18nKey="a.b" 중 리터럴만 검사한다.
    // 템플릿 리터럴(t(`nav.${id}`))은 정적으로 알 수 없으므로 건너뛴다.
    const pattern = /(?:\bt|i18n\.t|tList)\(\s*'([a-z][\w.]*)'|i18nKey="([\w.]+)"/g
    const missing: string[] = []
    for (const file of walk(join(__dirname, '..'))) {
      const src = readFileSync(file, 'utf-8')
      for (const m of src.matchAll(pattern)) {
        const key = m[1] ?? m[2]
        // 점이 없으면 우리 키 형식이 아니다(예: 다른 함수의 인자).
        if (!key.includes('.')) continue
        // 복수형 키는 리소스에 key_one/key_other 로만 존재한다.
        const exists = koKeys.has(key) || koKeys.has(`${key}_one`) || koKeys.has(`${key}_other`)
        if (!exists) missing.push(`${file.split('/src/')[1]}: ${key}`)
      }
    }
    expect(missing).toEqual([])
  })
})

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'locales') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      yield* walk(full)
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      yield full
    }
  }
}

describe('조합된 문구', () => {
  // "2026년 7월월"처럼 토큰과 템플릿이 접미사를 이중으로 붙이던 회귀를 막는다.
  // date.months 항목은 한국어에서 이미 '월'을 포함하므로 템플릿은 붙이면 안 된다.
  it('주간 캘린더 헤더에 월 표기가 중복되지 않는다', () => {
    const tKo = i18n.getFixedT('ko')
    const months = tList('date.months', 'ko')
    expect(tKo('calendar.weekRangeSameMonth', { year: 2026, month: months[6] })).toBe('2026년 7월')
    expect(tKo('calendar.weekRangeSameYear', { year: 2026, from: months[6], to: months[7] })).toBe('2026년 7월 - 8월')
    expect(
      tKo('calendar.weekRangeCrossYear', {
        fromYear: 2026,
        from: months[11],
        toYear: 2027,
        to: months[0]
      })
    ).toBe('2026년 12월 - 2027년 1월')
  })

  it('영어 주간 캘린더 헤더', () => {
    const tEn = i18n.getFixedT('en')
    const months = tList('date.months', 'en')
    expect(tEn('calendar.weekRangeSameMonth', { year: 2026, month: months[7] })).toBe('Aug 2026')
    expect(tEn('calendar.weekRangeSameYear', { year: 2026, from: months[6], to: months[7] })).toBe('Jul – Aug 2026')
  })

  it('시각 표기는 언어별 어순을 따른다', () => {
    const tKo = i18n.getFixedT('ko')
    const tEn = i18n.getFixedT('en')
    expect(tKo('date.hour', { period: tKo('date.pm'), hour: 3 })).toBe('오후 3시')
    expect(tEn('date.hour', { period: tEn('date.pm'), hour: 3 })).toBe('3 PM')
    expect(tKo('date.hourMinute', { period: tKo('date.am'), hour: 9, minute: '30' })).toBe('오전 9:30')
    expect(tEn('date.hourMinute', { period: tEn('date.am'), hour: 9, minute: '30' })).toBe('9:30 AM')
  })

  it('영어 복수형이 count에 따라 갈린다', () => {
    const tEn = i18n.getFixedT('en')
    expect(tEn('task.count', { count: 1 })).toBe('1 task')
    expect(tEn('task.count', { count: 3 })).toBe('3 tasks')
    expect(tEn('timeline.taskCount', { count: 1 })).toBe('1 task')
    expect(tEn('timeline.taskCount', { count: 2 })).toBe('2 tasks')
  })

  it('한국어는 수량에 관계없이 한 형태만 쓴다', () => {
    const tKo = i18n.getFixedT('ko')
    expect(tKo('task.count', { count: 1 })).toBe('1개')
    expect(tKo('task.count', { count: 3 })).toBe('3개')
  })
})

/**
 * 위의 "소스에서 리터럴로 참조하는 키" 검사는 템플릿 리터럴을 건너뛴다. 라이선스
 * 실패 문구는 전부 `t(`license.error.${code}`)`로 조회되므로 그 검사에 안 걸린다.
 *
 * 빠지면 증상이 최악이다 — 활성화가 실패한 바로 그 순간 사용자가
 * `license.error.somethingNew`라는 날문자열을 본다.
 */
describe('라이선스 실패 코드 문구', () => {
  // 유니온을 Record 키로 받아, 코드가 늘면 **여기서 타입 에러**가 나게 한다.
  const ACTIVATE: Record<ActivateFailure, true> = {
    invalidKey: true,
    noDevice: true,
    badToken: true,
    saveFailed: true,
    incomplete: true,
    unknownKey: true,
    revoked: true,
    deviceLimit: true,
    deactivationLimit: true,
    deviceNotActive: true,
    malformedKey: true,
    network: true
  }
  const DEACTIVATE: Record<DeactivateFailure, true> = {
    nothing: true,
    noDevice: true,
    deactivationLimit: true,
    refused: true,
    saveFailed: true,
    network: true
  }

  const errorTable = (locale: Json): Record<string, unknown> =>
    (locale.license as Record<string, Record<string, unknown>>).error

  it('모든 실패 코드가 ko·en 양쪽에 문구를 갖는다', () => {
    const codes = [...new Set([...Object.keys(ACTIVATE), ...Object.keys(DEACTIVATE)])]
    expect(codes.filter((c) => typeof errorTable(ko as Json)[c] !== 'string')).toEqual([])
    expect(codes.filter((c) => typeof errorTable(en as Json)[c] !== 'string')).toEqual([])
  })

  it('쓰지 않는 문구가 남아 있지 않다', () => {
    // 코드를 지우고 문구만 남으면, 다음 사람이 그 코드가 아직 있다고 믿는다.
    const codes = new Set([...Object.keys(ACTIVATE), ...Object.keys(DEACTIVATE)])
    expect(Object.keys(errorTable(ko as Json)).filter((k) => !codes.has(k))).toEqual([])
  })

  it('성공 문구도 있다', () => {
    // en 쪽은 위의 "ko와 en의 키 집합이 완전히 같다"가 이미 보장한다.
    expect(['license.activated', 'license.deactivated'].filter((k) => !koKeys.has(k))).toEqual([])
  })
})
