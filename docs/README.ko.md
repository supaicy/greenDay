<p align="center">
  <img src="../resources/icon-128-rounded.png" alt="Greenday" width="128" height="128">
</p>

<h1 align="center">Greenday</h1>

<p align="center">
  <strong>macOS 올인원 생산성 앱</strong><br>
  할 일 관리, 캘린더, 포모도로, 습관 트래커를 하나에
</p>

<p align="center">
  <a href="../README.md">🇺🇸 English</a>
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

1. 위의 **Download** 버튼 클릭 (또는 [Releases](https://github.com/supaicy/greenDay/releases) 페이지)
2. 다운로드된 `.dmg` 파일 열기
3. `Greenday` 앱을 `Applications` 폴더로 드래그
4. 바로 실행하면 됩니다 — 추가 작업이 없습니다.

> 릴리스는 Developer ID 인증서로 서명되고 Apple 공증을 거칩니다(릴리스 워크플로가 둘 다
> 검증한 뒤에만 공개합니다). 그래서 Gatekeeper가 "손상되었습니다" 경고 없이 엽니다.
> 그래도 경고가 뜬다면 내려받은 파일이 손상되거나 바뀐 것이니, 격리 플래그를 지우지 말고
> 다시 내려받으세요.

### 업데이트

앱 내 **설정 > 업데이트 확인**에서 새 버전이 감지되면 GitHub Releases 페이지로 이동합니다.
`Greenday-arm64.dmg`(Intel은 `Greenday-x64.dmg`)를 다시 다운로드하여 기존 앱에 덮어쓰기하세요.

### 소스에서 빌드

```bash
git clone https://github.com/supaicy/greenDay.git
cd greenDay
npm install
npm run dev        # 개발 모드 실행
npm run package    # macOS 앱으로 패키징
```

## AI 설정 (선택)

Greenday의 AI 기능은 로컬 모델이나 클라우드 모델 모두 사용할 수 있습니다. **설정 → AI**에서 구성하세요.

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
- Apple Silicon(`Greenday-arm64.dmg`)과 Intel(`Greenday-x64.dmg`) 둘 다 — 릴리스마다 둘 다 빌드하고 공증합니다

---

<p align="center">
  Made by <a href="https://github.com/supaicy">supaicy</a>
</p>
