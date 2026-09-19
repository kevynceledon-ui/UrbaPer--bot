# Migración de Baileys a WhatsApp Cloud API — Contexto y estado

> Documento de contexto generado a partir de la sesión de trabajo del 14-15 de
> septiembre de 2026. Sirve como referencia para retomar el trabajo, para
> explicarle el proyecto al dueño del negocio, y como bitácora de decisiones.

## 1. Por qué se está migrando

El bot de UrbanPerú usa hoy **Baileys** (`@whiskeysockets/baileys`), un
cliente no oficial de WhatsApp Web hecho por ingeniería inversa del
protocolo. Esto:

- Viola los Términos de Servicio de Meta.
- Expone al **número real del negocio** a un baneo sin aviso previo — más
  probable justo cuando el negocio tenga más pedidos (que es cuando más
  dolería perder el canal).
- Es inherentemente inestable: se desconecta y reconecta solo, a veces con
  errores tipo `Stream Errored (restart required)` o timeouts en las
  "init queries" al reconectar. Es comportamiento normal de Baileys, no un
  bug del código propio.

La alternativa es la **WhatsApp Business Platform Cloud API**, la API
oficial de Meta. Se investigó el costo real (ver sección 7 — Pricing) y se
decidió migrar.

**Decisión del dueño:** avanzar con la migración. El riesgo de baneo no es
aceptable; el costo de migrar es tiempo de desarrollo, no una cuota mensual
relevante (al menos con el volumen actual del negocio).

## 2. Estrategia: migración en fases, sin tocar el número real todavía

Se siguió (y se sigue) un plan por fases, para no arriesgar el número real
del negocio hasta validar todo contra un número de prueba:

- **Fase A** — Setup en Meta Developer (número de prueba, credenciales).
  ✅ Completa.
- **Fase B** — Construir el transporte Cloud API en paralelo a Baileys, sin
  borrar nada de Baileys. ✅ Completa.
- **Fase C** — Validar el flujo completo contra el número de prueba (texto,
  imagen de comprobante, persistencia en BD). ✅ Completa.
- **Fase D** — Corte al número real de producción. ⛔ **NO iniciada** — es
  la de mayor riesgo, requiere verificación de negocio en Meta y acción del
  dueño.
- **Fase E** — Eliminar Baileys del código, una vez que la Fase D lleve un
  período de "soak" limpio (1-2 semanas sin pedidos perdidos/duplicados).
  ⛔ No iniciada.

El plan completo y detallado (con la lista exacta de archivos a tocar/borrar
en cada fase) vive en:
`C:\Users\kevin\.claude\plans\keen-riding-moth.md`

## 3. Qué se construyó (Fase B) — arquitectura

La pieza clave que hace posible que ambos transportes convivan sin duplicar
lógica de negocio: **`manejarMensaje()`** (el motor completo de la
conversación — menú, carrito, pago, agenda, confirmación, persistencia en
BD, emisión a Socket.IO) **no depende directamente de Baileys**. Solo recibe
3 callbacks (`responder`, `enviarDatosBancarios`, `notificarStaff`) como
única costura con el transporte. Eso permitió una migración quirúrgica: se
reescribe la "cáscara" de conexión, no la lógica de negocio.

### Archivos nuevos

- **`src/services/whatsappCloudApi.ts`** — Cliente delgado de la Graph API
  de Meta (`v21.0`):
  - `enviarTexto(numero, texto)`
  - `enviarImagenBuffer(numero, buffer, mime, caption)` — sube el media con
    `POST /{phone-number-id}/media` y luego lo envía.
  - `descargarMedia(mediaId)` — produce el mismo formato
    `data:mime;base64,...` que ya esperaba `comprobantesPendientes` con
    Baileys.
  - `enviarPlantilla(numero, nombre, params)` — para el aviso al staff (ver
    sección 6, pendiente la plantilla).

- **`src/routes/whatsappWebhook.ts`** — Webhook de Meta, sin autenticación
  JWT (Meta lo llama directo), pero con verificación de firma:
  - `GET /api/whatsapp/webhook` — responde el `hub.challenge` si
    `hub.verify_token` coincide (handshake de verificación de Meta).
  - `POST /api/whatsapp/webhook` — verifica `X-Hub-Signature-256`
    (HMAC-SHA256 sobre el body **crudo** con `WHATSAPP_APP_SECRET`,
    comparación en tiempo constante con `crypto.timingSafeEqual`) → responde
    `200` **inmediatamente** (Meta exige ack en <20s o reintenta y puede
    desactivar el webhook) → procesa async: extrae `message.from` (ya viene
    en E.164 limpio — sin el problema de LID/senderPn que tiene Baileys) →
    dedupea por `message.id` (mismo patrón de Set acotado que ya existía
    para Baileys) → arma los 3 callbacks → llama a
    `manejarMensajeEntrante(...)`.

  **Detalle crítico de implementación:** esta ruta necesita el body
  **crudo** (`express.raw({type:"application/json"})`) para calcular el
  HMAC, y debe montarse **antes** de que el `express.json()` global consuma
  el body — si no, la verificación de firma falla siempre.

### Archivos modificados

- **`src/services/whatsappServices.ts`**:
  - Se agregó `manejarMensajeEntrante(opts)`, el punto de entrada
    **compartido** entre Baileys y Cloud API: cada transporte solo resuelve
    `numeroTelefono` / `texto` / `imagen` y arma los 3 callbacks a su
    manera; toda la lógica de qué hacer con eso vive una sola vez acá.
  - Se agregaron getters exportados `getConfiguracionBot()` y
    `estaEsperandoComprobante(numeroTelefono)` para que el webhook (otro
    módulo) pueda leer ese estado sin duplicarlo.
  - Se refactorizó el handler `messages.upsert` de Baileys para llamar a
    `manejarMensajeEntrante(...)` en vez de tener su propia lógica inline
    duplicada.
  - **Fix de detección de saludos** (ver sección 5).

- **`src/index.ts`**:
  - Se montó `whatsappWebhookRoutes` **antes** del `express.json()` global.
  - Se agregó `/api/whatsapp/webhook` al `skip` del rate limiter global.
  - Se agregó la bandera `WHATSAPP_TRANSPORT` (`"baileys"` por defecto,
    `"cloud"` para activar la Cloud API) que gatea si se llama
    `iniciarWhatsapp()` (Baileys) al arrancar. **Nunca deben estar ambos
    transportes activos a la vez** — respondería duplicado al mismo
    cliente.

- **`.env.example`** y **`render.yaml`**: se agregaron las 6 variables
  nuevas (`WHATSAPP_TRANSPORT`, `WHATSAPP_ACCESS_TOKEN`,
  `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`,
  `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_TEMPLATE_AVISO_STAFF`). En
  `render.yaml`, `WHATSAPP_TRANSPORT` está en `value: baileys` (no
  `sync: false`) — a propósito, para que el corte a `cloud` en producción
  sea un cambio explícito y visible en el repo, no una env var seteada a
  mano y olvidada en el dashboard de Render.

## 4. Setup manual hecho en Meta (Fase A)

Todo esto se hizo bajo la **cuenta personal de Facebook de Kevyn**, no la
del dueño del negocio (ver sección 8 — pendiente importante).

- App de Meta for Developers: **"Urban peru"** (App ID `1093038013231410`).
  - Nota: el nombre original "Urban **Perú**" (con tilde) no se dejaba
    guardar al crear el Portfolio comercial — el formulario de Meta no
    acepta caracteres especiales en el nombre. Se resolvió sacando la
    tilde: "Urban peru".
- Business Portfolio comercial: **"Urban peru"**.
- Número de prueba de WhatsApp (gratis, dado automáticamente por Meta) +
  número receptor verificado por OTP: `+56 9 3692 0014` (el celular
  personal de Kevyn, usado como "cliente" de prueba).
- WABA (WhatsApp Business Account) ID de prueba: `3826926454150251`.
- Phone Number ID de prueba: `1287220781147673`.
- **Token de acceso**: inicialmente se generó uno **temporal (24h)** desde
  la pantalla de "Introducción" — esto causó un error productivo real (ver
  sección 5). Se reemplazó por un **token de Usuario del Sistema
  (System User)**, generado desde Business Settings → Usuarios → Usuarios
  del sistema, con permisos `whatsapp_business_management` y
  `whatsapp_business_messaging`, con acceso total sobre la app "Urban peru"
  y sobre la cuenta de WhatsApp Business. Este token dura más (60 días o
  "nunca", según si el negocio ya está verificado).
- `WHATSAPP_VERIFY_TOKEN`: string propio inventado (`urbanperu2026verify`),
  no lo da Meta — se configura igual en el `.env` y en el dashboard de Meta
  al verificar el webhook.
- Webhook de Meta apuntado a un túnel de **ngrok** local durante las
  pruebas (`ngrok http 3000`). Nota: el free tier de ngrok da una URL
  nueva y aleatoria en cada reinicio — hubo que re-pegarla en el dashboard
  de Meta más de una vez durante las pruebas.
- **Paso fácil de olvidar, y que causó horas de debugging**: configurar el
  Callback URL + Verify Token en Meta **no alcanza** para que los mensajes
  entrantes lleguen al webhook. Hace falta además vincular explícitamente
  la WABA a la app llamando:
  ```
  POST https://graph.facebook.com/v21.0/{waba-id}/subscribed_apps
  Authorization: Bearer {token}
  ```
  Sin este paso, el handshake `GET` funciona perfecto, Meta muestra
  "messages" como suscrito en la UI, pero **cero** mensajes reales llegan
  al webhook — no hay ningún error visible, simplemente no pasa nada. Se
  diagnosticó comparando el inspector de ngrok (`localhost:4040`, sin
  ningún `POST` entrante) contra WhatsApp mostrando el mensaje enviado con
  normalidad.

## 5. Bugs encontrados y arreglados durante esta sesión

| # | Bug | Causa | Fix |
|---|-----|-------|-----|
| 1 | `Buffer<ArrayBufferLike>` no asignable a `BlobPart` (TS) | Tipo de Node.js `Buffer` no compatible directo con `Blob` del fetch API | `new Blob([new Uint8Array(buffer)], { type: mimeType })` en `enviarImagenBuffer` |
| 2 | TS7030 "Not all code paths return a value" en el POST handler del webhook | Faltaba un `return` explícito tras el `void procesarWebhook(...)` fire-and-forget | Se agregó `return;` al final del handler |
| 3 | El refactor inicial de Baileys descargaba imágenes siempre, no solo cuando se esperaba comprobante | Regresión propia al extraer `manejarMensajeEntrante` | Se restauró el chequeo `estadosUsuarios[numero] === "ESPERANDO_COMPROBANTE"` antes de descargar, en ambos transportes |
| 4 | `401 Authentication Error (code 190)` al enviar mensajes vía Cloud API, en producción real de pruebas | El `WHATSAPP_ACCESS_TOKEN` usado era el **temporal de 24h** de la pantalla de Introducción, y ya había expirado | Se generó un token de **Usuario del Sistema** permanente (ver sección 4) |
| 5 | Webhook configurado y verificado, pero cero mensajes reales llegaban (sin error visible) | Faltaba el paso de `POST /{waba-id}/subscribed_apps` — vincular la WABA a la app, un paso separado de configurar el Callback URL | Se ejecutó el `curl` a `subscribed_apps` manualmente; funcionó al toque |
| 6 | Detección de saludos ("hola") no reconocía variantes como `wena`, `wenas`, `wenos días`, `ola wenas` — y **un saludo no reconocido dejaba al bot completamente mudo** (sin ninguna respuesta) | La lista de saludos era una whitelist de regex fija, e imposible de cubrir todas las variantes/chilenismos | Se reemplazó por un **catch-all**: se identificó que, en el punto del flujo donde se evalúa esto, el estado del cliente solo puede ser "idle" o `REALIZANDO_PEDIDO` (todo estado intermedio ya hizo `return` antes), y los únicos comandos válidos en idle son `"1"` y `"2"`. Por lo tanto, **cualquier otro texto en idle** dispara la bienvenida por defecto — sin necesidad de reconocer la palabra exacta. Esto cubre automáticamente infinitas variantes de saludo y de paso arregla el bug del bot mudo. |

## 6. Validado end-to-end (Fase C)

Se hicieron pedidos de prueba completos, reales, vía WhatsApp contra el
número de prueba, confirmando persistencia correcta en Postgres para cada
uno (verificado con consultas SQL directas):

- ✅ Pedido con pago **efectivo**, delivery, con dirección y notas —
  confirmado y guardado correctamente.
- ✅ Pedido con pago **transferencia + comprobante por imagen** — el bot
  pidió la imagen, la Cloud API la descargó (`descargarMedia`), y quedó
  guardada en `Pedido.comprobanteImagen` como base64 (verificado: 80.611
  caracteres, imagen real, no vacío).
- ✅ Reset de conversación entre pedidos — después de confirmar un pedido,
  un nuevo saludo (`Hola`, `:D`, etc.) reinicia el flujo correctamente sin
  arrastrar estado del pedido anterior.
- ✅ Deploy a Render confirmado sano (`GET /ping` responde `200 OK`) tras el
  push del código de Fase B + el fix de saludos.

### No probado explícitamente (bajo riesgo, el código ya lo maneja)

- Rechazo de un `POST` al webhook con firma HMAC inválida o ausente
  (debería devolver `403` — el código en `whatsappWebhook.ts` ya lo hace,
  solo falta el test explícito).
- Comportamiento ante reintentos duplicados de Meta del mismo
  `message.id` (el dedup Set ya existe, mismo patrón usado para Baileys).

## 7. Pricing de la API oficial (verificado, no asumido)

Investigado directamente contra la documentación/política de Meta:

- El patrón de uso de este bot (el cliente escribe primero, el bot responde
  con texto libre dentro de la ventana de 24h de conversación abierta) cae
  en **"service messages"**.
- **Cambio de política de Meta, efectivo 1 de octubre de 2026**: los
  service messages pasan a ser facturables más allá de un umbral gratuito.
  - **1.000 mensajes gratis por número de teléfono, por mes.**
  - Después de eso, fracciones de centavo por mensaje.
  - **Se debe tener un método de pago cargado en Meta antes del 30 de
    septiembre de 2026**, o desde el 1 de octubre los service messages
    simplemente **dejan de entregarse** (no hay período de gracia ni
    aviso visible al cliente final — el bot se queda mudo).
- Con el volumen actual del negocio (bajo), esto debería seguir siendo
  prácticamente gratis, pero el método de pago **sí hay que cargarlo antes
  de esa fecha** para no perder el canal el 1 de octubre.

## 8. Identidad de la cuenta de Meta (RESUELTO)

> **Actualización:** resuelto. Kevin ya tiene acceso a la cuenta de Meta
> Business/Developers **del dueño del negocio**, así que todo el setup real
> (app, número, token permanente, catálogo, verificación de negocio) se hará ahí y
> no hace falta migrar nada desde la cuenta personal. Lo de abajo se conserva como
> historial de por qué se planteó el problema.

Todo el setup de Meta (App, Business Portfolio, número de prueba) está bajo
la **cuenta personal de Facebook de Kevyn**, no la del dueño del negocio.
Antes de avanzar a la Fase D (número real), hay que decidir con el dueño:

1. **El dueño crea su propio Business Portfolio** (con su Facebook, sus
   datos, sus documentos) y ahí se hace la verificación de negocio real —
   luego agrega a Kevyn como administrador/desarrollador si van a seguir
   trabajando juntos.
2. **Se queda todo bajo la cuenta de Kevyn** — funciona, pero la
   verificación de negocio ante Meta va a pedir documentos legales del
   negocio (RUT, dirección, etc.) que solo el dueño tiene, sin importar de
   quién sea la cuenta de Facebook.

Esta decisión la tiene que tomar el dueño, no es algo resoluble solo con
código.

## 9. Estado actual del deploy

- **Producción (Render, `urbanperu-backend`)**: código de Cloud API +
  fix de saludos ya están desplegados (`git push` a `main`, commits
  `de070b0` y `f813330`). `WHATSAPP_TRANSPORT` en producción sigue en
  `"baileys"` — el número real del negocio sigue funcionando exactamente
  igual que siempre, **cero riesgo** por este deploy. El código de Cloud
  API queda ahí, listo, sin usarse, hasta que se decida activarlo.
- **Local (`.env`, no versionado)**: configurado con
  `WHATSAPP_TRANSPORT=cloud` y las credenciales del número de **prueba**,
  para seguir iterando/probando sin tocar producción.

## 10. Próximos pasos

> **Alcance actualizado:** el dueño decidió eliminar Baileys por completo y usar el
> **catálogo nativo de WhatsApp** (carrito armado en la interfaz de WhatsApp, recibido
> por webhook como mensaje `order`), con Meta Commerce Manager como fuente de
> verdad de los productos. El plan vigente y detallado (Fases A–E, con el catálogo
> incluido) está en `C:Userskevin.claudeplanskeen-riding-moth.md`. Lo de abajo
> es la versión original, previa a ese cambio de alcance.

En orden recomendado, sin implicar que haya que hacerlos todos ya:

1. **Reunión con el dueño del negocio** (en curso/próxima) — mostrarle el
   bot funcionando (vía Baileys, sin cambios visibles para él todavía),
   explicarle el riesgo de baneo del número real, y decidir juntos bajo qué
   cuenta de Meta se hace la verificación de negocio (ver sección 8).
2. **Plantilla `nuevo_pedido_alerta`** — crearla y pedir aprobación en Meta
   Business Manager para que `notificarStaff` funcione con Cloud API (el
   staff no le escribe primero al bot, así que no hay ventana de 24h
   abierta — necesita sí o sí una plantilla *utility* aprobada). Puede
   tardar horas o un día en aprobarse.
3. **Verificación de negocio en Meta** — la inicia el dueño (o Kevyn, según
   lo que decidan en el punto 1), sube documentos, puede tardar días.
4. **Cargar método de pago en Meta** antes del **30 de septiembre de
   2026** (ver sección 7) — independiente de si ya se migró o no, es una
   fecha dura.
5. **Fase D** (corte real, alto riesgo, no autorizada todavía):
   - Desvincular Baileys del número real (un número no puede estar en
     ambos modos a la vez).
   - Registrar el número real en Cloud API.
   - Confirmar que la plantilla de aviso al staff esté aprobada también
     para la app de producción.
   - Actualizar las env vars reales en Render (`WHATSAPP_PHONE_NUMBER_ID`,
     `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`,
     `WHATSAPP_VERIFY_TOKEN`) y recién ahí cambiar
     `WHATSAPP_TRANSPORT=cloud` en `render.yaml`.
   - Monitorear de cerca los primeros pedidos reales. Rollback documentado:
     volver `WHATSAPP_TRANSPORT=baileys` y redesplegar (probablemente haya
     que re-escanear QR si `.baileys_auth` quedó desactualizado).
   - Período de "soak" de al menos 1-2 semanas (cubriendo un fin de semana
     de más pedidos) confirmando cero pedidos perdidos/duplicados.
6. **Fase E** (solo después de un soak period limpio): eliminar todo el
   código de Baileys — ver la lista exacta de qué borrar en
   `C:\Users\kevin\.claude\plans\keen-riding-moth.md`.

## 11. Deuda técnica / gaps conocidos, no relacionados a la migración

Detectados durante esta sesión, no resueltos todavía (no bloquean nada de
lo anterior):

- **Error no fatal en cada arranque local**: `sync({alter:true})` de
  Sequelize genera un `ALTER TABLE` inválido para la columna `categoriaId`
  de `Productos` (`error de sintaxis en o cerca de «REFERENCES»`). Se
  captura en el try/catch de `db.ts`, no rompe el servidor ni bloquea nada,
  pero ensucia el log de arranque.
- La imagen `assets/datos-transferencia.jpg` (datos bancarios que se
  mandan al elegir transferencia) **no existe** en el proyecto — esto ya
  era así con Baileys, no es nuevo de esta migración. `enviarDatosBancarios`
  simplemente no manda nada si el archivo no está.

## 12. Trabajo posterior a la validación (septiembre 2026)

Cambios hechos después de cerrar la Fase C, todos verificados con `tsc`, build del
frontend y pruebas contra el servidor local:

- **Campo `Producto.retailerId`** (Fase B2 del plan de catálogo): puente entre el
  `product_retailer_id` que llegará en el mensaje `order` de WhatsApp y la fila de
  `Producto`. Aún no hay handler para ese mensaje (Fase B3).
- **Auditoría de bugs** (motor de conversación, backend, dashboard): pedido duplicado
  por doble "SI" (candado `PROCESANDO_PEDIDO`), crash del proceso por promesa sin
  `.catch`, dashboard a pantalla blanca por un pedido con datos rotos (Error Boundary),
  datos de pago mezclados al cambiar de método, sesión JWT vencida sin aviso, `trust
  proxy` mal configurado, carreras entre poll y socket, CORS con comodín + credenciales.
- **Refactor del motor de conversación**: los ~10 mapas sueltos por cliente pasaron a un
  solo objeto (`PedidoPendiente`) y `manejarMensaje` (700 líneas) a una tabla
  `estado → manejador`. Validado con comparación "golden master": las mismas
  conversaciones simuladas contra el código viejo y el nuevo, sin diferencias.
- **Bugs encontrados durante ese trabajo**: `reset` dejaba carrito/pago colgados;
  escribir `constructor`/`toString`/`__proto__` como código de plato agregaba un plato
  "undefined" y dejaba al cliente sin respuesta; una falla a mitad de guardar el pedido
  dejaba al cliente trabado (ahora se recupera y puede reintentar); el estado en memoria
  (con el comprobante en base64) nunca expiraba (ahora hay purga a las 24 h de inactividad).
- **Seguridad**: contenedor ya no corre como root (con `chown` para la sesión de Baileys),
  JWT fijado a HS256 en firma y verificación, CORS sin comodín con credenciales, dependencia
  sin uso removida, `npm audit` (solo queda `uuid` transitivo de Sequelize, no explotable
  con el uso actual; el fix forzado rompería Sequelize).
- **Verificado en vivo**: un POST al webhook sin firma HMAC responde 403 (pendiente de la
  Fase C, ya cerrado).
