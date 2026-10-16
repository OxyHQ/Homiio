/**
 * PropertyListHeader — the header used by every property-list surface that
 * isn't the full search/browse experience (Recently viewed, My properties,
 * Drafts, Type results).
 *
 * Bloom `PageHeader` with the shell's menu button and a back button, a title
 * (with an optional one-line subtitle) and a right-hand action slot for owner
 * actions (e.g. "Add property"). The app shell owns the safe area.
 */
import type React from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AppShellMenuButton } from '@oxy.so/bloom/app-shell';
import { PageHeader } from '@oxy.so/bloom/page-header';

interface PropertyListHeaderProps {
  /** Main title. */
  title: string;
  /** Optional one-line subtitle below the title (e.g. result count). */
  subtitle?: string;
  /** Optional trailing action(s) — owner buttons, clear, etc. */
  right?: React.ReactNode;
}

export const PropertyListHeader: React.FC<PropertyListHeaderProps> = ({
  title,
  subtitle,
  right,
}) => {
  const { t } = useTranslation();
  const router = useRouter();

  return (
    <PageHeader
      title={title}
      subtitle={subtitle}
      titleAlign="center"
      leading={<AppShellMenuButton accessibilityLabel={t('sidebar.open')} />}
      onBack={router.canGoBack() ? router.back : undefined}
      backLabel={t('goBack')}
      actions={right}
    />
  );
};
