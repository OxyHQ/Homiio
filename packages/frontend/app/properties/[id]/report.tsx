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
 * Mirrors the long-term apply form (`apply.tsx`): `Header`, Bloom `RadioGroup`
 * cards for the reason, `Textarea`/`TextFieldInput` fields, the same auth gate (`openAccountDialog`), `useMutation`, and
 * the shared toast + `ApiError` handling. No `useEffect` — form state is local,
 * the email prefill is derived from `useOxy`, and validity is `useMemo`.
 */
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { z } from 'zod';

import { Button } from '@oxy.so/bloom/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@oxy.so/bloom/card';
import { Field } from '@oxy.so/bloom/field';
import { RiMailLine, RiShieldCheckLine } from '@oxy.so/bloom/icons';
import { RadioGroup, type RadioOption } from '@oxy.so/bloom/radio';
import { TextField, TextFieldIcon, TextFieldInput } from '@oxy.so/bloom/text-field';
import { Textarea } from '@oxy.so/bloom/textarea';
import { useTheme } from '@oxy.so/bloom/theme';
import { Text } from '@oxy.so/bloom/typography';
import { openAccountDialog, useOxy } from '@oxy.so/services';

import { ListingReportReason, PropertyType } from '@homiio/shared-types';
import { Header } from '@/components/Header';
import { useProperty } from '@/hooks';
import { useReportListingMutation } from '@/hooks/useReportMutation';
import { generatePropertyTitle } from '@/utils/propertyTitleGenerator';
import { ApiError } from '@/utils/api';
import { toast } from '@oxy.so/bloom/toast';
import { spacing } from '@/constants/styles';

const MAX_DETAILS_LENGTH = 4000;
const EMAIL_REGEX = /\S+@\S+\.\S+/;

/**
 * `OTHER` stays last so it reads as the fallback it is. `PRIVACY` and `UNSAFE`
 * sit above it because both used to have nowhere to go but there, and a reason
 * buried under "something else" is a reason nobody picks.
 */
const REASON_OPTIONS: { value: ListingReportReason; labelKey: string }[] = [
  { value: ListingReportReason.INACCURATE, labelKey: 'property.report.reason.inaccurate' },
  { value: ListingReportReason.SCAM, labelKey: 'property.report.reason.scam' },
  { value: ListingReportReason.INAPPROPRIATE, labelKey: 'property.report.reason.inappropriate' },
  { value: ListingReportReason.UNAVAILABLE, labelKey: 'property.report.reason.unavailable' },
  { value: ListingReportReason.PRIVACY, labelKey: 'property.report.reason.privacy' },
  { value: ListingReportReason.UNSAFE, labelKey: 'property.report.reason.unsafe' },
  { value: ListingReportReason.OTHER, labelKey: 'property.report.reason.other' },
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
  const theme = useTheme();
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
  const emailInvalid =
    contactEmail.trim().length > 0 && !EMAIL_REGEX.test(contactEmail.trim());

  const reasonOptions = useMemo<RadioOption<ListingReportReason>[]>(
    () => REASON_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) })),
    [t],
  );

  const formIsValid = useMemo(() => {
    if (!propertyId || !reason) return false;
    return reportFormSchema.safeParse({ reason, details, contactEmail }).success;
  }, [propertyId, reason, details, contactEmail]);

  const extractError = (err: unknown): string => {
    if (err instanceof ApiError) {
      const response = err.response as { error?: { code?: string }; code?: string } | undefined;
      const code = response?.error?.code || response?.code;
      if (code === 'INVALID_REASON') {
        return t('property.report.error.invalidReason');
      }
      if (code === 'DETAILS_REQUIRED') {
        return t('property.report.error.detailsRequired');
      }
      if (code === 'AUTHENTICATION_REQUIRED') {
        return t('property.report.error.auth');
      }
      if (code === 'NOT_FOUND') {
        return t('property.report.error.notFound');
      }
      return err.message;
    }
    if (err instanceof Error) return err.message;
    return t('property.report.error.generic');
  };

  const handleSubmit = async () => {
    if (!isAuthenticated) {
      openAccountDialog();
      return;
    }
    if (!propertyId || !reason || !formIsValid) {
      toast.error(t('property.report.error.invalidForm'));
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
      toast.success(t('property.report.success'));
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
          title: t('property.report.title'),
        }}
      />
      <SafeAreaView style={styles.scrollWrapper} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <Text style={[styles.intro, { color: theme.colors.textSecondary }]}>
            {t('property.report.intro')}
          </Text>

          {property ? (
            <Card variant="outlined" radius="radius-16">
              <CardHeader>
                <CardTitle>{propertyTitle}</CardTitle>
                <CardDescription>
                  {property.address?.cityName}
                  {property.address?.countryName ? `, ${property.address.countryName}` : ''}
                </CardDescription>
              </CardHeader>
            </Card>
          ) : null}

          <Field label={t('property.report.section.reason')} required>
            <RadioGroup
              variant="card"
              label={t('property.report.section.reason')}
              value={reason ?? undefined}
              onValueChange={setReason}
              options={reasonOptions}
            />
          </Field>

          <Textarea
            label={
              detailsRequired
                ? t('property.report.section.detailsRequired')
                : t('property.report.section.details')
            }
            required={detailsRequired}
            hint={t('property.report.section.detailsHelp')}
            value={details}
            onChangeText={setDetails}
            placeholder={t('property.report.field.detailsPlaceholder')}
            rows={5}
            maxLength={MAX_DETAILS_LENGTH}
            showCount
          />

          <Field
            label={t('property.report.section.contact')}
            description={t('property.report.section.contactHelp')}
          >
            <TextField isInvalid={emailInvalid}>
              <TextFieldIcon icon={RiMailLine} />
              <TextFieldInput
                label={t('property.report.section.contact')}
                value={contactEmail}
                onChangeText={setContactEmail}
                placeholder="you@example.com"
                inputMode="email"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </TextField>
          </Field>

          <View style={styles.noticeRow}>
            <RiShieldCheckLine width={18} height={18} fill={theme.colors.textSecondary} />
            <Text style={[styles.noticeText, { color: theme.colors.textSecondary }]}>
              {t('property.report.notice')}
            </Text>
          </View>

          <Button
            onPress={handleSubmit}
            disabled={!formIsValid || isSubmitting}
            loading={isSubmitting}
            variant="primary"
            size="large"
          >
            {t('property.report.actions.submit')}
          </Button>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scrollWrapper: {
    flex: 1,
  },
  scrollContent: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    padding: spacing.lg,
    paddingBottom: spacing['4xl'],
    gap: spacing.lg,
  },
  intro: {
    fontSize: 14,
    lineHeight: 20,
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
  },
});
