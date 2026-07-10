/**
 * ExchangeSection — the "Home exchange" block on the property detail page.
 *
 * Display-only summary of an EXCHANGE listing's terms: the mode (home swap /
 * free hosting / either) explained, the host's availability windows (same
 * `AvailabilityWindow` shape the vacation calendar uses), a welcome note, the
 * languages spoken, meals-included and reciprocity flags, and a primary
 * "Request exchange" CTA. Rendered only for listings whose `intents` include
 * `exchange` (the screen gates it), reusing the flat `Section` primitive +
 * Bloom typography so it matches the rest of the page.
 */
import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { format, parseISO } from 'date-fns';

import { Button } from '@oxyhq/bloom/button';
import { Divider } from '@oxyhq/bloom/divider';
import { Text as BloomText } from '@oxyhq/bloom/typography';
import { Ionicons } from '@expo/vector-icons';

import { ExchangeMode, type PropertyExchange } from '@homiio/shared-types';
import { Section } from '@/components/property/Section';
import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';

interface Props {
  exchange: PropertyExchange;
  /** Open the request-exchange flow (primary CTA). */
  onRequestExchange: () => void;
}

const ICON_SIZE = 18;
const MAX_WINDOWS_SHOWN = 4;

/** Exchange-mode → headline + helper copy. */
const MODE_COPY: Record<ExchangeMode, { titleKey: string; helpKey: string }> = {
  [ExchangeMode.SWAP]: {
    titleKey: 'listing.exchange.mode.swap',
    helpKey: 'listing.exchange.mode.swapHelp',
  },
  [ExchangeMode.HOST]: {
    titleKey: 'listing.exchange.mode.host',
    helpKey: 'listing.exchange.mode.hostHelp',
  },
  [ExchangeMode.BOTH]: {
    titleKey: 'listing.exchange.mode.both',
    helpKey: 'listing.exchange.mode.bothHelp',
  },
};

const formatWindow = (start: string, end: string): string => {
  const startDate = parseISO(start);
  const endDate = parseISO(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return '';
  }
  return `${format(startDate, 'MMM d, yyyy')} → ${format(endDate, 'MMM d, yyyy')}`;
};

interface FactRowProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
}

const FactRow: React.FC<FactRowProps> = ({ icon, label }) => (
  <View style={styles.factRow}>
    <Ionicons name={icon} size={16} color={colors.exchangeAccent} />
    <BloomText style={styles.factText}>{label}</BloomText>
  </View>
);

export const ExchangeSection: React.FC<Props> = ({ exchange, onRequestExchange }) => {
  const { t } = useTranslation();

  const mode = MODE_COPY[exchange.mode] ?? MODE_COPY[ExchangeMode.BOTH];

  const windows = useMemo(
    () => (exchange.availabilityWindows ?? []).slice(0, MAX_WINDOWS_SHOWN),
    [exchange.availabilityWindows],
  );
  const extraWindows =
    (exchange.availabilityWindows?.length ?? 0) - windows.length;

  const stayLabel = useMemo(() => {
    const { minStay, maxStay } = exchange;
    if (minStay && maxStay) {
      return t('listing.exchange.stayRange', {
        min: minStay,
        max: maxStay,
      });
    }
    if (minStay) {
      return t('listing.exchange.minStay', { count: minStay });
    }
    if (maxStay) {
      return t('listing.exchange.maxStay', { count: maxStay });
    }
    return undefined;
  }, [exchange, t]);

  const languages = exchange.languages?.filter(Boolean) ?? [];

  return (
    <Section title={t('listing.exchange.sectionTitle')}>
      {/* Mode */}
      <View style={styles.modeRow}>
        <View style={styles.modeBadge}>
          <Ionicons name="swap-horizontal" size={ICON_SIZE} color={colors.exchangeAccent} />
        </View>
        <View style={styles.modeText}>
          <BloomText style={styles.modeTitle}>
            {t(mode.titleKey)}
          </BloomText>
          <BloomText style={styles.modeHelp}>
            {t(mode.helpKey)}
          </BloomText>
        </View>
      </View>

      {/* Welcome note */}
      {exchange.welcomeNote ? (
        <>
          <Divider />
          <BloomText style={styles.welcomeNote}>{exchange.welcomeNote}</BloomText>
        </>
      ) : null}

      {/* Availability windows */}
      {windows.length > 0 ? (
        <>
          <Divider />
          <View style={styles.block}>
            <BloomText style={styles.blockLabel}>
              {t('listing.exchange.availabilityTitle')}
            </BloomText>
            {windows.map((window) => (
              <View key={`${window.start}_${window.end}`} style={styles.windowRow}>
                <Ionicons
                  name="calendar-outline"
                  size={15}
                  color={colors.COLOR_BLACK_LIGHT_3}
                />
                <BloomText style={styles.windowText}>
                  {formatWindow(window.start, window.end)}
                </BloomText>
              </View>
            ))}
            {extraWindows > 0 ? (
              <BloomText style={styles.moreWindows}>
                {t('listing.exchange.moreWindows', {
                  count: extraWindows,
                })}
              </BloomText>
            ) : null}
          </View>
        </>
      ) : null}

      {/* Facts: stay length, languages, meals, reciprocity */}
      <Divider />
      <View style={styles.factGrid}>
        {stayLabel ? <FactRow icon="moon-outline" label={stayLabel} /> : null}
        {languages.length > 0 ? (
          <FactRow
            icon="chatbubbles-outline"
            label={t('listing.exchange.languagesValue', {
              languages: languages.join(', '),
            })}
          />
        ) : null}
        {exchange.mealsIncluded ? (
          <FactRow
            icon="restaurant-outline"
            label={t('listing.exchange.mealsIncludedFact')}
          />
        ) : null}
        <FactRow
          icon={exchange.requiresReciprocity ? 'repeat-outline' : 'gift-outline'}
          label={
            exchange.requiresReciprocity
              ? t('listing.exchange.reciprocityRequired')
              : t('listing.exchange.reciprocityOptional')
          }
        />
      </View>

      <Button
        variant="primary"
        size="large"
        onPress={onRequestExchange}
        style={styles.cta}
      >
        {t('listing.exchange.requestCta')}
      </Button>
    </Section>
  );
};

const styles = StyleSheet.create({
  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingBottom: spacing.sm,
  },
  modeBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.exchangeSubtle,
  },
  modeText: {
    flex: 1,
    gap: 2,
  },
  modeTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
  },
  modeHelp: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  welcomeNote: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.COLOR_BLACK_LIGHT_2,
    paddingVertical: spacing.sm,
  },
  block: {
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  blockLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.COLOR_BLACK_LIGHT_3,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  windowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  windowText: {
    fontSize: 15,
    color: colors.COLOR_BLACK,
  },
  moreWindows: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_4,
    marginTop: 2,
  },
  factGrid: {
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  factRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  factText: {
    fontSize: 15,
    color: colors.COLOR_BLACK,
    flex: 1,
  },
  cta: {
    marginTop: spacing.md,
  },
});

export default ExchangeSection;
