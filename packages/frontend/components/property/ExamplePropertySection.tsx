import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { SectionCard } from '@/components/ui/SectionCard';
import { useTranslation } from 'react-i18next';

interface Props {
    property?: {
        // Add your property fields here
        someField?: string;
    } | null;
}

export const ExamplePropertySection: React.FC<Props> = ({ property }) => {
    const { t } = useTranslation();

    // Early return if no data
    if (!property?.someField) return null;

    return (
        <SectionCard
            title={t('Section Title')}
            // Optional: customize the card appearance
            padding={20}
            borderRadius={16}
            cardStyle={{ backgroundColor: '#f8f9fa' }}
        >
            <View style={styles.content}>
                <ThemedText style={styles.text}>
                    {property.someField}
                </ThemedText>
                {/* Add your section content here */}
            </View>
        </SectionCard>
    );
};

// Only include styles for your content, not container/card/title
const styles = StyleSheet.create({
    content: {
        // Your content styles here
    },
    text: {
        fontSize: 14,
        lineHeight: 20,
    },
});

export default ExamplePropertySection;
