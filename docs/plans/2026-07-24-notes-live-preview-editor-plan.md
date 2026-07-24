# Notes Live-Preview Editor Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox (`- [ ]`) syntax. Spec: `docs/design/2026-07-24-notes-live-preview-editor-design.md`.

**Goal:** Replace the task-detail notes textarea/preview toggle with an Obsidian-style live-preview markdown editor (`@atomic-editor/editor`, CodeMirror 6).

**Architecture:** Swap the right-column notes UI for `<AtomicCodeMirrorEditor>`. `description` (raw markdown) stays the source of truth: `markdownSource` in, `onMarkdownChange` out → debounced save. Atomic's clickable checkboxes and CM6 code highlighting replace the app's regex-toggle + react-markdown/highlight.js. Task 0 is a blocking spike that validates the library before the real integration.

**Tech Stack:** Electron + React 19 + TypeScript + Zustand + Tailwind; `@atomic-editor/editor@0.6.2` + CodeMirror 6 / Lezer; Vitest/Biome for health.

## Global Constraints

- Health stack green after every stage: `npx tsc --build` (0 errors), `npx biome lint src electron.vite.config.ts` (clean), `npx vitest run` (all pass). Run node/npm with `NODE_OPTIONS="--dns-result-order=ipv4first --no-network-family-autoselection"`.
- No `Co-Authored-By` trailer in commits.
- **After each STAGE: run `/simplify` then `/review`** before the next stage (user requirement).
- `description` stays raw markdown (no storage-model change). Pin `@atomic-editor/editor@0.6.2` (pre-1.0).
- No renderer component tests exist → integration + manual QA, not TDD.

---

## Stage 0 — Spike (GATE)

### Task 0: Validate `@atomic-editor/editor` before integrating

**Files:**
- Modify: `package.json` (add deps)
- Create (throwaway): `src/renderer/src/components/tasks/_AtomicSpike.tsx`

- [ ] **Step 1: Install the library + peer deps**

```bash
NODE_OPTIONS="--dns-result-order=ipv4first --no-network-family-autoselection" npm install @atomic-editor/editor@0.6.2 \
  @codemirror/state @codemirror/view @codemirror/commands @codemirror/autocomplete \
  @codemirror/language @codemirror/search @codemirror/lang-markdown \
  @lezer/common @lezer/highlight @lezer/markdown \
  @codemirror/lang-javascript @codemirror/lang-python @codemirror/lang-json \
  @codemirror/lang-css @codemirror/lang-html @codemirror/lang-sql \
  @codemirror/lang-java @codemirror/lang-rust @codemirror/lang-go \
  @codemirror/lang-cpp @codemirror/lang-php @codemirror/lang-xml \
  @codemirror/lang-yaml @codemirror/legacy-modes
```

Expected: installs without peer-dep ERRORs (warnings are OK). If it hard-fails on React 19, STOP — record the error and fall back to approach B.

- [ ] **Step 2: Mount a throwaway spike component** — create `src/renderer/src/components/tasks/_AtomicSpike.tsx`:

```tsx
import { useState } from 'react'
import { AtomicCodeMirrorEditor } from '@atomic-editor/editor'
import '@atomic-editor/editor/styles.css'

const SEED = `# 제목\n\n**굵게** *기울임* \`코드\`\n\n- [ ] 체크박스\n- [x] 완료\n\n\`\`\`js\nconst x = 1\n\`\`\`\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n한글 입력 테스트: 안녕하세요`

export function AtomicSpike() {
  const [md, setMd] = useState(SEED)
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#fff', padding: 16, overflow: 'auto' }}>
      <AtomicCodeMirrorEditor markdownSource={md} onMarkdownChange={setMd} onLinkClick={(u) => console.log('link', u)} />
      <pre style={{ marginTop: 12, fontSize: 11, color: '#888' }}>{md}</pre>
    </div>
  )
}
```

- [ ] **Step 3: Render the spike temporarily** — in `src/renderer/src/App.tsx`, add `import { AtomicSpike } from './components/tasks/_AtomicSpike'` and render `<AtomicSpike />` as the first child of the root div (temporary). Run `npm run dev`.

- [ ] **Step 4: Validate (manual, GATE criteria)** — with the app running, confirm ALL:
  1. **Build/dev**: electron-vite bundles it; the editor renders; no console errors.
  2. **Live preview**: heading/bold/italic/code/table render; the cursor line shows raw syntax.
  3. **Korean IME**: type 한글 into the editor — characters compose correctly, none dropped/duplicated.
  4. **Checkbox**: click a task-list checkbox → the `<pre>` raw source flips `[ ]`↔`[x]`.
  5. **Dark theme**: determine how to theme it dark (a prop, a passed CM6 theme extension, or CSS). Note the exact mechanism for Task 1.
  6. **Bundle**: `npm run build` succeeds; note the TaskDetail chunk size.
  7. **Wiki-links**: check whether `[[x]]` can be disabled via config (or is inert).

- [ ] **Step 5: Go / No-Go decision**
  - If 1–4 pass and 5 has a workable answer → **GO**. Record the theme mechanism (from 4.5) and the exact peer-dep set that was actually needed.
  - If build fails, IME is broken, or dark theming is impossible → **NO-GO**: revert (`git checkout -- package.json package-lock.json && rm src/renderer/src/components/tasks/_AtomicSpike.tsx` and undo the App.tsx edit), and STOP to re-decide with the user (approach B — custom CM6 decorations).

- [ ] **Step 6: Remove the spike scaffolding (on GO)** — delete `_AtomicSpike.tsx` and revert the temporary `<AtomicSpike />` + import in `App.tsx`. Keep the installed deps.

```bash
rm src/renderer/src/components/tasks/_AtomicSpike.tsx
# manually revert the two App.tsx lines
git add package.json package-lock.json
git commit -m "chore(deps): add @atomic-editor/editor + codemirror 6 (spike passed)"
```

**★ Stage 0 checkpoint:** the spike result is the gate. On GO, run `/simplify` then `/review` on the deps change, then continue. On NO-GO, stop.

---

## Stage 1 — Integrate the editor

### Task 1: Replace the notes column with AtomicCodeMirrorEditor

**Files:**
- Modify: `src/renderer/src/components/tasks/TaskDetail.tsx`

**Interfaces:**
- Consumes: `AtomicCodeMirrorEditor` from `@atomic-editor/editor` (props `markdownSource: string`, `onMarkdownChange: (md: string) => void`, `onLinkClick: (url: string) => void`, + the dark-theme mechanism recorded in Task 0).
- Produces: notes editing via `description`; save via existing `save({ description })`.

- [ ] **Step 1: Add imports + debounced-save wiring.** At the top of `TaskDetail.tsx` add:

```tsx
import { AtomicCodeMirrorEditor } from '@atomic-editor/editor'
import '@atomic-editor/editor/styles.css'
```

Inside the component (near the other hooks, before the `if (!task) return null` guard), add a debounced save that flushes on unmount/task switch:

```tsx
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingNotes = useRef<string | null>(null)
  const flushNotes = useCallback(() => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
    if (pendingNotes.current != null && task) {
      updateTask({ id: task.id, description: pendingNotes.current })
      pendingNotes.current = null
    }
  }, [task, updateTask])
  const onNotesChange = useCallback((md: string) => {
    setDescription(md)
    pendingNotes.current = md
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(flushNotes, 400)
  }, [flushNotes])
  // flush on unmount / task switch
  useEffect(() => () => flushNotes(), [flushNotes])
```

(`task?.id` change already resets `description` via the existing effect; `flushNotes` before that keeps the previous task's edit. To be safe, also flush when the id changes: add `flushNotes()` at the top of the existing `useEffect([task?.id])` body before `setTitle(...)`.)

- [ ] **Step 2: Replace the notes JSX.** Delete the entire right-column block — the 편집/미리보기 tab buttons, the `mdPreview` conditional, the `<textarea>`, and the react-markdown `<div>` — and replace the right column body with:

```tsx
        <div className="min-h-0 overflow-hidden flex flex-col">
          <AtomicCodeMirrorEditor
            markdownSource={description}
            onMarkdownChange={onNotesChange}
            onLinkClick={(url) => window.api.openExternal(url)}
            /* dark theme applied via the mechanism recorded in Task 0 */
          />
        </div>
```

Apply the dark/light theme exactly as recorded in Task 0 (prop or CM6 theme extension). If `window.api.openExternal` isn't typed, it already exists (`preload/index.ts:61`); use it.

- [ ] **Step 3: Delete the now-dead code.** Remove: `mdPreview` state, `toggleCheckbox` useCallback, `checkboxIndex` ref, the `CodeBlock` memo component, and all `highlight.js` + `react-markdown` + `remark-gfm` imports and the `hljs.registerLanguage(...)` block.

- [ ] **Step 4: Verify health.** Run `npx tsc --build && npx biome lint src && npx vitest run`. Expected: 0 type errors (any unused-import errors mean Step 3 missed one — remove it), lint clean, 270 tests pass.

- [ ] **Step 5: Manual smoke.** `npm run dev`, open a task, confirm the editor renders in the right column and typing updates the notes.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/tasks/TaskDetail.tsx
git commit -m "feat(notes): live-preview markdown editor (Atomic/CM6) replaces textarea toggle"
```

### Task 2: Remove the unused markdown deps

**Files:**
- Modify: `package.json`, `src/renderer/src/index.css`

- [ ] **Step 1: Confirm no remaining usage.** Run `grep -rn "react-markdown\|remark-gfm\|highlight.js\|hljs" src/renderer/src`. Expected: only `index.css` (the hljs theme import) remains.

- [ ] **Step 2: Remove the hljs theme import** from `src/renderer/src/index.css` (the `@import` / highlight.js CSS line).

- [ ] **Step 3: Uninstall the deps.**

```bash
NODE_OPTIONS="--dns-result-order=ipv4first --no-network-family-autoselection" npm uninstall react-markdown remark-gfm highlight.js
```

- [ ] **Step 4: Verify health + build.** Run `npx tsc --build && npx biome lint src && npx vitest run && npm run build`. Expected: all pass, bundle builds.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/renderer/src/index.css
git commit -m "chore(deps): drop react-markdown/remark-gfm/highlight.js (notes now use CM6)"
```

**★ Stage 1 checkpoint:** run `/simplify` then `/review` on the integration diff; address findings; continue.

---

## Stage 2 — QA + polish

### Task 3: Manual QA and dark-mode/theme polish

**Files:**
- Modify: `src/renderer/src/components/tasks/TaskDetail.tsx` / `index.css` (only if QA finds issues)

- [ ] **Step 1: Run the QA checklist** (with `npm run dev`, open a task's notes):
  1. Type markdown → the cursor line shows raw syntax, other lines render.
  2. Bold / italic / heading / link / image / code-block highlight / table render inline.
  3. Task-list checkbox click toggles and **persists** (close + reopen the task).
  4. Link click opens in the system browser.
  5. Korean IME typing is correct (no dropped/duplicated chars).
  6. Dark mode: toggle it in settings; the editor + code blocks + tables read well.
  7. Edit then immediately switch task / close the detail → the change is saved (reopen shows it; survives app restart).
  8. No console errors.

- [ ] **Step 2: Fix any issues found** (theme contrast, save-flush timing, checkbox persistence). Keep fixes minimal and re-run the relevant checklist item.

- [ ] **Step 3: Verify health.** `npx tsc --build && npx biome lint src && npx vitest run`.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix(notes): <specific QA fix>"
```

**★ Stage 2 checkpoint:** run `/simplify` then `/review`; final full health run; done.

---

## Self-review (author check against spec)

- Single live-preview mode / remove toggle — Task 1 (delete tabs + mdPreview). ✓
- Atomic library + CM6 peers added — Task 0 install. ✓
- Remove react-markdown/remark-gfm/highlight.js — Task 2. ✓
- Debounced save + flush on switch/unmount — Task 1 Step 1. ✓
- Checkboxes via Atomic, remove regex toggle — Task 1 Step 3. ✓
- Links via `window.api.openExternal` — Task 1 Step 2. ✓
- Theme (light/dark) — resolved in Task 0 spike, applied in Task 1. ✓
- Spike GATE with fallback to B — Task 0 Steps 4–5. ✓
- Manual QA (no component tests) — Task 3. ✓
- Wiki-links disable / bundle check — Task 0 Step 4. ✓
- No placeholders in deliverable steps; the only "resolved in Task 0" item (theme API) is a deliberate spike-then-apply, with a concrete fallback (prop / CM6 theme / CSS). Types (`onNotesChange`, `flushNotes`, `markdownSource`/`onMarkdownChange`/`onLinkClick`) consistent across tasks. ✓
