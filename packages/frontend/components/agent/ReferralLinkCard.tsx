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
import { View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useTranslation } from 'react-i18next';
import { useMediaQuery } from 'react-responsive';

import { Button } from '@oxy.so/bloom/button';
import { Card } from '@oxy.so/bloom/card';
import { RiCheckLine, RiFileCopyLine, RiLink, RiShare2Line } from '@oxy.so/bloom/icons';
import { useTheme } from '@oxy.so/bloom/theme';
import { toast } from '@oxy.so/bloom/toast';
import { Text as BloomText } from '@oxy.so/bloom/typography';

import { shareReferralLink } from '@/utils/shareReferral';
import { resolvePagePadding } from '@/constants/styles';

interface ReferralLinkCardProps {
  link: string;
}

export const ReferralLinkCard: React.FC<ReferralLinkCardProps> = ({ link }) => {
  const { t } = useTranslation();
  const theme = useTheme();
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
      <Card
        variant="outlined"
        radius="radius-24"
        className="w-full max-w-[720px] self-center gap-4 p-6"
      >
        <BloomText
          variant="caption-1-semibold"
          style={{ color: theme.colors.textSecondary, textTransform: 'uppercase' }}
        >
          {t('agent.referral.title')}
        </BloomText>

        <Card variant="filled" radius="radius-12" className="flex-row items-center gap-2 px-4 py-3">
          <RiLink width={20} height={20} fill={theme.colors.icon} />
          <BloomText
            variant="body-medium"
            style={{ flex: 1, minWidth: 0, color: theme.colors.text }}
            numberOfLines={1}
            ellipsizeMode="middle"
          >
            {link}
          </BloomText>
        </Card>

        <View className="flex-row flex-wrap gap-3">
          <Button
            variant="primary"
            size="medium"
            leadingIcon={copied ? RiCheckLine : RiFileCopyLine}
            onPress={handleCopy}
            style={{ flexGrow: 1, flexBasis: 140 }}
          >
            {copied ? t('agent.referral.copiedShort') : t('agent.referral.copy')}
          </Button>
          <Button
            variant="secondary"
            size="medium"
            leadingIcon={RiShare2Line}
            onPress={handleShare}
            style={{ flexGrow: 1, flexBasis: 140 }}
          >
            {t('agent.referral.share')}
          </Button>
        </View>
      </Card>
    </View>
  );
};

export default ReferralLinkCard;
