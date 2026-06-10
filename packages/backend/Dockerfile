##
## Dockerfile for the Homiio Backend API (@homiio/backend)
##
## Production image for the Express + Mongoose API. Built for AWS Graviton
## (linux/arm64) but also runs on linux/amd64. The build context MUST be the
## monorepo root so the workspace packages (shared-types + backend) resolve:
##
##   Build:  docker build -f packages/backend/Dockerfile -t homiio-backend .
##   Run:    docker run --env-file packages/backend/.env -p 4000:4000 homiio-backend
##
## Listens on $PORT (default 4000). See packages/backend/.env.example for the
## full list of runtime environment variables.
##

# ── Build stage ───────────────────────────────────────────────────
FROM node:20-alpine AS builder

# Toolchain for any node-gyp fallback (sharp ships arm64 musl prebuilds, but
# keep the compiler available so a source build never fails the image).
RUN apk add --no-cache python3 make g++

# whatsapp-web.js depends on puppeteer; never download Chromium into the image.
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

RUN npm install -g bun

WORKDIR /app

# Copy the workspace root and narrow `workspaces` to just the two packages the
# API needs (shared-types + backend). This excludes the heavy Expo frontend.
# Narrowing the workspace set invalidates bun.lock, so it is NOT copied — bun
# resolves fresh from the package.json version ranges (still deterministic).
# The root `postinstall` (build:shared-types) is stripped: source is not present
# yet at install time, and shared-types is built explicitly below.
COPY package.json ./
RUN node -e "const p=require('./package.json'); p.workspaces=['packages/shared-types','packages/backend']; delete p.scripts.postinstall; require('fs').writeFileSync('package.json', JSON.stringify(p, null, 2));"

# bunfig.toml pins `linker = "hoisted"`. This is REQUIRED: with bun's default
# isolated linker, @types/express-serve-static-core lands at a deeply-nested
# `.bun/` path that tsc deems non-portable, breaking the composite declaration
# emit (TS2883: "inferred type of 'router' cannot be named ..."). The hoisted
# layout matches the monorepo's flat node_modules and lets tsc emit cleanly.
COPY bunfig.toml ./

# Copy package manifests first for a cacheable dependency install layer.
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/backend/package.json packages/backend/

# Install all dependencies (incl. dev: tsc/typescript) for the workspace subset.
RUN bun install

# Copy the source for both workspace packages.
COPY packages/shared-types/ packages/shared-types/
COPY packages/backend/ packages/backend/

# Build shared-types first (backend imports @homiio/shared-types), then the
# backend. Both compile with tsc to their respective dist/ folders.
RUN bun run --filter @homiio/shared-types build
RUN bun run --filter @homiio/backend build

# The backend reads i18n locale JSON at runtime from `<dist>/../locales`
# (path.join(__dirname,'..','locales') in services/telegramService.ts). tsc does
# not copy non-imported assets, so stage them next to the compiled output.
RUN cp -r packages/backend/locales packages/backend/dist/locales

# ── Production stage ──────────────────────────────────────────────
FROM node:20-alpine

# Runtime deps: libc++/libstdc++ for sharp's prebuilt musl binary; tini as a
# proper PID 1 for clean signal handling and zombie reaping.
RUN apk add --no-cache libstdc++ tini

ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

RUN npm install -g bun

WORKDIR /app

# Re-create the narrowed workspace so `bun install --production` resolves the
# same dependency subset (without dev tooling like tsc/eslint).
COPY package.json ./
RUN node -e "const p=require('./package.json'); p.workspaces=['packages/shared-types','packages/backend']; delete p.scripts.postinstall; require('fs').writeFileSync('package.json', JSON.stringify(p, null, 2));"
# Same hoisted linker as the build stage for consistent runtime resolution.
COPY bunfig.toml ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/backend/package.json packages/backend/

RUN bun install --production

# Copy the compiled JavaScript (incl. staged locales) from the build stage.
COPY --from=builder /app/packages/shared-types/dist packages/shared-types/dist
COPY --from=builder /app/packages/backend/dist packages/backend/dist

# Drop privileges — node:alpine ships a `node` user (uid 1000).
USER node

# Express listens on $PORT (default 4000, see config.ts).
EXPOSE 4000

# tini handles SIGTERM/SIGINT and reaps children (Telegram/WhatsApp workers).
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "packages/backend/dist/server.js"]
