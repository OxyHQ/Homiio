import React, { useState, useRef, useEffect } from 'react';
import {
    View,
    StyleSheet,
    ScrollView,
    Alert,
    TouchableOpacity,
    Text,
    TextInput,
    ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

// Components
import { Header } from '@/components/Header';
import { ThemedText } from '@/components/ThemedText';
import { useOxy } from '@oxyhq/services';
import Map from '@/components/Map';

// Services and hooks
import { api } from '@/utils/api';
import { default as reviewService } from '@/services/reviewService';
// Types
import { colors } from '@/styles/colors';

// Local type definitions

interface ReviewFormData {
    // Address information
    street: string;
    city: string;
    state: string;
    postal_code: string;
    country: string;
    number?: string;
    building_name?: string;
    floor?: string;
    unit?: string;

    // Coordinates for map
    latitude?: number;
    longitude?: number;

    // Basic Information
    greenHouse: string;
    price: string;
    currency: string;
    livedFrom: string;
    livedTo: string;
    recommendation: boolean | null;
    opinion: string;
    positiveComment: string;
    negativeComment: string;
    rating: number;

    // Apartment-specific ratings
    summerTemperature: string;
    winterTemperature: string;
    noise: string;
    light: string;
    conditionAndMaintenance: string;
    services: string[];

    // Community-specific ratings
    landlordTreatment: string;
    problemResponse: string;
    depositReturned: boolean | null;
    staircaseNeighbors: string;
    touristApartments: boolean | null;
    neighborRelations: string;
    cleaning: string;

    // Area-specific ratings
    areaTourists: string;
    areaSecurity: string;
}

const initialFormData: ReviewFormData = {
    // Address information
    street: '',
    city: '',
    state: '',
    postal_code: '',
    country: '',
    number: '',
    building_name: '',
    floor: '',
    unit: '',

    // Coordinates for map
    latitude: undefined,
    longitude: undefined,

    // Basic Information
    greenHouse: '',
    price: '',
    currency: 'EUR',
    livedFrom: '',
    livedTo: '',
    recommendation: null,
    opinion: '',
    positiveComment: '',
    negativeComment: '',
    rating: 0,
    summerTemperature: '',
    winterTemperature: '',
    noise: '',
    light: '',
    conditionAndMaintenance: '',
    services: [],
    landlordTreatment: '',
    problemResponse: '',
    depositReturned: null,
    staircaseNeighbors: '',
    touristApartments: null,
    neighborRelations: '',
    cleaning: '',
    areaTourists: '',
    areaSecurity: '',
};

export default function WriteReviewPage() {
    const { addressId } = useLocalSearchParams<{ addressId: string }>();
    const router = useRouter();
    const { t: _t } = useTranslation();
    const { oxyServices, activeSessionId } = useOxy();
    const mapRef = useRef<any>(null);

    // State variables
    const [formData, setFormData] = useState<ReviewFormData>(initialFormData);
    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Fetch address data if addressId is provided
    useEffect(() => {
        if (addressId && oxyServices && activeSessionId) {
            setLoading(true);
            const fetchAddress = async () => {
                try {
                    const response = await api.get(`/api/addresses/${addressId}`, {
                        oxyServices,
                        activeSessionId
                    });
                    const address = response.data?.address || response.data;

                    // Auto-fill form data with address information
                    setFormData(prev => ({
                        ...prev,
                        street: address.street || '',
                        city: address.city || '',
                        state: address.state || '',
                        postal_code: address.postal_code || address.zipCode || '', // Support legacy field
                        country: address.country || '',
                        number: address.number || '',
                        building_name: address.building_name || '',
                        floor: address.floor || '',
                        unit: address.unit || '',
                        latitude: address.coordinates?.coordinates?.[1],
                        longitude: address.coordinates?.coordinates?.[0],
                    }));

                    // Move map to the address location if coordinates exist
                    if (address.coordinates?.coordinates && mapRef.current) {
                        const [lng, lat] = address.coordinates.coordinates;
                        mapRef.current.navigateToLocation([lng, lat], 15);
                    }
                } catch (err) {
                    console.error('Error fetching address:', err);
                    setError('Failed to load address information');
                } finally {
                    setLoading(false);
                }
            };

            fetchAddress();
        }
    }, [addressId, oxyServices, activeSessionId]);

    // Handle address selection from map
    const handleAddressSelect = React.useCallback((address: any, coordinates: [number, number]) => {
        console.log('handleAddressSelect received address data:', address);

        // Update form with coordinates
        setFormData(prev => ({
            ...prev,
            latitude: coordinates[1],
            longitude: coordinates[0],
            // Auto-fill address fields
            ...(address.street && { street: address.street }),
            ...(address.houseNumber && { number: address.houseNumber }),
            ...(address.city && { city: address.city }),
            ...(address.state && { state: address.state }),
            ...(address.country && { country: address.country }),
            ...(address.postalCode && { postal_code: address.postalCode }),
        }));

        // Move map to selected location
        if (mapRef.current) {
            mapRef.current.navigateToLocation(coordinates, 15);
        }
    }, []);

    const updateFormData = (field: keyof ReviewFormData, value: any) => {
        setFormData(prev => ({
            ...prev,
            [field]: value
        }));
    };

    const validateForm = (): boolean => {
        // Address validation
        if (!formData.street.trim()) {
            Alert.alert('Validation Error', 'Please provide a street address.');
            return false;
        }

        if (!formData.city.trim()) {
            Alert.alert('Validation Error', 'Please provide a city.');
            return false;
        }

        if (!formData.postal_code.trim()) {
            Alert.alert('Validation Error', 'Please provide a postal code.');
            return false;
        }

        if (!formData.country.trim()) {
            Alert.alert('Validation Error', 'Please provide a country.');
            return false;
        }

        // Review validation
        if (!formData.opinion.trim()) {
            Alert.alert('Validation Error', 'Please provide your opinion about this address.');
            return false;
        }

        if (formData.opinion.trim().length < 10) {
            Alert.alert('Validation Error', 'Your opinion must be at least 10 characters long.');
            return false;
        }

        if (!formData.price || parseFloat(formData.price) <= 0) {
            Alert.alert('Validation Error', 'Please provide a valid price.');
            return false;
        }

        if (!formData.livedFrom || !formData.livedTo) {
            Alert.alert('Validation Error', 'Please provide both start and end dates.');
            return false;
        }

        if (formData.recommendation === null) {
            Alert.alert('Validation Error', 'Please indicate whether you would recommend this address.');
            return false;
        }

        if (formData.rating === 0) {
            Alert.alert('Validation Error', 'Please provide a rating from 1 to 5.');
            return false;
        }

        return true;
    };

    const handleSubmit = async () => {
        if (!validateForm()) return;
        if (!oxyServices || !activeSessionId) return;

        setSubmitting(true);
        try {
            // Calculate lived duration in months
            const startDate = new Date(formData.livedFrom);
            const endDate = new Date(formData.livedTo);
            const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
            const _livedForMonths = Math.ceil(diffTime / (1000 * 60 * 60 * 24 * 30.44));

            const reviewData = {
                // Address data - backend will handle address creation/lookup
                address: {
                    street: formData.street.trim(),
                    city: formData.city.trim(),
                    state: formData.state.trim() || undefined,
                    postal_code: formData.postal_code.trim(),
                    country: formData.country.trim(),
                    number: formData.number?.trim() || undefined,
                    building_name: formData.building_name?.trim() || undefined,
                    floor: formData.floor?.trim() || undefined,
                    unit: formData.unit?.trim() || undefined,
                    ...(formData.latitude && formData.longitude && {
                        latitude: formData.latitude,
                        longitude: formData.longitude
                    })
                },

                // Review data
                greenHouse: formData.greenHouse,
                price: formData.price ? parseFloat(formData.price) : undefined,
                currency: formData.currency,
                livedFrom: formData.livedFrom ? new Date(formData.livedFrom) : undefined,
                livedTo: formData.livedTo ? new Date(formData.livedTo) : undefined,
                livedForMonths: _livedForMonths, // Include the calculated duration
                recommendation: formData.recommendation as boolean, // Ensure it's boolean (validation ensures it's not null)
                opinion: formData.opinion.trim(),
                positiveComment: formData.positiveComment.trim() || undefined,
                negativeComment: formData.negativeComment.trim() || undefined,

                // Core rating - always required
                rating: formData.rating,

                // Optional detailed ratings - only include if they have values
                ...(formData.summerTemperature && { summerTemperature: formData.summerTemperature as any }),
                ...(formData.winterTemperature && { winterTemperature: formData.winterTemperature as any }),
                ...(formData.noise && { noise: formData.noise as any }),
                ...(formData.light && { light: formData.light as any }),
                ...(formData.conditionAndMaintenance && { conditionAndMaintenance: formData.conditionAndMaintenance as any }),
                ...(formData.services.length > 0 && { services: formData.services as any }),
                ...(formData.landlordTreatment && { landlordTreatment: formData.landlordTreatment as any }),
                ...(formData.problemResponse && { problemResponse: formData.problemResponse as any }),
                ...(formData.depositReturned !== null && { depositReturned: formData.depositReturned }),
                ...(formData.staircaseNeighbors && { staircaseNeighbors: formData.staircaseNeighbors as any }),
                ...(formData.touristApartments !== null && { touristApartments: formData.touristApartments }),
                ...(formData.neighborRelations && { neighborRelations: formData.neighborRelations as any }),
                ...(formData.cleaning && { cleaning: formData.cleaning as any }),
                ...(formData.areaTourists && { areaTourists: formData.areaTourists as any }),
                ...(formData.areaSecurity && { areaSecurity: formData.areaSecurity as any })
            }; const result = await reviewService.createReview(reviewData, oxyServices, activeSessionId);

            if (result.success) {
                Alert.alert(
                    'Success',
                    'Your review has been submitted successfully!',
                    [
                        {
                            text: 'OK',
                            onPress: () => router.back()
                        }
                    ]
                );
            } else {
                Alert.alert('Error', result.error || 'Failed to submit review');
            }
        } catch (err) {
            console.error('Error submitting review:', err);
            Alert.alert('Error', 'Failed to submit review. Please try again.');
        } finally {
            setSubmitting(false);
        }
    };

    const renderStarRating = () => {
        return (
            <View style={styles.starRatingContainer}>
                <ThemedText style={styles.fieldLabel}>Overall Rating *</ThemedText>
                <View style={styles.starsContainer}>
                    {[1, 2, 3, 4, 5].map((star) => (
                        <TouchableOpacity
                            key={star}
                            onPress={() => updateFormData('rating', star)}
                            style={styles.starButton}
                        >
                            <Ionicons
                                name={star <= formData.rating ? 'star' : 'star-outline'}
                                size={30}
                                color={star <= formData.rating ? '#FFD700' : '#ccc'}
                            />
                        </TouchableOpacity>
                    ))}
                </View>
                <ThemedText style={styles.ratingText}>
                    {formData.rating > 0 ? `${formData.rating} star${formData.rating > 1 ? 's' : ''}` : 'No rating'}
                </ThemedText>
            </View>
        );
    };

    const renderRecommendationChoice = () => {
        return (
            <View style={styles.fieldContainer}>
                <ThemedText style={styles.fieldLabel}>Would you recommend this address? *</ThemedText>
                <View style={styles.choiceContainer}>
                    <TouchableOpacity
                        style={[
                            styles.choiceButton,
                            formData.recommendation === true && styles.choiceButtonActive
                        ]}
                        onPress={() => updateFormData('recommendation', true)}
                    >
                        <Ionicons
                            name="thumbs-up"
                            size={20}
                            color={formData.recommendation === true ? '#fff' : colors.primaryColor}
                        />
                        <Text style={[
                            styles.choiceText,
                            formData.recommendation === true && styles.choiceTextActive
                        ]}>Yes</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[
                            styles.choiceButton,
                            formData.recommendation === false && styles.choiceButtonActive
                        ]}
                        onPress={() => updateFormData('recommendation', false)}
                    >
                        <Ionicons
                            name="thumbs-down"
                            size={20}
                            color={formData.recommendation === false ? '#fff' : '#FF6B6B'}
                        />
                        <Text style={[
                            styles.choiceText,
                            formData.recommendation === false && styles.choiceTextActive
                        ]}>No</Text>
                    </TouchableOpacity>
                </View>
            </View>
        );
    };

    if (loading) {
        return (
            <SafeAreaView style={styles.container}>
                <Header options={{ title: 'Write Review', showBackButton: true }} />
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={colors.primaryColor} />
                    <ThemedText style={styles.loadingText}>Loading address details...</ThemedText>
                </View>
            </SafeAreaView>
        );
    }

    if (error) {
        return (
            <SafeAreaView style={styles.container}>
                <Header options={{ title: 'Write Review', showBackButton: true }} />
                <View style={styles.errorContainer}>
                    <Ionicons name="alert-circle" size={48} color={colors.COLOR_BLACK_LIGHT_4} />
                    <ThemedText style={styles.errorText}>
                        {error}
                    </ThemedText>
                    <TouchableOpacity style={styles.retryButton} onPress={() => router.back()}>
                        <ThemedText style={styles.retryText}>Go Back</ThemedText>
                    </TouchableOpacity>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.container}>
            <Header options={{ title: 'Write Review', showBackButton: true }} />

            <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
                {/* Address Information */}
                <View style={styles.section}>
                    <ThemedText style={styles.sectionTitle}>Address Information</ThemedText>

                    <View style={styles.fieldContainer}>
                        <ThemedText style={styles.fieldLabel}>Street Address *</ThemedText>
                        <TextInput
                            style={styles.textInput}
                            placeholder="e.g. 123 Main Street"
                            value={formData.street}
                            onChangeText={(text: string) => updateFormData('street', text)}
                        />
                    </View>

                    <View style={styles.fieldContainer}>
                        <ThemedText style={styles.fieldLabel}>Building Number</ThemedText>
                        <TextInput
                            style={styles.textInput}
                            placeholder="e.g. 123A"
                            value={formData.number || ''}
                            onChangeText={(text: string) => updateFormData('number', text)}
                        />
                    </View>

                    <View style={styles.fieldContainer}>
                        <ThemedText style={styles.fieldLabel}>Building Name</ThemedText>
                        <TextInput
                            style={styles.textInput}
                            placeholder="e.g. Sunset Apartments"
                            value={formData.building_name || ''}
                            onChangeText={(text: string) => updateFormData('building_name', text)}
                        />
                    </View>

                    <View style={styles.addressRow}>
                        <View style={styles.addressRowField}>
                            <ThemedText style={styles.fieldLabel}>Floor</ThemedText>
                            <TextInput
                                style={styles.textInput}
                                placeholder="e.g. 3"
                                value={formData.floor || ''}
                                onChangeText={(text: string) => updateFormData('floor', text)}
                            />
                        </View>
                        <View style={styles.addressRowField}>
                            <ThemedText style={styles.fieldLabel}>Unit/Apt</ThemedText>
                            <TextInput
                                style={styles.textInput}
                                placeholder="e.g. 3B"
                                value={formData.unit || ''}
                                onChangeText={(text: string) => updateFormData('unit', text)}
                            />
                        </View>
                    </View>

                    <View style={styles.addressRow}>
                        <View style={styles.addressRowField}>
                            <ThemedText style={styles.fieldLabel}>City *</ThemedText>
                            <TextInput
                                style={styles.textInput}
                                placeholder="e.g. Barcelona"
                                value={formData.city}
                                onChangeText={(text: string) => updateFormData('city', text)}
                            />
                        </View>
                        <View style={styles.addressRowField}>
                            <ThemedText style={styles.fieldLabel}>State/Province</ThemedText>
                            <TextInput
                                style={styles.textInput}
                                placeholder="e.g. Catalonia"
                                value={formData.state}
                                onChangeText={(text: string) => updateFormData('state', text)}
                            />
                        </View>
                    </View>

                    <View style={styles.addressRow}>
                        <View style={styles.addressRowField}>
                            <ThemedText style={styles.fieldLabel}>Postal Code *</ThemedText>
                            <TextInput
                                style={styles.textInput}
                                placeholder="e.g. 08001"
                                value={formData.postal_code}
                                onChangeText={(text: string) => updateFormData('postal_code', text)}
                            />
                        </View>
                        <View style={styles.addressRowField}>
                            <ThemedText style={styles.fieldLabel}>Country *</ThemedText>
                            <TextInput
                                style={styles.textInput}
                                placeholder="e.g. Spain"
                                value={formData.country}
                                onChangeText={(text: string) => updateFormData('country', text)}
                            />
                        </View>
                    </View>

                    {/* Map for location selection */}
                    <View style={styles.mapContainer}>
                        <ThemedText style={styles.fieldLabel}>Select Location on Map</ThemedText>
                        <View style={styles.mapWrapper}>
                            <Map
                                ref={mapRef}
                                style={{ height: 300 }}
                                enableAddressLookup={true}
                                showAddressInstructions={true}
                                onAddressSelect={handleAddressSelect}
                                screenId="write-review"
                            />
                        </View>
                        <ThemedText style={styles.mapHint}>
                            Tap on the map to select the exact location and auto-fill address details
                        </ThemedText>
                    </View>
                </View>

                {/* Basic Information */}
                <View style={styles.section}>
                    <ThemedText style={styles.sectionTitle}>Basic Information</ThemedText>

                    <View style={styles.fieldContainer}>
                        <ThemedText style={styles.fieldLabel}>Monthly Rent *</ThemedText>
                        <View style={styles.priceContainer}>
                            <TextInput
                                style={styles.priceInput}
                                placeholder="0.00"
                                value={formData.price}
                                onChangeText={(text: string) => updateFormData('price', text)}
                                keyboardType="numeric"
                            />
                            <ThemedText style={styles.currencyText}>€</ThemedText>
                        </View>
                    </View>

                    <View style={styles.fieldContainer}>
                        <ThemedText style={styles.fieldLabel}>Green House/Apartment Description</ThemedText>
                        <TextInput
                            style={styles.textInput}
                            placeholder="e.g., 2nd floor, green door, Garden view..."
                            value={formData.greenHouse}
                            onChangeText={(text: string) => updateFormData('greenHouse', text)}
                            multiline
                        />
                    </View>

                    <View style={styles.dateRow}>
                        <View style={styles.dateField}>
                            <ThemedText style={styles.fieldLabel}>Lived From *</ThemedText>
                            <TextInput
                                style={styles.textInput}
                                placeholder="YYYY-MM-DD"
                                value={formData.livedFrom}
                                onChangeText={(text: string) => updateFormData('livedFrom', text)}
                            />
                        </View>
                        <View style={styles.dateField}>
                            <ThemedText style={styles.fieldLabel}>Lived To *</ThemedText>
                            <TextInput
                                style={styles.textInput}
                                placeholder="YYYY-MM-DD"
                                value={formData.livedTo}
                                onChangeText={(text: string) => updateFormData('livedTo', text)}
                            />
                        </View>
                    </View>
                </View>

                {/* Overall Review */}
                <View style={styles.section}>
                    <ThemedText style={styles.sectionTitle}>Overall Review</ThemedText>

                    {renderStarRating()}
                    {renderRecommendationChoice()}

                    <View style={styles.fieldContainer}>
                        <ThemedText style={styles.fieldLabel}>Your Opinion *</ThemedText>
                        <TextInput
                            style={[styles.textInput, styles.textAreaLarge]}
                            placeholder="Share your experience living at this address... (minimum 10 characters)"
                            value={formData.opinion}
                            onChangeText={(text: string) => updateFormData('opinion', text)}
                            multiline
                            numberOfLines={5}
                        />
                    </View>

                    <View style={styles.fieldContainer}>
                        <ThemedText style={styles.fieldLabel}>What did you like? (Optional)</ThemedText>
                        <TextInput
                            style={[styles.textInput, styles.textArea]}
                            placeholder="Positive aspects of living here..."
                            value={formData.positiveComment}
                            onChangeText={(text: string) => updateFormData('positiveComment', text)}
                            multiline
                            numberOfLines={3}
                        />
                    </View>

                    <View style={styles.fieldContainer}>
                        <ThemedText style={styles.fieldLabel}>What could be improved? (Optional)</ThemedText>
                        <TextInput
                            style={[styles.textInput, styles.textArea]}
                            placeholder="Areas for improvement..."
                            value={formData.negativeComment}
                            onChangeText={(text: string) => updateFormData('negativeComment', text)}
                            multiline
                            numberOfLines={3}
                        />
                    </View>
                </View>

                {/* Note about additional ratings */}
                <View style={styles.noteCard}>
                    <Ionicons name="information-circle" size={24} color={colors.primaryColor} />
                    <ThemedText style={styles.noteText}>
                        Additional detailed ratings for apartments, community, and area are optional and can be added later.
                    </ThemedText>
                </View>

                {/* Submit Button */}
                <View style={styles.submitContainer}>
                    <TouchableOpacity
                        style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
                        onPress={handleSubmit}
                        disabled={submitting}
                    >
                        {submitting ? (
                            <ActivityIndicator size="small" color="#fff" />
                        ) : (
                            <ThemedText style={styles.submitText}>Submit Review</ThemedText>
                        )}
                    </TouchableOpacity>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.COLOR_BLACK_LIGHT_8,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    loadingText: {
        marginTop: 16,
        fontSize: 16,
        color: colors.COLOR_BLACK_LIGHT_4,
    },
    errorContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    errorText: {
        marginTop: 16,
        fontSize: 16,
        color: colors.COLOR_BLACK_LIGHT_4,
        textAlign: 'center',
    },
    retryButton: {
        marginTop: 16,
        backgroundColor: colors.primaryColor,
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 8,
    },
    retryText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    },
    scrollView: {
        flex: 1,
    },
    addressCard: {
        backgroundColor: '#fff',
        margin: 16,
        padding: 16,
        borderRadius: 12,
        borderLeftWidth: 4,
        borderLeftColor: colors.primaryColor,
    },
    addressTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.COLOR_BLACK_LIGHT_4,
        marginBottom: 4,
    },
    addressText: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.primaryDark,
    },
    section: {
        backgroundColor: '#fff',
        margin: 16,
        marginTop: 0,
        padding: 16,
        borderRadius: 12,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.primaryDark,
        marginBottom: 16,
    },
    fieldContainer: {
        marginBottom: 16,
    },
    addressRow: {
        flexDirection: 'row',
        gap: 12,
        marginBottom: 16,
    },
    addressRowField: {
        flex: 1,
    },
    fieldLabel: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.COLOR_BLACK_LIGHT_2,
        marginBottom: 8,
    },
    textInput: {
        borderWidth: 1,
        borderColor: colors.COLOR_BLACK_LIGHT_6,
        borderRadius: 8,
        padding: 12,
        fontSize: 16,
        backgroundColor: '#fff',
    },
    textArea: {
        minHeight: 80,
        textAlignVertical: 'top',
    },
    textAreaLarge: {
        minHeight: 120,
        textAlignVertical: 'top',
    },
    priceContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    priceInput: {
        flex: 1,
        borderWidth: 1,
        borderColor: colors.COLOR_BLACK_LIGHT_6,
        borderRadius: 8,
        padding: 12,
        fontSize: 16,
        backgroundColor: '#fff',
        marginRight: 8,
    },
    currencyText: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.COLOR_BLACK_LIGHT_3,
    },
    dateRow: {
        flexDirection: 'row',
        gap: 12,
    },
    dateField: {
        flex: 1,
    },
    starRatingContainer: {
        marginBottom: 16,
    },
    starsContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
    },
    starButton: {
        padding: 4,
        marginRight: 4,
    },
    ratingText: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_4,
    },
    choiceContainer: {
        flexDirection: 'row',
        gap: 12,
    },
    choiceButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 12,
        borderWidth: 2,
        borderColor: colors.COLOR_BLACK_LIGHT_6,
        borderRadius: 8,
        gap: 8,
    },
    choiceButtonActive: {
        backgroundColor: colors.primaryColor,
        borderColor: colors.primaryColor,
    },
    choiceText: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.COLOR_BLACK_LIGHT_3,
    },
    choiceTextActive: {
        color: '#fff',
    },
    noteCard: {
        backgroundColor: colors.primaryColor + '10',
        margin: 16,
        marginTop: 0,
        padding: 16,
        borderRadius: 12,
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
    },
    noteText: {
        flex: 1,
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_3,
        lineHeight: 20,
    },
    submitContainer: {
        padding: 16,
    },
    submitButton: {
        backgroundColor: colors.primaryColor,
        paddingVertical: 16,
        borderRadius: 12,
        alignItems: 'center',
    },
    submitButtonDisabled: {
        opacity: 0.6,
    },
    submitText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    },
    mapContainer: {
        marginBottom: 16,
    },
    mapWrapper: {
        marginTop: 8,
        marginBottom: 8,
        borderRadius: 12,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: colors.COLOR_BLACK_LIGHT_6,
    },
    mapHint: {
        fontSize: 12,
        color: colors.COLOR_BLACK_LIGHT_4,
        textAlign: 'center',
        fontStyle: 'italic',
        marginTop: 8,
    },
});
