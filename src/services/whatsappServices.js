const {Client, LocalAuth, AuthStrategy} = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");

//Memoria temporal.
const estadosUsuarios = {};

//Import de la tabla Cliente
const { Cliente } = require("../config/db.js")

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

    try{
    //Estamos esperando el nombre de este cliente ?
    if(estadosUsuarios[numeroTelefono] === "ESPERANDO_NOMBRE") {
        //se actualiza el nombre  en sql
        await Cliente.update(
            {nombre: textoCliente },
            {where: {telefono: numeroTelefono}}
        
        );
        
        //Borramos el estado para que no quede atrapado en este paso.
        delete estadosUsuarios[numeroTelefono];

        return msg.reply(`¡Perfecto, ${textoCliente}! Ya guardé tus datos. 🍔 ¿Qué te gustaría pedir hoy?\n\n1️⃣ Ver Menú\n2️⃣ Hablar con un humano`)
    }
    //Busca al cliente en psql, si no existe lo crea automaticamente.
    const [ cliente, fueCreado] = await Cliente.findOrCreate({
        where: {telefono: numeroTelefono},
        defaults: {nombre: "Por definir"} //Guardado con un nombre generico
    });

    //Impresion del resultado en clg    
    if (fueCreado){
        console.log(`Nuevo cliente registrado Telefono ${numeroTelefono}`);

    }else{
        console.log(`Cliente frecuente Telefono:${numeroTelefono}`);
    }

     if(msg.body.toLowerCase().trim() === "hola"){
        if(fueCreado || cliente.nombre === "Por definir"){
            estadosUsuarios[numeroTelefono] = "ESPERANDO_NOMBRE";
            msg.reply("¡Hola! Soy el asistente virtual de UrbanPerú 🇵🇪. Veo que es tu primera vez pidiendo con nosotros. ¿Me podrías decir tu nombre para registrarte?")
        }else{
        msg.reply(`¡Hola de nuevo, ${cliente.nombre}! 🇵🇪 ¿Qué vas a servirte hoy?\n\n1️⃣ Ver Menú\n2️⃣ Hablar con un humano`)
        }
    }
    }
    catch(error){
        console.error("Error al intentar interactuar con la db", error)
    }
});

module.exports = client;