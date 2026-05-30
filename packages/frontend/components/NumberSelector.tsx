import React, { useState } from 'react';
import { View, TouchableOpacity, StyleSheet, TextInput } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ThemedText } from '@/components/ThemedText';
import { colors } from '@/styles/colors';

interface NumberSelectorProps {
    value: number;
    onChange: (value: number) => void;
    maxValue?: number;
    minValue?: number;
}

export function NumberSelector({ value, onChange, maxValue = 5, minValue = 0 }: NumberSelectorProps) {
    const { t } = useTranslation();
    // The custom input is shown whenever the value already exceeds maxValue
    // (derived from props) or the user has explicitly tapped the "+max" button
    // (tracked locally). Deriving `showInput` instead of syncing it in an effect
    // avoids cascading renders.
    const [userOpenedInput, setUserOpenedInput] = useState(false);
    const showInput = value > maxValue || userOpenedInput;
    const [inputText, setInputText] = useState<string | null>(null);
    // The field shows the user's in-progress text when present, otherwise the
    // current value (when it overflows maxValue).
    const inputValue = inputText ?? (value > maxValue ? value.toString() : '');
    const numbers = Array.from({ length: maxValue + 1 }, (_, i) => i);

    const handleInputChange = (text: string) => {
        // Only allow numbers
        const numericValue = text.replace(/[^0-9]/g, '');
        setInputText(numericValue);

        const parsedValue = parseInt(numericValue);
        if (!isNaN(parsedValue) && parsedValue >= maxValue) {
            onChange(parsedValue);
        }
    };

    const handleNumberPress = (num: number) => {
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
            {numbers.map((num) => (
                num === maxValue && showInput ? (
                    <TextInput
                        key={num}
                        style={[styles.numberInput, styles.lastButton]}
                        keyboardType="numeric"
                        value={inputValue}
                        onChangeText={handleInputChange}
                        placeholder={maxValue.toString()}
                        maxLength={2}
                    />
                ) : (
                    <TouchableOpacity
                        key={num}
                        style={[
                            styles.numberButton,
                            value === num && styles.selectedButton,
                            num === maxValue && styles.lastButton,
                            value > maxValue && num === maxValue && styles.selectedButton,
                        ]}
                        onPress={() => handleNumberPress(num)}
                    >
                        <ThemedText
                            style={[
                                styles.numberText,
                                (value === num || (value > maxValue && num === maxValue)) && styles.selectedText,
                            ]}
                        >
                            {num === maxValue ? (value > maxValue ? `${value}` : `+${num}`) : num.toString()}
                        </ThemedText>
                    </TouchableOpacity>
                )
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.COLOR_BLACK_LIGHT_9,
        borderRadius: 25,
        padding: 4,
    },
    numberButton: {
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderRadius: 20,
        marginHorizontal: 2,
    },
    selectedButton: {
        backgroundColor: colors.primaryColor,
    },
    lastButton: {
        paddingHorizontal: 12,
    },
    numberText: {
        fontSize: 16,
        color: colors.COLOR_BLACK_LIGHT_3,
    },
    selectedText: {
        color: colors.primaryLight,
        fontWeight: 'bold',
    },
    numberInput: {
        fontSize: 16,
        color: colors.primaryLight,
        backgroundColor: colors.primaryColor,
        textAlign: 'center',
        minWidth: 50,
        height: 36,
        borderRadius: 20,
        marginHorizontal: 2,
    },
});
