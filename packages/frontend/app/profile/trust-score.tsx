import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { colors } from '@/styles/colors';
import { Ionicons } from '@expo/vector-icons';
import { TrustScoreManager } from '@/components/TrustScoreManager';
import { useRouter } from 'expo-router';

export default function TrustScorePage() {
    const { t } = useTranslation();
    const router = useRouter();

    const handleEditProfile = () => {
        router.push('/profile/edit');
    };

    return (
        <SafeAreaView style={{ flex: 1 }} edges={['top']}>
            <View style={styles.header}>
                <View style={styles.titleContainer}>
                    <Text style={styles.title}>{t('Trust Score')}</Text>
                    <TouchableOpacity 
                        style={styles.editButton}
                        onPress={handleEditProfile}
                    >
                        <Ionicons name="create-outline" size={20} color={colors.primaryLight} />
                        <Text style={styles.editButtonText}>Edit Profile</Text>
                    </TouchableOpacity>
                </View>
                <Text style={styles.subtitle}>
                    Build trust with landlords and roommates through verification and positive interactions
                </Text>
                <View style={styles.improvementHint}>
                    <Ionicons name="information-circle-outline" size={16} color={colors.primaryColor} />
                    <Text style={styles.improvementHintText}>
                        Complete your profile information to improve your trust score
                    </Text>
                </View>
            </View>

            <TrustScoreManager />
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    header: {
        padding: 20,
        backgroundColor: colors.primaryLight,
        borderBottomWidth: 1,
        borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
    },
    titleContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    title: {
        fontSize: 28,
        fontWeight: 'bold',
        color: colors.primaryDark,
        flex: 1,
    },
    editButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.primaryColor,
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
        gap: 6,
    },
    editButtonText: {
        color: colors.primaryLight,
        fontSize: 14,
        fontWeight: '600',
        fontFamily: 'Phudu',
    },
    subtitle: {
        fontSize: 16,
        color: colors.COLOR_BLACK_LIGHT_4,
        lineHeight: 22,
        marginBottom: 12,
    },
    improvementHint: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.primaryLight_1,
        padding: 12,
        borderRadius: 8,
        borderLeftWidth: 4,
        borderLeftColor: colors.primaryColor,
        gap: 8,
    },
    improvementHintText: {
        fontSize: 14,
        color: colors.primaryColor,
        flex: 1,
        lineHeight: 18,
    },
}); 