import { generateAPIUrl } from '@/utils/generateAPIUrl';
import { useChat } from '@ai-sdk/react';
import { fetch as expoFetch } from 'expo/fetch';
import { View, TextInput, ScrollView, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useOxy } from '@oxyhq/services';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';

import { useRouter } from 'expo-router';
import { PropertyCard } from '@/components/PropertyCard';
import { SindiIcon } from '@/assets/icons';
import { ThemedView } from '@/components/ThemedView';
import { ThemedText } from '@/components/ThemedText';
import { Header } from '@/components/Header';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import * as DocumentPicker from 'expo-document-picker';
import React, { useState, useEffect, useCallback } from 'react';
import { useConversationStore, type ConversationMessage, type Conversation } from '@/store/conversationStore';
import { EmptyState } from '@/components/ui/EmptyState'; // keep for IconComponent type assertion
const IconComponent = Ionicons as any;

export default function Sindi() {
  const { oxyServices, activeSessionId } = useOxy();
  const router = useRouter();
  const { t } = useTranslation();
  const [attachedFile, setAttachedFile] = React.useState<any>(null);

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

  // Always call useChat, but only enable it if authenticated
  const isAuthenticated = !!oxyServices && !!activeSessionId;
  const { messages, error, handleInputChange, input, handleSubmit, isLoading } = useChat({
    fetch: authenticatedFetch as unknown as typeof globalThis.fetch,
    api: generateAPIUrl('/api/ai/stream'),
    onError: (error: any) => console.error(error, 'ERROR'),
    enabled: isAuthenticated, // Only enable chat if authenticated
  } as any); // Cast to any to allow 'enabled' prop if not in type

  // Create new conversation
  const createNewConversation = useCallback(async () => {
    if (!isAuthenticated) return;

    try {
      const newConversation = await createConversation('New Conversation', undefined, authenticatedFetch);
      router.push(`/sindi/${newConversation.id}`);
      // Refresh conversations list
      loadConversations(authenticatedFetch);
    } catch (error) {
      console.error('Failed to create conversation:', error);
      // Fallback to client-side ID generation
      const conversationId = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      router.push(`/sindi/${conversationId}`);
    }
  }, [isAuthenticated, authenticatedFetch, router, createConversation, loadConversations]);

  // Load conversations on mount
  useEffect(() => {
    if (isAuthenticated) {
      loadConversations(authenticatedFetch);
    }
  }, [isAuthenticated, loadConversations, authenticatedFetch]);

  const handleAttachFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        setAttachedFile(result.assets[0]);
      }
    } catch (e) {
      console.error('File pick error:', e);
    }
  };

  const handleRemoveFile = () => setAttachedFile(null);

  // Wrap the original handleSubmit to include file info (for now, just log)
  const handleSubmitWithFile = () => {
    if (attachedFile) {
      console.log('Sending file:', attachedFile);
      // TODO: Integrate file upload to backend here
      setAttachedFile(null);
    }
    handleSubmit();
  };

  // Early return for unauthenticated users (after all hooks)
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

  const handleQuickAction = (prompt: string) => {
    handleInputChange({
      target: { value: prompt }
    } as any);
  };

  if (error) return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={[colors.primaryColor, colors.secondaryLight]}
        style={styles.errorContainer}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <View style={styles.errorContent}>
          <IconComponent name="alert-circle" size={48} color="white" />
          <Text style={styles.errorText}>{t('sindi.errors.connection')}</Text>
          <Text style={styles.errorSubtext}>{t('sindi.errors.connectionMessage')}</Text>
        </View>
      </LinearGradient>
    </SafeAreaView>
  );

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
          <LinearGradient
            colors={[colors.primaryColor, colors.secondaryLight]}
            style={styles.welcomeHeader}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <View style={styles.welcomeIconContainer}>
              <View style={styles.welcomeIconBackground}>
                <SindiIcon size={56} color="white" />
              </View>
              <View style={styles.welcomeIconGlow} />
            </View>
            <Text style={styles.welcomeTitle}>{t('sindi.welcome.title')}</Text>
            <Text style={styles.welcomeSubtitle}>
              {t('sindi.welcome.subtitle')}
            </Text>
            <View style={styles.welcomeFeatures}>
              <View style={styles.welcomeFeature}>
                <IconComponent name="shield-checkmark" size={16} color="rgba(255, 255, 255, 0.9)" />
                <Text style={styles.welcomeFeatureText}>Tenant Rights Expert</Text>
              </View>
              <View style={styles.welcomeFeature}>
                <IconComponent name="home" size={16} color="rgba(255, 255, 255, 0.9)" />
                <Text style={styles.welcomeFeatureText}>Housing Search</Text>
              </View>
              <View style={styles.welcomeFeature}>
                <IconComponent name="document-text" size={16} color="rgba(255, 255, 255, 0.9)" />
                <Text style={styles.welcomeFeatureText}>Legal Guidance</Text>
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
                {conversations.map((conversation) => (
                  <TouchableOpacity
                    key={conversation.id}
                    style={styles.conversationItem}
                    onPress={() => router.push(`/sindi/${conversation.id}`)}
                    activeOpacity={0.7}
                  >
                    <LinearGradient
                      colors={['#ffffff', '#f8f9fa']}
                      style={styles.conversationCard}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                    >
                      <View style={styles.conversationHeader}>
                        <View style={styles.conversationTitleContainer}>
                          <View style={styles.conversationIcon}>
                            <IconComponent name="chatbubble-ellipses" size={16} color={colors.primaryColor} />
                          </View>
                          <Text style={styles.conversationTitle} numberOfLines={1}>
                            {conversation.title}
                          </Text>
                        </View>
                        <Text style={styles.conversationDate}>
                          {new Date(conversation.updatedAt).toLocaleDateString()}
                        </Text>
                      </View>
                      <Text style={styles.conversationPreview} numberOfLines={2}>
                        {conversation.messages.length > 0
                          ? conversation.messages[conversation.messages.length - 1].content
                          : 'No messages yet'
                        }
                      </Text>
                      <View style={styles.conversationMeta}>
                        <View style={styles.conversationStats}>
                          <IconComponent name="chatbubbles" size={14} color={colors.primaryColor} />
                          <Text style={styles.conversationStatsText}>
                            {conversation.messages.length} messages
                          </Text>
                        </View>
                        <View style={styles.conversationArrow}>
                          <IconComponent name="chevron-forward" size={16} color={colors.COLOR_BLACK_LIGHT_3} />
                        </View>
                      </View>
                    </LinearGradient>
                  </TouchableOpacity>
                ))}
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
                      const newConversation = await createConversation(action.title, action.prompt, authenticatedFetch);
                      router.push(`/sindi/${newConversation.id}?message=${encodeURIComponent(action.prompt)}`);
                      // Refresh conversations list
                      loadConversations(authenticatedFetch);
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
                      const newConversation = await createConversation(example.title, example.prompt, authenticatedFetch);
                      router.push(`/sindi/${newConversation.id}?message=${encodeURIComponent(example.prompt)}`);
                      // Refresh conversations list
                      loadConversations(authenticatedFetch);
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  messagesContainer: {
    flex: 1,
    marginBottom: 120, // Account for sticky input
  },
  messagesContent: {
    paddingHorizontal: 16,
    paddingVertical: 20,
  },
  welcomeContainer: {
    paddingVertical: 20,
  },
  welcomeHeader: {
    alignItems: 'center',
    marginBottom: 30,
    padding: 32,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK,
    marginHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 6,
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
    fontSize: 28,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 12,
    fontFamily: 'Phudu',
    textAlign: 'center',
  },
  welcomeSubtitle: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.9)',
    textAlign: 'center',
    lineHeight: 24,
    paddingHorizontal: 20,
    marginBottom: 24,
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
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.8)',
    marginTop: 6,
    textAlign: 'center',
    fontWeight: '500',
  },
  quickActionsContainer: {
    marginBottom: 30,
  },
  quickActionsTitle: {
    fontSize: 22,
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
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  quickActionGradient: {
    padding: 18,
    alignItems: 'center',
    minHeight: 80,
    justifyContent: 'center',
  },
  quickActionText: {
    fontSize: 13,
    fontWeight: '600',
    color: 'white',
    marginTop: 10,
    textAlign: 'center',
    lineHeight: 18,
  },
  propertySearchContainer: {
    marginBottom: 30,
  },
  propertySearchTitle: {
    fontSize: 22,
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
    paddingHorizontal: 20,
    marginBottom: 16,
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
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  propertySearchGradient: {
    padding: 16,
    alignItems: 'center',
    minHeight: 70,
    justifyContent: 'center',
  },
  propertySearchText: {
    fontSize: 13,
    fontWeight: '600',
    color: 'white',
    marginTop: 8,
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
    padding: 20,
    borderRadius: 25,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK,
    marginHorizontal: 16,
    marginBottom: 20,
  },
  featuresTitle: {
    fontSize: 22,
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
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
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
    borderTopColor: '#e9ecef',
  },
  inputGradient: {
    margin: 16,
    marginBottom: 8,
    borderRadius: 25,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK,
  },
  inputContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  textInput: {
    flex: 1,
    fontSize: 16,
    maxHeight: 100,
    paddingVertical: 8,
    color: 'white',
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
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
    marginTop: 8,
    fontStyle: 'italic',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
    margin: 16,
    borderRadius: 25,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK,
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
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
    marginBottom: 8,
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
    borderRadius: 25,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK,
    overflow: 'hidden',
  },
  newConversationGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  newConversationIconContainer: {
    marginRight: 12,
  },
  newConversationTextContainer: {
    flex: 1,
  },
  newConversationText: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
    marginBottom: 2,
  },
  newConversationSubtext: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.8)',
    fontWeight: '400',
  },
  newConversationArrow: {
    marginLeft: 12,
  },
  conversationHistoryContainer: {
    marginBottom: 30,
  },
  conversationHistoryTitle: {
    fontSize: 22,
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
    paddingHorizontal: 16,
  },
  conversationItem: {
    marginBottom: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e9ecef',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
    overflow: 'hidden',
  },
  conversationCard: {
    padding: 16,
  },
  conversationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  conversationTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  conversationIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(76, 175, 80, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  conversationTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
    flex: 1,
  },
  conversationDate: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_3,
    fontWeight: '500',
  },
  conversationPreview: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_2,
    lineHeight: 20,
    marginBottom: 12,
  },
  conversationMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  conversationStats: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  conversationStatsText: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_3,
    marginLeft: 4,
    fontWeight: '500',
  },
  conversationArrow: {
    padding: 4,
  },
  conversationMessageCount: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
});