<p align="center">
  <img src="resources/icon-128-rounded.png" alt="Greenday" width="128" height="128">
</p>

<h1 align="center">Greenday</h1>

<p align="center">
  <strong>All-in-one productivity app for macOS</strong><br>
  Tasks, Calendar, Pomodoro, and Habit Tracker — in one place
</p>

<p align="center">
  <a href="docs/README.ko.md">🇰🇷 한국어</a>
</p>

<p align="center">
  <a href="https://github.com/supaicy/greenDay/releases/latest/download/Greenday-arm64.dmg">
    <img src="https://img.shields.io/badge/Download-macOS_(Apple_Silicon)-blue?style=for-the-badge&logo=apple" alt="Download DMG">
  </a>
</p>

<p align="center">
  <a href="https://github.com/supaicy/greenDay/stargazers">
    <img src="https://img.shields.io/github/stars/supaicy/greenDay?style=flat-square" alt="Stars">
  </a>
  <img src="https://img.shields.io/github/downloads/supaicy/greenDay/total?style=flat-square" alt="Downloads">
  <img src="https://img.shields.io/github/v/release/supaicy/greenDay?style=flat-square" alt="Release">
  <img src="https://img.shields.io/badge/platform-macOS-lightgrey?style=flat-square" alt="Platform">
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License">
</p>

---

## Features

| Feature | Description |
|---------|-------------|
| **Task Management** | Create, edit, delete tasks with subtasks, priorities, and tags |
| **AI Assistant** | Natural language task creation with auto subtasks, priority, and due dates via Ollama or OpenAI |
| **AI Chat** | Ask about your schedule, deadlines, and productivity with streaming responses |
| **Natural Language Input** | "내일 장보기", "next monday meeting", "글피 치과" — Korean and English supported |
| **Calendar** | Monthly, weekly, and daily views |
| **Time Blocking** | Drag tasks onto calendar slots to schedule when you'll work on them — resize, move, unschedule. Recurring tasks repeat the block automatically. |
| **Kanban Board** | Drag-and-drop tasks across To Do / In Progress / Done |
| **Pomodoro Timer** | 25-min focus + 5-min break cycles with session history |
| **Habit Tracker** | Daily habit checklist |
| **Eisenhower Matrix** | Organize by urgency and importance |
| **Timeline** | Chronological task flow view |
| **Statistics** | Completion rates, pomodoro records, productivity analytics |
| **Gamification** | Points and level system for motivation |
| **Dark / Light Mode** | Easy on the eyes, day or night |
| **Keyboard Shortcuts** | Cmd+N, Cmd+Shift+A, and more for fast navigation |

## Installation

### Homebrew (Recommended)

```bash
brew install --cask supaicy/haru/greenday
```

To upgrade:

```bash
brew upgrade --cask greenday
```

### Download DMG

1. Click the **Download** button above (or visit [Releases](https://github.com/supaicy/greenDay/releases))
2. Open the downloaded `.dmg` and drag `Greenday` into your `Applications` folder
3. Launch it — no extra steps.

> Releases are signed with a Developer ID certificate and notarized by Apple (the release
> workflow verifies both before publishing), so Gatekeeper opens Greenday without a
> *"damaged"* warning. If you still see one, the download was altered or incomplete —
> download it again rather than clearing the quarantine flag.

### Update

- **Homebrew:** `brew upgrade --cask greenday`
- **DMG:** Open **Settings → Check for Updates** in-app. When a new version is available, download the latest `Greenday-arm64.dmg` (or `Greenday-x64.dmg` for Intel) from Releases and replace the existing app.

### Build from Source

```bash
git clone https://github.com/supaicy/greenDay.git
cd greenDay
npm install
npm run dev        # Development mode
npm run package    # Build macOS app
```

## AI Setup (Optional)

Greenday's AI features work with a local or cloud model. Configure under **Settings → AI**.

| Provider | Default endpoint | Default model | Notes |
|----------|------------------|---------------|-------|
| **Ollama** (local, free) | `http://localhost:11434` | `llama3.2:latest` | Install [Ollama](https://ollama.com), then `ollama pull llama3.2` |
| **OpenAI** | `https://api.openai.com` | `gpt-4o-mini` | Paste an API key from [platform.openai.com](https://platform.openai.com/api-keys) |
| **Custom** | Your own URL | Your own model | Any OpenAI-compatible endpoint |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd + N` | Add task |
| `Cmd + Shift + A` | Quick add (global) |
| `Cmd + F` | Search |
| `Cmd + Z` | Undo |
| `Cmd + D` | Set due date to today |
| `Cmd + E` | Export data |
| `1` `2` `3` `4` | Change priority |
| `Delete` | Delete selected task |
| `Esc` | Deselect / Close |

## Documentation

Developer docs (Korean) live under [`docs/`](docs/README.md) — tutorials, how-tos (release, Mac App Store, bridge build, Google OAuth, screenshots, i18n), references (scripts and flags, IPC channels, licensing, migration files) and explanations (bundle-ID migration, license gate and MAS, local data and safeStorage). Start at [docs/README.md](docs/README.md).

## Tech Stack

- **Electron 40** — Native macOS app
- **React 19** + **TypeScript** — UI
- **Tailwind CSS 3** — Styling
- **Zustand** — State management
- **JSON file storage** — Local data persistence

## System Requirements

- macOS 12 (Monterey) or later
- Apple Silicon (`Greenday-arm64.dmg`) and Intel (`Greenday-x64.dmg`) — both are built and notarized for every release

---

<p align="center">
  Made by <a href="https://github.com/supaicy">supaicy</a>
</p>
