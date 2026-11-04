# Homiio SDK

Three entries:

- `@oxy.so/homiio-sdk/client` — public case cards for browsers (`HomiioClient`),
  no Zod.
- `@oxy.so/homiio-sdk` — the same plus case links and `HomiioTeamClient`, the
  case owner's side of a team operation (`begin`, `finalize`) over the
  signed-in person's Oxy linked transport. The transport is required.
- `@oxy.so/homiio-sdk/server` — the team operation read, for backends.

## Reading a team operation

```ts
import { homiioTeamForOxyService } from '@oxy.so/homiio-sdk/server';

const team = homiioTeamForOxyService(oxy); // the process's one OxyServer
const operation = await team.read(operationId, capability);
```

Every request carries two things, and neither replaces the other:

- **The caller's Oxy service token** — transport identity, minted by
  `OxyServer.createServiceClient` for Homiio's audience (`SERVICE_AUDIENCE`,
  `oxy-service:<Homiio's application id>`) from the process's attested workload
  identity (Oxy ADR 0026/0049). No API key, internal scope or app consent.
- **The operation's capability** (`x-homiio-team-operation`) — the resource
  grant. Operation and membership checks are Homiio's, whoever the caller is.

Homiio refuses the read without a service token (401) or with a person's
session (403); `read` throws for every refusal. The factory takes only the
structural `createServiceClient` method it uses, so neither entry carries Oxy
types; it requires Oxy core7 or newer. `createServiceClient` mints from
workload identity only, so an `OxyServer` configured only with `serviceAuth`
(an external application's key pair) cannot read operations; there is no
second, key-based path.

## 1.0.0 — the operation read always authenticates

0.x let `new HomiioTeamClient()` call the read route with bare `fetch` and no
token, so Homiio could not require a service token there.

- Removed: `HomiioTeamClient.read` and its optional `fetch`. `homiioTeamForOxyService`
  now returns a `HomiioTeamOperationReader` (`read` only).
- Changed: `new HomiioTeamClient({ transport })` — the transport is required.
- Unchanged: `begin`, `finalize`, `SERVICE_AUDIENCE`, `/client`, links and the
  contract types.

A backend that already read through `homiioTeamForOxyService` and a frontend
that already passed a transport only bump the version.
