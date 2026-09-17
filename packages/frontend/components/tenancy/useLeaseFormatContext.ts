import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Lease } from '@homiio/shared-types';

import { useOxyAvatars } from '@/hooks/useOxyAvatars';
import { useFormatting } from '@/utils/format';
import { leasePartyIds, type LeaseFormatContext } from './leaseTenancy';

/**
 * The formatting context for one or more leases, with every party resolved
 * through ONE batched Oxy lookup — a list of N leases costs one round trip, not
 * N. A party is its Oxy display name (or username) and avatar; an account that
 * does not resolve yields `null`, and the card leaves that party out.
 */
export function useLeaseFormatContext(leases: readonly (Lease | undefined)[]): LeaseFormatContext {
  const { t } = useTranslation();
  const { locale } = useFormatting();
  const ids = useMemo(() => leases.flatMap(leasePartyIds), [leases]);
  const { usersById } = useOxyAvatars(ids);

  return useMemo<LeaseFormatContext>(
    () => ({
      t,
      locale,
      resolveParty: (oxyUserId) => {
        const user = usersById.get(oxyUserId);
        const name = user?.name?.displayName?.trim() || user?.username;
        return name ? { name, avatar: user?.avatar ?? undefined } : null;
      },
    }),
    [t, locale, usersById],
  );
}
