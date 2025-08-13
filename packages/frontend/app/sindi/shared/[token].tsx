import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { generateAPIUrl } from '@/utils/generateAPIUrl';
import { fetch as expoFetch } from 'expo/fetch';
import { colors } from '@/styles/colors';
import { SindiIcon } from '@/assets/icons';
import { Header } from '@/components/Header';
import { useTranslation } from 'react-i18next';

const IconComponent = Ionicons as any;

interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

interface SharedConversation {
  _id: string;
  title: string;
  messages: ConversationMessage[];
  createdAt: Date;
  updatedAt: Date;
}

export default function SharedConversationView() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { t } = useTranslation();
  const [conversation, setConversation] = useState<SharedConversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadSharedConversation = async () => {
      if (!token) return;

      try {
        setLoading(true);
        const response = await expoFetch(generateAPIUrl(`/api/ai/shared/${token}`));

        if (response.ok) {
          const data = await response.json();
          if (data.success && data.conversation) {
            setConversation(data.conversation);
          } else {
            setError(t('sindi.shared.error.notFound'));
          }
        } else if (response.status === 404) {
          setError(t('sindi.shared.error.notFound'));
        } else {
          setError(t('sindi.shared.error.failed'));
        }
      } catch (err) {
        console.error('Failed to load shared conversation:', err);
        setError(t('sindi.shared.error.failed'));
      } finally {
        setLoading(false);
      }
    };

    loadSharedConversation();
  }, [token, t]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <Header
          options={{
            title: t('sindi.shared.loading'),
            showBackButton: true,
          }}
        />
        <View style={styles.loadingContainer}>
          <IconComponent name="hourglass" size={48} color={colors.primaryColor} />
          <Text style={styles.loadingText}>{t('sindi.shared.loadingMessage')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <Header
          options={{
            title: t('sindi.shared.error.title'),
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
            <Text style={styles.errorText}>{error}</Text>
            <Text style={styles.errorSubtext}>{t('sindi.shared.error.description')}</Text>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  if (!conversation) {
    return (
      <SafeAreaView style={styles.container}>
        <Header
          options={{
            title: t('sindi.shared.error.title'),
            showBackButton: true,
          }}
        />
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{t('sindi.shared.error.notFound')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Web-specific styles for sticky positioning
  const webStyles =
    Platform.OS === 'web'
      ? {
          container: { height: '100vh', display: 'flex', flexDirection: 'column' } as any,
          messagesContainer: { flex: 1, overflow: 'auto' } as any,
        }
      : {};

  return (
    <SafeAreaView style={[styles.container, webStyles.container]}>
      {/* Header */}
      <Header
        options={{
          title: conversation.title,
          subtitle: t('sindi.shared.subtitle'),
          showBackButton: true,
        }}
      />

      {/* Shared Badge */}
      <View style={styles.sharedBadgeContainer}>
        <LinearGradient
          colors={[colors.primaryColor, colors.secondaryLight]}
          style={styles.sharedBadge}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          <IconComponent name="share-outline" size={16} color="white" />
          <Text style={styles.sharedBadgeText}>{t('sindi.shared.badge')}</Text>
        </LinearGradient>
      </View>

      {/* Messages */}
      <ScrollView
        style={[styles.messagesContainer, webStyles.messagesContainer]}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.messagesContent}
      >
        {conversation.messages.length === 0 ? (
          <View style={styles.emptyContainer}>
            <LinearGradient
              colors={[colors.primaryColor, colors.secondaryLight]}
              style={styles.emptyHeader}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <SindiIcon size={48} color="white" />
              <Text style={styles.emptyTitle}>{t('sindi.shared.empty.title')}</Text>
              <Text style={styles.emptySubtitle}>{t('sindi.shared.empty.subtitle')}</Text>
            </LinearGradient>
          </View>
        ) : (
          conversation.messages.map((m, index) => (
            <View
              key={index}
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
                <Text
                  style={[
                    styles.messageText,
                    m.role === 'user' ? styles.userText : styles.assistantText,
                  ]}
                >
                  {m.content}
                </Text>
              </View>
              <Text style={styles.messageTime}>
                {m.role === 'user' ? t('sindi.chat.you') : t('sindi.name')} •{' '}
                {new Date(m.timestamp).toLocaleString()}
              </Text>
            </View>
          ))
        )}
      </ScrollView>

      {/* Footer */}
      <View style={styles.footer}>
        <LinearGradient
          colors={[colors.primaryColor, colors.secondaryLight]}
          style={styles.footerGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          <Text style={styles.footerText}>{t('sindi.shared.footer')}</Text>
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
  sharedBadgeContainer: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  sharedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    alignSelf: 'center',
  },
  sharedBadgeText: {
    fontSize: 12,
    color: 'white',
    fontWeight: '500',
    marginLeft: 4,
  },
  messagesContainer: {
    flex: 1,
  },
  messagesContent: {
    paddingHorizontal: 16,
    paddingVertical: 20,
  },
  emptyContainer: {
    paddingVertical: 20,
  },
  emptyHeader: {
    alignItems: 'center',
    marginBottom: 30,
    padding: 24,
    borderRadius: 25,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK,
    marginHorizontal: 16,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
    marginTop: 16,
    marginBottom: 8,
    fontFamily: 'Phudu',
  },
  emptySubtitle: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.9)',
    textAlign: 'center',
    lineHeight: 24,
    paddingHorizontal: 20,
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
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  footerGradient: {
    padding: 12,
    borderRadius: 20,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 12,
    color: 'white',
    textAlign: 'center',
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
});
