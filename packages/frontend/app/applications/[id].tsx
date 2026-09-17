/**
 * Application detail (applicant + landlord view).
 *
 * Shows the submitted application payload. Renders role-appropriate actions:
 *  - Applicant on submitted/reviewing: "Withdraw" (confirm dialog)
 *  - Landlord on approved:             "Create lease" → /contracts/new?application=
 *    (the landlord-only bridge seeds a draft lease from this application)
 *
 * Documents are linked via signed S3 URLs returned by the API.
 *
 * Each block is an outlined Bloom `Card`; documents are Bloom `Item` rows with
 * Remix glyphs; status is the Chip-based `ApplicationStatusBadge`. Loading is
 * Bloom `Loading`, errors the shared ErrorState component.
 */
import React, { useCallback, useMemo } from 'react';
import { Image, Linking, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { useFormatting } from '@/utils/format';
import i18next from 'i18next';
import { toast } from '@oxy.so/bloom/toast';
import { Item } from '@oxy.so/bloom/item';
import { useTheme } from '@oxy.so/bloom/theme';
import {
  RiAlertLine,
  RiCloseLine,
  RiEditLine,
  RiExternalLinkLine,
  RiFileTextLine,
  RiMailLine,
  RiUserLine,
  RiWallet3Line,
} from '@oxy.so/bloom/icons';

import { Button } from '@oxy.so/bloom/button';
import { Loading } from '@oxy.so/bloom/loading';
import { Text as BloomText, H2 } from '@oxy.so/bloom/typography';
import {
  TenantApplicationDocument,
  TenantApplicationStatus,
  formatMoney,
} from '@homiio/shared-types';

import { Header } from '@/components/Header';
import { PageScrollView } from '@/components/PageScrollView';
import { ApplicationStatusBadge } from '@/components/ApplicationStatusBadge';
import { confirm } from '@oxy.so/bloom/surfaces';
import { useProperty } from '@/hooks';
import { useProfile } from '@/context/ProfileContext';
import {
  useApplicationById,
  useUpdateApplicationMutation,
} from '@/hooks/useApplicationQueries';
import {
  getPropertyImageSource,
  getPropertyTitle,
} from '@/utils/propertyUtils';
import { Card } from '@oxy.so/bloom/card';
import { ErrorState } from '@/components/ui/ErrorState';
import { radius, spacing, tracker } from '@/constants/styles';

/** A tenant's declared income has no currency field; it is quoted in euros. */
const APPLICATION_INCOME_CURRENCY = 'EUR';
/** Income reads as a round figure — cents on a salary are noise. */
const INCOME_FORMAT = { minimumFractionDigits: 0, maximumFractionDigits: 0 } as const;

const formatDate = (raw: string): string => {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return format(date, 'EEE, MMM d, yyyy');
};

const DocIcon: React.FC<{ type: string; size: number; fill: string }> = ({ type, size, fill }) => {
  switch (type) {
    case 'id':
      return <RiUserLine width={size} height={size} fill={fill} />;
    case 'income':
      return <RiWallet3Line width={size} height={size} fill={fill} />;
    case 'reference':
      return <RiMailLine width={size} height={size} fill={fill} />;
    default:
      return <RiFileTextLine width={size} height={size} fill={fill} />;
  }
};

const openDocument = (url: string): void => {
  if (Platform.OS === 'web') {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  Linking.openURL(url).catch(() => {
    toast.error(i18next.t('applications.toast.openDocumentFailed'));
  });
};

interface DocumentRowProps {
  document: TenantApplicationDocument;
}

const DocumentRow: React.FC<DocumentRowProps> = ({ document }) => {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <Item
      onPress={() => openDocument(document.url)}
      accessibilityRole="link"
      accessibilityLabel={`Open document ${document.filename}`}
      leading={<DocIcon type={document.type} size={20} fill={theme.colors.icon} />}
      title={document.filename}
      subtitle={t(`applications.documentType.${document.type}`)}
      trailing={<RiExternalLinkLine width={18} height={18} fill={theme.colors.textSecondary} />}
    />
  );
};

export default function ApplicationDetailScreen() {
  const { t } = useTranslation();
  const { locale } = useFormatting();
  const router = useRouter();
  const theme = useTheme();
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : params.id?.[0];
  const applicationQuery = useApplicationById(id);
  const updateMutation = useUpdateApplicationMutation();
  const { profile } = useProfile();

  const application = applicationQuery.data;
  const { property } = useProperty(application?.propertyId ?? '');

  const role = useMemo<'applicant' | 'landlord' | null>(() => {
    if (!application || !profile) return null;
    const sessionOxyUserId = profile?.oxyUserId;
    if (!sessionOxyUserId) return null;
    if (String(application.landlordOxyUserId) === sessionOxyUserId) return 'landlord';
    if (String(application.applicantOxyUserId) === sessionOxyUserId) return 'applicant';
    return null;
  }, [application, profile]);

  const canWithdraw = useMemo<boolean>(() => {
    if (!application || role !== 'applicant') return false;
    return (
      application.status === TenantApplicationStatus.SUBMITTED ||
      application.status === TenantApplicationStatus.REVIEWING
    );
  }, [application, role]);

  const showCreateLease = useMemo<boolean>(() => {
    if (!application) return false;
    return (
      role === 'landlord' &&
      application.status === TenantApplicationStatus.APPROVED
    );
  }, [application, role]);

  const handleWithdraw = useCallback(async () => {
    if (!id || !application) return;
    const ok = await confirm({
      title: 'Withdraw application?',
      description:
        'The landlord will see this application as withdrawn. You can submit a new one for this property afterwards.',
      confirmLabel: 'Withdraw',
      destructive: true,
    });
    if (!ok) return;
    try {
      await updateMutation.mutateAsync({
        id,
        input: { status: TenantApplicationStatus.WITHDRAWN },
      });
      toast.success(t('applications.toast.withdrawn'));
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t('applications.toast.withdrawFailed');
      toast.error(message);
    }
  }, [id, application, updateMutation, t]);

  const handleCreateLease = useCallback(() => {
    if (!id) return;
    router.push({
      pathname: '/contracts/new',
      params: { application: id },
    });
  }, [id, router]);

  const header = (
    <Header
      options={{
        showBackButton: true,
        title: 'Application',
      }}
    />
  );

  if (!id) {
    return (
      <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
        {header}
        <View style={styles.centerWrap}>
          <ErrorState
            icon={RiAlertLine}
            title="Invalid application id"
            description="The link you followed is missing the application reference."
            retryLabel="Go back"
            onRetry={() => router.back()}
          />
        </View>
      </View>
    );
  }

  if (applicationQuery.isPending) {
    return (
      <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
        {header}
        <View style={styles.centerWrap}>
          <Loading variant="spinner" size="medium" />
        </View>
      </View>
    );
  }

  if (applicationQuery.isError || !application) {
    return (
      <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
        {header}
        <View style={styles.centerWrap}>
          <ErrorState
            title="Application unavailable"
            description={
              applicationQuery.error?.message ?? 'This application could not be loaded.'
            }
            retryLabel="Go back"
            onRetry={() => router.back()}
          />
        </View>
      </View>
    );
  }

  const propertyTitle = property ? getPropertyTitle(property) : 'Property';
  const secondaryText = { color: theme.colors.textSecondary };
  const imageSource = property ? getPropertyImageSource(property) : null;

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      {header}
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <PageScrollView contentContainerStyle={styles.content}>
          <View style={[styles.thumbWrap, { backgroundColor: theme.colors.backgroundSecondary }]}>
            {imageSource ? (
              <Image source={imageSource} style={styles.thumb} resizeMode="cover" />
            ) : (
              <View style={styles.thumb} />
            )}
          </View>

          <Card variant="outlined" radius="radius-16" className="p-5">
            <View style={styles.headerRow}>
              <H2 style={styles.title}>{propertyTitle}</H2>
              <ApplicationStatusBadge status={application.status} />
            </View>
            {property?.address ? (
              <BloomText style={[styles.subtitle, secondaryText]}>
                {[property.address.cityName, property.address.countryName]
                  .filter(Boolean)
                  .join(', ')}
              </BloomText>
            ) : null}
          </Card>

          <Card variant="outlined" radius="radius-16" className="p-5">
            <BloomText style={[styles.sectionLabel, secondaryText]}>Tenancy</BloomText>
            <DetailRow label="Move-in" value={formatDate(application.moveInDate)} />
            <DetailRow
              label="Lease term"
              value={`${application.leaseTermMonths} months`}
            />
            <DetailRow
              label="Submitted"
              value={formatDate(application.submittedAt)}
            />
            {application.decidedAt ? (
              <DetailRow
                label="Decided"
                value={formatDate(application.decidedAt)}
              />
            ) : null}
          </Card>

          <Card variant="outlined" radius="radius-16" className="p-5">
            <BloomText style={[styles.sectionLabel, secondaryText]}>Finances</BloomText>
            <DetailRow
              label="Monthly income"
              value={formatMoney(application.monthlyIncome, APPLICATION_INCOME_CURRENCY, locale, INCOME_FORMAT)}
            />
            <DetailRow
              label="Employment"
              value={t(`profile.edit.options.employmentStatus.${application.employmentStatus}`)}
            />
          </Card>

          <Card variant="outlined" radius="radius-16" className="p-5">
            <BloomText style={[styles.sectionLabel, secondaryText]}>References</BloomText>
            {application.referenceContacts.length === 0 ? (
              <BloomText style={[styles.emptyHint, secondaryText]}>
                No references provided.
              </BloomText>
            ) : (
              application.referenceContacts.map((reference, index) => (
                <View key={`${reference.email}-${index}`} style={[styles.referenceCard, { borderBottomColor: theme.colors.border }]}>
                  <BloomText style={styles.referenceName}>
                    {reference.name}
                  </BloomText>
                  <BloomText style={[styles.referenceMeta, secondaryText]}>
                    {t(`profile.edit.options.referenceRelationship.${reference.relationship}`)} ·{' '}
                    {reference.phone}
                  </BloomText>
                  <BloomText style={[styles.referenceMeta, secondaryText]}>
                    {reference.email}
                  </BloomText>
                </View>
              ))
            )}
          </Card>

          <Card variant="outlined" radius="radius-16" className="p-5">
            <BloomText style={[styles.sectionLabel, secondaryText]}>Documents</BloomText>
            {application.documents.length === 0 ? (
              <BloomText style={[styles.emptyHint, secondaryText]}>No documents attached.</BloomText>
            ) : (
              application.documents.map((document) => (
                <DocumentRow key={document.url} document={document} />
              ))
            )}
          </Card>

          {application.notes ? (
            <Card variant="outlined" radius="radius-16" className="p-5">
              <BloomText style={[styles.sectionLabel, secondaryText]}>Notes</BloomText>
              <BloomText style={styles.notesBody}>{application.notes}</BloomText>
            </Card>
          ) : null}

          {(showCreateLease || canWithdraw) ? (
            <View style={styles.actionRow}>
              {showCreateLease ? (
                <Button
                  variant="primary"
                  size="medium"
                  leadingIcon={RiEditLine}
                  onPress={handleCreateLease}
                  style={styles.actionButton}
                >
                  Create lease
                </Button>
              ) : null}
              {canWithdraw ? (
                <Button
                  variant="ghost"
                  size="medium"
                  leadingIcon={RiCloseLine}
                  onPress={() => void handleWithdraw()}
                  disabled={updateMutation.isPending}
                  style={styles.actionButton}
                >
                  Withdraw application
                </Button>
              ) : null}
            </View>
          ) : null}
        </PageScrollView>
      </SafeAreaView>
    </View>
  );
}

interface DetailRowProps {
  label: string;
  value: string;
}

const DetailRow: React.FC<DetailRowProps> = ({ label, value }) => {
  const theme = useTheme();
  return (
    <View style={[styles.detailRow, { borderBottomColor: theme.colors.border }]}>
      <BloomText style={[styles.detailLabel, { color: theme.colors.textSecondary }]}>{label}</BloomText>
      <BloomText style={styles.detailValue}>{value}</BloomText>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  centerWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing['2xl'],
  },
  thumbWrap: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: radius.photo,
    overflow: 'hidden',
  },
  thumb: {
    width: '100%',
    height: '100%',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.xs,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    flex: 1,
  },
  subtitle: {
    fontSize: 13,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: tracker.eyebrow,
    marginBottom: spacing.sm,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  detailLabel: {
    fontSize: 13,
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '600',
  },
  emptyHint: {
    fontSize: 13,
    fontStyle: 'italic',
  },
  referenceCard: {
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  referenceName: {
    fontSize: 14,
    fontWeight: '600',
  },
  referenceMeta: {
    fontSize: 12,
  },
  notesBody: {
    fontSize: 14,
    lineHeight: 20,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  actionButton: {
    flex: 1,
    minWidth: 120,
  },
});
