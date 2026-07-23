# Bottom Task Detail Panel — Design Spec

- **Date**: 2026-07-24
- **Status**: Approved (design) — pending implementation plan
- **Author**: pair session (user + Claude)
- **Visual reference**: `docs/design-mockups/task-detail-bottom-v2.html` (interactive), `docs/design-mockups/v2-final-notes-right.png`

## Goal

Move the task detail from the current right-side vertical panel to a **bottom panel** that slides up (TickTick-style), so the detail reads as a wide, short surface and can appear from any view.

## Current state (before)

- `App.tsx` lays the app out as a horizontal flex: `Sidebar | [ MainContent + TaskDetail(right) ] | AiChatPanel`.
- `TaskDetail` is a `w-[480px] min-w-[400px] border-l` full-height **right column**, rendered only when `viewType === 'tasks' && selectedTaskId` — so the detail appears **only in the list view**, not in calendar/kanban/timeline/eisenhower.
- Detail content is a tall vertical stack: title → list → date+time → priority → reminder → recurring → tags → subtasks → attachments → notes.

## Design decisions (confirmed)

1. **Placement**: bottom panel, slides up from the bottom of the content area (right of the sidebar). Does not extend under the sidebar.
2. **Behavior**: **Push** — the view content (list/calendar/kanban/…) shrinks vertically to sit above the panel; both are visible at once. Not an overlay.
3. **Scope**: **all views**. Clicking a task/event in any view opens the same bottom detail. Remove the `viewType === 'tasks'` gate; gate on `selectedTaskId` alone. **Per-view reality (from review):** 6 of 7 views already call `selectTask(id)` and work unchanged — List (`TaskItem.tsx:79`), Kanban (`KanbanView.tsx:213`), Timeline (`TimelineView.tsx:184`), Eisenhower (`EisenhowerMatrix.tsx:118`), Calendar Week (`WeeklyCalendar.tsx:292`), Calendar Day (`DailyCalendar.tsx:213`). **Only Calendar Month must change**: `CalendarView.tsx:110-114` calls `setViewType('tasks')` (which nulls `selectedTaskId`, `useStore.ts:623`) and `setSelectedList` (also nulls it, `useStore.ts:327`) before `selectTask`, so it jumps to the list instead of opening the panel in place. Fix: drop `setViewType('tasks')` (and re-check `setSelectedList`) so month view keeps its context and just selects the task.
4. **Height**: user-adjustable by **dragging a grip** at the top edge of the panel. The chosen height **persists** across sessions. Stored as **absolute px** (see Store) so the panel keeps the exact size the user set even after the window is resized — vh was considered but rejected because it rescales the panel when the window changes. Default on first use ≈ 72% of the content-area height. Clamped so it never overflows: `[240px, contentHeight − 160px]` (always keep ≥160px of the view visible above); re-clamp on window resize.
5. **Content layout** (reference-informed — TickTick / Todoist / Things), notes on the **right**:
   - **Header** (full width): complete circle `○` (priority-colored) + editable **title** + inline chips `📅 date/time` and `⚑ priority` + close `✕`.
   - **Body, two columns**:
     - **Left column**: `하위 작업` (subtasks + progress + add) → `첨부` (attachments + add) → compact **meta list**: `리스트` (dropdown), `우선순위` (segmented 없음/낮음/중간/높음), `알림`, `반복`, `# 태그`.
     - **Right column**: `메모` (notes) with `편집`/`미리보기` tabs — the primary content area (hero).
6. **Open / close**:
   - Open: selecting a task in any view (`selectTask(id)`).
   - Close: `✕` button and `Esc`. **Reuse the existing Esc path** — `useKeyboardShortcuts.ts:35` already does `selectTask(null)` on Escape, which now closes the bottom panel for free. Do NOT add a new panel Esc listener. Two fixes needed there: (a) add `showSettings` to that handler's modal guard (it currently checks `showQuickAdd`/`showExport`/`showAddTask` but not `showSettings`), and (b) make the Settings capture-phase Esc handler (`Settings.tsx:67`, added for the earlier modal fix) call `stopPropagation()` so one Esc doesn't both close Settings AND deselect the task. Close == deselect (single `selectedTaskId` state); do not add a separate "panel open" boolean.
7. **Motion**: slide up/down, ~0.3s ease (`cubic-bezier(.32,.72,0,1)`), matching the mockup.

## Architecture / component changes

### `App.tsx`
- Change the inner content wrapper from horizontal to **vertical** flex so the detail sits below the view:
  - Before: `<div className="flex flex-1 min-w-0"> <MainContent/> {gate && <TaskDetail/>} </div>`
  - After: `<div className="flex flex-col flex-1 min-w-0"> <MainContent/ (flex-1, min-h-0, overflow)> {selectedTaskId && <TaskDetail/>} </div>`
- Gate becomes `selectedTaskId` only (drop `viewType === 'tasks'`). Keep the `lazy`/`Suspense` wrapping for `TaskDetail`.
- `MainContent` (`App.tsx:25-49`) is only a `switch` returning each view — it renders no wrapper. So `flex-1 min-h-0` must land on **each view root**, not on a MainContent wrapper. Either wrap `<MainContent/>` in a `flex-1 min-h-0 overflow-hidden` div, or apply it per view.

### View roots — `h-full` → `min-h-0` (7 files) [from review]
Every view root is `flex-1 flex flex-col h-full`; with the parent now vertical-flex and the panel a sibling below, `h-full` (=100% of parent) overflows behind/pushes the panel off-screen. Change `h-full` → `min-h-0` (or wrap) on: `TaskList.tsx:131`, `KanbanView.tsx:163`, `TimelineView.tsx:132`, `EisenhowerMatrix.tsx:171`, `CalendarView.tsx:36`, `WeeklyCalendar.tsx:183`, `DailyCalendar.tsx:154`. Their inner scroll containers (`flex-1 overflow-y-auto`) and fixed-px calendar time grids shrink correctly once the root height is bounded — mechanical change, not a rearchitecture.

### `TaskDetail.tsx`
- Rework the container from `w-[480px] ... h-full border-l` (right column) to a **full-width bottom panel**: fixed to the bottom of the content column, height = stored value, `border-t`, top shadow, slide transform.
- Add a **grip** row at the top (drag handle) wired to a resize interaction.
- Restructure internal JSX:
  - Header row: complete toggle + title input + date chip + priority chip + close.
  - Body: CSS grid, two columns. Left = subtasks/attachments/meta; Right = notes (편집/미리보기).
- Preserve all existing behaviors: title `onBlur` save, notes `onBlur` save, priority set, list picker, date/time picker, reminder, recurring, tags, subtasks (SubtaskList), attachments (AttachmentList), markdown preview. This is a **re-layout**, not a rewrite of the field logic.
- **Notes-column sizing gotcha** [review]: the notes block (`TaskDetail.tsx:368-443`) sizes its textarea/markdown via `flex-1 min-h-[200px]` off the parent chain's `flex-1 min-h-0`. In the 2-column grid, the notes column needs its own `flex flex-col min-h-0 h-full` or the notes won't fill the column height. This is the one spot where re-layout touches sizing logic.
- Keep dark-mode styling (existing `isDark` branches).

### Store (`useStore.ts`)
- Add UI state `detailPanelHeightPx: number | null` (null = "use default 72% of content height on first open"). **Persist via `localStorage`** — theme persistence is `localStorage.setItem('ticktick-theme', …)` inside the setter (`useStore.ts:626`) read at init (`useStore.ts:263`); there is NO persist middleware. Mirror it: read `localStorage.getItem('ticktick-detail-height')` at init, write in the setter. (Not the `ticktick-data.json` store.)
- Action `setDetailPanelHeightPx(px)` clamps and persists. **Clamp must handle small windows** where `contentH − 160 < 240` (range inverts): `Math.min(Math.max(px, 240), Math.max(240, contentH − 160))`. During drag, derive px from the pointer: `contentBottom − clientY`, clamped. On window resize, re-clamp the stored value. The first computed default (72%) must also be clamped.

### Resize interaction
- Grip `mousedown` → track drag → live-update inline height (clamped) → on `mouseup`, commit to `setDetailPanelHeightPx` (persist).

## Edge cases / considerations

- **Dark mode**: panel bg, borders, chips, notes must follow the existing theme tokens.
- **AI panel coexistence**: `AiChatPanel` remains a separate right column outside the content wrapper; the bottom detail lives inside the content column, so they coexist without overlap. Verify on a 1200px window.
- **Narrow width**: if the content column is narrow, the two-column body may need to stack (min-width guard) — acceptable to defer to a follow-up, but note it.
- **Empty / long content**: notes and subtasks scroll within their column; header title truncates.
- **Per-view click wiring**: see Design decision #3 — 6/7 views already work; only Calendar Month (`CalendarView.tsx:110-114`) needs its click handler changed.
- **Keyboard**: `Esc` closes; see Design decision #6 — reuse `useKeyboardShortcuts` Esc, add `showSettings` guard, `stopPropagation` in Settings' capture handler.
- **Lazy/Suspense flash** [review]: TaskDetail is `lazy` with `<Suspense fallback={null}>` (`App.tsx:107`). First-ever open fetches the chunk → null → mounts → then animates, so the slide may not play on the very first open. Acceptable, or preload the chunk on first `selectTask`. Minor.

## Testing

- Unit: `setDetailPanelHeightPx` clamps (incl. inverted-range small-window case) and persists to localStorage; height survives reload.
- **No renderer component tests exist** [review] — the test suite is util/store/main only, so "re-layout not rewrite" has no automated safety net. Every TaskDetail field must be **manually re-verified** after the JSX restructure: title/notes onBlur save, priority, list/date/time pickers, reminder, recurring, tags, subtasks, attachments, markdown checkbox toggle (`TaskDetail.tsx:116-131`), preview. Live-QA across list/calendar/kanban; drag-resize persist; Esc/✕ close; dark mode; no console errors.

## Deferred follow-ups (recorded, not in this change)

- **Narrow-width responsive stacking** — when the content column is narrow, the two-column body (subtasks/meta | notes) gets cramped. Deferred by decision (2026-07-24): ship the two-column layout now; add a breakpoint that stacks the columns vertically below some width as a follow-up. Tracked in `TODOS.md`.

## Out of scope

- Redesigning the fields themselves (pickers, markdown editor) — only their arrangement changes.
- Full mobile/responsive redesign (beyond the deferred narrow-width stack above).
- Changing the AI panel or settings modal.
