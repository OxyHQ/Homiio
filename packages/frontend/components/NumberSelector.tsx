import React, { useState, useEffect } from 'react';
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
    const [showInput, setShowInput] = useState(false);
    const [inputValue, setInputValue] = useState('');
    const numbers = Array.from({ length: maxValue + 1 }, (_, i) => i);

    useEffect(() => {
        if (value > maxValue) {
            setInputValue(value.toString());
            setShowInput(true);
        } else {
            setShowInput(false);
        }
    }, [value, maxValue]);

    const handleInputChange = (text: string) => {
        // Only allow numbers
        const numericValue = text.replace(/[^0-9]/g, '');
        setInputValue(numericValue);

        const parsedValue = parseInt(numericValue);
        if (!isNaN(parsedValue) && parsedValue >= maxValue) {
            onChange(parsedValue);
        }
    };

    const handleNumberPress = (num: number) => {
        if (num === maxValue) {
            setShowInput(true);
            setInputValue(value > maxValue ? value.toString() : '');
        } else {
            setShowInput(false);
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
