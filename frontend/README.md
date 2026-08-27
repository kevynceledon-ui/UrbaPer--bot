# Urban Perú — Dashboard Recepción (Frontend)

Dashboard **Mobile-First** para recepción de pedidos en tiempo real. React 19 + Vite 8 + Tailwind CSS 4 + TypeScript.

> Diseñado exclusivamente para navegador de celular (360-430px), responsive y PWA-ready.

---

## ✨ Funcionalidades

- **Login** `POST /api/login` → guarda JWT en `localStorage`
- **Ruta protegida** `/` verifica token contra `GET /api/verify`
- **Pedidos Activos** en cards Tailwind (nombre, teléfono con tel:/wa.me, items, total $CLP, resumen)
- **Socket.IO realtime** `nuevo_pedido` con auth JWT (`{ auth: { token: "Bearer <JWT>" } }`)
- **Autoplay Policy**: botón gigante `▶️ Iniciar Turno` desbloquea `AudioContext` con buffer silencioso 1ms + genera beep con Web Audio API (sin archivo mp3 externo)
- **Wake Lock API** con `visibilitychange` + `focus` para re-solicitar lock
- **Vibración** + animación `slide-in` al llegar pedido

---

## 📁 Estructura recomendada

```
frontend/
├── public/                # favicon.svg (mp3 opcional: fallback-audio)
├── src/
│   ├── components/
│   │   ├── Header.tsx              # Estado conexión, wake, audio, logout
│   │   ├── OrderCard.tsx           # Card pedido (mobile-first)
│   │   ├── StartShiftButton.tsx    # Botón gigante desbloquear audio
│   │   └── ProtectedRoute.tsx      # Guard localStorage token
│   ├── pages/
│   │   ├── LoginPage.tsx           # Form login + rate-limit feedback
│   │   └── DashboardPage.tsx       # Lista + socket + wakeLock + audio
│   ├── hooks/
│   │   ├── useWakeLock.ts          # Screen Wake Lock + visibilitychange
│   │   ├── useAudioUnlock.ts       # unlockAudio() wrapper
│   │   └── useOrdersSocket.ts      # socket.io-client + nuevo_pedido
│   ├── services/
│   │   ├── api.ts                  # login() verifyToken() + VITE_API_URL
│   │   └── socket.ts               # getSocket(token) singleton
│   ├── utils/
│   │   └── audio.ts                # Web Audio beep + unlock (1ms silence)
│   ├── types/
│   │   └── order.ts                # Order, Cliente, OrderItem
│   ├── App.tsx                     # BrowserRouter + rutas
│   ├── main.tsx
│   └── index.css                   # @import "tailwindcss"
├── vite.config.ts                  # @tailwindcss/vite + port 5173
├── index.html
└── .env                            # VITE_API_URL=http://localhost:3000
```

---

## 🔧 Configuración Vite + Tailwind

**vite.config.ts**
```ts
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, host: true, strictPort: true },
})
```

**src/index.css**
```css
@import "tailwindcss";
@theme { --font-sans: "Inter", ui-sans-serif, system-ui; }
body { @apply bg-zinc-950 text-zinc-50 antialiased; }
```

Tailwind v4 no requiere `tailwind.config.js` ni `postcss.config.js` — el plugin `@tailwindcss/vite` lo resuelve.

---

## 🔌 Conexión Socket.IO con JWT

**src/services/socket.ts**
```ts
import { io } from 'socket.io-client'
const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

export function getSocket(token: string) {
  return io(API_URL, {
    auth: { token: `Bearer ${token}` }, // backend soporta Bearer o raw
    transports: ['websocket','polling'],
    reconnection: true,
    reconnectionDelay: 1500,
  })
}
```

**Uso en hook:**
```ts
socket.on('nuevo_pedido', (payload: Order) => {
  setOrders(prev => [payload, ...prev])
  void playNotificationSound() // Web Audio beep
  navigator.vibrate?.([180,80,180,80,350])
})
socket.on('connect_error', err => console.warn(err.message))
```

Backend `src/config/socket.js` valida:
```js
const tokenRaw = socket.handshake.auth?.token || socket.handshake.headers?.authorization
const token = tokenRaw.startsWith('Bearer ') ? tokenRaw.slice(7) : tokenRaw
jwt.verify(token, process.env.JWT_SECRET)
```

---

## 🔊 Desbloqueo Autoplay (crítico)

**src/utils/audio.ts**
```ts
export async function unlockAudio() {
  const ctx = getAudioContext()
  if (ctx.state === 'suspended') await ctx.resume()
  // buffer silencioso 1ms desbloquea iOS/Chrome
  const buffer = ctx.createBuffer(1, 1, 22050)
  const src = ctx.createBufferSource()
  src.buffer = buffer
  src.connect(ctx.destination)
  src.start(0)
  isUnlocked = true
}

export async function playNotificationSound() {
  const ctx = getAudioContext()
  if (ctx.state === 'suspended') await ctx.resume()
  // doble beep ascendente 880Hz → 1108Hz → 1318Hz
  // + vibrate([180,80,180,80,350])
}
```

**Hook + Botón:**
```tsx
// DashboardPage
const { unlocked, unlock } = useAudioUnlock()
<button onClick={async () => {
  await unlock() // DEBE ser gesto directo
  setShiftStarted(true)
}}>▶️ Iniciar Turno</button>
```

Sin esto, `playNotificationSound()` será bloqueado y no sonará al llegar `nuevo_pedido`.

---

## 🔆 Wake Lock

**src/hooks/useWakeLock.ts**
```ts
export function useWakeLock(enabled: boolean) {
  const request = async () => {
    const sentinel = await navigator.wakeLock.request('screen')
    sentinel.addEventListener('release', () => setIsLocked(false))
  }
  useEffect(() => {
    if (!enabled) return
    void request()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void request()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => { /* remove + release */ }
  }, [enabled])
}
```
Se activa solo después de `Iniciar Turno` para no pedir permiso sin gesto.

---

## 🚀 Instalación y ejecución

```bash
# 1. Backend (raíz del repo) — en una terminal
npm install          # si no está instalado
npm run dev          # o node src/index.js
# → http://localhost:3000  (CORS permite http://localhost:5173)

# 2. Frontend — en otra terminal
cd frontend
npm install
# configurar backend URL si cambia (opcional)
echo "VITE_API_URL=http://localhost:3000" > .env

npm run dev          # → http://localhost:5173
npm run build        # build producción → dist/
npm run preview      # preview build
```

**Credenciales por defecto** (definidas en `/.env` del backend):
```
DASHBOARD_USER=admin
DASHBOARD_PASSWORD=CambiaEstaPass123!
JWT_SECRET=pon_aqui_un_secreto_muy_largo...
```

---

## 🧪 Cómo probar visualmente (mobile)

1. **Login**  
   Abre `http://localhost:5173` en Chrome DevTools → Toggle device toolbar (iPhone 14/ SE).  
   Loguéate con `admin / CambiaEstaPass123!` → debe redirigir a `/` y guardar `token` en localStorage.

2. **Iniciar Turno**  
   Verás pantalla gigante `▶️ Iniciar Turno`. Toca → debe sonar beep corto (confirmación) y activar wake lock (indicador `🔆 PANTALLA ACTIVA` en header).

3. **Pedido realtime**  
   En otra terminal, emite un pedido (requiere backend corriendo):

   ```js
   // test-pedido.js en raíz
   const { io } = require('socket.io-client')
   const jwt = require('jsonwebtoken')
   const token = jwt.sign({user:'admin'}, process.env.JWT_SECRET || 'dev_secret_cambiar_en_produccion', {expiresIn:'1h'})
   const s = io('http://localhost:3000', { auth:{ token:`Bearer ${token}` } })
   s.on('connect', () => {
     // Para probar recepción, necesitas otro cliente dashboard conectado.
     // Mejor usa el helper del backend: getIO().emit
   })
   ```

   **Más simple:** usa el backend directamente:
   ```js
   // En src/services/whatsappServices o donde se crea pedido,
   // o crea un endpoint temporal:
const { getIO } = require('./src/config/socket')
getIO().to('dashboard').emit('nuevo_pedido', {
  id: 'A1B2C3', cliente:{nombre:'Luis González', telefono:'56987654321', whatsapp:'56987654321'},
  items:[{nombre:'Pollo a la brasa entero', precio:12990},{nombre:'Bebida 1.5L', precio:2490}],
  total: 15480, resumen:'Sin ají', fecha: new Date().toISOString()
})
   ```

   O desde el dashboard usa el botón **🧪 Simular pedido** (inyecta un pedido mock + beep sin backend).

4. **Verifica**  
   - Card aparece arriba con animación `slide-in` + badge `¡NUEVO!` + sonido + vibración.  
   - Header muestra `Conectado · N pedidos` con punto verde.  
   - Al cambiar de pestaña y volver, el Wake Lock se re-solicita (ver consola `[WakeLock] Activado ✓`).

5. **Screen Wake Lock**  
   En celular real (Chrome Android), abre `chrome://inspect` → consola debe mostrar `[WakeLock] Activado`. Bloquea pantalla: no debe apagarse mientras el tab está visible.

6. **Logout**  
   Botón `Salir` → borra token y desconecta socket.

---

## ⚠️ Nota de seguridad (reporte para auditor)

> **Token en localStorage** es vulnerable a XSS. Si existe un vector XSS, un atacante puede robar `localStorage.getItem('token')`.  
> Reportado pero no corregido por regla del agente frontend — dejar a `security-auditor` evaluar migración a `httpOnly` cookie + CSRF o memoria + refresh token.

---

## 📦 Build

```bash
npm run build # → dist/ listo para Vercel/Netlify/Nginx
# dist/index.html 0.90kB, css 30kB, js 296kB (94kB gzip)
```
