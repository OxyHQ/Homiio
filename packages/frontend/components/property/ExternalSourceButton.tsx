/**
 * The one action an external listing gets: open it on its source website.
 *
 * External listings (`isExternal`) are never applied to, booked or enquired
 * about inside Homiio. Without a `sourceUrl` the button says so rather than
 * inventing another way to reach the advertiser.
 */
import React, { useCallback } from 'react';
import { Linking } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button } from '@oxy.so/bloom/button';
import { RiExternalLinkLine } from '@oxy.so/bloom/icons';
import { toast } from '@oxy.so/bloom/toast';
import type { Property } from '@homiio/shared-types';

interface ExternalSourceButtonProps {
  property: Pick<Property, 'sourceUrl'>;
}

export const ExternalSourceButton: React.FC<ExternalSourceButtonProps> = ({ property }) => {
  const { t } = useTranslation();
  const { sourceUrl } = property;

  const handlePress = useCallback(async () => {
    if (!sourceUrl) {
      toast.error(t('error.source.noUrl'));
      return;
    }
    try {
      await Linking.openURL(sourceUrl);
    } catch {
      toast.error(t('error.source.openFailed'));
    }
  }, [sourceUrl, t]);

  return (
    <Button variant="primary" size="large" leadingIcon={RiExternalLinkLine} onPress={handlePress}>
      {t('listing.cta.viewOnSourceWebsite')}
    </Button>
  );
};

export default ExternalSourceButton;
