import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { useMutation } from '@tanstack/react-query';
import type { MapApi, AddressData } from '@/components/Map';
import {
  useCreatePropertyFormStore,
  useCreatePropertyFormSelectors,
} from '@/store/createPropertyFormStore';
import { useProperty } from '@/hooks/usePropertyQueries';
import type { UploadedImage } from '@/services/imageUploadService';
import {
  ExchangeMode,
  ListingIntent,
  type Property,
  type PropertyImage,
} from '@homiio/shared-types';
import { logger } from '@/utils/logger';
import {
  resolveStepFlow,
  FIELD_CONFIG,
  DEFAULT_PROPERTY_TYPE,
  STEP_SALE_DETAILS,
} from '@/components/property/create/constants';
import {
  validateBasicInfoStep,
  validateLocationStep,
  validatePricingStep,
  validateAmenitiesStep,
  validateSaleDetailsStep,
  validateFloor,
  PROPERTY_FORM_DEFAULTS,
  type StepValidationErrors,
} from '@/utils/propertyFormSchema';

const LOCATION_STEP_INDEX = 1;

interface GeoCoordinates {
  latitude: number;
  longitude: number;
}

/**
 * Normalises a persisted property image (string URL or `PropertyImage`) into the
 * `UploadedImage` shape the form store and `ImageUpload` component expect. The
 * available URL is mirrored across the size slots so edit-mode previews render.
 */
const toUploadedImage = (image: string | PropertyImage, index: number): UploadedImage => {
  const url = typeof image === 'string' ? image : image.url;
  const caption = typeof image === 'string' ? '' : image.caption ?? '';
  const isPrimary = typeof image === 'string' ? index === 0 : image.isPrimary ?? index === 0;
  return {
    imageId: url,
    urls: { small: url, medium: url, large: url, original: url },
    keys: { original: url, variants: {} },
    metadata: { originalSize: 0, originalFormat: '', uploadedAt: new Date() },
    isPrimary,
    caption,
  };
};

const mapPropertyImages = (images: Property['images']): UploadedImage[] => {
  if (!Array.isArray(images)) return [];
  return images.map((image, index) => toUploadedImage(image, index));
};

/**
 * Centralises all state, derived values, side effects, and handlers for the
 * property creation wizard. The screen and step components consume this hook so
 * they stay presentational.
 *
 * Responsibilities:
 *  - Wire the Zustand form store (single source of truth for form data).
 *  - Load + hydrate the form in edit mode via React Query (`useProperty`).
 *  - Resolve the user's location on the Location step via a React Query mutation.
 *  - Derive the active step list and visible fields (no effects).
 *  - Run per-step Zod validation and gate progression.
 */
export function usePropertyCreateForm(id: string | undefined) {
  const isEditMode = Boolean(id);

  const {
    setFormData,
    updateFormField,
    nextStep,
    prevStep,
    setCurrentStep,
  } = useCreatePropertyFormStore();

  const { formData, currentStep, isLoading, error: submitError } = useCreatePropertyFormSelectors();

  const {
    property,
    loading: propertyLoading,
    error: propertyError,
  } = useProperty(id ?? '');

  const [validationErrors, setValidationErrors] = useState<StepValidationErrors>({});
  const mapRef = useRef<MapApi | null>(null);
  const fullscreenMapRef = useRef<MapApi | null>(null);

  // Derived step list for the active property type AND the selected intents
  // (no effect needed). The flow grows by a "Sale Details" step when the
  // listing is also for sale, so it must recompute when either changes.
  const propertyType = formData.basicInfo.propertyType || DEFAULT_PROPERTY_TYPE;
  const intents = formData.offering.intents;
  const steps = useMemo(
    () => resolveStepFlow(propertyType, intents),
    [propertyType, intents],
  );

  const currentType = formData.basicInfo.propertyType || DEFAULT_PROPERTY_TYPE;
  // Clamp the lookup index to the active flow. The flow can shrink when the
  // host removes the 'sale' intent (dropping the Sale Details step); reading a
  // clamped index keeps `stepName` valid (never `undefined`) without an effect.
  const safeStepIndex = Math.min(currentStep, steps.length - 1);
  const stepName = steps[safeStepIndex];
  const fieldsToShow = useMemo(
    () => FIELD_CONFIG[currentType]?.[stepName] ?? [],
    [currentType, stepName],
  );

  // --- Edit-mode hydration --------------------------------------------------
  // Sync the fetched property into the form store exactly once per loaded id.
  const hydratedPropertyIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isEditMode || !property) return;
    if (hydratedPropertyIdRef.current === property._id) return;
    hydratedPropertyIdRef.current = property._id;

    setFormData('basicInfo', {
      propertyType: property.type || 'apartment',
      bedrooms: property.bedrooms || 1,
      bathrooms: property.bathrooms || 1,
      squareFootage: property.squareFootage || 0,
      yearBuilt: property.yearBuilt,
      description: property.description || '',
    });

    const coordinates = property.address?.coordinates;
    const hasPoint = coordinates?.type === 'Point';

    setFormData('location', {
      address: property.address?.street || '',
      floor: property.floor,
      showFloor: Boolean(property.floor),
      neighborhood: property.address?.neighborhood || '',
      city: property.address?.city || '',
      state: property.address?.state || '',
      postal_code: property.address?.postal_code || '',
      country: property.address?.country || '',
      latitude: hasPoint ? coordinates.coordinates[1] : undefined,
      longitude: hasPoint ? coordinates.coordinates[0] : undefined,
      availableFrom: '',
      leaseTerm: '',
      number: property.address?.number || '',
      building_name: property.address?.building_name || '',
      block: property.address?.block || '',
      entrance: property.address?.entrance || '',
      unit: property.address?.unit || '',
      subunit: property.address?.subunit || '',
      district: property.address?.district || '',
      address_lines: property.address?.address_lines || [],
      po_box: property.address?.po_box || '',
      reference: property.address?.reference || '',
    });

    setFormData('pricing', {
      monthlyRent: property.rent?.amount || 0,
      currency: property.rent?.currency || 'EUR',
      securityDeposit: 0,
      applicationFee: 0,
      lateFee: 0,
    });

    setFormData('amenities', {
      selectedAmenities: property.amenities || [],
    });

    setFormData('media', {
      images: mapPropertyImages(property.images),
    });

    setFormData('colivingFeatures', {
      sharedSpaces: false,
      communityEvents: false,
      sharedSpacesList: [],
      otherFeatures: '',
    });

    // Hydrate the multi-intent offering. Legacy listings with no stored intents
    // are rent-only; a stored `sale` block seeds the Sale Details fields and a
    // stored `exchange` block seeds the Exchange Settings fields so editing a
    // for-sale / exchange listing round-trips instead of dropping that data.
    const storedIntents =
      Array.isArray(property.intents) && property.intents.length > 0
        ? property.intents
        : [ListingIntent.RENT];
    const exchange = property.exchange;
    setFormData('offering', {
      intents: storedIntents,
      salePrice: property.sale?.price,
      saleCurrency: property.sale?.currency,
      chainStatus: property.sale?.chainStatus,
      isPriceReduced: property.sale?.isPriceReduced,
      exchangeMode: exchange?.mode ?? ExchangeMode.BOTH,
      exchangeAvailabilityWindows: exchange?.availabilityWindows ?? [],
      exchangeMinStay: exchange?.minStay,
      exchangeMaxStay: exchange?.maxStay,
      exchangeWelcomeNote: exchange?.welcomeNote,
      exchangeLanguages: exchange?.languages ?? [],
      exchangeMealsIncluded: exchange?.mealsIncluded ?? false,
      exchangeRequiresReciprocity: exchange?.requiresReciprocity ?? false,
    });
  }, [isEditMode, property, setFormData]);

  // --- User geolocation on the Location step --------------------------------
  const locationMutation = useMutation<GeoCoordinates | null>({
    mutationFn: async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        logger.warn('Location permission denied');
        return null;
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
        timeInterval: 10000,
        distanceInterval: 10,
      });
      return { latitude: position.coords.latitude, longitude: position.coords.longitude };
    },
    onSuccess: (coords) => {
      if (!coords) return;
      logger.info('User location obtained', coords);
      setFormData('location', { latitude: coords.latitude, longitude: coords.longitude });
    },
    onError: (error) => {
      logger.error('Error getting user location', error);
    },
  });

  const { mutate: resolveUserLocation, isPending: isResolvingLocation } = locationMutation;

  const { latitude, longitude } = formData.location;
  const isAtDefaultBarcelona =
    latitude === PROPERTY_FORM_DEFAULTS.DEFAULT_LATITUDE &&
    longitude === PROPERTY_FORM_DEFAULTS.DEFAULT_LONGITUDE;
  const needsLocationResolve = !latitude || !longitude || isAtDefaultBarcelona;

  // Resolve the user's location the first time they reach the Location step
  // without usable coordinates. A ref guard keeps the effect's deps honest and
  // prevents re-triggering as coordinates update mid-resolution.
  const hasRequestedLocationRef = useRef(false);
  useEffect(() => {
    if (currentStep !== LOCATION_STEP_INDEX) return;
    if (!needsLocationResolve || hasRequestedLocationRef.current || isResolvingLocation) return;
    hasRequestedLocationRef.current = true;
    resolveUserLocation();
  }, [currentStep, needsLocationResolve, isResolvingLocation, resolveUserLocation]);

  // --- Address autofill from the map ----------------------------------------
  const applyAddressSelection = useCallback(
    (address: AddressData, coordinates: [number, number]) => {
      updateFormField('location', 'latitude', coordinates[1]);
      updateFormField('location', 'longitude', coordinates[0]);

      if (address.street) updateFormField('location', 'address', address.street);
      if (address.houseNumber) updateFormField('location', 'number', address.houseNumber);
      if (address.neighborhood) {
        updateFormField('location', 'neighborhood', address.neighborhood);
      }
      if (address.city) updateFormField('location', 'city', address.city);
      if (address.state) updateFormField('location', 'state', address.state);
      if (address.country) updateFormField('location', 'country', address.country);
      if (address.postalCode) updateFormField('location', 'postal_code', address.postalCode);

      mapRef.current?.navigateToLocation(coordinates, 15);
    },
    [updateFormField],
  );

  const handleAddressSelect = useCallback(
    (address: AddressData, coordinates: [number, number]) => {
      applyAddressSelection(address, coordinates);
    },
    [applyAddressSelection],
  );

  // --- Field handlers -------------------------------------------------------
  const handleShowFloorToggle = useCallback(
    (show: boolean) => {
      setFormData('location', { showFloor: show });
    },
    [setFormData],
  );

  const handleFloorChange = useCallback(
    (text: string) => {
      const floor = text ? parseInt(text, 10) : undefined;
      const error = validateFloor(floor);
      setValidationErrors((prev) => ({ ...prev, floor: error || '' }));
      updateFormField('location', 'floor', floor);
    },
    [updateFormField],
  );

  const handleAmenityToggle = useCallback(
    (amenityId: string) => {
      const currentAmenities = formData.amenities.selectedAmenities || [];
      const updatedAmenities = currentAmenities.includes(amenityId)
        ? currentAmenities.filter((value) => value !== amenityId)
        : [...currentAmenities, amenityId];
      setFormData('amenities', { selectedAmenities: updatedAmenities });
    },
    [formData.amenities.selectedAmenities, setFormData],
  );

  // Property type changes reset the wizard to the first step when the user has
  // already progressed (event-driven, replacing the previous effect).
  const handlePropertyTypeChange = useCallback(
    (nextType: string) => {
      const previousType = formData.basicInfo.propertyType;
      updateFormField('basicInfo', 'propertyType', nextType);
      if (previousType && previousType !== nextType && currentStep > 0) {
        setCurrentStep(0);
      }
    },
    [formData.basicInfo.propertyType, currentStep, updateFormField, setCurrentStep],
  );

  // --- Validation + navigation ----------------------------------------------
  const validateCurrentStep = useCallback((): boolean => {
    let errors: StepValidationErrors = {};
    if (stepName === 'Basic Info') {
      errors = validateBasicInfoStep(formData.basicInfo, fieldsToShow);
    } else if (stepName === 'Location') {
      errors = validateLocationStep(formData.location);
    } else if (stepName === 'Pricing') {
      errors = validatePricingStep(formData.pricing, fieldsToShow);
    } else if (stepName === 'Amenities') {
      errors = validateAmenitiesStep(formData.rules, fieldsToShow);
    } else if (stepName === STEP_SALE_DETAILS) {
      errors = validateSaleDetailsStep(formData.offering);
    }
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  }, [stepName, fieldsToShow, formData]);

  // The "next" cap derives from the ACTIVE flow length (RISK 5) — never a
  // hardcoded literal — so adding the Sale Details step extends the reachable
  // range automatically.
  const maxStep = steps.length - 1;
  const handleNextStep = useCallback(() => {
    if (validateCurrentStep()) {
      nextStep(maxStep);
    }
  }, [validateCurrentStep, nextStep, maxStep]);

  return {
    // state
    formData,
    currentStep,
    isLoading,
    submitError,
    steps,
    stepName,
    fieldsToShow,
    validationErrors,
    isEditMode,
    propertyLoading,
    propertyError,
    // refs
    mapRef,
    fullscreenMapRef,
    // store actions used directly by steps/orchestrator
    setFormData,
    updateFormField,
    prevStep,
    // handlers
    applyAddressSelection,
    handleAddressSelect,
    handleShowFloorToggle,
    handleFloorChange,
    handleAmenityToggle,
    handlePropertyTypeChange,
    handleNextStep,
  };
}

export type UsePropertyCreateFormReturn = ReturnType<typeof usePropertyCreateForm>;
