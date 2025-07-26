import { generateAPIUrl } from '@/utils/generateAPIUrl';
import { useChat } from '@ai-sdk/react';
import { fetch as expoFetch } from 'expo/fetch';
import { View, TextInput, ScrollView, Text, TouchableOpacity, StyleSheet, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useOxy } from '@oxyhq/services';
import { Ionicons } from '@expo/vector-icons';
const IconComponent = Ionicons as any;
import { colors } from '@/styles/colors';

import { useRouter, useLocalSearchParams } from 'expo-router';
import { PropertyCard } from '@/components/PropertyCard';
import { SindiIcon } from '@/assets/icons';
import { ThemedView } from '@/components/ThemedView';
import { ThemedText } from '@/components/ThemedText';
import { Header } from '@/components/Header';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import * as DocumentPicker from 'expo-document-picker';
import React, { useEffect, useState, useCallback } from 'react';
import { useConversationStore, type ConversationMessage, type Conversation } from '@/store/conversationStore';
import { EmptyState } from '@/components/ui/EmptyState';

export default function ConversationDetail() {
    const { oxyServices, activeSessionId } = useOxy();
    const router = useRouter();
    const { t } = useTranslation();
    const { conversationid, message } = useLocalSearchParams<{ conversationid: string; message?: string }>();
    const [attachedFile, setAttachedFile] = React.useState<any>(null);

    // Zustand store
    const {
        currentConversation,
        loading,
        error: storeError,
        loadConversation,
        saveConversation,
        updateConversationMessages,
        generateShareToken,
    } = useConversationStore();

    // Create a custom fetch function that includes authentication
    const authenticatedFetch = useCallback(async (url: string, options: RequestInit = {}) => {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...(options.headers as Record<string, string> || {}),
        };

        // Add authentication token if available
        if (oxyServices && activeSessionId) {
            try {
                const tokenData = await oxyServices.getTokenBySession(activeSessionId);
                if (tokenData) {
                    headers['Authorization'] = `Bearer ${tokenData.accessToken}`;
                }
            } catch (error) {
                console.error('Failed to get authentication token:', error);
            }
        }

        // Create fetch options without null body
        const { body, ...otherOptions } = options;
        const fetchOptions = {
            ...otherOptions,
            headers,
            ...(body !== null && { body }),
        };

        return expoFetch(url, fetchOptions as any);
    }, [oxyServices, activeSessionId]);

    // Always call useChat, but only enable it if authenticated
    const isAuthenticated = !!oxyServices && !!activeSessionId;
    const { messages, error, handleInputChange, input, handleSubmit, isLoading, setMessages } = useChat({
        fetch: authenticatedFetch as unknown as typeof globalThis.fetch,
        api: generateAPIUrl('/api/ai/stream'),
        onError: (error: any) => console.error(error, 'ERROR'),
        enabled: isAuthenticated,
        initialMessages: currentConversation?.messages || [],
        body: {
            conversationId: conversationid && !conversationid.startsWith('conv_') ? conversationid : undefined
        },
    } as any);

    // Load conversation on mount
    useEffect(() => {
        if (conversationid && conversationid !== 'undefined' && isAuthenticated) {
            console.log('Loading conversation with ID:', conversationid);

            // Check if this is a client-side generated ID (starts with 'conv_')
            if (conversationid.startsWith('conv_')) {
                console.log('Client-side conversation ID detected, creating new conversation');
                // This is a client-side ID, we need to create a new conversation
                // For now, just set an empty conversation state
                return;
            }

            // Only try to load from database if it's a valid database ID
            loadConversation(conversationid, authenticatedFetch).then((conversation) => {
                console.log('Loaded conversation:', conversation);
                if (conversation && conversation.messages.length > 0) {
                    // Set messages in the chat hook
                    setMessages(conversation.messages.map(msg => ({
                        id: msg.id || `msg_${Date.now()}_${Math.random()}`,
                        role: msg.role,
                        content: msg.content,
                    })));
                }
            }).catch((error) => {
                console.error('Failed to load conversation:', error);
            });
        }
    }, [conversationid, isAuthenticated, loadConversation, authenticatedFetch, setMessages]);

    // Update conversation when messages change (debounced to prevent infinite loops)
    useEffect(() => {
        if (currentConversation && messages.length > 0 && conversationid && conversationid !== 'undefined') {
            const conversationMessages: ConversationMessage[] = messages.map(msg => ({
                id: msg.id,
                role: msg.role as 'user' | 'assistant' | 'system',
                content: msg.content,
                timestamp: new Date(),
            }));

            // Only update if messages actually changed
            const currentMessages = currentConversation.messages;
            const messagesChanged = currentMessages.length !== conversationMessages.length ||
                conversationMessages.some((msg, index) =>
                    !currentMessages[index] ||
                    currentMessages[index].content !== msg.content ||
                    currentMessages[index].role !== msg.role
                );

            if (messagesChanged) {
                console.log('Messages changed, updating conversation:', conversationid);
                updateConversationMessages(conversationid, conversationMessages);

                // Debounce the save operation
                const timeoutId = setTimeout(() => {
                    const updatedConversation: Conversation = {
                        ...currentConversation,
                        messages: conversationMessages,
                        updatedAt: new Date(),
                        // Update title based on first user message if it's still the default
                        title: currentConversation.title === 'New Conversation' && messages.length > 0 && messages[0].role === 'user'
                            ? messages[0].content.substring(0, 50) + (messages[0].content.length > 50 ? '...' : '')
                            : currentConversation.title,
                    };

                    console.log('Saving conversation with messages:', updatedConversation.messages.length);
                    saveConversation(updatedConversation, authenticatedFetch).then((savedConversation) => {
                        console.log('Conversation saved successfully:', savedConversation?.id);
                        // If the conversation ID changed (from client-generated to database ID), update URL
                        if (savedConversation && savedConversation.id !== conversationid) {
                            router.replace(`/sindi/${savedConversation.id}`);
                        }
                    }).catch((error) => {
                        console.error('Failed to save conversation:', error);
                    });
                }, 1000); // 1 second debounce

                return () => clearTimeout(timeoutId);
            }
        }
    }, [messages, currentConversation, conversationid, updateConversationMessages, saveConversation, authenticatedFetch, router]); // Watch for actual message changes

    // Handle initial message from URL parameter
    useEffect(() => {
        if (message && currentConversation && !loading) {
            // Set the initial message in the input field
            handleInputChange({
                target: { value: decodeURIComponent(message) }
            } as any);
        }
    }, [message, currentConversation, loading, handleInputChange]);

    const handleAttachFile = async () => {
        try {
            const result = await DocumentPicker.getDocumentAsync({
                type: '*/*',
                copyToCacheDirectory: true,
                multiple: false,
            });
            if (!result.canceled && result.assets && result.assets.length > 0) {
                setAttachedFile(result.assets[0]);
            }
        } catch (e) {
            console.error('File pick error:', e);
        }
    };

    const handleRemoveFile = () => setAttachedFile(null);

    // Wrap the original handleSubmit to include file info
    const handleSubmitWithFile = () => {
        if (attachedFile) {
            console.log('Sending file:', attachedFile);
            // TODO: Integrate file upload to backend here
            setAttachedFile(null);
        }
        handleSubmit();
    };

    // Early return for unauthenticated users
    if (!isAuthenticated) {
        return (
            <ThemedView style={styles.container} lightColor="transparent" darkColor="transparent">
                <Header options={{
                    title: t('sindi.conversation.title'),
                    showBackButton: true,
                    rightComponents: [
                        <TouchableOpacity key="share" onPress={() => {/* TODO: Implement share */ }}>
                            <IconComponent name="share-outline" size={24} color={colors.COLOR_BLACK} />
                        </TouchableOpacity>
                    ]
                }} />
                <EmptyState
                    icon="lock-closed"
                    title={t('sindi.auth.required')}
                    description={t('sindi.auth.message')}
                    actionText="Sign In"
                    actionIcon="log-in"
                    onAction={() => router.push('/profile')}
                    iconColor={colors.primaryColor}
                />
            </ThemedView>
        );
    }

    if (loading) {
        return (
            <ThemedView style={styles.container} lightColor="transparent" darkColor="transparent">
                <Header options={{
                    title: t('sindi.conversation.loading'),
                    showBackButton: true
                }} />
                <View style={styles.loadingContainer}>
                    <IconComponent name="hourglass" size={48} color={colors.primaryColor} />
                    <Text style={styles.loadingText}>{t('sindi.conversation.loadingMessage')}</Text>
                </View>
            </ThemedView>
        );
    }

    if (error) return (
        <SafeAreaView style={styles.container}>
            <Header options={{
                title: t('sindi.conversation.error'),
                showBackButton: true
            }} />
            <LinearGradient
                colors={[colors.primaryColor, colors.secondaryLight]}
                style={styles.errorContainer}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
            >
                <View style={styles.errorContent}>
                    <IconComponent name="alert-circle" size={48} color="white" />
                    <Text style={styles.errorText}>{t('sindi.errors.connection')}</Text>
                    <Text style={styles.errorSubtext}>{t('sindi.errors.connectionMessage')}</Text>
                </View>
            </LinearGradient>
        </SafeAreaView>
    );

    // Web-specific styles for sticky positioning
    const webStyles = Platform.OS === 'web' ? {
        container: { height: '100vh', display: 'flex', flexDirection: 'column' } as any,
        stickyHeader: { position: 'sticky', top: 0 } as any,
        messagesContainer: { marginTop: 0, marginBottom: 0, flex: 1, overflow: 'auto' } as any,
        stickyInput: { position: 'sticky', bottom: 0 } as any,
        messagesContent: { paddingBottom: 100 }
    } : {};

    return (
        <SafeAreaView style={[styles.container, webStyles.container]}>
            {/* Header */}
            <Header
                options={{
                    title: currentConversation?.title || t('sindi.conversation.title'),
                    subtitle: t('sindi.conversation.subtitle'),
                    showBackButton: true,
                    rightComponents: [
                        <TouchableOpacity key="share" onPress={async () => {
                            if (!currentConversation || currentConversation.id.startsWith('conv_')) {
                                Alert.alert(
                                    t('sindi.shared.share.error.title'),
                                    t('sindi.shared.share.error.saveFirst')
                                );
                                return;
                            }

                            // Don't allow sharing empty conversations
                            if (!currentConversation.messages || currentConversation.messages.length === 0) {
                                Alert.alert(
                                    t('sindi.shared.share.error.title'),
                                    t('sindi.shared.share.error.emptyConversation')
                                );
                                return;
                            }

                            try {
                                // Generate share token using store method
                                const shareToken = await generateShareToken(currentConversation.id, authenticatedFetch);

                                if (shareToken) {
                                    const shareUrl = `${Platform.OS === 'web' ? window.location.origin : 'https://homiio.com'}/sindi/shared/${shareToken}`;

                                    if (Platform.OS === 'web' && navigator.share) {
                                        navigator.share({
                                            title: currentConversation.title,
                                            text: t('sindi.shared.share.text'),
                                            url: shareUrl,
                                        });
                                    } else if (Platform.OS === 'web') {
                                        navigator.clipboard.writeText(shareUrl);
                                        Alert.alert(
                                            t('sindi.shared.share.success.title'),
                                            t('sindi.shared.share.success.copied')
                                        );
                                    }
                                } else {
                                    Alert.alert(
                                        t('sindi.shared.share.error.title'),
                                        t('sindi.shared.share.error.failed')
                                    );
                                }
                            } catch (error) {
                                console.error('Failed to share conversation:', error);
                                Alert.alert(
                                    t('sindi.shared.share.error.title'),
                                    t('sindi.shared.share.error.failed')
                                );
                            }
                        }}>
                            <IconComponent name="share-outline" size={24} color={colors.COLOR_BLACK} />
                        </TouchableOpacity>
                    ]
                }}
            />

            {/* Messages */}
            <ScrollView
                style={[styles.messagesContainer, webStyles.messagesContainer]}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={[styles.messagesContent, webStyles.messagesContent]}
            >
                {messages.length === 0 ? (
                    <View style={styles.emptyContainer}>
                        <LinearGradient
                            colors={[colors.primaryColor, colors.secondaryLight]}
                            style={styles.emptyHeader}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                        >
                            <View style={styles.emptyIconContainer}>
                                <SindiIcon size={56} color="white" />
                            </View>
                            <Text style={styles.emptyTitle}>{t('sindi.conversation.empty.title')}</Text>
                            <Text style={styles.emptySubtitle}>
                                {t('sindi.conversation.empty.subtitle')}
                            </Text>
                            <View style={styles.emptyActions}>
                                <View style={styles.emptyActionItem}>
                                    <IconComponent name="help-circle" size={20} color="rgba(255, 255, 255, 0.8)" />
                                    <Text style={styles.emptyActionText}>Ask about tenant rights</Text>
                                </View>
                                <View style={styles.emptyActionItem}>
                                    <IconComponent name="search" size={20} color="rgba(255, 255, 255, 0.8)" />
                                    <Text style={styles.emptyActionText}>Find housing options</Text>
                                </View>
                                <View style={styles.emptyActionItem}>
                                    <IconComponent name="document-text" size={20} color="rgba(255, 255, 255, 0.8)" />
                                    <Text style={styles.emptyActionText}>Review lease agreements</Text>
                                </View>
                            </View>
                        </LinearGradient>
                    </View>
                ) : (
                    messages.map(m => (
                        <View key={m.id} style={[
                            styles.messageContainer,
                            m.role === 'user' ? styles.userMessage : styles.assistantMessage
                        ]}>
                            <View style={[
                                styles.messageBubble,
                                m.role === 'user' ? styles.userBubble : styles.assistantBubble
                            ]}>
                                {
                                    // If this is a property search result system message, parse and render cards
                                    m.role === 'system' &&
                                        m.content.startsWith('PROPERTY SEARCH RESULTS:') ? (() => {
                                            // Extract property lines
                                            const lines = m.content.split('\n').filter(line => line.startsWith('- '));
                                            const properties = lines.map(line => {
                                                // Try to parse title, type, rent, city from the line
                                                const match = line.match(/^- (.*?) \((.*?), (.*?)\)(, (.*?))?$/);
                                                if (match) {
                                                    return {
                                                        title: match[1],
                                                        type: match[2],
                                                        rent: { amount: match[3] },
                                                        address: { city: match[5] },
                                                        _id: match[1] + '-' + (match[5] || ''), // Fallback unique id
                                                        id: match[1] + '-' + (match[5] || ''),
                                                    };
                                                }
                                                return undefined;
                                            }).filter((p): p is any => !!p);
                                            return (
                                                <View key={m.id || m.content} style={styles.propertyCardsContainer}>
                                                    {properties.map((property, idx) => (
                                                        <PropertyCard
                                                            key={property._id || property.id || idx}
                                                            property={property}
                                                            variant={"featured"}
                                                            onPress={() => router.push(`/properties/${property._id || property.id}`)}
                                                        />
                                                    ))}
                                                </View>
                                            );
                                        })() : (
                                        <View style={{ flexShrink: 1, flexWrap: 'wrap', width: '100%' }}>
                                            <Text style={[
                                                styles.markdownParagraph,
                                                {
                                                    color: m.role === 'user' ? 'white' : '#2c3e50',
                                                    flexWrap: 'wrap',
                                                    flexShrink: 1,
                                                    width: '100%',
                                                }
                                            ]}>
                                                {m.content}
                                            </Text>
                                        </View>
                                    )
                                }
                            </View>
                            <Text style={styles.messageTime}>
                                {m.role === 'user' ? t('sindi.chat.you') : t('sindi.name')} • {new Date().toLocaleTimeString()}
                            </Text>
                        </View>
                    ))
                )}
            </ScrollView>

            {/* Sticky Input */}
            <View style={[styles.stickyInput, webStyles.stickyInput]}>
                <LinearGradient
                    colors={[colors.primaryColor, colors.secondaryLight]}
                    style={styles.inputGradient}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                >
                    <View style={styles.inputContainer}>
                        {/* File preview */}
                        {attachedFile && (
                            <View style={styles.filePreviewContainer}>
                                <Text style={styles.filePreviewText}>{attachedFile.name}</Text>
                                <TouchableOpacity onPress={handleRemoveFile} style={styles.removeFileButton}>
                                    <IconComponent name="close-circle" size={18} color="#e74c3c" />
                                </TouchableOpacity>
                            </View>
                        )}
                        <View style={styles.inputWrapper}>
                            {/* Attach button */}
                            <TouchableOpacity onPress={handleAttachFile} style={styles.attachButton}>
                                <IconComponent name="attach" size={20} color="white" />
                            </TouchableOpacity>
                            <TextInput
                                style={styles.textInput}
                                placeholder={t('sindi.chat.placeholder')}
                                placeholderTextColor="rgba(255, 255, 255, 0.6)"
                                value={input}
                                onChangeText={(text) => handleInputChange({
                                    target: { value: text }
                                } as any)}
                                onSubmitEditing={handleSubmitWithFile}
                                multiline
                                maxLength={1000}
                            />
                            <TouchableOpacity
                                style={[styles.sendButton, !input.trim() && styles.sendButtonDisabled]}
                                onPress={handleSubmitWithFile}
                                disabled={!input.trim() || isLoading}
                            >
                                <IconComponent
                                    name={isLoading ? "hourglass" : "send"}
                                    size={20}
                                    color={input.trim() ? "white" : "rgba(255, 255, 255, 0.4)"}
                                />
                            </TouchableOpacity>
                        </View>
                        <Text style={styles.disclaimer}>
                            {t('sindi.chat.disclaimer')}
                        </Text>
                    </View>
                </LinearGradient>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f8f9fa',
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 40,
    },
    loadingText: {
        marginTop: 16,
        fontSize: 16,
        color: colors.COLOR_BLACK_LIGHT_3,
    },
    messagesContainer: {
        flex: 1,
        marginBottom: 120, // Account for sticky input
    },
    messagesContent: {
        paddingHorizontal: 16,
        paddingVertical: 20,
    },
    emptyContainer: {
        paddingVertical: 40,
        paddingHorizontal: 20,
    },
    emptyHeader: {
        alignItems: 'center',
        padding: 32,
        borderRadius: 28,
        borderWidth: 1,
        borderColor: colors.COLOR_BLACK,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
        elevation: 4,
    },
    emptyIconContainer: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: 'rgba(255, 255, 255, 0.15)',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 20,
    },
    emptyTitle: {
        fontSize: 26,
        fontWeight: 'bold',
        color: 'white',
        marginBottom: 12,
        fontFamily: 'Phudu',
        textAlign: 'center',
    },
    emptySubtitle: {
        fontSize: 16,
        color: 'rgba(255, 255, 255, 0.9)',
        textAlign: 'center',
        lineHeight: 24,
        paddingHorizontal: 20,
        marginBottom: 24,
    },
    emptyActions: {
        alignItems: 'flex-start',
        gap: 12,
    },
    emptyActionItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 4,
    },
    emptyActionText: {
        fontSize: 14,
        color: 'rgba(255, 255, 255, 0.8)',
        marginLeft: 12,
        fontWeight: '500',
    },
    messageContainer: {
        marginVertical: 6,
        paddingHorizontal: 4,
    },
    userMessage: {
        alignItems: 'flex-end',
        marginLeft: 40,
    },
    assistantMessage: {
        alignItems: 'flex-start',
        marginRight: 40,
    },
    messageBubble: {
        maxWidth: '85%',
        paddingHorizontal: 18,
        paddingVertical: 14,
        borderRadius: 24,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 3,
        elevation: 2,
    },
    userBubble: {
        backgroundColor: colors.primaryColor,
        borderTopRightRadius: 8,
    },
    assistantBubble: {
        backgroundColor: 'white',
        borderWidth: 1,
        borderColor: '#e9ecef',
        borderTopLeftRadius: 8,
    },
    messageTime: {
        fontSize: 12,
        color: '#95a5a6',
        marginTop: 4,
        marginHorizontal: 8,
    },
    stickyInput: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        backgroundColor: 'white',
        borderTopWidth: 1,
        borderTopColor: '#e9ecef',
    },
    inputGradient: {
        margin: 16,
        marginBottom: 8,
        borderRadius: 28,
        borderWidth: 1,
        borderColor: colors.COLOR_BLACK,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
        elevation: 4,
    },
    inputContainer: {
        paddingHorizontal: 20,
        paddingVertical: 16,
    },
    inputWrapper: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        backgroundColor: 'rgba(255, 255, 255, 0.15)',
        borderRadius: 26,
        paddingHorizontal: 18,
        paddingVertical: 10,
        minHeight: 52,
    },
    textInput: {
        flex: 1,
        fontSize: 16,
        maxHeight: 120,
        paddingVertical: 12,
        paddingHorizontal: 4,
        color: 'white',
        lineHeight: 22,
    },
    sendButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(255, 255, 255, 0.25)',
        justifyContent: 'center',
        alignItems: 'center',
        marginLeft: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 3,
        elevation: 2,
    },
    sendButtonDisabled: {
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
        shadowOpacity: 0,
        elevation: 0,
    },
    disclaimer: {
        fontSize: 11,
        color: 'rgba(255, 255, 255, 0.7)',
        textAlign: 'center',
        marginTop: 8,
        fontStyle: 'italic',
    },
    errorContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 40,
        margin: 16,
        borderRadius: 25,
        borderWidth: 1,
        borderColor: colors.COLOR_BLACK,
    },
    errorContent: {
        alignItems: 'center',
    },
    errorText: {
        fontSize: 18,
        fontWeight: 'bold',
        color: 'white',
        marginTop: 16,
        marginBottom: 8,
        fontFamily: 'Phudu',
    },
    errorSubtext: {
        fontSize: 14,
        color: 'rgba(255, 255, 255, 0.8)',
        textAlign: 'center',
    },
    markdownParagraph: {
        fontSize: 16,
        lineHeight: 22,
        marginBottom: 4,
    },
    propertyCardsContainer: {
        marginVertical: 12,
        gap: 12,
    },

    filePreviewContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.15)',
        borderRadius: 8,
        padding: 6,
        marginBottom: 6,
    },
    filePreviewText: {
        color: 'white',
        fontSize: 13,
        marginRight: 8,
    },
    removeFileButton: {
        padding: 2,
    },
    attachButton: {
        marginRight: 8,
        padding: 4,
    },
});