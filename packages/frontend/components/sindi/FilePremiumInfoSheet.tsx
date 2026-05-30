import React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@oxyhq/bloom/button';
import { H3, Text as BloomText } from '@oxyhq/bloom/typography';
import { colors } from '@/styles/colors';
import { sindiStyles } from './styles';

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
}) => (
  <View style={sindiStyles.premiumSheet}>
    <View style={sindiStyles.premiumIconWrap}>
      <Ionicons name="lock-closed-outline" size={36} color={colors.primaryColor} />
    </View>
    <H3 style={sindiStyles.premiumTitle}>File analysis is premium</H3>
    <BloomText style={sindiStyles.premiumBody}>
      Upload rental contracts and legal documents for instant analysis. Understand your rights and
      spot risky clauses in seconds.
    </BloomText>
    <View style={sindiStyles.premiumPriceCard}>
      <View style={sindiStyles.premiumPriceRow}>
        <Ionicons name="checkmark-circle" size={18} color={colors.primaryColor} />
        <BloomText style={sindiStyles.premiumPriceLabel}>
          Pay per contract — 5 € per review
        </BloomText>
      </View>
      <View style={sindiStyles.premiumPriceRow}>
        <Ionicons name="star-outline" size={18} color={colors.primaryColor} />
        <BloomText style={sindiStyles.premiumPriceLabel}>
          Homiio+ subscription — 9.99 €/mo
        </BloomText>
      </View>
      <BloomText style={sindiStyles.premiumPriceCaption}>
        Includes up to 10 contracts per month, free.
      </BloomText>
    </View>
    <View style={sindiStyles.premiumActionRow}>
      <Button variant="secondary" size="medium" onPress={onClose} style={sindiStyles.premiumActionButton}>
        Maybe later
      </Button>
      <Button variant="primary" size="medium" onPress={onUpgrade} style={sindiStyles.premiumActionButton}>
        Upgrade to Homiio+
      </Button>
    </View>
  </View>
);
