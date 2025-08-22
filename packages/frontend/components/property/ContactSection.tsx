import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { colors } from '@/styles/colors';
import { useTranslation } from 'react-i18next';

interface Props { property: any; onMessage?: () => void; onCall?: () => void; onViewing?: () => void; canMessage?: boolean; phone?: string; }

export const ContactSection: React.FC<Props> = ({ property: _property, onMessage, onCall, onViewing, canMessage, phone }) => {
    const { t } = useTranslation();
    if (!onMessage && !onCall && !onViewing) return null;
    return (
        <View style={styles.container}>
            <ThemedText style={styles.sectionTitle}>{t('Contact')}</ThemedText>
            <View style={styles.card}>
                {canMessage && onMessage && (
                    <TouchableOpacity style={styles.button} onPress={onMessage}><ThemedText style={styles.buttonText}>{t('Message')}</ThemedText></TouchableOpacity>
                )}
                {onCall && phone && (
                    <TouchableOpacity style={styles.button} onPress={onCall}><ThemedText style={styles.buttonText}>{t('Call')}</ThemedText></TouchableOpacity>
                )}
                {onViewing && (
                    <TouchableOpacity style={styles.button} onPress={onViewing}><ThemedText style={styles.buttonText}>{t('Schedule Viewing')}</ThemedText></TouchableOpacity>
                )}
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: { marginBottom: 20 },
    sectionTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 15 },
    card: { padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#e9ecef' },
    button: { backgroundColor: colors.primaryColor, paddingVertical: 10, borderRadius: 8, marginBottom: 10, alignItems: 'center' },
    buttonText: { color: '#fff', fontWeight: '600' },
});

export default ContactSection;
