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
    const [suggestions, setSuggestions] = useState<SindiSuggestion[]>(DEFAULT_SUGGESTIONS);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { oxyServices, activeSessionId } = useOxy();

    useEffect(() => {
        if (!property || !oxyServices || !activeSessionId) {
            setSuggestions(DEFAULT_SUGGESTIONS);
            return;
        }

        const propertyId = property._id || property.id;
        
        const fetchSuggestions = async () => {
            setLoading(true);
            setError(null);

            try {
                // Build property context for better suggestions
                const propertyContext = {
                    type: property.type,
                    city: property.address?.city,
                    bedrooms: property.bedrooms,
                    bathrooms: property.bathrooms,
                    rent: property.rent,
                    amenities: property.amenities || [],
                };

                const response = await api.post<SuggestionsResponse>('/api/ai/suggestions', {
                    propertyId,
                    propertyContext,
                    conversationContext,
                }, {
                    oxyServices,
                    activeSessionId,
                });

                const data = response.data;

                if (data.success && data.suggestions?.length > 0) {
                    setSuggestions(data.suggestions);
                } else {
                    setSuggestions(DEFAULT_SUGGESTIONS);
                }

            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to load suggestions');
                setSuggestions(DEFAULT_SUGGESTIONS);
            } finally {
                setLoading(false);
            }
        };

        fetchSuggestions();
    }, [property, conversationContext, oxyServices, activeSessionId]);

    return {
        suggestions,
        loading,
        error,
        refetch: () => {
            if (property && oxyServices && activeSessionId) {
                // Trigger re-fetch by updating a dependency
                setSuggestions(DEFAULT_SUGGESTIONS);
            }
        },
    };
}
