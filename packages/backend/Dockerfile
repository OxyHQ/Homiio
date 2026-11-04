##
## Dockerfile for the Homiio Backend API + listing worker (@homiio/backend)
##
## Production image for the Express + PostgreSQL API and the listing-ingestion
## worker. Built for AWS Graviton (linux/arm64) but also runs on linux/amd64.
## The build context MUST be the monorepo root so the workspace packages
## (shared-types + listing-providers + backend) resolve:
##
##   API build (default):
##     docker build -f packages/backend/Dockerfile --target api -t homiio-api .
##   Worker build:
##     docker build -f packages/backend/Dockerfile --target worker -t homiio-worker .
##   API:    docker run --env-file packages/backend/.env -p 4000:4000 homiio-api
##   Worker: docker run --env-file packages/backend/.env homiio-worker
##
## Both targets contain the same compiled commit and migration ledger. Only the
## worker target contains Playwright, Chromium and X11; the API never scrapes
## and therefore must not carry or patch those bytes.
##
## BOTH TARGETS RUN ON BUN, FROM DIFFERENT BASES. The API is `oven/bun`
## (Debian/glibc like the install stages, so sharp's glibc prebuild matches); its
## CMD and the `pre` migrator one-shot in .github/scripts/deploy-ecs-image.sh
## both say `bun`. The worker keeps the `node:22-bookworm-slim` base with the
## pinned bun binary copied in: Playwright's Chromium/X11 system packages are
## installed and proven on that base (Debian's, via `playwright install-deps`), and the
## real Node left beside bun makes rolling the worker back a command change, not
## an image change. Its ECS command (deploy-aws.yml's TASK_COMMAND_JSON, which
## replaces the live task definition's) and its `post` migrator both say `bun`.
## A command must always name the runtime its image ships.
##
## HEADED browser tier (LISTING_BROWSER_HEADED=true): DataDome/Kasada block
## headless Chromium, so the worker can launch a real HEADED browser to clear
## them. A headed launch needs an X display; this image bundles Xvfb (the
## virtual framebuffer) for that. When the flag is on, the worker command MUST
## wrap the runtime in xvfb-run:
##
##   xvfb-run -a --server-args="-screen 0 1920x1080x24" \
##     bun packages/backend/dist/worker.js
##
## The flag defaults OFF (headless) and is set by infra alongside the xvfb-run
## command — the image supports both modes; nothing here forces headed.
##
## Listens on $PORT (default 4000). See packages/backend/.env.example for the
## full list of runtime environment variables.
##

# ── Build stage ───────────────────────────────────────────────────
# Must equal `packageManager` in the root package.json (and ci.yml's
# `BUN_VERSION`); .github/scripts/check-version-pins.sh fails CI if they drift.
ARG BUN_VERSION=1.4.3
# Must equal `playwright` in packages/backend/worker-runtime/package.json, the
# npm package the worker installs; check-version-pins.sh holds the two together.
# Playwright refuses to launch a browser built for another release, so the
# browsers copied from the image below must come from the same version.
ARG PLAYWRIGHT_VERSION=1.61.1

# Base images are pinned by multi-arch INDEX digest (linux/arm64 included).
# The digest is what the build uses; the tag is only for readers and for
# check-version-pins.sh. Moving to another bun or node release, or picking up a
# rebuilt base for OS patches, needs a new digest here — and that edit changes
# the build inputs, so it needs a new owner review and re-pin in
# .github/scripts/reviewed-images.json.
#
# Bun comes from its own published image at that version, copied in as one
# binary. Installing it through npm put a second package manager in the
# build just to fetch the first. A BUN_VERSION bump that forgets the digest
# would silently keep the old bun, so the builder asserts the version below.
FROM oven/bun:${BUN_VERSION}-slim@sha256:14a223fa35747ec728bce300ef85888bc5f7958164d15bbba6a54b22b52a3288 AS bun-bin

# Chromium for the listing worker, taken from Microsoft's Playwright image for
# the same release instead of downloaded from Playwright's CDN at build time:
# the digest pins the browser bytes, which `playwright install` never checked
# against anything this file controls. Only Chromium, its headless shell and
# ffmpeg (what `playwright install chromium` fetches) leave this stage. Chromium
# is one generic linux build per architecture (Playwright downloads the same
# archive for ubuntu24.04 and debian12, amd64 and arm64 alike), so it runs on
# the worker's Debian base; its system libraries come from Debian, below.
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble@sha256:5b8f294aff9041b7191c34a4bab3ac270157a28774d4b0660e9743297b697e48 AS playwright-browsers
RUN mkdir /browsers \
    && cp -a /ms-playwright/chromium-* /ms-playwright/chromium_headless_shell-* /ms-playwright/ffmpeg-* /browsers/

FROM node:22.23-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da AS builder
ARG BUN_VERSION

# No compiler toolchain: this stage installs with --ignore-scripts and only runs
# tsc, which loads no native addon. The one addon the runtime has to compile is
# built in `production-deps`, below.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# whatsapp-web.js depends on puppeteer; never download Chromium into the image
# for that path — Playwright Chromium is installed explicitly in the runtime
# stage for the listing worker only.
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Pinned, and pinned to the SAME version as CI and deploy-frontends: every
# install below reads the repository's bun.lock, and a lockfile read by another
# bun can abort a frozen install.
COPY --from=bun-bin /usr/local/bin/bun /usr/local/bin/bun
# `bunx` is bun invoked under that name; the official install ships it as a
# symlink, and copying only the binary dropped it. The workspace `build`
# scripts run `bunx tsc`, so without it this stage fails with exit 127 (every
# deploy from #627 to the change that added this line).
RUN ln -s bun /usr/local/bin/bunx && test "$(bunx --version)" = "$BUN_VERSION"

WORKDIR /app

# THE LOCKFILE. Every install in this file is `bun install --frozen-lockfile`
# against the repository's own bun.lock, unmodified, with `--filter` picking the
# three workspaces the API and worker need (shared-types, listing-providers,
# backend). The root workspace and the Expo frontend are not installed, and the
# frontend's manifest is not in the build context: bun installs a filtered set
# from the lockfile without it.
#
# Until 2026-10 these stages rewrote `workspaces` to that subset, which made
# bun.lock unusable, so it was not copied and every transitive version resolved
# against the registry at build time, separately in each install stage.
# Measured on 2026-10-13: 32 of the 567 packages that install put in the API's
# node_modules were versions bun.lock does not record at all (@oxy.so/db 1.1.0
# where it records 1.0.0; @messageformat/date-skeleton 2.0.0-0, a prerelease,
# where it records 1.1.0). CI's image smoke now checks every package installed
# in the builder and both runtime targets against the lockfiles
# (.github/scripts/assert-image-lockfile.mjs).
#
# `--ignore-scripts`: no dependency lifecycle script runs, and neither does the
# root `postinstall` (build:shared-types, built explicitly below). The closure's
# install scripts are puppeteer's (a browser download, already skipped by
# PUPPETEER_SKIP_DOWNLOAD), esbuild's (this stage only; tsc does not use it)
# and msgpackr-extract's, whose one job the runtime needs is done explicitly in
# `production-deps`. On linux/amd64 installs with and without them produced
# byte-identical node_modules (measured 2026-10-13).
COPY package.json bun.lock ./

# bunfig.toml pins `linker = "hoisted"`. This is REQUIRED: with bun's default
# isolated linker, @types/express-serve-static-core lands at a deeply-nested
# `.bun/` path that tsc deems non-portable, breaking the composite declaration
# emit (TS2883: "inferred type of 'router' cannot be named ..."). The hoisted
# layout matches the monorepo's flat node_modules and lets tsc emit cleanly.
COPY bunfig.toml ./

# Copy package manifests first for a cacheable dependency install layer.
COPY packages/contracts/package.json packages/contracts/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/listing-providers/package.json packages/listing-providers/
COPY packages/backend/package.json packages/backend/

# Every dependency of the three workspaces, dev included (tsc).
RUN bun install --frozen-lockfile --ignore-scripts \
      --filter @oxy.so/homiio-contracts --filter @homiio/shared-types --filter @homiio/listing-providers --filter @homiio/backend

# Copy the source for all workspace packages.
COPY packages/contracts/ packages/contracts/
COPY packages/shared-types/ packages/shared-types/
COPY packages/listing-providers/ packages/listing-providers/
COPY packages/backend/ packages/backend/

# Build in dependency order: shared-types → listing-providers → backend.
RUN bun run --filter @oxy.so/homiio-contracts build
RUN bun run --filter @homiio/shared-types build
RUN bun run --filter @homiio/listing-providers build
RUN bun run --filter @homiio/backend build

# The backend reads i18n locale JSON at runtime from `<dist>/../locales`
# (path.join(__dirname,'..','locales') in services/telegramService.ts). tsc does
# not copy non-imported assets, so stage them next to the compiled output.
RUN cp -r packages/backend/locales packages/backend/dist/locales

# ── Production dependency stages ─────────────────────────────────
# Throwaway install stages. They are glibc (Debian bookworm), the same libc as
# both runtime stages below, so the sharp prebuild installed here is the one
# each runtime loads. Same lockfile, flags and filter as the builder, minus
# devDependencies, so `dist` was compiled against the versions that ship. The
# API and the worker take the same `node_modules`; the worker adds Playwright.
FROM node:22.23-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da AS production-deps
ARG BUN_VERSION

# The compiler toolchain, for msgpackr-extract only (below). It stays in this
# throwaway stage; neither runtime target carries it.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=bun-bin /usr/local/bin/bun /usr/local/bin/bun

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

WORKDIR /app

COPY package.json bun.lock ./
COPY bunfig.toml ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/listing-providers/package.json packages/listing-providers/
COPY packages/backend/package.json packages/backend/

# msgpackr-extract (BullMQ's msgpackr decoder) publishes prebuilt addons for
# linux/amd64 glibc but only MUSL builds for linux/arm64, which is production.
# Its install script, skipped here, would find no usable prebuild there and run
# `node-gyp rebuild`, fetching whatever node-gyp and Node headers it can reach.
# This does that step explicitly and offline, only when no prebuild loads: the
# node-gyp bundled with this digest-pinned image's npm, the image's own Node
# headers (--nodedir), and ENABLE_V8_FUNCTIONS=false for a pure N-API build,
# the flavour Bun (the API's runtime) loads. Both runtimes are then required to
# load it, here and again in each target.
RUN bun install --frozen-lockfile --production --omit peer --ignore-scripts \
      --filter @oxy.so/homiio-contracts --filter @homiio/shared-types --filter @homiio/listing-providers --filter @homiio/backend \
    && rm -rf node_modules/@img/sharp-linuxmusl-* \
              node_modules/@img/sharp-libvips-linuxmusl-* \
    && if ! node -e "require('msgpackr-extract')" 2>/dev/null; then \
         cd node_modules/msgpackr-extract \
         && ENABLE_V8_FUNCTIONS=false node /usr/local/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js \
              rebuild --nodedir=/usr/local \
         && find build -mindepth 1 -maxdepth 1 ! -name Release -exec rm -rf {} + \
         && find build/Release -mindepth 1 -maxdepth 1 ! -name '*.node' -exec rm -rf {} + \
         && cd /app; \
       fi \
    && node -e "require('msgpackr-extract')" \
    && bun -e "require('msgpackr-extract')"

FROM production-deps AS worker-deps
# Playwright is the worker's alone and is not in bun.lock: listing-providers
# declares it only as an optional peer, so no repository install pulls it. It
# comes from packages/backend/worker-runtime, a one-dependency project (not a
# workspace) with its own bun.lock, installed frozen beside the app and copied
# into the hoisted node_modules, where listing-providers' `import('playwright')`
# finds it. The `test ! -e` lines refuse a second copy from the main closure.
COPY packages/backend/worker-runtime/package.json packages/backend/worker-runtime/bun.lock /opt/worker-runtime/
RUN bun install --cwd /opt/worker-runtime --frozen-lockfile --production --ignore-scripts \
    && test ! -e node_modules/playwright \
    && test ! -e node_modules/playwright-core \
    && cp -a /opt/worker-runtime/node_modules/. node_modules/

# ── Worker runtime base (Debian + Node, bun copied in below) ──────
# See the header for why the worker keeps this base rather than `oven/bun`.
FROM node:22.23-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da AS runtime-common

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    LOG_FILE=/tmp/homiio-app.log

WORKDIR /app

COPY --from=builder /app/packages/contracts/dist packages/contracts/dist
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
ARG BUN_VERSION
ARG PLAYWRIGHT_VERSION

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# The worker's runtime: the same pinned binary as every other stage, plus the
# `bunx` name the official install ships as a symlink (copying the binary alone
# drops it — see the builder stage).
COPY --from=bun-bin /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s bun /usr/local/bin/bunx

COPY --from=worker-deps /app/package.json ./
COPY --from=worker-deps /app/packages packages/
COPY --from=worker-deps /app/node_modules node_modules/
COPY --from=playwright-browsers /browsers /ms-playwright

# Chromium and its X11 libraries exist only in the worker image. xauth is
# needed by the documented headed `xvfb-run` mode. `install-deps` is apt only,
# from Debian's signed repositories: the browsers were copied in above and
# nothing is fetched from Playwright's CDN. The checks prove the npm package is
# the release the browsers came from, and that headed Chromium and the headless
# shell (`chrome-headless-shell` on amd64, `headless_shell` on arm64) are both
# present.
USER root
RUN apt-get update && apt-get install -y --no-install-recommends xauth \
    && ./node_modules/.bin/playwright install-deps chromium \
    && rm -rf /var/lib/apt/lists/* \
    && chmod -R a+rX /ms-playwright \
    && test "$(node -p "require('playwright/package.json').version")" = "$PLAYWRIGHT_VERSION" \
    && test -x "$(node -p "require('playwright').chromium.executablePath()")" \
    && find /ms-playwright/chromium_headless_shell-* -maxdepth 2 -type f -perm -u+x \
         \( -name chrome-headless-shell -o -name headless_shell \) | grep -q . \
    && node -e "require('playwright'); require('sharp'); require('msgpackr-extract')" \
    && bun -e "require('playwright'); require('sharp'); require('msgpackr-extract'); require('@homiio/shared-types'); require('@homiio/listing-providers')" \
    && test "$(bun --version)" = "$BUN_VERSION" \
    && test "$(bunx --version)" = "$BUN_VERSION"
# Debian's xvfb-run can wait forever for SIGUSR1 in a container even after Xvfb
# has created a live display socket. Use the bounded, socket-gated wrapper and
# stage the shared directory before privileges drop.
COPY packages/backend/scripts/xvfb-run-ready.sh /usr/local/bin/xvfb-run
RUN chmod 755 /usr/local/bin/xvfb-run \
    && mkdir -p /tmp/.X11-unix \
    && chmod 1777 /tmp/.X11-unix
USER node
# ECS never runs this CMD — the task definition's command wraps it in xvfb-run
# (deploy-aws.yml's TASK_COMMAND_JSON) — but it names the same runtime, so a
# bare `docker run` and deployMigrationWiring.test.ts both see Bun here.
CMD ["bun", "packages/backend/dist/worker.js"]

# ── API target (default/final stage): Bun ─────────────────────────
# The pinned Bun image, Debian slim (glibc) like every install stage, so the
# sharp prebuild production-deps installed is the one this runtime loads. It ships no
# real Node: `node` on its PATH (/usr/local/bun-node-fallback-bin/node) is a
# symlink to bun, so a stale `node ...` override would still run Bun while
# claiming otherwise. Every command that targets this image names `bun`.
#
# The API ran on Node (node:22-bookworm-slim) until 2026-10. Rolling back is
# reverting the change that made this switch: it moved this stage, its CMD and
# the `pre` migrator command in deploy-ecs-image.sh together.
FROM oven/bun:${BUN_VERSION}-slim@sha256:14a223fa35747ec728bce300ef85888bc5f7958164d15bbba6a54b22b52a3288 AS api
ARG BUN_VERSION

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    LOG_FILE=/tmp/homiio-app.log

WORKDIR /app

COPY --from=builder /app/packages/contracts/dist packages/contracts/dist
COPY --from=builder /app/packages/shared-types/dist packages/shared-types/dist
COPY --from=builder /app/packages/listing-providers/dist packages/listing-providers/dist
COPY --from=builder /app/packages/backend/dist packages/backend/dist
COPY --from=builder /app/packages/backend/drizzle packages/backend/drizzle

COPY --from=production-deps /app/package.json ./
COPY --from=production-deps /app/packages packages/
COPY --from=production-deps /app/node_modules node_modules/

RUN bun -e "require('sharp'); require('msgpackr-extract'); require('@homiio/shared-types'); require('@homiio/listing-providers')" \
    && test "$(bun --version)" = "$BUN_VERSION" \
    && test "$(readlink -f "$(command -v node)")" = "$(readlink -f "$(command -v bun)")" \
    && test ! -d node_modules/playwright \
    && test ! -d /ms-playwright \
    && test ! -e /usr/bin/Xvfb

EXPOSE 4000
# tini is PID 1 and forwards SIGTERM to Bun, whose handler in server.ts drains
# the server and the moderation outbox and exits 0. CI's image smoke
# (.github/scripts/smoke-api-image.sh) asserts that whole chain.
ENTRYPOINT ["/usr/bin/tini", "--"]
# The image's own unprivileged user, uid/gid 1000 like Node's `node`.
USER bun
CMD ["bun", "packages/backend/dist/server.js"]
