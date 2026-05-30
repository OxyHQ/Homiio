import React from 'react';
import { StyleSheet } from 'react-native';
import { Text as BloomText } from '@oxyhq/bloom/typography';
import { Section } from '@/components/property/Section';
import { colors } from '@/styles/colors';
import { useTranslation } from 'react-i18next';
import type { Property } from '@homiio/shared-types';

// `neighborhoodDescription` is an optional API-provided field absent from the base model.
interface Props { property: (Property & { neighborhoodDescription?: string }) | null }

export const NeighborhoodInfo: React.FC<Props> = ({ property }) => {
    const { t } = useTranslation();
    const description = t('This neighborhood offers excellent connectivity with public transportation, shopping centers, and educational institutions within walking distance.') || property?.neighborhoodDescription;
    return (
        <Section title={t('Neighborhood')}>
            <BloomText style={styles.item}>{description}</BloomText>
        </Section>
    );
};

const styles = StyleSheet.create({
    item: { fontSize: 15, lineHeight: 22, color: colors.COLOR_BLACK_LIGHT_3 },
});

export default NeighborhoodInfo;
