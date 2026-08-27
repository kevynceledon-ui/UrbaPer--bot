import "dotenv/config";
import {
  Sequelize,
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
  ForeignKey,
} from "sequelize";

//Conexión db
if (!process.env.DB_URL) {
  console.error("Falta la variable de entorno DB_URL (connection string de Postgres).");
  process.exit(1);
}

//Proveedores gestionados (Neon, Supabase, etc.) exigen SSL; Sequelize no lo activa
//solo por tener "sslmode=require" en la URL, hay que declararlo en dialectOptions.
const sequelize = new Sequelize(process.env.DB_URL, {
  logging: false,
  dialectOptions:
    process.env.NODE_ENV === "production"
      ? { ssl: { require: true, rejectUnauthorized: false } }
      : {},
});

type EstadoPedido = "comprando" | "pendiente" | "preparando" | "listo" | "entregado" | "cancelado";

//Definición de modelos
class Cliente extends Model<InferAttributes<Cliente>, InferCreationAttributes<Cliente>> {
  declare id: CreationOptional<string>;
  declare telefono: string;
  declare nombre: string;
}

Cliente.init(
  {
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
  },
  { sequelize, modelName: "Cliente" }
);

class Producto extends Model<InferAttributes<Producto>, InferCreationAttributes<Producto>> {
  declare id: CreationOptional<string>;
  declare nombre: string;
  declare precio: number;
  declare disponible: CreationOptional<boolean>;
}

Producto.init(
  {
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
  },
  { sequelize, modelName: "Producto" }
);

class Pedido extends Model<InferAttributes<Pedido>, InferCreationAttributes<Pedido>> {
  declare id: CreationOptional<string>;
  declare estado: CreationOptional<EstadoPedido>;
  declare total: CreationOptional<number>;
  declare cliente_id: ForeignKey<Cliente["id"]>;
}

Pedido.init(
  {
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
  },
  { sequelize, modelName: "Pedido" }
);

class DetallePedido extends Model<InferAttributes<DetallePedido>, InferCreationAttributes<DetallePedido>> {
  declare id: CreationOptional<string>;
  declare cantidad: CreationOptional<number>;
  declare precio_unitario: number;
  declare pedido_id: ForeignKey<Pedido["id"]>;
  declare producto_id: ForeignKey<Producto["id"]>;
}

DetallePedido.init(
  {
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
  },
  { sequelize, modelName: "DetallePedido" }
);

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
    const isProd = process.env.NODE_ENV === "production";
    await sequelize.sync(isProd ? undefined : { alter: true });
    console.log("Base de datos creada con éxito");
  } catch (err) {
    console.error("Error al sincronizar:", err);
  }
})();

export { sequelize, Cliente, Producto, Pedido, DetallePedido };
