import React, { useState, useEffect } from 'react';
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

// Services and hooks
import { api } from '@/utils/api';
import { default as reviewService, type ReviewData } from '@/services/reviewService';

// Types
import { colors } from '@/styles/colors';

// Local type definitions
interface AddressData {
    _id: string;
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
    fullAddress: string;
    location: string;
}

interface ReviewFormData {
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

    // State variables
    const [address, setAddress] = useState<AddressData | null>(null);
    const [formData, setFormData] = useState<ReviewFormData>(initialFormData);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Fetch address data
    useEffect(() => {
        if (!addressId || !oxyServices || !activeSessionId) return;

        const fetchAddress = async () => {
            try {
                const response = await api.get(`/api/addresses/${addressId}`, {
                    oxyServices,
                    activeSessionId
                });
                setAddress(response.data?.address || response.data);
            } catch (err) {
                console.error('Error fetching address:', err);
                setError('Failed to load address information');
            } finally {
                setLoading(false);
            }
        };

        fetchAddress();
    }, [addressId, oxyServices, activeSessionId]);

    const updateFormData = (field: keyof ReviewFormData, value: any) => {
        setFormData(prev => ({
            ...prev,
            [field]: value
        }));
    };

    const validateForm = (): boolean => {
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
        if (!address || !oxyServices || !activeSessionId) return;

        setSubmitting(true);
        try {
            // Calculate lived duration in months
            const startDate = new Date(formData.livedFrom);
            const endDate = new Date(formData.livedTo);
            const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
            const livedForMonths = Math.ceil(diffTime / (1000 * 60 * 60 * 24 * 30.44));

            const reviewData: Partial<ReviewData> = {
                addressId: address._id,
                address: address.fullAddress || address.location || `${address.street}, ${address.city}`,
                greenHouse: formData.greenHouse,
                price: parseFloat(formData.price),
                currency: formData.currency,
                livedFrom: formData.livedFrom,
                livedTo: formData.livedTo,
                livedForMonths,
                recommendation: formData.recommendation!,
                opinion: formData.opinion.trim(),
                positiveComment: formData.positiveComment.trim(),
                negativeComment: formData.negativeComment.trim(),
                rating: formData.rating,
                summerTemperature: formData.summerTemperature,
                winterTemperature: formData.winterTemperature,
                noise: formData.noise,
                light: formData.light,
                conditionAndMaintenance: formData.conditionAndMaintenance,
                services: formData.services,
                landlordTreatment: formData.landlordTreatment,
                problemResponse: formData.problemResponse,
                depositReturned: formData.depositReturned!,
                staircaseNeighbors: formData.staircaseNeighbors,
                touristApartments: formData.touristApartments!,
                neighborRelations: formData.neighborRelations,
                cleaning: formData.cleaning,
                areaTourists: formData.areaTourists,
                areaSecurity: formData.areaSecurity,
                images: [], // TODO: Implement image upload
                verified: false,
            };

            const result = await reviewService.createReview(reviewData, oxyServices, activeSessionId);

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

    if (error || !address) {
        return (
            <SafeAreaView style={styles.container}>
                <Header options={{ title: 'Write Review', showBackButton: true }} />
                <View style={styles.errorContainer}>
                    <Ionicons name="alert-circle" size={48} color={colors.COLOR_BLACK_LIGHT_4} />
                    <ThemedText style={styles.errorText}>
                        {error || 'Failed to load address information'}
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
                {/* Address Info */}
                <View style={styles.addressCard}>
                    <ThemedText style={styles.addressTitle}>Reviewing</ThemedText>
                    <ThemedText style={styles.addressText}>
                        {address.fullAddress || address.location || `${address.street}, ${address.city}`}
                    </ThemedText>
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
});
