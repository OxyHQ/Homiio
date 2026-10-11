# Ecosystem activity

Each deployed API process publishes bounded activity aggregates to Oxy, whether
or not anyone has opened the dashboard. HTTP middleware observes requests and
completed responses, including errors; the shared outgoing observer covers fetch
and Node HTTP clients. Requests and responses have independent directions.
Socket.IO application events and observed raw WebSocket messages are counted
separately from HTTP. Ping/pong frames and Socket.IO acknowledgements are not
application events.

The publisher sends only service identities, infrastructure regions, coarse edge
PoPs, direction, scope, category and aggregate counts. It never sends payloads,
paths, query strings, IPs, user IDs, credentials or socket IDs. A Cloudflare PoP
is a network ingress location, not a visitor's physical location.

The deployed producer activates automatically once `OXY_ACTIVITY_API_KEY` and
`OXY_ACTIVITY_API_SECRET` are both set; leave them unset in local environments,
even when using AWS storage. There is no separate enable flag — the dedicated
credential pair is both the authentication and the toggle.

`AWS_REGION` supplies the process location. Each process registers a fresh
instance, refreshes its lease, and removes it during graceful shutdown.
Crashed instances disappear when their lease expires. Oxy broadcasts
authoritative snapshots over Socket.IO.

Counters describe observed application operations, not network bytes. Direct
object-storage downloads, media transports, database wire protocols and third
party runtime internals require instrumentation at their owning services.

## Web traffic

The frontend's web traffic (`homiio.com`, the `homiio-frontend` Worker) is
measured keylessly by Oxy from Cloudflare's own analytics — see OxyHQ/oxy
`docs/operations/cloudflare-web-activity.md`. The Worker holds no Oxy activity
secret and runs no activity code; it hands every request to its ASSETS binding.
The `OXY_EDGE_ACTIVITY_*` bindings were never provisioned and nothing reads them
now, so if an operator ever finds one on the deployment it can simply be deleted.

## Package versions

Core and contracts are aligned through workspace overrides so browser and server packages share one version.
