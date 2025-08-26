import React from 'react';
import { StyleSheet } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { SectionCard } from '@/components/ui/SectionCard';
import { useTranslation } from 'react-i18next';

interface Props { property: any }

export const NeighborhoodInfo: React.FC<Props> = ({ property }) => {
    const { t } = useTranslation();
    const description = t('This neighborhood offers excellent connectivity with public transportation, shopping centers, and educational institutions within walking distance.') || property?.neighborhoodDescription;
    return (
        <SectionCard title={t('Neighborhood')}>
            <ThemedText style={styles.item}>{description}</ThemedText>
        </SectionCard>
    );
};

const styles = StyleSheet.create({
    item: { fontSize: 14 },
});

export default NeighborhoodInfo;
