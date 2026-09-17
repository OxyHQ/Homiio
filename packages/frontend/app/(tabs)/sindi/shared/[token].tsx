import React, { useState, useEffect } from 'react';
import { View, ScrollView, StyleSheet, Platform, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { fetch as expoFetch } from 'expo/fetch';
import { useTranslation } from 'react-i18next';
import {
  AdmonitionContent,
  AdmonitionIcon,
  AdmonitionRoot,
  AdmonitionRow,
  AdmonitionText,
} from '@oxy.so/bloom/admonition';
import { Chip } from '@oxy.so/bloom/chip';
import { RiShare2Line } from '@oxy.so/bloom/icons';
import { Loading } from '@oxy.so/bloom/loading';
import { useTheme } from '@oxy.so/bloom/theme';
import { Text } from '@oxy.so/bloom/typography';
import { deviceTimeZone, formatDate } from '@homiio/shared-types';
import { API_URL } from '@/config';
import { SindiIcon } from '@/assets/icons';
import { Header } from '@/components/Header';
import { ChatMessage } from '@/components/sindi/ChatMessage';
import { logger } from '@/utils/logger';
import { useFormatting } from '@/utils/format';

interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

interface SharedConversation {
  id: string;
  title: string;
  messages: ConversationMessage[];
  createdAt: Date;
  updatedAt: Date;
}

interface SharedConversationResponse {
  success: boolean;
  conversation?: SharedConversation;
}

/**
 * Web shell: a viewport-tall column whose transcript scrolls inside it.
 * Viewport units are valid on react-native-web but absent from RN's types.
 */
const webContainer: ViewStyle | undefined =
  Platform.OS === 'web'
    ? {
        height: '100vh' as unknown as ViewStyle['height'],
        display: 'flex',
        flexDirection: 'column',
      }
    : undefined;

/**
 * A read-only shared Sindi transcript (`/sindi/shared/<token>`), drawn with the
 * same Bloom ai-chat turns as the live chat, each turn settled and footnoted
 * with its real timestamp.
 */
export default function SharedConversationView() {
  const { locale } = useFormatting();
  const { colors } = useTheme();
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
        const response = await expoFetch(`${API_URL}/api/ai/shared/${token}`);

        if (response.ok) {
          const data: SharedConversationResponse = await response.json();
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
      } catch (err: unknown) {
        logger.error('Failed to load shared conversation:', err);
        setError(t('sindi.shared.error.failed'));
      } finally {
        setLoading(false);
      }
    };

    loadSharedConversation();
  }, [token, t]);

  const containerStyle = [styles.container, { backgroundColor: colors.background }, webContainer];

  if (loading) {
    return (
      <SafeAreaView style={containerStyle} edges={['bottom']}>
        <Header options={{ title: t('sindi.shared.loading'), showBackButton: true }} />
        <Loading size="large" text={t('sindi.shared.loadingMessage')} style={styles.fill} />
      </SafeAreaView>
    );
  }

  if (error || !conversation) {
    return (
      <SafeAreaView style={containerStyle} edges={['bottom']}>
        <Header options={{ title: t('sindi.shared.error.title'), showBackButton: true }} />
        <AdmonitionRoot type="error" style={styles.callout}>
          <AdmonitionRow>
            <AdmonitionIcon />
            <AdmonitionContent>
              <AdmonitionText style={styles.calloutTitle}>
                {error ?? t('sindi.shared.error.notFound')}
              </AdmonitionText>
              <AdmonitionText>{t('sindi.shared.error.description')}</AdmonitionText>
            </AdmonitionContent>
          </AdmonitionRow>
        </AdmonitionRoot>
      </SafeAreaView>
    );
  }

  const lastIndex = conversation.messages.length - 1;

  return (
    <SafeAreaView style={containerStyle} edges={['bottom']}>
      <Header
        options={{
          title: conversation.title,
          subtitle: t('sindi.shared.subtitle'),
          showBackButton: true,
        }}
      />

      <View style={styles.badge}>
        <Chip
          size="small"
          startIcon={<RiShare2Line width={14} height={14} fill={colors.textSecondary} />}
        >
          {t('sindi.shared.badge')}
        </Chip>
      </View>

      <ScrollView
        style={styles.fill}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.thread}
      >
        {conversation.messages.length === 0 ? (
          <View style={styles.empty}>
            <SindiIcon size={48} color={colors.primary} />
            <Text variant="title-2-medium" style={[styles.center, { color: colors.text }]}>
              {t('sindi.shared.empty.title')}
            </Text>
            <Text variant="body-regular" style={[styles.center, { color: colors.textSecondary }]}>
              {t('sindi.shared.empty.subtitle')}
            </Text>
          </View>
        ) : (
          conversation.messages.map((m, index) => (
            <ChatMessage
              key={m.id ?? index}
              message={{ id: m.id ?? String(index), role: m.role, content: m.content }}
              isLast={index === lastIndex}
              isLoading={false}
              footnote={`${m.role === 'user' ? t('sindi.chat.you') : t('sindi.name')} • ${formatDate(
                m.timestamp,
                locale,
                deviceTimeZone(),
                { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' },
              )}`}
            />
          ))
        )}
      </ScrollView>

      <Text
        variant="caption-1-regular"
        style={[styles.center, styles.footer, { color: colors.textTertiary }]}
      >
        {t('sindi.shared.footer')}
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  fill: {
    flex: 1,
  },
  callout: {
    margin: 16,
  },
  calloutTitle: {
    fontWeight: '600',
  },
  badge: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  thread: {
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  empty: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 32,
  },
  center: {
    textAlign: 'center',
  },
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
});
