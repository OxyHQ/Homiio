import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

import {
    RiBuilding2Line,
    RiCalendarLine,
    RiCarLine,
    RiHome4Line,
    type Props as IconProps,
} from '@oxy.so/bloom/icons';
import { Text as BloomText } from '@oxy.so/bloom/typography';

import { Section } from '@/components/property/Section';
import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';
import type { Property } from '@homiio/shared-types';

interface Props { property: Property | null }

const ICON_SIZE = 20;

interface DetailFact {
    key: string;
    icon: React.ComponentType<IconProps>;
    label: string;
    value: string;
}

export const PropertyDetailsCard: React.FC<Props> = ({ property }) => {
    const { t } = useTranslation();
    const type = property?.type;
    const floor = property?.floor;
    const yearBuilt = property?.yearBuilt;
    const parkingSpaces = property?.parkingSpaces;

    const facts: DetailFact[] = [
        {
            key: 'type',
            icon: RiHome4Line,
            label: t('property.sections.propertyType'),
            value: type ? type.charAt(0).toUpperCase() + type.slice(1) : t('property.sections.notSpecified'),
        },
    ];
    if (floor !== undefined) {
        facts.push({ key: 'floor', icon: RiBuilding2Line, label: t('property.sections.floor'), value: String(floor) });
    }
    if (yearBuilt) {
        facts.push({ key: 'yearBuilt', icon: RiCalendarLine, label: t('property.sections.yearBuilt'), value: String(yearBuilt) });
    }
    if (parkingSpaces !== undefined) {
        facts.push({ key: 'parking', icon: RiCarLine, label: t('property.sections.parkingSpaces'), value: String(parkingSpaces) });
    }

    return (
        <Section title={t('property.sections.details')}>
            <View style={styles.grid}>
                {facts.map(({ key, icon: Icon, label, value }) => (
                    <View key={key} style={styles.item}>
                        <Icon width={ICON_SIZE} height={ICON_SIZE} fill={colors.COLOR_BLACK_LIGHT_3} />
                        <View style={styles.text}>
                            <BloomText variant="body-2-regular" style={styles.label}>{label}</BloomText>
                            <BloomText variant="headline-semibold" style={styles.value}>{value}</BloomText>
                        </View>
                    </View>
                ))}
            </View>
        </Section>
    );
};

const styles = StyleSheet.create({
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        rowGap: spacing.lg,
    },
    item: { width: '50%', flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
    text: { flex: 1, gap: 2 },
    label: { color: colors.COLOR_BLACK_LIGHT_3 },
    value: { color: colors.COLOR_BLACK },
});

export default PropertyDetailsCard;
