/**
 * StepTexts — the written review: a required title + opinion (≥10 chars) and the
 * optional pros / cons lists (max 10 items each, ≤140 chars).
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { TextFieldInput } from '@oxyhq/bloom/text-field';

import { EditableList } from '@/components/reviews/write/EditableList';
import { StepHeader } from '@/components/reviews/write/StepHeader';
import type { StepProps } from '@/components/reviews/write/types';
import { spacing } from '@/constants/styles';

const TITLE_MAX_LENGTH = 120;

export const StepTexts: React.FC<StepProps> = ({ data, update }) => {
  const { t } = useTranslation();

  return (
    <View style={styles.container}>
      <StepHeader
        title={t('reviews.write.steps.texts.title')}
        subtitle={t('reviews.write.steps.texts.subtitle')}
      />

      <TextFieldInput
        label={t('reviews.write.fields.reviewTitle')}
        placeholder={t('reviews.write.placeholders.reviewTitle')}
        value={data.title}
        onChangeText={(text) => update('title', text)}
        maxLength={TITLE_MAX_LENGTH}
      />
      <TextFieldInput
        label={t('reviews.write.fields.opinion')}
        placeholder={t('reviews.write.placeholders.opinion')}
        value={data.opinion}
        onChangeText={(text) => update('opinion', text)}
        multiline
      />

      <EditableList
        label={t('reviews.write.fields.pros')}
        tone="positive"
        items={data.prosItems}
        onChange={(items) => update('prosItems', items)}
        placeholder={t('reviews.write.placeholders.pros')}
        addLabel={t('reviews.write.addItem')}
        removeLabel={t('reviews.write.removeItem')}
      />
      <EditableList
        label={t('reviews.write.fields.cons')}
        tone="negative"
        items={data.consItems}
        onChange={(items) => update('consItems', items)}
        placeholder={t('reviews.write.placeholders.cons')}
        addLabel={t('reviews.write.addItem')}
        removeLabel={t('reviews.write.removeItem')}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: spacing.xl,
  },
});

export default StepTexts;
