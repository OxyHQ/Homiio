import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '@oxy.so/bloom/button';
import { RatingInput } from '@oxy.so/bloom/rating';
import { Textarea } from '@oxy.so/bloom/textarea';
import { useTheme } from '@oxy.so/bloom/theme';
import { Text as BloomText } from '@oxy.so/bloom/typography';

import { useCreateExchangeReview } from '@/hooks/useExchangeQueries';
import { toast } from '@oxy.so/bloom/toast';
import { spacing } from '@/constants/styles';

export interface ExchangeReviewFormProps {
  exchangeRequestId: string;
  /** Called after a review is successfully submitted. */
  onSubmitted: () => void;
}

const MAX_COMMENT = 2000;

/**
 * Leave-a-review form for a COMPLETED exchange. Captures an overall 1–5 rating
 * (required) and an optional comment, then submits via
 * `useCreateExchangeReview`. The backend automatically targets the OTHER party.
 *
 * The rating is Bloom's `RatingInput` (2.12). The hand-rolled picker it
 * replaces already announced a `radiogroup`, but the group had no NAME and the
 * arrow keys did nothing — the stars were five separate `Pressable`s. Payload
 * is unchanged: a whole 1–5, with 0 meaning "not chosen yet", which the
 * submit guard still rejects.
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
      <RatingInput
        value={rating > 0 ? rating : null}
        onChange={setRating}
        size="large"
        accessibilityLabel={t('listing.exchange.review.ratingLabel')}
        formatStarLabel={(star) => t('listing.exchange.review.starLabel', { count: star })}
        testID="exchange-review-rating"
      />
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
  submit: {
    alignSelf: 'flex-start',
  },
});

export default ExchangeReviewForm;
