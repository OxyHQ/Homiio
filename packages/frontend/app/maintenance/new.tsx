/**
 * Report a repair (#518 §7.1, #519 §7.1).
 *
 * Reached from the repairs section of My home, which supplies the `lease` the
 * request is filed against. The LEASE is the parameter and the property is not:
 * the server takes `propertyId` from the tenancy, so a form that carried one
 * would be offering a field the API refuses to read — and the shape
 * `AGENTS.md` forbids, wearing a different name.
 *
 * Mirrors `properties/[id]/report.tsx`: `Header`, Bloom `Field` + `RadioGroup`
 * + `Textarea`, the same auth gate, `useMutation`, and the shared toast and
 * `ApiError` handling. No `useEffect`; form state is local and validity is
 * derived.
 */
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@oxy.so/bloom/button';
import { Field } from '@oxy.so/bloom/field';
import { RadioGroup, type RadioOption } from '@oxy.so/bloom/radio';
import { TextField, TextFieldInput } from '@oxy.so/bloom/text-field';
import { Textarea } from '@oxy.so/bloom/textarea';
import { toast } from '@oxy.so/bloom/toast';
import { openAccountDialog, useOxy } from '@oxy.so/services';
import {
  MAINTENANCE_CATEGORIES,
  MAINTENANCE_DESCRIPTION_MAX,
  MAINTENANCE_TITLE_MAX,
  MAINTENANCE_URGENCIES,
  type MaintenanceCategory,
  type MaintenanceUrgency,
} from '@homiio/shared-types';

import { Header } from '@/components/Header';
import { EmptyState } from '@/components/ui/EmptyState';
import { useReportRepair } from '@/hooks/useMaintenanceQueries';
import {
  maintenanceCategoryKey,
  maintenanceUrgencyKey,
} from '@/components/tenancy/maintenanceTenancy';
import { spacing } from '@/constants/styles';

export default function ReportRepairScreen(): React.ReactElement {
  const { t } = useTranslation();
  const router = useRouter();
  const { lease } = useLocalSearchParams<{ lease?: string }>();
  const { isAuthenticated } = useOxy();
  const report = useReportRepair();

  const [category, setCategory] = useState<MaintenanceCategory>('plumbing');
  const [urgency, setUrgency] = useState<MaintenanceUrgency>('normal');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const categoryOptions: RadioOption<MaintenanceCategory>[] = useMemo(
    () =>
      MAINTENANCE_CATEGORIES.map((value) => ({
        value,
        label: t(maintenanceCategoryKey(value)),
      })),
    [t],
  );

  const urgencyOptions: RadioOption<MaintenanceUrgency>[] = useMemo(
    () =>
      MAINTENANCE_URGENCIES.map((value) => ({
        value,
        label: t(maintenanceUrgencyKey(value)),
        // Only the most severe carries a warning, and it is the tenant's own
        // claim about their home. A description on every level would read as
        // triage guidance nobody asked this screen for.
        ...(value === 'emergency' ? { description: t('maintenance.urgency.emergencyHint') } : {}),
      })),
    [t],
  );

  const canSubmit =
    title.trim().length > 0 && description.trim().length > 0 && !report.isPending;

  const submit = (): void => {
    if (!lease || !canSubmit) return;
    report.mutate(
      { leaseId: lease, category, urgency, title: title.trim(), description: description.trim() },
      {
        onSuccess: (request) => {
          toast.success(t('maintenance.report.sent'));
          // REPLACE, not push: the form is finished and Back from the request
          // should return to My home rather than to an empty form.
          router.replace(`/maintenance/${request.id}`);
        },
        onError: () => toast.error(t('maintenance.errors.reportFailed')),
      },
    );
  };

  if (!isAuthenticated) {
    return (
      <SafeAreaView style={styles.screen}>
        <Header options={{ title: t('maintenance.report.title') }} />
        <EmptyState
          title={t('sindi.auth.required')}
          description={t('sindi.auth.message')}
          actionText={t('common.signIn')}
          onAction={() => openAccountDialog()}
        />
      </SafeAreaView>
    );
  }

  if (!lease) {
    // A repair is filed against a TENANCY. With no lease there is nothing to
    // file it against, and inventing one is not available.
    return (
      <SafeAreaView style={styles.screen}>
        <Header options={{ title: t('maintenance.report.title') }} />
        <EmptyState
          title={t('maintenance.report.noLeaseTitle')}
          description={t('maintenance.report.noLeaseBody')}
          actionText={t('maintenance.report.goToMyHome')}
          onAction={() => router.replace('/my-home')}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <Header options={{ title: t('maintenance.report.title') }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Field label={t('maintenance.field.title')}>
          <TextField>
            {/* The accessible name goes on the INPUT, which is what Bloom's
                `TextFieldInput` requires and what `report.tsx` does; `Field`
                renders the visible label above it. */}
            <TextFieldInput
              label={t('maintenance.field.title')}
              value={title}
              onChangeText={setTitle}
              maxLength={MAINTENANCE_TITLE_MAX}
              placeholder={t('maintenance.field.titlePlaceholder')}
            />
          </TextField>
        </Field>

        <Field
          label={t('maintenance.field.description')}
          description={t('maintenance.field.descriptionHint')}
        >
          <Textarea
            value={description}
            onChangeText={setDescription}
            maxLength={MAINTENANCE_DESCRIPTION_MAX}
            placeholder={t('maintenance.field.descriptionPlaceholder')}
          />
        </Field>

        <Field label={t('maintenance.field.category')}>
          <RadioGroup options={categoryOptions} value={category} onValueChange={setCategory} />
        </Field>

        <Field label={t('maintenance.field.urgency')}>
          <RadioGroup options={urgencyOptions} value={urgency} onValueChange={setUrgency} />
        </Field>

        <View style={styles.footer}>
          <Button
            variant="primary"
            size="medium"
            disabled={!canSubmit}
            loading={report.isPending}
            onPress={submit}
            accessibilityLabel={t('maintenance.report.submitAccessible')}
          >
            {t('maintenance.report.submit')}
          </Button>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: spacing.lg, padding: spacing.lg, paddingBottom: spacing['3xl'] },
  footer: { flexDirection: 'row' },
});
