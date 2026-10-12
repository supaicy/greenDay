<p align="center">
  <img src="../resources/icon-128-rounded.png" alt="haru" width="128" height="128">
</p>

<h1 align="center">haru</h1>

<p align="center">
  <strong>macOS 올인원 생산성 앱</strong><br>
  할 일 관리, 캘린더, 포모도로, 습관 트래커를 하나에
</p>

<p align="center">
  <a href="../README.md">🇺🇸 English</a>
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

> ### 📦 이 저장소는 이제 릴리스 전용입니다
>
> 개발은 비공개 저장소로 옮겼습니다. 이 저장소는 **릴리스·다운로드 링크·랜딩 페이지**를
> 그대로 유지합니다. 쓰시는 데 달라지는 것은 없습니다.
>
> **지금 쓰시는 앱은 계속 동작합니다.** v1.4.1과 그 이전 공개 릴리스는 **영구히 무료이고
> MIT입니다.** 그 버전들에는 라이선스 검사도, 원격으로 끄는 장치도 들어 있지 않습니다.
> 나중에 소급해서 바꿀 수 있는 것이 아닙니다.
>
> **Greenday v2는 새로 나온 별도의 유료 앱**입니다. v1.4.1의 업데이트가 아니고,
> 자동 업데이트로 가지도 않습니다 — 업데이트 채널을 일부러 갈라 두었습니다.
> 원하실 때 직접 받으시면 됩니다: <https://begreen.dev/ko/greenday>


## 주요 기능

| 기능 | 설명 |
|------|------|
| **태스크 관리** | 할 일 추가/편집/삭제, 서브태스크, 우선순위, 태그 |
| **AI 어시스턴트** | 자연어로 태스크 생성 시 서브태스크, 우선순위, 마감일 자동 추출 (Ollama / OpenAI 지원) |
| **AI 채팅** | 일정, 마감일, 생산성에 대해 실시간 스트리밍 답변 |
| **자연어 입력** | "내일 장보기", "다음주 월요일 회의", "글피 치과" 등 한국어/영어 날짜 인식 |
| **캘린더** | 월간 / 주간 / 일간 뷰 |
| **타임블로킹** | 작업을 캘린더 슬롯으로 드래그해서 실행 예정 시간 배정 — 이동/리사이즈/해제 지원. 반복 작업은 매 인스턴스에 자동 반영. |
| **칸반 보드** | 드래그앤드롭으로 할 일 / 진행 중 / 완료 관리 |
| **포모도로 타이머** | 25분 집중 + 5분 휴식 사이클, 세션 기록 |
| **습관 트래커** | 매일 체크하는 습관 목록 |
| **아이젠하워 매트릭스** | 긴급/중요도 기반 4분면 정리 |
| **타임라인** | 시간순 태스크 흐름 보기 |
| **통계** | 완료율, 포모도로 기록, 생산성 분석 |
| **게이미피케이션** | 점수 / 레벨 시스템으로 동기부여 |
| **다크 / 라이트 모드** | 눈이 편한 테마 전환 |
| **키보드 단축키** | Cmd+N, Cmd+Shift+A 등 빠른 조작 |

## 설치 방법

### DMG로 설치 (권장)

1. 위의 **Download** 버튼 클릭 (또는 [Releases](https://github.com/supaicy/haru/releases) 페이지)
2. 다운로드된 `.dmg` 파일 열기
3. `haru` 앱을 `Applications` 폴더로 드래그
4. **첫 실행 전에 터미널에서 아래 명령을 실행하세요:**

```bash
xattr -cr /Applications/haru.app
```

> **왜 필요한가요?**
> haru는 Apple Developer 인증서로 서명되지 않은 오픈소스 앱입니다.
> macOS가 "손상되었습니다" 경고를 표시할 수 있으며, 위 명령으로 해결됩니다.
> 이 명령은 최초 설치 시 1회만 실행하면 됩니다.

### 업데이트

앱 내 **설정 > 업데이트 확인**에서 새 버전이 감지되면 GitHub Releases 페이지로 이동합니다.
`haru.dmg`를 다시 다운로드하여 기존 앱에 덮어쓰기하세요.

### 소스에서 빌드

```bash
git clone https://github.com/supaicy/haru.git
cd haru
npm install
npm run dev        # 개발 모드 실행
npm run package    # macOS 앱으로 패키징
```

## AI 설정 (선택)

haru의 AI 기능은 로컬 모델이나 클라우드 모델 모두 사용할 수 있습니다. **설정 → AI**에서 구성하세요.

| 제공자 | 기본 엔드포인트 | 기본 모델 | 비고 |
|--------|----------------|-----------|------|
| **Ollama** (로컬, 무료) | `http://localhost:11434` | `llama3.2:latest` | [Ollama](https://ollama.com) 설치 후 `ollama pull llama3.2` |
| **OpenAI** | `https://api.openai.com` | `gpt-4o-mini` | [platform.openai.com](https://platform.openai.com/api-keys)에서 API 키 발급 |
| **Custom** | 직접 지정 | 직접 지정 | OpenAI 호환 엔드포인트 모두 가능 |

## 키보드 단축키

| 단축키 | 기능 |
|--------|------|
| `Cmd + N` | 할 일 추가 |
| `Cmd + Shift + A` | 빠른 추가 (글로벌) |
| `Cmd + F` | 검색 |
| `Cmd + Z` | 되돌리기 |
| `Cmd + D` | 오늘 마감일 설정 |
| `Cmd + E` | 데이터 내보내기 |
| `1` `2` `3` `4` | 우선순위 변경 |
| `Delete` | 선택 태스크 삭제 |
| `Esc` | 선택 해제 / 닫기 |

## 기술 스택

- **Electron 40** — macOS 네이티브 앱
- **React 19** + **TypeScript** — UI
- **Tailwind CSS 3** — 스타일링
- **Zustand** — 상태 관리
- **JSON 파일 저장소** — 로컬 데이터 저장

## 시스템 요구사항

- macOS 12 (Monterey) 이상
- Apple Silicon 전용 (M1 / M2 / M3 / M4) — *Intel Mac은 지원하지 않습니다*

---

<p align="center">
  Made by <a href="https://github.com/supaicy">supaicy</a>
</p>
