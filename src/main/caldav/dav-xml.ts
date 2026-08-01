/**
 * WebDAV 응답(multistatus)만 읽는 최소 XML 파서.
 *
 * 범용 XML 라이브러리를 새로 들이는 대신 필요한 만큼만 직접 처리한다. 네트워크에
 * 붙는 메인 프로세스 코드라 의존성을 늘리지 않는 편이 낫고, WebDAV 응답 형태는
 * 좁고 잘 정의돼 있다. 다만 그만큼 범위를 벗어난 XML(DTD, 처리 명령, 네임스페이스
 * 재정의 등)은 다루지 않는다 — 여기 오는 입력은 CalDAV 서버 응답뿐이다.
 *
 * 네임스페이스 접두사는 무시하고 로컬 이름으로만 찾는다. 서버마다 D:/d:/(없음)이
 * 제각각이라 접두사에 기대면 서버를 바꿀 때마다 깨진다.
 */

export interface XmlNode {
  name: string
  /** 속성 이름은 소문자 로컬 이름으로 정규화한다 (<C:comp name="VEVENT"/> → { name: 'VEVENT' }) */
  attrs: Record<string, string>
  children: XmlNode[]
  text: string
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'"
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return ENTITIES[body.toLowerCase()] ?? match
  })
}

/** 접두사를 떼고 소문자 로컬 이름만 남긴다. */
function localName(tag: string): string {
  const colon = tag.indexOf(':')
  return (colon >= 0 ? tag.slice(colon + 1) : tag).toLowerCase()
}

/** name="v" name='v' name=v 세 형태를 모두 읽는다. */
function parseAttrs(body: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const pattern = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g
  let match = pattern.exec(body)
  while (match) {
    const value = match[3] ?? match[4] ?? match[5] ?? ''
    attrs[localName(match[1])] = decodeEntities(value)
    match = pattern.exec(body)
  }
  return attrs
}

export function parseXml(source: string): XmlNode {
  const root: XmlNode = { name: '#root', attrs: {}, children: [], text: '' }
  const stack: XmlNode[] = [root]

  let i = 0
  while (i < source.length) {
    const lt = source.indexOf('<', i)
    if (lt < 0) {
      appendText(stack[stack.length - 1], source.slice(i))
      break
    }
    appendText(stack[stack.length - 1], source.slice(i, lt))

    // <![CDATA[ ... ]]> — 내용을 그대로 텍스트로 싣는다.
    if (source.startsWith('<![CDATA[', lt)) {
      const end = source.indexOf(']]>', lt)
      const stop = end < 0 ? source.length : end
      stack[stack.length - 1].text += source.slice(lt + 9, stop)
      i = end < 0 ? source.length : end + 3
      continue
    }
    // <?xml ... ?>, <!-- ... -->, <!DOCTYPE ...> — 전부 건너뛴다.
    if (source.startsWith('<?', lt) || source.startsWith('<!', lt)) {
      const end = source.indexOf('>', lt)
      i = end < 0 ? source.length : end + 1
      continue
    }

    const gt = source.indexOf('>', lt)
    if (gt < 0) break
    const inner = source.slice(lt + 1, gt).trim()
    i = gt + 1

    if (inner.startsWith('/')) {
      // 닫는 태그. 짝이 맞는 가장 가까운 조상까지 되감는다 — 서버가 태그를 빠뜨려도
      // 파서 전체가 무너지지 않게 한다.
      const name = localName(inner.slice(1).trim())
      for (let depth = stack.length - 1; depth > 0; depth--) {
        if (stack[depth].name === name) {
          stack.length = depth
          break
        }
      }
      continue
    }

    const selfClosing = inner.endsWith('/')
    const body = selfClosing ? inner.slice(0, -1).trim() : inner
    const [tag, ...rest] = body.split(/[\s\t\r\n]+/)
    const name = localName(tag)
    const node: XmlNode = { name, attrs: parseAttrs(rest.join(' ')), children: [], text: '' }
    stack[stack.length - 1].children.push(node)
    if (!selfClosing) stack.push(node)
  }

  return root
}

function appendText(node: XmlNode, chunk: string): void {
  if (chunk) node.text += decodeEntities(chunk)
}

/** 트리 전체에서 로컬 이름이 일치하는 노드를 깊이 우선으로 모은다. */
export function findAll(node: XmlNode, name: string): XmlNode[] {
  const target = name.toLowerCase()
  const found: XmlNode[] = []
  const visit = (current: XmlNode): void => {
    for (const child of current.children) {
      if (child.name === target) found.push(child)
      visit(child)
    }
  }
  visit(node)
  return found
}

export function findFirst(node: XmlNode, name: string): XmlNode | null {
  return findAll(node, name)[0] ?? null
}

/** 자손 중 첫 번째 일치 노드의 텍스트(공백 제거). 없으면 빈 문자열. */
export function textOf(node: XmlNode | null, name?: string): string {
  if (!node) return ''
  const target = name ? findFirst(node, name) : node
  return target ? target.text.trim() : ''
}

export interface DavResponse {
  href: string
  /** 로컬 이름 → 노드. 여러 개면 첫 번째만 담는다. */
  props: Map<string, XmlNode>
  /** propstat별 HTTP 상태 줄. 값이 비어 있는 404 propstat를 걸러낼 때 쓴다. */
  statuses: string[]
}

/**
 * multistatus를 응답 목록으로 편다.
 *
 * 404 propstat(서버가 "그 속성은 없다"고 답한 블록)의 prop은 버린다. 이걸 섞으면
 * 존재하지 않는 속성이 빈 값으로 잡혀 "찾았는데 비어 있다"와 구분되지 않는다.
 */
export function parseMultistatus(xml: string): DavResponse[] {
  const root = parseXml(xml)
  return findAll(root, 'response').map((response) => {
    const props = new Map<string, XmlNode>()
    const statuses: string[] = []
    for (const propstat of findAll(response, 'propstat')) {
      const status = textOf(propstat, 'status')
      statuses.push(status)
      if (/\s4\d\d\s|\s5\d\d\s/.test(` ${status} `)) continue
      const prop = findFirst(propstat, 'prop')
      if (!prop) continue
      for (const child of prop.children) {
        if (!props.has(child.name)) props.set(child.name, child)
      }
    }
    // propstat 없이 prop만 보내는 서버도 있다.
    if (props.size === 0) {
      for (const prop of findAll(response, 'prop')) {
        for (const child of prop.children) {
          if (!props.has(child.name)) props.set(child.name, child)
        }
      }
    }
    return { href: textOf(response, 'href'), props, statuses }
  })
}
