/**
 * Why Homiio exists, said to the people it exists for: it was born out of
 * the same housing crisis they are living through, and it is on their side.
 * Supporting Homiio is the secondary action.
 */
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@oxy.so/bloom/button';
import { Text } from '@oxy.so/bloom/typography';

import { BaseWidget } from './BaseWidget';

export function MissionWidget() {
  const { t } = useTranslation();
  const router = useRouter();

  return (
    <BaseWidget title={t('home.mission.title')}>
      <Text className="text-body-2-regular text-muted-foreground">{t('home.mission.body')}</Text>
      <Button tone="neutral" appearance="outline" onPress={() => router.push('/donate')}>
        {t('home.mission.support')}
      </Button>
    </BaseWidget>
  );
}
