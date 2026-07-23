# Bottom Task Detail Panel — Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox (`- [ ]`) syntax. Spec: `docs/design/2026-07-24-bottom-task-detail-design.md`.

**Goal:** Move the task detail from a 480px right column to a resizable, persisted bottom slide-up panel that opens from every view.

**Architecture:** The content column (`App.tsx`) becomes a vertical flex: the current view on top (shrinks) and `TaskDetail` as a full-width bottom panel below (Push). Panel height lives in the store, persisted to `localStorage`, dragged via a grip. `TaskDetail` is re-laid-out (not rewritten) into header + two columns (left: subtasks/attachments/meta, right: notes). Detail un-gates from `viewType` so it opens everywhere.

**Tech Stack:** Electron + React 19 + TypeScript + Zustand + Tailwind; Vitest for unit tests; Biome for lint.

## Global Constraints

- Health stack must stay green after every stage: `npx tsc --build` (0 errors), `npx biome lint src electron.vite.config.ts` (clean), `npx vitest run` (all pass). Run network/node commands with `NODE_OPTIONS="--dns-result-order=ipv4first --no-network-family-autoselection"`.
- No `Co-Authored-By` trailer in commits (global hook strips it).
- **After each STAGE: run `/simplify` then `/review` on the stage's changes before starting the next stage** (user requirement). Address findings before proceeding.
- Preserve every existing TaskDetail field behavior; this is a re-layout. No renderer component tests exist → manual QA the fields after Stage 2.
- Height persisted as absolute **px** via `localStorage` key `ticktick-detail-height`.

---

## Stage 1 — Store: persisted panel height (TDD)

### Task 1: `detailPanelHeightPx` state + clamped setter + persistence

**Files:**
- Modify: `src/renderer/src/store/useStore.ts` (state ~line 43-area, init ~263, setters ~626)
- Test: `src/renderer/src/store/detailHeight.test.ts` (create)

**Interfaces:**
- Produces: `detailPanelHeightPx: number | null`, `setDetailPanelHeightPx(px: number, contentHeight: number): void`, and a pure helper `clampDetailHeight(px: number, contentHeight: number): number`.

- [ ] **Step 1: Write the failing test** — create `src/renderer/src/store/detailHeight.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { clampDetailHeight } from './detailHeight'

describe('clampDetailHeight', () => {
  it('keeps a value inside the range', () => {
    expect(clampDetailHeight(500, 900)).toBe(500) // range [240, 740]
  })
  it('floors at 240', () => {
    expect(clampDetailHeight(100, 900)).toBe(240)
  })
  it('caps at contentHeight - 160', () => {
    expect(clampDetailHeight(1000, 900)).toBe(740)
  })
  it('handles inverted range on tiny windows (contentH - 160 < 240)', () => {
    // contentHeight 300 -> ceil = max(240, 140) = 240, so result never below 240
    expect(clampDetailHeight(50, 300)).toBe(240)
    expect(clampDetailHeight(999, 300)).toBe(240)
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/renderer/src/store/detailHeight.test.ts`
Expected: FAIL — cannot import `clampDetailHeight`.

- [ ] **Step 3: Create the helper** — `src/renderer/src/store/detailHeight.ts`:

```ts
// Clamp the bottom-detail panel height (px) so it always keeps >=160px of the
// view visible and never drops below a usable 240px. On tiny windows where
// (contentHeight - 160) < 240 the ceiling wins but is floored at 240.
export function clampDetailHeight(px: number, contentHeight: number): number {
  const ceil = Math.max(240, contentHeight - 160)
  return Math.min(Math.max(px, 240), ceil)
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run src/renderer/src/store/detailHeight.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire into the store** — in `src/renderer/src/store/useStore.ts`:
  - Import the helper at the top: `import { clampDetailHeight } from './detailHeight'`
  - Add to the state interface (near `theme: Theme`): `detailPanelHeightPx: number | null`
  - Add to the actions interface (near `setTheme`): `setDetailPanelHeightPx: (px: number, contentHeight: number) => void`
  - Initialize (near `theme: (localStorage.getItem('ticktick-theme') …)`):

```ts
    detailPanelHeightPx: ((): number | null => {
      const v = localStorage.getItem('ticktick-detail-height')
      return v ? Number(v) : null
    })(),
```

  - Add the setter (near `setTheme`):

```ts
    setDetailPanelHeightPx: (px, contentHeight) => {
      const clamped = clampDetailHeight(px, contentHeight)
      localStorage.setItem('ticktick-detail-height', String(clamped))
      set({ detailPanelHeightPx: clamped })
    },
```

- [ ] **Step 6: Verify health**

Run: `npx tsc --build && npx biome lint src && npx vitest run`
Expected: 0 type errors, lint clean, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/store/detailHeight.ts src/renderer/src/store/detailHeight.test.ts src/renderer/src/store/useStore.ts
git commit -m "feat(store): persisted, clamped bottom-detail panel height"
```

**★ Stage 1 checkpoint: run `/simplify` then `/review` on the diff, address findings, then continue.**

---

## Stage 2 — Bottom panel layout (core re-layout)

> These four tasks land together to keep the app visually correct — commit each, but do not stop with a half-migrated layout. Manual QA at the end of the stage.

### Task 2: App.tsx — vertical content flex + un-gate detail

**Files:**
- Modify: `src/renderer/src/App.tsx:104-111`

- [ ] **Step 1: Restructure the content wrapper.** Replace the block:

```tsx
      <div className="flex flex-1 min-w-0">
        <MainContent />
        {viewType === 'tasks' && selectedTaskId && (
          <Suspense fallback={null}>
            <TaskDetail />
          </Suspense>
        )}
      </div>
```

with:

```tsx
      <div className="flex flex-col flex-1 min-w-0">
        <div className="flex-1 min-h-0 overflow-hidden">
          <MainContent />
        </div>
        {selectedTaskId && (
          <Suspense fallback={null}>
            <TaskDetail />
          </Suspense>
        )}
      </div>
```

- [ ] **Step 2: Drop the now-unused `viewType`** from `App()` if TypeScript flags it unused (it is still used by `MainContent` via its own `useStore`, so the top-level `const viewType` in `App()` at line 54 may become unused — remove that line if lint warns).

- [ ] **Step 3: Verify types/lint** — `npx tsc --build && npx biome lint src`. Expected: clean. (App will look wrong until Task 5; that's expected.)

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "refactor(layout): vertical content flex, un-gate detail from viewType"
```

### Task 3: View roots `h-full` → `min-h-0` (7 files)

**Files (modify the root element's className, `h-full` → `min-h-0`):**
- `src/renderer/src/components/tasks/TaskList.tsx:131`
- `src/renderer/src/components/kanban/KanbanView.tsx:163`
- `src/renderer/src/components/timeline/TimelineView.tsx:132`
- `src/renderer/src/components/eisenhower/EisenhowerMatrix.tsx:171`
- `src/renderer/src/components/calendar/CalendarView.tsx:36`
- `src/renderer/src/components/calendar/WeeklyCalendar.tsx:183`
- `src/renderer/src/components/calendar/DailyCalendar.tsx:154`

- [ ] **Step 1:** In each file, on the root element that reads `flex-1 flex flex-col h-full` (or similar), change `h-full` to `min-h-0`. Keep everything else. (These roots are direct children of the new `flex-1 min-h-0 overflow-hidden` wrapper, so `min-h-0` lets them fill and scroll instead of forcing 100%.)

- [ ] **Step 2: Verify** — `npx tsc --build && npx biome lint src`. Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/tasks/TaskList.tsx src/renderer/src/components/kanban/KanbanView.tsx src/renderer/src/components/timeline/TimelineView.tsx src/renderer/src/components/eisenhower/EisenhowerMatrix.tsx src/renderer/src/components/calendar/CalendarView.tsx src/renderer/src/components/calendar/WeeklyCalendar.tsx src/renderer/src/components/calendar/DailyCalendar.tsx
git commit -m "refactor(views): view roots use min-h-0 so the bottom panel can push"
```

### Task 4: Calendar Month opens the panel in place

**Files:**
- Modify: `src/renderer/src/components/calendar/CalendarView.tsx:110-114`

- [ ] **Step 1:** In the month-cell task `onClick`, remove `setViewType('tasks')` so the month view keeps its context and just selects the task. Change:

```tsx
onClick={() => { setViewType('tasks'); setSelectedList(task.listId); selectTask(task.id) }}
```

to:

```tsx
onClick={(e) => { e.stopPropagation(); selectTask(task.id) }}
```

(Drop `setSelectedList` too — it also nulls `selectedTaskId` and switching the active list on click is a side effect we don't want when just opening the detail. `selectTask` last is the only call needed.)

- [ ] **Step 2:** Remove now-unused imports/destructures (`setViewType`, `setSelectedList`) from `CalendarView` **only if** no longer referenced elsewhere in the file (check first; the header prev/next buttons may still use them — if so, keep).

- [ ] **Step 3: Verify** — `npx tsc --build && npx biome lint src`. Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/calendar/CalendarView.tsx
git commit -m "fix(calendar): month view opens detail in place instead of jumping to list"
```

### Task 5: TaskDetail — right column → bottom two-column panel

**Files:**
- Modify: `src/renderer/src/components/tasks/TaskDetail.tsx` (container ~line 149-153; header ~152-168; body wrapper ~170; notes block ~368-443)

- [ ] **Step 1: Container.** Change the root from the right-column shell to a full-width bottom panel whose height comes from the store. Read height + a ref to measure content:

```tsx
  const detailHeight = useStore((s) => s.detailPanelHeightPx)
  // default 72% of the content area on first open (null); fall back to 560px
  const height = detailHeight ?? Math.round((typeof window !== 'undefined' ? window.innerHeight : 800) * 0.72)
```

Root className: replace `w-[480px] min-w-[400px] border-l flex flex-col h-full` with:

```tsx
  className={`w-full flex-shrink-0 border-t flex flex-col ${isDark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}`}
  style={{ height }}
```

- [ ] **Step 2: Grip.** Add, as the first child of the root, a drag handle (drag logic lands in Task 6; render it now):

```tsx
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="상세 패널 높이 조절"
        className="h-3 flex items-center justify-center cursor-ns-resize flex-shrink-0"
      >
        <div className={`w-9 h-1 rounded-full ${isDark ? 'bg-gray-700' : 'bg-gray-300'}`} />
      </div>
```

- [ ] **Step 3: Header.** Keep the existing complete/close/title controls but lay them in one row with inline date + priority chips (reuse existing state/handlers — do not rewrite field logic). The header already has the Trash2 + X buttons; move the title `<input>` (currently at ~174) up into this row and add read-only chips that reflect `task.dueDate` and `task.priority` (clicking them can be wired to the existing pickers later; for now they open the same controls that live in the left column). Concretely, the header becomes a flex row: `○ complete` · `title input (flex-1)` · `date chip` · `priority chip` · `✕`.

- [ ] **Step 4: Body two columns.** Replace the single vertical `flex-1 overflow-y-auto p-4 space-y-4 flex flex-col` body with a two-column grid:

```tsx
      <div className="flex-1 min-h-0 grid grid-cols-[1fr_1.35fr]">
        {/* LEFT: subtasks + attachments + meta */}
        <div className="min-h-0 overflow-y-auto p-4 space-y-4 border-r border-gray-100 dark:border-gray-800">
          {/* SubtaskList, AttachmentList, then the meta controls: list picker,
              priority segmented, reminder, recurring, tags — MOVE the existing
              JSX for these here unchanged */}
        </div>
        {/* RIGHT: notes hero */}
        <div className="min-h-0 overflow-y-auto p-4 flex flex-col">
          {/* MOVE the existing 편집/미리보기 tabs + textarea/markdown here.
              The notes wrapper needs flex flex-col min-h-0 h-full so the
              textarea's flex-1 min-h-[200px] fills the column. */}
        </div>
      </div>
```

Move the existing field JSX into the two columns **verbatim** — same handlers, same state, same `save()`/`onBlur`. Only the wrapping/placement changes.

- [ ] **Step 5: Notes column sizing.** Ensure the notes `textarea`/markdown container keeps `flex-1 min-h-[200px]` and its parent is `flex flex-col min-h-0` so it fills the right column.

- [ ] **Step 6: Verify types/lint** — `npx tsc --build && npx biome lint src`. Expected: clean.

- [ ] **Step 7: Manual QA (no component tests exist).** With `npm run dev` running, verify in the live app: open a task from the list → bottom panel appears; edit title (blur) saves; notes edit saves; priority/list/date/reminder/recurring/tags/subtasks/attachments all work; markdown preview + checkbox toggle work; dark mode looks right; open from calendar month/week/day, kanban, timeline, eisenhower; no console errors.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/tasks/TaskDetail.tsx
git commit -m "feat(detail): re-lay TaskDetail as a bottom two-column panel"
```

**★ Stage 2 checkpoint: run `/simplify` then `/review`; address findings; then continue.**

---

## Stage 3 — Drag-to-resize + window re-clamp

### Task 6: Grip drag handler + resize re-clamp

**Files:**
- Modify: `src/renderer/src/components/tasks/TaskDetail.tsx` (grip element + a `useEffect`)

- [ ] **Step 1:** Add a ref to the panel root and a drag handler on the grip. On `mousedown`, attach `mousemove`/`mouseup` listeners; compute px as `contentBottom - clientY` where `contentBottom` = the panel's parent bottom; live-set a local height state; on `mouseup`, commit via `setDetailPanelHeightPx(px, contentHeight)`.

```tsx
  const setHeight = useStore((s) => s.setDetailPanelHeightPx)
  const panelRef = useRef<HTMLDivElement>(null)
  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault()
    const parent = panelRef.current?.parentElement
    if (!parent) return
    const rect = parent.getBoundingClientRect()
    const onMove = (ev: MouseEvent) => {
      const px = rect.bottom - ev.clientY
      setHeight(px, rect.height) // clamps + persists live (cheap; localStorage write is fine)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
```

Wire `onMouseDown={startDrag}` on the grip. Use `panelRef` on the root and drive its height from `detailPanelHeightPx` (fall back to the 72% default when null).

- [ ] **Step 2: Re-clamp on window resize.** Add:

```tsx
  useEffect(() => {
    const onResize = () => {
      const parent = panelRef.current?.parentElement
      if (parent && detailHeight != null) setHeight(detailHeight, parent.getBoundingClientRect().height)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [detailHeight, setHeight])
```

- [ ] **Step 3: Verify** — `npx tsc --build && npx biome lint src`. Expected: clean.

- [ ] **Step 4: Manual QA** — drag the grip up/down: panel resizes, view above shrinks; release → height persists across an app reload; shrink the window very small → panel clamps, never covers the whole view.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/tasks/TaskDetail.tsx
git commit -m "feat(detail): drag-to-resize the bottom panel, persist + re-clamp on resize"
```

**★ Stage 3 checkpoint: run `/simplify` then `/review`; address findings; then continue.**

---

## Stage 4 — Esc precedence + motion polish

### Task 7: Esc closes Settings without also deselecting the task

**Files:**
- Modify: `src/renderer/src/components/sidebar/Settings.tsx` (the capture-phase keydown handler added earlier, ~line 62-68)

**Interfaces:**
- Consumes: existing `useKeyboardShortcuts.ts:35` already closes the panel on Escape via `selectTask(null)` — nothing to add there.

- [ ] **Step 1:** In the Settings Escape handler, add `e.stopPropagation()` so when both Settings and the detail are open, one Esc closes only Settings (the event never reaches the window-level shortcut that would also deselect the task):

```tsx
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        toggleSettings()
      }
    }
```

- [ ] **Step 2: Verify** — `npx tsc --build && npx biome lint src`. Expected: clean.

- [ ] **Step 3: Manual QA** — open detail + open Settings → Esc closes Settings only (task stays open); Esc again closes the detail. With Settings closed, Esc closes the detail directly.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/sidebar/Settings.tsx
git commit -m "fix(settings): Escape closes only Settings, not the task detail too"
```

### Task 8: Slide-up motion

**Files:**
- Modify: `src/renderer/src/components/tasks/TaskDetail.tsx` (root transition)

- [ ] **Step 1:** Add a mount transition so the panel slides up. Use a small `mounted` state toggled on in a `useEffect([])` and translate:

```tsx
  const [shown, setShown] = useState(false)
  useEffect(() => { setShown(true) }, [])
  // on root: add `transition-transform duration-300 ease-[cubic-bezier(.32,.72,0,1)]`
  // and style translateY: shown ? '0' : '100%'
```

(TaskDetail unmounts on close via the `selectedTaskId` gate, so an exit animation is out of scope; the enter slide is enough. First-ever open may skip the slide due to the lazy chunk fetch — acceptable per spec.)

- [ ] **Step 2: Verify** — `npx tsc --build && npx biome lint src`. Expected: clean.

- [ ] **Step 3: Manual QA** — opening a task slides the panel up smoothly; switching between tasks keeps it open (no re-slide needed).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/tasks/TaskDetail.tsx
git commit -m "feat(detail): slide-up motion for the bottom panel"
```

**★ Stage 4 checkpoint: run `/simplify` then `/review`; then a final full health run (`tsc` + `biome` + `vitest`) and a live-QA pass across all views + dark mode.**

---

## Self-review (author check against spec)

- Placement/Push/all-views/height-px/notes-right/header-chips/Esc/motion — each maps to a task above (Tasks 2-8). ✓
- Height persistence (localStorage), clamp incl. inverted range — Task 1. ✓
- Month-view fix (blocking) — Task 4. ✓
- 7 view roots min-h-0 (blocking) — Task 3. ✓
- Esc collision with Settings — Task 7. ✓
- Notes-column sizing gotcha — Task 5 step 5. ✓
- Deferred narrow-width stacking — out of scope, in TODOS.md. ✓
- No placeholders; every code step shows code; types (`detailPanelHeightPx`, `setDetailPanelHeightPx`, `clampDetailHeight`) consistent across tasks. ✓
