import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Switch, Alert, ActivityIndicator, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { SindiIcon } from '@/assets/icons';
import { colors } from '@/styles/colors';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons as IoniconsRaw } from '@expo/vector-icons';
import { useOxy } from '@oxyhq/services';
import { sindiApi } from '@/utils/api';

const Ionicons = IoniconsRaw as any;

export default function SindiSettingsScreen() {
    const router = useRouter();
    const { t } = useTranslation();
    const { oxyServices, activeSessionId } = useOxy();
    const [showTips, setShowTips] = useState(true);
    const [conversations, setConversations] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [clearing, setClearing] = useState(false);

    const fetchHistory = async () => {
        if (!oxyServices || !activeSessionId) return;
        setLoading(true);
        setError(null);
        try {
            const res = await sindiApi.getSindiChatHistory(oxyServices, activeSessionId);
            setConversations(res.conversations || []);
        } catch (err: any) {
            setError(t('sindi.settings.historyError', 'Failed to load chat history.'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchHistory();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [oxyServices, activeSessionId]);

    const handleClearHistory = () => {
        Alert.alert(
            t('sindi.settings.clearHistoryTitle', 'Clear Chat History?'),
            t('sindi.settings.clearHistoryMessage', 'This will remove all your Sindi chat history.'),
            [
                { text: t('common.cancel', 'Cancel'), style: 'cancel' },
                {
                    text: t('common.clear', 'Clear'),
                    style: 'destructive',
                    onPress: async () => {
                        if (!oxyServices || !activeSessionId) return;
                        setClearing(true);
                        try {
                            await sindiApi.clearSindiChatHistory(oxyServices, activeSessionId);
                            setConversations([]);
                            Alert.alert(t('common.success', 'Success'), t('sindi.settings.cleared', 'Chat history cleared.'));
                        } catch (err: any) {
                            Alert.alert(t('sindi.settings.historyError', 'Failed to clear chat history.'));
                        } finally {
                            setClearing(false);
                        }
                    },
                },
            ]
        );
    };

    const handleResetDefaults = () => {
        Alert.alert(
            t('sindi.settings.resetTitle', 'Reset Sindi?'),
            t('sindi.settings.resetMessage', 'This will reset all Sindi preferences to their defaults.'),
            [
                { text: t('common.cancel', 'Cancel'), style: 'cancel' },
                {
                    text: t('common.reset', 'Reset'),
                    style: 'destructive',
                    onPress: () => {
                        setShowTips(true);
                        Alert.alert(t('common.success', 'Success'), t('sindi.settings.resetDone', 'Sindi preferences reset.'));
                    },
                },
            ]
        );
    };

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backButton} accessibilityLabel="Back">
                    <Ionicons name="arrow-back" size={22} color={colors.sindiColor} />
                </TouchableOpacity>
                <SindiIcon size={32} color={colors.sindiColor} />
                <Text style={styles.headerTitle}>{t('sindi.settings.title', 'Sindi Preferences')}</Text>
            </View>
            <View style={styles.content}>
                {/* Show Tips & Hints */}
                <View style={styles.settingRow}>
                    <Text style={styles.settingLabel}>{t('sindi.settings.tips', 'Show Tips & Hints')}</Text>
                    <Switch value={showTips} onValueChange={setShowTips} thumbColor={showTips ? colors.sindiColor : '#ccc'} trackColor={{ true: '#b3d8ff', false: '#eee' }} />
                </View>
                {/* Chat Conversations Section */}
                <View style={styles.historySection}>
                    <Text style={styles.historyTitle}>{t('sindi.settings.chatHistory', 'Sindi Chat History')}</Text>
                    {loading ? (
                        <ActivityIndicator size="small" color={colors.sindiColor} />
                    ) : error ? (
                        <Text style={{ color: 'red', marginBottom: 8 }}>{error}</Text>
                    ) : conversations.length === 0 ? (
                        <Text style={{ color: '#7f8c8d' }}>{t('sindi.settings.noHistory', 'No chat history yet.')}</Text>
                    ) : (
                        <ScrollView style={{ maxHeight: 300 }}>
                            {conversations.map((conv, cidx) => (
                                <View key={conv._id || cidx} style={{ marginBottom: 18 }}>
                                    <Text style={{ fontWeight: 'bold', color: colors.sindiColor, marginBottom: 4 }}>
                                        {t('sindi.settings.conversation', 'Conversation')} #{conversations.length - cidx}
                                        {conv.startedAt ? ` • ${new Date(conv.startedAt).toLocaleString()}` : ''}
                                    </Text>
                                    {conv.messages && conv.messages.length > 0 ? (
                                        conv.messages.map((msg: any, midx: number) => (
                                            <View key={midx} style={styles.historyMsgRow}>
                                                <Text style={[styles.historyMsgRole, { color: msg.role === 'user' ? colors.sindiColor : '#2c3e50' }]}>{msg.role}</Text>
                                                <Text style={styles.historyMsgContent}>{msg.content}</Text>
                                                <Text style={styles.historyMsgTime}>{new Date(msg.timestamp).toLocaleString()}</Text>
                                            </View>
                                        ))
                                    ) : (
                                        <Text style={{ color: '#7f8c8d' }}>{t('sindi.settings.noMessages', 'No messages in this conversation.')}</Text>
                                    )}
                                    {/* Reopen button */}
                                    <TouchableOpacity
                                        style={[styles.actionButton, { marginTop: 8, alignSelf: 'flex-end' }]}
                                        onPress={() => router.push(`/sindi?conversationId=${conv._id}`)}
                                    >
                                        <Ionicons name="chatbubbles-outline" size={16} color={colors.sindiColor} style={{ marginRight: 6 }} />
                                        <Text style={styles.actionText}>{t('sindi.settings.reopen', 'Reopen')}</Text>
                                    </TouchableOpacity>
                                </View>
                            ))}
                        </ScrollView>
                    )}
                </View>
                {/* Clear Chat History */}
                <TouchableOpacity style={styles.actionButton} onPress={handleClearHistory} disabled={clearing || loading}>
                    <Ionicons name="trash-outline" size={18} color={colors.sindiColor} style={{ marginRight: 8 }} />
                    <Text style={styles.actionText}>{t('sindi.settings.clearHistory', 'Clear Sindi Chat History')}</Text>
                </TouchableOpacity>
                {/* Reset to Defaults */}
                <TouchableOpacity style={styles.actionButton} onPress={handleResetDefaults}>
                    <Ionicons name="refresh-outline" size={18} color={colors.sindiColor} style={{ marginRight: 8 }} />
                    <Text style={styles.actionText}>{t('sindi.settings.reset', 'Reset Sindi to Defaults')}</Text>
                </TouchableOpacity>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f7fbff',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 12,
        backgroundColor: 'rgba(255,255,255,0.85)',
        borderBottomWidth: 1,
        borderBottomColor: '#e3f0ff',
    },
    backButton: {
        marginRight: 8,
        padding: 4,
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: colors.sindiColor,
        marginLeft: 8,
    },
    content: {
        flex: 1,
        padding: 24,
    },
    settingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 24,
    },
    settingLabel: {
        fontSize: 16,
        color: '#2c3e50',
        flex: 1,
        marginRight: 12,
    },
    historySection: {
        marginBottom: 24,
    },
    historyTitle: {
        fontSize: 16,
        color: colors.sindiColor,
        fontWeight: 'bold',
        marginBottom: 8,
    },
    historyMsgRow: {
        marginBottom: 10,
        padding: 8,
        backgroundColor: '#fff',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#e3f0ff',
    },
    historyMsgRole: {
        fontWeight: 'bold',
        marginBottom: 2,
        textTransform: 'capitalize',
    },
    historyMsgContent: {
        fontSize: 15,
        color: '#2c3e50',
        marginBottom: 2,
    },
    historyMsgTime: {
        fontSize: 12,
        color: '#7f8c8d',
        textAlign: 'right',
    },
    actionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#fff',
        borderRadius: 10,
        paddingVertical: 10,
        paddingHorizontal: 16,
        marginTop: 8,
        marginBottom: 0,
        borderWidth: 1,
        borderColor: '#e3f0ff',
    },
    actionText: {
        color: colors.sindiColor,
        fontWeight: 'bold',
        fontSize: 15,
    },
}); 