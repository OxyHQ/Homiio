import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useMemo } from 'react';
import {
  CreateEvictionCaseData,
  CreateEvictionReportInput,
  CreateEvictionTimelineEventData,
  EvictionCase,
  EvictionComment,
  UpdateEvictionCaseData,
} from '@homiio/shared-types';
import {
  EvictionAttendResult,
  EvictionCommentListResponse,
  EvictionListResponse,
  EvictionWriteResult,
  JurisdictionResourcesResponse,
  ListEvictionsParams,
  evictionService,
} from '@/services/evictionService';

/** Page size for the board + comment infinite feeds. */
const PAGE_SIZE = 20;

const LIST_STALE_TIME = 1000 * 60;
const DETAIL_STALE_TIME = 1000 * 30;
const COMMENTS_STALE_TIME = 1000 * 30;

const EVICTION_LIST_KEY = 'evictions';
const EVICTION_DETAIL_KEY = 'eviction';
const EVICTION_COMMENTS_KEY = 'eviction-comments';
const EVICTION_ATTENDING_KEY = 'eviction-attending';
const EVICTION_FOLLOWING_KEY = 'eviction-following';
const EVICTION_RESOURCES_KEY = 'eviction-resources';

export const evictionKeys = {
  list: (params: ListEvictionsParams) => [EVICTION_LIST_KEY, params] as const,
  detail: (id: string) => [EVICTION_DETAIL_KEY, id] as const,
  comments: (id: string) => [EVICTION_COMMENTS_KEY, id] as const,
  attending: () => [EVICTION_ATTENDING_KEY] as const,
  following: () => [EVICTION_FOLLOWING_KEY] as const,
  resources: (countryCode: string, regionId?: string) =>
    [EVICTION_RESOURCES_KEY, countryCode, regionId ?? null] as const,
};

export type EvictionsInfiniteResult = UseInfiniteQueryResult<
  InfiniteData<EvictionListResponse>,
  Error
> & {
  /** All loaded cases flattened across pages. */
  cases: EvictionCase[];
  /** Total match count reported by the server. */
  total: number;
};

/**
 * Paginated public board feed. Page-based `useInfiniteQuery` (mechanics mirror
 * `usePropertySearch`): each scope + filter combination is its own cache entry
 * and paging reuses it.
 *
 * `params.scope` is REQUIRED, and a caller with no resolved location must pass
 * `enabled: false` rather than a placeholder scope — the server refuses a
 * scope-less request, and inventing `global` here to keep a spinner moving is
 * exactly the silent widening ADR 0002 forbids.
 */
export function useEvictions(
  params: ListEvictionsParams,
  options: { enabled?: boolean } = {},
): EvictionsInfiniteResult {
  const key = useMemo(() => evictionKeys.list(params), [params]);

  const result = useInfiniteQuery<EvictionListResponse, Error>({
    queryKey: key,
    initialPageParam: 1,
    enabled: options.enabled ?? true,
    staleTime: LIST_STALE_TIME,
    queryFn: ({ pageParam }) =>
      evictionService.list({ ...params, page: pageParam as number, limit: PAGE_SIZE }),
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.pagination.page + 1 : undefined,
  });

  const cases = useMemo<EvictionCase[]>(
    () => result.data?.pages.flatMap((page) => page.items) ?? [],
    [result.data],
  );
  const total = result.data?.pages[0]?.pagination.total ?? 0;

  return { ...result, cases, total };
}

/** Single case by id. Disabled until `id` is non-empty. */
export function useEvictionDetail(
  id: string | undefined,
): UseQueryResult<EvictionCase, Error> {
  return useQuery<EvictionCase, Error>({
    queryKey: evictionKeys.detail(id ?? ''),
    queryFn: () => {
      if (!id) throw new Error('Eviction case id is required');
      return evictionService.getById(id);
    },
    enabled: Boolean(id),
    staleTime: DETAIL_STALE_TIME,
  });
}

export type EvictionCommentsInfiniteResult = UseInfiniteQueryResult<
  InfiniteData<EvictionCommentListResponse>,
  Error
> & {
  comments: EvictionComment[];
  total: number;
};

/** Paginated public comment thread for a case (newest-first). */
export function useEvictionComments(
  id: string | undefined,
): EvictionCommentsInfiniteResult {
  const result = useInfiniteQuery<EvictionCommentListResponse, Error>({
    queryKey: evictionKeys.comments(id ?? ''),
    initialPageParam: 1,
    enabled: Boolean(id),
    staleTime: COMMENTS_STALE_TIME,
    queryFn: ({ pageParam }) => {
      if (!id) throw new Error('Eviction case id is required');
      return evictionService.listComments(id, pageParam as number, PAGE_SIZE);
    },
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.pagination.page + 1 : undefined,
  });

  const comments = useMemo<EvictionComment[]>(
    () => result.data?.pages.flatMap((page) => page.items) ?? [],
    [result.data],
  );
  const total = result.data?.pages[0]?.pagination.total ?? 0;

  return { ...result, comments, total };
}

/** Cases the caller RSVP'd to. Only runs when authenticated. */
export function useMyAttendingEvictions(
  options: { enabled?: boolean } = {},
): UseQueryResult<EvictionListResponse, Error> {
  return useQuery<EvictionListResponse, Error>({
    queryKey: evictionKeys.attending(),
    queryFn: () => evictionService.myAttending(),
    enabled: options.enabled ?? true,
    staleTime: LIST_STALE_TIME,
  });
}

export function useCreateEviction(): UseMutationResult<
  EvictionWriteResult,
  Error,
  CreateEvictionCaseData
> {
  const queryClient = useQueryClient();
  return useMutation<EvictionWriteResult, Error, CreateEvictionCaseData>({
    mutationFn: (payload) => evictionService.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [EVICTION_LIST_KEY] });
    },
  });
}

export function useUpdateEviction(
  id: string,
): UseMutationResult<EvictionWriteResult, Error, UpdateEvictionCaseData> {
  const queryClient = useQueryClient();
  return useMutation<EvictionWriteResult, Error, UpdateEvictionCaseData>({
    mutationFn: (payload) => evictionService.update(id, payload),
    onSuccess: (result) => {
      queryClient.setQueryData(evictionKeys.detail(id), result.eviction);
      queryClient.invalidateQueries({ queryKey: [EVICTION_LIST_KEY] });
    },
  });
}

/**
 * Optimistic RSVP toggle. Flips `isAttending` and nudges `attendeeCount` on the
 * cached detail immediately, rolls back on error, and reconciles with the
 * server's authoritative count on success. Invalidates the board + attending
 * lists so aggregate counts refresh.
 */
export function useToggleAttend(
  id: string,
): UseMutationResult<EvictionAttendResult, Error, void, { previous?: EvictionCase }> {
  const queryClient = useQueryClient();
  return useMutation<EvictionAttendResult, Error, void, { previous?: EvictionCase }>({
    mutationFn: () => evictionService.toggleAttend(id),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: evictionKeys.detail(id) });
      const previous = queryClient.getQueryData<EvictionCase>(evictionKeys.detail(id));
      if (previous) {
        const nextAttending = !previous.isAttending;
        queryClient.setQueryData<EvictionCase>(evictionKeys.detail(id), {
          ...previous,
          isAttending: nextAttending,
          attendeeCount: Math.max(0, previous.attendeeCount + (nextAttending ? 1 : -1)),
        });
      }
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(evictionKeys.detail(id), context.previous);
      }
    },
    onSuccess: (result) => {
      const current = queryClient.getQueryData<EvictionCase>(evictionKeys.detail(id));
      if (current) {
        queryClient.setQueryData<EvictionCase>(evictionKeys.detail(id), {
          ...current,
          isAttending: result.attending,
          attendeeCount: result.attendeeCount,
        });
      }
    },
    onSettled: () => {
      // Refetch the detail: the server gates organiser contact behind a
      // CONFIRMED supporter (an RSVP plus the ADR 0003 §7.3.1 second factor), so
      // whether this RSVP unlocked anything is the server's answer and not one
      // this cache can compute.
      queryClient.invalidateQueries({ queryKey: evictionKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: [EVICTION_LIST_KEY] });
      queryClient.invalidateQueries({ queryKey: evictionKeys.attending() });
    },
  });
}

export function useCreateEvictionUpdate(
  id: string,
): UseMutationResult<EvictionWriteResult, Error, CreateEvictionTimelineEventData> {
  const queryClient = useQueryClient();
  return useMutation<EvictionWriteResult, Error, CreateEvictionTimelineEventData>({
    mutationFn: (payload) => evictionService.createUpdate(id, payload),
    onSuccess: (result) => {
      queryClient.setQueryData(evictionKeys.detail(id), result.eviction);
      queryClient.invalidateQueries({ queryKey: [EVICTION_LIST_KEY] });
    },
  });
}

/**
 * Follow / unfollow a case.
 *
 * Deliberately NOT folded into {@link useToggleAttend}: "I will be there" and
 * "tell me if the date moves" are different statements, and a board that
 * conflates them either spams people who only wanted to watch or inflates the
 * turnout number the whole page exists to report.
 */
export function useToggleFollow(
  id: string,
): UseMutationResult<{ following: boolean }, Error, void, { previous?: EvictionCase }> {
  const queryClient = useQueryClient();
  return useMutation<{ following: boolean }, Error, void, { previous?: EvictionCase }>({
    mutationFn: () => evictionService.toggleFollow(id),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: evictionKeys.detail(id) });
      const previous = queryClient.getQueryData<EvictionCase>(evictionKeys.detail(id));
      if (previous) {
        queryClient.setQueryData<EvictionCase>(evictionKeys.detail(id), {
          ...previous,
          isFollowing: !previous.isFollowing,
        });
      }
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(evictionKeys.detail(id), context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: evictionKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: evictionKeys.following() });
    },
  });
}

/**
 * Legal and housing resources for a jurisdiction.
 *
 * Disabled without a country code rather than defaulting to one: showing a
 * Spanish tenant union to somebody in Ireland is worse than showing nothing,
 * and an empty list is a true answer this UI is built to render.
 */
export function useJurisdictionResources(
  countryCode: string | undefined,
  regionId?: string,
): UseQueryResult<JurisdictionResourcesResponse, Error> {
  return useQuery<JurisdictionResourcesResponse, Error>({
    queryKey: evictionKeys.resources(countryCode ?? '', regionId),
    queryFn: () => {
      if (!countryCode) throw new Error('A country code is required');
      return evictionService.resources(countryCode, regionId);
    },
    enabled: Boolean(countryCode),
    staleTime: LIST_STALE_TIME,
  });
}

export function useCreateEvictionComment(
  id: string,
): UseMutationResult<EvictionComment, Error, string> {
  const queryClient = useQueryClient();
  return useMutation<EvictionComment, Error, string>({
    mutationFn: (body) => evictionService.createComment(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: evictionKeys.comments(id) });
    },
  });
}

export function useDeleteEvictionComment(
  id: string,
): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (commentId) => evictionService.deleteComment(id, commentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: evictionKeys.comments(id) });
    },
  });
}

export function useReportEviction(
  id: string,
): UseMutationResult<void, Error, CreateEvictionReportInput> {
  return useMutation<void, Error, CreateEvictionReportInput>({
    mutationFn: (input) => evictionService.report(id, input),
  });
}
