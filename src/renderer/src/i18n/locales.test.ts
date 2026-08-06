import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import i18n, { tList } from './index'
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
