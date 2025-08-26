import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    StyleSheet,
    Dimensions,
    Platform,
} from 'react-native';
import { ChatContent } from '@/app/sindi/[conversationId]';
import { Property } from '@homiio/shared-types';
import { useOxy } from '@oxyhq/services';
import { useConversationStore } from '@/store/conversationStore';
import type { Conversation } from '@/store/conversationStore';
import { fetch as expoFetch } from 'expo/fetch';
import { ScrollView } from 'react-native-gesture-handler';

const { height: screenHeight } = Dimensions.get('window');

interface SindiChatBottomSheetProps {
    /** Property object containing details to discuss with Sindi AI */
    property: Property;
    /** Callback function called when the bottom sheet should be closed */
    onClose: () => void;
    /** Optional initial message to send instead of the default property message */
    initialMessage?: string;
}

/**
 * Bottom sheet component that embeds Sindi AI chat for property-specific conversations.
 * Creates a new conversation with the property context and automatically sends an initial message.
 */
export function SindiChatBottomSheet({ property, initialMessage }: SindiChatBottomSheetProps) {
    const { oxyServices, activeSessionId } = useOxy();
    const { createConversation } = useConversationStore();
    const [conversationId, setConversationId] = useState<string | undefined>();
    const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null);
    const [initialMessageToSend, setInitialMessageToSend] = useState<string | undefined>();
    const isInitialized = useRef(false);

    // Create authenticated fetch function like in the main screen
    const authenticatedFetch = useCallback(
        async (url: string | URL | Request, options: RequestInit = {}) => {
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                ...((options.headers as Record<string, string>) || {}),
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

            // If sending multipart, let fetch set the boundary header automatically
            if (typeof FormData !== 'undefined' && body instanceof FormData) {
                delete headers['Content-Type'];
            }

            const fetchOptions = {
                ...otherOptions,
                headers,
                ...(body !== null && { body }),
            };

            // Use appropriate fetch implementation
            const fetchImpl: typeof globalThis.fetch = Platform.OS === 'web' ? globalThis.fetch : (expoFetch as any);
            return fetchImpl(url, fetchOptions as any);
        },
        [oxyServices, activeSessionId],
    );

    useEffect(() => {
        // Prevent multiple initializations and ensure auth is ready
        if (isInitialized.current || !oxyServices || !activeSessionId) return;

        // Validate required property data
        if (!property._id && !property.id) {
            console.error('Property ID is required for Sindi chat');
            return;
        }

        // Create a new conversation when the bottom sheet opens
        const initializeConversation = async () => {
            try {
                isInitialized.current = true;

                // Create conversation title with fallback values
                const city = property.address?.city || 'Unknown Location';
                const type = property.type || 'Property';
                const conversationTitle = `Property: ${city} - ${type}`;

                // Create an empty conversation (no initial message)
                const newConversation = await createConversation(
                    conversationTitle,
                    undefined, // No initial message - we'll send it manually
                    authenticatedFetch
                );

                if (newConversation?.id) {
                    setConversationId(newConversation.id);
                    setCurrentConversation(newConversation);

                    let messageToSend: string;

                    if (initialMessage) {
                        // Use the provided initial message (e.g., from suggestion chips)
                        const propertyId = property._id || property.id;
                        messageToSend = `${initialMessage}

<PROPERTIES_JSON>["${propertyId}"]</PROPERTIES_JSON>`;
                    } else {
                        // Build default property message with safe property access
                        const bedrooms = property.bedrooms || 'unspecified';
                        const bathrooms = property.bathrooms || 'unspecified';
                        const location = property.address?.city || 'the area';
                        const rent = property.rent?.amount || 'unspecified';
                        const currency = property.rent?.currency || '';
                        const priceUnit = property.priceUnit || 'month';
                        const propertyId = property._id || property.id;

                        messageToSend = `I'm interested in this property: ${type} with ${bedrooms} bedrooms and ${bathrooms} bathrooms in ${location}. The rent is ${rent} ${currency}/${priceUnit}. Can you help me understand more about this property and my rental rights?

<PROPERTIES_JSON>["${propertyId}"]</PROPERTIES_JSON>`;
                    }

                    // Set the message immediately - no timeout needed
                    console.log('Setting initial message:', messageToSend);
                    setInitialMessageToSend(messageToSend);
                } else {
                    console.error('Failed to create conversation: Invalid response');
                    isInitialized.current = false;
                }
            } catch (error) {
                console.error('Failed to create conversation:', error);
                // Reset so user can try again
                isInitialized.current = false;
                // Fallback to undefined conversation ID which will create a new one
                setConversationId(undefined);
            }
        };

        initializeConversation();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [oxyServices, activeSessionId]); // Only depend on auth state

    // Check if user is authenticated
    const isAuthenticated = !!oxyServices && !!activeSessionId;

    console.log('SindiChatBottomSheet render:', {
        conversationId,
        hasConversation: !!currentConversation,
        hasInitialMessage: !!initialMessageToSend,
        isAuthenticated
    });

    return (
        <ScrollView style={styles.container}>
            <ChatContent
                conversationId={conversationId}
                currentConversation={currentConversation}
                isAuthenticated={isAuthenticated}
                authenticatedFetch={authenticatedFetch as typeof globalThis.fetch}
                initialMessages={[]}
                messageFromUrl={initialMessageToSend}
                style={{ flex: 1 }}
            />
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        maxHeight: screenHeight * 0.9,
        backgroundColor: '#ffffff',
    },
});