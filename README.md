<p align="center">
  <img src="resources/icon-128-rounded.png" alt="haru" width="128" height="128">
</p>

<h1 align="center">haru</h1>

<p align="center">
  <strong>All-in-one productivity app for macOS</strong><br>
  Tasks, Calendar, Pomodoro, and Habit Tracker — in one place
</p>

<p align="center">
  <a href="docs/README.ko.md">🇰🇷 한국어</a>
</p>

<p align="center">
  <a href="https://github.com/supaicy/haru/releases/latest/download/haru.dmg">
    <img src="https://img.shields.io/badge/Download-macOS_(Apple_Silicon)-blue?style=for-the-badge&logo=apple" alt="Download DMG">
  </a>
</p>

<p align="center">
  <a href="https://github.com/supaicy/haru/stargazers">
    <img src="https://img.shields.io/github/stars/supaicy/haru?style=flat-square" alt="Stars">
  </a>
  <img src="https://img.shields.io/github/downloads/supaicy/haru/total?style=flat-square" alt="Downloads">
  <img src="https://img.shields.io/github/v/release/supaicy/haru?style=flat-square" alt="Release">
  <img src="https://img.shields.io/badge/platform-macOS-lightgrey?style=flat-square" alt="Platform">
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License">
</p>

---

> ### 📦 This repository is now for releases only
>
> Development has moved to a private repository. This repo continues to host the
> **releases, the download links and the landing page** — nothing here changes for you.
>
> **Your current app keeps working.** v1.4.1 and every earlier public release stay
> **free and MIT-licensed, permanently.** They contain no licence check and no remote
> kill switch, and that cannot be changed retroactively.
>
> **Greenday v2 is a separate, new, paid app.** It is not an update to v1.4.1 and it will
> not arrive through auto-update — the update channels are deliberately split. If you want
> it, you choose it: <https://begreen.dev/greenday>
>
> _한국어: 이 저장소는 이제 **릴리스 전용**입니다. **v1.4.1과 그 이전 공개 릴리스는 계속 무료이고
> MIT이며, 영구히 그렇습니다** — 라이선스 검사도 원격 차단 장치도 들어 있지 않습니다.
> **Greenday v2는 새로 나온 별도의 유료 앱**이고 자동 업데이트로 가지 않습니다. 원하실 때만
> 직접 받으시면 됩니다._


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
brew install --cask supaicy/haru/haru
```

If macOS shows a "damaged" warning on first launch, clear the quarantine flag:

```bash
xattr -cr /Applications/haru.app
```

To upgrade:

```bash
brew upgrade --cask haru
```

### Download DMG

1. Click the **Download** button above (or visit [Releases](https://github.com/supaicy/haru/releases))
2. Open the downloaded `.dmg` and drag `haru` into your `Applications` folder
3. Before the first launch, run:

```bash
xattr -cr /Applications/haru.app
```

> haru is open-source and isn't signed with an Apple Developer certificate, so macOS may show a *"damaged"* warning. The command above clears the quarantine flag and only needs to run once.

### Update

- **Homebrew:** `brew upgrade --cask haru`
- **DMG:** Open **Settings → Check for Updates** in-app. When a new version is available, download the latest `haru.dmg` from Releases and replace the existing app.

### Build from Source

```bash
git clone https://github.com/supaicy/haru.git
cd haru
npm install
npm run dev        # Development mode
npm run package    # Build macOS app
```

## AI Setup (Optional)

haru's AI features work with a local or cloud model. Configure under **Settings → AI**.

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

## Tech Stack

- **Electron 40** — Native macOS app
- **React 19** + **TypeScript** — UI
- **Tailwind CSS 3** — Styling
- **Zustand** — State management
- **JSON file storage** — Local data persistence

## System Requirements

- macOS 12 (Monterey) or later
- Apple Silicon only (M1 / M2 / M3 / M4) — *Intel Macs are not supported*

---

<p align="center">
  Made by <a href="https://github.com/supaicy">supaicy</a>
</p>
