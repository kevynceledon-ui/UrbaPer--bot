FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY assets ./assets

# node:22-slim corre como root por defecto — sin esto, un RCE en cualquier
# dependencia (o en el propio código) corre con privilegios de root dentro
# del contenedor. La imagen ya trae un usuario "node" sin privilegios listo
# para usar. OJO: Baileys escribe su sesión en ".baileys_auth" relativo al
# cwd (/app, ver useMultiFileAuthState en whatsappServices.ts) — como /app
# quedó con dueño root de los COPY de arriba, sin este chown el usuario
# "node" no podría crear esa carpeta al reconectar y el bot real (que hoy
# sigue corriendo por Baileys) se rompería en el próximo deploy.
RUN chown -R node:node /app
USER node

EXPOSE 3000
CMD ["node", "dist/index.js"]
