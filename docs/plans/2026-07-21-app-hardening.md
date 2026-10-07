# App Hardening (헬스 + 보안) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** haru macOS 앱을 정식 출시 전 헬스 그린 + 보안 하드닝 상태로 만든다 (스펙 작업 A + E1).

**Architecture:** 기존 Electron main/renderer 구조를 유지한다. 보안 로직은 테스트 가능한 순수 함수로 분리하고(주입식 의존성), IPC 경계에 입력 검증을 추가한다. UI 접근성은 biome 규칙을 그린으로 만든다. 소스 코드 분기는 만들지 않는다(패키징은 Plan 2).

**Tech Stack:** Electron 40, React 19, Zustand 5, TypeScript 5.7, vitest 4, biome 2.4, electron `safeStorage`.

## Global Constraints

- 커밋 메시지에 Claude Co-Authored-By 트레일러를 **넣지 않는다** (사용자 전역 훅이 제거함).
- 브랜치: `supaicy/coordinate`. main에 직접 커밋 금지.
- 각 태스크 종료 시 `npx tsc --build`, `npx biome lint src electron.vite.config.ts`, `npx vitest run` **모두 그린**이어야 한다. (로컬 바이너리 사용: `./node_modules/.bin/<tool>`.)
- 기존 파일 관례를 따른다: 한국어 주석, main 프로세스 동기 파일 I/O, 단순 IPC.
- 신규 기능 추가 금지. 이 계획은 하드닝/정리만 한다.

---

### Task 1: AI 채팅 한국어 출력 강제 + 스트리밍 프롬프트 DRY

3B 모델이 한국어 질문에 언어를 혼용해 답하는 문제(`TODOS.md` Follow-up)를 시스템 프롬프트로 완화한다. 동시에 `chat()`용 프롬프트와 `streamChat()`의 인라인 중복 프롬프트를 공통 함수로 합친다.

**Files:**
- Modify: `src/main/ai-service.ts:137-147` (buildChatSystemPrompt), `:294-301` (streamChat 인라인 프롬프트)
- Test: `src/main/ai-service.test.ts`

**Interfaces:**
- Produces: `export function chatPromptBase(taskSummary: string): string`, `export function buildChatSystemPrompt(taskSummary: string): string`

- [ ] **Step 1: 실패하는 테스트 작성** — `src/main/ai-service.test.ts`의 describe 블록 안에 추가:

```ts
describe('chat 시스템 프롬프트', () => {
  it('chatPromptBase는 한국어 전용 응답 규칙을 포함한다', async () => {
    const ai = await loadAiService()
    const p = ai.chatPromptBase('No tasks.')
    expect(p).toContain('respond ONLY in Korean')
    expect(p).toContain('No tasks.')
  })

  it('buildChatSystemPrompt는 base를 포함하고 JSON 지시를 덧붙인다', async () => {
    const ai = await loadAiService()
    const p = ai.buildChatSystemPrompt('No tasks.')
    expect(p).toContain('respond ONLY in Korean')
    expect(p).toContain('"action":"chat_response"')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `./node_modules/.bin/vitest run src/main/ai-service.test.ts`
Expected: FAIL — `ai.chatPromptBase is not a function`

- [ ] **Step 3: 최소 구현** — `ai-service.ts`의 `buildChatSystemPrompt`(137~147행)를 아래로 교체:

```ts
export function chatPromptBase(taskSummary: string): string {
  return `You are a productivity assistant for the app "haru". The user can ask about their tasks, schedule, and productivity.
Answer in the same language the user writes in (Korean or English). When the user writes in Korean, respond ONLY in Korean and never mix languages within a single response.
Be concise and helpful. Reference specific tasks when relevant.

Current tasks summary:
${taskSummary}

Today is ${getToday()}.`
}

export function buildChatSystemPrompt(taskSummary: string): string {
  return `${chatPromptBase(taskSummary)}
Return your response as JSON: {"action":"chat_response","message":"your response here"}`
}
```

그리고 `streamChat`(294~301행)의 인라인 `const systemPrompt = ...` 블록을 다음 한 줄로 교체:

```ts
  const systemPrompt = chatPromptBase(summary)
```

- [ ] **Step 4: 통과 확인**

Run: `./node_modules/.bin/vitest run src/main/ai-service.test.ts`
Expected: PASS

- [ ] **Step 5: 헬스 확인 후 커밋**

```bash
./node_modules/.bin/tsc --build && ./node_modules/.bin/biome lint src electron.vite.config.ts
git add src/main/ai-service.ts src/main/ai-service.test.ts
git commit -m "fix(ai): enforce Korean-only replies and DRY chat system prompt"
```

---

### Task 2: AI API 키 저장 시 암호화 (safeStorage)

현재 `ai-config.json`에 API 키가 평문 저장된다. Electron `safeStorage`(macOS Keychain 백엔드)로 `apiKey` 필드만 암호화한다. 나머지 설정은 평문 유지. safeStorage는 vitest에서 사용 불가하므로 암호화 로직을 주입식 순수 함수로 분리한다.

**Files:**
- Modify: `src/main/database.ts:393-405` (getAiConfig/saveAiConfig)
- Test: `src/main/database.test.ts`

**Interfaces:**
- Produces:
  - `interface KeyCrypto { available(): boolean; encrypt(s: string): string; decrypt(b64: string): string }`
  - `export function encodeApiKey(config: Record<string, unknown>, crypto: KeyCrypto): Record<string, unknown>`
  - `export function decodeApiKey(raw: Record<string, unknown>, crypto: KeyCrypto): Record<string, unknown>`
- Consumes: `saveAiConfig`/`getAiConfig`가 실제 `safeStorage` 어댑터로 위 함수를 호출.

- [ ] **Step 1: 실패하는 테스트 작성** — `src/main/database.test.ts`에 추가:

```ts
import { encodeApiKey, decodeApiKey } from './database'

const fakeCrypto = {
  available: () => true,
  encrypt: (s: string) => `enc(${s})`,
  decrypt: (b64: string) => b64.replace(/^enc\(/, '').replace(/\)$/, '')
}

describe('API 키 암호화', () => {
  it('encodeApiKey: 평문 키를 암호화하고 apiKey를 null로 만든다', () => {
    const out = encodeApiKey({ provider: 'openai', apiKey: 'sk-123' }, fakeCrypto)
    expect(out.apiKey).toBeNull()
    expect(out.apiKey_enc).toBe('enc(sk-123)')
  })

  it('decodeApiKey: 암호문을 평문 키로 복원한다', () => {
    const out = decodeApiKey({ provider: 'openai', apiKey: null, apiKey_enc: 'enc(sk-123)' }, fakeCrypto)
    expect(out.apiKey).toBe('sk-123')
    expect(out.apiKey_enc).toBeUndefined()
  })

  it('encode→decode 라운드트립', () => {
    const enc = encodeApiKey({ provider: 'openai', apiKey: 'sk-xyz' }, fakeCrypto)
    const dec = decodeApiKey(enc, fakeCrypto)
    expect(dec.apiKey).toBe('sk-xyz')
  })

  it('암호화 불가 시 평문 그대로 통과', () => {
    const noCrypto = { available: () => false, encrypt: () => '', decrypt: () => '' }
    const out = encodeApiKey({ apiKey: 'sk-1' }, noCrypto)
    expect(out.apiKey).toBe('sk-1')
    expect(out.apiKey_enc).toBeUndefined()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `./node_modules/.bin/vitest run src/main/database.test.ts`
Expected: FAIL — `encodeApiKey` export 없음

- [ ] **Step 3: 최소 구현** — `database.ts` 상단 import에 `safeStorage` 추가(`import { app, safeStorage } from 'electron'`), 그리고 `getAiConfig`/`saveAiConfig`(393~405행)를 교체:

```ts
export interface KeyCrypto {
  available(): boolean
  encrypt(s: string): string
  decrypt(b64: string): string
}

const realCrypto: KeyCrypto = {
  available: () => {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  },
  encrypt: (s) => safeStorage.encryptString(s).toString('base64'),
  decrypt: (b64) => safeStorage.decryptString(Buffer.from(b64, 'base64'))
}

export function encodeApiKey(config: Record<string, unknown>, crypto: KeyCrypto): Record<string, unknown> {
  const out = { ...config }
  if (typeof out.apiKey === 'string' && out.apiKey && crypto.available()) {
    out.apiKey_enc = crypto.encrypt(out.apiKey)
    out.apiKey = null
  }
  return out
}

export function decodeApiKey(raw: Record<string, unknown>, crypto: KeyCrypto): Record<string, unknown> {
  const out = { ...raw }
  if (typeof out.apiKey_enc === 'string' && out.apiKey_enc && crypto.available()) {
    try {
      out.apiKey = crypto.decrypt(out.apiKey_enc)
    } catch {
      out.apiKey = null
    }
  }
  delete out.apiKey_enc
  return out
}

export function getAiConfig(): Record<string, unknown> | null {
  if (!aiConfigPath) return null
  if (!existsSync(aiConfigPath)) return null
  try {
    return decodeApiKey(JSON.parse(readFileSync(aiConfigPath, 'utf-8')), realCrypto)
  } catch {
    return null
  }
}

export function saveAiConfig(config: Record<string, unknown>): void {
  if (!aiConfigPath) return
  writeFileSync(aiConfigPath, JSON.stringify(encodeApiKey(config, realCrypto), null, 2), 'utf-8')
}
```

- [ ] **Step 4: 통과 확인**

Run: `./node_modules/.bin/vitest run src/main/database.test.ts`
Expected: PASS

- [ ] **Step 5: 헬스 확인 후 커밋**

```bash
./node_modules/.bin/tsc --build && ./node_modules/.bin/biome lint src electron.vite.config.ts
git add src/main/database.ts src/main/database.test.ts
git commit -m "feat(security): encrypt AI API key at rest via safeStorage"
```

---

### Task 3: IPC 태스크 페이로드 입력 검증

`create-task`/`update-task` 핸들러가 렌더러 페이로드를 검증 없이 DB로 넘긴다. 필수 필드·타입을 검증하는 순수 함수를 만들고 경계에 적용한다.

**Files:**
- Create: `src/main/validate.ts`
- Test: `src/main/validate.test.ts`
- Modify: `src/main/ipc-handlers.ts:41-42` (create-task/update-task)

**Interfaces:**
- Produces: `export function validateTaskInput(input: unknown): Record<string, unknown>` — 유효하면 정규화된 객체 반환, 아니면 `throw new Error('Invalid task payload')`.

- [ ] **Step 1: 실패하는 테스트 작성** — `src/main/validate.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { validateTaskInput } from './validate'

describe('validateTaskInput', () => {
  it('id와 title이 있으면 통과', () => {
    const out = validateTaskInput({ id: 't1', title: '할일', extra: 1 })
    expect(out.id).toBe('t1')
    expect(out.title).toBe('할일')
  })

  it('객체가 아니면 throw', () => {
    expect(() => validateTaskInput(null)).toThrow('Invalid task payload')
    expect(() => validateTaskInput('x')).toThrow('Invalid task payload')
  })

  it('id가 문자열이 아니면 throw', () => {
    expect(() => validateTaskInput({ id: 1, title: 'a' })).toThrow('Invalid task payload')
  })

  it('title이 없으면 throw', () => {
    expect(() => validateTaskInput({ id: 't1' })).toThrow('Invalid task payload')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `./node_modules/.bin/vitest run src/main/validate.test.ts`
Expected: FAIL — `validate.ts` 없음

- [ ] **Step 3: 최소 구현** — `src/main/validate.ts`:

```ts
// IPC 경계 입력 검증 — 렌더러 페이로드를 DB에 넘기기 전 최소 방어
export function validateTaskInput(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Invalid task payload')
  }
  const obj = input as Record<string, unknown>
  if (typeof obj.id !== 'string' || obj.id.length === 0) {
    throw new Error('Invalid task payload')
  }
  if (typeof obj.title !== 'string') {
    throw new Error('Invalid task payload')
  }
  return obj
}
```

- [ ] **Step 4: 통과 확인**

Run: `./node_modules/.bin/vitest run src/main/validate.test.ts`
Expected: PASS

- [ ] **Step 5: 핸들러에 적용** — `ipc-handlers.ts` 상단에 `import { validateTaskInput } from './validate'` 추가하고 41~42행 교체:

```ts
  ipcMain.handle('create-task', (_, task) => db.createTask(validateTaskInput(task)))
  ipcMain.handle('update-task', (_, task) => db.updateTask(validateTaskInput(task)))
```

- [ ] **Step 6: 헬스 확인 후 커밋**

```bash
./node_modules/.bin/tsc --build && ./node_modules/.bin/biome lint src electron.vite.config.ts && ./node_modules/.bin/vitest run
git add src/main/validate.ts src/main/validate.test.ts src/main/ipc-handlers.ts
git commit -m "feat(security): validate task payloads at IPC boundary"
```

---

### Task 4: 클릭 가능 div 접근성 (biome a11y 그린)

`TODOS.md` [P2] — `<div onClick>` ~50건이 `useKeyWithClickEvents`/`noStaticElementInteractions`를 위반한다. 파일별 수동 판단으로 (a) `<button type="button">` 전환 또는 (b) `role="button" + tabIndex={0} + onKeyDown` 추가. 이 태스크의 검증은 vitest가 아니라 **biome lint 그린**이다.

**Files:**
- Modify: `src/renderer/src/components/sidebar/Sidebar.tsx`, `src/renderer/src/components/sidebar/Settings.tsx`, `src/renderer/src/components/habits/HabitTracker.tsx`, 그리고 biome이 지목하는 나머지 파일.

- [ ] **Step 1: 위반 목록 확보**

Run: `./node_modules/.bin/biome lint src 2>&1 | grep -E "useKeyWithClickEvents|noStaticElementInteractions" | sort | uniq -c`
Expected: 위반 파일/행 목록 출력 (기준 ~50건)

- [ ] **Step 2: 변환 패턴 적용 (파일별)**

두 가지 패턴 중 택1. 실제 예 — `Sidebar.tsx:160-166`의 색상 스와치:

```tsx
// BEFORE (위반: 클릭만 있고 키보드 불가)
<div
  className="w-3 h-3 rounded-full flex-shrink-0 cursor-pointer"
  style={{ backgroundColor: editColor }}
  onClick={() => {
    const idx = COLORS.indexOf(editColor)
    setEditColor(COLORS[(idx + 1) % COLORS.length])
  }}
/>
```

패턴 A — 순수 클릭 요소는 `<button>`으로 (권장):

```tsx
<button
  type="button"
  aria-label="색상 변경"
  className="w-3 h-3 rounded-full flex-shrink-0 cursor-pointer"
  style={{ backgroundColor: editColor }}
  onClick={() => {
    const idx = COLORS.indexOf(editColor)
    setEditColor(COLORS[(idx + 1) % COLORS.length])
  }}
/>
```

패턴 B — `<button>`으로 못 바꾸는 경우(중첩 인터랙티브 요소 포함 등) `role`+키보드:

```tsx
<div
  role="button"
  tabIndex={0}
  className="..."
  onClick={handleClick}
  onKeyDown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleClick()
    }
  }}
>
  ...
</div>
```

각 위반 지점에 대해 위 두 패턴 중 맞는 것을 적용한다. 인라인 화살표 핸들러는 `onKeyDown`에서 재사용할 수 있게 필요 시 지역 함수로 추출한다.

- [ ] **Step 3: 검증**

Run: `./node_modules/.bin/biome lint src electron.vite.config.ts`
Expected: `useKeyWithClickEvents`/`noStaticElementInteractions` 위반 0. 전체 에러 0.

- [ ] **Step 4: 시각 회귀 없음 스모크** — (deps/electron 준비 시) `npm run dev`로 사이드바/설정/습관 화면에서 해당 요소 클릭이 이전과 동일하게 동작하는지 확인. 키보드 Tab→Enter로도 동작 확인.

- [ ] **Step 5: 커밋**

```bash
./node_modules/.bin/tsc --build && ./node_modules/.bin/vitest run
git add src/renderer/src/components
git commit -m "fix(a11y): keyboard support for clickable elements (biome green)"
```

---

### Task 5: SSRF 방어 회귀 테스트 + 의도 문서화

`isAllowedUrl`은 이미 사설 IP(10.x·172.16-31·192.168·169.254.169.254·0.0.0.0)를 차단하고 localhost만 허용한다. 이 동작을 회귀 테스트로 고정하고, localhost 허용이 의도임을 주석으로 명시한다.

**Files:**
- Modify: `src/main/ai-service.ts:50-66` (isAllowedUrl export + 주석)
- Test: `src/main/ai-service.test.ts`

**Interfaces:**
- Produces: `export function isAllowedUrl(url: string): boolean` (기존 내부 함수를 export로 승격)

- [ ] **Step 1: 실패하는 테스트 작성** — `ai-service.test.ts`에 추가:

```ts
describe('isAllowedUrl (SSRF 방어)', () => {
  const cases: [string, boolean][] = [
    ['http://localhost:11434', true],
    ['http://127.0.0.1:11434', true],
    ['https://api.openai.com', true],
    ['http://169.254.169.254/latest/meta-data', false],
    ['http://10.0.0.5', false],
    ['http://192.168.1.10', false],
    ['http://172.16.0.1', false],
    ['file:///etc/passwd', false],
    ['not-a-url', false]
  ]
  it.each(cases)('%s → %s', async (url, expected) => {
    const ai = await loadAiService()
    expect(ai.isAllowedUrl(url)).toBe(expected)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `./node_modules/.bin/vitest run src/main/ai-service.test.ts`
Expected: FAIL — `ai.isAllowedUrl is not a function`

- [ ] **Step 3: 최소 구현** — `ai-service.ts` 50행 `function isAllowedUrl`을 `export function isAllowedUrl`로 바꾸고, localhost 허용 라인 위 주석을 명확히:

```ts
    // 의도적 허용: localhost/127.0.0.1은 로컬 Ollama 서버용. 그 외 사설/메타데이터
    // 대역은 위에서 차단됨. 사용자가 직접 설정하는 신뢰 엔드포인트만 통과.
    return true
```

- [ ] **Step 4: 통과 확인**

Run: `./node_modules/.bin/vitest run src/main/ai-service.test.ts`
Expected: PASS (9 케이스)

- [ ] **Step 5: 전체 헬스 + 커밋**

```bash
./node_modules/.bin/tsc --build && ./node_modules/.bin/biome lint src electron.vite.config.ts && ./node_modules/.bin/vitest run
git add src/main/ai-service.ts src/main/ai-service.test.ts
git commit -m "test(security): lock in SSRF URL allowlist behavior"
```

---

## Self-Review

- **스펙 커버리지:** A(=Task 1 한국어 출력, Task 4 a11y) + E1(=Task 2 키 암호화, Task 3 IPC 검증, Task 5 SSRF/CSP). CSP 재점검은 Task 5 스모크에 흡수(현 CSP 유지 확인). ✔
- **플레이스홀더:** 각 스텝에 실제 코드/명령/기대출력 포함. a11y는 lint 게이트로 검증(vitest 불가 항목). ✔
- **타입 일관성:** `KeyCrypto`, `encodeApiKey`/`decodeApiKey`, `validateTaskInput`, `chatPromptBase`, `isAllowedUrl` 시그니처가 태스크 간 일치. ✔

## 후속 계획 (별도 문서로 작성 예정)

- **Plan 2 — Dual-channel Packaging (B+C):** electron-builder mac 하드닝/공증, mas 타깃 + 샌드박스 entitlements 3종, `process.mas` updater 가드.
- **Plan 3 — Code Audit (E2/E3/E4):** 성능·유지보수·완성도 리포트 먼저, 그 후 "지금 vs 보류" 판단.
- **Plan 4 — Release (D):** 2.0.0 bump, CHANGELOG, GitHub Pages 랜딩.
