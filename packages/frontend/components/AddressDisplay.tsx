import React from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Linking,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { ThemedText } from './ThemedText';
import { useTranslation } from 'react-i18next';
import * as Clipboard from 'expo-clipboard';
import { toast } from '@oxy.so/bloom/toast';
import * as Haptics from 'expo-haptics';
import { RiArrowRightSLine, RiFileCopyLine, RiMapPinFill, RiMapPinLine } from '@oxy.so/bloom/icons';
import { useTheme } from '@oxy.so/bloom/theme';

interface Address {
  street: string;
  city: string;
  state: string;
  zipCode: string;
  country?: string;
  coordinates?: {
    lat: number;
    lng: number;
  };
}

interface AddressDisplayProps {
  address: Address;
  variant?: 'compact' | 'detailed' | 'card';
  showActions?: boolean;
  showMap?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function AddressDisplay({
  address,
  variant = 'detailed',
  showActions = true,
  showMap = false,
  onPress,
  style,
}: AddressDisplayProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();

  const formattedAddress = `${address.street || ''}, ${address.city || ''}, ${address.state || ''} ${address.zipCode || ''}`;
  const shortAddress = `${address.city || ''}, ${address.state || ''}`;

  const handleCopyAddress = async () => {
    try {
      await Clipboard.setStringAsync(formattedAddress);
      toast.success(t('addresses.display.copySuccess'));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      toast.error(t('addresses.display.copyFailed'));
    }
  };

  const handleOpenInMaps = async () => {
    try {
      const url = Platform.select({
        ios: `maps://app?address=${encodeURIComponent(formattedAddress)}`,
        android: `geo:0,0?q=${encodeURIComponent(formattedAddress)}`,
        default: `https://maps.google.com/?q=${encodeURIComponent(formattedAddress)}`,
      });

      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      } else {
        await Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(formattedAddress)}`);
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (error) {
      toast.error(t('addresses.display.mapsFailed'));
    }
  };

  const handlePress = () => {
    if (onPress) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onPress();
    }
  };

  if (variant === 'compact') {
    return (
      <TouchableOpacity
        style={[styles.compactContainer, style]}
        onPress={handlePress}
        disabled={!onPress}
      >
        <RiMapPinLine width={16} height={16} fill={colors.textTertiary} />
        <ThemedText style={[styles.compactText, { color: colors.textTertiary }]} numberOfLines={1}>
          {shortAddress}
        </ThemedText>
        {onPress && <RiArrowRightSLine width={16} height={16} fill={colors.textTertiary} />}
      </TouchableOpacity>
    );
  }

  if (variant === 'card') {
    return (
      <View className="border-border bg-background" style={[styles.cardContainer, style]}>
        <View style={styles.cardHeader}>
          <View style={styles.addressInfo}>
            <RiMapPinFill width={20} height={20} fill={colors.primarySubtleForeground} />
            <View style={styles.addressTextContainer}>
              <ThemedText style={styles.cardStreet}>{address.street}</ThemedText>
              <ThemedText style={[styles.cardCityState, { color: colors.textTertiary }]}>
                {address.city}, {address.state} {address.zipCode}
              </ThemedText>
            </View>
          </View>
          {showActions && (
            <View style={styles.cardActions}>
              <TouchableOpacity
                className="bg-primary-subtle"
                style={styles.actionButton}
                onPress={handleCopyAddress}
              >
                <RiFileCopyLine width={16} height={16} fill={colors.primarySubtleForeground} />
              </TouchableOpacity>
              <TouchableOpacity
                className="bg-primary-subtle"
                style={styles.actionButton}
                onPress={handleOpenInMaps}
              >
                <RiMapPinLine width={16} height={16} fill={colors.primarySubtleForeground} />
              </TouchableOpacity>
            </View>
          )}
        </View>
        {showMap && address.coordinates && (
          <View className="border-border bg-surface" style={styles.mapPlaceholder}>
            <RiMapPinLine width={24} height={24} fill={colors.textTertiary} />
            <ThemedText style={[styles.mapPlaceholderText, { color: colors.textTertiary }]}>
              {t('address.display.mapPlaceholder')}
            </ThemedText>
          </View>
        )}
      </View>
    );
  }

  // Detailed variant (default)
  return (
    <View className="bg-background" style={[styles.detailedContainer, style]}>
      <View style={styles.detailedHeader}>
        <RiMapPinFill width={24} height={24} fill={colors.primarySubtleForeground} />
        <View style={styles.detailedAddressInfo}>
          <ThemedText style={styles.detailedStreet}>{address.street}</ThemedText>
          <ThemedText style={[styles.detailedCityState, { color: colors.textTertiary }]}>
            {address.city}, {address.state} {address.zipCode}
          </ThemedText>
          {address.country && address.country !== 'USA' && (
            <ThemedText style={[styles.detailedCountry, { color: colors.textTertiary }]}>
              {address.country}
            </ThemedText>
          )}
        </View>
      </View>

      {showActions && (
        <View style={styles.detailedActions}>
          <TouchableOpacity
            className="bg-primary-subtle"
            style={styles.detailedActionButton}
            onPress={handleCopyAddress}
          >
            <RiFileCopyLine width={16} height={16} fill={colors.primarySubtleForeground} />
            <ThemedText
              style={[styles.actionButtonText, { color: colors.primarySubtleForeground }]}
            >
              {t('address.display.copy')}
            </ThemedText>
          </TouchableOpacity>

          <TouchableOpacity
            className="bg-primary-subtle"
            style={styles.detailedActionButton}
            onPress={handleOpenInMaps}
          >
            <RiMapPinLine width={16} height={16} fill={colors.primarySubtleForeground} />
            <ThemedText
              style={[styles.actionButtonText, { color: colors.primarySubtleForeground }]}
            >
              {t('address.display.openInMaps')}
            </ThemedText>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Compact variant styles
  compactContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  compactText: {
    flex: 1,
    marginLeft: 8,
    fontSize: 14,
  },

  // Card variant styles
  cardContainer: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  addressInfo: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flex: 1,
  },
  addressTextContainer: {
    marginLeft: 12,
    flex: 1,
  },
  cardStreet: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  cardCityState: {
    fontSize: 14,
  },
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionButton: {
    padding: 8,
    marginLeft: 8,
    borderRadius: 6,
  },
  mapPlaceholder: {
    marginTop: 12,
    height: 100,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  mapPlaceholderText: {
    marginTop: 8,
    fontSize: 14,
  },

  // Detailed variant styles
  detailedContainer: {
    padding: 16,
    borderRadius: 12,
  },
  detailedHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  detailedAddressInfo: {
    marginLeft: 12,
    flex: 1,
  },
  detailedStreet: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 4,
  },
  detailedCityState: {
    fontSize: 16,
    marginBottom: 2,
  },
  detailedCountry: {
    fontSize: 14,
  },
  detailedActions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  detailedActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    flex: 1,
    marginHorizontal: 4,
    justifyContent: 'center',
  },
  actionButtonText: {
    marginLeft: 8,
    fontSize: 14,
    fontWeight: '500',
  },
});
