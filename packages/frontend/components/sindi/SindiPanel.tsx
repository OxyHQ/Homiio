import type React from 'react';
import { useCallback, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { AliaParticipants, type AliaChatState, useConversations } from '@alia.onl/sdk';
import { Portal } from '@oxy.so/bloom/portal';
import { Button } from '@oxy.so/bloom/button';
import {
  RiAddLine,
  RiArrowLeftSLine,
  RiChat3Line,
  RiCloseLine,
  RiEditBoxLine,
  RiLockLine,
  RiLoginBoxLine,
} from '@oxy.so/bloom/icons';
import { useTheme } from '@oxy.so/bloom/theme';
import { Text } from '@oxy.so/bloom/typography';
import * as Skeleton from '@oxy.so/bloom/skeleton';
import { useAuth, openAccountDialog } from '@oxy.so/services';
import { SindiIcon } from '@/assets/icons';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  ConversationItem,
  ConversationList,
  conversationsOf,
} from '@/components/sindi/ConversationItem';
import { SindiConversation } from '@/components/sindi/SindiConversation';
import { SINDI_AGENT_ID } from '@/components/sindi/sindiAgent';
import { useSindiPanelLayout } from '@/components/sindi/sindiPanelLayout';
import { useUIStore } from '@/store/uiStore';
import { radius, spacing } from '@/constants/styles';

/**
 * Scrim color for the overlay-tier panel (30% black). The scrim
 * fades over `SCRIM_FADE_DURATION`; the panel itself appears without sliding.
 */
const SCRIM_FADE_DURATION = 250;
const PANEL_SCRIM = 'rgba(0, 0, 0, 0.3)';

/**
 * Pressable that participates in Reanimated layout transitions — used for the
 * fade-in scrim behind the overlay-tier panel. Created once at module scope so
 * the animated wrapper stays stable across renders.
 */
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Hairline borders. Their colour is the explicit Bloom token passed at render
 * (`{ borderColor: colors.border }`): the `--border` CSS variable behind the
 * `border-border` class doesn't reliably reach the native runtime.
 */
const panelBorders = StyleSheet.create({
  overlayEdge: {
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  docked: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 24,
    overflow: 'hidden',
  },
  headerDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});

/**
 * The OVERLAY-tier panel is pinned to the viewport's right edge, full height,
 * over the page. `position: 'fixed'` / `'100vh'` are web-only CSS; native uses
 * the absolute fill the Portal layer already provides.
 */
const overlayPanelPinnedStyle: ViewStyle =
  Platform.OS === 'web'
    ? ({
        position: 'fixed',
        top: 0,
        right: 0,
        height: '100vh',
        maxHeight: '100vh',
        zIndex: 1000,
      } as unknown as ViewStyle)
    : { position: 'absolute', top: 0, right: 0, bottom: 0 };

/**
 * `AppShell`'s aside column is pinned one viewport tall minus its 12 px frame
 * padding top and bottom, and wraps the aside in a `ScrollView`. The docked
 * panel takes exactly that height on web so the chat's own scroller and
 * composer stay put instead of growing the aside's scroller; native fills it.
 */
const SHELL_VERTICAL_PADDING = 24;

/** Skeleton rows shown while the conversation list loads. */
const PanelSkeleton: React.FC = () => {
  const { colors } = useTheme();
  return (
    <View style={styles.skeletonList}>
      {Array.from({ length: 4 }).map((_, idx) => (
        <View key={idx} style={[styles.skeletonRow, { backgroundColor: colors.card }]}>
          <Skeleton.Circle size={36} />
          <View style={styles.skeletonBody}>
            <Skeleton.Text style={{ width: 140, lineHeight: 16 }} />
            <Skeleton.Text style={{ width: 180, lineHeight: 13 }} />
          </View>
        </View>
      ))}
    </View>
  );
};

/**
 * Responsive Sindi AI chat panel. Where it goes is `useSindiPanelLayout`'s
 * decision, and the layout mounts it accordingly:
 *
 *   - `placement="aside"` (>= 1024): the layout hands it to `AppShell` as the
 *     `aside`, in place of the right rail, so the shell sizes and pins the
 *     column and the page column narrows beside it.
 *   - `placement="overlay"` (500-1023): the sidebar is a drawer and there is no
 *     aside column, so it floats over the page from the right edge through
 *     Bloom's root Portal, with a tap-to-dismiss scrim.
 *
 * Each placement renders nothing outside its own tier, so the layout can mount
 * the overlay unconditionally.
 *
 * Owns which conversation is open, locally:
 *   - none → a compact landing (intro + new chat + Sindi's conversations, from
 *     Alia: `useConversations({ agentId })`)
 *   - one, or a new one → the SDK's conversation (`SindiConversation`)
 *
 * Selecting a conversation or starting a new one stays IN the panel (no route
 * push): the panel acts on the page beside it, and replacing that page with the
 * full-screen chat would be the panel navigating out from under itself (#519
 * §8.7).
 */
export function SindiPanel({ placement }: { placement: 'aside' | 'overlay' }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { canUsePrivateApi } = useAuth();

  const closeSindiPanel = useUIStore((s) => s.closeSindiPanel);

  const layout = useSindiPanelLayout();
  const { height: viewportHeight } = useWindowDimensions();

  /** `null`: the landing. `{ id: undefined }`: a new conversation, made with its first turn. */
  const [open, setOpen] = useState<{ id: string | undefined; serial: number } | null>(null);

  // Whether THIS placement renders this frame.
  const isVisible = layout.visible && layout.docked === (placement === 'aside');

  const conversations = useConversations({ agentId: SINDI_AGENT_ID });
  const sortedConversations = conversationsOf(conversations.data);

  const handleNewChat = useCallback(() => {
    if (!canUsePrivateApi) {
      openAccountDialog();
      return;
    }
    // A new serial remounts the chat, so "new chat" from inside one starts clean.
    setOpen((previous) => ({ id: undefined, serial: (previous?.serial ?? 0) + 1 }));
  }, [canUsePrivateApi]);

  const handleBackToList = useCallback(() => setOpen(null), []);

  // The chat made (or left) its conversation: the panel's selection follows,
  // and the main pane is never touched.
  const handleConversationChange = useCallback(
    (id: string | undefined) => setOpen((previous) => (previous ? { ...previous, id } : previous)),
    [],
  );

  const chrome = useCallback(
    ({ participants }: AliaChatState) => ({
      header: (
        <View style={[styles.header, panelBorders.headerDivider, { borderColor: colors.border }]}>
          <Button
            iconOnly
            leadingIcon={RiArrowLeftSLine}
            onPress={handleBackToList}
            accessibilityLabel={t('sindi.panel.conversations')}
            tone="neutral"
            appearance="outline"
          />
          <View style={styles.headerTitleWrap}>
            <AliaParticipants participants={participants} />
          </View>
          <View style={styles.headerActions}>
            <Button
              iconOnly
              leadingIcon={RiEditBoxLine}
              onPress={handleNewChat}
              accessibilityLabel={t('sindi.panel.newChat')}
              tone="neutral"
              appearance="outline"
            />
            <Button
              iconOnly
              leadingIcon={RiCloseLine}
              onPress={closeSindiPanel}
              accessibilityLabel={t('sindi.panel.close')}
              tone="neutral"
              appearance="outline"
            />
          </View>
        </View>
      ),
    }),
    [t, handleBackToList, handleNewChat, closeSindiPanel, colors.border],
  );

  if (!isVisible) return null;

  // The landing's header. An open conversation draws its own (the chat's
  // participants, through `chrome`).
  const landingHeader = (
    <View style={[styles.header, panelBorders.headerDivider, { borderColor: colors.border }]}>
      <View style={styles.headerLeft}>
        <View style={[styles.headerBrand, { backgroundColor: colors.primarySubtle }]}>
          <SindiIcon size={22} color={colors.primary} />
        </View>
        <View style={styles.headerTitleWrap}>
          <Text variant="body-semibold" numberOfLines={1} style={{ color: colors.text }}>
            {t('sindi.panel.title')}
          </Text>
          <Text
            variant="caption-1-regular"
            numberOfLines={1}
            style={{ color: colors.textSecondary }}
          >
            {t('sindi.panel.subtitle')}
          </Text>
        </View>
      </View>
      <View style={styles.headerActions}>
        <Button
          iconOnly
          leadingIcon={RiEditBoxLine}
          onPress={handleNewChat}
          accessibilityLabel={t('sindi.panel.newChat')}
          tone="neutral"
          appearance="outline"
        />
        <Button
          iconOnly
          leadingIcon={RiCloseLine}
          onPress={closeSindiPanel}
          accessibilityLabel={t('sindi.panel.close')}
          tone="neutral"
          appearance="outline"
        />
      </View>
    </View>
  );

  // Shared verbatim by the docked and overlay render paths below.
  const content = !canUsePrivateApi ? (
    <>
      {landingHeader}
      <EmptyState
        icon={RiLockLine}
        title={t('sindi.auth.required')}
        description={t('sindi.auth.message')}
        actionText={t('common.signIn')}
        actionIcon={RiLoginBoxLine}
        onAction={() => openAccountDialog()}
        iconColor={colors.primarySubtleForeground}
      />
    </>
  ) : open ? (
    <SindiConversation
      key={open.serial}
      // Both placements are the same host: `useSindiPanelLayout` already tells
      // docked (act in the page column beside the chat) from the overlay tier
      // (act, then close this panel once the answer is written).
      host="panel"
      conversationId={open.id}
      onConversationChange={handleConversationChange}
      chrome={chrome}
    />
  ) : (
    <>
      {landingHeader}
      <ScrollView contentContainerStyle={styles.landing} showsVerticalScrollIndicator={false}>
        <View style={styles.intro}>
          <SindiIcon size={40} color={colors.primary} />
          <Text variant="headline-semibold" style={[styles.center, { color: colors.text }]}>
            {t('sindi.panel.title')}
          </Text>
          <Text variant="body-2-regular" style={[styles.center, { color: colors.textSecondary }]}>
            {t('sindi.panel.intro')}
          </Text>
        </View>

        <Button
          leadingIcon={RiAddLine}
          onPress={handleNewChat}
          fullWidth
          tone="accent"
          appearance="solid"
        >
          {t('sindi.panel.startNew')}
        </Button>

        <View style={styles.historyBlock}>
          <Text variant="body-semibold" style={{ color: colors.text }}>
            {t('sindi.panel.conversations')}
          </Text>
          {conversations.isLoading ? (
            <PanelSkeleton />
          ) : sortedConversations.length === 0 ? (
            <View style={styles.emptyHistory}>
              <RiChat3Line width={28} height={28} fill={colors.textTertiary} />
              <Text
                variant="body-2-regular"
                style={[styles.center, { color: colors.textSecondary }]}
              >
                {t('sindi.panel.empty')}
              </Text>
            </View>
          ) : (
            <ConversationList>
              {sortedConversations.map((conversation) => (
                <ConversationItem
                  key={conversation.id}
                  conversation={conversation}
                  onPress={() => setOpen({ id: conversation.id, serial: 0 })}
                />
              ))}
            </ConversationList>
          )}
        </View>
      </ScrollView>
    </>
  );

  // --- ASIDE (>= 1024): AppShell owns the column; this fills it. ----------
  if (placement === 'aside') {
    return (
      <Animated.View
        entering={FadeIn.duration(120)}
        exiting={FadeOut.duration(120)}
        // Explicit solid surface: `bg-background` resolves transparent in this
        // subtree on the Metro web build, so page content showed through.
        style={[
          { backgroundColor: colors.background, borderColor: colors.border },
          panelBorders.docked,
          Platform.OS === 'web' ? { height: viewportHeight - SHELL_VERTICAL_PADDING } : { flex: 1 },
        ]}
      >
        {content}
      </Animated.View>
    );
  }

  // --- OVERLAY (500-1023): over the page from the right edge (no slide), with
  // a tap-to-dismiss scrim, through Bloom's root Portal so it escapes the
  // shell and covers the viewport.
  return (
    <Portal>
      {/* The wrapper passes touches through (`'none'`; the RN-only
          `'box-none'` is invalid CSS that RN-Web drops) and the scrim and panel
          re-enable themselves with `'auto'`. */}
      <View style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}>
        <AnimatedPressable
          entering={FadeIn.duration(SCRIM_FADE_DURATION)}
          exiting={FadeOut.duration(SCRIM_FADE_DURATION)}
          accessibilityRole="button"
          accessibilityLabel={t('sindi.panel.close')}
          onPress={closeSindiPanel}
          style={[StyleSheet.absoluteFill, { backgroundColor: PANEL_SCRIM, pointerEvents: 'auto' }]}
        />
        <Animated.View
          entering={FadeIn.duration(120)}
          exiting={FadeOut.duration(120)}
          style={[
            {
              width: layout.width,
              pointerEvents: 'auto',
              backgroundColor: colors.background,
              borderColor: colors.border,
            },
            panelBorders.overlayEdge,
            overlayPanelPinnedStyle,
          ]}
        >
          {content}
        </Animated.View>
      </View>
    </Portal>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    height: 56,
    paddingHorizontal: spacing.md,
    flexShrink: 0,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
    minWidth: 0,
  },
  headerBrand: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexShrink: 0,
  },
  landing: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing['3xl'],
  },
  intro: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  center: {
    textAlign: 'center',
    maxWidth: 280,
  },
  historyBlock: {
    gap: spacing.md,
  },
  emptyHistory: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  skeletonList: {
    gap: spacing.md,
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
  },
  skeletonBody: {
    flex: 1,
    gap: spacing.sm,
  },
});
