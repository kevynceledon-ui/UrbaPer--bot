//Cliente delgado de la Graph API de WhatsApp (WhatsApp Business Platform, Meta) —
//ver el plan de migración de Baileys a Cloud API. Reemplaza uno a uno los métodos
//de Baileys usados hoy en whatsappServices.ts (sock.sendMessage, downloadMediaMessage)
//sin cambiar el contrato que espera manejarMensajeEntrante/manejarMensaje.
//
//Requiere las variables de entorno WHATSAPP_ACCESS_TOKEN y WHATSAPP_PHONE_NUMBER_ID
//(ver Fase A del plan: se obtienen del Meta Developer App, primero con el número
//de prueba gratis antes de tocar el número real).

const GRAPH_VERSION = "v21.0";

function graphUrl(path: string): string {
  return `https://graph.facebook.com/${GRAPH_VERSION}/${path}`;
}

function accessToken(): string {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token) throw new Error("Falta WHATSAPP_ACCESS_TOKEN");
  return token;
}

function phoneNumberId(): string {
  const id = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!id) throw new Error("Falta WHATSAPP_PHONE_NUMBER_ID");
  return id;
}

async function graphFetch(path: string, init: RequestInit): Promise<any> {
  const res = await fetch(graphUrl(path), {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken()}`,
      ...(init.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Graph API ${path} → ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

//Manda un mensaje de texto libre. Solo funciona dentro de la ventana de 24h de
//conversación abierta (el cliente escribió primero) — ver notas del plan sobre
//notificarStaff, que por eso usa enviarPlantilla en vez de esto.
export async function enviarTexto(numeroTelefono: string, texto: string): Promise<unknown> {
  return graphFetch(`${phoneNumberId()}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: numeroTelefono,
      type: "text",
      text: { body: texto },
    }),
  });
}

//Sube un buffer como media (paso 1) y lo manda como mensaje de imagen (paso 2).
//Reemplaza sock.sendMessage(jid, { image: buffer, caption }).
export async function enviarImagenBuffer(
  numeroTelefono: string,
  buffer: Buffer,
  mimeType: string,
  caption?: string
): Promise<unknown> {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mimeType);
  form.append("file", new Blob([new Uint8Array(buffer)], { type: mimeType }), "imagen");

  const subida = await graphFetch(`${phoneNumberId()}/media`, {
    method: "POST",
    body: form,
  });
  const mediaId = subida?.id;
  if (!mediaId) throw new Error(`No se pudo subir la imagen a Graph API: ${JSON.stringify(subida)}`);

  return graphFetch(`${phoneNumberId()}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: numeroTelefono,
      type: "image",
      image: { id: mediaId, caption },
    }),
  });
}

//Manda un mensaje de plantilla (template) ya aprobada en Meta Business Manager —
//única forma de iniciar contacto FUERA de una ventana de 24h abierta. Usado por
//notificarStaff, ya que el staff nunca le escribe primero al bot (ver Fase B del
//plan de migración). `params` son los {{1}}, {{2}}... del cuerpo de la plantilla,
//en orden.
export async function enviarPlantilla(
  numeroTelefono: string,
  nombrePlantilla: string,
  params: string[],
  idioma = "es"
): Promise<unknown> {
  return graphFetch(`${phoneNumberId()}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: numeroTelefono,
      type: "template",
      template: {
        name: nombrePlantilla,
        language: { code: idioma },
        components: params.length
          ? [{ type: "body", parameters: params.map((texto) => ({ type: "text", text: texto })) }]
          : undefined,
      },
    }),
  });
}

//Descarga un media recibido por webhook (ej. comprobante de transferencia).
//Reemplaza downloadMediaMessage(msg, "buffer", ...) de Baileys: la Graph API
//entrega el archivo en 2 pasos (obtener la URL firmada, después descargarla).
export async function descargarMedia(mediaId: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const info = await graphFetch(mediaId, { method: "GET" });
  const url = info?.url;
  const mimeType = info?.mime_type || "image/jpeg";
  if (!url) throw new Error(`No se pudo resolver la URL del media ${mediaId}: ${JSON.stringify(info)}`);

  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken()}` } });
  if (!res.ok) throw new Error(`Descarga de media ${mediaId} → ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), mimeType };
}
