# VisionPharma Officine — image du serveur (spec §2, doc 06 §5) : multi-étapes, utilisateur non root,
# système de fichiers en lecture seule sauf le volume de données (voir docker-compose.yml).
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY web/package.json web/package-lock.json web/
RUN npm --prefix web ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production VP_DATA_DIR=/data VP_WEB_DIST=/app/web/dist VP_HOST=0.0.0.0 VP_PORT=8443
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/web/dist ./web/dist
COPY --from=build /app/data ./data
RUN mkdir -p /data && chown node:node /data && chmod 0700 /data
USER node
VOLUME ["/data"]
EXPOSE 8443
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('https://127.0.0.1:8443/api/v1/health',{}).then(()=>process.exit(0),e=>process.exit(e?.cause?.code==='ECONNREFUSED'?1:0))"
CMD ["node", "dist/server/src/main.js"]
