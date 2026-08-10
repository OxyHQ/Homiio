<p align="center">
  <b>Homiio</b> is the housing trust and transparency layer, by <a href="https://oxy.so">Oxy</a>.<br>
  Find a place, research its history, learn what it really costs, understand what living there was like, and manage or defend the tenancy.
</p>

<p align="center">
  <a href="https://homiio.com">homiio.com</a>
</p>

<p align="center">
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-440151?style=flat-square"></a>
  <img alt="Expo SDK 56" src="https://img.shields.io/badge/Expo-SDK%2056-440151?style=flat-square&logo=expo&logoColor=white">
  <img alt="React Native 0.85" src="https://img.shields.io/badge/React%20Native-0.85-440151?style=flat-square&logo=react&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-440151?style=flat-square&logo=typescript&logoColor=white">
  <img alt="Bun" src="https://img.shields.io/badge/bun-1.3-440151?style=flat-square&logo=bun&logoColor=white">
  <img alt="Node 22" src="https://img.shields.io/badge/node-22.x-440151?style=flat-square&logo=nodedotjs&logoColor=white">
  <img alt="PostgreSQL + PostGIS" src="https://img.shields.io/badge/PostgreSQL-PostGIS%20%2B%20Drizzle-440151?style=flat-square&logo=postgresql&logoColor=white">
</p>

---

<table>
<tr>
<td valign="top" width="50%">

### 🏠 The dwelling is permanent; the advert is not

A listing is not the identity of a home. The permanent thing is a place — a street, a building, a unit — and a listing is a temporary, sourced advertisement pointing at it. One dwelling can carry several adverts across several portals, lose them all, and get new ones next season.

That is what makes rent history, resident reviews and eviction records attachable to somewhere real rather than to an advert that vanishes. It is fixed by [ADR 0001](docs/adr/0001-canonical-housing-graph.md).

</td>
<td valign="top" width="50%">

### 🔑 Identity comes from Oxy

There is no Homiio account. Sign in is the device first Oxy session, handled end to end by [`@oxyhq/services`](https://www.npmjs.com/package/@oxyhq/services) on the client and [`@oxyhq/core`](https://www.npmjs.com/package/@oxyhq/core) on the server.

Ownership follows from it: every property, room and lease write resolves the owner from the session and never from the request body. See the [Oxy platform repo](https://github.com/OxyHQ/oxy) for how the session works.

</td>
</tr>
<tr>
<td valign="top" width="50%">

### 📍 Location is never implicit

Every surface that answers "where?" says which area it is querying, and free text and geographic scope are separate dimensions. A geocoding failure is an error a person can see, never a silent fall back to a worldwide feed. [ADR 0002](docs/adr/0002-location-and-search-contract.md).

</td>
<td valign="top" width="50%">

### 🔒 Privacy by precision, prices with reasons

An address, a coordinate and a review are stored at one precision and published at a coarser one, decided per audience rather than per serializer ([ADR 0003](docs/adr/0003-privacy-verification-publication.md)). A price assessment is local, versioned and explainable — never one universal score ([ADR 0004](docs/adr/0004-local-explainable-pricing.md)).

</td>
</tr>
</table>

## The whole tenancy, not just the search

Most of this repo is what happens after the listing. Applications become leases; leases are first class documents that get signed, renewed and terminated; payments and documents hang off them; roommate requests materialise into real relationships. Viewings, reviews, evictions and partner commissions are all modelled, so a tenancy has a record rather than a chat log.

## Packages

| Package | Path | What it is |
|---|---|---|
| `@homiio/frontend` | [`packages/frontend/`](packages/frontend/) | Expo app for web, iOS and Android, with expo-router, NativeWind and i18next |
| `@homiio/backend` | [`packages/backend/`](packages/backend/) | Express API and a separate worker process: PostgreSQL via Drizzle, Stripe, Sharp, BullMQ |
| `@homiio/listing-providers` | [`packages/listing-providers/`](packages/listing-providers/) | Provider plugin contract, shared fetch runtime, and the portal plugins |
| `@homiio/shared-types` | [`packages/shared-types/`](packages/shared-types/) | Address, city, lease, profile, property, review and observability DTOs |

The UI is [`@oxyhq/bloom`](https://www.npmjs.com/package/@oxyhq/bloom) primitives with NativeWind on top. The production image builds in dependency order: shared types, then listing providers, then the backend.

## Data lives in PostgreSQL, and nowhere else

One store: PostgreSQL with **PostGIS**, reached through [Drizzle](https://orm.drizzle.team/). `DATABASE_URL` is the only database secret either process needs, and the API refuses to boot without it. Geographic queries are real PostGIS — `ST_DWithin`, `ST_MakeEnvelope`, `ST_Distance`, `ST_Intersects` against a generated `geography` column with a GiST index — not a bounding box computed in JavaScript.

Expiry is a **sweep**, not an engine feature: Postgres never deletes an expired row by itself, so every table with a deadline column is registered in `packages/backend/db/expiry.ts` and reaped by `services/cron.ts`. A table added without an entry grows forever, with no error and no failing test.

## Quick start

```bash
bun install
cp packages/backend/.env.example packages/backend/.env   # set DATABASE_URL

docker compose -f docker-compose.postgres.yml up -d      # PostGIS on 127.0.0.1:5434
bun run --cwd packages/backend db:migrate                # apply every migration

bun run dev:backend
bun run dev:frontend
```

Bun 1.3.14 and Node 22. Use `bun` and `bunx`, never npm, yarn or npx.

The compose file runs `postgis/postgis:17-3.5` on port **5434** rather than 5432, because sibling Oxy services already hold 5432 and 5433 on a developer machine. Migrations run through `packages/backend/db/migrate.ts`; never `drizzle-kit migrate`, which does not understand this repo's `pre` / `post` deploy phases.

The backend test suite treats a reachable Postgres as a **hard prerequisite** — it refuses to start rather than skipping silently, so a green run always means the database was really there.

<details>
<summary><b>All the commands</b></summary>

<br>

```bash
bun run dev              # every workspace at once
bun run dev:frontend     # Expo app
bun run dev:backend      # API
bun run build            # every workspace
bun run test             # every workspace
bun run lint             # every workspace
bun run check:lockfile   # bun.lock really matches the manifests
bun run clean            # build artifacts and node_modules

bun run --filter @homiio/backend worker       # the BullMQ worker
bun run --filter @homiio/frontend typecheck   # tsc --noEmit
bun run --filter @homiio/frontend check:i18n  # translation keys
```

</details>

<details>
<summary><b>Cold start check: the only thing that sees a white screen</b></summary>

<br>

```bash
bun run --cwd packages/frontend build
bun run --cwd packages/frontend check:cold-start / /properties
bun run --cwd packages/frontend check:cold-start:test
```

Run it after touching anything in the boot path, meaning `app/_layout.tsx`, the providers under `context/`, or the splash gate.

It exists because nothing else here can catch a blank boot. TypeScript passes, Jest passes, `expo export` succeeds, and the app still mounts nothing: a boot mounted component calling a suspenseful hook deadlocks the render, so the init effect never runs and the promise never resolves, with zero console output.

The check loads the exported build in a real headed browser and asserts rendered content, not merely that nothing threw. It refuses to give a verdict when the tab is not visible, because a backgrounded tab pauses `requestAnimationFrame` and presents exactly like a blank page. It also carries a mutation test, so it can tell "ran and found nothing" from "did not run".

</details>

<details>
<summary><b>Market listings are ingested, never hotlinked</b></summary>

<br>

Homiio aggregates listings from external portals as first party data. Nothing is proxied live and no portal image URL is ever served at runtime: a listing is fetched, normalized to a `NormalizedListing`, upserted with `isExternal: true` and a mandatory source URL, and its photos are downloaded, processed with Sharp and stored by Homiio.

External listings are visibly marked and cannot be applied to or booked through Homiio. They link back to the portal, plus direct contact details when the portal itself exposed them.

Each portal is a plugin implementing `discover`, `fetch`, `normalize` and `health`, registered in the provider registry and off by default behind its own environment flag. Rate limiting, retries, the circuit breaker, the browser pool and the escalation ladder live once in the shared fetch runtime rather than in every plugin, and parsing helpers for schema.org, `__NEXT_DATA__`, contact details and city lists are shared modules that plugins must import instead of reimplementing.

General classifieds sites are never crawled site wide. Their plugins allow only housing categories and reject non housing listings at normalize time, pinned by fixtures on both sides.

</details>

<details>
<summary><b>Canonical addresses, reviews, contracts and evictions</b></summary>

<br>

**Canonical addresses.** An address is a row of its own, not a blob copied onto each listing. A listing references it by `address_id`, and `findOrCreateCanonicalAddress` resolves a submitted address to an existing row rather than making a near duplicate. Place names — country, region, city, neighborhood — are never stored as free text on the address; they are ids into the geo tables and resolved to display names on the way out. That is what lets several listings, several reviews and a rent history hang off one physical place. The target street / building / unit levelling is [ADR 0001](docs/adr/0001-canonical-housing-graph.md).

**Reviews.** Residents review an address, not a listing, so a review outlives the advert that led someone there. Reviews are community moderated: reports accumulate on a review until it moves to `under_review` on its own. There is no reviewer queue and no privileged actor.

**Contracts.** A lease is a first class document on Postgres with its own child tables for payments, documents, co tenants, utilities and inspections. It can only be created from an **approved** application through `POST /api/applications/:id/create-lease`, which resolves the property, the tenant and the rent server side — there is no free form lease composer and no tenant picker.

**Evictions.** A public solidarity board of upcoming evictions, with comments and attendance. Public coordinates are deliberately approximate; the exact ones are not what the board is for. Read endpoints are unauthenticated, writes are not. The privacy rules are [ADR 0003](docs/adr/0003-privacy-verification-publication.md).

</details>

<details>
<summary><b>No admin or moderator surfaces</b></summary>

<br>

This is a product decision, not a gap. Homiio has no admin panel, no moderator queue and no privileged action over user content. Moderation is community level: reports accumulate on a review until it enters review automatically, eviction reports are user submitted, and owners cancel or delete their own content.

The one privileged surface is the scraper route, which is infrastructure tooling and not content moderation.

</details>

<details>
<summary><b>Deploy</b></summary>

<br>

| Workflow | Target |
|---|---|
| [`ci.yml`](.github/workflows/ci.yml) | Lint, tests and builds on every push and pull request |
| [`deploy-aws.yml`](.github/workflows/deploy-aws.yml) | API and worker to AWS ECS Fargate on `linux/arm64` |
| [`deploy-frontends.yml`](.github/workflows/deploy-frontends.yml) | Web build to Cloudflare Pages |

The API and the worker are the same image with different start commands. Full instructions are in [`docs/deployment.mdx`](docs/deployment.mdx).

</details>

## Documentation

| Page | About |
|---|---|
| [`docs/getting-started.mdx`](docs/getting-started.mdx) | Running it locally |
| [`docs/architecture.mdx`](docs/architecture.mdx) | How the pieces fit |
| [`docs/glossary.mdx`](docs/glossary.mdx) | What `listing`, `housing place`, `building`, `unit`, `precision`, `source` and the rest mean here |
| [`docs/source-of-truth.mdx`](docs/source-of-truth.mdx) | Which module owns each domain, so nobody builds a second authority |
| [`docs/routes.mdx`](docs/routes.mdx) | Every mounted route, public or authenticated, plus redirects and the response envelope |
| [`docs/listings.mdx`](docs/listings.mdx) | The `Property` DTO, offerings, search and external ingest |
| [`docs/payments.mdx`](docs/payments.mdx) | Stripe billing and subscriptions |
| [`docs/analytics.mdx`](docs/analytics.mdx) | What is measured, and what is deliberately not |
| [`docs/auth.mdx`](docs/auth.mdx) | Sessions, ownership and profiles |
| [`docs/deployment.mdx`](docs/deployment.mdx) | Shipping it |
| [`docs/contributing.mdx`](docs/contributing.mdx) | Working on it |
| [`docs/adr/README.md`](docs/adr/README.md) | The architecture decision records, and which one binds what |

The full working agreement, including the layout and styling rules the app is held to, is in [`AGENTS.md`](AGENTS.md).

Documentation here is gated: `bun run check:docs` fails the build when an authoritative page describes a store this repo does not use, links somewhere that does not exist, or falls behind the routes Express and Expo Router actually mount.

## License

MIT. See [`LICENSE`](LICENSE).

<br>

<div align="center">
<sub>Part of the <a href="https://github.com/OxyHQ">Oxy</a> ecosystem</sub>
</div>
