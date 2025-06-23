import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/styles/colors';
import { Ionicons } from '@expo/vector-icons';

const IconComponent = Ionicons as any;

const LANGUAGES = [
    { code: 'en-US', label: 'English', description: 'English (United States)', flag: '🇺🇸' },
    { code: 'es-ES', label: 'Español', description: 'Español (España)', flag: '🇪🇸' },
    { code: 'ca-ES', label: 'Català', description: 'Català (Espanya)', flag: '🇪🇸' },
    { code: 'fr-FR', label: 'Français', description: 'Français (France)', flag: '🇫🇷' },
    { code: 'de-DE', label: 'Deutsch', description: 'Deutsch (Deutschland)', flag: '🇩🇪' },
    { code: 'it-IT', label: 'Italiano', description: 'Italiano (Italia)', flag: '🇮🇹' },
    { code: 'pt-PT', label: 'Português', description: 'Português (Portugal)', flag: '🇵🇹' },
    { code: 'zh-CN', label: '中文', description: 'Chinese (Simplified)', flag: '🇨🇳' },
    { code: 'ja-JP', label: '日本語', description: 'Japanese (Japan)', flag: '🇯🇵' },
    { code: 'ru-RU', label: 'Русский', description: 'Russian (Russia)', flag: '🇷🇺' },
    { code: 'ar-AR', label: 'العربية', description: 'Arabic', flag: '🇸🇦' },
    // Add more languages here as needed
];

export default function LanguageSettingsScreen() {
    const { t, i18n } = useTranslation();
    const router = useRouter();

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.headerBackButton}>
                    <IconComponent name="arrow-back" size={24} color="#333" />
                </TouchableOpacity>
                <View style={styles.headerTitleContainer}>
                    <Text style={styles.headerTitle}>{t('Language')}</Text>
                </View>
            </View>
            <ScrollView style={styles.content}>
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>{t('Language')}</Text>
                    <View style={styles.groupedList}>
                        {LANGUAGES.map((lang, idx) => {
                            let itemStyle: any = [styles.settingItem];
                            if (idx === 0 && LANGUAGES.length === 1) {
                                itemStyle.push(styles.firstSettingItem, styles.lastSettingItem);
                            } else if (idx === 0) {
                                itemStyle.push(styles.firstSettingItem);
                            } else if (idx === LANGUAGES.length - 1) {
                                itemStyle.push(styles.lastSettingItem);
                            }
                            if (i18n.language === lang.code) {
                                itemStyle.push({ backgroundColor: '#f0f8ff' });
                            }
                            return (
                                <TouchableOpacity
                                    key={lang.code}
                                    style={[...itemStyle, { flexDirection: 'row', direction: 'ltr' }]}
                                    onPress={() => {
                                        i18n.changeLanguage(lang.code);
                                        router.back();
                                    }}
                                >
                                    <View style={styles.settingInfo}>
                                        <View style={styles.flag}>
                                            <Text style={styles.flagEmoji}>{lang.flag}</Text>
                                        </View>
                                        <View style={styles.textContainer}>
                                            <Text style={[styles.settingLabel, { textAlign: 'left', direction: 'ltr' }]}>{lang.label}</Text>
                                            <Text style={[styles.settingDescription, { textAlign: 'left', direction: 'ltr' }]}>{lang.description}</Text>
                                        </View>
                                    </View>
                                    {i18n.language === lang.code ? (
                                        <IconComponent name="checkmark" size={20} color={colors.primaryColor} />
                                    ) : (
                                        <IconComponent name="chevron-forward" size={16} color="#ccc" />
                                    )}
                                </TouchableOpacity>
                            );
                        })}
                        {LANGUAGES.length === 0 && (
                            <Text style={{ textAlign: 'center', color: '#888', marginTop: 24 }}>{t('No languages found')}</Text>
                        )}
                    </View>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f2f2f2',
    },
    header: {
        paddingHorizontal: 20,
        paddingTop: 20,
        paddingBottom: 16,
        backgroundColor: '#fff',
        borderBottomWidth: 1,
        borderBottomColor: '#e0e0e0',
        flexDirection: 'row',
        alignItems: 'center',
    },
    headerBackButton: {
        position: 'absolute',
        left: 20,
        top: 20,
        zIndex: 2,
        padding: 4,
    },
    headerTitleContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#000',
    },
    content: {
        flex: 1,
        padding: 16,
    },
    section: {
        marginBottom: 24,
        paddingTop: 0,
        paddingBottom: 0,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#333',
        marginBottom: 0,
    },
    groupedList: {
        backgroundColor: '#fff',
        borderRadius: 24,
        overflow: 'hidden',
        marginTop: 0,
        marginBottom: 0,
        paddingTop: 0,
        paddingBottom: 0,
    },
    settingItem: {
        backgroundColor: '#fff',
        paddingVertical: 16,
        paddingHorizontal: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 2,
    },
    firstSettingItem: {
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        marginBottom: 2,
    },
    lastSettingItem: {
        borderBottomLeftRadius: 24,
        borderBottomRightRadius: 24,
        marginBottom: 0,
    },
    settingInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    flag: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#fff',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
        display: 'flex',
    },
    flagEmoji: {
        fontSize: 22,
        textAlign: 'center',
        lineHeight: 40,
    },
    textContainer: {
        flex: 1,
        justifyContent: 'center',
    },
    settingLabel: {
        fontSize: 16,
        fontWeight: '500',
        color: '#333',
        marginBottom: 2,
    },
    settingDescription: {
        fontSize: 14,
        color: '#666',
        marginBottom: 0,
        marginTop: -2,
    },
}); 