import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Chip } from '@oxy.so/bloom/chip';
import {
  RiAlertLine,
  RiFileTextLine,
  RiQuestionLine,
  RiSearchLine,
} from '@oxy.so/bloom/icons';
import { Text } from '@oxy.so/bloom/typography';
import { useTheme } from '@oxy.so/bloom/theme';
import { SindiIcon } from '@/assets/icons';

type RemixIcon = typeof RiSearchLine;

interface Suggestion {
  icon: RemixIcon;
  label: string;
  prompt: string;
}

/** Starter prompts shown in an empty conversation. */
const SUGGESTIONS: readonly Suggestion[] = [
  {
    icon: RiQuestionLine,
    label: 'Tenant rights',
    prompt: 'What are my rights if my rent increases by 20%?',
  },
  {
    icon: RiSearchLine,
    label: 'Find housing',
    prompt: 'Find 2-bedroom apartments under $2000 in Seattle',
  },
  {
    icon: RiFileTextLine,
    label: 'Lease review',
    prompt: 'Can you review my lease for red flags?',
  },
  {
    icon: RiAlertLine,
    label: 'Eviction help',
    prompt: 'How should I respond to an eviction notice?',
  },
];

export interface ChatEmptyStateProps {
  onSuggestionPress: (prompt: string) => void;
}

/**
 * Empty-conversation hero, shaped like Bloom agent-chat's empty transcript: the
 * Sindi mark, a `title-2-medium` heading, one `body-regular` line and wrapping
 * suggestion chips that seed the composer and submit when tapped.
 */
export const ChatEmptyState = React.memo<ChatEmptyStateProps>(({ onSuggestionPress }) => {
  const { colors } = useTheme();
  return (
    <View style={styles.container}>
      <SindiIcon size={48} color={colors.primary} />
      <Text variant="title-2-medium" style={[styles.center, { color: colors.text }]}>
        Start your conversation
      </Text>
      <Text variant="body-regular" style={[styles.center, { color: colors.textSecondary }]}>
        Ask about tenant rights, explore housing options, or get a quick lease review.
      </Text>
      <View style={styles.suggestions}>
        {SUGGESTIONS.map(({ icon: Icon, label, prompt }) => (
          <Chip
            key={label}
            size="medium"
            onPress={() => onSuggestionPress(prompt)}
            startIcon={<Icon width={16} height={16} fill={colors.textSecondary} />}
            accessibilityLabel={prompt}
          >
            {label}
          </Chip>
        ))}
      </View>
    </View>
  );
});
ChatEmptyState.displayName = 'ChatEmptyState';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 32,
    paddingHorizontal: 16,
  },
  center: {
    textAlign: 'center',
    maxWidth: 420,
  },
  suggestions: {
    marginTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
});
