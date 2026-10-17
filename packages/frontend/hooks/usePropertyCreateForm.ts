import { useCallback, useMemo, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MapApi, GeocodedAddress } from '@/components/Map';
import {
  useCreatePropertyFormStore,
  useCreatePropertyFormSelectors,
  whenFormRestored,
} from '@/store/createPropertyFormStore';
import { useProperty } from '@/hooks/usePropertyQueries';
import { propertyService } from '@/services/propertyService';
import type { UploadedImage } from '@/services/imageUploadService';
import {
  ExchangeMode,
  OfferingType,
  type Property,
  type PropertyImage,
  type PropertyImageRef,
} from '@homiio/shared-types';
import { logger } from '@/utils/logger';
import { newDraftId, saveDraft } from '@/utils/propertyDrafts';
import { resolveBackendImageUrl } from '@/utils/imageUrl';
import {
  resolveStepFlow,
  FIELD_CONFIG,
  DEFAULT_PROPERTY_TYPE,
  STEP_AMENITIES,
  STEP_BASIC_INFO,
  STEP_LOCATION,
  STEP_PROPERTY_TYPE,
  STEP_OFFERING,
  STEP_LONG_TERM_PRICING,
  STEP_NIGHTLY_PRICING,
  STEP_SALE_DETAILS,
} from '@/components/property/create/constants';
import {
  validateBasicInfoStep,
  validateLocationStep,
  validateOfferingStep,
  validateLongTermPricingStep,
  validateNightlyPricingStep,
  validateAmenitiesStep,
  validateSaleDetailsStep,
  validateFloor,
  PROPERTY_FORM_DEFAULTS,
  type StepValidationErrors,
} from '@/utils/propertyFormSchema';

interface GeoCoordinates {
  latitude: number;
  longitude: number;
}

/**
 * Normalises a persisted property image into the `UploadedImage` shape the form
 * store and `ImageUpload` component expect. The available URL is mirrored across
 * the size slots when the stored entry carries only one, so edit-mode previews
 * render either way.
 *
 * `urls` is display-only and is re-homed onto the active API origin (see
 * {@link resolveBackendImageUrl}) so a baked-in dev/emulator host previews on web
 * too. `keys.original` is a bookkeeping identifier passed verbatim to the delete
 * endpoint, so it keeps the ORIGINAL stored value and is never re-homed.
 *
 * `storedImageId` is what makes an edit SAVEABLE. A stored photo already has a
 * canonical `images` row, and republishing it means naming that row — the server
 * cannot re-derive it from a URL, and a save that did not name it would either
 * fail or mint a duplicate row for bytes it already holds.
 */
const toUploadedImage = (
  image: string | PropertyImage | PropertyImageRef,
  index: number,
): UploadedImage => {
  const ref = typeof image === 'string' ? undefined : (image as PropertyImageRef);
  const url = typeof image === 'string' ? image : image.url;
  const displayUrl = resolveBackendImageUrl(url);
  const caption = typeof image === 'string' ? '' : (image.caption ?? '');
  const isPrimary = typeof image === 'string' ? index === 0 : (image.isPrimary ?? index === 0);
  const variant = (name: keyof NonNullable<PropertyImageRef['urls']>): string =>
    ref?.urls?.[name] ? resolveBackendImageUrl(ref.urls[name]) : displayUrl;
  return {
    // The grid's key: the canonical row id when there is one, so a reorder and a
    // remove address the photo by the same identity the save will.
    imageId: ref?.imageId ?? url,
    storedImageId: ref?.imageId,
    urls: {
      small: variant('small'),
      medium: variant('medium'),
      large: variant('large'),
      original: variant('original'),
    },
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
 * Seed the form store from a stored listing, for editing it.
 *
 * Called by the form-session loader once BOTH the listing and the persisted
 * form are in, which is what makes the dirty-edit check below reachable.
 */
function seedEditForm(property: Property) {
  const store = useCreatePropertyFormStore.getState();
  if (store.editingPropertyId === property.id && store.isDirty) {
    // An edit of THIS listing was interrupted and the store restored it.
    // Overwriting it with the server's copy would discard exactly the changes
    // the restore preserved — the server's copy is what they were editing
    // AWAY from. Waiting for the restore (`whenFormRestored`) is what makes this reachable:
    // the restore lands after the first renders.
    return;
  }
  // Anything else in the store belongs to a different listing. An unsaved NEW
  // listing is parked in the drafts list first, so opening an edit never
  // silently discards a listing somebody was part-way through writing.
  if (!store.editingPropertyId && store.isDirty) {
    saveDraft(store.draftId ?? newDraftId(), store.formData, store.currentStep).catch(
      (error: unknown) => logger.error('Error parking in-progress listing before edit', error),
    );
  }
  store.resetForm();
  store.setEditingPropertyId(property.id);

  store.setFormData('basicInfo', {
    propertyType: property.type || 'apartment',
    bedrooms: property.bedrooms || 1,
    bathrooms: property.bathrooms || 1,
    squareFootage: property.squareFootage || 0,
    yearBuilt: property.yearBuilt,
    description: property.description || '',
  });

  const coordinates = property.address?.coordinates;
  const hasPoint = coordinates?.type === 'Point';

  store.setFormData('location', {
    address: property.address?.street || '',
    floor: property.floor,
    // The stored publication choice, not whether a floor exists: a listing
    // with a floor and no choice publishes `building`, which is private.
    showFloor: property.addressPublishedPrecision === 'exact',
    // Geo is relational: seed the form's resolution inputs from the address's
    // resolved display NAMES (the geo `*Id` fields are ids, not strings).
    neighborhood: property.address?.neighborhoodName || '',
    city: property.address?.cityName || '',
    state: property.address?.regionName || '',
    postal_code: property.address?.postal_code || '',
    country: property.address?.countryName || '',
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

  // Hydrate the per-offering pricing back from the stored blocks so editing
  // round-trips every field (including deposit/fees, fixing the prior
  // reset-to-0 gap). `offerings` is read straight off the property — it is the
  // authoritative axis, equal to the set of present priced blocks.
  const longTerm = property.longTermRent;
  const shortTerm = property.shortTermRent;
  const storedOfferings =
    Array.isArray(property.offerings) && property.offerings.length > 0
      ? property.offerings
      : [OfferingType.LONG_TERM_RENT];
  // Shared currency: prefer the long-term block's, else the short-term one.
  const pricingCurrency = longTerm?.currency || shortTerm?.currency || 'EUR';
  store.setFormData('pricing', {
    offerings: storedOfferings,
    currency: pricingCurrency,
    monthlyRent: longTerm?.monthlyAmount ?? 0,
    securityDeposit: longTerm?.deposit ?? 0,
    applicationFee: longTerm?.applicationFee ?? 0,
    lateFee: longTerm?.lateFee ?? 0,
    nightlyRate: shortTerm?.nightlyRate ?? 0,
    cleaningFee: shortTerm?.cleaningFee ?? 0,
    serviceFee: shortTerm?.serviceFee ?? 0,
    taxesPercent: shortTerm?.taxesPercent ?? 0,
    minNights: shortTerm?.minNights,
    maxNights: shortTerm?.maxNights,
    instantBook: shortTerm?.instantBook ?? false,
  });

  store.setFormData('amenities', {
    selectedAmenities: property.amenities || [],
  });

  store.setFormData('media', {
    images: mapPropertyImages(property.images),
  });

  store.setFormData('colivingFeatures', {
    sharedSpaces: false,
    communityEvents: false,
    sharedSpacesList: [],
    otherFeatures: '',
  });

  // Hydrate the sale + exchange sub-fields. A stored `sale` block seeds the
  // Sale Details fields and a stored `exchange` block seeds the Exchange
  // Settings fields so editing those listings round-trips that data.
  const exchange = property.exchange;
  store.setFormData('offering', {
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
}

/**
 * Centralises all state, derived values, side effects, and handlers for the
 * property creation wizard. The screen and step components consume this hook so
 * they stay presentational.
 *
 * Responsibilities:
 *  - Wire the Zustand form store (single source of truth for form data).
 *  - Open the form session via React Query: seed an edit from its listing, or
 *    clear a leftover edit before a new listing.
 *  - Resolve the user's location on arrival at the Location step (from the
 *    Next/Back press) via a React Query mutation.
 *  - Derive the active step list and visible fields (no effects).
 *  - Run per-step Zod validation and gate progression.
 */
export function usePropertyCreateForm(id: string | undefined) {
  const isEditMode = Boolean(id);

  const { setFormData, updateFormField, nextStep, setCurrentStep } = useCreatePropertyFormStore();

  const { formData, currentStep, isLoading, error: submitError } = useCreatePropertyFormSelectors();

  const { loading: propertyLoading, error: propertyError } = useProperty(id ?? '');

  const [validationErrors, setValidationErrors] = useState<StepValidationErrors>({});
  const mapRef = useRef<MapApi | null>(null);
  const fullscreenMapRef = useRef<MapApi | null>(null);

  // Derived step list for the active property type AND the selected offerings
  // (no effect needed). The flow grows a per-offering pricing step for each
  // selected offering, so it must recompute when either changes.
  const propertyType = formData.basicInfo.propertyType || DEFAULT_PROPERTY_TYPE;
  const offerings = formData.pricing.offerings;
  const steps = useMemo(() => resolveStepFlow(propertyType, offerings), [propertyType, offerings]);

  const currentType = formData.basicInfo.propertyType || DEFAULT_PROPERTY_TYPE;
  // Clamp the lookup index to the active flow. The flow can shrink when the
  // host deselects an offering (dropping its pricing step); reading a clamped
  // index keeps `stepName` valid (never `undefined`) without an effect.
  const safeStepIndex = Math.min(currentStep, steps.length - 1);
  const stepName = steps[safeStepIndex];
  const fieldsToShow = useMemo(
    () => FIELD_CONFIG[currentType]?.[stepName] ?? [],
    [currentType, stepName],
  );

  // --- The form session -----------------------------------------------------
  // Arriving at the flow OPENS a form session, and that is one async load, so
  // React Query runs it — once per visit (`gcTime: 0` drops it when the screen
  // goes, `staleTime: Infinity` keeps a focus or reconnect from re-running it
  // over the host's work while it is open). Both kinds wait for the persisted
  // form to be read back first: acting on the defaults would see nothing to
  // keep and write over the very work being restored.
  //
  //  - Editing: get the listing (through the same cache entry `useProperty`
  //    reads) and seed the form from it.
  //  - A new listing: the restored form IS the resumption — what was typed, at
  //    the step it was typed on — or the draft the drafts screen just opened.
  //    The one form that must not survive is a listing opened for EDITING:
  //    "Create" never starts from somebody's home.
  const queryClient = useQueryClient();
  useQuery({
    queryKey: ['propertyForm', 'session', id ?? null],
    queryFn: async () => {
      await whenFormRestored();
      if (!id) {
        const store = useCreatePropertyFormStore.getState();
        if (store.editingPropertyId) store.resetForm();
        return null;
      }
      const loaded = await queryClient.ensureQueryData({
        queryKey: ['property', id],
        queryFn: async () => propertyService.getPropertyById(id),
      });
      if (loaded) seedEditForm(loaded);
      return loaded?.id ?? null;
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    retry: false,
  });

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
  // without usable coordinates. Reaching it is a press (Next / Back), so the
  // press resolves it; the ref keeps a later visit from asking again.
  const hasRequestedLocationRef = useRef(false);
  const resolveLocationOnArrival = useCallback(
    (arrivingAt: string | undefined) => {
      if (arrivingAt !== STEP_LOCATION) return;
      if (!needsLocationResolve || hasRequestedLocationRef.current || isResolvingLocation) return;
      hasRequestedLocationRef.current = true;
      resolveUserLocation();
    },
    [needsLocationResolve, isResolvingLocation, resolveUserLocation],
  );

  // --- Address autofill from the map ----------------------------------------
  const applyAddressSelection = useCallback(
    (address: GeocodedAddress, coordinates: [number, number]) => {
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
    (address: GeocodedAddress, coordinates: [number, number]) => {
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
    if (stepName === STEP_PROPERTY_TYPE || stepName === STEP_BASIC_INFO) {
      errors = validateBasicInfoStep(formData.basicInfo, fieldsToShow);
    } else if (stepName === STEP_LOCATION) {
      errors = validateLocationStep(formData.location);
    } else if (stepName === STEP_OFFERING) {
      errors = validateOfferingStep(formData.pricing);
    } else if (stepName === STEP_LONG_TERM_PRICING) {
      errors = validateLongTermPricingStep(formData.pricing);
    } else if (stepName === STEP_NIGHTLY_PRICING) {
      errors = validateNightlyPricingStep(formData.pricing);
    } else if (stepName === STEP_AMENITIES) {
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
  /** Validates the step and advances; returns whether it advanced. */
  const handleNextStep = useCallback((): boolean => {
    if (!validateCurrentStep()) return false;
    nextStep(maxStep);
    // Mirrors the store's own clamp in `nextStep`.
    resolveLocationOnArrival(steps[Math.min(currentStep + 1, maxStep)]);
    return true;
  }, [validateCurrentStep, nextStep, maxStep, resolveLocationOnArrival, steps, currentStep]);

  const handlePrevStep = useCallback(() => {
    setValidationErrors({});
    // Step back from where the host SEES they are: the clamped index, not a
    // stored one past the end of a flow that shrank.
    const previous = Math.max(safeStepIndex - 1, 0);
    setCurrentStep(previous);
    resolveLocationOnArrival(steps[previous]);
  }, [safeStepIndex, setCurrentStep, resolveLocationOnArrival, steps]);

  return {
    // state
    formData,
    currentStep,
    stepIndex: safeStepIndex,
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
    // handlers
    handlePrevStep,
    applyAddressSelection,
    handleAddressSelect,
    handleShowFloorToggle,
    handleFloorChange,
    handleAmenityToggle,
    handlePropertyTypeChange,
    handleNextStep,
  };
}
