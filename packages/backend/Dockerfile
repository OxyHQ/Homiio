##
## Dockerfile for the Homiio Backend API + listing worker (@homiio/backend)
##
## Production image for the Express + Mongoose API and the listing-ingestion
## worker. Built for AWS Graviton (linux/arm64) but also runs on linux/amd64.
## The build context MUST be the monorepo root so the workspace packages
## (shared-types + listing-providers + backend) resolve:
##
##   API build (default):
##     docker build -f packages/backend/Dockerfile --target api -t homiio-api .
##   Worker build:
##     docker build -f packages/backend/Dockerfile --target worker -t homiio-worker .
##   API:    docker run --env-file packages/backend/.env -p 4000:4000 homiio-api
##   Worker: docker run --env-file packages/backend/.env \
##             homiio-worker node packages/backend/dist/worker.js
##
## Both targets contain the same compiled commit and migration ledger. Only the
## worker target contains Playwright, Chromium and X11; the API never scrapes
## and therefore must not carry or patch those bytes.
##
## HEADED browser tier (LISTING_BROWSER_HEADED=true): DataDome/Kasada block
## headless Chromium, so the worker can launch a real HEADED browser to clear
## them. A headed launch needs an X display; this image bundles Xvfb (the
## virtual framebuffer) for that. When the flag is on, the worker command MUST
## wrap node in xvfb-run:
##
##   xvfb-run -a --server-args="-screen 0 1920x1080x24" \
##     node packages/backend/dist/worker.js
##
## The flag defaults OFF (headless) and is set by infra alongside the xvfb-run
## command — the image supports both modes; nothing here forces headed.
##
## Listens on $PORT (default 4000). See packages/backend/.env.example for the
## full list of runtime environment variables.
##

# ── Build stage ───────────────────────────────────────────────────
# Kept in step with `BUN_VERSION` in .github/workflows/ci.yml by
# .github/scripts/check-version-pins.sh, which fails CI if the two drift.
ARG BUN_VERSION=1.3.14

FROM node:22-bookworm-slim AS builder
ARG BUN_VERSION

# Toolchain for any node-gyp fallback (sharp ships arm64 glibc prebuilds, but
# keep the compiler available so a source build never fails the image).
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# whatsapp-web.js depends on puppeteer; never download Chromium into the image
# for that path — Playwright Chromium is installed explicitly in the runtime
# stage for the listing worker only.
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Pinned, and pinned to the SAME version as CI and deploy-frontends.
#
# The usual argument for pinning bun — one lockfile read by two versions — does
# NOT apply here: this stage narrows `workspaces` and deliberately never copies
# bun.lock. That makes the pin MORE load-bearing, not less. With no lockfile,
# the bun version is the only thing deciding how the version ranges below
# resolve, so an unpinned `npm install -g bun` means the image built today and
# the image built next month can install different dependency graphs from an
# identical commit.
RUN npm install -g bun@${BUN_VERSION}

WORKDIR /app

# Copy the workspace root and narrow `workspaces` to just the packages the
# API/worker need (shared-types + listing-providers + backend). This excludes
# the heavy Expo frontend.
# Narrowing the workspace set invalidates bun.lock, so it is NOT copied — bun
# resolves fresh from the package.json version ranges (still deterministic).
# The root `postinstall` (build:shared-types) is stripped: source is not present
# yet at install time, and shared-types is built explicitly below.
COPY package.json ./
RUN node -e "const p=require('./package.json'); p.workspaces=['packages/shared-types','packages/listing-providers','packages/backend']; p.dependencies={}; delete p.scripts.postinstall; require('fs').writeFileSync('package.json', JSON.stringify(p, null, 2));"

# bunfig.toml pins `linker = "hoisted"`. This is REQUIRED: with bun's default
# isolated linker, @types/express-serve-static-core lands at a deeply-nested
# `.bun/` path that tsc deems non-portable, breaking the composite declaration
# emit (TS2883: "inferred type of 'router' cannot be named ..."). The hoisted
# layout matches the monorepo's flat node_modules and lets tsc emit cleanly.
COPY bunfig.toml ./

# Copy package manifests first for a cacheable dependency install layer.
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/listing-providers/package.json packages/listing-providers/
COPY packages/backend/package.json packages/backend/

# Install all dependencies (incl. dev: tsc/typescript) for the workspace subset.
RUN bun install

# Copy the source for all workspace packages.
COPY packages/shared-types/ packages/shared-types/
COPY packages/listing-providers/ packages/listing-providers/
COPY packages/backend/ packages/backend/

# Build in dependency order: shared-types → listing-providers → backend.
RUN bun run --filter @homiio/shared-types build
RUN bun run --filter @homiio/listing-providers build
RUN bun run --filter @homiio/backend build

# The backend reads i18n locale JSON at runtime from `<dist>/../locales`
# (path.join(__dirname,'..','locales') in services/telegramService.ts). tsc does
# not copy non-imported assets, so stage them next to the compiled output.
RUN cp -r packages/backend/locales packages/backend/dist/locales

# ── Production dependency stages ─────────────────────────────────
# Bun and the native build toolchain live only in throwaway install stages.
# The compiled runtime and migration tasks use Node, so shipping Bun added
# hundreds of MiB without providing a supported production entry point.
FROM node:22-bookworm-slim AS production-manifests
ARG BUN_VERSION

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g bun@${BUN_VERSION}

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

WORKDIR /app

COPY package.json ./
RUN node -e "const p=require('./package.json'); p.workspaces=['packages/shared-types','packages/listing-providers','packages/backend']; p.dependencies={}; delete p.scripts.postinstall; require('fs').writeFileSync('package.json', JSON.stringify(p, null, 2));"
COPY bunfig.toml ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/listing-providers/package.json packages/listing-providers/
COPY packages/backend/package.json packages/backend/

FROM production-manifests AS api-deps
RUN bun install --production --omit peer \
    && rm -rf node_modules/@img/sharp-linuxmusl-* \
              node_modules/@img/sharp-libvips-linuxmusl-*

FROM production-manifests AS worker-deps
# Editing the manifest before the single production install avoids `bun add`,
# which first installed every devDependency and left them in node_modules.
RUN node -e "const fs=require('fs'); const file='packages/backend/package.json'; const p=require('./'+file); p.dependencies={...p.dependencies,playwright:'1.61.1'}; fs.writeFileSync(file, JSON.stringify(p, null, 2));" \
    && bun install --production --omit peer \
    && rm -rf node_modules/@img/sharp-linuxmusl-* \
              node_modules/@img/sharp-libvips-linuxmusl-*

# ── Common runtime ────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime-common

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    LOG_FILE=/tmp/homiio-app.log

WORKDIR /app

COPY --from=builder /app/packages/shared-types/dist packages/shared-types/dist
COPY --from=builder /app/packages/listing-providers/dist packages/listing-providers/dist
COPY --from=builder /app/packages/backend/dist packages/backend/dist

# Both task definitions may run migrations. Keep the same ledger in both image
# targets so pre/post phases always use bytes built from the deployed commit.
COPY --from=builder /app/packages/backend/drizzle packages/backend/drizzle

EXPOSE 4000
ENTRYPOINT ["/usr/bin/tini", "--"]

# ── Listing worker target ─────────────────────────────────────────
FROM runtime-common AS worker

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY --from=worker-deps /app/package.json ./
COPY --from=worker-deps /app/packages packages/
COPY --from=worker-deps /app/node_modules node_modules/

# Chromium and its X11 libraries exist only in the worker image. xauth is
# needed by the documented headed `xvfb-run` mode.
USER root
RUN apt-get update && apt-get install -y --no-install-recommends xauth \
    && rm -rf /var/lib/apt/lists/* \
    && ./node_modules/.bin/playwright install --with-deps chromium \
    && chmod -R a+rX /ms-playwright \
    && node -e "require('playwright'); require('sharp')" \
    && test ! -e /usr/local/bin/bun
# Debian's xvfb-run can wait forever for SIGUSR1 in a container even after Xvfb
# has created a live display socket. Use the bounded, socket-gated wrapper and
# stage the shared directory before privileges drop.
COPY packages/backend/scripts/xvfb-run-ready.sh /usr/local/bin/xvfb-run
RUN chmod 755 /usr/local/bin/xvfb-run \
    && mkdir -p /tmp/.X11-unix \
    && chmod 1777 /tmp/.X11-unix
USER node
CMD ["node", "packages/backend/dist/worker.js"]

# ── API target (default/final stage) ──────────────────────────────
FROM runtime-common AS api

COPY --from=api-deps /app/package.json ./
COPY --from=api-deps /app/packages packages/
COPY --from=api-deps /app/node_modules node_modules/

RUN node -e "require('sharp'); require('@homiio/shared-types'); require('@homiio/listing-providers')" \
    && test ! -d node_modules/playwright \
    && test ! -d /ms-playwright \
    && test ! -e /usr/local/bin/bun \
    && test ! -e /usr/bin/Xvfb

USER node
CMD ["node", "packages/backend/dist/server.js"]
