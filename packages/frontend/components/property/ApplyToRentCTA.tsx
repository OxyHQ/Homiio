/**
 * Long-term mode apply surface on the property detail screen.
 *
 * Flat content (no card chrome): `BookingCard` owns the card and the price
 * header above this. This component renders the application entry: a move-in
 * date picked with Bloom's `DatePicker` (a popover on web, a bottom sheet on
 * native), and the primary "Apply to rent" button. The full
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
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { addMonths, format, startOfDay } from 'date-fns';

import { Button } from '@oxy.so/bloom/button';
import { DatePicker } from '@oxy.so/bloom/date-picker';
import { Field } from '@oxy.so/bloom/field';
import { Text as BloomText } from '@oxy.so/bloom/typography';
import { openAccountDialog, useOxy } from '@oxy.so/services';

import { useActiveApplicationForProperty } from '@/hooks/useApplicationQueries';
import { ExternalSourceButton } from '@/components/property/ExternalSourceButton';
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

  if (property.isExternal) {
    return <ExternalSourceButton property={property} />;
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
        <Button variant="primary" size="large" onPress={handleViewStatus}>
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

      <Button variant="primary" size="large" onPress={handleApply}>
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
  moveInField: {
    marginTop: spacing.xs,
  },
});

export default ApplyToRentCTA;
