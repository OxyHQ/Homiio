/**
 * FiltersBottomSheet — the ONE filter sheet body every listing surface renders
 * (explore results, the property grids, a city page).
 *
 * Each section is a Bloom control: `Chip` for single / multiple choice,
 * `RangeSlider` for a bounded range, `Switch` for a flag and a stepper built on
 * `Button` for a count. Callers describe sections as data and receive each
 * change through `onFilterChange`; this component owns no filter semantics.
 *
 * ## Why it mirrors the values locally
 *
 * The sheet is presented through `BottomSheetContext.openBottomSheet(<… />)`,
 * which stores the ELEMENT it was given. The caller's state changes on every
 * press but the element in the sheet is the snapshot from the moment it opened,
 * so a chip the user just pressed never looked pressed until the sheet was
 * reopened. Each change is therefore applied to a local overlay as well as
 * reported upward, and the overlay is what renders.
 */
import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '@oxy.so/bloom/button';
import { Chip } from '@oxy.so/bloom/chip';
import { RangeSlider } from '@oxy.so/bloom/slider';
import { Switch } from '@oxy.so/bloom/switch';
import { H3, Text as BloomText } from '@oxy.so/bloom/typography';

import { spacing } from '@/constants/styles';
import { useColors } from '@/hooks/useThemeColor';

export type FilterValue = string | number | boolean | (string | number)[];

export interface FilterOption {
    id: string;
    label: string;
    value: string | number;
}

export interface FilterSection {
    id: string;
    title: string;
    type: 'range' | 'chips' | 'toggle' | 'counter';
    options?: FilterOption[];
    /**
     * Chips only: several options may be on at once. Each press still reports
     * the ONE option pressed — the caller toggles membership — and the sheet
     * mirrors that toggle locally.
     */
    multiple?: boolean;
    /** Range only: lower bound. The bound itself reports as `0` ("no minimum"). */
    min?: number;
    /**
     * Range: upper bound, which itself reports as `0` ("no maximum").
     * Counter: the highest count offered.
     */
    max?: number;
    /** Range only: slider granularity. Defaults to a hundredth of the span. */
    step?: number;
    /** Counter only: accessible names for the decrease / increase buttons. */
    stepLabels?: [string, string];
    /** Range only: formats a thumb's value (e.g. as money). */
    formatValue?: (value: number) => string;
    value?: FilterValue;
}

interface FiltersBottomSheetProps {
    sections: FilterSection[];
    onFilterChange: (sectionId: string, value: FilterValue) => void;
    onApply: () => void;
    onClear: () => void;
    /** Sheet heading. Defaults to "Filters". */
    title?: string;
}

type Overrides = Record<string, FilterValue | undefined>;

/** The range a slider shows for a section, with an unset bound at its edge. */
function rangeOf(section: FilterSection): [number, number] {
    const min = section.min ?? 0;
    const max = section.max ?? 0;
    const [low, high] = Array.isArray(section.value) ? section.value : [];
    const lo = typeof low === 'number' && low > min ? Math.min(low, max) : min;
    const hi = typeof high === 'number' && high > 0 ? Math.min(high, max) : max;
    return [lo, Math.max(lo, hi)];
}

export function FiltersBottomSheet({
    sections,
    onFilterChange,
    onApply,
    onClear,
    title,
}: FiltersBottomSheetProps) {
    const { t } = useTranslation();
    const colors = useColors();
    const [overrides, setOverrides] = useState<Overrides>({});

    const valueOf = useCallback(
        (section: FilterSection): FilterValue | undefined =>
            section.id in overrides ? overrides[section.id] : section.value,
        [overrides],
    );

    const report = useCallback(
        (section: FilterSection, reported: FilterValue, shown: FilterValue | undefined) => {
            setOverrides((prev) => ({ ...prev, [section.id]: shown }));
            onFilterChange(section.id, reported);
        },
        [onFilterChange],
    );

    const handleClear = useCallback(() => {
        setOverrides({});
        onClear();
    }, [onClear]);

    const renderChips = (section: FilterSection) => {
        const current = valueOf(section);
        const multiple = section.multiple ?? Array.isArray(current);
        const selectedValues = Array.isArray(current) ? current : [];
        return (
            <View style={styles.chips}>
                {(section.options ?? []).map((option) => {
                    const isSelected = multiple
                        ? selectedValues.includes(option.value)
                        : current === option.value;
                    const onPress = () => {
                        if (!multiple) {
                            report(section, option.value, option.value);
                            return;
                        }
                        const next = isSelected
                            ? selectedValues.filter((v) => v !== option.value)
                            : [...selectedValues, option.value];
                        report(section, option.value, next);
                    };
                    return (
                        <Chip
                            key={option.id}
                            variant={isSelected ? 'solid' : 'outlined'}
                            size="large"
                            selected={isSelected}
                            onPress={onPress}
                            accessibilityLabel={option.label}
                        >
                            {option.label}
                        </Chip>
                    );
                })}
            </View>
        );
    };

    const renderRange = (section: FilterSection) => {
        if (section.min === undefined || section.max === undefined) return null;
        const min = section.min;
        const max = section.max;
        const current = valueOf(section);
        const shownSection = { ...section, value: current };
        const [lo, hi] = rangeOf(shownSection);
        const step = section.step ?? Math.max(1, Math.round((max - min) / 100));
        const format = section.formatValue ?? ((value: number) => String(value));
        return (
            <View style={styles.rangeTrack}>
                <RangeSlider
                    value={[lo, hi]}
                    min={min}
                    max={max}
                    step={step}
                    // The thumbs move locally while dragging; the caller hears about it
                    // once, when the gesture ends, so a drag is not twenty queries.
                    onValueChange={(next) =>
                        setOverrides((prev) => ({ ...prev, [section.id]: next }))
                    }
                    onSlidingComplete={([nextLo, nextHi]) =>
                        report(
                            section,
                            [nextLo <= min ? 0 : nextLo, nextHi >= max ? 0 : nextHi],
                            [nextLo, nextHi],
                        )
                    }
                    formatValue={(value) => format(value)}
                    thumbLabels={[t('search.step.price.min'), t('search.step.price.max')]}
                    accessibilityLabel={section.title}
                />
            </View>
        );
    };

    const renderCounter = (section: FilterSection) => {
        const current = valueOf(section);
        const count = typeof current === 'number' ? current : 0;
        return (
            <View style={styles.counterRow}>
                <Button
                    variant="icon"
                    size="small"
                    disabled={count <= 0}
                    onPress={() => report(section, Math.max(0, count - 1), Math.max(0, count - 1))}
                    accessibilityLabel={section.stepLabels?.[0] ?? section.title}
                >
                    {'−'}
                </Button>
                <BloomText style={[styles.counterValue, { color: colors.text }]}>{count}</BloomText>
                <Button
                    variant="icon"
                    size="small"
                    disabled={section.max !== undefined && count >= section.max}
                    onPress={() => report(section, count + 1, count + 1)}
                    accessibilityLabel={section.stepLabels?.[1] ?? section.title}
                >
                    {'+'}
                </Button>
            </View>
        );
    };

    return (
        <View style={styles.container}>
            <H3 style={styles.title}>{title ?? t('search.actions.filters')}</H3>

            <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
            >
                {sections.map((section) =>
                    section.type === 'toggle' ? (
                        <View key={section.id} style={styles.toggleRow}>
                            <BloomText style={[styles.sectionTitle, styles.toggleLabel, { color: colors.text }]}>
                                {section.title}
                            </BloomText>
                            <Switch
                                value={Boolean(valueOf(section))}
                                onValueChange={(next) => report(section, next, next)}
                                accessibilityLabel={section.title}
                            />
                        </View>
                    ) : (
                        <View key={section.id} style={styles.section}>
                            <BloomText style={[styles.sectionTitle, { color: colors.text }]}>
                                {section.title}
                            </BloomText>
                            {section.type === 'chips' ? renderChips(section) : null}
                            {section.type === 'range' ? renderRange(section) : null}
                            {section.type === 'counter' ? renderCounter(section) : null}
                        </View>
                    ),
                )}
            </ScrollView>

            <View style={[styles.footer, { borderTopColor: colors.border }]}>
                <Button variant="secondary" size="medium" onPress={handleClear} style={styles.footerButton}>
                    {t('search.actions.clearAll')}
                </Button>
                <Button variant="primary" size="medium" onPress={onApply} style={styles.footerButton}>
                    {t('common.done')}
                </Button>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        paddingTop: spacing.sm,
    },
    title: {
        paddingHorizontal: spacing.lg,
        marginBottom: spacing.md,
    },
    scroll: {
        flex: 1,
    },
    scrollContent: {
        paddingHorizontal: spacing.lg,
        paddingBottom: spacing.lg,
        gap: spacing.xl,
    },
    section: {
        gap: spacing.md,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: '600',
    },
    chips: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: spacing.sm,
    },
    // The thumbs' value bubbles are centred on the thumbs, so at either end of
    // the track half a bubble hangs past it; the inset keeps them on screen.
    rangeTrack: {
        paddingHorizontal: spacing.xl,
    },
    toggleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.md,
    },
    toggleLabel: {
        flex: 1,
    },
    counterRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.lg,
    },
    counterValue: {
        fontSize: 16,
        fontWeight: '600',
        minWidth: 24,
        textAlign: 'center',
    },
    footer: {
        flexDirection: 'row',
        gap: spacing.md,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    footerButton: {
        flex: 1,
    },
});
