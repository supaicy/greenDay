import { describe, it, expect } from 'vitest'
import { isLocalAiConfig } from './ai-config'

describe('isLocalAiConfig', () => {
  it('ollama + localhost/127.0.0.1/::1 이면 온디바이스(true)', () => {
    expect(isLocalAiConfig({ provider: 'ollama', baseUrl: 'http://localhost:11434' })).toBe(true)
    expect(isLocalAiConfig({ provider: 'ollama', baseUrl: 'http://127.0.0.1:11434' })).toBe(true)
    expect(isLocalAiConfig({ provider: 'ollama', baseUrl: 'http://[::1]:11434' })).toBe(true)
  })

  it('ollama라도 원격 baseUrl이면 false', () => {
    expect(isLocalAiConfig({ provider: 'ollama', baseUrl: 'http://192.168.0.5:11434' })).toBe(false)
    expect(isLocalAiConfig({ provider: 'ollama', baseUrl: 'https://ollama.example.com' })).toBe(false)
  })

  it('외부 제공자는 항상 false', () => {
    expect(isLocalAiConfig({ provider: 'openai', baseUrl: 'https://api.openai.com' })).toBe(false)
    expect(isLocalAiConfig({ provider: 'custom', baseUrl: 'http://localhost:1234' })).toBe(false)
  })

  it('잘못된 URL은 false', () => {
    expect(isLocalAiConfig({ provider: 'ollama', baseUrl: 'not-a-url' })).toBe(false)
  })
})
