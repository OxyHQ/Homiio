import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  SegmentedControl,
  SegmentedControlItem,
  SegmentedControlItemText,
} from '@oxy.so/bloom/segmented-control';
import { TextFieldInput } from '@oxy.so/bloom/text-field';

interface NumberSelectorProps {
  value: number;
  onChange: (value: number) => void;
  maxValue?: number;
  minValue?: number;
  /** Names the choice for assistive tech (e.g. "Bedrooms"). */
  label?: string;
}

/**
 * A small count picker: Bloom `SegmentedControl` over `minValue…maxValue`, where
 * the last segment reads `+max` and opens a numeric field for larger counts.
 */
export function NumberSelector({
  value,
  onChange,
  maxValue = 5,
  minValue = 0,
  label = 'Number',
}: NumberSelectorProps) {
  // The custom input is shown whenever the value already exceeds maxValue
  // (derived from props) or the user has explicitly picked the "+max" segment
  // (tracked locally). Deriving `showInput` instead of syncing it in an effect
  // avoids cascading renders.
  const [userOpenedInput, setUserOpenedInput] = useState(false);
  const showInput = value > maxValue || userOpenedInput;
  const [inputText, setInputText] = useState<string | null>(null);
  // The field shows the user's in-progress text when present, otherwise the
  // current value (when it overflows maxValue).
  const inputValue = inputText ?? (value > maxValue ? value.toString() : '');
  const numbers = Array.from({ length: maxValue - minValue + 1 }, (_, i) => minValue + i);
  const selected = showInput ? String(maxValue) : String(value);

  const handleInputChange = (text: string) => {
    // Only allow numbers
    const numericValue = text.replace(/[^0-9]/g, '');
    setInputText(numericValue);

    const parsedValue = parseInt(numericValue, 10);
    if (!isNaN(parsedValue) && parsedValue >= maxValue) {
      onChange(parsedValue);
    }
  };

  const handleSelect = (raw: string) => {
    const num = Number(raw);
    if (num === maxValue) {
      setUserOpenedInput(true);
      setInputText(value > maxValue ? value.toString() : '');
    } else {
      setUserOpenedInput(false);
      setInputText(null);
      onChange(num);
    }
  };

  return (
    <View style={styles.container}>
      <SegmentedControl label={label} type="radio" value={selected} onChange={handleSelect}>
        {numbers.map((num) => (
          <SegmentedControlItem key={num} value={String(num)}>
            <SegmentedControlItemText>
              {num === maxValue ? (value > maxValue ? `${value}` : `+${num}`) : num.toString()}
            </SegmentedControlItemText>
          </SegmentedControlItem>
        ))}
      </SegmentedControl>
      {showInput ? (
        <View style={styles.input}>
          <TextFieldInput
            label={label}
            value={inputValue}
            onChangeText={handleInputChange}
            placeholder={maxValue.toString()}
            keyboardType="numeric"
            maxLength={2}
            autoFocus={userOpenedInput}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  input: {
    width: 64,
  },
});
