/**
 * StepPriceDates — the tenancy money + timeline: monthly rent, currency (a Bloom
 * `SegmentedControl`), and the lived-from / lived-to days (Bloom `DatePicker`s).
 * The wizard data keeps the dates as `YYYY-MM-DD` strings, so the pickers
 * convert at the edge; "to" cannot precede "from" and vice versa.
 * `livedForMonths` is NOT collected — the server derives it from the dates.
 * Hard-required: price, both dates.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { format, isValid, parse } from 'date-fns';

import { DatePicker } from '@oxy.so/bloom/date-picker';
import { Field } from '@oxy.so/bloom/field';
import {
  SegmentedControl,
  SegmentedControlItem,
  SegmentedControlItemText,
} from '@oxy.so/bloom/segmented-control';
import { TextFieldInput } from '@oxy.so/bloom/text-field';

import type { StepProps } from '@/components/reviews/write/types';
import { spacing } from '@/constants/styles';

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CAD'] as const;
const DAY_FORMAT = 'yyyy-MM-dd';

/** `YYYY-MM-DD` → local-midnight Date, or null when empty / unparseable. */
const toDate = (value: string): Date | null => {
  if (!value.trim()) return null;
  const parsed = parse(value, DAY_FORMAT, new Date());
  return isValid(parsed) ? parsed : null;
};

const toDay = (date: Date | null): string => (date ? format(date, DAY_FORMAT) : '');

export const StepPriceDates: React.FC<StepProps> = ({ data, update }) => {
  const { t } = useTranslation();
  const livedFrom = toDate(data.livedFrom);
  const livedTo = toDate(data.livedTo);
  const currencyLabel = t('reviews.write.fields.currency');

  return (
    <View style={styles.container}>
      <Field label={t('reviews.write.fields.price')}>
        <TextFieldInput
          label={t('reviews.write.fields.price')}
          placeholder={t('reviews.write.placeholders.price')}
          value={data.price}
          onChangeText={(text) => update('price', text)}
          keyboardType="numeric"
        />
      </Field>

      <Field label={currencyLabel}>
        <View style={styles.segmented}>
          <SegmentedControl
            label={currencyLabel}
            type="radio"
            value={data.currency}
            onChange={(next) => update('currency', next)}
          >
            {CURRENCIES.map((currency) => (
              <SegmentedControlItem key={currency} value={currency}>
                <SegmentedControlItemText>
                  {t(`reviews.write.currencies.${currency}`)}
                </SegmentedControlItemText>
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        </View>
      </Field>

      <View style={styles.row}>
        <Field label={t('reviews.write.fields.livedFrom')} required style={styles.rowField}>
          <DatePicker
            value={livedFrom}
            onChange={(date) => update('livedFrom', toDay(date))}
            maxDate={livedTo}
            placeholder={t('reviews.write.placeholders.selectDate')}
            accessibilityLabel={t('reviews.write.fields.livedFrom')}
          />
        </Field>
        <Field label={t('reviews.write.fields.livedTo')} required style={styles.rowField}>
          <DatePicker
            value={livedTo}
            onChange={(date) => update('livedTo', toDay(date))}
            minDate={livedFrom}
            placeholder={t('reviews.write.placeholders.selectDate')}
            accessibilityLabel={t('reviews.write.fields.livedTo')}
          />
        </Field>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: spacing.xl,
  },
  segmented: {
    alignSelf: 'flex-start',
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  rowField: {
    flexGrow: 1,
    flexBasis: 160,
  },
});

export default StepPriceDates;
