import { AgencyDirectoryField } from '@/components/agencies/AgencyDirectoryField';
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
import type React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Textarea } from '@oxy.so/bloom/textarea';

import { LandlordTreatment, ResponseRating, DepositReturn } from '@homiio/shared-types/review';

import { EnumChipSelector } from '@/components/reviews/EnumChipSelector';
import type { StepProps } from '@/components/reviews/write/types';
import { spacing } from '@/constants/styles';

export const StepManagement: React.FC<StepProps> = ({ data, update }) => {
  const { t } = useTranslation();
  return (
    <View style={styles.container}>
      <AgencyDirectoryField
        label={t('reviews.write.fields.agencyName')}
        placeholder={t('reviews.write.placeholders.agencyName')}
        name={data.agencyName}
        accountId={data.agencyOxyAccountId}
        onChange={(name, accountId) => {
          update('agencyName', name);
          update('agencyOxyAccountId', accountId);
        }}
      />

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
