/**
 * The read-only blocks of a tenant application, shared by the applicant's view
 * (`/applications/[id]`) and the landlord's (`/landlord/applications/[id]`):
 * Bloom `SettingsListGroup`s on the page background, one per block, replacing
 * the hand-rolled label/value rows each screen used to carry.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  RiFileTextLine,
  RiMailLine,
  RiUserLine,
  RiWallet3Line,
} from '@oxy.so/bloom/icons';
import { SettingsListGroup, SettingsListItem } from '@oxy.so/bloom/settings-list';
import { Button } from '@oxy.so/bloom/button';
import { toast } from '@oxy.so/bloom/toast';
import {
  applicationChecklist,
  formatMoney,
  type TenantApplication,
  type TenantApplicationDocument,
} from '@homiio/shared-types';

import { SettingsRowIcon, type SettingsIconComponent } from '@/components/profile/SettingsRowIcon';
import { openPrivateDocument } from '@/utils/privateDocument';
import { useVerifyApplicationDocument } from '@/hooks/useApplicationQueries';
import { spacing } from '@/constants/styles';
import { formatLocalized } from '@/utils/dateLocale';
import { useFormatting } from '@/utils/format';

/** A tenant's declared income has no currency field; it is quoted in euros. */
const APPLICATION_INCOME_CURRENCY = 'EUR';
/** Income reads as a round figure — cents on a salary are noise. */
const INCOME_FORMAT = { minimumFractionDigits: 0, maximumFractionDigits: 0 } as const;

const DOCUMENT_ICON: Record<TenantApplicationDocument['type'], SettingsIconComponent> = {
  id: RiUserLine,
  income: RiWallet3Line,
  reference: RiMailLine,
  other: RiFileTextLine,
};

export const formatApplicationDate = (raw: string): string => {
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : formatLocalized(date, 'EEE, d MMM yyyy');
};

export const formatApplicationIncome = (application: TenantApplication, locale: string): string =>
  formatMoney(application.monthlyIncome, APPLICATION_INCOME_CURRENCY, locale, INCOME_FORMAT);

/**
 * Open one attached document.
 *
 * This used to be `window.open(document.url)` / `Linking.openURL(document.url)`
 * over an absolute link to `/api/images/file/<key>` — the unauthenticated route
 * that also serves listing photos — so opening a tenant's payslip took no
 * session and the link, once seen, worked forever. The bytes now come from a
 * handler that checks who is asking, which is why neither of those functions
 * can be what opens it.
 *
 * The failure is SHOWN. A silent catch here is indistinguishable from a row
 * that does nothing when pressed.
 */
const openDocument = (downloadPath: string, failedLabel: string): void => {
  void openPrivateDocument(downloadPath).catch(() => toast.error(failedLabel));
};

interface GroupProps {
  application: TenantApplication;
  /**
   * Whether the viewer is the landlord on THIS application, resolved by the
   * host screen. It decides only whether the decision buttons are drawn — the
   * server refuses a non-landlord either way, so this is presentation and not
   * authorization.
   */
  viewerIsLandlord?: boolean;
}

/** Move-in, lease term, and when it was submitted and decided. */
export const ApplicationTermsGroup: React.FC<GroupProps> = ({ application }) => {
  const { t } = useTranslation();
  return (
    <SettingsListGroup title={t('applications.landlord.sectionTenancy')}>
      <SettingsListItem
        title={t('applications.card.moveIn')}
        value={formatApplicationDate(application.moveInDate)}
      />
      <SettingsListItem
        title={t('applications.field.leaseTerm')}
        value={t('applications.field.leaseTermMonths', { count: application.leaseTermMonths })}
      />
      <SettingsListItem
        title={t('applications.landlord.submittedLabel')}
        value={formatApplicationDate(application.submittedAt)}
      />
      {application.decidedAt ? (
        <SettingsListItem
          title={t('applications.landlord.decidedLabel')}
          value={formatApplicationDate(application.decidedAt)}
        />
      ) : null}
    </SettingsListGroup>
  );
};

/** Declared income and employment. */
export const ApplicationFinancesGroup: React.FC<GroupProps> = ({ application }) => {
  const { t } = useTranslation();
  const { locale } = useFormatting();
  return (
    <SettingsListGroup title={t('applications.section.finances')}>
      <SettingsListItem
        title={t('applications.field.monthlyIncome')}
        value={formatApplicationIncome(application, locale)}
      />
      <SettingsListItem
        title={t('applications.field.employment')}
        value={t(`profile.edit.options.employmentStatus.${application.employmentStatus}`)}
      />
    </SettingsListGroup>
  );
};

/** The references the applicant gave: name, relationship, phone and email. */
export const ApplicationReferencesGroup: React.FC<GroupProps> = ({ application }) => {
  const { t } = useTranslation();
  return (
    <SettingsListGroup title={t('applications.section.references')}>
      {application.referenceContacts.length === 0 ? (
        <SettingsListItem title={t('applications.landlord.noReferences')} />
      ) : (
        application.referenceContacts.map((reference, index) => (
          <SettingsListItem
            key={`${reference.email}-${index}`}
            title={reference.name}
            description={[
              [
                t(`profile.edit.options.referenceRelationship.${reference.relationship}`),
                reference.phone,
              ]
                .filter(Boolean)
                .join(' · '),
              reference.email,
            ]
              .filter(Boolean)
              .join('\n')}
          />
        ))
      )}
    </SettingsListGroup>
  );
};

/**
 * The CHECKLIST: what was asked for, what arrived, and what has been checked
 * (#518 §7.4).
 *
 * Three facts, and they are three because they can disagree. A landlord asks
 * for proof of income; the applicant uploads something; somebody has to open it
 * and decide it is what was asked for. Every one of those states comes from the
 * server — `applicationChecklist` is the same function the backend's contract
 * defines, run over the same two fields — so this screen cannot tick a box the
 * data does not support.
 *
 * §7.4: "Pulsar un botón no convierte localmente un documento en verificado."
 * The verify and reject buttons below call the server and re-read; there is no
 * local state that could disagree with it, which is why there is no optimistic
 * update here.
 *
 * Each row fetches its bytes through the authenticated API and hands them to
 * the platform. There is no link to hand out.
 */
export const ApplicationDocumentsGroup: React.FC<GroupProps> = ({ application, viewerIsLandlord }) => {
  const { t } = useTranslation();
  const verify = useVerifyApplicationDocument(application.id);
  const [busyId, setBusyId] = useState<string | null>(null);

  const items = useMemo(
    () =>
      applicationChecklist(
        application.requiredDocuments ?? [],
        (application.documents ?? []).map((document) => ({
          id: document.id,
          type: document.type,
          filename: document.filename,
          verification: document.verification,
          ...(document.rejectionReason ? { rejectionReason: document.rejectionReason } : {}),
          ...(document.verifiedAt ? { verifiedAt: document.verifiedAt } : {}),
        })),
      ),
    [application.requiredDocuments, application.documents],
  );

  /**
   * The wire document behind a checklist entry.
   *
   * `ChecklistDocument` is the pure contract and deliberately carries no
   * transport path — so the row that OPENS a file looks it up here rather than
   * the contract growing an HTTP concern it has no business knowing about.
   */
  const byId = useMemo(
    () => new Map((application.documents ?? []).map((document) => [document.id, document])),
    [application.documents],
  );

  const decide = useCallback(
    (documentId: string, status: 'verified' | 'rejected') => {
      setBusyId(documentId);
      verify
        .mutateAsync({
          documentId,
          status,
          ...(status === 'rejected' ? { reason: t('applications.checklist.defaultReason') } : {}),
        })
        .catch(() => toast.error(t('applications.checklist.decisionFailed')))
        .finally(() => setBusyId(null));
    },
    [t, verify],
  );

  if (items.length === 0) {
    return (
      <SettingsListGroup title={t('applications.landlord.sectionDocuments')}>
        <SettingsListItem title={t('applications.landlord.noDocuments')} />
      </SettingsListGroup>
    );
  }

  return (
    <SettingsListGroup title={t('applications.landlord.sectionDocuments')}>
      {items.map((item) => (
        <View key={item.type}>
          <SettingsListItem
            icon={<SettingsRowIcon icon={DOCUMENT_ICON[item.type] ?? RiFileTextLine} />}
            title={t(`applications.documentType.${item.type}`)}
            /* The status is the SERVER's word, including "nobody has opened
               this yet" — which is what an applicant most needs to see, and the
               difference between a slow landlord and a lost upload. */
            description={t(`applications.checklist.status.${item.status}`)}
            value={item.required ? t('applications.checklist.required') : undefined}
          />
          {item.documents.map((document) => (
            <View key={document.id}>
              <SettingsListItem
                title={document.filename}
                description={
                  document.rejectionReason
                    ? t('applications.checklist.rejectedBecause', {
                        reason: document.rejectionReason,
                      })
                    : undefined
                }
                accessibilityRole="link"
                accessibilityLabel={t('applications.landlord.openDocument', {
                  filename: document.filename,
                })}
                onPress={() => {
                  const path = byId.get(document.id)?.downloadPath;
                  if (!path) return;
                  openDocument(path, t('applications.landlord.toastOpenDocumentFailed'));
                }}
              />
              {/* Only the landlord decides, and only on a document that is
                  actually there. The applicant sees the same states and no
                  buttons — which is the point: nothing on their screen can
                  change a verification. */}
              {viewerIsLandlord ? (
                <View style={styles.checklistActions}>
                  <Button
                    variant="secondary"
                    size="small"
                    disabled={busyId !== null || document.verification === 'verified'}
                    onPress={() => decide(document.id, 'verified')}
                    accessibilityLabel={t('applications.checklist.verifyAccessible')}
                  >
                    {t('applications.checklist.verify')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="small"
                    disabled={busyId !== null || document.verification === 'rejected'}
                    onPress={() => decide(document.id, 'rejected')}
                    accessibilityLabel={t('applications.checklist.rejectAccessible')}
                  >
                    {t('applications.checklist.reject')}
                  </Button>
                </View>
              ) : null}
            </View>
          ))}
        </View>
      ))}
    </SettingsListGroup>
  );
};

const styles = StyleSheet.create({
  checklistActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
});
