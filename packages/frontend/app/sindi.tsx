import { generateAPIUrl } from '@/utils/generateAPIUrl';
import { useChat } from '@ai-sdk/react';
import { fetch as expoFetch } from 'expo/fetch';
import { View, TextInput, ScrollView, Text, SafeAreaView, TouchableOpacity, StyleSheet, Platform, ActivityIndicator } from 'react-native';
import { useOxy } from '@oxyhq/services';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import Markdown from 'react-native-markdown-display';
import { useRouter } from 'expo-router';
import { PropertyCard } from '@/components/PropertyCard';
import { SindiIcon } from '@/assets/icons';
import { ThemedView } from '@/components/ThemedView';
import { ThemedText } from '@/components/ThemedText';
import { Header } from '@/components/Header';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { sindiApi } from '@/utils/api';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    borderRadius: 35,
  },
  absoluteFillWithRadius: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 35,
  },
  stickyHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1100,
  },
  headerWrapper: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginHorizontal: 0,
    marginTop: 0,
    marginBottom: 0,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    overflow: 'hidden',
    maxWidth: '100%',
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 15,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  avatarContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primaryColor,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2c3e50',
  },
  subtitle: {
    fontSize: 12,
    color: '#7f8c8d',
    marginTop: 2,
  },
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  statusText: {
    fontSize: 12,
    color: '#7f8c8d',
  },
  messagesContainer: {
    flex: 1,
    marginTop: 70, // Account for sticky header
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
  },
  welcomeTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginTop: 16,
    marginBottom: 8,
  },
  welcomeSubtitle: {
    fontSize: 16,
    color: '#7f8c8d',
    textAlign: 'center',
    lineHeight: 24,
    paddingHorizontal: 20,
  },
  quickActionsContainer: {
    marginBottom: 30,
  },
  quickActionsTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#2c3e50',
    marginBottom: 16,
  },
  quickActionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  quickActionButton: {
    width: '48%',
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    padding: 16,
    borderRadius: 35,
    marginBottom: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    overflow: 'hidden',
  },
  quickActionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2c3e50',
    marginTop: 8,
    textAlign: 'center',
  },
  propertySearchContainer: {
    marginBottom: 30,
  },
  propertySearchTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#2c3e50',
    marginBottom: 16,
  },
  propertySearchSubtitle: {
    fontSize: 14,
    color: '#7f8c8d',
    textAlign: 'center',
    lineHeight: 24,
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  propertySearchGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  propertySearchButton: {
    width: '48%',
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    padding: 16,
    borderRadius: 35,
    marginBottom: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    overflow: 'hidden',
  },
  propertySearchText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#2c3e50',
    marginTop: 8,
    textAlign: 'center',
  },
  propertySearchNote: {
    fontSize: 12,
    color: '#7f8c8d',
    textAlign: 'center',
    marginTop: 8,
  },
  featuresContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    padding: 20,
    borderRadius: 35,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    overflow: 'hidden',
  },
  featuresTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#2c3e50',
    marginBottom: 16,
  },
  featureList: {
    gap: 8,
  },
  featureItem: {
    fontSize: 14,
    color: '#7f8c8d',
    lineHeight: 20,
  },
  messageContainer: {
    marginVertical: 8,
  },
  userMessage: {
    alignItems: 'flex-end',
    alignSelf: 'flex-end',
  },
  assistantMessage: {
    alignItems: 'flex-start',
    alignSelf: 'flex-start',
  },
  messageBubble: {
    width: 'auto',
    maxWidth: '80%',
    minWidth: 0,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 35,
  },
  userBubble: {
    backgroundColor: colors.sindiColor,
  },
  assistantBubble: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(23, 95, 172, 0.1)',
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
    backgroundColor: 'transparent',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.3)',
    borderBottomLeftRadius: 35,
    borderBottomRightRadius: 35,
  },
  inputContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: 35,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    overflow: 'hidden',
  },
  textInput: {
    flex: 1,
    fontSize: 16,
    maxHeight: 100,
    paddingVertical: 8,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.sindiColor,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  sendButtonDisabled: {
    backgroundColor: '#e9ecef',
  },
  disclaimer: {
    fontSize: 11,
    color: '#95a5a6',
    textAlign: 'center',
    marginTop: 8,
    fontStyle: 'italic',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  errorText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginTop: 16,
    marginBottom: 8,
  },
  errorSubtext: {
    fontSize: 14,
    color: '#7f8c8d',
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
    marginBottom: 0,
    width: '100%',
    minWidth: 0,
    flexShrink: 1,
    flexWrap: 'wrap',
    ...(Platform.OS === 'web' ? { wordBreak: 'break-word', whiteSpace: 'pre-wrap' } : {}),
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
  authRequiredContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  authRequiredContent: {
    alignItems: 'center',
  },
  authRequiredIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  authRequiredTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  authRequiredSubtitle: {
    fontSize: 14,
    color: '#7f8c8d',
    textAlign: 'center',
  },
  stickyHeaderNative: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1100,
    overflow: 'hidden',
  },
});

// Sticky header style for web as plain object (not in StyleSheet)
const stickyHeaderWeb = {
  position: 'sticky',
  top: 0,
  zIndex: 1100,
  overflow: 'hidden' as 'hidden',
};

const webStyles = Platform.OS === 'web' ? {
  container: { height: '100vh', display: 'flex', flexDirection: 'column' } as any,
  stickyHeader: { position: 'sticky', top: 0 } as any,
  messagesContainer: { marginTop: 0, marginBottom: 0, flex: 1, overflow: 'auto' } as any,
  stickyInput: { position: 'sticky', bottom: 0 } as any,
  messagesContent: { paddingBottom: 100 }
} : {};

export default function sindi() {
  const { oxyServices, activeSessionId } = useOxy();
  const router = useRouter();
  const { t } = useTranslation();

  // Add a loading state for auth context restoration
  if (typeof oxyServices === 'undefined' || typeof activeSessionId === 'undefined') {
    return (
      <SafeAreaView style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={colors.primaryColor} />
      </SafeAreaView>
    );
  }

  // Check if user is authenticated
  if (!oxyServices || !activeSessionId) {
    return (
      <View style={styles.container}>
        <View style={{ position: 'relative' }}>
          <BlurView intensity={40} style={StyleSheet.absoluteFill} />
          <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255,255,255,0.5)', }} pointerEvents="none" />
          <Header
            options={{
              title: t('sindi.title'),
              titlePosition: 'center',
              showBackButton: true,
              leftComponents: [
              ],
            }}
          />
        </View>
        <View style={styles.authRequiredContainer}>
          <View style={styles.authRequiredContent}>
            <Text style={styles.authRequiredIcon}>🔒</Text>
            <ThemedText style={styles.authRequiredTitle}>{t('sindi.auth.required')}</ThemedText>
            <ThemedText style={styles.authRequiredSubtitle}>
              {t('sindi.auth.message')}
            </ThemedText>
          </View>
        </View>
      </View>
    );
  }

  // Create a custom fetch function that includes authentication and buffers streamed assistant response for chat history
  const authenticatedFetch = async (url: string, options: RequestInit = {}) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {}),
    };

    // Add authentication token if available
    if (activeSessionId) {
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

    // --- Buffer streamed response for /api/ai/stream ---
    if (url.includes('/api/ai/stream') && options.method === 'POST') {
      // Parse user message from body
      let userMessage = '';
      try {
        const parsed = JSON.parse(body as string);
        if (Array.isArray(parsed.messages)) {
          const lastUserMsg = parsed.messages.slice().reverse().find((m: any) => m.role === 'user');
          if (lastUserMsg) userMessage = lastUserMsg.content;
        }
      } catch (e) { /* ignore */ }

      // Use fetch to stream response
      const response = await expoFetch(url, fetchOptions as any);
      if (!response.body) return response;

      // Tee the stream: one for UI, one for buffering
      const [uiStream, bufferStream] = response.body.tee();

      // Buffer the streamed assistant response in the background
      (async () => {
        let assistantMessage = '';
        const reader = bufferStream.getReader();
        const decoder = new TextDecoder();
        let done = false;
        while (!done) {
          const { value, done: doneReading } = await reader.read();
          if (value) assistantMessage += decoder.decode(value);
          done = doneReading;
        }
        // After streaming, save to chat history
        if (userMessage && assistantMessage && oxyServices && activeSessionId) {
          try {
            await sindiApi.saveSindiChatHistory(userMessage, assistantMessage, oxyServices, activeSessionId);
          } catch (e) {
            console.error('Failed to save Sindi chat history:', e);
          }
        }
      })();

      // Return the UI stream to useChat for real-time updates
      return new Response(uiStream, {
        headers: response.headers,
        status: response.status,
        statusText: response.statusText,
      });
    }
    // --- End buffer logic ---

    return expoFetch(url, fetchOptions as any);
  };

  const { messages, error, handleInputChange, input, handleSubmit, isLoading } = useChat({
    fetch: authenticatedFetch as unknown as typeof globalThis.fetch,
    api: generateAPIUrl('/api/ai/stream'),
    onError: error => console.error(error, 'ERROR'),
  });

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
      <View style={styles.errorContainer}>
        <Ionicons name="alert-circle" size={48} color={colors.primaryColor} />
        <Text style={styles.errorText}>{t('sindi.errors.connection')}</Text>
        <Text style={styles.errorSubtext}>{t('sindi.errors.connectionMessage')}</Text>
      </View>
    </SafeAreaView>
  );

  const bubbleTextStyle = {
    minWidth: 0,
    flexShrink: 1,
    ...(Platform.OS === 'web' ? { wordBreak: 'break-word', whiteSpace: 'pre-wrap' } : {}),
  };
  const bubbleViewStyle = {
    width: '100%' as const,
    minWidth: 0,
    flexShrink: 1,
  };
  const bubbleListStyle = {
    minWidth: 0,
    flexShrink: 1,
  };

  return (
    <SafeAreaView style={[styles.container, webStyles.container]}>
      {/* Gradient Background */}
      <LinearGradient
        colors={["#ffffff", "#e3f0ff", "#b3d8ff", "#5baaff"]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={styles.absoluteFillWithRadius}
      >
        <BlurView intensity={40} style={styles.absoluteFillWithRadius} />
      </LinearGradient>
      {/* Blurry Header - sticky, outside ScrollView */}
      <View
        style={[
          Platform.OS === 'web' ? (stickyHeaderWeb as import('react-native').ViewStyle) : styles.stickyHeaderNative,
        ]}
      >
        {/* Blurry background only */}
        <BlurView intensity={40} style={StyleSheet.absoluteFill} />
        <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255,255,255,0.5)' }} pointerEvents="none" />
        {/* Header content above blur */}
        <View style={[styles.headerWrapper, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
          {/* Left section */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
            <TouchableOpacity
              onPress={() => router.back()}
              style={{ marginRight: 6, alignItems: 'center', justifyContent: 'center', padding: 2 }}
              accessibilityLabel="Back"
            >
              <Ionicons name="arrow-back" size={22} color={colors.sindiColor} />
            </TouchableOpacity>
          </View>
          {/* Center section */}
          <View style={{ flex: 2, alignItems: 'center', justifyContent: 'center', minWidth: 0 }}>
            <Text style={{ fontFamily: 'Phudu', fontWeight: '700', fontSize: 20, color: '#175FAC', letterSpacing: 0.5, maxWidth: 180 }} numberOfLines={1} ellipsizeMode="tail">
              {t('sindi.title')}
            </Text>
          </View>
          {/* Right section */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', flex: 1 }}>
            <TouchableOpacity
              onPress={() => router.push('/settings/sindi')}
              style={{ marginLeft: 6, alignItems: 'center', justifyContent: 'center', padding: 2 }}
              accessibilityLabel="Preferences"
            >
              <Ionicons name="settings-outline" size={22} color={colors.sindiColor} />
            </TouchableOpacity>
          </View>
        </View>
      </View>
      {/* Messages */}
      <ScrollView
        style={[styles.messagesContainer, webStyles.messagesContainer]}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.messagesContent, webStyles.messagesContent]}
      >
        {messages.length === 0 ? (
          <View style={styles.welcomeContainer}>
            <View style={styles.welcomeHeader}>
              <SindiIcon size={48} color={colors.sindiColor} />
              <Text style={[styles.welcomeTitle, { fontFamily: 'Phudu' }]}>{t('sindi.welcome.title')}</Text>
              <Text style={styles.welcomeSubtitle}>
                {t('sindi.welcome.subtitle')}
              </Text>
            </View>

            <View style={styles.quickActionsContainer}>
              <Text style={[styles.quickActionsTitle, { fontFamily: 'Phudu' }]}>{t('sindi.actions.title')}</Text>
              <View style={styles.quickActionsGrid}>
                {quickActions.map((action, index) => (
                  <TouchableOpacity
                    key={index}
                    style={styles.quickActionButton}
                    onPress={() => handleQuickAction(action.prompt)}
                  >
                    <Ionicons name={action.icon as any} size={20} color={colors.sindiColor} />
                    <Text style={styles.quickActionText}>{action.title}</Text>
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
                    onPress={() => handleQuickAction(example.prompt)}
                  >
                    <Ionicons name={example.icon as any} size={18} color={colors.sindiColor} />
                    <Text style={styles.propertySearchText}>{example.title}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.propertySearchNote}>
                {t('sindi.housing.naturalLanguage')}
              </Text>
            </View>

            <View style={styles.featuresContainer}>
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
            </View>
          </View>
        ) : (
          messages.map(m => (
            <View key={m.id} style={[
              styles.messageContainer,
              m.role === 'user' ? styles.userMessage : styles.assistantMessage
            ]}>
              <View style={[
                styles.messageBubble,
                m.role === 'user' ? styles.userBubble : styles.assistantBubble
              ]}>
                {
                  // If this is a property search result system message, parse and render cards
                  m.role === 'system' &&
                    m.content.startsWith('PROPERTY SEARCH RESULTS:') ? (() => {
                      // Extract property lines
                      const lines = m.content.split('\n').filter(line => line.startsWith('- '));
                      const properties = lines.map(line => {
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
                      }).filter((p): p is any => !!p);
                      return (
                        <View key={m.id || m.content} style={styles.propertyCardsContainer}>
                          {properties.map((property, idx) => (
                            <PropertyCard
                              key={property._id || property.id || idx}
                              property={property}
                              variant={"featured"}
                              onPress={() => router.push(`/properties/${property._id || property.id}`)}
                            />
                          ))}
                        </View>
                      );
                    })() : (
                    <View style={{ flex: 1, minWidth: 0, alignSelf: 'stretch' }}>
                      {m.role === 'user' ? (
                        <Text style={[styles.messageText, styles.userText]}>{m.content}</Text>
                      ) : (
                        <Markdown
                          key={m.id}
                          style={{
                            body: bubbleTextStyle,
                            paragraph: bubbleTextStyle,
                            heading1: bubbleTextStyle,
                            heading2: bubbleTextStyle,
                            heading3: bubbleTextStyle,
                            heading4: bubbleTextStyle,
                            heading5: bubbleTextStyle,
                            heading6: bubbleTextStyle,
                            code_block: bubbleViewStyle,
                            code_inline: bubbleTextStyle,
                            blockquote: bubbleViewStyle,
                            table: bubbleViewStyle,
                            thead: bubbleViewStyle,
                            tbody: bubbleViewStyle,
                            th: bubbleViewStyle,
                            tr: bubbleViewStyle,
                            td: bubbleViewStyle,
                            list_item: bubbleListStyle,
                            bullet_list: bubbleListStyle,
                            ordered_list: bubbleListStyle,
                            strong: styles.markdownBold,
                            em: styles.markdownItalic,
                          }}
                        >
                          {m.content}
                        </Markdown>
                      )}
                    </View>
                  )
                }
              </View>
              <Text style={styles.messageTime}>
                {m.role === 'user' ? t('sindi.chat.you') : t('sindi.name')} • {new Date().toLocaleTimeString()}
              </Text>
            </View>
          ))
        )}
      </ScrollView>

      {/* Sticky Input */}
      <BlurView intensity={40} style={[styles.stickyInput, webStyles.stickyInput]}>
        <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255,255,255,0.5)' }} pointerEvents="none" />
        <View style={styles.inputContainer}>
          <View style={styles.inputWrapper}>
            <TextInput
              style={styles.textInput}
              placeholder={t('sindi.chat.placeholder')}
              value={input}
              onChangeText={(text) => handleInputChange({
                target: { value: text }
              } as any)}
              onSubmitEditing={() => handleSubmit()}
              multiline
              maxLength={1000}
            />
            <TouchableOpacity
              style={[styles.sendButton, !input.trim() && styles.sendButtonDisabled]}
              onPress={() => handleSubmit()}
              disabled={!input.trim() || isLoading}
            >
              <Ionicons
                name={isLoading ? "hourglass" : "send"}
                size={20}
                color={input.trim() ? "white" : "#ccc"}
              />
            </TouchableOpacity>
          </View>
          <Text style={styles.disclaimer}>
            {t('sindi.chat.disclaimer')}
          </Text>
        </View>
      </BlurView>
    </SafeAreaView >
  );
}