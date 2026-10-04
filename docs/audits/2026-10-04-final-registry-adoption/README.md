# Homiio: published SDK adoption

Source `af889e0f9483dff1be2dbda548e55ef15a1e45f6` pins the published SDK and its measured compatible Bloom version, including the regenerated lockfile. Existing application behavior and previously reviewed fixes remain in the branch.

Validation: {"frontendSuites": 13, "frontendPassed": 134, "backendSuites": 2, "backendPassed": 64, "sdkImporterMembers": 4359, "bloomImporterMembers": 41880, "typesBuildExport": "passed"}. Exact commands, logs, archive member hashes and importer resolutions are in [proof.json](proof.json).

- Published registry archives and all installed SDK importer members were compared byte for byte. Stale same-version candidate materializations were retained and repaired with a frozen install; their setup failures remain in the records.
- Local web export proves compilation, not browser/native acceptance or deployed public-client configuration. Required PR/main CI and root image/promotion remain separate.
- No production database, provider writes, grants, credentials or auth fixtures were changed. Owned PostgreSQL was stopped and its PID absence verified.
- The backend Jest run exited 0 with all 64 tests passing but reported a worker force-exit warning. This is preserved; it is not evidence of graceful Jest worker teardown.
