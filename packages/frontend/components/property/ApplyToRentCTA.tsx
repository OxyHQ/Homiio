/**
 * Long-term mode apply surface on the property detail screen.
 *
 * Flat content (no card chrome): the surface — `BaseWidget` in the desktop
 * right column, a `Section` on mobile — owns the border/background/radius, and
 * `BookingCard` owns the price header above this. This component renders the
 * Idealista-style application entry: a compact price/requirements line, an
 * inline move-in date field (reusing the same `AvailabilityCalendar` the
 * vacation path uses), and the primary "Apply to rent" button. The full
 * application (income, references, documents) is still collected on
 * `/properties/[id]/apply`; the chosen move-in date is passed through as a
 * param so the user doesn't re-enter it.
 *
 * When the user already has an active application on this property, the CTA
 * swaps for a "View status" deep link so the apply form isn't offered twice.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { Ionicons } from '@expo/vector-icons';

import { Button } from '@oxyhq/bloom/button';
import { Text as BloomText, H3 } from '@oxyhq/bloom/typography';
import { showSignInModal, useOxy } from '@oxyhq/services';

import {
  AvailabilityCalendar,
  type AvailabilityCalendarRange,
} from '@/components/AvailabilityCalendar';
import { useActiveApplicationForProperty } from '@/hooks/useApplicationQueries';
import { resolveHeadlinePrice } from '@/utils/propertyPricing';
import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';
import { type Property } from '@homiio/shared-types';

interface ApplyToRentCTAProps {
  property: Property;
}

/** Format a `Date` as the `YYYY-MM-DD` string the apply form expects. */
const toIsoDay = (date: Date): string => format(date, 'yyyy-MM-dd');

export const ApplyToRentCTA: React.FC<ApplyToRentCTAProps> = ({ property }) => {
  const router = useRouter();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { isAuthenticated } = useOxy();

  const propertyId = String(property._id ?? property.id ?? '');

  const activeApplicationQuery = useActiveApplicationForProperty(
    isAuthenticated ? propertyId : undefined,
  );
  const activeApplication = activeApplicationQuery.data ?? null;

  const [calendarOpen, setCalendarOpen] = useState(false);
  const [moveInDate, setMoveInDate] = useState<Date | null>(null);

  // Compact price/requirements line — same headline rule as the rest of the
  // detail surfaces (the active mode's priced block; long-term here).
  const { priceLabel } = useMemo(
    () => resolveHeadlinePrice(property, 'long_term', t),
    [property, t],
  );

  const openCalendar = useCallback(() => setCalendarOpen(true), []);
  const closeCalendar = useCallback(() => setCalendarOpen(false), []);

  // Long-term needs a single move-in date, not a stay range, so we read the
  // first tapped day off the calendar's selection and close immediately.
  const handleSelectMoveIn = useCallback(
    (range: AvailabilityCalendarRange | null) => {
      if (range) {
        setMoveInDate(range.checkIn);
        setCalendarOpen(false);
      }
    },
    [],
  );

  const handleApply = useCallback(() => {
    if (!isAuthenticated) {
      showSignInModal();
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

  const moveInLabel = moveInDate
    ? format(moveInDate, 'MMM d, yyyy')
    : t('applications.cta.addMoveIn');

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
          <View style={styles.metaItem}>
            <Ionicons
              name="pricetag-outline"
              size={14}
              color={colors.COLOR_BLACK_LIGHT_3}
            />
            <BloomText style={styles.metaText}>{priceLabel}</BloomText>
          </View>
        </View>
      ) : null}

      <Pressable
        onPress={openCalendar}
        accessibilityRole="button"
        accessibilityLabel={t('applications.field.moveInDate')}
        style={styles.moveInField}
      >
        <BloomText style={styles.moveInLabel}>
          {t('applications.field.moveInDate')}
        </BloomText>
        <View style={styles.moveInValueRow}>
          <BloomText
            style={[styles.moveInValue, !moveInDate && styles.moveInPlaceholder]}
            numberOfLines={1}
          >
            {moveInLabel}
          </BloomText>
          <Ionicons
            name="calendar-outline"
            size={18}
            color={colors.COLOR_BLACK_LIGHT_3}
          />
        </View>
      </Pressable>

      <Button
        variant="primary"
        size="medium"
        onPress={handleApply}
        style={styles.button}
      >
        {t('applications.cta.apply')}
      </Button>

      <Modal
        visible={calendarOpen}
        animationType={Platform.OS === 'web' ? 'fade' : 'slide'}
        transparent={Platform.OS === 'web'}
        onRequestClose={closeCalendar}
      >
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.modalSurface,
              Platform.OS === 'web' ? null : { paddingBottom: spacing.lg + insets.bottom },
            ]}
          >
            <View style={styles.modalHeader}>
              <H3 style={styles.modalTitle}>
                {t('applications.field.moveInDate')}
              </H3>
              <Button
                variant="icon"
                size="small"
                onPress={closeCalendar}
                accessibilityLabel={t('common.close')}
              >
                {'×'}
              </Button>
            </View>
            <AvailabilityCalendar
              mode="modal"
              selectionMode="single"
              initialRange={moveInDate ? { checkIn: moveInDate, checkOut: moveInDate } : null}
              onChange={handleSelectMoveIn}
              hideActions
            />
          </View>
        </View>
      </Modal>
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
    flexWrap: 'wrap',
    gap: spacing.lg,
    marginTop: spacing.xs,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  metaText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
  },
  moveInField: {
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 2,
    marginTop: spacing.xs,
  },
  moveInLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.COLOR_BLACK_LIGHT_3,
    textTransform: 'uppercase',
  },
  moveInValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  moveInValue: {
    flex: 1,
    fontSize: 14,
    color: colors.COLOR_BLACK,
  },
  moveInPlaceholder: {
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  button: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: Platform.OS === 'web' ? 'center' : 'flex-end',
    alignItems: 'center',
  },
  modalSurface: {
    backgroundColor: colors.white,
    width: '100%',
    maxWidth: 720,
    maxHeight: '92%',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderBottomLeftRadius: Platform.OS === 'web' ? radius.xl : 0,
    borderBottomRightRadius: Platform.OS === 'web' ? radius.xl : 0,
    padding: spacing.lg,
    gap: spacing.md,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
});

export default ApplyToRentCTA;
