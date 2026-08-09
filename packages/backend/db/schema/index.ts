/**
 * The schema barrel.
 *
 * Three things read this module and they must all see the SAME set of tables:
 * `drizzle()` in `db/postgres.ts` (what queries reference), `drizzle.config.ts`
 * (what the generated DDL creates), and every gate under `__tests__/db/` (which
 * enumerates `declaredTables()` from here, so a NEW table is covered by every
 * invariant without an edit to a test).
 *
 * That last property is why a table must be exported here the moment it exists.
 * A table left out of this barrel is a table no gate checks — it would not
 * appear in the snake_case scan, the primary-key scan, the timestamptz scan or
 * the id-column classification, and every one of those would keep reporting
 * "no offenders".
 *
 * The migration ledger (`drizzle.__drizzle_migrations`) is deliberately ABSENT.
 * drizzle owns those rows; modelling them here would invite application code to
 * write to a table the migrator treats as its own.
 *
 * **TABLES ONLY.** Nothing else may be exported from here. The gates enumerate
 * this module's values and narrow them to `PgTable`, so a non-table export
 * widens that union and the narrowing stops type-checking — which is how the
 * value tuples (`ADDRESS_LEVELS`, `IMAGE_ENTITY_TYPES`) were first exported and
 * then removed. Import those from their own module: they belong to the table
 * that constrains itself with them, not to the set of tables.
 */

export { addresses } from './addresses';
export { cities, countries, neighborhoods, regions } from './geo';
export { images } from './images';
export {
  properties,
  propertyAvailabilityWindows,
  propertyDocuments,
  propertyImages,
} from './properties';
