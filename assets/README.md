# assets/

Archivos estáticos que el bot manda por WhatsApp.

- `datos-transferencia.jpg` (no incluido en el repo por defecto): imagen con la
  cuenta RUT y el logo de Mercado Pago para transferencias. Se manda
  automáticamente al cliente cuando elige pagar por transferencia. Si el
  archivo no existe, el bot sigue funcionando pero no manda esa imagen (solo
  pide el comprobante por texto) — ver `src/services/whatsappServices.ts`.
