import { API_URL } from '@/config';
import { useChat } from '@ai-sdk/react';
import { fetch as expoFetch } from 'expo/fetch';
import {
  View,
  TextInput,
  ScrollView,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useOxy } from '@oxyhq/services';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';

import { useRouter, useLocalSearchParams } from 'expo-router';
import { PropertyCard } from '@/components/PropertyCard';
import { SindiIcon } from '@/assets/icons';
import { ThemedView } from '@/components/ThemedView';
import { Header } from '@/components/Header';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import * as DocumentPicker from 'expo-document-picker';
import React, { useEffect, useCallback } from 'react';
import {
  useConversationStore,
  type ConversationMessage,
  type Conversation,
} from '@/store/conversationStore';
import { EmptyState } from '@/components/ui/EmptyState';
const IconComponent = Ionicons as any;

export default function ConversationDetail() {
  const { oxyServices, activeSessionId } = useOxy();
  const router = useRouter();
  const { t } = useTranslation();
  const { conversationId, message } = useLocalSearchParams<{
    conversationId: string;
    message?: string;
  }>();
  const [attachedFile, setAttachedFile] = React.useState<any>(null);

  // Zustand store
  const {
    currentConversation,
    loading,
    loadConversation,
    saveConversation,
    updateConversationMessages,
    generateShareToken,
  } = useConversationStore();

  // Create a custom fetch function that includes authentication
  const authenticatedFetch = useCallback(
    async (url: string, options: RequestInit = {}) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...((options.headers as Record<string, string>) || {}),
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
    },
    [oxyServices, activeSessionId],
  );

  // Always call useChat, but only enable it if authenticated
  const isAuthenticated = !!oxyServices && !!activeSessionId;

  // Prepare initial messages from current conversation
  const initialMessages = React.useMemo(() => {
    if (currentConversation?.messages && currentConversation.messages.length > 0) {
      return currentConversation.messages.map((msg) => ({
        id: msg.id || `msg_${Date.now()}_${Math.random()}`,
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content,
      }));
    }
    return [];
  }, [currentConversation?.messages]);

  const { messages, error, handleInputChange, input, handleSubmit, isLoading, setMessages } =
    useChat({
      fetch: authenticatedFetch as unknown as typeof globalThis.fetch,
      api: `${API_URL}/api/ai/stream`,
      onError: (error: any) => console.error(error, 'ERROR'),
      enabled: isAuthenticated,
      initialMessages: initialMessages,
      body: {
        conversationId:
          conversationId && !conversationId.startsWith('conv_') ? conversationId : undefined,
      },
    } as any);

  // Auto-scroll to bottom for new messages
  const scrollViewRef = React.useRef<ScrollView>(null);
  const scrollToEnd = React.useCallback(() => {
    try {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    } catch { }
  }, []);

  // Load conversation on mount
  useEffect(() => {
    if (conversationId && conversationId !== 'undefined' && isAuthenticated) {
      // Check if this is a client-side generated ID (starts with 'conv_')
      if (conversationId.startsWith('conv_')) {
        // This is a client-side ID, we need to create a new conversation
        return;
      }

      // Only try to load from database if it's a valid database ID
      loadConversation(conversationId, authenticatedFetch)
        .catch((error) => {
          console.error('Failed to load conversation:', error);
        });
    }
  }, [conversationId, isAuthenticated, loadConversation, authenticatedFetch]);



  // Update conversation when messages change (debounced to prevent infinite loops)
  useEffect(() => {
    if (
      currentConversation &&
      messages.length > 0 &&
      conversationId &&
      conversationId !== 'undefined'
    ) {
      const conversationMessages: ConversationMessage[] = messages.map((msg) => ({
        id: msg.id,
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content,
        timestamp: new Date(),
      }));

      // Only update if messages actually changed
      const currentMessages = currentConversation.messages;
      const messagesChanged =
        currentMessages.length !== conversationMessages.length ||
        conversationMessages.some(
          (msg, index) =>
            !currentMessages[index] ||
            currentMessages[index].content !== msg.content ||
            currentMessages[index].role !== msg.role,
        );

      if (messagesChanged) {
        console.log('Messages changed, updating conversation:', conversationId);
        updateConversationMessages(conversationId, conversationMessages);

        // Debounce the save operation
        const timeoutId = setTimeout(() => {
          const updatedConversation: Conversation = {
            ...currentConversation,
            messages: conversationMessages,
            updatedAt: new Date(),
            // Update title based on first user message if it's still the default
            title:
              currentConversation.title === 'New Conversation' &&
                messages.length > 0 &&
                messages[0].role === 'user'
                ? messages[0].content.substring(0, 50) +
                (messages[0].content.length > 50 ? '...' : '')
                : currentConversation.title,
          };

          console.log('Saving conversation with messages:', updatedConversation.messages.length);
          saveConversation(updatedConversation, authenticatedFetch)
            .then((savedConversation) => {
              console.log('Conversation saved successfully:', savedConversation?.id);
              // If the conversation ID changed (from client-generated to database ID), update URL
              if (savedConversation && savedConversation.id !== conversationId) {
                router.replace(`/sindi/${savedConversation.id}`);
              }
            })
            .catch((error) => {
              console.error('Failed to save conversation:', error);
            });
        }, 1000); // 1 second debounce

        return () => clearTimeout(timeoutId);
      }
    }

    // Always scroll to the latest message
    scrollToEnd();
  }, [
    messages,
    currentConversation,
    conversationId,
    updateConversationMessages,
    saveConversation,
    authenticatedFetch,
    router,
    scrollToEnd,
  ]); // Watch for actual message changes

  // Handle initial message from URL parameter
  useEffect(() => {
    if (message && currentConversation && !loading) {
      // Set the initial message in the input field
      handleInputChange({
        target: { value: decodeURIComponent(message) },
      } as any);
    }
  }, [message, currentConversation, loading, handleInputChange]);

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

  // Wrap the original handleSubmit to include file info
  const handleSubmitWithFile = React.useCallback(() => {
    if (attachedFile) {
      console.log('Sending file:', attachedFile);
      // TODO: Integrate file upload to backend here
      setAttachedFile(null);
    }
    handleSubmit();
  }, [attachedFile, handleSubmit]);

  const handleSuggestionPress = React.useCallback(
    (text: string) => {
      handleInputChange({ target: { value: text } } as any);
      setTimeout(() => handleSubmitWithFile(), 0);
    },
    [handleInputChange, handleSubmitWithFile],
  );

  // Early return for unauthenticated users
  if (!isAuthenticated) {
    return (
      <ThemedView style={styles.container} lightColor="transparent" darkColor="transparent">
        <Header
          options={{
            title: t('sindi.conversation.title'),
            showBackButton: true,
            rightComponents: [
              <TouchableOpacity
                key="share"
                onPress={() => {
                  /* TODO: Implement share */
                }}
              >
                <IconComponent name="share-outline" size={24} color={colors.COLOR_BLACK} />
              </TouchableOpacity>,
            ],
          }}
        />
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

  if (loading) {
    return (
      <ThemedView style={styles.container} lightColor="transparent" darkColor="transparent">
        <Header
          options={{
            title: t('sindi.conversation.loading'),
            showBackButton: true,
          }}
        />
        <View style={styles.loadingContainer}>
          <IconComponent name="hourglass" size={48} color={colors.primaryColor} />
          <Text style={styles.loadingText}>{t('sindi.conversation.loadingMessage')}</Text>
        </View>
      </ThemedView>
    );
  }

  if (error)
    return (
      <SafeAreaView style={styles.container}>
        <Header
          options={{
            title: t('sindi.conversation.error'),
            showBackButton: true,
          }}
        />
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
  const webStyles =
    Platform.OS === 'web'
      ? {
        container: { height: '100vh', display: 'flex', flexDirection: 'column' } as any,
        stickyHeader: { position: 'sticky', top: 0 } as any,
        messagesContainer: { marginTop: 0, marginBottom: 0, flex: 1, overflow: 'auto' } as any,
        stickyInput: { position: 'sticky', bottom: 0 } as any,
        messagesContent: { paddingBottom: 100 },
      }
      : {};

  return (
    <SafeAreaView style={[styles.container, webStyles.container]}>
      <LinearGradient
        colors={["#ffffff", `${colors.primaryColor}40`]}
        style={styles.backgroundGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />
      {/* Header */}
      <Header
        options={{
          title: currentConversation?.title || t('sindi.conversation.title'),
          subtitle: t('sindi.conversation.subtitle'),
          showBackButton: true,
          rightComponents: [
            <TouchableOpacity
              key="share"
              onPress={async () => {
                if (!currentConversation || currentConversation.id.startsWith('conv_')) {
                  Alert.alert(
                    t('sindi.shared.share.error.title'),
                    t('sindi.shared.share.error.saveFirst'),
                  );
                  return;
                }

                // Don't allow sharing empty conversations
                if (!currentConversation.messages || currentConversation.messages.length === 0) {
                  Alert.alert(
                    t('sindi.shared.share.error.title'),
                    t('sindi.shared.share.error.emptyConversation'),
                  );
                  return;
                }

                try {
                  // Generate share token using store method
                  const shareToken = await generateShareToken(
                    currentConversation.id,
                    authenticatedFetch,
                  );

                  if (shareToken) {
                    const shareUrl = `${Platform.OS === 'web' ? window.location.origin : 'https://homiio.com'}/sindi/shared/${shareToken}`;

                    if (Platform.OS === 'web' && navigator.share) {
                      navigator.share({
                        title: currentConversation.title,
                        text: t('sindi.shared.share.text'),
                        url: shareUrl,
                      });
                    } else if (Platform.OS === 'web') {
                      navigator.clipboard.writeText(shareUrl);
                      Alert.alert(
                        t('sindi.shared.share.success.title'),
                        t('sindi.shared.share.success.copied'),
                      );
                    }
                  } else {
                    Alert.alert(
                      t('sindi.shared.share.error.title'),
                      t('sindi.shared.share.error.failed'),
                    );
                  }
                } catch (error) {
                  console.error('Failed to share conversation:', error);
                  Alert.alert(
                    t('sindi.shared.share.error.title'),
                    t('sindi.shared.share.error.failed'),
                  );
                }
              }}
            >
              <IconComponent name="share-outline" size={24} color={colors.COLOR_BLACK} />
            </TouchableOpacity>,
          ],
        }}
      />

      {/* Messages */}
      <ScrollView
        ref={scrollViewRef}
        style={[styles.messagesContainer, webStyles.messagesContainer]}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.messagesContent, webStyles.messagesContent]}
        onContentSizeChange={scrollToEnd}
      >
        {messages.length === 0 ? (
          <View style={styles.emptyContainer}>
            <View style={styles.emptyCard}>
              <View style={styles.emptyIconContainer}>
                <SindiIcon size={56} color={colors.primaryColor} />
              </View>
              <Text style={styles.emptyTitle}>Start your conversation</Text>
              <Text style={styles.emptySubtitle}>
                Ask about tenant rights, explore housing options, or get a quick lease review.
              </Text>
              <View style={styles.suggestionsWrap}>
                <TouchableOpacity
                  style={styles.suggestionChip}
                  onPress={() => handleSuggestionPress('What are my rights if my rent increases by 20%?')}
                >
                  <IconComponent name="help-circle-outline" size={16} color={colors.primaryColor} />
                  <Text style={styles.suggestionText}>Tenant rights</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.suggestionChip}
                  onPress={() => handleSuggestionPress('Find 2-bedroom apartments under $2000 in Seattle')}
                >
                  <IconComponent name="search-outline" size={16} color={colors.primaryColor} />
                  <Text style={styles.suggestionText}>Find housing</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.suggestionChip}
                  onPress={() => handleSuggestionPress('Can you review my lease for red flags?')}
                >
                  <IconComponent name="document-text-outline" size={16} color={colors.primaryColor} />
                  <Text style={styles.suggestionText}>Lease review</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.suggestionChip}
                  onPress={() => handleSuggestionPress('How should I respond to an eviction notice?')}
                >
                  <IconComponent name="alert-circle-outline" size={16} color={colors.primaryColor} />
                  <Text style={styles.suggestionText}>Eviction help</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ) : (
          messages.map((m) => (
            <View
              key={m.id}
              style={[
                styles.messageContainer,
                m.role === 'user' ? styles.userMessage : styles.assistantMessage,
              ]}
            >
              <View
                style={[
                  styles.messageBubble,
                  m.role === 'user' ? styles.userBubble : styles.assistantBubble,
                ]}
              >
                {
                  // If this is a property search result system message, parse and render cards
                  m.role === 'system' && m.content.startsWith('PROPERTY SEARCH RESULTS:') ? (
                    (() => {
                      // Extract property lines
                      const lines = m.content.split('\n').filter((line) => line.startsWith('- '));
                      const properties = lines
                        .map((line) => {
                          // Try to parse title, type, rent, city from the line
                          const match = line.match(/^- (.*?) \((.*?), (.*?)\)(, (.*?))?$/);
                          if (match) {
                            return {
                              title: match[1],
                              type: match[2],
                              rent: { amount: match[3] },
                              address: { city: match[5] },
                              _id: match[1] + '-' + (match[5] || ''), // Fallback unique id
                              id: match[1] + '-' + (match[5] || ''),
                            };
                          }
                          return undefined;
                        })
                        .filter((p): p is any => !!p);
                      return (
                        <View key={m.id || m.content} style={styles.propertyCardsContainer}>
                          {properties.map((property, idx) => (
                            <PropertyCard
                              key={property._id || property.id || idx}
                              property={property}
                              variant={'featured'}
                              onPress={() =>
                                router.push(`/properties/${property._id || property.id}`)
                              }
                            />
                          ))}
                        </View>
                      );
                    })()
                  ) : (
                    <View style={{ flexShrink: 1, flexWrap: 'wrap', width: '100%' }}>
                      <Text
                        style={[
                          styles.markdownParagraph,
                          m.role === 'user' ? styles.userText : styles.assistantText,
                        ]}
                      >
                        {m.content}
                      </Text>
                    </View>
                  )
                }
              </View>
              <Text
                style={[
                  styles.messageTime,
                  m.role === 'user' ? styles.messageTimeUser : styles.messageTimeAssistant,
                ]}
              >
                {m.role === 'user' ? t('sindi.chat.you') : t('sindi.name')} • {new Date().toLocaleTimeString()}
              </Text>
            </View>
          ))
        )}
      </ScrollView>

      {/* Sticky Input */}
      <View style={[styles.stickyInput, webStyles.stickyInput]}>
        <View style={styles.inputBar}>
          <View style={styles.inputContainer}>
            {attachedFile && (
              <View style={styles.filePreviewContainer}>
                <Text style={styles.filePreviewText}>{attachedFile.name}</Text>
                <TouchableOpacity onPress={handleRemoveFile} style={styles.removeFileButton}>
                  <IconComponent name="close-circle" size={18} color="#e74c3c" />
                </TouchableOpacity>
              </View>
            )}
            <View style={styles.inputWrapper}>
              <TouchableOpacity onPress={handleAttachFile} style={styles.attachButton}>
                <IconComponent name="attach" size={20} color="#54656f" />
              </TouchableOpacity>
              <TextInput
                style={styles.textInput}
                placeholder={t('sindi.chat.placeholder')}
                placeholderTextColor="#667781"
                value={input}
                onChangeText={(text) =>
                  handleInputChange({
                    target: { value: text },
                  } as any)
                }
                onSubmitEditing={handleSubmitWithFile}
                multiline
                maxLength={1000}
              />
              <TouchableOpacity
                style={[styles.sendButtonPlain, !input.trim() && styles.sendButtonDisabledPlain]}
                onPress={handleSubmitWithFile}
                disabled={!input.trim() || isLoading}
              >
                <IconComponent
                  name={isLoading ? 'hourglass' : 'send'}
                  size={20}
                  color={input.trim() ? colors.primaryColor : '#99a2a7'}
                />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  backgroundGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  messagesContainer: {
    flex: 1,
    marginBottom: 72,
  },
  messagesContent: {
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  emptyContainer: {
    paddingVertical: 32,
    paddingHorizontal: 16,
  },
  emptyCard: {
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    backgroundColor: 'transparent',
    borderWidth: 0,
    borderColor: 'transparent',
  },
  emptyIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111b21',
    marginBottom: 6,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#667781',
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 8,
    marginBottom: 12,
  },
  suggestionsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  suggestionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#f0f2f5',
    borderWidth: 1,
    borderColor: '#e9edef',
    gap: 6,
  },
  suggestionText: {
    color: colors.primaryColor,
    fontSize: 13,
    fontWeight: '600',
  },
  messageContainer: {
    marginVertical: 2,
    paddingHorizontal: 4,
  },
  userMessage: {
    alignItems: 'flex-end',
    marginLeft: 40,
  },
  assistantMessage: {
    alignItems: 'flex-start',
    marginRight: 40,
  },
  messageBubble: {
    maxWidth: '75%',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 18,
    overflow: 'hidden',
    shadowColor: 'transparent',
    elevation: 0,
  },
  userBubble: {
    backgroundColor: colors.primaryColor,
    borderTopRightRadius: 18,
  },
  assistantBubble: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e9edef',
    borderTopLeftRadius: 18,
  },
  timestampInBubble: { display: 'none' },
  timestampUser: { display: 'none' },
  timestampAssistant: { display: 'none' },
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
  inputBar: {
    backgroundColor: '#f0f2f5',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#e9edef',
  },
  inputContainer: {
    paddingHorizontal: 8,
    paddingVertical: 0,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: '#ffffff',
    borderRadius: 24,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 44,
    borderWidth: 1,
    borderColor: '#e9edef',
  },
  textInput: {
    flex: 1,
    fontSize: 16,
    maxHeight: 120,
    paddingVertical: 8,
    paddingHorizontal: 6,
    color: '#111b21',
    lineHeight: 22,
  },
  sendButtonPlain: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  sendButtonDisabledPlain: {
    opacity: 0.5,
  },
  disclaimer: { display: 'none' },
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
  markdownParagraph: {
    fontSize: 15,
    lineHeight: 20,
    marginBottom: 2,
  },
  userText: {
    color: 'white',
  },
  assistantText: {
    color: '#111b21',
  },
  propertyCardsContainer: {
    marginVertical: 12,
    gap: 12,
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
  messageTime: {
    fontSize: 11,
    color: '#8696a0',
    marginTop: 2,
    marginHorizontal: 8,
  },
  messageTimeUser: {
    alignSelf: 'flex-end',
  },
  messageTimeAssistant: {
    alignSelf: 'flex-start',
  },
});
