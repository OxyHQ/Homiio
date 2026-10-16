import type { CatalogTool } from '@oxy.so/contracts';

import {
  actTool,
  enumInput,
  idInput,
  objectInput,
  openObjectInput,
  optionalTextInput,
  pageInput,
  readTool,
} from './define';

const REVIEW_REPORT_REASONS = ['fake', 'offensive', 'personal_data', 'spam', 'other'] as const;
const reviewPage = { type: 'integer', minimum: 1, maximum: 50 } as const;

const reviewAddress = {
  type: 'object',
  description:
    'The reviewed place. street, city, postal_code and country are required; number, floor, unit, building_name, state, countryCode, neighborhood, latitude and longitude (strings) are optional. Without coordinates the address is geocoded.',
  properties: {
    street: { type: 'string', minLength: 1, maxLength: 300 },
    number: { type: 'string', maxLength: 50 },
    building_name: { type: 'string', maxLength: 200 },
    floor: { type: 'string', maxLength: 50 },
    unit: { type: 'string', maxLength: 50 },
    postal_code: { type: 'string', minLength: 1, maxLength: 20 },
    city: { type: 'string', minLength: 1, maxLength: 200 },
    state: { type: 'string', maxLength: 200 },
    country: { type: 'string', minLength: 1, maxLength: 200 },
    countryCode: { type: 'string', maxLength: 3 },
    neighborhood: { type: 'string', maxLength: 200 },
    latitude: { type: 'string', maxLength: 40 },
    longitude: { type: 'string', maxLength: 40 },
  },
  required: ['street', 'city', 'postal_code', 'country'],
  additionalProperties: false,
} as const;

export const REVIEW_TOOLS: readonly CatalogTool[] = [
  readTool({
    name: 'listReviews',
    description:
      'Read the community reviews of one address at its level: a unit with its building summary, a building with its own and its units’ reviews, or a street aggregate. Removed reviews are never shown except to their author.',
    capability: 'housing.reviews.read',
    input: objectInput({ addressId: idInput, page: pageInput, limit: reviewPage }, ['addressId']),
  }),
  readTool({
    name: 'getAddressReviewStats',
    description:
      'Read only the review statistics (ratings, counts) of one address at its level, without the reviews themselves.',
    capability: 'housing.reviews.read',
    input: objectInput({ addressId: idInput }, ['addressId']),
  }),
  readTool({
    name: 'getReview',
    description: 'Read one review. A removed review answers not-found to everyone but its author.',
    capability: 'housing.reviews.read',
    input: objectInput({ reviewId: idInput }, ['reviewId']),
  }),
  readTool({
    name: 'listUserReviews',
    description:
      'List the reviews one person wrote, newest first. Pass the person’s own account id to see their own reviews, including removed ones.',
    capability: 'housing.reviews.read',
    input: objectInput({ oxyUserId: idInput, page: pageInput, limit: reviewPage }, ['oxyUserId']),
  }),
  actTool({
    name: 'writeReview',
    description:
      'Publish the person’s review of a building or a flat they lived in. One review per person per address; title ≥ 5 and opinion ≥ 10 characters. Owners of listings at that address are notified.',
    capability: 'housing.reviews.write',
    capabilityPackage: 'publish',
    input: objectInput(
      {
        address: reviewAddress,
        review: openObjectInput(
          'The review fields: title, opinion, rating, recommendation, price, currency, livedFrom, livedTo, prosItems, consItems, adviceToAgency, adviceToLandlord, agencyOxyAccountId, images, authorIdentity, depositReturned and the dimension ratings (noise, light, …). Anything else is ignored.',
        ),
      },
      ['address', 'review'],
    ),
  }),
  actTool({
    name: 'updateReview',
    description:
      'Edit the person’s own review (same fields as writeReview’s review object). Somebody else’s review answers not-found.',
    capability: 'housing.reviews.write',
    capabilityPackage: 'publish',
    input: objectInput(
      { reviewId: idInput, changes: openObjectInput('The review fields to change.') },
      ['reviewId', 'changes'],
    ),
  }),
  actTool({
    name: 'deleteReview',
    description: 'Delete the person’s own review. Somebody else’s review answers not-found.',
    capability: 'housing.reviews.write',
    capabilityPackage: 'administer',
    input: objectInput({ reviewId: idInput }, ['reviewId']),
  }),
  actTool({
    name: 'markReviewHelpful',
    description:
      'Toggle the person’s “helpful” vote on somebody else’s review (calling again removes it). Refuses the person’s own review. The author is told about a new vote.',
    capability: 'housing.reviews.vote',
    capabilityPackage: 'publish',
    rollback: 'supported',
    input: objectInput({ reviewId: idInput }, ['reviewId']),
  }),
  actTool({
    name: 'reportReview',
    description:
      'File the person’s community report against a review (fake, offensive, personal_data, spam or other — other needs details). Re-reporting is a no-op; three reports put a review under review. Nothing is removed by a report.',
    capability: 'housing.reviews.report',
    capabilityPackage: 'communicate',
    input: objectInput(
      {
        reviewId: idInput,
        reason: enumInput(REVIEW_REPORT_REASONS),
        details: optionalTextInput(500),
      },
      ['reviewId', 'reason'],
    ),
  }),
];
