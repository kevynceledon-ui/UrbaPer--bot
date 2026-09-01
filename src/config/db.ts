import "dotenv/config";
import {
  Sequelize,
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
  ForeignKey,
  NonAttribute,
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
  //Marca de tiempo desde que el cliente pidió hablar con una persona (null = el bot
  //lo atiende normal). Solo para que el dashboard lo muestre tras recargar la página;
  //el bot en sí se pausa vía estado en memoria (ver whatsappServices.ts), que se
  //pierde en cada reinicio del proceso igual que el resto del estado de conversación.
  declare necesitaHumanoDesde: CreationOptional<Date | null>;
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
    necesitaHumanoDesde: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
    },
  },
  { sequelize, modelName: "Cliente" }
);

//Agrupa los productos del menú (ver ELIGIENDO_CATEGORIA en whatsappServices.ts).
class Categoria extends Model<InferAttributes<Categoria>, InferCreationAttributes<Categoria>> {
  declare id: CreationOptional<string>;
  declare nombre: string;
  declare orden: CreationOptional<number>;
}

Categoria.init(
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
    orden: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
  },
  { sequelize, modelName: "Categoria" }
);

class Producto extends Model<InferAttributes<Producto>, InferCreationAttributes<Producto>> {
  declare id: CreationOptional<string>;
  declare nombre: string;
  declare precio: number;
  declare disponible: CreationOptional<boolean>;
  //Nullable: productos de pedidos históricos (antes del menú por categorías) se
  //quedan sin categoría — invisibles en el menú nuevo, pero no rompen DetallePedido.
  declare categoriaId: ForeignKey<Categoria["id"]> | null;
  //Orden dentro de su categoría en el listado del bot (no estaba en el pedido
  //original, pero hace falta para que el orden no dependa del azar de la DB).
  declare orden: CreationOptional<number>;
  //Minutos de cocina para UN plato de este producto, usado por
  //calcularTiempoPedido() en whatsappServices.ts para estimar la demora real en
  //vez de una fórmula genérica por cantidad de pedidos en cola.
  declare tiempoPreparacionMin: CreationOptional<number>;
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
    categoriaId: {
      type: DataTypes.UUID,
      allowNull: true,
      defaultValue: null,
    },
    orden: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    tiempoPreparacionMin: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 15,
    },
  },
  { sequelize, modelName: "Producto" }
);

class Pedido extends Model<InferAttributes<Pedido>, InferCreationAttributes<Pedido>> {
  declare id: CreationOptional<string>;
  declare estado: CreationOptional<EstadoPedido>;
  declare total: CreationOptional<number>;
  declare notas: CreationOptional<string | null>;
  //Pedidos anteriores a este cambio no lo tienen (por eso nullable).
  declare metodoPago: CreationOptional<"efectivo" | "transferencia" | null>;
  //Comprobante de transferencia como data URL base64. Solo para revisión visual del
  //equipo en el dashboard — no hay verificación automática de que la plata haya
  //llegado de verdad (ver plan de "método de pago + pedidos fantasma").
  declare comprobanteImagen: CreationOptional<string | null>;
  //Campos nullable: pedidos anteriores a este cambio no los tienen.
  declare modalidad: CreationOptional<"delivery" | "retiro" | null>;
  declare direccion: CreationOptional<string | null>;
  //Con qué billete pagó (para calcular el vuelto al vuelo, no se persiste el vuelto).
  declare montoRecibido: CreationOptional<number | null>;
  //Congelados al momento de crear el pedido: no se recalculan después aunque
  //cambie la cola (ver calcularTiempoEstimado en whatsappServices.ts).
  declare tiempoEstimadoMin: CreationOptional<number | null>;
  declare tiempoEstimadoMax: CreationOptional<number | null>;
  //null = pedido en tiempo real. Con valor = pedido agendado fuera de horario,
  //comprometido para esa hora exacta (ver ADR-002 / ELIGIENDO_HORA_PROGRAMADA).
  declare horaProgramada: CreationOptional<Date | null>;
  declare cliente_id: ForeignKey<Cliente["id"]>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  //Poblados solo cuando se pide con `include` (ver GET /api/pedidos).
  declare Cliente?: NonAttribute<Cliente>;
  declare DetallePedidos?: NonAttribute<DetallePedido[]>;
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
    notas: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: null,
    },
    metodoPago: {
      type: DataTypes.ENUM("efectivo", "transferencia"),
      allowNull: true,
      defaultValue: null,
    },
    comprobanteImagen: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: null,
    },
    modalidad: {
      type: DataTypes.ENUM("delivery", "retiro"),
      allowNull: true,
      defaultValue: null,
    },
    direccion: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: null,
    },
    montoRecibido: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: null,
    },
    tiempoEstimadoMin: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: null,
    },
    tiempoEstimadoMax: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: null,
    },
    horaProgramada: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
    },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, modelName: "Pedido" }
);

class DetallePedido extends Model<InferAttributes<DetallePedido>, InferCreationAttributes<DetallePedido>> {
  declare id: CreationOptional<string>;
  declare cantidad: CreationOptional<number>;
  declare precio_unitario: number;
  declare pedido_id: ForeignKey<Pedido["id"]>;
  declare producto_id: ForeignKey<Producto["id"]>;

  //Poblado solo cuando se pide con `include` (ver GET /api/pedidos).
  declare Producto?: NonAttribute<Producto>;
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

//ID fijo de la única fila de ConfiguracionBot. findOrCreate() necesita una
//condición que choque contra un constraint único de verdad para poder detectar
//una carrera entre dos llamadas concurrentes (boot del bot + GET/PATCH); con
//`where: {}` (sin columnas únicas) dos inserts concurrentes podían colarse como
//dos filas distintas, sin que Sequelize lo detectara.
const CONFIGURACION_BOT_ID = "00000000-0000-0000-0000-000000000001";

//Fila única: pausa de emergencia del bot desde el dashboard (ver botón "Pausar
//bot" y whatsappServices.ts). Sin cliente_id ni relaciones porque es config
//global, no algo por cliente/pedido.
class ConfiguracionBot extends Model<InferAttributes<ConfiguracionBot>, InferCreationAttributes<ConfiguracionBot>> {
  declare id: CreationOptional<string>;
  declare activo: CreationOptional<boolean>;
  declare mensajePausa: CreationOptional<string>;
  //Tamaño de cada franja horaria ofrecida al agendar (ver ADR-002).
  declare duracionFranjaMin: CreationOptional<number>;
  //Cuántos pedidos programados caben en la misma franja. Valor temporal (1) hasta
  //que la dueña confirme cuántos puede tener listos en paralelo.
  declare capacidadPorFranja: CreationOptional<number>;
  //Aviso adicional por WhatsApp al número de quien está de turno cuando llega un
  //pedido nuevo — parche para cuando el sonido del dashboard no es confiable
  //(celular bloqueado). No reemplaza el dashboard, solo avisa que hay algo nuevo.
  declare notificacionesWhatsappActivas: CreationOptional<boolean>;
  declare numeroNotificaciones: CreationOptional<string | null>;
  //Factores del cálculo de demora por cocina paralela (ver calcularTiempoPedido
  //en whatsappServices.ts): el plato más lento marca el mínimo, y el resto de
  //platos del mismo pedido suma solo una fracción de su tiempo (se cocinan en
  //paralelo, no uno detrás del otro). Configurables sin redeploy porque son un
  //supuesto del negocio, no una constante técnica.
  declare factorParaleloMin: CreationOptional<number>;
  declare factorParaleloMax: CreationOptional<number>;
}

ConfiguracionBot.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    activo: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    mensajePausa: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: "En este momento no estamos tomando pedidos por este medio. Por favor intenta más tarde o comunícate directamente con el local.",
    },
    //30 min: tamaño de bloque que se le MUESTRA al cliente para agendar (menos
    //opciones, sin números de dos dígitos con emoji). capacidadPorFranja sigue
    //operando sobre este mismo bloque, sin lógica aparte.
    duracionFranjaMin: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 30,
    },
    capacidadPorFranja: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    },
    notificacionesWhatsappActivas: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    numeroNotificaciones: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: null,
    },
    factorParaleloMin: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0.3,
    },
    factorParaleloMax: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0.5,
    },
  },
  { sequelize, modelName: "ConfiguracionBot" }
);

//Horario real de atención, usado para decidir si el bot puede tomar pedidos en
//tiempo real o debe ofrecer agendar (ver ADR-002 / src/utils/horario.ts). Puede
//haber más de una fila por día (turno partido); un día sin filas = cerrado.
class HorarioAtencion extends Model<InferAttributes<HorarioAtencion>, InferCreationAttributes<HorarioAtencion>> {
  declare id: CreationOptional<string>;
  //Convención Date.getDay(): 0=Domingo … 6=Sábado.
  declare diaSemana: number;
  //"HH:MM" 24h — string simple en vez de TIME de Postgres, para comparar con
  //</> directamente sin lidiar con casts de zona horaria.
  declare horaInicio: string;
  declare horaFin: string;
}

HorarioAtencion.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    diaSemana: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    horaInicio: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    horaFin: {
      type: DataTypes.STRING,
      allowNull: false,
    },
  },
  { sequelize, modelName: "HorarioAtencion" }
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

//una categoría agrupa muchos productos
Categoria.hasMany(Producto, { foreignKey: "categoriaId" });
Producto.belongsTo(Categoria, { foreignKey: "categoriaId" });

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

export {
  sequelize,
  Cliente,
  Producto,
  Pedido,
  DetallePedido,
  ConfiguracionBot,
  CONFIGURACION_BOT_ID,
  Categoria,
  HorarioAtencion,
};
