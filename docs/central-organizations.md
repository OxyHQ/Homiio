# Canonical organizations and housing references

Oxy owns organization names, account identity, aliases, logos, legal details and claims. Homiio stores two independent housing roles: an agency reference and a housing-support collective reference. The same Oxy account may hold both roles. An eviction case's agency is the party carrying out the eviction; its support organization is the collective helping the household. These relationships are never interchanged.

Agency IDs and historical slugs remain stable. Public names come from bounded Oxy directory batches, deduplicated across each result set. Missing or suppressed accounts are withheld; directory failures propagate instead of serving archived labels. Review and case authors select canonical accounts. They cannot author company identities or confer account ownership. Housing-support contact-channel checks remain local privacy evidence and do not imply an Oxy claim or verified identity.

## Historical evidence

The production read-only inventory on 2026-10-15 found 13,905 agency rows, no reviews and no orphan property agency references. Source-kind aggregates were: 11,031 exclusively agency, 145 exclusively non-agency, 1,701 unknown, 16 unknown/non-agency, and 1,012 without a referencing property. The support-organization table and its case references were empty. These are rollout measurements, not permanent constraints.

A populated agency label is not proof of an organization. Existing parsers for Rightmove and OnTheMarket infer agency kind from the presence of a label; Immoweb includes label-only fallback. Those historical rows remain `unresolved`. The automatic neutral import accepts only consistently explicit agency/commercial-advertiser categories from the audited Fotocasa, Otodom, Kleinanzeigen, Bienici, Immowelt and Storia parsers, with source URLs. Generic OpenRent landlord labels are `not_organization`. Mixed, missing and unaudited evidence remains unresolved. Nothing matches or merges company names.

The two immutable identity archives preserve the former labels and IDs as migration evidence. They are not a public directory or a name lookup fallback. The serving rows contain `oxyAccountId` and an explicit `identityStatus`: `linked`, `unresolved`, or `not_organization`. An unresolved agency URL returns `agency_identity_unresolved`, which the frontend explains. Its existing property and review references remain intact.

## Current ingestion and later resolution

A label-only advertiser remains a sourced listing contact observation. A provider-declared agency with a stable advertiser key can resolve through Oxy's namespace-bound import API. For example Fotocasa supplies `clientId` separately from the listing ID; parsing preserves that key without deriving one from a name. Oxy uses namespace `homiio` and source key `provider:<provider>:<advertiserId>`. Repeated refreshes resolve the same canonical account.

A refreshed listing may move to its evidenced source advertiser reference. This does not reassign all listings in an old globally name-folded agency row. Historical ambiguity is preserved until reviewed evidence justifies a link. Do not recrawl the entire dataset as part of this migration. Existing ingestion refreshes provide incremental evidence; staff may separately resolve historical groups using reviewed mappings. Oxy alone reviews cross-source merges and ownership claims.

## Deployment and migration

1. Deploy Oxy organization APIs and publish the canonical SDK first. Enable the Homiio workload's durable `organizations:import` scope and exact `organizations:import:homiio` capability through Oxy's reviewed product-agent/workload configuration. Runtime workers use existing workload attestation, never a human token or an extra static credential.
2. Apply migration `0031_central_organization_references` with the standard executor's `pre` phase. Both roles are archived and old name writers are frozen in the same transaction. Old required name columns become nullable so the new image can insert reference-only rows before post migration. Existing reads remain possible during the rolling deployment, but legacy identity writes deliberately fail; schedule this short write-maintenance window and drain old ingestion workers.
3. The existing deploy workflow rolls the API and worker images, waits for the old worker to drain, then automatically executes the `post` phase. Migration `0032_retire_local_organization_identity` checks exact archive agreement before removing local identity columns. It does not depend on completed Oxy imports: unresolved rows and their historical relationships intentionally survive. No manual pipeline pause is required.
4. After rollout, run the dry-run backfill below and inspect its private plan file. It reads immutable archives and surviving role references after old identity columns have been dropped. Source imports must run only after Oxy's app capability is active. The plan lists every source group, evidence, classification and reviewed mapping. Review exact contents and hash before applying.
5. Apply each reviewed plan. Every remote batch contains at most 100 sources. Oxy source mappings are idempotent; each successful batch checkpoints local links with a null-or-same compare-and-set. No remote request occurs inside the local database transaction. A retry after partial completion needs a fresh dry-run/hash; already-linked rows are retained. Distinct source IDs with equal labels stay distinct unless Oxy has a reviewed merge. Verify reference counts, classifications and archive integrity after completion. Unresolved references are an explicit remaining identity-resolution state, not a falsely completed company import.

Both pre changes precede the post migration because the migration ledger is a high-water mark and cannot skip a post migration to execute a later pre migration. Use the existing ECS one-shot migration executor and production network; no direct database tunnel is needed. No production migration has been executed by the implementation tests.

The backfill is dry-run by default and requires the actual database name to match both the configured URL and connected database:

```sh
bun packages/backend/scripts/backfillCentralOrganizations.ts \
  --target-database=homiio --role=housing_agency --plan-output=/secure/agency-plan.json

bun packages/backend/scripts/backfillCentralOrganizations.ts \
  --target-database=homiio --role=housing_agency --apply --plan-sha256=<reviewed-sha256>
```

`--plan-output` creates a new file with mode 0600 and refuses to overwrite it. It contains source names/URLs, never authentication tokens. Use a fresh private filename per plan. Keep evidence under the operations retention/access policy.

Optional `--reviewed-mappings=/secure/mappings.json` takes an array of `{ "agencyId": "historical-id", "accountId": "canonical-oxy-id", "evidenceReference": "review-record-or-source" }`. `agencyId` names the historical role reference for either role. Linking an existing canonical account requires an authorized staff SDK session supplied by the operation's credential environment as `OXY_ADMIN_ACCESS_TOKEN`; it is never stored or logged. Automatic worker imports cannot link arbitrary accounts. A reviewed mapping never overwrites canonical facts, creates an owner or transfers a historical verification assertion.

For support collectives pass `--role=housing_support`. These rows have no provider-backed company classifier: they remain unresolved until an explicit reviewed mapping exists. Their source keys are `support:<id>`; agency migration source keys are `legacy:<id>` within the Homiio namespace.

Before post migration, application rollback requires retaining the reference-aware image: the old identity writer is intentionally frozen. After post migration, roll forward or restore a reviewed database backup; do not recreate an editable local directory from the archive. New canonical accounts remain source-mapped in Oxy even if an app deployment is rolled back.
