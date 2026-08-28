import { Client, LocalAuth, Message } from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import QRCode from "qrcode";

//Memoria temporal.
const estadosUsuarios: Record<string, string> = {};

interface CarritoItem {
  nombre: string;
  precio: number;
}
const carritos: Record<string, CarritoItem[]> = {};

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

//Inicio del cliente
//Localauth es vital para guardar la sesión en una carpeta oculta.
//Esto para no escanear el qr cuando se reinicia el bot.
//Flags de Puppeteer requeridos para correr Chromium dentro de un contenedor Docker
//(sin sandbox de kernel disponible) como en Render. PUPPETEER_EXECUTABLE_PATH apunta
//al Chromium instalado vía apt en la imagen Docker (ver Dockerfile) en vez del que
//Puppeteer intenta descargar en npm install.
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  },
});

//Cuando el bot necesite vinculo arrojara el qr en consola.
//El log en vivo de Render distorsiona el QR ASCII (fuente no monoespaciada), así que
//además lo mandamos como imagen por el socket ya autenticado con JWT para que el
//dashboard lo muestre y se pueda escanear desde el celular sin pasar por Render.
client.on("qr", (qr) => {
  qrcode.generate(qr, { small: true });
  console.log("Escanea este código QR en el wsp del negocio (o desde el dashboard)");

  QRCode.toDataURL(qr)
    .then(async (dataUrl) => {
      const { getIO } = await import("../config/socket.js");
      try {
        getIO().emit("whatsapp_qr", { qr: dataUrl });
      } catch (e) {
        console.warn("[Socket.IO] No se pudo emitir whatsapp_qr:", e instanceof Error ? e.message : e);
      }
    })
    .catch((e) => console.error("Error generando QR como imagen:", e));
});

//Evento de éxito
client.on("ready", async () => {
  console.log("Cliente de wsp conecta y listo para recibir pedidos.");
  const { getIO } = await import("../config/socket.js");
  try {
    getIO().emit("whatsapp_ready");
  } catch (e) {
    console.warn("[Socket.IO] No se pudo emitir whatsapp_ready:", e instanceof Error ? e.message : e);
  }
});

//el bot escucha todo lo que llega
client.on("message", async (msg: Message) => {
  console.log(`[DEBUG CRUDO] De: ${msg.from} | Texto: "${msg.body}"| EsMio:"${msg.fromMe}"`);
  //Si el mensaje no tiene texto , lo ignora de inmediato
  //Esto elimina la basura de sincronización multimedia.
  if (!msg.body || msg.body.trim() === "") return;
  //Esto ignora mensajes de grupos, estados o sistema. Solo acepta chats privados.
  if (msg.from.endsWith("@g.us") || msg.from === "status@broadcast") return;
  //Ignorar si el mensaje viene de mi mismo.
  if (msg.fromMe) return;

  //Limpieza de el numero , quitara el "@c.us"
  const numeroTelefono = msg.from.split("@")[0];
  const textoCliente = msg.body.trim();

  if (textoCliente.toLowerCase() === "reset") {
    await Cliente.destroy({ where: { telefono: numeroTelefono } });
    delete estadosUsuarios[numeroTelefono];
    return msg.reply("Tu usuario a sido eliminado.");
  }

  try {
    // 1. ¿ESTAMOS ESPERANDO EL NOMBRE?
    if (estadosUsuarios[numeroTelefono] === "ESPERANDO_NOMBRE") {
      const soloLetras = /^[A-Za-zÁÉÍÓÚáéíóúÑñ]+$/;

      if (!soloLetras.test(textoCliente)) {
        return msg.reply("❌ Formato inválido. Por favor, ingresa *solamente tu primer nombre* (sin espacios, ni números).");
      }

      await Cliente.update(
        { nombre: textoCliente },
        { where: { telefono: numeroTelefono } }
      );

      delete estadosUsuarios[numeroTelefono];
      return msg.reply(`¡Perfecto, ${textoCliente}! Ya guardé tus datos. 🍔 ¿Qué te gustaría pedir hoy?\n\n1️⃣ Ver Menú\n2️⃣ Hablar con un humano`);
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

    // 3. LÓGICA DEL SALUDO
    if (textoCliente.toLowerCase() === "hola") {
      if (fueCreado || !cliente.nombre || cliente.nombre.trim() === "Por definir") {
        estadosUsuarios[numeroTelefono] = "ESPERANDO_NOMBRE";
        return msg.reply("¡Hola! Soy el asistente virtual de UrbanPerú 🇵🇪. Veo que es tu primera vez pidiendo con nosotros. ¿Me podrías decir tu nombre para registrarte?");
      } else {
        return msg.reply(`¡Hola de nuevo, ${cliente.nombre}! 🇵🇪 ¿Qué vas a servirte hoy?\n\n1️⃣ Ver Menú\n2️⃣ Hablar con un humano`);
      }
    }

    // 4. ENRUTADOR PRINCIPAL (OPCIÓN 1 y 2)
    // Solo respondemos al 1 y 2 si NO están dentro de un pedido
    if (textoCliente === "1" && estadosUsuarios[numeroTelefono] !== "REALIZANDO_PEDIDO") {
      estadosUsuarios[numeroTelefono] = "REALIZANDO_PEDIDO";
      return msg.reply(generarMenuTexto());
    }

    if (textoCliente === "2" && estadosUsuarios[numeroTelefono] !== "REALIZANDO_PEDIDO") {
      delete estadosUsuarios[numeroTelefono];
      return msg.reply("👨‍🍳 ¡Entendido! Un miembro de nuestro equipo leerá tu mensaje y te atenderá en unos minutos. ¡Gracias por tu paciencia!");
    }

    // 5. LÓGICA DEL CARRITO (SOLO si el estado es REALIZANDO_PEDIDO)
    if (estadosUsuarios[numeroTelefono] === "REALIZANDO_PEDIDO") {
      // a) Si el cliente quiere pagar
      if (textoCliente.toLowerCase() === "pagar") {
        const miCarrito = carritos[numeroTelefono];

        if (!miCarrito || miCarrito.length === 0) {
          return msg.reply("Tu carrito está vacío. Por favor escribe un código válido (ej: 11).");
        }

        // Cálculo total y boleta
        let total = 0;
        let resumen = "*🧾 RESUMEN DE TU PEDIDO:*\n\n";

        // El bucle SOLO suma e imprime los platos
        miCarrito.forEach((item) => {
          resumen += `- ${item.nombre} ($${item.precio.toLocaleString("es-CL")})\n`;
          total += item.precio;
        });

        // El total y la despedida van FUERA del bucle
        resumen += `\n*Total a pagar: $${total.toLocaleString("es-CL")}*\n\n`;
        resumen += `¡Tu pedido ha sido confirmado! 🧑‍🍳 En breve te contactaremos para coordinar el pago y la entrega.`;

        // ============ PERSISTENCIA EN BD ============
        // Guarda el pedido y sus detalles para que sobreviva a un reinicio del bot
        // y quede disponible aunque ningún dashboard esté conectado al emitirse.
        let pedidoId: string = `pedido_${Date.now()}`;
        try {
          const nuevoPedido = await Pedido.create({
            cliente_id: cliente.id,
            estado: "pendiente",
            total,
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
              whatsapp: msg.from,
            },
            items: [...miCarrito],
            total,
            resumen,
            fecha: new Date().toISOString(),
          };

          // Opción A: broadcast global a todos los dashboards autenticados
          io.emit("nuevo_pedido", pedidoPayload);

          // Opción B: solo a la room dashboard (si prefieres segmentar)
          // io.to("dashboard").emit("nuevo_pedido", pedidoPayload);

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

        return msg.reply(resumen);
      }

      // b) Si el cliente ingresa un plato
      const productoElegido = catalogo[textoCliente];

      if (productoElegido) {
        if (!carritos[numeroTelefono]) {
          carritos[numeroTelefono] = [];
        }
        carritos[numeroTelefono].push(productoElegido);
        return msg.reply(`✅ *${productoElegido.nombre}* agregado a tu pedido.\n\n👉 Escribe otro código si quieres pedir algo más, o escribe *pagar* para enviar tu pedido a la cocina.`);
      } else {
        return msg.reply("❌ Código no reconocido. Por favor, escribe un número válido del menú (ej: 11) o escribe *pagar* para terminar.");
      }
    }

    return;
  } catch (error) {
    console.error("Error al intentar interactuar con la db", error);
    return;
  }
});

export default client;
