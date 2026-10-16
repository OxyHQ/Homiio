import {
  deleteReview,
  getAddressReviewStats,
  getReview,
  listAddressReviews,
  listUserReviews,
  reportReview,
  ReviewRequestError,
  toggleReviewHelpful,
  updateReview,
  writeReview,
} from '../../domain/reviews';
import { AppError } from '../../middlewares/errorHandler';
import {
  type HomiioToolHandlers,
  optionalInteger,
  optionalString,
  requiredObject,
  requiredString,
} from './context';

/** A refusal that lists its reasons carries them in the tool error's message. */
async function withReasons<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ReviewRequestError && error.errors?.length) {
      throw new AppError(
        `${error.message}: ${error.errors.join('; ')}`,
        error.statusCode,
        error.code ?? 'VALIDATION_ERROR',
      );
    }
    throw error;
  }
}

const page = (input: Parameters<HomiioToolHandlers[string]>[0]) => ({
  page: optionalInteger(input, 'page'),
  limit: optionalInteger(input, 'limit'),
});

export const REVIEW_HANDLERS: HomiioToolHandlers = {
  listReviews: async (input, { accountId }) =>
    listAddressReviews(accountId, requiredString(input, 'addressId'), page(input)),
  getAddressReviewStats: async (input) => getAddressReviewStats(requiredString(input, 'addressId')),
  getReview: async (input, { accountId }) =>
    getReview(accountId, requiredString(input, 'reviewId')),
  listUserReviews: async (input, { accountId }) =>
    listUserReviews(accountId, requiredString(input, 'oxyUserId'), page(input)),
  writeReview: async (input, { accountId }) =>
    withReasons(() =>
      writeReview(accountId, {
        ...requiredObject(input, 'review'),
        address: requiredObject(input, 'address'),
      }),
    ),
  updateReview: async (input, { accountId }) =>
    withReasons(() =>
      updateReview(accountId, requiredString(input, 'reviewId'), requiredObject(input, 'changes')),
    ),
  deleteReview: async (input, { accountId }) => {
    await deleteReview(accountId, requiredString(input, 'reviewId'));
    return { message: 'Review deleted successfully' };
  },
  markReviewHelpful: async (input, { accountId }) =>
    toggleReviewHelpful(accountId, requiredString(input, 'reviewId')),
  reportReview: async (input, { accountId }) => {
    const outcome = await reportReview(accountId, requiredString(input, 'reviewId'), {
      reason: requiredString(input, 'reason'),
      details: optionalString(input, 'details'),
    });
    return { message: outcome.message, moderationStatus: outcome.moderationStatus };
  },
};
