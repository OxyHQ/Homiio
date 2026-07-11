/**
 * EditableList — the pros / cons capped string-list editor. Type an item, tap
 * Add (or submit), and it appends to the list (max `maxItems`, each clamped to
 * `maxLength`). Each row shows the text with a remove button; the remove button
 * is the shared `IconButton` (owns its own press state → safe in the `.map`).
 */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '@oxyhq/bloom/button';
import { TextFieldInput } from '@oxyhq/bloom/text-field';
import { Text as BloomText } from '@oxyhq/bloom/typography';

import { IconButton } from '@/components/ui/IconButton';
import { colors } from '@/styles/colors';
import { hairline, radius, spacing } from '@/constants/styles';

interface EditableListProps {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
  addLabel: string;
  removeLabel: string;
  /** Accent tint for the row bullet. */
  tone: 'positive' | 'negative';
  maxItems?: number;
  maxLength?: number;
}

export const EditableList: React.FC<EditableListProps> = ({
  label,
  items,
  onChange,
  placeholder,
  addLabel,
  removeLabel,
  tone,
  maxItems = 10,
  maxLength = 140,
}) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const atCapacity = items.length >= maxItems;

  const addItem = () => {
    const value = draft.trim();
    if (!value || atCapacity) return;
    onChange([...items, value.slice(0, maxLength)]);
    setDraft('');
  };

  const removeItem = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  const bulletColor = tone === 'positive' ? colors.success : colors.error;

  return (
    <View style={styles.container}>
      <View style={styles.labelRow}>
        <BloomText style={styles.label}>{label}</BloomText>
        <BloomText style={styles.count}>
          {t('reviews.write.listCount', { current: items.length, max: maxItems })}
        </BloomText>
      </View>

      {items.length > 0 ? (
        <View style={styles.list}>
          {items.map((item, index) => (
            <View key={`${item}-${index}`} style={styles.itemRow}>
              <View style={[styles.bullet, { backgroundColor: bulletColor }]} />
              <BloomText style={styles.itemText}>{item}</BloomText>
              <IconButton
                icon="close"
                variant="ghost"
                size={16}
                onPress={() => removeItem(index)}
                accessibilityLabel={removeLabel}
              />
            </View>
          ))}
        </View>
      ) : null}

      {atCapacity ? null : (
        <View style={styles.addRow}>
          <View style={styles.addField}>
            <TextFieldInput
              label={placeholder}
              value={draft}
              onChangeText={setDraft}
              maxLength={maxLength}
              onSubmitEditing={addItem}
              returnKeyType="done"
            />
          </View>
          <Button
            variant="secondary"
            size="medium"
            onPress={addItem}
            disabled={draft.trim().length === 0}
          >
            {addLabel}
          </Button>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.COLOR_BLACK_LIGHT_2,
  },
  count: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_4,
  },
  list: {
    gap: spacing.xs,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: hairline.width,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    backgroundColor: colors.surfaceElevated,
  },
  bullet: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  itemText: {
    flex: 1,
    fontSize: 14,
    color: colors.COLOR_BLACK,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  addField: {
    flex: 1,
  },
});

export default EditableList;
