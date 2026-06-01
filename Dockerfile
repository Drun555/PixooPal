FROM node:22-alpine AS deps

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

FROM deps AS build

COPY . .
RUN npm run build

FROM node:22-alpine AS runtime

WORKDIR /app

ARG BUILD_VERSION=0.0.1

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=5173 \
    PIXOOPAL_DATA_DIR=/data

LABEL io.hass.version="${BUILD_VERSION}" \
      io.hass.type="app" \
      io.hass.arch="amd64|aarch64"

RUN apk add --no-cache ffmpeg gcompat

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/build ./build
COPY scripts ./scripts
COPY package.json ./package.json

RUN mkdir -p /data && chown -R node:node /data /app

EXPOSE 5173
VOLUME ["/data"]

CMD ["node", "scripts/docker-entrypoint.mjs"]
