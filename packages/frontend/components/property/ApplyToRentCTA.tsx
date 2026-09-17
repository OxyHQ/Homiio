/**
 * Long-term mode apply surface on the property detail screen.
 *
 * Flat content (no card chrome): the surface — `BaseWidget` in the desktop
 * right column, a `Section` on mobile — owns the border/background/radius, and
 * `BookingCard` owns the price header above this. This component renders the
 * Idealista-style application entry: a compact price/requirements line, a
 * move-in date picked with Bloom's `DatePicker` (a popover on web, a bottom
 * sheet on native), and the primary "Apply to rent" button. The full
 * application (income, references, documents) is still collected on
 * `/properties/[id]/apply`; the chosen move-in date is passed through as a
 * param so the user doesn't re-enter it.
 *
 * External listings (`isExternal`) never enter the in-app apply flow: the CTA
 * opens the source website instead, and says so when there is no `sourceUrl`.
 *
 * When the user already has an active application on this property, the CTA
 * swaps for a "View status" deep link so the apply form isn't offered twice.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { addMonths, format, startOfDay } from 'date-fns';

import { Button } from '@oxy.so/bloom/button';
import { DatePicker } from '@oxy.so/bloom/date-picker';
import { Field } from '@oxy.so/bloom/field';
import { RiExternalLinkLine, RiWallet3Line } from '@oxy.so/bloom/icons';
import { toast } from '@oxy.so/bloom/toast';
import { Text as BloomText } from '@oxy.so/bloom/typography';
import { openAccountDialog, useOxy } from '@oxy.so/services';

import { useActiveApplicationForProperty } from '@/hooks/useApplicationQueries';
import { resolveHeadlinePrice } from '@/utils/propertyPricing';
import { useFormatting } from '@/utils/format';
import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';
import { type Property } from '@homiio/shared-types';

interface ApplyToRentCTAProps {
  property: Property;
}

/** Format a `Date` as the `YYYY-MM-DD` string the apply form expects. */
const toIsoDay = (date: Date): string => format(date, 'yyyy-MM-dd');

/** How far ahead a move-in can be picked (matches the stay calendar). */
const MOVE_IN_HORIZON_MONTHS = 18;
/** Monday-first grid, like every other Homiio calendar. */
const WEEK_START = 1;

export const ApplyToRentCTA: React.FC<ApplyToRentCTAProps> = ({ property }) => {
  const router = useRouter();
  const { t } = useTranslation();
  const formatting = useFormatting();
  const { isAuthenticated } = useOxy();

  const propertyId = String(property.id ?? '');

  const activeApplicationQuery = useActiveApplicationForProperty(
    isAuthenticated ? propertyId : undefined,
  );
  const activeApplication = activeApplicationQuery.data ?? null;

  const [moveInDate, setMoveInDate] = useState<Date | null>(null);
  const [today] = useState(() => startOfDay(new Date()));
  const maxMoveIn = useMemo(() => addMonths(today, MOVE_IN_HORIZON_MONTHS), [today]);

  // Compact price/requirements line — same headline rule as the rest of the
  // detail surfaces (the active mode's priced block; long-term here).
  const { priceLabel } = useMemo(
    () => resolveHeadlinePrice(property, 'long_term', t, formatting),
    [property, t, formatting],
  );

  const handleApply = useCallback(() => {
    if (!isAuthenticated) {
      openAccountDialog();
      return;
    }
    router.push({
      pathname: '/properties/[id]/apply',
      params: {
        id: propertyId,
        ...(moveInDate ? { moveIn: toIsoDay(moveInDate) } : {}),
      },
    });
  }, [isAuthenticated, moveInDate, propertyId, router]);

  const handleViewStatus = useCallback(() => {
    if (!activeApplication) return;
    router.push({
      pathname: '/applications/[id]',
      params: { id: String(activeApplication.id) },
    });
  }, [activeApplication, router]);

  const handleOpenSource = useCallback(async () => {
    if (!property.sourceUrl) {
      toast.error(t('error.source.noUrl'));
      return;
    }
    try {
      await Linking.openURL(property.sourceUrl);
    } catch {
      toast.error(t('error.source.openFailed'));
    }
  }, [property.sourceUrl, t]);

  if (property.isExternal) {
    return (
      <View style={styles.content}>
        {priceLabel ? (
          <View style={styles.metaRow}>
            <RiWallet3Line width={14} height={14} fill={colors.COLOR_BLACK_LIGHT_3} />
            <BloomText style={styles.metaText}>{priceLabel}</BloomText>
          </View>
        ) : null}
        <Button
          variant="primary"
          size="medium"
          leadingIcon={RiExternalLinkLine}
          onPress={handleOpenSource}
          style={styles.button}
        >
          {t('listing.cta.viewOnSourceWebsite')}
        </Button>
      </View>
    );
  }

  if (activeApplication) {
    return (
      <View style={styles.content}>
        <BloomText style={styles.title}>
          {t('applications.detail.alreadySubmitted')}
        </BloomText>
        <BloomText style={styles.subtitle}>
          {t('applications.detail.alreadySubmittedBody')}
        </BloomText>
        <Button
          variant="primary"
          size="medium"
          onPress={handleViewStatus}
          style={styles.button}
        >
          {t('applications.detail.viewStatus')}
        </Button>
      </View>
    );
  }

  return (
    <View style={styles.content}>
      <BloomText style={styles.title}>
        {t('applications.cta.title')}
      </BloomText>
      <BloomText style={styles.subtitle}>
        {t('applications.cta.subtitle')}
      </BloomText>

      {priceLabel ? (
        <View style={styles.metaRow}>
          <RiWallet3Line width={14} height={14} fill={colors.COLOR_BLACK_LIGHT_3} />
          <BloomText style={styles.metaText}>{priceLabel}</BloomText>
        </View>
      ) : null}

      <Field label={t('applications.field.moveInDate')} style={styles.moveInField}>
        <DatePicker
          value={moveInDate}
          onChange={setMoveInDate}
          minDate={today}
          maxDate={maxMoveIn}
          weekStartsOn={WEEK_START}
          locale={formatting.locale}
          placeholder={t('applications.cta.addMoveIn')}
          accessibilityLabel={t('applications.field.moveInDate')}
        />
      </Field>

      <Button
        variant="primary"
        size="medium"
        onPress={handleApply}
        style={styles.button}
      >
        {t('applications.cta.apply')}
      </Button>
    </View>
  );
};

const styles = StyleSheet.create({
  content: {
    gap: spacing.sm,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
  },
  subtitle: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
    lineHeight: 18,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  metaText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
  },
  moveInField: {
    marginTop: spacing.xs,
  },
  button: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
  },
});

export default ApplyToRentCTA;
