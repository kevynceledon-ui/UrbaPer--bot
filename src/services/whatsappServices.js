const {Client, LocalAuth, AuthStrategy} = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");

//Memoria temporal.
const estadosUsuarios = {};
const carritos = {};

//Import de la tabla Cliente
const { Cliente } = require("../config/db.js");
const { text } = require("express");

//Inicio del cliente
//Localauth es vital para guardar la sesión en una carpeta oculta.
//Esto para no escanear el qr cuando se reinicia el bot.
const client = new Client({
    authStrategy: new LocalAuth(),
});

//Cuando el bot necesite vinculo arrojara el qr en consola.
client.addListener("qr", (qr) =>{
    qrcode.generate(qr,{small:true});
    console.log("Escanea este código QR en el wsp del negocio");
});

//Evento de éxito   
client.addListener("ready", ()=>{
    console.log("Cliente de wsp conecta y listo para recibir pedidos.");
});

//el bot escucha todo lo que llega
client.addListener ("message", async (msg) =>{
console.log(`[DEBUG CRUDO] De: ${msg.from} | Texto: "${msg.body}"| EsMio:"${msg.fromMe}"`);
//Si el mensaje no tiene texto , lo ignora de inmediato
//Esto elimina la basura de sincronización multimedia.
    if (!msg.body || msg.body.trim() === "") return;
//Esto ignora mensajes de grupos, estados o sistema. Solo acepta chats privados.
    if(msg.from.endsWith("@g.us") || msg.from === "status@broadcast") return;
//Ignorar si el mensaje viene de mi mismo.
    if (msg.fromMe) return;

  //Limpieza de el numero , quitara el "@c.us"
    const numeroTelefono = msg.from.split("@")[0];
    const textoCliente = msg.body.trim();


    if (textoCliente.toLowerCase() === "reset"){
        await Cliente.destroy({where:{telefono: numeroTelefono}});
        delete estadosUsuarios[numeroTelefono];
        return msg.reply("Tu usuario a sido eliminado.")
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
            defaults: { nombre: "Por definir" } 
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
            const menuComida = `*--- MENÚ URBANPERÚ 🇵🇪 ---*\n\n` +
                               `1️⃣1️⃣ Lomo Saltado - $8.000\n` +
                               `1️⃣2️⃣ Ají de Gallina - $7.500\n` +
                               `1️⃣3️⃣ Ceviche de Pescado - $9.000\n` +
                               `1️⃣4️⃣ Papas a la Huancaína - $4.500\n\n` +
                               `👉 *Escribe el número del plato que deseas agregar a tu pedido (ej: 11).*`;
            return msg.reply(menuComida);
        }

        if (textoCliente === "2" && estadosUsuarios[numeroTelefono] !== "REALIZANDO_PEDIDO") {
            delete estadosUsuarios[numeroTelefono];
            return msg.reply("👨‍🍳 ¡Entendido! Un miembro de nuestro equipo leerá tu mensaje y te atenderá en unos minutos. ¡Gracias por tu paciencia!");
        }

        // 5. LÓGICA DEL CARRITO (SOLO si el estado es REALIZANDO_PEDIDO)
        if (estadosUsuarios[numeroTelefono] === "REALIZANDO_PEDIDO") {
            const catalogo = {
                "11": { nombre: "Lomo Saltado", precio: 8000 },
                "12": { nombre: "Ají de Gallina", precio: 7500 },
                "13": { nombre: "Ceviche de Pescado", precio: 9000 },
                "14": { nombre: "Papas a la Huancaína", precio: 4500 }    
            };

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
                miCarrito.forEach(item => {
                    resumen += `- ${item.nombre} ($${item.precio})\n`;
                    total += item.precio;
                });

                // El total y la despedida van FUERA del bucle
                resumen += `\n*Total a pagar: $${total}*\n\n`;
                resumen += `¡Tu pedido ha sido confirmado! 🧑‍🍳 En breve te contactaremos para coordinar el pago y la entrega.`;

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

    } catch (error) {
        console.error("Error al intentar interactuar con la db", error);
    }
});


module.exports = client;