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
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { toast } from '@/lib/sonner';
import { Button } from '@oxyhq/bloom/button';
import { Chip } from '@oxyhq/bloom/chip';

import {
  EmploymentStatus,
  ReferenceRelationship,
  TenantApplicationDocumentType,
} from '@homiio/shared-types';
import { Header } from '@/components/Header';
import { ThemedText } from '@/components/ThemedText';
import { colors } from '@/styles/colors';
import { useProperty } from '@/hooks';
import { useCreateApplicationMutation } from '@/hooks/useApplicationQueries';
import {
  ApplicationDocumentUpload,
  ApplicationReferenceInput,
} from '@/services/applicationService';
import { useOxy, openAccountDialog } from '@oxyhq/services';
import { generatePropertyTitle } from '@/utils/propertyTitleGenerator';
import { PropertyType } from '@homiio/shared-types';
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

const IconComponent = Ionicons as unknown as React.ComponentType<{
  name: string;
  size?: number;
  color?: string;
  style?: object;
}>;

type ReferenceFormState = ApplicationReferenceInput;

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
  };
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
  const { t } = useTranslation();
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
      phone: ref.phone.trim(),
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
            <View style={styles.propertyCard}>
              <ThemedText style={styles.propertyTitle}>{propertyTitle}</ThemedText>
              <ThemedText style={styles.propertyLocation}>
                {property.address?.cityName}
                {property.address?.countryName ? `, ${property.address.countryName}` : ''}
              </ThemedText>
              {property.longTermRent && (
                <ThemedText style={styles.propertyPrice}>
                  {property.longTermRent.currency || ''}
                  {property.longTermRent.monthlyAmount}
                  {' / '}
                  {t('common.month')}
                </ThemedText>
              )}
            </View>
          )}

          <Section title={t('applications.section.timing')}>
            <FieldLabel>{t('applications.field.moveInDate')}</FieldLabel>
            <TextInput
              style={styles.input}
              value={moveInDate}
              onChangeText={setMoveInDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.COLOR_BLACK_LIGHT_3}
              autoCapitalize="none"
              autoCorrect={false}
              inputMode="numeric"
              maxLength={10}
            />
            <ThemedText style={styles.helperText}>
              {t('applications.field.moveInHelper')}
            </ThemedText>

            <FieldLabel>{t('applications.field.leaseTerm')}</FieldLabel>
            <View style={styles.chipRow}>
              {LEASE_PRESET_MONTHS.map((preset) => {
                const isActive = !usingCustomTerm && leaseTermMonths === preset;
                return (
                  <Chip
                    key={preset}
                    selected={isActive}
                    onPress={() => {
                      setUsingCustomTerm(false);
                      setLeaseTermMonths(preset);
                    }}
                    style={styles.chip}
                  >
                    {t('applications.field.leaseTermMonths', { count: preset })}
                  </Chip>
                );
              })}
              <Chip
                selected={usingCustomTerm}
                onPress={() => setUsingCustomTerm(true)}
                style={styles.chip}
              >
                {t('applications.field.leaseTermCustom')}
              </Chip>
            </View>
            {usingCustomTerm && (
              <TextInput
                style={styles.input}
                value={leaseTermCustom}
                onChangeText={(text) => setLeaseTermCustom(text.replace(/[^0-9]/g, ''))}
                placeholder={t('applications.field.leaseTermCustomPlaceholder')}
                placeholderTextColor={colors.COLOR_BLACK_LIGHT_3}
                inputMode="numeric"
                maxLength={2}
              />
            )}
          </Section>

          <Section title={t('applications.section.finances')}>
            <FieldLabel>{t('applications.field.monthlyIncome')}</FieldLabel>
            <TextInput
              style={styles.input}
              value={monthlyIncome}
              onChangeText={setMonthlyIncome}
              placeholder={t('applications.field.monthlyIncomePlaceholder')}
              placeholderTextColor={colors.COLOR_BLACK_LIGHT_3}
              inputMode="decimal"
              keyboardType="decimal-pad"
            />

            <FieldLabel>{t('applications.field.employment')}</FieldLabel>
            <View style={styles.chipRow}>
              {EMPLOYMENT_OPTIONS.map((option) => (
                <Chip
                  key={option.value}
                  selected={employmentStatus === option.value}
                  onPress={() => setEmploymentStatus(option.value)}
                  style={styles.chip}
                >
                  {t(option.labelKey)}
                </Chip>
              ))}
            </View>
          </Section>

          <Section
            title={t('applications.section.references')}
            description={t('applications.section.referencesHelp')}
          >
            {references.map((reference, index) => (
              <View key={index} style={styles.referenceCard}>
                <View style={styles.referenceHeader}>
                  <ThemedText style={styles.referenceTitle}>
                    {t('applications.field.referenceIndex', { index: index + 1 })}
                  </ThemedText>
                  {references.length > 1 && (
                    <Pressable
                      onPress={() => handleRemoveReference(index)}
                      accessibilityLabel={t('applications.field.removeReference')}
                      hitSlop={8}
                    >
                      <IconComponent name="close" size={18} color={colors.COLOR_BLACK_LIGHT_3} />
                    </Pressable>
                  )}
                </View>
                <FieldLabel>{t('applications.field.name')}</FieldLabel>
                <TextInput
                  style={styles.input}
                  value={reference.name}
                  onChangeText={(value) => handleReferenceChange(index, { name: value })}
                  placeholder={t('applications.field.namePlaceholder')}
                  placeholderTextColor={colors.COLOR_BLACK_LIGHT_3}
                  autoCapitalize="words"
                />
                <FieldLabel>{t('applications.field.relationship')}</FieldLabel>
                <View style={styles.chipRow}>
                  {RELATIONSHIP_OPTIONS.map((option) => (
                    <Chip
                      key={option.value}
                      selected={reference.relationship === option.value}
                      onPress={() => handleReferenceChange(index, { relationship: option.value })}
                      style={styles.chip}
                    >
                      {t(option.labelKey)}
                    </Chip>
                  ))}
                </View>
                <FieldLabel>{t('applications.field.phone')}</FieldLabel>
                <TextInput
                  style={styles.input}
                  value={reference.phone}
                  onChangeText={(value) => handleReferenceChange(index, { phone: value })}
                  placeholder="+34 600 000 000"
                  placeholderTextColor={colors.COLOR_BLACK_LIGHT_3}
                  inputMode="tel"
                  keyboardType="phone-pad"
                />
                <FieldLabel>{t('applications.field.email')}</FieldLabel>
                <TextInput
                  style={styles.input}
                  value={reference.email}
                  onChangeText={(value) => handleReferenceChange(index, { email: value })}
                  placeholder="reference@example.com"
                  placeholderTextColor={colors.COLOR_BLACK_LIGHT_3}
                  inputMode="email"
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>
            ))}
            {references.length < 3 && (
              <Button
                variant="secondary"
                onPress={handleAddReference}
                icon={<IconComponent name="add" size={16} color={colors.primaryDark} />}
                style={styles.secondaryAction}
              >
                {t('applications.field.addReference')}
              </Button>
            )}
          </Section>

          <Section
            title={t('applications.section.documents')}
            description={t('applications.section.documentsHelp',
              { max: MAX_DOCUMENTS },)}
          >
            <Button
              variant="secondary"
              onPress={handlePickDocuments}
              disabled={documents.length >= MAX_DOCUMENTS}
              icon={<IconComponent name="cloud-upload-outline" size={16} color={colors.primaryDark} />}
              style={styles.secondaryAction}
            >
              {t('applications.field.pickDocuments')}
            </Button>
            {documents.map((doc) => (
              <View key={doc.id} style={styles.documentCard}>
                <View style={styles.documentHeader}>
                  <IconComponent
                    name={doc.mimeType?.startsWith('image/') ? 'image-outline' : 'document-text-outline'}
                    size={18}
                    color={colors.primaryDark}
                  />
                  <ThemedText style={styles.documentName} numberOfLines={1}>
                    {doc.filename}
                  </ThemedText>
                  <Pressable
                    onPress={() => handleRemoveDocument(doc.id)}
                    accessibilityLabel={t('applications.field.removeDocument')}
                    hitSlop={8}
                  >
                    <IconComponent name="close" size={18} color={colors.COLOR_BLACK_LIGHT_3} />
                  </Pressable>
                </View>
                {formatDocumentSize(doc.sizeBytes) && (
                  <ThemedText style={styles.documentMeta}>
                    {formatDocumentSize(doc.sizeBytes)}
                  </ThemedText>
                )}
                <View style={styles.chipRow}>
                  {DOCUMENT_TYPE_OPTIONS.map((option) => (
                    <Chip
                      key={option.value}
                      selected={doc.type === option.value}
                      onPress={() => handleDocumentTypeChange(doc.id, option.value)}
                      style={styles.chip}
                    >
                      {t(option.labelKey)}
                    </Chip>
                  ))}
                </View>
              </View>
            ))}
          </Section>

          <Section title={t('applications.section.notes')}>
            <TextInput
              style={[styles.input, styles.notesInput]}
              value={notes}
              onChangeText={setNotes}
              placeholder={t('applications.field.notesPlaceholder')}
              placeholderTextColor={colors.COLOR_BLACK_LIGHT_3}
              multiline
              numberOfLines={4}
              maxLength={4000}
            />
          </Section>

          <Button
            onPress={handleSubmit}
            disabled={!formIsValid || isSubmitting}
            loading={isSubmitting}
            variant="primary"
            size="large"
            style={styles.submitButton}
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
    <View style={styles.section}>
      <ThemedText style={styles.sectionTitle}>{title}</ThemedText>
      {description && <ThemedText style={styles.sectionDescription}>{description}</ThemedText>}
      {children}
    </View>
  );
}

function FieldLabel({ children }: React.PropsWithChildren) {
  return <ThemedText style={styles.fieldLabel}>{children}</ThemedText>;
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
    padding: 16,
    paddingBottom: 40,
    gap: 16,
  },
  propertyCard: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 16,
    gap: 4,
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
  propertyPrice: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primaryColor,
    marginTop: 4,
  },
  section: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 16,
    gap: 12,
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
  fieldLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.COLOR_BLACK,
    marginTop: 4,
  },
  helperText: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  input: {
    backgroundColor: colors.COLOR_BACKGROUND,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'web' ? 12 : 10,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    fontSize: 15,
    color: colors.COLOR_BLACK,
  },
  notesInput: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    marginRight: 0,
  },
  referenceCard: {
    gap: 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
  },
  referenceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  referenceTitle: {
    fontWeight: '700',
    fontSize: 14,
    color: colors.COLOR_BLACK,
  },
  documentCard: {
    gap: 8,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.COLOR_BLACK_LIGHT_6,
  },
  documentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  documentName: {
    flex: 1,
    fontSize: 14,
    color: colors.COLOR_BLACK,
  },
  documentMeta: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  secondaryAction: {
    alignSelf: 'flex-start',
  },
  submitButton: {
    marginTop: 8,
  },
});
