require ("dotenv").config();
const express  = require("express");
const {sequelize} = require("./config/db.js");

const app = express();
const PORT = process.env.PORT || 3000;

//middlewares
app.use(express.json());

//Rutas
//ruta de prueba.
app.get("/ping", (req, res) =>{
    res.json({mensaje: "El bot está funcionando"});
});


//Aquí rutas de Whattsapp
const whatsappClient = require('./services/whatsappServices');

//Inicio del servidor
app.listen(PORT, async() =>{
    console.log(`Servidor corriendo en http://localhost:${PORT} `);
    whatsappClient.initialize();

try{
    await sequelize.authenticate();
    console.log("Conexión con PG establecida correctamente.");
}catch(error){
    console.error("No se pudo conectar  la DB");
}
});