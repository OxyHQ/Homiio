import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useOxy } from '@oxyhq/services';
import type { User } from '@oxyhq/core';

/**
 * Resolve a set of Oxy user ids to their canonical Oxy {@link User} records in a
 * single batched request.
 *
 * Homiio's `Profile` stores `oxyUserId` (an Oxy *user* id), NOT a file id, so a
 * profile alone cannot render an avatar — the avatar file id lives on the Oxy
 * `User` (`user.avatar`). This hook batches every distinct `oxyUserId` through
 * `oxyServices.getUsersByIds()` (chunked + deduped in the SDK) so a list of N
 * applicants/landlords costs one round trip instead of N, then exposes a
 * lookup of `oxyUserId → User`.
 *
 * Pair the returned `getAvatarFileId(oxyUserId)` with a Bloom `Avatar`
 * `source` + `variant` and the app-wide `ImageResolverProvider` (registered in
 * the root layout): the resolver turns the file id into the canonical Oxy
 * media URL via `getFileDownloadUrl`, the single media chokepoint.
 */
export function useOxyAvatars(oxyUserIds: ReadonlyArray<string | undefined | null>) {
  const { oxyServices } = useOxy();

  // Stable, deduped list of non-empty ids; sorted so the query key is
  // order-insensitive and identical id sets share a cache entry.
  const ids = useMemo(() => {
    const set = new Set<string>();
    for (const id of oxyUserIds) {
      if (typeof id === 'string' && id.length > 0) set.add(id);
    }
    return Array.from(set).sort();
  }, [oxyUserIds]);

  const query = useQuery<User[]>({
    queryKey: ['oxy-users-by-ids', ids],
    queryFn: () => oxyServices.getUsersByIds([...ids]),
    enabled: ids.length > 0,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
  });

  const usersById = useMemo(() => {
    const map = new Map<string, User>();
    for (const user of query.data ?? []) {
      if (user?.id) map.set(user.id, user);
    }
    return map;
  }, [query.data]);

  return useMemo(
    () => ({
      usersById,
      isLoading: query.isLoading,
      /** The Oxy file id for a user's avatar, or `undefined` when unavailable. */
      getAvatarFileId: (oxyUserId: string | undefined | null): string | undefined => {
        if (!oxyUserId) return undefined;
        return usersById.get(oxyUserId)?.avatar ?? undefined;
      },
    }),
    [usersById, query.isLoading],
  );
}
