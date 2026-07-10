/**
 * ReferralLinkCard — surfaces a joined partner's referral link with Copy and
 * native Share actions.
 *
 * The link is displayed read-only in a flat field; "Copy" writes it to the
 * clipboard (`expo-clipboard`) directly and confirms with a toast — a copy
 * button is its own distinct action. "Share" routes through `shareReferralLink`,
 * which delegates to the shared `shareContent` ladder (native share / Web Share
 * → clipboard fallback), so it behaves like every other share in the app.
 * Buttons are Bloom `Button`s so they inherit the brand styling.
 */
import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Button } from '@oxyhq/bloom/button';
import { Text as BloomText } from '@oxyhq/bloom/typography';

import { toast } from '@/lib/sonner';
import { shareReferralLink } from '@/utils/shareReferral';
import { colors } from '@/styles/colors';
import {
  hairline,
  ICON_SIZES,
  radius,
  resolvePagePadding,
  spacing,
  tracker,
} from '@/constants/styles';
import { useMediaQuery } from 'react-responsive';

interface ReferralLinkCardProps {
  link: string;
}

export const ReferralLinkCard: React.FC<ReferralLinkCardProps> = ({ link }) => {
  const { t } = useTranslation();
  const isWide = useMediaQuery({ minWidth: 768 });
  const horizontalPadding = resolvePagePadding(isWide);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(link);
      setCopied(true);
      toast.success(t('agent.referral.copied'));
    } catch {
      toast.error(t('agent.referral.copyFailed'));
    }
  }, [link, t]);

  const handleShare = useCallback(async () => {
    const outcome = await shareReferralLink({
      link,
      message: t('agent.referral.shareMessage', {
        link,
      }),
      title: t('agent.referral.shareTitle'),
    });
    if (outcome === 'copied') {
      toast.success(t('agent.referral.copied'));
    } else if (outcome === 'failed') {
      toast.error(t('agent.referral.shareFailed'));
    }
  }, [link, t]);

  return (
    <View style={{ paddingHorizontal: horizontalPadding }}>
      <View style={styles.card}>
        <BloomText style={styles.label}>
          {t('agent.referral.title')}
        </BloomText>

        <View style={styles.linkRow}>
          <Ionicons
            name="link-outline"
            size={ICON_SIZES.md}
            color={colors.COLOR_BLACK_LIGHT_3}
          />
          <BloomText style={styles.linkText} numberOfLines={1} ellipsizeMode="middle">
            {link}
          </BloomText>
        </View>

        <View style={styles.actions}>
          <Button
            variant="primary"
            size="medium"
            onPress={handleCopy}
            style={styles.action}
          >
            {copied
              ? t('agent.referral.copiedShort')
              : t('agent.referral.copy')}
          </Button>
          <Button
            variant="secondary"
            size="medium"
            onPress={handleShare}
            style={styles.action}
          >
            {t('agent.referral.share')}
          </Button>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.xl,
    borderWidth: hairline.width,
    borderColor: colors.border,
    padding: spacing['2xl'],
    gap: spacing.lg,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.COLOR_BLACK_LIGHT_3,
    textTransform: 'uppercase',
    letterSpacing: tracker.eyebrow,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.mutedSubtle,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  linkText: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    color: colors.COLOR_BLACK,
    fontWeight: '500',
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  action: {
    flexGrow: 1,
    flexBasis: 140,
  },
});

export default ReferralLinkCard;
