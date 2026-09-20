/**
 * What a person's guest points actually stand at (#518 §7.5, #519 §7.5).
 *
 * ## The one thing this component must never do
 *
 * Show a balance nobody earned. #518 §7.5 forbids the "saldo ficticio" — a
 * welcome grant dressed as a balance — so a new member sees zero, and sees the
 * honest sentence that goes with it: *you need to host before you can stay*.
 * There is no placeholder number, no "coming soon", and no simulated activity.
 *
 * ## Available is not balance, and the difference is on screen
 *
 * A point reserved against a request nobody has answered is neither spent nor
 * spendable. Showing only the total would tell somebody they have three points
 * and then refuse the stay they try to book with them, which is the worst
 * possible order to learn it in. The reserved figure is drawn whenever it is
 * non-zero, and the number offered as "you can book with" is `available`.
 *
 * Every figure comes from the server's derived standing. This component does no
 * arithmetic of its own — a second definition of "available" is precisely what
 * `guestPointStanding` exists to prevent.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@oxy.so/bloom/theme';
import { P, Text as BloomText } from '@oxy.so/bloom/typography';

import { useGuestPoints } from '@/hooks/useGuestPointsQueries';
import { spacing } from '@/constants/styles';

export interface GuestPointsSummaryProps {
  /** Hide the movement breakdown, for a compact placement. */
  readonly compact?: boolean;
}

export function GuestPointsSummary({
  compact = false,
}: GuestPointsSummaryProps): React.ReactElement | null {
  const { t } = useTranslation();
  const theme = useTheme();
  const { data, isLoading, error } = useGuestPoints();

  // Nothing at all while it loads: a zero rendered before the answer arrives is
  // indistinguishable from a real zero, and this is the one number where that
  // confusion costs somebody a trip they could have booked.
  if (isLoading) return null;

  if (error || !data) {
    return (
      <View style={styles.container}>
        <P style={{ color: theme.colors.textSecondary }}>
          {t('guestPoints.errors.loadFailed')}
        </P>
      </View>
    );
  }

  const { balance } = data;

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: theme.colors.backgroundSecondary, borderColor: theme.colors.border },
      ]}
    >
      <BloomText style={[styles.heading, { color: theme.colors.text }]}>
        {t('guestPoints.title')}
      </BloomText>

      {balance.neverMoved ? (
        <P style={{ color: theme.colors.textSecondary }}>{t('guestPoints.empty.body')}</P>
      ) : (
        <>
          <BloomText style={[styles.figure, { color: theme.colors.text }]}>
            {t('guestPoints.available', { count: balance.available })}
          </BloomText>
          {balance.reserved > 0 ? (
            <P style={{ color: theme.colors.textSecondary }}>
              {t('guestPoints.reserved', { count: balance.reserved })}
            </P>
          ) : null}
          {balance.available <= 0 ? (
            <P style={{ color: theme.colors.textSecondary }}>{t('guestPoints.needToHost')}</P>
          ) : null}
          {compact ? null : (
            <P style={{ color: theme.colors.textSecondary }}>
              {t('guestPoints.breakdown', { earned: balance.earned, spent: balance.spent })}
            </P>
          )}
        </>
      )}

      {/* The rule itself, stated on the surface rather than assumed. A points
          system whose exchange rate is invisible is one people guess at. */}
      <P style={[styles.rule, { color: theme.colors.textSecondary }]}>
        {t('guestPoints.rule')}
      </P>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  heading: {
    fontSize: 15,
    fontWeight: '600',
  },
  figure: {
    fontSize: 22,
    fontWeight: '700',
  },
  rule: {
    fontSize: 12,
    lineHeight: 17,
  },
});

export default GuestPointsSummary;
