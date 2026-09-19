import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary
      fallback={
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-950 p-6 text-center text-zinc-200">
          <p className="text-lg font-bold">Algo salió mal mostrando el dashboard.</p>
          <p className="max-w-md text-sm text-zinc-400">
            Prueba recargar la página; si el problema sigue, avísale a soporte técnico.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-full bg-brand-500 px-5 py-2 text-sm font-bold text-zinc-900"
          >
            Recargar
          </button>
        </div>
      }
    >
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
