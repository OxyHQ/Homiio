# Homiio published Peable verifier adoption

Source `b94053ae1b81203cc1f29e2c388663cf2c1c0a12`, base`64d458c542fcb0980c28c0c338dd2d600def0dae`. Five source files and ten evidence records are pinned in [proof.json](proof.json). Shared-root WIP was not touched.

The published `@peable.to/sdk@0.2.2` standalone `WebhooksResource` replaces local HMAC/header parsing in the unmounted payment seam. All53 SDK files match the independently verified registry archive; shared-types resolves0.3.0. No client credential or dummy authenticated client is constructed. The local status/refund/unknown mapping is preserved; no route, Pay rent UI or financial write is enabled.

Three RED cases show the previous signature-only helper accepted signed non-JSON, empty JSON and a prototype-name event. This is a local seam regression test, not evidence of an exposed endpoint or exploitation. Final32 PASS cover the ten published event types with their resource families, raw-string/buffer verification, timestamp boundary, tamper/secret/shape refusals, zero fetch, and invalid UTF-8 rejection before lossy decoding. The local refusal becomes generic `invalid_webhook`; no mounted caller depended on prior diagnostic categories.

Commands: `bun run --cwd packages/backend test --runInBand __tests__/unit/peableContract.test.ts`; backend typecheck/build; scoped ESLint max-warnings0; `bun run check:docs`; pinned Bun1.3.14 `bun run check:lockfile`. The backend harness provisions/migrates/drops its own PostgreSQL databases even for this pure suite; the existing owned PG5575 server persists and the final prefix readback is empty. Initial RED retained the pre-existing pool exit warning; the fixture now closes its own pool explicitly.

Initial TS identified the test's dynamic import needing a NodeNext extension; it was changed to the normal static import and final strict TS passes. Initial lockfile checks correctly refused an uncommitted file, then the ambient Bun1.4.2 mismatch; after committing manifest/lock and running the repository-pinned Bun1.3.14, a fresh install left the lockfile byte unchanged. Historical diagnostics remain private hash references. No runtime workaround or unrelated lock churn was introduced.

This completes verifier-source adoption only. Homiio payment identity, merchant namespace, currency/rail/cohort preflight, obligation correlation, mounted ingress/ledger acceptance and deployment remain separate gates. Mercaria sandbox success is not Homiio commercial authorization. See [the updated integration classification](../../peable-rent-payments.md).
