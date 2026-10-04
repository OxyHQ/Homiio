# Worker readiness rehearsal

Run from the repository root after a frozen install and the normal shared-types,
listing-providers and backend builds:

```sh
node --test scripts/acceptance/worker-readiness/loopback-only.test.mjs
node scripts/acceptance/worker-readiness/run.mjs /absolute/new/private/output
```

The output directory must not exist. The harness starts its own PostgreSQL and
Redis on loopback-only dynamic ports, a synthetic HTTP issuer/activity sink, and
the actual compiled `dist/worker.js`. It gives the worker a minimal environment,
disables dotenv loading, boot/recurring discovery and browser fetching, and
preloads a socket guard that refuses non-loopback connections. It never enqueues
a listing job. PostgreSQL is deliberately empty: this measures the worker's
startup round trip, not schema migration or ingest compatibility.

Acceptance requires both startup messages, one real Redis consumer for each of
the two queues, an infrastructure heartbeat through the installed Oxy SDK, empty
queues and no public tables. SIGTERM must exit zero, send the removal heartbeat
and unregister both consumers. Cleanup independently stops the worker, queue
clients, HTTP sink, Redis and PostgreSQL. The result and logs remain under the
private output directory. No live credentials, SDK mocks, grants or provider
requests are involved; the issuer/sink are synthetic and do not establish live
Oxy authorization.

## Production mapping for the root operator

Keep the reviewed two-stage image/configuration promotion and captured-count
restore. Readiness must be tied to the exact new worker task ARN, task definition,
image digest and post-start log stream, never to API `/health` or an older task.
Require `Listing worker connected to database` and
`Listing worker started on BullMQ`, stable RUNNING state and no terminal startup
failure. A configured infrastructure heartbeat is additional evidence only:
`startPlatformActivity` currently returns without starting unless both dedicated
activity credentials are present. Its ready flag is set before BullMQ starts,
so a heartbeat alone cannot replace the queue-start checks.

Preserve live discovery configuration and existing queued intentions. Do not
inject jobs, copy fixture credentials, suppress errors, or change queue settings
to manufacture production success. Provider/ingest success and any delegated
authority remain separate from DB/queue startup. This local rehearsal does not
prove Chromium, ARM image contents, live Redis/DB connectivity or provider access.
