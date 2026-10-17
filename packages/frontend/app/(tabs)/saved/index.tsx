/**
 * Saved — saved searches, upcoming stays and swaps, folders and saved homes,
 * composed like the Bloom housing template's Saved page (`SavedPageBody`).
 *
 * Homiio's `AppShell` and a Bloom `PageHeader` stay the frame; the template's
 * `HousingHeader` is not adopted. The header leads to Notes and to the alert history.
 */
import { StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { AppShellMenuButton } from '@oxy.so/bloom/app-shell';
import { Button } from '@oxy.so/bloom/button';
import {
  RiFileTextLine,
  RiLockLine,
  RiLoginBoxLine,
  RiNotification3Line,
} from '@oxy.so/bloom/icons';
import { PageHeader } from '@oxy.so/bloom/page-header';
import { Screen, ScreenScrollView } from '@oxy.so/bloom/screen';
import { useOxy, openAccountDialog } from '@oxy.so/services';

import { SavedPageBody } from '@/components/saved/SavedPageBody';
import { EmptyState } from '@/components/ui/EmptyState';

export default function SavedScreen() {
  const { t } = useTranslation();
  const { oxyServices, activeSessionId } = useOxy();
  const isAuthed = Boolean(oxyServices && activeSessionId);

  return (
    <Screen
      documentScroll
      header={
        <PageHeader
          title={t('saved.header')}
          titleAlign="center"
          leading={<AppShellMenuButton accessibilityLabel={t('sidebar.open')} />}
          actions={
            isAuthed ? (
              <>
                <Button
                  iconOnly
                  leadingIcon={RiFileTextLine}
                  accessibilityLabel={t('saved.notes.title')}
                  onPress={() => router.push('/saved/notes')}
                  tone="accent"
                  appearance="subtle"
                />
                {/* The alert history spans every saved search, so it lives on
                      the page header; one search's settings open from its card. */}
                <Button
                  iconOnly
                  leadingIcon={RiNotification3Line}
                  accessibilityLabel={t('alerts.history.title')}
                  onPress={() => router.push('/saved/alerts')}
                  tone="accent"
                  appearance="subtle"
                />
              </>
            ) : undefined
          }
        />
      }
    >
      {isAuthed ? (
        <SavedPageBody enabled />
      ) : (
        <ScreenScrollView contentContainerStyle={styles.centerWrap}>
          <EmptyState
            icon={RiLockLine}
            title={t('profile.signInRequired')}
            description={t('profile.signInMessage')}
            actionText={t('common.signIn')}
            actionIcon={RiLoginBoxLine}
            onAction={() => openAccountDialog()}
          />
        </ScreenScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  centerWrap: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
});
