# UrbanPeru - AI Agent & Developer Guide (`agent.md`)

Este documento sirve como la guía de referencia técnica y operativa para agentes de IA y desarrolladores que trabajen en el proyecto **UrbanPeru**.

---

## 📌 Descripción del Proyecto
UrbanPeru es una aplicación full-stack para tomar pedidos de un food truck por WhatsApp, compuesta por:
1. **Backend (Node.js / Express / TypeScript)**: Servidor API REST, autenticación JWT, conexión a PostgreSQL mediante Sequelize, WebSockets (`socket.io`) y el bot de WhatsApp. El bot corre hoy sobre `Baileys` (no oficial) y está **en migración a la WhatsApp Cloud API oficial de Meta**: ambos transportes conviven en el código y se elige con `WHATSAPP_TRANSPORT` (`baileys` por defecto). Contexto y estado completos en `MIGRACION-WHATSAPP-CLOUD-API.md`.
2. **Frontend (React 19 / Vite / Tailwind v4 / TypeScript)**: Panel de control (Dashboard), gestión de turnos, visualización en tiempo real de pedidos/mensajes mediante WebSockets, autenticación de usuarios y diseño responsive.

---

## 📂 Estructura del Repositorio
```text
UrbanPeru/
├── src/                    # Backend (Node.js / Express / TypeScript)
│   ├── config/             # db.ts (TODOS los modelos Sequelize + relaciones) y socket.ts (Socket.IO + auth JWT)
│   ├── middleware/         # auth.ts (JWT)
│   ├── routes/             # auth, pedidos, clientes, configuracion, whatsapp (QR/reinicio Baileys), whatsappWebhook (Cloud API)
│   ├── services/           # whatsappServices.ts (motor de conversación + transporte Baileys), whatsappCloudApi.ts (cliente Graph API)
│   ├── utils/              # horario.ts (horario de atención y franjas de agenda)
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

## 🧠 Motor de conversación (`src/services/whatsappServices.ts`)
- Ambos transportes (Baileys y el webhook de Cloud API) llaman al MISMO punto de entrada: `manejarMensajeEntrante()`. La lógica de negocio no debe depender de un transporte concreto; recibe callbacks (`responder`, `enviarDatosBancarios`, `notificarStaff`).
- La conversación es una máquina de estados explícita: `EstadoConversacion` (union de strings) + tablas `MANEJADORES_SIN_CLIENTE` y `MANEJADORES` (`estado → función`), con un manejador por paso (`manejarPidiendoMetodoPago`, `manejarConfirmandoPedido`, …). Un cliente sin estado cae en `manejarSinPedidoActivo`.
- Todo lo que el bot recuerda de un pedido a medio armar vive en UN objeto por cliente (`PedidoPendiente`, indexado por teléfono en `pedidosPendientes`). Se accede con `pedido(tel)` (escritura) y `estadoDe(tel)` (solo lectura), y se borra entero con `limpiarPedidoPendiente(tel)`. **No agregues mapas sueltos por cliente**: fue la causa de bugs reales (datos de pago mezclados entre intentos).
- Es memoria del proceso, no BD: el pedido recién se persiste al confirmar. Hay purga por inactividad (24 h).
- Para agregar un paso nuevo: sumar el estado al union, escribir su manejador y registrarlo en la tabla correspondiente.
- No hay tests automatizados. Antes de refactorizar este archivo, conviene comparar conversaciones simuladas antes/después (respuesta por respuesta) contra la BD local — así se validó el último refactor sin diferencias.

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
2. **Migración de WhatsApp a la Cloud API oficial (en curso)**:
   - ✅ Transporte Cloud API construido y validado contra un número de prueba (`whatsappCloudApi.ts`, `whatsappWebhook.ts`).
   - ❌ Manejo del mensaje `order` del webhook (carrito nativo del catálogo de WhatsApp) — campo `Producto.retailerId` ya creado, falta el handler.
   - ❌ Plantilla `nuevo_pedido_alerta` aprobada en Meta (sin ella `notificarStaff` no avisa por Cloud API).
   - ❌ Verificación de negocio, corte del número real y posterior eliminación de Baileys. Ver `MIGRACION-WHATSAPP-CLOUD-API.md`.
3. **Gestión de productos**:
   - ❌ No hay pantalla ni endpoints para crear/editar productos y categorías (hoy se manejan directo en la BD; el catálogo nativo se administrará en Meta Commerce Manager).
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
