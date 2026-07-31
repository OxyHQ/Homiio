import { useState, useEffect } from 'react';
import { Property, SindiSuggestion } from '@homiio/shared-types';
import { api } from '@/utils/api';
import { useOxy } from '@oxyhq/services';

interface UseSindiSuggestionsProps {
    property?: Property;
    conversationContext?: string;
}

interface SuggestionsResponse {
    success: boolean;
    suggestions: SindiSuggestion[];
    generated: boolean;
    propertyContext: boolean;
}

const DEFAULT_SUGGESTIONS: SindiSuggestion[] = [
    { text: 'How much should I budget?' },
    { text: 'Review my lease terms' },
    { text: 'What are my rights?' },
    { text: 'Tell me about this area' },
    { text: 'Are there hidden costs?' },
    { text: 'What should I inspect?' },
    { text: 'How to negotiate rent?' },
    { text: 'Red flags to watch for?' },
];

export function useSindiSuggestions({ property, conversationContext }: UseSindiSuggestionsProps = {}) {
    // Keyed by the property it was fetched for, so the fallback below is DERIVED
    // rather than reset by an effect. The effect used to call
    // `setSuggestions(DEFAULT_SUGGESTIONS)` synchronously whenever it could not
    // fetch — a cascading render, and on the very first pass a no-op, since that
    // is already the initial value. Keying also fixes a real bug: suggestions
    // fetched for one property stayed on screen while the next one loaded.
    const [fetched, setFetched] = useState<{ propertyId: string; items: SindiSuggestion[] } | null>(
        null,
    );
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { oxyServices, activeSessionId } = useOxy();

    const propertyId = property?._id || property?.id;
    const suggestions =
        fetched && fetched.propertyId === propertyId ? fetched.items : DEFAULT_SUGGESTIONS;

    useEffect(() => {
        if (!property || !propertyId || !oxyServices || !activeSessionId) {
            return;
        }
        
        const fetchSuggestions = async () => {
            setLoading(true);
            setError(null);

            try {
                // Build property context for better suggestions
                const propertyContext = {
                    type: property.type,
                    city: property.address?.cityName,
                    bedrooms: property.bedrooms,
                    bathrooms: property.bathrooms,
                    offerings: property.offerings,
                    longTermRent: property.longTermRent,
                    shortTermRent: property.shortTermRent,
                    amenities: property.amenities || [],
                };

                const response = await api.post<SuggestionsResponse>('/api/ai/suggestions', {
                    propertyId,
                    propertyContext,
                    conversationContext,
                });

                const data = response.data;

                setFetched({
                    propertyId,
                    items:
                        data.success && data.suggestions?.length > 0
                            ? data.suggestions
                            : DEFAULT_SUGGESTIONS,
                });

            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to load suggestions');
                setFetched({ propertyId, items: DEFAULT_SUGGESTIONS });
            } finally {
                setLoading(false);
            }
        };

        fetchSuggestions();
    }, [property, propertyId, conversationContext, oxyServices, activeSessionId]);

    return { suggestions, loading, error };
}
