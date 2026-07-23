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
3. **Scope**: **all views**. Clicking a task/event in any view (list, calendar month/week/day, kanban, timeline, eisenhower) opens the same bottom detail. Remove the `viewType === 'tasks'` gate; gate on `selectedTaskId` alone.
4. **Height**: user-adjustable by **dragging a grip** at the top edge of the panel. The chosen height **persists** across sessions. Default on first use ≈ 78vh ("XL"). Clamp to a sensible range (min ~22vh, max ~88vh).
5. **Content layout** (reference-informed — TickTick / Todoist / Things), notes on the **right**:
   - **Header** (full width): complete circle `○` (priority-colored) + editable **title** + inline chips `📅 date/time` and `⚑ priority` + close `✕`.
   - **Body, two columns**:
     - **Left column**: `하위 작업` (subtasks + progress + add) → `첨부` (attachments + add) → compact **meta list**: `리스트` (dropdown), `우선순위` (segmented 없음/낮음/중간/높음), `알림`, `반복`, `# 태그`.
     - **Right column**: `메모` (notes) with `편집`/`미리보기` tabs — the primary content area (hero).
6. **Open / close**:
   - Open: selecting a task in any view (`selectTask(id)`).
   - Close: `✕` button and `Esc`. (Escape closes the detail; does not clear other state.)
7. **Motion**: slide up/down, ~0.3s ease (`cubic-bezier(.32,.72,0,1)`), matching the mockup.

## Architecture / component changes

### `App.tsx`
- Change the inner content wrapper from horizontal to **vertical** flex so the detail sits below the view:
  - Before: `<div className="flex flex-1 min-w-0"> <MainContent/> {gate && <TaskDetail/>} </div>`
  - After: `<div className="flex flex-col flex-1 min-w-0"> <MainContent/ (flex-1, min-h-0, overflow)> {selectedTaskId && <TaskDetail/>} </div>`
- Gate becomes `selectedTaskId` only (drop `viewType === 'tasks'`). Keep the `lazy`/`Suspense` wrapping for `TaskDetail`.
- `MainContent` gets `flex-1 min-h-0 overflow-hidden` so it shrinks and scrolls internally when the panel is open (Push).

### `TaskDetail.tsx`
- Rework the container from `w-[480px] ... h-full border-l` (right column) to a **full-width bottom panel**: fixed to the bottom of the content column, height = stored value, `border-t`, top shadow, slide transform.
- Add a **grip** row at the top (drag handle) wired to a resize interaction.
- Restructure internal JSX:
  - Header row: complete toggle + title input + date chip + priority chip + close.
  - Body: CSS grid, two columns. Left = subtasks/attachments/meta; Right = notes (편집/미리보기).
- Preserve all existing behaviors: title `onBlur` save, notes `onBlur` save, priority set, list picker, date/time picker, reminder, recurring, tags, subtasks (SubtaskList), attachments (AttachmentList), markdown preview. This is a **re-layout**, not a rewrite of the field logic.
- Keep dark-mode styling (existing `isDark` branches).

### Store (`useStore.ts`)
- Add persisted UI state `detailPanelHeightVh: number` — panel height as a **vh percentage** (scales with window size), default `78`. Persist alongside other UI prefs (same mechanism as `theme`).
- Action `setDetailPanelHeightVh(vh)` clamps to `[22, 88]` and persists. During drag, convert the pointer position to vh: `(1 - clientY / window.innerHeight) * 100`, clamped.

### Resize interaction
- Grip `mousedown` → track drag → live-update `--detail-height` (or inline height) → on `mouseup`, commit to `setDetailPanelHeight` (persist). Clamp during drag.

## Edge cases / considerations

- **Dark mode**: panel bg, borders, chips, notes must follow the existing theme tokens.
- **AI panel coexistence**: `AiChatPanel` remains a separate right column outside the content wrapper; the bottom detail lives inside the content column, so they coexist without overlap. Verify on a 1200px window.
- **Narrow width**: if the content column is narrow, the two-column body may need to stack (min-width guard) — acceptable to defer to a follow-up, but note it.
- **Empty / long content**: notes and subtasks scroll within their column; header title truncates.
- **Per-view click wiring**: confirm each view (Kanban, Calendar*, Timeline, Eisenhower) calls `selectTask(id)` on task/event click so the panel opens everywhere. Where a view does not yet, add it.
- **Keyboard**: `Esc` closes; ensure it doesn't collide with other Esc handlers (e.g., modals). Detail Esc only when a task is selected and no modal is open.

## Testing

- Unit: `setDetailPanelHeight` clamps and persists; height survives reload.
- Behavior (manual / live): detail opens from list, calendar, kanban; drag resizes and persists; Esc/✕ close; title/notes/priority/subtask edits still work; dark mode looks right.
- Regression: existing TaskDetail field tests (if any) still pass; no console errors on open/close across views.

## Out of scope

- Redesigning the fields themselves (pickers, markdown editor) — only their arrangement changes.
- Mobile/responsive redesign beyond the narrow-width stack note.
- Changing the AI panel or settings modal.
