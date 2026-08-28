import { useState } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { login } from '../services/api'

export function LoginPage() {
  const nav = useNavigate()
  const token = localStorage.getItem('token')

  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPass, setShowPass] = useState(false)

  // Los hooks van siempre antes de cualquier return condicional: si este componente
  // re-renderiza (ej. por el setLoading del finally tras un login exitoso) justo antes
  // de que el router desmonte la página, el orden de hooks debe mantenerse idéntico o
  // React tira "Rendered fewer hooks than expected".
  if (token) return <Navigate to="/" replace />

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!user.trim() || !password) {
      setError('Completa usuario y contraseña')
      return
    }
    setLoading(true)
    try {
      const data = await login(user.trim(), password)
      localStorage.setItem('token', data.token)
      localStorage.setItem('user', data.user)
      nav('/', { replace: true })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al iniciar sesión'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-dvh flex flex-col bg-zinc-950 safe-top safe-bottom">
      {/* Fondo decorativo */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="absolute -top-32 -right-32 h-72 w-72 rounded-full bg-brand-600/15 blur-[80px]" />
        <div className="absolute top-1/2 -left-24 h-96 w-96 rounded-full bg-brand-900/25 blur-[90px]" />
      </div>

      <div className="relative flex flex-1 flex-col items-center justify-center px-5 py-8">
        <div className="w-full max-w-[380px]">
          {/* Branding */}
          <div className="mb-8 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[18px] bg-brand-500 text-zinc-900 font-black text-2xl shadow-lg shadow-black/30">
              U
            </div>
            <h1 className="mt-4 text-2xl font-black tracking-tight">URBAN PERÚ</h1>
            <p className="mt-1 text-sm font-medium text-zinc-400">Dashboard de pedidos · Acceso recepción</p>
          </div>

          <form onSubmit={handleSubmit} className="rounded-[28px] border border-zinc-800 bg-zinc-900 p-6 shadow-2xl shadow-black/40">
            <h2 className="text-[11px] font-bold tracking-[0.18em] text-zinc-500 uppercase mb-5">Iniciar sesión</h2>

            <div className="space-y-4">
              <div>
                <label htmlFor="user" className="mb-1.5 block text-sm font-semibold text-zinc-300">Usuario</label>
                <input
                  id="user"
                  type="text"
                  autoComplete="username"
                  inputMode="text"
                  placeholder="admin"
                  value={user}
                  onChange={e => setUser(e.target.value)}
                  className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3.5 text-[16px] font-medium text-white placeholder:text-zinc-600 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/20 transition"
                  aria-required="true"
                />
              </div>

              <div>
                <label htmlFor="pass" className="mb-1.5 block text-sm font-semibold text-zinc-300">Contraseña</label>
                <div className="relative">
                  <input
                    id="pass"
                    type={showPass ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3.5 pr-12 text-[16px] font-medium text-white placeholder:text-zinc-600 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/20 transition"
                    aria-required="true"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(v => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xl bg-zinc-900 px-2.5 py-1.5 text-xs font-bold text-zinc-400 border border-zinc-800"
                    aria-label={showPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  >
                    {showPass ? 'Ocultar' : 'Ver'}
                  </button>
                </div>
              </div>

              {error && (
                <div role="alert" className="animate-shake rounded-2xl border border-red-900/50 bg-red-950/50 px-4 py-3 text-sm font-medium text-red-300">
                  ⚠️ {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-2xl bg-brand-500 px-4 py-3.5 text-[16px] font-black text-zinc-900 shadow-lg shadow-black/30 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/40"
              >
                {loading ? 'Verificando…' : 'Entrar →'}
              </button>

              <p className="text-center text-xs leading-relaxed text-zinc-500">
                Usa las credenciales configuradas en <code className="rounded bg-zinc-800 px-1 py-0.5 text-zinc-300">DASHBOARD_USER</code> / <code className="rounded bg-zinc-800 px-1 py-0.5 text-zinc-300">DASHBOARD_PASSWORD</code>
              </p>
            </div>
          </form>

          <p className="mt-6 text-center text-xs text-zinc-600">
            Solo uso en celular · Mantén la pantalla activa durante el turno
          </p>
        </div>
      </div>

      <footer className="py-4 text-center text-[11px] font-medium tracking-wide text-zinc-600">
        © {new Date().getFullYear()} Urban Perú · Hecho para recepción móvil
      </footer>
    </div>
  )
}
