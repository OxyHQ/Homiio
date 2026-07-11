/**
 * StepManagement — who managed the tenancy and how it went: agency name (with a
 * debounced typeahead against `/api/agencies/search`), landlord treatment,
 * problem response, deposit outcome, and free-text advice to the agency /
 * landlord. All optional.
 *
 * The agency search debounces WITHOUT a `useEffect`: each keystroke resets a
 * timer ref that publishes the debounced term into a `useQuery` key. Result
 * rows own their own pressed state (extracted `AgencyResultRow`, safe in `.map`).
 */
import React, { useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { TextFieldInput } from '@oxyhq/bloom/text-field';
import { Text as BloomText } from '@oxyhq/bloom/typography';

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
import { colors } from '@/styles/colors';
import { hairline, radius, spacing } from '@/constants/styles';

const IS_WEB = Platform.OS === 'web';
const SEARCH_DEBOUNCE_MS = 300;
const MIN_SEARCH_LENGTH = 2;

interface AgencyResultRowProps {
  agency: AgencySummary;
  onSelect: () => void;
}

/** One agency typeahead suggestion — owns its own pressed/hovered state. */
const AgencyResultRow: React.FC<AgencyResultRowProps> = ({ agency, onSelect }) => {
  const [pressed, setPressed] = useState(false);
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      onPress={onSelect}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onHoverIn={IS_WEB ? () => setHovered(true) : undefined}
      onHoverOut={IS_WEB ? () => setHovered(false) : undefined}
      accessibilityRole="button"
      accessibilityLabel={agency.name}
      style={[styles.resultRow, (pressed || hovered) && styles.resultRowActive]}
    >
      <Ionicons name="business-outline" size={16} color={colors.COLOR_BLACK_LIGHT_3} />
      <BloomText style={styles.resultLabel}>{agency.name}</BloomText>
    </Pressable>
  );
};

export const StepManagement: React.FC<StepProps> = ({ data, update }) => {
  const { t } = useTranslation();
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
        <TextFieldInput
          label={t('reviews.write.fields.agencyName')}
          placeholder={t('reviews.write.placeholders.agencyName')}
          value={data.agencyName}
          onChangeText={handleAgencyChange}
        />
        {showSuggestions ? (
          <View style={styles.results}>
            {results.map((agency) => (
              <AgencyResultRow
                key={agency.id}
                agency={agency}
                onSelect={() => handleSelectAgency(agency)}
              />
            ))}
          </View>
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

      <TextFieldInput
        label={t('reviews.write.fields.adviceToAgency')}
        placeholder={t('reviews.write.placeholders.adviceToAgency')}
        value={data.adviceToAgency}
        onChangeText={(text) => update('adviceToAgency', text)}
        multiline
      />
      <TextFieldInput
        label={t('reviews.write.fields.adviceToLandlord')}
        placeholder={t('reviews.write.placeholders.adviceToLandlord')}
        value={data.adviceToLandlord}
        onChangeText={(text) => update('adviceToLandlord', text)}
        multiline
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
    borderWidth: hairline.width,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surfaceElevated,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  resultRowActive: {
    backgroundColor: colors.COLOR_BLACK_LIGHT_7,
  },
  resultLabel: {
    fontSize: 14,
    color: colors.COLOR_BLACK,
  },
});

export default StepManagement;
