import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from '@oxy.so/bloom/toast';
import { confirm } from '@oxy.so/bloom/surfaces';
import type { Reservation } from '@homiio/shared-types';
import { ReservationStatus } from '@homiio/shared-types/reservation';
import { useUpdateReservationCommand as useUpdateReservation } from '@/hooks/useReservationCommands';
import { accountOwnerKey, useAccountOwnerGuard } from '@/hooks/useAccountOwner';

type Decision = ReservationStatus.CONFIRMED | ReservationStatus.DECLINED;

/**
 * Approve / decline one pending reservation. Declining is confirmed first; the
 * outcome is reported by toast. Shared by the card footer and the table row.
 */
export function useReservationDecision(reservation: Reservation) {
  const { t } = useTranslation();
  const mutation = useUpdateReservation(reservation.id);
  const { owner, isCurrent } = useAccountOwnerGuard();
  const [, , epoch, instance, generation] = accountOwnerKey(owner);
  const ownerKey = JSON.stringify([epoch, instance, generation]);
  const [pending, setPending] = useState<{ ownerKey: string; target: Decision } | null>(null);
  const busy = pending?.ownerKey === ownerKey ? pending.target : null;

  const decide = useCallback(
    async (target: Decision) => {
      if (!isCurrent(owner) || mutation.isPending) return;
      if (target === ReservationStatus.DECLINED) {
        const ok = await confirm({
          title: t('reservations.detail.confirmDeclineTitle'),
          description: t('reservations.detail.confirmDeclineBody'),
          confirmLabel: t('host.reservations.decline'),
          cancelLabel: t('common.cancel'),
          destructive: true,
        });
        if (!ok || !isCurrent(owner)) return;
      }
      setPending({ ownerKey, target });
      try {
        await mutation.mutateAsync({ status: target });
        if (!isCurrent(owner)) return;
        toast.success(
          target === ReservationStatus.CONFIRMED
            ? t('host.reservations.toastConfirmed')
            : t('host.reservations.toastDeclined'),
        );
      } catch (error) {
        if (!isCurrent(owner)) return;
        toast.error(
          error instanceof Error ? error.message : t('host.reservations.toastUpdateFailed'),
        );
      } finally {
        if (isCurrent(owner)) setPending(null);
      }
    },
    [mutation, t, owner, ownerKey, isCurrent],
  );

  return { decide, busy, isPending: mutation.isPending };
}
