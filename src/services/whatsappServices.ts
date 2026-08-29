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

//Memoria temporal.
const estadosUsuarios: Record<string, string> = {};

interface CarritoItem {
  nombre: string;
  precio: number;
}
const carritos: Record<string, CarritoItem[]> = {};
//Nota de alergias/instrucciones especiales pendiente de confirmar (ver estado
//PIDIENDO_NOTA / CONFIRMANDO_PEDIDO).
const notasPendientes: Record<string, string> = {};
//Método de pago elegido (ver estado PIDIENDO_METODO_PAGO) y comprobante de
//transferencia recibido (ver estado ESPERANDO_COMPROBANTE), ambos pendientes
//hasta la confirmación final.
const metodosPagoPendientes: Record<string, "efectivo" | "transferencia"> = {};
const comprobantesPendientes: Record<string, string> = {};
//Modalidad de entrega (ver estado PIDIENDO_MODALIDAD), dirección de despacho (solo
//si delivery, ver PIDIENDO_DIRECCION) y monto con el que paga en efectivo (para
//calcular el vuelto, ver PIDIENDO_MONTO_EFECTIVO), todos pendientes hasta la
//confirmación final.
const modalidadesPendientes: Record<string, "delivery" | "retiro"> = {};
const direccionesPendientes: Record<string, string> = {};
const montosRecibidosPendientes: Record<string, number> = {};

//Import de las tablas
import { Cliente, Pedido, Producto, DetallePedido, ConfiguracionBot, CONFIGURACION_BOT_ID } from "../config/db.js";

//Dirección del local, mostrada automáticamente a quien elige "retiro". Si no está
//configurada, se avisa igual sin romper el flujo.
const DIRECCION_LOCAL = process.env.DIRECCION_LOCAL || "contáctanos para coordinar el retiro (dirección aún no configurada)";

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
let configuracionBot: { activo: boolean; mensajePausa: string } = {
  activo: true,
  mensajePausa: "En este momento no estamos tomando pedidos por este medio. Por favor intenta más tarde o comunícate directamente con el local.",
};

export async function cargarConfiguracionBot(): Promise<void> {
  try {
    const [fila] = await ConfiguracionBot.findOrCreate({
      where: { id: CONFIGURACION_BOT_ID },
      defaults: { id: CONFIGURACION_BOT_ID },
    });
    configuracionBot = { activo: fila.activo, mensajePausa: fila.mensajePausa };
  } catch (e) {
    console.warn("No se pudo cargar la configuración del bot, se usa el valor por defecto (activo):", e);
  }
}

export function actualizarConfiguracionBotCache(cambios: { activo?: boolean; mensajePausa?: string }): void {
  configuracionBot = { ...configuracionBot, ...cambios };
}

//Catálogo único: fuente de verdad para el menú mostrado y para la validación de pedidos.
const catalogo: Record<string, CarritoItem> = {
  "11": { nombre: "Lomo Saltado", precio: 8990 },
  "12": { nombre: "Ají de Gallina", precio: 7490 },
  "13": { nombre: "Ceviche de Pescado", precio: 9990 },
  "14": { nombre: "Papas a la Huancaína", precio: 4990 },
};

const emojiDigito: Record<string, string> = {
  "0": "0️⃣", "1": "1️⃣", "2": "2️⃣", "3": "3️⃣", "4": "4️⃣",
  "5": "5️⃣", "6": "6️⃣", "7": "7️⃣", "8": "8️⃣", "9": "9️⃣",
};

function generarMenuTexto(): string {
  const lineas = Object.entries(catalogo).map(([codigo, item]) => {
    const numeroEmoji = codigo.split("").map((d) => emojiDigito[d]).join("");
    return `${numeroEmoji} ${item.nombre} - $${item.precio.toLocaleString("es-CL")}`;
  });
  return `*--- MENÚ URBANPERÚ 🇵🇪 ---*\n\n${lineas.join("\n")}\n\n👉 *Escribe el número del plato que deseas agregar a tu pedido (ej: 11).*`;
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

//Cuenta pedidos activos (pendiente/preparando) creados en la última hora, para
//estimar la demora de cocina. Un pedido olvidado por el staff más allá de 60 min
//deja de inflar la demora de los demás (sin tocar su estado real).
async function calcularTiempoEstimado(): Promise<{ min: number; max: number }> {
  const haceUnaHora = new Date(Date.now() - 60 * 60 * 1000);
  const nAnteriores = await Pedido.count({
    where: { estado: { [Op.in]: ["pendiente", "preparando"] }, createdAt: { [Op.gte]: haceUnaHora } },
  });
  const n = nAnteriores + 1; // incluye el pedido que se está creando ahora
  return { min: Math.min(15 * n, 60), max: Math.min(20 * n, 60) };
}

//Logger silencioso: Baileys es muy verboso por defecto (loguea cada paquete de protocolo).
const logger = pino({ level: "error" });

//Procesa un mensaje entrante. Recibe un helper `responder` en vez de msg.reply()
//(que no existe en Baileys) para mantener el resto de la lógica casi intacta.
async function manejarMensaje(
  numeroTelefono: string,
  textoCliente: string,
  responder: (texto: string) => Promise<unknown>,
  enviarDatosBancarios: () => Promise<void>
): Promise<void> {
  if (textoCliente.toLowerCase() === "reset") {
    await Cliente.destroy({ where: { telefono: numeroTelefono } });
    delete estadosUsuarios[numeroTelefono];
    await responder("Tu usuario a sido eliminado.");
    return;
  }

  //Cliente atendido por una persona: el bot se queda callado para no interrumpir
  //la conversación manual hasta que alguien del equipo lo devuelva al bot desde
  //el dashboard.
  if (estadosUsuarios[numeroTelefono] === "HABLANDO_CON_HUMANO") {
    return;
  }

  //Si llegó texto en vez de una imagen mientras se esperaba el comprobante (la
  //imagen en sí se maneja antes de esta función, en messages.upsert, porque
  //necesita el socket para descargarla).
  if (estadosUsuarios[numeroTelefono] === "ESPERANDO_COMPROBANTE") {
    await responder("Por favor envía la *imagen* del comprobante de transferencia (foto o captura de pantalla).");
    return;
  }

  try {
    // 1. ¿ESTAMOS ESPERANDO EL NOMBRE?
    if (estadosUsuarios[numeroTelefono] === "ESPERANDO_NOMBRE") {
      const soloLetras = /^[A-Za-zÁÉÍÓÚáéíóúÑñ]+$/;

      if (!soloLetras.test(textoCliente)) {
        await responder("❌ Formato inválido. Por favor, ingresa *solamente tu primer nombre* (sin espacios, ni números).");
        return;
      }

      await Cliente.update(
        { nombre: textoCliente },
        { where: { telefono: numeroTelefono } }
      );

      delete estadosUsuarios[numeroTelefono];
      await responder(`¡Perfecto, ${textoCliente}! Ya guardé tus datos. 🍔 ¿Qué te gustaría pedir hoy?\n\n1️⃣ Ver Menú\n2️⃣ Hablar con un humano`);
      return;
    }

    // 2. BUSCAR/CREAR AL CLIENTE EN LA BD
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

    // 2b. ¿ESTAMOS ESPERANDO LA MODALIDAD DE ENTREGA?
    // Va justo después de "pagar" y antes del método de pago (ver ADR en el handoff).
    if (estadosUsuarios[numeroTelefono] === "PIDIENDO_MODALIDAD") {
      if (textoCliente === "1") {
        modalidadesPendientes[numeroTelefono] = "delivery";
        estadosUsuarios[numeroTelefono] = "PIDIENDO_METODO_PAGO";
        await responder(
          "💳 ¿Cómo vas a pagar?\n\n1️⃣ Efectivo\n2️⃣ Transferencia\n\n📦 Recuerda: el envío se paga solo por transferencia bancaria (la comida la puedes pagar en efectivo)."
        );
        return;
      }
      if (textoCliente === "2") {
        modalidadesPendientes[numeroTelefono] = "retiro";
        estadosUsuarios[numeroTelefono] = "PIDIENDO_METODO_PAGO";
        await responder(`📍 Retiras en nuestro local: ${DIRECCION_LOCAL}\n\n💳 ¿Cómo vas a pagar?\n\n1️⃣ Efectivo\n2️⃣ Transferencia`);
        return;
      }
      await responder("Por favor responde *1* para Delivery o *2* para Retiro en el local.");
      return;
    }

    // 3a0. ¿ESTAMOS ESPERANDO EL MÉTODO DE PAGO?
    if (estadosUsuarios[numeroTelefono] === "PIDIENDO_METODO_PAGO") {
      if (textoCliente === "1") {
        metodosPagoPendientes[numeroTelefono] = "efectivo";
        estadosUsuarios[numeroTelefono] = "PIDIENDO_MONTO_EFECTIVO";
        await responder("💵 ¿Con qué billete vas a pagar, para llevarte el vuelto justo? (escribe solo el monto, ej: 10000)");
        return;
      }
      if (textoCliente === "2") {
        metodosPagoPendientes[numeroTelefono] = "transferencia";
        estadosUsuarios[numeroTelefono] = "ESPERANDO_COMPROBANTE";
        await enviarDatosBancarios();
        await responder("📸 Envía la *imagen* de tu comprobante de transferencia (foto o captura de pantalla).");
        return;
      }
      await responder("Por favor responde *1* para Efectivo o *2* para Transferencia.");
      return;
    }

    // 3a-bis. ¿ESTAMOS ESPERANDO EL MONTO CON QUE PAGA EN EFECTIVO?
    if (estadosUsuarios[numeroTelefono] === "PIDIENDO_MONTO_EFECTIVO") {
      const monto = Number(textoCliente.replace(/[^\d]/g, ""));
      if (!monto) {
        await responder("Por favor escribe solo el monto en números, ej: 10000.");
        return;
      }
      const { total } = formatResumenCarrito(carritos[numeroTelefono] ?? [], "");
      if (monto < total) {
        await responder(`Ese monto no alcanza a cubrir el total ($${total.toLocaleString("es-CL")}). Escribe un monto igual o mayor.`);
        return;
      }
      montosRecibidosPendientes[numeroTelefono] = monto;

      if (modalidadesPendientes[numeroTelefono] === "delivery") {
        estadosUsuarios[numeroTelefono] = "PIDIENDO_DIRECCION";
        await responder("📍 Pásame tu dirección de entrega (calle, número, comuna).");
      } else {
        estadosUsuarios[numeroTelefono] = "PIDIENDO_NOTA";
        await responder("📝 ¿Alguna alergia o instrucción especial para tu pedido? (ej: alérgico a los mariscos, sin cebolla, para llevar, etc.)\n\nEscribe tu nota, o *no* si no tienes ninguna.");
      }
      return;
    }

    // 3a-ter. ¿ESTAMOS ESPERANDO LA DIRECCIÓN DE DESPACHO? (solo delivery)
    if (estadosUsuarios[numeroTelefono] === "PIDIENDO_DIRECCION") {
      direccionesPendientes[numeroTelefono] = textoCliente;
      estadosUsuarios[numeroTelefono] = "PIDIENDO_NOTA";
      await responder("📝 ¿Alguna alergia o instrucción especial para tu pedido? (ej: alérgico a los mariscos, sin cebolla, para llevar, etc.)\n\nEscribe tu nota, o *no* si no tienes ninguna.");
      return;
    }

    // 3a. ¿ESTAMOS ESPERANDO LA NOTA DE ALERGIAS/INSTRUCCIONES ESPECIALES?
    if (estadosUsuarios[numeroTelefono] === "PIDIENDO_NOTA") {
      const nota = textoCliente.toLowerCase() === "no" ? "" : textoCliente;
      notasPendientes[numeroTelefono] = nota;
      estadosUsuarios[numeroTelefono] = "CONFIRMANDO_PEDIDO";

      const miCarrito = carritos[numeroTelefono] ?? [];
      const { texto } = formatResumenCarrito(miCarrito, nota, {
        metodoPago: metodosPagoPendientes[numeroTelefono],
        modalidad: modalidadesPendientes[numeroTelefono],
        direccion: direccionesPendientes[numeroTelefono],
        montoRecibido: montosRecibidosPendientes[numeroTelefono],
      });
      await responder(`*🧾 REVISA TU PEDIDO ANTES DE ENVIARLO:*\n\n${texto}\n\n¿Confirmas? Responde *SI* para mandarlo a cocina o *NO* para seguir editando.`);
      return;
    }

    // 3b. ¿ESTAMOS ESPERANDO LA CONFIRMACIÓN FINAL?
    // Existe para evitar pedidos "fantasma": nada se guarda en la cocina hasta
    // que el cliente confirma explícitamente con SI.
    if (estadosUsuarios[numeroTelefono] === "CONFIRMANDO_PEDIDO") {
      const respuesta = textoCliente.toLowerCase();

      if (respuesta === "no") {
        estadosUsuarios[numeroTelefono] = "REALIZANDO_PEDIDO";
        delete metodosPagoPendientes[numeroTelefono];
        delete comprobantesPendientes[numeroTelefono];
        delete modalidadesPendientes[numeroTelefono];
        delete direccionesPendientes[numeroTelefono];
        delete montosRecibidosPendientes[numeroTelefono];
        await responder("Sin problema, sigue agregando platos o escribe *pagar* cuando estés listo.");
        return;
      }

      if (respuesta !== "si" && respuesta !== "sí") {
        await responder("Por favor responde *SI* para confirmar tu pedido o *NO* para seguir editando.");
        return;
      }

      const miCarrito = carritos[numeroTelefono];
      if (!miCarrito || miCarrito.length === 0) {
        estadosUsuarios[numeroTelefono] = "REALIZANDO_PEDIDO";
        await responder("Tu carrito quedó vacío, escribe un código válido (ej: 11) para agregar algo.");
        return;
      }

      const nota = notasPendientes[numeroTelefono] ?? "";
      const metodoPago = metodosPagoPendientes[numeroTelefono];
      const comprobanteImagen = comprobantesPendientes[numeroTelefono] ?? null;
      const modalidad = modalidadesPendientes[numeroTelefono] ?? null;
      const direccion = direccionesPendientes[numeroTelefono] ?? null;
      const montoRecibido = montosRecibidosPendientes[numeroTelefono] ?? null;
      const { texto: resumenItems, total } = formatResumenCarrito(miCarrito, nota, {
        metodoPago,
        modalidad: modalidad ?? undefined,
        direccion: direccion ?? undefined,
        montoRecibido: montoRecibido ?? undefined,
      });
      const tiempoEstimado = await calcularTiempoEstimado();
      const resumen = `*🧾 RESUMEN DE TU PEDIDO:*\n\n${resumenItems}\n⏱️ Tiempo estimado: ${tiempoEstimado.min}-${tiempoEstimado.max} min\n\n¡Tu pedido ha sido confirmado! 🧑‍🍳 En breve te contactaremos para coordinar el pago y la entrega.`;

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
          tiempoEstimadoMin: tiempoEstimado.min,
          tiempoEstimadoMax: tiempoEstimado.max,
        });
        pedidoId = nuevoPedido.id;

        for (const item of miCarrito) {
          const [productoDb] = await Producto.findOrCreate({
            where: { nombre: item.nombre },
            defaults: { nombre: item.nombre, precio: item.precio },
          });
          await DetallePedido.create({
            pedido_id: nuevoPedido.id,
            producto_id: productoDb.id,
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
          tiempoEstimadoMin: tiempoEstimado.min,
          tiempoEstimadoMax: tiempoEstimado.max,
          fecha: new Date().toISOString(),
        };

        io.emit("nuevo_pedido", pedidoPayload);

        console.log(`[Socket.IO] Evento 'nuevo_pedido' emitido para ${numeroTelefono} total $${total.toLocaleString("es-CL")}`);
      } catch (socketErr) {
        // No romper el flujo del pedido si Socket.IO aún no está listo
        // En producción podrías persistir en DB y hacer polling fallback
        const message = socketErr instanceof Error ? socketErr.message : String(socketErr);
        console.warn("[Socket.IO] No se pudo emitir nuevo_pedido:", message);
      }
      // ===============================================================

      // Limpieza de memoria
      delete estadosUsuarios[numeroTelefono];
      delete carritos[numeroTelefono];
      delete notasPendientes[numeroTelefono];
      delete metodosPagoPendientes[numeroTelefono];
      delete comprobantesPendientes[numeroTelefono];
      delete modalidadesPendientes[numeroTelefono];
      delete direccionesPendientes[numeroTelefono];
      delete montosRecibidosPendientes[numeroTelefono];

      await responder(resumen);
      return;
    }

    // 3. LÓGICA DEL SALUDO
    if (textoCliente.toLowerCase() === "hola") {
      if (fueCreado || !cliente.nombre || cliente.nombre.trim() === "Por definir") {
        estadosUsuarios[numeroTelefono] = "ESPERANDO_NOMBRE";
        await responder("¡Hola! Soy el asistente virtual de UrbanPerú 🇵🇪. Veo que es tu primera vez pidiendo con nosotros. ¿Me podrías decir tu nombre para registrarte?");
      } else {
        await responder(`¡Hola de nuevo, ${cliente.nombre}! 🇵🇪 ¿Qué vas a servirte hoy?\n\n1️⃣ Ver Menú\n2️⃣ Hablar con un humano`);
      }
      return;
    }

    // 4. ENRUTADOR PRINCIPAL (OPCIÓN 1 y 2)
    // Solo respondemos al 1 y 2 si NO están dentro de un pedido
    if (textoCliente === "1" && estadosUsuarios[numeroTelefono] !== "REALIZANDO_PEDIDO") {
      estadosUsuarios[numeroTelefono] = "REALIZANDO_PEDIDO";
      await responder(generarMenuTexto());
      return;
    }

    if (textoCliente === "2" && estadosUsuarios[numeroTelefono] !== "REALIZANDO_PEDIDO") {
      estadosUsuarios[numeroTelefono] = "HABLANDO_CON_HUMANO";
      delete carritos[numeroTelefono];

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

    // 5. LÓGICA DEL CARRITO (SOLO si el estado es REALIZANDO_PEDIDO)
    if (estadosUsuarios[numeroTelefono] === "REALIZANDO_PEDIDO") {
      // a) Si el cliente quiere pagar: pasa a pedir nota + confirmación antes de
      // crear nada en firme (ver estados PIDIENDO_METODO_PAGO / PIDIENDO_NOTA /
      // CONFIRMANDO_PEDIDO arriba).
      if (textoCliente.toLowerCase() === "pagar") {
        const miCarrito = carritos[numeroTelefono];

        if (!miCarrito || miCarrito.length === 0) {
          await responder("Tu carrito está vacío. Por favor escribe un código válido (ej: 11).");
          return;
        }

        estadosUsuarios[numeroTelefono] = "PIDIENDO_MODALIDAD";
        await responder("🛵 ¿Tu pedido es para *delivery* o *retiro* en el local?\n\n1️⃣ Delivery\n2️⃣ Retiro en el local");
        return;
      }

      // b) Si el cliente ingresa un plato
      const productoElegido = catalogo[textoCliente];

      if (productoElegido) {
        if (!carritos[numeroTelefono]) {
          carritos[numeroTelefono] = [];
        }
        carritos[numeroTelefono].push(productoElegido);
        await responder(`✅ *${productoElegido.nombre}* agregado a tu pedido.\n\n👉 Escribe otro código si quieres pedir algo más, o escribe *pagar* para enviar tu pedido a la cocina.`);
      } else {
        await responder("❌ Código no reconocido. Por favor, escribe un número válido del menú (ej: 11) o escribe *pagar* para terminar.");
      }
    }
  } catch (error) {
    console.error("Error al intentar interactuar con la db", error);
  }
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
  delete estadosUsuarios[numeroTelefono];
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
    await rm(".baileys_auth", { recursive: true, force: true }).catch(() => {});
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
    await rm(".baileys_auth", { recursive: true, force: true }).catch(() => {});
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

  sock.ev.on("messages.upsert", ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      void (async () => {
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

        //Pausa de emergencia (ver botón del dashboard / ConfiguracionBot): si está
        //pausado, no se procesa nada más, ni siquiera "reset" o un comprobante en curso.
        if (!configuracionBot.activo) {
          await responder(configuracionBot.mensajePausa);
          return;
        }

        //Manda la imagen con los datos bancarios (cuenta RUT + logo Mercado Pago) al
        //elegir transferencia. Se define acá porque necesita `sock`/`jid`, que
        //manejarMensaje no tiene.
        const enviarDatosBancarios = async () => {
          if (!datosBancariosBuffer) return;
          await sock.sendMessage(jid, { image: datosBancariosBuffer, caption: "🏦 Estos son nuestros datos para la transferencia." });
        };

        //Comprobante de transferencia: es una imagen, no pasa por el filtro de solo-texto
        //de abajo. Se maneja acá (no en manejarMensaje) porque necesita `sock` para
        //descargar el archivo.
        const imagen = msg.message?.imageMessage;
        if (estadosUsuarios[numeroTelefono] === "ESPERANDO_COMPROBANTE" && imagen) {
          try {
            const buffer = await downloadMediaMessage(msg, "buffer", {}, { logger, reuploadRequest: sock.updateMediaMessage });
            const mime = imagen.mimetype || "image/jpeg";
            comprobantesPendientes[numeroTelefono] = `data:${mime};base64,${buffer.toString("base64")}`;
            if (modalidadesPendientes[numeroTelefono] === "delivery") {
              estadosUsuarios[numeroTelefono] = "PIDIENDO_DIRECCION";
              await responder("✅ Comprobante recibido.\n\n📍 Pásame tu dirección de entrega (calle, número, comuna).");
            } else {
              estadosUsuarios[numeroTelefono] = "PIDIENDO_NOTA";
              await responder("✅ Comprobante recibido.\n\n📝 ¿Alguna alergia o instrucción especial para tu pedido? (ej: alérgico a los mariscos, sin cebolla, para llevar, etc.)\n\nEscribe tu nota, o *no* si no tienes ninguna.");
            }
          } catch (e) {
            console.error("Error descargando comprobante de transferencia:", e);
            await responder("❌ No pude leer esa imagen, ¿puedes volver a enviarla?");
          }
          return;
        }

        const texto = extraerTexto(msg);
        //Si el mensaje no tiene texto, lo ignora de inmediato (elimina la basura de
        //sincronización multimedia: imágenes, stickers, etc.) — salvo que estuviera
        //esperando el comprobante, donde vale la pena avisarle que mande la imagen.
        if (!texto || texto.trim() === "") {
          if (estadosUsuarios[numeroTelefono] === "ESPERANDO_COMPROBANTE") {
            await responder("Por favor envía la *imagen* del comprobante de transferencia (foto o captura de pantalla).");
          }
          return;
        }

        const textoCliente = texto.trim();
        await manejarMensaje(numeroTelefono, textoCliente, responder, enviarDatosBancarios);
      })();
    }
  });
}
