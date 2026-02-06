import { useState, useCallback, useEffect } from 'react';

// Types for address search
export interface AddressSuggestion {
  id: string;
  text: string;
  icon: string;
  lat?: number;
  lon?: number;
  address?: {
    street: string;
    city: string;
    state: string;
    country: string;
    postcode: string;
  };
}

export interface AddressSearchOptions {
  minQueryLength?: number;
  debounceDelay?: number;
  maxResults?: number;
  includeAddressDetails?: boolean;
}

export interface UseAddressSearchReturn {
  suggestions: AddressSuggestion[];
  loading: boolean;
  error: string | null;
  searchAddresses: (query: string) => Promise<void>;
  clearSuggestions: () => void;
  setSuggestions: (suggestions: AddressSuggestion[]) => void;
}

/**
 * Reusable hook for address search using OpenStreetMap Nominatim API
 *
 * @param options - Configuration options for the address search
 * @returns Object with suggestions, loading state, error state, and search functions
 *
 * @example
 * ```tsx
 * const { suggestions, loading, error, searchAddresses, clearSuggestions } = useAddressSearch({
 *   minQueryLength: 3,
 *   debounceDelay: 500,
 *   maxResults: 5
 * });
 *
 * // Search for addresses
 * await searchAddresses('123 Main St');
 *
 * // Clear suggestions
 * clearSuggestions();
 * ```
 */
export const useAddressSearch = (options: AddressSearchOptions = {}): UseAddressSearchReturn => {
  const {
    minQueryLength = 3,
    debounceDelay = 500,
    maxResults = 5,
    includeAddressDetails = true,
  } = options;

  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Search for addresses using OpenStreetMap Nominatim API
   */
  const searchAddresses = useCallback(
    async (query: string) => {
      if (!query.trim() || query.length < minQueryLength) {
        setSuggestions([]);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        // Build the API URL with parameters
        const params = new URLSearchParams({
          format: 'json',
          q: query.trim(),
          limit: maxResults.toString(),
          ...(includeAddressDetails && { addressdetails: '1' }),
        });

        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?${params.toString()}`,
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: Failed to fetch address suggestions`);
        }

        const data = await response.json();

        // Transform the API response to our format
        const transformedSuggestions: AddressSuggestion[] = data.map(
          (result: any, index: number) => ({
            id: result.place_id?.toString() || index.toString(),
            text: result.display_name,
            icon: 'location-outline',
            lat: parseFloat(result.lat),
            lon: parseFloat(result.lon),
            address: includeAddressDetails
              ? {
                  street: result.address?.road || '',
                  city:
                    result.address?.city || result.address?.town || result.address?.village || '',
                  state: result.address?.state || '',
                  country: result.address?.country || '',
                  postcode: result.address?.postcode || '',
                }
              : undefined,
          }),
        );

        setSuggestions(transformedSuggestions);
      } catch (err: any) {
        setError(err.message || 'Failed to fetch address suggestions');
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    },
    [minQueryLength, maxResults, includeAddressDetails],
  );

  /**
   * Clear all suggestions
   */
  const clearSuggestions = useCallback(() => {
    setSuggestions([]);
    setError(null);
  }, []);

  /**
   * Set suggestions manually (useful for testing or custom data)
   */
  const setSuggestionsManually = useCallback((newSuggestions: AddressSuggestion[]) => {
    setSuggestions(newSuggestions);
  }, []);

  return {
    suggestions,
    loading,
    error,
    searchAddresses,
    clearSuggestions,
    setSuggestions: setSuggestionsManually,
  };
};

/**
 * Hook that combines address search with debounced input
 *
 * @param options - Configuration options for the address search
 * @returns Object with suggestions, loading state, error state, and debounced search function
 *
 * @example
 * ```tsx
 * const { suggestions, loading, error, debouncedSearch } = useDebouncedAddressSearch({
 *   minQueryLength: 3,
 *   debounceDelay: 500,
 *   maxResults: 5
 * });
 *
 * // Use with input onChange
 * <TextInput onChangeText={debouncedSearch} />
 * ```
 */
export const useDebouncedAddressSearch = (
  options: AddressSearchOptions = {},
): UseAddressSearchReturn & {
  debouncedSearch: (query: string) => void;
} => {
  const { debounceDelay = 500, ...searchOptions } = options;

  const { suggestions, loading, error, searchAddresses, clearSuggestions, setSuggestions } =
    useAddressSearch(searchOptions);

  const [debouncedQuery, setDebouncedQuery] = useState('');

  // Debounced search effect
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (debouncedQuery.trim()) {
        searchAddresses(debouncedQuery);
      } else {
        clearSuggestions();
      }
    }, debounceDelay);

    return () => clearTimeout(timeoutId);
  }, [debouncedQuery, debounceDelay, searchAddresses, clearSuggestions]);

  /**
   * Debounced search function for use with input onChange
   */
  const debouncedSearch = useCallback((query: string) => {
    setDebouncedQuery(query);
  }, []);

  return {
    suggestions,
    loading,
    error,
    searchAddresses,
    clearSuggestions,
    setSuggestions,
    debouncedSearch,
  };
};

/**
 * Hook for reverse geocoding (coordinates to address)
 *
 * @returns Object with reverse geocoding function and result
 *
 * @example
 * ```tsx
 * const { reverseGeocode, result, loading, error } = useReverseGeocode();
 *
 * // Get address from coordinates
 * await reverseGeocode(41.38723, 2.16538);
 * ```
 */
export const useReverseGeocode = () => {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reverseGeocode = useCallback(async (lat: number, lng: number) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`,
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: Failed to reverse geocode`);
      }

      const data = await response.json();
      setResult(data);
    } catch (err: any) {
      setError(err.message || 'Failed to reverse geocode');
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const clearResult = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return {
    result,
    loading,
    error,
    reverseGeocode,
    clearResult,
  };
};
