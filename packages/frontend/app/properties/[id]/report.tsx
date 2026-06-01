/**
 * Report a listing — in-app trust & safety flow.
 *
 * Reached from the "Report this listing" link on the property detail booking
 * card. The reporter picks a reason (inaccurate info, suspected scam,
 * inappropriate content, already rented/unavailable, other), adds optional
 * free-text details (required when the reason is "other"), and may share a
 * reply-to email (prefilled from the signed-in account). Submitting POSTs to
 * `/api/properties/:propertyId/report`; the report lands in the internal
 * review queue.
 *
 * Mirrors the long-term apply form (`apply.tsx`): `Header` + `Section`s, Bloom
 * `Button`/`Chip`, the same auth gate (`showSignInModal`), `useMutation`, and
 * the shared toast + `ApiError` handling. No `useEffect` — form state is local,
 * the email prefill is derived from `useOxy`, and validity is `useMemo`.
 */
import React, { useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { z } from 'zod';

import { Button } from '@oxyhq/bloom/button';
import { Chip } from '@oxyhq/bloom/chip';
import { showSignInModal, useOxy } from '@oxyhq/services';

import { ListingReportReason } from '@homiio/shared-types';
import { Header } from '@/components/Header';
import { ThemedText } from '@/components/ThemedText';
import { useProperty } from '@/hooks';
import { useReportListingMutation } from '@/hooks/useReportMutation';
import { generatePropertyTitle } from '@/utils/propertyTitleGenerator';
import { PropertyType } from '@homiio/shared-types';
import { ApiError } from '@/utils/api';
import { toast } from '@/lib/sonner';
import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';

const MAX_DETAILS_LENGTH = 4000;
const EMAIL_REGEX = /\S+@\S+\.\S+/;

const REASON_OPTIONS: { value: ListingReportReason; labelKey: string; fallback: string }[] = [
  { value: ListingReportReason.INACCURATE, labelKey: 'property.report.reason.inaccurate', fallback: 'Inaccurate information' },
  { value: ListingReportReason.SCAM, labelKey: 'property.report.reason.scam', fallback: 'Suspected scam or fraud' },
  { value: ListingReportReason.INAPPROPRIATE, labelKey: 'property.report.reason.inappropriate', fallback: 'Inappropriate content' },
  { value: ListingReportReason.UNAVAILABLE, labelKey: 'property.report.reason.unavailable', fallback: 'Already rented or unavailable' },
  { value: ListingReportReason.OTHER, labelKey: 'property.report.reason.other', fallback: 'Something else' },
];

/**
 * Validates the submit payload. `details` is required (non-empty) when the
 * reason is "other"; `contactEmail`, when present, must look like an email.
 */
const reportFormSchema = z
  .object({
    reason: z.nativeEnum(ListingReportReason),
    details: z.string().trim().max(MAX_DETAILS_LENGTH),
    contactEmail: z.string().trim(),
  })
  .refine((value) => value.reason !== ListingReportReason.OTHER || value.details.length > 0, {
    path: ['details'],
  })
  .refine((value) => value.contactEmail.length === 0 || EMAIL_REGEX.test(value.contactEmail), {
    path: ['contactEmail'],
  });

export default function ReportListingScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isAuthenticated, user } = useOxy();

  const propertyId = Array.isArray(id) ? id[0] : id;
  const { property } = useProperty(propertyId ?? '');

  const [reason, setReason] = useState<ListingReportReason | null>(null);
  const [details, setDetails] = useState('');
  // Prefill the reply-to email from the signed-in account (derived, not synced
  // via an effect). The user can clear or edit it.
  const [contactEmail, setContactEmail] = useState(user?.email ?? '');

  const reportMutation = useReportListingMutation();
  const isSubmitting = reportMutation.isPending;

  const propertyTitle = useMemo(() => {
    if (!property) return '';
    return generatePropertyTitle({
      type: Object.values(PropertyType).includes(property.type)
        ? (property.type as PropertyType)
        : PropertyType.APARTMENT,
      address: property.address,
      bedrooms: property.bedrooms,
      bathrooms: property.bathrooms,
    });
  }, [property]);

  const detailsRequired = reason === ListingReportReason.OTHER;

  const formIsValid = useMemo(() => {
    if (!propertyId || !reason) return false;
    return reportFormSchema.safeParse({ reason, details, contactEmail }).success;
  }, [propertyId, reason, details, contactEmail]);

  const extractError = (err: unknown): string => {
    if (err instanceof ApiError) {
      const response = err.response as { error?: { code?: string }; code?: string } | undefined;
      const code = response?.error?.code || response?.code;
      if (code === 'INVALID_REASON') {
        return t('property.report.error.invalidReason', 'Please choose a reason for your report.');
      }
      if (code === 'DETAILS_REQUIRED') {
        return t('property.report.error.detailsRequired', 'Please add a few details about the problem.');
      }
      if (code === 'AUTHENTICATION_REQUIRED') {
        return t('property.report.error.auth', 'Please sign in to report a listing.');
      }
      if (code === 'NOT_FOUND') {
        return t('property.report.error.notFound', 'This listing no longer exists.');
      }
      return err.message;
    }
    if (err instanceof Error) return err.message;
    return t('property.report.error.generic', 'Something went wrong. Please try again.');
  };

  const handleSubmit = async () => {
    if (!isAuthenticated) {
      showSignInModal();
      return;
    }
    if (!propertyId || !reason || !formIsValid) {
      toast.error(t('property.report.error.invalidForm', 'Please choose a reason before submitting.'));
      return;
    }
    const trimmedDetails = details.trim();
    const trimmedEmail = contactEmail.trim();
    try {
      await reportMutation.mutateAsync({
        propertyId,
        input: {
          reason,
          details: trimmedDetails || undefined,
          contactEmail: trimmedEmail || undefined,
        },
      });
      toast.success(t('property.report.success', 'Thanks — your report has been submitted.'));
      router.back();
    } catch (err) {
      toast.error(extractError(err));
    }
  };

  return (
    <View style={styles.root}>
      <Header
        options={{
          showBackButton: true,
          title: t('property.report.title', 'Report this listing'),
          titlePosition: 'center',
        }}
      />
      <SafeAreaView style={styles.scrollWrapper} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <ThemedText style={styles.intro}>
            {t(
              'property.report.intro',
              'Tell us what’s wrong with this listing. Reports are confidential and reviewed by our team — they are never shared with the host.',
            )}
          </ThemedText>

          {property ? (
            <View style={styles.propertyCard}>
              <ThemedText style={styles.propertyTitle}>{propertyTitle}</ThemedText>
              <ThemedText style={styles.propertyLocation}>
                {property.address?.cityName}
                {property.address?.countryName ? `, ${property.address.countryName}` : ''}
              </ThemedText>
            </View>
          ) : null}

          <Section title={t('property.report.section.reason', 'Why are you reporting this?')}>
            <View style={styles.chipRow}>
              {REASON_OPTIONS.map((option) => (
                <Chip
                  key={option.value}
                  selected={reason === option.value}
                  onPress={() => setReason(option.value)}
                  style={styles.chip}
                >
                  {t(option.labelKey, option.fallback)}
                </Chip>
              ))}
            </View>
          </Section>

          <Section
            title={
              detailsRequired
                ? t('property.report.section.detailsRequired', 'Details')
                : t('property.report.section.details', 'Details (optional)')
            }
            description={t(
              'property.report.section.detailsHelp',
              'Add anything that helps us understand the problem.',
            )}
          >
            <TextInput
              style={[styles.input, styles.detailsInput]}
              value={details}
              onChangeText={setDetails}
              placeholder={t(
                'property.report.field.detailsPlaceholder',
                'Describe what’s inaccurate, suspicious or inappropriate…',
              )}
              placeholderTextColor={colors.COLOR_BLACK_LIGHT_3}
              multiline
              numberOfLines={5}
              maxLength={MAX_DETAILS_LENGTH}
              textAlignVertical="top"
            />
          </Section>

          <Section
            title={t('property.report.section.contact', 'Contact email (optional)')}
            description={t(
              'property.report.section.contactHelp',
              'Share an email if you’re happy for us to follow up about this report.',
            )}
          >
            <TextInput
              style={styles.input}
              value={contactEmail}
              onChangeText={setContactEmail}
              placeholder="you@example.com"
              placeholderTextColor={colors.COLOR_BLACK_LIGHT_3}
              inputMode="email"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </Section>

          <View style={styles.noticeRow}>
            <Ionicons
              name="shield-checkmark-outline"
              size={18}
              color={colors.COLOR_BLACK_LIGHT_3}
            />
            <ThemedText style={styles.noticeText}>
              {t(
                'property.report.notice',
                'False or abusive reports may affect your account. Only report genuine problems.',
              )}
            </ThemedText>
          </View>

          <Button
            onPress={handleSubmit}
            disabled={!formIsValid || isSubmitting}
            loading={isSubmitting}
            variant="primary"
            size="large"
            style={styles.submitButton}
          >
            {t('property.report.actions.submit', 'Submit report')}
          </Button>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function Section({
  title,
  description,
  children,
}: React.PropsWithChildren<{ title: string; description?: string }>) {
  return (
    <View style={styles.section}>
      <ThemedText style={styles.sectionTitle}>{title}</ThemedText>
      {description ? <ThemedText style={styles.sectionDescription}>{description}</ThemedText> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.COLOR_BACKGROUND,
  },
  scrollWrapper: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing['4xl'],
    gap: spacing.lg,
  },
  intro: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  propertyCard: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: spacing.lg,
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
  },
  propertyTitle: {
    fontWeight: '700',
    fontSize: 18,
    color: colors.COLOR_BLACK,
  },
  propertyLocation: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  section: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: spacing.lg,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
  },
  sectionTitle: {
    fontWeight: '700',
    fontSize: 16,
    color: colors.COLOR_BLACK,
  },
  sectionDescription: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    marginRight: 0,
  },
  input: {
    backgroundColor: colors.COLOR_BACKGROUND,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === 'web' ? spacing.md : spacing.sm,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    fontSize: 15,
    color: colors.COLOR_BLACK,
  },
  detailsInput: {
    minHeight: 120,
  },
  noticeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  noticeText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  submitButton: {
    marginTop: spacing.xs,
  },
});
