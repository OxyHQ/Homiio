/**
 * Rendering an {@link AlertExplanation} — the ONE place a stored alert becomes a
 * sentence on the client.
 *
 * ## Why the client re-renders rather than showing the server's message
 *
 * The backend composes English when it writes the notification, because a sweep
 * running at 08:05 UTC has no reader to have a locale. The alert row carries the
 * structured explanation beside that text precisely so this component can say
 * the same thing in the reader's own language, with money formatted by
 * `@homiio/shared-types/format` for their locale rather than for the server's.
 *
 * ## There is no fallback branch, and that is the point
 *
 * The issue forbids "recomendado para ti" with no concrete reason. The way to
 * make that unshippable is to have no code path that produces it: the switch
 * below is exhaustive over a closed union, so a new explanation variant is a
 * TypeScript error here rather than a generic sentence in production.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Text as BloomText } from '@oxyhq/bloom/typography';
import { formatMoney, type AlertExplanationDetail } from '@homiio/shared-types';
import { useFormatting } from '@/utils/format';

interface Props {
  readonly detail: AlertExplanationDetail;
  readonly watchName: string;
}

export function AlertExplanationText({ detail, watchName }: Props) {
  const { t } = useTranslation();
  const { locale } = useFormatting();

  const change = ((): string => {
    switch (detail.kind) {
      case 'new_listing':
        return t('alerts.explanation.newListing', { title: detail.listingTitle });
      case 'price_change':
        return t(
          detail.direction === 'decrease'
            ? 'alerts.explanation.priceDecrease'
            : 'alerts.explanation.priceIncrease',
          {
            title: detail.listingTitle,
            from: formatMoney(detail.fromAmount, detail.currency, locale),
            to: formatMoney(detail.toAmount, detail.currency, locale),
          },
        );
      case 'cost_terms_changed':
        return t('alerts.explanation.costTermsChanged', {
          title: detail.listingTitle,
          // WHICH terms moved, never their values — the alert's job is "go and
          // look", not to publish a deposit figure onto a lock screen.
          terms: detail.terms.join(', '),
        });
      case 'listing_removed':
        return t('alerts.explanation.listingRemoved', { title: detail.listingTitle });
      case 'listing_reappeared':
        return t('alerts.explanation.listingReappeared', {
          title: detail.listingTitle,
          source: detail.sourceName,
        });
      case 'new_review':
        // ADR 0003 §5.1 — a review is published at the BUILDING, never the unit.
        return t('alerts.explanation.newReview', { building: detail.buildingLabel });
      case 'eviction_nearby':
        // ADR 0003 §7.1 — a STATED radius, never a rounded point that looks
        // exact, and no unit or household.
        return t('alerts.explanation.evictionNearby', {
          radius: detail.approximateRadiusMeters,
          area: detail.areaLabel,
        });
      case 'source_conflict':
        return t('alerts.explanation.sourceConflict', {
          title: detail.listingTitle,
          count: detail.sourceCount,
        });
      default: {
        // Exhaustive over a closed union. A new variant fails to compile here
        // rather than rendering a sentence with no concrete reason in it.
        const exhaustive: never = detail;
        return exhaustive;
      }
    }
  })();

  return (
    <BloomText>
      {t('alerts.explanation.matched', { change, watchName })}
    </BloomText>
  );
}
