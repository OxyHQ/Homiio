import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import type { Message } from '@ai-sdk/react';
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
import { useOxy, openAccountDialog } from '@oxy.so/services';
import { SindiIcon } from '@/assets/icons';
import { EmptyState } from '@/components/ui/EmptyState';
import { ChatContent } from '@/components/sindi/ChatContent';
import { ConversationItem, ConversationList } from '@/components/sindi/ConversationItem';
import { useSindiPanelLayout } from '@/components/sindi/sindiPanelLayout';
import { useSindiAuthenticatedFetch } from '@/hooks/useSindiAuthenticatedFetch';
import { useUIStore } from '@/store/uiStore';
import { useConversationStore } from '@/store/conversationStore';
import { radius, spacing } from '@/constants/styles';
import { colors } from '@/styles/colors';

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
 * Hairline borders from an explicit Bloom token: the `--border` CSS variable
 * behind the `border-border` class doesn't reliably reach the native runtime.
 */
const panelBorders = StyleSheet.create({
  overlayEdge: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.border,
  },
  docked: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 24,
    overflow: 'hidden',
  },
  headerDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
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
const PanelSkeleton: React.FC = () => (
  <View style={styles.skeletonList}>
    {Array.from({ length: 4 }).map((_, idx) => (
      <View key={idx} style={styles.skeletonRow}>
        <Skeleton.Circle size={36} />
        <View style={styles.skeletonBody}>
          <Skeleton.Text style={{ width: 140, lineHeight: 16 }} />
          <Skeleton.Text style={{ width: 180, lineHeight: 13 }} />
        </View>
      </View>
    ))}
  </View>
);

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
 * Owns a local `activeConversationId`:
 *   - none selected  → a compact landing (intro + new-chat + recent list)
 *   - one selected   → the shared `ChatContent` pane seeded with its history
 *
 * Selecting a conversation or starting a new one stays IN the panel (no route
 * push) — the full-screen `/sindi` route is a separate, mobile-facing surface.
 */
export function SindiPanel({ placement }: { placement: 'aside' | 'overlay' }) {
  const { t } = useTranslation();
  const { colors: themeColors } = useTheme();
  const { oxyServices, activeSessionId } = useOxy();

  const closeSindiPanel = useUIStore((s) => s.closeSindiPanel);

  const layout = useSindiPanelLayout();
  const { height: viewportHeight } = useWindowDimensions();

  const {
    conversations,
    currentConversation,
    loading,
    loadConversations,
    loadConversation,
    createConversation,
  } = useConversationStore();

  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    null,
  );

  const isAuthenticated = useMemo(
    () => Boolean(oxyServices) && Boolean(activeSessionId),
    [oxyServices, activeSessionId],
  );

  const conversationFetch = useSindiAuthenticatedFetch();

  // Whether THIS placement renders this frame.
  const isVisible = layout.visible && layout.docked === (placement === 'aside');

  // Load the conversation list whenever the panel becomes visible while
  // authenticated. Genuine side effect (network) gated on open + auth.
  useEffect(() => {
    if (isVisible && isAuthenticated) {
      loadConversations(conversationFetch);
    }
  }, [isVisible, isAuthenticated, loadConversations, conversationFetch]);

  // Load the selected conversation's history into the store (skip
  // client-generated `conv_*` IDs, which are created lazily on first message).
  useEffect(() => {
    if (!isAuthenticated || !activeConversationId) return;
    if (activeConversationId.startsWith('conv_')) return;
    loadConversation(activeConversationId, conversationFetch).catch(() => {
      // loadConversation already logs + falls back to a new conversation.
    });
  }, [activeConversationId, isAuthenticated, loadConversation, conversationFetch]);

  const sortedConversations = useMemo(
    () =>
      [...conversations].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      ),
    [conversations],
  );

  // Seed the AI SDK with the active conversation's persisted history. Mirrors
  // the route screen's mapping so both surfaces hydrate identically.
  const initialMessages = useMemo<Message[]>(() => {
    const stored =
      currentConversation?.id === activeConversationId
        ? currentConversation?.messages
        : undefined;
    if (!stored || stored.length === 0) return [];
    return stored.map((msg, index) => {
      const ts = msg.timestamp ? new Date(msg.timestamp).getTime() : index;
      const stableId = msg.id || `${msg.role}-${ts}-${(msg.content || '').length}`;
      return {
        id: String(stableId),
        role: msg.role,
        content: msg.content,
      };
    });
  }, [currentConversation, activeConversationId]);

  const handleNewChat = useCallback(async () => {
    if (!isAuthenticated) {
      openAccountDialog();
      return;
    }
    const created = await createConversation(
      'New Conversation',
      undefined,
      conversationFetch,
    );
    setActiveConversationId(created.id);
    loadConversations(conversationFetch);
  }, [isAuthenticated, createConversation, conversationFetch, loadConversations]);

  const handleBackToList = useCallback(() => setActiveConversationId(null), []);

  if (!isVisible) return null;

  const hasActiveConversation = Boolean(activeConversationId);

  // Header + body — shared verbatim by the docked and overlay render paths
  // below. It owns no hooks, so holding it in a variable is safe.
  const content = (
    <>
      {/* Header */}
      <View style={[styles.header, panelBorders.headerDivider]}>
        <View style={styles.headerLeft}>
          {hasActiveConversation ? (
            <Button
              variant="icon"
              iconOnly
              leadingIcon={RiArrowLeftSLine}
              onPress={handleBackToList}
              accessibilityLabel={t('sindi.panel.conversations')}
            />
          ) : (
            <View style={[styles.headerBrand, { backgroundColor: themeColors.primarySubtle }]}>
              <SindiIcon size={22} color={themeColors.primary} />
            </View>
          )}
          <View style={styles.headerTitleWrap}>
            <Text variant="body-semibold" numberOfLines={1} style={{ color: themeColors.text }}>
              {t('sindi.panel.title')}
            </Text>
            <Text
              variant="caption-1-regular"
              numberOfLines={1}
              style={{ color: themeColors.textSecondary }}
            >
              {t('sindi.panel.subtitle')}
            </Text>
          </View>
        </View>
        <View style={styles.headerActions}>
          <Button
            variant="icon"
            iconOnly
            leadingIcon={RiEditBoxLine}
            onPress={handleNewChat}
            accessibilityLabel={t('sindi.panel.newChat')}
          />
          <Button
            variant="icon"
            iconOnly
            leadingIcon={RiCloseLine}
            onPress={closeSindiPanel}
            accessibilityLabel={t('sindi.panel.close')}
          />
        </View>
      </View>

      {/* Body */}
      {!isAuthenticated ? (
        <EmptyState
          icon={RiLockLine}
          title={t('sindi.auth.required')}
          description={t('sindi.auth.message')}
          actionText={t('common.signIn')}
          actionIcon={RiLoginBoxLine}
          onAction={() => openAccountDialog()}
          iconColor={colors.primaryColor}
        />
      ) : hasActiveConversation ? (
        <ChatContent
          key={`${activeConversationId}|${initialMessages.length}`}
          // Both placements are the same host: `useSindiPanelLayout` already
          // tells `docked` (act in the page column beside the chat) from the
          // overlay tier (act, then close this panel once the answer is written
          // so the result is not left behind a scrim).
          host="panel"
          conversationId={activeConversationId ?? undefined}
          currentConversation={
            currentConversation?.id === activeConversationId ? currentConversation : null
          }
          isAuthenticated={isAuthenticated}
          authenticatedFetch={conversationFetch}
          initialMessages={initialMessages}
          // The panel updates its OWN selection and leaves the main pane alone.
          // This replaced an unconditional `router.replace('/sindi/:id')` inside
          // the hook, which navigated the page the panel was sitting beside —
          // the exact failure #519 §8.7 describes.
          onConversationPersisted={setActiveConversationId}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.landing} showsVerticalScrollIndicator={false}>
          <View style={styles.intro}>
            <SindiIcon size={40} color={themeColors.primary} />
            <Text variant="headline-semibold" style={[styles.center, { color: themeColors.text }]}>
              {t('sindi.panel.title')}
            </Text>
            <Text
              variant="body-2-regular"
              style={[styles.center, { color: themeColors.textSecondary }]}
            >
              {t('sindi.panel.intro')}
            </Text>
          </View>

          <Button variant="primary" leadingIcon={RiAddLine} onPress={handleNewChat} fullWidth>
            {t('sindi.panel.startNew')}
          </Button>

          <View style={styles.historyBlock}>
            <Text variant="body-semibold" style={{ color: themeColors.text }}>
              {t('sindi.panel.conversations')}
            </Text>
            {loading ? (
              <PanelSkeleton />
            ) : sortedConversations.length === 0 ? (
              <View style={styles.emptyHistory}>
                <RiChat3Line width={28} height={28} fill={themeColors.textTertiary} />
                <Text
                  variant="body-2-regular"
                  style={[styles.center, { color: themeColors.textSecondary }]}
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
                    isActive={conversation.id === activeConversationId}
                    onPress={() => setActiveConversationId(conversation.id)}
                  />
                ))}
              </ConversationList>
            )}
          </View>
        </ScrollView>
      )}
    </>
  );

  // --- ASIDE (>= 1024): AppShell owns the column; this fills it. ----------
  if (placement === 'aside') {
    return (
      <Animated.View
        entering={FadeIn.duration(120)}
        exiting={FadeOut.duration(120)}
        style={[
          styles.panel,
          panelBorders.docked,
          Platform.OS === 'web'
            ? { height: viewportHeight - SHELL_VERTICAL_PADDING }
            : { flex: 1 },
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
      <View
        style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}
      >
        <AnimatedPressable
          entering={FadeIn.duration(SCRIM_FADE_DURATION)}
          exiting={FadeOut.duration(SCRIM_FADE_DURATION)}
          accessibilityRole="button"
          accessibilityLabel={t('sindi.panel.close')}
          onPress={closeSindiPanel}
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: PANEL_SCRIM, pointerEvents: 'auto' },
          ]}
        />
        <Animated.View
          entering={FadeIn.duration(120)}
          exiting={FadeOut.duration(120)}
          style={[
            styles.panel,
            { width: layout.width, pointerEvents: 'auto' },
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
  panel: {
    // Explicit solid surface. The `bg-background` className resolves to a
    // transparent computed background on the Metro web build (the CSS var
    // behind it doesn't reach this subtree), so page content showed THROUGH
    // the panel as it scrolled. An explicit Bloom token guarantees an opaque
    // panel in both placements.
    backgroundColor: colors.background,
  },
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
    backgroundColor: colors.surfaceElevated,
    padding: spacing.lg,
    borderRadius: radius.lg,
  },
  skeletonBody: {
    flex: 1,
    gap: spacing.sm,
  },
});
