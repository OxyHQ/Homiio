# Notification amount assertion

The previous full-row substring assertion could match `9999` inside generated IDs. The revised assertion checks the published title, message, explanation and push text; it also requires the cost detail to contain exactly the change kind, listing title and changed term names. No amount is allowed in that detail. Backend runtime is unchanged.

Executed `TEST_DATABASE_URL=postgres://nate@127.0.0.1:5611/postgres bun run --cwd packages/backend test --runInBand __tests__/integration/housingWatchAlerts.test.ts`: **54 PASS**. A new owned PostgreSQL17 cluster on loopback5611 ran the repository's canonical migrator and per-worker throwaway databases. The post-test DB census was empty and the owned server stopped. No other database or server was used.
