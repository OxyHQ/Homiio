import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { colors } from '@/styles/colors';
import { Ionicons } from '@expo/vector-icons';

export default function TrustScorePage() {
    const { t } = useTranslation();

    const scoreItems = [
        {
            id: 1,
            title: 'Complete profile verification',
            description: 'Verify your identity to increase your karma in the Oxy Ecosystem',
            karma: 20,
            completed: true,
            icon: 'person-circle-outline',
        },
        {
            id: 2,
            title: 'Connect social accounts',
            description: 'Link your social profiles to enhance your trustworthiness',
            karma: 15,
            completed: false,
            icon: 'share-social-outline',
        },
        {
            id: 3,
            title: 'Verify phone number',
            description: 'Add and verify your phone number for added security',
            karma: 10,
            completed: true,
            icon: 'call-outline',
        },
        {
            id: 4,
            title: 'Add payment method',
            description: 'Set up a secure payment method to your account',
            karma: 15,
            completed: false,
            icon: 'card-outline',
        },
        {
            id: 5,
            title: 'Get 3 positive reviews',
            description: 'Building a history of positive interactions increases karma',
            karma: 25,
            completed: false,
            icon: 'star-outline',
        },
    ];

    const currentScore = 87;
    const maxScore = 100;
    const completedTasks = scoreItems.filter(item => item.completed).length;
    const totalTasks = scoreItems.length;

    return (
        <SafeAreaView style={{ flex: 1 }} edges={['top']}>
            <ScrollView style={styles.container}>
                <View style={styles.header}>
                    <Text style={styles.title}>{t('Trust Score')}</Text>
                    <Text style={styles.subtitle}>
                        Your trust score is based on karma from the Oxy Ecosystem and helps hosts and guests feel confident when interacting with you
                    </Text>
                </View>

                <View style={styles.scoreContainer}>
                    <View style={styles.scoreCircle}>
                        <Text style={styles.scoreNumber}>{currentScore}</Text>
                        <Text style={styles.scoreMax}>/{maxScore}</Text>
                    </View>
                    <View style={styles.scoreSummary}>
                        <Text style={styles.scoreStatus}>
                            Your trust score is <Text style={styles.scoreStatusHighlight}>Good</Text>
                        </Text>
                        <Text style={styles.scoreProgress}>
                            Completed {completedTasks} of {totalTasks} tasks
                        </Text>
                    </View>
                </View>

                <View style={styles.tasksContainer}>
                    <Text style={styles.sectionTitle}>Improve Your Karma</Text>

                    {scoreItems.map(item => (
                        <View key={item.id} style={styles.taskItem}>
                            <View style={styles.taskIconContainer}>
                                <Ionicons
                                    name={item.icon as any}
                                    size={24}
                                    color={item.completed ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_4}
                                />
                            </View>
                            <View style={styles.taskContent}>
                                <View style={styles.taskHeader}>
                                    <Text style={styles.taskTitle}>{item.title}</Text>
                                    <Text style={styles.taskPoints}>+{item.karma} karma</Text>
                                </View>
                                <Text style={styles.taskDescription}>{item.description}</Text>
                            </View>
                            <View style={styles.taskStatus}>
                                {item.completed ? (
                                    <Ionicons name="checkmark-circle" size={24} color={colors.primaryColor} />
                                ) : (
                                    <TouchableOpacity
                                        style={styles.completeButton}
                                        onPress={() => {
                                            // Handle task completion
                                        }}
                                    >
                                        <Text style={styles.completeButtonText}>Complete</Text>
                                    </TouchableOpacity>
                                )}
                            </View>
                        </View>
                    ))}
                </View>

                <View style={styles.oxyInfoContainer}>
                    <View style={styles.oxyHeader}>
                        <Ionicons name="globe-outline" size={22} color={colors.primaryColor} />
                        <Text style={styles.oxyTitle}>Oxy Ecosystem</Text>
                    </View>
                    <Text style={styles.oxyDescription}>
                        Karma is earned through positive contributions to the Oxy Ecosystem. Higher karma increases your trust score and unlocks additional benefits across the platform.
                    </Text>
                    <TouchableOpacity
                        style={styles.learnMoreButton}
                        onPress={() => {
                            const url = "https://oxy.so";
                            window.open(url, "_blank");
                        }}
                    >
                        <Text style={styles.learnMoreText}>Learn More</Text>
                    </TouchableOpacity>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        padding: 20,
        backgroundColor: colors.primaryLight,
    },
    header: {
        marginBottom: 24,
    },
    title: {
        fontSize: 28,
        fontWeight: 'bold',
        marginBottom: 8,
        color: colors.primaryDark,
    },
    subtitle: {
        fontSize: 16,
        color: colors.COLOR_BLACK_LIGHT_4,
        lineHeight: 22,
    },
    scoreContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'white',
        borderRadius: 15,
        padding: 20,
        marginBottom: 24,
        shadowColor: colors.primaryDark,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
    },
    scoreCircle: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: colors.primaryColor,
        justifyContent: 'center',
        alignItems: 'center',
        flexDirection: 'row',
    },
    scoreNumber: {
        color: 'white',
        fontSize: 24,
        fontWeight: 'bold',
    },
    scoreMax: {
        color: 'rgba(255, 255, 255, 0.7)',
        fontSize: 16,
    },
    scoreSummary: {
        flex: 1,
        marginLeft: 20,
    },
    scoreStatus: {
        fontSize: 18,
        marginBottom: 5,
        color: colors.primaryDark,
    },
    scoreStatusHighlight: {
        color: colors.primaryColor,
        fontWeight: 'bold',
    },
    scoreProgress: {
        color: colors.COLOR_BLACK_LIGHT_4,
    },
    tasksContainer: {
        marginBottom: 20,
    },
    sectionTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        marginBottom: 16,
        color: colors.primaryDark,
    },
    taskItem: {
        flexDirection: 'row',
        borderBottomWidth: 1,
        borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
        paddingVertical: 16,
        alignItems: 'center',
    },
    taskIconContainer: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'white',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
        shadowColor: colors.primaryDark,
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 1,
    },
    taskContent: {
        flex: 1,
    },
    taskHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 4,
    },
    taskTitle: {
        fontWeight: 'bold',
        fontSize: 16,
        color: colors.primaryDark,
    },
    taskPoints: {
        fontWeight: 'bold',
        color: colors.primaryColor,
    },
    taskDescription: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_4,
        lineHeight: 20,
    },
    taskStatus: {
        marginLeft: 10,
    },
    completeButton: {
        backgroundColor: colors.primaryLight,
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 15,
    },
    completeButtonText: {
        color: colors.primaryColor,
        fontWeight: '600',
        fontSize: 14,
    },
    oxyInfoContainer: {
        backgroundColor: 'white',
        borderRadius: 15,
        padding: 20,
        marginBottom: 24,
        shadowColor: colors.primaryDark,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
    },
    oxyHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
    },
    oxyTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        marginLeft: 8,
        color: colors.primaryDark,
    },
    oxyDescription: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_4,
        lineHeight: 20,
        marginBottom: 15,
    },
    learnMoreButton: {
        backgroundColor: '#e7f4e4',
        paddingVertical: 8,
        paddingHorizontal: 15,
        borderRadius: 20,
        alignSelf: 'center',
    },
    learnMoreText: {
        color: 'green',
        fontWeight: '600',
    },
}); 