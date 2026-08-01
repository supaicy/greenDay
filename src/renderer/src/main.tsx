import ReactDOM from 'react-dom/client'
import App from './App'
import './i18n'
import './index.css'

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Root element #root not found in index.html')
ReactDOM.createRoot(rootEl).render(<App />)
