import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  type WAMessage,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import QRCode from "qrcode";

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

//Import de las tablas
import { Cliente, Pedido, Producto, DetallePedido } from "../config/db.js";

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
function formatResumenCarrito(carrito: CarritoItem[], nota: string): { texto: string; total: number } {
  let total = 0;
  let texto = "";
  carrito.forEach((item) => {
    texto += `- ${item.nombre} ($${item.precio.toLocaleString("es-CL")})\n`;
    total += item.precio;
  });
  texto += `\n*Total: $${total.toLocaleString("es-CL")}*`;
  if (nota) {
    texto += `\n📝 Nota: ${nota}`;
  }
  return { texto, total };
}

//Logger silencioso: Baileys es muy verboso por defecto (loguea cada paquete de protocolo).
const logger = pino({ level: "error" });

//Procesa un mensaje entrante. Recibe un helper `responder` en vez de msg.reply()
//(que no existe en Baileys) para mantener el resto de la lógica casi intacta.
async function manejarMensaje(
  numeroTelefono: string,
  textoCliente: string,
  responder: (texto: string) => Promise<unknown>
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

    // 3a. ¿ESTAMOS ESPERANDO LA NOTA DE ALERGIAS/INSTRUCCIONES ESPECIALES?
    if (estadosUsuarios[numeroTelefono] === "PIDIENDO_NOTA") {
      const nota = textoCliente.toLowerCase() === "no" ? "" : textoCliente;
      notasPendientes[numeroTelefono] = nota;
      estadosUsuarios[numeroTelefono] = "CONFIRMANDO_PEDIDO";

      const miCarrito = carritos[numeroTelefono] ?? [];
      const { texto } = formatResumenCarrito(miCarrito, nota);
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
      const { texto: resumenItems, total } = formatResumenCarrito(miCarrito, nota);
      const resumen = `*🧾 RESUMEN DE TU PEDIDO:*\n\n${resumenItems}\n\n¡Tu pedido ha sido confirmado! 🧑‍🍳 En breve te contactaremos para coordinar el pago y la entrega.`;

      // ============ PERSISTENCIA EN BD ============
      // Guarda el pedido y sus detalles para que sobreviva a un reinicio del bot
      // y quede disponible aunque ningún dashboard esté conectado al emitirse.
      let pedidoId: string = `pedido_${Date.now()}`;
      try {
        const nuevoPedido = await Pedido.create({
          cliente_id: cliente.id,
          estado: "pendiente",
          total,
          notas: nota || null,
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
      // crear nada en firme (ver estados PIDIENDO_NOTA / CONFIRMANDO_PEDIDO arriba).
      if (textoCliente.toLowerCase() === "pagar") {
        const miCarrito = carritos[numeroTelefono];

        if (!miCarrito || miCarrito.length === 0) {
          await responder("Tu carrito está vacío. Por favor escribe un código válido (ej: 11).");
          return;
        }

        estadosUsuarios[numeroTelefono] = "PIDIENDO_NOTA";
        await responder("📝 ¿Alguna alergia o instrucción especial para tu pedido? (ej: alérgico a los mariscos, sin cebolla, para llevar, etc.)\n\nEscribe tu nota, o *no* si no tienes ninguna.");
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

//Evita que dos conexiones convivan a la vez usando la misma sesión (corrompe el
//estado de Signal/cifrado si se llama iniciarWhatsapp() dos veces sin que la
//anterior haya cerrado).
let socketActivo = false;

//Inicia (o reinicia) la conexión con WhatsApp. Baileys guarda las credenciales en
//".baileys_auth" para no tener que re-escanear el QR en cada reinicio del proceso
//(en el free tier de Render, sin disco persistente, igual se pierde en cada redeploy).
export async function iniciarWhatsapp(): Promise<void> {
  if (socketActivo) {
    console.warn("iniciarWhatsapp() llamado mientras ya había una conexión activa; se ignora.");
    return;
  }
  socketActivo = true;

  const { state, saveCreds } = await useMultiFileAuthState(".baileys_auth");

  const sock = makeWASocket({
    auth: state,
    logger,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    //El log en vivo de Render distorsiona el QR ASCII (fuente no monoespaciada), así que
    //lo mandamos como imagen por el socket ya autenticado con JWT para que el dashboard
    //lo muestre y se pueda escanear desde el celular sin pasar por la consola de Render.
    if (qr) {
      console.log("Nuevo QR generado, escanéalo desde el dashboard.");
      QRCode.toDataURL(qr)
        .then((dataUrl) => emitirEvento("whatsapp_qr", { qr: dataUrl }))
        .catch((e) => console.error("Error generando QR como imagen:", e));
    }

    if (connection === "open") {
      console.log("Cliente de wsp conecta y listo para recibir pedidos.");
      void emitirEvento("whatsapp_ready");
    }

    if (connection === "close") {
      socketActivo = false;

      const statusCode = lastDisconnect?.error instanceof Boom
        ? lastDisconnect.error.output?.statusCode
        : undefined;
      const cerroSesion = statusCode === DisconnectReason.loggedOut;

      console.error("Conexión de WhatsApp cerrada.", lastDisconnect?.error?.message ?? "");

      if (cerroSesion) {
        console.error("Sesión de WhatsApp cerrada desde el celular. Hay que volver a escanear el QR.");
      } else {
        console.log("Reintentando conexión de WhatsApp...");
        void iniciarWhatsapp();
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

        const texto = extraerTexto(msg);
        //Si el mensaje no tiene texto, lo ignora de inmediato (elimina la basura de
        //sincronización multimedia: imágenes, stickers, etc.).
        if (!texto || texto.trim() === "") return;

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
        const textoCliente = texto.trim();
        const responder = (t: string) => sock.sendMessage(jid, { text: t });

        await manejarMensaje(numeroTelefono, textoCliente, responder);
      })();
    }
  });
}
