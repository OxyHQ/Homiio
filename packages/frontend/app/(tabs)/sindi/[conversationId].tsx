/**
 * The full-screen conversation with Sindi (`/sindi/:id`, and `/sindi/new` for
 * one Alia has not made yet). The conversation is Alia's, drawn by the SDK
 * (`components/sindi/SindiConversation.tsx`); this route owns its address and
 * its header.
 *
 * The chat IS the screen here, so acting on the app means going to the
 * destination — "muéstrame pisos" has nowhere else to land. The executor holds
 * that navigation until the turn stops streaming, because this screen is inside
 * `<Slot/>` and navigating unmounts the chat mid-answer.
 *
 * Safe area: the app shell owns the insets; the header is Bloom's `PageHeader`
 * with the conversation's participants as its title (Alia ADR 0020 §7).
 */

import { AliaParticipants, type AliaChatState, useShareConversation } from '@alia.onl/sdk';
import { AppShellMenuButton } from '@oxy.so/bloom/app-shell';
import { Button } from '@oxy.so/bloom/button';
import { RiLockLine, RiLoginBoxLine, RiShare2Line } from '@oxy.so/bloom/icons';
import { PageHeader } from '@oxy.so/bloom/page-header';
import { Screen, ScreenScrollView } from '@oxy.so/bloom/screen';
import { useTheme } from '@oxy.so/bloom/theme';
import { toast } from '@oxy.so/bloom/toast';
import { openAccountDialog, useAuth } from '@oxy.so/services';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { SindiConversation } from '@/components/sindi/SindiConversation';
import { NEW_SINDI_CONVERSATION } from '@/components/sindi/sindiAgent';
import { EmptyState } from '@/components/ui/EmptyState';
import { shareSindiConversation } from '@/hooks/useSindiChat';

export default function ConversationDetail() {
  const { canUsePrivateApi } = useAuth();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const { share, isSharing } = useShareConversation();
  const { conversationId, message } = useLocalSearchParams<{
    conversationId: string;
    message?: string;
  }>();

  const isNew = !conversationId || conversationId === NEW_SINDI_CONVERSATION;

  // THIS host owns `/sindi/:id`: a conversation the first turn made replaces the
  // address, and the SDK hands that turn to the conversation's own mount.
  const openConversation = useCallback(
    (id: string) => {
      if (id !== conversationId) router.replace(`/sindi/${id}`);
    },
    [conversationId, router],
  );
  const closeConversation = useCallback(() => {
    if (!isNew) router.replace(`/sindi/${NEW_SINDI_CONVERSATION}`);
  }, [isNew, router]);

  const handleShare = useCallback(
    (id: string | undefined) => {
      if (!id) return;
      share(id).then(
        (minted) => shareSindiConversation(minted, t),
        () =>
          toast.error(t('sindi.share.error.title'), {
            description: t('sindi.share.error.failed'),
          }),
      );
    },
    [share, t],
  );

  const chrome = useCallback(
    ({ participants, conversationId: open, hasMessages }: AliaChatState) => ({
      header: (
        <PageHeader
          title={<AliaParticipants participants={participants} />}
          titleAlign="center"
          leading={<AppShellMenuButton accessibilityLabel={t('sidebar.open')} />}
          onBack={router.canGoBack() ? router.back : () => router.replace('/sindi')}
          backLabel={t('goBack')}
          actions={
            <Button
              iconOnly
              leadingIcon={RiShare2Line}
              onPress={() => handleShare(open)}
              disabled={!open || !hasMessages || isSharing}
              accessibilityLabel={t('common.share')}
              tone="neutral"
              appearance="outline"
            />
          }
        />
      ),
    }),
    [router, t, handleShare, isSharing],
  );

  const initialTurn = useMemo(
    () => (isNew && message ? { text: message } : undefined),
    [isNew, message],
  );

  if (!canUsePrivateApi) {
    return (
      <Screen
        documentScroll
        header={
          <PageHeader
            title={t('sindi.conversation.title')}
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

  // The chat fills the screen and scrolls its own thread, so it is a plain View
  // in the Screen rather than a ScreenScrollView; its header is the chat's chrome.
  return (
    <Screen documentScroll>
      <View style={styles.container}>
        <SindiConversation
          key={isNew ? NEW_SINDI_CONVERSATION : conversationId}
          host="screen"
          conversationId={isNew ? undefined : conversationId}
          openConversation={openConversation}
          closeConversation={closeConversation}
          chrome={chrome}
          initialTurn={initialTurn}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
