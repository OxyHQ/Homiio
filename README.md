<p align="center">
  <b>Homiio</b> is a real estate platform by <a href="https://oxy.so">Oxy</a>.<br>
  Find a home, sign the lease, and live in it, without a portal standing between the two people involved.
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
  <img alt="MongoDB" src="https://img.shields.io/badge/MongoDB-Mongoose-440151?style=flat-square&logo=mongodb&logoColor=white">
</p>

---

<table>
<tr>
<td valign="top" width="50%">

### 🏠 The whole tenancy, not just the search

Most of this repo is what happens after the listing. Applications become leases, leases are first class documents that get signed, renewed and terminated, payments and documents hang off them, and roommate requests materialize into real relationships.

Viewings, reviews, evictions and partner commissions are all modelled, so a tenancy has a record rather than a chat log.

</td>
<td valign="top" width="50%">

### 🔑 Identity comes from Oxy

There is no Homiio account. Sign in is the device first Oxy session, handled end to end by [`@oxyhq/services`](https://www.npmjs.com/package/@oxyhq/services) on the client and [`@oxyhq/core`](https://www.npmjs.com/package/@oxyhq/core) on the server.

Ownership follows from it: every property, room and lease write resolves the owner from the session and never from the request body. See the [Oxy platform repo](https://github.com/OxyHQ/oxy) for how the session works.

</td>
</tr>
</table>

## Packages

| Package | Path | What it is |
|---|---|---|
| `@homiio/frontend` | [`packages/frontend/`](packages/frontend/) | Expo app for web, iOS and Android, with expo-router, NativeWind and i18next |
| `@homiio/backend` | [`packages/backend/`](packages/backend/) | Express API and a separate worker process: Mongoose, Stripe, Sharp, BullMQ |
| `@homiio/listing-providers` | [`packages/listing-providers/`](packages/listing-providers/) | Provider plugin contract, shared fetch runtime, and the portal plugins |
| `@homiio/shared-types` | [`packages/shared-types/`](packages/shared-types/) | Address, city, lease, profile, property and review DTOs |

The UI is [`@oxyhq/bloom`](https://www.npmjs.com/package/@oxyhq/bloom) primitives with NativeWind on top. The production image builds in dependency order: shared types, then listing providers, then the backend.

## Quick start

```bash
bun install
cp packages/backend/.env.example packages/backend/.env
bun run dev:backend
bun run dev:frontend
```

Bun 1.3.14 and Node 22. Use `bun` and `bunx`, never npm, yarn or npx.

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
| [`docs/auth.mdx`](docs/auth.mdx) | Sessions, ownership and profiles |
| [`docs/listings.mdx`](docs/listings.mdx) | Properties and external ingest |
| [`docs/payments.mdx`](docs/payments.mdx) | Stripe billing and subscriptions |
| [`docs/analytics.mdx`](docs/analytics.mdx) | What is measured |
| [`docs/deployment.mdx`](docs/deployment.mdx) | Shipping it |
| [`docs/contributing.mdx`](docs/contributing.mdx) | Working on it |

The full working agreement, including the layout and styling rules the app is held to, is in [`AGENTS.md`](AGENTS.md).

## License

MIT. See [`LICENSE`](LICENSE).

<br>

<div align="center">
<sub>Part of the <a href="https://github.com/OxyHQ">Oxy</a> ecosystem</sub>
</div>
