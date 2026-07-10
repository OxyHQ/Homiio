##
## Dockerfile for the Homiio Backend API + listing worker (@homiio/backend)
##
## Production image for the Express + Mongoose API and the listing-ingestion
## worker. Built for AWS Graviton (linux/arm64) but also runs on linux/amd64.
## The build context MUST be the monorepo root so the workspace packages
## (shared-types + listing-providers + backend) resolve:
##
##   Build:  docker build -f packages/backend/Dockerfile -t homiio-backend .
##   API:    docker run --env-file packages/backend/.env -p 4000:4000 homiio-backend
##   Worker: docker run --env-file packages/backend/.env \
##             homiio-backend node packages/backend/dist/worker.js
##
## Same ECR image serves both processes — ECS overrides the command for the
## worker task. Playwright Chromium is installed so LISTING_BROWSER_ENABLED
## can escalate anti-bot portals on the worker (the API never scrapes).
##
## Listens on $PORT (default 4000). See packages/backend/.env.example for the
## full list of runtime environment variables.
##

# ── Build stage ───────────────────────────────────────────────────
FROM node:20-bookworm-slim AS builder

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

RUN npm install -g bun

WORKDIR /app

# Copy the workspace root and narrow `workspaces` to just the packages the
# API/worker need (shared-types + listing-providers + backend). This excludes
# the heavy Expo frontend.
# Narrowing the workspace set invalidates bun.lock, so it is NOT copied — bun
# resolves fresh from the package.json version ranges (still deterministic).
# The root `postinstall` (build:shared-types) is stripped: source is not present
# yet at install time, and shared-types is built explicitly below.
COPY package.json ./
RUN node -e "const p=require('./package.json'); p.workspaces=['packages/shared-types','packages/listing-providers','packages/backend']; delete p.scripts.postinstall; require('fs').writeFileSync('package.json', JSON.stringify(p, null, 2));"

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

# ── Production stage ──────────────────────────────────────────────
FROM node:20-bookworm-slim

# Runtime deps: tini as PID 1; Playwright OS libs installed via
# `playwright install-deps` below (Chromium needs a full set of shared libs).
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    # Writable log path for the non-root `node` user (default ./logs is EACCES).
    LOG_FILE=/tmp/homiio-app.log \
    # Playwright browsers land under this path (owned by root, readable by node).
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN npm install -g bun

WORKDIR /app

# Re-create the narrowed workspace so `bun install --production` resolves the
# same dependency subset (without dev tooling like tsc/eslint).
COPY package.json ./
RUN node -e "const p=require('./package.json'); p.workspaces=['packages/shared-types','packages/listing-providers','packages/backend']; delete p.scripts.postinstall; require('fs').writeFileSync('package.json', JSON.stringify(p, null, 2));"
# Same hoisted linker as the build stage for consistent runtime resolution.
COPY bunfig.toml ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/listing-providers/package.json packages/listing-providers/
COPY packages/backend/package.json packages/backend/

# Playwright is an optional peer of @homiio/listing-providers. Install it as a
# production dependency of the backend workspace so the worker can escalate to
# the browser fetch tier when LISTING_BROWSER_ENABLED=true.
RUN bun add --cwd packages/backend playwright@1.61.1 \
 && bun install --production

# Install Chromium + its OS dependencies into PLAYWRIGHT_BROWSERS_PATH.
# Kept in the shared image so one ECR tag serves API + worker; the API never
# launches a browser (LISTING_* flags are worker-only). Use the local binary
# (not `bunx --cwd`, which mis-resolves the package name as a GitHub repo).
RUN cd packages/backend \
 && ./node_modules/.bin/playwright install --with-deps chromium \
 && chmod -R a+rX /ms-playwright

# Copy the compiled JavaScript (incl. staged locales) from the build stage.
COPY --from=builder /app/packages/shared-types/dist packages/shared-types/dist
COPY --from=builder /app/packages/listing-providers/dist packages/listing-providers/dist
COPY --from=builder /app/packages/backend/dist packages/backend/dist

# Drop privileges — node:bookworm-slim ships a `node` user (uid 1000).
USER node

# Express listens on $PORT (default 4000, see config.ts).
EXPOSE 4000

# tini handles SIGTERM/SIGINT and reaps children (Telegram/WhatsApp/Playwright).
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "packages/backend/dist/server.js"]
