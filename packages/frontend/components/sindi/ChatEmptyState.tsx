import React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@oxyhq/bloom/button';
import { H3, Text as BloomText } from '@oxyhq/bloom/typography';
import { SindiIcon } from '@/assets/icons';
import { colors } from '@/styles/colors';
import { sindiStyles } from './styles';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface Suggestion {
  icon: IoniconName;
  label: string;
  prompt: string;
}

/** Starter prompts shown in an empty conversation. */
const SUGGESTIONS: readonly Suggestion[] = [
  {
    icon: 'help-circle-outline',
    label: 'Tenant rights',
    prompt: 'What are my rights if my rent increases by 20%?',
  },
  {
    icon: 'search-outline',
    label: 'Find housing',
    prompt: 'Find 2-bedroom apartments under $2000 in Seattle',
  },
  {
    icon: 'document-text-outline',
    label: 'Lease review',
    prompt: 'Can you review my lease for red flags?',
  },
  {
    icon: 'alert-circle-outline',
    label: 'Eviction help',
    prompt: 'How should I respond to an eviction notice?',
  },
];

export interface ChatEmptyStateProps {
  onSuggestionPress: (prompt: string) => void;
}

/**
 * Empty-conversation hero: Sindi icon, intro copy, and a row of starter-prompt
 * chips that seed the composer and submit when tapped.
 */
export const ChatEmptyState = React.memo<ChatEmptyStateProps>(({ onSuggestionPress }) => (
  <View style={sindiStyles.emptyContainer}>
    <View style={sindiStyles.emptyCard}>
      <View style={sindiStyles.emptyIconContainer}>
        <SindiIcon size={56} color={colors.primaryColor} />
      </View>
      <H3 style={sindiStyles.emptyTitle}>Start your conversation</H3>
      <BloomText style={sindiStyles.emptySubtitle}>
        Ask about tenant rights, explore housing options, or get a quick lease review.
      </BloomText>
      <View style={sindiStyles.suggestionsWrap}>
        {SUGGESTIONS.map((suggestion) => (
          <Button
            key={suggestion.label}
            variant="secondary"
            size="small"
            onPress={() => onSuggestionPress(suggestion.prompt)}
            icon={<Ionicons name={suggestion.icon} size={14} color={colors.primaryColor} />}
          >
            {suggestion.label}
          </Button>
        ))}
      </View>
    </View>
  </View>
));
ChatEmptyState.displayName = 'ChatEmptyState';
