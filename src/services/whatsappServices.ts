import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
  type WAMessage,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import QRCode from "qrcode";
import { rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Op } from "sequelize";
import { estaAbierto as estaAbiertoSegunHorario, calcularFranjasDisponibles, horaChileAFecha, formatHoraChile } from "../utils/horario.js";

//Estado en memoria de cada cliente, indexado por teléfono. Vive acá y no en la
//BD a propósito: un pedido a medio armar no vale la pena persistirlo, y recién
//se guarda en Postgres al confirmar (ver manejarConfirmandoPedido). Se pierde
//si el proceso se reinicia a mitad de una conversación.
type EstadoConversacion =
  | "ESPERANDO_NOMBRE"
  | "ESPERANDO_CONFIRMAR_AGENDA"
  | "ELIGIENDO_CATEGORIA"
  | "REALIZANDO_PEDIDO"
  | "PIDIENDO_MODALIDAD"
  | "ELIGIENDO_HORA_PROGRAMADA"
  | "PIDIENDO_METODO_PAGO"
  | "PIDIENDO_MONTO_EFECTIVO"
  | "ESPERANDO_COMPROBANTE"
  | "PIDIENDO_DIRECCION"
  | "PIDIENDO_NOTA"
  | "CONFIRMANDO_PEDIDO"
  | "PROCESANDO_PEDIDO"
  | "HABLANDO_CON_HUMANO";

interface CarritoItem {
  productoId: string;
  nombre: string;
  precio: number;
  //Usado por calcularTiempoPedido() para estimar la demora real de cocina en
  //vez de una fórmula genérica por cantidad de pedidos en cola.
  tiempoPreparacionMin: number;
}

interface PedidoPendiente {
  //Paso de la conversación en el que está el cliente (ausente = sin pedido activo).
  estado?: EstadoConversacion;
  carrito?: CarritoItem[];
  //Último listado de códigos mostrado (categoría elegida o "ver todo el menú"),
  //mapeando el número que escribe (1, 2, 3…) al producto real. Se sobreescribe
  //cada vez que se muestra un listado nuevo (ver manejarEligiendoCategoria).
  menuActual?: Record<string, CarritoItem>;
  //Pedido agendado fuera de horario (ver ADR-002): si el cliente aceptó agendar,
  //se le pregunta la hora después de la modalidad en vez de ir directo al pago.
  //`franjas` cachea el listado exacto mostrado, para que elegir "3" siempre
  //mapee al mismo horario aunque la disponibilidad cambie mientras responde.
  programado?: boolean;
  franjas?: { inicio: string; fin: string }[];
  horaProgramada?: Date;
  //Nota de alergias/instrucciones especiales, pendiente de confirmar.
  nota?: string;
  //Pago: método elegido, comprobante de transferencia recibido, o monto con el
  //que paga en efectivo (para calcular el vuelto). Pendientes hasta la
  //confirmación final.
  metodoPago?: "efectivo" | "transferencia";
  comprobanteImagen?: string;
  montoRecibido?: number;
  //Entrega: modalidad, y dirección de despacho (solo si delivery).
  modalidad?: "delivery" | "retiro";
  direccion?: string;
  //Última vez que se accedió para escribir (ver pedido()); lo usa la purga por
  //inactividad de más abajo.
  actualizadoEn?: number;
}

//Sin prototipo: la clave es un identificador que viene del mensaje entrante, y en
//un `{}` normal una clave "__proto__" haría que pedido() devuelva Object.prototype
//y le escriba campos (contaminación de prototipo global).
const pedidosPendientes: Record<string, PedidoPendiente> = Object.create(null);

//Devuelve el pedido pendiente del cliente, creándolo vacío si no existía. Usar
//solo para escribir o cuando ya se sabe que hay una conversación en curso.
function pedido(numeroTelefono: string): PedidoPendiente {
  const p = (pedidosPendientes[numeroTelefono] ??= {});
  p.actualizadoEn = Date.now();
  return p;
}

//Solo lectura del estado: NO crea la entrada (un saludo suelto de alguien que
//nunca arma un pedido no debe dejar basura en memoria).
function estadoDe(numeroTelefono: string): EstadoConversacion | undefined {
  return pedidosPendientes[numeroTelefono]?.estado;
}

//Borra TODO el estado en memoria de un cliente de una sola vez. Al ser un solo
//objeto por cliente, ya no hay forma de "olvidarse" de limpiar uno de varios
//campos sueltos (bug real que ya pasó dos veces: método de pago/comprobante
//mezclados entre intentos, y "reset" dejando el carrito anterior colgado).
function limpiarPedidoPendiente(numeroTelefono: string): void {
  delete pedidosPendientes[numeroTelefono];
}

//Purga por inactividad: sin esto, cada conversación abandonada a mitad de un pedido
//quedaba en memoria para siempre — y el comprobante de transferencia se guarda como
//base64 (hasta varios MB por cliente), así que en un servidor chico se acumulaba
//hasta quedarse sin memoria. No se purgan los estados que deben sobrevivir aunque el
//cliente no escriba: PROCESANDO_PEDIDO (se está guardando) y HABLANDO_CON_HUMANO
//(el bot debe seguir callado hasta que el equipo lo devuelva desde el dashboard).
const INACTIVIDAD_MAXIMA_MS = 24 * 60 * 60 * 1000;
setInterval(() => {
  const limite = Date.now() - INACTIVIDAD_MAXIMA_MS;
  for (const numeroTelefono of Object.keys(pedidosPendientes)) {
    const p = pedidosPendientes[numeroTelefono];
    if (p.estado === "PROCESANDO_PEDIDO" || p.estado === "HABLANDO_CON_HUMANO") continue;
    if ((p.actualizadoEn ?? 0) < limite) delete pedidosPendientes[numeroTelefono];
  }
}, 60 * 60 * 1000).unref();

//Simulación manual del horario (ADR-002) para pruebas, sin tocar HorarioAtencion
//ni afectar a ningún cliente real. No existe fuera de NODE_ENV !== "production",
//y solo responde a los números en NUMEROS_PRUEBA. "cerrado" fuerza el flujo de
//local cerrado aunque el horario real diga abierto; "abierto" fuerza lo
//contrario (útil para probar el flujo normal en un día/hora realmente cerrado).
const NUMEROS_PRUEBA =
  process.env.NODE_ENV !== "production"
    ? (process.env.NUMEROS_PRUEBA || "").split(",").map((n) => n.trim()).filter(Boolean)
    : [];
const simulacionHorarioPorNumero = new Map<string, "cerrado" | "abierto">();

function simulacionHorario(numeroTelefono: string): "cerrado" | "abierto" | null {
  if (process.env.NODE_ENV === "production") return null;
  return simulacionHorarioPorNumero.get(numeroTelefono) ?? null;
}

//Única fuente de verdad para "¿el local está abierto ahora mismo, para este
//número?" — respeta el modo prueba (/simular) antes de consultar el horario
//real. TODO el código debe llamar a ESTA función, nunca a
//horario.ts::estaAbierto() directo, para que el override no se pueda olvidar
//al agregar un punto nuevo del flujo (ver bug real: el disparo de
//ELIGIENDO_HORA_PROGRAMADA lo decidía por su cuenta, ignorando /simular).
async function estaAbierto(numeroTelefono: string): Promise<boolean> {
  const simulacion = simulacionHorario(numeroTelefono);
  if (simulacion === "abierto") return true;
  if (simulacion === "cerrado") return false;
  return estaAbiertoSegunHorario();
}

//Import de las tablas
import { Cliente, Pedido, Producto, DetallePedido, ConfiguracionBot, CONFIGURACION_BOT_ID, Categoria } from "../config/db.js";

//Dirección del local, mostrada automáticamente a quien elige "retiro". Si no está
//configurada, se avisa igual sin romper el flujo.
const DIRECCION_LOCAL = process.env.DIRECCION_LOCAL || "contáctanos para coordinar el retiro (dirección aún no configurada)";

//Reconocimiento flexible de saludos y preguntas de "¿están abiertos?", tolerante
//a tildes, mayúsculas y errores ortográficos comunes (ola, asta, etc.).
function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[¿?¡!.,]/g, "")
    .trim()
    .replace(/\s+/g, " ");
}


const PATRON_CONSULTA_ESTADO = /\b(abiert|cerrad|atend|disponib|abren)\w*\b/;

function esConsultaEstado(textoCliente: string): boolean {
  return PATRON_CONSULTA_ESTADO.test(normalizarTexto(textoCliente));
}

function mensajeMetodoPago(modalidad?: "delivery" | "retiro"): string {
  const notaEnvio =
    modalidad === "delivery"
      ? "\n\n📦 Recuerda: el envío se paga solo por transferencia bancaria (la comida la puedes pagar en efectivo)."
      : "";
  return `💳 ¿Cómo vas a pagar?\n\n1️⃣ Efectivo\n2️⃣ Transferencia${notaEnvio}`;
}

//Horario real del negocio (ver ADR-002 / HorarioAtencion). Se usa como mensaje de
//respaldo cuando no queda ningún turno disponible hoy para agendar.
const MENSAJE_CERRADO_SIN_AGENDA =
  "🕒 Ahora estamos cerrados y no quedan horarios disponibles para agendar hoy.\n\n" +
  "Nuestro horario:\n📅 Martes a sábado: 12:00-16:30 y 19:00-22:00\n📅 Domingo: 12:00-17:00\n📅 Lunes: cerrado\n\n" +
  "¡Te esperamos pronto! 👋";

//Imagen con los datos bancarios (cuenta RUT + logo Mercado Pago) que se manda al
//elegir "transferencia", para que el cliente no tenga que leer un mensaje de texto.
//Se lee una sola vez al iniciar; si el archivo no está, se sigue sin mandarla.
const RUTA_DATOS_BANCARIOS = path.join(process.cwd(), "assets", "datos-transferencia.jpg");
let datosBancariosBuffer: Buffer | null = null;
if (existsSync(RUTA_DATOS_BANCARIOS)) {
  datosBancariosBuffer = readFileSync(RUTA_DATOS_BANCARIOS);
} else {
  console.warn(`No se encontró la imagen de datos bancarios en ${RUTA_DATOS_BANCARIOS}; se seguirá sin enviarla.`);
}

//Pausa de emergencia del bot, controlada desde el dashboard (ver src/routes/configuracion.ts).
//Cacheada en memoria para no consultar la DB en cada mensaje entrante; se refresca
//con actualizarConfiguracionBotCache() cuando el equipo cambia el toggle.
interface ConfiguracionBotCache {
  activo: boolean;
  mensajePausa: string;
  duracionFranjaMin: number;
  capacidadPorFranja: number;
  //Aviso adicional por WhatsApp cuando llega un pedido nuevo (ver notificarStaff
  //más abajo) — parche para cuando el sonido del dashboard no es confiable.
  notificacionesWhatsappActivas: boolean;
  numeroNotificaciones: string | null;
  //Factores del cálculo de demora por cocina paralela (ver calcularTiempoPedido).
  factorParaleloMin: number;
  factorParaleloMax: number;
}

let configuracionBot: ConfiguracionBotCache = {
  activo: true,
  mensajePausa: "En este momento no estamos tomando pedidos por este medio. Por favor intenta más tarde o comunícate directamente con el local.",
  duracionFranjaMin: 15,
  capacidadPorFranja: 1,
  notificacionesWhatsappActivas: false,
  numeroNotificaciones: null,
  factorParaleloMin: 0.3,
  factorParaleloMax: 0.5,
};

export async function cargarConfiguracionBot(): Promise<void> {
  try {
    const [fila] = await ConfiguracionBot.findOrCreate({
      where: { id: CONFIGURACION_BOT_ID },
      defaults: { id: CONFIGURACION_BOT_ID },
    });
    configuracionBot = {
      activo: fila.activo,
      mensajePausa: fila.mensajePausa,
      duracionFranjaMin: fila.duracionFranjaMin,
      capacidadPorFranja: fila.capacidadPorFranja,
      notificacionesWhatsappActivas: fila.notificacionesWhatsappActivas,
      numeroNotificaciones: fila.numeroNotificaciones,
      factorParaleloMin: fila.factorParaleloMin,
      factorParaleloMax: fila.factorParaleloMax,
    };
  } catch (e) {
    console.warn("No se pudo cargar la configuración del bot, se usa el valor por defecto (activo):", e);
  }
}

export function actualizarConfiguracionBotCache(cambios: Partial<ConfiguracionBotCache>): void {
  configuracionBot = { ...configuracionBot, ...cambios };
}

//Lectura de la caché para transportes fuera de este archivo (ver whatsappWebhook.ts
//y el plan de migración a Cloud API) — el staff se notifica desde el módulo del
//transporte, que necesita el número configurado en el dashboard.
export function getConfiguracionBot(): Readonly<ConfiguracionBotCache> {
  return configuracionBot;
}

const emojiDigito: Record<string, string> = {
  "0": "0️⃣", "1": "1️⃣", "2": "2️⃣", "3": "3️⃣", "4": "4️⃣",
  "5": "5️⃣", "6": "6️⃣", "7": "7️⃣", "8": "8️⃣", "9": "9️⃣",
};

function numeroEmoji(n: number): string {
  return String(n).split("").map((d) => emojiDigito[d]).join("");
}

//Menú real: se agrupa en categorías (ver ELIGIENDO_CATEGORIA) en vez de un
//listado plano, porque es muy extenso para leerlo de un tirón por WhatsApp.
async function generarListaCategorias(): Promise<string> {
  const categorias = await Categoria.findAll({ order: [["orden", "ASC"]] });
  const lineas = categorias.map((c, i) => `${numeroEmoji(i + 1)} ${c.nombre}`);
  return `*--- MENÚ URBANPERÚ 🇵🇪 ---*\n\n${lineas.join("\n")}\n${numeroEmoji(0)} Ver todo el menú\n\n👉 *Escribe el número de la categoría que te interesa.*`;
}

//categoriaId=null → "ver todo el menú" (agrupado por categoría, numeración
//continua). Con categoriaId → solo esa categoría, numeración 1..N reiniciada.
//Devuelve también el mapa código→producto para guardar en PedidoPendiente.menuActual.
async function generarMenuCategoria(
  categoriaId: string | null
): Promise<{ texto: string; codigos: Record<string, CarritoItem> }> {
  //Sin prototipo a propósito: el texto que escribe el cliente se usa como clave
  //(menuActual[textoCliente]), y con un `{}` normal escribir "constructor" o
  //"toString" devolvía una propiedad heredada de Object (truthy) que se agregaba
  //al carrito como un plato "undefined", dejando al cliente sin respuesta.
  const codigos: Record<string, CarritoItem> = Object.create(null);
  let contador = 0;

  if (categoriaId) {
    const categoria = await Categoria.findByPk(categoriaId);
    const productos = await Producto.findAll({
      where: { categoriaId, disponible: true },
      order: [["orden", "ASC"]],
    });
    const lineas = productos.map((p) => {
      contador++;
      codigos[String(contador)] = { productoId: p.id, nombre: p.nombre, precio: p.precio, tiempoPreparacionMin: p.tiempoPreparacionMin };
      return `${numeroEmoji(contador)} ${p.nombre} - $${p.precio.toLocaleString("es-CL")}`;
    });
    const texto = `*${categoria?.nombre ?? "Menú"}*\n\n${lineas.join("\n")}\n\n👉 *Escribe el número del plato para agregarlo, o "listo" para ver las categorías de nuevo.*`;
    return { texto, codigos };
  }

  const categorias = await Categoria.findAll({ order: [["orden", "ASC"]] });
  const bloques: string[] = [];
  for (const categoria of categorias) {
    const productos = await Producto.findAll({
      where: { categoriaId: categoria.id, disponible: true },
      order: [["orden", "ASC"]],
    });
    if (productos.length === 0) continue;
    const lineas = productos.map((p) => {
      contador++;
      codigos[String(contador)] = { productoId: p.id, nombre: p.nombre, precio: p.precio, tiempoPreparacionMin: p.tiempoPreparacionMin };
      return `${numeroEmoji(contador)} ${p.nombre} - $${p.precio.toLocaleString("es-CL")}`;
    });
    bloques.push(`*${categoria.nombre}*\n${lineas.join("\n")}`);
  }
  const texto = `*--- MENÚ COMPLETO ---*\n\n${bloques.join("\n\n")}\n\n👉 *Escribe el número del plato para agregarlo, o "listo" para ver las categorías de nuevo.*`;
  return { texto, codigos };
}

//Compartido entre la opción "1" del menú y las preguntas de "¿están abiertos?"
//(ver esConsultaEstado): si está cerrado (real o simulado, ver ADR-002) ofrece
//agendar; si está abierto, muestra las categorías directamente.
async function mostrarMenuOAgendar(
  numeroTelefono: string,
  responder: (texto: string) => Promise<unknown>,
  prefijoSiAbierto = ""
): Promise<void> {
  if (!(await estaAbierto(numeroTelefono))) {
    const franjas = await calcularFranjasDisponibles(configuracionBot.duracionFranjaMin, configuracionBot.capacidadPorFranja);
    if (franjas.length === 0) {
      await responder(MENSAJE_CERRADO_SIN_AGENDA);
      return;
    }
    pedido(numeroTelefono).estado = "ESPERANDO_CONFIRMAR_AGENDA";
    await responder(`🕒 Ahora estamos cerrados. Volvemos a abrir hoy a las ${franjas[0].inicio}. ¿Quieres agendar tu pedido para más tarde? Responde *SI* o *NO*.`);
    return;
  }
  pedido(numeroTelefono).estado = "ELIGIENDO_CATEGORIA";
  await responder(`${prefijoSiAbierto}${await generarListaCategorias()}`);
}

//Arma el listado de items + total (usado tanto en la vista previa antes de
//confirmar como en el recibo final, para no duplicar el cálculo).
function formatResumenCarrito(
  carrito: CarritoItem[],
  nota: string,
  opts: {
    metodoPago?: "efectivo" | "transferencia";
    modalidad?: "delivery" | "retiro";
    direccion?: string;
    montoRecibido?: number;
    horaProgramadaTexto?: string;
  } = {}
): { texto: string; total: number } {
  let total = 0;
  let texto = "";
  carrito.forEach((item) => {
    texto += `- ${item.nombre} ($${item.precio.toLocaleString("es-CL")})\n`;
    total += item.precio;
  });
  texto += `\n*Total: $${total.toLocaleString("es-CL")}*`;
  if (opts.modalidad) {
    texto += `\n${opts.modalidad === "delivery" ? "🛵 Delivery" : "🏪 Retiro en el local"}`;
  }
  if (opts.direccion) {
    texto += `\n📍 Dirección: ${opts.direccion}`;
  }
  if (opts.horaProgramadaTexto) {
    texto += `\n🗓️ Agendado para las ${opts.horaProgramadaTexto}`;
  }
  if (opts.metodoPago) {
    texto += `\n💳 Pago: ${opts.metodoPago === "efectivo" ? "Efectivo" : "Transferencia"}`;
  }
  if (opts.montoRecibido != null) {
    const vuelto = opts.montoRecibido - total;
    texto += `\n💵 Pagas con: $${opts.montoRecibido.toLocaleString("es-CL")} (vuelto: $${vuelto.toLocaleString("es-CL")})`;
  }
  if (nota) {
    texto += `\n📝 Nota: ${nota}`;
  }
  return { texto, total };
}

//Demora de UN pedido cocinado en paralelo: el plato más lento marca el mínimo
//posible (no se puede entregar antes que él), y el resto de platos del mismo
//pedido suma solo una fracción de su tiempo (se cocinan al mismo tiempo, no uno
//detrás del otro) — factorParaleloMin/Max son configurables desde ConfiguracionBot.
function calcularTiempoPedido(items: { tiempoPreparacionMin: number }[]): { min: number; max: number } {
  if (items.length === 0) return { min: 0, max: 0 };
  const tiempos = items.map((i) => i.tiempoPreparacionMin);
  const platoMasLento = Math.max(...tiempos);
  const restoSuma = tiempos.reduce((suma, t) => suma + t, 0) - platoMasLento;
  return {
    min: Math.round(platoMasLento + configuracionBot.factorParaleloMin * restoSuma),
    max: Math.round(platoMasLento + configuracionBot.factorParaleloMax * restoSuma),
  };
}

//Suma calcularTiempoPedido() de cada pedido activo (pendiente/preparando, sin
//contar uno agendado que todavía no llega su hora) más el pedido que se está
//creando ahora. Reemplaza la vieja fórmula de "n × minutos fijos por pedido en
//cola", que no distinguía un pedido de un plato de uno de cinco. Un pedido
//olvidado por el staff más allá de 60 min deja de inflar la demora de los demás
//(sin tocar su estado real).
async function calcularTiempoEstimado(itemsNuevoPedido: CarritoItem[]): Promise<{ min: number; max: number }> {
  const haceUnaHora = new Date(Date.now() - 60 * 60 * 1000);
  const ahora = new Date();
  const pedidosActivos = await Pedido.findAll({
    where: {
      estado: { [Op.in]: ["pendiente", "preparando"] },
      createdAt: { [Op.gte]: haceUnaHora },
      [Op.or]: [{ horaProgramada: null }, { horaProgramada: { [Op.lte]: ahora } }],
    },
    include: [{ model: DetallePedido, include: [{ model: Producto }] }],
  });

  let minTotal = 0;
  let maxTotal = 0;
  for (const pedido of pedidosActivos) {
    const items = (pedido.DetallePedidos ?? []).flatMap((detalle) =>
      Array.from({ length: detalle.cantidad }, () => ({
        tiempoPreparacionMin: detalle.Producto?.tiempoPreparacionMin ?? 15,
      }))
    );
    const { min, max } = calcularTiempoPedido(items);
    minTotal += min;
    maxTotal += max;
  }

  const nuevo = calcularTiempoPedido(itemsNuevoPedido);
  minTotal += nuevo.min;
  maxTotal += nuevo.max;

  return { min: Math.min(minTotal, 60), max: Math.min(maxTotal, 60) };
}

//Logger silencioso: Baileys es muy verboso por defecto (loguea cada paquete de protocolo).
const logger = pino({ level: "error" });

//Contexto de un mensaje entrante, compartido por todos los manejadores de
//estado. `ContextoMensaje` agrega el Cliente de la BD, que solo existe después de
//buscarlo/crearlo (los manejadores previos a eso usan `ContextoBase`).
interface ContextoBase {
  numeroTelefono: string;
  textoCliente: string;
  responder: (texto: string) => Promise<unknown>;
  enviarDatosBancarios: () => Promise<void>;
  notificarStaff: (texto: string) => Promise<unknown>;
}
interface ContextoMensaje extends ContextoBase {
  cliente: Cliente;
  fueCreado: boolean;
}

//Cliente atendido por una persona: el bot se queda callado para no interrumpir
//la conversación manual hasta que alguien del equipo lo devuelva al bot desde
//el dashboard.
async function manejarHablandoConHumano(): Promise<void> {}

//Si llegó texto en vez de una imagen mientras se esperaba el comprobante (la
//imagen en sí se maneja antes, en manejarMensajeEntrante, porque el transporte
//necesita descargarla). También permite corregir el método de pago si el
//cliente eligió "transferencia" por error.
async function manejarEsperandoComprobante(ctx: ContextoBase): Promise<void> {
  const { numeroTelefono, textoCliente, responder } = ctx;
  const p = pedido(numeroTelefono);
  const comando = textoCliente.toLowerCase().trim();
  if (comando === "cambiar" || comando === "efectivo" || comando === "cambiar metodo" || comando === "cambiar método") {
    delete p.metodoPago;
    // Se estaba esperando comprobante de transferencia — si vuelve a efectivo,
    // ese comprobante (si llegó a mandar uno antes) ya no aplica. Sin este
    // borrado, un pedido en efectivo podía quedar guardado con una imagen de
    // comprobante de un intento de transferencia anterior.
    delete p.comprobanteImagen;
    p.estado = "PIDIENDO_METODO_PAGO";
    await responder(mensajeMetodoPago(p.modalidad));
    return;
  }
  await responder('Por favor envía la *imagen* del comprobante de transferencia (foto o captura de pantalla). Si te equivocaste y quieres pagar en *efectivo*, escribe *cambiar*.');
}

//Candado contra doble confirmación: si el cliente manda "SI" dos veces seguido
//(impaciencia, o un reintento de WhatsApp con otro id de mensaje — el dedup por
//message.id no lo detecta), el segundo mensaje puede llegar mientras el primero
//todavía está guardando el pedido en la BD (varios `await` entre leer el carrito
//y borrarlo). manejarConfirmandoPedido pasa el estado a PROCESANDO_PEDIDO de
//forma síncrona, antes del primer `await`, y cualquier mensaje que llegue
//mientras tanto termina acá en vez de crear un segundo Pedido.
async function manejarProcesandoPedido(ctx: ContextoBase): Promise<void> {
  await ctx.responder("⏳ Ya estoy procesando tu pedido, dame un segundo...");
}

// ESPERANDO_NOMBRE: cliente nuevo, se le pide su primer nombre para registrarlo.
async function manejarEsperandoNombre(ctx: ContextoBase): Promise<void> {
  const { numeroTelefono, textoCliente, responder } = ctx;
  const p = pedido(numeroTelefono);
  const soloLetras = /^[A-Za-zÁÉÍÓÚáéíóúÑñ]+$/;

  if (!soloLetras.test(textoCliente)) {
    await responder("❌ Formato inválido. Por favor, ingresa *solamente tu primer nombre* (sin espacios, ni números).");
    return;
  }

  await Cliente.update(
    { nombre: textoCliente },
    { where: { telefono: numeroTelefono } }
  );

  delete p.estado;
  await responder(`¡Perfecto, ${textoCliente}! Ya guardé tus datos. 🍔 ¿Qué te gustaría pedir hoy?\n\n1️⃣ Ver Menú\n2️⃣ Hablar con un humano`);
  return;
}

// ESPERANDO_CONFIRMAR_AGENDA: el local está cerrado, ¿quiere agendar su pedido? (ver ADR-002)
async function manejarEsperandoConfirmarAgenda(ctx: ContextoMensaje): Promise<void> {
  const { numeroTelefono, textoCliente, responder } = ctx;
  const p = pedido(numeroTelefono);
  const respuesta = textoCliente.toLowerCase();
  if (respuesta === "si" || respuesta === "sí") {
    p.programado = true;
    p.estado = "ELIGIENDO_CATEGORIA";
    await responder(await generarListaCategorias());
    return;
  }
  if (respuesta === "no") {
    delete p.estado;
    await responder("Sin problema, te esperamos en nuestro horario de atención. ¡Hasta pronto! 👋");
    return;
  }
  await responder("Por favor responde *SI* o *NO*.");
  return;
}

// PIDIENDO_MODALIDAD: delivery o retiro.
// Va justo después de "pagar" y antes del método de pago (ver ADR en el handoff).
async function manejarPidiendoModalidad(ctx: ContextoMensaje): Promise<void> {
  const { numeroTelefono, textoCliente, responder } = ctx;
  const p = pedido(numeroTelefono);
  if (textoCliente === "1" || textoCliente === "2") {
    const modalidad: "delivery" | "retiro" = textoCliente === "1" ? "delivery" : "retiro";
    p.modalidad = modalidad;
    const prefijo = modalidad === "retiro" ? `📍 Retiras en nuestro local: ${DIRECCION_LOCAL}\n\n` : "";

    // Pedido agendado (ver ADR-002): en vez de ir directo al método de pago,
    // pregunta la hora dentro de los turnos que quedan hoy.
    if (p.programado) {
      const franjas = await calcularFranjasDisponibles(configuracionBot.duracionFranjaMin, configuracionBot.capacidadPorFranja);
      if (franjas.length === 0) {
        // Se llenaron los horarios mientras elegía la modalidad (raro, pero posible).
        delete p.programado;
        p.estado = "PIDIENDO_METODO_PAGO";
        await responder(`${prefijo}Se acaban de llenar los horarios disponibles para agendar hoy.\n\n${mensajeMetodoPago(modalidad)}`);
        return;
      }
      p.franjas = franjas;
      p.estado = "ELIGIENDO_HORA_PROGRAMADA";
      const lista = franjas.map((f, i) => `${numeroEmoji(i + 1)} ${f.inicio}-${f.fin}`).join("\n");
      await responder(`${prefijo}🗓️ ¿Para qué hora lo necesitas?\n\n${lista}`);
      return;
    }

    p.estado = "PIDIENDO_METODO_PAGO";
    await responder(`${prefijo}${mensajeMetodoPago(modalidad)}`);
    return;
  }
  await responder("Por favor responde *1* para Delivery o *2* para Retiro en el local.");
  return;
}

// ELIGIENDO_HORA_PROGRAMADA: elige una de las franjas horarias de un pedido agendado (ver ADR-002).
async function manejarEligiendoHoraProgramada(ctx: ContextoMensaje): Promise<void> {
  const { numeroTelefono, textoCliente, responder } = ctx;
  const p = pedido(numeroTelefono);
  const franjas = p.franjas ?? [];
  const elegida = franjas[Number(textoCliente) - 1];
  if (!elegida) {
    await responder("Por favor elige un número válido de la lista de horarios.");
    return;
  }
  p.horaProgramada = horaChileAFecha(elegida.inicio);
  p.estado = "PIDIENDO_METODO_PAGO";
  await responder(mensajeMetodoPago(p.modalidad));
  return;
}

// ELIGIENDO_CATEGORIA: elige una categoría del menú (o 0 para verlo todo).
async function manejarEligiendoCategoria(ctx: ContextoMensaje): Promise<void> {
  const { numeroTelefono, textoCliente, responder } = ctx;
  const p = pedido(numeroTelefono);
  if (textoCliente === "0") {
    const { texto, codigos } = await generarMenuCategoria(null);
    p.menuActual = codigos;
    p.estado = "REALIZANDO_PEDIDO";
    await responder(texto);
    return;
  }
  const categorias = await Categoria.findAll({ order: [["orden", "ASC"]] });
  const categoria = categorias[Number(textoCliente) - 1];
  if (!categoria) {
    await responder('Por favor elige un número válido de categoría, o *0* para ver todo el menú.');
    return;
  }
  const { texto, codigos } = await generarMenuCategoria(categoria.id);
  p.menuActual = codigos;
  p.estado = "REALIZANDO_PEDIDO";
  await responder(texto);
  return;
}

// PIDIENDO_METODO_PAGO: efectivo o transferencia.
async function manejarPidiendoMetodoPago(ctx: ContextoMensaje): Promise<void> {
  const { numeroTelefono, textoCliente, responder, enviarDatosBancarios } = ctx;
  const p = pedido(numeroTelefono);
  if (textoCliente === "1") {
    p.metodoPago = "efectivo";
    // Si venía de haber elegido transferencia antes (por ejemplo, dijo "no"
    // en la confirmación y cambió de método), ese comprobante ya no aplica —
    // sin este borrado quedaba pegado a un pedido que ahora es en efectivo.
    delete p.comprobanteImagen;
    p.estado = "PIDIENDO_MONTO_EFECTIVO";
    const { total } = formatResumenCarrito(p.carrito ?? [], "");
    await responder(`💵 Tu pedido suma *$${total.toLocaleString("es-CL")}*. ¿Con qué billete vas a pagar, para llevarte el vuelto justo? (escribe solo el monto, ej: 10000)`);
    return;
  }
  if (textoCliente === "2") {
    p.metodoPago = "transferencia";
    // Mismo caso al revés: un monto en efectivo de un intento anterior no
    // debe seguir mostrándose como "pagas con / vuelto" en un pedido que
    // ahora es por transferencia (bug real reportado: "vuelto: -$8.500").
    delete p.montoRecibido;
    p.estado = "ESPERANDO_COMPROBANTE";
    await enviarDatosBancarios();
    await responder("📸 Envía la *imagen* de tu comprobante de transferencia (foto o captura de pantalla).");
    return;
  }
  await responder("Por favor responde *1* para Efectivo o *2* para Transferencia.");
  return;
}

// PIDIENDO_MONTO_EFECTIVO: con qué billete paga, para calcular el vuelto justo.
async function manejarPidiendoMontoEfectivo(ctx: ContextoMensaje): Promise<void> {
  const { numeroTelefono, textoCliente, responder } = ctx;
  const p = pedido(numeroTelefono);
  const comandoCambiar = textoCliente.toLowerCase().trim();
  if (comandoCambiar === "cambiar" || comandoCambiar === "transferencia" || comandoCambiar === "cambiar metodo" || comandoCambiar === "cambiar método") {
    delete p.metodoPago;
    p.estado = "PIDIENDO_METODO_PAGO";
    await responder(mensajeMetodoPago(p.modalidad));
    return;
  }
  const monto = Number(textoCliente.replace(/[^\d]/g, ""));
  if (!monto) {
    await responder("Por favor escribe solo el monto en números, ej: 10000. Si te equivocaste y quieres pagar por *transferencia*, escribe *cambiar*.");
    return;
  }
  const { total } = formatResumenCarrito(p.carrito ?? [], "");
  if (monto < total) {
    await responder(`Ese monto no alcanza a cubrir el total ($${total.toLocaleString("es-CL")}). Escribe un monto igual o mayor.`);
    return;
  }
  p.montoRecibido = monto;

  if (p.modalidad === "delivery") {
    p.estado = "PIDIENDO_DIRECCION";
    await responder("📍 Pásame tu dirección de entrega (calle, número, comuna).");
  } else {
    p.estado = "PIDIENDO_NOTA";
    await responder("📝 ¿Alguna alergia o instrucción especial para tu pedido? (ej: alérgico a los mariscos, sin cebolla, para llevar, etc.)\n\nEscribe tu nota, o *no* si no tienes ninguna.");
  }
  return;
}

// PIDIENDO_DIRECCION: dirección de despacho (solo delivery).
async function manejarPidiendoDireccion(ctx: ContextoMensaje): Promise<void> {
  const { numeroTelefono, textoCliente, responder } = ctx;
  const p = pedido(numeroTelefono);
  p.direccion = textoCliente;
  p.estado = "PIDIENDO_NOTA";
  await responder("📝 ¿Alguna alergia o instrucción especial para tu pedido? (ej: alérgico a los mariscos, sin cebolla, para llevar, etc.)\n\nEscribe tu nota, o *no* si no tienes ninguna.");
  return;
}

// PIDIENDO_NOTA: alergias o instrucciones especiales; después muestra el resumen para confirmar.
async function manejarPidiendoNota(ctx: ContextoMensaje): Promise<void> {
  const { numeroTelefono, textoCliente, responder } = ctx;
  const p = pedido(numeroTelefono);
  const nota = textoCliente.toLowerCase() === "no" ? "" : textoCliente;
  p.nota = nota;
  p.estado = "CONFIRMANDO_PEDIDO";

  const miCarrito = p.carrito ?? [];
  const horaProgramadaPreview = p.horaProgramada;
  const { texto } = formatResumenCarrito(miCarrito, nota, {
    metodoPago: p.metodoPago,
    modalidad: p.modalidad,
    direccion: p.direccion,
    montoRecibido: p.montoRecibido,
    horaProgramadaTexto: horaProgramadaPreview ? formatHoraChile(horaProgramadaPreview) : undefined,
  });
  await responder(`*🧾 REVISA TU PEDIDO ANTES DE ENVIARLO:*\n\n${texto}\n\n¿Confirmas? Responde *SI* para mandarlo a cocina o *NO* para seguir editando.`);
  return;
}

// CONFIRMANDO_PEDIDO: confirmación final.
// Existe para evitar pedidos "fantasma": nada se guarda en la cocina hasta
// que el cliente confirma explícitamente con SI.
async function manejarConfirmandoPedido(ctx: ContextoMensaje): Promise<void> {
  const { numeroTelefono, textoCliente, responder, notificarStaff, cliente, fueCreado } = ctx;
  const p = pedido(numeroTelefono);
  const respuesta = textoCliente.toLowerCase();

  if (respuesta === "no") {
    p.estado = "REALIZANDO_PEDIDO";
    // OJO: metodoPago/comprobante/modalidad/dirección/monto NO se borran acá.
    // "NO" significa "déjame seguir agregando platos" (es literal lo que dice
    // el mensaje de abajo) — esa información ya la dio el cliente y sigue
    // siendo válida. Borrarla obligaba a mandar el comprobante de transferencia
    // una segunda vez al volver a escribir "pagar" (bug reportado por el cliente
    // real: ver el chequeo de "ya resuelto" en el handler de "pagar" más abajo).
    // OJO: pedidosProgramadosPendientes NO se borra acá — si seguía cerrado
    // cuando confirmó "no", al volver a escribir "pagar" debe recalcular
    // franjas y volver a pedir la hora, no colarse como pedido en tiempo
    // real (ver ADR-002). Solo se limpia lo que hay que recalcular de cero.
    delete p.franjas;
    delete p.horaProgramada;
    await responder("Sin problema, sigue agregando platos o escribe *pagar* cuando estés listo.");
    return;
  }

  if (respuesta !== "si" && respuesta !== "sí") {
    await responder("Por favor responde *SI* para confirmar tu pedido o *NO* para seguir editando.");
    return;
  }

  const miCarrito = p.carrito;
  if (!miCarrito || miCarrito.length === 0) {
    p.estado = "REALIZANDO_PEDIDO";
    await responder("Tu carrito quedó vacío, escribe un código válido (ej: 11) para agregar algo.");
    return;
  }

  // A partir de acá empiezan los `await` a la BD — se traba el estado antes
  // del primero para que un "SI" duplicado (ver candado más arriba) no vea
  // "CONFIRMANDO_PEDIDO" de nuevo mientras este pedido se sigue guardando.
  p.estado = "PROCESANDO_PEDIDO";

  const nota = p.nota ?? "";
  const metodoPago = p.metodoPago;
  const comprobanteImagen = p.comprobanteImagen ?? null;
  const modalidad = p.modalidad ?? null;
  const direccion = p.direccion ?? null;
  const montoRecibido = p.montoRecibido ?? null;
  const horaProgramada = p.horaProgramada ?? null;

  // Revalidación final de la hora agendada (ver ADR-002): la disponibilidad
  // se chequeó una sola vez, cuando se mostró la lista de horarios, varios
  // mensajes atrás (modalidad → hora → método de pago → comprobante/monto →
  // nota → confirmar). Si otro cliente reservó esa misma franja mientras
  // tanto, sin este chequeo el pedido se creaba igual, duplicando la hora
  // (bug real reportado: dos pedidos para las 9:30). Se revisa recién acá,
  // justo antes de guardar, contra el estado actual de la BD.
  if (horaProgramada) {
    const finFranja = new Date(horaProgramada.getTime() + configuracionBot.duracionFranjaMin * 60000);
    const ocupados = await Pedido.count({
      where: {
        horaProgramada: { [Op.gte]: horaProgramada, [Op.lt]: finFranja },
        estado: { [Op.ne]: "cancelado" },
      },
    });
    if (ocupados >= configuracionBot.capacidadPorFranja) {
      const franjas = await calcularFranjasDisponibles(configuracionBot.duracionFranjaMin, configuracionBot.capacidadPorFranja);
      delete p.horaProgramada;
      if (franjas.length === 0) {
        delete p.programado;
        delete p.franjas;
        p.estado = "CONFIRMANDO_PEDIDO";
        await responder("😕 Justo se acaba de ocupar ese horario y no quedan más disponibles por hoy. Escribe *SI* para mandarlo en tiempo real apenas abramos, o *NO* para seguir editando.");
        return;
      }
      p.franjas = franjas;
      p.estado = "ELIGIENDO_HORA_PROGRAMADA";
      const lista = franjas.map((f, i) => `${numeroEmoji(i + 1)} ${f.inicio}-${f.fin}`).join("\n");
      await responder(`😕 Justo se acaba de ocupar ese horario. Elige otro:\n\n${lista}`);
      return;
    }
  }

  const { texto: resumenItems, total } = formatResumenCarrito(miCarrito, nota, {
    metodoPago,
    modalidad: modalidad ?? undefined,
    direccion: direccion ?? undefined,
    montoRecibido: montoRecibido ?? undefined,
    horaProgramadaTexto: horaProgramada ? formatHoraChile(horaProgramada) : undefined,
  });
  // Un pedido agendado ya tiene una hora comprometida — no tiene sentido
  // mostrarle además un rango de espera "en vivo" (ver ADR-002).
  const tiempoEstimado = horaProgramada ? null : await calcularTiempoEstimado(miCarrito);
  const lineaTiempo = horaProgramada
    ? `🗓️ Tu pedido quedó agendado para las ${formatHoraChile(horaProgramada)}.`
    : `⏱️ Tiempo estimado: ${tiempoEstimado!.min}-${tiempoEstimado!.max} min`;
  const resumen = `*🧾 RESUMEN DE TU PEDIDO:*\n\n${resumenItems}\n${lineaTiempo}\n\n¡Tu pedido ha sido confirmado! 🧑‍🍳 En breve te contactaremos para coordinar el pago y la entrega.`;

  // ============ PERSISTENCIA EN BD ============
  // Guarda el pedido y sus detalles para que sobreviva a un reinicio del bot
  // y quede disponible aunque ningún dashboard esté conectado al emitirse.
  let pedidoId: string = `pedido_${Date.now()}`;
  //Cuántos pedidos anteriores de este cliente quedaron marcados "cancelado"
  //(el equipo los usa para marcar "no llegó" desde el dashboard). Se avisa al
  //equipo en el mismo pedido nuevo para que decidan si piden algo extra de
  //garantía antes de empezar a cocinar.
  let noShows = 0;
  try {
    // Diagnóstico: se detectaron pedidos guardados con cliente_id NULL (el
    // teléfono no aparece en el dashboard) sin poder reproducir la causa por
    // lectura de código — si vuelve a pasar, este log debería decir por qué
    // `cliente` llegó roto hasta acá.
    if (!cliente?.id) {
      console.error("[BUG cliente_id] cliente inválido al crear el pedido:", { numeroTelefono, cliente, fueCreado });
    }

    noShows = await Pedido.count({ where: { cliente_id: cliente.id, estado: "cancelado" } });

    const nuevoPedido = await Pedido.create({
      cliente_id: cliente.id,
      estado: "pendiente",
      total,
      notas: nota || null,
      metodoPago: metodoPago ?? null,
      comprobanteImagen,
      modalidad,
      direccion,
      montoRecibido,
      tiempoEstimadoMin: tiempoEstimado?.min ?? null,
      tiempoEstimadoMax: tiempoEstimado?.max ?? null,
      horaProgramada,
    });
    pedidoId = nuevoPedido.id;

    // Los items ya vienen con productoId real (elegidos del menú por categorías,
    // ver ELIGIENDO_CATEGORIA) — ya no hace falta buscar/crear por nombre.
    for (const item of miCarrito) {
      await DetallePedido.create({
        pedido_id: nuevoPedido.id,
        producto_id: item.productoId,
        cantidad: 1,
        precio_unitario: item.precio,
      });
    }
  } catch (dbErr) {
    // No rompemos el flujo del cliente si la DB falla, pero queda registrado
    console.error("[DB] No se pudo persistir el pedido:", dbErr);
  }
  // ===============================================================

  // ============ EMITIR EVENTO SOCKET.IO: nuevo_pedido ============
  // IMPORTANTE: Esta es la integración pedida. El Dashboard recibe tiempo real.
  try {
    const { getIO } = await import("../config/socket.js");
    const io = getIO();

    const pedidoPayload = {
      id: pedidoId,
      cliente: {
        telefono: numeroTelefono,
        nombre: cliente.nombre,
        whatsapp: `${numeroTelefono}@s.whatsapp.net`,
      },
      items: [...miCarrito],
      total,
      resumen: nota,
      metodoPago: metodoPago ?? null,
      comprobanteImagen,
      clienteNoShows: noShows,
      modalidad,
      direccion,
      montoRecibido,
      tiempoEstimadoMin: tiempoEstimado?.min ?? null,
      tiempoEstimadoMax: tiempoEstimado?.max ?? null,
      horaProgramada: horaProgramada ? horaProgramada.toISOString() : null,
      fecha: new Date().toISOString(),
    };

    // Un pedido agendado no debe aparecer en el feed de "activos ahora" del
    // dashboard (la cocina no debe empezarlo antes de tiempo) — va a su propia
    // sección, alimentada por este evento distinto (ver GET /api/pedidos/programados).
    const evento = horaProgramada ? "nuevo_pedido_programado" : "nuevo_pedido";
    io.emit(evento, pedidoPayload);

    console.log(`[Socket.IO] Evento '${evento}' emitido para ${numeroTelefono} total $${total.toLocaleString("es-CL")}`);
  } catch (socketErr) {
    // No romper el flujo del pedido si Socket.IO aún no está listo
    // En producción podrías persistir en DB y hacer polling fallback
    const message = socketErr instanceof Error ? socketErr.message : String(socketErr);
    console.warn("[Socket.IO] No se pudo emitir nuevo_pedido:", message);
  }
  // ===============================================================

  // ============ AVISO ADICIONAL POR WHATSAPP (opcional) ============
  // Parche para cuando el sonido del dashboard no es confiable (celular
  // bloqueado): un WhatsApp corto al número de turno, además del evento de
  // socket de arriba — no lo reemplaza, solo funciona como alarma.
  if (configuracionBot.notificacionesWhatsappActivas && configuracionBot.numeroNotificaciones) {
    const avisoModalidad = horaProgramada
      ? `🗓️ agendado ${formatHoraChile(horaProgramada)}`
      : modalidad === "retiro"
        ? "🏪 retiro en local"
        : "🛵 delivery";
    console.log(`[WhatsApp] Enviando aviso de pedido nuevo a ${configuracionBot.numeroNotificaciones}...`);
    await notificarStaff(
      `🔔 *Pedido nuevo* — ${cliente.nombre}\n${miCarrito.length} plato(s) · $${total.toLocaleString("es-CL")} · ${avisoModalidad}\n\nRevisa el dashboard para los detalles.`
    );
    console.log("[WhatsApp] Aviso de pedido nuevo enviado sin errores.");
  } else {
    // Diagnóstico: si esto aparece, el aviso no se manda porque la caché en
    // memoria no ve el toggle activado o el número — aunque la DB lo tenga
    // guardado bien, puede que este proceso arrancó antes de guardarlo, o que
    // cargarConfiguracionBot() falló al arrancar (ver warning más arriba).
    console.log(
      `[WhatsApp] Aviso de pedido nuevo NO enviado — notificacionesWhatsappActivas=${configuracionBot.notificacionesWhatsappActivas}, numeroNotificaciones=${configuracionBot.numeroNotificaciones ?? "null"}`
    );
  }
  // ===============================================================

  // Limpieza de memoria
  limpiarPedidoPendiente(numeroTelefono);

  await responder(resumen);
  return;
}

// REALIZANDO_PEDIDO: el cliente está armando su carrito (pagar / listo / carrito / quitar / código de plato).
async function manejarRealizandoPedido(ctx: ContextoMensaje): Promise<void> {
  const { numeroTelefono, textoCliente, responder } = ctx;
  const p = pedido(numeroTelefono);
  // a) Si el cliente quiere pagar: pasa a pedir nota + confirmación antes de
  // crear nada en firme (ver estados PIDIENDO_METODO_PAGO / PIDIENDO_NOTA /
  // CONFIRMANDO_PEDIDO arriba).
  if (textoCliente.toLowerCase() === "pagar") {
    const miCarrito = p.carrito;

    if (!miCarrito || miCarrito.length === 0) {
      await responder("Tu carrito está vacío. Por favor escribe un código válido (ej: 11).");
      return;
    }

    // ¿Ya resolvió modalidad + pago en un intento anterior (dijo "no" solo
    // para agregar más platos)? Si sigue siendo válido, no tiene sentido
    // volver a pedir la modalidad, el método de pago ni el comprobante —
    // se salta directo a la nota con el carrito actualizado.
    const modalidad = p.modalidad;
    const metodoPago = p.metodoPago;
    const direccionResuelta = !modalidad || modalidad === "retiro" || !!p.direccion;
    const { total: totalActual } = formatResumenCarrito(miCarrito, "");
    const pagoResuelto =
      metodoPago === "transferencia" ? !!p.comprobanteImagen :
        metodoPago === "efectivo" ? (p.montoRecibido ?? 0) >= totalActual :
          false;
    // Si es un pedido agendado, la hora elegida también se borró al decir "no"
    // (ver ADR-002 — puede haber pasado tiempo y las franjas ya no ser las
    // mismas), así que si falta hay que volver a pedirla, no saltarla.
    const horaResuelta = !p.programado || !!p.horaProgramada;

    if (modalidad && metodoPago && pagoResuelto && direccionResuelta && horaResuelta) {
      p.estado = "PIDIENDO_NOTA";
      await responder("📝 ¿Alguna alergia o instrucción especial para tu pedido? (ej: alérgico a los mariscos, sin cebolla, para llevar, etc.)\n\nEscribe tu nota, o *no* si no tienes ninguna.");
      return;
    }

    p.estado = "PIDIENDO_MODALIDAD";
    await responder("🛵 ¿Tu pedido es para *delivery* o *retiro* en el local?\n\n1️⃣ Delivery\n2️⃣ Retiro en el local");
    return;
  }

  // b) Si el cliente quiere ver las categorías de nuevo (para seguir agregando
  // platos de otra categoría al mismo pedido, ver ELIGIENDO_CATEGORIA).
  if (textoCliente.toLowerCase() === "listo") {
    p.estado = "ELIGIENDO_CATEGORIA";
    await responder(await generarListaCategorias());
    return;
  }

  // c-bis) Ver el carrito o corregir un plato agregado por error (ver el mismo
  // pedido del owner que dio origen al "cambiar" de método de pago).
  if (textoCliente.toLowerCase() === "carrito") {
    const miCarrito = p.carrito ?? [];
    if (miCarrito.length === 0) {
      await responder("Tu carrito está vacío todavía. Escribe un código del menú para agregar un plato.");
      return;
    }
    const lineas = miCarrito.map((item, i) => `${numeroEmoji(i + 1)} ${item.nombre} - $${item.precio.toLocaleString("es-CL")}`);
    await responder(`🛒 *Tu pedido hasta ahora:*\n\n${lineas.join("\n")}\n\n👉 Escribe *quitar <número>* para eliminar un plato (ej: quitar 2), o sigue agregando códigos.`);
    return;
  }

  const matchQuitar = textoCliente.toLowerCase().trim().match(/^quitar(?:\s+(\d+))?$/);
  if (matchQuitar) {
    const miCarrito = p.carrito ?? [];
    if (miCarrito.length === 0) {
      await responder("Tu carrito ya está vacío, no hay nada que quitar.");
      return;
    }
    // "quitar" sin número saca el último plato agregado (el caso típico de
    // "me equivoqué de código"); "quitar N" saca uno específico de la lista
    // mostrada con *carrito*.
    const posicion = matchQuitar[1] ? Number(matchQuitar[1]) : miCarrito.length;
    const indice = posicion - 1;
    if (indice < 0 || indice >= miCarrito.length) {
      await responder("No encontré ese número en tu carrito. Escribe *carrito* para ver la lista actualizada.");
      return;
    }
    const [eliminado] = miCarrito.splice(indice, 1);
    await responder(`🗑️ Quité *${eliminado.nombre}* de tu pedido.\n\n👉 Escribe *carrito* para ver lo que queda, otro código para seguir agregando, o *pagar* cuando estés listo.`);
    return;
  }

  // d) Si el cliente ingresa un plato (código del último listado mostrado)
  const productoElegido = p.menuActual?.[textoCliente];

  if (productoElegido) {
    if (!p.carrito) {
      p.carrito = [];
    }
    p.carrito.push(productoElegido);
    await responder(`✅ *${productoElegido.nombre}* agregado a tu pedido.\n\n👉 Escribe otro código para seguir en esta categoría. \n✅ *listo* para ver las categorías de nuevo\n 🛒*carrito* para revisar/quitar algo\n 💰*pagar* para enviar tu pedido a la cocina.`);
  } else {
    await responder('❌ Código no reconocido. Escribe un número válido del listado, ✅*listo* para ver las categorías, 🛒*carrito* para revisar/quitar algo.💰*pagar* para enviar tu pedido a la cocina.');
  }
}

//Cliente sin pedido en curso: consulta de "¿están abiertos?", opciones 1 y 2 del
//menú principal, y la bienvenida por defecto para cualquier otro texto.
async function manejarSinPedidoActivo(ctx: ContextoMensaje): Promise<void> {
  const { numeroTelefono, textoCliente, responder, cliente, fueCreado } = ctx;

  if (esConsultaEstado(textoCliente)) {
    await mostrarMenuOAgendar(numeroTelefono, responder, "✅ ¡Sí, estamos atendiendo! 🇵🇪\n\n");
    return;
  }

  if (textoCliente === "1") {
    await mostrarMenuOAgendar(numeroTelefono, responder);
    return;
  }

  if (textoCliente === "2") {
    pedido(numeroTelefono).estado = "HABLANDO_CON_HUMANO";
    delete pedido(numeroTelefono).carrito;

    const desde = new Date();
    await Cliente.update({ necesitaHumanoDesde: desde }, { where: { telefono: numeroTelefono } });

    void emitirEvento("cliente_necesita_humano", {
      telefono: numeroTelefono,
      nombre: cliente.nombre,
      desde: desde.toISOString(),
    });

    await responder("👨‍🍳 ¡Entendido! Un miembro de nuestro equipo leerá tu mensaje y te atenderá en unos minutos. ¡Gracias por tu paciencia!");
    return;
  }

  // Bienvenida por defecto. No intentamos reconocer cada variante de "hola"
  // (wena, wenas, wenos días, holaaaa, ola, etc. — son infinitas): un cliente sin
  // pedido en curso solo tiene como comandos válidos "1" y "2" (arriba), así que
  // cualquier otro texto no tiene otro significado posible que "está iniciando la
  // conversación". Esto también evita que un saludo raro deje al bot mudo.
  if (fueCreado || !cliente.nombre || cliente.nombre.trim() === "Por definir") {
    pedido(numeroTelefono).estado = "ESPERANDO_NOMBRE";
    await responder("¡Hola! Soy el asistente virtual de UrbanPerú 🇵🇪. Veo que es tu primera vez pidiendo con nosotros. ¿Me podrías decir tu nombre para registrarte?");
  } else {
    await responder(`¡Hola de nuevo, ${cliente.nombre}! 🇵🇪 ¿Qué vas a servirte hoy?\n\n1️⃣ Ver Menú\n2️⃣ Hablar con un humano`);
  }
}

//Estados que se resuelven sin necesitar al Cliente de la BD.
const MANEJADORES_SIN_CLIENTE: Partial<Record<EstadoConversacion, (ctx: ContextoBase) => Promise<void>>> = {
  HABLANDO_CON_HUMANO: manejarHablandoConHumano,
  ESPERANDO_COMPROBANTE: manejarEsperandoComprobante,
  PROCESANDO_PEDIDO: manejarProcesandoPedido,
  ESPERANDO_NOMBRE: manejarEsperandoNombre,
};

//Un manejador por estado de la conversación. Un cliente sin estado (o con uno
//que no figura acá) cae en manejarSinPedidoActivo.
const MANEJADORES: Partial<Record<EstadoConversacion, (ctx: ContextoMensaje) => Promise<void>>> = {
  PROCESANDO_PEDIDO: manejarProcesandoPedido,
  ESPERANDO_CONFIRMAR_AGENDA: manejarEsperandoConfirmarAgenda,
  PIDIENDO_MODALIDAD: manejarPidiendoModalidad,
  ELIGIENDO_HORA_PROGRAMADA: manejarEligiendoHoraProgramada,
  ELIGIENDO_CATEGORIA: manejarEligiendoCategoria,
  PIDIENDO_METODO_PAGO: manejarPidiendoMetodoPago,
  PIDIENDO_MONTO_EFECTIVO: manejarPidiendoMontoEfectivo,
  PIDIENDO_DIRECCION: manejarPidiendoDireccion,
  PIDIENDO_NOTA: manejarPidiendoNota,
  CONFIRMANDO_PEDIDO: manejarConfirmandoPedido,
  REALIZANDO_PEDIDO: manejarRealizandoPedido,
};

//Punto de entrada por mensaje de texto: atiende los comandos globales (reset y los
//de prueba), y después despacha según el estado de la conversación del cliente
//— ver MANEJADORES_SIN_CLIENTE y MANEJADORES arriba. Recibe `responder` en vez de
//msg.reply() (que no existe en Baileys) para no depender de un transporte.
async function manejarMensaje(
  numeroTelefono: string,
  textoCliente: string,
  responder: (texto: string) => Promise<unknown>,
  enviarDatosBancarios: () => Promise<void>,
  notificarStaff: (texto: string) => Promise<unknown>
): Promise<void> {
  if (textoCliente.toLowerCase() === "reset") {
    await Cliente.destroy({ where: { telefono: numeroTelefono } });
    limpiarPedidoPendiente(numeroTelefono);
    await responder("Tu usuario a sido eliminado.");
    return;
  }

  //Comando de prueba manual: fuerza "cerrado" o "abierto" (ADR-002) sin depender
  //del horario real. Solo existe fuera de producción, y solo para los números
  //listados en NUMEROS_PRUEBA — invisible para cualquier otro cliente.
  if (process.env.NODE_ENV !== "production" && NUMEROS_PRUEBA.includes(numeroTelefono)) {
    const comando = textoCliente.toLowerCase().trim();
    if (comando === "/simular cerrado") {
      simulacionHorarioPorNumero.set(numeroTelefono, "cerrado");
      await responder("🧪 Modo prueba: este número ahora ve el local como *cerrado*, sin importar el horario real. Escribe */simular abierto* o */simular normal* para cambiarlo.");
      return;
    }
    if (comando === "/simular abierto") {
      simulacionHorarioPorNumero.set(numeroTelefono, "abierto");
      await responder("🧪 Modo prueba: este número ahora ve el local como *abierto*, sin importar el horario real. Escribe */simular cerrado* o */simular normal* para cambiarlo.");
      return;
    }
    if (comando === "/simular normal") {
      simulacionHorarioPorNumero.delete(numeroTelefono);
      await responder("🧪 Modo prueba: este número vuelve a ver el horario real.");
      return;
    }
  }

  const base: ContextoBase = { numeroTelefono, textoCliente, responder, enviarDatosBancarios, notificarStaff };

  try {
    const estadoInicial = estadoDe(numeroTelefono);
    const manejadorSinCliente = estadoInicial && MANEJADORES_SIN_CLIENTE[estadoInicial];
    if (manejadorSinCliente) {
      await manejadorSinCliente(base);
      return;
    }

    // Buscar/crear al cliente en la BD
    const [cliente, fueCreado] = await Cliente.findOrCreate({
      where: { telefono: numeroTelefono },
      defaults: { telefono: numeroTelefono, nombre: "Por definir" },
    });

    // Imprimir en consola para nosotros
    if (fueCreado) {
      console.log(`Nuevo cliente registrado Telefono ${numeroTelefono}`);
    } else {
      console.log(`Cliente frecuente Telefono: ${numeroTelefono}`);
    }

    // El estado se vuelve a leer acá, después del `await` de arriba: otro mensaje
    // del mismo cliente pudo haberlo cambiado mientras se buscaba al cliente.
    const ctx: ContextoMensaje = { ...base, cliente, fueCreado };
    const estadoActual = estadoDe(numeroTelefono);
    const manejador = (estadoActual && MANEJADORES[estadoActual]) || manejarSinPedidoActivo;
    await manejador(ctx);
  } catch (error) {
    console.error("Error al intentar interactuar con la db", error);
    // Si falló a mitad de guardar el pedido, sin esto el cliente quedaba trabado
    // en PROCESANDO_PEDIDO (candado de manejarProcesandoPedido) sin poder reintentar.
    if (estadoDe(numeroTelefono) === "PROCESANDO_PEDIDO") {
      pedido(numeroTelefono).estado = "CONFIRMANDO_PEDIDO";
      await Promise.resolve(responder("⚠️ Tuve un problema al guardar tu pedido. Responde *SI* para intentarlo de nuevo.")).catch(() => {});
    }
  }
}

//Punto de entrada compartido entre transportes (Baileys hoy, WhatsApp Cloud API
//en migración — ver plan de migración): cada transporte solo tiene que resolver
//numeroTelefono/texto/imagen y armar los 3 callbacks (responder, enviarDatosBancarios,
//notificarStaff) a su manera; toda la lógica de qué hacer con eso vive acá una
//sola vez, para no duplicarla entre transportes.
export async function manejarMensajeEntrante(opts: {
  numeroTelefono: string;
  texto: string | undefined;
  imagen: { buffer: Buffer; mimetype: string } | null;
  responder: (texto: string) => Promise<unknown>;
  enviarDatosBancarios: () => Promise<void>;
  notificarStaff: (texto: string) => Promise<unknown>;
}): Promise<void> {
  const { numeroTelefono, texto, imagen, responder, enviarDatosBancarios, notificarStaff } = opts;

  //Pausa de emergencia (ver botón del dashboard / ConfiguracionBot): si está
  //pausado, no se procesa nada más, ni siquiera "reset" o un comprobante en curso.
  if (!configuracionBot.activo) {
    await responder(configuracionBot.mensajePausa);
    return;
  }

  //Comprobante de transferencia: no pasa por el flujo de solo-texto de abajo.
  if (estadoDe(numeroTelefono) === "ESPERANDO_COMPROBANTE" && imagen) {
    pedido(numeroTelefono).comprobanteImagen = `data:${imagen.mimetype};base64,${imagen.buffer.toString("base64")}`;
    if (pedido(numeroTelefono).modalidad === "delivery") {
      pedido(numeroTelefono).estado = "PIDIENDO_DIRECCION";
      await responder("✅ Comprobante recibido.\n\n📍 Pásame tu dirección de entrega (calle, número, comuna).");
    } else {
      pedido(numeroTelefono).estado = "PIDIENDO_NOTA";
      await responder("✅ Comprobante recibido.\n\n📝 ¿Alguna alergia o instrucción especial para tu pedido? (ej: alérgico a los mariscos, sin cebolla, para llevar, etc.)\n\nEscribe tu nota, o *no* si no tienes ninguna.");
    }
    return;
  }

  //Si el mensaje no tiene texto, lo ignora de inmediato (elimina la basura de
  //sincronización multimedia: imágenes, stickers, etc.) — salvo que estuviera
  //esperando el comprobante, donde vale la pena avisarle que mande la imagen.
  if (!texto || texto.trim() === "") {
    if (estadoDe(numeroTelefono) === "ESPERANDO_COMPROBANTE") {
      await responder("Por favor envía la *imagen* del comprobante de transferencia (foto o captura de pantalla).");
    }
    return;
  }

  await manejarMensaje(numeroTelefono, texto.trim(), responder, enviarDatosBancarios, notificarStaff);
}

//Para que un transporte (ej. whatsappWebhook.ts) pueda decidir si vale la pena
//descargar una imagen entrante ANTES de gastar la llamada a la API — solo se
//necesita cuando el cliente está esperando el comprobante de transferencia.
export function estaEsperandoComprobante(numeroTelefono: string): boolean {
  return estadoDe(numeroTelefono) === "ESPERANDO_COMPROBANTE";
}

function extraerTexto(msg: WAMessage): string | undefined {
  return msg.message?.conversation ?? msg.message?.extendedTextMessage?.text ?? undefined;
}

async function emitirEvento(evento: string, payload?: unknown): Promise<void> {
  try {
    const { getIO } = await import("../config/socket.js");
    if (payload === undefined) {
      getIO().emit(evento);
    } else {
      getIO().emit(evento, payload);
    }
  } catch (e) {
    console.warn(`[Socket.IO] No se pudo emitir ${evento}:`, e instanceof Error ? e.message : e);
  }
}

//Usado por PATCH /api/clientes/:telefono/reanudar-bot cuando el equipo termina de
//atender manualmente y quiere que el bot vuelva a responder ese número.
export function reanudarBot(numeroTelefono: string): void {
  delete pedidosPendientes[numeroTelefono]?.estado;
}

//Último QR generado y todavía sin escanear (null si ya está vinculado). El evento
//"whatsapp_qr" solo se emite en el instante exacto en que WhatsApp lo genera; un
//dashboard que se conecta un poco después se lo pierde. Cacheado acá para que
//src/config/socket.ts se lo mande apenas se conecte alguien nuevo.
let ultimoQrDataUrl: string | null = null;

export function getUltimoQr(): string | null {
  return ultimoQrDataUrl;
}

//Evita que dos conexiones convivan a la vez usando la misma sesión (corrompe el
//estado de Signal/cifrado si se llama iniciarWhatsapp() dos veces sin que la
//anterior haya cerrado).
let socketActivo = false;

//Referencia al socket activo, para poder forzar un reinicio manual desde el
//dashboard (ver reiniciarWhatsapp) sin esperar a que WhatsApp decida cerrar la
//conexión por su cuenta.
let socketRef: ReturnType<typeof makeWASocket> | null = null;

//Fuerza cerrar la sesión actual y generar un QR nuevo. Usado por el botón
//"Reiniciar vínculo" del dashboard cuando el bot queda en un estado raro (ej.
//aparece "listo" pero no responde, o quedó un vínculo a medias de una prueba
//anterior) y no se quiere esperar a un redeploy para limpiarlo.
export async function reiniciarWhatsapp(): Promise<void> {
  const anterior = socketRef;
  if (!anterior) {
    await rm(".baileys_auth", { recursive: true, force: true }).catch(() => { });
    socketActivo = false;
    await iniciarWhatsapp();
    return;
  }

  try {
    // logout() avisa a WhatsApp que desvincule el dispositivo; el propio evento
    // "close" con loggedOut que dispara ya se encarga de limpiar y reconectar
    // (ver el handler de connection.update más abajo).
    await anterior.logout();
  } catch (e) {
    console.warn("No se pudo cerrar sesión formalmente, se fuerza el reinicio igual:", e);
    await rm(".baileys_auth", { recursive: true, force: true }).catch(() => { });
    socketActivo = false;
    socketRef = null;
    await iniciarWhatsapp();
  }
}

//Inicia (o reinicia) la conexión con WhatsApp. Baileys guarda las credenciales en
//".baileys_auth" para no tener que re-escanear el QR en cada reinicio del proceso
//(en el free tier de Render, sin disco persistente, igual se pierde en cada redeploy).
export async function iniciarWhatsapp(): Promise<void> {
  if (socketActivo) {
    console.warn("iniciarWhatsapp() llamado mientras ya había una conexión activa; se ignora.");
    return;
  }
  socketActivo = true;

  await cargarConfiguracionBot();

  const { state, saveCreds } = await useMultiFileAuthState(".baileys_auth");

  const sock = makeWASocket({
    auth: state,
    logger,
  });
  socketRef = sock;

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    //El log en vivo de Render distorsiona el QR ASCII (fuente no monoespaciada), así que
    //lo mandamos como imagen por el socket ya autenticado con JWT para que el dashboard
    //lo muestre y se pueda escanear desde el celular sin pasar por la consola de Render.
    if (qr) {
      console.log("Nuevo QR generado, escanéalo desde el dashboard.");
      QRCode.toDataURL(qr)
        .then((dataUrl) => {
          ultimoQrDataUrl = dataUrl;
          void emitirEvento("whatsapp_qr", { qr: dataUrl });
        })
        .catch((e) => console.error("Error generando QR como imagen:", e));
    }

    if (connection === "open") {
      console.log("Cliente de wsp conecta y listo para recibir pedidos.");
      ultimoQrDataUrl = null;
      void emitirEvento("whatsapp_ready");
    }

    if (connection === "close") {
      socketActivo = false;
      if (socketRef === sock) socketRef = null;

      const statusCode = lastDisconnect?.error instanceof Boom
        ? lastDisconnect.error.output?.statusCode
        : undefined;
      const cerroSesion = statusCode === DisconnectReason.loggedOut;

      console.error("Conexión de WhatsApp cerrada.", lastDisconnect?.error?.message ?? "");

      if (cerroSesion) {
        // Alguien desvinculó el dispositivo desde el celular (Dispositivos vinculados).
        // Las credenciales guardadas ya no sirven: sin borrarlas, useMultiFileAuthState
        // las volvería a cargar tal cual y jamás se generaría un QR nuevo, dejando el
        // bot muerto hasta el próximo reinicio del proceso.
        console.error("Sesión de WhatsApp cerrada desde el celular. Generando un QR nuevo...");
        rm(".baileys_auth", { recursive: true, force: true })
          .catch((e) => console.error("No se pudo limpiar la sesión anterior:", e))
          .finally(() => {
            void iniciarWhatsapp().catch((e) => console.error("Error re-vinculando WhatsApp:", e));
          });
      } else {
        console.log("Reintentando conexión de WhatsApp...");
        // Sin este .catch(), un error acá (ej. una condición de carrera leyendo el
        // archivo de sesión durante reconexiones seguidas) queda como una promesa
        // rechazada sin manejar y Node mata TODO el proceso, no solo la conexión de
        // WhatsApp — probablemente la causa real de los "Instance failed" vistos en
        // Render durante las pruebas con varios celulares.
        void iniciarWhatsapp().catch((e) => console.error("Error reintentando conexión de WhatsApp:", e));
      }
    }
  });

  //Baileys puede reentregar el mismo mensaje más de una vez (reconexiones,
  //reintentos de ack) — sin este chequeo, un solo "1" del cliente se procesaba
  //dos veces y duplicaba el ítem en el carrito (bug real reportado: mismo
  //plato x2 en el mismo pedido sin que el cliente lo haya escrito dos veces).
  // Acotado en tamaño y recreado en cada reconexión (vive en el scope de
  // iniciarWhatsapp), no necesita expirar por tiempo.
  const mensajesProcesados = new Set<string>();
  const MAX_MENSAJES_PROCESADOS = 1000;

  sock.ev.on("messages.upsert", ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      void (async () => {
        const msgId = msg.key.id;
        if (msgId) {
          if (mensajesProcesados.has(msgId)) return;
          mensajesProcesados.add(msgId);
          if (mensajesProcesados.size > MAX_MENSAJES_PROCESADOS) {
            const masAntiguo = mensajesProcesados.values().next().value;
            if (masAntiguo) mensajesProcesados.delete(masAntiguo);
          }
        }

        const jid = msg.key.remoteJid;
        if (!jid) return;

        console.log(`[DEBUG CRUDO] De: ${jid} | Texto: "${extraerTexto(msg)}" | EsMio:"${msg.key.fromMe}"`);

        //Ignorar mensajes propios, de grupos y de estados/sistema. Solo chats privados.
        if (msg.key.fromMe || jid.endsWith("@g.us") || jid === "status@broadcast") return;

        //Desde 2024 WhatsApp usa un LID (identificador opaco, ej. "197135257587855@lid")
        //en vez del número real en remoteJid para ocultarlo por privacidad. El teléfono
        //real, cuando WhatsApp lo entrega, viene en msg.key.senderPn. Si no está disponible
        //(típico en el primer mensaje de un contacto nuevo, antes de que se sincronice el
        //mapeo), no hay forma de recuperarlo — es una limitación de la plataforma, no
        //nuestra: se usa el LID igual para no perder la conversación, pero no será un
        //número real marcable.
        //También se quita el sufijo ":idDispositivo" que WhatsApp multi-dispositivo agrega
        //(ej. "56912345678:12@s.whatsapp.net"), que si no se corta queda pegado al número.
        const fuenteTelefono = msg.key.senderPn ?? jid;
        const numeroTelefono = fuenteTelefono.split("@")[0].split(":")[0];
        const responder = (t: string) => sock.sendMessage(jid, { text: t });

        //Aviso adicional por WhatsApp al número de turno (ver ConfiguracionBot):
        //parche opcional para cuando el sonido del dashboard no es confiable.
        //No usa `responder` porque el destino es un número distinto al cliente.
        const notificarStaff = async (texto: string) => {
          if (!configuracionBot.numeroNotificaciones) return;
          try {
            await sock.sendMessage(`${configuracionBot.numeroNotificaciones}@s.whatsapp.net`, { text: texto });
          } catch (e) {
            console.warn("[WhatsApp] No se pudo enviar el aviso de pedido nuevo al staff:", e);
          }
        };

        //Manda la imagen con los datos bancarios (cuenta RUT + logo Mercado Pago) al
        //elegir transferencia. Se define acá porque necesita `sock`/`jid`, que
        //manejarMensaje no tiene.
        const enviarDatosBancarios = async () => {
          if (!datosBancariosBuffer) return;
          await sock.sendMessage(jid, { image: datosBancariosBuffer, caption: "🏦 Estos son nuestros datos para la transferencia." });
        };

        //Comprobante de transferencia: es una imagen, no pasa por extraerTexto. Se
        //descarga acá (no en manejarMensajeEntrante) porque necesita `sock` de Baileys.
        //Solo si corresponde — una imagen mandada en cualquier otro momento de la
        //conversación no vale la pena descargarla, se va a ignorar igual.
        let imagen: { buffer: Buffer; mimetype: string } | null = null;
        const imagenMsg = msg.message?.imageMessage;
        if (imagenMsg && estadoDe(numeroTelefono) === "ESPERANDO_COMPROBANTE") {
          try {
            const buffer = await downloadMediaMessage(msg, "buffer", {}, { logger, reuploadRequest: sock.updateMediaMessage });
            imagen = { buffer, mimetype: imagenMsg.mimetype || "image/jpeg" };
          } catch (e) {
            console.error("Error descargando comprobante de transferencia:", e);
            await responder("❌ No pude leer esa imagen, ¿puedes volver a enviarla?");
            return;
          }
        }

        const texto = extraerTexto(msg);
        await manejarMensajeEntrante({
          numeroTelefono,
          texto,
          imagen,
          responder,
          enviarDatosBancarios,
          notificarStaff,
        });
      })().catch((e) => {
        // Sin este .catch, cualquier error acá (ej. un hipo de Postgres justo
        // durante "reset", que corre antes del try/catch de manejarMensaje)
        // era una promesa rechazada sin nadie que la atrape — Node mata el
        // proceso completo por eso desde la v15, tumbando el bot para TODOS
        // los clientes por un error de UN solo mensaje.
        console.error("[WhatsApp] Error no manejado procesando un mensaje:", e);
      });
    }
  });
}
