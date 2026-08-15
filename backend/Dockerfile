# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# build
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Prisma's schema engine (what `migrate deploy` runs) links against libssl.
RUN apk add --no-cache openssl

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# The schema's generator writes the client to ./generated/prisma, outside the
# prisma directory, so it has to be generated before the TypeScript build —
# src/core/prisma/prisma.service.ts imports from there.
RUN npx prisma generate && npm run build

# ---------------------------------------------------------------------------
# runtime
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache openssl

ENV NODE_ENV=production
# npx writes here; the app runs as an unprivileged user with no home it owns
ENV NPM_CONFIG_CACHE=/tmp/.npm

# node_modules is copied whole rather than pruned to production dependencies:
# the container's own start command is `prisma migrate deploy && node ...`, so
# the Prisma CLI — a devDependency — has to be present at runtime, along with
# the TypeScript loader it needs to read prisma.config.ts. Pruning breaks the
# migration on boot, which is the one thing that must work unattended.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/generated ./generated
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json /app/prisma.config.ts ./

USER node
EXPOSE 3000

# GET /api/health is deliberately unauthenticated (health.controller.ts), which
# is what makes it usable as a probe. wget is busybox's, always present here.
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=5 \
  CMD wget -q -O- "http://127.0.0.1:${PORT:-3000}/api/health" || exit 1

# start:prod is `prisma migrate deploy && node dist/src/main.js` — migrations
# are applied by the container on every start, so a deploy never needs a
# separate migration step.
CMD ["npm", "run", "start:prod"]
