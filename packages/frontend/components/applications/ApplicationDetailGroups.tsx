/**
 * The read-only blocks of a tenant application, shared by the applicant's view
 * (`/applications/[id]`) and the landlord's (`/landlord/applications/[id]`):
 * Bloom `SettingsListGroup`s on the page background, one per block, replacing
 * the hand-rolled label/value rows each screen used to carry.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  RiFileTextLine,
  RiMailLine,
  RiUserLine,
  RiWallet3Line,
} from '@oxy.so/bloom/icons';
import { SettingsListGroup, SettingsListItem } from '@oxy.so/bloom/settings-list';
import { toast } from '@oxy.so/bloom/toast';
import {
  formatMoney,
  type TenantApplication,
  type TenantApplicationDocument,
} from '@homiio/shared-types';

import { SettingsRowIcon, type SettingsIconComponent } from '@/components/profile/SettingsRowIcon';
import { openPrivateDocument } from '@/utils/privateDocument';
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
 * The attached documents; each row fetches its bytes through the authenticated
 * API and hands them to the platform. There is no link to hand out.
 */
export const ApplicationDocumentsGroup: React.FC<GroupProps> = ({ application }) => {
  const { t } = useTranslation();
  return (
    <SettingsListGroup title={t('applications.landlord.sectionDocuments')}>
      {application.documents.length === 0 ? (
        <SettingsListItem title={t('applications.landlord.noDocuments')} />
      ) : (
        application.documents.map((document) => (
          <SettingsListItem
            key={document.id}
            icon={<SettingsRowIcon icon={DOCUMENT_ICON[document.type] ?? RiFileTextLine} />}
            title={document.filename}
            description={t(`applications.documentType.${document.type}`)}
            accessibilityRole="link"
            accessibilityLabel={t('applications.landlord.openDocument', {
              filename: document.filename,
            })}
            onPress={() =>
              openDocument(
                document.downloadPath,
                t('applications.landlord.toastOpenDocumentFailed'),
              )
            }
          />
        ))
      )}
    </SettingsListGroup>
  );
};
