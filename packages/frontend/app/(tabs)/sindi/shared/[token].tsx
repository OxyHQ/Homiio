import { useState, useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { fetch as expoFetch } from 'expo/fetch';
import { useTranslation } from 'react-i18next';
import {
  AdmonitionContent,
  AdmonitionIcon,
  AdmonitionRoot,
  AdmonitionRow,
  AdmonitionText,
} from '@oxy.so/bloom/admonition';
import { AppShellMenuButton } from '@oxy.so/bloom/app-shell';
import { Chip } from '@oxy.so/bloom/chip';
import { RiShare2Line } from '@oxy.so/bloom/icons';
import { Loading } from '@oxy.so/bloom/loading';
import { PageHeader } from '@oxy.so/bloom/page-header';
import { useTheme } from '@oxy.so/bloom/theme';
import { Text } from '@oxy.so/bloom/typography';
import { deviceTimeZone, formatDate } from '@homiio/shared-types';
import { API_URL } from '@/config';
import { SindiIcon } from '@/assets/icons';
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
 * A read-only shared Sindi transcript (`/sindi/shared/<token>`), drawn with the
 * same Bloom ai-chat turns as the live chat, each turn settled and footnoted
 * with its real timestamp.
 */
export default function SharedConversationView() {
  const { locale } = useFormatting();
  const { colors } = useTheme();
  const { token } = useLocalSearchParams<{ token: string }>();
  const { t } = useTranslation();
  const router = useRouter();
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

  if (loading) {
    return (
      <>
        <PageHeader
          title={t('sindi.shared.loading')}
          titleAlign="center"
          leading={<AppShellMenuButton accessibilityLabel={t('sidebar.open')} />}
          onBack={router.canGoBack() ? router.back : undefined}
          backLabel={t('goBack')}
        />
        <Loading size="lg" text={t('sindi.shared.loadingMessage')} style={styles.fill} />
      </>
    );
  }

  if (error || !conversation) {
    return (
      <>
        <PageHeader
          title={t('sindi.shared.error.title')}
          titleAlign="center"
          leading={<AppShellMenuButton accessibilityLabel={t('sidebar.open')} />}
          onBack={router.canGoBack() ? router.back : undefined}
          backLabel={t('goBack')}
        />
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
      </>
    );
  }

  const lastIndex = conversation.messages.length - 1;

  return (
    <>
      <PageHeader
        title={conversation.title}
        subtitle={t('sindi.shared.subtitle')}
        titleAlign="center"
        leading={<AppShellMenuButton accessibilityLabel={t('sidebar.open')} />}
        onBack={router.canGoBack() ? router.back : undefined}
        backLabel={t('goBack')}
      />

      <View style={styles.badge}>
        <Chip
          size="sm"
          startIcon={<RiShare2Line width={14} height={14} fill={colors.textSecondary} />}
        >
          {t('sindi.shared.badge')}
        </Chip>
      </View>

      <View style={styles.thread}>
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
                {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                },
              )}`}
            />
          ))
        )}
      </View>

      <Text
        variant="caption-1-regular"
        style={[styles.center, styles.footer, { color: colors.textTertiary }]}
      >
        {t('sindi.shared.footer')}
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
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
