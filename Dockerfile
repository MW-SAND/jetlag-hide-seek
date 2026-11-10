# syntax=docker/dockerfile:1.7
#
# Multi-arch image for the Jet Lag Hide & Seek map generator.
# The build stage runs on the CI runner's native platform (fast, no QEMU) and
# only produces platform-independent JS; the runtime stage is a plain
# node:alpine image for the target platform (arm64 on the Jetson).

ARG NODE_IMAGE=node:24-alpine@sha256:a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8

FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS build
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY packages/geo/package.json packages/geo/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
COPY . .
ARG APP_VERSION=dev
RUN APP_VERSION=${APP_VERSION} pnpm build

FROM ${NODE_IMAGE} AS runtime
ARG APP_VERSION=dev
LABEL org.opencontainers.image.title="jetlag-hide-seek" \
      org.opencontainers.image.description="Jet Lag: Hide and Seek map generator with self-hosted multiplayer" \
      org.opencontainers.image.source="https://github.com/MW-SAND/jetlag-hide-seek" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${APP_VERSION}"
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    STATIC_DIR=/app/public
WORKDIR /app
COPY --from=build /src/apps/server/dist/server.mjs ./server.mjs
COPY --from=build /src/apps/web/dist ./public
# /data must exist and belong to uid 1000 so fresh named volumes inherit that
# ownership (bind mounts on the homeserver are chown'ed during setup).
RUN mkdir -p /data && chown node:node /data
# The official image's "node" user is uid/gid 1000 (= "jetson" on the host),
# so files written to the bind mount are owned by the normal user, never root.
USER node
EXPOSE 8080
VOLUME ["/data"]
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "--max-old-space-size=64", "server.mjs"]
