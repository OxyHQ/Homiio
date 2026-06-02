import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { showSignInModal } from '@oxyhq/services';
import { Button } from '@oxyhq/bloom/button';
import { Switch } from '@oxyhq/bloom/switch';
import { Text as BloomText } from '@oxyhq/bloom/typography';
import * as TextField from '@oxyhq/bloom/text-field';
import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';
import { toast } from '@/lib/sonner';
import { BaseWidget } from './BaseWidget';
import { useSavedSearches } from '@/hooks/useSavedSearches';
import type { SavedSearchFilters } from '@/store/savedSearchesStore';

const ALERT_ICON_SIZE = 22;
const EMPTY_ICON_SIZE = 28;
/** Diameter of the round empty-state icon bubble (denser than the prior 56). */
const EMPTY_ICON_BUBBLE_SIZE = 48;
const CURRENCY_SYMBOL = '€';
/** En-dash range separator for the human alert label, e.g. "€500–€1000". */
const RANGE_SEPARATOR = '–';
/** Middle-dot separator between the location and the price range. */
const LABEL_SEPARATOR = ' · ';

/**
 * Result of parsing one price input: either a valid finite non-negative number,
 * an empty (omitted) field, or an invalid entry the caller must reject.
 */
type ParsedPrice =
  | { kind: 'empty' }
  | { kind: 'value'; value: number }
  | { kind: 'invalid' };

/** Parse a raw price string with guards against non-numeric/NaN/negative input. */
function parsePrice(raw: string): ParsedPrice {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: 'empty' };
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return { kind: 'invalid' };
  return { kind: 'value', value };
}

/** Build the human-readable price portion of the alert label (e.g. "€500–€1000"). */
function formatPriceRange(min: number | undefined, max: number | undefined): string {
  if (min !== undefined && max !== undefined) {
    return `${CURRENCY_SYMBOL}${min}${RANGE_SEPARATOR}${CURRENCY_SYMBOL}${max}`;
  }
  if (min !== undefined) return `${CURRENCY_SYMBOL}${min}+`;
  if (max !== undefined) return `${CURRENCY_SYMBOL}0${RANGE_SEPARATOR}${CURRENCY_SYMBOL}${max}`;
  return '';
}

/**
 * Right-rail "Property Alerts" widget: lets an authenticated user persist a
 * saved search (location and/or price range) that the backend notifies them
 * about when new matching listings appear.
 *
 * Auth is gated on the real Oxy signal: logged-out users see a compact sign-in
 * prompt instead of the form. The backend `SavedSearch` model only stores a
 * single `notificationsEnabled` flag, so this exposes one "notify me" toggle
 * rather than faking per-channel (email/push) delivery.
 */
export function PropertyAlertWidget() {
  const { t } = useTranslation();
  const { saveSearch, isAuthenticated, isSaving } = useSavedSearches();

  const [location, setLocation] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [notify, setNotify] = useState(true);
  const [minInvalid, setMinInvalid] = useState(false);
  const [maxInvalid, setMaxInvalid] = useState(false);

  const resetForm = () => {
    setLocation('');
    setMinPrice('');
    setMaxPrice('');
    setNotify(true);
    setMinInvalid(false);
    setMaxInvalid(false);
  };

  const handleCreateAlert = async () => {
    if (!isAuthenticated) {
      showSignInModal();
      return;
    }

    const trimmedLocation = location.trim();
    const parsedMin = parsePrice(minPrice);
    const parsedMax = parsePrice(maxPrice);

    // Reject non-numeric / negative entries and flag the offending field(s).
    setMinInvalid(parsedMin.kind === 'invalid');
    setMaxInvalid(parsedMax.kind === 'invalid');
    if (parsedMin.kind === 'invalid' || parsedMax.kind === 'invalid') {
      toast.error(t('search.widgets.alerts.invalidNumber'));
      return;
    }

    const minValue = parsedMin.kind === 'value' ? parsedMin.value : undefined;
    const maxValue = parsedMax.kind === 'value' ? parsedMax.value : undefined;

    // Reject an empty form (no location and no valid price) — nothing to alert on.
    if (!trimmedLocation && minValue === undefined && maxValue === undefined) {
      toast.error(t('search.widgets.alerts.locationOrPriceRequired'));
      return;
    }

    // Reject an inverted range only when both bounds are present and finite.
    if (minValue !== undefined && maxValue !== undefined && minValue > maxValue) {
      setMinInvalid(true);
      setMaxInvalid(true);
      toast.error(t('search.widgets.alerts.minOverMax'));
      return;
    }

    const filters: SavedSearchFilters = {};
    if (minValue !== undefined) filters.minPrice = minValue;
    if (maxValue !== undefined) filters.maxPrice = maxValue;

    // Compose a sensible, non-empty name + query from the criteria. The hook and
    // backend both require a non-empty name and query.
    const priceLabel = formatPriceRange(minValue, maxValue);
    const labelParts = [trimmedLocation, priceLabel].filter(Boolean);
    const alertName = labelParts.join(LABEL_SEPARATOR) || t('search.widgets.alerts.title');
    const query = trimmedLocation || alertName;

    const success = await saveSearch(alertName, query, filters, notify);
    if (success) resetForm();
  };

  // Logged-out: compact sign-in empty state instead of the form.
  if (!isAuthenticated) {
    return (
      <BaseWidget
        title={t('search.widgets.alerts.title')}
        icon={
          <Ionicons name="notifications-outline" size={ALERT_ICON_SIZE} color={colors.primaryColor} />
        }
      >
        <View style={styles.emptyState}>
          <View style={styles.emptyIconBubble}>
            <Ionicons name="notifications-outline" size={EMPTY_ICON_SIZE} color={colors.primaryColor} />
          </View>
          <BloomText style={styles.subtitle}>{t('search.widgets.alerts.signInPrompt')}</BloomText>
          <Button variant="primary" size="medium" onPress={showSignInModal}>
            {t('search.widgets.common.signIn')}
          </Button>
        </View>
      </BaseWidget>
    );
  }

  return (
    <BaseWidget
      title={t('search.widgets.alerts.title')}
      icon={
        <Ionicons name="notifications-outline" size={ALERT_ICON_SIZE} color={colors.primaryColor} />
      }
    >
      <View style={styles.container}>
        <BloomText style={styles.subtitle}>{t('search.widgets.alerts.subtitle')}</BloomText>

        <TextField.Input
          label={t('search.widgets.alerts.location')}
          placeholder={t('search.widgets.alerts.locationPlaceholder')}
          value={location}
          onChangeText={setLocation}
        />

        <View style={styles.priceRow}>
          <View style={styles.priceField}>
            <TextField.Input
              label={t('search.widgets.alerts.minPrice')}
              placeholder={t('search.widgets.alerts.minPricePlaceholder')}
              value={minPrice}
              onChangeText={(value) => {
                setMinPrice(value);
                if (minInvalid) setMinInvalid(false);
              }}
              keyboardType="numeric"
              isInvalid={minInvalid}
            />
          </View>
          <View style={styles.priceField}>
            <TextField.Input
              label={t('search.widgets.alerts.maxPrice')}
              placeholder={t('search.widgets.alerts.maxPricePlaceholder')}
              value={maxPrice}
              onChangeText={(value) => {
                setMaxPrice(value);
                if (maxInvalid) setMaxInvalid(false);
              }}
              keyboardType="numeric"
              isInvalid={maxInvalid}
            />
          </View>
        </View>

        <View style={styles.notifyRow}>
          <View style={styles.notifyCopy}>
            <BloomText style={styles.notifyLabel}>{t('search.widgets.alerts.notify')}</BloomText>
            <BloomText style={styles.notifyHelper}>
              {t('search.widgets.alerts.notifyHelper')}
            </BloomText>
          </View>
          <Switch value={notify} onValueChange={setNotify} />
        </View>

        <Button variant="primary" size="medium" onPress={handleCreateAlert} loading={isSaving}>
          {t('search.widgets.alerts.create')}
        </Button>
      </View>
    </BaseWidget>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
  },
  subtitle: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  priceRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  priceField: {
    flex: 1,
  },
  notifyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  notifyCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  notifyLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.primaryDark,
  },
  notifyHelper: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  emptyState: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  emptyIconBubble: {
    width: EMPTY_ICON_BUBBLE_SIZE,
    height: EMPTY_ICON_BUBBLE_SIZE,
    borderRadius: EMPTY_ICON_BUBBLE_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLight_1,
  },
});
