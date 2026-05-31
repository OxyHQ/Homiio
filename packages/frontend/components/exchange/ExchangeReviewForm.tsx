import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Button } from '@oxyhq/bloom/button';
import { Text as BloomText } from '@oxyhq/bloom/typography';

import { useCreateExchangeReview } from '@/hooks/useExchangeQueries';
import { toast } from '@/lib/sonner';
import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';

export interface ExchangeReviewFormProps {
  exchangeRequestId: string;
  /** Called after a review is successfully submitted. */
  onSubmitted: () => void;
}

const STAR_COUNT = 5;
const STAR_SIZE = 32;
const MAX_COMMENT = 2000;

/** A tappable 1–5 star picker (the read-only `Stars` component is display-only). */
const StarPicker: React.FC<{ value: number; onChange: (next: number) => void }> = ({
  value,
  onChange,
}) => {
  const { t } = useTranslation();
  return (
    <View style={styles.starRow}>
      {Array.from({ length: STAR_COUNT }).map((_, index) => {
        const rating = index + 1;
        const filled = rating <= value;
        return (
          <Pressable
            key={rating}
            onPress={() => onChange(rating)}
            accessibilityRole="button"
            accessibilityLabel={t('listing.exchange.review.starLabel', '{{count}} stars', {
              count: rating,
            })}
            hitSlop={6}
          >
            <Ionicons
              name={filled ? 'star' : 'star-outline'}
              size={STAR_SIZE}
              color={filled ? colors.ratingStar : colors.COLOR_BLACK_LIGHT_5}
            />
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
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const mutation = useCreateExchangeReview(exchangeRequestId);

  const handleSubmit = useCallback(async () => {
    if (rating < 1) {
      toast.error(t('listing.exchange.review.pickRating', 'Pick a star rating first'));
      return;
    }
    try {
      await mutation.mutateAsync({
        rating,
        comment: comment.trim() || undefined,
      });
      toast.success(t('listing.exchange.review.thanks', 'Thanks for your review'));
      onSubmitted();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t('listing.exchange.review.failed', 'Could not submit review');
      toast.error(message);
    }
  }, [rating, comment, mutation, onSubmitted, t]);

  return (
    <View style={styles.container}>
      <BloomText style={styles.title}>
        {t('listing.exchange.review.title', 'Leave a review')}
      </BloomText>
      <BloomText style={styles.subtitle}>
        {t(
          'listing.exchange.review.subtitle',
          'Rate your exchange — your feedback builds trust for everyone.',
        )}
      </BloomText>
      <StarPicker value={rating} onChange={setRating} />
      <TextInput
        style={styles.input}
        value={comment}
        onChangeText={setComment}
        placeholder={t(
          'listing.exchange.review.placeholder',
          'Share how the stay went (optional).',
        )}
        placeholderTextColor={colors.COLOR_BLACK_LIGHT_4}
        multiline
        textAlignVertical="top"
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
        {t('listing.exchange.review.submit', 'Submit review')}
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
    color: colors.COLOR_BLACK,
  },
  subtitle: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  starRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  input: {
    backgroundColor: colors.COLOR_BLACK_LIGHT_9,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 15,
    color: colors.COLOR_BLACK,
    minHeight: 96,
  },
  submit: {
    alignSelf: 'flex-start',
  },
});

export default ExchangeReviewForm;
