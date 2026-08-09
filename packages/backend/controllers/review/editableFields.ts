/**
 * Mass-assignment protection for review write endpoints.
 *
 * `createReview`/`updateReview` must NEVER spread `req.body` straight into an
 * insert. That would let a client set the address hierarchy ids, the author
 * (`oxyUserId`), the moderation/verification state or the relational
 * `agencyId` — an IDOR / integrity hole. Instead the controllers pick ONLY the
 * explicit, user-supplied fields listed here; every server-owned field is
 * resolved and set explicitly.
 *
 * This is the FIRST of two layers and it decides only WHICH keys survive.
 * `controllers/review/reviewInput.ts` is the second and decides whether their
 * values are storable — the job mongoose's casting and validators used to do,
 * and the reason a rejected review is still a 400 rather than a CHECK violation
 * surfacing as a 500.
 *
 * `agencyName` is a WRITE-ONLY input: the controller resolves it into a
 * canonical agency and sets `agencyId` server-side — the raw name is never
 * persisted on the review. The address is handled separately (nested
 * `address` object, create-only), so it is intentionally absent here.
 *
 * Keep this list in sync with the user-facing columns of `db/schema/reviews.ts`.
 * Server/system fields are intentionally absent:
 *   oxyUserId, verified, moderationStatus, addressId, addressLevel,
 *   streetLevelId, buildingLevelId, unitLevelId, cityId, neighborhoodId,
 *   agencyId, livedForMonths, greenHouse, positiveComment, negativeComment.
 *
 * `helpfulVoters` and `reports` are not on that list because they are no longer
 * COLUMNS: `review_helpful_votes` and `review_reports` are separate tables with
 * their own write paths, so a request body naming either reaches nothing.
 */

/**
 * Fields a user may set when CREATING a review. The address hierarchy,
 * `cityId`/`neighborhoodId`, the resolved `agencyId`, `oxyUserId`,
 * `livedForMonths` and every moderation field are resolved / derived
 * server-side and are intentionally absent.
 */
export const CREATABLE_REVIEW_FIELDS: readonly string[] = [
  // Core
  'title',
  'price',
  'currency',
  'livedFrom',
  'livedTo',
  'rating',
  'recommendation',
  'opinion',
  'prosItems',
  'consItems',
  'adviceToAgency',
  'adviceToLandlord',
  // Write-only: resolved into agencyId server-side.
  'agencyName',
  'images',
  // Deposit outcome (enum).
  'depositReturned',
  // Dimension ratings.
  'summerTemperature',
  'winterTemperature',
  'noise',
  'light',
  'conditionAndMaintenance',
  'services',
  'landlordTreatment',
  'problemResponse',
  'staircaseNeighbors',
  'touristApartments',
  'neighborRelations',
  'cleaning',
  'areaTourists',
  'areaSecurity',
  'areaNoise',
  'areaCleanliness',
];

/**
 * Fields a user may change when UPDATING their review. Mirrors the creatable
 * set — the address is create-only (a review can't be re-homed), so it is not
 * editable; everything else the author supplied stays editable.
 */
export const EDITABLE_REVIEW_FIELDS: readonly string[] = [...CREATABLE_REVIEW_FIELDS];
