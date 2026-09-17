import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '@oxy.so/bloom/button';
import { RiStarFill, RiStarLine } from '@oxy.so/bloom/icons';
import { Textarea } from '@oxy.so/bloom/textarea';
import { useTheme } from '@oxy.so/bloom/theme';
import { Text as BloomText } from '@oxy.so/bloom/typography';

import { useCreateExchangeReview } from '@/hooks/useExchangeQueries';
import { toast } from '@oxy.so/bloom/toast';
import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';

export interface ExchangeReviewFormProps {
  exchangeRequestId: string;
  /** Called after a review is successfully submitted. */
  onSubmitted: () => void;
}

const STAR_COUNT = 5;
const MAX_COMMENT = 2000;

/** A tappable 1–5 star picker (the read-only `Stars` component is display-only). */
const StarPicker: React.FC<{ value: number; onChange: (next: number) => void }> = ({
  value,
  onChange,
}) => {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <View style={styles.starRow} accessibilityRole="radiogroup">
      {Array.from({ length: STAR_COUNT }).map((_, index) => {
        const rating = index + 1;
        const filled = rating <= value;
        return (
          <Pressable
            key={rating}
            onPress={() => onChange(rating)}
            accessibilityRole="radio"
            accessibilityState={{ checked: rating === value }}
            accessibilityLabel={t('listing.exchange.review.starLabel', {
              count: rating,
            })}
            hitSlop={6}
          >
            {filled ? (
              <RiStarFill size="2xl" fill={colors.ratingStar} />
            ) : (
              <RiStarLine size="2xl" fill={theme.colors.textTertiary} />
            )}
          </Pressable>
        );
      })}
    </View>
  );
};

/**
 * Leave-a-review form for a COMPLETED exchange. Captures an overall 1–5 rating
 * (required) and an optional comment, then submits via
 * `useCreateExchangeReview`. The backend automatically targets the OTHER party.
 */
export const ExchangeReviewForm: React.FC<ExchangeReviewFormProps> = ({
  exchangeRequestId,
  onSubmitted,
}) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const mutation = useCreateExchangeReview(exchangeRequestId);

  const handleSubmit = useCallback(async () => {
    if (rating < 1) {
      toast.error(t('listing.exchange.review.pickRating'));
      return;
    }
    try {
      await mutation.mutateAsync({
        rating,
        comment: comment.trim() || undefined,
      });
      toast.success(t('listing.exchange.review.thanks'));
      onSubmitted();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t('listing.exchange.review.failed');
      toast.error(message);
    }
  }, [rating, comment, mutation, onSubmitted, t]);

  return (
    <View style={styles.container}>
      <BloomText style={[styles.title, { color: theme.colors.text }]}>
        {t('listing.exchange.review.title')}
      </BloomText>
      <BloomText style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
        {t('listing.exchange.review.subtitle')}
      </BloomText>
      <StarPicker value={rating} onChange={setRating} />
      <Textarea
        value={comment}
        onChangeText={setComment}
        placeholder={t('listing.exchange.review.placeholder')}
        accessibilityLabel={t('listing.exchange.review.placeholder')}
        rows={4}
        autoResize
        maxLength={MAX_COMMENT}
      />
      <Button
        variant="primary"
        size="medium"
        onPress={handleSubmit}
        loading={mutation.isPending}
        disabled={mutation.isPending}
        style={styles.submit}
      >
        {t('listing.exchange.review.submit')}
      </Button>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 13,
  },
  starRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  submit: {
    alignSelf: 'flex-start',
  },
});

export default ExchangeReviewForm;
