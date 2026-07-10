import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import {
  CreateExchangeRequestData,
  ExchangeRequest,
  ExchangeReview,
  UpdateExchangeRequestData,
} from '@homiio/shared-types';
import {
  CreateExchangeReviewBody,
  ExchangeRequestListResponse,
  ListExchangeRequestsParams,
  ProfileExchangeReviewsResponse,
  exchangeService,
} from '@/services/exchangeService';

const EXCHANGE_LIST_KEY = 'exchange-requests';
const EXCHANGE_DETAIL_KEY = 'exchange-request';
const EXCHANGE_REVIEWS_KEY = 'exchange-reviews';
const PROFILE_EXCHANGE_REVIEWS_KEY = 'profile-exchange-reviews';

const LIST_STALE_TIME = 1000 * 60;
const DETAIL_STALE_TIME = 1000 * 30;
const REVIEWS_STALE_TIME = 1000 * 60 * 5;

export const exchangeKeys = {
  list: (params: ListExchangeRequestsParams) => [EXCHANGE_LIST_KEY, params] as const,
  detail: (id: string) => [EXCHANGE_DETAIL_KEY, id] as const,
  requestReviews: (id: string) => [EXCHANGE_REVIEWS_KEY, id] as const,
  profileReviews: (profileId: string) =>
    [PROFILE_EXCHANGE_REVIEWS_KEY, profileId] as const,
};

/**
 * Listing query for exchange requests. Defaults to the guest view (requests I
 * made); pass `asHost: true` for the host inbox.
 */
export function useMyExchangeRequests(
  params: ListExchangeRequestsParams = {},
  options: { enabled?: boolean } = {},
): UseQueryResult<ExchangeRequestListResponse, Error> {
  return useQuery<ExchangeRequestListResponse, Error>({
    queryKey: exchangeKeys.list(params),
    queryFn: () => exchangeService.listMyRequests(params),
    enabled: options.enabled ?? true,
    staleTime: LIST_STALE_TIME,
  });
}

/** Single exchange request by id. Disabled until `id` is non-empty. */
export function useExchangeRequest(
  id: string | undefined,
): UseQueryResult<ExchangeRequest, Error> {
  return useQuery<ExchangeRequest, Error>({
    queryKey: exchangeKeys.detail(id ?? ''),
    queryFn: () => {
      if (!id) throw new Error('Exchange request id is required');
      return exchangeService.getRequest(id);
    },
    enabled: Boolean(id),
    staleTime: DETAIL_STALE_TIME,
  });
}

/** Both reviews tied to a single exchange (requester + host). */
export function useExchangeRequestReviews(
  id: string | undefined,
  options: { enabled?: boolean } = {},
): UseQueryResult<ExchangeReview[], Error> {
  return useQuery<ExchangeReview[], Error>({
    queryKey: exchangeKeys.requestReviews(id ?? ''),
    queryFn: () => {
      if (!id) throw new Error('Exchange request id is required');
      return exchangeService.getRequestReviews(id);
    },
    enabled: Boolean(id) && (options.enabled ?? true),
    staleTime: REVIEWS_STALE_TIME,
  });
}

/**
 * Exchange reviews where a profile is the SUBJECT — a trust signal surfaced on
 * the host/profile area. Carries an aggregate average rating + count in `meta`.
 */
export function useProfileExchangeReviews(
  profileId: string | undefined,
  params: { page?: number; limit?: number } = {},
  options: { enabled?: boolean } = {},
): UseQueryResult<ProfileExchangeReviewsResponse, Error> {
  return useQuery<ProfileExchangeReviewsResponse, Error>({
    queryKey: exchangeKeys.profileReviews(profileId ?? ''),
    queryFn: () => {
      if (!profileId) throw new Error('Profile id is required');
      return exchangeService.getProfileReviews(profileId, params);
    },
    enabled: Boolean(profileId) && (options.enabled ?? true),
    staleTime: REVIEWS_STALE_TIME,
  });
}

export function useCreateExchangeRequest(): UseMutationResult<
  ExchangeRequest,
  Error,
  CreateExchangeRequestData
> {
  const queryClient = useQueryClient();
  return useMutation<ExchangeRequest, Error, CreateExchangeRequestData>({
    mutationFn: (payload) => exchangeService.createRequest(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [EXCHANGE_LIST_KEY] });
    },
  });
}

export function useUpdateExchangeStatus(
  id: string,
): UseMutationResult<ExchangeRequest, Error, UpdateExchangeRequestData> {
  const queryClient = useQueryClient();
  return useMutation<ExchangeRequest, Error, UpdateExchangeRequestData>({
    mutationFn: (payload) => exchangeService.updateStatus(id, payload),
    onSuccess: (request) => {
      queryClient.setQueryData(exchangeKeys.detail(id), request);
      queryClient.invalidateQueries({ queryKey: [EXCHANGE_LIST_KEY] });
    },
  });
}

export function useCreateExchangeReview(
  id: string,
): UseMutationResult<ExchangeReview, Error, CreateExchangeReviewBody> {
  const queryClient = useQueryClient();
  return useMutation<ExchangeReview, Error, CreateExchangeReviewBody>({
    mutationFn: (body) => exchangeService.createReview(id, body),
    onSuccess: (review) => {
      queryClient.invalidateQueries({ queryKey: exchangeKeys.requestReviews(id) });
      queryClient.invalidateQueries({
        queryKey: exchangeKeys.profileReviews(String(review.subjectOxyUserId)),
      });
    },
  });
}
