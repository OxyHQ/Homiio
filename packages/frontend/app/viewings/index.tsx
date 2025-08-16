import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Header } from '@/components/Header';
import { ThemedText } from '@/components/ThemedText';
import { colors } from '@/styles/colors';
import { useOxy } from '@oxyhq/services';
import viewingService, { ViewingRequest } from '@/services/viewingService';
import { useQuery } from '@tanstack/react-query';

export default function ViewingsPage() {
  const { t } = useTranslation();
  const { oxyServices, activeSessionId } = useOxy();

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

  return (
    <View style={{ flex: 1 }}>
      <Header
        options={{
          showBackButton: true,
          title: t('Viewings') || 'Viewings',
          titlePosition: 'center',
        }}
      />
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
          {isLoading ? (
            <ThemedText style={styles.muted}>{t('state.loading') || 'Loading...'}</ThemedText>
          ) : isError ? (
            <ThemedText style={styles.muted}>{t('viewings.error.generic')}</ThemedText>
          ) : !data || data.length === 0 ? (
            <ThemedText style={styles.muted}>{t('No viewings yet') || 'No viewings yet'}</ThemedText>
          ) : (
            data.map((v) => (
              <View key={v._id} style={styles.card}>
                <ThemedText style={styles.title}>{new Date(v.scheduledAt).toLocaleString()}</ThemedText>
                <ThemedText style={styles.subtitle}>{t('Status')}: {v.status}</ThemedText>
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
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#eee',
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
});


