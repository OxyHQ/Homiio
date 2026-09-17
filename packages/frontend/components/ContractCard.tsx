/**
 * ContractCard — lease summary for the `/contracts` phone layout (wide web
 * shows the same rows in a Bloom DataTable).
 *
 * A pressable Bloom `Card` (outlined, radius-16) with Bloom Typography, Remix
 * icons in theme colours and a `ContractStatusBadge` Chip.
 */
import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '@homiio/shared-types';
import { Card } from '@oxy.so/bloom/card';
import { RiBuilding2Line, RiHome4Line, RiUserLine } from '@oxy.so/bloom/icons';
import { useTheme } from '@oxy.so/bloom/theme';
import { Text as BloomText, H3 } from '@oxy.so/bloom/typography';
import { useFormatting } from '@/utils/format';
import { radius, spacing } from '@/constants/styles';
import { ContractStatusBadge } from './ContractStatusBadge';
import { formatLocalized } from '@/utils/dateLocale';

export type ContractStatus =
  | 'draft'
  | 'pending'
  | 'pending_signatures'
  | 'active'
  | 'expired'
  | 'terminated'
  | 'cancelled';

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
}

const formatDate = (raw: string): string => {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return formatLocalized(date, 'MMM d, yyyy');
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
  currency = 'EUR',
  onPress,
}) => {
  const { t } = useTranslation();
  const { locale } = useFormatting();
  const { colors } = useTheme();

  const formattedRent = useMemo(
    () => formatMoney(monthlyRent, currency, locale),
    [currency, monthlyRent, locale],
  );

  const secondary = { color: colors.textSecondary };

  return (
    <Card
      variant="outlined"
      radius="radius-16"
      style={styles.surface}
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={onPress ? t('contracts.card.accessibility', { title }) : undefined}
    >
      <View style={styles.header}>
        <View style={styles.titleContainer}>
          <H3 style={styles.title} numberOfLines={1}>
            {title}
          </H3>
          <ContractStatusBadge status={status} />
        </View>
        <View style={styles.rentBlock}>
          <BloomText style={[styles.rentAmount, { color: colors.primary }]}>{formattedRent}</BloomText>
          <BloomText style={[styles.rentPeriod, secondary]}>{t('contracts.card.perMonth')}</BloomText>
        </View>
      </View>

      <View style={styles.iconRow}>
        <RiHome4Line width={16} height={16} fill={colors.icon} />
        <BloomText style={[styles.propertyName, secondary]} numberOfLines={1}>
          {propertyName}
        </BloomText>
      </View>

      <View style={[styles.datesContainer, { backgroundColor: colors.backgroundSecondary }]}>
        <View style={styles.dateRow}>
          <BloomText style={[styles.dateLabel, secondary]}>{t('contracts.card.start')}</BloomText>
          <BloomText style={styles.dateValue}>{formatDate(startDate)}</BloomText>
        </View>
        <View style={styles.dateRow}>
          <BloomText style={[styles.dateLabel, secondary]}>{t('contracts.card.end')}</BloomText>
          <BloomText style={styles.dateValue}>{formatDate(endDate)}</BloomText>
        </View>
      </View>

      <View style={styles.partiesContainer}>
        <View style={styles.iconRow}>
          <RiBuilding2Line width={16} height={16} fill={colors.icon} />
          <BloomText style={[styles.partyLabel, secondary]}>{t('contracts.card.landlord')}</BloomText>
          <BloomText style={styles.partyName} numberOfLines={1}>
            {landlordName}
          </BloomText>
        </View>
        <View style={styles.iconRow}>
          <RiUserLine width={16} height={16} fill={colors.icon} />
          <BloomText style={[styles.partyLabel, secondary]}>{t('contracts.card.tenant')}</BloomText>
          <BloomText style={styles.partyName} numberOfLines={1}>
            {tenantName}
          </BloomText>
        </View>
      </View>
    </Card>
  );
};

export default ContractCard;

const styles = StyleSheet.create({
  surface: {
    padding: spacing.lg,
    gap: spacing.sm,
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
    alignItems: 'flex-start',
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
  },
  rentPeriod: {
    fontSize: 13,
  },
  iconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  propertyName: {
    flex: 1,
    fontSize: 14,
  },
  datesContainer: {
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
  },
  dateValue: {
    fontSize: 12,
    fontWeight: '600',
  },
  partiesContainer: {
    gap: spacing.xs,
  },
  partyLabel: {
    fontSize: 13,
    minWidth: 64,
  },
  partyName: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
  },
});
