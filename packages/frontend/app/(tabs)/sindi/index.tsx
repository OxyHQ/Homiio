/**
 * Sindi conversation index — chat sidebar with conversation history + start
 * new chat affordance.
 *
 * Bloom throughout: `Card` surfaces, Remix glyphs, `Button`, `Search`,
 * `Item` conversation rows (`ConversationList`) and `Skeleton` rows while the
 * list loads; the shared `EmptyState` covers the signed-out and empty cases.
 */
import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@oxy.so/bloom/button';
import { Search } from '@oxy.so/bloom/search';
import * as Skeleton from '@oxy.so/bloom/skeleton';
import { Card } from '@oxy.so/bloom/card';
import {
  RiAddCircleLine,
  RiAddLine,
  RiDiscussLine,
  RiFileTextLine,
  RiLockLine,
  RiLoginBoxLine,
  RiShieldCheckLine,
  RiTeamLine,
} from '@oxy.so/bloom/icons';
import { useTheme } from '@oxy.so/bloom/theme';
import { H1, H3, Text } from '@oxy.so/bloom/typography';
import { useOxy, openAccountDialog } from '@oxy.so/services';
import { SindiIcon } from '@/assets/icons';
import { Header } from '@/components/Header';
import { EmptyState } from '@/components/ui/EmptyState';
import { SectionEyebrow } from '@/components/ui/SectionEyebrow';
import { ConversationItem, ConversationList } from '@/components/sindi/ConversationItem';
import { useSindiAuthenticatedFetch } from '@/hooks/useSindiAuthenticatedFetch';
import { BottomSheetContext } from '@/context/BottomSheetContext';
import { SindiExplanationBottomSheet } from '@/components/SindiExplanationBottomSheet';
import { useConversationStore } from '@/store/conversationStore';
import { spacing } from '@/constants/styles';
import { colors as staticColors } from '@/styles/colors';

/** The three promises under the hero. */
const FEATURES = [
  { icon: RiShieldCheckLine, label: 'Know your rights' },
  { icon: RiFileTextLine, label: 'Legal guidance' },
  { icon: RiTeamLine, label: 'Community support' },
] as const;

const SindiSkeleton: React.FC = () => (
  <View style={styles.skeletonList}>
    {Array.from({ length: 4 }).map((_, idx) => (
      <Card key={idx} variant="outlined" style={styles.skeletonRow}>
        <Skeleton.Circle size={36} />
        <View style={styles.skeletonBody}>
          <Skeleton.Text style={{ width: 180, lineHeight: 16 }} />
          <Skeleton.Text style={{ width: 240, lineHeight: 13 }} />
        </View>
      </Card>
    ))}
  </View>
);

export default function Sindi() {
  const { oxyServices, activeSessionId } = useOxy();
  const router = useRouter();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const {
    conversations,
    loading,
    loadConversations,
    createConversation,
  } = useConversationStore();
  const [searchQuery, setSearchQuery] = useState('');
  const bottomSheetContext = useContext(BottomSheetContext);

  const isAuthenticated = useMemo(
    () => Boolean(oxyServices) && Boolean(activeSessionId),
    [oxyServices, activeSessionId],
  );

  // Shared authenticated fetch (single source of truth across every Sindi
  // surface — web-vs-native split + FormData handling live in the hook).
  const conversationFetch = useSindiAuthenticatedFetch();

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
    } catch {
      const conversationId = `conv_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`;
      router.push(`/sindi/${conversationId}`);
    }
  }, [
    isAuthenticated,
    conversationFetch,
    router,
    createConversation,
    loadConversations,
  ]);

  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const q = searchQuery.toLowerCase();
    return conversations.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        (c.messages[c.messages.length - 1]?.content || '')
          .toLowerCase()
          .includes(q),
    );
  }, [conversations, searchQuery]);

  const sortedConversations = useMemo(
    () =>
      [...filteredConversations].sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      ),
    [filteredConversations],
  );

  useEffect(() => {
    if (isAuthenticated) {
      loadConversations(conversationFetch);
    }
  }, [isAuthenticated, loadConversations, conversationFetch]);

  // Web container CSS uses viewport units that RN's StyleSheet types reject
  // outright. Casting to ViewStyle here is the standard escape hatch for
  // platform-specific web overrides used elsewhere in the app.
  const webContainerStyle =
    Platform.OS === 'web'
      ? ({
          height: '100vh' as unknown as number,
          display: 'flex' as const,
          flexDirection: 'column' as const,
        })
      : undefined;

  if (!isAuthenticated) {
    return (
      <View style={styles.root}>
        <Header
          options={{ title: t('sindi.title'), showBackButton: true }}
        />
        <EmptyState
          icon={RiLockLine}
          title={t('sindi.auth.required')}
          description={t('sindi.auth.message')}
          actionText={t('common.signIn')}
          actionIcon={RiLoginBoxLine}
          onAction={() => openAccountDialog()}
          iconColor={staticColors.primaryColor}
        />
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.root, webContainerStyle]} edges={['bottom']}>
      <Header
        options={{
          title: t('sindi.title'),
          subtitle: t('sindi.subtitle'),
          showBackButton: true,
        }}
      />

      <ScrollView contentContainerStyle={styles.content}>
        <Card variant="outlined" radius="radius-24" style={styles.heroCard}>
          <SindiIcon size={56} color={colors.primary} />
          <SectionEyebrow>Meet Sindi</SectionEyebrow>
          <H1 style={styles.center}>{t('sindi.title')}</H1>
          <Text variant="body-regular" style={[styles.heroDescription, { color: colors.textSecondary }]}>
            Your AI-powered housing rights assistant. Get instant help with
            tenant issues, understand your rights, and navigate housing
            challenges with confidence.
          </Text>
          <Button
            variant="secondary"
            size="medium"
            onPress={() => {
              if (bottomSheetContext) {
                bottomSheetContext.openBottomSheet(
                  <SindiExplanationBottomSheet
                    onClose={() => bottomSheetContext.closeBottomSheet()}
                  />,
                  { hideHandle: true },
                );
              }
            }}
            accessibilityLabel="Learn how Sindi works"
          >
            Learn how it works
          </Button>
        </Card>

        <View style={styles.featuresRow}>
          {FEATURES.map(({ icon: Icon, label }) => (
            <Card key={label} variant="outlined" style={styles.featureCell}>
              <Icon width={20} height={20} fill={colors.primary} />
              <Text variant="body-2-medium" style={[styles.center, { color: colors.text }]}>
                {label}
              </Text>
            </Card>
          ))}
        </View>

        <Button
          variant="primary"
          size="large"
          onPress={createNewConversation}
          leadingIcon={RiAddLine}
          fullWidth
        >
          Start new conversation
        </Button>

        <View style={styles.historyBlock}>
          <H3>Chats</H3>
          <Search
            value={searchQuery}
            onChangeText={setSearchQuery}
            onClearText={() => setSearchQuery('')}
            label="Search conversations"
          />

          {loading ? (
            <SindiSkeleton />
          ) : filteredConversations.length === 0 ? (
            <EmptyState
              icon={RiDiscussLine}
              title={searchQuery ? 'No matches' : 'No conversations yet'}
              description={
                searchQuery
                  ? 'Try a different keyword.'
                  : 'Start a new conversation to get help.'
              }
              actionText={searchQuery ? undefined : 'Start first chat'}
              actionIcon={searchQuery ? undefined : RiAddCircleLine}
              onAction={searchQuery ? undefined : createNewConversation}
            />
          ) : (
            <ConversationList>
              {sortedConversations.map((conversation) => (
                <ConversationItem
                  key={conversation.id}
                  conversation={conversation}
                  onPress={() => router.push(`/sindi/${conversation.id}`)}
                />
              ))}
            </ConversationList>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: staticColors.background,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing['4xl'],
  },
  heroCard: {
    padding: spacing['2xl'],
    alignItems: 'center',
    gap: spacing.sm,
  },
  center: {
    textAlign: 'center',
  },
  heroDescription: {
    textAlign: 'center',
    maxWidth: 420,
    marginBottom: spacing.sm,
  },
  featuresRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  featureCell: {
    flex: 1,
    padding: spacing.md,
    alignItems: 'center',
    gap: spacing.xs,
  },
  historyBlock: {
    gap: spacing.md,
  },
  skeletonList: {
    gap: spacing.md,
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  skeletonBody: {
    flex: 1,
    gap: spacing.sm,
  },
});
