// Script de una sola ejecución (no forma parte de la app en producción).
// 1. Genera/guarda un retailerId estable para cada Producto sin uno.
// 2. Copia las fotos ya emparejadas manualmente a frontend/public/catalogo/.
// 3. Exporta un CSV en el formato de carga masiva de Meta Commerce Manager.
//
// Uso: npx tsx scripts/exportar-catalogo.ts
import "dotenv/config";
import { copyFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const CARPETA_FOTOS = "C:\\Users\\kevin\\Downloads\\platosurban";
const CARPETA_DESTINO = path.join(process.cwd(), "frontend", "public", "catalogo");
// Reemplazar por el dominio real de Vercel antes de subir el CSV a Meta.
const DOMINIO_FRONTEND = process.env.DOMINIO_CATALOGO || "https://REEMPLAZAR-DOMINIO.vercel.app";

// nombre exacto del Producto en la BD -> archivo de foto en CARPETA_FOTOS
const FOTOS: Record<string, string> = {
  "Ají de Gallina": "AjiGallina.jpg",
  "Arroz Chaufa Marino": "ArrozChaufaMarino.jpg",
  "Arroz Chaufa de Pollo": "ArrozChaufaPollo.jpeg",
  "Arroz con Mariscos": "ArrozMariscos.jpg",
  "Ceviche de Atún": "CevicheAtun.jpg",
  "Ceviche de Pulpo": "CevichePulpo.jpeg",
  "Ceviche de Reineta": "CevicheReineta.jpg",
  "Ceviche de Salmón": "CevicheSalmon.jpg",
  "Chicharrón de Pescado": "ChicharronPescado.jpg",
  "Combinación Perfecta": "CombPerfecta.jpeg",
  "Ensalada Urban": "EnsaladaUrban.jpeg",
  "Espaguetis Saltados de Pollo": "EspagethisSaltados_pollo.jpeg",
  "Espaguetis Saltados Especial": "EspaghetisaltadoEspecial.jpeg",
  "Fetuccine a la Huancaína con Filete a la Plancha": "Fetuchini a la huancaina con filete.jpg",
  "Fetuccine al Pesto con Milanesa": "FetuchiniAlPestoMilanesa.jpg",
  "Fetuccine a la Huancaína con Pollo Saltado": "FetuchiniAlahuancaina_Pollosalta.jpeg",
  "Fetuccine a la Huancaína con Lomo Saltado": "FetuchiniHuancLomoSalt.jpg",
  "Fetuccine al Pesto con Filete": "FetuchinipestoFilete.jpg",
  "Filete a lo Pobre": "FileteAloPobre.jpg",
  "Filete a la Pimienta": "Filete_Pimienta.jpeg",
  "Lomo Saltado con Camarones": "LomoSaltCamarones.jpg",
  "Lomo Saltado": "LomoSaltado.jpeg",
  "Pechuga en Salsa de Champiñones": "PechuaSalsaChamp.jpg",
  "Plato Urban": "PlatoUrban.jpg",
  "Pollo Crunch con Papas Fritas": "PolloCruchn.jpeg",
  "Pollo Saltado": "PolloSaltado.jpeg",
  "Reineta en Salsa de Camarones": "ReinetaSalsaCamaron.jpg",
  "Risotto a la Huancaína con Lomo Saltado": "RisotoHuancLomoSalta.jpeg",
  "Risotto al Pesto con Filete de Salmón": "RisotopestoCon salmon.jpeg",
  "Salchipollo": "Salchipollo.jpeg",
  "Espaguetis Saltados de Carne": "SpagehitSaltadoCarne.jpeg",
  "Spaghetis al Pesto con Lomo Saltado": "SpagethiPesto_lomosaltado.jpg",
  "Lomo Saltado a lo Pobre": "lomoSaltado_Alopobre.jpg",
  "Mostrito": "mostrito.jpg",
  // "Arroz Chaufa a lo Pobre" queda sin foto a propósito — el archivo que
  // había con ese nombre era un duplicado de Filete a lo Pobre (mismo hash).
};

function slug(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function csvEscape(v: string): string {
  return `"${v.replace(/"/g, '""')}"`;
}

async function main() {
  const { Producto, Categoria, sequelize } = await import("../src/config/db.js");
  await sequelize.authenticate();
  await new Promise((r) => setTimeout(r, 3000)); // esperar el sync automático de db.ts

  const productos = await Producto.findAll({ include: [{ model: Categoria }], order: [["orden", "ASC"]] });

  mkdirSync(CARPETA_DESTINO, { recursive: true });

  const filas: string[] = [];
  filas.push(["id", "title", "description", "availability", "condition", "price", "link", "image_link", "brand"].map(csvEscape).join(","));

  const sinFoto: string[] = [];
  const sinArchivo: string[] = [];

  for (const p of productos) {
    let retailerId = p.retailerId;
    if (!retailerId) {
      retailerId = slug(p.nombre);
      p.retailerId = retailerId;
      await p.save();
    }

    // Ojo: el alias real que genera Sequelize para esta relación es
    // "Categorium", no "Categoria" (pluraliza mal la palabra en español).
    const categoriaNombre: string = (p as any).Categorium?.nombre ?? "";
    const descripcion = `${p.nombre} — parte de ${categoriaNombre.replace(/^[^\wÁÉÍÓÚáéíóúñÑ]+/, "").trim()}. Preparado al momento en Urban Perú.`;

    const archivoFoto = FOTOS[p.nombre];
    let imageLink = "";
    if (!archivoFoto) {
      sinFoto.push(p.nombre);
    } else {
      const origen = path.join(CARPETA_FOTOS, archivoFoto);
      if (!existsSync(origen)) {
        sinArchivo.push(`${p.nombre} -> ${archivoFoto} (no existe en ${CARPETA_FOTOS})`);
      } else {
        const ext = path.extname(archivoFoto).toLowerCase();
        const destino = path.join(CARPETA_DESTINO, `${retailerId}${ext}`);
        copyFileSync(origen, destino);
        imageLink = `${DOMINIO_FRONTEND}/catalogo/${retailerId}${ext}`;
      }
    }

    filas.push(
      [
        retailerId,
        p.nombre,
        descripcion,
        p.disponible ? "in stock" : "out of stock",
        "new",
        `${p.precio} CLP`,
        process.env.DIRECCION_LOCAL || "https://urbanperu.cl",
        imageLink,
        "Urban Perú",
      ]
        .map((v) => csvEscape(String(v)))
        .join(",")
    );
  }

  const csvPath = path.join(process.cwd(), "catalogo-urbanperu.csv");
  writeFileSync(csvPath, filas.join("\n") + "\n", "utf8");

  console.log(`CSV generado: ${csvPath} (${productos.length} productos)`);
  console.log(`Fotos copiadas a: ${CARPETA_DESTINO}`);
  if (sinFoto.length) console.log("Sin foto asignada (fila queda con image_link vacío):", sinFoto);
  if (sinArchivo.length) console.log("Advertencia, archivo no encontrado:", sinArchivo);

  await sequelize.close();
  process.exit(0);
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
