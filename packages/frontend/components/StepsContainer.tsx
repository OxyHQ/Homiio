import React from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { colors } from '@/styles/colors';
import { Ionicons } from '@expo/vector-icons';

const IconComponent = Ionicons as any;

interface StepsContainerProps {
    steps: string[];
    currentStep: number;
}

export function StepsContainer({ steps, currentStep }: StepsContainerProps) {
    return (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.stepsContainer}
            contentContainerStyle={styles.stepsContent}
        >
            <View style={styles.stepsRow}>
                {steps.map((stepName, index) => (
                    <View key={index} style={[styles.stepItem, index === 0 && styles.firstStepItem]}>
                        <View style={styles.stepLine}>
                            <View style={[
                                styles.line,
                                index <= currentStep && styles.lineActive,
                                index === 0 && styles.firstLine,
                                index === steps.length - 1 && styles.lastLine
                            ]} />
                        </View>
                        <View style={styles.stepContent}>
                            <View
                                style={[
                                    styles.stepIndicator,
                                    index === currentStep && styles.stepIndicatorActive,
                                    index < currentStep && styles.stepIndicatorCompleted,
                                ]}
                            >
                                {index < currentStep ? (
                                    <IconComponent name="checkmark" size={14} color="white" />
                                ) : (
                                    <ThemedText style={[styles.stepNumber, index === currentStep && styles.stepNumberActive]}>
                                        {index + 1}
                                    </ThemedText>
                                )}
                            </View>
                            <ThemedText style={[styles.stepLabel, index === currentStep && styles.stepLabelActive]}>
                                {stepName}
                            </ThemedText>
                        </View>
                    </View>
                ))}
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    stepsContainer: {
        marginBottom: 24,
    },
    stepsContent: {
        flex: 1,
    },
    stepsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: 'auto',
    },
    stepItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingRight: 15,
    },
    firstStepItem: {},
    stepLine: {
        position: 'absolute',
        left: 0,
        right: 0,
        top: 12,
        height: 2,
        zIndex: 1,
    },
    line: {
        height: 2,
        backgroundColor: colors.COLOR_BLACK_LIGHT_6,
        width: '100%',
    },
    firstLine: {
        left: '50%',
    },
    lastLine: {
        width: '50%',
    },
    lineActive: {
        backgroundColor: colors.primaryColor,
    },
    stepContent: {
        flexDirection: 'column',
        alignItems: 'center',
        zIndex: 2,
        backgroundColor: colors.primaryLight,
        paddingHorizontal: 8,
    },
    stepIndicator: {
        width: 24,
        height: 24,
        borderRadius: 12,
        backgroundColor: colors.COLOR_BLACK_LIGHT_6,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 8,
    },
    stepIndicatorActive: {
        backgroundColor: colors.primaryColor,
    },
    stepIndicatorCompleted: {
        backgroundColor: colors.primaryColor,
    },
    stepNumber: {
        fontSize: 12,
        fontWeight: 'bold',
        color: colors.COLOR_BLACK_LIGHT_4,
    },
    stepNumberActive: {
        color: 'white',
    },
    stepLabel: {
        fontSize: 12,
        color: colors.COLOR_BLACK_LIGHT_4,
        textAlign: 'center',
        marginTop: 4,
    },
    stepLabelActive: {
        color: colors.primaryColor,
        fontWeight: 'bold',
    },
});
