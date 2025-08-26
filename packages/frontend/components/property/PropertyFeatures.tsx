import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ThemedText } from '@/components/ThemedText';
import { SectionCard } from '@/components/ui/SectionCard';
import { colors } from '@/styles/colors';

type FurnishedStatus = 'furnished' | 'partially_furnished' | 'unfurnished';

interface Props {
    property?: {
        furnishedStatus?: FurnishedStatus;
        hasBalcony?: boolean;
        hasGarden?: boolean;
        hasElevator?: boolean;
    } | null;
}

const AMBER = '#FFA500';

const ICONS = {
    furnished: ['cube', 'cube-outline'] as const, // filled = furnished, outline = not
    balcony: ['home', 'home-outline'] as const,
    garden: ['leaf', 'leaf-outline'] as const,
    elevator: ['arrow-up-circle', 'arrow-up-circle-outline'] as const,
};

function FeatureChip({
    k,
    label,
    active,
    warn,
}: {
    k: keyof typeof ICONS;
    label: string;
    active: boolean;
    warn?: boolean;
}) {
    const icon = ICONS[k][active ? 0 : 1];
    const tint = warn ? AMBER : active ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_4;
    const bg = active ? '#f7fafe' : '#fff';
    const border = active ? '#dceefe' : '#edf1f4';

    return (
        <View style={[styles.chip, { backgroundColor: bg, borderColor: border }]}>
            <View style={styles.iconWrap}>
                <Ionicons name={icon} size={22} color={tint} />
                {warn && <View style={styles.warnDot} />}
            </View>
            <ThemedText numberOfLines={1} style={[styles.chipText, { color: tint }]}>
                {label}
            </ThemedText>
        </View>
    );
}

export const PropertyFeatures: React.FC<Props> = ({ property }) => {
    const { t } = useTranslation();
    const furnishedStatus = property?.furnishedStatus;
    const hasBalcony = property?.hasBalcony;
    const hasGarden = property?.hasGarden;
    const hasElevator = property?.hasElevator;

    const hasAny =
        furnishedStatus !== undefined ||
        hasBalcony !== undefined ||
        hasGarden !== undefined ||
        hasElevator !== undefined;

    const furnishedChip = useMemo(() => {
        if (furnishedStatus === undefined) return null;
        const isFurnished = furnishedStatus === 'furnished';
        const isPartial = furnishedStatus === 'partially_furnished';
        return (
            <FeatureChip
                k="furnished"
                active={isFurnished}
                warn={isPartial}
                label={
                    isFurnished
                        ? t('Furnished')
                        : isPartial
                            ? t('Partially Furnished')
                            : t('Unfurnished')
                }
            />
        );
    }, [furnishedStatus, t]);

    if (!hasAny) return null;

    return (
        <SectionCard title={t('Property Features')}>
            <View style={styles.grid}>
                {furnishedChip}
                {hasBalcony !== undefined && (
                    <FeatureChip k="balcony" active={!!hasBalcony} label={t('Balcony')} />
                )}
                {hasGarden !== undefined && (
                    <FeatureChip k="garden" active={!!hasGarden} label={t('Garden')} />
                )}
                {hasElevator !== undefined && (
                    <FeatureChip k="elevator" active={!!hasElevator} label={t('Elevator')} />
                )}
            </View>
        </SectionCard>
    );
};

const styles = StyleSheet.create({
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
    },
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 999,
        borderWidth: 1,
    },
    iconWrap: { position: 'relative', alignItems: 'center', justifyContent: 'center' },
    warnDot: {
        position: 'absolute',
        top: -2,
        right: -2,
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: AMBER,
    },
    chipText: { fontSize: 13, fontWeight: '600' },
});

export default PropertyFeatures;
