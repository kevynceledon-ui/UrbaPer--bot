const { Sequelize, DataTypes } = require("sequelize");
require("dotenv").config();

//Conexión db
const sequelize = new Sequelize(process.env.DB_URL, {
    logging: false,
});

//Definición de modelos
const Cliente = sequelize.define("Cliente", {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    telefono: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
    },
    nombre: {
        type: DataTypes.STRING,
        allowNull: false,
    },
});

const Producto = sequelize.define("Producto", {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    nombre: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    precio: {
        type: DataTypes.INTEGER,
        allowNull: false,
    },
    disponible: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
    },
});

const Pedido = sequelize.define("Pedido", {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    estado: {
        type: DataTypes.ENUM("comprando", "pendiente", "preparando", "listo", "entregado", "cancelado"),
        defaultValue: "comprando",
    },
    total: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
    },
});

const DetallePedido = sequelize.define("DetallePedido", {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    cantidad: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
    },
    precio_unitario: {
        type: DataTypes.INTEGER,
        allowNull: false,
    },
});

//Relaciones
//Cliente a muchos pedidos
Cliente.hasMany(Pedido, { foreignKey: "cliente_id" });
Pedido.belongsTo(Cliente, { foreignKey: "cliente_id" });

//un pedido tiene muchos detalles
Pedido.hasMany(DetallePedido, { foreignKey: "pedido_id" });
DetallePedido.belongsTo(Pedido, { foreignKey: "pedido_id" });

//un detalle pertenece a un producto
Producto.hasMany(DetallePedido, { foreignKey: "producto_id" });
DetallePedido.belongsTo(Producto, { foreignKey: "producto_id" });

//Sincronización y exportación
(async () => {
    try {
        await sequelize.sync({ alter: true });
        console.log("Base de datos creada con éxito");
    } catch (err) {
        console.error("Error al sincronizar:", err);
    }
})();

module.exports = {
    sequelize,
    Cliente,
    Producto,
    Pedido,
    DetallePedido,
};