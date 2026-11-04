/**
 * Homiio's application permission vocabulary (`~/Oxy/docs/application-roles.md`).
 *
 * Homiio is Oxy's own application, so these keys are declared in code in
 * Homiio's entry of oxy's first-party registry (`operatorPermissions` in
 * `packages/api/src/scripts/seedOxyApplicationsSpecs.ts`, applied by oxy's
 * "Seed Oxy applications" workflow; oxy ADR 0056). Each key is held by roles of
 * the organization that owns Homiio (today its owners and admins): to make
 * somebody an operator, give them that role there. Nothing is granted per
 * person, in the Console or otherwise (Oxy answers a grant on a first-party
 * application `409 FIRST_PARTY_ROLES_IN_CODE`), and Homiio keeps no list of
 * user ids. Every key here must equal the registry's: a key renamed in only
 * one place answers 404 to everyone, and a new key does nothing until the
 * registry declares it and the seed runs.
 */
export const APPLICATION_PERMISSIONS = [
  {
    key: 'homiio.scraper.operate',
    description: 'Run, inspect and clean up the external listing ingestion tooling (/api/scraper).',
  },
] as const;

export const SCRAPER_OPERATE_PERMISSION = APPLICATION_PERMISSIONS[0].key;
