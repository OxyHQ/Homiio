/**
 * A shared conversation (`/sindi/shared/<token>`), read by anybody with the
 * link, signed in or not. The link is Alia's (`POST /v1/conversations/:id/share`,
 * minted from the conversation's header), and so is the page's content: the
 * SDK's `AliaSharedConversation` reads `GET /v1/shared/:token` and draws it with
 * the same thread as the live chat, read-only. Tool outputs never travel in a
 * share — they can hold the person's own data — so a shared page shows words,
 * pictures and who wrote them.
 */

import { AliaSharedConversation, DEFAULT_LABELS, type AliaChatLabels } from '@alia.onl/sdk';
import { AppShellMenuButton } from '@oxy.so/bloom/app-shell';
import { Chip } from '@oxy.so/bloom/chip';
import { RiShare2Line } from '@oxy.so/bloom/icons';
import { PageHeader } from '@oxy.so/bloom/page-header';
import { useTheme } from '@oxy.so/bloom/theme';
import { Text } from '@oxy.so/bloom/typography';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

export default function SharedConversationView() {
  const { colors } = useTheme();
  const { token } = useLocalSearchParams<{ token: string }>();
  const { t, i18n } = useTranslation();
  const router = useRouter();

  // The page's own two sentences in the reader's language; the thread's are the SDK's.
  const labels = useMemo<Partial<AliaChatLabels>>(
    () => ({
      locale: i18n.language,
      t: (key, params) => {
        if (key === 'chat.sharedGone') return t('sindi.shared.error.notFound');
        if (key === 'chat.sharedFailed') return t('sindi.shared.error.failed');
        return DEFAULT_LABELS.t(key, params);
      },
    }),
    [t, i18n.language],
  );

  return (
    <>
      <PageHeader
        title={t('sindi.shared.subtitle')}
        titleAlign="center"
        leading={<AppShellMenuButton accessibilityLabel={t('sidebar.open')} />}
        onBack={router.canGoBack() ? router.back : undefined}
        backLabel={t('goBack')}
      />

      <View style={styles.badge}>
        <Chip
          size="sm"
          startIcon={<RiShare2Line width={14} height={14} fill={colors.textSecondary} />}
        >
          {t('sindi.shared.badge')}
        </Chip>
      </View>

      <View style={styles.fill}>
        {token ? <AliaSharedConversation token={token} labels={labels} /> : null}
      </View>

      <Text variant="caption-1-regular" style={[styles.footer, { color: colors.textTertiary }]}>
        {t('sindi.shared.footer')}
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  badge: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  footer: {
    textAlign: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
});
