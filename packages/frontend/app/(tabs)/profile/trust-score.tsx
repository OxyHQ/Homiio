/**
 * Profile → Trust score detail screen.
 *
 * Stream P polish: shared Header, Bloom Button for the edit CTA, Bloom
 * typography end-to-end, and CardSurface for the explanatory banner.
 * The inline TrustScoreManager remains the source of truth for the
 * factor breakdown.
 */
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Button } from '@oxyhq/bloom/button';
import { H1, Text as BloomText } from '@oxyhq/bloom/typography';

import { Header } from '@/components/Header';
import { CardSurface } from '@/components/ui/CardSurface';
import { TrustScoreManager } from '@/components/TrustScoreManager';
import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';

export default function TrustScorePage() {
  const { t } = useTranslation();
  const router = useRouter();

  return (
    <View style={styles.root}>
      <Header
        options={{
          showBackButton: true,
          title: t('profile.trustScorePage.title'),
          titlePosition: 'center',
        }}
      />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.heroWrap}>
          <CardSurface padding={spacing['2xl']}>
            <View style={styles.heroHeader}>
              <H1 style={styles.heroTitle}>{t('profile.trustScorePage.title')}</H1>
              <Button
                variant="secondary"
                size="medium"
                onPress={() => router.push('/profile/edit')}
                icon={
                  <Ionicons
                    name="create-outline"
                    size={16}
                    color={colors.primaryColor}
                  />
                }
              >
                {t('profile.actions.editProfile')}
              </Button>
            </View>

            <BloomText style={styles.subtitle}>
              {t('profile.trustScoreSubtitle')}
            </BloomText>

            <View style={styles.hint}>
              <Ionicons
                name="information-circle-outline"
                size={16}
                color={colors.primaryColor}
              />
              <BloomText style={styles.hintText}>
                {t('profile.trustScoreHint')}
              </BloomText>
            </View>
          </CardSurface>
        </View>

        <View style={styles.managerWrap}>
          <TrustScoreManager />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    paddingTop: spacing.lg,
    paddingBottom: spacing['4xl'],
  },
  heroWrap: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
  },
  heroHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.md,
    flexWrap: 'wrap',
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 14,
    color: colors.muted,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 12,
    backgroundColor: colors.primaryLight_2,
  },
  hintText: {
    fontSize: 13,
    color: colors.primaryColor,
    lineHeight: 18,
    flex: 1,
  },
  managerWrap: {
    paddingHorizontal: spacing.lg,
  },
});
