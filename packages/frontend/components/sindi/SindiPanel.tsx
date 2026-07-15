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
import { Ionicons } from '@expo/vector-icons';
import { Portal } from '@oxyhq/bloom/portal';
import { H3, Text as BloomText } from '@oxyhq/bloom/typography';
import * as Skeleton from '@oxyhq/bloom/skeleton';
import { useOxy, openAccountDialog } from '@oxyhq/services';
import { SindiIcon } from '@/assets/icons';
import { EmptyState } from '@/components/ui/EmptyState';
import { ChatContent } from '@/components/sindi/ChatContent';
import {
  ConversationItem,
  conversationListStyles,
} from '@/components/sindi/ConversationItem';
import { useSidebarWidth } from '@/components/SideBar/dimensions';
import { useSindiAuthenticatedFetch } from '@/hooks/useSindiAuthenticatedFetch';
import {
  useIsScreenNotMobile,
  useIsDesktop,
  useIsLargeDesktop,
} from '@/hooks/useOptimizedMediaQuery';
import { useUIStore } from '@/store/uiStore';
import { useConversationStore } from '@/store/conversationStore';
import { radius, spacing } from '@/constants/styles';
import { colors } from '@/styles/colors';

/** Ideal docked width on desktop (matches the ChatGPT/Claude docked-rail). */
const PANEL_IDEAL_WIDTH = 380;

/** Wider docked width allowed on large desktops (>= 1440). */
const PANEL_MAX_WIDTH = 420;

/**
 * Floor for the docked main-content column. The docked panel width is clamped
 * so `viewport - sidebar - panel` never drops below this — keeping the pushed
 * main content usable instead of crushing it on mid-width screens.
 */
const MIN_MAIN_CONTENT_WIDTH = 380;

/**
 * Sliver of viewport kept to the right of the OVERLAY panel so it never spans
 * the whole content area and the underlying screen peeks through behind the
 * scrim — mirrors the SideBar drawer's `MOBILE_DRAWER_EDGE_GAP`.
 */
const PANEL_OVERLAY_EDGE_GAP = 56;

/**
 * Scrim color for the overlay-tier panel. Mirrors the SideBar's mobile overlay
 * drawer (30% scrim) so the two surfaces share one dimming language. The scrim
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
 * Hairline right border separating the panel from the main content. Uses the
 * same explicit Bloom token at `StyleSheet.hairlineWidth` as the SideBar's
 * `sidebarBorders.railEdge` — the `--border` CSS variable behind the
 * `border-border` class doesn't reliably reach the native runtime.
 */
const panelBorders = StyleSheet.create({
  railEdge: {
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.border,
  },
  headerDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
});

/**
 * Web pins the DOCKED panel to the viewport exactly like the SideBar so it
 * stays full-height while the page-level `Animated.ScrollView` scrolls. The
 * `position: 'sticky'` / `'100vh'` values are web-only CSS absent from RN's
 * `ViewStyle`, so the whole web block is typed via the standard escape hatch
 * used across the app (see `BaseSidebar` + the collapsed rail in SideBar).
 */
const dockedPinnedStyle =
  Platform.OS === 'web'
    ? ({
        position: 'sticky',
        top: 0,
        alignSelf: 'flex-start',
        height: '100vh',
        maxHeight: '100vh',
      } as object)
    : // Native (wide): the fixed `width` + `flexShrink: 0` on `styles.panel`
      // govern the column; `height: '100%'` makes it full-height in its row
      // parent — mirroring the SideBar's wide-native wrapper (`className="h-full"`,
      // no `flex: 1`, which would fight the fixed width).
      ({ height: '100%' } as const);

/**
 * Web positions the OVERLAY-tier panel as a viewport-fixed column anchored
 * `sidebarWidth` from the left, floating over the main content full-height.
 * `position: 'fixed'` / `'100vh'` are web-only CSS (the same escape hatch the
 * `RightBar.fixedContainer` uses); native falls back to the absolute fill the
 * Portal layer already provides, sizing via `height: '100%'`.
 */
const overlayPanelPinnedStyle = (left: number): ViewStyle =>
  Platform.OS === 'web'
    ? ({
        position: 'fixed',
        top: 0,
        left,
        height: '100vh',
        maxHeight: '100vh',
        zIndex: 1000,
      } as unknown as ViewStyle)
    : // Native: the Portal layer is a flex-row absolute fill; the scrim is an
      // absolute overlay (out of flow), so the panel is the lone flex child and
      // starts at the left edge. `marginLeft` anchors it after the sidebar.
      ({ height: '100%', marginLeft: left } as ViewStyle);

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
 * Responsive Sindi AI chat panel.
 *
 * Self-gates: renders nothing unless the panel is open AND the viewport is wide
 * (>= 500), so it can be mounted unconditionally in the layout's wide branches.
 *
 * Width tier (the "too many columns" fix):
 *   - Desktop and up (>= 1024): DOCKED inline between the SideBar and the main
 *     content, PUSHING the content (a flex sibling, ChatGPT/Claude right-of-rail).
 *   - Tablet / small-wide (500-1023): OVERLAY — appears (no slide) anchored
 *     immediately after the SideBar and floats OVER the main content with a
 *     tap-to-dismiss scrim, so the narrower main content is never crushed.
 *
 * Width is clamped so docked main content never drops below ~380px (up to 420px
 * on large desktops); the RightBar steps aside while open below 1440 (see
 * `RightBar`) so the layout stays at three columns.
 *
 * Owns a local `activeConversationId`:
 *   - none selected  → a compact landing (intro + new-chat + recent list)
 *   - one selected   → the shared `ChatContent` pane seeded with its history
 *
 * Selecting a conversation or starting a new one stays IN the panel (no route
 * push) — the full-screen `/sindi` route is a separate, mobile-facing surface.
 */
export function SindiPanel() {
  const { t } = useTranslation();
  const { oxyServices, activeSessionId } = useOxy();

  const sindiPanelOpen = useUIStore((s) => s.sindiPanelOpen);
  const closeSindiPanel = useUIStore((s) => s.closeSindiPanel);

  // Responsive tier inputs (derived during render — no effects).
  const { width: viewportWidth } = useWindowDimensions();
  const isScreenNotMobile = useIsScreenNotMobile(); // >= 500: panel allowed
  const isDesktop = useIsDesktop(); // >= 1024: dock & push
  const isLargeDesktop = useIsLargeDesktop(); // >= 1440: wider panel
  const sidebarWidth = useSidebarWidth(); // current rendered sidebar width

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

  // Whether the panel is actually rendered this frame. A wide-screen layout
  // feature: closed or narrow → render nothing (the layout mounts it
  // unconditionally and relies on this gate).
  const isVisible = sindiPanelOpen && isScreenNotMobile;

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

  // --- Responsive tier ---------------------------------------------------
  // Desktop and up (>= 1024) docks the panel inline and pushes the content.
  // Below desktop (500-1023) it becomes an overlay anchored after the sidebar
  // so the (narrower) main content is never crushed into too many columns.
  const isDocked = isDesktop;

  // Responsive width:
  //   - docked: ideal (380, or 420 on large desktop) but never so wide that the
  //     pushed main content drops below MIN_MAIN_CONTENT_WIDTH;
  //   - overlay: capped to min(380, viewport - sidebar - edge gap) like the
  //     SideBar drawer, so a sliver of scrim always shows on the right.
  const panelWidth = useMemo(() => {
    const ideal = isLargeDesktop ? PANEL_MAX_WIDTH : PANEL_IDEAL_WIDTH;
    if (isDocked) {
      const maxDockable = viewportWidth - sidebarWidth - MIN_MAIN_CONTENT_WIDTH;
      // Floor at a usable minimum so the panel never collapses if the viewport
      // is unexpectedly narrow at the desktop breakpoint.
      return Math.max(280, Math.min(ideal, maxDockable));
    }
    const maxOverlay = viewportWidth - sidebarWidth - PANEL_OVERLAY_EDGE_GAP;
    return Math.max(280, Math.min(PANEL_IDEAL_WIDTH, maxOverlay));
  }, [isDocked, isLargeDesktop, viewportWidth, sidebarWidth]);

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
            <Pressable
              onPress={handleBackToList}
              accessibilityRole="button"
              accessibilityLabel={t('sindi.panel.conversations')}
              style={styles.headerIconButton}
            >
              <Ionicons name="chevron-back" size={20} color={colors.primaryDark} />
            </Pressable>
          ) : (
            <View style={styles.headerBrand}>
              <SindiIcon size={22} color={colors.primaryColor} />
            </View>
          )}
          <View style={styles.headerTitleWrap}>
            <BloomText style={styles.headerTitle} numberOfLines={1}>
              {t('sindi.panel.title')}
            </BloomText>
            <BloomText style={styles.headerSubtitle} numberOfLines={1}>
              {t('sindi.panel.subtitle')}
            </BloomText>
          </View>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            onPress={handleNewChat}
            accessibilityRole="button"
            accessibilityLabel={t('sindi.panel.newChat')}
            style={styles.headerIconButton}
          >
            <Ionicons name="create-outline" size={20} color={colors.primaryDark} />
          </Pressable>
          <Pressable
            onPress={closeSindiPanel}
            accessibilityRole="button"
            accessibilityLabel={t('sindi.panel.close')}
            style={styles.headerIconButton}
          >
            <Ionicons name="close" size={20} color={colors.primaryDark} />
          </Pressable>
        </View>
      </View>

      {/* Body */}
      {!isAuthenticated ? (
        <EmptyState
          icon="lock-closed"
          title={t('sindi.auth.required')}
          description={t('sindi.auth.message')}
          actionText={t('common.signIn')}
          actionIcon="log-in"
          onAction={() => openAccountDialog()}
          iconColor={colors.primaryColor}
        />
      ) : hasActiveConversation ? (
        <View style={styles.chatBody}>
          <ChatContent
            key={`${activeConversationId}|${initialMessages.length}`}
            conversationId={activeConversationId ?? undefined}
            currentConversation={
              currentConversation?.id === activeConversationId
                ? currentConversation
                : null
            }
            isAuthenticated={isAuthenticated}
            authenticatedFetch={conversationFetch}
            initialMessages={initialMessages}
          />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.landing}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.intro}>
            <View style={styles.introIcon}>
              <SindiIcon size={40} color={colors.primaryColor} />
            </View>
            <BloomText style={styles.introTitle}>
              {t('sindi.panel.title')}
            </BloomText>
            <BloomText style={styles.introBody}>
              {t('sindi.panel.intro')}
            </BloomText>
          </View>

          <Pressable
            onPress={handleNewChat}
            accessibilityRole="button"
            accessibilityLabel={t('sindi.panel.startNew')}
            style={styles.startButton}
          >
            <Ionicons name="add" size={18} color={colors.primaryForeground} />
            <BloomText style={styles.startButtonLabel}>
              {t('sindi.panel.startNew')}
            </BloomText>
          </Pressable>

          <View style={styles.historyBlock}>
            <H3 style={styles.historyTitle}>
              {t('sindi.panel.conversations')}
            </H3>
            {loading ? (
              <PanelSkeleton />
            ) : sortedConversations.length === 0 ? (
              <View style={styles.emptyHistory}>
                <Ionicons
                  name="chatbubbles-outline"
                  size={28}
                  color={colors.muted}
                />
                <BloomText style={styles.emptyHistoryText}>
                  {t('sindi.panel.empty')}
                </BloomText>
              </View>
            ) : (
              <View style={conversationListStyles.list}>
                {sortedConversations.map((conversation, idx) => (
                  <ConversationItem
                    key={conversation.id}
                    conversation={conversation}
                    isLast={idx === sortedConversations.length - 1}
                    isActive={conversation.id === activeConversationId}
                    onPress={() => setActiveConversationId(conversation.id)}
                  />
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      )}
    </>
  );

  // --- DOCKED (>= 1024): inline flex sibling that pushes the main content ---
  // The panel appears in place with a short opacity fade only — no horizontal
  // slide (sliding felt jarring on open).
  if (isDocked) {
    return (
      <Animated.View
        entering={FadeIn.duration(120)}
        exiting={FadeOut.duration(120)}
        className="bg-background"
        style={[
          styles.panel,
          { width: panelWidth },
          panelBorders.railEdge,
          dockedPinnedStyle,
        ]}
      >
        {content}
      </Animated.View>
    );
  }

  // --- OVERLAY (500-1023): appears over the content (no slide), anchored after
  // the sidebar, with a tap-to-dismiss scrim. Rendered through Bloom's root Portal
  // so it escapes the layout scroll container and covers the content area —
  // the same mechanism as the SideBar's mobile drawer. The scrim starts after
  // the sidebar so the sidebar itself stays interactive while the panel is open.
  return (
    <Portal>
      {/* Wrapper is `pointerEvents:'none'` so the strip left of the scrim (the
          sidebar column) passes touches through and stays interactive while the
          panel is open — the RN-only `'box-none'` is invalid CSS that RN-Web
          drops, which would leave the wrapper `auto` and block the sidebar. The
          scrim + panel re-enable themselves with `'auto'`. */}
      <View
        className="flex-row"
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
            { left: sidebarWidth, backgroundColor: PANEL_SCRIM, pointerEvents: 'auto' },
          ]}
        />
        <Animated.View
          entering={FadeIn.duration(120)}
          exiting={FadeOut.duration(120)}
          className="bg-background"
          style={[
            styles.panel,
            { width: panelWidth, pointerEvents: 'auto' },
            panelBorders.railEdge,
            overlayPanelPinnedStyle(sidebarWidth),
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
    // Width is applied inline (responsive) by the render paths; never grows or
    // shrinks once sized, so the docked sibling holds its column.
    flexShrink: 0,
    flexGrow: 0,
    // Explicit solid surface. The `bg-background` className resolves to a
    // transparent computed background on the Metro web build (the CSS var
    // behind it doesn't reach this subtree), so page content showed THROUGH
    // the panel as it scrolled. An explicit Bloom token guarantees an opaque
    // rail in both the docked and overlay render paths (same approach the
    // layout uses for `mainContentWrapper`).
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
    backgroundColor: colors.infoSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
  },
  headerSubtitle: {
    fontSize: 11,
    color: colors.muted,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexShrink: 0,
  },
  headerIconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatBody: {
    flex: 1,
    minHeight: 0,
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
  introIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.infoSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  introTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
    textAlign: 'center',
  },
  introBody: {
    fontSize: 13,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 20,
  },
  startButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primaryColor,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  startButtonLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primaryForeground,
  },
  historyBlock: {
    gap: spacing.md,
  },
  historyTitle: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  emptyHistory: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  emptyHistoryText: {
    fontSize: 13,
    color: colors.muted,
    textAlign: 'center',
    maxWidth: 240,
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
