/**
 * Eviction case detail (detalle) — the mobilisation page for a single desahucio.
 *
 * Cover → status + date/time → title → reporter → organisation → description →
 * "Cómo ayudar" (structured needs + gated organiser contacts) → published disc
 * on a map with the precision explained → local legal resources → timeline →
 * public comment thread. A sticky RSVP CTA drives "Asistiré/Asistiendo" and a
 * separate Follow control drives "avísame"; the header carries Share + Report.
 *
 * ## Three things this screen must not do
 *
 * **Never render a coordinate as a precise place.** The pin is the centre of a
 * published disc and `EvictionPrecisionNote` says how wide it is. A case under a
 * precautionary hold publishes no point at all, and the map section simply does
 * not render — which is correct rather than a gap.
 *
 * **Never promise that an RSVP unlocks the contact.** It is necessary and not
 * sufficient (ADR 0003 §7.3.1), so the locked state renders the reason the
 * server gave and the copy matches it.
 *
 * **Never show the attendee roster.** Only the count is published, to anybody,
 * the organiser included.
 */
import React, { useCallback, useContext, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Avatar } from '@oxyhq/bloom/avatar';
import { Button } from '@oxyhq/bloom/button';
import { Divider } from '@oxyhq/bloom/divider';
import * as Skeleton from '@oxyhq/bloom/skeleton';
import { TextFieldInput } from '@oxyhq/bloom/text-field';
import { H2, H3, Text as BloomText } from '@oxyhq/bloom/typography';
import { useOxy, openAccountDialog } from '@oxyhq/services';

import { Header } from '@/components/Header';
import Map from '@/components/Map';
import { IconButton } from '@/components/ui/IconButton';
import { ErrorState } from '@/components/ui/ErrorState';
import { ZoomableImage } from '@/components/ui/ZoomableImage';
import { LoadMoreSentinel } from '@/components/common/LoadMoreSentinel';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import { useOxyAvatars } from '@/hooks/useOxyAvatars';
import {
  useCreateEvictionComment,
  useDeleteEvictionComment,
  useEvictionComments,
  useEvictionDetail,
  useJurisdictionResources,
  useToggleAttend,
  useToggleFollow,
} from '@/hooks/useEvictionQueries';
import { EvictionStatusBadge } from '@/components/evictions/EvictionStatusBadge';
import { EvictionDateBlock } from '@/components/evictions/EvictionDateBlock';
import { EvictionContactActions } from '@/components/evictions/EvictionContactActions';
import { EvictionCommentRow } from '@/components/evictions/EvictionCommentRow';
import { EvictionOwnerControls } from '@/components/evictions/EvictionOwnerControls';
import { EvictionReportSheet } from '@/components/evictions/EvictionReportSheet';
import { EvictionTimeline } from '@/components/evictions/EvictionTimeline';
import { EvictionHelpNeeds } from '@/components/evictions/EvictionHelpNeeds';
import { EvictionResources } from '@/components/evictions/EvictionResources';
import { EvictionPrecisionNote } from '@/components/evictions/EvictionPrecisionNote';
import { formatEvictionFullDate } from '@/components/evictions/evictionUtils';
import { BottomSheetContext } from '@/context/BottomSheetContext';
import { shareContent } from '@/utils/share';
import { resolveBackendImageUrl } from '@/utils/imageUrl';
import { formatRelativeTime } from '@/utils/dateLocale';
import { webAlert } from '@/utils/api';
import { toast } from '@oxyhq/bloom/toast';
import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';

const SectionCard: React.FC<React.PropsWithChildren<{ title?: string }>> = ({ title, children }) => (
  <View style={styles.section}>
    {title ? <H3 style={styles.sectionTitle}>{title}</H3> : null}
    {children}
  </View>
);

const DetailSkeleton: React.FC = () => (
  <View style={styles.content}>
    <Skeleton.Box width="100%" height={200} borderRadius={radius.lg} />
    <Skeleton.Text style={{ width: 220, lineHeight: 24 }} />
    <Skeleton.Text style={{ width: 160, lineHeight: 16 }} />
    <Skeleton.Box width="100%" height={120} borderRadius={radius.lg} />
  </View>
);

export default function EvictionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const caseId = Array.isArray(id) ? id[0] : id ?? '';
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const bottomSheet = useContext(BottomSheetContext);
  const { isAuthenticated, user } = useOxy();

  const { data: eviction, isLoading, isError, error, refetch } = useEvictionDetail(caseId);

  const {
    comments,
    total: commentTotal,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useEvictionComments(caseId);

  const toggleAttend = useToggleAttend(caseId);
  const toggleFollow = useToggleFollow(caseId);
  const createComment = useCreateEvictionComment(caseId);
  const deleteComment = useDeleteEvictionComment(caseId);

  const [commentText, setCommentText] = useState('');

  /**
   * Local legal and housing resources for THIS case's jurisdiction.
   *
   * Keyed on the case's own country rather than on the reader's: the person
   * needing a tenant union is at the address on the notice, not wherever the
   * phone happens to be. Disabled entirely when the case carries no country, so
   * the screen shows nothing rather than a guess.
   */
  const resources = useJurisdictionResources(eviction?.location.countryCode);

  const avatarIds = useMemo(
    () => [eviction?.oxyUserId, ...comments.map((comment) => comment.oxyUserId)],
    [eviction?.oxyUserId, comments],
  );
  const { usersById, getAvatarFileId } = useOxyAvatars(avatarIds);

  const resolveName = useCallback(
    (oxyUserId: string): string => {
      const resolved = usersById.get(oxyUserId);
      return (
        resolved?.name?.displayName?.trim() ||
        resolved?.username ||
        t('evictions.detail.anonymous')
      );
    },
    [usersById, t],
  );

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  const { onScroll } = useInfiniteScroll({ onEndReached: handleEndReached, enabled: hasNextPage });

  const handleShare = useCallback(async () => {
    if (!eviction) return;
    const url = `https://homiio.com/evictions/${caseId}`;
    const outcome = await shareContent({
      title: eviction.title,
      message: `${eviction.title}\n${eviction.location.label}\n\n${url}`,
      url,
    });
    if (outcome === 'copied') toast.success(t('evictions.detail.shareCopied'));
    else if (outcome === 'failed') toast.error(t('evictions.detail.shareFailed'));
  }, [eviction, caseId, t]);

  const handleReport = useCallback(() => {
    if (!isAuthenticated) {
      openAccountDialog();
      return;
    }
    bottomSheet.openBottomSheet(
      <EvictionReportSheet caseId={caseId} onClose={() => bottomSheet.closeBottomSheet()} />,
    );
  }, [isAuthenticated, bottomSheet, caseId]);

  const handleFollow = useCallback(() => {
    if (!isAuthenticated) {
      openAccountDialog();
      return;
    }
    toggleFollow.mutate();
  }, [isAuthenticated, toggleFollow]);

  const handleRSVP = useCallback(() => {
    if (!isAuthenticated) {
      openAccountDialog();
      return;
    }
    toggleAttend.mutate();
  }, [isAuthenticated, toggleAttend]);

  const handleEdit = useCallback(() => {
    router.push(`/evictions/new?edit=${caseId}`);
  }, [router, caseId]);

  const handlePostComment = useCallback(async () => {
    const body = commentText.trim();
    if (!body) return;
    try {
      await createComment.mutateAsync(body);
      setCommentText('');
    } catch {
      toast.error(t('evictions.comments.postError'));
    }
  }, [commentText, createComment, t]);

  const handleDeleteComment = useCallback(
    (commentId: string) => {
      webAlert(t('evictions.comments.deleteTitle'), t('evictions.comments.deleteMessage'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteComment.mutateAsync(commentId);
            } catch {
              toast.error(t('evictions.comments.deleteError'));
            }
          },
        },
      ]);
    },
    [deleteComment, t],
  );

  const contactLabels = useMemo(
    () => ({
      phone: t('evictions.detail.contact.phone'),
      whatsapp: t('evictions.detail.contact.whatsapp'),
      telegram: t('evictions.detail.contact.telegram'),
      email: t('evictions.detail.contact.email'),
    }),
    [t],
  );

  const shareButton = (
    <IconButton
      key="share"
      icon="share-outline"
      variant="ghost"
      accessibilityLabel={t('evictions.detail.share')}
      onPress={handleShare}
    />
  );
  const reportButton = (
    <IconButton
      key="report"
      icon="flag-outline"
      variant="ghost"
      accessibilityLabel={t('evictions.report.title')}
      onPress={handleReport}
    />
  );

  if (isLoading) {
    return (
      <View style={styles.root}>
        <Header options={{ showBackButton: true, title: t('evictions.detail.title') }} />
        <DetailSkeleton />
      </View>
    );
  }

  if (isError || !eviction) {
    return (
      <View style={styles.root}>
        <Header options={{ showBackButton: true, title: t('evictions.detail.title') }} />
        <ErrorState
          icon="cloud-offline-outline"
          title={t('evictions.loadError')}
          description={error?.message ?? t('common.tryAgain')}
          onRetry={() => void refetch()}
        />
      </View>
    );
  }

  const coverUrl = eviction.coverImage?.url
    ? resolveBackendImageUrl(eviction.coverImage.url)
    : undefined;
  // The PUBLISHED centre, or nothing. A case under a precautionary hold has no
  // coordinate at all and the map section below does not render — which is the
  // hold working, not a missing pin.
  const coords = eviction.location.approximateCoordinates;
  const hasPin = Array.isArray(coords) && coords.length === 2;

  return (
    <View style={styles.root}>
      <Header
        options={{
          showBackButton: true,
          title: t('evictions.detail.title'),
          rightComponents: [shareButton, reportButton],
        }}
      />
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.content}
          onScroll={onScroll}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
        >
          {coverUrl ? (
            <ZoomableImage borderRadius={radius.lg} aspectRatio={16 / 9} style={styles.cover}>
              <Image
                source={{ uri: coverUrl }}
                style={styles.coverImage}
                contentFit="cover"
                accessibilityIgnoresInvertColors
              />
            </ZoomableImage>
          ) : null}

          <View style={styles.heroRow}>
            <EvictionDateBlock
              scheduledAt={eviction.scheduledAt}
              locale={i18n.language}
              size="large"
            />
            <View style={styles.heroText}>
              <EvictionStatusBadge status={eviction.status} />
              <H2 style={styles.title}>{eviction.title}</H2>
              <BloomText style={styles.when}>
                {formatEvictionFullDate(eviction.scheduledAt, i18n.language)}
              </BloomText>
            </View>
          </View>

          <View style={styles.authorRow}>
            <Avatar
              size={36}
              name={resolveName(eviction.oxyUserId)}
              source={getAvatarFileId(eviction.oxyUserId) ?? null}
              variant="thumb"
            />
            <View style={styles.authorText}>
              <BloomText style={styles.authorLabel}>{t('evictions.detail.reportedBy')}</BloomText>
              <BloomText style={styles.authorName} numberOfLines={1}>
                {resolveName(eviction.oxyUserId)}
              </BloomText>
            </View>
          </View>

          {eviction.description ? (
            <BloomText style={styles.description}>{eviction.description}</BloomText>
          ) : (
            // Withheld ENTIRELY under a precautionary hold rather than partly
            // redacted: a partial redaction of prose reported as exposing
            // somebody's details is a guess about which sentence did it.
            <BloomText style={styles.muted}>{t('evictions.detail.descriptionWithheld')}</BloomText>
          )}

          {eviction.organization ? (
            <SectionCard title={t('evictions.detail.organization')}>
              <BloomText style={styles.organizationName}>{eviction.organization.name}</BloomText>
              <BloomText style={styles.muted}>
                {/* Verification is STRICTLY stronger than authorship, and the
                    UI has to say which one it is showing. */}
                {eviction.organization.verified
                  ? t('evictions.detail.organizationVerified', {
                      source: eviction.organization.verificationSource ?? '',
                      when: eviction.organization.verifiedAt
                        ? formatEvictionFullDate(eviction.organization.verifiedAt, i18n.language)
                        : '',
                    })
                  : t('evictions.detail.organizationUnverified')}
              </BloomText>
            </SectionCard>
          ) : null}

          <SectionCard title={t('evictions.detail.howToHelp')}>
            <EvictionHelpNeeds needs={eviction.helpNeeds} />
            <Divider />
            {eviction.contactLocked ? (
              <View style={styles.lockedContact}>
                <View style={styles.lockedIcon}>
                  <Ionicons name="lock-closed" size={22} color={colors.textSecondary} />
                </View>
                <BloomText style={styles.lockedText}>
                  {/* The REASON, not a generic lock: "RSVP first" and "your
                      account is too new" ask the reader for different things,
                      and one message for both teaches people to re-tap. */}
                  {t(
                    `evictions.detail.contactLocked.${eviction.contactLockReason ?? 'not_attending'}`,
                  )}
                </BloomText>
                <Button
                  variant="primary"
                  size="medium"
                  onPress={handleRSVP}
                  loading={toggleAttend.isPending}
                  icon={
                    <Ionicons
                      name="megaphone-outline"
                      size={18}
                      color={colors.primaryForeground}
                    />
                  }
                  iconPosition="left"
                  style={styles.lockedCta}
                >
                  {t('evictions.attend')}
                </Button>
              </View>
            ) : (
              <>
                <EvictionContactActions
                  contact={eviction.contactInfo}
                  labels={contactLabels}
                  instructionsLabel={t('evictions.detail.instructions')}
                  openFailedLabel={t('evictions.detail.contactFailed')}
                />
                {!eviction.contactInfo ? (
                  <BloomText style={styles.muted}>{t('evictions.detail.noContact')}</BloomText>
                ) : null}
              </>
            )}
          </SectionCard>

          {hasPin ? (
            <SectionCard title={t('evictions.detail.where')}>
              <View style={styles.mapWrap}>
                <Map
                  style={styles.mapInner}
                  screenId={`eviction-${caseId}`}
                  startFromCurrentLocation={false}
                  initialCoordinates={[coords[0], coords[1]]}
                  initialZoom={15}
                  markers={[
                    {
                      id: eviction.id,
                      coordinates: [coords[0], coords[1]],
                      priceLabel: eviction.location.label,
                    },
                  ]}
                />
              </View>
              <BloomText style={styles.locationLabel}>{eviction.location.label}</BloomText>
              <EvictionPrecisionNote
                location={eviction.location}
                moderation={eviction.moderation}
                locale={i18n.language}
              />
            </SectionCard>
          ) : (
            <SectionCard title={t('evictions.detail.where')}>
              <BloomText style={styles.locationLabel}>{eviction.location.label}</BloomText>
              <EvictionPrecisionNote
                location={eviction.location}
                moderation={eviction.moderation}
                locale={i18n.language}
              />
            </SectionCard>
          )}

          <SectionCard title={t('evictions.detail.localResources')}>
            <EvictionResources
              resources={resources.data?.resources ?? []}
              disclaimer={resources.data?.disclaimer}
              locale={i18n.language}
              isLoading={resources.isLoading}
              isError={resources.isError}
            />
          </SectionCard>

          <SectionCard title={t('evictions.detail.timeline')}>
            <EvictionTimeline events={eviction.timeline} locale={i18n.language} />
          </SectionCard>

          {eviction.isOwner ? (
            <EvictionOwnerControls
              caseId={caseId}
              currentStatus={eviction.status}
              onEdit={handleEdit}
            />
          ) : null}

          <SectionCard
            title={`${t('evictions.detail.comments')}${commentTotal > 0 ? ` · ${commentTotal}` : ''}`}
          >
            {comments.length === 0 ? (
              <BloomText style={styles.muted}>{t('evictions.comments.empty')}</BloomText>
            ) : (
              <View>
                {comments.map((comment, index) => {
                  const canDelete =
                    isAuthenticated &&
                    (comment.oxyUserId === user?.id || Boolean(eviction.isOwner));
                  return (
                    <View key={comment.id}>
                      {index > 0 ? <Divider /> : null}
                      <EvictionCommentRow
                        comment={comment}
                        authorName={resolveName(comment.oxyUserId)}
                        avatarFileId={getAvatarFileId(comment.oxyUserId)}
                        time={formatRelativeTime(new Date(comment.createdAt))}
                        canDelete={canDelete}
                        onDelete={() => handleDeleteComment(comment.id)}
                        deleteLabel={t('common.delete')}
                      />
                    </View>
                  );
                })}
                {isFetchingNextPage ? (
                  <BloomText style={styles.muted}>{t('common.loading')}</BloomText>
                ) : null}
                <LoadMoreSentinel enabled={hasNextPage} onLoadMore={handleEndReached} />
              </View>
            )}

            {isAuthenticated ? (
              <View style={styles.composer}>
                <View style={styles.composerField}>
                  <TextFieldInput
                    label={t('evictions.comments.placeholder')}
                    value={commentText}
                    onChangeText={setCommentText}
                    multiline
                  />
                </View>
                <Button
                  variant="primary"
                  size="medium"
                  onPress={handlePostComment}
                  disabled={!commentText.trim() || createComment.isPending}
                  loading={createComment.isPending}
                >
                  {t('evictions.comments.send')}
                </Button>
              </View>
            ) : (
              <Button variant="secondary" size="medium" onPress={() => openAccountDialog()}>
                {t('evictions.comments.signInToComment')}
              </Button>
            )}
          </SectionCard>
        </ScrollView>

        <View style={styles.footer}>
          <Button
            variant={eviction.isAttending ? 'secondary' : 'primary'}
            size="large"
            onPress={handleRSVP}
            loading={toggleAttend.isPending}
            accessibilityLabel={
              eviction.isAttending ? t('evictions.attending') : t('evictions.attend')
            }
            icon={
              <Ionicons
                name={eviction.isAttending ? 'checkmark-circle' : 'megaphone-outline'}
                size={20}
                color={eviction.isAttending ? colors.success : colors.primaryForeground}
              />
            }
            iconPosition="left"
            style={styles.footerButton}
          >
            {`${eviction.isAttending ? t('evictions.attending') : t('evictions.attend')} · ${t('evictions.attendeesCount', { count: eviction.attendeeCount })}`}
          </Button>
          {/* Following is a SEPARATE statement from attending: "tell me if the
              date moves" is not "I will be there", and folding them together
              either spams watchers or inflates the turnout number the page
              exists to report. */}
          <Button
            variant="outline"
            size="large"
            onPress={handleFollow}
            loading={toggleFollow.isPending}
            accessibilityLabel={
              eviction.isFollowing ? t('evictions.unfollow') : t('evictions.follow')
            }
            icon={
              <Ionicons
                name={eviction.isFollowing ? 'notifications' : 'notifications-outline'}
                size={20}
                color={colors.text}
              />
            }
            iconPosition="left"
          >
            {eviction.isFollowing ? t('evictions.following') : t('evictions.follow')}
          </Button>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  safeArea: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing['5xl'],
  },
  cover: {
    width: '100%',
  },
  coverImage: {
    width: '100%',
    height: '100%',
  },
  heroRow: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'flex-start',
  },
  heroText: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  title: {
    letterSpacing: -0.5,
  },
  when: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  authorText: {
    flex: 1,
    minWidth: 0,
  },
  authorLabel: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  authorName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  description: {
    fontSize: 15,
    color: colors.text,
    lineHeight: 22,
  },
  section: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  sectionTitle: {
    letterSpacing: -0.3,
  },
  muted: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  lockedContact: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  lockedIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.mutedSubtle,
  },
  lockedText: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 320,
  },
  lockedCta: {
    alignSelf: 'center',
  },
  mapWrap: {
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.mutedSubtle,
  },
  mapInner: {
    height: 220,
  },
  organizationName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  locationLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  disclaimerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  disclaimer: {
    flex: 1,
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  timeline: {
    gap: spacing.md,
  },
  timelineItem: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 4,
    backgroundColor: colors.primaryColor,
  },
  timelineBody: {
    flex: 1,
    gap: spacing.xs,
  },
  timelineTime: {
    fontSize: 12,
    color: colors.textTertiary,
  },
  timelineMessage: {
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
  },
  timelineMeta: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  composer: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  composerField: {
    minWidth: 0,
  },
  footer: {
    padding: spacing.lg,
    backgroundColor: colors.surfaceElevated,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footerButton: {
    alignSelf: 'stretch',
  },
});
