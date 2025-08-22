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
import { SindiIcon } from '@/assets/icons';
import Button from '@/components/button';
import { colors } from '@/styles/colors';
import { useRouter } from 'expo-router';
import { ThemedView } from '@/components/ThemedView';
import { Header } from '@/components/Header';
import { useTranslation } from 'react-i18next';
import React, { useEffect, useCallback, useState, useMemo, memo, useContext } from 'react';
import { useConversationStore } from '@/store/conversationStore';
import { EmptyState } from '@/components/ui/EmptyState';
import { BottomSheetContext } from '@/context/BottomSheetContext';
import { SindiExplanationBottomSheet } from '@/components/SindiExplanationBottomSheet';

const IconComponent = Ionicons as any;

// (Removed) Entitlements interface (unused)

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
        {/* Icon removed for a cleaner conversation list */}
        <View style={{ flex: 1, paddingRight: 4 }}>
          <View style={styles.conversationHeader}>
            <Text style={styles.conversationTitle} numberOfLines={1}>
              {conversation.title}
            </Text>
            <Text style={styles.conversationDate}>
              {formatTimestamp(new Date(conversation.updatedAt))}
            </Text>
          </View>
          <Text style={styles.conversationPreview} numberOfLines={1}>
            {last ? last.content : 'No messages yet'}
          </Text>
          {/* Meta removed for WhatsApp-style simplification */}
        </View>
      </View>
    </TouchableOpacity>
  );
});
ConversationItem.displayName = 'ConversationItem';

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
  <Button
    onPress={onPress}
    accessibilityLabel="Start new conversation"
    style={{
      marginHorizontal: 16,
      marginBottom: 24,
      borderRadius: 35,
      backgroundColor: '#ffffff',
      borderWidth: 1,
      borderColor: '#e5e7eb',
      paddingVertical: 16,
      paddingHorizontal: 16,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.05,
      shadowRadius: 8,
      elevation: 2,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      gap: 8
    }}
  >
    <IconComponent name="add-circle" size={24} color={colors.primaryColor} />
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={{ fontSize: 16, fontWeight: '600', color: '#1f2937' }}>Start New Conversation</Text>
      <Text style={{ fontSize: 13, color: '#6b7280', fontWeight: '400' }}>
        Get instant help with housing questions
      </Text>
    </View>
    <IconComponent name="chevron-forward" size={16} color={colors.primaryDark_1} />
  </Button>
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

  // Entitlements-related logic removed (previously unused)

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

  // Conversation action handler removed (legacy common questions feature)



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

  // Flat, newest-first conversation list (WhatsApp style)
  const sortedConversations = useMemo(
    () => [...filteredConversations].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [filteredConversations]
  );

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
              <SindiIcon size={48} color={colors.primaryColor} />
            </View>
            <Text style={styles.sindiTitle}>Meet Sindi</Text>
            <Text style={styles.sindiDescription}>
              Your AI-powered housing rights assistant. Get instant help with tenant issues, understand your rights, and navigate housing challenges with confidence.
            </Text>
            <Button
              onPress={() => {
                if (bottomSheetContext) {
                  bottomSheetContext.openBottomSheet(
                    <SindiExplanationBottomSheet onClose={() => bottomSheetContext.closeBottomSheet()} />,
                    { hideHandle: true }
                  );
                }
              }}
              accessibilityLabel="Learn how Sindi works"
            >
              Learn How It Works
            </Button>
          </View>

          <View style={styles.sindiFeaturesDetached}>
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
          </View>

          <NewConversationButton onPress={createNewConversation} />

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
                {sortedConversations.map((conversation, idx) => (
                  <ConversationItem
                    key={conversation.id}
                    conversation={conversation}
                    isLast={idx === sortedConversations.length - 1}
                    onPress={() => router.push(`/sindi/${conversation.id}`)}
                  />
                ))}
              </View>
            )}
          </View>

          {/* Common Questions section intentionally removed */}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // New hero styles aligned with main screen
  container: {
    flex: 1,
  },
  messagesContainer: {
    flex: 1,
  },
  messagesContent: {
  },
  welcomeContainer: {
    paddingVertical: 8,
  },
  sindiExplanationContainer: {
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    gap: 10,
  },
  sindiIconContainer: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: `${colors.primaryColor}12`,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sindiTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.primaryDark,
    fontFamily: 'Phudu',
    letterSpacing: -0.5,
  },
  sindiDescription: {
    fontSize: 16,
    color: colors.primaryDark_1,
    textAlign: 'center',
    lineHeight: 24,
  },
  sindiFeatures: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
  },
  sindiFeaturesDetached: {
    marginTop: 12,
    marginBottom: 12,
    paddingHorizontal: 16,
  },
  sindiFeature: {
    alignItems: 'center',
    flex: 1,
  },
  sindiFeatureText: {
    fontSize: 12,
    color: colors.primaryDark_1,
    marginTop: 6,
    textAlign: 'center',
    fontWeight: '500',
  },

  stickyInput: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    backgroundColor: 'white',
    borderTopWidth: 1,
    borderTopColor: colors.primaryDark_1,
  },
  inputGradient: {
    margin: 12,
    marginBottom: 4,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: colors.primaryDark_1,
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
    borderColor: colors.primaryDark_1,
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

  conversationHistoryContainer: {
    marginBottom: 32,
  },
  searchBarWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.primaryDark_1,
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
    color: colors.COLOR_BLACK_LIGHT_5,
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
  // groupHeader removed
  conversationItemLast: {
    borderBottomWidth: 0,
  },

  conversationHistoryTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.primaryDark,
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
    color: colors.primaryDark_1,
  },

  conversationsList: {
    backgroundColor: '#f0f2f5',
  },
  conversationItem: {
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#ececec',
  },
  conversationCard: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  conversationTitleContainer: { flex: 1 },
  conversationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  conversationTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#111b21',
    marginBottom: 2,
    paddingRight: 8,
  },
  conversationDate: {
    fontSize: 12,
    color: '#667781',
    fontWeight: '400',
    marginLeft: 8,
  },
  conversationPreview: {
    fontSize: 13,
    color: '#667781',
    lineHeight: 18,
    marginTop: 2,
  },
  conversationMeta: {},
  conversationStats: {},
  conversationStatsText: {},
  conversationArrow: {
    display: 'none',
  },
  conversationMessageCount: {
    fontSize: 12,
    color: colors.primaryDark_1,
  },
});
