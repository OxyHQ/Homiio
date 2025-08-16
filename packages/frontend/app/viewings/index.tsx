import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Header } from '@/components/Header';
import { ThemedText } from '@/components/ThemedText';
import { colors } from '@/styles/colors';
import { useOxy } from '@oxyhq/services';
import { viewingService, ViewingRequest } from '@/services/viewingService';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner-native';
import { ApiError } from '@/utils/api';
import { router } from 'expo-router';

export default function ViewingsPage() {
    const { t } = useTranslation();
    const { oxyServices, activeSessionId } = useOxy();
    const queryClient = useQueryClient();

    const { data, isLoading, isError, refetch } = useQuery({
        queryKey: ['viewings', 'me'],
        queryFn: async () => {
            const res = await viewingService.listMyViewingRequests(
                { page: 1, limit: 50 },
                oxyServices!,
                activeSessionId!,
            );
            return Array.isArray(res?.data) ? (res.data as ViewingRequest[]) : [];
        },
        enabled: Boolean(oxyServices && activeSessionId),
    });

    const cancelMutation = useMutation({
        mutationFn: async (viewingId: string) => {
            return await viewingService.cancel(viewingId, oxyServices!, activeSessionId!);
        },
        onSuccess: () => {
            toast.success(t('viewings.success.cancelled'));
            queryClient.invalidateQueries({ queryKey: ['viewings', 'me'] });
        },
        onError: (error: any) => {
            const errorMessage = extractErrorMessage(error);
            toast.error(errorMessage);
        },
    });

    const extractErrorMessage = (error: any): string => {
        if (error instanceof ApiError) {
            // Check for specific error codes
            const errorCode = error.response?.error?.code || error.response?.code;
            switch (errorCode) {
                case 'VIEWING_NOT_FOUND':
                    return t('viewings.error.notFound');
                case 'CANNOT_CANCEL':
                    return t('viewings.error.cannotCancel');
                case 'AUTHENTICATION_REQUIRED':
                    return t('viewings.error.authRequired');
                default:
                    return t('viewings.error.generic');
            }
        }
        return t('viewings.error.generic');
    };

    const handleCancel = (viewing: ViewingRequest) => {
        Alert.alert(
            t('viewings.actions.cancel'),
            t('viewings.cancel.confirmMessage'),
            [
                {
                    text: t('common.cancel'),
                    style: 'cancel',
                },
                {
                    text: t('viewings.actions.cancel'),
                    style: 'destructive',
                    onPress: () => cancelMutation.mutate(viewing._id),
                },
            ]
        );
    };

    const handleModify = (viewing: ViewingRequest) => {
        // Navigate to book-viewing screen with the property ID and indication that this is a modification
        router.push({
            pathname: `/properties/${viewing.propertyId}/book-viewing`,
            params: { modifyViewingId: viewing._id }
        });
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'pending':
                return colors.COLOR_WARNING || '#f59e0b';
            case 'approved':
                return colors.COLOR_SUCCESS || '#10b981';
            case 'declined':
                return colors.COLOR_ERROR || '#ef4444';
            case 'cancelled':
                return colors.COLOR_BLACK_LIGHT_3 || '#6b7280';
            default:
                return colors.COLOR_BLACK_LIGHT_3 || '#6b7280';
        }
    };

    const formatDateTime = (scheduledAt: string) => {
        try {
            const date = new Date(scheduledAt);
            const dateFormatted = date.toLocaleDateString();
            const timeFormatted = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
            return `${dateFormatted} at ${timeFormatted}`;
        } catch {
            return scheduledAt;
        }
    };

    return (
        <View style={{ flex: 1 }}>
            <Header
                options={{
                    showBackButton: true,
                    title: t('viewings.title') || 'Viewings',
                    titlePosition: 'center',
                }}
            />
            <SafeAreaView style={styles.container} edges={['top']}>
                <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
                    {isLoading ? (
                        <ThemedText style={styles.muted}>{t('state.loading')}</ThemedText>
                    ) : isError ? (
                        <ThemedText style={styles.muted}>{t('viewings.error.generic')}</ThemedText>
                    ) : !data || data.length === 0 ? (
                        <View style={styles.emptyState}>
                            <ThemedText style={styles.emptyTitle}>{t('viewings.empty.title')}</ThemedText>
                            <ThemedText style={styles.emptyDescription}>{t('viewings.empty.description')}</ThemedText>
                        </View>
                    ) : (
                        data.map((viewing) => (
                            <View key={viewing._id} style={styles.card}>
                                <View style={styles.cardHeader}>
                                    <View style={styles.cardTitleRow}>
                                        <ThemedText style={styles.cardTitle}>
                                            {formatDateTime(viewing.scheduledAt)}
                                        </ThemedText>
                                        <View style={[styles.statusBadge, { backgroundColor: getStatusColor(viewing.status) }]}>
                                            <ThemedText style={styles.statusText}>
                                                {t(`viewings.status.${viewing.status}`) || viewing.status}
                                            </ThemedText>
                                        </View>
                                    </View>
                                    {viewing.propertyTitle && (
                                        <ThemedText style={styles.propertyTitle}>{viewing.propertyTitle}</ThemedText>
                                    )}
                                    {viewing.message && (
                                        <ThemedText style={styles.message}>{viewing.message}</ThemedText>
                                    )}
                                </View>

                                {(viewing.status === 'pending' || viewing.status === 'approved') && (
                                    <View style={styles.cardActions}>
                                        {viewing.status === 'pending' && (
                                            <TouchableOpacity
                                                style={[styles.actionButton, styles.modifyButton]}
                                                onPress={() => handleModify(viewing)}
                                            >
                                                <ThemedText style={styles.modifyButtonText}>{t('viewings.actions.modify')}</ThemedText>
                                            </TouchableOpacity>
                                        )}
                                        <TouchableOpacity
                                            style={[styles.actionButton, styles.cancelButton]}
                                            onPress={() => handleCancel(viewing)}
                                            disabled={cancelMutation.isPending}
                                        >
                                            <ThemedText style={styles.cancelButtonText}>
                                                {cancelMutation.isPending ? t('state.loading') : t('viewings.actions.cancel')}
                                            </ThemedText>
                                        </TouchableOpacity>
                                    </View>
                                )}
                            </View>
                        ))
                    )}
                </ScrollView>
            </SafeAreaView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.COLOR_BACKGROUND,
    },
    muted: {
        color: colors.COLOR_BLACK_LIGHT_3,
    },
    emptyState: {
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 50,
        paddingHorizontal: 20,
    },
    emptyTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.COLOR_BLACK,
        marginBottom: 8,
        textAlign: 'center',
    },
    emptyDescription: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_3,
        textAlign: 'center',
        lineHeight: 20,
    },
    card: {
        backgroundColor: '#fff',
        borderRadius: 12,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#eee',
        overflow: 'hidden',
    },
    cardHeader: {
        padding: 16,
    },
    cardTitleRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 8,
    },
    cardTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.COLOR_BLACK,
        flex: 1,
        marginRight: 12,
    },
    statusBadge: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
    },
    statusText: {
        fontSize: 12,
        fontWeight: '500',
        color: '#fff',
        textTransform: 'capitalize',
    },
    propertyTitle: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_2,
        marginBottom: 4,
    },
    message: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_3,
        fontStyle: 'italic',
    },
    cardActions: {
        flexDirection: 'row',
        borderTopWidth: 1,
        borderTopColor: '#f1f1f1',
        paddingHorizontal: 16,
        paddingVertical: 12,
        gap: 8,
    },
    actionButton: {
        flex: 1,
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderRadius: 8,
        alignItems: 'center',
    },
    modifyButton: {
        backgroundColor: colors.primaryColor || '#2563eb',
    },
    modifyButtonText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '500',
    },
    cancelButton: {
        backgroundColor: '#f3f4f6',
        borderWidth: 1,
        borderColor: '#d1d5db',
    },
    cancelButtonText: {
        color: '#374151',
        fontSize: 14,
        fontWeight: '500',
    },
});


