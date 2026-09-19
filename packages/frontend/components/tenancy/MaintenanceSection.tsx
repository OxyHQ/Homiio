/**
 * The repairs section of a tenancy (#518 §7.1, #519 §7.1).
 *
 * ## What this replaces
 *
 * `app/my-home.tsx` used to say, in its own header: "The template also draws
 * repair requests, 'Pay rent' and 'Message landlord'; Homiio has no
 * maintenance, rent-payment or tenant–landlord messaging endpoint, so those are
 * absent rather than buttons that do nothing." Both epics reject that as an
 * ending, so the endpoint now exists and this is the surface for it.
 *
 * ## Every action offered is one the SERVER said is available
 *
 * `request.availableTransitions` is computed server-side from the caller's own
 * role and the current status, using the same table the repository validates
 * against. So a button is drawn only where pressing it can succeed — an offered
 * action that answers 409 is a worse experience than an action that is not
 * there, and it is the shape a client-side guess produces the moment the two
 * definitions drift.
 *
 * ## A conflict is not an error
 *
 * Pressing a stale button answers 409, and the mutation refetches rather than
 * showing a failure: the server knows something this screen does not, and the
 * right response is to show what actually happened. Only a genuine failure is
 * reported as one.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '@oxy.so/bloom/button';
import { RiAddLine } from '@oxy.so/bloom/icons';
import { MaintenanceRequestCard } from '@oxy.so/bloom/tenancy';
import { toast } from '@oxy.so/bloom/toast';
import { P } from '@oxy.so/bloom/typography';
import type { MaintenanceRequest, MaintenanceStatus } from '@homiio/shared-types';

import { EmptyState } from '@/components/ui/EmptyState';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { useMaintenanceRequests, useTransitionRepair } from '@/hooks/useMaintenanceQueries';
import { isTransitionConflict } from '@/services/maintenanceService';
import { spacing } from '@/constants/styles';

import { LeaseSectionTitle } from './LeaseSections';
import { maintenanceCardProps } from './maintenanceTenancy';

export interface MaintenanceSectionProps {
  readonly leaseId: string;
  /** Open the reporting form. The host owns the route. */
  readonly onReport: () => void;
  /** Open one request's thread. */
  readonly onOpenRequest: (id: string) => void;
}

/**
 * The action label for a transition.
 *
 * A VERB per destination status, not the status name: "Acknowledged" is not a
 * button, "I'll take a look" is. The keys are separate from
 * `maintenance.status.*` for exactly that reason — a screen that reused the
 * status words would draw a row of nouns.
 */
const ACTION_KEY: Record<MaintenanceStatus, string> = {
  open: 'maintenance.action.reopen',
  acknowledged: 'maintenance.action.acknowledge',
  scheduled: 'maintenance.action.schedule',
  resolved: 'maintenance.action.markResolved',
  closed: 'maintenance.action.close',
  declined: 'maintenance.action.decline',
};

/**
 * The one transition that needs a date, which an inline row cannot collect.
 *
 * Named rather than inlined so the omission below is a decision somebody can
 * find, and so the detail screen — which CAN ask for a date — offers exactly
 * the complement.
 */
export const NEEDS_A_DATE: MaintenanceStatus = 'scheduled';

export function MaintenanceSection({
  leaseId,
  onReport,
  onOpenRequest,
}: MaintenanceSectionProps): React.ReactElement {
  const { t } = useTranslation();
  const { data, isLoading, error } = useMaintenanceRequests({ leaseId });
  const transition = useTransitionRepair();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const requests = useMemo(() => data?.requests ?? [], [data]);

  const act = useCallback(
    (id: string, status: MaintenanceStatus) => {
      setPendingId(id);
      transition.mutate(
        { id, status },
        {
          onError: (mutationError) => {
            setPendingId(null);
            if (isTransitionConflict(mutationError)) {
              // The request moved on. The mutation has already refetched, so
              // the screen is about to show the truth; saying "try again" here
              // would be advice for a different problem.
              toast.info(t('maintenance.errors.conflict'));
              return;
            }
            toast.error(t('maintenance.errors.transitionFailed'));
          },
          onSuccess: () => setPendingId(null),
        },
      );
    },
    [transition, t],
  );

  const header = (
    <LeaseSectionTitle
      title={t('maintenance.section.title')}
      action={
        <Button
          variant="secondary"
          size="small"
          leadingIcon={RiAddLine}
          onPress={onReport}
          accessibilityLabel={t('maintenance.action.reportAccessible')}
        >
          {t('maintenance.action.report')}
        </Button>
      }
    />
  );

  if (isLoading) {
    return (
      <View style={styles.section}>
        {header}
        <ListSkeleton rows={2} />
      </View>
    );
  }

  if (error) {
    // "We could not load this" is not "there is nothing here", and the two must
    // not render the same way — the same rule `homeSurfaceState` encodes.
    return (
      <View style={styles.section}>
        {header}
        <P style={styles.message}>{t('maintenance.errors.loadFailed')}</P>
      </View>
    );
  }

  return (
    <View style={styles.section}>
      {header}
      {requests.length === 0 ? (
        <EmptyState
          title={t('maintenance.empty.title')}
          description={t('maintenance.empty.body')}
          actionText={t('maintenance.action.report')}
          onAction={onReport}
        />
      ) : (
        <View style={styles.list}>
          {requests.map((request: MaintenanceRequest) => (
            <MaintenanceRequestCard
              key={request.id}
              {...maintenanceCardProps(request, { t })}
              onPressComments={() => onOpenRequest(request.id)}
              commentsLabel={(count) => t('maintenance.comments.count', { count })}
              actions={
                <View style={styles.actions}>
                  {(request.availableTransitions ?? [])
                    // `scheduled` needs a DATE, and this row has nowhere to ask
                    // for one. Offering it here would produce a 400 — a button
                    // that does nothing, which is precisely what both epics
                    // forbid. The detail screen can ask, so it offers it.
                    .filter((status) => status !== NEEDS_A_DATE)
                    .map((status) => (
                      <Button
                        key={status}
                        variant="secondary"
                        size="small"
                        disabled={pendingId === request.id}
                        onPress={() => act(request.id, status)}
                        accessibilityLabel={t(ACTION_KEY[status])}
                      >
                        {t(ACTION_KEY[status])}
                      </Button>
                    ))}
                  <Button
                    variant="ghost"
                    size="small"
                    onPress={() => onOpenRequest(request.id)}
                    accessibilityLabel={t('maintenance.action.openAccessible')}
                  >
                    {t('maintenance.action.open')}
                  </Button>
                </View>
              }
            />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.md,
  },
  list: {
    gap: spacing.md,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  message: {
    fontSize: 14,
  },
});
