/**
 * Saved — saved searches, upcoming stays and swaps, folders and saved homes,
 * composed like the Bloom housing template's Saved page (`SavedPageBody`).
 *
 * Homiio's `AppShell`/`Header` stay the frame; the template's `HousingHeader`
 * is not adopted. The header leads to Notes and to the alert history.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button } from '@oxy.so/bloom/button';
import { RiFileTextLine, RiLockLine, RiLoginBoxLine, RiNotification3Line } from '@oxy.so/bloom/icons';
import { useTheme } from '@oxy.so/bloom/theme';
import { useOxy, openAccountDialog } from '@oxy.so/services';

import { Header } from '@/components/Header';
import { SavedPageBody } from '@/components/saved/SavedPageBody';
import { EmptyState } from '@/components/ui/EmptyState';

export default function SavedScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { oxyServices, activeSessionId } = useOxy();
  const isAuthed = Boolean(oxyServices && activeSessionId);

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <Header
        options={{
          title: t('saved.header'),
          rightComponents: isAuthed
            ? [
                <Button
                  key="notes"
                  variant="ghost"
                  iconOnly
                  leadingIcon={RiFileTextLine}
                  accessibilityLabel={t('saved.notes.title')}
                  onPress={() => router.push('/saved/notes')}
                />,
                // The alert history spans every saved search, so it lives on
                // the page header; one search's settings open from its card.
                <Button
                  key="alerts"
                  variant="ghost"
                  iconOnly
                  leadingIcon={RiNotification3Line}
                  accessibilityLabel={t('alerts.history.title')}
                  onPress={() => router.push('/saved/alerts')}
                />,
              ]
            : [],
        }}
      />
      {isAuthed ? (
        <SavedPageBody enabled />
      ) : (
        <View style={styles.centerWrap}>
          <EmptyState
            icon={RiLockLine}
            title={t('profile.signInRequired')}
            description={t('profile.signInMessage')}
            actionText={t('common.signIn')}
            actionIcon={RiLoginBoxLine}
            onAction={() => openAccountDialog()}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centerWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
});
