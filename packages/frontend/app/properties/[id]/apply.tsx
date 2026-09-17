/**
 * Long-term tenant application form.
 *
 * Default entry point from a property detail in long-term rent mode
 * (Idealista/Fotocasa style). The applicant supplies move-in intent,
 * income/employment, reference contacts and optional supporting documents
 * (ID, payslips, prior-landlord references); a single multipart POST to
 * `/api/applications` uploads the files and creates the application.
 */
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { toast } from '@oxy.so/bloom/toast';
import { Button } from '@oxy.so/bloom/button';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@oxy.so/bloom/card';
import { Chip } from '@oxy.so/bloom/chip';
import { DatePicker } from '@oxy.so/bloom/date-picker';
import { Field } from '@oxy.so/bloom/field';
import {
  RiAddLine,
  RiCloseLine,
  RiFileTextLine,
  RiImageLine,
  RiMailLine,
  RiUploadCloud2Line,
} from '@oxy.so/bloom/icons';
import { Item } from '@oxy.so/bloom/item';
import { PhoneInput, findCountry } from '@oxy.so/bloom/phone-input';
import { TextField, TextFieldIcon, TextFieldInput } from '@oxy.so/bloom/text-field';
import { Textarea } from '@oxy.so/bloom/textarea';
import { useTheme } from '@oxy.so/bloom/theme';
import { Text } from '@oxy.so/bloom/typography';

import {
  EmploymentStatus,
  ReferenceRelationship,
  TenantApplicationDocumentType,
 PropertyType } from '@homiio/shared-types';
import { Header } from '@/components/Header';
import { useProperty } from '@/hooks';
import { useCreateApplicationMutation } from '@/hooks/useApplicationQueries';
import {
  ApplicationDocumentUpload,
  ApplicationReferenceInput,
} from '@/services/applicationService';
import { useOxy, openAccountDialog } from '@oxy.so/services';
import { generatePropertyTitle } from '@/utils/propertyTitleGenerator';
import { ApiError } from '@/utils/api';

const MAX_DOCUMENTS = 10;
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024; // 10 MB
const MIN_LEASE_MONTHS = 1;
const MAX_LEASE_MONTHS = 60;
const LEASE_PRESET_MONTHS: number[] = [3, 6, 12, 18, 24];
const MOVE_IN_MAX_OFFSET_DAYS = 180; // ~6 months

const EMPLOYMENT_OPTIONS: { value: EmploymentStatus; labelKey: string }[] = [
  { value: EmploymentStatus.EMPLOYED, labelKey: 'applications.employment.employed' },
  { value: EmploymentStatus.SELF_EMPLOYED, labelKey: 'applications.employment.selfEmployed' },
  { value: EmploymentStatus.STUDENT, labelKey: 'applications.employment.student' },
  { value: EmploymentStatus.RETIRED, labelKey: 'applications.employment.retired' },
  { value: EmploymentStatus.UNEMPLOYED, labelKey: 'applications.employment.unemployed' },
  { value: EmploymentStatus.OTHER, labelKey: 'applications.employment.other' },
];

const RELATIONSHIP_OPTIONS: { value: ReferenceRelationship; labelKey: string }[] = [
  { value: ReferenceRelationship.LANDLORD, labelKey: 'applications.relationship.landlord' },
  { value: ReferenceRelationship.EMPLOYER, labelKey: 'applications.relationship.employer' },
  { value: ReferenceRelationship.PERSONAL, labelKey: 'applications.relationship.personal' },
  { value: ReferenceRelationship.OTHER, labelKey: 'applications.relationship.other' },
];

const DOCUMENT_TYPE_OPTIONS: { value: TenantApplicationDocumentType; labelKey: string }[] = [
  { value: TenantApplicationDocumentType.ID, labelKey: 'applications.docType.id' },
  { value: TenantApplicationDocumentType.INCOME, labelKey: 'applications.docType.income' },
  { value: TenantApplicationDocumentType.REFERENCE, labelKey: 'applications.docType.reference' },
  { value: TenantApplicationDocumentType.OTHER, labelKey: 'applications.docType.other' },
];

/** Reference phones default to Spain, the market the form's copy is written for. */
const DEFAULT_PHONE_COUNTRY = 'ES';

/**
 * `phone` holds the number as typed in `PhoneInput` (no dial code) and
 * `phoneCountry` the picked ISO code; `composePhone` joins them back into the
 * single international string the API stores.
 */
type ReferenceFormState = ApplicationReferenceInput & { phoneCountry: string };

type DocumentDraft = ApplicationDocumentUpload & {
  id: string;
  sizeBytes?: number;
};

function makeBlankReference(): ReferenceFormState {
  return {
    name: '',
    relationship: ReferenceRelationship.PERSONAL,
    phone: '',
    email: '',
    phoneCountry: DEFAULT_PHONE_COUNTRY,
  };
}

function composePhone(number: string, iso2: string): string {
  const trimmed = number.trim();
  if (!trimmed || trimmed.startsWith('+')) return trimmed;
  const dial = findCountry(iso2)?.dial;
  return dial ? `+${dial} ${trimmed}` : trimmed;
}

/** Local calendar day as `YYYY-MM-DD` (the form's stored move-in format). */
function toLocalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function fromLocalDateString(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function inferDocumentType(filename: string): TenantApplicationDocumentType {
  const lower = filename.toLowerCase();
  if (lower.includes('id') || lower.includes('passport') || lower.includes('license')) {
    return TenantApplicationDocumentType.ID;
  }
  if (lower.includes('pay') || lower.includes('salary') || lower.includes('income') || lower.includes('tax')) {
    return TenantApplicationDocumentType.INCOME;
  }
  if (lower.includes('reference') || lower.includes('letter')) {
    return TenantApplicationDocumentType.REFERENCE;
  }
  return TenantApplicationDocumentType.OTHER;
}

function getMoveInBounds() {
  const now = new Date();
  const min = new Date(now);
  min.setHours(0, 0, 0, 0);
  const max = new Date(now);
  max.setDate(max.getDate() + MOVE_IN_MAX_OFFSET_DAYS);
  max.setHours(23, 59, 59, 999);
  return { min, max };
}

function toIsoDate(value: string): string | null {
  const [yy, mm, dd] = value.split('-').map((part) => parseInt(part, 10));
  if (!yy || !mm || !dd) return null;
  const date = new Date(Date.UTC(yy, mm - 1, dd, 12, 0, 0));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function formatDocumentSize(bytes?: number): string | null {
  if (bytes == null) return null;
  const k = 1024;
  if (bytes < k) return `${bytes} B`;
  if (bytes < k * k) return `${(bytes / k).toFixed(1)} KB`;
  return `${(bytes / (k * k)).toFixed(1)} MB`;
}

export default function ApplyToRentScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { id, moveIn } = useLocalSearchParams<{ id: string; moveIn?: string }>();
  const { isAuthenticated } = useOxy();
  const propertyId = Array.isArray(id) ? id[0] : id;
  const { property } = useProperty(propertyId ?? '');

  // The detail card can pre-fill the move-in date (`YYYY-MM-DD`) so the user
  // doesn't re-enter it here; we still let them edit it on the form.
  const initialMoveIn = Array.isArray(moveIn) ? moveIn[0] : moveIn;
  const [moveInDate, setMoveInDate] = useState(
    initialMoveIn && /^\d{4}-\d{2}-\d{2}$/.test(initialMoveIn) ? initialMoveIn : '',
  );
  const [leaseTermMonths, setLeaseTermMonths] = useState(12);
  const [leaseTermCustom, setLeaseTermCustom] = useState('');
  const [usingCustomTerm, setUsingCustomTerm] = useState(false);
  const [monthlyIncome, setMonthlyIncome] = useState('');
  const [employmentStatus, setEmploymentStatus] = useState<EmploymentStatus>(
    EmploymentStatus.EMPLOYED,
  );
  const [notes, setNotes] = useState('');
  const [references, setReferences] = useState<ReferenceFormState[]>([
    makeBlankReference(),
  ]);
  const [documents, setDocuments] = useState<DocumentDraft[]>([]);

  const createMutation = useCreateApplicationMutation();
  const isSubmitting = createMutation.isPending;

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

  const moveInBounds = useMemo(() => getMoveInBounds(), []);
  const moveInDateValue = useMemo(() => fromLocalDateString(moveInDate), [moveInDate]);

  const monthlyIncomeNumber = useMemo(() => {
    const parsed = parseFloat(monthlyIncome.replace(/,/g, '.'));
    if (Number.isNaN(parsed)) return null;
    return parsed;
  }, [monthlyIncome]);

  const effectiveTermMonths = useMemo(() => {
    if (!usingCustomTerm) return leaseTermMonths;
    const parsed = parseInt(leaseTermCustom, 10);
    if (!Number.isFinite(parsed)) return null;
    return parsed;
  }, [leaseTermCustom, leaseTermMonths, usingCustomTerm]);

  const formIsValid = useMemo(() => {
    if (!propertyId) return false;
    if (!moveInDate) return false;
    const iso = toIsoDate(moveInDate);
    if (!iso) return false;
    const parsed = new Date(iso);
    if (parsed.getTime() < moveInBounds.min.getTime()) return false;
    if (parsed.getTime() > moveInBounds.max.getTime()) return false;
    if (effectiveTermMonths == null) return false;
    if (effectiveTermMonths < MIN_LEASE_MONTHS || effectiveTermMonths > MAX_LEASE_MONTHS) return false;
    if (monthlyIncomeNumber == null || monthlyIncomeNumber < 0) return false;
    if (references.length === 0) return false;
    return references.every(
      (ref) => ref.name.trim() && ref.phone.trim() && /\S+@\S+\.\S+/.test(ref.email),
    );
  }, [
    propertyId,
    moveInDate,
    effectiveTermMonths,
    monthlyIncomeNumber,
    references,
    moveInBounds,
  ]);

  const handleReferenceChange = (index: number, patch: Partial<ReferenceFormState>) => {
    setReferences((prev) =>
      prev.map((reference, i) => (i === index ? { ...reference, ...patch } : reference)),
    );
  };

  const handleAddReference = () => {
    if (references.length >= 3) return;
    setReferences((prev) => [...prev, makeBlankReference()]);
  };

  const handleRemoveReference = (index: number) => {
    setReferences((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)));
  };

  const handleDocumentTypeChange = (id: string, type: TenantApplicationDocumentType) => {
    setDocuments((prev) =>
      prev.map((doc) => (doc.id === id ? { ...doc, type } : doc)),
    );
  };

  const handleRemoveDocument = (id: string) => {
    setDocuments((prev) => prev.filter((doc) => doc.id !== id));
  };

  const handlePickDocuments = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*'],
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const assets = result.assets ?? [];
      const remaining = MAX_DOCUMENTS - documents.length;
      const slice = assets.slice(0, remaining);
      const next: DocumentDraft[] = [];
      for (const asset of slice) {
        if (asset.size != null && asset.size > MAX_DOCUMENT_BYTES) {
          toast.error(
            t('applications.documents.tooLarge', { name: asset.name }),
          );
          continue;
        }
        const inferredType = inferDocumentType(asset.name ?? 'file');
        next.push({
          id: `${Date.now()}-${asset.name}-${next.length}`,
          uri: asset.uri,
          filename: asset.name ?? 'document',
          mimeType: asset.mimeType ?? undefined,
          type: inferredType,
          file: asset.file,
          sizeBytes: asset.size,
        });
      }
      if (slice.length < assets.length) {
        toast.error(
          t('applications.documents.limit', { max: MAX_DOCUMENTS }),
        );
      }
      if (next.length > 0) {
        setDocuments((prev) => [...prev, ...next]);
      }
    } catch {
      toast.error(t('applications.documents.pickFailed'));
    }
  };

  const extractError = (err: unknown): string => {
    if (err instanceof ApiError) {
      const response = err.response as { error?: { code?: string }; code?: string } | undefined;
      const code = response?.error?.code || response?.code;
      if (code === 'ALREADY_APPLIED') {
        return t('applications.error.alreadyApplied');
      }
      if (code === 'EXTERNAL_PROPERTY') {
        return t('applications.error.external');
      }
      if (code === 'NOT_APPLICABLE') {
        return t('applications.error.notApplicable');
      }
      if (code === 'AUTHENTICATION_REQUIRED') {
        return t('applications.error.auth');
      }
      return err.message;
    }
    if (err instanceof Error) return err.message;
    return t('applications.error.generic');
  };

  const handleSubmit = async () => {
    if (!isAuthenticated) {
      openAccountDialog();
      return;
    }
    if (!propertyId) return;
    if (!formIsValid) {
      toast.error(t('applications.error.invalidForm'));
      return;
    }
    const moveInIso = toIsoDate(moveInDate);
    if (!moveInIso || effectiveTermMonths == null || monthlyIncomeNumber == null) {
      toast.error(t('applications.error.invalidForm'));
      return;
    }
    const referencePayload: ApplicationReferenceInput[] = references.map((ref) => ({
      name: ref.name.trim(),
      relationship: ref.relationship,
      phone: composePhone(ref.phone, ref.phoneCountry),
      email: ref.email.trim(),
    }));
    try {
      const documentPayload: ApplicationDocumentUpload[] = documents.map((doc) => ({
        type: doc.type,
        filename: doc.filename,
        uri: doc.uri,
        mimeType: doc.mimeType,
        file: doc.file,
      }));
      const created = await createMutation.mutateAsync({
        propertyId,
        moveInDate: moveInIso,
        leaseTermMonths: effectiveTermMonths,
        monthlyIncome: monthlyIncomeNumber,
        employmentStatus,
        referenceContacts: referencePayload,
        documents: documentPayload,
        notes: notes.trim() || undefined,
      });
      toast.success(t('applications.success.submitted'));
      router.replace({ pathname: '/applications/[id]', params: { id: String(created.id) } });
    } catch (err) {
      toast.error(extractError(err));
    }
  };

  return (
    <View style={styles.root}>
      <Header
        options={{
          showBackButton: true,
          title: t('applications.apply.title'),
        }}
      />
      <SafeAreaView style={styles.scrollWrapper} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          {property && (
            <Card variant="outlined" radius="radius-16">
              <CardHeader>
                <CardTitle>{propertyTitle}</CardTitle>
                <CardDescription>
                  {property.address?.cityName}
                  {property.address?.countryName ? `, ${property.address.countryName}` : ''}
                </CardDescription>
                {property.longTermRent && (
                  <Text style={[styles.propertyPrice, { color: theme.colors.primary }]}>
                    {property.longTermRent.currency || ''}
                    {property.longTermRent.monthlyAmount}
                    {' / '}
                    {t('common.month')}
                  </Text>
                )}
              </CardHeader>
            </Card>
          )}

          <Section title={t('applications.section.timing')}>
            <Field
              label={t('applications.field.moveInDate')}
              description={t('applications.field.moveInHelper')}
            >
              <DatePicker
                value={moveInDateValue}
                onChange={(date) => setMoveInDate(date ? toLocalDateString(date) : '')}
                minDate={moveInBounds.min}
                maxDate={moveInBounds.max}
                locale={i18n.language}
                weekStartsOn={1}
                placeholder={t('applications.cta.addMoveIn')}
                accessibilityLabel={t('applications.field.moveInDate')}
              />
            </Field>

            <Field label={t('applications.field.leaseTerm')}>
              <View style={styles.chipRow}>
                {LEASE_PRESET_MONTHS.map((preset) => {
                  const isActive = !usingCustomTerm && leaseTermMonths === preset;
                  return (
                    <Chip
                      key={preset}
                      selected={isActive}

                      variant={isActive ? 'solid' : 'outlined'}
                      onPress={() => {
                        setUsingCustomTerm(false);
                        setLeaseTermMonths(preset);
                      }}
                    >
                      {t('applications.field.leaseTermMonths', { count: preset })}
                    </Chip>
                  );
                })}
                <Chip
                  selected={usingCustomTerm}
                  variant={usingCustomTerm ? 'solid' : 'outlined'}
                  onPress={() => setUsingCustomTerm(true)}
                >
                  {t('applications.field.leaseTermCustom')}
                </Chip>
              </View>
            </Field>
            {usingCustomTerm && (
              <TextFieldInput
                label={t('applications.field.leaseTermCustom')}
                value={leaseTermCustom}
                onChangeText={(text) => setLeaseTermCustom(text.replace(/[^0-9]/g, ''))}
                placeholder={t('applications.field.leaseTermCustomPlaceholder')}
                inputMode="numeric"
                maxLength={2}
              />
            )}
          </Section>

          <Section title={t('applications.section.finances')}>
            <Field label={t('applications.field.monthlyIncome')}>
              <TextFieldInput
                label={t('applications.field.monthlyIncome')}
                value={monthlyIncome}
                onChangeText={setMonthlyIncome}
                placeholder={t('applications.field.monthlyIncomePlaceholder')}
                inputMode="decimal"
                keyboardType="decimal-pad"
              />
            </Field>

            <Field label={t('applications.field.employment')}>
              <View style={styles.chipRow}>
                {EMPLOYMENT_OPTIONS.map((option) => (
                  <Chip
                    key={option.value}
                    selected={employmentStatus === option.value}

                    variant={employmentStatus === option.value ? 'solid' : 'outlined'}
                    onPress={() => setEmploymentStatus(option.value)}
                  >
                    {t(option.labelKey)}
                  </Chip>
                ))}
              </View>
            </Field>
          </Section>

          <Section
            title={t('applications.section.references')}
            description={t('applications.section.referencesHelp')}
          >
            {references.map((reference, index) => (
              <Card key={index} variant="filled" radius="radius-12" style={styles.referenceCard}>
                <View style={styles.referenceHeader}>
                  <Text style={styles.referenceTitle}>
                    {t('applications.field.referenceIndex', { index: index + 1 })}
                  </Text>
                  {references.length > 1 && (
                    <Button
                      variant="ghost"
                      size="small"
                      iconOnly
                      leadingIcon={RiCloseLine}
                      onPress={() => handleRemoveReference(index)}
                      accessibilityLabel={t('applications.field.removeReference')}
                    />
                  )}
                </View>
                <Field label={t('applications.field.name')}>
                  <TextFieldInput
                    label={t('applications.field.name')}
                    value={reference.name}
                    onChangeText={(value) => handleReferenceChange(index, { name: value })}
                    placeholder={t('applications.field.namePlaceholder')}
                    autoCapitalize="words"
                  />
                </Field>
                <Field label={t('applications.field.relationship')}>
                  <View style={styles.chipRow}>
                    {RELATIONSHIP_OPTIONS.map((option) => (
                      <Chip
                        key={option.value}
                        selected={reference.relationship === option.value}

                        variant={reference.relationship === option.value ? 'solid' : 'outlined'}
                        onPress={() => handleReferenceChange(index, { relationship: option.value })}
                      >
                        {t(option.labelKey)}
                      </Chip>
                    ))}
                  </View>
                </Field>
                <PhoneInput
                  label={t('applications.field.phone')}
                  value={reference.phone}
                  onChangeText={(value) => handleReferenceChange(index, { phone: value })}
                  country={reference.phoneCountry}
                  onCountryChange={(iso2) => handleReferenceChange(index, { phoneCountry: iso2 })}
                  placeholder="600 000 000"
                />
                <Field label={t('applications.field.email')}>
                  <TextField>
                    <TextFieldIcon icon={RiMailLine} />
                    <TextFieldInput
                      label={t('applications.field.email')}
                      value={reference.email}
                      onChangeText={(value) => handleReferenceChange(index, { email: value })}
                      placeholder="reference@example.com"
                      inputMode="email"
                      keyboardType="email-address"
                      autoCapitalize="none"
                    />
                  </TextField>
                </Field>
              </Card>
            ))}
            {references.length < 3 && (
              <Button
                variant="secondary"
                onPress={handleAddReference}
                leadingIcon={RiAddLine}
                style={styles.secondaryAction}
              >
                {t('applications.field.addReference')}
              </Button>
            )}
          </Section>

          <Section
            title={t('applications.section.documents')}
            description={t('applications.section.documentsHelp', { max: MAX_DOCUMENTS })}
          >
            <Button
              variant="secondary"
              onPress={handlePickDocuments}
              disabled={documents.length >= MAX_DOCUMENTS}
              leadingIcon={RiUploadCloud2Line}
              style={styles.secondaryAction}
            >
              {t('applications.field.pickDocuments')}
            </Button>
            {documents.map((doc) => {
              const DocIcon = doc.mimeType?.startsWith('image/') ? RiImageLine : RiFileTextLine;
              return (
                <Card key={doc.id} variant="filled" radius="radius-12" style={styles.documentCard}>
                  <Item
                    density="compact"
                    leading={<DocIcon width={20} height={20} fill={theme.colors.primary} />}
                    title={doc.filename}
                    subtitle={formatDocumentSize(doc.sizeBytes) ?? undefined}
                    trailing={
                      <Button
                        variant="ghost"
                        size="small"
                        iconOnly
                        leadingIcon={RiCloseLine}
                        onPress={() => handleRemoveDocument(doc.id)}
                        accessibilityLabel={t('applications.field.removeDocument')}
                      />
                    }
                  />
                  <View style={styles.chipRow}>
                    {DOCUMENT_TYPE_OPTIONS.map((option) => (
                      <Chip
                        key={option.value}
                        size="small"
                        selected={doc.type === option.value}

                        variant={doc.type === option.value ? 'solid' : 'outlined'}
                        onPress={() => handleDocumentTypeChange(doc.id, option.value)}
                      >
                        {t(option.labelKey)}
                      </Chip>
                    ))}
                  </View>
                </Card>
              );
            })}
          </Section>

          <Section title={t('applications.section.notes')}>
            <Textarea
              accessibilityLabel={t('applications.section.notes')}
              value={notes}
              onChangeText={setNotes}
              placeholder={t('applications.field.notesPlaceholder')}
              rows={4}
              autoResize
              maxRows={12}
              maxLength={4000}
              showCount
            />
          </Section>

          <Button
            onPress={handleSubmit}
            disabled={!formIsValid || isSubmitting}
            loading={isSubmitting}
            variant="primary"
            size="large"
          >
            {t('applications.actions.submit')}
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
    <Card variant="outlined" radius="radius-16">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardBody style={styles.sectionBody}>{children}</CardBody>
    </Card>
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
    padding: 16,
    paddingBottom: 40,
    gap: 16,
  },
  propertyPrice: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 4,
  },
  sectionBody: {
    gap: 16,
    paddingBottom: 16,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  referenceCard: {
    gap: 12,
    padding: 12,
  },
  referenceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  referenceTitle: {
    fontWeight: '700',
    fontSize: 14,
  },
  documentCard: {
    gap: 8,
    padding: 8,
  },
  secondaryAction: {
    alignSelf: 'flex-start',
  },
});
