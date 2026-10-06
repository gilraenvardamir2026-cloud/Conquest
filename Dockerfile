# Conquest Tabletop: one container serving the built client, the API and the
# room WebSocket. Build: docker build -t conquest . — Run: docker run -p 3001:3001 conquest

FROM node:22-slim AS build
WORKDIR /app
# Install first (cached until a package file changes).
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci
COPY tsconfig.base.json ./
COPY shared shared
COPY client client
COPY server server
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
ENV NODE_ENV=production \
    PORT=3001 \
    DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/package.json /app/tsconfig.base.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/shared shared
COPY --from=build /app/server server
COPY --from=build /app/client/package.json client/
COPY --from=build /app/client/dist client/dist
# Room files. Without a mounted volume they last until the container restarts,
# which is fine for single-session games (browsers restore a lost room).
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--import", "tsx", "server/src/index.ts"]
