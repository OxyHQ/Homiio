/**
 * ContractCard — lease summary used by `/contracts` and shared list views.
 *
 * Stream Q polish:
 *   - Pressable card surface with withShadow('sm') and radius.lg.
 *   - Bloom Typography for every label / value, no raw <Text>.
 *   - Inline Bloom Button actions for share / download (when provided).
 */
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@oxyhq/bloom/button';
import { Text as BloomText, H3 } from '@oxyhq/bloom/typography';
import { colors } from '@/styles/colors';
import { radius, spacing, withShadow } from '@/constants/styles';
import { StatusBadge, type StatusType } from './ui/StatusBadge';

export type ContractStatus =
  | 'draft'
  | 'pending'
  | 'pending_signature'
  | 'active'
  | 'expired'
  | 'terminated';

interface ContractCardProps {
  id: string;
  title: string;
  propertyId: string;
  propertyName: string;
  startDate: string;
  endDate: string;
  status: ContractStatus;
  landlordName: string;
  tenantName: string;
  monthlyRent: number;
  currency?: string;
  onPress?: () => void;
  onSharePress?: () => void;
  onDownloadPress?: () => void;
}

const formatDate = (raw: string): string => {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

export const ContractCard: React.FC<ContractCardProps> = ({
  title,
  propertyName,
  startDate,
  endDate,
  status,
  landlordName,
  tenantName,
  monthlyRent,
  currency = '€',
  onPress,
  onSharePress,
  onDownloadPress,
}) => {
  const [pressed, setPressed] = useState(false);

  const formattedRent = useMemo(
    () => `${currency}${monthlyRent.toLocaleString()}`,
    [currency, monthlyRent],
  );

  const body = (
    <>
      <View style={styles.header}>
        <View style={styles.titleContainer}>
          <H3 style={styles.title} numberOfLines={1}>
            {title}
          </H3>
          <StatusBadge status={status as StatusType} size="small" />
        </View>
        <View style={styles.rentBlock}>
          <BloomText style={styles.rentAmount}>{formattedRent}</BloomText>
          <BloomText style={styles.rentPeriod}> / month</BloomText>
        </View>
      </View>

      <View style={styles.propertyRow}>
        <Ionicons
          name="home-outline"
          size={16}
          color={colors.COLOR_BLACK_LIGHT_2}
        />
        <BloomText style={styles.propertyName} numberOfLines={1}>
          {propertyName}
        </BloomText>
      </View>

      <View style={styles.datesContainer}>
        <View style={styles.dateRow}>
          <BloomText style={styles.dateLabel}>Start</BloomText>
          <BloomText style={styles.dateValue}>{formatDate(startDate)}</BloomText>
        </View>
        <View style={styles.dateRow}>
          <BloomText style={styles.dateLabel}>End</BloomText>
          <BloomText style={styles.dateValue}>{formatDate(endDate)}</BloomText>
        </View>
      </View>

      <View style={styles.partiesContainer}>
        <View style={styles.partyRow}>
          <Ionicons
            name="business-outline"
            size={16}
            color={colors.COLOR_BLACK_LIGHT_2}
          />
          <BloomText style={styles.partyLabel}>Landlord</BloomText>
          <BloomText style={styles.partyName} numberOfLines={1}>
            {landlordName}
          </BloomText>
        </View>
        <View style={styles.partyRow}>
          <Ionicons
            name="person-outline"
            size={16}
            color={colors.COLOR_BLACK_LIGHT_2}
          />
          <BloomText style={styles.partyLabel}>Tenant</BloomText>
          <BloomText style={styles.partyName} numberOfLines={1}>
            {tenantName}
          </BloomText>
        </View>
      </View>
    </>
  );

  return (
    <View style={styles.container}>
      {onPress ? (
        <Pressable
          onPress={onPress}
          onPressIn={() => setPressed(true)}
          onPressOut={() => setPressed(false)}
          style={[
            styles.bodyPressable,
            pressed && styles.containerPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Contract ${title}`}
        >
          {body}
        </Pressable>
      ) : (
        <View style={styles.bodyPressable}>{body}</View>
      )}

      {(onSharePress || onDownloadPress) && (
        <View style={styles.actionsContainer}>
          {onSharePress ? (
            <Button
              variant="secondary"
              size="small"
              onPress={onSharePress}
              icon={
                <Ionicons
                  name="share-outline"
                  size={16}
                  color={colors.COLOR_BLACK}
                />
              }
            >
              Share
            </Button>
          ) : null}
          {onDownloadPress ? (
            <Button
              variant="secondary"
              size="small"
              onPress={onDownloadPress}
              icon={
                <Ionicons
                  name="download-outline"
                  size={16}
                  color={colors.COLOR_BLACK}
                />
              }
            >
              Download
            </Button>
          ) : null}
        </View>
      )}
    </View>
  );
};

export default ContractCard;

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    ...withShadow('sm'),
  },
  bodyPressable: {
    gap: spacing.sm,
  },
  containerPressed: {
    opacity: 0.8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  titleContainer: {
    flex: 1,
    gap: spacing.xs,
  },
  title: {
    fontSize: 17,
    letterSpacing: -0.2,
  },
  rentBlock: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  rentAmount: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.primaryColor,
  },
  rentPeriod: {
    fontSize: 13,
    color: colors.muted,
  },
  propertyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  propertyName: {
    flex: 1,
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_2,
  },
  datesContainer: {
    backgroundColor: colors.mutedSubtle,
    padding: spacing.md,
    borderRadius: radius.md,
    gap: spacing.xs,
  },
  dateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  dateLabel: {
    fontSize: 12,
    color: colors.muted,
  },
  dateValue: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
  },
  partiesContainer: {
    gap: spacing.xs,
  },
  partyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  partyLabel: {
    fontSize: 13,
    color: colors.muted,
    minWidth: 64,
  },
  partyName: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
  },
  actionsContainer: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
});
