/**
 * StepManagement — who managed the tenancy and how it went: agency name (with a
 * debounced typeahead against `/api/agencies/search`), landlord treatment,
 * problem response, deposit outcome, and free-text advice to the agency /
 * landlord (Bloom `Textarea`s). All optional.
 *
 * The agency search debounces WITHOUT a `useEffect`: each keystroke resets a
 * timer ref that publishes the debounced term into a `useQuery` key. The
 * suggestions are Bloom `Item` rows (`role="option"`) on an outlined `Card`.
 */
import React, { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { Card } from '@oxy.so/bloom/card';
import { RiBuilding2Line } from '@oxy.so/bloom/icons';
import { Item } from '@oxy.so/bloom/item';
import { Field } from '@oxy.so/bloom/field';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { Textarea } from '@oxy.so/bloom/textarea';
import { useTheme } from '@oxy.so/bloom/theme';

import {
  LandlordTreatment,
  ResponseRating,
  DepositReturn,
  type AgencySummary,
} from '@homiio/shared-types';

import { EnumChipSelector } from '@/components/reviews/EnumChipSelector';
import { StepHeader } from '@/components/reviews/write/StepHeader';
import type { StepProps } from '@/components/reviews/write/types';
import { reviewService } from '@/services/reviewService';
import { spacing } from '@/constants/styles';

const SEARCH_DEBOUNCE_MS = 300;
const MIN_SEARCH_LENGTH = 2;

export const StepManagement: React.FC<StepProps> = ({ data, update }) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const [term, setTerm] = useState('');
  const [showResults, setShowResults] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useQuery<AgencySummary[]>({
    queryKey: ['agencySearch', term],
    queryFn: () => reviewService.searchAgencies(term),
    enabled: term.trim().length >= MIN_SEARCH_LENGTH,
    staleTime: 1000 * 30,
  });

  const handleAgencyChange = (text: string) => {
    update('agencyName', text);
    setShowResults(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setTerm(text), SEARCH_DEBOUNCE_MS);
  };

  const handleSelectAgency = (agency: AgencySummary) => {
    update('agencyName', agency.name);
    setShowResults(false);
    setTerm('');
  };

  const results = search.data ?? [];
  const showSuggestions =
    showResults && data.agencyName.trim().length >= MIN_SEARCH_LENGTH && results.length > 0;

  return (
    <View style={styles.container}>
      <StepHeader
        title={t('reviews.write.steps.management.title')}
        subtitle={t('reviews.write.steps.management.subtitle')}
      />

      <View>
        <Field label={t('reviews.write.fields.agencyName')}>
          <TextFieldInput
            label={t('reviews.write.fields.agencyName')}
            placeholder={t('reviews.write.placeholders.agencyName')}
            value={data.agencyName}
            onChangeText={handleAgencyChange}
          />
        </Field>
        {showSuggestions ? (
          <Card variant="outlined" radius="radius-12" style={styles.results}>
            {results.map((agency) => (
              <Item
                key={agency.id}
                role="option"
                density="compact"
                title={agency.name}
                leading={
                  <RiBuilding2Line width={16} height={16} fill={theme.colors.textSecondary} />
                }
                onPress={() => handleSelectAgency(agency)}
                accessibilityLabel={agency.name}
              />
            ))}
          </Card>
        ) : null}
      </View>

      <EnumChipSelector
        label={t('reviews.write.fields.landlordTreatment')}
        labelPrefix="reviews.enums.landlordTreatment"
        values={Object.values(LandlordTreatment)}
        selected={data.landlordTreatment ? [data.landlordTreatment] : []}
        onChange={(next) => update('landlordTreatment', next[0])}
      />
      <EnumChipSelector
        label={t('reviews.write.fields.problemResponse')}
        labelPrefix="reviews.enums.problemResponse"
        values={Object.values(ResponseRating)}
        selected={data.problemResponse ? [data.problemResponse] : []}
        onChange={(next) => update('problemResponse', next[0])}
      />
      <EnumChipSelector
        label={t('reviews.write.fields.depositReturned')}
        labelPrefix="reviews.enums.depositReturned"
        values={Object.values(DepositReturn)}
        selected={data.depositReturned ? [data.depositReturned] : []}
        onChange={(next) => update('depositReturned', next[0])}
      />

      <Textarea
        label={t('reviews.write.fields.adviceToAgency')}
        placeholder={t('reviews.write.placeholders.adviceToAgency')}
        value={data.adviceToAgency}
        onChangeText={(text) => update('adviceToAgency', text)}
        rows={3}
        autoResize
        maxRows={10}
      />
      <Textarea
        label={t('reviews.write.fields.adviceToLandlord')}
        placeholder={t('reviews.write.placeholders.adviceToLandlord')}
        value={data.adviceToLandlord}
        onChangeText={(text) => update('adviceToLandlord', text)}
        rows={3}
        autoResize
        maxRows={10}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: spacing.xl,
  },
  results: {
    marginTop: spacing.xs,
    overflow: 'hidden',
  },
});

export default StepManagement;
