# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# build
#
# Quasar inlines import.meta.env.VITE_* at build time, reading frontend/.env
# itself. That makes this image ENVIRONMENT-SPECIFIC: the Keycloak URL and
# realm are baked into the JavaScript, so changing available_hostnames means
# rebuilding this image, not restarting the container. .dockerignore therefore
# deliberately does NOT exclude .env.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
# --ignore-scripts because this project's own postinstall is `quasar prepare`,
# which reads quasar.config.ts and src/ — neither of which exists at this layer.
# Keeping the dependency install in its own layer is worth the extra step: it
# stays cached across source changes.
RUN npm ci --ignore-scripts

COPY . .
# npm rebuild runs the DEPENDENCIES' install scripts that were just skipped;
# postinstall then runs quasar prepare, now that it has a project to look at.
RUN npm rebuild && npm run postinstall && npm run build

# ---------------------------------------------------------------------------
# runtime — static files only; the edge nginx terminates TLS and proxies here
# ---------------------------------------------------------------------------
FROM nginx:1.29.5-alpine AS runtime

COPY --from=build /app/dist/spa /usr/share/nginx/html
COPY docker-nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O- http://127.0.0.1/ >/dev/null || exit 1
