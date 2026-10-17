import { View, TouchableOpacity } from 'react-native';
import { Text } from '@oxy.so/bloom/typography';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { RiErrorWarningFill } from '@oxy.so/bloom/icons';
import { useTheme } from '@oxy.so/bloom/theme';

export default function NotFoundScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors } = useTheme();

  return (
    <View className="flex-1 items-center justify-center p-4">
      <RiErrorWarningFill width={80} height={80} fill={colors.primarySubtleForeground} />
      <Text className="my-4 text-2xl font-bold text-foreground">{t('notFound.title')}</Text>
      <Text className="mb-6 text-center text-base text-muted-foreground">
        {t('notFound.message')}
      </Text>
      <TouchableOpacity className="rounded-full bg-primary px-6 py-3" onPress={() => router.back()}>
        <Text className="text-base font-bold text-primary-foreground">{t('notFound.goBack')}</Text>
      </TouchableOpacity>
    </View>
  );
}
