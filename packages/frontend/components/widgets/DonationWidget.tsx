import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BaseWidget } from './BaseWidget';
import { ThemedText } from '@/components/ThemedText';
import { ActionButton } from '@/components/ui/ActionButton';
import { colors } from '@/styles/colors';

// Type assertion for Ionicons compatibility
const IconComponent = Ionicons as any;

export function DonationWidget() {
    const { t } = useTranslation();
    const router = useRouter();

    const handleDonatePress = () => {
        router.push('/donate');
    };

    return (
        <BaseWidget
            title={t('Support Homiio')}
            icon={<IconComponent name="heart" size={20} color={colors.primaryColor} />}
        >
            <View style={styles.content}>
                <ThemedText style={styles.description}>
                    {t('Help us build the future of ethical housing. Your support makes a difference.')}
                </ThemedText>

                <View style={styles.impactSection}>
                    <View style={styles.impactItem}>
                        <IconComponent name="home" size={16} color={colors.primaryColor} />
                        <ThemedText style={styles.impactText}>
                            {t('Supporting transparent rentals')}
                        </ThemedText>
                    </View>

                    <View style={styles.impactItem}>
                        <IconComponent name="shield-checkmark" size={16} color={colors.primaryColor} />
                        <ThemedText style={styles.impactText}>
                            {t('Building trust & safety features')}
                        </ThemedText>
                    </View>

                    <View style={styles.impactItem}>
                        <IconComponent name="people" size={16} color={colors.primaryColor} />
                        <ThemedText style={styles.impactText}>
                            {t('Growing the Oxy ecosystem')}
                        </ThemedText>
                    </View>
                </View>

                <ActionButton
                    icon="heart"
                    text={t('Support Our Mission')}
                    onPress={handleDonatePress}
                    variant="primary"
                    style={styles.donateButton}
                />
            </View>
        </BaseWidget>
    );
}

const styles = StyleSheet.create({
    content: {
        gap: 16,
    },
    description: {
        fontSize: 14,
        lineHeight: 20,
        color: colors.COLOR_BLACK_LIGHT_4,
    },
    impactSection: {
        gap: 8,
    },
    impactItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    impactText: {
        fontSize: 13,
        color: colors.COLOR_BLACK_LIGHT_4,
        flex: 1,
    },
    donateButton: {
    },
});
