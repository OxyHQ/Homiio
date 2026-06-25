import React, { useState, useEffect, useRef } from 'react';
import {
    StyleSheet,
    Dimensions,
} from 'react-native';
import { ChatContent } from '@/components/sindi/ChatContent';
import { Property } from '@homiio/shared-types';
import { useOxy } from '@oxyhq/services';
import { useConversationStore } from '@/store/conversationStore';
import type { Conversation } from '@/store/conversationStore';
import { useSindiAuthenticatedFetch } from '@/hooks/useSindiAuthenticatedFetch';
import { ScrollView } from 'react-native-gesture-handler';
import { logger } from '@/utils/logger';
import { colors } from '@/styles/colors';

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

    // Shared streaming-capable authenticated fetch (single source of truth for
    // every Sindi surface). The token comes straight from the SDK; no app-local
    // refresh plumbing here.
    const authenticatedFetch = useSindiAuthenticatedFetch();

    useEffect(() => {
        // Prevent multiple initializations and ensure auth is ready
        if (isInitialized.current || !oxyServices || !activeSessionId) return;

        // Validate required property data
        if (!property._id && !property.id) {
            logger.error('Property ID is required for Sindi chat');
            return;
        }

        // Create a new conversation when the bottom sheet opens
        const initializeConversation = async () => {
            try {
                isInitialized.current = true;

                // Create conversation title with fallback values
                const city = property.address?.cityName || 'Unknown Location';
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
                        // Build default property message with safe property access.
                        // Prefer the long-term (monthly) price; fall back to the
                        // short-term (nightly) price for vacation-only listings.
                        const bedrooms = property.bedrooms || 'unspecified';
                        const bathrooms = property.bathrooms || 'unspecified';
                        const location = property.address?.cityName || 'the area';
                        const longTerm = property.longTermRent;
                        const shortTerm = property.shortTermRent;
                        const rent = longTerm?.monthlyAmount ?? shortTerm?.nightlyRate ?? 'unspecified';
                        const currency = longTerm?.currency || shortTerm?.currency || '';
                        const priceUnit = longTerm ? 'month' : shortTerm ? 'night' : 'month';
                        const propertyId = property._id || property.id;

                        messageToSend = `I'm interested in this property: ${type} with ${bedrooms} bedrooms and ${bathrooms} bathrooms in ${location}. The rent is ${rent} ${currency}/${priceUnit}. Can you help me understand more about this property and my rental rights?

<PROPERTIES_JSON>["${propertyId}"]</PROPERTIES_JSON>`;
                    }

                    // Set the message immediately - no timeout needed
                    setInitialMessageToSend(messageToSend);
                } else {
                    logger.error('Failed to create conversation: Invalid response');
                    isInitialized.current = false;
                }
            } catch (error) {
                logger.error('Failed to create conversation:', error);
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

    return (
        <ScrollView style={styles.container}>
            <ChatContent
                conversationId={conversationId}
                currentConversation={currentConversation}
                isAuthenticated={isAuthenticated}
                authenticatedFetch={authenticatedFetch}
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
        backgroundColor: colors.white,
    },
});
