/**
 * EditableList — the pros / cons capped string-list editor. Type an item, tap
 * Add (or submit), and it appends to the list (max `maxItems`, each clamped to
 * `maxLength`). Each entry is an outlined Bloom `Card` row with a tone glyph,
 * the full (wrapping) text and an icon-only Bloom `Button` to remove it.
 *
 * Not a `Chip` list: a chip truncates to one line and its close button carries
 * a fixed English label, while an entry here runs to 140 characters.
 */
import React, { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '@oxy.so/bloom/button';
import { Card } from '@oxy.so/bloom/card';
import {
  RiAddCircleLine,
  RiAddLine,
  RiCloseCircleLine,
  RiCloseLine,
} from '@oxy.so/bloom/icons';
import { Label } from '@oxy.so/bloom/label';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { useTheme } from '@oxy.so/bloom/theme';
import { Text as BloomText } from '@oxy.so/bloom/typography';

interface EditableListProps {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
  addLabel: string;
  removeLabel: string;
  /** Accent tone for the row glyph. */
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
  const theme = useTheme();
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

  const ToneIcon = tone === 'positive' ? RiAddCircleLine : RiCloseCircleLine;
  const toneColor = tone === 'positive' ? theme.colors.success : theme.colors.error;

  return (
    <View className="gap-2">
      <View className="flex-row items-center justify-between">
        <Label>{label}</Label>
        <BloomText className="text-xs text-muted-foreground">
          {t('reviews.write.listCount', { current: items.length, max: maxItems })}
        </BloomText>
      </View>

      {items.length > 0 ? (
        <View className="gap-2">
          {items.map((item, index) => (
            <Card key={`${item}-${index}`} variant="outlined" radius="radius-12">
              <View className="flex-row items-center gap-2 py-1 pl-3 pr-1">
                <ToneIcon width={16} height={16} fill={toneColor} />
                <BloomText className="flex-1 text-sm text-foreground">{item}</BloomText>
                <Button
                  variant="ghost"
                  size="small"
                  iconOnly
                  leadingIcon={RiCloseLine}
                  onPress={() => removeItem(index)}
                  accessibilityLabel={removeLabel}
                />
              </View>
            </Card>
          ))}
        </View>
      ) : null}

      {atCapacity ? null : (
        <View className="flex-row items-end gap-2">
          <View className="flex-1">
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
            leadingIcon={RiAddLine}
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

export default EditableList;
