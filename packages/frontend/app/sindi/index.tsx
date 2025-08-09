import { fetch as expoFetch } from 'expo/fetch';
import { View, ScrollView, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useOxy } from '@oxyhq/services';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';

import { useRouter } from 'expo-router';
// Landing screen does not render PropertyCard directly
import { SindiIcon } from '@/assets/icons';
import { ThemedView } from '@/components/ThemedView';
import { Header } from '@/components/Header';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
// Removed file attachment functionality for minimal hero page
import React, { useEffect, useCallback } from 'react';
import { useConversationStore } from '@/store/conversationStore';
import { EmptyState } from '@/components/ui/EmptyState'; // keep for IconComponent type assertion
const IconComponent = Ionicons as any;

export default function Sindi() {
  const { oxyServices, activeSessionId } = useOxy();
  const router = useRouter();
  const { t } = useTranslation();
  // No local file state needed on landing hero

  // Zustand store
  const {
    conversations,
    loading,
    loadConversations,
    createConversation,
  } = useConversationStore();

  // Create a custom fetch function that includes authentication
  const authenticatedFetch = useCallback(async (url: string, options: RequestInit = {}) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {}),
    };

    // Add authentication token if available
    if (oxyServices && activeSessionId) {
      try {
        const tokenData = await oxyServices.getTokenBySession(activeSessionId);
        if (tokenData) {
          headers['Authorization'] = `Bearer ${tokenData.accessToken}`;
        }
      } catch (error) {
        console.error('Failed to get authentication token:', error);
      }
    }

    // Create fetch options without null body
    const { body, ...otherOptions } = options;
    const fetchOptions = {
      ...otherOptions,
      headers,
      ...(body !== null && { body }),
    };

    return expoFetch(url, fetchOptions as any);
  }, [oxyServices, activeSessionId]);

  // Alias with Response-compatible typing to satisfy functions expecting the standard fetch signature
  const conversationFetch = authenticatedFetch as unknown as (url: string, options?: RequestInit) => Promise<Response>;

  // Auth status
  const isAuthenticated = !!oxyServices && !!activeSessionId;

  // Create new conversation
  const createNewConversation = useCallback(async () => {
    if (!isAuthenticated) return;

    try {
      const newConversation = await createConversation('New Conversation', undefined, conversationFetch);
      router.push(`/sindi/${newConversation.id}`);
      // Refresh conversations list
      loadConversations(conversationFetch);
    } catch (error) {
      console.error('Failed to create conversation:', error);
      // Fallback to client-side ID generation
      const conversationId = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      router.push(`/sindi/${conversationId}`);
    }
  }, [isAuthenticated, conversationFetch, router, createConversation, loadConversations]);

  // Load conversations on mount
  useEffect(() => {
    if (isAuthenticated) {
      loadConversations(conversationFetch);
    }
  }, [isAuthenticated, loadConversations, conversationFetch]);

  // Early return for unauthenticated users (after hooks)
  if (!isAuthenticated) {
    return (
      <ThemedView style={styles.container} lightColor="transparent" darkColor="transparent">
        <Header options={{ title: t('sindi.title'), showBackButton: true }} />
        <EmptyState
          icon="lock-closed"
          title={t('sindi.auth.required')}
          description={t('sindi.auth.message')}
          actionText="Sign In"
          actionIcon="log-in"
          onAction={() => router.push('/profile')}
          iconColor={colors.primaryColor}
        />
      </ThemedView>
    );
  }

  // Quick actions & examples (original arrays restored)
  const quickActions = [
    { title: t('sindi.actions.rentGouging.title'), icon: 'trending-up', prompt: t('sindi.actions.rentGouging.prompt') },
    { title: t('sindi.actions.evictionDefense.title'), icon: 'warning', prompt: t('sindi.actions.evictionDefense.prompt') },
    { title: t('sindi.actions.securityDeposit.title'), icon: 'card', prompt: t('sindi.actions.securityDeposit.prompt') },
    { title: t('sindi.actions.unsafeLiving.title'), icon: 'construct', prompt: t('sindi.actions.unsafeLiving.prompt') },
    { title: t('sindi.actions.discrimination.title'), icon: 'shield-checkmark', prompt: t('sindi.actions.discrimination.prompt') },
    { title: t('sindi.actions.retaliation.title'), icon: 'alert-circle', prompt: t('sindi.actions.retaliation.prompt') },
    { title: t('sindi.actions.leaseReview.title'), icon: 'document-text', prompt: t('sindi.actions.leaseReview.prompt') },
    { title: t('sindi.actions.tenantOrganizing.title'), icon: 'people', prompt: t('sindi.actions.tenantOrganizing.prompt') },
    { title: t('sindi.actions.currentLaws.title'), icon: 'globe', prompt: t('sindi.actions.currentLaws.prompt') },
    { title: t('sindi.actions.catalunya.title'), icon: 'location', prompt: t('sindi.actions.catalunya.prompt') },
  ];

  const propertySearchExamples = [
    { title: t('sindi.housing.examples.cheap.title'), icon: 'cash', prompt: t('sindi.housing.examples.cheap.prompt') },
    { title: t('sindi.housing.examples.petFriendly.title'), icon: 'paw', prompt: t('sindi.housing.examples.petFriendly.prompt') },
    { title: t('sindi.housing.examples.furnished.title'), icon: 'bed', prompt: t('sindi.housing.examples.furnished.prompt') },
    { title: t('sindi.housing.examples.family.title'), icon: 'home', prompt: t('sindi.housing.examples.family.prompt') },
    { title: t('sindi.housing.examples.luxury.title'), icon: 'diamond', prompt: t('sindi.housing.examples.luxury.prompt') },
    { title: t('sindi.housing.examples.shared.title'), icon: 'people', prompt: t('sindi.housing.examples.shared.prompt') },
  ];

  // Web-specific styles for sticky positioning
  const webStyles = Platform.OS === 'web' ? {
    container: { height: '100vh', display: 'flex', flexDirection: 'column' } as any,
    stickyHeader: { position: 'sticky', top: 0 } as any,
    messagesContainer: { marginTop: 0, marginBottom: 0, flex: 1, overflow: 'auto' } as any,
    stickyInput: { position: 'sticky', bottom: 0 } as any,
    messagesContent: { paddingBottom: 100 }
  } : {};

  return (
    <SafeAreaView style={[styles.container, webStyles.container]}>
      {/* Header */}
      <Header
        options={{
          title: t('sindi.title'),
          subtitle: t('sindi.subtitle'),
          showBackButton: true
        }}
      />

      {/* Messages */}
      <ScrollView
        style={[styles.messagesContainer, webStyles.messagesContainer]}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.messagesContent, webStyles.messagesContent]}
      >
        <View style={styles.welcomeContainer}>
          {/* Hero styled like main screen */}
          <LinearGradient
            colors={[colors.primaryColor, colors.secondaryLight, colors.primaryLight]}
            locations={[0, 0.85, 1]}
            style={styles.heroSection}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <View style={styles.heroContent}>
              <View style={styles.heroIconCircle}>
                <SindiIcon size={52} color={colors.secondaryColor} />
              </View>
              <Text style={styles.heroTitle}>{t('sindi.welcome.title')}</Text>
              <Text style={styles.heroSubtitle}>{t('sindi.welcome.subtitle')}</Text>
              <View style={styles.heroBadgesRow}>
                <View style={styles.heroBadge}><IconComponent name="shield-checkmark" size={14} color={colors.primaryColor} /><Text style={styles.heroBadgeText}>Rights</Text></View>
                <View style={styles.heroBadge}><IconComponent name="home" size={14} color={colors.primaryColor} /><Text style={styles.heroBadgeText}>Housing</Text></View>
                <View style={styles.heroBadge}><IconComponent name="document-text" size={14} color={colors.primaryColor} /><Text style={styles.heroBadgeText}>Legal</Text></View>
              </View>
            </View>
          </LinearGradient>

          {/* New Conversation Button */}
          <TouchableOpacity
            style={styles.newConversationButton}
            onPress={createNewConversation}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={[colors.primaryColor, colors.secondaryLight]}
              style={styles.newConversationGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <View style={styles.newConversationIconContainer}>
                <IconComponent name="add-circle" size={28} color="white" />
              </View>
              <View style={styles.newConversationTextContainer}>
                <Text style={styles.newConversationText}>Start New Conversation</Text>
                <Text style={styles.newConversationSubtext}>Get instant help with housing questions</Text>
              </View>
              <View style={styles.newConversationArrow}>
                <IconComponent name="arrow-forward" size={20} color="rgba(255, 255, 255, 0.8)" />
              </View>
            </LinearGradient>
          </TouchableOpacity>

          {/* Conversation History */}
          <View style={styles.conversationHistoryContainer}>
            <Text style={styles.conversationHistoryTitle}>Recent Conversations</Text>
            {loading ? (
              <View style={styles.loadingContainer}>
                <Text style={styles.loadingText}>Loading conversations...</Text>
              </View>
            ) : conversations.length === 0 ? (
              <EmptyState
                icon="chatbubbles-outline"
                title="No conversations yet"
                description="Start a new conversation to get help with your tenant rights questions"
                actionText="Start First Chat"
                actionIcon="add-circle"
                onAction={createNewConversation}
              />
            ) : (
              <View style={styles.conversationsList}>
                {conversations.map((conversation) => {
                  const last = conversation.messages[conversation.messages.length - 1];
                  return (
                    <TouchableOpacity
                      key={conversation.id}
                      style={styles.conversationItem}
                      onPress={() => router.push(`/sindi/${conversation.id}`)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.conversationCard}>
                        <View style={styles.conversationIcon}>
                          <IconComponent name="chatbubble-ellipses" size={20} color={'white'} />
                        </View>
                        <View style={{ flex: 1, position: 'relative', paddingRight: 4 }}>
                          <Text style={styles.conversationTitle} numberOfLines={1}>{conversation.title}</Text>
                          <Text style={styles.conversationPreview} numberOfLines={1}>
                            {last ? last.content : 'No messages yet'}
                          </Text>
                          <Text style={styles.conversationDate}>{new Date(conversation.updatedAt).toLocaleDateString()}</Text>
                          <View style={styles.conversationMeta}>
                            <View style={styles.conversationStats}>
                              <IconComponent name="chatbubbles" size={12} color={colors.primaryColor} />
                              <Text style={styles.conversationStatsText}>{conversation.messages.length}</Text>
                            </View>
                          </View>
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>

          <View style={styles.quickActionsContainer}>
            <Text style={styles.quickActionsTitle}>{t('sindi.actions.title')}</Text>
            <View style={styles.quickActionsGrid}>
              {quickActions.map((action, index) => (
                <TouchableOpacity
                  key={index}
                  style={styles.quickActionButton}
                  onPress={async () => {
                    if (!isAuthenticated) return;

                    try {
                      const newConversation = await createConversation(action.title, action.prompt, conversationFetch);
                      router.push(`/sindi/${newConversation.id}?message=${encodeURIComponent(action.prompt)}`);
                      // Refresh conversations list
                      loadConversations(conversationFetch);
                    } catch (error) {
                      console.error('Failed to create conversation:', error);
                      // Fallback
                      const conversationId = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                      router.push(`/sindi/${conversationId}?message=${encodeURIComponent(action.prompt)}`);
                    }
                  }}
                >
                  <LinearGradient
                    colors={[colors.primaryColor, colors.secondaryLight]}
                    style={styles.quickActionGradient}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                  >
                    <IconComponent name={action.icon as any} size={20} color="white" />
                    <Text style={styles.quickActionText}>{action.title}</Text>
                  </LinearGradient>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.propertySearchContainer}>
            <Text style={styles.propertySearchTitle}>{t('sindi.housing.title')}</Text>
            <Text style={styles.propertySearchSubtitle}>
              {t('sindi.housing.subtitle')}
            </Text>
            <View style={styles.propertySearchGrid}>
              {propertySearchExamples.map((example, index) => (
                <TouchableOpacity
                  key={index}
                  style={styles.propertySearchButton}
                  onPress={async () => {
                    if (!isAuthenticated) return;

                    try {
                      const newConversation = await createConversation(example.title, example.prompt, conversationFetch);
                      router.push(`/sindi/${newConversation.id}?message=${encodeURIComponent(example.prompt)}`);
                      // Refresh conversations list
                      loadConversations(conversationFetch);
                    } catch (error) {
                      console.error('Failed to create conversation:', error);
                      // Fallback
                      const conversationId = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                      router.push(`/sindi/${conversationId}?message=${encodeURIComponent(example.prompt)}`);
                    }
                  }}
                >
                  <LinearGradient
                    colors={[colors.primaryColor, colors.secondaryLight]}
                    style={styles.propertySearchGradient}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                  >
                    <IconComponent name={example.icon as any} size={18} color="white" />
                    <Text style={styles.propertySearchText}>{example.title}</Text>
                  </LinearGradient>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.propertySearchNote}>
              {t('sindi.housing.naturalLanguage')}
            </Text>
          </View>

          <LinearGradient
            colors={[colors.primaryColor, colors.secondaryLight]}
            style={styles.featuresContainer}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <Text style={styles.featuresTitle}>{t('sindi.features.title')}</Text>
            <View style={styles.featureList}>
              <Text style={styles.featureItem}>{t('sindi.features.rentIncreases')}</Text>
              <Text style={styles.featureItem}>{t('sindi.features.evictions')}</Text>
              <Text style={styles.featureItem}>{t('sindi.features.deposits')}</Text>
              <Text style={styles.featureItem}>{t('sindi.features.conditions')}</Text>
              <Text style={styles.featureItem}>{t('sindi.features.discrimination')}</Text>
              <Text style={styles.featureItem}>{t('sindi.features.retaliation')}</Text>
              <Text style={styles.featureItem}>{t('sindi.features.leases')}</Text>
              <Text style={styles.featureItem}>{t('sindi.features.organizing')}</Text>
              <Text style={styles.featureItem}>{t('sindi.features.updates')}</Text>
              <Text style={styles.featureItem}>{t('sindi.features.organizations')}</Text>
            </View>
          </LinearGradient>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// Minimal UI tuning constants
const MINIMAL_BORDER = '#d0d5dd';

const styles = StyleSheet.create({
  // New hero styles aligned with main screen
  heroSection: {
    backgroundColor: colors.primaryColor,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 40,
    marginBottom: 16,
    // Make full-bleed inside a padded ScrollView by offsetting horizontal padding
    marginHorizontal: -12,
    alignSelf: 'stretch',
    borderRadius: 0,
    overflow: 'hidden',
  },
  heroContent: {
    width: '100%',
    alignItems: 'center',
    maxWidth: 720,
  },
  heroIconCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(255,255,255,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 18,
  },
  heroTitle: {
    fontSize: 30,
    fontWeight: 'bold',
    fontFamily: 'Phudu',
    color: 'white',
    textAlign: 'center',
    marginBottom: 10,
  },
  heroSubtitle: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.92)',
    textAlign: 'center',
    maxWidth: 520,
    lineHeight: 22,
    marginBottom: 18,
  },
  heroBadgesRow: {
    flexDirection: 'row',
    gap: 8,
  },
  heroBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.85)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 18,
  },
  heroBadgeText: {
    marginLeft: 4,
    fontSize: 12,
    fontWeight: '600',
    color: colors.primaryColor,
  },
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  messagesContainer: {
    flex: 1,
    marginBottom: 120, // Account for sticky input
  },
  messagesContent: {
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  welcomeContainer: {
    paddingVertical: 16,
  },
  welcomeHeader: {
    alignItems: 'center',
    marginBottom: 24,
    padding: 20,
    borderRadius: 36,
    borderWidth: 1,
    borderColor: MINIMAL_BORDER,
    marginHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  welcomeIconContainer: {
    position: 'relative',
    marginBottom: 20,
  },
  welcomeIconBackground: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  welcomeIconGlow: {
    position: 'absolute',
    top: -8,
    left: -8,
    right: -8,
    bottom: -8,
    borderRadius: 52,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    zIndex: -1,
  },
  welcomeTitle: {
    fontSize: 26,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 10,
    fontFamily: 'Phudu',
    textAlign: 'center',
  },
  welcomeSubtitle: {
    fontSize: 15,
    color: 'rgba(255, 255, 255, 0.9)',
    textAlign: 'center',
    lineHeight: 24,
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  welcomeFeatures: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    paddingHorizontal: 20,
  },
  welcomeFeature: {
    alignItems: 'center',
    flex: 1,
  },
  welcomeFeatureText: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.8)',
    marginTop: 6,
    textAlign: 'center',
    fontWeight: '500',
  },
  quickActionsContainer: {
    marginBottom: 24,
  },
  quickActionsTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.COLOR_BLACK,
    marginBottom: 16,
    fontFamily: 'Phudu',
    paddingHorizontal: 16,
  },
  quickActionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
  },
  quickActionButton: {
    flex: 1,
    minWidth: '45%',
    borderRadius: 28,
    borderWidth: 1,
    borderColor: MINIMAL_BORDER,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  quickActionGradient: {
    padding: 14,
    alignItems: 'center',
    minHeight: 70,
    justifyContent: 'center',
  },
  quickActionText: {
    fontSize: 12,
    fontWeight: '600',
    color: 'white',
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 18,
  },
  propertySearchContainer: {
    marginBottom: 24,
  },
  propertySearchTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.COLOR_BLACK,
    marginBottom: 16,
    fontFamily: 'Phudu',
    paddingHorizontal: 16,
  },
  propertySearchSubtitle: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
    textAlign: 'center',
    lineHeight: 24,
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  propertySearchGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
  },
  propertySearchButton: {
    flex: 1,
    minWidth: '45%',
    borderRadius: 26,
    borderWidth: 1,
    borderColor: MINIMAL_BORDER,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  propertySearchGradient: {
    padding: 14,
    alignItems: 'center',
    minHeight: 64,
    justifyContent: 'center',
  },
  propertySearchText: {
    fontSize: 12,
    fontWeight: '600',
    color: 'white',
    marginTop: 6,
    textAlign: 'center',
    lineHeight: 16,
  },
  propertySearchNote: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_4,
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 16,
  },
  featuresContainer: {
    padding: 16,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: MINIMAL_BORDER,
    marginHorizontal: 16,
    marginBottom: 20,
  },
  featuresTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 16,
    fontFamily: 'Phudu',
  },
  featureList: {
    gap: 8,
  },
  featureItem: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.9)',
    lineHeight: 20,
  },
  messageContainer: {
    marginVertical: 8,
  },
  userMessage: {
    alignItems: 'flex-end',
  },
  assistantMessage: {
    alignItems: 'flex-start',
  },
  messageBubble: {
    maxWidth: '80%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 26,
    overflow: 'hidden',
  },
  userBubble: {
    backgroundColor: colors.primaryColor,
  },
  assistantBubble: {
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  messageText: {
    fontSize: 16,
    lineHeight: 22,
  },
  userText: {
    color: 'white',
  },
  assistantText: {
    color: '#2c3e50',
  },
  messageTime: {
    fontSize: 12,
    color: '#95a5a6',
    marginTop: 4,
    marginHorizontal: 8,
  },
  stickyInput: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    backgroundColor: 'white',
    borderTopWidth: 1,
    borderTopColor: MINIMAL_BORDER,
  },
  inputGradient: {
    margin: 12,
    marginBottom: 4,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: MINIMAL_BORDER,
  },
  inputContainer: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 28,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  textInput: {
    flex: 1,
    fontSize: 16,
    maxHeight: 100,
    paddingVertical: 6,
    color: 'white',
  },
  sendButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  sendButtonDisabled: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  disclaimer: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
    marginTop: 6,
    fontStyle: 'italic',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
    margin: 16,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: MINIMAL_BORDER,
  },
  errorContent: {
    alignItems: 'center',
  },
  errorText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'white',
    marginTop: 16,
    marginBottom: 8,
    fontFamily: 'Phudu',
  },
  errorSubtext: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
    textAlign: 'center',
  },
  markdownH3: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  markdownH2: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  markdownH1: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  markdownParagraph: {
    fontSize: 16,
    lineHeight: 22,
    marginBottom: 4,
  },
  markdownBold: {
    fontWeight: 'bold',
  },
  markdownItalic: {
    fontStyle: 'italic',
  },
  markdownListItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 4,
    flexWrap: 'wrap',
    flex: 1,
  },
  markdownBullet: {
    fontSize: 16,
    marginRight: 8,
    marginTop: 2,
  },
  markdownNumber: {
    fontSize: 16,
    marginRight: 8,
    marginTop: 2,
  },
  markdownCodeBlock: {
    backgroundColor: 'rgba(0,0,0,0.1)',
    padding: 8,
    borderRadius: 4,
    marginVertical: 4,
  },
  markdownCode: {
    fontSize: 14,
    fontFamily: Platform.OS === 'web' ? 'monospace' : 'monospace',
  },
  markdownInlineCode: {
    fontSize: 14,
    fontFamily: Platform.OS === 'web' ? 'monospace' : 'monospace',
    backgroundColor: 'rgba(0,0,0,0.1)',
    paddingHorizontal: 4,
    borderRadius: 2,
  },
  propertyCardsContainer: {
    marginVertical: 12,
    gap: 12,
  },
  propertyCardChat: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
    marginBottom: 6,
  },
  propertyCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  propertyCardTitle: {
    fontWeight: 'bold',
    fontSize: 16,
    color: '#2c3e50',
  },
  propertyCardType: {
    fontSize: 12,
    color: '#7f8c8d',
    marginLeft: 8,
  },
  propertyCardRent: {
    fontSize: 14,
    color: '#4CAF50',
    marginBottom: 2,
  },
  propertyCardCity: {
    fontSize: 13,
    color: '#7f8c8d',
    marginBottom: 8,
  },
  propertyCardButton: {
    backgroundColor: colors.primaryColor,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignSelf: 'flex-start',
  },
  propertyCardButtonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 14,
  },

  filePreviewContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 8,
    padding: 6,
    marginBottom: 6,
  },
  filePreviewText: {
    color: 'white',
    fontSize: 13,
    marginRight: 8,
  },
  removeFileButton: {
    padding: 2,
  },
  attachButton: {
    marginRight: 8,
    padding: 4,
  },
  newConversationButton: {
    marginHorizontal: 16,
    marginBottom: 20,
    borderRadius: 34,
    borderWidth: 1,
    borderColor: MINIMAL_BORDER,
    overflow: 'hidden',
  },
  newConversationGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
  },
  newConversationIconContainer: {
    marginRight: 12,
  },
  newConversationTextContainer: {
    flex: 1,
  },
  newConversationText: {
    fontSize: 15,
    fontWeight: '600',
    color: 'white',
    marginBottom: 2,
  },
  newConversationSubtext: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.8)',
    fontWeight: '400',
  },
  newConversationArrow: {
    marginLeft: 12,
  },
  conversationHistoryContainer: {
    marginBottom: 24,
  },
  conversationHistoryTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.COLOR_BLACK,
    marginBottom: 16,
    fontFamily: 'Phudu',
    paddingHorizontal: 16,
  },
  loadingContainer: {
    padding: 20,
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 16,
    color: colors.COLOR_BLACK_LIGHT_3,
  },

  conversationsList: {
    paddingHorizontal: 8,
  },
  conversationItem: {
    marginBottom: 4,
    borderRadius: 18,
    backgroundColor: 'white',
    overflow: 'hidden',
  },
  conversationCard: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  conversationHeader: {},
  conversationTitleContainer: { flex: 1 },
  conversationIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primaryColor,
    justifyContent: 'center',
    alignItems: 'center',
  },
  conversationTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
    marginBottom: 2,
  },
  conversationDate: {
    position: 'absolute',
    top: 0,
    right: 0,
    fontSize: 10,
    color: colors.COLOR_BLACK_LIGHT_4,
    fontWeight: '500',
  },
  conversationPreview: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_4,
    lineHeight: 16,
    paddingRight: 50,
  },
  conversationMeta: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  conversationStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  conversationStatsText: {
    fontSize: 10,
    color: colors.COLOR_BLACK_LIGHT_5,
    fontWeight: '500',
  },
  conversationArrow: {
    display: 'none',
  },
  conversationMessageCount: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
});