FROM node:24-bookworm-slim AS build
WORKDIR /app
ARG APP_ORIGIN=https://booqlet.com
ENV IFC_BOQ_SKIP_ENGINE_SETUP=1 NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_AUTH_ADAPTER=native NEXT_PUBLIC_APP_URL=${APP_ORIGIN}
COPY . .
RUN npm ci && npm run build:app

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/apps/app/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/app/.next/static ./apps/app/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/app/server.js"]
