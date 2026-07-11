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
  CreateEvictionUpdateData,
  EvictionCase,
  EvictionComment,
  UpdateEvictionCaseData,
} from '@homiio/shared-types';
import {
  EvictionAttendResult,
  EvictionCommentListResponse,
  EvictionListResponse,
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

export const evictionKeys = {
  list: (params: ListEvictionsParams) => [EVICTION_LIST_KEY, params] as const,
  detail: (id: string) => [EVICTION_DETAIL_KEY, id] as const,
  comments: (id: string) => [EVICTION_COMMENTS_KEY, id] as const,
  attending: () => [EVICTION_ATTENDING_KEY] as const,
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
 * `usePropertySearch`): each `status`/`city` combination is its own cache entry
 * and paging reuses it. Omitting `status` lets the backend serve `upcoming`.
 */
export function useEvictions(
  params: ListEvictionsParams = {},
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
  EvictionCase,
  Error,
  CreateEvictionCaseData
> {
  const queryClient = useQueryClient();
  return useMutation<EvictionCase, Error, CreateEvictionCaseData>({
    mutationFn: (payload) => evictionService.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [EVICTION_LIST_KEY] });
    },
  });
}

export function useUpdateEviction(
  id: string,
): UseMutationResult<EvictionCase, Error, UpdateEvictionCaseData> {
  const queryClient = useQueryClient();
  return useMutation<EvictionCase, Error, UpdateEvictionCaseData>({
    mutationFn: (payload) => evictionService.update(id, payload),
    onSuccess: (updated) => {
      queryClient.setQueryData(evictionKeys.detail(id), updated);
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
      queryClient.invalidateQueries({ queryKey: [EVICTION_LIST_KEY] });
      queryClient.invalidateQueries({ queryKey: evictionKeys.attending() });
    },
  });
}

export function useCreateEvictionUpdate(
  id: string,
): UseMutationResult<EvictionCase, Error, CreateEvictionUpdateData> {
  const queryClient = useQueryClient();
  return useMutation<EvictionCase, Error, CreateEvictionUpdateData>({
    mutationFn: (payload) => evictionService.createUpdate(id, payload),
    onSuccess: (updated) => {
      queryClient.setQueryData(evictionKeys.detail(id), updated);
      queryClient.invalidateQueries({ queryKey: [EVICTION_LIST_KEY] });
    },
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
