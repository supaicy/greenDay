#!/usr/bin/env node
/**
 * 라이선스 키 발급 도구 — 사장님 맥에서만 돌린다.
 *
 *   node scripts/license.mjs keygen                      키쌍 생성 (최초 1회)
 *   node scripts/license.mjs issue --name … --email …    키 발급
 *   node scripts/license.mjs inspect <키>                 키 내용 확인
 *
 * 개인키는 이 저장소에 절대 커밋되지 않는다(.gitignore). 유출되면 누구나 무제한으로
 * 라이선스를 찍어낼 수 있고, 이미 배포된 앱은 공개키가 박혀 있어 되돌릴 방법이 없다.
 * 반드시 별도로 백업해 두어야 한다 — 잃어버리면 기존 키를 검증할 새 키를 만들 수 없다.
 */

import { generateKeyPairSync, randomUUID, sign, createPrivateKey } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SECRET_DIR = join(ROOT, '.license-keys')
const PRIVATE_PATH = join(SECRET_DIR, 'private.pem')
const PUBLIC_PATH = join(SECRET_DIR, 'public.pem')
// 앱에 들어가는 공개키. 커밋해도 안전하다.
const EMBEDDED_PUBLIC = join(ROOT, 'src/shared/license/public-key.ts')

function die(message) {
  console.error(`ERROR: ${message}`)
  process.exit(1)
}

/** 서명 대상 문자열. src/shared/license/format.ts 의 canonicalize 와 반드시 같아야 한다. */
function canonicalize(payload) {
  return JSON.stringify(payload, Object.keys(payload).sort())
}

function signPayload(payload, privateKeyPem) {
  const signature = sign(null, Buffer.from(canonicalize(payload), 'utf-8'), createPrivateKey(privateKeyPem))
  return { payload, signature: signature.toString('base64url') }
}

function encodeDocument(doc) {
  return Buffer.from(JSON.stringify(doc), 'utf-8').toString('base64url')
}

function keygen() {
  if (existsSync(PRIVATE_PATH)) {
    die(
      `이미 키쌍이 있습니다: ${PRIVATE_PATH}\n` +
        '  덮어쓰면 이미 발급한 모든 라이선스가 무효가 됩니다.\n' +
        '  정말 새로 만들려면 그 파일을 직접 옮긴 뒤 다시 실행하세요.'
    )
  }
  mkdirSync(SECRET_DIR, { recursive: true, mode: 0o700 })
  const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
    privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
    publicKeyEncoding: { format: 'pem', type: 'spki' }
  })
  writeFileSync(PRIVATE_PATH, privateKey, { mode: 0o600 })
  writeFileSync(PUBLIC_PATH, publicKey, { mode: 0o644 })

  writeFileSync(
    EMBEDDED_PUBLIC,
    `// 자동 생성 — scripts/license.mjs keygen\n` +
      `//\n` +
      `// 공개키다. 앱에 담겨 배포되며 비밀이 아니다. 이 키로는 검증만 할 수 있고\n` +
      `// 라이선스를 새로 발급할 수는 없다.\n` +
      `export const LICENSE_PUBLIC_KEY = \`${publicKey.trim()}\n\`\n`,
    'utf-8'
  )

  console.log('키쌍을 만들었습니다.')
  console.log(`  개인키: ${PRIVATE_PATH}   ← 절대 공유 금지, 반드시 백업`)
  console.log(`  공개키: ${PUBLIC_PATH}`)
  console.log(`  앱 내장: ${EMBEDDED_PUBLIC}`)
  console.log()
  console.log('개인키를 잃어버리면 기존 라이선스를 이어서 발급할 수 없습니다.')
  console.log('1Password 같은 곳에 지금 백업해 두세요.')
}

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

function issue() {
  if (!existsSync(PRIVATE_PATH)) die(`개인키가 없습니다. 먼저 실행하세요:\n  node scripts/license.mjs keygen`)

  const name = arg('name')
  const email = arg('email')
  if (!name || !email) {
    die('사용법: node scripts/license.mjs issue --name "홍길동" --email hong@example.com [--seats 3] [--days 365] [--max-version 2.9.9]')
  }

  const seats = Number.parseInt(arg('seats', '3'), 10)
  if (!Number.isFinite(seats) || seats < 1) die('--seats 는 1 이상의 정수여야 합니다.')

  const days = arg('days')
  const issuedAt = new Date().toISOString()
  const expiresAt = days
    ? new Date(Date.now() + Number.parseInt(days, 10) * 86400_000).toISOString()
    : null

  const payload = {
    id: `lic_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    name,
    email,
    seats,
    issuedAt,
    expiresAt,
    maxVersion: arg('max-version')
  }

  const key = encodeDocument(signPayload(payload, readFileSync(PRIVATE_PATH, 'utf-8')))

  console.log('발급 완료')
  console.log(`  ID       ${payload.id}`)
  console.log(`  구매자    ${name} <${email}>`)
  console.log(`  기기 수   ${seats}대`)
  console.log(`  만료      ${expiresAt ?? '없음 (평생)'}`)
  if (payload.maxVersion) console.log(`  버전 상한 ${payload.maxVersion}`)
  console.log()
  console.log('아래를 구매자에게 보내세요:')
  console.log()
  console.log(key)
  console.log()

  // 발급 대장. 서버 DB와 별개로 손에 남는 기록이 있어야 나중에 대조할 수 있다.
  // --dry-run 은 서명 경로는 그대로 타면서 대장만 건드리지 않는다 — 테스트가 실제
  // 판매 기록을 오염시키지 않도록.
  if (process.argv.includes('--dry-run')) {
    console.log('(--dry-run: 발급 대장에 기록하지 않았습니다)')
    return
  }
  const ledger = join(SECRET_DIR, 'issued.jsonl')
  writeFileSync(ledger, `${JSON.stringify({ ...payload, key })}\n`, { flag: 'a', mode: 0o600 })
  console.log(`발급 내역을 ${ledger} 에 기록했습니다.`)
}

function inspect() {
  const encoded = process.argv[3]
  if (!encoded) die('사용법: node scripts/license.mjs inspect <키>')
  try {
    const doc = JSON.parse(Buffer.from(encoded.replace(/\s+/g, ''), 'base64url').toString('utf-8'))
    console.log(JSON.stringify(doc.payload, null, 2))
    console.log()
    console.log('주의: 이 명령은 내용만 보여줄 뿐 서명을 검증하지 않습니다.')
  } catch {
    die('키를 읽을 수 없습니다.')
  }
}

const command = process.argv[2]
if (command === 'keygen') keygen()
else if (command === 'issue') issue()
else if (command === 'inspect') inspect()
else {
  console.log('사용법:')
  console.log('  node scripts/license.mjs keygen')
  console.log('  node scripts/license.mjs issue --name "홍길동" --email hong@example.com [--seats 3] [--days 365]')
  console.log('  node scripts/license.mjs inspect <키>')
  process.exit(command ? 1 : 0)
}
