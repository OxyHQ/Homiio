/**
 * Horizon initiative — an editorial landing page.
 *
 * Built from Bloom: `Card` sections, `IconCircle` benefit marks, numbered
 * `Avatar` discs for the steps, initials `Avatar`s on the member stories and a
 * Bloom `Button` for the external join link.
 */
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import * as Linking from 'expo-linking';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar } from '@oxy.so/bloom/avatar';
import { Button } from '@oxy.so/bloom/button';
import { Card } from '@oxy.so/bloom/card';
import { IconCircle } from '@oxy.so/bloom/icon-circle';
import {
  RiArrowRightUpLine,
  RiEarthLine,
  RiFlightTakeoffLine,
  RiHomeHeartLine,
  RiStethoscopeLine,
  RiTeamLine,
} from '@oxy.so/bloom/icons';
import { useTheme } from '@oxy.so/bloom/theme';
import { H2, H3, Text as BloomText } from '@oxy.so/bloom/typography';
import { Header } from '@/components/Header';
import { spacing } from '@/constants/styles';

const HORIZON_URL = 'https://oxy.so/horizon';

const STORIES = [
  { initials: 'JS', name: 'Julia S.', route: 'Barcelona → Berlin', bodyKey: 'horizon.page.story1' },
  { initials: 'MR', name: 'Marco R.', route: 'Amsterdam → Stockholm', bodyKey: 'horizon.page.story2' },
] as const;

export default function HorizonPage() {
  const { t } = useTranslation();
  const theme = useTheme();
  const secondary = { color: theme.colors.textSecondary };

  const benefitItems = [
    {
      icon: RiHomeHeartLine,
      title: t('horizon.page.benefits.fairHousing.title'),
      description: t('horizon.page.benefits.fairHousing.description'),
    },
    {
      icon: RiStethoscopeLine,
      title: t('horizon.page.benefits.healthcare.title'),
      description: t('horizon.page.benefits.healthcare.description'),
    },
    {
      icon: RiFlightTakeoffLine,
      title: t('horizon.page.benefits.travel.title'),
      description: t('horizon.page.benefits.travel.description'),
    },
    {
      icon: RiTeamLine,
      title: t('horizon.page.benefits.community.title'),
      description: t('horizon.page.benefits.community.description'),
    },
  ];

  const steps = [
    {
      title: t('horizon.page.steps.apply.title'),
      description: t('horizon.page.steps.apply.description'),
    },
    {
      title: t('horizon.page.steps.verify.title'),
      description: t('horizon.page.steps.verify.description'),
    },
    {
      title: t('horizon.page.steps.access.title'),
      description: t('horizon.page.steps.access.description'),
    },
  ];

  const openHorizon = () => {
    Linking.openURL(HORIZON_URL).catch(() => undefined);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Header
        options={{
          showBackButton: true,
          title: t('horizon.title'),
        }}
      />

      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={[styles.hero, { backgroundColor: theme.colors.primary }]}>
          <RiEarthLine width={72} height={72} fill={theme.colors.primaryForeground} />
          <H2 style={[styles.heroTitle, { color: theme.colors.primaryForeground }]}>
            {t('horizon.page.heroTitle')}
          </H2>
          <BloomText style={[styles.heroSubtitle, { color: theme.colors.primaryForeground }]}>
            {t('horizon.page.heroSubtitle')}
          </BloomText>
        </View>

        <View style={styles.section}>
          <H3>{t('horizon.page.aboutTitle')}</H3>
          <BloomText style={[styles.bodyText, secondary]}>{t('horizon.page.aboutBody1')}</BloomText>
          <BloomText style={[styles.bodyText, secondary]}>{t('horizon.page.aboutBody2')}</BloomText>
        </View>

        <View style={styles.section}>
          <H3>{t('horizon.page.benefitsTitle')}</H3>
          <View style={styles.benefitGrid}>
            {benefitItems.map((item) => (
              <Card
                key={item.title}
                variant="outlined"
                radius="radius-16"
                style={styles.benefitCard}
              >
                <IconCircle icon={item.icon} />
                <BloomText style={styles.itemTitle}>{item.title}</BloomText>
                <BloomText style={[styles.itemDescription, secondary]}>
                  {item.description}
                </BloomText>
              </Card>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <H3>{t('horizon.page.howItWorksTitle')}</H3>
          {steps.map((step, index) => (
            <View key={step.title} style={styles.step}>
              <Avatar initials={String(index + 1)} color="blue" size={36} />
              <View style={styles.stepContent}>
                <BloomText style={styles.itemTitle}>{step.title}</BloomText>
                <BloomText style={[styles.itemDescription, secondary]}>
                  {step.description}
                </BloomText>
              </View>
            </View>
          ))}
        </View>

        <Card variant="filled" radius="radius-24" style={styles.joinCard}>
          <H3 style={styles.centerText}>{t('horizon.page.joinTitle')}</H3>
          <BloomText style={[styles.bodyText, styles.centerText, secondary]}>
            {t('horizon.page.joinSubtitle')}
          </BloomText>
          <Button
            variant="primary"
            size="large"
            trailingIcon={RiArrowRightUpLine}
            onPress={openHorizon}
          >
            {t('horizon.page.steps.apply.title')}
          </Button>
        </Card>

        <View style={styles.section}>
          <H3>{t('horizon.page.storiesTitle')}</H3>
          {STORIES.map((story) => (
            <Card key={story.name} variant="outlined" radius="radius-16" style={styles.storyCard}>
              <View style={styles.storyHeader}>
                <Avatar name={story.name} initials={story.initials} size={40} />
                <View>
                  <BloomText style={styles.itemTitle}>{story.name}</BloomText>
                  <BloomText style={[styles.itemDescription, secondary]}>{story.route}</BloomText>
                </View>
              </View>
              <BloomText style={[styles.storyText, secondary]}>{t(story.bodyKey)}</BloomText>
            </Card>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  content: {
    gap: spacing.xl,
    paddingBottom: spacing['4xl'],
  },
  hero: {
    minHeight: 250,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
  },
  heroTitle: {
    textAlign: 'center',
  },
  heroSubtitle: {
    fontSize: 16,
    textAlign: 'center',
    opacity: 0.9,
  },
  section: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  bodyText: {
    fontSize: 16,
    lineHeight: 24,
  },
  benefitGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  benefitCard: {
    flexGrow: 1,
    flexBasis: 260,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  itemTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  itemDescription: {
    fontSize: 14,
    lineHeight: 20,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  stepContent: {
    flex: 1,
    gap: 2,
  },
  joinCard: {
    marginHorizontal: spacing.lg,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
  },
  centerText: {
    textAlign: 'center',
  },
  storyCard: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  storyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  storyText: {
    fontSize: 14,
    lineHeight: 22,
    fontStyle: 'italic',
  },
});
