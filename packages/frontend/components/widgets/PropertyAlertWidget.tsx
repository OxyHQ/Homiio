import React, { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { formatMoney, formatMoneyRange } from '@homiio/shared-types';
import { openAccountDialog } from '@oxy.so/services';
import { Button } from '@oxy.so/bloom/button';
import { IconCircle } from '@oxy.so/bloom/icon-circle';
import { RiNotification3Line } from '@oxy.so/bloom/icons';
import { Item } from '@oxy.so/bloom/item';
import { Switch } from '@oxy.so/bloom/switch';
import { Text as BloomText } from '@oxy.so/bloom/typography';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { useColors } from '@/hooks/useThemeColor';
import { toast } from '@oxy.so/bloom/toast';
import { BaseWidget } from './BaseWidget';
import { useSavedSearches } from '@/hooks/useSavedSearches';
import type { SavedSearchFilters } from '@/store/savedSearchesStore';
import { SEARCH_PRICE_CURRENCY } from '@/components/search/types';
import { useFormatting } from '@/utils/format';

const ALERT_ICON_SIZE = 22;
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

/**
 * Build the human-readable price portion of the alert label.
 *
 * Formatted in {@link SEARCH_PRICE_CURRENCY} rather than glued after a
 * hardcoded `€` — and that is a DISPLAY default here, not the unit the alert
 * filters in. This widget takes a number and a typed place name, so nothing has
 * resolved a scope yet and no currency is stored with the bound; the server
 * resolves one from the area's own listings when the search runs and reports it
 * back. Writing a currency into the filter from here would be this component
 * deciding a Kraków alert is in euros because the app's default label is.
 *
 * The one-sided cases take their preposition from the locale file.
 */
function formatPriceRange(
  min: number | undefined,
  max: number | undefined,
  locale: string,
  t: TFunction,
): string {
  const money = (amount: number): string =>
    formatMoney(amount, SEARCH_PRICE_CURRENCY, locale, { maximumFractionDigits: 0 });
  if (min !== undefined && max !== undefined) {
    return formatMoneyRange(min, max, SEARCH_PRICE_CURRENCY, locale, {
      maximumFractionDigits: 0,
    });
  }
  if (min !== undefined) return t('format.range.from', { value: money(min) });
  if (max !== undefined) return t('format.range.upTo', { value: money(max) });
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
  const { locale } = useFormatting();
  const colors = useColors();
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
      openAccountDialog();
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
    const priceLabel = formatPriceRange(minValue, maxValue, locale, t);
    const labelParts = [trimmedLocation, priceLabel].filter(Boolean);
    const alertName = labelParts.join(LABEL_SEPARATOR) || t('search.widgets.alerts.title');
    const query = trimmedLocation || alertName;

    const success = await saveSearch(alertName, query, filters, notify);
    if (success) resetForm();
  };

  const headerIcon = (
    <RiNotification3Line width={ALERT_ICON_SIZE} height={ALERT_ICON_SIZE} fill={colors.primary} />
  );

  // Logged-out: compact sign-in empty state instead of the form.
  if (!isAuthenticated) {
    return (
      <BaseWidget
        title={t('search.widgets.alerts.title')}
        icon={headerIcon}
      >
        <View className="items-center gap-3 py-1">
          <IconCircle icon={RiNotification3Line} size="lg" />
          <BloomText className="text-center text-sm text-muted-foreground">{t('search.widgets.alerts.signInPrompt')}</BloomText>
          <Button variant="primary" size="medium" onPress={() => openAccountDialog()}>
            {t('search.widgets.common.signIn')}
          </Button>
        </View>
      </BaseWidget>
    );
  }

  return (
    <BaseWidget
      title={t('search.widgets.alerts.title')}
      icon={headerIcon}
    >
      <View className="gap-3">
        <BloomText className="text-sm text-muted-foreground">{t('search.widgets.alerts.subtitle')}</BloomText>

        <TextFieldInput
          label={t('search.widgets.alerts.location')}
          placeholder={t('search.widgets.alerts.locationPlaceholder')}
          value={location}
          onChangeText={setLocation}
        />

        <View className="flex-row gap-2">
          <View className="flex-1">
            <TextFieldInput
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
          <View className="flex-1">
            <TextFieldInput
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

        <Item
          density="compact"
          title={t('search.widgets.alerts.notify')}
          subtitle={t('search.widgets.alerts.notifyHelper')}
          trailing={
            <Switch
              value={notify}
              onValueChange={setNotify}
              accessibilityLabel={t('search.widgets.alerts.notify')}
            />
          }
        />

        <Button variant="primary" size="medium" onPress={handleCreateAlert} loading={isSaving}>
          {t('search.widgets.alerts.create')}
        </Button>
      </View>
    </BaseWidget>
  );
}
