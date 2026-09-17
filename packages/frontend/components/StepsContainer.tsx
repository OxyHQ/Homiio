import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Chip } from '@oxy.so/bloom/chip';
import { RiCheckLine } from '@oxy.so/bloom/icons';
import { StatBar } from '@oxy.so/bloom/stat-bar';
import { useTheme } from '@oxy.so/bloom/theme';

interface StepsContainerProps {
  steps: string[];
  currentStep: number;
}

/**
 * Wizard progress: a Bloom `StatBar` naming the current step and counting
 * through the flow, over a scrollable row of step `Chip`s (done steps carry a
 * check, the current one is selected).
 */
export function StepsContainer({ steps, currentStep }: StepsContainerProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const total = Math.max(steps.length, 1);

  return (
    <View style={styles.container}>
      <StatBar
        label={steps[currentStep] ?? ''}
        value={Math.min(currentStep + 1, total)}
        max={total}
        maxLabel={t('reviews.write.stepCounter', { current: currentStep + 1, total: steps.length })}
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsRow}
      >
        {steps.map((stepName, index) => (
          <Chip
            key={`${index}-${stepName}`}
            size="small"
            variant={index === currentStep ? 'solid' : 'subtle'}
            color={index <= currentStep ? 'primary' : 'default'}
            startIcon={
              index < currentStep ? <RiCheckLine size="xs" fill={theme.colors.primary} /> : undefined
            }
          >
            {stepName}
          </Chip>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
    marginBottom: 24,
  },
  chipsRow: {
    gap: 6,
  },
});
