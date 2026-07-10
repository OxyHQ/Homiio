import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import * as Linking from 'expo-linking';
import { colors } from '@/styles/colors';
import { shadowToken } from '@/styles/shadows';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Header } from '@/components/Header';

export default function HorizonPage() {
  const { t } = useTranslation();

  const benefitItems: {
    icon: 'home-outline' | 'medkit-outline' | 'airplane-outline' | 'people-outline';
    title: string;
    description: string;
  }[] = [
    {
      icon: 'home-outline',
      title: t('horizon.page.benefits.fairHousing.title'),
      description: t('horizon.page.benefits.fairHousing.description'),
    },
    {
      icon: 'medkit-outline',
      title: t('horizon.page.benefits.healthcare.title'),
      description: t('horizon.page.benefits.healthcare.description'),
    },
    {
      icon: 'airplane-outline',
      title: t('horizon.page.benefits.travel.title'),
      description: t('horizon.page.benefits.travel.description'),
    },
    {
      icon: 'people-outline',
      title: t('horizon.page.benefits.community.title'),
      description: t('horizon.page.benefits.community.description'),
    },
  ];

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Header
        options={{
          showBackButton: true,
          title: t('horizon.title'),
          titlePosition: 'center',
        }}
      />

      <ScrollView style={styles.container}>
        {/* Hero Section */}
        <View style={styles.heroSection}>
          <View style={styles.heroOverlay}>
            <Ionicons name="globe-outline" size={80} color={colors.ratingStar} style={styles.heroIcon} />
            <Text style={styles.heroTitle}>{t('horizon.page.heroTitle')}</Text>
            <Text style={styles.heroSubtitle}>
              {t('horizon.page.heroSubtitle')}
            </Text>
          </View>
        </View>

        {/* About Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('horizon.page.aboutTitle')}</Text>
          <Text style={styles.sectionText}>
            {t('horizon.page.aboutBody1')}
          </Text>
          <Text style={styles.sectionText}>
            {t('horizon.page.aboutBody2')}
          </Text>
        </View>

        {/* Benefits Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('horizon.page.benefitsTitle')}</Text>

          {benefitItems.map((item, index) => (
            <View key={index} style={styles.benefitItem}>
              <View style={styles.benefitIcon}>
                <Ionicons name={item.icon} size={28} color={colors.ratingStar} />
              </View>
              <View style={styles.benefitContent}>
                <Text style={styles.benefitTitle}>{item.title}</Text>
                <Text style={styles.benefitDescription}>{item.description}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* How It Works */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('horizon.page.howItWorksTitle')}</Text>

          <View style={styles.stepContainer}>
            <View style={styles.stepCircle}>
              <Text style={styles.stepNumber}>1</Text>
            </View>
            <View style={styles.stepContent}>
              <Text style={styles.stepTitle}>{t('horizon.page.steps.apply.title')}</Text>
              <Text style={styles.stepDescription}>
                {t('horizon.page.steps.apply.description')}
              </Text>
            </View>
          </View>

          <View style={styles.stepContainer}>
            <View style={styles.stepCircle}>
              <Text style={styles.stepNumber}>2</Text>
            </View>
            <View style={styles.stepContent}>
              <Text style={styles.stepTitle}>{t('horizon.page.steps.verify.title')}</Text>
              <Text style={styles.stepDescription}>
                {t('horizon.page.steps.verify.description')}
              </Text>
            </View>
          </View>

          <View style={styles.stepContainer}>
            <View style={styles.stepCircle}>
              <Text style={styles.stepNumber}>3</Text>
            </View>
            <View style={styles.stepContent}>
              <Text style={styles.stepTitle}>{t('horizon.page.steps.access.title')}</Text>
              <Text style={styles.stepDescription}>
                {t('horizon.page.steps.access.description')}
              </Text>
            </View>
          </View>
        </View>

        {/* Join Now */}
        <View style={styles.joinSection}>
          <Text style={styles.joinTitle}>{t('horizon.page.joinTitle')}</Text>
          <Text style={styles.joinDescription}>
            {t('horizon.page.joinSubtitle')}
          </Text>
          <TouchableOpacity
            style={styles.joinButton}
            onPress={() => {
              Linking.openURL('https://oxy.so/horizon').catch(() => undefined);
            }}
          >
            <Text style={styles.joinButtonText}>{t('horizon.page.steps.apply.title')}</Text>
          </TouchableOpacity>
        </View>

        {/* Testimonials */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('horizon.page.storiesTitle')}</Text>

          <View style={styles.testimonialCard}>
            <View style={styles.testimonialHeader}>
              <View style={styles.testimonialAvatar}>
                <Text style={styles.testimonialAvatarText}>JS</Text>
              </View>
              <View>
                <Text style={styles.testimonialName}>Julia S.</Text>
                <Text style={styles.testimonialLocation}>Barcelona → Berlin</Text>
              </View>
            </View>
            <Text style={styles.testimonialText}>
              {t('horizon.page.story1')}
            </Text>
          </View>

          <View style={styles.testimonialCard}>
            <View style={styles.testimonialHeader}>
              <View style={styles.testimonialAvatar}>
                <Text style={styles.testimonialAvatarText}>MR</Text>
              </View>
              <View>
                <Text style={styles.testimonialName}>Marco R.</Text>
                <Text style={styles.testimonialLocation}>Amsterdam → Stockholm</Text>
              </View>
            </View>
            <Text style={styles.testimonialText}>
              {t('horizon.page.story2')}
            </Text>
          </View>
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
  heroSection: {
    height: 250,
    backgroundColor: colors.primaryColor,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  heroOverlay: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.2)',
    padding: 20,
  },
  heroIcon: {
    marginBottom: 15,
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: colors.white,
    textAlign: 'center',
    marginBottom: 10,
  },
  heroSubtitle: {
    fontSize: 16,
    color: colors.white,
    textAlign: 'center',
    opacity: 0.9,
  },
  section: {
    padding: 20,
    borderBottomWidth: 8,
    borderBottomColor: colors.surface,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 15,
    color: colors.COLOR_BLACK,
  },
  sectionText: {
    fontSize: 16,
    lineHeight: 24,
    color: colors.COLOR_BLACK_LIGHT_3,
    marginBottom: 15,
  },
  benefitItem: {
    flexDirection: 'row',
    marginBottom: 20,
    alignItems: 'flex-start',
  },
  benefitIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
  },
  benefitContent: {
    flex: 1,
  },
  benefitTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 5,
    color: colors.COLOR_BLACK,
  },
  benefitDescription: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
    lineHeight: 20,
  },
  stepContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 25,
  },
  stepCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.ratingStar,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
  },
  stepNumber: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.COLOR_BLACK,
  },
  stepContent: {
    flex: 1,
  },
  stepTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 5,
    color: colors.COLOR_BLACK,
  },
  stepDescription: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
    lineHeight: 20,
  },
  joinSection: {
    backgroundColor: colors.primaryLight,
    padding: 30,
    borderRadius: 20,
    margin: 20,
    alignItems: 'center',
  },
  joinTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: colors.COLOR_BLACK,
    marginBottom: 10,
    textAlign: 'center',
  },
  joinDescription: {
    fontSize: 16,
    color: colors.COLOR_BLACK_LIGHT_3,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 22,
  },
  joinButton: {
    backgroundColor: colors.ratingStar,
    paddingVertical: 15,
    paddingHorizontal: 30,
    borderRadius: 30,
    alignItems: 'center',
  },
  joinButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.COLOR_BLACK,
  },
  testimonialCard: {
    backgroundColor: colors.white,
    borderRadius: 15,
    padding: 20,
    marginBottom: 15,
    ...shadowToken({ y: 2, blur: 4, color: colors.shadow, opacity: 0.1, elevation: 3 }),
  },
  testimonialHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
  },
  testimonialAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  testimonialAvatarText: {
    fontWeight: 'bold',
    color: colors.primaryColor,
  },
  testimonialName: {
    fontWeight: 'bold',
    fontSize: 16,
    color: colors.COLOR_BLACK,
  },
  testimonialLocation: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  testimonialText: {
    fontSize: 14,
    lineHeight: 22,
    color: colors.COLOR_BLACK_LIGHT_3,
    fontStyle: 'italic',
  },
});
