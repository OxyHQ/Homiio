/**
 * SearchPanel — the Airbnb-style expanding search composer.
 *
 * Collapsed, the search surface is a pill (rendered by `SearchSummaryBar`,
 * mounted by the caller). When `open` is true this panel presents the active
 * step. Presentation is breakpoint-driven from a SINGLE component:
 *
 *  - Wide screens (`useIsScreenNotMobile()`): an inline, elevated card the
 *    caller anchors under the pill.
 *  - Narrow screens: a full-screen `Modal` overlay/sheet.
 *
 * Steps (long-term, the default): Where → Type → Price. A Long-term/Vacation
 * toggle reveals an extra Dates step in vacation mode (Where → Type → Dates →
 * Price). Long-term mode never shows a calendar.
 *
 * The panel edits a LOCAL draft of the {@link SearchQuery} and only commits it
 * (via `onSubmit`) when the user presses Search, at which point it also records
 * the search in the persisted recent-searches store. This keeps the live
 * `searchQueryStore` stable while the user composes.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Button } from '@oxyhq/bloom/button';
import * as SegmentedControl from '@oxyhq/bloom/segmented-control';
import { H3 } from '@oxyhq/bloom/typography';

import { PropertyType, RentMode } from '@homiio/shared-types';
import { useIsScreenNotMobile } from '@/hooks/useOptimizedMediaQuery';
import { useRecentSearchesStore, type RecentSearch } from '@/store/recentSearchesStore';
import { colors } from '@/styles/colors';
import { cardShadow, radius, spacing } from '@/constants/styles';

import { WhereStep } from './steps/WhereStep';
import { TypeStep } from './steps/TypeStep';
import { PriceStep } from './steps/PriceStep';
import { DatesStep } from './steps/DatesStep';
import type {
  SearchDateRange,
  SearchLocation,
  SearchQuery,
  SearchStep,
} from './types';

/** Ordered steps per rental mode. Long-term never includes `dates`. */
const LONG_TERM_STEPS: readonly SearchStep[] = ['where', 'type', 'price'];
const VACATION_STEPS: readonly SearchStep[] = ['where', 'type', 'dates', 'price'];

/** Build a short recent-search label from a committed query. */
function buildRecentLabel(query: SearchQuery): { label: string; sublabel?: string } {
  const where = query.location?.shortLabel ?? 'Anywhere';
  const typeCount = query.propertyTypes.length;
  const typePart =
    typeCount === 0 ? '' : typeCount === 1 ? ` · ${query.propertyTypes[0]}` : ` · ${typeCount} types`;
  const pricePart =
    query.priceMax !== undefined
      ? `Up to €${query.priceMax}`
      : query.priceMin !== undefined
        ? `From €${query.priceMin}`
        : undefined;
  return { label: `${where}${typePart}`, sublabel: pricePart };
}

interface SearchPanelProps {
  /** Whether the panel is expanded/visible. */
  open: boolean;
  /** Close without committing (X / backdrop). */
  onClose: () => void;
  /** The query to seed the draft from when the panel opens. */
  initialQuery: SearchQuery;
  /**
   * Commit handler. Receives the fully-composed query. The caller persists it
   * to the active-search store and navigates to results.
   */
  onSubmit: (query: SearchQuery) => void;
}

export const SearchPanel: React.FC<SearchPanelProps> = ({
  open,
  onClose,
  initialQuery,
  onSubmit,
}) => {
  const { t } = useTranslation();
  const isWide = useIsScreenNotMobile();
  const addRecentSearch = useRecentSearchesStore((s) => s.addSearch);

  // Local draft, seeded once from `initialQuery`. The panel early-returns
  // `null` when `open` is false (on both breakpoints), so it fully unmounts
  // while collapsed and re-seeds from a fresh `initialQuery` on every reopen —
  // no `useEffect` and no parent `key` required.
  const [draft, setDraft] = useState<SearchQuery>(initialQuery);
  const [whereText, setWhereText] = useState<string>(
    initialQuery.location?.label ?? '',
  );
  const [step, setStep] = useState<SearchStep>('where');

  const steps = useMemo(
    () => (draft.rentMode === RentMode.VACATION ? VACATION_STEPS : LONG_TERM_STEPS),
    [draft.rentMode],
  );
  const stepIndex = Math.max(0, steps.indexOf(step));
  const isLastStep = stepIndex === steps.length - 1;

  const handleRentMode = useCallback((mode: RentMode) => {
    setDraft((prev) => ({
      ...prev,
      rentMode: mode,
      ...(mode === RentMode.LONG_TERM ? { dates: undefined, guests: undefined } : {}),
    }));
    // Leaving vacation while on the dates step would strand the user.
    setStep((prev) => (mode === RentMode.LONG_TERM && prev === 'dates' ? 'price' : prev));
  }, []);

  const handleSelectLocation = useCallback((location: SearchLocation) => {
    setDraft((prev) => ({ ...prev, location }));
    setWhereText(location.label);
    setStep('type');
  }, []);

  const handleSelectRecent = useCallback(
    (recent: RecentSearch) => {
      // Re-running a recent search commits immediately.
      onSubmit(recent.query);
    },
    [onSubmit],
  );

  const handleToggleType = useCallback((type: PropertyType) => {
    setDraft((prev) => {
      const next = prev.propertyTypes.includes(type)
        ? prev.propertyTypes.filter((tpe) => tpe !== type)
        : [...prev.propertyTypes, type];
      return { ...prev, propertyTypes: next };
    });
  }, []);

  const handlePriceChange = useCallback((min: number | undefined, max: number | undefined) => {
    setDraft((prev) => ({ ...prev, priceMin: min, priceMax: max }));
  }, []);

  const handleDatesChange = useCallback((dates: SearchDateRange | undefined) => {
    setDraft((prev) => ({ ...prev, dates }));
  }, []);

  const handleNext = useCallback(() => {
    setStep(steps[Math.min(stepIndex + 1, steps.length - 1)]);
  }, [steps, stepIndex]);

  const handleBack = useCallback(() => {
    setStep(steps[Math.max(stepIndex - 1, 0)]);
  }, [steps, stepIndex]);

  const handleClear = useCallback(() => {
    setDraft((prev) => ({
      ...prev,
      location: undefined,
      propertyTypes: [],
      priceMin: undefined,
      priceMax: undefined,
      dates: undefined,
      guests: undefined,
    }));
    setWhereText('');
    setStep('where');
  }, []);

  const handleSubmit = useCallback(() => {
    const { label, sublabel } = buildRecentLabel(draft);
    addRecentSearch({ label, sublabel, query: draft });
    onSubmit(draft);
  }, [draft, addRecentSearch, onSubmit]);

  const stepContent = useMemo(() => {
    switch (step) {
      case 'where':
        return (
          <WhereStep
            value={whereText}
            onChangeText={setWhereText}
            onSelectLocation={handleSelectLocation}
            onSelectRecent={handleSelectRecent}
          />
        );
      case 'type':
        return (
          <TypeStep
            rentMode={draft.rentMode}
            selected={draft.propertyTypes}
            onToggle={handleToggleType}
          />
        );
      case 'dates':
        return <DatesStep value={draft.dates} onChange={handleDatesChange} />;
      case 'price':
        return (
          <PriceStep
            rentMode={draft.rentMode}
            priceMin={draft.priceMin}
            priceMax={draft.priceMax}
            onChange={handlePriceChange}
          />
        );
      default:
        return null;
    }
  }, [
    step,
    whereText,
    draft,
    handleSelectLocation,
    handleSelectRecent,
    handleToggleType,
    handleDatesChange,
    handlePriceChange,
  ]);

  if (!open) return null;

  const header = (
    <View style={styles.header}>
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t('common.close', 'Close') || 'Close'}
        hitSlop={spacing.sm}
        style={styles.headerClose}
      >
        <Ionicons name="close" size={22} color={colors.COLOR_BLACK} />
      </Pressable>
      <View style={styles.modeToggle}>
        <SegmentedControl.Root<RentMode>
          label={t('search.mode.label', 'Rental mode') || 'Rental mode'}
          type="tabs"
          size="small"
          value={draft.rentMode}
          onChange={handleRentMode}
        >
          <SegmentedControl.Item value={RentMode.LONG_TERM}>
            <SegmentedControl.ItemText>
              {t('search.mode.longTerm', 'Long-term') || 'Long-term'}
            </SegmentedControl.ItemText>
          </SegmentedControl.Item>
          <SegmentedControl.Item value={RentMode.VACATION}>
            <SegmentedControl.ItemText>
              {t('search.mode.vacation', 'Vacation') || 'Vacation'}
            </SegmentedControl.ItemText>
          </SegmentedControl.Item>
        </SegmentedControl.Root>
      </View>
      <View style={styles.headerClose} />
    </View>
  );

  const footer = (
    <View style={styles.footer}>
      <Button
        variant="text"
        size="small"
        onPress={handleClear}
        accessibilityLabel={t('search.actions.clearAll', 'Clear all') || 'Clear all'}
      >
        {t('search.actions.clearAll', 'Clear all') || 'Clear all'}
      </Button>
      <View style={styles.footerActions}>
        {stepIndex > 0 ? (
          <Button
            variant="secondary"
            size="medium"
            onPress={handleBack}
            accessibilityLabel={t('common.back', 'Back') || 'Back'}
          >
            {t('common.back', 'Back') || 'Back'}
          </Button>
        ) : null}
        {isLastStep ? (
          <Button
            variant="primary"
            size="medium"
            onPress={handleSubmit}
            icon={<Ionicons name="search" size={16} color={colors.white} />}
            iconPosition="left"
            accessibilityLabel={t('search.actions.search', 'Search') || 'Search'}
          >
            {t('search.actions.search', 'Search') || 'Search'}
          </Button>
        ) : (
          <Button
            variant="primary"
            size="medium"
            onPress={handleNext}
            accessibilityLabel={t('common.next', 'Next') || 'Next'}
          >
            {t('common.next', 'Next') || 'Next'}
          </Button>
        )}
      </View>
    </View>
  );

  const body = (
    <View style={[styles.panel, isWide ? styles.panelWide : styles.panelFull, cardShadow.lg]}>
      {header}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {stepContent}
      </ScrollView>
      {footer}
    </View>
  );

  // Wide: inline elevated card the caller positions under the pill.
  if (isWide) {
    return body;
  }

  // Narrow: full-screen modal overlay — SAME component, breakpoint-driven.
  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable
          style={styles.backdrop}
          accessibilityRole="button"
          accessibilityLabel={t('common.close', 'Close') || 'Close'}
          onPress={onClose}
        />
        <View style={styles.modalSheet}>
          <View style={styles.sheetHandleWrap}>
            <H3 style={styles.sheetTitle}>
              {t('search.panel.title', 'Search') || 'Search'}
            </H3>
          </View>
          {body}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.xl,
    overflow: 'hidden',
  },
  panelWide: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    maxHeight: 560,
  },
  panelFull: {
    flex: 1,
    borderRadius: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  headerClose: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeToggle: {
    flex: 1,
    maxWidth: 280,
    alignItems: 'center',
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    gap: spacing.lg,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.md,
  },
  footerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.overlay,
  },
  modalSheet: {
    flex: 1,
    marginTop: spacing['5xl'],
    backgroundColor: colors.surfaceElevated,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    overflow: 'hidden',
  },
  sheetHandleWrap: {
    alignItems: 'center',
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
  },
});

export default SearchPanel;
