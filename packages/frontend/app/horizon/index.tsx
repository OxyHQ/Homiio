import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { colors } from '@/styles/colors';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Header } from '@/components/Header';

export default function HorizonPage() {
  const { t } = useTranslation();
  const router = useRouter();

  const benefitItems: {
    icon: "home-outline" | "medkit-outline" | "airplane-outline" | "people-outline";
    title: string;
    description: string;
  }[] = [
      {
        icon: 'home-outline',
        title: t('Fair Housing'),
        description: t('Access to affordable housing in 120+ cities worldwide with standardized ethical rental agreements')
      },
      {
        icon: 'medkit-outline',
        title: t('Healthcare Access'),
        description: t('Universal healthcare coverage with partner clinics and telehealth services in every Horizon city')
      },
      {
        icon: 'airplane-outline',
        title: t('Travel Network'),
        description: t('Discounted transportation and accommodation when traveling between Horizon locations')
      },
      {
        icon: 'people-outline',
        title: t('Community Support'),
        description: t('Connect with local members for cultural integration, language exchange, and social activities')
      }
    ];

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <Header
        options={{
          showBackButton: true,
          title: t("Horizon Initiative"),
          titlePosition: 'center',
        }}
      />

      <ScrollView style={styles.container}>
        {/* Hero Section */}
        <View style={styles.heroSection}>
          <View style={styles.heroOverlay}>
            <Ionicons name="globe-outline" size={80} color="#FFD700" style={styles.heroIcon} />
            <Text style={styles.heroTitle}>{t("Global Housing Initiative")}</Text>
            <Text style={styles.heroSubtitle}>
              {t("Creating a world of ethical housing, healthcare, and mobility")}
            </Text>
          </View>
        </View>

        {/* About Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("About Horizon")}</Text>
          <Text style={styles.sectionText}>
            {t("Horizon is a global initiative designed to make housing more accessible, affordable, and ethical for everyone. By joining a network of properties across 120+ cities worldwide, members gain access to fair housing, healthcare benefits, and travel support.")}
          </Text>
          <Text style={styles.sectionText}>
            {t("Our mission is to create sustainable living environments that foster community and wellbeing while reducing the environmental impact of housing.")}
          </Text>
        </View>

        {/* Benefits Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("Member Benefits")}</Text>

          {benefitItems.map((item, index) => (
            <View key={index} style={styles.benefitItem}>
              <View style={styles.benefitIcon}>
                <Ionicons name={item.icon} size={28} color="#FFD700" />
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
          <Text style={styles.sectionTitle}>{t("How It Works")}</Text>

          <View style={styles.stepContainer}>
            <View style={styles.stepCircle}>
              <Text style={styles.stepNumber}>1</Text>
            </View>
            <View style={styles.stepContent}>
              <Text style={styles.stepTitle}>{t("Apply for Membership")}</Text>
              <Text style={styles.stepDescription}>
                {t("Complete your profile and submit a membership application with your housing needs and preferences.")}
              </Text>
            </View>
          </View>

          <View style={styles.stepContainer}>
            <View style={styles.stepCircle}>
              <Text style={styles.stepNumber}>2</Text>
            </View>
            <View style={styles.stepContent}>
              <Text style={styles.stepTitle}>{t("Get Verified")}</Text>
              <Text style={styles.stepDescription}>
                {t("Our team reviews your application and verifies your identity and background information.")}
              </Text>
            </View>
          </View>

          <View style={styles.stepContainer}>
            <View style={styles.stepCircle}>
              <Text style={styles.stepNumber}>3</Text>
            </View>
            <View style={styles.stepContent}>
              <Text style={styles.stepTitle}>{t("Access the Network")}</Text>
              <Text style={styles.stepDescription}>
                {t("Once approved, browse and book properties across our global network with priority access.")}
              </Text>
            </View>
          </View>
        </View>

        {/* Join Now */}
        <View style={styles.joinSection}>
          <Text style={styles.joinTitle}>{t("Ready to join Horizon?")}</Text>
          <Text style={styles.joinDescription}>
            {t("Apply today and take the first step toward ethical, accessible housing worldwide.")}
          </Text>
          <TouchableOpacity
            style={styles.joinButton}
            onPress={() => router.push('/horizon/apply')}
          >
            <Text style={styles.joinButtonText}>{t("Apply for Membership")}</Text>
          </TouchableOpacity>
        </View>

        {/* Testimonials */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("Member Stories")}</Text>

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
              {t("Horizon made my relocation so much easier. I found an ethical apartment in Berlin within a week and the healthcare coverage saved me when I needed emergency care.")}
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
              {t("As a digital nomad, having access to quality housing in multiple cities has been life-changing. The community aspect is what makes Horizon truly special.")}
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
    color: 'white',
    textAlign: 'center',
    marginBottom: 10,
  },
  heroSubtitle: {
    fontSize: 16,
    color: 'white',
    textAlign: 'center',
    opacity: 0.9,
  },
  section: {
    padding: 20,
    borderBottomWidth: 8,
    borderBottomColor: '#f5f5f5',
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
    backgroundColor: '#FFD700',
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
    backgroundColor: '#FFD700',
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
    backgroundColor: 'white',
    borderRadius: 15,
    padding: 20,
    marginBottom: 15,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
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