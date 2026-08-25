const {Client, LocalAuth, AuthStrategy} = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");

//Inicio del cliente
//Localauth es vital para guardar la sesión en una carpeta oculta.
//Esto para no escanear el qr cuando se reinicia el bot.
const client = new Client(({
    AuthStrategy: new LocalAuth(),
}));

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
    console.log(`Mensaje recibido de ${msg.from}: ${msg.body}`);


    //Una prueba basica de respuesta
    if(msg.body.toLowerCase() === "hola"){
        msg.reply("¡Hola! Soy el boy de UrbanPerú. Te atenderemos en un momento.")
    }
});

module.exports = client;