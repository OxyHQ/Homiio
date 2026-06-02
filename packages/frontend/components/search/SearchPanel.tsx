/**
 * SearchPanel — the Airbnb-style expanding search composer.
 *
 * Collapsed, the search surface is a pill (rendered by `SearchSummaryBar`,
 * mounted by the caller). When `open` is true this panel presents the active
 * step. Presentation is breakpoint-driven from a SINGLE component:
 *
 *  - Wide screens (`useIsScreenNotMobile()`): a COMPACT centered dialog
 *    (`CenteredDialog`) over a dimmed page. It shows ONLY the single tapped step
 *    — a contextual title + close, the step's content, and a primary "Done" that
 *    applies the draft to the live query (so the pill updates) and closes. There
 *    is no multi-step back/next chrome on wide; the pill's own circular Search
 *    button runs the actual search.
 *  - Narrow screens: a full-screen slide-up `Modal` sheet that walks the full
 *    Where → Type → (Dates) → Price flow with a browse-mode toggle and
 *    Back/Next/Search footer.
 *
 * Steps (long-term, the default): Where → Type → Price. A Long-term/Vacation
 * toggle reveals an extra Dates step in vacation mode (Where → Type → Dates →
 * Price). Long-term mode never shows a calendar.
 *
 * The panel edits a LOCAL draft of the {@link SearchQuery}. The narrow sheet
 * commits it (via `onSubmit`) when the user presses Search, recording the search
 * in the persisted recent-searches store. The wide dialog applies it (via
 * `onApply`, defaulting to `onSubmit`) when the user presses Done. This keeps
 * the live `searchQueryStore` stable while the user composes.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Button } from '@oxyhq/bloom/button';
import { CenteredDialog } from '@oxyhq/bloom/dialog';
import * as SegmentedControl from '@oxyhq/bloom/segmented-control';
import { H3 } from '@oxyhq/bloom/typography';

import { OfferingType, PropertyType } from '@homiio/shared-types';
import { useIsScreenNotMobile } from '@/hooks/useOptimizedMediaQuery';
import { useRecentSearchesStore, type RecentSearch } from '@/store/recentSearchesStore';
import { colors } from '@/styles/colors';
import { cardShadow, radius, spacing } from '@/constants/styles';

import { WhereStep } from './steps/WhereStep';
import { TypeStep } from './steps/TypeStep';
import { PriceStep } from './steps/PriceStep';
import { DatesStep } from './steps/DatesStep';
import {
  BROWSE_MODE_OFFERING,
  browseModeFromOffering,
  type BrowseMode,
  type SearchDateRange,
  type SearchLocation,
  type SearchQuery,
  type SearchStep,
} from './types';

/** The four top-level browse modes, in display order, for the panel toggle. */
const BROWSE_MODE_ORDER: readonly BrowseMode[] = [
  'long_term',
  'vacation',
  'buy',
  'exchange',
];

/** i18n key + fallback label for each browse mode in the panel toggle. */
const BROWSE_MODE_LABELS: Record<BrowseMode, { key: string; fallback: string }> = {
  long_term: { key: 'search.mode.longTerm', fallback: 'Long-term' },
  vacation: { key: 'search.mode.vacation', fallback: 'Vacation' },
  buy: { key: 'search.mode.buy', fallback: 'Buy' },
  exchange: { key: 'search.mode.exchange', fallback: 'Exchange' },
};

/** Ordered steps per rental mode. Long-term never includes `dates`. */
const LONG_TERM_STEPS: readonly SearchStep[] = ['where', 'type', 'price'];
const VACATION_STEPS: readonly SearchStep[] = ['where', 'type', 'dates', 'price'];

/**
 * Contextual title for the compact wide dialog's header — the short label of the
 * single tapped step (mirrors the collapsed pill's column labels). The narrow
 * sheet keeps its own generic "Search" title and per-step content headings.
 */
const STEP_TITLE: Record<SearchStep, { key: string; fallback: string }> = {
  where: { key: 'searchBar.long.where', fallback: 'Where' },
  type: { key: 'searchBar.long.propertyType', fallback: 'Property type' },
  dates: { key: 'searchBar.vacation.when', fallback: 'When' },
  price: { key: 'search.step.price.title', fallback: 'Price range' },
};

/**
 * Compact wide-dialog width. The dialog shows a SINGLE step, so it stays snug
 * and centered. Bloom's `CenteredDialog` caps the height itself (80% of the
 * viewport, body scrolls) so the longer steps — the two-month calendar, the
 * city autocomplete list — scroll inside the card rather than growing it
 * off-screen; we only set the width here.
 */
const DIALOG_MAX_WIDTH = 420;

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
   * Step to open on. Defaults to `'where'`. The collapsed 3-column pill passes
   * the column the user tapped (e.g. `'type'`) so the panel lands on the
   * relevant step. If the requested step is not valid for the seeded rental
   * mode (e.g. `'dates'` in long-term), it falls back to `'where'`.
   */
  initialStep?: SearchStep;
  /**
   * Commit handler. Receives the fully-composed query. The caller persists it
   * to the active-search store and navigates to results. Used by the narrow
   * sheet's "Search" button.
   */
  onSubmit: (query: SearchQuery) => void;
  /**
   * Apply handler for the wide dialog's "Done": persists the composed query to
   * the live store (so the collapsed pill updates) WITHOUT navigating — the
   * pill's own circular Search button runs the actual search. Defaults to
   * {@link onSubmit} for callers (e.g. the results route) where applying and
   * submitting are the same action.
   */
  onApply?: (query: SearchQuery) => void;
}

export const SearchPanel: React.FC<SearchPanelProps> = ({
  open,
  onClose,
  initialQuery,
  initialStep = 'where',
  onSubmit,
  onApply,
}) => {
  const { t } = useTranslation();
  const isWide = useIsScreenNotMobile();
  const insets = useSafeAreaInsets();
  const addRecentSearch = useRecentSearchesStore((s) => s.addSearch);
  // Apply (wide "Done") falls back to submit when the caller doesn't separate
  // the two (the results route applies in place; the home hero navigates).
  const applyQuery = onApply ?? onSubmit;

  // Local draft, seeded once from `initialQuery`. The panel early-returns
  // `null` when `open` is false (on both breakpoints), so it fully unmounts
  // while collapsed and re-seeds from a fresh `initialQuery` on every reopen —
  // no `useEffect` and no parent `key` required.
  const [draft, setDraft] = useState<SearchQuery>(initialQuery);
  const [whereText, setWhereText] = useState<string>(
    initialQuery.location?.label ?? '',
  );
  // Seed the opening step from `initialStep`, clamped to the steps valid for the
  // seeded rental mode (e.g. `'dates'` only exists in vacation). The panel fully
  // unmounts while collapsed, so this initializer re-runs on every reopen — no
  // `useEffect` needed.
  const [step, setStep] = useState<SearchStep>(() => {
    const validSteps =
      initialQuery.offering === OfferingType.SHORT_TERM_RENT
        ? VACATION_STEPS
        : LONG_TERM_STEPS;
    return validSteps.includes(initialStep) ? initialStep : 'where';
  });

  const steps = useMemo(
    () =>
      draft.offering === OfferingType.SHORT_TERM_RENT ? VACATION_STEPS : LONG_TERM_STEPS,
    [draft.offering],
  );
  const stepIndex = Math.max(0, steps.indexOf(step));
  const isLastStep = stepIndex === steps.length - 1;

  // The toggle's current value is derived from the draft's active offering
  // rather than stored separately, so the panel keeps one source of truth.
  const draftBrowseMode = browseModeFromOffering(draft.offering);

  const handleBrowseMode = useCallback((next: BrowseMode) => {
    const offering = BROWSE_MODE_OFFERING[next];
    const isShortTerm = offering === OfferingType.SHORT_TERM_RENT;
    setDraft((prev) => ({
      ...prev,
      offering,
      // The price range is per-offering (monthly vs nightly vs sale), so clear
      // it when switching; short-term-only fields are meaningless elsewhere.
      priceMin: undefined,
      priceMax: undefined,
      ...(isShortTerm ? {} : { dates: undefined, guests: undefined }),
    }));
    // Leaving the short-term experience while on the dates step would strand the
    // user (the other offerings have no calendar step).
    setStep((prev) => (!isShortTerm && prev === 'dates' ? 'price' : prev));
  }, []);

  const handleSelectLocation = useCallback(
    (location: SearchLocation) => {
      setDraft((prev) => ({ ...prev, location }));
      setWhereText(location.label);
      // The narrow sheet walks the multi-step flow, so picking a place advances
      // to the type step. The wide dialog shows ONLY the tapped step, so it
      // stays on "where" with the now-filled input; the user presses Done.
      if (!isWide) {
        setStep('type');
      }
    },
    [isWide],
  );

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

  // Wide dialog "Done": push the draft to the live query so the collapsed pill
  // reflects it, then close. No navigation and no recent-search entry — the pill
  // updates and the user runs the search from the pill's circular Search button.
  const handleApply = useCallback(() => {
    applyQuery(draft);
  }, [applyQuery, draft]);

  // The wide path renders the step inside Bloom's compact `CenteredDialog`
  // (whose header already names the step), so the steps drop their redundant
  // internal heading and tighten their gaps via `compact`. The narrow sheet
  // (`isWide` is false) keeps the full per-step heading. The two presentations
  // are mutually exclusive, so `isWide` is the single source for compactness.
  const stepContent = useMemo(() => {
    switch (step) {
      case 'where':
        return (
          <WhereStep
            value={whereText}
            onChangeText={setWhereText}
            onSelectLocation={handleSelectLocation}
            onSelectRecent={handleSelectRecent}
            compact={isWide}
          />
        );
      case 'type':
        return (
          <TypeStep
            offering={draft.offering}
            selected={draft.propertyTypes}
            onToggle={handleToggleType}
            compact={isWide}
          />
        );
      case 'dates':
        return <DatesStep value={draft.dates} onChange={handleDatesChange} compact={isWide} />;
      case 'price':
        return (
          <PriceStep
            offering={draft.offering}
            priceMin={draft.priceMin}
            priceMax={draft.priceMax}
            onChange={handlePriceChange}
            compact={isWide}
          />
        );
      default:
        return null;
    }
  }, [
    step,
    whereText,
    draft,
    isWide,
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
        <SegmentedControl.Root<BrowseMode>
          label={t('search.mode.label', 'Browse mode') || 'Browse mode'}
          type="tabs"
          size="small"
          value={draftBrowseMode}
          onChange={handleBrowseMode}
        >
          {BROWSE_MODE_ORDER.map((browseMode) => (
            <SegmentedControl.Item key={browseMode} value={browseMode}>
              <SegmentedControl.ItemText>
                {t(BROWSE_MODE_LABELS[browseMode].key, BROWSE_MODE_LABELS[browseMode].fallback) ||
                  BROWSE_MODE_LABELS[browseMode].fallback}
              </SegmentedControl.ItemText>
            </SegmentedControl.Item>
          ))}
        </SegmentedControl.Root>
      </View>
      <View style={styles.headerClose} />
    </View>
  );

  const footer = (
    <View
      style={[
        styles.footer,
        // The full-screen sheet pins this footer to the bottom edge, so the CTA
        // must clear the home indicator.
        { paddingBottom: spacing.md + insets.bottom },
      ]}
    >
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
            icon={<Ionicons name="search" size={16} color={colors.primaryForeground} />}
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

  // Wide: a COMPACT centered Bloom dialog showing ONLY the single tapped step.
  // Bloom owns the chrome — a tight title + close header, the scrollable body
  // (compact padding/gaps by default), and a footer slot with a hairline
  // separator. We pass the contextual step title, the step content, and a
  // primary "Done" footer button that applies the draft to the live query (so
  // the collapsed pill updates) and closes. No browse-mode toggle and no
  // Back/Next chrome: the pill's circular Search button runs the search.
  if (isWide) {
    const stepTitle =
      t(STEP_TITLE[step].key, STEP_TITLE[step].fallback) || STEP_TITLE[step].fallback;
    return (
      <CenteredDialog
        visible={open}
        onClose={onClose}
        title={stepTitle}
        maxWidth={DIALOG_MAX_WIDTH}
        closeAccessibilityLabel={t('common.close', 'Close') || 'Close'}
        footer={
          <View style={styles.dialogFooter}>
            <Button
              variant="primary"
              size="medium"
              onPress={handleApply}
              accessibilityLabel={t('common.done', 'Done') || 'Done'}
            >
              {t('common.done', 'Done') || 'Done'}
            </Button>
          </View>
        }
      >
        {stepContent}
      </CenteredDialog>
    );
  }

  // Narrow: full-screen slide-up sheet that walks the full multi-step flow.
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
          <View style={[styles.panel, styles.panelFull, cardShadow.lg]}>
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
  panelFull: {
    flex: 1,
    borderRadius: 0,
  },

  // --- Wide compact dialog (single step) ---
  // Bloom's `CenteredDialog` owns the header, body padding, and the footer's
  // hairline + padding; this footer row only right-aligns the "Done" button
  // inside that slot.
  dialogFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },

  // --- Narrow full-screen sheet ---
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
    // Wide enough for the four browse segments (Long-term / Vacation / Buy /
    // Exchange) to read on one line each at the small segmented size.
    maxWidth: 380,
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
