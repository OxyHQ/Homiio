import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, Switch } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import { BaseWidget } from './BaseWidget';
import { useSavedSearches } from '@/hooks/useSavedSearches';
import { toast } from 'sonner';
import Button from '../Button';

// Type assertion for Ionicons compatibility
const IconComponent = Ionicons as any;

export function PropertyAlertWidget() {
  const { t } = useTranslation();
  const router = useRouter();
  const { saveSearch, isAuthenticated, isSaving } = useSavedSearches();

  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('1000');
  const [location, setLocation] = useState('');
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [pushNotifications, setPushNotifications] = useState(true);

  const handleCreateAlert = async () => {
    if (!isAuthenticated) {
      toast.error('Please sign in to create alerts');
      return;
    }

    if (!location.trim() && !minPrice && !maxPrice) {
      toast.error('Please specify at least a location or price range');
      return;
    }

    try {
      // Build search query from alert criteria
      const queryParts = [];
      if (location.trim()) queryParts.push(location.trim());

      const filters: any = {};
      if (minPrice) filters.minPrice = parseFloat(minPrice);
      if (maxPrice) filters.maxPrice = parseFloat(maxPrice);

      const query = queryParts.length > 0 ? queryParts.join(' ') : 'properties';
      const alertName =
        `Alert: ${location || 'Any location'} ${minPrice ? `⊜${minPrice}+` : ''}${maxPrice ? ` - ⊜${maxPrice}` : ''}`.trim();

      const success = await saveSearch(
        alertName,
        query,
        filters,
        emailNotifications || pushNotifications,
      );

      if (success) {
        // Clear form
        setMinPrice('');
        setMaxPrice('1000');
        setLocation('');
        setEmailNotifications(true);
        setPushNotifications(true);
      }
    } catch (error) {
      console.error('Failed to create alert:', error);
      toast.error('Failed to create alert. Please try again.');
    }
  };

  if (!isAuthenticated) {
    return (
      <BaseWidget
        title={t('Property Alerts')}
        icon={<IconComponent name="notifications" size={22} color={colors.primaryColor} />}
      >
        <View style={styles.container}>
          <Text style={styles.subtitle}>{t('Sign in to create property alerts')}</Text>
          <Button style={styles.createButton} onPress={() => router.push('/search')}>
            {t('Go to Search')}
          </Button>
        </View>
      </BaseWidget>
    );
  }

  return (
    <BaseWidget
      title={t('Property Alerts')}
      icon={<IconComponent name="notifications" size={22} color={colors.primaryColor} />}
    >
      <View style={styles.container}>
        <Text style={styles.subtitle}>Get notified when new properties match your criteria</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Location</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Barcelona, Berlin"
            value={location}
            onChangeText={setLocation}
          />
        </View>

        <View style={styles.priceRange}>
          <View style={styles.priceInput}>
            <Text style={styles.inputLabel}>Min Price</Text>
            <TextInput
              style={styles.input}
              placeholder="Min ⊜"
              value={minPrice}
              onChangeText={setMinPrice}
              keyboardType="numeric"
            />
          </View>

          <View style={styles.priceInput}>
            <Text style={styles.inputLabel}>Max Price</Text>
            <TextInput
              style={styles.input}
              placeholder="Max ⊜"
              value={maxPrice}
              onChangeText={setMaxPrice}
              keyboardType="numeric"
            />
          </View>
        </View>

        <View style={styles.notificationPreferences}>
          <Text style={styles.sectionTitle}>Notification Preferences</Text>

          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Email notifications</Text>
            <Switch
              value={emailNotifications}
              onValueChange={setEmailNotifications}
              trackColor={{ false: colors.COLOR_BLACK_LIGHT_6, true: colors.primaryColor }}
              thumbColor={emailNotifications ? '#fff' : '#f4f3f4'}
            />
          </View>

          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Push notifications</Text>
            <Switch
              value={pushNotifications}
              onValueChange={setPushNotifications}
              trackColor={{ false: colors.COLOR_BLACK_LIGHT_6, true: colors.primaryColor }}
              thumbColor={pushNotifications ? '#fff' : '#f4f3f4'}
            />
          </View>
        </View>

        <Button
          style={[styles.createButton, isSaving && styles.createButtonDisabled]}
          onPress={handleCreateAlert}
          disabled={isSaving}
        >
          {isSaving ? t('Creating...') : t('Create Alert')}
        </Button>
      </View>
    </BaseWidget>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 10,
  },
  subtitle: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_4,
    marginBottom: 15,
  },
  inputGroup: {
    marginBottom: 15,
  },
  inputLabel: {
    fontSize: 14,
    marginBottom: 5,
    color: colors.primaryDark,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    borderRadius: 8,
    padding: 8,
    fontSize: 14,
  },
  priceRange: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 15,
  },
  priceInput: {
    width: '48%',
  },
  notificationPreferences: {
    marginBottom: 15,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 10,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  toggleLabel: {
    fontSize: 14,
    color: colors.primaryDark,
  },
  createButton: {
    backgroundColor: colors.primaryColor,
    borderRadius: 25,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 5,
  },
  createButtonDisabled: {
    backgroundColor: colors.COLOR_BLACK_LIGHT_4,
  },
  createButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 14,
  },
});
