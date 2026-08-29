import { Op } from "sequelize";
import { HorarioAtencion, Pedido } from "../config/db.js";

//Devuelve un Date cuyos campos "locales" (getDay/getHours/getMinutes, en la zona
//horaria del proceso) representan en realidad la hora de Chile, sin importar en
//qué zona horaria corre el servidor (Render corre en UTC). Truco estándar:
//renderizar la fecha como texto en la zona de Chile y volver a parsearla.
function ahoraEnChile(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/Santiago" }));
}

function diaSemanaChile(): number {
  return ahoraEnChile().getDay();
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function horaMinChile(): string {
  const ahora = ahoraEnChile();
  return `${pad2(ahora.getHours())}:${pad2(ahora.getMinutes())}`;
}

//Convierte "HH:MM" de HOY (hora de Chile) a un instante real (UTC). Se apoya en
//la diferencia entre el reloj "falseado" de ahoraEnChile() y el reloj real en
//el mismo instante, y aplica esa misma diferencia al resultado — válido dentro
//del mismo día (no cruza un cambio de huso horario a mitad de cálculo).
function horaChileAFecha(horaMin: string): Date {
  const chileFalseado = ahoraEnChile();
  const offsetMs = chileFalseado.getTime() - Date.now();
  const [h, m] = horaMin.split(":").map(Number);
  const objetivoFalseado = new Date(chileFalseado);
  objetivoFalseado.setHours(h, m, 0, 0);
  return new Date(objetivoFalseado.getTime() - offsetMs);
}

function sumarMinutos(horaMin: string, minutos: number): string {
  const [h, m] = horaMin.split(":").map(Number);
  const total = h * 60 + m + minutos;
  return `${pad2(Math.floor(total / 60) % 24)}:${pad2(total % 60)}`;
}

//¿Hay algún turno de HorarioAtencion vigente ahora mismo (hora de Chile)?
async function estaAbierto(): Promise<boolean> {
  const diaSemana = diaSemanaChile();
  const horaActual = horaMinChile();
  const turnos = await HorarioAtencion.findAll({ where: { diaSemana } });
  return turnos.some((t) => horaActual >= t.horaInicio && horaActual < t.horaFin);
}

//Franjas de "duracionFranjaMin" minutos, dentro de los turnos de HOY, que todavía
//no empezaron y no llegaron a "capacidadPorFranja" pedidos programados. Solo se
//agenda para el resto del día de hoy — nunca para mañana (ver ADR-002).
async function calcularFranjasDisponibles(
  duracionFranjaMin: number,
  capacidadPorFranja: number
): Promise<{ inicio: string; fin: string }[]> {
  const diaSemana = diaSemanaChile();
  const horaActual = horaMinChile();
  const turnos = await HorarioAtencion.findAll({ where: { diaSemana }, order: [["horaInicio", "ASC"]] });

  const candidatas: { inicio: string; fin: string }[] = [];
  for (const turno of turnos) {
    let cursor = turno.horaInicio;
    while (true) {
      const fin = sumarMinutos(cursor, duracionFranjaMin);
      if (fin > turno.horaFin) break;
      if (cursor > horaActual) candidatas.push({ inicio: cursor, fin });
      cursor = fin;
    }
  }

  const disponibles: { inicio: string; fin: string }[] = [];
  for (const franja of candidatas) {
    const inicioFecha = horaChileAFecha(franja.inicio);
    const finFecha = horaChileAFecha(franja.fin);
    const ocupados = await Pedido.count({
      where: {
        horaProgramada: { [Op.gte]: inicioFecha, [Op.lt]: finFecha },
        estado: { [Op.ne]: "cancelado" },
      },
    });
    if (ocupados < capacidadPorFranja) disponibles.push(franja);
  }
  return disponibles;
}

//Formatea un instante real como "HH:MM" en hora de Chile (para mostrarle al
//cliente la hora que quedó guardada en horaProgramada).
function formatHoraChile(fecha: Date): string {
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: "America/Santiago",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(fecha);
}

export { estaAbierto, calcularFranjasDisponibles, horaChileAFecha, diaSemanaChile, horaMinChile, formatHoraChile };
