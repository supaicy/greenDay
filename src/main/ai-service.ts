// AI Service Layer — Ollama / OpenAI 호환 API 클라이언트
import { lookup } from 'node:dns/promises'
import * as db from './database'
import { type AiConfig, isLocalAiConfig } from '../shared/ai-config'
import { type ChatHistoryMessage, normalizeChatHistory } from '../shared/ai-history'
import { toLocalDateString } from '../shared/date'

const ALLOWED_ACTIONS = ['create_task', 'chat_response', 'task_action'] as const
const ACTION_OPS = ['complete', 'reschedule', 'delete', 'none'] as const
const VALID_PRIORITIES = ['none', 'low', 'medium', 'high'] as const
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const DEFAULT_TIMEOUT = 30_000
// 스트리밍은 전체 시간이 아니라 '토큰 간 유휴' 기준으로 끊는다. 긴 응답도 토큰이
// 계속 오면 유지되고, 모델이 중간에 멈추면 이 시간 뒤 중단된다.
const STREAM_IDLE_TIMEOUT = 30_000
const MAX_RETRIES = 2
// 응답 최대 토큰 (폭주 방지 안전장치 — 일반 답변엔 넉넉). OpenAI 호환 필드라
// Ollama/OpenAI/커스텀 모두 동작.
const MAX_RESPONSE_TOKENS = 2048

const DEFAULT_CONFIG: AiConfig = {
  provider: 'ollama',
  baseUrl: 'http://localhost:11434',
  model: 'llama3.2:latest',
  apiKey: null,
  maxHistoryMessages: 200,
  localOnly: false
}

let config: AiConfig = { ...DEFAULT_CONFIG }

/**
 * 요청 하나가 쓸 설정을 **한 번 찍는다.**
 *
 * `setAiConfig`와 `hydrateFromDisk`는 `config`에 **새 객체를 대입**하지, 들고 있는
 * 객체를 고치지 않는다. 그래서 여기서 잡아 둔 참조는 그 뒤 무슨 일이 있어도 안 변한다.
 *
 * 이게 필요한 이유: 요청 경로는 `await`으로 여러 조각이 나 있고, 그 사이에 `ai:set-config`
 * IPC가 도착할 수 있다. 조각마다 전역을 다시 읽으면 **검사한 주소·실어 보내는 키·모델이
 * 서로 다른 시점의 값**으로 조합된다 — 오리진 A에 결속된 키가 B로 나가는 것이 그 조합
 * 중 하나이고, 관문을 통과한 주소 대신 검사받지 않은 주소로 나가는 것도 그렇다.
 */
function snapshot(): AiConfig {
  // **읽기 전에 디스크를 올린다.** 전역 `config`는 모듈이 올라오는 순간 `DEFAULT_CONFIG`
  // (= ollama / `http://localhost:11434`)이고, 하이드레이션은 `getAiConfig()`와
  // `getAiConfigInternal()` **안에서만** 일어난다. 그런데 앱이 부팅하고 처음 보내는 AI IPC는
  // `ai:check-connection`이지 `ai:get-config`가 아니다(App.tsx의 시작 effect —
  // `ai:get-config`는 설정 화면이나 AI 패널을 **열어야** 나간다). 그래서 첫 연결 확인이,
  // 그리고 그 둘을 열기 전에 누른 할일 폼의 AI 버튼(`ai:create-task` → `callLlm`)이,
  // **저장된 설정 대신 기본 localhost**로 나갔다. 로컬 Ollama가 없으면 `aiConnected=false`가
  // 한 세션 내내 붙어(패널의 재검사는 `null`일 때만 돈다) AI가 통째로 죽고, 떠 있으면 반대로
  // **남의 제공자 모델 목록**이 설정 드롭다운에 실린 채 프롬프트가 localhost로 나간다.
  //
  // 하이드레이션을 여기 두는 이유: 요청을 보내는 다섯 자리가 전부 `snapshot()` 아니면
  // `getAiConfigInternal()`을 지나므로, 이 한 줄이 나머지를 한꺼번에 덮는다.
  // `checkConnection`만 고치면 부팅 검사는 초록이 되는데 그 초록이 띄운 AI 버튼은 여전히
  // localhost로 가서, 오히려 증상이 더 헷갈려진다.
  //
  // 위 주석의 보장은 깨지지 않는다 — `hydrateFromDisk`는 `config`에 **새 객체를 대입**하고
  // 우리는 그 직후 참조를 한 번만 잡는다. 요청 하나가 한 시점의 설정만 쓴다는 성질은 그대로다.
  hydrateFromDisk()
  return config
}

// ── API 키의 봉투 ─────────────────────────────────────────────────────────────

/** 렌더러로 내려보내는 마스킹 접두사. "이 값은 키가 아니다"의 표시이기도 하다. */
const KEY_MASK = '••••••'

/**
 * 이 값이 바뀌면 저장된 키를 못 읽는다. **형식을 바꿀 때만** 올린다.
 * (`purpose`/`account`의 의미가 바뀌는 것도 형식 변경이다.)
 */
const SECRET_ENVELOPE_VERSION = 1

/**
 * 이 암호문이 무엇을 위한 것인가.
 *
 * `safeStorage` 암호문에는 **맥락이 하나도 실리지 않는다**(M3). AI 키·CalDAV 앱 암호·
 * Google 토큰이 같은 키체인 항목으로 같은 형식의 base64가 되므로, userData에 쓸 수 있는
 * 사람은 파일 사이에서 암호문을 **옮기기만 하면** 된다 — 위조할 필요가 없다.
 * 옮겨진 비밀은 받는 쪽이 자기 것인 줄 알고 그대로 **바깥으로 보낸다**(confused deputy).
 *
 * 그래서 평문 안에 버전·용도·계정을 넣고 복호화 뒤에 **엄격히** 확인한다.
 * 넣는 쪽이 아니라 **읽는 쪽**이 판정한다는 점이 요점이다.
 */
const AI_KEY_PURPOSE = 'ai.apiKey'

interface SecretEnvelope {
  v: number
  purpose: string
  account: string
  secret: string
}

/**
 * 이 키가 묶이는 대상 — provider와 **정규화한 오리진**.
 *
 * 오리진으로 잡는 이유(C3): 예전에는 마스킹된 키가 돌아오면 원본 키를 유지하면서
 * `baseUrl`·`provider` 변경은 그대로 받아들였다. 렌더러가 엔드포인트만 공격자 서버로
 * 바꾸고 연결 확인을 부르면, 메인이 보관한 키가 `Bearer`로 그 서버에 나간다.
 *
 * 경로는 보지 않는다 — `https://api.openai.com`과 `https://api.openai.com/v1`은 같은
 * 상대다. 포트와 스킴은 오리진에 포함되므로 `http`로 내리는 다운그레이드도 갈린다.
 */
export function aiKeyAccount(c: Pick<AiConfig, 'provider' | 'baseUrl'>): string | null {
  try {
    return `${c.provider}|${new URL(c.baseUrl).origin}`
  } catch {
    return null
  }
}

function sealAiKey(secret: string, account: string): string {
  const envelope: SecretEnvelope = { v: SECRET_ENVELOPE_VERSION, purpose: AI_KEY_PURPOSE, account, secret }
  return JSON.stringify(envelope)
}

/**
 * 봉투를 연다. **맞지 않으면 아무것도 내주지 않는다.**
 *
 * 세 가지를 다 확인한다: 버전, 용도, 계정. 하나라도 어긋나면 null이고, 호출처는
 * 키가 없는 것처럼 동작한다(= 사용자가 다시 입력해야 한다).
 *
 * **옛 평문 키는 받아들이지 않는다.** 봉투가 생기기 전에 저장된 키는 그냥 문자열이라
 * `JSON.parse`에서 떨어진다. 그걸 "레거시니까 통과"로 열어 두면 M3가 그대로 남는다 —
 * CalDAV 앱 암호(`password_enc`)도 복호화하면 그냥 문자열이라, 그 암호문을
 * `apiKey_enc` 자리로 옮기는 것만으로 사용자의 iCloud 앱 암호가 공격자 서버에
 * `Bearer`로 나간다. 한 번의 키 재입력이 그 구멍보다 싸다.
 */
export function openAiKey(sealed: unknown, account: string | null): string | null {
  if (typeof sealed !== 'string' || !sealed || account === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(sealed)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const envelope = parsed as Record<string, unknown>
  if (envelope.v !== SECRET_ENVELOPE_VERSION) return null
  if (envelope.purpose !== AI_KEY_PURPOSE) return null
  if (envelope.account !== account) return null
  return typeof envelope.secret === 'string' && envelope.secret ? envelope.secret : null
}

/**
 * 디스크의 설정을 메모리로 올린다. 키는 봉투를 열어 **평문으로** 들고 있는다 —
 * 요청을 보낼 때 쓰는 값이고, 렌더러로는 마스킹해서만 나간다.
 */
function hydrateFromDisk(): void {
  const saved = db.getAiConfig()
  if (!saved) return
  const next = { ...DEFAULT_CONFIG, ...saved } as AiConfig
  const stored = next.apiKey
  next.apiKey = openAiKey(stored, aiKeyAccount(next))
  if (stored && !next.apiKey) {
    // 조용히 넘어가면 증상이 "AI가 갑자기 인증 오류를 낸다"로만 나타난다.
    console.error('[ai] 저장된 API 키가 이 구성(provider·주소)의 것이 아니다 — 버렸다. 설정에서 다시 입력해야 한다.')
  }
  config = next
}

function persistConfig(): void {
  const account = aiKeyAccount(config)
  const stored: Record<string, unknown> = { ...config }
  // 키가 없거나 주소가 파싱되지 않으면 아무것도 적지 않는다. 봉투 없이 적으면
  // 다음 로드에서 어차피 거절되고, 그동안 평문 키만 파일에 남는다.
  stored.apiKey = config.apiKey && account ? sealAiKey(config.apiKey, account) : null
  db.saveAiConfig(stored)
}

export function getAiConfig(): AiConfig {
  hydrateFromDisk()
  // API 키는 렌더러에 마스킹하여 반환
  return { ...config, apiKey: config.apiKey ? `${KEY_MASK}${config.apiKey.slice(-4)}` : null }
}

export function getAiConfigInternal(): AiConfig {
  hydrateFromDisk()
  return { ...config }
}

// ── 나가는 주소 판정 (SSRF) ────────────────────────────────────────────────────

/**
 * 주소 하나가 어느 부류인가.
 *
 * `null`은 "IP 리터럴이 아니다"(= 이름이라 DNS를 봐야 한다)이지 허용이 아니다.
 *
 * 루프백을 `blocked`와 가르는 이유: 로컬 Ollama가 이 앱의 기본 구성이라 루프백은
 * 반드시 열려 있어야 한다. 다만 **이름이 루프백으로 해석되는 것**은 다른 이야기라
 * (DNS 리바인딩) 호출처가 두 경우를 다르게 다룬다.
 */
export function classifyAddress(value: string): 'loopback' | 'blocked' | 'public' | null {
  const v4 = ipv4Octets(value)
  if (v4) return classifyIpv4(v4)
  const v6 = ipv6Groups(value)
  if (v6) return classifyIpv6(v6)
  return null
}

function ipv4Octets(value: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value)
  if (!m) return null
  const octets = m.slice(1).map(Number)
  return octets.every((o) => o <= 255) ? octets : null
}

function classifyIpv4([a, b, c]: number[]): 'loopback' | 'blocked' | 'public' {
  if (a === 127) return 'loopback'
  // IANA IPv4 Special-Purpose Address Registry 중 "Globally Reachable = False"인 것들.
  // 0.0.0.0/8 · 10/8 · 100.64/10(CGNAT) · 169.254/16(링크로컬·메타데이터) · 172.16/12 ·
  // 192.0.0/16(프로토콜 할당 + 문서용) · 192.88.99/24(6to4 릴레이) · 192.168/16 ·
  // 198.18/15(벤치마크) · 198.51.100/24·203.0.113/24(문서용) · 224/4 이상(멀티캐스트·예약)
  if (a === 0 || a === 10) return 'blocked'
  if (a === 100 && b >= 64 && b <= 127) return 'blocked'
  if (a === 169 && b === 254) return 'blocked'
  if (a === 172 && b >= 16 && b <= 31) return 'blocked'
  if (a === 192 && b === 0) return 'blocked'
  if (a === 192 && b === 88 && c === 99) return 'blocked'
  if (a === 192 && b === 168) return 'blocked'
  if (a === 198 && (b === 18 || b === 19)) return 'blocked'
  if (a === 198 && b === 51 && c === 100) return 'blocked'
  if (a === 203 && b === 0 && c === 113) return 'blocked'
  if (a >= 224) return 'blocked'
  return 'public'
}

/**
 * IPv6를 8개 그룹으로 편다. `::` 압축과 끝에 붙는 점찍기 IPv4 표기를 다룬다.
 *
 * WHATWG URL은 호스트를 순수 16진 그룹으로 정규화하므로(`[::ffff:10.0.0.5]` →
 * `[::ffff:a00:5]`) URL에서 온 값에는 점 표기가 없다. 그래도 다루는 이유는 이 함수가
 * DNS가 돌려주는 문자열도 받기 때문이다 — 거기는 정규화가 보장되지 않는다.
 */
function ipv6Groups(value: string): number[] | null {
  if (!value.includes(':')) return null
  let text = value
  const embedded: number[] = []
  if (text.includes('.')) {
    const cut = text.lastIndexOf(':')
    const octets = ipv4Octets(text.slice(cut + 1))
    if (!octets) return null
    embedded.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3])
    text = text.slice(0, cut)
    if (text.endsWith(':') && !text.endsWith('::')) text = text.slice(0, -1)
    if (text === '' || text === ':') text = '::'
  }
  const halves = text.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const groups: number[] = []
  for (const part of head) {
    const n = hexGroup(part)
    if (n === null) return null
    groups.push(n)
  }
  const missing = 8 - embedded.length - head.length - tail.length
  if (halves.length === 2) {
    if (missing < 0) return null
    for (let i = 0; i < missing; i++) groups.push(0)
  } else if (missing !== 0) {
    return null
  }
  for (const part of tail) {
    const n = hexGroup(part)
    if (n === null) return null
    groups.push(n)
  }
  groups.push(...embedded)
  return groups.length === 8 ? groups : null
}

function hexGroup(part: string): number | null {
  return /^[0-9a-fA-F]{1,4}$/.test(part) ? Number.parseInt(part, 16) : null
}

/**
 * IPv6는 **차단 목록이 아니라 허용 목록으로** 판정한다.
 *
 * 특수 용도 접두사를 하나씩 지워 나가면 반드시 빠뜨린다 — 실제로 `fec0::/10`(사이트
 * 로컬), `100::/64`(discard-only), `::ffff:0:0/96`(IPv4 변환)이 전부 `public`으로
 * 새어 나갔다. IANA IPv6 Special-Purpose 레지스트리에서 "Globally Reachable = True"인
 * 것은 사실상 전역 유니캐스트(`2000::/3`)뿐이므로, 그 밖은 전부 닫고 안에서 몇 개를
 * 다시 판다.
 *
 * 감싼 IPv4를 **먼저** 꺼낸다. 그 주소가 진짜 목적지이고, 꺼내지 않으면
 * `::ffff:93.184.216.34` 같은 정상 주소까지 `2000::/3` 밖이라고 막힌다.
 */
function classifyIpv6(g: number[]): 'loopback' | 'blocked' | 'public' {
  const embeddedV4 = (hi: number, lo: number): number[] => [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff]
  const zeros = (upTo: number): boolean => g.slice(0, upTo).every((x) => x === 0)

  // ── 감싼 IPv4 ──
  if (zeros(5) && g[5] === 0xffff) return classifyIpv4(embeddedV4(g[6], g[7])) // ::ffff:a.b.c.d 매핑
  if (zeros(4) && g[4] === 0xffff && g[5] === 0) return classifyIpv4(embeddedV4(g[6], g[7])) // ::ffff:0:a.b.c.d 변환
  if (zeros(6) && (g[6] !== 0 || g[7] > 1)) return classifyIpv4(embeddedV4(g[6], g[7])) // ::a.b.c.d 구형 호환
  if (g[0] === 0x2002) return classifyIpv4(embeddedV4(g[1], g[2])) // 2002::/16 6to4
  if (g[0] === 0x0064 && g[1] === 0xff9b) return classifyIpv4(embeddedV4(g[6], g[7])) // 64:ff9b::/96 NAT64

  // ── 특수 주소 ──
  if (g.every((x) => x === 0)) return 'blocked' // ::  unspecified
  if (zeros(7) && g[7] === 1) return 'loopback' // ::1

  // ── 전역 유니캐스트 안인가 ──
  if ((g[0] & 0xe000) !== 0x2000) return 'blocked' // 2000::/3 밖: fc00::/7 ULA · fe80::/10 ·
  // fec0::/10 사이트로컬 · ff00::/8 멀티캐스트 · 100::/64 discard · 그 밖 전부
  if (g[0] === 0x2001 && g[1] === 0x0000) return 'blocked' // 2001::/32 Teredo — 임의 v4를 감싼다
  if (g[0] === 0x2001 && g[1] === 0x0002) return 'blocked' // 2001:2::/48 벤치마크
  if (g[0] === 0x2001 && g[1] === 0x0db8) return 'blocked' // 2001:db8::/32 문서용
  return 'public'
}

/** 사용자가 "로컬"이라고 적을 수 있는 이름. RFC 6761이 루프백으로 못 박는다. */
function isLoopbackName(host: string): boolean {
  const name = host.toLowerCase()
  return name === 'localhost' || name.endsWith('.localhost')
}

/**
 * DNS를 보지 않고 판정할 수 있는 것만 본다 — **싼 사전 검사**다.
 *
 * 이름은 여기서 통과한다(`https://api.openai.com`도, `http://metadata.google.internal`도).
 * 진짜 판정은 요청을 보내는 자리의 `assertEgressAllowed`가 **해석된 주소**로 한다.
 * 이 함수만 믿으면 안 되는 이유가 바로 감사가 실측한 우회들이다.
 */
export function isAllowedUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    const host = bareHost(parsed.hostname)
    if (isLoopbackName(host)) return true
    return classifyAddress(host) !== 'blocked'
  } catch {
    return false
  }
}

/** `URL.hostname`은 IPv6를 대괄호째 준다. */
function bareHost(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
}

/**
 * **요청을 보내기 직전의 단 하나의 관문.** 통과하지 못하면 던진다.
 *
 * 예전에는 `setAiConfig`만 주소를 검사했고, 실제로 요청을 보내는 다섯 자리
 * (`checkConnection`·`warmupModel`·`pullModel`·`callLlm`·`streamChat`) 중 어느 것도
 * 검사를 부르지 않았다. 손으로 고친 `ai-config.json` 하나면 그 검사가 통째로 우회됐고,
 * 응답 본문이 렌더러로 돌아가므로 **읽기까지 되는 SSRF**였다.
 *
 * `localOnly`도 여기 합친다. 그 검사는 `callLlm`과 `streamChat`에만 있어서, 설정 화면의
 * 자물쇠가 "외부 제공자를 차단해 데이터가 기기를 벗어나지 않습니다"라고 말하는 동안
 * **연결 확인 버튼이 그 약속을 깨고** 있었다. 약속과 강제를 한 자리에 둔다.
 *
 * 그 자물쇠는 **지금 나가는 `url`**로 판정한다. 저장된 `cfg.baseUrl`로 판정하면
 * 리다이렉트 홉이 통째로 빠져나간다 — `guardedFetch`가 홉마다 여기를 다시 부르는데
 * 대상만 외부로 바뀌고 설정은 그대로라 판정이 계속 "이건 로컬이다"였다.
 *
 * 판정은 호스트 문자열이 아니라 **해석된 주소**로 한다. 이름이 루프백/사설로 풀리는
 * 경우(DNS 리바인딩, `metadata.google.internal`)가 문자열 검사로는 안 보인다.
 *
 * 그리고 **해석한 주소를 그대로 쓴다.** 예전에는 검사에만 쓰고 버려서, `fetch`가 연결
 * 시점에 호스트명을 다시 해석했다 — 검사한 주소와 붙는 주소가 다를 수 있는 TOCTOU다.
 * 돌려주는 URL이 어디로 요청해야 하는지까지 담는다(`pinnedUrl`).
 *
 * 설정은 **호출처가 스냅샷으로 넘긴다.** 모듈 전역 `config`를 여기서 읽으면, `await`
 * 중에 도착한 `ai:set-config`가 판정 대상을 바꿔 놓는다.
 */
export async function assertEgressAllowed(url: string, cfg: AiConfig): Promise<string> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('허용되지 않은 서버 주소입니다')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('허용되지 않은 서버 주소입니다')
  }
  // 자물쇠는 **지금 나가는 주소**로 판정한다. 저장된 `cfg.baseUrl`로 판정하면
  // `localhost:11434`가 `302 Location: http://외부/` 하나만 줘도 다음 홉의 판정이
  // 여전히 "설정은 로컬이다"라고 답해서, 잠금이 켜진 채 외부 호스트로 요청이 나갔다
  // (실측: 두 번째 요청이 나갔고 그 호스트가 준 모델 목록이 드롭다운에 들어왔다).
  // provider는 설정의 것을 그대로 쓴다 — 주소가 로컬이어도 ollama가 아니면 온디바이스가 아니다.
  if (cfg.localOnly && !isLocalAiConfig({ provider: cfg.provider, baseUrl: parsed.origin })) {
    throw new Error('로컬 전용 모드: 외부 제공자 호출이 차단되었습니다')
  }

  const host = bareHost(parsed.hostname)
  // 사용자가 "로컬"이라고 쓴 이름과 리터럴만 루프백을 얻는다. **이름이 루프백으로
  // 해석되는 것은 통과시키지 않는다** — 그게 DNS 리바인딩이다.
  if (isLoopbackName(host)) return url
  const literal = classifyAddress(host)
  if (literal !== null) {
    // 이미 IP다 — DNS도, 고정도 필요 없다.
    if (literal === 'blocked') throw new Error(`허용되지 않은 서버 주소입니다: ${host}`)
    return url
  }

  let resolved: { address: string }[]
  try {
    resolved = await lookup(host, { all: true, verbatim: true })
  } catch {
    // 주소를 못 얻으면 닫는 쪽으로 떨어진다. 어차피 요청도 못 나간다.
    throw new Error(`서버 주소를 확인할 수 없습니다: ${host}`)
  }
  if (resolved.length === 0) throw new Error(`서버 주소를 확인할 수 없습니다: ${host}`)
  for (const { address } of resolved) {
    // 이름이 루프백으로 풀리는 것도 막는다 — 위 주석 참고.
    if (classifyAddress(address) !== 'public') {
      throw new Error(`허용되지 않은 서버 주소입니다: ${host} → ${address}`)
    }
  }
  return pinnedUrl(parsed, resolved[0].address)
}

/**
 * 검증한 주소로 **실제 연결을 고정한다.**
 *
 * `http:`는 URL의 호스트를 IP로 바꿔 버린다. 재바인딩이 끼어들 자리가 없어진다.
 * (`fetch`의 `Host` 헤더 override는 undici가 금지 헤더로 버린다 — 실측 확인했다. 그래서
 * 서버는 `Host: <IP>`를 본다. Ollama·LM Studio·llama.cpp 같은 로컬/직결 엔드포인트는
 * Host를 보지 않으므로 영향이 없고, 평문 HTTP로 가상호스팅하는 AI 엔드포인트만 영향을
 * 받는다 — 그런 구성은 IP나 https로 적으면 된다. 그 드문 불편과 재바인딩을 맞바꾼다.)
 *
 * `https:`는 **이름을 그대로 둔다.** IP로 바꾸면 SNI가 IP가 되어 인증서 검증이 깨지고,
 * 그러면 모든 정상 제공자가 죽는다. 대신 여기서는 TLS 자체가 고정 역할을 한다 —
 * 재바인딩으로 내부 주소에 붙어도 그 호스트명의 유효한 인증서를 내놓지 못하면
 * 핸드셰이크가 실패한다.
 *
 * (완전한 고정은 소켓 커넥터에 `lookup`을 주입해야 하고, 그건 `undici` Agent가 필요하다 —
 * 이 저장소의 직접 의존이 아니라 `package.json` 변경이 선행되어야 한다.)
 */
function pinnedUrl(parsed: URL, address: string): string {
  if (parsed.protocol !== 'http:') return parsed.href
  const pinned = new URL(parsed.href)
  pinned.hostname = address.includes(':') ? `[${address}]` : address
  return pinned.href
}

/** 따라갈 수 있는 3xx. 308·307은 메서드를 보존하므로 본문 있는 요청에서 특히 위험하다. */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const MAX_REDIRECTS = 5

/**
 * 관문을 지나야만 나간다. 이 모듈의 모든 요청이 여기를 거친다.
 *
 * **리다이렉트를 자동으로 따라가지 않는다.** 기본 `fetch`는 3xx를 조용히 따라가고,
 * 그 홉은 관문을 지나지 않는다 — 실측했다: 허용된 주소가 `302 Location: http://[fd00::1]/`
 * 하나만 주면 요청이 그 주소까지 도달한다(`EHOSTUNREACH`), `169.254.169.254`도 마찬가지다.
 * 관문이 첫 홉만 검사하면 검사가 아니다. 그래서 `manual`로 받고 홉마다 다시 검사한다.
 * (라이선스 클라이언트는 `redirect: 'error'`, CalDAV는 `'manual'`이다. AI만 기본값이었다.)
 *
 * **본문이 있는 요청은 따라가지 않는다.** 프롬프트와 `Authorization`을 두 번째 호스트로
 * 다시 보내는 셈이고, 그건 홉을 검사해도 여전히 "A에 결속된 키가 B로 간다"는 유출이다.
 * 3xx를 그대로 돌려주면 호출처가 `!res.ok`로 받아 실패로 다룬다.
 *
 * **오리진이 바뀌면 `Authorization`을 떼고 간다.** 브라우저가 교차 오리진 리다이렉트에서
 * 하는 것과 같다. 오늘 본문 없는 요청(`checkConnection`)만 여기 오지만, 그 요청도 키를
 * 싣는다.
 */
async function guardedFetch(rawUrl: string, cfg: AiConfig, init?: RequestInit): Promise<Response> {
  const hasBody = init?.body != null
  let target = rawUrl
  let headers = init?.headers as Record<string, string> | undefined

  for (let hop = 0; ; hop++) {
    const pinned = await assertEgressAllowed(target, cfg)
    const response = await fetch(pinned, { ...init, headers, redirect: 'manual' })
    if (!REDIRECT_STATUSES.has(response.status)) return response

    const location = response.headers.get('location')
    if (!location || hasBody) return response
    if (hop >= MAX_REDIRECTS) throw new Error('리다이렉트가 너무 많습니다')

    const next = new URL(location, pinned).href
    if (new URL(next).origin !== new URL(pinned).origin) headers = withoutAuthorization(headers)
    // 소켓을 돌려준다 — 따라갈 응답의 본문은 읽지 않는다.
    void response.body?.cancel().catch(() => {})
    target = next
  }
}

function withoutAuthorization(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!headers) return headers
  const { Authorization, ...rest } = headers
  void Authorization
  return rest
}

export function setAiConfig(updates: Partial<AiConfig>): void {
  const incoming = { ...updates }
  // 마스킹된 API 키('••••••...')가 돌아오면 "키는 바꾸지 않는다"는 뜻이다.
  if (typeof incoming.apiKey === 'string' && incoming.apiKey.startsWith(KEY_MASK)) {
    delete incoming.apiKey
  }
  const next = { ...config, ...incoming } as AiConfig

  if (incoming.baseUrl && !isAllowedUrl(incoming.baseUrl)) {
    throw new Error('Blocked URL: internal network addresses are not allowed')
  }
  // 로컬 전용(프라이버시) 모드 강제: 잠금이 켜져 있으면 외부(비-로컬) 제공자로
  // 저장할 수 없다. 렌더러가 우회하더라도 여기서 막아 데이터 유출을 방지한다.
  if (next.localOnly && !isLocalAiConfig(next)) {
    throw new Error('로컬 전용 모드에서는 외부 AI 제공자를 사용할 수 없습니다')
  }

  // **목적지가 바뀌면 저장된 키는 이 목적지의 것이 아니다** (C3).
  // 새 키를 함께 주지 않은 채 provider나 오리진만 바꾸는 것은 정확히 공격의 모양이다:
  // 렌더러가 엔드포인트만 자기 서버로 돌려놓고 연결 확인을 부르면 키가 그리로 나간다.
  // 정직한 사용자에게 이것은 "주소를 바꾸면 키를 다시 넣는다"가 된다.
  if (incoming.apiKey === undefined && aiKeyAccount(next) !== aiKeyAccount(config)) {
    next.apiKey = null
  }

  config = next
  persistConfig()
}

export async function checkConnection(): Promise<{ connected: boolean; models?: string[] }> {
  const cfg = snapshot()
  try {
    if (cfg.provider === 'ollama') {
      const res = await guardedFetch(`${cfg.baseUrl}/api/tags`, cfg, { signal: AbortSignal.timeout(5000) })
      if (!res.ok) return { connected: false }
      const data = await res.json()
      const models = (data.models || []).map((m: { name: string }) => m.name)
      return { connected: true, models }
    }
    // OpenAI/Custom: 연결 확인은 간단히 models 엔드포인트
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`
    const res = await guardedFetch(`${cfg.baseUrl}/v1/models`, cfg, { headers, signal: AbortSignal.timeout(5000) })
    return { connected: res.ok }
  } catch {
    // 막힌 것도 못 닿은 것도 사용자에게는 "연결 안 됨"이다. 막힌 이유는 관문이 던지는
    // 메시지에 있고, 그 메시지는 로그로만 남는다 — 여기서 화면에 내보내면 내부
    // 네트워크 구조를 렌더러에 알려 주는 셈이 된다.
    return { connected: false }
  }
}

// 모델을 미리 메모리에 올려두고 keep_alive를 늘려, 유휴 후 첫 응답의 콜드 로드
// 지연을 없앤다. Ollama 로컬에서만 의미 있음(OpenAI/커스텀은 서버가 상주 관리).
// keep_alive는 /v1 채팅 엔드포인트가 무시하므로 네이티브 /api/generate 로 설정한다.
export async function warmupModel(): Promise<void> {
  const cfg = getAiConfigInternal()
  if (cfg.provider !== 'ollama') return
  try {
    await guardedFetch(`${cfg.baseUrl}/api/generate`, cfg, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: cfg.model, prompt: '', keep_alive: '30m' }),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT)
    })
  } catch {
    // 웜업 실패는 무시 — 실제 요청 때 어차피 로드된다.
  }
}

// === 모델 설치(원클릭 Ollama 온보딩) ===
// Ollama 서버가 떠 있으면 CLI/PATH 없이 HTTP /api/pull 로 모델을 내려받는다.
// 다운로드는 수 분 걸릴 수 있어 '유휴' 타임아웃(진행 라인마다 리셋)으로 관리한다.
const PULL_IDLE_TIMEOUT = 60_000

export interface PullProgress {
  status: string
  completed?: number
  total?: number
  // total을 알 때만 0–100, 아니면 null(불확정 단계: manifest/verify 등)
  percent: number | null
  error?: string
}

// /api/pull NDJSON 한 줄을 진행 상태로 파싱. 빈 줄/비JSON은 null.
export function parsePullProgress(line: string): PullProgress | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (typeof obj.error === 'string') return { status: 'error', percent: null, error: obj.error }
  const status = typeof obj.status === 'string' ? obj.status : ''
  const completed = typeof obj.completed === 'number' ? obj.completed : undefined
  const total = typeof obj.total === 'number' && obj.total > 0 ? obj.total : undefined
  const percent =
    completed != null && total != null ? Math.max(0, Math.min(100, Math.round((completed / total) * 100))) : null
  return { status, completed, total, percent }
}

export async function pullModel(
  model: string,
  onProgress: (p: PullProgress) => void,
  onDone: () => void,
  onError: (error: string) => void
): Promise<void> {
  const cfg = getAiConfigInternal()
  if (cfg.provider !== 'ollama') {
    onError('모델 설치는 Ollama(로컬)에서만 가능합니다')
    return
  }
  const name = String(model || '').trim()
  if (!name) {
    onError('모델 이름이 비어 있습니다')
    return
  }
  // 예전에는 여기서 `isAllowedUrl`(문자열 검사)로 한 번 걸렀다. 이제 아래 요청이
  // `guardedFetch`를 지나고, 관문이 던지는 메시지는 이 함수의 catch가 그대로
  // `onError`로 흘려보낸다 — 검사가 요청과 같은 자리에 있다.

  const controller = new AbortController()
  let idleTimer = setTimeout(() => controller.abort(), PULL_IDLE_TIMEOUT)
  const resetIdle = (): void => {
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => controller.abort(), PULL_IDLE_TIMEOUT)
  }
  let sawError = ''

  const emitLine = (line: string): void => {
    const p = parsePullProgress(line)
    if (!p) return
    if (p.error) sawError = p.error
    onProgress(p)
  }

  try {
    const res = await guardedFetch(`${cfg.baseUrl}/api/pull`, cfg, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, stream: true }),
      signal: controller.signal
    })
    if (!res.ok) {
      onError(`설치 실패: HTTP ${res.status}`)
      return
    }
    const reader = res.body?.getReader()
    if (!reader) {
      onError('응답 본문이 없습니다')
      return
    }
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      resetIdle()
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) emitLine(line)
    }
    buffer += decoder.decode()
    if (buffer) emitLine(buffer)

    if (sawError) onError(sawError)
    else onDone()
  } catch (err) {
    const message = err instanceof Error ? err.message : '설치 실패'
    onError(message.includes('abort') ? '설치가 시간 초과로 중단되었습니다' : message)
  } finally {
    clearTimeout(idleTimer)
  }
}

interface TaskResult {
  action: 'create_task'
  task: {
    title: string
    dueDate: string | null
    dueTime: string | null
    priority: 'none' | 'low' | 'medium' | 'high'
    tags: string[]
    subtasks: { title: string; dueDate: string | null }[]
  }
}

interface ChatResult {
  action: 'chat_response'
  message: string
}

// 기존 할일에 대한 파괴적 액션(완료/리스케줄/삭제). 실행 전 렌더러에서 확인 카드 필수.
export interface ActionResult {
  action: 'task_action'
  // op 집합의 단일 출처는 ACTION_OPS — 타입을 배열에서 파생해 드리프트를 막는다.
  op: (typeof ACTION_OPS)[number]
  // 대상 태스크의 (모델이 고른) 제목. 렌더러가 실제 태스크 id로 해석한다.
  taskTitle: string
  // reschedule일 때 새 마감일(YYYY-MM-DD), 그 외 null.
  dueDate: string | null
}

type AiResult = TaskResult | ChatResult | ActionResult

const TASK_SYSTEM_PROMPT = `You are a task management assistant. Given a natural language input in Korean or English, extract task information and return ONLY valid JSON in this exact format:
{
  "action": "create_task",
  "task": {
    "title": "task title",
    "dueDate": "YYYY-MM-DD or null",
    "dueTime": "HH:MM or null",
    "priority": "none|low|medium|high",
    "tags": ["tag1"],
    "subtasks": [{"title": "subtask title", "dueDate": "YYYY-MM-DD or null"}]
  }
}
Priority rules: "급하게","긴급","ASAP","중요!","반드시","urgent" → high. "시간 나면","나중에","천천히","여유" → low. Otherwise → none.
{tagHint}Today is {today}. Return ONLY the JSON, no explanation.`

// 프롬프트에 넣을 기존 태그 어휘의 최대 개수 — 너무 길면 프롬프트가 비대해진다.
const MAX_TAG_VOCAB = 30

// 기존 태스크에서 중복 없는 태그 어휘를 최대 max개 뽑는다. 태스크 생성 시 모델이
// 새 태그를 만들기보다 사용자의 기존 태그를 재사용하도록 프롬프트에 힌트로 넣는다.
export function taskTagVocabulary(tasks: TaskContext[], max = MAX_TAG_VOCAB): string[] {
  const seen = new Set<string>()
  for (const t of tasks) {
    for (const tag of t.tags ?? []) {
      if (tag) seen.add(tag)
      if (seen.size >= max) return [...seen]
    }
  }
  return [...seen]
}

export function buildTaskSystemPrompt(existingTags: string[]): string {
  const tagHint =
    existingTags.length > 0
      ? `When a tag fits, prefer reusing one of the user's existing tags instead of inventing a new one: ${existingTags
          .map((t) => `#${t}`)
          .join(' ')}.\n`
      : ''
  return TASK_SYSTEM_PROMPT.replace('{tagHint}', tagHint)
}

export function chatPromptBase(taskSummary: string): string {
  return `You are a productivity assistant for the app "haru". The user can ask about their tasks, schedule, and productivity.
Answer in the same language the user writes in (Korean or English).
When the user writes in Korean, respond ONLY in Korean: use Hangul and standard punctuation, and never mix in English words, Chinese, Japanese, Thai, or any other script within a word or sentence. If you are unsure of a Korean term, paraphrase it in Korean instead of switching languages.
Be concise and helpful. Reference specific tasks when relevant.

Current tasks summary:
${taskSummary}

Today is ${getToday()}.`
}

export function buildChatSystemPrompt(taskSummary: string): string {
  return `${chatPromptBase(taskSummary)}
Return your response as JSON: {"action":"chat_response","message":"your response here"}`
}

// 모델에게 알려 주는 '오늘'. 로컬 날짜여야 "내일"이 하루 밀리지 않는다.
function getToday(): string {
  return toLocalDateString(new Date())
}

async function callLlm(systemPrompt: string, userMessage: string, useJsonMode: boolean): Promise<AiResult> {
  // **설정을 한 번 찍고 그것만 쓴다.** 아래 `await`들은 전부 중단점이고, 그 사이에
  // 도착한 `ai:set-config`가 전역 `config`를 갈아 끼운다. 조각마다 다시 읽으면
  // 검사한 주소·실어 보내는 키·모델이 서로 다른 시점의 값으로 조합된다 —
  // A에 결속된 키가 B로 나가는 것이 그 조합 중 하나다.
  const cfg = snapshot()
  const chatUrl = `${cfg.baseUrl}/v1/chat/completions`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`

  const body: Record<string, unknown> = {
    model: cfg.model,
    messages: [
      { role: 'system', content: systemPrompt.replace('{today}', getToday()) },
      { role: 'user', content: userMessage }
    ],
    temperature: 0.3,
    max_tokens: MAX_RESPONSE_TOKENS,
    stream: false
  }

  if (useJsonMode) {
    body.response_format = { type: 'json_object' }
  }

  let lastError: Error | null = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController()
    // **본문을 다 읽을 때까지 타이머를 살려 둔다.** 전에는 헤더가 도착하자마자
    // `clearTimeout`을 해서 30초가 '연결·헤더까지'만 덮었다. 200만 뱉고 본문을 멈춘
    // 상대(생성 도중 멎은 Ollama, 끊긴 Wi-Fi/프록시, 캡티브 포털) 앞에서는 아래
    // `res.json()`이 영영 안 깨어나고 끊어 줄 신호도 없었다 — AI 패널이 `aiLoading`인
    // 채로 얼어붙어 전송 버튼까지 죽었다(스피너만 돌고 취소도 안 된다).
    // 정리는 streamChat·pullModel과 같은 모양으로 아래 finally 한 곳에서만 한다.
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT)
    try {
      const res = await guardedFetch(chatUrl, cfg, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      })

      if (!res.ok) {
        throw new Error(`API error: ${res.status} ${res.statusText}`)
      }

      const data = await res.json()
      const content = data.choices?.[0]?.message?.content || ''

      if (!content) {
        throw new Error('Empty response from LLM')
      }

      const parsed = JSON.parse(content) as AiResult

      // action 허용 목록 검증
      if (!ALLOWED_ACTIONS.includes(parsed.action as (typeof ALLOWED_ACTIONS)[number])) {
        throw new Error(`Invalid action: ${parsed.action}`)
      }

      return parsed
    } catch (err) {
      lastError = err as Error
      if (attempt < MAX_RETRIES) continue
    } finally {
      // continue/return/throw 어느 경로든 이번 시도의 타이머를 정리한다.
      // 성공 경로의 `return parsed`도 여기를 지나므로 타이머는 정확히 한 번 꺼진다.
      clearTimeout(timeout)
    }
  }

  throw lastError || new Error('LLM call failed')
}

export interface TaskContext {
  title: string
  dueDate: string | null
  dueTime?: string | null
  priority: string
  completed: boolean
  tags?: string[]
}

function summarizeTasks(tasks: TaskContext[]): string {
  if (tasks.length === 0) return 'No tasks.'
  return tasks
    .map((t) => {
      const status = t.completed ? '[done]' : '[todo]'
      const due = t.dueDate ? ` (due: ${t.dueDate}${t.dueTime ? ` ${t.dueTime}` : ''})` : ''
      const pri = t.priority !== 'none' ? ` [${t.priority}]` : ''
      const tags = t.tags && t.tags.length > 0 ? ` ${t.tags.map((tag) => `#${tag}`).join(' ')}` : ''
      return `${status} ${t.title}${due}${pri}${tags}`
    })
    .join('\n')
}

function sanitizeTaskResult(raw: AiResult): TaskResult {
  if (raw.action !== 'create_task') {
    throw new Error('Unexpected action from task creation')
  }
  const t = (raw as TaskResult).task
  return {
    action: 'create_task',
    task: {
      title: typeof t.title === 'string' ? t.title.slice(0, 500) : 'Untitled',
      dueDate:
        typeof t.dueDate === 'string' && DATE_RE.test(t.dueDate) && !Number.isNaN(Date.parse(t.dueDate))
          ? t.dueDate
          : null,
      dueTime: typeof t.dueTime === 'string' && TIME_RE.test(t.dueTime) ? t.dueTime : null,
      priority: VALID_PRIORITIES.includes(t.priority as (typeof VALID_PRIORITIES)[number]) ? t.priority : 'none',
      tags: Array.isArray(t.tags) ? t.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 20) : [],
      subtasks: Array.isArray(t.subtasks)
        ? t.subtasks
            .filter((s): s is { title: string; dueDate: string | null } => typeof s?.title === 'string')
            .map((s) => ({
              title: s.title.slice(0, 500),
              dueDate:
                typeof s.dueDate === 'string' && DATE_RE.test(s.dueDate) && !Number.isNaN(Date.parse(s.dueDate))
                  ? s.dueDate
                  : null
            }))
            .slice(0, 20)
        : []
    }
  }
}

export async function createTaskFromNL(input: string, existingTasks: TaskContext[]): Promise<TaskResult> {
  const prompt = buildTaskSystemPrompt(taskTagVocabulary(existingTasks))
  const result = await callLlm(prompt, input, true)
  return sanitizeTaskResult(result)
}

// 기존 할일 액션 해석용 시스템 프롬프트. 미완료 최상위 태스크 목록을 주고,
// 모델이 대상 태스크의 정확한 제목 + 연산을 고르게 한다.
export function buildActionSystemPrompt(tasks: TaskContext[]): string {
  const list = tasks
    .filter((t) => !t.completed)
    .map((t) => `- ${t.title}${t.dueDate ? ` (due: ${t.dueDate})` : ''}`)
    .join('\n')
  return `You manage the user's EXISTING task list. The user wants to act on ONE existing task.
Return ONLY JSON: {"action":"task_action","op":"${ACTION_OPS.join('|')}","taskTitle":"<exact title from the list, or empty>","dueDate":"YYYY-MM-DD or null"}
Rules:
- op: complete = mark done (완료/끝냈어/했어), reschedule = change the due date (미뤄/내일로/모레/다음주), delete = remove it (삭제/지워/없애).
- taskTitle: copy the EXACT title of the single best-matching task from the list below. If nothing matches, use op="none" and taskTitle="".
- dueDate: for reschedule, resolve relative dates (내일/모레/다음 주 등) against Today into YYYY-MM-DD. Otherwise null.
Tasks:
${list || '(none)'}
Today is {today}. Return ONLY the JSON, no explanation.`
}

function sanitizeActionResult(raw: AiResult): ActionResult {
  if (raw.action !== 'task_action') {
    throw new Error('Unexpected action from task-action interpret')
  }
  // 위 가드로 raw는 ActionResult로 좁혀진다(캐스트 불필요).
  const r = raw
  const op = ACTION_OPS.includes(r.op as (typeof ACTION_OPS)[number]) ? r.op : 'none'
  return {
    action: 'task_action',
    op,
    taskTitle: typeof r.taskTitle === 'string' ? r.taskTitle.slice(0, 500) : '',
    dueDate:
      // 리스케줄 날짜는 형식/파싱뿐 아니라 '오늘 이후'여야 한다 — 모델이 과거 날짜로
      // 잘못 해석하면 무효(null)로 떨궈, 렌더러가 구체적 날짜를 다시 묻게 한다.
      op === 'reschedule' &&
      typeof r.dueDate === 'string' &&
      DATE_RE.test(r.dueDate) &&
      !Number.isNaN(Date.parse(r.dueDate)) &&
      r.dueDate >= getToday()
        ? r.dueDate
        : null
  }
}

// 사용자 메시지를 기존 할일 액션으로 해석. 확인 카드용 구조화 결과만 반환하며,
// 실제 변경은 렌더러가 사용자 확인 후 수행한다(파괴적 액션 안전장치).
export async function interpretTaskAction(message: string, existingTasks: TaskContext[]): Promise<ActionResult> {
  const prompt = buildActionSystemPrompt(existingTasks)
  const result = await callLlm(prompt, message, true)
  return sanitizeActionResult(result)
}

// 스트리밍 채팅 — MessagePort 대신 간단한 콜백 기반으로 구현
// (Electron IPC에서 스트리밍 이벤트로 전달)
export async function streamChat(
  userMessage: string,
  existingTasks: TaskContext[],
  history: ChatHistoryMessage[],
  onToken: (token: string) => void,
  onDone: () => void,
  onError: (error: string) => void
): Promise<void> {
  // 설정을 한 번 찍고 그것만 쓴다 — `callLlm`과 같은 이유. 스트리밍은 응답이 수십 초
  // 이어지므로 그 사이 설정이 바뀔 창이 특히 넓다.
  const cfg = snapshot()
  const chatUrl = `${cfg.baseUrl}/v1/chat/completions`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`

  const summary = summarizeTasks(existingTasks)
  const systemPrompt = chatPromptBase(summary)

  // 직전 대화를 컨텍스트로 포함 (멀티턴). 방어적으로 재검증 + 최근 N개로 제한.
  const priorTurns = normalizeChatHistory(history)

  const body = {
    model: cfg.model,
    messages: [{ role: 'system', content: systemPrompt }, ...priorTurns, { role: 'user', content: userMessage }],
    temperature: 0.3,
    max_tokens: MAX_RESPONSE_TOKENS,
    stream: true
  }

  // 이미 토큰을 하나라도 흘려보냈으면 재시도하지 않는다 (중복 출력 방지).
  // 연결/헤더 단계 실패만 재시도한다.
  let emittedAny = false
  let lastError = 'Stream failed'

  // SSE 한 줄에서 델타 토큰을 추출해 emit. 성공 시 true.
  const emitLine = (line: string): void => {
    const trimmed = line.trim()
    if (!trimmed || trimmed === 'data: [DONE]' || !trimmed.startsWith('data: ')) return
    try {
      const token = JSON.parse(trimmed.slice(6)).choices?.[0]?.delta?.content || ''
      if (token) {
        emittedAny = true
        onToken(token)
      }
    } catch {
      // skip malformed SSE lines
    }
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController()
    // 처음엔 연결(첫 바이트) 타임아웃, 데이터가 오기 시작하면 유휴 타임아웃으로 리셋.
    let idleTimer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT)
    const resetIdle = (): void => {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => controller.abort(), STREAM_IDLE_TIMEOUT)
    }

    try {
      const res = await guardedFetch(chatUrl, cfg, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      })

      if (!res.ok) {
        lastError = `API error: ${res.status}`
        if (attempt < MAX_RETRIES && !emittedAny) continue
        onError(lastError)
        return
      }

      const reader = res.body?.getReader()
      if (!reader) {
        lastError = 'No response body'
        if (attempt < MAX_RETRIES && !emittedAny) continue
        onError(lastError)
        return
      }

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        resetIdle()
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) emitLine(line)
      }
      // 남은 멀티바이트/마지막 줄 flush
      buffer += decoder.decode()
      if (buffer) emitLine(buffer)

      onDone()
      return
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Stream failed'
      lastError = message.includes('abort') ? '응답 시간이 초과되었습니다' : message
      if (attempt < MAX_RETRIES && !emittedAny) continue
      onError(lastError)
      return
    } finally {
      // continue/return/throw 어느 경로든 이번 시도의 타이머를 정리
      clearTimeout(idleTimer)
    }
  }

  // 루프는 정상적으로 항상 return 하지만, 안전망으로 종단 콜백을 보장한다.
  onError(lastError)
}
