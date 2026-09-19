/**
 * What is owed, what has settled, and what somebody has merely CLAIMED
 * (#518 §7.2, #519 §7.2).
 *
 * ## The one thing this screen must never do
 *
 * Render a declaration as a payment. #518 §7.2: "Un pago declarado por
 * transferencia debe identificarse como declarado/confirmado según su flujo, no
 * fingirse liquidado por un procesador", and "La UI no marca pagado por pulsar
 * un botón ni por volver de un checkout."
 *
 * So a tenant who presses "I've paid" sees their own sentence — *"you said you
 * sent €900; your landlord has not confirmed it"* — and the outstanding figure
 * does not move. Only a landlord's confirmation moves it, and the number comes
 * from the ledger rather than from anything this component computes.
 *
 * ## "Pay rent" is not here
 *
 * There is no processor, so there is no checkout to open. A button that started
 * one Homiio cannot settle would be the simulated success both epics forbid.
 * The honest affordance is the one that exists: declare a transfer, and let the
 * landlord confirm it. `docs/housing-parity.md` records the block.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '@oxy.so/bloom/button';
import { toast } from '@oxy.so/bloom/toast';
import { P } from '@oxy.so/bloom/typography';
import {
  formatMoney,
  leaseOutstandingTotal,
  type Lease,
  type LeaseObligationSummary,
  type LeasePaymentMovement,
} from '@homiio/shared-types';

import { ListSkeleton } from '@/components/ui/ListSkeleton';
import {
  useConfirmPayment,
  useDeclarePayment,
  useLeaseLedger,
  useRejectPayment,
} from '@/hooks/useLeaseLedgerQueries';
import { useFormatting } from '@/utils/format';
import { formatLocalized } from '@/utils/dateLocale';
import { spacing } from '@/constants/styles';

import { LeaseSectionTitle } from './LeaseSections';

export interface LeaseLedgerSectionProps {
  readonly lease: Lease;
  /** Which side of the lease the viewer is on, resolved by the host. */
  readonly viewerIsLandlord: boolean;
}

/** The obligation a summary describes, for its label and due date. */
function obligationOf(lease: Lease, obligationId: string) {
  return (lease.paymentSchedule ?? []).find((payment) => payment.id === obligationId);
}

export function LeaseLedgerSection({
  lease,
  viewerIsLandlord,
}: LeaseLedgerSectionProps): React.ReactElement | null {
  const { t } = useTranslation();
  const { locale } = useFormatting();
  const { data, isLoading, error } = useLeaseLedger(lease.id);
  const declare = useDeclarePayment(lease.id);
  const confirm = useConfirmPayment(lease.id);
  const reject = useRejectPayment(lease.id);
  const [busyId, setBusyId] = useState<string | null>(null);

  const currency = lease.rentDetails?.currency ?? 'EUR';
  const money = useCallback(
    (amount: number) => formatMoney(amount, currency, locale),
    [currency, locale],
  );

  const outstanding = useMemo(
    () => (data ? leaseOutstandingTotal(data.obligations) : 0),
    [data],
  );

  /** A tenant's claim awaiting the landlord, by obligation. */
  const pendingByObligation = useMemo(() => {
    const map = new Map<string, LeasePaymentMovement>();
    for (const movement of data?.movements ?? []) {
      if (movement.state === 'pending' && movement.direction === 'payment') {
        map.set(movement.obligationId, movement);
      }
    }
    return map;
  }, [data]);

  const run = useCallback(
    (id: string, work: Promise<unknown>, failureKey: string) => {
      setBusyId(id);
      work
        .catch(() => toast.error(t(failureKey)))
        .finally(() => setBusyId(null));
    },
    [t],
  );

  if (isLoading) {
    return (
      <View style={styles.section}>
        <LeaseSectionTitle title={t('ledger.section.title')} />
        <ListSkeleton rows={2} />
      </View>
    );
  }

  if (error || !data) {
    return (
      <View style={styles.section}>
        <LeaseSectionTitle title={t('ledger.section.title')} />
        {/* "We could not load this" is not "nothing is owed". */}
        <P style={styles.muted}>{t('ledger.errors.loadFailed')}</P>
      </View>
    );
  }

  if (data.obligations.length === 0) return null;

  return (
    <View style={styles.section}>
      <LeaseSectionTitle title={t('ledger.section.title')} />
      <P style={styles.total}>
        {t('ledger.section.outstanding', { amount: money(outstanding) })}
      </P>

      {data.obligations.map((summary: LeaseObligationSummary) => {
        const obligation = obligationOf(lease, summary.obligationId);
        const pending = pendingByObligation.get(summary.obligationId);
        const busy = busyId === summary.obligationId || busyId === pending?.id;

        return (
          <View key={summary.obligationId} style={styles.row}>
            <P style={styles.rowTitle}>
              {obligation?.dueDate
                ? formatLocalized(new Date(obligation.dueDate), 'LLLL yyyy')
                : t('contracts.detail.monthlyRent')}
            </P>

            <P style={styles.muted}>
              {summary.settled
                ? t('ledger.state.settled', { amount: money(summary.settledAmount) })
                : t('ledger.state.outstanding', {
                    outstanding: money(summary.outstandingAmount),
                    total: money(summary.amount),
                  })}
            </P>

            {/* The CLAIM, said as a claim. Never folded into the settled total,
                and never drawn with a tick. */}
            {summary.declaredAmount > 0 ? (
              <P style={styles.claim}>
                {t('ledger.state.declared', { amount: money(summary.declaredAmount) })}
              </P>
            ) : null}

            <View style={styles.actions}>
              {/* The tenant's only action: say they sent it. */}
              {!viewerIsLandlord && !summary.settled && !pending ? (
                <Button
                  variant="secondary"
                  size="small"
                  disabled={busy}
                  onPress={() =>
                    run(
                      summary.obligationId,
                      declare.mutateAsync({ obligationId: summary.obligationId }),
                      'ledger.errors.declareFailed',
                    )
                  }
                  accessibilityLabel={t('ledger.action.declareAccessible')}
                >
                  {t('ledger.action.declare')}
                </Button>
              ) : null}

              {/* The landlord's two answers to a claim. */}
              {viewerIsLandlord && pending ? (
                <>
                  <Button
                    variant="primary"
                    size="small"
                    disabled={busy}
                    onPress={() =>
                      run(
                        pending.id,
                        confirm.mutateAsync({ movementId: pending.id }),
                        'ledger.errors.confirmFailed',
                      )
                    }
                    accessibilityLabel={t('ledger.action.confirmAccessible')}
                  >
                    {t('ledger.action.confirm')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="small"
                    disabled={busy}
                    onPress={() =>
                      run(
                        pending.id,
                        reject.mutateAsync({
                          movementId: pending.id,
                          reason: t('ledger.action.rejectReason'),
                        }),
                        'ledger.errors.rejectFailed',
                      )
                    }
                    accessibilityLabel={t('ledger.action.rejectAccessible')}
                  >
                    {t('ledger.action.reject')}
                  </Button>
                </>
              ) : null}
            </View>
          </View>
        );
      })}

      {/* Said once, at the foot: Homiio cannot take the money itself yet, and
          nothing on this screen pretends otherwise. */}
      <P style={styles.muted}>{t('ledger.section.noProcessor')}</P>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.md },
  total: { fontSize: 15, fontWeight: '600' },
  row: { gap: spacing.xs },
  rowTitle: { fontSize: 14, fontWeight: '600' },
  claim: { fontSize: 13, opacity: 0.9 },
  muted: { fontSize: 13, opacity: 0.7 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingTop: spacing.xs },
});
