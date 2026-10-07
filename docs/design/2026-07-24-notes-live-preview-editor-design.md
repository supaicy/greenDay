# Notes Live-Preview Editor — Design Spec

- **Date**: 2026-07-24
- **Status**: Approved (design) — pending implementation plan
- **Author**: pair session (user + Claude)

## Goal

Replace the task-detail notes editor (raw `textarea` ⇄ rendered preview toggle) with an **Obsidian-style live-preview** markdown editor: everything renders as formatted markdown except the line/block the cursor is on, which shows raw source. Single mode — no edit/preview toggle.

## Background / decision

- The requested experience ("edit the current line as raw, render the rest") is exactly Obsidian's Live Preview.
- Two paradigms exist: **editor-with-decorations** (raw markdown stays the source of truth — Obsidian, CodeMirror 6) vs **contenteditable WYSIWYG** (rendered DOM is the source — Typora, or ProseMirror/TipTap with a separate doc model). The app stores `description` as raw markdown and manipulates it directly, and Korean IME must work — both favor the CodeMirror 6 (Obsidian) paradigm. Typora/WYSIWYG would change the storage model and bring contenteditable IME pain, so it is rejected.
- Within the CM6 paradigm: **use a library** (`@atomic-editor/editor`) vs **build custom decorations**. Research found `@atomic-editor/editor` — a React-native, MIT, CM6-based library that does exactly this (raw on cursor line, rendered elsewhere; headings/bold/italic/highlight/links/images/code-highlight/tables/**clickable task-lists**), `markdownSource` in / `onMarkdownChange` out (preserves raw-markdown storage). Chosen over building custom (which would reimplement it). Confirmed: React 19 peer (`^18 || ^19`), MIT, v0.6.2.

## Current state (before)

- `TaskDetail.tsx` right column: a `편집`/`미리보기` tab toggle, a `<textarea>` (edit) and a react-markdown block (preview), gated by `mdPreview` state.
- Checkboxes: clicking a rendered checkbox runs a custom regex over `description` to flip `- [ ]`/`- [x]` (`toggleCheckbox`, `TaskDetail.tsx`).
- Deps used ONLY by these notes: `react-markdown`, `remark-gfm`, `highlight.js` (+ the hljs theme CSS in `index.css`). Nothing else in the renderer imports them (AI chat does not).
- `description` is stored as raw markdown; saved on textarea blur.

## Design decisions (confirmed)

1. **Single live-preview mode** — remove the 편집/미리보기 toggle and the `mdPreview` state. The Atomic editor is the only notes surface.
2. **Library**: add `@atomic-editor/editor` (pinned `0.6.2`) + its CodeMirror 6 / Lezer peer deps. **Remove** `react-markdown`, `remark-gfm`, `highlight.js` and the hljs CSS import (only the notes used them) — offsets the bundle add. Atomic brings its own CM6 code highlighting.
3. **Data flow**: `markdownSource={description}` in; `onMarkdownChange` out → **debounced autosave (~400ms)** to the store (`save({ description })`), plus a **flush on unmount / task switch** so no edit is lost. Replaces the old onBlur save.
4. **Checkboxes**: use Atomic's built-in clickable task-list toggling. Clicking edits the source → `onMarkdownChange` → save. **Remove** the custom `toggleCheckbox` regex + `checkboxIndex` ref.
5. **Links**: `onLinkClick={(url) => window.api.openExternal(url)}` — open in the system browser (same IPC the app already uses).
6. **Theme**: provide the app's light/dark to the editor (exact API — prop vs CM6 theme extension — confirmed in the spike) matching the app tokens; import `@atomic-editor/editor/styles.css`.
7. **Wiki-links** `[[ ]]`: the app has no note-linking — disable if the library exposes config; if not, harmless (renders inert) and acceptable.
8. **Bundle**: the whole notes stack lives in the lazy-loaded `TaskDetail` chunk, so the main chunk is unaffected; the react-markdown/highlight.js removal offsets the CM6 add.

## Architecture / component changes

### `package.json`
- Add `@atomic-editor/editor@0.6.2` and its peer deps: `@codemirror/{state,view,commands,autocomplete,language,search,lang-markdown}`, `@lezer/{common,highlight,markdown}`, and the `@codemirror/lang-*` modes Atomic needs for code highlighting.
- Remove `react-markdown`, `remark-gfm`, `highlight.js`.

### `TaskDetail.tsx` (notes column only)
- Delete: the `mdPreview` state, the 편집/미리보기 tab buttons, the `<textarea>`, the react-markdown preview block, `toggleCheckbox`, `checkboxIndex`, the `CodeBlock` component, and the hljs imports/registrations.
- Add: `<AtomicCodeMirrorEditor markdownSource={description} onMarkdownChange={onNotesChange} onLinkClick={openLink} .../>` filling the right column (`flex-1 min-h-0`). `markdownSource`/`onMarkdownChange`/`onLinkClick` are confirmed from the README; the **dark/light theming API is confirmed in the spike** (Atomic may take a theme prop or a CM6 theme extension — not assumed here).
- `onNotesChange(md)`: update a `latestNotes` ref + debounced `save({ description: md })`. Flush the pending save in a cleanup effect (task switch / unmount).
- The left column, header, drag, motion, toggle-close — all unchanged.

### `index.css`
- Remove the highlight.js theme import; add any Atomic style overrides needed for dark/light parity.

## Spike — plan Task 0 (GATE, before the real integration)

Install Atomic + peers, mount it in a throwaway spot (or directly behind a flag), and verify:
1. `electron-vite build` (and dev) bundle it cleanly with React 19.
2. **Korean IME** composition works (type 한글 in the editor, no dropped/duplicated chars).
3. Dark theme is achievable to match the app.
4. Bundle delta is acceptable (measure the TaskDetail chunk before/after; expect roughly neutral after removing react-markdown+hljs).
5. Wiki-links can be disabled (or are inert).

**If any of 1–3 fails or is unacceptable → fall back to custom CM6 decorations (approach B), or pause and re-decide with the user.** Do not proceed to the full integration until the gate passes.

## Edge cases / considerations

- **IME (한글)**: primary risk mitigation is the spike; CM6 has mature composition handling.
- **Local-file images** in notes (`![](/path)`): out of scope — external URLs render; local paths behave no worse than today.
- **Pre-1.0 library**: pin the version; MIT license means we can fork/patch if needed.
- **Dark mode**: verify the editor + rendered elements (code blocks, tables) read well in dark.
- **Save timing**: debounce must flush on task switch/unmount and before the app closes, so a quick edit + close doesn't lose data.

## Testing

- No renderer component tests exist; this is manual QA. Checklist:
  - Type markdown → current line shows raw, other lines render.
  - Bold/italic/headings/links/images/code-block-highlight/tables render inline.
  - Task-list checkbox click toggles and **persists** (reopen the task).
  - Link click opens in the system browser.
  - Korean IME typing is correct.
  - Dark and light mode both read well.
  - Edit then immediately switch task / close → change is saved (reopen shows it; survives app restart).
  - No console errors.

## Rollback

The change is contained to the TaskDetail notes column + package.json. If Atomic proves unsuitable after integration, revert the component + restore react-markdown/highlight.js.

## Out of scope

- Note-to-note linking / wiki-link resolution.
- Local-file image rendering in notes.
- Changing any other part of the detail panel (header, meta, drag, motion) or the AI chat markdown.
