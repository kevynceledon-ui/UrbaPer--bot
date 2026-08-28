# UrbanPeru - AI Agent & Developer Guide (`agent.md`)

Este documento sirve como la guía de referencia técnica y operativa para agentes de IA y desarrolladores que trabajen en el proyecto **UrbanPeru**.

---

## 📌 Descripción del Proyecto
UrbanPeru is una aplicación full-stack compuesta por:
1. **Backend (Node.js / Express / TypeScript)**: Servidor API REST, autenticación JWT, conexión a PostgreSQL mediante Sequelize, WebSockets (`socket.io`) y automatización de WhatsApp (`Baileys`).
2. **Frontend (React 19 / Vite / Tailwind v4 / TypeScript)**: Panel de control (Dashboard), gestión de turnos, visualización en tiempo real de pedidos/mensajes mediante WebSockets, autenticación de usuarios y diseño responsive.

---

## 📂 Estructura del Repositorio
```text
UrbanPeru/
├── src/                    # Backend (Node.js / Express / TypeScript)
│   ├── config/             # Configuración de BD (db.ts) y WebSockets (socket.ts)
│   ├── middleware/         # Middlewares (ej. auth.ts)
│   ├── routes/             # Rutas API (ej. auth.ts)
│   ├── services/           # Lógica de negocio y WhatsApp (whatsappServices.ts)
│   └── index.ts            # Punto de entrada del servidor backend
├── tsconfig.json           # Configuración TypeScript del backend (module NodeNext, strict)
├── frontend/               # Frontend (React + Vite + Tailwind v4 + TS)
│   ├── src/
│   │   ├── components/     # Componentes reutilizables (OrderCard, Header, etc.)
│   │   ├── hooks/          # Custom hooks (useOrdersSocket, useWakeLock, etc.)
│   │   ├── pages/          # Páginas (DashboardPage, LoginPage)
│   │   ├── services/       # Cliente API y sockets (api.ts, socket.ts)
│   │   ├── types/          # Tipados TypeScript (order.ts)
│   │   ├── App.tsx         # Enrutador y componentes raíz
│   │   └── index.css       # Estilos globales y Tailwind CSS
│   ├── package.json
│   └── vite.config.ts
├── .env / .env.example     # Variables de entorno
└── package.json            # Dependencias del backend
```

---

## 🚀 Comandos Útiles

### Backend
- **Iniciar servidor de desarrollo** (recarga en caliente con `tsx`):
  ```bash
  npm run dev
  ```
- **Compilar a JavaScript** (salida en `dist/`):
  ```bash
  npm run build
  ```
- **Iniciar servidor compilado (producción)**:
  ```bash
  npm start
  ```
- **Verificar tipos sin emitir archivos**:
  ```bash
  npm run typecheck
  ```

### Frontend (`/frontend`)
- **Instalar dependencias**:
  ```bash
  npm install
  ```
- **Iniciar servidor de desarrollo (Vite)**:
  ```bash
  npm run dev
  ```
- **Construir para producción (Typecheck + Build)**:
  ```bash
  npm run build
  ```
- **Ejecutar linter (Oxlint)**:
  ```bash
  npm run lint
  ```

---

## 🚧 Puntos y Pasos Pendientes (No Implementados)
Los siguientes componentes, características y mejoras aún no están implementados en el proyecto y representan la hoja de ruta para futuras iteraciones:

1. **Testing Automatizado**:
   - ❌ **Tests unitarios e integración en Backend**: Configuración de Jest/Supertest para endpoints de autenticación y lógica de servicios.
   - ❌ **Tests en Frontend**: Pruebas unitarias de componentes con Vitest y React Testing Library / Playwright para flujos E2E.
2. **Modelos de Datos y Endpoints de Órdenes (Backend)**:
   - ❌ **Modelos Sequelize para Negocio**: Creación de modelos y migraciones para Órdenes, Clientes, Productos e Inventario.
   - ❌ **CRUD de Pedidos**: Endpoints REST completos (`/api/orders`) para gestión, actualización de estados y filtrado.
3. **Integración y Monitoreo de WhatsApp (`Baileys`)**:
   - ❌ **Dashboard QR State**: Interfaz gráfica en el frontend que reciba y muestre en tiempo real el código QR de autenticación de WhatsApp emitido por el backend vía Socket.io.
   - ❌ **Gestión de Sesiones y Reconexión**: Lógica avanzada de auto-reconexión ante caídas de la API de WhatsApp y almacenamiento persistente de sesión seguro.
4. **Control de Accesos Basado en Roles (RBAC)**:
   - ❌ **Roles de Usuario**: Diferenciación de permisos entre Administrador, Operador de Turno y Repartidor tanto en middleware de backend como en protección de rutas en frontend.
5. **Reportes y Analítica**:
   - ❌ **Exportación de Datos**: Funcionalidad para exportar reportes de turnos y ventas a formatos PDF o Excel.
   - ❌ **Métricas Avanzadas**: Gráficos de rendimiento, tiempos de entrega y volumen de mensajes en el dashboard.

---

## 🔐 Convenciones y Normas de Desarrollo
1. **Seguridad**:
   - Nunca expongas credenciales, tokens JWT o claves de base de datos en el código fuente.
   - Utiliza variables de entorno (`.env`) para configuraciones sensibles.
   - El backend cuenta con `helmet`, CORS restrictivo y rate limiting (`express-rate-limit`). Mantén estas medidas activas.
2. **Estilo de Código**:
   - Backend en TypeScript estricto (`tsconfig.json`, módulos `NodeNext`, imports relativos con extensión `.js`). Frontend en ES Modules / TypeScript estricto.
   - Mantén los componentes de React limpios, tipados y modulares.
3. **Control de Versiones**:
   - Realiza commits atómicos y claros.
   - Verifica que el build y lint pasen correctamente antes de finalizar cambios importantes.
