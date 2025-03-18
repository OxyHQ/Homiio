import React, { useState } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ScrollView, 
  TextInput,
  TouchableOpacity,
  Switch,
  ActivityIndicator,
  Platform
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { colors } from '@/styles/colors';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Header } from '@/components/Header';

type Amenity = {
  id: string;
  name: string;
  selected: boolean;
};

export default function AddPropertyPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const totalSteps = 4;

  // Form state
  const [propertyType, setPropertyType] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [price, setPrice] = useState('');
  const [size, setSize] = useState('');
  const [bedrooms, setBedrooms] = useState('1');
  const [bathrooms, setBathrooms] = useState('1');
  const [isEcoFriendly, setIsEcoFriendly] = useState(false);
  const [isCoLiving, setIsCoLiving] = useState(false);
  const [availableFrom, setAvailableFrom] = useState('');
  const [minimumStay, setMinimumStay] = useState('6');
  const [acceptsStudents, setAcceptsStudents] = useState(true);

  // Amenities
  const [amenities, setAmenities] = useState<Amenity[]>([
    { id: '1', name: 'WiFi', selected: false },
    { id: '2', name: 'Washing Machine', selected: false },
    { id: '3', name: 'Kitchen', selected: false },
    { id: '4', name: 'Heating', selected: false },
    { id: '5', name: 'Air Conditioning', selected: false },
    { id: '6', name: 'Elevator', selected: false },
    { id: '7', name: 'Workspace', selected: false },
    { id: '8', name: 'Parking', selected: false },
    { id: '9', name: 'Balcony', selected: false },
    { id: '10', name: 'TV', selected: false },
    { id: '11', name: 'Dishwasher', selected: false },
    { id: '12', name: 'Gym', selected: false },
  ]);

  // Property types
  const propertyTypes = [
    { id: 'apartment', name: t('Apartment') },
    { id: 'house', name: t('House') },
    { id: 'room', name: t('Room') },
    { id: 'studio', name: t('Studio') },
    { id: 'coliving', name: t('Co-living Space') },
  ];

  const toggleAmenity = (id: string) => {
    setAmenities(prev =>
      prev.map(amenity =>
        amenity.id === id 
          ? { ...amenity, selected: !amenity.selected } 
          : amenity
      )
    );
  };

  const nextStep = () => {
    if (currentStep < totalSteps) {
      setCurrentStep(prev => prev + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(prev => prev - 1);
    }
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    
    // Simulate API call
    setTimeout(() => {
      setIsSubmitting(false);
      router.push('/properties/add/success');
    }, 2000);
  };

  const renderStepIndicator = () => {
    return (
      <View style={styles.stepIndicatorContainer}>
        {Array.from({ length: totalSteps }).map((_, index) => (
          <View 
            key={index} 
            style={[
              styles.stepDot,
              currentStep > index && styles.completedStep,
              currentStep === index + 1 && styles.currentStep
            ]}
          />
        ))}
      </View>
    );
  };

  const renderStep1 = () => {
    // Property Type Selection
    return (
      <View style={styles.stepContainer}>
        <Text style={styles.stepTitle}>{t('What type of property are you listing?')}</Text>
        
        {propertyTypes.map(type => (
          <TouchableOpacity 
            key={type.id}
            style={[
              styles.propertyTypeButton,
              propertyType === type.id && styles.selectedPropertyType
            ]}
            onPress={() => setPropertyType(type.id)}
          >
            <Text 
              style={[
                styles.propertyTypeText,
                propertyType === type.id && styles.selectedPropertyTypeText
              ]}
            >
              {type.name}
            </Text>
          </TouchableOpacity>
        ))}

        <View style={styles.infoBox}>
          <Ionicons name="information-circle" size={20} color={colors.primaryColor} />
          <Text style={styles.infoText}>
            {t('All properties must comply with our ethical housing standards, including fair pricing and transparent conditions.')}
          </Text>
        </View>
      </View>
    );
  };

  const renderStep2 = () => {
    // Basic Information
    return (
      <View style={styles.stepContainer}>
        <Text style={styles.stepTitle}>{t('Tell us about your property')}</Text>
        
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>{t('Title')}</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder={t('E.g., Cozy Studio in City Center')}
            placeholderTextColor="#999"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>{t('Description')}</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={description}
            onChangeText={setDescription}
            placeholder={t('Describe your property, amenities, and neighborhood')}
            placeholderTextColor="#999"
            multiline
            numberOfLines={Platform.OS === 'ios' ? 0 : 4}
            textAlignVertical="top"
          />
        </View>

        <View style={styles.inputRow}>
          <View style={[styles.inputGroup, { flex: 1, marginRight: 10 }]}>
            <Text style={styles.inputLabel}>{t('Size (m²)')}</Text>
            <TextInput
              style={styles.input}
              value={size}
              onChangeText={setSize}
              placeholder="45"
              placeholderTextColor="#999"
              keyboardType="numeric"
            />
          </View>
          
          <View style={[styles.inputGroup, { flex: 1 }]}>
            <Text style={styles.inputLabel}>{t('Price (€/month)')}</Text>
            <TextInput
              style={styles.input}
              value={price}
              onChangeText={setPrice}
              placeholder="850"
              placeholderTextColor="#999"
              keyboardType="numeric"
            />
          </View>
        </View>

        <View style={styles.inputRow}>
          <View style={[styles.inputGroup, { flex: 1, marginRight: 10 }]}>
            <Text style={styles.inputLabel}>{t('Bedrooms')}</Text>
            <TextInput
              style={styles.input}
              value={bedrooms}
              onChangeText={setBedrooms}
              placeholder="1"
              placeholderTextColor="#999"
              keyboardType="numeric"
            />
          </View>
          
          <View style={[styles.inputGroup, { flex: 1 }]}>
            <Text style={styles.inputLabel}>{t('Bathrooms')}</Text>
            <TextInput
              style={styles.input}
              value={bathrooms}
              onChangeText={setBathrooms}
              placeholder="1"
              placeholderTextColor="#999"
              keyboardType="numeric"
            />
          </View>
        </View>
      </View>
    );
  };

  const renderStep3 = () => {
    // Location and Availability
    return (
      <View style={styles.stepContainer}>
        <Text style={styles.stepTitle}>{t('Location & Availability')}</Text>
        
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>{t('Address')}</Text>
          <TextInput
            style={styles.input}
            value={address}
            onChangeText={setAddress}
            placeholder={t('Street and number')}
            placeholderTextColor="#999"
          />
        </View>

        <View style={styles.inputRow}>
          <View style={[styles.inputGroup, { flex: 2, marginRight: 10 }]}>
            <Text style={styles.inputLabel}>{t('City')}</Text>
            <TextInput
              style={styles.input}
              value={city}
              onChangeText={setCity}
              placeholder="Barcelona"
              placeholderTextColor="#999"
            />
          </View>
          
          <View style={[styles.inputGroup, { flex: 1 }]}>
            <Text style={styles.inputLabel}>{t('Postal Code')}</Text>
            <TextInput
              style={styles.input}
              value={postalCode}
              onChangeText={setPostalCode}
              placeholder="08001"
              placeholderTextColor="#999"
            />
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>{t('Country')}</Text>
          <TextInput
            style={styles.input}
            value={country}
            onChangeText={setCountry}
            placeholder="Spain"
            placeholderTextColor="#999"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>{t('Available From')}</Text>
          <TouchableOpacity style={styles.datePickerButton}>
            <Text style={styles.datePickerText}>
              {availableFrom || t('Select date')}
            </Text>
            <Ionicons name="calendar-outline" size={20} color={colors.COLOR_BLACK_LIGHT_3} />
          </TouchableOpacity>
        </View>

        <View style={styles.inputRow}>
          <View style={[styles.inputGroup, { flex: 2, marginRight: 10 }]}>
            <Text style={styles.inputLabel}>{t('Minimum Stay (months)')}</Text>
            <TextInput
              style={styles.input}
              value={minimumStay}
              onChangeText={setMinimumStay}
              placeholder="6"
              placeholderTextColor="#999"
              keyboardType="numeric"
            />
          </View>
        </View>
      </View>
    );
  };

  const renderStep4 = () => {
    // Amenities and Features
    return (
      <View style={styles.stepContainer}>
        <Text style={styles.stepTitle}>{t('Amenities & Features')}</Text>
        
        <View style={styles.switchGroup}>
          <View style={styles.switchLabelContainer}>
            <Ionicons name="leaf" size={20} color={isEcoFriendly ? 'green' : colors.COLOR_BLACK_LIGHT_3} />
            <Text style={styles.switchLabel}>{t('Eco-Friendly Property')}</Text>
          </View>
          <Switch
            value={isEcoFriendly}
            onValueChange={setIsEcoFriendly}
            trackColor={{ false: '#ccc', true: '#8BC34A' }}
            thumbColor={isEcoFriendly ? 'green' : '#f5f5f5'}
          />
        </View>

        <View style={styles.switchGroup}>
          <View style={styles.switchLabelContainer}>
            <Ionicons name="people" size={20} color={isCoLiving ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_3} />
            <Text style={styles.switchLabel}>{t('Co-Living Space')}</Text>
          </View>
          <Switch
            value={isCoLiving}
            onValueChange={setIsCoLiving}
            trackColor={{ false: '#ccc', true: colors.primaryLight }}
            thumbColor={isCoLiving ? colors.primaryColor : '#f5f5f5'}
          />
        </View>

        <View style={styles.switchGroup}>
          <View style={styles.switchLabelContainer}>
            <Ionicons name="school" size={20} color={acceptsStudents ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_3} />
            <Text style={styles.switchLabel}>{t('Accepts Students')}</Text>
          </View>
          <Switch
            value={acceptsStudents}
            onValueChange={setAcceptsStudents}
            trackColor={{ false: '#ccc', true: colors.primaryLight }}
            thumbColor={acceptsStudents ? colors.primaryColor : '#f5f5f5'}
          />
        </View>

        <Text style={styles.sectionLabel}>{t('Select Amenities')}</Text>
        <View style={styles.amenitiesGrid}>
          {amenities.map(amenity => (
            <TouchableOpacity 
              key={amenity.id}
              style={[
                styles.amenityButton,
                amenity.selected && styles.selectedAmenity
              ]}
              onPress={() => toggleAmenity(amenity.id)}
            >
              <Text 
                style={[
                  styles.amenityButtonText,
                  amenity.selected && styles.selectedAmenityText
                ]}
              >
                {amenity.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.photosLabel}>{t('Photos (0/10)')}</Text>
        <TouchableOpacity style={styles.uploadButton}>
          <Ionicons name="camera" size={24} color={colors.COLOR_BLACK_LIGHT_3} />
          <Text style={styles.uploadButtonText}>{t('Upload Photos')}</Text>
        </TouchableOpacity>

        <Text style={styles.disclaimer}>
          {t('By listing your property, you agree to our Fair Housing Policy and Terms of Service.')}
        </Text>
      </View>
    );
  };

  const renderCurrentStep = () => {
    switch (currentStep) {
      case 1:
        return renderStep1();
      case 2:
        return renderStep2();
      case 3:
        return renderStep3();
      case 4:
        return renderStep4();
      default:
        return null;
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <Header
        options={{
          showBackButton: true,
          title: t('Add Property'),
          titlePosition: 'center',
        }}
      />

      <ScrollView style={styles.container}>
        {renderStepIndicator()}
        {renderCurrentStep()}
        
        <View style={styles.navigationButtons}>
          {currentStep > 1 && (
            <TouchableOpacity 
              style={styles.backButton}
              onPress={prevStep}
            >
              <Text style={styles.backButtonText}>{t('Back')}</Text>
            </TouchableOpacity>
          )}
          
          {currentStep < totalSteps ? (
            <TouchableOpacity 
              style={[
                styles.nextButton,
                currentStep === 1 && !propertyType && styles.disabledButton
              ]}
              onPress={nextStep}
              disabled={currentStep === 1 && !propertyType}
            >
              <Text style={styles.nextButtonText}>{t('Next')}</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity 
              style={styles.submitButton}
              onPress={handleSubmit}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <ActivityIndicator color="white" size="small" />
              ) : (
                <Text style={styles.submitButtonText}>{t('Submit Listing')}</Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.COLOR_BACKGROUND,
  },
  container: {
    flex: 1,
    padding: 15,
  },
  stepIndicatorContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 25,
  },
  stepDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#e0e0e0',
    marginHorizontal: 5,
  },
  currentStep: {
    backgroundColor: colors.primaryColor,
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  completedStep: {
    backgroundColor: '#8BC34A',
  },
  stepContainer: {
    marginBottom: 20,
  },
  stepTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 20,
    color: colors.COLOR_BLACK,
  },
  propertyTypeButton: {
    padding: 15,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    marginBottom: 10,
  },
  selectedPropertyType: {
    backgroundColor: colors.primaryColor,
  },
  propertyTypeText: {
    fontSize: 16,
    color: colors.COLOR_BLACK,
  },
  selectedPropertyTypeText: {
    color: 'white',
    fontWeight: '500',
  },
  infoBox: {
    flexDirection: 'row',
    backgroundColor: colors.primaryLight,
    padding: 15,
    borderRadius: 8,
    marginTop: 15,
    alignItems: 'flex-start',
  },
  infoText: {
    flex: 1,
    marginLeft: 10,
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  inputGroup: {
    marginBottom: 15,
  },
  inputLabel: {
    fontSize: 16,
    marginBottom: 8,
    color: colors.COLOR_BLACK,
  },
  input: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: 'white',
  },
  textArea: {
    height: 100,
    paddingTop: 12,
  },
  inputRow: {
    flexDirection: 'row',
    marginBottom: 15,
  },
  datePickerButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    padding: 12,
    backgroundColor: 'white',
  },
  datePickerText: {
    fontSize: 16,
    color: colors.COLOR_BLACK,
  },
  switchGroup: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  switchLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  switchLabel: {
    fontSize: 16,
    marginLeft: 10,
    color: colors.COLOR_BLACK,
  },
  sectionLabel: {
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 10,
    marginBottom: 15,
    color: colors.COLOR_BLACK,
  },
  amenitiesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 20,
  },
  amenityButton: {
    backgroundColor: '#f5f5f5',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    marginRight: 10,
    marginBottom: 10,
  },
  selectedAmenity: {
    backgroundColor: colors.primaryColor,
  },
  amenityButtonText: {
    color: colors.COLOR_BLACK,
  },
  selectedAmenityText: {
    color: 'white',
  },
  photosLabel: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
    color: colors.COLOR_BLACK,
  },
  uploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 15,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderStyle: 'dashed',
    marginBottom: 20,
  },
  uploadButtonText: {
    fontSize: 16,
    color: colors.COLOR_BLACK_LIGHT_3,
    marginLeft: 10,
  },
  disclaimer: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_3,
    marginBottom: 20,
    textAlign: 'center',
  },
  navigationButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 20,
  },
  backButton: {
    flex: 1,
    padding: 15,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    alignItems: 'center',
    marginRight: 10,
  },
  backButtonText: {
    fontSize: 16,
    color: colors.COLOR_BLACK,
    fontWeight: '500',
  },
  nextButton: {
    flex: 1,
    padding: 15,
    backgroundColor: colors.primaryColor,
    borderRadius: 8,
    alignItems: 'center',
  },
  nextButtonText: {
    fontSize: 16,
    color: 'white',
    fontWeight: '500',
  },
  submitButton: {
    flex: 1,
    padding: 15,
    backgroundColor: colors.primaryColor,
    borderRadius: 8,
    alignItems: 'center',
  },
  submitButtonText: {
    fontSize: 16,
    color: 'white',
    fontWeight: '500',
  },
  disabledButton: {
    backgroundColor: '#ccc',
  },
});