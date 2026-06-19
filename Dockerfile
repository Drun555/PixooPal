FROM node:22-alpine AS deps

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

FROM deps AS build

COPY . .
RUN npm run build

FROM deps AS prod-deps

RUN npm prune --omit=dev --ignore-scripts && npm cache clean --force

FROM node:22-alpine AS runtime

WORKDIR /app

ARG BUILD_VERSION=0.0.1

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    HTTP_PORT=5173 \
    HTTPS_PORT=443 \
    RESOLUTION=64 \
    DEBUG_LOGGING=false \
    BODY_SIZE_LIMIT=25M

LABEL io.hass.version="${BUILD_VERSION}" \
      io.hass.type="app" \
      io.hass.arch="amd64|aarch64"

RUN apk add --no-cache ffmpeg gcompat

COPY package*.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/scripts ./scripts
COPY package.json ./package.json
COPY app-divoom-gz.com-privateKey.key ./app-divoom-gz.com-privateKey.key
COPY app-divoom-gz.com.crt ./app-divoom-gz.com.crt

RUN mkdir -p /data && chown -R node:node /data /app

EXPOSE 5173 443 1883
VOLUME ["/data"]

CMD ["node", "scripts/docker-entrypoint.mjs"]
