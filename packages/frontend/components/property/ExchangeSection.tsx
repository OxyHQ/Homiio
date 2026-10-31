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
import type React from 'react';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns/format';
import { parseISO } from 'date-fns/parseISO';

import { Button } from '@oxy.so/bloom/button';
import { Divider } from '@oxy.so/bloom/divider';
import { Text as BloomText } from '@oxy.so/bloom/typography';
import { RiArrowLeftRightLine } from '@oxy.so/bloom/icons/RiArrowLeftRightLine';
import { RiCalendarLine } from '@oxy.so/bloom/icons/RiCalendarLine';
import { RiChat3Line } from '@oxy.so/bloom/icons/RiChat3Line';
import { RiGiftLine } from '@oxy.so/bloom/icons/RiGiftLine';
import { RiMoonLine } from '@oxy.so/bloom/icons/RiMoonLine';
import { RiRepeatLine } from '@oxy.so/bloom/icons/RiRepeatLine';
import { RiRestaurantLine } from '@oxy.so/bloom/icons/RiRestaurantLine';
import { useTheme } from '@oxy.so/bloom/theme';

import { ExchangeMode } from '@homiio/shared-types/common';
import type { PropertyExchange } from '@homiio/shared-types';
import { Section } from '@/components/property/Section';
import { spacing } from '@/constants/styles';

interface Props {
  exchange: PropertyExchange;
  /**
   * Open the request-exchange flow (primary CTA).
   *
   * OMITTED for an external listing, and the CTA then does not render at all.
   * Homiio cannot arrange a swap in a home it merely copied an advertisement
   * for: there is nobody here to agree to it. The screen decides that — the
   * booking card and the action bar branch on `isExternal` before anything
   * else, and this section used to be the one surface that did not, offering a
   * live "Request exchange" button on a scraped listing.
   */
  onRequestExchange?: () => void;
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

type FactIcon = React.ComponentType<{ width?: number; height?: number; fill?: string }>;

interface FactRowProps {
  icon: FactIcon;
  label: string;
}

const FactRow: React.FC<FactRowProps> = ({ icon: Icon, label }) => {
  const { colors } = useTheme();
  return (
    <View style={styles.factRow}>
      <Icon width={16} height={16} fill={colors.tertiarySubtleForeground} />
      <BloomText className="text-foreground" style={styles.factText}>
        {label}
      </BloomText>
    </View>
  );
};

export const ExchangeSection: React.FC<Props> = ({ exchange, onRequestExchange }) => {
  const { t } = useTranslation();
  const { colors } = useTheme();

  const mode = MODE_COPY[exchange.mode] ?? MODE_COPY[ExchangeMode.BOTH];

  const windows = useMemo(
    () => (exchange.availabilityWindows ?? []).slice(0, MAX_WINDOWS_SHOWN),
    [exchange.availabilityWindows],
  );
  const extraWindows = (exchange.availabilityWindows?.length ?? 0) - windows.length;

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
        <View className="h-10 w-10 items-center justify-center rounded-full bg-tertiary-subtle">
          <RiArrowLeftRightLine
            width={ICON_SIZE}
            height={ICON_SIZE}
            fill={colors.tertiarySubtleForeground}
          />
        </View>
        <View style={styles.modeText}>
          <BloomText className="text-foreground" style={styles.modeTitle}>
            {t(mode.titleKey)}
          </BloomText>
          <BloomText className="text-muted-foreground" style={styles.modeHelp}>
            {t(mode.helpKey)}
          </BloomText>
        </View>
      </View>

      {/* Welcome note */}
      {exchange.welcomeNote ? (
        <>
          <Divider />
          <BloomText className="text-foreground" style={styles.welcomeNote}>
            {exchange.welcomeNote}
          </BloomText>
        </>
      ) : null}

      {/* Availability windows */}
      {windows.length > 0 ? (
        <>
          <Divider />
          <View style={styles.block}>
            <BloomText className="text-muted-foreground" style={styles.blockLabel}>
              {t('listing.exchange.availabilityTitle')}
            </BloomText>
            {windows.map((window) => (
              <View key={`${window.start}_${window.end}`} style={styles.windowRow}>
                <RiCalendarLine width={15} height={15} fill={colors.textSecondary} />
                <BloomText className="text-foreground" style={styles.windowText}>
                  {formatWindow(window.start, window.end)}
                </BloomText>
              </View>
            ))}
            {extraWindows > 0 ? (
              <BloomText className="text-muted-foreground" style={styles.moreWindows}>
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
        {stayLabel ? <FactRow icon={RiMoonLine} label={stayLabel} /> : null}
        {languages.length > 0 ? (
          <FactRow
            icon={RiChat3Line}
            label={t('listing.exchange.languagesValue', {
              languages: languages.join(', '),
            })}
          />
        ) : null}
        {exchange.mealsIncluded ? (
          <FactRow icon={RiRestaurantLine} label={t('listing.exchange.mealsIncludedFact')} />
        ) : null}
        <FactRow
          icon={exchange.requiresReciprocity ? RiRepeatLine : RiGiftLine}
          label={
            exchange.requiresReciprocity
              ? t('listing.exchange.reciprocityRequired')
              : t('listing.exchange.reciprocityOptional')
          }
        />
      </View>

      {onRequestExchange ? (
        <Button
          size="lg"
          onPress={onRequestExchange}
          style={styles.cta}
          tone="accent"
          appearance="solid"
        >
          {t('listing.exchange.requestCta')}
        </Button>
      ) : null}
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
  modeText: {
    flex: 1,
    gap: 2,
  },
  modeTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  modeHelp: {
    fontSize: 14,
  },
  welcomeNote: {
    fontSize: 15,
    lineHeight: 22,
    paddingVertical: spacing.sm,
  },
  block: {
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  blockLabel: {
    fontSize: 13,
    fontWeight: '700',
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
  },
  moreWindows: {
    fontSize: 13,
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
    flex: 1,
  },
  cta: {
    marginTop: spacing.md,
  },
});
