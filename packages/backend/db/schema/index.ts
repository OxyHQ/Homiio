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
export {
  addressCandidates,
  addressExternalRefs,
  addressMaterializations,
} from './addressMaterialization';
export { addressMergeRelationMoves, addressMerges } from './addressMerges';
export { agencies } from './agencies';
export {
  tenantApplicationDocuments,
  tenantApplicationReferences,
  tenantApplications,
} from './applications';
export { billing, billingProcessedSessions } from './billing';
export { reservations, viewingRequests } from './bookings';
export {
  conversationMessageAttachments,
  conversationMessages,
  conversations,
} from './conversations';
export {
  evictionCaseAttendees,
  evictionCaseFollowers,
  evictionCaseHelpNeeds,
  evictionCases,
  evictionCaseUpdates,
  evictionComments,
  evictionLocationAccessAudit,
  evictionLocationGrants,
  evictionOrganizations,
  evictionReports,
  evictionSupporterVouches,
  evictionUpdateNotifications,
  jurisdictionResources,
} from './evictions';
export { exchangeRequests, exchangeReviews } from './exchanges';
export { cities, countries, neighborhoods, regions } from './geo';
export { images } from './images';
export {
  leaseCoTenants,
  leaseDocuments,
  leaseInspectionFindings,
  leaseInspections,
  leasePaymentSchedule,
  leases,
  leaseSharedUtilityCosts,
} from './leases';
export {
  moderationEnforcements,
  moderationEvents,
  moderationOutbox,
  moderationReports,
} from './moderation';
export { notifications } from './notifications';
export { commissions, partners } from './partners';
export { placePoiCategories, placePois } from './placePois';
export {
  profileChatMessages,
  profilePreferredLocations,
  profileReferences,
  profileRentalHistory,
  profileRoommateHistory,
  profiles,
} from './profiles';
export {
  properties,
  propertyAvailabilityWindows,
  propertyDocuments,
  propertyImages,
} from './properties';
export { listingReports } from './reports';
export { reviewHelpfulVotes, reviewReports, reviews } from './reviews';
export { roommateRelationships, roommateRequests } from './roommates';
export {
  recentlyViewed,
  savedItems,
  savedPropertyFolderItems,
  savedPropertyFolders,
  savedSearches,
} from './saved';
export { housingAlerts, housingDomainEvents, housingWatchRules } from './watches';
