/**
 * Homiio's application permission vocabulary (`~/Oxy/docs/application-roles.md`).
 *
 * Declare these keys on Homiio's Oxy application (Console → Settings → Roles,
 * or `PUT /applications/:appId/roles/permissions`, which replaces the WHOLE
 * vocabulary — keep any other declared key) and grant them to the people who
 * operate the surface. Shipping this code declares and grants nothing: until a
 * person holds the key, the surface it gates answers 404 to everyone.
 */
export const APPLICATION_PERMISSIONS = [
  {
    key: 'homiio.scraper.operate',
    description: 'Run, inspect and clean up the external listing ingestion tooling (/api/scraper).',
  },
] as const;

export const SCRAPER_OPERATE_PERMISSION = APPLICATION_PERMISSIONS[0].key;
