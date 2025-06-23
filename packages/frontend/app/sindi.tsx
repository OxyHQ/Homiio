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

export default function sindi() {
  const { oxyServices, activeSessionId } = useOxy();
  const router = useRouter();

  // Check if user is authenticated
  if (!oxyServices || !activeSessionId) {
    return (
      <ThemedView style={styles.container} lightColor="transparent" darkColor="transparent">
        <Header options={{ title: 'Sindi', showBackButton: true }} />
        <View style={styles.authRequiredContainer}>
          <View style={styles.authRequiredContent}>
            <Text style={styles.authRequiredIcon}>🔒</Text>
            <ThemedText style={styles.authRequiredTitle}>Authentication Required</ThemedText>
            <ThemedText style={styles.authRequiredSubtitle}>
              Please sign in to access Sindi, your AI-powered housing justice advocate
            </ThemedText>
          </View>
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
    { title: 'Rent Gouging Check', icon: 'trending-up', prompt: 'My rent increased by [amount]%. Is this legal rent gouging? What can I do to fight unfair increases?' },
    { title: 'Illegal Eviction Defense', icon: 'warning', prompt: 'I received an eviction notice that seems illegal. Help me understand my rights and how to fight back.' },
    { title: 'Security Deposit Theft', icon: 'card', prompt: 'My landlord is keeping my security deposit without valid reasons. How do I recover my money?' },
    { title: 'Unsafe Living Conditions', icon: 'construct', prompt: 'My apartment has serious safety issues. What are my rights and how do I force repairs?' },
    { title: 'Discrimination Help', icon: 'shield-checkmark', prompt: 'I think I\'m being discriminated against by my landlord. What are my rights and how do I report this?' },
    { title: 'Retaliation Protection', icon: 'alert-circle', prompt: 'My landlord is retaliating because I complained. What protections do I have?' },
    { title: 'Lease Review', icon: 'document-text', prompt: 'Can you review my lease for unfair clauses and illegal terms I should challenge?' },
    { title: 'Tenant Organizing', icon: 'people', prompt: 'How can I organize with other tenants to fight for better conditions and fair treatment?' },
    { title: 'Current Laws & Updates', icon: 'globe', prompt: 'What are the current tenant rights laws and recent legal developments I should know about?' },
    { title: 'Catalunya Tenant Rights', icon: 'location', prompt: 'I\'m in Catalunya/Barcelona. What are my tenant rights and how can I connect with local tenant organizations like Sindicat de Llogateres?' },
  ];

  const propertySearchExamples = [
    { title: 'Cheap Apartments', icon: 'cash', prompt: 'Find me cheap apartments under $1000 in Barcelona' },
    { title: 'Pet-Friendly Homes', icon: 'paw', prompt: 'Show me pet-friendly apartments with parking under $1500' },
    { title: 'Furnished Studios', icon: 'bed', prompt: 'I need furnished studios with wifi under $1200' },
    { title: 'Family Homes', icon: 'home', prompt: 'Find 3-bedroom houses with garden under $2000' },
    { title: 'Luxury Properties', icon: 'diamond', prompt: 'Show me luxury apartments with gym and pool over $3000' },
    { title: 'Shared Housing', icon: 'people', prompt: 'Find shared rooms or coliving spaces under $800' },
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
        <Text style={styles.errorText}>Connection Error</Text>
        <Text style={styles.errorSubtext}>Please check your connection and try again.</Text>
      </View>
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
      {/* Sticky Header */}
      <View style={[styles.stickyHeader, webStyles.stickyHeader]}>
        <View style={styles.header}>
          <View style={styles.headerContent}>
            <View style={styles.avatarContainer}>
              <SindiIcon size={24} color="white" />
            </View>
            <View style={styles.headerText}>
              <Text style={styles.title}>Sindi</Text>
              <Text style={styles.subtitle}>Housing Justice Advocate with Real-Time Info</Text>
            </View>
          </View>
          <View style={styles.statusIndicator}>
            <View style={[styles.statusDot, { backgroundColor: isLoading ? '#FFD700' : '#4CAF50' }]} />
            <Text style={styles.statusText}>{isLoading ? 'Thinking...' : 'Online'}</Text>
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
              <SindiIcon size={48} color={colors.primaryColor} />
              <Text style={styles.welcomeTitle}>Welcome to Sindi</Text>
              <Text style={styles.welcomeSubtitle}>
                Your AI-powered housing justice advocate with real-time information access. I'm here to fight for your tenant rights,
                challenge unfair practices, and provide current legal updates. Together, we can build a more equitable housing system.
              </Text>
            </View>

            <View style={styles.quickActionsContainer}>
              <Text style={styles.quickActionsTitle}>Fight for Your Rights</Text>
              <View style={styles.quickActionsGrid}>
                {quickActions.map((action, index) => (
                  <TouchableOpacity
                    key={index}
                    style={styles.quickActionButton}
                    onPress={() => handleQuickAction(action.prompt)}
                  >
                    <Ionicons name={action.icon as any} size={20} color={colors.primaryColor} />
                    <Text style={styles.quickActionText}>{action.title}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.propertySearchContainer}>
              <Text style={styles.propertySearchTitle}>Find Ethical Housing</Text>
              <Text style={styles.propertySearchSubtitle}>
                I can search for properties with advanced filters. Try these examples:
              </Text>
              <View style={styles.propertySearchGrid}>
                {propertySearchExamples.map((example, index) => (
                  <TouchableOpacity
                    key={index}
                    style={styles.propertySearchButton}
                    onPress={() => handleQuickAction(example.prompt)}
                  >
                    <Ionicons name={example.icon as any} size={18} color={colors.primaryColor} />
                    <Text style={styles.propertySearchText}>{example.title}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.propertySearchNote}>
                💡 I understand natural language! Try: "cheap 2-bedroom apartments in Barcelona with parking" or "luxury studios with gym under $2000"
              </Text>
            </View>

            <View style={styles.featuresContainer}>
              <Text style={styles.featuresTitle}>How I fight for housing justice:</Text>
              <View style={styles.featureList}>
                <Text style={styles.featureItem}>• Challenge illegal rent increases and gouging</Text>
                <Text style={styles.featureItem}>• Defend against wrongful evictions</Text>
                <Text style={styles.featureItem}>• Fight security deposit theft and fraud</Text>
                <Text style={styles.featureItem}>• Demand safe, habitable living conditions</Text>
                <Text style={styles.featureItem}>• Combat housing discrimination</Text>
                <Text style={styles.featureItem}>• Protect against landlord retaliation</Text>
                <Text style={styles.featureItem}>• Expose unfair lease clauses</Text>
                <Text style={styles.featureItem}>• Support tenant organizing and solidarity</Text>
                <Text style={styles.featureItem}>• Provide current legal updates and recent developments</Text>
                <Text style={styles.featureItem}>• Connect you with local tenant organizations</Text>
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
                {m.role === 'user' ? 'You' : 'Sindi'} • {new Date().toLocaleTimeString()}
              </Text>
            </View>
          ))
        )}
      </ScrollView>

      {/* Sticky Input */}
      <View style={[styles.stickyInput, webStyles.stickyInput]}>
        <View style={styles.inputContainer}>
          <View style={styles.inputWrapper}>
            <TextInput
              style={styles.textInput}
              placeholder="Ask Sindi about your tenant rights..."
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
            Sindi advocates for tenant rights and housing justice. For legal action, consult a qualified attorney.
            Connect with local tenant organizations for community support.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  stickyHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#e9ecef',
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 15,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerContent: {
    flexDirection: 'row',
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
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  quickActionText: {
    fontSize: 14,
    fontWeight: '500',
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
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e9ecef',
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
    backgroundColor: 'white',
    padding: 20,
    borderRadius: 12,
    marginBottom: 20,
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
  inputContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: '#f8f9fa',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 8,
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
    backgroundColor: colors.primaryColor,
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
});