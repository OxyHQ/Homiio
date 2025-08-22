import { fetch as expoFetch } from 'expo/fetch';
import {
  View,
  ScrollView,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useOxy } from '@oxyhq/services';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import { useRouter } from 'expo-router';
import { ThemedView } from '@/components/ThemedView';
import { Header } from '@/components/Header';
import { useTranslation } from 'react-i18next';
import React, { useEffect, useCallback, useState, useMemo, memo, useContext } from 'react';
import { useConversationStore } from '@/store/conversationStore';
import { EmptyState } from '@/components/ui/EmptyState';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/utils/api';
import { BottomSheetContext } from '@/context/BottomSheetContext';
import { SindiExplanationBottomSheet } from '@/components/SindiExplanationBottomSheet';

const IconComponent = Ionicons as any;

interface Entitlements {
  plusActive: boolean;
  plusSince?: string;
  plusStripeSubscriptionId?: string;
  fileCredits: number;
  lastPaymentAt?: string;
}

// Memoized components for better performance

const ConversationItem = memo(({
  conversation,
  isLast,
  onPress
}: {
  conversation: any;
  isLast: boolean;
  onPress: () => void;
}) => {
  const last = conversation.messages[conversation.messages.length - 1];
  const formatTimestamp = useCallback((d: Date) => {
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }, []);

  return (
    <TouchableOpacity
      style={[styles.conversationItem, isLast && styles.conversationItemLast]}
      onPress={onPress}
      activeOpacity={0.6}
    >
      <View style={styles.conversationCard}>
        <View style={styles.conversationIcon}>
          <IconComponent name="chatbubble-ellipses" size={18} color={'white'} />
        </View>
        <View style={{ flex: 1, position: 'relative', paddingRight: 4 }}>
          <Text style={styles.conversationTitle} numberOfLines={1}>
            {conversation.title}
          </Text>
          <Text style={styles.conversationPreview} numberOfLines={1}>
            {last ? last.content : 'No messages yet'}
          </Text>
          <Text style={styles.conversationDate}>
            {formatTimestamp(new Date(conversation.updatedAt))}
          </Text>
          <View style={styles.conversationMeta}>
            <View style={styles.conversationStats}>
              <IconComponent name="chatbubbles" size={11} color={colors.primaryColor} />
              <Text style={styles.conversationStatsText}>
                {conversation.messages.length}
              </Text>
            </View>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
});
ConversationItem.displayName = 'ConversationItem';

const SubscriptionCard = memo(({
  entitlements,
  entitlementsLoading,
  onUpgrade
}: {
  entitlements: Entitlements | null;
  entitlementsLoading: boolean;
  onUpgrade: () => void;
}) => {
  if (entitlementsLoading) return null;

  const plusActive = entitlements?.plusActive || false;

  return (
    <View style={styles.subscriptionStatusContainer}>
      <View style={[styles.subscriptionCard, plusActive && styles.subscriptionCardActive]}>
        <View style={styles.subscriptionHeader}>
          <IconComponent
            name={plusActive ? "star" : "information-circle"}
            size={20}
            color={plusActive ? colors.primaryColor : '#6b7280'}
          />
          <Text style={styles.subscriptionTitle}>
            {plusActive ? 'Homiio+ Active' : 'Free Plan'}
          </Text>
        </View>
        <Text style={styles.subscriptionDescription}>
          {plusActive
            ? 'Unlimited file uploads and priority support included'
            : 'Upgrade to Homiio+ for unlimited file uploads and priority support'
          }
        </Text>
        {!plusActive && (
          <TouchableOpacity style={styles.upgradeButton} onPress={onUpgrade} activeOpacity={0.8}>
            <Text style={styles.upgradeButtonText}>Upgrade to Homiio+</Text>
          </TouchableOpacity>
        )}
        {plusActive && (
          <View style={styles.subscriptionBadge}>
            <IconComponent name="checkmark-circle" size={14} color={colors.primaryColor} />
            <Text style={styles.subscriptionBadgeText}>Active</Text>
          </View>
        )}
      </View>
    </View>
  );
});
SubscriptionCard.displayName = 'SubscriptionCard';

const SearchBar = memo(({
  searchQuery,
  onSearchChange,
  onClear
}: {
  searchQuery: string;
  onSearchChange: (text: string) => void;
  onClear: () => void;
}) => (
  <View style={styles.searchBarWrapper}>
    <Ionicons name="search" size={16} color={colors.COLOR_BLACK_LIGHT_5} />
    <TextInput
      style={styles.searchInputChats}
      placeholder="Search conversations"
      placeholderTextColor={colors.COLOR_BLACK_LIGHT_5}
      value={searchQuery}
      onChangeText={onSearchChange}
    />
    {searchQuery.length > 0 && (
      <TouchableOpacity onPress={onClear} style={styles.clearSearchBtn}>
        <Ionicons name="close" size={14} color={colors.COLOR_BLACK_LIGHT_5} />
      </TouchableOpacity>
    )}
  </View>
));
SearchBar.displayName = 'SearchBar';

const NewConversationButton = memo(({ onPress }: { onPress: () => void }) => (
  <TouchableOpacity style={styles.newConversationButton} onPress={onPress} activeOpacity={0.8}>
    <View style={styles.newConversationContent}>
      <View style={styles.newConversationIconContainer}>
        <IconComponent name="add-circle" size={24} color={colors.primaryColor} />
      </View>
      <View style={styles.newConversationTextContainer}>
        <Text style={styles.newConversationText}>Start New Conversation</Text>
        <Text style={styles.newConversationSubtext}>
          Get instant help with housing questions
        </Text>
      </View>
      <View style={styles.newConversationArrow}>
        <IconComponent name="chevron-forward" size={16} color={APPLE_TEXT_TERTIARY} />
      </View>
    </View>
  </TouchableOpacity>
));
NewConversationButton.displayName = 'NewConversationButton';

export default function Sindi() {
  const { oxyServices, activeSessionId } = useOxy();
  const router = useRouter();
  const { t } = useTranslation();
  const { conversations, loading, loadConversations, createConversation } = useConversationStore();
  const [searchQuery, setSearchQuery] = useState('');
  const bottomSheetContext = useContext(BottomSheetContext);

  // Memoized authentication status
  const isAuthenticated = useMemo(() => !!oxyServices && !!activeSessionId, [oxyServices, activeSessionId]);

  // Memoized authenticated fetch function
  const authenticatedFetch = useCallback(
    async (url: string, options: RequestInit = {}) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...((options.headers as Record<string, string>) || {}),
      };

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

      const { body, ...otherOptions } = options;
      const fetchOptions = {
        ...otherOptions,
        headers,
        ...(body !== null && { body }),
      };

      return expoFetch(url, fetchOptions as any);
    },
    [oxyServices, activeSessionId],
  );

  const conversationFetch = authenticatedFetch as unknown as (
    url: string,
    options?: RequestInit,
  ) => Promise<Response>;

  // Entitlements query
  const {
    data: entitlements,
    isLoading: entitlementsLoading,
  } = useQuery({
    queryKey: ['entitlements'],
    queryFn: async () => {
      const { data } = await api.get<{ success: boolean; entitlements: Entitlements }>(
        '/api/profiles/me/entitlements',
        { oxyServices, activeSessionId: activeSessionId || undefined }
      );
      if (!data?.success) {
        throw new Error('Failed to load entitlements');
      }
      return data.entitlements || null;
    },
    enabled: isAuthenticated,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
  });

  // Memoized conversation creation handler
  const createNewConversation = useCallback(async () => {
    if (!isAuthenticated) return;

    try {
      const newConversation = await createConversation(
        'New Conversation',
        undefined,
        conversationFetch,
      );
      router.push(`/sindi/${newConversation.id}`);
      loadConversations(conversationFetch);
    } catch (error) {
      console.error('Failed to create conversation:', error);
      const conversationId = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      router.push(`/sindi/${conversationId}`);
    }
  }, [isAuthenticated, conversationFetch, router, createConversation, loadConversations]);

  // Memoized conversation action handler
  const handleConversationAction = useCallback(async (title: string, prompt: string) => {
    if (!isAuthenticated) return;

    try {
      const newConversation = await createConversation(title, prompt, conversationFetch);
      router.push(`/sindi/${newConversation.id}?message=${encodeURIComponent(prompt)}`);
      loadConversations(conversationFetch);
    } catch (error) {
      console.error('Failed to create conversation:', error);
      const conversationId = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      router.push(`/sindi/${conversationId}?message=${encodeURIComponent(prompt)}`);
    }
  }, [isAuthenticated, conversationFetch, router, createConversation, loadConversations]);



  // Memoized filtered conversations
  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const q = searchQuery.toLowerCase();
    return conversations.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        (c.messages[c.messages.length - 1]?.content || '').toLowerCase().includes(q),
    );
  }, [conversations, searchQuery]);

  // Memoized grouped conversations
  const groupedConversations = useMemo(() => {
    const groups: Record<string, typeof filteredConversations> = {};
    const today = new Date();
    const isSameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    filteredConversations.forEach((conv) => {
      const d = new Date(conv.updatedAt);
      let label: string;
      if (isSameDay(d, today)) label = 'Today';
      else if (isSameDay(d, yesterday)) label = 'Yesterday';
      else label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      (groups[label] = groups[label] || []).push(conv);
    });

    const orderedLabels = Object.keys(groups).sort((a, b) => {
      const special = (l: string) => (l === 'Today' ? 2 : l === 'Yesterday' ? 1 : 0);
      const sa = special(a), sb = special(b);
      if (sa !== sb) return sb - sa;
      if (sa === 0 && sb === 0) {
        const da = new Date(a + ' ' + new Date().getFullYear());
        const db = new Date(b + ' ' + new Date().getFullYear());
        return db.getTime() - da.getTime();
      }
      return 0;
    });

    return orderedLabels.map((label) => ({ label, items: groups[label] }));
  }, [filteredConversations]);

  // Load conversations on mount
  useEffect(() => {
    if (isAuthenticated) {
      loadConversations(conversationFetch);
    }
  }, [isAuthenticated, loadConversations, conversationFetch]);

  // Web-specific styles
  const webStyles = useMemo(() =>
    Platform.OS === 'web'
      ? {
        container: { height: '100vh', display: 'flex', flexDirection: 'column' } as any,
        stickyHeader: { position: 'sticky', top: 0 } as any,
        messagesContainer: { marginTop: 0, marginBottom: 0, flex: 1, overflow: 'auto' } as any,
        stickyInput: { position: 'sticky', bottom: 0 } as any,
        messagesContent: { paddingBottom: 100 },
      }
      : {}, []
  );

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

  return (
    <SafeAreaView style={[styles.container, webStyles.container]}>
      <Header
        options={{
          title: t('sindi.title'),
          subtitle: t('sindi.subtitle'),
          showBackButton: true,
        }}
      />

      <ScrollView
        style={[styles.messagesContainer, webStyles.messagesContainer]}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.messagesContent, webStyles.messagesContent]}
      >
        <View style={styles.welcomeContainer}>
          {/* What is Sindi Section */}
          <View style={styles.sindiExplanationContainer}>
            <View style={styles.sindiIconContainer}>
              <IconComponent name="chatbubble-ellipses" size={32} color={colors.primaryColor} />
            </View>
            <Text style={styles.sindiTitle}>Meet Sindi</Text>
            <Text style={styles.sindiDescription}>
              Your AI-powered housing rights assistant. Get instant help with tenant issues, understand your rights, and navigate housing challenges with confidence.
            </Text>
            <View style={styles.sindiFeatures}>
              <View style={styles.sindiFeature}>
                <IconComponent name="shield-checkmark" size={16} color={colors.primaryColor} />
                <Text style={styles.sindiFeatureText}>Know your rights</Text>
              </View>
              <View style={styles.sindiFeature}>
                <IconComponent name="document-text" size={16} color={colors.primaryColor} />
                <Text style={styles.sindiFeatureText}>Legal guidance</Text>
              </View>
              <View style={styles.sindiFeature}>
                <IconComponent name="people" size={16} color={colors.primaryColor} />
                <Text style={styles.sindiFeatureText}>Community support</Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.learnMoreButton}
              onPress={() => {
                if (bottomSheetContext) {
                  bottomSheetContext.openBottomSheet(
                    <SindiExplanationBottomSheet onClose={() => bottomSheetContext.closeBottomSheet()} />,
                    { hideHandle: true }
                  );
                }
              }}
              activeOpacity={0.7}
            >
              <Text style={styles.learnMoreButtonText}>Learn How It Works</Text>
              <IconComponent name="chevron-forward" size={16} color={colors.primaryColor} />
            </TouchableOpacity>
          </View>

          <NewConversationButton onPress={createNewConversation} />

          <SubscriptionCard
            entitlements={entitlements || null}
            entitlementsLoading={entitlementsLoading}
            onUpgrade={() => router.push('/profile/subscriptions')}
          />

          <View style={styles.conversationHistoryContainer}>
            <Text style={styles.conversationHistoryTitle}>Chats</Text>
            <SearchBar
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onClear={() => setSearchQuery('')}
            />

            {loading ? (
              <View style={{ paddingHorizontal: 16 }}>
                {[...Array(4)].map((_, i) => (
                  <View key={i} style={styles.skeletonRow} />
                ))}
              </View>
            ) : filteredConversations.length === 0 ? (
              <EmptyState
                icon="chatbubbles-outline"
                title={searchQuery ? 'No matches' : 'No conversations yet'}
                description={
                  searchQuery ? 'Try another search term' : 'Start a new conversation to get help'
                }
                actionText={searchQuery ? undefined : 'Start First Chat'}
                actionIcon={searchQuery ? undefined : 'add-circle'}
                onAction={searchQuery ? undefined : createNewConversation}
              />
            ) : (
              <View style={styles.conversationsList}>
                {groupedConversations.map((group) => (
                  <View key={group.label}>
                    <Text style={styles.groupHeader}>{group.label}</Text>
                    {group.items.map((conversation, idx) => (
                      <ConversationItem
                        key={conversation.id}
                        conversation={conversation}
                        isLast={idx === group.items.length - 1}
                        onPress={() => router.push(`/sindi/${conversation.id}`)}
                      />
                    ))}
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* Common Questions */}
          <View style={styles.commonQuestionsContainer}>
            <Text style={styles.commonQuestionsTitle}>Common Questions</Text>
            <Text style={styles.commonQuestionsSubtitle}>
              Tap any question to start a conversation with Sindi
            </Text>
            <View style={styles.questionsList}>
              <TouchableOpacity
                style={styles.questionItem}
                onPress={() => handleConversationAction('Rent Increase Help', 'My landlord is raising my rent. What are my rights?')}
                activeOpacity={0.7}
              >
                <Text style={styles.questionText}>My landlord is raising my rent. What are my rights?</Text>
                <IconComponent name="chevron-forward" size={16} color={APPLE_TEXT_TERTIARY} />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.questionItem}
                onPress={() => handleConversationAction('Eviction Defense', 'I received an eviction notice. What should I do?')}
                activeOpacity={0.7}
              >
                <Text style={styles.questionText}>I received an eviction notice. What should I do?</Text>
                <IconComponent name="chevron-forward" size={16} color={APPLE_TEXT_TERTIARY} />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.questionItem}
                onPress={() => handleConversationAction('Security Deposit', 'Can I get my security deposit back?')}
                activeOpacity={0.7}
              >
                <Text style={styles.questionText}>Can I get my security deposit back?</Text>
                <IconComponent name="chevron-forward" size={16} color={APPLE_TEXT_TERTIARY} />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// Minimal UI tuning constants
const MINIMAL_BORDER = '#e5e7eb';
const APPLE_BACKGROUND = '#f8fafc';
const APPLE_CARD_BACKGROUND = '#ffffff';
const APPLE_TEXT_PRIMARY = '#1f2937';
const APPLE_TEXT_SECONDARY = '#6b7280';
const APPLE_TEXT_TERTIARY = '#9ca3af';

const styles = StyleSheet.create({
  // New hero styles aligned with main screen
  container: {
    flex: 1,
    backgroundColor: APPLE_BACKGROUND,
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
    paddingVertical: 8,
  },
  sindiExplanationContainer: {
    backgroundColor: APPLE_CARD_BACKGROUND,
    borderRadius: 16,
    padding: 24,
    marginHorizontal: 16,
    marginBottom: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: MINIMAL_BORDER,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  sindiIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: `${colors.primaryColor}15`,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  sindiTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: APPLE_TEXT_PRIMARY,
    marginBottom: 12,
    fontFamily: 'Phudu',
    letterSpacing: -0.5,
  },
  sindiDescription: {
    fontSize: 16,
    color: APPLE_TEXT_SECONDARY,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 20,
  },
  sindiFeatures: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
  },
  sindiFeature: {
    alignItems: 'center',
    flex: 1,
  },
  sindiFeatureText: {
    fontSize: 12,
    color: APPLE_TEXT_SECONDARY,
    marginTop: 6,
    textAlign: 'center',
    fontWeight: '500',
  },
  learnMoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: `${colors.primaryColor}15`,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: `${colors.primaryColor}30`,
  },
  learnMoreButtonText: {
    color: colors.primaryColor,
    fontSize: 15,
    fontWeight: '600',
    marginRight: 8,
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
    marginBottom: 24,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: MINIMAL_BORDER,
    overflow: 'hidden',
    backgroundColor: APPLE_CARD_BACKGROUND,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  newConversationContent: {
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
    color: APPLE_TEXT_PRIMARY,
    marginBottom: 2,
  },
  newConversationSubtext: {
    fontSize: 13,
    color: APPLE_TEXT_SECONDARY,
    fontWeight: '400',
  },
  newConversationArrow: {
    marginLeft: 12,
  },
  conversationHistoryContainer: {
    marginBottom: 32,
  },
  searchBarWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: APPLE_CARD_BACKGROUND,
    borderWidth: 1,
    borderColor: MINIMAL_BORDER,
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 44,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  searchInputChats: {
    flex: 1,
    fontSize: 16,
    marginLeft: 8,
    color: APPLE_TEXT_PRIMARY,
  },
  clearSearchBtn: {
    padding: 4,
    borderRadius: 12,
  },
  skeletonRow: {
    height: 64,
    borderRadius: 12,
    backgroundColor: '#f3f4f6',
    marginBottom: 8,
    overflow: 'hidden',
  },
  groupHeader: {
    fontSize: 13,
    fontWeight: '600',
    color: APPLE_TEXT_TERTIARY,
    marginTop: 16,
    marginBottom: 8,
    paddingHorizontal: 16,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  conversationItemLast: {
    marginBottom: 16,
  },

  conversationHistoryTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: APPLE_TEXT_PRIMARY,
    marginBottom: 20,
    fontFamily: 'Phudu',
    paddingHorizontal: 16,
    letterSpacing: -0.5,
  },
  loadingContainer: {
    padding: 20,
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 16,
    color: APPLE_TEXT_SECONDARY,
  },

  conversationsList: {
    paddingHorizontal: 8,
  },
  conversationItem: {
    marginBottom: 4,
    borderRadius: 12,
    backgroundColor: APPLE_CARD_BACKGROUND,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  conversationCard: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  conversationHeader: {},
  conversationTitleContainer: { flex: 1 },
  conversationIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primaryColor,
    justifyContent: 'center',
    alignItems: 'center',
  },
  conversationTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: APPLE_TEXT_PRIMARY,
    marginBottom: 4,
  },
  conversationDate: {
    position: 'absolute',
    top: 0,
    right: 0,
    fontSize: 12,
    color: APPLE_TEXT_TERTIARY,
    fontWeight: '500',
  },
  conversationPreview: {
    fontSize: 14,
    color: APPLE_TEXT_SECONDARY,
    lineHeight: 18,
    paddingRight: 60,
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
    fontSize: 11,
    color: APPLE_TEXT_TERTIARY,
    fontWeight: '500',
  },
  conversationArrow: {
    display: 'none',
  },
  conversationMessageCount: {
    fontSize: 12,
    color: APPLE_TEXT_SECONDARY,
  },
  subscriptionStatusContainer: {
    marginHorizontal: 16,
    marginBottom: 32,
  },
  subscriptionCard: {
    backgroundColor: APPLE_CARD_BACKGROUND,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: MINIMAL_BORDER,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  subscriptionCardActive: {
    borderColor: colors.primaryColor,
    borderWidth: 2,
  },
  subscriptionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  subscriptionTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: APPLE_TEXT_PRIMARY,
    marginLeft: 8,
  },
  subscriptionDescription: {
    fontSize: 14,
    color: APPLE_TEXT_SECONDARY,
    marginBottom: 16,
    lineHeight: 20,
  },
  upgradeButton: {
    backgroundColor: colors.primaryColor,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignSelf: 'flex-start',
  },
  upgradeButtonText: {
    color: 'white',
    fontSize: 15,
    fontWeight: '600',
  },
  subscriptionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(107, 114, 128, 0.1)',
    borderRadius: 12,
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignSelf: 'flex-start',
  },
  subscriptionBadgeText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primaryColor,
    marginLeft: 4,
  },
  commonQuestionsContainer: {
    marginHorizontal: 16,
    marginBottom: 32,
  },
  commonQuestionsTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: APPLE_TEXT_PRIMARY,
    marginBottom: 8,
    fontFamily: 'Phudu',
    letterSpacing: -0.5,
  },
  commonQuestionsSubtitle: {
    fontSize: 15,
    color: APPLE_TEXT_SECONDARY,
    marginBottom: 20,
    lineHeight: 22,
  },
  questionsList: {
    gap: 12,
  },
  questionItem: {
    backgroundColor: APPLE_CARD_BACKGROUND,
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: MINIMAL_BORDER,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  questionText: {
    fontSize: 15,
    color: APPLE_TEXT_PRIMARY,
    flex: 1,
    marginRight: 12,
    lineHeight: 20,
  },
});
