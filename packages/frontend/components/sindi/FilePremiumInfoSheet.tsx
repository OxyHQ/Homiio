import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button } from '@oxy.so/bloom/button';
import { Card } from '@oxy.so/bloom/card';
import { IconCircle } from '@oxy.so/bloom/icon-circle';
import { RiCheckboxCircleFill, RiLockLine, RiStarLine } from '@oxy.so/bloom/icons';
import { useTheme } from '@oxy.so/bloom/theme';
import { H3, Text } from '@oxy.so/bloom/typography';

export interface FilePremiumInfoSheetProps {
  onClose: () => void;
  onUpgrade: () => void;
}

/**
 * Bottom-sheet upsell shown when a non-subscriber (with no file credits) tries
 * to attach a document for AI analysis. Explains the pay-per-contract and
 * Homiio+ options and routes to the subscriptions screen on upgrade.
 */
export const FilePremiumInfoSheet: React.FC<FilePremiumInfoSheetProps> = ({
  onClose,
  onUpgrade,
}) => {
  const { colors } = useTheme();
  return (
    <View style={styles.sheet}>
      <IconCircle icon={RiLockLine} size="lg" style={styles.icon} />
      <H3 style={styles.center}>File analysis is premium</H3>
      <Text variant="body-2-regular" style={[styles.center, { color: colors.textSecondary }]}>
        Upload rental contracts and legal documents for instant analysis. Understand your rights and
        spot risky clauses in seconds.
      </Text>
      <Card variant="filled" style={styles.prices}>
        <View style={styles.priceRow}>
          <RiCheckboxCircleFill width={18} height={18} fill={colors.primary} />
          <Text variant="body-2-regular" style={{ color: colors.text }}>
            Pay per contract — 5 € per review
          </Text>
        </View>
        <View style={styles.priceRow}>
          <RiStarLine width={18} height={18} fill={colors.primary} />
          <Text variant="body-2-regular" style={{ color: colors.text }}>
            Homiio+ subscription — 9.99 €/mo
          </Text>
        </View>
        <Text variant="caption-1-regular" style={[styles.caption, { color: colors.textSecondary }]}>
          Includes up to 10 contracts per month, free.
        </Text>
      </Card>
      <View style={styles.actions}>
        <Button variant="secondary" size="medium" onPress={onClose} style={styles.action}>
          Maybe later
        </Button>
        <Button variant="primary" size="medium" onPress={onUpgrade} style={styles.action}>
          Upgrade to Homiio+
        </Button>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  sheet: {
    padding: 24,
    gap: 12,
  },
  icon: {
    alignSelf: 'center',
  },
  center: {
    textAlign: 'center',
  },
  prices: {
    padding: 12,
    gap: 8,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  caption: {
    marginLeft: 26,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  action: {
    flex: 1,
  },
});
