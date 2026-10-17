/**
 * Sindi conversation index — Sindi's conversations (Alia's, listed with
 * `useConversations({ agentId })`) and the start-a-new-chat affordance, which
 * opens `/sindi/new`: the conversation is made by its first turn.
 *
 * Bloom throughout: `Card` surfaces, Remix glyphs, `Button`, `Search`,
 * `Item` conversation rows (`ConversationList`) and `Skeleton` rows while the
 * list loads; the shared `EmptyState` covers the signed-out and empty cases.
 */
import type React from 'react';
import { useCallback, useContext, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AppShellMenuButton } from '@oxy.so/bloom/app-shell';
import { Button } from '@oxy.so/bloom/button';
import { PageHeader } from '@oxy.so/bloom/page-header';
import { Screen, ScreenScrollView } from '@oxy.so/bloom/screen';
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
import { useConversations } from '@alia.onl/sdk';
import { useAuth, openAccountDialog } from '@oxy.so/services';
import { SindiIcon } from '@/assets/icons';
import { EmptyState } from '@/components/ui/EmptyState';
import { SectionEyebrow } from '@/components/ui/SectionEyebrow';
import {
  ConversationItem,
  ConversationList,
  conversationsOf,
} from '@/components/sindi/ConversationItem';
import { NEW_SINDI_CONVERSATION, SINDI_AGENT_ID } from '@/components/sindi/sindiAgent';
import { BottomSheetContext } from '@/context/BottomSheetContext';
import { SindiExplanationBottomSheet } from '@/components/SindiExplanationBottomSheet';
import { spacing } from '@/constants/styles';

/** The three promises under the hero. */
const FEATURES = [
  { icon: RiShieldCheckLine, label: 'Know your rights' },
  { icon: RiFileTextLine, label: 'Legal guidance' },
  { icon: RiTeamLine, label: 'Community support' },
] as const;

const SindiSkeleton: React.FC = () => (
  <View style={styles.skeletonList}>
    {Array.from({ length: 4 }).map((_, idx) => (
      <Card key={idx} style={styles.skeletonRow} appearance="outline">
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
  const { canUsePrivateApi } = useAuth();
  const router = useRouter();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const conversations = useConversations({ agentId: SINDI_AGENT_ID });
  const [searchQuery, setSearchQuery] = useState('');
  const bottomSheetContext = useContext(BottomSheetContext);

  const isAuthenticated = canUsePrivateApi;

  const createNewConversation = useCallback(() => {
    if (!isAuthenticated) return;
    router.push(`/sindi/${NEW_SINDI_CONVERSATION}`);
  }, [isAuthenticated, router]);

  const sortedConversations = useMemo(() => {
    const all = conversationsOf(conversations.data);
    const q = searchQuery.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (c) => c.title.toLowerCase().includes(q) || (c.lastMessage ?? '').toLowerCase().includes(q),
    );
  }, [conversations.data, searchQuery]);

  if (!isAuthenticated) {
    return (
      <Screen
        documentScroll
        header={
          <PageHeader
            title={t('sindi.title')}
            titleAlign="center"
            leading={<AppShellMenuButton accessibilityLabel={t('sidebar.open')} />}
            onBack={router.canGoBack() ? router.back : undefined}
            backLabel={t('goBack')}
          />
        }
      >
        <ScreenScrollView>
          <EmptyState
            icon={RiLockLine}
            title={t('sindi.auth.required')}
            description={t('sindi.auth.message')}
            actionText={t('common.signIn')}
            actionIcon={RiLoginBoxLine}
            onAction={() => openAccountDialog()}
            iconColor={colors.primarySubtleForeground}
          />
        </ScreenScrollView>
      </Screen>
    );
  }

  return (
    <Screen
      documentScroll
      header={
        <PageHeader
          title={t('sindi.title')}
          subtitle={t('sindi.subtitle')}
          titleAlign="center"
          leading={<AppShellMenuButton accessibilityLabel={t('sidebar.open')} />}
          onBack={router.canGoBack() ? router.back : undefined}
          backLabel={t('goBack')}
        />
      }
    >
      <ScreenScrollView contentContainerStyle={styles.content}>
        <Card radius="radius-24" style={styles.heroCard} appearance="outline">
          <SindiIcon size={56} color={colors.primary} />
          <SectionEyebrow>Meet Sindi</SectionEyebrow>
          <H1 style={styles.center}>{t('sindi.title')}</H1>
          <Text
            variant="body-regular"
            style={[styles.heroDescription, { color: colors.textSecondary }]}
          >
            Your AI-powered housing rights assistant. Get instant help with tenant issues,
            understand your rights, and navigate housing challenges with confidence.
          </Text>
          <Button
            size="md"
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
            tone="neutral"
            appearance="outline"
          >
            Learn how it works
          </Button>
        </Card>

        <View style={styles.featuresRow}>
          {FEATURES.map(({ icon: Icon, label }) => (
            <Card key={label} style={styles.featureCell} appearance="outline">
              <Icon width={20} height={20} fill={colors.primary} />
              <Text variant="body-2-medium" style={[styles.center, { color: colors.text }]}>
                {label}
              </Text>
            </Card>
          ))}
        </View>

        <Button
          size="lg"
          onPress={createNewConversation}
          leadingIcon={RiAddLine}
          fullWidth
          tone="accent"
          appearance="solid"
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

          {conversations.isLoading ? (
            <SindiSkeleton />
          ) : sortedConversations.length === 0 ? (
            <EmptyState
              icon={RiDiscussLine}
              title={searchQuery ? 'No matches' : 'No conversations yet'}
              description={
                searchQuery ? 'Try a different keyword.' : 'Start a new conversation to get help.'
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
      </ScreenScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
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
