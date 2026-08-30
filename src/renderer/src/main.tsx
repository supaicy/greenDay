import ReactDOM from 'react-dom/client'
import App from './App'
import { installDragGuard } from './utils/dragGuard'
import './i18n'
import './index.css'

// **React를 붙이기 전에 건다.** 첫 프레임 전에 창에 뭔가 떨어뜨려도 브라우저 기본 동작
// (그 파일로 네비게이트 → 새 문서가 `window.api`를 통째로 물려받는다)이 살아나지 않게
// 한다. 요소별 드롭 핸들러는 자기 위에서만 걸리므로 사이드바·헤더·빈 공간이 뚫려 있었다.
installDragGuard(window)

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Root element #root not found in index.html')
ReactDOM.createRoot(rootEl).render(<App />)
