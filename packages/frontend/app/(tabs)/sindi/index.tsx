/**
 * Sindi conversation index — chat sidebar with conversation history + start
 * new chat affordance.
 *
 * Stream Q polish:
 *   - Bloom Typography (H1/H2/H3/Text) everywhere, no raw <Text>.
 *   - Bloom Button replaces every TouchableOpacity CTA.
 *   - Bloom SearchInput replaces hand-rolled search bar.
 *   - withShadow('sm') cards with radius.lg, no borders, semantic tokens.
 *   - Skeleton.Box rows during load; EmptyState shared.
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
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@oxyhq/bloom/button';
import { SearchInput } from '@oxyhq/bloom/search-input';
import * as Skeleton from '@oxyhq/bloom/skeleton';
import { H1, H3, Text as BloomText } from '@oxyhq/bloom/typography';
import { useOxy, showSignInModal } from '@oxyhq/services';
import { SindiIcon } from '@/assets/icons';
import { Header } from '@/components/Header';
import { EmptyState } from '@/components/ui/EmptyState';
import { SectionEyebrow } from '@/components/ui/SectionEyebrow';
import {
  ConversationItem,
  conversationListStyles,
} from '@/components/sindi/ConversationItem';
import { useSindiAuthenticatedFetch } from '@/hooks/useSindiAuthenticatedFetch';
import { BottomSheetContext } from '@/context/BottomSheetContext';
import { SindiExplanationBottomSheet } from '@/components/SindiExplanationBottomSheet';
import { useConversationStore } from '@/store/conversationStore';
import { radius, spacing, withShadow } from '@/constants/styles';
import { colors } from '@/styles/colors';

const SindiSkeleton: React.FC = () => (
  <View style={styles.skeletonList}>
    {Array.from({ length: 4 }).map((_, idx) => (
      <View key={idx} style={styles.skeletonRow}>
        <Skeleton.Circle size={36} />
        <View style={styles.skeletonBody}>
          <Skeleton.Text style={{ width: 180, lineHeight: 16 }} />
          <Skeleton.Text style={{ width: 240, lineHeight: 13 }} />
        </View>
      </View>
    ))}
  </View>
);

export default function Sindi() {
  const { oxyServices, activeSessionId } = useOxy();
  const router = useRouter();
  const { t } = useTranslation();
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
          icon="lock-closed"
          title={t('sindi.auth.required')}
          description={t('sindi.auth.message')}
          actionText={t('Sign in')}
          actionIcon="log-in"
          onAction={() => showSignInModal()}
          iconColor={colors.primaryColor}
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
        <View style={styles.heroCard}>
          <View style={styles.heroIcon}>
            <SindiIcon size={56} color={colors.primaryColor} />
          </View>
          <SectionEyebrow>Meet Sindi</SectionEyebrow>
          <H1 style={styles.heroTitle}>{t('sindi.title')}</H1>
          <BloomText style={styles.heroDescription}>
            Your AI-powered housing rights assistant. Get instant help with
            tenant issues, understand your rights, and navigate housing
            challenges with confidence.
          </BloomText>
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
        </View>

        <View style={styles.featuresRow}>
          <View style={styles.featureCell}>
            <Ionicons
              name="shield-checkmark"
              size={20}
              color={colors.primaryColor}
            />
            <BloomText style={styles.featureLabel}>Know your rights</BloomText>
          </View>
          <View style={styles.featureCell}>
            <Ionicons
              name="document-text"
              size={20}
              color={colors.primaryColor}
            />
            <BloomText style={styles.featureLabel}>Legal guidance</BloomText>
          </View>
          <View style={styles.featureCell}>
            <Ionicons name="people" size={20} color={colors.primaryColor} />
            <BloomText style={styles.featureLabel}>Community support</BloomText>
          </View>
        </View>

        <Button
          variant="primary"
          size="large"
          onPress={createNewConversation}
          icon={<Ionicons name="add" size={20} color={colors.primaryForeground} />}
          style={styles.newButton}
        >
          Start new conversation
        </Button>

        <View style={styles.historyBlock}>
          <H3 style={styles.historyTitle}>Chats</H3>
          <SearchInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            onClearText={() => setSearchQuery('')}
            label="Search conversations"
          />

          {loading ? (
            <SindiSkeleton />
          ) : filteredConversations.length === 0 ? (
            <EmptyState
              icon="chatbubbles-outline"
              title={searchQuery ? 'No matches' : 'No conversations yet'}
              description={
                searchQuery
                  ? 'Try a different keyword.'
                  : 'Start a new conversation to get help.'
              }
              actionText={searchQuery ? undefined : 'Start first chat'}
              actionIcon={searchQuery ? undefined : 'add-circle'}
              onAction={searchQuery ? undefined : createNewConversation}
            />
          ) : (
            <View style={conversationListStyles.list}>
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
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing['4xl'],
  },
  heroCard: {
    backgroundColor: colors.surfaceElevated,
    padding: spacing['2xl'],
    borderRadius: radius.xl,
    alignItems: 'center',
    gap: spacing.sm,
    ...withShadow('sm'),
  },
  heroIcon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.infoSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  heroTitle: {
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  heroDescription: {
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 420,
    marginBottom: spacing.sm,
  },
  featuresRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  featureCell: {
    flex: 1,
    backgroundColor: colors.surfaceElevated,
    padding: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    gap: spacing.xs,
    ...withShadow('sm'),
  },
  featureLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.COLOR_BLACK_LIGHT_2,
    textAlign: 'center',
  },
  newButton: {
    alignSelf: 'stretch',
  },
  historyBlock: {
    gap: spacing.md,
  },
  historyTitle: {
    letterSpacing: -0.3,
  },
  skeletonList: {
    gap: spacing.md,
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surfaceElevated,
    padding: spacing.lg,
    borderRadius: radius.lg,
    ...withShadow('sm'),
  },
  skeletonBody: {
    flex: 1,
    gap: spacing.sm,
  },
});
