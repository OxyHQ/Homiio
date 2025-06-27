import { generateAPIUrl } from '@/utils/generateAPIUrl';
import { useChat } from '@ai-sdk/react';
import { fetch as expoFetch } from 'expo/fetch';
import { View, TextInput, ScrollView, Text, SafeAreaView, TouchableOpacity, StyleSheet, Platform } from 'react-native';
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

export default function sindi() {
  const { oxyServices, activeSessionId } = useOxy();
  const router = useRouter();
  const { t } = useTranslation();

  // Check if user is authenticated
  if (!oxyServices || !activeSessionId) {
    return (
      <ThemedView style={styles.container} lightColor="transparent" darkColor="transparent">
        <Header options={{ title: t('sindi.title'), showBackButton: true }} />
        <View style={styles.authRequiredContainer}>
          <LinearGradient
            colors={[colors.primaryColor, colors.secondaryLight]}
            style={styles.authRequiredCard}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <View style={styles.authRequiredContent}>
              <View style={styles.authRequiredIconContainer}>
                <Text style={styles.authRequiredIcon}>🔒</Text>
              </View>
              <Text style={styles.authRequiredTitle}>{t('sindi.auth.required')}</Text>
              <Text style={styles.authRequiredSubtitle}>
                {t('sindi.auth.message')}
              </Text>
            </View>
          </LinearGradient>
        </View>
      </ThemedView>
    );
  }

  // Create a custom fetch function that includes authentication
  const authenticatedFetch = async (url: string, options: RequestInit = {}) => {
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
      <LinearGradient
        colors={[colors.primaryColor, colors.secondaryLight]}
        style={styles.errorContainer}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <View style={styles.errorContent}>
          <Ionicons name="alert-circle" size={48} color="white" />
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
        {messages.length === 0 ? (
          <View style={styles.welcomeContainer}>
            <LinearGradient
              colors={[colors.primaryColor, colors.secondaryLight]}
              style={styles.welcomeHeader}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <SindiIcon size={48} color="white" />
              <Text style={styles.welcomeTitle}>{t('sindi.welcome.title')}</Text>
              <Text style={styles.welcomeSubtitle}>
                {t('sindi.welcome.subtitle')}
              </Text>
            </LinearGradient>

            <View style={styles.quickActionsContainer}>
              <Text style={styles.quickActionsTitle}>{t('sindi.actions.title')}</Text>
              <View style={styles.quickActionsGrid}>
                {quickActions.map((action, index) => (
                  <TouchableOpacity
                    key={index}
                    style={styles.quickActionButton}
                    onPress={() => handleQuickAction(action.prompt)}
                  >
                    <LinearGradient
                      colors={[colors.primaryColor, colors.secondaryLight]}
                      style={styles.quickActionGradient}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                    >
                      <Ionicons name={action.icon as any} size={20} color="white" />
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
                    onPress={() => handleQuickAction(example.prompt)}
                  >
                    <LinearGradient
                      colors={[colors.primaryColor, colors.secondaryLight]}
                      style={styles.propertySearchGradient}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                    >
                      <Ionicons name={example.icon as any} size={18} color="white" />
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
                    <View style={{ flexShrink: 1, flexWrap: 'wrap', width: '100%' }}>
                      <Markdown
                        key={m.id}
                        style={{
                          body: {
                            ...styles.markdownParagraph,
                            color: m.role === 'user' ? 'white' : '#2c3e50',
                            flexWrap: 'wrap',
                            flexShrink: 1,
                            width: '100%',
                          },
                          heading1: styles.markdownH1,
                          heading2: styles.markdownH2,
                          heading3: styles.markdownH3,
                          strong: styles.markdownBold,
                          em: styles.markdownItalic,
                          bullet_list: styles.markdownListItem,
                          ordered_list: styles.markdownListItem,
                          code_block: styles.markdownCodeBlock,
                          code_inline: styles.markdownInlineCode,
                        }}
                      >
                        {m.content}
                      </Markdown>
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
      <View style={[styles.stickyInput, webStyles.stickyInput]}>
        <LinearGradient
          colors={[colors.primaryColor, colors.secondaryLight]}
          style={styles.inputGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          <View style={styles.inputContainer}>
            <View style={styles.inputWrapper}>
              <TextInput
                style={styles.textInput}
                placeholder={t('sindi.chat.placeholder')}
                placeholderTextColor="rgba(255, 255, 255, 0.6)"
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
                  color={input.trim() ? "white" : "rgba(255, 255, 255, 0.4)"}
                />
              </TouchableOpacity>
            </View>
            <Text style={styles.disclaimer}>
              {t('sindi.chat.disclaimer')}
            </Text>
          </View>
        </LinearGradient>
      </View>
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
    padding: 24,
    borderRadius: 25,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK,
    marginHorizontal: 16,
  },
  welcomeTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
    marginTop: 16,
    marginBottom: 8,
    fontFamily: 'Phudu',
  },
  welcomeSubtitle: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.9)',
    textAlign: 'center',
    lineHeight: 24,
    paddingHorizontal: 20,
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
    borderRadius: 25,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK,
    overflow: 'hidden',
  },
  quickActionGradient: {
    padding: 16,
    alignItems: 'center',
  },
  quickActionText: {
    fontSize: 14,
    fontWeight: '500',
    color: 'white',
    marginTop: 8,
    textAlign: 'center',
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
    borderRadius: 25,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK,
    overflow: 'hidden',
  },
  propertySearchGradient: {
    padding: 16,
    alignItems: 'center',
  },
  propertySearchText: {
    fontSize: 14,
    fontWeight: '500',
    color: 'white',
    marginTop: 8,
    textAlign: 'center',
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
  authRequiredCard: {
    padding: 24,
    borderRadius: 25,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK,
    backgroundColor: 'white',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  authRequiredContent: {
    alignItems: 'center',
  },
  authRequiredIconContainer: {
    marginBottom: 16,
  },
  authRequiredIcon: {
    fontSize: 48,
  },
  authRequiredTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
    fontFamily: 'Phudu',
    color: colors.COLOR_BLACK,
  },
  authRequiredSubtitle: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
    textAlign: 'center',
  },
});