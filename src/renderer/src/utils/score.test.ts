import { describe, it, expect } from 'vitest'
import { levelFromScore, levelProgress, pointsToNextLevel, pointsForTask, POINTS_PER_LEVEL } from './score'

describe('levelFromScore', () => {
  it('starts at Lv.1 with no points', () => {
    expect(levelFromScore(0)).toBe(1)
  })

  it('stays on the same level until the threshold is crossed', () => {
    expect(levelFromScore(1)).toBe(1)
    expect(levelFromScore(99)).toBe(1)
    expect(levelFromScore(100)).toBe(2)
    expect(levelFromScore(199)).toBe(2)
    expect(levelFromScore(200)).toBe(3)
  })

  it('clamps negative totals to Lv.1 instead of going below', () => {
    expect(levelFromScore(-50)).toBe(1)
  })
})

describe('levelProgress', () => {
  it('reports points earned within the current level', () => {
    expect(levelProgress(0)).toBe(0)
    expect(levelProgress(40)).toBe(40)
    expect(levelProgress(100)).toBe(0)
    expect(levelProgress(140)).toBe(40)
  })

  it('never returns a negative width', () => {
    expect(levelProgress(-10)).toBe(0)
  })
})

describe('pointsToNextLevel', () => {
  it('counts down to the next threshold', () => {
    expect(pointsToNextLevel(0)).toBe(POINTS_PER_LEVEL)
    expect(pointsToNextLevel(40)).toBe(60)
    expect(pointsToNextLevel(99)).toBe(1)
  })
})

describe('sidebar and stats agree', () => {
  // 2026-08-05 검증에서 40점일 때 사이드바 Lv.0 / 통계 Lv.1로 갈렸다.
  it('gives one answer for the score that used to disagree', () => {
    expect(levelFromScore(40)).toBe(1)
    expect(levelProgress(40)).toBe(40)
  })
})

describe('pointsForTask', () => {
  it('pays more for higher priority', () => {
    expect(pointsForTask('high')).toBe(3)
    expect(pointsForTask('medium')).toBe(2)
    expect(pointsForTask('low')).toBe(1)
    expect(pointsForTask('none')).toBe(1)
  })
})
